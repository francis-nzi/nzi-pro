"""
API routes for job data output and emissions breakdown.
Provides hierarchical view of emissions data by Scope > Categories > Sites.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from core.database import get_conn
from api.auth import _current_user
from services.monthly_emissions import JobMonthlyEmissionsResolver
from services.emissions_reporting import combined_row_metrics
from typing import Any

router = APIRouter()

_SCOPE_SORT = {"Scope 1": 1, "Scope 2": 2, "Scope 3": 3}


def _column_exists(con, table_name: str, column_name: str) -> bool:
    row = con.execute(
        """
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = CURRENT_SCHEMA()
              AND table_name = %s
              AND column_name = %s
        )
        """,
        [table_name, column_name],
    ).fetchone()
    return bool(row and row[0])


def _scope_sort_key(scope_name: str | None) -> tuple[int, str]:
    name = str(scope_name or "").strip()
    return (_SCOPE_SORT.get(name, 99), name)


def _clean_label(value, fallback: str) -> str:
    txt = str(value or "").strip()
    if not txt:
        return fallback
    if txt.lower() in {"nan", "none", "null"}:
        return fallback
    return txt


def _is_placeholder_category(value) -> bool:
    txt = str(value or "").strip().lower()
    return not txt or txt in {"nan", "none", "null", "uncategorized", "uncategorised"}


def _dataset_category_label(row, fallback: str = "Uncategorized") -> str:
    for value in (
        row.get("dataset_category"),
        row.get("lookup_category"),
        row.get("category"),
        row.get("lookup_level_1"),
        row.get("lookup_level_2"),
        row.get("level_1"),
        row.get("level_2"),
    ):
        if _is_placeholder_category(value):
            continue
        return _clean_label(value, fallback)
    return fallback


def _factor_category_expr(con) -> str:
    return "fl.category" if _column_exists(con, "factor_lookup", "category") else "NULL::text"


def _safe_text(value: Any) -> str | None:
    if value is None:
        return None
    try:
        if value != value:  # NaN check without importing math
            return None
    except Exception:
        pass
    txt = str(value).strip()
    if not txt or txt.lower() in {"nan", "none", "null"}:
        return None
    return txt


def _calc_emissions_tco2e(
    qty: float | None,
    factor: float | None,
    apply_pct: float | None,
    ghg_unit: str | None,
) -> float:
    qty_val = float(qty or 0)
    factor_val = float(factor or 0)
    apply_pct_val = float(apply_pct or 100)
    emissions = qty_val * factor_val * (apply_pct_val / 100.0)
    if "kg" in str(ghg_unit or "kgCO2e").lower():
        emissions = emissions / 1000.0
    return float(emissions)


def _load_data_output_rows(con, job_id: int):
    factor_category_expr = _factor_category_expr(con)
    df = con.execute(
        f"""
        WITH legacy_rows AS (
            SELECT
                jsr.row_id AS row_id,
                jsr.scope,
                jsr.level_1,
                CASE
                    WHEN COALESCE(TRIM(CAST({factor_category_expr} AS VARCHAR)), '') = ''
                        OR LOWER(TRIM(CAST({factor_category_expr} AS VARCHAR))) IN ('nan', 'none', 'null')
                    THEN COALESCE(NULLIF(TRIM(CAST(jsr.category AS VARCHAR)), ''), NULLIF(TRIM(CAST(jsr.level_2 AS VARCHAR)), ''), 'Uncategorized'::text)
                    ELSE TRIM(CAST({factor_category_expr} AS VARCHAR))
                END AS category,
                COALESCE(s.site_name, 'No Site Assigned'::text) AS site_name,
                jsr.level_3,
                jsr.level_4,
                COALESCE(jsr.column_text, jsr.report_label) AS activity_name,
                jsr.dataset_id,
                jsr.factor_db_id,
                jsr.original_id,
                jsr.qty,
                jsr.uom,
                jsr.factor,
                jsr.ghg_unit,
                jsr.apply_pct,
                jsr.notes,
                NULL::numeric AS source_qty,
                NULL::text AS source_uom,
                jsr.is_custom_entry,
                jsr.month_1, jsr.month_2, jsr.month_3, jsr.month_4,
                jsr.month_5, jsr.month_6, jsr.month_7, jsr.month_8,
                jsr.month_9, jsr.month_10, jsr.month_11, jsr.month_12,
                'legacy'::text AS record_type,
                COALESCE(jsr.data_source, 'Company Data') AS data_source,
                COALESCE(jsr.data_confidence, 'M') AS data_confidence,
                d.name AS dataset_name,
                d.version AS dataset_version,
                NULLIF(TRIM(CAST({factor_category_expr} AS VARCHAR)), '') AS lookup_category,
                fl.level_1 AS lookup_level_1,
                NULL::text AS source_type,
                NULL::text AS source_subtype,
                NULL::text AS group_name,
                NULL::text AS asset_identifier,
                NULL::text AS employee_name,
                COALESCE(
                    NULLIF(jsr.report_label, ''),
                    CASE
                        WHEN COALESCE(TRIM(CAST({factor_category_expr} AS VARCHAR)), '') = ''
                            OR LOWER(TRIM(CAST({factor_category_expr} AS VARCHAR))) IN ('nan', 'none', 'null')
                        THEN COALESCE(NULLIF(TRIM(CAST(jsr.category AS VARCHAR)), ''), NULLIF(TRIM(CAST(jsr.level_2 AS VARCHAR)), ''), 'Uncategorized')
                        ELSE TRIM(CAST({factor_category_expr} AS VARCHAR))
                    END
                ) AS report_label
            FROM job_scope_rows jsr
            LEFT JOIN client_sites s ON jsr.site_id = s.site_id
            LEFT JOIN datasets d ON d.dataset_id = jsr.dataset_id
            LEFT JOIN factor_lookup fl ON fl.db_id = jsr.factor_db_id
            WHERE jsr.job_id = %s
              AND jsr.enabled = TRUE
        ),
        source_rows AS (
            SELECT
                js.source_id AS row_id,
                js.scope,
                NULL::text AS level_1,
                CASE
                    WHEN COALESCE(TRIM(CAST({factor_category_expr} AS VARCHAR)), '') = ''
                        OR LOWER(TRIM(CAST({factor_category_expr} AS VARCHAR))) IN ('nan', 'none', 'null')
                    THEN COALESCE(NULLIF(TRIM(CAST(js.category AS VARCHAR)), ''), 'Uncategorized'::text)
                    ELSE TRIM(CAST({factor_category_expr} AS VARCHAR))
                END AS category,
                COALESCE(cs.site_name, 'No Site Assigned'::text) AS site_name,
                NULL::text AS level_3,
                NULL::text AS level_4,
                COALESCE(
                    NULLIF(js.source_name, ''),
                    NULLIF(g.group_name, ''),
                    CASE
                        WHEN COALESCE(TRIM(CAST({factor_category_expr} AS VARCHAR)), '') = ''
                            OR LOWER(TRIM(CAST({factor_category_expr} AS VARCHAR))) IN ('nan', 'none', 'null')
                        THEN COALESCE(NULLIF(TRIM(CAST(js.category AS VARCHAR)), ''), 'Uncategorized')
                        ELSE TRIM(CAST({factor_category_expr} AS VARCHAR))
                    END
                ) AS activity_name,
                COALESCE(g.dataset_id, js.dataset_id) AS dataset_id,
                COALESCE(g.factor_db_id, js.factor_db_id) AS factor_db_id,
                COALESCE(g.original_id, js.original_id) AS original_id,
                js.qty,
                COALESCE(g.uom, js.uom) AS uom,
                COALESCE(g.factor, js.factor) AS factor,
                COALESCE(g.ghg_unit, js.ghg_unit) AS ghg_unit,
                js.apply_pct,
                js.notes,
                NULL::numeric AS source_qty,
                NULL::text AS source_uom,
                FALSE AS is_custom_entry,
                NULL::numeric AS month_1, NULL::numeric AS month_2, NULL::numeric AS month_3, NULL::numeric AS month_4,
                NULL::numeric AS month_5, NULL::numeric AS month_6, NULL::numeric AS month_7, NULL::numeric AS month_8,
                NULL::numeric AS month_9, NULL::numeric AS month_10, NULL::numeric AS month_11, NULL::numeric AS month_12,
                'source_register'::text AS record_type,
                COALESCE(js.data_source, CASE WHEN js.source_type = 'business_travel' THEN 'Business Travel Register' ELSE 'Asset Register' END) AS data_source,
                COALESCE(js.data_confidence, 'M') AS data_confidence,
                d.name AS dataset_name,
                d.version AS dataset_version,
                NULLIF(TRIM(CAST({factor_category_expr} AS VARCHAR)), '') AS lookup_category,
                fl.level_1 AS lookup_level_1,
                js.source_type AS source_type,
                js.source_subtype AS source_subtype,
                g.group_name,
                js.asset_identifier,
                js.employee_name,
                COALESCE(
                    NULLIF(js.source_name, ''),
                    NULLIF(g.group_name, ''),
                    CASE
                        WHEN COALESCE(TRIM(CAST({factor_category_expr} AS VARCHAR)), '') = ''
                            OR LOWER(TRIM(CAST({factor_category_expr} AS VARCHAR))) IN ('nan', 'none', 'null')
                        THEN COALESCE(NULLIF(TRIM(CAST(js.category AS VARCHAR)), ''), 'Uncategorized')
                        ELSE TRIM(CAST({factor_category_expr} AS VARCHAR))
                    END
                ) AS report_label
            FROM job_emission_sources js
            LEFT JOIN job_emission_groups g ON g.group_id = js.group_id
            LEFT JOIN client_sites cs ON cs.site_id = js.site_id
            LEFT JOIN datasets d ON d.dataset_id = COALESCE(g.dataset_id, js.dataset_id)
            LEFT JOIN factor_lookup fl ON fl.db_id = COALESCE(g.factor_db_id, js.factor_db_id)
            WHERE js.job_id = %s
              AND COALESCE(js.enabled, TRUE) = TRUE
        )
        SELECT *
        FROM (
            SELECT * FROM legacy_rows
            UNION ALL
            SELECT * FROM source_rows
        ) combined_rows
        ORDER BY COALESCE(site_name, 'No Site Assigned'::text), scope, category, report_label
        """,
        [int(job_id), int(job_id)],
    ).df()
    if not df.empty:
        for col, fallback in (("scope", "Unknown"), ("category", "Uncategorized"), ("site_name", "No Site Assigned")):
            if col in df.columns:
                df[col] = df[col].apply(lambda value: _clean_label(value, fallback))
        df["dataset_category"] = df.apply(lambda row: _dataset_category_label(row), axis=1)
    return df


# Shared by Data Output and report generation so both views use the same rounding rules.
def _build_scope_summary(data_df, resolver) -> tuple[list[dict[str, Any]], dict[str, float]]:
    scopes: dict[str, dict[str, Any]] = {}
    for _, row in data_df.iterrows():
        scope_name = _clean_label(row.get('scope'), 'Unknown')
        category = _dataset_category_label(row)
        site = _clean_label(row.get('site_name'), 'No Site Assigned')
        metrics = combined_row_metrics(row, resolver)
        emission = round(float(metrics.get("calc_tco2e") or 0.0), 2)

        if scope_name not in scopes:
            scopes[scope_name] = {
                "scope_name": scope_name,
                "total_emissions": 0.0,
                "categories": {}
            }

        if category not in scopes[scope_name]["categories"]:
            scopes[scope_name]["categories"][category] = {
                "category_name": category,
                "total_emissions": 0.0,
                "site_emissions": {}
            }

        if site not in scopes[scope_name]["categories"][category]["site_emissions"]:
            scopes[scope_name]["categories"][category]["site_emissions"][site] = {
                "total": 0.0,
                "count": 0
            }

        scopes[scope_name]["total_emissions"] += emission
        scopes[scope_name]["categories"][category]["total_emissions"] += emission
        scopes[scope_name]["categories"][category]["site_emissions"][site]["total"] += emission
        scopes[scope_name]["categories"][category]["site_emissions"][site]["count"] += 1

    scope_list: list[dict[str, Any]] = []
    totals = {"Scope 1": 0.0, "Scope 2": 0.0, "Scope 3": 0.0}
    for scope_name, scope_data in sorted(scopes.items(), key=lambda item: _scope_sort_key(item[0])):
        category_list = []
        for cat_name, cat_data in sorted(
            scope_data["categories"].items(),
            key=lambda item: (-float(item[1]["total_emissions"] or 0.0), str(item[0]).lower()),
        ):
            sites_list = [
                {
                    "site_name": site_name,
                    "total_emissions": round(site_data["total"], 2),
                    "activity_count": site_data["count"]
                }
                for site_name, site_data in sorted(
                    cat_data["site_emissions"].items(),
                    key=lambda item: str(item[0]).lower(),
                )
            ]
            category_list.append({
                "category_name": cat_name,
                "total_emissions": round(cat_data["total_emissions"], 2),
                "site_count": len(sites_list),
                "sites": sites_list
            })

        scope_total = round(scope_data["total_emissions"], 2)
        scope_list.append({
            "scope_name": scope_name,
            "total_emissions": scope_total,
            "category_count": len(category_list),
            "categories": category_list
        })
        if scope_name in totals:
            totals[scope_name] = scope_total

    totals["Total"] = round(sum(totals.values()), 2)
    return scope_list, totals


@router.get("/jobs/{job_id}/data-output")
def get_job_data_output(
    job_id: int,
    scope: str | None = None,
    _user: dict[str, str] = Depends(_current_user)
):
    """
    Get hierarchical emissions data for a job.
    Returns data structured by Scope > Level 2 (Categories) > Sites.

    If scope is provided, returns detailed breakdown for that scope only.
    Otherwise returns summary for all scopes.
    """
    try:
        with get_conn() as con:
            # Verify job exists
            job_check = con.execute(
                "SELECT job_id, reporting_year FROM jobs WHERE job_id = %s",
                [int(job_id)]
            ).fetchone()

            if not job_check:
                raise HTTPException(status_code=404, detail="Job not found")

            reporting_year = job_check[1]
            resolver = JobMonthlyEmissionsResolver(con, int(job_id))
            data_df = _load_data_output_rows(con, int(job_id))

            if data_df is None or data_df.empty:
                if scope:
                    return {
                        "job_id": int(job_id),
                        "reporting_year": reporting_year,
                        "scope": scope,
                        "categories": []
                    }
                return {
                    "job_id": int(job_id),
                    "reporting_year": reporting_year,
                    "scopes": []
                }

            if scope:
                data_df = data_df[data_df["scope"] == scope].copy()

            if scope:
                # Detailed breakdown for specific scope
                # Group by dataset category and site
                categories = {}
                for _, row in data_df.iterrows():
                    category = _dataset_category_label(row)
                    site = _clean_label(row.get('site_name'), 'No Site Assigned')
                    metrics = combined_row_metrics(row, resolver)
                    qty_val = float(metrics.get("display_qty") or 0.0)
                    emission = float(metrics.get("calc_tco2e") or 0.0)
                    emission_display = round(emission, 2)

                    if category not in categories:
                        categories[category] = {
                            "category_name": category,
                            "total_emissions": 0,
                            "sites": {}
                        }

                    if site not in categories[category]["sites"]:
                        categories[category]["sites"][site] = {
                            "site_name": site,
                            "total_emissions": 0,
                            "activities": []
                        }

                    categories[category]["total_emissions"] += emission_display
                    categories[category]["sites"][site]["total_emissions"] += emission_display
                    categories[category]["sites"][site]["activities"].append({
                        "row_id": int(row['row_id']),
                        "level_3": _safe_text(row.get('level_3')),
                        "level_4": _safe_text(row.get('level_4')),
                        "activity_name": _safe_text(row.get('activity_name')),
                        "quantity": qty_val if qty_val > 0 else None,
                        "unit": metrics.get("display_uom"),
                        "emissions": emission_display,
                        "is_custom_entry": bool(row.get("is_custom_entry") or False),
                        "record_type": _safe_text(row.get("record_type")) or "legacy",
                        "source_family": _safe_text(row.get("source_family")) or (
                            "Business Travel Register"
                            if str(row.get("source_type") or "").strip().lower() == "business_travel"
                            else (
                                "Asset Register"
                                if str(row.get("record_type") or "legacy").strip().lower() == "source_register"
                                else "Legacy Data Entry"
                            )
                        ),
                        "source_type": _safe_text(row.get("source_type")),
                        "group_name": _safe_text(row.get("group_name")),
                        "source_name": _safe_text(row.get("source_name")),
                        "asset_identifier": _safe_text(row.get("asset_identifier")),
                        "employee_name": _safe_text(row.get("employee_name")),
                        "site_name": site,
                    })

                # Convert to list format
                category_list = []
                for cat_name, cat_data in sorted(
                    categories.items(),
                    key=lambda item: (-float(item[1]["total_emissions"] or 0.0), str(item[0]).lower()),
                ):
                    site_list = [
                        {
                            "site_name": site_name,
                            "total_emissions": round(site_data["total_emissions"], 2),
                            "activities": site_data["activities"]
                        }
                        for site_name, site_data in sorted(
                            cat_data["sites"].items(),
                            key=lambda item: str(item[0]).lower(),
                        )
                    ]

                    category_list.append({
                        "category_name": cat_name,
                        "total_emissions": round(cat_data["total_emissions"], 2),
                        "site_count": len(site_list),
                        "sites": site_list
                    })

                return {
                    "job_id": int(job_id),
                    "reporting_year": reporting_year,
                    "scope": scope,
                    "categories": category_list
                }

            else:
                # Summary view - all scopes
                scope_list, _scope_totals = _build_scope_summary(data_df, resolver)
                return {
                    "job_id": int(job_id),
                    "reporting_year": reporting_year,
                    "scopes": scope_list
                }
                
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch data output: {e}")


@router.get("/jobs/{job_id}/data-output/audit")
def get_job_data_output_audit(
    job_id: int,
    _user: dict[str, str] = Depends(_current_user),
):
    """Core audit rows in Site order, then Scope order, with scope subtotals."""
    try:
        with get_conn() as con:
            job_check = con.execute(
                "SELECT job_id, reporting_year FROM jobs WHERE job_id = %s",
                [int(job_id)],
            ).fetchone()
            if not job_check:
                raise HTTPException(status_code=404, detail="Job not found")

            reporting_year = job_check[1]
            resolver = JobMonthlyEmissionsResolver(con, int(job_id))
            df = _load_data_output_rows(con, int(job_id))

            if df is None or df.empty:
                return {
                    "job_id": int(job_id),
                    "reporting_year": reporting_year,
                    "rows": [],
                    "scope_subtotals": [],
                }

            rows: list[dict] = []
            subtotal_map: dict[tuple[str, str], float] = {}
            for _, row in df.iterrows():
                scope_name = _clean_label(row.get("scope"), "Unknown")
                site_name = _clean_label(row.get("site_name"), "No Site Assigned")
                category_name = _dataset_category_label(row)
                metrics = combined_row_metrics(row, resolver)
                qty_val = float(metrics.get("display_qty") or 0.0)
                emissions = float(metrics.get("calc_tco2e") or 0.0)
                emissions_display = round(emissions, 2)

                rows.append(
                    {
                        "site_name": site_name,
                        "scope": scope_name,
                        "category": category_name,
                        "dataset_category": category_name,
                        "id": str(row.get("original_id") or ""),
                        "report_label": str(row.get("report_label") or "-"),
                        "uom": str(metrics.get("display_uom") or ""),
                        "qty": qty_val,
                        "factor": float(metrics.get("display_factor") or 0.0),
                        "factor_label": metrics.get("factor_label"),
                        "tco2e_after_apply": round(emissions, 6),
                        "data_confidence": str(row.get("data_confidence") or ""),
                        "source_family": str(
                            row.get("source_family")
                            or (
                                "Business Travel Register"
                                if str(row.get("source_type") or "").strip().lower() == "business_travel"
                                else (
                                    "Asset Register"
                                    if str(row.get("record_type") or "legacy").strip().lower() == "source_register"
                                    else "Legacy Data Entry"
                                )
                            )
                        ),
                        "record_type": str(row.get("record_type") or "legacy"),
                        "source_type": row.get("source_type"),
                        "group_name": row.get("group_name"),
                        "source_name": row.get("source_name"),
                        "asset_identifier": row.get("asset_identifier"),
                        "employee_name": row.get("employee_name"),
                        "dataset_name": str(metrics.get("dataset_label") or row.get("dataset_name") or ""),
                        "dataset_version": str(row.get("dataset_version") or ""),
                    }
                )
                key = (site_name, scope_name)
                subtotal_map[key] = float(subtotal_map.get(key, 0.0) + emissions_display)

            rows.sort(
                key=lambda r: (
                    _scope_sort_key(str(r["scope"])),
                    str(r.get("category") or "").lower(),
                    str(r["report_label"]).lower(),
                    str(r["id"]).lower(),
                    str(r["site_name"]).lower(),
                )
            )
            scope_subtotals = [
                {
                    "site_name": site_name,
                    "scope": scope_name,
                    "subtotal_tco2e_after_apply": round(total, 6),
                }
                for (site_name, scope_name), total in sorted(
                    subtotal_map.items(),
                    key=lambda item: (str(item[0][0]).lower(), _scope_sort_key(str(item[0][1]))),
                )
            ]

            return {
                "job_id": int(job_id),
                "reporting_year": reporting_year,
                "rows": rows,
                "scope_subtotals": scope_subtotals,
            }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch audit data output: {e}")
