"""
API routes for job data output and emissions breakdown.
Provides hierarchical view of emissions data by Scope > Categories > Sites.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from core.database import get_conn
from api.auth import _current_user

router = APIRouter()

_SCOPE_SORT = {"Scope 1": 1, "Scope 2": 2, "Scope 3": 3}


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

            if scope:
                # Detailed breakdown for specific scope
                data_df = con.execute(
                    """
                    SELECT 
                        jsr.scope,
                        COALESCE(jsr.category, jsr.level_2, 'Uncategorized'::text) as category,
                        COALESCE(s.site_name, 'No Site Assigned'::text) as site_name,
                        jsr.level_3,
                        jsr.level_4,
                        COALESCE(jsr.column_text, jsr.report_label) as activity_name,
                        jsr.qty as quantity,
                        jsr.uom as unit,
                        jsr.factor,
                        jsr.ghg_unit,
                        jsr.apply_pct,
                        jsr.is_custom_entry,
                        jsr.month_1, jsr.month_2, jsr.month_3, jsr.month_4,
                        jsr.month_5, jsr.month_6, jsr.month_7, jsr.month_8,
                        jsr.month_9, jsr.month_10, jsr.month_11, jsr.month_12,
                        jsr.row_id
                    FROM job_scope_rows jsr
                    LEFT JOIN client_sites s ON jsr.site_id = s.site_id
                    WHERE jsr.job_id = %s 
                    AND jsr.scope = %s
                    AND jsr.enabled = TRUE
                    ORDER BY COALESCE(s.site_name, 'No Site Assigned'), jsr.category, jsr.level_2, jsr.level_3, jsr.level_4
                    """,
                    [int(job_id), scope]
                ).df()

                if data_df is None or data_df.empty:
                    return {
                        "job_id": int(job_id),
                        "reporting_year": reporting_year,
                        "scope": scope,
                        "categories": []
                    }

                # Group by category and site
                categories = {}
                for _, row in data_df.iterrows():
                    category = row['category'] or 'Uncategorized'
                    site = row['site_name'] or 'No Site Assigned'

                    # Calculate emissions on-the-fly
                    monthly_total = sum([
                        float(row.get(f'month_{i}') or 0)
                        for i in range(1, 13)
                    ])
                    qty_val = float(row.get('quantity') or monthly_total or 0)
                    factor_val = float(row.get('factor') or 0)
                    apply_pct_val = float(row.get('apply_pct') or 100)

                    # Convert based on ghg_unit
                    ghg_unit = str(row.get('ghg_unit') or 'kgCO2e').lower()
                    emission = qty_val * factor_val * (apply_pct_val / 100.0)
                    if 'kg' in ghg_unit:
                        emission = emission / 1000.0  # Convert kg to tonnes

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
                        "unit": row['unit'],
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
                summary_df = con.execute(
                    """
                    SELECT 
                        jsr.scope,
                        COALESCE(jsr.category, jsr.level_2, 'Uncategorized'::text) as category,
                        COALESCE(s.site_name, 'No Site Assigned'::text) as site_name,
                        jsr.qty,
                        jsr.factor,
                        jsr.ghg_unit,
                        jsr.apply_pct,
                        jsr.is_custom_entry,
                        jsr.month_1, jsr.month_2, jsr.month_3, jsr.month_4,
                        jsr.month_5, jsr.month_6, jsr.month_7, jsr.month_8,
                        jsr.month_9, jsr.month_10, jsr.month_11, jsr.month_12
                    FROM job_scope_rows jsr
                    LEFT JOIN client_sites s ON jsr.site_id = s.site_id
                    WHERE jsr.job_id = %s
                    AND jsr.enabled = TRUE
                    ORDER BY jsr.scope, category, COALESCE(s.site_name, 'No Site Assigned')
                    """,
                    [int(job_id)]
                ).df()
                
                if summary_df is None or summary_df.empty:
                    return {
                        "job_id": int(job_id),
                        "reporting_year": reporting_year,
                        "scopes": []
                    }
                
                # Group by scope and calculate emissions
                scopes = {}
                for _, row in summary_df.iterrows():
                    scope_name = row['scope'] or 'Unknown'
                    category = row['category'] or 'Uncategorized'
                    site = row['site_name'] or 'No Site Assigned'
                    
                    # Calculate emissions on-the-fly
                    monthly_total = sum([
                        float(row.get(f'month_{i}') or 0) 
                        for i in range(1, 13)
                    ])
                    qty_val = float(row.get('qty') or monthly_total or 0)
                    factor_val = float(row.get('factor') or 0)
                    apply_pct_val = float(row.get('apply_pct') or 100)
                    
                    # Convert based on ghg_unit
                    ghg_unit = str(row.get('ghg_unit') or 'kgCO2e').lower()
                    emission = qty_val * factor_val * (apply_pct_val / 100.0)
                    if 'kg' in ghg_unit:
                        emission = emission / 1000.0  # Convert kg to tonnes
                    
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
            df = con.execute(
                """
                SELECT
                    COALESCE(s.site_name, 'No Site Assigned'::text) AS site_name,
                    jsr.scope,
                    jsr.original_id,
                    COALESCE(jsr.report_label, jsr.column_text, '-'::text) AS report_label,
                    jsr.uom,
                    jsr.qty,
                    jsr.factor,
                    jsr.ghg_unit,
                    jsr.apply_pct,
                    jsr.data_confidence,
                    d.name AS dataset_name,
                    d.version AS dataset_version,
                    jsr.month_1, jsr.month_2, jsr.month_3, jsr.month_4,
                    jsr.month_5, jsr.month_6, jsr.month_7, jsr.month_8,
                    jsr.month_9, jsr.month_10, jsr.month_11, jsr.month_12
                FROM job_scope_rows jsr
                LEFT JOIN client_sites s ON jsr.site_id = s.site_id
                LEFT JOIN datasets d ON jsr.dataset_id = d.dataset_id
                WHERE jsr.job_id = %s
                AND jsr.enabled = TRUE
                ORDER BY COALESCE(s.site_name, 'No Site Assigned'::text), jsr.scope, COALESCE(jsr.report_label, jsr.column_text, '-'::text), jsr.original_id
                """,
                [int(job_id)],
            ).df()

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
                monthly_total = sum([float(row.get(f"month_{i}") or 0) for i in range(1, 13)])
                qty_val = float(row.get("qty") or monthly_total or 0)
                scope_name = str(row.get("scope") or "Unknown")
                site_name = str(row.get("site_name") or "No Site Assigned")
                emissions = _calc_emissions_tco2e(
                    qty=qty_val,
                    factor=float(row.get("factor") or 0),
                    apply_pct=float(row.get("apply_pct") or 100),
                    ghg_unit=str(row.get("ghg_unit") or "kgCO2e"),
                )

                rows.append(
                    {
                        "site_name": site_name,
                        "scope": scope_name,
                        "id": str(row.get("original_id") or ""),
                        "report_label": str(row.get("report_label") or "-"),
                        "uom": str(row.get("uom") or ""),
                        "qty": qty_val,
                        "factor": float(row.get("factor") or 0),
                        "tco2e_after_apply": round(emissions, 6),
                        "data_confidence": str(row.get("data_confidence") or ""),
                        "dataset_name": str(row.get("dataset_name") or ""),
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
