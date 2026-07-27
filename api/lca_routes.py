from __future__ import annotations

from datetime import datetime
from typing import Any

import io
import json
import pandas as pd
from fastapi import APIRouter, Body, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import Response

from api.auth import _current_user
from api.permissions import assert_job_access, assert_permission
from core.database import get_conn
from services.lca_bom_template import generate_lca_bom_template
from services.lca_component_tree import ensure_lca_hierarchy_schema, resolve_effective_lines, snapshot_to_lines
from services.lca_engine import apply_scenario_multipliers, compute_readiness, safe_float, summarize_assessment
from services.lca_material_categories import ensure_material_categories_deduped, resolve_or_create_material_category
from services.virus_scan import VirusScanError, scan_bytes

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
    # GHG Protocol Scope 3 categories (Phase 5, service assessments)
    "S1": "purchased goods services procurement supplies",
    "S2": "capital goods equipment machinery construction",
    "S3": "fuel energy upstream well-to-tank transmission distribution losses",
    "S4": "upstream transport freight logistics inbound shipping",
    "S5": "waste disposal landfill recycling incineration",
    "S6": "business travel flight rail car mileage hotel",
    "S7": "employee commuting commute travel to work",
    "S8": "leased assets upstream lease rental",
    "S9": "downstream transport distribution outbound delivery",
    "S10": "processing sold products intermediate",
    "S11": "use phase sold products operational energy",
    "S12": "end of life disposal treatment sold products",
    "S13": "leased assets downstream lease rental",
    "S14": "franchise franchisee",
    "S15": "investment financed emissions equity debt",
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


def _parse_json_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        except Exception:
            return []
    return []


# Below this score (0-1), a factor match is not auto-applied -- it's
# surfaced as a candidate for the user to confirm instead. See
# _find_factor_candidates for how confidence is computed.
CONFIDENCE_THRESHOLD = 0.45


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
               data_sources_note, review_status, total_tco2e, last_calculated_at, readiness_score, readiness_breakdown
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
        "readiness_score": _float_or_none(row[21]),
        "readiness_breakdown": _parse_json_list(row[22]),
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
        SELECT line_item_id, component_id, activity_id, module_code, line_label, material_category_id, quantity, unit,
               factor_value, factor_unit, is_gap_filled, is_placeholder, data_quality,
               mapped_factor_source, factor_match_confidence
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
                "component_id": _int_or_none(r.get("component_id")),
                "activity_id": _int_or_none(r.get("activity_id")),
                "module_code": str(r.get("module_code") or ""),
                "line_label": str(r.get("line_label") or "Unnamed line"),
                "material_category_id": _int_or_none(r.get("material_category_id")),
                "quantity": safe_float(r.get("quantity")),
                "unit": str(r.get("unit") or ""),
                # factor_value is nullable (no default) -- an unmapped line item
                # legitimately has NULL here, which .df() upcasts to NaN; safe_float()
                # happily parses "nan" as a float, so this must go through
                # _float_or_none first or NaN poisons the emissions total and breaks
                # json.dumps downstream (Postgres JSONB rejects the literal NaN token).
                "factor_value": _float_or_none(r.get("factor_value")) or 0.0,
                "factor_unit": str(r.get("factor_unit") or "kgCO2e/kg"),
                "is_gap_filled": bool(r.get("is_gap_filled") or False),
                "is_placeholder": bool(r.get("is_placeholder") or False),
                "data_quality": str(r.get("data_quality") or "secondary"),
                "mapped_factor_source": (str(r.get("mapped_factor_source")) if not _is_missing(r.get("mapped_factor_source")) else None),
                "factor_match_confidence": _float_or_none(r.get("factor_match_confidence")),
            }
        )
    return rows


def _recalculate_assessment(con, assessment_id: int, user: dict[str, str]) -> dict[str, Any]:
    ensure_lca_hierarchy_schema(con)
    assessment_row = con.execute(
        """
        SELECT confirmed_quantity, confirmed_quantity_unit, included_modules, assessment_type,
               review_status, resolved_lines_snapshot
        FROM lca_assessments WHERE assessment_id = %s
        """,
        [int(assessment_id)],
    ).fetchone()
    confirmed_quantity = safe_float(assessment_row[0]) if assessment_row and assessment_row[0] is not None else None
    confirmed_unit = assessment_row[1] if assessment_row else "kg"
    included_modules = _parse_json_list(assessment_row[2]) if assessment_row else []
    assessment_type = str(assessment_row[3] or "product") if assessment_row else "product"
    review_status = str(assessment_row[4] or "draft") if assessment_row else "draft"
    frozen_snapshot = snapshot_to_lines(assessment_row[5]) if assessment_row else None

    # Once an assessment reaches verified/published, its resolved lines freeze
    # at whatever they were the moment it got there -- a shared assembly
    # edited elsewhere (or any other line-level change) can't silently move
    # an already-signed-off ISO 14067 number without a deliberate re-review.
    # Reopening the assessment (review_status back to draft/in_review) clears
    # the freeze; the next verify/publish captures a fresh snapshot.
    is_frozen_status = review_status in ("verified", "published")
    raw_lines = _load_line_items_for_calc(con, int(assessment_id))
    if is_frozen_status and frozen_snapshot is not None:
        lines = frozen_snapshot
    else:
        lines = resolve_effective_lines(con, raw_lines)
        con.execute(
            "UPDATE lca_assessments SET resolved_lines_snapshot = %s WHERE assessment_id = %s",
            [json.dumps(lines) if is_frozen_status else None, int(assessment_id)],
        )

    summary = summarize_assessment(lines, confirmed_quantity, confirmed_unit, assessment_type=assessment_type)
    readiness = compute_readiness(lines, summary, included_modules, CONFIDENCE_THRESHOLD, assessment_type=assessment_type)
    summary["readiness"] = readiness

    con.execute(
        """
        UPDATE lca_assessments
        SET total_tco2e = %s, readiness_score = %s, readiness_breakdown = %s,
            last_calculated_at = NOW(), updated_at = NOW(), updated_by = %s
        WHERE assessment_id = %s
        """,
        [summary["total_tco2e"], readiness["score"], json.dumps(readiness["checks"]), _actor(user), int(assessment_id)],
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
    """Rank candidate factors by a normalized 0-1 confidence score.

    confidence = 0.75 * trigram word_similarity + 0.15 * unit match +
    0.10 * module-keyword hit. Uses pg_trgm's word_similarity() rather than
    plain similarity(): real BOM line labels ("Steel cans") are short while
    factor_lookup's report_label is a long, multi-segment string ("Material
    use - Metal - Metal: steel cans - Primary material production"), and
    whole-string similarity() penalizes that length gap so heavily that
    even a perfect conceptual match scores ~0.25 (confirmed live). Word
    similarity finds the best-matching *word extent* within the longer
    string instead, so a true match scores close to 1.0 -- verified live:
    "Steel cans" against the row above scores word_similarity=1.0 vs.
    plain similarity=0.24; an unrelated label scores ~0.05 either way.
    """
    keyword_blob = MODULE_KEYWORDS.get(module_code, "")
    label = line_label.strip()
    unit_pattern = str(unit or "").strip()
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

    where_clause = "COALESCE(fl.factor, 0) > 0"
    where_params: list[Any] = []
    selected = sorted({int(x) for x in (dataset_ids or []) if int(x) > 0})
    if selected:
        ph = ",".join(["%s"] * len(selected))
        where_clause += f" AND fl.dataset_id IN ({ph})"
        where_params.extend(selected)

    df = con.execute(
        f"""
        WITH candidates AS (
            SELECT
              fl.db_id, fl.report_label, fl.column_text, fl.uom, fl.factor, fl.source, fl.region, fl.year,
              LEAST(1.0,
                0.75 * GREATEST(
                  word_similarity(%s, COALESCE(fl.report_label, '')),
                  word_similarity(%s, COALESCE(fl.column_text, ''))
                )
                + 0.15 * (CASE WHEN COALESCE(fl.uom, '') <> '' AND lower(fl.uom) = lower(%s) THEN 1 ELSE 0 END)
                + 0.10 * (CASE WHEN ({keyword_expr or 'FALSE'}) THEN 1 ELSE 0 END)
              ) AS confidence
            FROM v_factor_lookup fl
            WHERE {where_clause}
        ),
        deduped AS (
            -- Same report_label can exist in more than one loaded dataset/
            -- year -- pick the best-scoring one per label instead of
            -- showing the same candidate several times.
            SELECT DISTINCT ON (report_label) *
            FROM candidates
            WHERE confidence > 0.05
            ORDER BY report_label, confidence DESC, year DESC NULLS LAST, db_id DESC
        )
        SELECT * FROM deduped
        ORDER BY confidence DESC, year DESC NULLS LAST, db_id DESC
        LIMIT 10
        """,
        [label, label, unit_pattern, *keyword_params, *where_params],
    ).df()
    out: list[dict[str, Any]] = []
    if df is None or df.empty:
        return out
    # astype(object) first -- plain .where() is a no-op on any column pandas
    # infers as float64 (uom/source/region commonly are, whenever every
    # candidate row has that column NULL), leaving raw NaN in fields like
    # "uom"/"source"/"region" below and breaking JSON encoding of the response.
    df = df.astype(object).where(df.notna(), None)
    for _, r in df.iterrows():
        confidence = round(safe_float(r.get("confidence")), 4)
        out.append(
            {
                "db_id": int(r.get("db_id")),
                "label": str(r.get("report_label") or r.get("column_text") or f"Factor {r.get('db_id')}"),
                "uom": r.get("uom"),
                "factor": safe_float(r.get("factor")),
                "source": r.get("source"),
                "region": r.get("region"),
                "confidence": confidence,
                "score": round(confidence * 100, 1),
            }
        )
    return out


def _lookup_factor_by_id(con, factor_db_id: int) -> dict[str, Any] | None:
    row = con.execute(
        "SELECT db_id, report_label, column_text, uom, factor, source, region FROM v_factor_lookup WHERE db_id = %s",
        [int(factor_db_id)],
    ).fetchone()
    if not row:
        return None
    return {
        "db_id": int(row[0]),
        "label": str(row[1] or row[2] or f"Factor {row[0]}"),
        "uom": row[3],
        "factor": safe_float(row[4]),
        "source": row[5],
        "region": row[6],
    }


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


_BOM_COLUMN_ALIAS_GROUPS = [
    ["item_name", "material", "material_name", "component", "component_name", "name", "description"],
    ["module", "module_code", "stage", "stage_key", "lifecycle_stage"],
    ["quantity", "qty", "weight", "unit_weight", "mass"],
    ["unit", "uom", "units"],
    ["origin_country", "country", "raw_material_origin_country"],
    ["component_code", "part_code", "part_number", "current_codes", "new_codes"],
    ["material_category", "material_category_name", "category", "category_name"],
    ["factor", "factor_value", "emission_factor"],
    ["factor_unit", "emission_factor_unit"],
]
_BOM_ALIAS_TOKENS = {_normalize_col(a) for group in _BOM_COLUMN_ALIAS_GROUPS for a in group}


def _detect_bom_header_row(raw_df: Any, max_scan: int = 20) -> int:
    """BOM files can have a title/metadata preamble above the real header row
    -- our own downloadable template does (job number, client, boundary) --
    so scan the first few rows for the one that looks most like a
    column-header row instead of always assuming row 0 is the header."""
    best_row = 0
    best_score = 0
    for i in range(min(max_scan, len(raw_df))):
        cells = {_normalize_col(v) for v in raw_df.iloc[i].tolist() if v is not None and str(v).strip() != ""}
        score = len(cells & _BOM_ALIAS_TOKENS)
        if score > best_score:
            best_score = score
            best_row = i
    return best_row if best_score >= 2 else 0


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
        ensure_material_categories_deduped(con)
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


@router.post("/lca/material-categories")
def create_or_resolve_lca_material_category(body: dict = Body(...), _user: dict[str, str] = Depends(_current_user)):
    """Resolve a typed category name to an existing category (case-insensitive),
    or create it if it doesn't exist yet. Backs the smart-list category picker
    in the job LCA UI -- categories aren't a fixed list, so any job user can
    add a new one on the fly rather than being limited to admin-curated CRUD."""
    name = str(body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    with get_conn() as con:
        ensure_material_categories_deduped(con)
        category_id = resolve_or_create_material_category(con, name)
        row = con.execute("SELECT name FROM lca_material_categories_lookup WHERE category_id = %s", [category_id]).fetchone()
    return {"ok": True, "category_id": category_id, "name": row[0] if row else name}


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
    if assessment_type not in ("product", "service"):
        raise HTTPException(status_code=400, detail="assessment_type must be 'product' or 'service'")

    if assessment_type == "service":
        # Scope 3 category selection is a service-specific concept -- lifecycle
        # boundary (cradle-to-gate/-grave) is a product-only notion, so it's
        # not used to default included_modules here. No sensible "all 15
        # apply" default either -- an empty list prompts the user to pick the
        # categories relevant to this service in Goal & Scope.
        # lifecycle_boundary is NOT NULL on lca_assessments; "custom" is
        # already a recognized value for "not the standard product boundaries."
        lifecycle_boundary = str(body.get("lifecycle_boundary") or "custom").strip()
        included_modules = body.get("included_modules")
        if not isinstance(included_modules, list):
            included_modules = []
    else:
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
                    str(body.get("standard") or ("GHG Protocol Scope 3 Standard" if assessment_type == "service" else "ISO 14067")).strip(),
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

_bom_nan_artifacts_repaired = False


def _repair_bom_nan_artifacts(con) -> None:
    """One-time cleanup for rows written before the getv() NaN-passthrough
    fix above: a blank BOM cell stored the literal NaN/"nan" value instead of
    falling through to the intended default. Repairs the damage in place --
    factor_value NaN -> 0 (unmapped, same as a properly-blank cell would
    have produced), factor_unit/unit/origin_country 'nan' text -> the normal
    default, and repoints any line item that landed on a bogus "nan"
    material category back to uncategorized before deleting that category."""
    global _bom_nan_artifacts_repaired
    if _bom_nan_artifacts_repaired:
        return
    con.execute("UPDATE lca_line_items SET factor_value = 0 WHERE factor_value = 'NaN'::float8")
    con.execute("UPDATE lca_line_items SET factor_unit = 'kgCO2e/kg' WHERE lower(trim(factor_unit)) = 'nan'")
    con.execute("UPDATE lca_line_items SET unit = 'kg' WHERE lower(trim(unit)) = 'nan'")
    con.execute("UPDATE lca_line_items SET origin_country = NULL WHERE lower(trim(origin_country)) = 'nan'")
    bogus_category = con.execute(
        "SELECT category_id FROM lca_material_categories_lookup WHERE lower(trim(name)) = 'nan'"
    ).fetchone()
    if bogus_category:
        cat_id = int(bogus_category[0])
        for table in ("lca_components", "lca_line_items", "lca_scenario_multipliers", "lca_component_children"):
            con.execute(f"UPDATE {table} SET material_category_id = NULL WHERE material_category_id = %s", [cat_id])
        con.execute("DELETE FROM lca_material_categories_lookup WHERE category_id = %s", [cat_id])
    _bom_nan_artifacts_repaired = True


@router.get("/jobs/{job_id}/lca/assessments/{assessment_id}/line-items")
def list_line_items(job_id: int, assessment_id: int, _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.view")
    assert_job_access(_user, int(job_id))
    try:
        with get_conn() as con:
            if not _assessment_row(con, int(job_id), int(assessment_id)):
                raise HTTPException(status_code=404, detail="LCA assessment not found")
            _repair_bom_nan_artifacts(con)
            df = con.execute(
                "SELECT * FROM lca_line_items WHERE assessment_id = %s ORDER BY module_code, line_item_id",
                [int(assessment_id)],
            ).df()
            items: list[dict[str, Any]] = []
            if df is not None and not df.empty:
                # astype(object) first -- otherwise .where() is a no-op on any
                # column pandas inferred as float64 (which happens whenever
                # every row's value for that column is NULL, common for
                # optional text fields like transport_mode/notes right after a
                # bulk BOM import), leaving NaN instead of None and blowing up
                # JSON serialization downstream ("Out of range float values
                # are not JSON compliant: nan").
                df = df.astype(object).where(df.notna(), None)
                for _, r in df.iterrows():
                    items.append(
                        {
                            "line_item_id": int(r.get("line_item_id")),
                            "component_id": _int_or_none(r.get("component_id")),
                            "activity_id": _int_or_none(r.get("activity_id")),
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
                            "factor_match_confidence": _float_or_none(r.get("factor_match_confidence")),
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


def _fill_from_activity(con, body: dict[str, Any]) -> dict[str, Any]:
    """If an activity_id is supplied, use it to default line_label/module_code
    (Scope 3 category)/quantity/unit unless the caller explicitly overrides
    those fields. Service-assessment equivalent of _fill_from_component."""
    activity_id = body.get("activity_id")
    if activity_id in (None, ""):
        return body
    row = con.execute(
        """
        SELECT description, default_module_code, default_quantity, default_unit
        FROM lca_activities WHERE activity_id = %s
        """,
        [int(activity_id)],
    ).fetchone()
    if not row:
        raise HTTPException(status_code=400, detail="activity_id does not exist")
    filled = dict(body)
    filled.setdefault("line_label", row[0])
    if row[1] and (not str(filled.get("module_code") or "").strip()):
        filled["module_code"] = row[1]
    if "quantity" not in filled or filled.get("quantity") in (None, ""):
        filled["quantity"] = row[2]
    if "unit" not in filled or filled.get("unit") in (None, ""):
        filled["unit"] = row[3]
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
            body = _fill_from_activity(con, body)
            module_code = str(body.get("module_code") or "").strip().upper()
            if module_code not in valid_modules:
                raise HTTPException(status_code=400, detail=f"Invalid module_code: {module_code}")
            line_label = str(body.get("line_label") or "").strip()
            if not line_label:
                raise HTTPException(status_code=400, detail="line_label is required")

            row = con.execute(
                """
                INSERT INTO lca_line_items (
                  assessment_id, component_id, activity_id, module_code, line_label, material_category_id, quantity, unit,
                  origin_country, transport_mode, distance_km, energy_kwh, end_of_life_route,
                  mapped_factor_source, mapped_factor_id, factor_value, factor_unit,
                  factor_source_label, factor_source_url, data_quality, is_gap_filled, gap_fill_method,
                  is_placeholder, notes, created_by, updated_by
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING line_item_id
                """,
                [
                    int(assessment_id),
                    int(body.get("component_id")) if str(body.get("component_id") or "").strip().isdigit() else None,
                    int(body.get("activity_id")) if str(body.get("activity_id") or "").strip().isdigit() else None,
                    module_code, line_label,
                    int(body.get("material_category_id")) if str(body.get("material_category_id") or "").strip().isdigit() else None,
                    safe_float(body.get("quantity")), str(body.get("unit") or "kg").strip(),
                    str(body.get("origin_country") or "").strip() or None,
                    str(body.get("transport_mode") or "").strip() or None,
                    safe_float(body.get("distance_km")) if body.get("distance_km") not in (None, "") else None,
                    safe_float(body.get("energy_kwh")) if body.get("energy_kwh") not in (None, "") else None,
                    str(body.get("end_of_life_route") or "").strip() or None,
                    # Only default mapped_factor_source to "manual" when a real
                    # factor_value was actually supplied -- `body.get(...) or
                    # "manual"` previously defaulted to "manual" even when the
                    # caller explicitly sent null/omitted the field, silently
                    # mislabeling zero-factor (i.e. genuinely unmapped) lines
                    # as manually-verified and inflating the readiness score's
                    # factor-confidence check (mirrors the BOM-upload endpoint's
                    # already-correct "manual" if explicit_factor > 0 else None).
                    (str(body.get("mapped_factor_source")).strip() if body.get("mapped_factor_source")
                     else ("manual" if safe_float(body.get("factor_value")) > 0 else None)),
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
            int_fields = {"component_id", "activity_id", "material_category_id", "mapped_factor_id"}
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


@router.get("/jobs/{job_id}/lca/line-items/{line_item_id}/factor-search")
def search_lca_line_item_factors(
    job_id: int,
    line_item_id: int,
    q: str = Query("", min_length=0),
    limit: int = Query(20, ge=1, le=50),
    _user: dict[str, str] = Depends(_current_user),
):
    """Free-text factor lookup for the "search for a factor" box on a line
    item, for when the auto-match candidates (word-similarity against the
    line's own label) are all wrong -- e.g. "EVOH" won't textually match
    "Plastic" factors even though that's the right category. Unlike
    map-factor's candidates, this isn't ranked by similarity to the line
    label at all -- it's a plain keyword search the user drives themselves."""
    assert_permission(_user, "jobs.view")
    assert_job_access(_user, int(job_id))
    with get_conn() as con:
        assessment_id = _line_item_assessment(con, int(job_id), int(line_item_id))
        dataset_ids = _resolve_dataset_ids(con, int(job_id), assessment_id)
        where = ["COALESCE(fl.factor, 0) > 0"]
        params: list[Any] = []
        selected = sorted({int(x) for x in (dataset_ids or []) if int(x) > 0})
        if selected:
            ph = ",".join(["%s"] * len(selected))
            where.append(f"fl.dataset_id IN ({ph})")
            params.extend(selected)
        q_clean = q.strip()
        if q_clean:
            where.append(
                "(COALESCE(fl.report_label,'') ILIKE %s OR COALESCE(fl.column_text,'') ILIKE %s "
                "OR COALESCE(fl.level_1,'') ILIKE %s OR COALESCE(fl.level_2,'') ILIKE %s)"
            )
            pat = f"%{q_clean}%"
            params.extend([pat, pat, pat, pat])
        df = con.execute(
            f"""
            SELECT DISTINCT ON (COALESCE(fl.report_label, fl.column_text))
                   fl.db_id, fl.report_label, fl.column_text, fl.uom, fl.factor, fl.source, fl.region, fl.dataset_id
            FROM v_factor_lookup fl
            WHERE {' AND '.join(where)}
            ORDER BY COALESCE(fl.report_label, fl.column_text), fl.dataset_id DESC
            LIMIT %s
            """,
            [*params, int(limit)],
        ).df()
        items: list[dict[str, Any]] = []
        if df is not None and not df.empty:
            df = df.astype(object).where(df.notna(), None)
            for _, r in df.iterrows():
                items.append(
                    {
                        "db_id": int(r.get("db_id")),
                        "label": str(r.get("report_label") or r.get("column_text") or f"Factor {r.get('db_id')}"),
                        "uom": r.get("uom"),
                        "factor": safe_float(r.get("factor")),
                        "source": r.get("source"),
                        "region": r.get("region"),
                    }
                )
    return {"items": items, "dataset_ids_used": dataset_ids}


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
            top_confidence = safe_float(candidates[0]["confidence"]) if candidates else None

            forced_factor_id = body.get("factor_db_id")
            applied = None
            auto_applied = False
            if forced_factor_id:
                # Explicit user pick -- applies regardless of confidence (the
                # "human confirms" escape hatch for below-threshold matches).
                chosen = next((c for c in candidates if c["db_id"] == int(forced_factor_id)), None) or _lookup_factor_by_id(con, int(forced_factor_id))
                if not chosen:
                    raise HTTPException(status_code=404, detail="Selected factor not found")
                con.execute(
                    """
                    UPDATE lca_line_items
                    SET mapped_factor_source = 'factor_lookup', mapped_factor_id = %s, factor_value = %s,
                        factor_unit = %s, factor_source_label = %s, factor_source_url = NULL,
                        factor_match_confidence = %s, is_gap_filled = FALSE, gap_fill_method = NULL,
                        updated_at = NOW(), updated_by = %s
                    WHERE line_item_id = %s
                    """,
                    [int(chosen["db_id"]), safe_float(chosen["factor"]), str(chosen.get("uom") or "kgCO2e/kg"),
                     str(chosen.get("source") or "factor_lookup"), chosen.get("confidence"), _actor(_user), int(line_item_id)],
                )
                applied = chosen
            else:
                apply_top = bool(body.get("apply_top_match", True))
                if candidates and apply_top and top_confidence is not None and top_confidence >= CONFIDENCE_THRESHOLD:
                    top = candidates[0]
                    con.execute(
                        """
                        UPDATE lca_line_items
                        SET mapped_factor_source = 'factor_lookup', mapped_factor_id = %s, factor_value = %s,
                            factor_unit = %s, factor_source_label = %s, factor_source_url = NULL,
                            factor_match_confidence = %s, is_gap_filled = FALSE, gap_fill_method = NULL,
                            updated_at = NOW(), updated_by = %s
                        WHERE line_item_id = %s
                        """,
                        [int(top["db_id"]), safe_float(top["factor"]), str(top.get("uom") or "kgCO2e/kg"),
                         str(top.get("source") or "factor_lookup"), top["confidence"], _actor(_user), int(line_item_id)],
                    )
                    applied = top
                    auto_applied = True
                else:
                    # Not confident enough to auto-apply -- still record the best
                    # candidate's confidence so the UI/readiness score can flag
                    # this line as needing manual review.
                    con.execute(
                        "UPDATE lca_line_items SET factor_match_confidence = %s, updated_at = NOW(), updated_by = %s WHERE line_item_id = %s",
                        [top_confidence, _actor(_user), int(line_item_id)],
                    )
            summary = _recalculate_assessment(con, assessment_id, _user)
            return {
                "ok": True, "applied": applied, "auto_applied": auto_applied, "candidates": candidates,
                "confidence_threshold": CONFIDENCE_THRESHOLD, "summary": summary, "dataset_ids_used": dataset_ids,
            }
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


def _build_lca_report_payload(con, job_id: int, assessment_id: int, user: dict[str, str]) -> dict[str, Any] | None:
    """Assemble the full report payload for one assessment: goal/scope, inventory,
    impact (module/category breakdown), mass reconciliation, hotspots, readiness
    (Phase 2), and data-quality stats. Shared by the JSON report endpoint below
    and the PDF/HTML report renderer in api/lca_report_routes.py."""
    assessment = _assessment_row(con, int(job_id), int(assessment_id))
    if not assessment:
        return None
    summary = _recalculate_assessment(con, int(assessment_id), user)
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
            "assessment_type": assessment["assessment_type"],
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
        "readiness": summary["readiness"],
        "data_quality": {
            "gap_filled_rows": gap_count,
            "primary_data_rows": sum(1 for ln in real_lines if str(ln.get("data_quality") or "").lower() == "primary"),
            "secondary_data_rows": sum(1 for ln in real_lines if str(ln.get("data_quality") or "").lower() != "primary"),
            "gap_filled_pct": round((gap_count / total_rows * 100.0) if total_rows else 0.0, 2),
        },
    }


@router.get("/jobs/{job_id}/lca/assessments/{assessment_id}/report")
def assessment_report(job_id: int, assessment_id: int, _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.view")
    assert_job_access(_user, int(job_id))
    try:
        with get_conn(autocommit=False) as con:
            payload = _build_lca_report_payload(con, int(job_id), int(assessment_id), _user)
            if not payload:
                raise HTTPException(status_code=404, detail="LCA assessment not found")
            return payload
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


@router.get("/jobs/{job_id}/lca/assessments/{assessment_id}/bom-template")
def download_bom_template(
    job_id: int,
    assessment_id: int,
    _user: dict[str, str] = Depends(_current_user),
):
    assert_job_access(_user, int(job_id))
    result = generate_lca_bom_template(int(job_id), int(assessment_id))
    if result is None:
        raise HTTPException(status_code=404, detail="LCA assessment not found")
    content, file_name = result
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{file_name}"',
            "X-Filename": file_name,
        },
    )


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
        try:
            scan_bytes(raw, filename=file.filename)
        except VirusScanError as e:
            raise HTTPException(status_code=400, detail=str(e))
        is_csv = filename.endswith(".csv")
        is_excel = filename.endswith((".xlsx", ".xlsm", ".xls"))
        if not is_csv and not is_excel:
            raise HTTPException(status_code=400, detail="Unsupported file type. Use CSV or XLSX.")
        probe_df = pd.read_csv(io.BytesIO(raw), header=None) if is_csv else pd.read_excel(io.BytesIO(raw), header=None)
        if probe_df is None or probe_df.empty:
            raise HTTPException(status_code=400, detail="No rows found in BOM file")
        header_row = _detect_bom_header_row(probe_df)
        df = pd.read_csv(io.BytesIO(raw), header=header_row) if is_csv else pd.read_excel(io.BytesIO(raw), header=header_row)
        if df is None or df.empty:
            raise HTTPException(status_code=400, detail="No rows found in BOM file")

        norm_map = {_normalize_col(c): c for c in df.columns}

        def getv(row: Any, names: list[str], default: Any = None) -> Any:
            for name in names:
                original = norm_map.get(_normalize_col(name))
                if original is not None:
                    val = row.get(original)
                    # A blank Excel/CSV cell comes back as pandas' float NaN,
                    # not None -- str(nan).strip() is the non-empty string
                    # "nan", so without this check a blank cell would "win"
                    # over the default and store the literal NaN/"nan" value
                    # instead of falling through (e.g. an intentionally blank
                    # factor_unit cell stored the 3-char string "nan").
                    if val is not None and not pd.isna(val) and str(val).strip() != "":
                        return val
            return default

        inserted = mapped = gap_filled = needs_review = skipped = components_created = 0

        with get_conn(autocommit=False) as con:
            if not _assessment_row(con, int(job_id), int(assessment_id)):
                raise HTTPException(status_code=404, detail="LCA assessment not found")
            client_db_id = _job_client_id(con, int(job_id))
            valid_modules = _valid_module_codes(con)
            dataset_ids = _resolve_dataset_ids(con, int(job_id), int(assessment_id))
            ensure_material_categories_deduped(con)
            category_cache: dict[str, int | None] = {}

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
                category_raw = str(getv(row, ["material_category", "material_category_name", "category", "category_name"], "") or "").strip()
                material_category_id = None
                if category_raw:
                    cache_key = category_raw.lower()
                    if cache_key not in category_cache:
                        category_cache[cache_key] = resolve_or_create_material_category(con, category_raw)
                    material_category_id = category_cache[cache_key]
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
                      assessment_id, component_id, module_code, line_label, material_category_id, quantity, unit, origin_country,
                      mapped_factor_source, factor_value, factor_unit, data_quality, is_placeholder, created_by, updated_by
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING line_item_id
                    """,
                    [
                        int(assessment_id), component_id, module_code, line_label, material_category_id, qty, unit or "kg",
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
                top_confidence = safe_float(candidates[0]["confidence"]) if candidates else None
                if candidates and top_confidence is not None and top_confidence >= CONFIDENCE_THRESHOLD:
                    top = candidates[0]
                    con.execute(
                        """
                        UPDATE lca_line_items
                        SET mapped_factor_source = 'factor_lookup', mapped_factor_id = %s, factor_value = %s,
                            factor_unit = %s, factor_source_label = %s, factor_match_confidence = %s,
                            is_gap_filled = FALSE, updated_at = NOW(), updated_by = %s
                        WHERE line_item_id = %s
                        """,
                        [int(top["db_id"]), safe_float(top["factor"]), str(top.get("uom") or "kgCO2e/kg"),
                         str(top.get("source") or "factor_lookup"), top["confidence"], _actor(_user), line_item_id],
                    )
                    mapped += 1
                elif candidates:
                    # A candidate exists but isn't confident enough to auto-apply --
                    # leave unmapped for manual review rather than risk a wrong match.
                    con.execute(
                        "UPDATE lca_line_items SET factor_match_confidence = %s, updated_at = NOW(), updated_by = %s WHERE line_item_id = %s",
                        [top_confidence, _actor(_user), line_item_id],
                    )
                    needs_review += 1
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
                    else:
                        needs_review += 1

            summary = _recalculate_assessment(con, int(assessment_id), _user)

        return {
            "ok": True, "rows_total": int(len(df.index)), "inserted": inserted, "mapped": mapped,
            "gap_filled": gap_filled, "needs_review": needs_review, "skipped": skipped,
            "components_created": components_created, "dataset_ids_used": dataset_ids, "summary": summary,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to import BOM file: {e}")


# ---------------------------------------------------------------------
# Phase 3: scenario / what-if multiplier engine
# ---------------------------------------------------------------------


def _scenario_row(con, job_id: int, scenario_id: int) -> dict[str, Any] | None:
    row = con.execute(
        """
        SELECT s.scenario_id, s.assessment_id, s.name, s.description, s.is_baseline
        FROM lca_scenarios s
        JOIN lca_assessments a ON a.assessment_id = s.assessment_id
        WHERE s.scenario_id = %s AND a.job_id = %s
        """,
        [int(scenario_id), int(job_id)],
    ).fetchone()
    if not row:
        return None
    return {
        "scenario_id": int(row[0]),
        "assessment_id": int(row[1]),
        "name": row[2],
        "description": row[3],
        "is_baseline": bool(row[4]),
    }


def _load_scenario_multiplier_rules(con, scenario_id: int) -> list[dict[str, Any]]:
    df = con.execute(
        "SELECT module_code, material_category_id, component_id, activity_id, multiplier FROM lca_scenario_multipliers WHERE scenario_id = %s",
        [int(scenario_id)],
    ).df()
    rules: list[dict[str, Any]] = []
    if df is not None and not df.empty:
        for _, r in df.iterrows():
            rules.append(
                {
                    "module_code": r.get("module_code"),
                    "material_category_id": _int_or_none(r.get("material_category_id")),
                    "component_id": _int_or_none(r.get("component_id")),
                    "activity_id": _int_or_none(r.get("activity_id")),
                    "multiplier": safe_float(r.get("multiplier"), 1.0),
                }
            )
    return rules


@router.get("/jobs/{job_id}/lca/assessments/{assessment_id}/scenarios")
def list_scenarios(job_id: int, assessment_id: int, _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.view")
    assert_job_access(_user, int(job_id))
    try:
        with get_conn() as con:
            if not _assessment_row(con, int(job_id), int(assessment_id)):
                raise HTTPException(status_code=404, detail="LCA assessment not found")
            df = con.execute(
                "SELECT scenario_id, name, description, is_baseline, created_at FROM lca_scenarios WHERE assessment_id = %s ORDER BY is_baseline DESC, scenario_id",
                [int(assessment_id)],
            ).df()
            items: list[dict[str, Any]] = []
            if df is not None and not df.empty:
                for _, r in df.iterrows():
                    items.append(
                        {
                            "scenario_id": int(r.get("scenario_id")),
                            "name": r.get("name"),
                            "description": r.get("description"),
                            "is_baseline": bool(r.get("is_baseline")),
                            "created_at": str(r.get("created_at")) if r.get("created_at") else None,
                        }
                    )
            return {"assessment_id": int(assessment_id), "items": items}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list scenarios: {e}")


@router.post("/jobs/{job_id}/lca/assessments/{assessment_id}/scenarios")
def create_scenario(job_id: int, assessment_id: int, body: dict = Body(...), _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.edit")
    assert_job_access(_user, int(job_id))
    name = str(body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    try:
        with get_conn(autocommit=False) as con:
            if not _assessment_row(con, int(job_id), int(assessment_id)):
                raise HTTPException(status_code=404, detail="LCA assessment not found")
            row = con.execute(
                """
                INSERT INTO lca_scenarios (assessment_id, name, description, is_baseline, created_by)
                VALUES (%s, %s, %s, FALSE, %s) RETURNING scenario_id
                """,
                [int(assessment_id), name, str(body.get("description") or "").strip() or None, _actor(_user)],
            ).fetchone()
            return {"ok": True, "scenario_id": int(row[0])}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create scenario: {e}")


@router.patch("/jobs/{job_id}/lca/scenarios/{scenario_id}")
def update_scenario(job_id: int, scenario_id: int, body: dict = Body(...), _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.edit")
    assert_job_access(_user, int(job_id))
    try:
        with get_conn(autocommit=False) as con:
            scenario = _scenario_row(con, int(job_id), int(scenario_id))
            if not scenario:
                raise HTTPException(status_code=404, detail="Scenario not found")
            updates: list[str] = []
            params: list[Any] = []
            if "name" in body:
                name = str(body.get("name") or "").strip()
                if not name:
                    raise HTTPException(status_code=400, detail="name cannot be empty")
                updates.append("name = %s")
                params.append(name)
            if "description" in body:
                updates.append("description = %s")
                params.append(str(body.get("description") or "").strip() or None)
            if not updates:
                return {"ok": True}
            params.append(int(scenario_id))
            con.execute(f"UPDATE lca_scenarios SET {', '.join(updates)} WHERE scenario_id = %s", params)
            return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update scenario: {e}")


@router.delete("/jobs/{job_id}/lca/scenarios/{scenario_id}")
def delete_scenario(job_id: int, scenario_id: int, _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.edit")
    assert_job_access(_user, int(job_id))
    try:
        with get_conn(autocommit=False) as con:
            scenario = _scenario_row(con, int(job_id), int(scenario_id))
            if not scenario:
                raise HTTPException(status_code=404, detail="Scenario not found")
            if scenario["is_baseline"]:
                raise HTTPException(status_code=400, detail="Cannot delete the baseline scenario")
            con.execute("DELETE FROM lca_scenarios WHERE scenario_id = %s", [int(scenario_id)])
            return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete scenario: {e}")


@router.get("/jobs/{job_id}/lca/scenarios/{scenario_id}/multipliers")
def list_multipliers(job_id: int, scenario_id: int, _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.view")
    assert_job_access(_user, int(job_id))
    try:
        with get_conn() as con:
            if not _scenario_row(con, int(job_id), int(scenario_id)):
                raise HTTPException(status_code=404, detail="Scenario not found")
            multiplier_ids_df = con.execute(
                "SELECT multiplier_id, module_code, material_category_id, component_id, activity_id, multiplier FROM lca_scenario_multipliers WHERE scenario_id = %s ORDER BY multiplier_id",
                [int(scenario_id)],
            ).df()
            items: list[dict[str, Any]] = []
            if multiplier_ids_df is not None and not multiplier_ids_df.empty:
                for _, r in multiplier_ids_df.iterrows():
                    items.append(
                        {
                            "multiplier_id": int(r.get("multiplier_id")),
                            "module_code": r.get("module_code"),
                            "material_category_id": _int_or_none(r.get("material_category_id")),
                            "component_id": _int_or_none(r.get("component_id")),
                            "activity_id": _int_or_none(r.get("activity_id")),
                            "multiplier": safe_float(r.get("multiplier"), 1.0),
                        }
                    )
            return {"scenario_id": int(scenario_id), "items": items}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list multipliers: {e}")


@router.post("/jobs/{job_id}/lca/scenarios/{scenario_id}/multipliers")
def create_multiplier(job_id: int, scenario_id: int, body: dict = Body(...), _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.edit")
    assert_job_access(_user, int(job_id))
    module_code = str(body.get("module_code") or "").strip().upper()
    if not module_code:
        raise HTTPException(status_code=400, detail="module_code is required")
    try:
        with get_conn(autocommit=False) as con:
            scenario = _scenario_row(con, int(job_id), int(scenario_id))
            if not scenario:
                raise HTTPException(status_code=404, detail="Scenario not found")
            if scenario["is_baseline"]:
                raise HTTPException(status_code=400, detail="Cannot add multiplier rules to the baseline scenario")
            if module_code not in _valid_module_codes(con):
                raise HTTPException(status_code=400, detail=f"Unknown module_code: {module_code}")
            category_raw = str(body.get("material_category_id") or "").strip()
            component_raw = str(body.get("component_id") or "").strip()
            activity_raw = str(body.get("activity_id") or "").strip()
            row = con.execute(
                """
                INSERT INTO lca_scenario_multipliers (scenario_id, module_code, material_category_id, component_id, activity_id, multiplier)
                VALUES (%s, %s, %s, %s, %s, %s) RETURNING multiplier_id
                """,
                [
                    int(scenario_id), module_code,
                    int(category_raw) if category_raw.isdigit() else None,
                    int(component_raw) if component_raw.isdigit() else None,
                    int(activity_raw) if activity_raw.isdigit() else None,
                    safe_float(body.get("multiplier"), 1.0),
                ],
            ).fetchone()
            return {"ok": True, "multiplier_id": int(row[0])}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create multiplier: {e}")


def _multiplier_scenario(con, job_id: int, multiplier_id: int) -> dict[str, Any] | None:
    row = con.execute(
        """
        SELECT m.multiplier_id, s.is_baseline
        FROM lca_scenario_multipliers m
        JOIN lca_scenarios s ON s.scenario_id = m.scenario_id
        JOIN lca_assessments a ON a.assessment_id = s.assessment_id
        WHERE m.multiplier_id = %s AND a.job_id = %s
        """,
        [int(multiplier_id), int(job_id)],
    ).fetchone()
    if not row:
        return None
    return {"multiplier_id": int(row[0]), "is_baseline": bool(row[1])}


@router.patch("/jobs/{job_id}/lca/multipliers/{multiplier_id}")
def update_multiplier(job_id: int, multiplier_id: int, body: dict = Body(...), _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.edit")
    assert_job_access(_user, int(job_id))
    try:
        with get_conn(autocommit=False) as con:
            existing = _multiplier_scenario(con, int(job_id), int(multiplier_id))
            if not existing:
                raise HTTPException(status_code=404, detail="Multiplier rule not found")
            if existing["is_baseline"]:
                raise HTTPException(status_code=400, detail="Cannot edit multiplier rules on the baseline scenario")
            updates: list[str] = []
            params: list[Any] = []
            if "module_code" in body:
                module_code = str(body.get("module_code") or "").strip().upper()
                if module_code not in _valid_module_codes(con):
                    raise HTTPException(status_code=400, detail=f"Unknown module_code: {module_code}")
                updates.append("module_code = %s")
                params.append(module_code)
            if "material_category_id" in body:
                raw = str(body.get("material_category_id") or "").strip()
                updates.append("material_category_id = %s")
                params.append(int(raw) if raw.isdigit() else None)
            if "component_id" in body:
                raw = str(body.get("component_id") or "").strip()
                updates.append("component_id = %s")
                params.append(int(raw) if raw.isdigit() else None)
            if "activity_id" in body:
                raw = str(body.get("activity_id") or "").strip()
                updates.append("activity_id = %s")
                params.append(int(raw) if raw.isdigit() else None)
            if "multiplier" in body:
                updates.append("multiplier = %s")
                params.append(safe_float(body.get("multiplier"), 1.0))
            if not updates:
                return {"ok": True}
            params.append(int(multiplier_id))
            con.execute(f"UPDATE lca_scenario_multipliers SET {', '.join(updates)} WHERE multiplier_id = %s", params)
            return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update multiplier: {e}")


@router.delete("/jobs/{job_id}/lca/multipliers/{multiplier_id}")
def delete_multiplier(job_id: int, multiplier_id: int, _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.edit")
    assert_job_access(_user, int(job_id))
    try:
        with get_conn(autocommit=False) as con:
            existing = _multiplier_scenario(con, int(job_id), int(multiplier_id))
            if not existing:
                raise HTTPException(status_code=404, detail="Multiplier rule not found")
            con.execute("DELETE FROM lca_scenario_multipliers WHERE multiplier_id = %s", [int(multiplier_id)])
            return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete multiplier: {e}")


@router.get("/jobs/{job_id}/lca/assessments/{assessment_id}/scenario-comparison")
def scenario_comparison(job_id: int, assessment_id: int, _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.view")
    assert_job_access(_user, int(job_id))
    try:
        with get_conn(autocommit=False) as con:
            assessment = _assessment_row(con, int(job_id), int(assessment_id))
            if not assessment:
                raise HTTPException(status_code=404, detail="LCA assessment not found")
            ensure_lca_hierarchy_schema(con)
            lines = resolve_effective_lines(con, _load_line_items_for_calc(con, int(assessment_id)))
            confirmed_quantity = assessment["confirmed_quantity"]
            confirmed_unit = assessment["confirmed_quantity_unit"]

            scenarios_df = con.execute(
                "SELECT scenario_id, name, is_baseline FROM lca_scenarios WHERE assessment_id = %s ORDER BY is_baseline DESC, scenario_id",
                [int(assessment_id)],
            ).df()

            results: list[dict[str, Any]] = []
            baseline_total: float | None = None
            mass_reconciliation: dict[str, Any] | None = None
            if scenarios_df is not None and not scenarios_df.empty:
                for _, srow in scenarios_df.iterrows():
                    scenario_id = int(srow.get("scenario_id"))
                    is_baseline = bool(srow.get("is_baseline"))
                    scenario_lines = lines if is_baseline else apply_scenario_multipliers(
                        lines, _load_scenario_multiplier_rules(con, scenario_id)
                    )
                    summary = summarize_assessment(scenario_lines, confirmed_quantity, confirmed_unit, assessment_type=str(assessment.get("assessment_type") or "product"))
                    con.execute(
                        """
                        INSERT INTO lca_result_snapshots (
                          assessment_id, scenario_id, calculated_by, total_tco2e, module_breakdown, hotspots, mass_reconciliation, notes
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        [
                            int(assessment_id), scenario_id, _actor(_user), summary["total_tco2e"],
                            json.dumps(summary["module_breakdown"]), json.dumps(summary["hotspots"]),
                            json.dumps(summary["mass_reconciliation"]), "Scenario comparison",
                        ],
                    )
                    if is_baseline:
                        baseline_total = summary["total_tco2e"]
                        mass_reconciliation = summary["mass_reconciliation"]
                    results.append(
                        {
                            "scenario_id": scenario_id,
                            "name": srow.get("name"),
                            "is_baseline": is_baseline,
                            "total_tco2e": summary["total_tco2e"],
                            "module_breakdown": summary["module_breakdown"],
                        }
                    )

            for r in results:
                if baseline_total:
                    r["delta_vs_baseline_tco2e"] = round(r["total_tco2e"] - baseline_total, 6)
                    r["delta_vs_baseline_pct"] = round((r["total_tco2e"] - baseline_total) / baseline_total * 100.0, 2)
                else:
                    r["delta_vs_baseline_tco2e"] = None
                    r["delta_vs_baseline_pct"] = None

            return {
                "assessment_id": int(assessment_id),
                "scenarios": results,
                "mass_reconciliation": mass_reconciliation or {},
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to compare scenarios: {e}")
