"""
Client Reporting API Routes
Provides year-over-year emissions comparison data for client reporting.
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from core.database import get_conn
from api.auth import _current_user
from services.monthly_emissions import JobMonthlyEmissionsResolver

router = APIRouter()


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


def _optional_float(value):
    if value is None:
        return None
    try:
        text = str(value).strip()
        if not text or text.lower() == "nan":
            return None
        return float(text)
    except Exception:
        return None


def _calc_emissions(row):
    """Calculate emissions from a row with qty, factor, ghg_unit, apply_pct, and monthly values."""
    monthly_total = sum([
        float(row.get(f'month_{i}') or 0)
        for i in range(1, 13)
    ])
    qty_val = float(row.get('qty') or monthly_total or 0)
    factor_val = float(row.get('factor') or 0)
    apply_pct_val = float(row.get('apply_pct') or 100)
    
    ghg_unit = str(row.get('ghg_unit') or 'kgCO2e').lower()
    emission = qty_val * factor_val * (apply_pct_val / 100.0)
    if 'kg' in ghg_unit:
        emission = emission / 1000.0
    
    return emission


def _calc_quantity(row):
    """Calculate quantity using preserved source quantity when available."""
    source_qty = _optional_float(row.get('source_qty'))
    if source_qty is not None:
        return float(source_qty)
    monthly_total = sum([
        float(row.get(f'month_{i}') or 0)
        for i in range(1, 13)
    ])
    return float(row.get('qty') or monthly_total or 0)


@router.get("/clients/{client_db_id}/reporting")
def get_client_reporting(
    client_db_id: int,
    by_site: bool = Query(False, description="Group by site instead of total company"),
    _user: dict[str, str] = Depends(_current_user)
):
    """
    Get emissions data for year-over-year and activity comparison reporting.
    
    Returns:
    - Years with emissions summary
    - By Scope breakdown per year
    - By Activity/Category breakdown per year (if by_site=False)
    - By Site breakdown per year (if by_site=True)
    """
    try:
        with get_conn() as con:
            # Verify client exists
            client_check = con.execute(
                "SELECT client_name FROM clients WHERE db_id = %s",
                [int(client_db_id)]
            ).fetchone()
            
            if not client_check:
                raise HTTPException(status_code=404, detail="Client not found")
            
            # Get all CRP jobs for this client
            jobs_df = con.execute(
                """
                SELECT 
                    j.job_id,
                    j.reporting_year,
                    j.title,
                    COALESCE(
                        EXTRACT(YEAR FROM j.reporting_period_end),
                        EXTRACT(YEAR FROM cjd.reporting_period_to),
                        j.reporting_year
                    ) AS dashboard_year
                FROM jobs j
                LEFT JOIN crp_job_details cjd ON cjd.job_id = j.job_id
                WHERE j.client_db_id = %s AND j.is_crp = TRUE
                ORDER BY dashboard_year ASC NULLS LAST
                """,
                [int(client_db_id)]
            ).df()
            
            if jobs_df is None or jobs_df.empty:
                return {
                    "client_db_id": int(client_db_id),
                    "client_name": client_check[0],
                    "years": [],
                    "by_scope": [],
                    "by_activity": [],
                    "by_site": []
                }
            
            # Get all scope data for these jobs
            job_ids = [int(j) for j in jobs_df['job_id'].tolist()]
            
            if not job_ids:
                return {
                    "client_db_id": int(client_db_id),
                    "client_name": client_check[0],
                    "years": [],
                    "by_scope": [],
                    "by_activity": [],
                    "by_site": []
                }
            
            placeholders = ",".join(["%s"] * len(job_ids))

            # Get combined scope rows from both the legacy data-entry table and the source register.
            # This keeps year-over-year client reporting aligned with the job report and Data Output views.
            scope_df = con.execute(
                f"""
                WITH job_context AS (
                    SELECT
                        j.job_id,
                        COALESCE(
                            EXTRACT(YEAR FROM j.reporting_period_end),
                            EXTRACT(YEAR FROM cjd.reporting_period_to),
                            j.reporting_year
                        ) AS dashboard_year
                    FROM jobs j
                    LEFT JOIN crp_job_details cjd ON cjd.job_id = j.job_id
                    WHERE j.job_id IN ({placeholders})
                ),
                legacy_rows AS (
                    SELECT
                        jsr.job_id,
                        jsr.row_id,
                        jc.dashboard_year,
                        jsr.scope,
                        COALESCE(jsr.category, jsr.level_2, 'Uncategorized') AS category,
                        COALESCE(s.site_name, 'No Site Assigned') AS site_name,
                        jsr.dataset_id,
                        jsr.factor_db_id,
                        jsr.original_id,
                        NULL::numeric AS source_qty,
                        NULL::text AS source_uom,
                        jsr.qty,
                        jsr.uom,
                        jsr.factor,
                        jsr.ghg_unit,
                        jsr.apply_pct,
                        jsr.notes,
                        jsr.month_1, jsr.month_2, jsr.month_3, jsr.month_4,
                        jsr.month_5, jsr.month_6, jsr.month_7, jsr.month_8,
                        jsr.month_9, jsr.month_10, jsr.month_11, jsr.month_12
                    FROM job_scope_rows jsr
                    JOIN job_context jc ON jc.job_id = jsr.job_id
                    LEFT JOIN client_sites s ON jsr.site_id = s.site_id
                    WHERE jsr.enabled = TRUE
                ),
                source_rows AS (
                    SELECT
                        js.job_id,
                        js.source_id AS row_id,
                        jc.dashboard_year,
                        js.scope,
                        COALESCE(js.category, 'Uncategorized') AS category,
                        COALESCE(cs.site_name, 'No Site Assigned') AS site_name,
                        COALESCE(g.dataset_id, js.dataset_id) AS dataset_id,
                        COALESCE(g.factor_db_id, js.factor_db_id) AS factor_db_id,
                        COALESCE(g.original_id, js.original_id) AS original_id,
                        NULL::numeric AS source_qty,
                        NULL::text AS source_uom,
                        js.qty,
                        COALESCE(g.uom, js.uom) AS uom,
                        COALESCE(g.factor, js.factor) AS factor,
                        COALESCE(g.ghg_unit, js.ghg_unit) AS ghg_unit,
                        js.apply_pct,
                        js.notes,
                        NULL::numeric AS month_1, NULL::numeric AS month_2, NULL::numeric AS month_3, NULL::numeric AS month_4,
                        NULL::numeric AS month_5, NULL::numeric AS month_6, NULL::numeric AS month_7, NULL::numeric AS month_8,
                        NULL::numeric AS month_9, NULL::numeric AS month_10, NULL::numeric AS month_11, NULL::numeric AS month_12
                    FROM job_emission_sources js
                    JOIN job_context jc ON jc.job_id = js.job_id
                    LEFT JOIN job_emission_groups g ON g.group_id = js.group_id
                    LEFT JOIN client_sites cs ON cs.site_id = js.site_id
                    WHERE COALESCE(js.enabled, TRUE) = TRUE
                )
                SELECT *
                FROM (
                    SELECT * FROM legacy_rows
                    UNION ALL
                    SELECT * FROM source_rows
                ) combined_rows
                ORDER BY dashboard_year, scope, category, site_name
                """,
                job_ids
            ).df()
            
            if scope_df is None or scope_df.empty:
                return {
                    "client_db_id": int(client_db_id),
                    "client_name": client_check[0],
                    "years": sorted([int(y) for y in jobs_df['dashboard_year'].dropna().unique().tolist()]),
                    "by_scope": [],
                    "by_activity": [],
                    "by_site": []
                }
            
            # Calculate emissions and quantity using the same month-aware row resolver
            resolver_by_job: dict[int, JobMonthlyEmissionsResolver] = {}
            emissions_vals: list[float] = []
            quantity_vals: list[float] = []
            for _, row in scope_df.iterrows():
                row_job_id = int(row.get('job_id'))
                resolver = resolver_by_job.get(row_job_id)
                if resolver is None:
                    resolver = JobMonthlyEmissionsResolver(con, row_job_id)
                    resolver_by_job[row_job_id] = resolver
                metrics = resolver.row_metrics(row)
                emissions_vals.append(float(metrics.get('calc_tco2e') or 0.0))
                quantity_vals.append(float(metrics.get('display_qty') or 0.0))

            scope_df['emissions'] = emissions_vals
            scope_df['quantity'] = quantity_vals
            
            # Get unique years
            years = sorted([int(y) for y in scope_df['dashboard_year'].dropna().unique().tolist()])
            
            # === BY SCOPE ===
            # Group by year and scope
            scope_groups = scope_df.groupby(['dashboard_year', 'scope'])['emissions'].sum().reset_index()
            
            by_scope = []
            for year in years:
                year_data = {"year": int(year)}
                year_rows = scope_groups[scope_groups['dashboard_year'] == year]
                for _, row in year_rows.iterrows():
                    scope_name = str(row['scope']) if row['scope'] else 'Unknown'
                    year_data[scope_name] = round(float(row['emissions']), 2)
                year_data['total'] = round(year_rows['emissions'].sum(), 2)
                by_scope.append(year_data)

            # === BY SCOPE (VOLUME/QTY) ===
            scope_volume_groups = scope_df.groupby(['dashboard_year', 'scope'])['quantity'].sum().reset_index()
            by_scope_volume = []
            for year in years:
                year_data = {"year": int(year)}
                year_rows = scope_volume_groups[scope_volume_groups['dashboard_year'] == year]
                for _, row in year_rows.iterrows():
                    scope_name = str(row['scope']) if row['scope'] else 'Unknown'
                    year_data[scope_name] = round(float(row['quantity']), 2)
                year_data['total'] = round(year_rows['quantity'].sum(), 2)
                by_scope_volume.append(year_data)
            
            # === BY SCOPE AND CATEGORY ===
            # Group by year, scope, and category for detailed breakdown
            scope_cat_groups = scope_df.groupby(['dashboard_year', 'scope', 'category'])['emissions'].sum().reset_index()
            
            by_scope_category = []
            for year in years:
                year_data = {"year": int(year)}
                year_rows = scope_cat_groups[scope_cat_groups['dashboard_year'] == year]
                
                # Group by scope within this year
                scope_cats = {}
                for _, row in year_rows.iterrows():
                    scope_name = str(row['scope']) if row['scope'] else 'Unknown'
                    cat_name = str(row['category']) if row['category'] else 'Unknown'
                    if scope_name not in scope_cats:
                        scope_cats[scope_name] = {}
                    scope_cats[scope_name][cat_name] = round(float(row['emissions']), 2)
                
                year_data['scopes'] = scope_cats
                by_scope_category.append(year_data)

            # === BY SCOPE AND CATEGORY (VOLUME/QTY) ===
            scope_cat_volume_groups = scope_df.groupby(['dashboard_year', 'scope', 'category'])['quantity'].sum().reset_index()
            by_scope_category_volume = []
            for year in years:
                year_data = {"year": int(year)}
                year_rows = scope_cat_volume_groups[scope_cat_volume_groups['dashboard_year'] == year]
                scope_cats = {}
                for _, row in year_rows.iterrows():
                    scope_name = str(row['scope']) if row['scope'] else 'Unknown'
                    cat_name = str(row['category']) if row['category'] else 'Unknown'
                    if scope_name not in scope_cats:
                        scope_cats[scope_name] = {}
                    scope_cats[scope_name][cat_name] = round(float(row['quantity']), 2)
                year_data['scopes'] = scope_cats
                by_scope_category_volume.append(year_data)
            
            # === BY ACTIVITY (category) ===
            # Group by year and category
            activity_groups = scope_df.groupby(['dashboard_year', 'category'])['emissions'].sum().reset_index()
            
            by_activity = []
            for year in years:
                year_data = {"year": int(year)}
                year_rows = activity_groups[activity_groups['dashboard_year'] == year]
                for _, row in year_rows.iterrows():
                    cat_name = str(row['category']) if row['category'] else 'Unknown'
                    year_data[cat_name] = round(float(row['emissions']), 2)
                year_data['total'] = round(year_rows['emissions'].sum(), 2)
                by_activity.append(year_data)
            
            # === BY SITE ===
            # Group by year and site
            site_groups = scope_df.groupby(['dashboard_year', 'site_name'])['emissions'].sum().reset_index()
            
            by_site = []
            for year in years:
                year_data = {"year": int(year)}
                year_rows = site_groups[site_groups['dashboard_year'] == year]
                for _, row in year_rows.iterrows():
                    site_name = str(row['site_name']) if row['site_name'] else 'Unknown'
                    year_data[site_name] = round(float(row['emissions']), 2)
                year_data['total'] = round(year_rows['emissions'].sum(), 2)
                by_site.append(year_data)
            
            return {
                "client_db_id": int(client_db_id),
                "client_name": client_check[0],
                "years": [int(y) for y in years],
                "by_scope": by_scope,
                "by_scope_category": by_scope_category,
                "by_scope_volume": by_scope_volume,
                "by_scope_category_volume": by_scope_category_volume,
                "by_activity": by_activity,
                "by_site": by_site
            }
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch reporting data: {e}")
