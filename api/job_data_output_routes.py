"""
API routes for job data output and emissions breakdown.
Provides hierarchical view of emissions data by Scope > Categories > Sites.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from core.database import get_conn
from api.auth import _current_user
from services.monthly_emissions import JobMonthlyEmissionsResolver

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
    df = con.execute(
        """
        WITH legacy_rows AS (
            SELECT
                jsr.row_id AS row_id,
                jsr.scope,
                COALESCE(jsr.category, jsr.level_2, 'Uncategorized'::text) AS category,
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
                jsr.source_qty,
                jsr.source_uom,
                jsr.is_custom_entry,
                jsr.month_1, jsr.month_2, jsr.month_3, jsr.month_4,
                jsr.month_5, jsr.month_6, jsr.month_7, jsr.month_8,
                jsr.month_9, jsr.month_10, jsr.month_11, jsr.month_12,
                'legacy'::text AS record_type,
                COALESCE(jsr.data_source, 'Company Data') AS data_source,
                COALESCE(jsr.data_confidence, 'M') AS data_confidence,
                d.name AS dataset_name,
                d.version AS dataset_version,
                NULL::text AS source_type,
                NULL::text AS source_subtype,
                NULL::text AS group_name,
                NULL::text AS asset_identifier,
                NULL::text AS employee_name,
                COALESCE(NULLIF(jsr.report_label, ''), COALESCE(jsr.category, 'Uncategorized')) AS report_label
            FROM job_scope_rows jsr
            LEFT JOIN client_sites s ON jsr.site_id = s.site_id
            LEFT JOIN datasets d ON d.dataset_id = jsr.dataset_id
            WHERE jsr.job_id = %s
              AND jsr.enabled = TRUE
        ),
        source_rows AS (
            SELECT
                js.source_id AS row_id,
                js.scope,
                COALESCE(js.category, 'Uncategorized'::text) AS category,
                COALESCE(cs.site_name, 'No Site Assigned'::text) AS site_name,
                NULL::text AS level_3,
                NULL::text AS level_4,
                COALESCE(NULLIF(js.source_name, ''), NULLIF(g.group_name, ''), COALESCE(js.category, 'Uncategorized')) AS activity_name,
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
                js.source_type AS source_type,
                js.source_subtype AS source_subtype,
                g.group_name,
                js.asset_identifier,
                js.employee_name,
                COALESCE(NULLIF(js.source_name, ''), NULLIF(g.group_name, ''), COALESCE(js.category, 'Uncategorized')) AS report_label
            FROM job_emission_sources js
            LEFT JOIN job_emission_groups g ON g.group_id = js.group_id
            LEFT JOIN client_sites cs ON cs.site_id = js.site_id
            LEFT JOIN datasets d ON d.dataset_id = COALESCE(g.dataset_id, js.dataset_id)
            WHERE js.job_id = %s
              AND COALESCE(js.enabled, TRUE) = TRUE
        )
        SELECT * FROM legacy_rows
        UNION ALL
        SELECT * FROM source_rows
        ORDER BY COALESCE(site_name, 'No Site Assigned'::text), scope, category, report_label
        """,
        [int(job_id), int(job_id)],
    ).df()
    return df


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
                # Group by category and site
                categories = {}
                for _, row in data_df.iterrows():
                    category = row['category'] or 'Uncategorized'
                    site = row['site_name'] or 'No Site Assigned'
                    metrics = resolver.row_metrics(row)
                    qty_val = float(metrics.get("display_qty") or 0.0)
                    emission = float(metrics.get("calc_tco2e") or 0.0)

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

                    categories[category]["total_emissions"] += emission
                    categories[category]["sites"][site]["total_emissions"] += emission
                    categories[category]["sites"][site]["activities"].append({
                        "row_id": int(row['row_id']),
                        "level_3": row['level_3'],
                        "level_4": row['level_4'],
                        "activity_name": row['activity_name'],
                        "quantity": qty_val if qty_val > 0 else None,
                        "unit": metrics.get("display_uom"),
                        "emissions": round(emission, 2),
                        "is_custom_entry": bool(row.get("is_custom_entry") or False),
                    })

                # Convert to list format
                category_list = []
                for cat_name, cat_data in categories.items():
                    site_list = [
                        {
                            "site_name": site_name,
                            "total_emissions": round(site_data["total_emissions"], 2),
                            "activities": site_data["activities"]
                        }
                        for site_name, site_data in cat_data["sites"].items()
                    ]

                    category_list.append({
                        "category_name": cat_name,
                        "total_emissions": round(cat_data["total_emissions"], 2),
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
                # Group by scope and calculate emissions
                scopes = {}
                for _, row in data_df.iterrows():
                    scope_name = row['scope'] or 'Unknown'
                    category = row['category'] or 'Uncategorized'
                    site = row['site_name'] or 'No Site Assigned'
                    metrics = resolver.row_metrics(row)
                    emission = float(metrics.get("calc_tco2e") or 0.0)
                    
                    if scope_name not in scopes:
                        scopes[scope_name] = {
                            "scope_name": scope_name,
                            "total_emissions": 0,
                            "categories": {}
                        }
                    
                    if category not in scopes[scope_name]["categories"]:
                        scopes[scope_name]["categories"][category] = {
                            "category_name": category,
                            "total_emissions": 0,
                            "site_emissions": {}
                        }
                    
                    # Aggregate by site
                    if site not in scopes[scope_name]["categories"][category]["site_emissions"]:
                        scopes[scope_name]["categories"][category]["site_emissions"][site] = {
                            "total": 0,
                            "count": 0
                        }
                    
                    scopes[scope_name]["total_emissions"] += emission
                    scopes[scope_name]["categories"][category]["total_emissions"] += emission
                    scopes[scope_name]["categories"][category]["site_emissions"][site]["total"] += emission
                    scopes[scope_name]["categories"][category]["site_emissions"][site]["count"] += 1
                
                # Convert to list format
                scope_list = []
                for scope_name, scope_data in scopes.items():
                    category_list = []
                    for cat_name, cat_data in scope_data["categories"].items():
                        sites_list = [
                            {
                                "site_name": site_name,
                                "total_emissions": round(site_data["total"], 2),
                                "activity_count": site_data["count"]
                            }
                            for site_name, site_data in cat_data["site_emissions"].items()
                        ]
                        category_list.append({
                            "category_name": cat_name,
                            "total_emissions": round(cat_data["total_emissions"], 2),
                            "sites": sites_list
                        })
                    
                    scope_list.append({
                        "scope_name": scope_name,
                        "total_emissions": round(scope_data["total_emissions"], 2),
                        "categories": category_list
                    })
                
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
                scope_name = str(row.get("scope") or "Unknown")
                site_name = str(row.get("site_name") or "No Site Assigned")
                metrics = resolver.row_metrics(row)
                qty_val = float(metrics.get("display_qty") or 0.0)
                emissions = float(metrics.get("calc_tco2e") or 0.0)

                rows.append(
                    {
                        "site_name": site_name,
                        "scope": scope_name,
                        "id": str(row.get("original_id") or ""),
                        "report_label": str(row.get("report_label") or "-"),
                        "uom": str(metrics.get("display_uom") or ""),
                        "qty": qty_val,
                        "factor": float(metrics.get("display_factor") or 0.0),
                        "factor_label": metrics.get("factor_label"),
                        "tco2e_after_apply": round(emissions, 6),
                        "data_confidence": str(row.get("data_confidence") or ""),
                        "dataset_name": str(metrics.get("dataset_label") or row.get("dataset_name") or ""),
                        "dataset_version": str(row.get("dataset_version") or ""),
                    }
                )
                key = (site_name, scope_name)
                subtotal_map[key] = float(subtotal_map.get(key, 0.0) + emissions)

            rows.sort(key=lambda r: (str(r["site_name"]).lower(), _scope_sort_key(str(r["scope"])), str(r["report_label"]).lower(), str(r["id"]).lower()))
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
