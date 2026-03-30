"""
Client Reporting API Routes
Provides year-over-year emissions comparison data for client reporting.
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from core.database import get_conn
from api.auth import _current_user
from services.monthly_emissions import JobMonthlyEmissionsResolver
from services.emissions_reporting import load_combined_reporting_rows

router = APIRouter()


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
            
            # Get combined scope rows from both the legacy data-entry table and the source register.
            # This keeps year-over-year client reporting aligned with the job report and Data Output views.
            scope_df = load_combined_reporting_rows(con, job_ids)
            
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
