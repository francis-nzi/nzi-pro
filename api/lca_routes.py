from __future__ import annotations

from datetime import datetime
from typing import Any

import io
import json
import pandas as pd
from fastapi import APIRouter, Body, Depends, HTTPException, Query, UploadFile, File

from api.auth import _current_user
from api.permissions import assert_job_access, assert_permission
from core.database import get_conn
from services.lca_engine import safe_float, summarize_assessment

router = APIRouter(tags=["lca"])

MODULE_KEYWORDS: dict[str, str] = {
    "A1": "material raw bom purchased goods commodity ingredient component",
    "A2": "transport freight logistics delivery shipping inbound",
    "A3": "manufacturing electricity gas process plant energy assembly",
    "A4": "transport freight logistics delivery shipping outbound distribution",
    "A5": "installation construction assembly site",
    "B1": "use operation energy",
    "B2": "maintenance service",
    "B3": "repair",
    "B4": "replacement",
    "B5": "refurbishment",
    "B6": "electricity energy operational",
    "B7": "water operational",
    "C1": "deconstruction demolition",
    "C2": "transport waste collection",
    "C3": "waste processing recycling recovery",
    "C4": "disposal landfill incineration",
    "D": "recycling recovery reuse credit benefit",
}


def _actor(user: dict[str, str]) -> str:
    return str(user.get("email") or user.get("user_id") or "system").strip()


def _is_missing(value: Any) -> bool:
    """True for None and for pandas' float NaN representation of SQL NULL.

    pandas.DataFrame.df() upcasts a nullable INTEGER/NUMERIC column to
    float64, so a NULL comes back as NaN rather than None -- plain
    `value is not None` checks silently pass a NaN through, which then
    blows up on `int(nan)`. Text/object columns are unaffected (SQL NULL
    stays a real None there), but every nullable numeric field read via
    `.df()` in this file must be routed through this check.
    """
    if value is None:
        return True
    try:
        return bool(pd.isna(value))
    except (TypeError, ValueError):
        return False


def _int_or_none(value: Any) -> int | None:
    if _is_missing(value):
        return None
    try:
        return int(value)
    except Exception:
        return None


def _float_or_none(value: Any) -> float | None:
    if _is_missing(value):
        return None
    return safe_float(value)


def _job_client_id(con, job_id: int) -> int | None:
    row = con.execute("SELECT client_db_id FROM jobs WHERE job_id = %s", [int(job_id)]).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    return int(row[0]) if row[0] is not None else None


def _assessment_row(con, job_id: int, assessment_id: int) -> dict[str, Any] | None:
    row = con.execute(
        """
        SELECT assessment_id, job_id, client_db_id, assessment_type, name, sku, description,
               functional_unit_value, functional_unit_unit, confirmed_quantity, confirmed_quantity_unit,
               lifecycle_boundary, included_modules, standard, reference_year, geography, assumptions,
               data_sources_note, review_status, total_tco2e, last_calculated_at
        FROM lca_assessments
        WHERE assessment_id = %s AND job_id = %s
        """,
        [int(assessment_id), int(job_id)],
    ).fetchone()
    if not row:
        return None
    included_modules = row[12]
    if isinstance(included_modules, str):
        try:
            included_modules = json.loads(included_modules)
        except Exception:
            included_modules = []
    return {
        "assessment_id": int(row[0]),
        "job_id": int(row[1]),
        "client_db_id": int(row[2]) if row[2] is not None else None,
        "assessment_type": row[3],
        "name": row[4],
        "sku": row[5],
        "description": row[6],
        "functional_unit_value": safe_float(row[7], 1.0),
        "functional_unit_unit": row[8],
        "confirmed_quantity": safe_float(row[9]) if row[9] is not None else None,
        "confirmed_quantity_unit": row[10],
        "lifecycle_boundary": row[11],
        "included_modules": included_modules or [],
        "standard": row[13],
        "reference_year": row[14],
        "geography": row[15],
        "assumptions": row[16],
        "data_sources_note": row[17],
        "review_status": row[18],
        "total_tco2e": safe_float(row[19]),
        "last_calculated_at": str(row[20]) if row[20] else None,
    }


def _to_int_list(raw: Any) -> list[int]:
    if raw is None:
        return []
    if isinstance(raw, (list, tuple, set)):
        items = list(raw)
    else:
        text = str(raw).strip()
        if not text:
            return []
        items = [x.strip() for x in text.split(",")]
    out: list[int] = []
    for v in items:
        try:
            iv = int(v)
            if iv > 0:
                out.append(iv)
        except Exception:
            continue
    return sorted(set(out))


def _get_assessment_dataset_ids(con, assessment_id: int) -> list[int]:
    df = con.execute(
        "SELECT dataset_id FROM lca_assessment_datasets WHERE assessment_id = %s ORDER BY dataset_id",
        [int(assessment_id)],
    ).df()
    if df is None or df.empty:
        return []
    return sorted({int(r.get("dataset_id")) for _, r in df.iterrows() if r.get("dataset_id") is not None})


def _set_assessment_dataset_ids(con, assessment_id: int, dataset_ids: list[int], user: dict[str, str]) -> list[int]:
    clean = sorted({int(x) for x in dataset_ids if int(x) > 0})
    valid_ids: list[int] = []
    if clean:
        ph = ",".join(["%s"] * len(clean))
        valid_df = con.execute(
            f"SELECT dataset_id FROM datasets WHERE dataset_id IN ({ph}) AND COALESCE(archived, FALSE) = FALSE",
            clean,
        ).df()
        if valid_df is not None and not valid_df.empty:
            valid_ids = sorted({int(r.get("dataset_id")) for _, r in valid_df.iterrows()})

    con.execute("DELETE FROM lca_assessment_datasets WHERE assessment_id = %s", [int(assessment_id)])
    for dsid in valid_ids:
        con.execute(
            """
            INSERT INTO lca_assessment_datasets (assessment_id, dataset_id, created_by)
            VALUES (%s, %s, %s)
            ON CONFLICT (assessment_id, dataset_id) DO NOTHING
            """,
            [int(assessment_id), int(dsid), _actor(user)],
        )
    return valid_ids


def _get_job_dataset_ids(con, job_id: int) -> list[int]:
    out: list[int] = []
    for table, col in (("job_scope_config", "dataset_id"), ("job_additional_datasets", "dataset_id")):
        exists = con.execute(
            "SELECT 1 FROM information_schema.tables WHERE table_name = %s", [table]
        ).fetchone()
        if not exists:
            continue
        df = con.execute(f"SELECT DISTINCT {col} FROM {table} WHERE job_id = %s AND {col} IS NOT NULL", [int(job_id)]).df()
        if df is not None and not df.empty:
            out.extend(int(r.get(col)) for _, r in df.iterrows() if r.get(col) is not None)
    return sorted(set(out))


def _resolve_dataset_ids(con, job_id: int, assessment_id: int | None) -> list[int]:
    selected = _get_assessment_dataset_ids(con, int(assessment_id)) if assessment_id is not None else []
    return selected if selected else _get_job_dataset_ids(con, int(job_id))


def _list_available_datasets(con) -> list[dict[str, Any]]:
    df = con.execute(
        """
        SELECT dataset_id, name, analysis_type, country, year, version
        FROM datasets
        WHERE COALESCE(archived, FALSE) = FALSE
        ORDER BY year DESC NULLS LAST, name ASC
        """
    ).df()
    if df is None or df.empty:
        return []
    return [
        {
            "dataset_id": int(r.get("dataset_id")),
            "name": str(r.get("name") or ""),
            "analysis_type": str(r.get("analysis_type") or ""),
            "country": str(r.get("country") or ""),
            "year": int(r.get("year")) if r.get("year") is not None else None,
            "version": str(r.get("version") or ""),
        }
        for _, r in df.iterrows()
    ]


def _load_line_items_for_calc(con, assessment_id: int) -> list[dict[str, Any]]:
    df = con.execute(
        """
        SELECT line_item_id, module_code, line_label, material_category_id, quantity, unit,
               factor_value, factor_unit, is_gap_filled, is_placeholder, data_quality
        FROM lca_line_items
        WHERE assessment_id = %s
        ORDER BY line_item_id
        """,
        [int(assessment_id)],
    ).df()
    if df is None or df.empty:
        return []
    rows: list[dict[str, Any]] = []
    for _, r in df.iterrows():
        rows.append(
            {
                "line_item_id": int(r.get("line_item_id") or 0),
                "module_code": str(r.get("module_code") or ""),
                "line_label": str(r.get("line_label") or "Unnamed line"),
                "material_category_id": _int_or_none(r.get("material_category_id")),
                "quantity": safe_float(r.get("quantity")),
                "unit": str(r.get("unit") or ""),
                "factor_value": safe_float(r.get("factor_value")),
                "factor_unit": str(r.get("factor_unit") or "kgCO2e/kg"),
                "is_gap_filled": bool(r.get("is_gap_filled") or False),
                "is_placeholder": bool(r.get("is_placeholder") or False),
                "data_quality": str(r.get("data_quality") or "secondary"),
            }
        )
    return rows


def _recalculate_assessment(con, assessment_id: int, user: dict[str, str]) -> dict[str, Any]:
    assessment_row = con.execute(
        "SELECT confirmed_quantity, confirmed_quantity_unit FROM lca_assessments WHERE assessment_id = %s",
        [int(assessment_id)],
    ).fetchone()
    confirmed_quantity = safe_float(assessment_row[0]) if assessment_row and assessment_row[0] is not None else None
    confirmed_unit = assessment_row[1] if assessment_row else "kg"

    lines = _load_line_items_for_calc(con, int(assessment_id))
    summary = summarize_assessment(lines, confirmed_quantity, confirmed_unit)

    con.execute(
        """
        UPDATE lca_assessments
        SET total_tco2e = %s, last_calculated_at = NOW(), updated_at = NOW(), updated_by = %s
        WHERE assessment_id = %s
        """,
        [summary["total_tco2e"], _actor(user), int(assessment_id)],
    )
    con.execute(
        """
        INSERT INTO lca_result_snapshots (
          assessment_id, calculated_by, total_tco2e, module_breakdown, hotspots, mass_reconciliation, notes
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        [
            int(assessment_id),
            _actor(user),
            summary["total_tco2e"],
            json.dumps(summary["module_breakdown"]),
            json.dumps(summary["hotspots"]),
            json.dumps(summary["mass_reconciliation"]),
            "Auto recalculation",
        ],
    )
    return summary


def _find_factor_candidates(
    con,
    line_label: str,
    module_code: str,
    unit: str,
    country: str | None,
    dataset_ids: list[int] | None = None,
) -> list[dict[str, Any]]:
    keyword_blob = MODULE_KEYWORDS.get(module_code, "")
    item_pattern = f"%{line_label.strip()}%"
    unit_pattern = str(unit or "").strip()
    country_pattern = str(country or "").strip()
    words = [w for w in keyword_blob.split() if w]
    keyword_expr = " OR ".join(
        [
            "(COALESCE(fl.report_label,'') ILIKE %s OR COALESCE(fl.column_text,'') ILIKE %s OR COALESCE(fl.level_1,'') ILIKE %s OR COALESCE(fl.level_2,'') ILIKE %s)"
            for _ in words
        ]
    )
    keyword_params: list[Any] = []
    for word in words:
        pat = f"%{word}%"
        keyword_params.extend([pat, pat, pat, pat])

    where_clause = "COALESCE(fl.factor, 0) > 0 AND (COALESCE(fl.report_label,'') ILIKE %s OR COALESCE(fl.column_text,'') ILIKE %s)"
    params: list[Any] = [item_pattern, item_pattern]
    if keyword_expr:
        where_clause = f"{where_clause} OR ({keyword_expr})"
        params.extend(keyword_params)

    selected = sorted({int(x) for x in (dataset_ids or []) if int(x) > 0})
    if selected:
        ph = ",".join(["%s"] * len(selected))
        where_clause = f"({where_clause}) AND fl.dataset_id IN ({ph})"
        params.extend(selected)

    df = con.execute(
        f"""
        SELECT
          fl.db_id, fl.report_label, fl.column_text, fl.uom, fl.factor, fl.source, fl.region,
          (
            CASE WHEN COALESCE(fl.uom, '') <> '' AND lower(fl.uom) = lower(%s) THEN 20 ELSE 0 END +
            CASE WHEN COALESCE(fl.report_label,'') ILIKE %s OR COALESCE(fl.column_text,'') ILIKE %s THEN 25 ELSE 0 END
          ) AS score
        FROM v_factor_lookup fl
        WHERE {where_clause}
        ORDER BY score DESC, fl.year DESC NULLS LAST, fl.db_id DESC
        LIMIT 10
        """,
        [unit_pattern, item_pattern, item_pattern, *params],
    ).df()
    out: list[dict[str, Any]] = []
    if df is None or df.empty:
        return out
    for _, r in df.iterrows():
        out.append(
            {
                "db_id": int(r.get("db_id")),
                "label": str(r.get("report_label") or r.get("column_text") or f"Factor {r.get('db_id')}"),
                "uom": r.get("uom"),
                "factor": safe_float(r.get("factor")),
                "source": r.get("source"),
                "region": r.get("region"),
                "score": safe_float(r.get("score")),
            }
        )
    return out


def _estimate_gap_factor(con, module_code: str, unit: str, dataset_ids: list[int] | None = None) -> tuple[float, str]:
    stage_words = [w for w in MODULE_KEYWORDS.get(module_code, "").split() if w]
    unit_text = str(unit or "").strip()

    base_sql = """
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY fl.factor) AS p50_factor
        FROM v_factor_lookup fl
        WHERE fl.factor IS NOT NULL AND fl.factor > 0
    """
    params: list[Any] = []
    if unit_text:
        base_sql += " AND lower(COALESCE(fl.uom,'')) = lower(%s)"
        params.append(unit_text)
    if stage_words:
        conditions = [
            "(COALESCE(fl.report_label,'') ILIKE %s OR COALESCE(fl.column_text,'') ILIKE %s OR COALESCE(fl.level_1,'') ILIKE %s OR COALESCE(fl.level_2,'') ILIKE %s)"
            for _ in stage_words
        ]
        base_sql += f" AND ({' OR '.join(conditions)})"
        for word in stage_words:
            pat = f"%{word}%"
            params.extend([pat, pat, pat, pat])

    selected = sorted({int(x) for x in (dataset_ids or []) if int(x) > 0})
    if selected:
        ph = ",".join(["%s"] * len(selected))
        base_sql += f" AND fl.dataset_id IN ({ph})"
        params.extend(selected)

    row = con.execute(base_sql, params).fetchone()
    estimated = safe_float(row[0] if row else 0.0)
    if estimated > 0:
        return estimated, "median_factor_by_module_and_unit"

    sql2 = """
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY fl.factor)
        FROM v_factor_lookup fl
        WHERE fl.factor IS NOT NULL AND fl.factor > 0
          AND (%s = '' OR lower(COALESCE(fl.uom,'')) = lower(%s))
    """
    params2: list[Any] = [unit_text, unit_text]
    if selected:
        ph2 = ",".join(["%s"] * len(selected))
        sql2 += f" AND fl.dataset_id IN ({ph2})"
        params2.extend(selected)
    row2 = con.execute(sql2, params2).fetchone()
    estimated2 = safe_float(row2[0] if row2 else 0.0)
    if estimated2 > 0:
        return estimated2, "median_factor_by_unit"
    return 0.0, "no_estimate_available"


def _normalize_col(col: Any) -> str:
    return str(col or "").strip().lower().replace("-", "_").replace(" ", "_")


def _valid_module_codes(con) -> set[str]:
    df = con.execute("SELECT module_code FROM lca_modules_lookup WHERE is_active = TRUE").df()
    if df is None or df.empty:
        return set()
    return {str(v) for v in df["module_code"].tolist()}


# ---------------------------------------------------------------------------
# Reference data
# ---------------------------------------------------------------------------

@router.get("/lca/material-categories")
def list_lca_material_categories(_user: dict[str, str] = Depends(_current_user)):
    """Read-only listing for the job-level LCA UI. Admin CRUD for this lookup
    table lives in api/admin_lookups_routes.py (admin-permission gated) -- this
    endpoint exists so any user with job access can populate the category
    dropdown without needing admin rights."""
    with get_conn() as con:
        df = con.execute(
            """
            SELECT category_id, name, description
            FROM lca_material_categories_lookup
            WHERE is_active = TRUE
            ORDER BY name
            """
        ).df()
        items = []
        if df is not None and not df.empty:
            for _, r in df.iterrows():
                items.append({"category_id": int(r.get("category_id")), "name": r.get("name"), "description": r.get("description")})
        return {"items": items}


@router.get("/lca/modules")
def list_lca_modules(_user: dict[str, str] = Depends(_current_user)):
    with get_conn() as con:
        df = con.execute(
            """
            SELECT module_code, label, description, module_group, default_in_pcf, default_in_lca
            FROM lca_modules_lookup
            WHERE is_active = TRUE
            ORDER BY sort_order
            """
        ).df()
        items = []
        if df is not None and not df.empty:
            for _, r in df.iterrows():
                items.append(
                    {
                        "module_code": r.get("module_code"),
                        "label": r.get("label"),
                        "description": r.get("description"),
                        "module_group": r.get("module_group"),
                        "default_in_pcf": bool(r.get("default_in_pcf")),
                        "default_in_lca": bool(r.get("default_in_lca")),
                    }
                )
        return {"items": items}


# ---------------------------------------------------------------------------
# Assessments
# ---------------------------------------------------------------------------

@router.get("/jobs/{job_id}/lca/overview")
def lca_overview(job_id: int, _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.view")
    assert_job_access(_user, int(job_id))
    try:
        with get_conn() as con:
            _job_client_id(con, int(job_id))
            df = con.execute(
                """
                SELECT assessment_id, name, sku, assessment_type, functional_unit_value, functional_unit_unit,
                       lifecycle_boundary, standard, review_status, total_tco2e, last_calculated_at
                FROM lca_assessments
                WHERE job_id = %s
                ORDER BY assessment_id DESC
                """,
                [int(job_id)],
            ).df()
            assessments: list[dict[str, Any]] = []
            portfolio_total = 0.0
            if df is not None and not df.empty:
                for _, r in df.iterrows():
                    total = safe_float(r.get("total_tco2e"))
                    portfolio_total += total
                    assessments.append(
                        {
                            "assessment_id": int(r.get("assessment_id")),
                            "name": r.get("name"),
                            "sku": r.get("sku"),
                            "assessment_type": r.get("assessment_type"),
                            "functional_unit_value": safe_float(r.get("functional_unit_value"), 1.0),
                            "functional_unit_unit": r.get("functional_unit_unit"),
                            "lifecycle_boundary": r.get("lifecycle_boundary"),
                            "standard": r.get("standard"),
                            "review_status": r.get("review_status"),
                            "total_tco2e": round(total, 6),
                            "last_calculated_at": str(r.get("last_calculated_at")) if r.get("last_calculated_at") else None,
                        }
                    )
            return {
                "job_id": int(job_id),
                "assessments_count": len(assessments),
                "total_tco2e": round(portfolio_total, 6),
                "assessments": assessments,
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load LCA overview: {e}")


@router.get("/jobs/{job_id}/lca/assessments/{assessment_id}")
def get_lca_assessment(job_id: int, assessment_id: int, _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.view")
    assert_job_access(_user, int(job_id))
    try:
        with get_conn() as con:
            assessment = _assessment_row(con, int(job_id), int(assessment_id))
            if not assessment:
                raise HTTPException(status_code=404, detail="LCA assessment not found")
            return assessment
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load LCA assessment: {e}")


@router.post("/jobs/{job_id}/lca/assessments")
def create_lca_assessment(job_id: int, body: dict = Body(...), _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.edit")
    assert_job_access(_user, int(job_id))
    name = str(body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    assessment_type = str(body.get("assessment_type") or "product").strip()
    if assessment_type != "product":
        raise HTTPException(status_code=400, detail="Only assessment_type='product' is supported currently")

    lifecycle_boundary = str(body.get("lifecycle_boundary") or "cradle_to_gate").strip()
    default_modules = ["A1", "A2", "A3"] if lifecycle_boundary == "cradle_to_gate" else [
        "A1", "A2", "A3", "A4", "A5", "B1", "B2", "B3", "B4", "B5", "B6", "B7", "C1", "C2", "C3", "C4", "D",
    ]
    included_modules = body.get("included_modules")
    if not isinstance(included_modules, list) or not included_modules:
        included_modules = default_modules

    try:
        with get_conn(autocommit=False) as con:
            client_db_id = _job_client_id(con, int(job_id))
            row = con.execute(
                """
                INSERT INTO lca_assessments (
                  job_id, client_db_id, assessment_type, name, sku, description,
                  functional_unit_value, functional_unit_unit, confirmed_quantity, confirmed_quantity_unit,
                  lifecycle_boundary, included_modules, standard, reference_year, geography, assumptions,
                  data_sources_note, review_status, created_by, updated_by
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING assessment_id
                """,
                [
                    int(job_id), client_db_id, assessment_type, name,
                    str(body.get("sku") or "").strip() or None,
                    str(body.get("description") or "").strip() or None,
                    safe_float(body.get("functional_unit_value"), 1.0),
                    str(body.get("functional_unit_unit") or "unit").strip(),
                    safe_float(body.get("confirmed_quantity")) if body.get("confirmed_quantity") not in (None, "") else None,
                    str(body.get("confirmed_quantity_unit") or "kg").strip(),
                    lifecycle_boundary,
                    json.dumps(included_modules),
                    str(body.get("standard") or "ISO 14067").strip(),
                    int(body.get("reference_year")) if str(body.get("reference_year") or "").strip().isdigit() else None,
                    str(body.get("geography") or "").strip() or None,
                    str(body.get("assumptions") or "").strip() or None,
                    str(body.get("data_sources_note") or "").strip() or None,
                    str(body.get("review_status") or "draft").strip(),
                    _actor(_user), _actor(_user),
                ],
            ).fetchone()
            assessment_id = int(row[0])
            requested_dataset_ids = _to_int_list(body.get("dataset_ids"))
            if requested_dataset_ids:
                _set_assessment_dataset_ids(con, assessment_id, requested_dataset_ids, _user)
            con.execute(
                "INSERT INTO lca_scenarios (assessment_id, name, description, is_baseline, created_by) VALUES (%s, %s, %s, TRUE, %s)",
                [assessment_id, "Baseline", "Baseline assumptions", _actor(_user)],
            )
            return {"ok": True, "assessment_id": assessment_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create LCA assessment: {e}")


@router.patch("/jobs/{job_id}/lca/assessments/{assessment_id}")
def update_lca_assessment(job_id: int, assessment_id: int, body: dict = Body(...), _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.edit")
    assert_job_access(_user, int(job_id))
    try:
        with get_conn(autocommit=False) as con:
            if not _assessment_row(con, int(job_id), int(assessment_id)):
                raise HTTPException(status_code=404, detail="LCA assessment not found")
            updates: list[str] = []
            params: list[Any] = []
            editable_text = [
                "name", "sku", "description", "functional_unit_unit", "confirmed_quantity_unit",
                "lifecycle_boundary", "standard", "geography", "assumptions", "data_sources_note", "review_status",
            ]
            for field in editable_text:
                if field not in body:
                    continue
                updates.append(f"{field} = %s")
                val = str(body.get(field) or "").strip()
                params.append(val or None)
            if "functional_unit_value" in body:
                updates.append("functional_unit_value = %s")
                params.append(safe_float(body.get("functional_unit_value"), 1.0))
            if "confirmed_quantity" in body:
                updates.append("confirmed_quantity = %s")
                raw = body.get("confirmed_quantity")
                params.append(safe_float(raw) if raw not in (None, "") else None)
            if "reference_year" in body:
                updates.append("reference_year = %s")
                raw = str(body.get("reference_year") or "").strip()
                params.append(int(raw) if raw.isdigit() else None)
            if "included_modules" in body and isinstance(body.get("included_modules"), list):
                updates.append("included_modules = %s")
                params.append(json.dumps(body.get("included_modules")))

            if updates:
                updates.extend(["updated_at = NOW()", "updated_by = %s"])
                params.append(_actor(_user))
                params.extend([int(job_id), int(assessment_id)])
                con.execute(
                    f"UPDATE lca_assessments SET {', '.join(updates)} WHERE job_id = %s AND assessment_id = %s",
                    params,
                )
            if "dataset_ids" in body:
                _set_assessment_dataset_ids(con, int(assessment_id), _to_int_list(body.get("dataset_ids")), _user)
            summary = _recalculate_assessment(con, int(assessment_id), _user)
            return {"ok": True, "summary": summary}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update LCA assessment: {e}")


@router.get("/jobs/{job_id}/lca/assessments/{assessment_id}/datasets")
def get_assessment_datasets(job_id: int, assessment_id: int, _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.view")
    assert_job_access(_user, int(job_id))
    try:
        with get_conn() as con:
            if not _assessment_row(con, int(job_id), int(assessment_id)):
                raise HTTPException(status_code=404, detail="LCA assessment not found")
            selected = _get_assessment_dataset_ids(con, int(assessment_id))
            inherited = _get_job_dataset_ids(con, int(job_id))
            return {
                "job_id": int(job_id),
                "assessment_id": int(assessment_id),
                "selected_dataset_ids": selected,
                "inherited_job_dataset_ids": inherited,
                "effective_dataset_ids": selected if selected else inherited,
                "datasets": _list_available_datasets(con),
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load LCA datasets: {e}")


@router.put("/jobs/{job_id}/lca/assessments/{assessment_id}/datasets")
def put_assessment_datasets(job_id: int, assessment_id: int, body: dict = Body(...), _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.edit")
    assert_job_access(_user, int(job_id))
    try:
        with get_conn(autocommit=False) as con:
            if not _assessment_row(con, int(job_id), int(assessment_id)):
                raise HTTPException(status_code=404, detail="LCA assessment not found")
            selected = _set_assessment_dataset_ids(con, int(assessment_id), _to_int_list(body.get("dataset_ids")), _user)
            effective = _resolve_dataset_ids(con, int(job_id), int(assessment_id))
            return {"ok": True, "selected_dataset_ids": selected, "effective_dataset_ids": effective}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update LCA datasets: {e}")


# ---------------------------------------------------------------------------
# Line items
# ---------------------------------------------------------------------------

@router.get("/jobs/{job_id}/lca/assessments/{assessment_id}/line-items")
def list_line_items(job_id: int, assessment_id: int, _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.view")
    assert_job_access(_user, int(job_id))
    try:
        with get_conn() as con:
            if not _assessment_row(con, int(job_id), int(assessment_id)):
                raise HTTPException(status_code=404, detail="LCA assessment not found")
            df = con.execute(
                "SELECT * FROM lca_line_items WHERE assessment_id = %s ORDER BY module_code, line_item_id",
                [int(assessment_id)],
            ).df()
            items: list[dict[str, Any]] = []
            if df is not None and not df.empty:
                df = df.where(df.notna(), None)
                for _, r in df.iterrows():
                    items.append(
                        {
                            "line_item_id": int(r.get("line_item_id")),
                            "component_id": _int_or_none(r.get("component_id")),
                            "module_code": r.get("module_code"),
                            "line_label": r.get("line_label"),
                            "material_category_id": _int_or_none(r.get("material_category_id")),
                            "quantity": safe_float(r.get("quantity")),
                            "unit": r.get("unit"),
                            "origin_country": r.get("origin_country"),
                            "transport_mode": r.get("transport_mode"),
                            "distance_km": _float_or_none(r.get("distance_km")),
                            "energy_kwh": _float_or_none(r.get("energy_kwh")),
                            "end_of_life_route": r.get("end_of_life_route"),
                            "mapped_factor_source": r.get("mapped_factor_source"),
                            "mapped_factor_id": _int_or_none(r.get("mapped_factor_id")),
                            "factor_value": safe_float(r.get("factor_value")),
                            "factor_unit": r.get("factor_unit"),
                            "factor_source_label": r.get("factor_source_label"),
                            "factor_source_url": r.get("factor_source_url"),
                            "data_quality": r.get("data_quality"),
                            "is_gap_filled": bool(r.get("is_gap_filled") or False),
                            "gap_fill_method": r.get("gap_fill_method"),
                            "is_placeholder": bool(r.get("is_placeholder") or False),
                            "notes": r.get("notes"),
                            "updated_at": str(r.get("updated_at")) if r.get("updated_at") else None,
                        }
                    )
            summary = _recalculate_assessment(con, int(assessment_id), _user)
            return {
                "job_id": int(job_id),
                "assessment_id": int(assessment_id),
                "items": items,
                "summary": summary,
                "selected_dataset_ids": _get_assessment_dataset_ids(con, int(assessment_id)),
                "effective_dataset_ids": _resolve_dataset_ids(con, int(job_id), int(assessment_id)),
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load LCA line items: {e}")


def _fill_from_component(con, body: dict[str, Any]) -> dict[str, Any]:
    """If a component_id is supplied, use it to default category/mass/unit/origin
    unless the caller explicitly overrides those fields."""
    component_id = body.get("component_id")
    if component_id in (None, ""):
        return body
    row = con.execute(
        """
        SELECT description, material_category_id, default_unit_mass, default_unit, origin_country
        FROM lca_components WHERE component_id = %s
        """,
        [int(component_id)],
    ).fetchone()
    if not row:
        raise HTTPException(status_code=400, detail="component_id does not exist")
    filled = dict(body)
    filled.setdefault("line_label", row[0])
    if "material_category_id" not in filled or filled.get("material_category_id") in (None, ""):
        filled["material_category_id"] = row[1]
    if "quantity" not in filled or filled.get("quantity") in (None, ""):
        filled["quantity"] = row[2]
    if "unit" not in filled or filled.get("unit") in (None, ""):
        filled["unit"] = row[3]
    if "origin_country" not in filled or filled.get("origin_country") in (None, ""):
        filled["origin_country"] = row[4]
    return filled


@router.post("/jobs/{job_id}/lca/assessments/{assessment_id}/line-items")
def create_line_item(job_id: int, assessment_id: int, body: dict = Body(...), _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.edit")
    assert_job_access(_user, int(job_id))
    try:
        with get_conn(autocommit=False) as con:
            if not _assessment_row(con, int(job_id), int(assessment_id)):
                raise HTTPException(status_code=404, detail="LCA assessment not found")
            valid_modules = _valid_module_codes(con)
            body = _fill_from_component(con, body)
            module_code = str(body.get("module_code") or "").strip().upper()
            if module_code not in valid_modules:
                raise HTTPException(status_code=400, detail=f"Invalid module_code: {module_code}")
            line_label = str(body.get("line_label") or "").strip()
            if not line_label:
                raise HTTPException(status_code=400, detail="line_label is required")

            row = con.execute(
                """
                INSERT INTO lca_line_items (
                  assessment_id, component_id, module_code, line_label, material_category_id, quantity, unit,
                  origin_country, transport_mode, distance_km, energy_kwh, end_of_life_route,
                  mapped_factor_source, mapped_factor_id, factor_value, factor_unit,
                  factor_source_label, factor_source_url, data_quality, is_gap_filled, gap_fill_method,
                  is_placeholder, notes, created_by, updated_by
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING line_item_id
                """,
                [
                    int(assessment_id),
                    int(body.get("component_id")) if str(body.get("component_id") or "").strip().isdigit() else None,
                    module_code, line_label,
                    int(body.get("material_category_id")) if str(body.get("material_category_id") or "").strip().isdigit() else None,
                    safe_float(body.get("quantity")), str(body.get("unit") or "kg").strip(),
                    str(body.get("origin_country") or "").strip() or None,
                    str(body.get("transport_mode") or "").strip() or None,
                    safe_float(body.get("distance_km")) if body.get("distance_km") not in (None, "") else None,
                    safe_float(body.get("energy_kwh")) if body.get("energy_kwh") not in (None, "") else None,
                    str(body.get("end_of_life_route") or "").strip() or None,
                    str(body.get("mapped_factor_source") or "manual").strip(),
                    int(body.get("mapped_factor_id")) if str(body.get("mapped_factor_id") or "").strip().isdigit() else None,
                    safe_float(body.get("factor_value")), str(body.get("factor_unit") or "kgCO2e/kg").strip(),
                    str(body.get("factor_source_label") or "").strip() or None,
                    str(body.get("factor_source_url") or "").strip() or None,
                    str(body.get("data_quality") or "secondary").strip(),
                    bool(body.get("is_gap_filled") or False),
                    str(body.get("gap_fill_method") or "").strip() or None,
                    bool(body.get("is_placeholder") or False),
                    str(body.get("notes") or "").strip() or None,
                    _actor(_user), _actor(_user),
                ],
            ).fetchone()
            summary = _recalculate_assessment(con, int(assessment_id), _user)
            return {"ok": True, "line_item_id": int(row[0]), "summary": summary}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create LCA line item: {e}")


def _line_item_assessment(con, job_id: int, line_item_id: int) -> int:
    row = con.execute(
        """
        SELECT li.assessment_id
        FROM lca_line_items li
        JOIN lca_assessments la ON la.assessment_id = li.assessment_id
        WHERE li.line_item_id = %s AND la.job_id = %s
        LIMIT 1
        """,
        [int(line_item_id), int(job_id)],
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="LCA line item not found")
    return int(row[0])


@router.patch("/jobs/{job_id}/lca/line-items/{line_item_id}")
def update_line_item(job_id: int, line_item_id: int, body: dict = Body(...), _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.edit")
    assert_job_access(_user, int(job_id))
    try:
        with get_conn(autocommit=False) as con:
            assessment_id = _line_item_assessment(con, int(job_id), int(line_item_id))
            valid_modules = _valid_module_codes(con)
            edits: list[str] = []
            params: list[Any] = []
            numeric_fields = {"quantity", "distance_km", "energy_kwh", "factor_value"}
            int_fields = {"component_id", "material_category_id", "mapped_factor_id"}
            bool_fields = {"is_gap_filled", "is_placeholder"}
            text_fields = {
                "line_label", "unit", "origin_country", "transport_mode", "end_of_life_route",
                "mapped_factor_source", "factor_unit", "factor_source_label", "factor_source_url",
                "data_quality", "gap_fill_method", "notes",
            }
            for field in ("module_code", *numeric_fields, *int_fields, *bool_fields, *text_fields):
                if field not in body:
                    continue
                if field == "module_code":
                    val = str(body.get(field) or "").strip().upper()
                    if val not in valid_modules:
                        raise HTTPException(status_code=400, detail=f"Invalid module_code: {val}")
                    edits.append("module_code = %s")
                    params.append(val)
                elif field in numeric_fields:
                    edits.append(f"{field} = %s")
                    raw = body.get(field)
                    params.append(safe_float(raw) if raw not in (None, "") else None)
                elif field in int_fields:
                    raw = str(body.get(field) or "").strip()
                    edits.append(f"{field} = %s")
                    params.append(int(raw) if raw.isdigit() else None)
                elif field in bool_fields:
                    edits.append(f"{field} = %s")
                    params.append(bool(body.get(field)))
                else:
                    text = str(body.get(field) or "").strip()
                    edits.append(f"{field} = %s")
                    params.append(text or None)
            if not edits:
                return {"ok": True}
            edits.extend(["updated_at = NOW()", "updated_by = %s"])
            params.append(_actor(_user))
            params.append(int(line_item_id))
            con.execute(f"UPDATE lca_line_items SET {', '.join(edits)} WHERE line_item_id = %s", params)
            summary = _recalculate_assessment(con, assessment_id, _user)
            return {"ok": True, "summary": summary}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update LCA line item: {e}")


@router.delete("/jobs/{job_id}/lca/line-items/{line_item_id}")
def delete_line_item(job_id: int, line_item_id: int, _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.edit")
    assert_job_access(_user, int(job_id))
    try:
        with get_conn(autocommit=False) as con:
            assessment_id = _line_item_assessment(con, int(job_id), int(line_item_id))
            con.execute("DELETE FROM lca_line_items WHERE line_item_id = %s", [int(line_item_id)])
            summary = _recalculate_assessment(con, assessment_id, _user)
            return {"ok": True, "summary": summary}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete LCA line item: {e}")


@router.post("/jobs/{job_id}/lca/line-items/{line_item_id}/map-factor")
def map_line_item_factor(job_id: int, line_item_id: int, body: dict = Body(default={}), _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.edit")
    assert_job_access(_user, int(job_id))
    try:
        with get_conn(autocommit=False) as con:
            row = con.execute(
                """
                SELECT li.assessment_id, li.line_label, li.module_code, COALESCE(li.unit,''), COALESCE(li.origin_country,'')
                FROM lca_line_items li
                JOIN lca_assessments la ON la.assessment_id = li.assessment_id
                WHERE li.line_item_id = %s AND la.job_id = %s
                LIMIT 1
                """,
                [int(line_item_id), int(job_id)],
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="LCA line item not found")
            assessment_id = int(row[0])
            dataset_ids = _resolve_dataset_ids(con, int(job_id), assessment_id)
            candidates = _find_factor_candidates(
                con, line_label=str(row[1] or ""), module_code=str(row[2] or ""),
                unit=str(row[3] or ""), country=str(row[4] or ""), dataset_ids=dataset_ids,
            )
            apply_top = bool(body.get("apply_top_match", True))
            applied = None
            if candidates and apply_top:
                top = candidates[0]
                con.execute(
                    """
                    UPDATE lca_line_items
                    SET mapped_factor_source = 'factor_lookup', mapped_factor_id = %s, factor_value = %s,
                        factor_unit = %s, factor_source_label = %s, factor_source_url = NULL,
                        is_gap_filled = FALSE, gap_fill_method = NULL, updated_at = NOW(), updated_by = %s
                    WHERE line_item_id = %s
                    """,
                    [int(top["db_id"]), safe_float(top["factor"]), str(top.get("uom") or "kgCO2e/kg"),
                     str(top.get("source") or "factor_lookup"), _actor(_user), int(line_item_id)],
                )
                applied = top
            summary = _recalculate_assessment(con, assessment_id, _user)
            return {"ok": True, "applied": applied, "candidates": candidates, "summary": summary, "dataset_ids_used": dataset_ids}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to map emission factor: {e}")


@router.post("/jobs/{job_id}/lca/line-items/{line_item_id}/gap-fill")
def gap_fill_line_item(job_id: int, line_item_id: int, body: dict = Body(default={}), _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.edit")
    assert_job_access(_user, int(job_id))
    try:
        with get_conn(autocommit=False) as con:
            row = con.execute(
                """
                SELECT li.assessment_id, li.module_code, COALESCE(li.unit,'')
                FROM lca_line_items li
                JOIN lca_assessments la ON la.assessment_id = li.assessment_id
                WHERE li.line_item_id = %s AND la.job_id = %s
                LIMIT 1
                """,
                [int(line_item_id), int(job_id)],
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="LCA line item not found")
            assessment_id = int(row[0])
            dataset_ids = _resolve_dataset_ids(con, int(job_id), assessment_id)
            estimate, method = _estimate_gap_factor(con, str(row[1] or "A1"), str(row[2] or ""), dataset_ids=dataset_ids)
            apply_fill = bool(body.get("apply", True))
            if apply_fill and estimate > 0:
                con.execute(
                    """
                    UPDATE lca_line_items
                    SET factor_value = %s, factor_unit = COALESCE(NULLIF(factor_unit, ''), %s),
                        mapped_factor_source = 'manual', factor_source_label = 'predictive_estimate',
                        data_quality = 'estimated', is_gap_filled = TRUE, gap_fill_method = %s,
                        updated_at = NOW(), updated_by = %s
                    WHERE line_item_id = %s
                    """,
                    [estimate, "kgCO2e/kg", method, _actor(_user), int(line_item_id)],
                )
            summary = _recalculate_assessment(con, assessment_id, _user)
            return {
                "ok": True, "estimated_factor": round(estimate, 8), "method": method,
                "applied": bool(apply_fill and estimate > 0), "summary": summary, "dataset_ids_used": dataset_ids,
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to gap-fill line item: {e}")


@router.post("/jobs/{job_id}/lca/assessments/{assessment_id}/recalculate")
def recalculate_assessment(job_id: int, assessment_id: int, _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.view")
    assert_job_access(_user, int(job_id))
    try:
        with get_conn(autocommit=False) as con:
            if not _assessment_row(con, int(job_id), int(assessment_id)):
                raise HTTPException(status_code=404, detail="LCA assessment not found")
            summary = _recalculate_assessment(con, int(assessment_id), _user)
            return {"ok": True, "summary": summary}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to recalculate assessment: {e}")


@router.get("/jobs/{job_id}/lca/assessments/{assessment_id}/report")
def assessment_report(job_id: int, assessment_id: int, _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.view")
    assert_job_access(_user, int(job_id))
    try:
        with get_conn(autocommit=False) as con:
            assessment = _assessment_row(con, int(job_id), int(assessment_id))
            if not assessment:
                raise HTTPException(status_code=404, detail="LCA assessment not found")
            summary = _recalculate_assessment(con, int(assessment_id), _user)
            lines_df = con.execute(
                """
                SELECT line_item_id, module_code, line_label, quantity, unit, factor_value, factor_unit,
                       factor_source_label, factor_source_url, is_gap_filled, gap_fill_method, data_quality, is_placeholder
                FROM lca_line_items WHERE assessment_id = %s ORDER BY module_code, line_item_id
                """,
                [int(assessment_id)],
            ).df()
            lines: list[dict[str, Any]] = []
            if lines_df is not None and not lines_df.empty:
                for _, r in lines_df.iterrows():
                    lines.append(
                        {
                            "line_item_id": int(r.get("line_item_id")),
                            "module_code": r.get("module_code"),
                            "line_label": r.get("line_label"),
                            "quantity": safe_float(r.get("quantity")),
                            "unit": r.get("unit"),
                            "factor_value": safe_float(r.get("factor_value")),
                            "factor_unit": r.get("factor_unit"),
                            "factor_source_label": r.get("factor_source_label"),
                            "factor_source_url": r.get("factor_source_url"),
                            "is_gap_filled": bool(r.get("is_gap_filled") or False),
                            "gap_fill_method": r.get("gap_fill_method"),
                            "data_quality": r.get("data_quality"),
                            "is_placeholder": bool(r.get("is_placeholder") or False),
                        }
                    )
            real_lines = [ln for ln in lines if not ln["is_placeholder"]]
            gap_count = sum(1 for ln in real_lines if ln["is_gap_filled"])
            total_rows = len(real_lines)

            return {
                "job_id": int(job_id),
                "assessment_id": int(assessment_id),
                "generated_at": datetime.utcnow().isoformat(),
                "goal_scope": {
                    "name": assessment["name"],
                    "sku": assessment["sku"],
                    "description": assessment["description"],
                    "functional_unit": f"{assessment['functional_unit_value']} {assessment['functional_unit_unit']}",
                    "lifecycle_boundary": assessment["lifecycle_boundary"],
                    "included_modules": assessment["included_modules"],
                    "standard": assessment["standard"],
                    "reference_year": assessment["reference_year"],
                    "geography": assessment["geography"],
                    "assumptions": assessment["assumptions"],
                    "data_sources_note": assessment["data_sources_note"],
                    "review_status": assessment["review_status"],
                },
                "inventory_analysis": {"rows_count": total_rows, "placeholder_rows": len(lines) - total_rows, "rows": lines},
                "impact_assessment": {
                    "method": "Global Warming Potential (GWP 100)",
                    "unit": "tCO2e",
                    "total_tco2e": summary["total_tco2e"],
                    "module_breakdown": summary["module_breakdown"],
                    "category_breakdown": summary["category_breakdown"],
                },
                "mass_reconciliation": summary["mass_reconciliation"],
                "hotspots": summary["hotspots"],
                "data_quality": {
                    "gap_filled_rows": gap_count,
                    "primary_data_rows": sum(1 for ln in real_lines if str(ln.get("data_quality") or "").lower() == "primary"),
                    "secondary_data_rows": sum(1 for ln in real_lines if str(ln.get("data_quality") or "").lower() != "primary"),
                    "gap_filled_pct": round((gap_count / total_rows * 100.0) if total_rows else 0.0, 2),
                },
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate LCA report payload: {e}")


@router.get("/jobs/{job_id}/lca/lci-search")
def lci_search(
    job_id: int,
    q: str = Query(default=""),
    assessment_id: int | None = Query(default=None),
    dataset_ids: str = Query(default=""),
    unit: str = Query(default=""),
    country: str = Query(default=""),
    module_code: str = Query(default="A1"),
    _user: dict[str, str] = Depends(_current_user),
):
    assert_permission(_user, "jobs.view")
    assert_job_access(_user, int(job_id))
    query = str(q or "").strip()
    if not query:
        return {"items": []}
    try:
        with get_conn() as con:
            selected_ids = _to_int_list(dataset_ids)
            if not selected_ids:
                selected_ids = _resolve_dataset_ids(con, int(job_id), assessment_id) if assessment_id else _get_job_dataset_ids(con, int(job_id))
            candidates = _find_factor_candidates(
                con, line_label=query, module_code=str(module_code or "A1"),
                unit=str(unit or ""), country=str(country or ""), dataset_ids=selected_ids,
            )
            return {"items": candidates, "dataset_ids_used": selected_ids}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to search LCI factors: {e}")


@router.post("/jobs/{job_id}/lca/assessments/{assessment_id}/bom-upload")
async def upload_bom_file(
    job_id: int,
    assessment_id: int,
    file: UploadFile = File(...),
    _user: dict[str, str] = Depends(_current_user),
):
    assert_permission(_user, "jobs.edit")
    assert_job_access(_user, int(job_id))
    try:
        filename = str(file.filename or "").strip().lower()
        raw = await file.read()
        if not raw:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")
        if filename.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(raw))
        elif filename.endswith((".xlsx", ".xlsm", ".xls")):
            df = pd.read_excel(io.BytesIO(raw))
        else:
            raise HTTPException(status_code=400, detail="Unsupported file type. Use CSV or XLSX.")
        if df is None or df.empty:
            raise HTTPException(status_code=400, detail="No rows found in BOM file")

        norm_map = {_normalize_col(c): c for c in df.columns}

        def getv(row: Any, names: list[str], default: Any = None) -> Any:
            for name in names:
                original = norm_map.get(_normalize_col(name))
                if original is not None:
                    val = row.get(original)
                    if val is not None and str(val).strip() != "":
                        return val
            return default

        inserted = mapped = gap_filled = skipped = components_created = 0

        with get_conn(autocommit=False) as con:
            if not _assessment_row(con, int(job_id), int(assessment_id)):
                raise HTTPException(status_code=404, detail="LCA assessment not found")
            client_db_id = _job_client_id(con, int(job_id))
            valid_modules = _valid_module_codes(con)
            dataset_ids = _resolve_dataset_ids(con, int(job_id), int(assessment_id))

            for _, row in df.iterrows():
                line_label = str(getv(row, ["item_name", "material", "material_name", "component", "component_name", "name", "description"], "") or "").strip()
                if not line_label:
                    skipped += 1
                    continue

                module_raw = str(getv(row, ["module", "module_code", "stage", "stage_key", "lifecycle_stage"], "A1") or "A1").strip().upper()
                module_code = module_raw if module_raw in valid_modules else "A1"
                qty = safe_float(getv(row, ["quantity", "qty", "weight", "unit_weight", "mass"], 0))
                unit = str(getv(row, ["unit", "uom", "units"], "kg") or "kg").strip()
                origin_country = str(getv(row, ["origin_country", "country", "raw_material_origin_country"], "") or "").strip()
                component_code = str(getv(row, ["component_code", "part_code", "part_number", "current_codes", "new_codes"], "") or "").strip()
                is_placeholder = qty <= 0
                explicit_factor = safe_float(getv(row, ["factor", "factor_value", "emission_factor"], 0))
                explicit_factor_unit = str(getv(row, ["factor_unit", "emission_factor_unit"], "kgCO2e/kg") or "kgCO2e/kg").strip()

                component_id = None
                if component_code:
                    existing = con.execute(
                        "SELECT component_id FROM lca_components WHERE component_code = %s AND client_db_id IS NOT DISTINCT FROM %s",
                        [component_code, client_db_id],
                    ).fetchone()
                    if existing:
                        component_id = int(existing[0])
                    elif not is_placeholder:
                        created = con.execute(
                            """
                            INSERT INTO lca_components (client_db_id, component_code, description, origin_country, created_by, updated_by)
                            VALUES (%s, %s, %s, %s, %s, %s)
                            RETURNING component_id
                            """,
                            [client_db_id, component_code, line_label, origin_country or None, _actor(_user), _actor(_user)],
                        ).fetchone()
                        component_id = int(created[0])
                        components_created += 1

                row_insert = con.execute(
                    """
                    INSERT INTO lca_line_items (
                      assessment_id, component_id, module_code, line_label, quantity, unit, origin_country,
                      mapped_factor_source, factor_value, factor_unit, data_quality, is_placeholder, created_by, updated_by
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING line_item_id
                    """,
                    [
                        int(assessment_id), component_id, module_code, line_label, qty, unit or "kg",
                        origin_country or None, "manual" if explicit_factor > 0 else None,
                        explicit_factor, explicit_factor_unit, "secondary", is_placeholder,
                        _actor(_user), _actor(_user),
                    ],
                ).fetchone()
                line_item_id = int(row_insert[0])
                inserted += 1

                if is_placeholder or explicit_factor > 0:
                    continue

                candidates = _find_factor_candidates(con, line_label=line_label, module_code=module_code, unit=unit, country=origin_country, dataset_ids=dataset_ids)
                if candidates:
                    top = candidates[0]
                    con.execute(
                        """
                        UPDATE lca_line_items
                        SET mapped_factor_source = 'factor_lookup', mapped_factor_id = %s, factor_value = %s,
                            factor_unit = %s, factor_source_label = %s, is_gap_filled = FALSE,
                            updated_at = NOW(), updated_by = %s
                        WHERE line_item_id = %s
                        """,
                        [int(top["db_id"]), safe_float(top["factor"]), str(top.get("uom") or "kgCO2e/kg"),
                         str(top.get("source") or "factor_lookup"), _actor(_user), line_item_id],
                    )
                    mapped += 1
                else:
                    estimate, method = _estimate_gap_factor(con, module_code, unit, dataset_ids=dataset_ids)
                    if estimate > 0:
                        con.execute(
                            """
                            UPDATE lca_line_items
                            SET factor_value = %s, factor_unit = %s, mapped_factor_source = 'manual',
                                factor_source_label = 'predictive_estimate', data_quality = 'estimated',
                                is_gap_filled = TRUE, gap_fill_method = %s, updated_at = NOW(), updated_by = %s
                            WHERE line_item_id = %s
                            """,
                            [estimate, "kgCO2e/kg", method, _actor(_user), line_item_id],
                        )
                        gap_filled += 1

            summary = _recalculate_assessment(con, int(assessment_id), _user)

        return {
            "ok": True, "rows_total": int(len(df.index)), "inserted": inserted, "mapped": mapped,
            "gap_filled": gap_filled, "skipped": skipped, "components_created": components_created,
            "dataset_ids_used": dataset_ids, "summary": summary,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to import BOM file: {e}")
