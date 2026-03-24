"""
API endpoints for job scope data entry and management.
Supports in-app data entry with real-time calculations.
"""

import math
import re
from typing import Any
import pandas as pd
from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from core.database import get_conn
from api.auth import _current_user
from services.audit_log import fetch_row_dict, record_audit_event
from services.dataset_selector import get_scope_primary_datasets
from services.monthly_emissions import JobMonthlyEmissionsResolver

router = APIRouter()

_FACTOR_ORIGINAL_ID_RE = re.compile(r"(?:^|[;( ])factor_original_id=([^;)\s]+)", re.IGNORECASE)
_STORAGE_REASON_RE = re.compile(r"(?:^|[;( ])storage_reason=([^;)\s]+)", re.IGNORECASE)


def _ensure_job_scope_rows_schema(con) -> None:
    """Keep job_scope_rows schema aligned for data-entry endpoints."""
    try:
        con.execute("ALTER TABLE job_scope_rows ADD COLUMN IF NOT EXISTS site_id INTEGER")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE job_scope_rows ADD COLUMN IF NOT EXISTS category VARCHAR")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE job_scope_rows ADD COLUMN IF NOT EXISTS level_4 VARCHAR")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE job_scope_rows ADD COLUMN IF NOT EXISTS report_label VARCHAR")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE job_scope_rows ADD COLUMN IF NOT EXISTS ghg_unit VARCHAR")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE job_scope_rows ADD COLUMN IF NOT EXISTS apply_pct NUMERIC DEFAULT 100")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE job_scope_rows ADD COLUMN IF NOT EXISTS data_source VARCHAR DEFAULT 'Company Data'")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE job_scope_rows ADD COLUMN IF NOT EXISTS data_confidence VARCHAR DEFAULT 'M'")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE job_scope_rows ADD COLUMN IF NOT EXISTS is_custom_entry BOOLEAN DEFAULT FALSE")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE job_scope_rows ADD COLUMN IF NOT EXISTS source_qty NUMERIC")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE job_scope_rows ADD COLUMN IF NOT EXISTS source_uom VARCHAR")
    except Exception:
        pass


def _legacy_scope_dataset_map(job_id: int) -> dict[str, int]:
    dataset_map: dict[str, int] = {}
    try:
        with get_conn() as con:
            df_config = con.execute(
                "SELECT scope, dataset_id FROM job_scope_config WHERE job_id=%s",
                [int(job_id)]
            ).df()
    except Exception:
        return dataset_map

    if df_config is None or df_config.empty:
        return dataset_map

    df_config = df_config.where(df_config.notna(), None)
    for _, r in df_config.iterrows():
        scope_val = r.get("scope")
        dataset_id = r.get("dataset_id")
        if scope_val and dataset_id is not None:
            try:
                dataset_map[str(scope_val)] = int(dataset_id)
            except Exception:
                continue

    return dataset_map


def _additional_dataset_ids(con, job_id: int) -> list[int]:
    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS job_additional_datasets (
                job_id INTEGER NOT NULL,
                dataset_id INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                PRIMARY KEY (job_id, dataset_id)
            )
            """
        )
        df = con.execute(
            """
            SELECT dataset_id
            FROM job_additional_datasets
            WHERE job_id=%s
            ORDER BY dataset_id
            """,
            [int(job_id)],
        ).df()
        out: list[int] = []
        if df is not None and not df.empty:
            for _, row in df.iterrows():
                dsid = _safe_int(row.get("dataset_id"))
                if dsid is None:
                    continue
                out.append(int(dsid))
        return out
    except Exception:
        return []


def _safe_int(value):
    if value is None:
        return None
    try:
        return int(float(value))
    except Exception:
        return None


def _safe_float(value):
    if value is None:
        return None
    try:
        out = float(value)
        if not math.isfinite(out):
            return None
        return out
    except Exception:
        return None


def _json_safe(value):
    """Normalize values to JSON-safe primitives."""
    if value is None:
        return None
    try:
        # pandas/NumPy NaN handling
        if pd.isna(value):
            return None
    except Exception:
        pass
    try:
        # NumPy scalar -> Python scalar
        if hasattr(value, "item"):
            return value.item()
    except Exception:
        pass
    return value


def _table_columns(con, table_name: str) -> set[str]:
    try:
        df = con.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = %s
            """,
            [str(table_name)],
        ).df()
        if df is None or df.empty:
            return set()
        return {str(v).strip().lower() for v in df["column_name"].tolist()}
    except Exception:
        return set()


def _extract_note_token(notes: str | None, pattern: re.Pattern[str]) -> str | None:
    text = str(notes or "")
    if not text:
        return None
    match = pattern.search(text)
    if not match:
        return None
    value = str(match.group(1) or "").strip()
    return value or None


def _lookup_factor_from_reference(con, dataset_id: int | None, scope: str | None, original_id: str | None) -> dict[str, Any] | None:
    oid = str(original_id or "").strip()
    if not oid:
        return None

    attempts: list[tuple[str, list[Any]]] = []
    if dataset_id is not None and scope:
        attempts.append(
            (
                """
                SELECT db_id, factor, ghg_unit
                FROM factor_lookup
                WHERE dataset_id=%s AND scope=%s AND original_id=%s
                ORDER BY db_id ASC
                LIMIT 1
                """,
                [int(dataset_id), str(scope), oid],
            )
        )
    if dataset_id is not None:
        attempts.append(
            (
                """
                SELECT db_id, factor, ghg_unit
                FROM factor_lookup
                WHERE dataset_id=%s AND original_id=%s
                ORDER BY CASE WHEN scope=%s THEN 0 ELSE 1 END, db_id ASC
                LIMIT 1
                """,
                [int(dataset_id), oid, str(scope or "")],
            )
        )
    if scope:
        attempts.append(
            (
                """
                SELECT db_id, factor, ghg_unit
                FROM factor_lookup
                WHERE scope=%s AND original_id=%s
                ORDER BY dataset_id DESC, db_id ASC
                LIMIT 1
                """,
                [str(scope), oid],
            )
        )
    attempts.append(
        (
            """
            SELECT db_id, factor, ghg_unit
            FROM factor_lookup
            WHERE original_id=%s
            ORDER BY CASE WHEN scope=%s THEN 0 ELSE 1 END, dataset_id DESC, db_id ASC
            LIMIT 1
            """,
            [oid, str(scope or "")],
        )
    )

    for query, params in attempts:
        try:
            row = con.execute(query, params).fetchone()
        except Exception:
            row = None
        if not row:
            continue
        db_id, factor, ghg_unit = row
        return {
            "db_id": _safe_int(db_id),
            "factor": _safe_float(factor),
            "ghg_unit": str(ghg_unit).strip() if ghg_unit is not None else None,
        }
    return None


def _job_scope_row_snapshot(con, job_id: int, row_id: int) -> dict[str, Any] | None:
    return fetch_row_dict(
        con,
        "SELECT * FROM job_scope_rows WHERE row_id = %s AND job_id = %s",
        [int(row_id), int(job_id)],
    )


def _factor_lookup_select_parts(con) -> dict[str, str]:
    cols = _table_columns(con, "factor_lookup")
    has = lambda c: c in cols
    return {
        "level_4_expr": "level_4" if has("level_4") else "NULL::text AS level_4",
        "report_label_expr": "report_label" if has("report_label") else "NULL::text AS report_label",
        "ghg_unit_expr": "ghg_unit" if has("ghg_unit") else "NULL::text AS ghg_unit",
        "search_report_label_expr": "COALESCE(report_label, '')" if has("report_label") else "''",
    }


def _custom_factor_legacy_year_values(row: dict) -> dict[int, float]:
    out: dict[int, float] = {}
    for year in range(2018, 2031):
        key = f"factor_{year}"
        val = _safe_float(row.get(key))
        if val is not None:
            out[int(year)] = float(val)
    return out


def _choose_factor_for_year(year_values: dict[int, float], preferred_year: int | None) -> tuple[float | None, int | None]:
    if not year_values:
        return None, None

    years = sorted(int(y) for y in year_values.keys())
    if preferred_year is None:
        y = years[-1]
        return float(year_values[y]), int(y)

    if preferred_year in year_values:
        return float(year_values[preferred_year]), int(preferred_year)

    lower = [y for y in years if y <= preferred_year]
    if lower:
        y = max(lower)
        return float(year_values[y]), int(y)

    y = years[0]
    return float(year_values[y]), int(y)


def _load_custom_factor_year_values(con, factor_ids: list[int]) -> dict[int, dict[int, float]]:
    out: dict[int, dict[int, float]] = {int(fid): {} for fid in factor_ids}
    if not factor_ids:
        return out

    try:
        table_exists = bool(
            con.execute(
                """
                SELECT 1
                FROM information_schema.tables
                WHERE table_name = 'custom_factor_year_values'
                LIMIT 1
                """
            ).fetchone()
        )
    except Exception:
        table_exists = False

    if not table_exists:
        return out

    placeholders = ",".join(["%s"] * len(factor_ids))
    df = con.execute(
        f"""
        SELECT factor_id, year, factor
        FROM custom_factor_year_values
        WHERE factor_id IN ({placeholders})
        ORDER BY factor_id, year
        """,
        factor_ids,
    ).df()

    if df is None or df.empty:
        return out

    for _, row in df.iterrows():
        fid = _safe_int(row.get("factor_id"))
        year = _safe_int(row.get("year"))
        factor = _safe_float(row.get("factor"))
        if fid is None or year is None or factor is None:
            continue
        out.setdefault(int(fid), {})[int(year)] = float(factor)

    return out


@router.get("/jobs/{job_id}/scope-data")
def get_job_scope_data(job_id, scope: str = None, _user: dict[str, str] = Depends(_current_user)):
    """
    Get all scope data entries for a job with calculated emissions.
    Optionally filter by scope.
    """
    print(f"DEBUG: get_job_scope_data called with job_id={job_id}, scope={scope}")
    print(f"DEBUG: job_id type: {type(job_id)}, value: {repr(job_id)}")
    try:
        with get_conn() as con:
            _ensure_job_scope_rows_schema(con)
            cols = _table_columns(con, "job_scope_rows")
            has_source_qty = "source_qty" in cols
            has_source_uom = "source_uom" in cols
            source_qty_select = "source_qty" if has_source_qty else "NULL::numeric AS source_qty"
            source_uom_select = "source_uom" if has_source_uom else "NULL::text AS source_uom"
            # Verify job exists
            print(f"DEBUG: About to convert job_id to int")
            job_id_int = int(job_id)
            print(f"DEBUG: job_id converted to: {job_id_int}")
            job_exists = con.execute("SELECT 1 FROM jobs WHERE job_id=%s", [job_id_int]).fetchone()
            if not job_exists:
                raise HTTPException(status_code=404, detail="Job not found")
            resolver = JobMonthlyEmissionsResolver(con, job_id_int)
            
            # Build query
            where_clause = "WHERE jsr.job_id=%s AND jsr.enabled=TRUE"
            params = [int(job_id)]
            
            if scope:
                where_clause += " AND jsr.scope=%s"
                params.append(scope)
            
            query = f"""
                SELECT 
                    jsr.row_id, jsr.job_id, jsr.scope, jsr.site_id, jsr.dataset_id, jsr.factor_db_id, jsr.original_id,
                    jsr.category, jsr.level_1, jsr.level_2, jsr.level_3, jsr.level_4, jsr.column_text, jsr.report_label,
                    jsr.qty, jsr.uom, jsr.factor, jsr.ghg_unit, jsr.calc_tco2e, jsr.apply_pct,
                    {source_qty_select}, {source_uom_select},
                    jsr.month_1, jsr.month_2, jsr.month_3, jsr.month_4, jsr.month_5, jsr.month_6,
                    jsr.month_7, jsr.month_8, jsr.month_9, jsr.month_10, jsr.month_11, jsr.month_12,
                    jsr.data_source, jsr.data_confidence, jsr.notes, jsr.is_custom_entry, jsr.created_at, jsr.updated_at,
                    fl.factor AS lookup_factor,
                    fl.ghg_unit AS lookup_ghg_unit
                FROM job_scope_rows jsr
                LEFT JOIN factor_lookup fl ON fl.db_id = jsr.factor_db_id
                {where_clause}
                ORDER BY jsr.scope, jsr.category, jsr.report_label
            """
            
            # Execute query and get raw cursor
            result = con.execute(query, params)
            cursor = result.cursor
            
            # Get column names from cursor description
            columns = [desc[0] for desc in cursor.description]
            
            # Fetch all rows
            raw_rows = cursor.fetchall()
            
            rows = []
            for idx, raw_row in enumerate(raw_rows):
                try:
                    # Convert row tuple to dict
                    r = dict(zip(columns, raw_row))
                    
                    # Helper function to safely convert to int
                    def safe_int(val):
                        if val is None:
                            return None
                        try:
                            return int(val)
                        except (ValueError, TypeError):
                            return None
                    
                    def safe_float(val):
                        if val is None:
                            return None
                        try:
                            out = float(val)
                            if not math.isfinite(out):
                                return None
                            return out
                        except (ValueError, TypeError):
                            return None
                    
                    def safe_bool(val):
                        if val is None:
                            return False
                        try:
                            return bool(val)
                        except (ValueError, TypeError):
                            return False
                    
                    metrics = resolver.row_metrics(r)
                    source_qty_val = safe_float(metrics.get("source_qty"))
                    source_uom_val = metrics.get("source_uom")
                    storage_qty_val = safe_float(metrics.get("storage_qty"))
                    storage_uom_val = metrics.get("storage_uom")
                    storage_factor_val = safe_float(metrics.get("storage_factor"))
                    reference_factor_val = safe_float(metrics.get("reference_factor"))
                    
                    rows.append({
                        "row_id": safe_int(r.get("row_id")),
                        "job_id": safe_int(r.get("job_id")),
                        "scope": r.get("scope"),
                        "site_id": safe_int(r.get("site_id")),
                        "dataset_id": safe_int(metrics.get("display_dataset_id")) or safe_int(r.get("dataset_id")),
                        "factor_db_id": safe_int(r.get("factor_db_id")),
                        "original_id": r.get("original_id"),
                        "category": r.get("category"),
                        "level_1": r.get("level_1"),
                        "level_2": r.get("level_2"),
                        "level_3": r.get("level_3"),
                        "level_4": r.get("level_4"),
                        "column_text": r.get("column_text"),
                        "report_label": r.get("report_label"),
                        "qty": safe_float(metrics.get("display_qty")),
                        "uom": metrics.get("display_uom"),
                        "factor": safe_float(metrics.get("display_factor")),
                        "source_qty": source_qty_val,
                        "source_uom": source_uom_val,
                        "storage_qty": storage_qty_val,
                        "storage_uom": storage_uom_val,
                        "storage_factor": storage_factor_val,
                        "reference_factor": reference_factor_val,
                        "factor_reference": metrics.get("factor_reference"),
                        "storage_reason": metrics.get("storage_reason"),
                        "uses_emissions_fallback": bool(metrics.get("uses_emissions_fallback")),
                        "source_volume_available": bool(metrics.get("source_volume_available")),
                        "factor_label": metrics.get("factor_label"),
                        "dataset_label": metrics.get("dataset_label"),
                        "monthly_factor_details": metrics.get("monthly_factor_details") or [],
                        "uses_monthly_factors": bool(metrics.get("uses_monthly_factors")),
                        "ghg_unit": r.get("ghg_unit"),
                        "calc_tco2e": round(float(metrics.get("calc_tco2e") or 0.0), 4),
                        "tco2e_before_apply": round(float(metrics.get("tco2e_before_apply") or 0.0), 4),
                        "apply_pct": safe_float(r.get("apply_pct")) or 100,
                        "month_1": safe_float(r.get("month_1")),
                        "month_2": safe_float(r.get("month_2")),
                        "month_3": safe_float(r.get("month_3")),
                        "month_4": safe_float(r.get("month_4")),
                        "month_5": safe_float(r.get("month_5")),
                        "month_6": safe_float(r.get("month_6")),
                        "month_7": safe_float(r.get("month_7")),
                        "month_8": safe_float(r.get("month_8")),
                        "month_9": safe_float(r.get("month_9")),
                        "month_10": safe_float(r.get("month_10")),
                        "month_11": safe_float(r.get("month_11")),
                        "month_12": safe_float(r.get("month_12")),
                        "data_source": r.get("data_source"),
                        "data_confidence": r.get("data_confidence"),
                        "notes": r.get("notes"),
                        "is_custom_entry": safe_bool(r.get("is_custom_entry")),
                        "created_at": str(r.get("created_at")) if r.get("created_at") else None,
                        "updated_at": str(r.get("updated_at")) if r.get("updated_at") else None,
                    })
                except Exception as row_error:
                    print(f"ERROR processing row {idx}: {row_error}")
                    print(f"Row data: {raw_row}")
                    raise
            
            try:
                job_id_int = int(job_id)
            except Exception as jid_error:
                print(f"ERROR converting job_id to int: {job_id}, error: {jid_error}")
                job_id_int = job_id
            
            return {"job_id": job_id_int, "rows": rows, "total": len(rows)}
            
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        print(f"ERROR in get_job_scope_data: {error_details}")
        print(f"Exception type: {type(e)}")
        print(f"Exception args: {e.args}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch scope data: {str(e)}")


@router.get("/jobs/{job_id}/scope-totals")
def get_job_scope_totals(job_id: int, _user: dict[str, str] = Depends(_current_user)):
    """
    Get aggregated scope totals and emissions summary for a job.
    """
    try:
        with get_conn() as con:
            _ensure_job_scope_rows_schema(con)
            # Verify job exists
            job_exists = con.execute("SELECT 1 FROM jobs WHERE job_id=%s", [int(job_id)]).fetchone()
            if not job_exists:
                raise HTTPException(status_code=404, detail="Job not found")
            resolver = JobMonthlyEmissionsResolver(con, int(job_id))
            
            # Get all rows
            df = con.execute(
                """
                SELECT scope, dataset_id, factor_db_id, original_id, qty, uom, factor, ghg_unit, apply_pct, notes, source_qty, source_uom,
                       month_1, month_2, month_3, month_4, month_5, month_6,
                       month_7, month_8, month_9, month_10, month_11, month_12
                FROM job_scope_rows
                WHERE job_id=%s AND enabled=TRUE
                """,
                [int(job_id)]
            ).df()
            
            totals = {
                "Scope 1": 0.0,
                "Scope 2": 0.0,
                "Scope 3": 0.0,
                "Total": 0.0
            }
            
            if df is not None and not df.empty:
                for _, r in df.iterrows():
                    metrics = resolver.row_metrics(r)
                    emissions = float(metrics.get("calc_tco2e") or 0.0)
                    scope = r.get('scope')
                    if scope in totals:
                        totals[scope] += emissions
                        totals["Total"] += emissions
            
            # Round scope values first, then sum them for total to ensure consistency
            scope_1_rounded = round(totals["Scope 1"], 2)
            scope_2_rounded = round(totals["Scope 2"], 2)
            scope_3_rounded = round(totals["Scope 3"], 2)
            
            return {
                "job_id": int(job_id),
                "scope_1": scope_1_rounded,
                "scope_2": scope_2_rounded,
                "scope_3": scope_3_rounded,
                "total": scope_1_rounded + scope_2_rounded + scope_3_rounded
            }
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to calculate scope totals: {e}")


@router.post("/jobs/{job_id}/scope-data")
def create_scope_data_row(
    request: Request,
    job_id: int,
    payload: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user)
):
    """
    Create a new scope data entry row.
    """
    try:
        with get_conn() as con:
            _ensure_job_scope_rows_schema(con)
            # Verify job exists
            job_exists = con.execute("SELECT 1 FROM jobs WHERE job_id=%s", [int(job_id)]).fetchone()
            if not job_exists:
                raise HTTPException(status_code=404, detail="Job not found")
            
            # Extract fields
            scope = payload.get("scope")
            original_id = payload.get("original_id")
            
            if not scope or not original_id:
                raise HTTPException(status_code=400, detail="scope and original_id are required")
            
            # Extract site_id from payload
            site_id = payload.get("site_id")
            if site_id is not None:
                try:
                    site_id = int(site_id)
                except (ValueError, TypeError):
                    site_id = None

            # Insert row
            result = con.execute(
                """
                INSERT INTO job_scope_rows (
                    job_id, scope, site_id, dataset_id, factor_db_id, original_id,
                    category, level_1, level_2, level_3, level_4, column_text, report_label,
                    qty, uom, factor, ghg_unit, apply_pct, data_source, data_confidence, notes, is_custom_entry,
                    month_1, month_2, month_3, month_4, month_5, month_6,
                    month_7, month_8, month_9, month_10, month_11, month_12
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING row_id
                """,
                [
                    int(job_id),
                    scope,
                    site_id,
                    payload.get("dataset_id"),
                    payload.get("factor_db_id"),
                    original_id,
                    payload.get("category"),
                    payload.get("level_1"),
                    payload.get("level_2"),
                    payload.get("level_3"),
                    payload.get("level_4"),
                    payload.get("column_text"),
                    payload.get("report_label"),
                    payload.get("qty"),
                    payload.get("uom"),
                    payload.get("factor"),
                    payload.get("ghg_unit"),
                    payload.get("apply_pct", 100),
                    payload.get("data_source", "Company Data"),
                    payload.get("data_confidence", "M"),
                    payload.get("notes"),
                    payload.get("is_custom_entry", False),
                    payload.get("month_1"),
                    payload.get("month_2"),
                    payload.get("month_3"),
                    payload.get("month_4"),
                    payload.get("month_5"),
                    payload.get("month_6"),
                    payload.get("month_7"),
                    payload.get("month_8"),
                    payload.get("month_9"),
                    payload.get("month_10"),
                    payload.get("month_11"),
                    payload.get("month_12"),
                ]
            ).fetchone()
            
            row_id = result[0] if result else None
            after = _job_scope_row_snapshot(con, int(job_id), int(row_id))
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="create",
                entity_type="job_scope_row",
                entity_id=int(row_id),
                job_id=int(job_id),
                after=after,
                metadata={
                    "scope": scope,
                    "original_id": original_id,
                    "dataset_id": payload.get("dataset_id"),
                    "factor_db_id": payload.get("factor_db_id"),
                },
            )

            return {"ok": True, "row_id": int(row_id), "job_id": int(job_id)}
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create scope data row: {e}")


@router.patch("/jobs/{job_id}/scope-data/{row_id}")
def update_scope_data_row(
    request: Request,
    job_id: int,
    row_id: int,
    payload: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user)
):
    """
    Update an existing scope data entry row.
    """
    try:
        with get_conn() as con:
            _ensure_job_scope_rows_schema(con)
            before = _job_scope_row_snapshot(con, int(job_id), int(row_id))
            # Verify row exists and belongs to job
            row_exists = con.execute(
                "SELECT 1 FROM job_scope_rows WHERE row_id=%s AND job_id=%s",
                [int(row_id), int(job_id)]
            ).fetchone()
            
            if not row_exists:
                raise HTTPException(status_code=404, detail="Row not found")
            
            # Build update query dynamically based on provided fields
            update_fields = []
            params = []
            
            allowed_fields = [
                "qty", "apply_pct", "data_source", "data_confidence", "notes", "site_id",
                "month_1", "month_2", "month_3", "month_4", "month_5", "month_6",
                "month_7", "month_8", "month_9", "month_10", "month_11", "month_12"
            ]
            
            for field in allowed_fields:
                if field in payload:
                    update_fields.append(f"{field}=%s")
                    params.append(payload[field])
            
            if not update_fields:
                raise HTTPException(status_code=400, detail="No valid fields to update")
            
            # Add updated_at
            update_fields.append("updated_at=NOW()")
            
            # Add row_id to params
            params.append(int(row_id))
            
            query = f"""
                UPDATE job_scope_rows
                SET {', '.join(update_fields)}
                WHERE row_id=%s
            """
            
            con.execute(query, params)

            after = _job_scope_row_snapshot(con, int(job_id), int(row_id))
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="update",
                entity_type="job_scope_row",
                entity_id=int(row_id),
                job_id=int(job_id),
                before=before,
                after=after,
                metadata={"updated_fields": [field for field in allowed_fields if field in payload]},
            )

            return {"ok": True, "row_id": int(row_id), "job_id": int(job_id)}
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update scope data row: {e}")


@router.delete("/jobs/{job_id}/scope-data/{row_id}")
def delete_scope_data_row(
    request: Request,
    job_id: int,
    row_id: int,
    _user: dict[str, str] = Depends(_current_user)
):
    """
    Delete (soft delete) a scope data entry row.
    """
    try:
        with get_conn() as con:
            _ensure_job_scope_rows_schema(con)
            before = _job_scope_row_snapshot(con, int(job_id), int(row_id))
            # Verify row exists and belongs to job
            row_exists = con.execute(
                "SELECT 1 FROM job_scope_rows WHERE row_id=%s AND job_id=%s",
                [int(row_id), int(job_id)]
            ).fetchone()
            
            if not row_exists:
                raise HTTPException(status_code=404, detail="Row not found")
            
            # Soft delete by setting enabled=FALSE
            con.execute(
                "UPDATE job_scope_rows SET enabled=FALSE, updated_at=NOW() WHERE row_id=%s",
                [int(row_id)]
            )

            after = _job_scope_row_snapshot(con, int(job_id), int(row_id))
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="delete",
                entity_type="job_scope_row",
                entity_id=int(row_id),
                job_id=int(job_id),
                before=before,
                after=after,
            )

            return {"ok": True, "row_id": int(row_id), "job_id": int(job_id)}
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete scope data row: {e}")


@router.get("/jobs/{job_id}/template-factors-test")
def get_template_factors_test(job_id: int):
    """Simple test endpoint without authentication"""
    print(f"TEST ENDPOINT CALLED for job_id={job_id}")
    return {"test": "success", "job_id": job_id}

@router.get("/jobs/{job_id}/template-factors")
def get_template_factors(
    job_id: int,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    search: str = Query(""),
    scope: str = Query(""),
    _user: dict[str, str] = Depends(_current_user)
):
    """
    Get available factors for this job with pagination and search.
    Returns factors from:
    1. Custom factors (highest priority)
    2. Full dataset factors from assigned datasets
    
    Supports pagination (limit/offset) and search filtering.
    """
    try:
        with get_conn() as con:
            _ensure_job_scope_rows_schema(con)
            # Verify job exists
            job_row = con.execute(
                """
                SELECT client_db_id, reporting_year, reporting_period_end
                FROM jobs
                WHERE job_id=%s
                """,
                [int(job_id)],
            ).fetchone()
            if not job_row:
                raise HTTPException(status_code=404, detail="Job not found")

            job_client_db_id = _safe_int(job_row[0])
            job_reporting_year = _safe_int(job_row[1])
            if job_reporting_year is None and job_row[2] is not None:
                try:
                    job_reporting_year = int(getattr(job_row[2], "year", None) or str(job_row[2])[:4])
                except Exception:
                    job_reporting_year = None

            search_term = (search or "").strip().lower()

            dataset_map: dict[str, int] = {}

            # Primary mode: automatic dataset resolution.
            try:
                resolved = get_scope_primary_datasets(int(job_id))
                for scope_val, dataset_id in (resolved or {}).items():
                    if scope_val and dataset_id is not None:
                        dataset_map[str(scope_val)] = int(dataset_id)
            except Exception:
                # Fall back to legacy manual scope config.
                dataset_map = {}

            if not dataset_map:
                dataset_map = _legacy_scope_dataset_map(int(job_id))
            extra_dataset_ids = _additional_dataset_ids(con, int(job_id))

            # ---------------------------------------------------------------
            # 1) Custom factors (global + client-specific) - highest priority
            # ---------------------------------------------------------------
            custom_factors: list[dict] = []
            custom_total = 0

            try:
                has_custom_factors = bool(
                    con.execute(
                        """
                        SELECT 1
                        FROM information_schema.tables
                        WHERE table_name='custom_factors'
                        LIMIT 1
                        """
                    ).fetchone()
                )
            except Exception:
                has_custom_factors = False

            if has_custom_factors:
                try:
                    cf_where = [
                        "(archived = FALSE OR archived IS NULL)",
                        "COALESCE(is_active, TRUE) = TRUE",
                    ]
                    cf_params: list = []

                    if scope and scope.strip():
                        cf_where.append("scope = %s")
                        cf_params.append(scope.strip())

                    if job_client_db_id is not None:
                        cf_where.append("(COALESCE(is_global, TRUE) = TRUE OR client_db_id = %s)")
                        cf_params.append(int(job_client_db_id))
                    else:
                        cf_where.append("COALESCE(is_global, TRUE) = TRUE")

                    if search_term:
                        search_pattern = f"%{search_term}%"
                        cf_where.append(
                            """
                            (
                              LOWER(COALESCE(custom_id, '')) LIKE %s
                              OR LOWER(COALESCE(description, '')) LIKE %s
                              OR LOWER(COALESCE(report_label, '')) LIKE %s
                              OR LOWER(COALESCE(category, '')) LIKE %s
                              OR LOWER(COALESCE(source, '')) LIKE %s
                            )
                            """
                        )
                        cf_params.extend([
                            search_pattern,
                            search_pattern,
                            search_pattern,
                            search_pattern,
                            search_pattern,
                        ])

                    cf_where_sql = " AND ".join(cf_where)
                    cf_df = con.execute(
                        f"""
                        SELECT factor_id, custom_id, country, scope, description, report_label, category,
                               uom, ghg_unit, source, is_global, client_db_id,
                               factor_2018, factor_2019, factor_2020, factor_2021, factor_2022,
                               factor_2023, factor_2024, factor_2025, factor_2026, factor_2027,
                               factor_2028, factor_2029, factor_2030
                        FROM custom_factors
                        WHERE {cf_where_sql}
                        ORDER BY scope, category, report_label, description, factor_id
                        """,
                        cf_params,
                    ).df()

                    if cf_df is not None and not cf_df.empty:
                        cf_df = cf_df.where(cf_df.notna(), None)
                        factor_ids = [
                            int(v)
                            for v in cf_df["factor_id"].tolist()
                            if _safe_int(v) is not None
                        ]
                        year_map = _load_custom_factor_year_values(con, factor_ids)

                        for _, row in cf_df.iterrows():
                            factor_id = _safe_int(row.get("factor_id"))
                            if factor_id is None:
                                continue

                            row_dict = {k: row.get(k) for k in row.index}
                            years = _custom_factor_legacy_year_values(row_dict)
                            years.update(year_map.get(int(factor_id), {}))

                            factor_value, factor_year = _choose_factor_for_year(years, job_reporting_year)
                            if factor_value is None:
                                continue

                            custom_id = str(row.get("custom_id") or "").strip() or f"CF-{factor_id}"
                            report_label_val = str(row.get("report_label") or "").strip() or str(row.get("description") or "").strip() or custom_id
                            category_val = str(row.get("category") or "").strip() or str(row.get("scope") or "").strip()

                            custom_factors.append(
                                {
                                    "scope": row.get("scope"),
                                    "category": category_val,
                                    "report_label": report_label_val,
                                    "original_id": custom_id,
                                    "uom": row.get("uom"),
                                    "dataset_id": None,
                                    "factor_db_id": None,
                                    "factor": float(factor_value),
                                    "ghg_unit": row.get("ghg_unit"),
                                    "level_3": None,
                                    "level_4": None,
                                    "is_custom": True,
                                    "source": row.get("source"),
                                    "custom_factor_id": int(factor_id),
                                    "factor_year": int(factor_year) if factor_year is not None else None,
                                    "is_global": bool(row.get("is_global")) if row.get("is_global") is not None else True,
                                    "client_db_id": _safe_int(row.get("client_db_id")),
                                }
                            )
                except Exception as cf_error:
                    print(f"WARNING: custom_factors load skipped due to error: {cf_error}")

            custom_total = len(custom_factors)

            # ---------------------------------------------------------------
            # 2) Dataset factors from resolved scope datasets
            # ---------------------------------------------------------------
            dataset_total = 0
            dataset_factors: list[dict] = []

            if dataset_map or extra_dataset_ids:
                try:
                    dataset_ids = list(dataset_map.values())
                    for dsid in extra_dataset_ids:
                        if dsid not in dataset_ids:
                            dataset_ids.append(dsid)
                    where_clauses = [f"dataset_id IN ({','.join(['%s'] * len(dataset_ids))})"]
                    params = list(dataset_ids)
                    fl_parts = _factor_lookup_select_parts(con)

                    if scope and scope.strip():
                        where_clauses.append("scope = %s")
                        params.append(scope.strip())

                    if search_term:
                        search_pattern = f"%{search_term}%"
                        where_clauses.append(
                            f"(LOWER({fl_parts['search_report_label_expr']}) LIKE %s OR LOWER(COALESCE(level_2, '')) LIKE %s OR LOWER(COALESCE(level_3, '')) LIKE %s OR LOWER(COALESCE(original_id, '')) LIKE %s)"
                        )
                        params.extend([search_pattern, search_pattern, search_pattern, search_pattern])

                    where_sql = " AND ".join(where_clauses)

                    # Count dataset factors separately.
                    count_query = f"SELECT COUNT(*) FROM factor_lookup WHERE {where_sql}"
                    dataset_total = int(con.execute(count_query, params).fetchone()[0] or 0)

                    # Custom factors are always first in list order.
                    if offset < custom_total:
                        custom_page = custom_factors[offset: offset + limit]
                        remaining_limit = max(0, limit - len(custom_page))
                        dataset_offset = 0
                    else:
                        custom_page = []
                        remaining_limit = int(limit)
                        dataset_offset = int(offset - custom_total)

                    if remaining_limit > 0:
                        query = f"""
                            SELECT db_id, dataset_id, scope, original_id, level_1, level_2, level_3, {fl_parts['level_4_expr']},
                                   column_text, {fl_parts['report_label_expr']}, uom, factor, {fl_parts['ghg_unit_expr']}
                            FROM factor_lookup
                            WHERE {where_sql}
                            ORDER BY scope, level_2, level_3, report_label
                            LIMIT %s OFFSET %s
                        """
                        df_factors = con.execute(query, [*params, int(remaining_limit), int(dataset_offset)]).df()

                        if df_factors is not None and not df_factors.empty:
                            df_factors = df_factors.where(df_factors.notna(), None)

                            for _, row in df_factors.iterrows():
                                factor_val = _safe_float(row.get('factor'))
                                dataset_factors.append({
                                    "scope": row.get('scope'),
                                    "category": row.get('level_2') or row.get('level_1'),
                                    "report_label": row.get('report_label') or row.get('column_text'),
                                    "original_id": row.get('original_id'),
                                    "uom": row.get('uom'),
                                    "dataset_id": int(row.get('dataset_id')) if row.get('dataset_id') is not None else None,
                                    "factor_db_id": int(row.get('db_id')) if row.get('db_id') is not None else None,
                                    "factor": factor_val,
                                    "ghg_unit": row.get('ghg_unit'),
                                    "level_3": row.get('level_3'),
                                    "level_4": row.get('level_4'),
                                    "is_custom": False,
                                    "source": None,
                                })

                    factors = [*custom_page, *dataset_factors]
                    total_count = custom_total + dataset_total
                except Exception as ds_error:
                    print(f"WARNING: dataset factor lookup failed, returning custom factors only: {ds_error}")
                    factors = custom_factors[offset: offset + limit]
                    total_count = custom_total
            else:
                factors = custom_factors[offset: offset + limit]
                total_count = custom_total

            safe_factors = [{k: _json_safe(v) for k, v in row.items()} for row in factors]
            return {
                "job_id": int(job_id),
                "factors": safe_factors,
                "total": int(total_count),
                "limit": int(limit),
                "offset": int(offset),
                "has_more": bool((offset + limit) < total_count),
            }
            
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_details = f"Failed to fetch template factors: {e}\n{traceback.format_exc()}"
        print(f"ERROR: {error_details}")
        # Fail-safe response for UI continuity; diagnostics are logged server-side.
        return {
            "job_id": int(job_id),
            "factors": [],
            "total": 0,
            "limit": int(limit),
            "offset": int(offset),
            "has_more": False,
            "error": f"Failed to fetch template factors: {e}",
        }
