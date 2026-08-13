"""
Client Reporting API Routes
Provides year-over-year emissions comparison data for client reporting.
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from core.database import get_conn
from api.auth import _current_user
from services.monthly_emissions import JobMonthlyEmissionsResolver
from services.emissions_reporting import combined_row_metrics, load_combined_reporting_rows

router = APIRouter()


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
        row.get("category"),
        row.get("dataset_category"),
        row.get("lookup_level_1"),
        row.get("level_1"),
        row.get("lookup_category"),
        row.get("level_2"),
    ):
        if _is_placeholder_category(value):
            continue
        return _clean_label(value, fallback)
    return fallback


def _level1_category_label(row, fallback: str = "Uncategorized") -> str:
    """High-level category label using the emission factor's category field (fl.category = lookup_category)."""
    for value in (
        row.get("lookup_category"),
        row.get("category"),
        row.get("dataset_category"),
        row.get("lookup_level_1"),
        row.get("level_1"),
        row.get("level_2"),
    ):
        if _is_placeholder_category(value):
            continue
        return _clean_label(value, fallback)
    return fallback


def _load_client_jobs(con, client_db_id: int, crp_only: bool = True):
    if crp_only:
        return con.execute(
            """
            SELECT
                j.job_id,
                j.job_number,
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
            ORDER BY dashboard_year ASC NULLS LAST, j.job_id ASC
            """,
            [int(client_db_id)],
        ).df()

    return con.execute(
        """
        SELECT
            j.job_id,
            j.job_number,
            j.reporting_year,
            j.title,
            COALESCE(
                EXTRACT(YEAR FROM j.reporting_period_end),
                EXTRACT(YEAR FROM cjd.reporting_period_to),
                j.reporting_year
            ) AS dashboard_year
        FROM jobs j
        LEFT JOIN crp_job_details cjd ON cjd.job_id = j.job_id
        WHERE j.client_db_id = %s
        ORDER BY dashboard_year ASC NULLS LAST, j.job_id ASC
        """,
        [int(client_db_id)],
    ).df()


def _build_year_jobs(jobs_df):
    if jobs_df is None or jobs_df.empty:
        return []

    year_jobs = []
    grouped = jobs_df.copy()
    grouped["dashboard_year_norm"] = grouped["dashboard_year"].apply(lambda value: int(value) if str(value).strip().lower() not in {"", "nan", "none", "null"} and value is not None else None)
    grouped = grouped[grouped["dashboard_year_norm"].notna()].copy()

    for year, year_rows in grouped.groupby("dashboard_year_norm", sort=True):
        latest_row = year_rows.iloc[-1]
        job_number = str(latest_row.get("job_number") or "").strip() or None
        year_jobs.append({
            "year": int(year),
            "job_id": int(latest_row["job_id"]),
            "job_number": job_number,
            "title": str(latest_row.get("title") or "").strip() or None,
            "reporting_year": int(latest_row["reporting_year"]) if str(latest_row.get("reporting_year")).strip().lower() not in {"", "nan", "none", "null"} and latest_row.get("reporting_year") is not None else None,
        })

    return year_jobs


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
            # Verify client exists and get benchmark_year
            client_check = con.execute(
                "SELECT client_name, benchmark_year FROM clients WHERE db_id = %s",
                [int(client_db_id)]
            ).fetchone()

            if not client_check:
                raise HTTPException(status_code=404, detail="Client not found")

            client_benchmark_year = int(client_check[1]) if client_check[1] is not None else None
            
            # Use all client jobs so the comparison table reflects every reporting
            # year that exists for the client, including non-CRP historical jobs.
            jobs_df = _load_client_jobs(con, int(client_db_id), crp_only=False)
            
            if jobs_df is None or jobs_df.empty:
                return {
                    "client_db_id": int(client_db_id),
                    "client_name": client_check[0],
                    "benchmark_year": client_benchmark_year,
                    "years": [],
                    "year_jobs": [],
                    "by_scope": [],
                    "by_activity": [],
                    "by_site": []
                }

            # Deduplicate to one job per year (most recent by job_id) so multiple
            # jobs for the same dashboard_year don't get double-counted.
            year_jobs = _build_year_jobs(jobs_df)
            job_ids = [yj["job_id"] for yj in year_jobs]

            if not job_ids:
                return {
                    "client_db_id": int(client_db_id),
                    "client_name": client_check[0],
                    "benchmark_year": client_benchmark_year,
                    "years": [],
                    "year_jobs": [],
                    "by_scope": [],
                    "by_activity": [],
                    "by_site": []
                }

            # Get combined scope rows from both the legacy data-entry table and the source register.
            scope_df = load_combined_reporting_rows(con, job_ids)

            if scope_df is None or scope_df.empty:
                return {
                    "client_db_id": int(client_db_id),
                    "client_name": client_check[0],
                    "benchmark_year": client_benchmark_year,
                    "years": sorted([int(y) for y in jobs_df['dashboard_year'].dropna().unique().tolist()]),
                    "year_jobs": _build_year_jobs(jobs_df),
                    "by_scope": [],
                    "by_activity": [],
                    "by_site": []
                }
            
            # Calculate emissions and quantity using the same month-aware row resolver
            resolver_by_job: dict[int, JobMonthlyEmissionsResolver] = {}
            emissions_vals: list[float] = []
            quantity_vals: list[float] = []
            for _, row in scope_df.iterrows():
                row_type = str(row.get("record_type") or "legacy").strip().lower()
                if row_type == "source_register":
                    metrics = combined_row_metrics(row)
                else:
                    row_job_id = int(row.get('job_id'))
                    resolver = resolver_by_job.get(row_job_id)
                    if resolver is None:
                        resolver = JobMonthlyEmissionsResolver(con, row_job_id)
                        resolver_by_job[row_job_id] = resolver
                    metrics = combined_row_metrics(row, resolver)
                emissions_vals.append(round(float(metrics.get('calc_tco2e') or 0.0), 2))
                quantity_vals.append(float(metrics.get('display_qty') or 0.0))

            scope_df['emissions'] = emissions_vals
            scope_df['quantity'] = quantity_vals
            scope_df['scope'] = scope_df['scope'].apply(lambda value: _clean_label(value, 'Unknown'))
            scope_df['dataset_category'] = scope_df.apply(lambda row: _dataset_category_label(row), axis=1)
            scope_df['category'] = scope_df['dataset_category']
            scope_df['level1_cat'] = scope_df.apply(lambda row: _level1_category_label(row), axis=1)
            scope_df['site_name'] = scope_df['site_name'].apply(lambda value: _clean_label(value, 'Unknown'))
            if 'activity_name' in scope_df.columns:
                scope_df['activity_name'] = scope_df['activity_name'].apply(lambda v: _clean_label(v, 'Unknown'))
            else:
                scope_df['activity_name'] = scope_df['category']
            
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
                    scope_name = _clean_label(row['scope'], 'Unknown')
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
                    scope_name = _clean_label(row['scope'], 'Unknown')
                    year_data[scope_name] = round(float(row['quantity']), 2)
                year_data['total'] = round(year_rows['quantity'].sum(), 2)
                by_scope_volume.append(year_data)
            
            # === BY SCOPE AND CATEGORY ===
            # Group by year, scope, and level_1 category (high-level grouping)
            scope_cat_groups = scope_df.groupby(['dashboard_year', 'scope', 'level1_cat'])['emissions'].sum().reset_index()

            by_scope_category = []
            for year in years:
                year_data = {"year": int(year)}
                year_rows = scope_cat_groups[scope_cat_groups['dashboard_year'] == year]
                scope_cats = {}
                for _, row in year_rows.iterrows():
                    scope_name = _clean_label(row['scope'], 'Unknown')
                    cat_name = _clean_label(row['level1_cat'], 'Uncategorized')
                    if scope_name not in scope_cats:
                        scope_cats[scope_name] = {}
                    scope_cats[scope_name][cat_name] = round(float(row['emissions']), 2)

                year_data['scopes'] = scope_cats
                by_scope_category.append(year_data)

            # === BY SCOPE AND CATEGORY (VOLUME/QTY) ===
            scope_cat_volume_groups = scope_df.groupby(['dashboard_year', 'scope', 'level1_cat'])['quantity'].sum().reset_index()
            by_scope_category_volume = []
            for year in years:
                year_data = {"year": int(year)}
                year_rows = scope_cat_volume_groups[scope_cat_volume_groups['dashboard_year'] == year]
                scope_cats = {}
                for _, row in year_rows.iterrows():
                    scope_name = _clean_label(row['scope'], 'Unknown')
                    cat_name = _clean_label(row['level1_cat'], 'Uncategorized')
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
                    cat_name = _clean_label(row['category'], 'Uncategorized')
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
                    site_name = _clean_label(row['site_name'], 'Unknown')
                    year_data[site_name] = round(float(row['emissions']), 2)
                year_data['total'] = round(year_rows['emissions'].sum(), 2)
                by_site.append(year_data)

            # === BY ACTIVITY DETAIL ===
            # Flat list of individual activity lines grouped by year, scope, high-level category, activity name
            detail_groups = scope_df.groupby(
                ['dashboard_year', 'scope', 'level1_cat', 'activity_name']
            )['emissions'].sum().reset_index()

            by_activity_detail = []
            for _, row in detail_groups.iterrows():
                by_activity_detail.append({
                    "year": int(row['dashboard_year']),
                    "scope": _clean_label(row['scope'], 'Unknown'),
                    "category": _clean_label(row['level1_cat'], 'Uncategorized'),
                    "activity": _clean_label(row['activity_name'], 'Unknown'),
                    "emissions": round(float(row['emissions']), 2),
                })

            detail_vol_groups = scope_df.groupby(
                ['dashboard_year', 'scope', 'level1_cat', 'activity_name']
            )['quantity'].sum().reset_index()

            by_activity_detail_volume = []
            for _, row in detail_vol_groups.iterrows():
                by_activity_detail_volume.append({
                    "year": int(row['dashboard_year']),
                    "scope": _clean_label(row['scope'], 'Unknown'),
                    "category": _clean_label(row['level1_cat'], 'Uncategorized'),
                    "activity": _clean_label(row['activity_name'], 'Unknown'),
                    "quantity": round(float(row['quantity']), 2),
                })

            # === BY SITE ACTIVITY DETAIL ===
            # Same as by_activity_detail but broken down per site
            site_detail_groups = scope_df.groupby(
                ['site_name', 'dashboard_year', 'scope', 'level1_cat', 'activity_name']
            )['emissions'].sum().reset_index()

            by_site_activity_detail = []
            for _, row in site_detail_groups.iterrows():
                by_site_activity_detail.append({
                    "site_name": _clean_label(row['site_name'], 'Unknown'),
                    "year": int(row['dashboard_year']),
                    "scope": _clean_label(row['scope'], 'Unknown'),
                    "category": _clean_label(row['level1_cat'], 'Uncategorized'),
                    "activity": _clean_label(row['activity_name'], 'Unknown'),
                    "emissions": round(float(row['emissions']), 2),
                })

            site_detail_vol_groups = scope_df.groupby(
                ['site_name', 'dashboard_year', 'scope', 'level1_cat', 'activity_name']
            )['quantity'].sum().reset_index()

            by_site_activity_detail_volume = []
            for _, row in site_detail_vol_groups.iterrows():
                by_site_activity_detail_volume.append({
                    "site_name": _clean_label(row['site_name'], 'Unknown'),
                    "year": int(row['dashboard_year']),
                    "scope": _clean_label(row['scope'], 'Unknown'),
                    "category": _clean_label(row['level1_cat'], 'Uncategorized'),
                    "activity": _clean_label(row['activity_name'], 'Unknown'),
                    "quantity": round(float(row['quantity']), 2),
                })

            return {
                "client_db_id": int(client_db_id),
                "client_name": client_check[0],
                "benchmark_year": client_benchmark_year,
                "years": [int(y) for y in years],
                "year_jobs": _build_year_jobs(jobs_df),
                "by_scope": by_scope,
                "by_scope_category": by_scope_category,
                "by_scope_volume": by_scope_volume,
                "by_scope_category_volume": by_scope_category_volume,
                "by_activity": by_activity,
                "by_site": by_site,
                "by_activity_detail": by_activity_detail,
                "by_activity_detail_volume": by_activity_detail_volume,
                "by_site_activity_detail": by_site_activity_detail,
                "by_site_activity_detail_volume": by_site_activity_detail_volume,
            }
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch reporting data: {e}")
