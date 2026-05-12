"""
API endpoints for job scope data entry and management.
Supports in-app data entry with real-time calculations.
"""

import math
import logging
import re
from typing import Any
import pandas as pd
from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from core.database import get_conn
from api.auth import _current_user
from api.job_communications_routes import _ensure_tables as _ensure_job_communications_tables
from api.job_data_output_routes import _build_scope_summary, _load_data_output_rows
from services.audit_log import ensure_audit_log_table, fetch_row_dict, parse_json_text, record_audit_event
from services.dataset_selector import get_scope_primary_datasets
from services.monthly_emissions import JobMonthlyEmissionsResolver

router = APIRouter()
logger = logging.getLogger(__name__)

_FACTOR_ORIGINAL_ID_RE = re.compile(r"(?:^|[;( ])factor_original_id=([^;)\s]+)", re.IGNORECASE)
_STORAGE_REASON_RE = re.compile(r"(?:^|[;( ])storage_reason=([^;)\s]+)", re.IGNORECASE)


def _ensure_job_scope_rows_schema(con) -> None:
    """Keep job_scope_rows schema aligned for data-entry endpoints."""
    try:
        con.execute("ALTER TABLE job_scope_rows ADD COLUMN IF NOT EXISTS site_id INTEGER")
    except Exception:
        logger.debug("Ignoring job_scope_rows.site_id compatibility migration failure", exc_info=True)
    try:
        con.execute("ALTER TABLE job_scope_rows ADD COLUMN IF NOT EXISTS category VARCHAR")
    except Exception:
        logger.debug("Ignoring job_scope_rows.category compatibility migration failure", exc_info=True)
    try:
        con.execute("ALTER TABLE job_scope_rows ADD COLUMN IF NOT EXISTS level_4 VARCHAR")
    except Exception:
        logger.debug("Ignoring job_scope_rows.level_4 compatibility migration failure", exc_info=True)
    try:
        con.execute("ALTER TABLE job_scope_rows ADD COLUMN IF NOT EXISTS report_label VARCHAR")
    except Exception:
        logger.debug("Ignoring job_scope_rows.report_label compatibility migration failure", exc_info=True)
    try:
        con.execute("ALTER TABLE job_scope_rows ADD COLUMN IF NOT EXISTS ghg_unit VARCHAR")
    except Exception:
        logger.debug("Ignoring job_scope_rows.ghg_unit compatibility migration failure", exc_info=True)
    try:
        con.execute("ALTER TABLE job_scope_rows ADD COLUMN IF NOT EXISTS apply_pct NUMERIC DEFAULT 100")
    except Exception:
        logger.debug("Ignoring job_scope_rows.apply_pct compatibility migration failure", exc_info=True)
    try:
        con.execute("ALTER TABLE job_scope_rows ADD COLUMN IF NOT EXISTS data_source VARCHAR DEFAULT 'Company Data'")
    except Exception:
        logger.debug("Ignoring job_scope_rows.data_source compatibility migration failure", exc_info=True)
    try:
        con.execute("ALTER TABLE job_scope_rows ADD COLUMN IF NOT EXISTS data_confidence VARCHAR DEFAULT 'M'")
    except Exception:
        logger.debug("Ignoring job_scope_rows.data_confidence compatibility migration failure", exc_info=True)
    try:
        con.execute("ALTER TABLE job_scope_rows ADD COLUMN IF NOT EXISTS is_custom_entry BOOLEAN DEFAULT FALSE")
    except Exception:
        logger.debug("Ignoring job_scope_rows.is_custom_entry compatibility migration failure", exc_info=True)
    try:
        con.execute("ALTER TABLE job_scope_rows ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT TRUE")
    except Exception:
        logger.debug("Ignoring job_scope_rows.enabled compatibility migration failure", exc_info=True)
    try:
        con.execute("ALTER TABLE job_scope_rows ADD COLUMN IF NOT EXISTS source_qty NUMERIC")
    except Exception:
        logger.debug("Ignoring job_scope_rows.source_qty compatibility migration failure", exc_info=True)
    try:
        con.execute("ALTER TABLE job_scope_rows ADD COLUMN IF NOT EXISTS source_uom VARCHAR")
    except Exception:
        logger.debug("Ignoring job_scope_rows.source_uom compatibility migration failure", exc_info=True)
    try:
        con.execute("ALTER TABLE job_scope_rows ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()")
    except Exception:
        logger.debug("Ignoring job_scope_rows.updated_at compatibility migration failure", exc_info=True)
    try:
        con.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS job_scope_rows_job_site_scope_active_uidx
            ON job_scope_rows (job_id, site_id, scope, original_id)
            WHERE COALESCE(enabled, TRUE) = TRUE
            """
        )
    except Exception:
        logger.debug("Ignoring job_scope_rows unique index compatibility migration failure", exc_info=True)
    try:
        con.execute("DROP INDEX IF EXISTS job_scope_rows_job_site_scope_oid_uidx")
    except Exception:
        logger.debug("Ignoring job_scope_rows unique index drop failure", exc_info=True)


def _legacy_scope_dataset_map(job_id: int) -> dict[str, int]:
    dataset_map: dict[str, int] = {}
    try:
        with get_conn() as con:
            df_config = con.execute(
                "SELECT scope, dataset_id FROM job_scope_config WHERE job_id=%s",
                [int(job_id)]
            ).df()
    except Exception:
        logger.debug("Failed to load legacy scope dataset map; returning empty map", exc_info=True)
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
                logger.debug("Skipping invalid legacy scope dataset mapping value", exc_info=True)
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
        logger.debug("Failed to load legacy scope dataset ids; returning empty list", exc_info=True)
        return []


def _safe_int(value):
    if value is None:
        return None
    try:
        return int(float(value))
    except Exception:
        logger.debug("Failed to coerce numeric value; returning None", exc_info=True)
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
        logger.debug("Failed to parse output row bundle; returning None", exc_info=True)
        return None


def _safe_text(value: Any) -> str:
    return str(value or "").strip()


def _json_safe(value):
    """Normalize values to JSON-safe primitives."""
    if value is None:
        return None
    try:
        # pandas/NumPy NaN handling
        if pd.isna(value):
            return None
    except Exception:
        logger.debug("Skipping NaN check failure while normalizing value", exc_info=True)
    try:
        # NumPy scalar -> Python scalar
        if hasattr(value, "item"):
            return value.item()
    except Exception:
        logger.debug("Skipping item() extraction failure while normalizing value", exc_info=True)
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
        logger.debug("Failed to read selector columns; returning empty set", exc_info=True)
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
            logger.debug("Optional lookup failed while resolving scope data", exc_info=True)
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
        "category_expr": "category" if has("category") else "NULL::text",
        # fl_category_expr is table-alias-qualified for use inside JOIN queries
        # where an unqualified "category" would be ambiguous with jsr.category.
        "fl_category_expr": "fl.category" if has("category") else "NULL::text",
        "level_1_expr": "level_1" if has("level_1") else "NULL::text AS level_1",
        "level_2_expr": "level_2" if has("level_2") else "NULL::text AS level_2",
        "level_4_expr": "level_4" if has("level_4") else "NULL::text AS level_4",
        "report_label_expr": "report_label" if has("report_label") else "NULL::text AS report_label",
        "column_text_expr": "column_text" if has("column_text") else "NULL::text AS column_text",
        "ghg_unit_expr": "ghg_unit" if has("ghg_unit") else "NULL::text AS ghg_unit",
        "search_report_label_expr": "COALESCE(report_label, '')" if has("report_label") else "''",
    }


def _search_tokens(search_text: str | None) -> list[str]:
    raw = str(search_text or "").strip().lower()
    if not raw:
        return []
    tokens: list[str] = []
    for token in re.split(r"\s+", raw):
        cleaned = token.strip()
        if cleaned and cleaned not in tokens:
            tokens.append(cleaned)
    return tokens


def _append_multi_token_like_filters(where_clauses: list[str], params: list, fields: list[str], search_text: str | None) -> None:
    tokens = _search_tokens(search_text)
    if not tokens or not fields:
        return

    for token in tokens:
        pattern = f"%{token}%"
        where_clauses.append(
            "(" + " OR ".join([f"LOWER(COALESCE({field}, '')) LIKE %s" for field in fields]) + ")"
        )
        params.extend([pattern] * len(fields))


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
        logger.debug("Failed to detect table existence; defaulting to False", exc_info=True)
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


def _scope_data_fallback_metrics(row: dict[str, Any]) -> dict[str, Any]:
    """Return a minimal, safe emissions payload when the resolver cannot run.

    The data-entry screen should still render stored rows even if dataset
    resolution or factor lookups fail for a specific job. We keep the fallback
    intentionally simple so a broken lookup path does not take down the page.
    """

    storage_qty = _safe_float(row.get("qty"))
    storage_uom = str(row.get("uom")).strip() if row.get("uom") is not None else None
    storage_factor = _safe_float(row.get("factor"))
    apply_pct = _safe_float(row.get("apply_pct")) or 100.0
    ghg_unit = str(row.get("ghg_unit")).strip() if row.get("ghg_unit") is not None else None

    monthly_total = 0.0
    for idx in range(1, 13):
        monthly_total += _safe_float(row.get(f"month_{idx}")) or 0.0

    annual_qty = storage_qty if storage_qty is not None else monthly_total
    factor_value = storage_factor
    emissions = float(annual_qty or 0.0) * float(factor_value or 0.0) * (apply_pct / 100.0)
    if "kg" in str(ghg_unit or "kgCO2e").lower():
        emissions /= 1000.0

    notes = row.get("notes")
    factor_reference = _extract_note_token(notes, _FACTOR_ORIGINAL_ID_RE)
    storage_reason = _extract_note_token(notes, _STORAGE_REASON_RE)

    return {
        "display_qty": annual_qty,
        "display_uom": storage_uom,
        "calc_tco2e": emissions,
        "tco2e_before_apply": emissions if apply_pct == 100.0 else (
            float(annual_qty or 0.0) * float(factor_value or 0.0)
            / 1000.0 if "kg" in str(ghg_unit or "kgCO2e").lower()
            else float(annual_qty or 0.0) * float(factor_value or 0.0)
        ),
        "display_factor": factor_value,
        "factor_label": factor_reference,
        "dataset_label": None,
        "monthly_factor_details": [],
        "uses_monthly_factors": False,
        "source_qty": _safe_float(row.get("source_qty")),
        "source_uom": str(row.get("source_uom")).strip() if row.get("source_uom") is not None else None,
        "storage_qty": annual_qty,
        "storage_uom": storage_uom,
        "storage_factor": storage_factor,
        "reference_factor": None,
        "reference_ghg_unit": ghg_unit,
        "factor_reference": factor_reference,
        "storage_reason": storage_reason,
        "unit_warning": None,
        "uses_emissions_fallback": False,
        "source_volume_available": bool(row.get("source_qty") is not None and row.get("source_uom")),
        "display_dataset_id": _safe_int(row.get("dataset_id")),
    }


@router.get("/jobs/{job_id}/scope-data")
def get_job_scope_data(
    job_id,
    scope: str = None,
    include_disabled: bool = Query(False),
    _user: dict[str, str] = Depends(_current_user),
):
    """
    Get all scope data entries for a job with calculated emissions.
    Optionally filter by scope.
    """
    try:
        with get_conn() as con:
            _ensure_job_scope_rows_schema(con)
            cols = _table_columns(con, "job_scope_rows")
            has_source_qty = "source_qty" in cols
            has_source_uom = "source_uom" in cols
            source_qty_select = "source_qty" if has_source_qty else "NULL::numeric AS source_qty"
            source_uom_select = "source_uom" if has_source_uom else "NULL::text AS source_uom"
            fl_parts = _factor_lookup_select_parts(con)
            job_id_int = int(job_id)
            job_exists = con.execute("SELECT 1 FROM jobs WHERE job_id=%s", [job_id_int]).fetchone()
            if not job_exists:
                raise HTTPException(status_code=404, detail="Job not found")
            try:
                resolver = JobMonthlyEmissionsResolver(con, job_id_int)
            except Exception as resolver_error:
                logger.warning("Falling back to minimal scope-data metrics for job %s", job_id_int, exc_info=True)
                resolver = None
            
            # Build query
            where_clause = "WHERE jsr.job_id=%s"
            params = [int(job_id)]
            if not include_disabled:
                where_clause += " AND COALESCE(jsr.enabled, TRUE)=TRUE"
            
            if scope:
                where_clause += " AND jsr.scope=%s"
                params.append(scope)
            
            query = f"""
                SELECT 
                    jsr.row_id, jsr.job_id, jsr.scope, jsr.site_id, cs.site_name, jsr.dataset_id, jsr.factor_db_id, jsr.original_id,
                    jsr.category, jsr.level_1, jsr.level_2, jsr.level_3, jsr.level_4, jsr.column_text, jsr.report_label,
                    jsr.qty, jsr.uom, jsr.factor, jsr.ghg_unit, jsr.calc_tco2e, jsr.apply_pct,
                    {source_qty_select}, {source_uom_select},
                    jsr.month_1, jsr.month_2, jsr.month_3, jsr.month_4, jsr.month_5, jsr.month_6,
                    jsr.month_7, jsr.month_8, jsr.month_9, jsr.month_10, jsr.month_11, jsr.month_12,
                    jsr.data_source, jsr.data_confidence, jsr.notes, jsr.is_custom_entry, jsr.enabled, jsr.created_at, jsr.updated_at,
                    fl.factor AS lookup_factor,
                    fl.ghg_unit AS lookup_ghg_unit,
                    {fl_parts['fl_category_expr']} AS lookup_category,
                    fl.level_1 AS lookup_level_1,
                    fl.level_2 AS lookup_level_2,
                    fl.level_3 AS lookup_level_3,
                    fl.level_4 AS lookup_level_4,
                    fl.column_text AS lookup_column_text,
                    fl.report_label AS lookup_report_label
                FROM job_scope_rows jsr
                LEFT JOIN factor_lookup fl ON fl.db_id = jsr.factor_db_id
                LEFT JOIN client_sites cs ON cs.site_id = jsr.site_id
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
                    
                    try:
                        metrics = resolver.row_metrics(r) if resolver is not None else _scope_data_fallback_metrics(r)
                    except Exception as metrics_error:
                        logger.warning("Scope-data resolver failed for row %s", r.get("row_id"), exc_info=True)
                        metrics = _scope_data_fallback_metrics(r)
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
                        "site_name": r.get("site_name"),
                        "dataset_id": safe_int(metrics.get("display_dataset_id")) or safe_int(r.get("dataset_id")),
                        "dataset_category": r.get("lookup_category") or r.get("category") or r.get("lookup_level_1") or r.get("level_1"),
                        "factor_db_id": safe_int(r.get("factor_db_id")),
                        "original_id": r.get("original_id"),
                        "category": r.get("lookup_category") or r.get("category") or r.get("lookup_level_2") or r.get("lookup_level_1"),
                        "level_1": r.get("level_1") or r.get("lookup_level_1"),
                        "level_2": r.get("level_2") or r.get("lookup_level_2"),
                        "level_3": r.get("level_3") or r.get("lookup_level_3"),
                        "level_4": r.get("level_4") or r.get("lookup_level_4"),
                        "column_text": r.get("column_text") or r.get("lookup_column_text"),
                        "report_label": r.get("report_label") or r.get("lookup_report_label") or r.get("column_text") or r.get("lookup_column_text"),
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
                        "unit_warning": metrics.get("unit_warning"),
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
                        "enabled": safe_bool(r.get("enabled")),
                        "created_at": str(r.get("created_at")) if r.get("created_at") else None,
                        "updated_at": str(r.get("updated_at")) if r.get("updated_at") else None,
                    })
                except Exception as row_error:
                    logger.error("Error processing scope row %s", idx, exc_info=True)
                    raise
            
            try:
                job_id_int = int(job_id)
            except Exception as jid_error:
                logger.error("Error converting job_id to int for scope data", exc_info=True)
                job_id_int = job_id
            
            return {"job_id": job_id_int, "rows": rows, "total": len(rows)}
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error("ERROR in get_job_scope_data", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch scope data: {str(e)}")


@router.get("/jobs/{job_id}/notes-summary")
def get_job_notes_summary(
    job_id: int,
    archive_state: str = Query("active"),
    _user: dict[str, str] = Depends(_current_user),
):
    """Return a consolidated list of notes across job scope rows with row context and audit metadata."""

    def _to_iso(value: Any) -> str | None:
        if value is None:
            return None
        try:
            if hasattr(value, "isoformat"):
                return value.isoformat()
        except Exception:
            logger.debug("Skipping isoformat conversion failure while normalizing value", exc_info=True)
        text_value = str(value).strip()
        return text_value or None

    try:
        archive_state_normalized = str(archive_state or "active").strip().lower()
        if archive_state_normalized not in {"active", "archived", "all"}:
            raise HTTPException(status_code=400, detail="Invalid archive state")

        archived_clause = ""
        if archive_state_normalized == "active":
            archived_clause = "AND COALESCE(jc.archived, FALSE) = FALSE"
        elif archive_state_normalized == "archived":
            archived_clause = "AND COALESCE(jc.archived, FALSE) = TRUE"

        with get_conn() as con:
            _ensure_job_communications_tables(con)
            _ensure_job_scope_rows_schema(con)
            ensure_audit_log_table(con)

            job_row = con.execute(
                """
                SELECT job_id, job_number, title, client_db_id
                FROM jobs
                WHERE job_id=%s
                """,
                [int(job_id)],
            ).fetchone()
            if not job_row:
                raise HTTPException(status_code=404, detail="Job not found")

            communications_df = con.execute(
                f"""
                SELECT
                    jc.communication_id,
                    jc.job_id,
                    jc.client_db_id,
                    jc.subject,
                    jc.message_text,
                    jc.scope,
                    jc.category,
                    jc.site_id,
                    COALESCE(jc.site_name, cs.site_name, '') AS site_name,
                    jc.archived,
                    jc.archived_at,
                    jc.archived_by,
                    jc.created_by,
                    jc.created_at,
                    jc.updated_at,
                    jc.event_at,
                    j.job_number,
                    j.title AS job_title
                FROM job_communications jc
                JOIN jobs j ON j.job_id = jc.job_id
                LEFT JOIN client_sites cs ON cs.site_id = jc.site_id
                WHERE jc.job_id = %s
                  AND lower(COALESCE(jc.channel, '')) = 'note'
                  {archived_clause}
                ORDER BY COALESCE(jc.event_at, jc.created_at) DESC NULLS LAST, jc.communication_id DESC
                """,
                [int(job_id)],
            ).df()

            site_options_df = None
            client_db_id = _safe_int(job_row[3]) if len(job_row) > 3 else None
            if client_db_id is not None:
                site_options_df = con.execute(
                    """
                    SELECT site_id, site_name, is_registered_office
                    FROM client_sites
                    WHERE client_db_id = %s
                    ORDER BY COALESCE(is_registered_office, FALSE) DESC, lower(coalesce(site_name, '')) ASC, site_id ASC
                    """,
                    [int(client_db_id)],
                ).df()

            notes_df = con.execute(
                """
                SELECT
                    jsr.row_id,
                    jsr.job_id,
                    jsr.scope,
                    jsr.site_id,
                    cs.site_name,
                    jsr.category,
                    jsr.level_1,
                    jsr.level_2,
                    jsr.level_3,
                    jsr.level_4,
                    jsr.column_text,
                    jsr.report_label,
                    jsr.original_id,
                    jsr.notes,
                    jsr.created_at,
                    jsr.updated_at
                FROM job_scope_rows jsr
                LEFT JOIN client_sites cs ON cs.site_id = jsr.site_id
                WHERE jsr.job_id = %s
                  AND COALESCE(TRIM(CAST(jsr.notes AS VARCHAR)), '') <> ''
                ORDER BY jsr.updated_at DESC NULLS LAST, jsr.created_at DESC NULLS LAST, jsr.row_id DESC
                """,
                [int(job_id)],
            ).df()

            audit_df = con.execute(
                """
                SELECT audit_id, entity_id, created_at, actor_email, actor_name, action, diff_json, metadata_json
                FROM audit_log
                WHERE job_id = %s
                  AND entity_type = 'job_scope_row'
                ORDER BY created_at DESC, audit_id DESC
                """,
                [int(job_id)],
            ).df()

            latest_note_events: dict[str, dict[str, Any]] = {}
            if audit_df is not None and not audit_df.empty:
                for _, audit_row in audit_df.iterrows():
                    entity_id = str(audit_row.get("entity_id") or "").strip()
                    if not entity_id or entity_id in latest_note_events:
                        continue

                    diff_data = parse_json_text(audit_row.get("diff_json"))
                    meta_data = parse_json_text(audit_row.get("metadata_json"))
                    note_change_detected = False

                    if isinstance(diff_data, dict) and "notes" in diff_data:
                        note_change_detected = True

                    if not note_change_detected and isinstance(meta_data, dict):
                        updated_fields = meta_data.get("updated_fields")
                        if isinstance(updated_fields, list) and any(str(field).strip() == "notes" for field in updated_fields):
                            note_change_detected = True

                    if not note_change_detected:
                        continue

                    actor_label = str(audit_row.get("actor_name") or audit_row.get("actor_email") or "").strip() or None
                    latest_note_events[entity_id] = {
                        "updated_at": _to_iso(audit_row.get("created_at")),
                        "updated_by": actor_label,
                    }

            items: list[dict[str, Any]] = []
            if communications_df is not None and not communications_df.empty:
                for _, row in communications_df.iterrows():
                    note_text = _safe_text(row.get("message_text"))
                    if not note_text:
                        continue
                    job_number = _safe_text(row.get("job_number") or job_row[1]) or None
                    job_title = _safe_text(row.get("job_title") or job_row[2]) or None
                    subject = _safe_text(row.get("subject")) or None
                    location_bits = ["Job Note"]
                    if job_number:
                        location_bits.append(f"Job {job_number}")
                    elif row.get("job_id") is not None:
                        location_bits.append(f"Job {int(row.get('job_id'))}")
                    if subject:
                        location_bits.append(subject)
                    items.append(
                        {
                            "note_id": f"job-comm-{int(row.get('communication_id') or 0)}",
                            "source_type": "job-communication",
                            "source_label": "Job Note",
                            "communication_id": int(row.get("communication_id") or 0),
                            "row_id": None,
                            "job_id": int(row.get("job_id") or job_id),
                            "job_number": job_number,
                            "job_title": job_title,
                            "note_subject": subject,
                            "scope": _safe_text(row.get("scope")),
                            "site_id": _safe_int(row.get("site_id")),
                            "site_name": _safe_text(row.get("site_name")),
                            "category": _safe_text(row.get("category")),
                            "archived": bool(row.get("archived")) if row.get("archived") is not None else False,
                            "archived_at": _to_iso(row.get("archived_at")),
                            "archived_by": _safe_text(row.get("archived_by")) or None,
                            "report_label": "",
                            "original_id": "",
                            "note_text": note_text,
                            "note_location": " | ".join(location_bits),
                            "note_updated_at": _to_iso(row.get("event_at") or row.get("updated_at") or row.get("created_at")),
                            "note_updated_by": _safe_text(row.get("created_by")) or None,
                            "row_created_at": _to_iso(row.get("created_at")),
                            "row_updated_at": _to_iso(row.get("updated_at")),
                        }
                    )
            if notes_df is not None and not notes_df.empty:
                for _, row in notes_df.iterrows():
                    row_id = _safe_int(row.get("row_id"))
                    if row_id is None:
                        continue
                    note_text = str(row.get("notes") or "").strip()
                    if not note_text:
                        continue

                    site_name = str(row.get("site_name") or "").strip() or (
                        f"Site {row.get('site_id')}" if row.get("site_id") is not None else "No Site Assigned"
                    )
                    location_parts = [
                        site_name,
                        str(row.get("scope") or "").strip(),
                        str(row.get("category") or row.get("level_2") or row.get("level_1") or "").strip(),
                        str(row.get("report_label") or row.get("column_text") or row.get("original_id") or "").strip(),
                    ]
                    note_location = " | ".join(part for part in location_parts if part)
                    note_event = latest_note_events.get(str(row_id), {})
                    updated_at = note_event.get("updated_at") or _to_iso(row.get("updated_at"))

                    items.append(
                        {
                            "note_id": f"job-row-{row_id}",
                            "source_type": "job-row",
                            "source_label": "Job Row Note",
                            "communication_id": None,
                            "row_id": row_id,
                            "job_id": int(row.get("job_id") or job_id),
                            "job_number": str(job_row[1]) if len(job_row) > 1 and job_row[1] is not None else None,
                            "job_title": str(job_row[2]) if len(job_row) > 2 and job_row[2] is not None else None,
                            "note_subject": "",
                            "scope": str(row.get("scope") or ""),
                            "site_id": _safe_int(row.get("site_id")),
                            "site_name": site_name,
                            "category": str(row.get("category") or row.get("level_2") or row.get("level_1") or ""),
                            "archived": False,
                            "archived_at": None,
                            "archived_by": None,
                            "report_label": str(row.get("report_label") or row.get("column_text") or row.get("original_id") or ""),
                            "original_id": str(row.get("original_id") or ""),
                            "note_text": note_text,
                            "note_location": note_location,
                            "note_updated_at": updated_at,
                            "note_updated_by": note_event.get("updated_by"),
                            "row_created_at": _to_iso(row.get("created_at")),
                            "row_updated_at": _to_iso(row.get("updated_at")),
                        }
                    )

            return {
                "job_id": int(job_id),
                "job_number": str(job_row[1]) if len(job_row) > 1 and job_row[1] is not None else None,
                "job_title": str(job_row[2]) if len(job_row) > 2 and job_row[2] is not None else None,
                "client_db_id": _safe_int(job_row[3]) if len(job_row) > 3 else None,
                "total": len(items),
                "items": items,
                "site_options": [
                    {
                        "site_id": int(r.get("site_id")) if r.get("site_id") is not None else None,
                        "site_name": _safe_text(r.get("site_name")),
                        "is_registered_office": bool(r.get("is_registered_office")) if r.get("is_registered_office") is not None else False,
                    }
                    for _, r in (site_options_df.iterrows() if site_options_df is not None and not site_options_df.empty else [])
                ],
                "default_site_id": (
                    _safe_int(
                        next(
                            (
                                r.get("site_id")
                                for _, r in site_options_df.iterrows()
                                if bool(r.get("is_registered_office"))
                            ),
                            None,
                        )
                    )
                    if site_options_df is not None and not site_options_df.empty
                    else None
                ),
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch job notes summary: {e}")


@router.get("/jobs/{job_id}/previous-scope-rows")
def get_previous_scope_rows(
    job_id: int,
    limit: int = Query(50, ge=1, le=200),
    scope: str = Query(""),
    search: str = Query(""),
    _user: dict[str, str] = Depends(_current_user),
):
    """Return reusable dataset-backed rows from recent prior jobs for the same client."""
    try:
        with get_conn() as con:
            _ensure_job_scope_rows_schema(con)
            current_job = con.execute(
                """
                SELECT client_db_id, reporting_period_start, reporting_period_end
                FROM jobs
                WHERE job_id=%s
                """,
                [int(job_id)],
            ).fetchone()
            if not current_job:
                raise HTTPException(status_code=404, detail="Job not found")

            client_db_id = _safe_int(current_job[0])
            current_start = current_job[1]
            current_end = current_job[2]
            if client_db_id is None:
                return {"job_id": int(job_id), "rows": [], "total": 0}

            prior_job_rows = con.execute(
                """
                SELECT job_id, job_number, title, reporting_period_start, reporting_period_end
                FROM jobs
                WHERE client_db_id=%s
                  AND job_id <> %s
                  AND (
                    %s IS NULL
                    OR (reporting_period_end IS NOT NULL AND reporting_period_end < %s)
                    OR (reporting_period_start IS NOT NULL AND reporting_period_start < %s)
                    OR (reporting_period_end IS NOT NULL AND %s IS NOT NULL AND reporting_period_end <= %s)
                  )
                ORDER BY reporting_period_end DESC NULLS LAST, reporting_period_start DESC NULLS LAST, job_id DESC
                LIMIT 8
                """,
                [int(client_db_id), int(job_id), current_start, current_start, current_start, current_end, current_end],
            ).fetchall()

            prior_jobs: list[dict[str, Any]] = []
            for row in prior_job_rows:
                prior_jobs.append(
                    {
                        "job_id": _safe_int(row[0]),
                        "job_number": row[1],
                        "title": row[2],
                        "reporting_period_start": row[3],
                        "reporting_period_end": row[4],
                    }
                )
            prior_job_ids = [item["job_id"] for item in prior_jobs if item.get("job_id") is not None]
            if not prior_job_ids:
                return {"job_id": int(job_id), "rows": [], "total": 0}

            prior_job_map = {int(item["job_id"]): item for item in prior_jobs if item.get("job_id") is not None}
            where_clauses = [
                f"jsr.job_id IN ({','.join(['%s'] * len(prior_job_ids))})",
                "COALESCE(jsr.enabled, TRUE) = TRUE",
                "COALESCE(jsr.is_custom_entry, FALSE) = FALSE",
                "COALESCE(jsr.original_id, '') <> ''",
            ]
            params: list[Any] = list(prior_job_ids)
            fl_parts = _factor_lookup_select_parts(con)

            if scope and scope.strip():
                where_clauses.append("jsr.scope = %s")
                params.append(scope.strip())

            _append_multi_token_like_filters(
                where_clauses,
                params,
                [
                    "COALESCE(jsr.report_label, fl.report_label)",
                    "COALESCE(jsr.category, jsr.level_2, fl.level_2, jsr.level_1, fl.level_1)",
                    "COALESCE(jsr.level_1, fl.level_1)",
                    "COALESCE(jsr.level_2, fl.level_2)",
                    "COALESCE(jsr.level_3, fl.level_3)",
                    "COALESCE(jsr.level_4, fl.level_4)",
                    "COALESCE(jsr.column_text, fl.column_text)",
                    "jsr.original_id",
                ],
                search,
            )

            query = f"""
                SELECT
                    jsr.row_id,
                    jsr.job_id,
                    jsr.scope,
                    jsr.site_id,
                    cs.site_name,
                    jsr.dataset_id,
                    jsr.factor_db_id,
                    jsr.original_id,
                    COALESCE({fl_parts['fl_category_expr']}, jsr.level_1, jsr.category, jsr.level_2, fl.level_2) AS category,
                    COALESCE({fl_parts['fl_category_expr']}, jsr.category, jsr.level_2, fl.level_2, jsr.level_1) AS lookup_category,
                    COALESCE(jsr.level_1, fl.level_1) AS level_1,
                    COALESCE(jsr.level_2, fl.level_2) AS level_2,
                    COALESCE(jsr.level_3, fl.level_3) AS level_3,
                    COALESCE(jsr.level_4, fl.level_4) AS level_4,
                    COALESCE(jsr.column_text, fl.column_text) AS column_text,
                    COALESCE(jsr.report_label, fl.report_label, jsr.column_text, fl.column_text) AS report_label,
                    jsr.uom,
                    COALESCE(jsr.factor, fl.factor) AS factor,
                    COALESCE(jsr.ghg_unit, fl.ghg_unit) AS ghg_unit,
                    jsr.qty,
                    jsr.data_confidence,
                    jsr.month_1, jsr.month_2, jsr.month_3, jsr.month_4, jsr.month_5, jsr.month_6,
                    jsr.month_7, jsr.month_8, jsr.month_9, jsr.month_10, jsr.month_11, jsr.month_12
                FROM job_scope_rows jsr
                LEFT JOIN factor_lookup fl ON fl.db_id = jsr.factor_db_id
                LEFT JOIN client_sites cs ON cs.site_id = jsr.site_id
                WHERE {" AND ".join(where_clauses)}
                ORDER BY jsr.job_id DESC, jsr.scope, report_label, jsr.original_id
            """

            raw_rows = con.execute(query, params).fetchall()
            deduped: list[dict[str, Any]] = []
            seen: set[tuple[Any, ...]] = set()

            for raw in raw_rows:
                row = {
                    "row_id": _safe_int(raw[0]),
                    "job_id": _safe_int(raw[1]),
                    "scope": raw[2],
                    "site_id": _safe_int(raw[3]),
                    "site_name": raw[4],
                    "dataset_id": _safe_int(raw[5]),
                    "factor_db_id": _safe_int(raw[6]),
                    "original_id": raw[7],
                    "category": raw[8],
                    "lookup_category": raw[9],
                    "level_1": raw[10],
                    "level_2": raw[11],
                    "level_3": raw[12],
                    "level_4": raw[13],
                    "column_text": raw[14],
                    "report_label": raw[15],
                    "uom": raw[16],
                    "factor": _safe_float(raw[17]),
                    "ghg_unit": raw[18],
                    "previous_qty": _safe_float(raw[19]),
                    "data_confidence": raw[20],
                    "months": [_safe_float(value) for value in raw[21:33]],
                }
                dedupe_key = (
                    row["scope"],
                    row["original_id"],
                    row["lookup_category"] or row["category"],
                    row["report_label"],
                    row["level_1"],
                    row["level_2"],
                    row["level_3"],
                    row["level_4"],
                    row["column_text"],
                    row["uom"],
                    row["site_id"],
                )
                if dedupe_key in seen:
                    continue
                seen.add(dedupe_key)
                source_job = prior_job_map.get(int(row["job_id"])) if row.get("job_id") is not None else None
                row["previous_month_count"] = sum(1 for value in row["months"] if value is not None and abs(value) > 0)
                row["source_job_number"] = source_job.get("job_number") if source_job else None
                row["source_job_title"] = source_job.get("title") if source_job else None
                row["source_reporting_period_start"] = str(source_job.get("reporting_period_start")) if source_job and source_job.get("reporting_period_start") else None
                row["source_reporting_period_end"] = str(source_job.get("reporting_period_end")) if source_job and source_job.get("reporting_period_end") else None
                deduped.append(row)
                if len(deduped) >= int(limit):
                    break

            return {"job_id": int(job_id), "rows": deduped, "total": len(deduped)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch previous scope rows: {e}")


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
            data_df = _load_data_output_rows(con, int(job_id))
            if data_df is None or data_df.empty:
                return {
                    "job_id": int(job_id),
                    "scope_1": 0.0,
                    "scope_2": 0.0,
                    "scope_3": 0.0,
                    "total": 0.0,
                }

            _, totals = _build_scope_summary(data_df, resolver)
            scope_1_rounded = round(float(totals.get("Scope 1") or 0.0), 2)
            scope_2_rounded = round(float(totals.get("Scope 2") or 0.0), 2)
            scope_3_rounded = round(float(totals.get("Scope 3") or 0.0), 2)
            
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

            # Always resolve the factor from the job's active dataset for this
            # reporting year so stale values from previous-year rows are not
            # carried forward into the new row.
            resolved_dataset_id = None
            resolved_factor_db_id = None
            resolved_factor = None
            resolved_ghg_unit = None
            try:
                from services.dataset_selector import resolve_dataset_resolution
                _resolution = resolve_dataset_resolution(int(job_id))
                _scope_map: dict[str, int] = {
                    str(s): int(d)
                    for s, d in (_resolution.get("scope_primary_datasets") or {}).items()
                    if d is not None
                }
                current_ds = _scope_map.get(str(scope))
                if current_ds:
                    _refreshed = _lookup_factor_from_reference(con, current_ds, scope, str(original_id))
                    if _refreshed:
                        resolved_dataset_id = current_ds
                        resolved_factor_db_id = _refreshed["db_id"]
                        resolved_factor = _refreshed["factor"]
                        resolved_ghg_unit = _refreshed["ghg_unit"]
                    else:
                        resolved_dataset_id = current_ds
            except Exception:
                logger.debug("Ignoring resolved_dataset_id conversion failure while updating scope config", exc_info=True)

            # Fall back to whatever the payload supplied if resolution failed
            final_dataset_id = resolved_dataset_id if resolved_dataset_id is not None else payload.get("dataset_id")
            final_factor_db_id = resolved_factor_db_id if resolved_factor_db_id is not None else payload.get("factor_db_id")
            final_factor = resolved_factor if resolved_factor is not None else payload.get("factor")
            final_ghg_unit = resolved_ghg_unit if resolved_ghg_unit is not None else payload.get("ghg_unit")

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
                    final_dataset_id,
                    final_factor_db_id,
                    original_id,
                    payload.get("dataset_category")
                    or payload.get("category")
                    or payload.get("level_1")
                    or payload.get("level_2"),
                    payload.get("level_1"),
                    payload.get("level_2"),
                    payload.get("level_3"),
                    payload.get("level_4"),
                    payload.get("column_text"),
                    payload.get("report_label"),
                    payload.get("qty"),
                    payload.get("uom"),
                    final_factor,
                    final_ghg_unit,
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
                    "dataset_id": final_dataset_id,
                    "factor_db_id": final_factor_db_id,
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

            site_id = payload.get("site_id") if "site_id" in payload else None
            if site_id is not None:
                try:
                    site_id = int(site_id)
                except (ValueError, TypeError):
                    site_id = None
                if site_id is not None:
                    conflict = con.execute(
                        """
                        SELECT row_id
                        FROM job_scope_rows
                        WHERE job_id=%s
                          AND site_id=%s
                          AND scope=%s
                          AND original_id=%s
                          AND COALESCE(enabled, TRUE) = TRUE
                          AND row_id<>%s
                        LIMIT 1
                        """,
                        [
                            int(job_id),
                            int(site_id),
                            str(before.get("scope") or ""),
                            str(before.get("original_id") or ""),
                            int(row_id),
                        ],
                    ).fetchone()
                    if conflict:
                        conflict_row_id = int(conflict[0])
                        raise HTTPException(
                            status_code=409,
                            detail=(
                                "Another row already exists for this site, scope, and reference ID "
                                f"(conflicting row_id {conflict_row_id}). "
                                "Please keep one row per site/reference or delete the existing duplicate first."
                            ),
                        )
            
            # Build update query dynamically based on provided fields
            update_fields = []
            params = []
            
            allowed_fields = [
                "category", "qty", "apply_pct", "data_source", "data_confidence", "notes", "site_id",
                "month_1", "month_2", "month_3", "month_4", "month_5", "month_6",
                "month_7", "month_8", "month_9", "month_10", "month_11", "month_12"
            ]
            
            for field in allowed_fields:
                if field in payload:
                    update_fields.append(f"{field}=%s")
                    if field == "site_id":
                        params.append(site_id)
                    else:
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
    logger.debug("TEST ENDPOINT CALLED for job_id=%s", job_id)
    return {"test": "success", "job_id": job_id}

@router.get("/jobs/{job_id}/template-factors")
def get_template_factors(
    job_id: int,
    limit: int = Query(50, ge=1, le=5000),
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
                    logger.debug("Failed to derive job reporting year from job row", exc_info=True)
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
                logger.debug("Falling back to legacy manual scope config after scope dataset resolution failed", exc_info=True)
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
                logger.debug("Unable to detect custom factor state; defaulting to False", exc_info=True)
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

                    _append_multi_token_like_filters(
                        cf_where,
                        cf_params,
                        [
                            "custom_id",
                            "description",
                            "report_label",
                            "category",
                            "uom",
                            "source",
                            "country",
                        ],
                        search_term,
                    )

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
                                    "level_1": None,
                                    "level_2": None,
                                    "level_3": None,
                                    "level_4": None,
                                    "column_text": None,
                                    "is_custom": True,
                                    "source": row.get("source"),
                                    "custom_factor_id": int(factor_id),
                                    "factor_year": int(factor_year) if factor_year is not None else None,
                                    "is_global": bool(row.get("is_global")) if row.get("is_global") is not None else True,
                                    "client_db_id": _safe_int(row.get("client_db_id")),
                                }
                            )
                except Exception as cf_error:
                    logger.warning("custom_factors load skipped due to error", exc_info=True)

            # ---------------------------------------------------------------
            # 1b) Job-scoped custom factors - only for this job
            # ---------------------------------------------------------------
            try:
                has_job_custom_factors = bool(
                    con.execute(
                        """
                        SELECT 1
                        FROM information_schema.tables
                        WHERE table_name='job_custom_factors'
                        LIMIT 1
                        """
                    ).fetchone()
                )
            except Exception:
                logger.debug("Unable to detect job custom factor state; defaulting to False", exc_info=True)
                has_job_custom_factors = False

            if has_job_custom_factors:
                try:
                    jcf_where = [
                        "job_id = %s",
                        "(archived = FALSE OR archived IS NULL)",
                        "COALESCE(is_active, TRUE) = TRUE",
                    ]
                    jcf_params: list = [int(job_id)]

                    if scope and scope.strip():
                        jcf_where.append("scope = %s")
                        jcf_params.append(scope.strip())

                    _append_multi_token_like_filters(
                        jcf_where,
                        jcf_params,
                        [
                            "custom_id",
                            "description",
                            "report_label",
                            "category",
                            "uom",
                            "source",
                        ],
                        search_term,
                    )

                    jcf_df = con.execute(
                        f"""
                        SELECT factor_id, job_id, country, scope, description, report_label, category,
                               uom, ghg_unit, source, custom_id, factor, factor_year,
                               is_active, archived
                        FROM job_custom_factors
                        WHERE {' AND '.join(jcf_where)}
                        ORDER BY scope, category, report_label, description, factor_id
                        """,
                        jcf_params,
                    ).df()

                    if jcf_df is not None and not jcf_df.empty:
                        jcf_df = jcf_df.where(jcf_df.notna(), None)
                        for _, row in jcf_df.iterrows():
                            factor_id = _safe_int(row.get("factor_id"))
                            if factor_id is None:
                                continue
                            factor_value = _safe_float(row.get("factor"))
                            if factor_value is None:
                                continue

                            custom_id = str(row.get("custom_id") or "").strip() or f"JCF-{job_id}-{factor_id}"
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
                                    "level_1": None,
                                    "level_2": None,
                                    "level_3": None,
                                    "level_4": None,
                                    "column_text": None,
                                    "is_custom": True,
                                    "source": row.get("source") or "Job custom factor",
                                    "custom_factor_id": int(factor_id),
                                    "factor_year": _safe_int(row.get("factor_year")),
                                    "job_id": int(job_id),
                                    "is_global": False,
                                    "client_db_id": job_client_db_id,
                                }
                            )
                except Exception as jcf_error:
                    logger.warning("job_custom_factors load skipped due to error", exc_info=True)

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

                    _append_multi_token_like_filters(
                        where_clauses,
                        params,
                        [
                            "report_label",
                            "level_1",
                            "level_2",
                            "level_3",
                            "level_4",
                            "column_text",
                            "original_id",
                            "uom",
                            "source",
                            "method",
                            "region",
                        ],
                        search_term,
                    )

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
                            SELECT db_id, dataset_id, scope, {fl_parts['category_expr']} AS category, {fl_parts['level_1_expr']}, {fl_parts['level_2_expr']}, level_3, {fl_parts['level_4_expr']},
                                   original_id, {fl_parts['column_text_expr']}, {fl_parts['report_label_expr']}, uom, factor, {fl_parts['ghg_unit_expr']}
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
                                    "category": row.get('category') or row.get('level_1') or row.get('level_2'),
                                    "report_label": row.get('report_label') or row.get('column_text'),
                                    "original_id": row.get('original_id'),
                                    "uom": row.get('uom'),
                                    "dataset_id": int(row.get('dataset_id')) if row.get('dataset_id') is not None else None,
                                    "factor_db_id": int(row.get('db_id')) if row.get('db_id') is not None else None,
                                    "factor": factor_val,
                                    "ghg_unit": row.get('ghg_unit'),
                                    "level_1": row.get('level_1'),
                                    "level_2": row.get('level_2'),
                                    "level_3": row.get('level_3'),
                                    "level_4": row.get('level_4'),
                                    "column_text": row.get('column_text'),
                                    "is_custom": False,
                                    "source": None,
                                })

                    factors = [*custom_page, *dataset_factors]
                    total_count = custom_total + dataset_total
                except Exception as ds_error:
                    logger.warning("dataset factor lookup failed, returning custom factors only", exc_info=True)
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
        logger.error("Failed to fetch template factors for job %s", job_id, exc_info=True)
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
