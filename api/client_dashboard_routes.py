"""
Client Dashboard API Routes
Provides aggregated emissions data and metrics for client dashboards
"""

from fastapi import APIRouter, HTTPException, Depends, Query
import os
from core.database import get_conn
from api.auth import _current_user
from api.permissions import assert_client_access
from services.tenancy import require_org
from services.tenancy import org_context
from services import ai_insights
from services.client_benchmark import ensure_client_benchmark_columns, get_client_benchmark_metrics
from services.emissions_reporting import attach_exact_emissions, load_combined_reporting_rows

router = APIRouter()


def _org_match_clause(job_alias: str = "j", client_alias: str = "c") -> str:
    return (
        f"COALESCE({job_alias}.org_id, {client_alias}.org_id) = %s"
    )


def _load_client_jobs(con, client_db_id: int, org_id: str | None, crp_only: bool = True):
    if org_id:
        if crp_only:
            return con.execute(
                """
                SELECT
                    j.job_id,
                    j.reporting_year,
                    COALESCE(
                        EXTRACT(YEAR FROM j.reporting_period_end),
                        EXTRACT(YEAR FROM cjd.reporting_period_to),
                        j.reporting_year
                    ) as dashboard_year,
                    j.title
                FROM jobs j
                LEFT JOIN crp_job_details cjd ON cjd.job_id = j.job_id
                JOIN clients c ON c.db_id = j.client_db_id
                WHERE j.client_db_id = %s AND j.is_crp = TRUE AND {org_match}
                ORDER BY dashboard_year ASC NULLS LAST
                """.format(org_match=_org_match_clause()),
                [int(client_db_id), org_id],
            ).df()
        return con.execute(
            """
            SELECT
                j.job_id,
                j.reporting_year,
                COALESCE(
                    EXTRACT(YEAR FROM j.reporting_period_end),
                    EXTRACT(YEAR FROM cjd.reporting_period_to),
                    j.reporting_year
                ) as dashboard_year,
                j.title
            FROM jobs j
            LEFT JOIN crp_job_details cjd ON cjd.job_id = j.job_id
            JOIN clients c ON c.db_id = j.client_db_id
            WHERE j.client_db_id = %s AND {org_match}
                ORDER BY dashboard_year ASC NULLS LAST
            """.format(org_match=_org_match_clause()),
            [int(client_db_id), org_id],
        ).df()

    if crp_only:
        return con.execute(
            """
            SELECT
                j.job_id,
                j.reporting_year,
                COALESCE(
                    EXTRACT(YEAR FROM j.reporting_period_end),
                    EXTRACT(YEAR FROM cjd.reporting_period_to),
                    j.reporting_year
                ) as dashboard_year,
                j.title
            FROM jobs j
            LEFT JOIN crp_job_details cjd ON cjd.job_id = j.job_id
            WHERE j.client_db_id = %s AND j.is_crp = TRUE
            ORDER BY dashboard_year ASC NULLS LAST
            """,
            [int(client_db_id)],
        ).df()

    return con.execute(
        """
        SELECT
            j.job_id,
            j.reporting_year,
            COALESCE(
                EXTRACT(YEAR FROM j.reporting_period_end),
                EXTRACT(YEAR FROM cjd.reporting_period_to),
                j.reporting_year
            ) as dashboard_year,
            j.title
        FROM jobs j
        LEFT JOIN crp_job_details cjd ON cjd.job_id = j.job_id
        WHERE j.client_db_id = %s
        ORDER BY dashboard_year ASC NULLS LAST
        """,
        [int(client_db_id)],
    ).df()


@router.get("/clients/{client_db_id}/dashboard")
def get_client_dashboard(
    client_db_id: int,
    year: int | None = Query(default=None),
    _user: dict[str, str] = Depends(_current_user),
):
    """
    Get dashboard data for a client including:
    - Total emissions by year
    - Emissions by scope and year
    - Top emission categories
    - Intensity metrics (if available)
    """
    try:
        assert_client_access(_user, int(client_db_id))
        org_id = require_org(_user)
        with get_conn() as con:
            ensure_client_benchmark_columns(con)
            try:
                # Prefer CRP jobs for the dashboard, but fall back to all client jobs
                # when the client has no CRP-tagged jobs yet.
                jobs_df = _load_client_jobs(con, int(client_db_id), org_id, crp_only=True)
                if jobs_df is None or jobs_df.empty:
                    jobs_df = _load_client_jobs(con, int(client_db_id), org_id, crp_only=False)
                job_ids = [int(j) for j in jobs_df['job_id'].tolist()] if jobs_df is not None and not jobs_df.empty else []
                scope_df = load_combined_reporting_rows(con, job_ids)
                scope_df = attach_exact_emissions(con, scope_df)
            except Exception:
                jobs_df = None
                scope_df = None

            benchmark_metrics = None
            try:
                benchmark_metrics = get_client_benchmark_metrics(con, int(client_db_id))
            except Exception:
                benchmark_metrics = None

            if scope_df is None or scope_df.empty:
                available_years = sorted(
                    [
                        int(y)
                        for y in jobs_df['dashboard_year'].dropna().unique().tolist()
                        if y is not None and str(y) != 'nan'
                    ]
                ) if jobs_df is not None and not jobs_df.empty else []
                selected_year = (
                    int(year)
                    if year is not None and int(year) in available_years
                    else (available_years[-1] if available_years else None)
                )
                return {
                    'client_db_id': int(client_db_id),
                    'selected_year': selected_year,
                    'available_years': available_years,
                    'current_metrics': {
                        'total_emissions': 0,
                        'scope1': 0,
                        'scope2': 0,
                        'scope3': 0,
                        'year': selected_year
                    },
                    'yoy_change': None,
                    'yearly_emissions': [],
                    'top_categories': [],
                    'intensity_metrics': [],
                    'currency': 'GBP',
                    'benchmark_metrics': benchmark_metrics,
                    'industry_average_emissions': None,
                    'net_zero_progress': None
                }

            scope_df = scope_df.copy()
            scope_df['dashboard_year_norm'] = scope_df['dashboard_year'].apply(lambda value: int(value) if value is not None and str(value) != 'nan' else None)
            scope_df = scope_df[scope_df['dashboard_year_norm'].notna()].copy()
            years = sorted(
                [
                    int(y)
                    for y in scope_df['dashboard_year_norm'].dropna().unique().tolist()
                    if y is not None and str(y) != 'nan'
                ]
            )
            available_years = years
            try:
                requested_year = int(year) if year is not None else None
            except Exception:
                requested_year = None
            selected_year = (
                requested_year
                if requested_year is not None and requested_year in available_years
                else (available_years[-1] if available_years else None)
            )

            scope_groups = scope_df.groupby(['dashboard_year_norm', 'scope'])['emissions'].sum().reset_index()
            yearly_emissions = []
            for yr in available_years:
                year_rows = scope_groups[scope_groups['dashboard_year_norm'] == yr]
                scope1_total = float(year_rows[year_rows['scope'] == 'Scope 1']['emissions'].sum())
                scope2_total = float(year_rows[year_rows['scope'] == 'Scope 2']['emissions'].sum())
                scope3_total = float(year_rows[year_rows['scope'] == 'Scope 3']['emissions'].sum())
                yearly_emissions.append({
                    'year': int(yr),
                    'scope1': scope1_total,
                    'scope2': scope2_total,
                    'scope3': scope3_total,
                    'total': float(year_rows['emissions'].sum()),
                })

            current_metrics = {
                'total_emissions': 0,
                'scope1': 0,
                'scope2': 0,
                'scope3': 0,
                'year': selected_year
            }

            if selected_year is not None:
                selected_data = next((y for y in yearly_emissions if int(y['year']) == int(selected_year)), None)
                if selected_data:
                    current_metrics = {
                        'total_emissions': selected_data['total'],
                        'scope1': selected_data['scope1'],
                        'scope2': selected_data['scope2'],
                        'scope3': selected_data['scope3'],
                        'year': selected_data['year']
                    }

            top_categories = []
            total_selected_emissions = float(current_metrics['total_emissions'] or 0)
            if selected_year is not None:
                selected_rows = scope_df[scope_df['dashboard_year_norm'] == selected_year].copy()
                if not selected_rows.empty:
                    category_groups = selected_rows.groupby('category')['emissions'].sum().reset_index()
                    category_groups = category_groups.sort_values('emissions', ascending=False).head(10)
                    for _, row in category_groups.iterrows():
                        category = str(row['category']).strip()
                        if not category or category.lower() in ['nan', 'none', 'null']:
                            continue
                        emissions = float(row['emissions'])
                        percentage = (emissions / total_selected_emissions * 100) if total_selected_emissions > 0 else 0
                        top_categories.append({
                            'category': category,
                            'emissions': emissions,
                            'percentage': round(percentage, 1)
                        })

            # Additional summary: industry average and net-zero progress
            industry_average_emissions = None
            net_zero_progress = None

            try:
                client_info = con.execute(
                    "SELECT industry, net_zero_year FROM clients WHERE db_id = %s",
                    [int(client_db_id)],
                ).fetchone()
            except Exception:
                client_info = con.execute(
                    "SELECT industry, net_zero_year FROM clients WHERE db_id = %s",
                    [int(client_db_id)],
                ).fetchone()
            if not client_info:
                raise HTTPException(status_code=404, detail="Client not found")
            industry = client_info[0] if len(client_info) > 0 else None
            net_year = client_info[1] if len(client_info) > 1 else None
            if industry:
                try:
                    if org_id:
                        avg_df = con.execute(
                            """
                            SELECT AVG(total_emissions) FROM (
                                WITH job_context AS (
                                    SELECT
                                        j.job_id,
                                        j.client_db_id
                                    FROM jobs j
                                    JOIN clients c ON c.db_id = j.client_db_id
                                    WHERE c.industry = %s AND j.is_crp = TRUE AND {org_match}
                                ),
                                    legacy_rows AS (
                                        SELECT
                                            jc.client_db_id,
                                            jsr.qty,
                                            jsr.factor,
                                            jsr.ghg_unit,
                                            jsr.apply_pct,
                                            jsr.month_1, jsr.month_2, jsr.month_3, jsr.month_4,
                                            jsr.month_5, jsr.month_6, jsr.month_7, jsr.month_8,
                                            jsr.month_9, jsr.month_10, jsr.month_11, jsr.month_12
                                        FROM job_scope_rows jsr
                                        JOIN job_context jc ON jc.job_id = jsr.job_id
                                        WHERE jsr.enabled = TRUE
                                    ),
                                    source_rows AS (
                                        SELECT
                                            jc.client_db_id,
                                            js.qty,
                                            COALESCE(g.factor, js.factor) AS factor,
                                            COALESCE(g.ghg_unit, js.ghg_unit) AS ghg_unit,
                                            js.apply_pct,
                                            NULL::numeric AS month_1, NULL::numeric AS month_2, NULL::numeric AS month_3, NULL::numeric AS month_4,
                                            NULL::numeric AS month_5, NULL::numeric AS month_6, NULL::numeric AS month_7, NULL::numeric AS month_8,
                                            NULL::numeric AS month_9, NULL::numeric AS month_10, NULL::numeric AS month_11, NULL::numeric AS month_12
                                        FROM job_emission_sources js
                                        JOIN job_context jc ON jc.job_id = js.job_id
                                        LEFT JOIN job_emission_groups g ON g.group_id = js.group_id
                                        WHERE COALESCE(js.enabled, TRUE) = TRUE
                                    ),
                                    combined_rows AS (
                                        SELECT * FROM legacy_rows
                                        UNION ALL
                                        SELECT * FROM source_rows
                                    )
                                    SELECT
                                        client_db_id,
                                        COALESCE(SUM(
                                            CASE
                                                WHEN LOWER(COALESCE(ghg_unit,'kgCO2e')) LIKE '%%kg%%' THEN
                                                    (COALESCE(qty,
                                                            COALESCE(month_1,0)+COALESCE(month_2,0)+
                                                            COALESCE(month_3,0)+COALESCE(month_4,0)+
                                                            COALESCE(month_5,0)+COALESCE(month_6,0)+
                                                            COALESCE(month_7,0)+COALESCE(month_8,0)+
                                                            COALESCE(month_9,0)+COALESCE(month_10,0)+
                                                            COALESCE(month_11,0)+COALESCE(month_12,0),0)
                                                        * COALESCE(factor,0) * COALESCE(apply_pct,100)/100.0)/1000.0
                                                ELSE
                                                    (COALESCE(qty,
                                                            COALESCE(month_1,0)+COALESCE(month_2,0)+
                                                            COALESCE(month_3,0)+COALESCE(month_4,0)+
                                                            COALESCE(month_5,0)+COALESCE(month_6,0)+
                                                            COALESCE(month_7,0)+COALESCE(month_8,0)+
                                                            COALESCE(month_9,0)+COALESCE(month_10,0)+
                                                            COALESCE(month_11,0)+COALESCE(month_12,0),0)
                                                        * COALESCE(factor,0) * COALESCE(apply_pct,100)/100.0)
                                            END
                                        ),0) AS total_emissions
                                    FROM combined_rows
                                    GROUP BY client_db_id
                                ) sub
                                """.format(org_match=_org_match_clause()),
                            [industry, org_id],
                        ).fetchone()
                    else:
                        avg_df = con.execute(
                            """
                            SELECT AVG(total_emissions) FROM (
                                WITH job_context AS (
                                    SELECT
                                        j.job_id,
                                        j.client_db_id
                                    FROM jobs j
                                    JOIN clients c ON c.db_id = j.client_db_id
                                    WHERE c.industry = %s AND j.is_crp = TRUE
                                ),
                                    legacy_rows AS (
                                        SELECT
                                            jc.client_db_id,
                                            jsr.qty,
                                            jsr.factor,
                                            jsr.ghg_unit,
                                            jsr.apply_pct,
                                            jsr.month_1, jsr.month_2, jsr.month_3, jsr.month_4,
                                            jsr.month_5, jsr.month_6, jsr.month_7, jsr.month_8,
                                            jsr.month_9, jsr.month_10, jsr.month_11, jsr.month_12
                                        FROM job_scope_rows jsr
                                        JOIN job_context jc ON jc.job_id = jsr.job_id
                                        WHERE jsr.enabled = TRUE
                                    ),
                                    source_rows AS (
                                        SELECT
                                            jc.client_db_id,
                                            js.qty,
                                            COALESCE(g.factor, js.factor) AS factor,
                                            COALESCE(g.ghg_unit, js.ghg_unit) AS ghg_unit,
                                            js.apply_pct,
                                            NULL::numeric AS month_1, NULL::numeric AS month_2, NULL::numeric AS month_3, NULL::numeric AS month_4,
                                            NULL::numeric AS month_5, NULL::numeric AS month_6, NULL::numeric AS month_7, NULL::numeric AS month_8,
                                            NULL::numeric AS month_9, NULL::numeric AS month_10, NULL::numeric AS month_11, NULL::numeric AS month_12
                                        FROM job_emission_sources js
                                        JOIN job_context jc ON jc.job_id = js.job_id
                                        LEFT JOIN job_emission_groups g ON g.group_id = js.group_id
                                        WHERE COALESCE(js.enabled, TRUE) = TRUE
                                    ),
                                    combined_rows AS (
                                        SELECT * FROM legacy_rows
                                        UNION ALL
                                        SELECT * FROM source_rows
                                    )
                                    SELECT
                                        client_db_id,
                                        COALESCE(SUM(
                                            CASE
                                                WHEN LOWER(COALESCE(ghg_unit,'kgCO2e')) LIKE '%%kg%%' THEN
                                                    (COALESCE(qty,
                                                            COALESCE(month_1,0)+COALESCE(month_2,0)+
                                                            COALESCE(month_3,0)+COALESCE(month_4,0)+
                                                            COALESCE(month_5,0)+COALESCE(month_6,0)+
                                                            COALESCE(month_7,0)+COALESCE(month_8,0)+
                                                            COALESCE(month_9,0)+COALESCE(month_10,0)+
                                                            COALESCE(month_11,0)+COALESCE(month_12,0),0)
                                                        * COALESCE(factor,0) * COALESCE(apply_pct,100)/100.0)/1000.0
                                                ELSE
                                                    (COALESCE(qty,
                                                            COALESCE(month_1,0)+COALESCE(month_2,0)+
                                                            COALESCE(month_3,0)+COALESCE(month_4,0)+
                                                            COALESCE(month_5,0)+COALESCE(month_6,0)+
                                                            COALESCE(month_7,0)+COALESCE(month_8,0)+
                                                            COALESCE(month_9,0)+COALESCE(month_10,0)+
                                                            COALESCE(month_11,0)+COALESCE(month_12,0),0)
                                                        * COALESCE(factor,0) * COALESCE(apply_pct,100)/100.0)
                                            END
                                        ),0) AS total_emissions
                                    FROM combined_rows
                                    GROUP BY client_db_id
                                ) sub
                                """,
                            [industry],
                        ).fetchone()
                    industry_average_emissions = float(avg_df[0]) if avg_df and avg_df[0] is not None else None
                except Exception:
                    industry_average_emissions = None
            if net_year and yearly_emissions:
                yrs = [y['year'] for y in yearly_emissions if y['year'] is not None]
                if yrs:
                    cur_year = max(yrs)
                    net_zero_progress = {
                        "current_year": int(cur_year),
                        "net_zero_year": int(net_year),
                        "years_to_target": int(net_year) - int(cur_year)
                    }
            
            # Calculate year-over-year change for selected year
            yoy_change = None
            if selected_year is not None:
                ordered_years = [int(y['year']) for y in yearly_emissions if y.get('year') is not None]
                if selected_year in ordered_years:
                    selected_idx = ordered_years.index(selected_year)
                    if selected_idx > 0:
                        current = float(yearly_emissions[selected_idx]['total'])
                        previous = float(yearly_emissions[selected_idx - 1]['total'])
                        if previous > 0:
                            yoy_change = ((current - previous) / previous) * 100
            
            # Get intensity metrics from the latest job
            intensity_metrics = []
            if jobs_df is not None and not jobs_df.empty and selected_year is not None:
                # Get the latest job for the selected year
                selected_jobs = jobs_df[jobs_df['dashboard_year'] == selected_year]
                if selected_jobs is not None and not selected_jobs.empty:
                    latest_job_id = int(selected_jobs.iloc[-1]['job_id'])
                
                    # Fetch intensity metrics for the latest selected-year job
                    metrics_result = con.execute(
                        "SELECT intensity_metrics FROM jobs WHERE job_id = %s",
                        [latest_job_id]
                    ).fetchone()
                
                    if metrics_result and metrics_result[0]:
                        job_metrics = metrics_result[0]
                        total_emissions = current_metrics['total_emissions']
                    
                        # Calculate intensity for each metric (take first 3)
                        for key, metric in list(job_metrics.items())[:3]:
                            if metric.get('value', 0) > 0:
                                intensity = (total_emissions / metric['value']) * metric.get('divider', 1)
                                intensity_metrics.append({
                                    'key': key,
                                    'label': metric.get('label', key),
                                    'value': metric.get('value', 0),
                                    'divider': metric.get('divider', 1),
                                    'intensity': round(intensity, 2)
                                })
            
            # Get client currency for display
            try:
                if org_id:
                    client_currency = con.execute(
                        "SELECT currency FROM clients WHERE db_id = %s",
                        [int(client_db_id)]
                    ).fetchone()
                else:
                    client_currency = con.execute(
                        "SELECT currency FROM clients WHERE db_id = %s",
                        [int(client_db_id)]
                    ).fetchone()
            except Exception:
                client_currency = con.execute(
                    "SELECT currency FROM clients WHERE db_id = %s",
                    [int(client_db_id)]
                ).fetchone()
            
            currency = client_currency[0] if client_currency and client_currency[0] else 'GBP'
            return {
                'client_db_id': int(client_db_id),
                'selected_year': selected_year,
                'available_years': available_years,
                'current_metrics': current_metrics,
                'yoy_change': round(yoy_change, 1) if yoy_change is not None else None,
                'yearly_emissions': yearly_emissions,
                'top_categories': top_categories,
                'intensity_metrics': intensity_metrics,
                'currency': currency,
                'benchmark_metrics': benchmark_metrics,
                'industry_average_emissions': industry_average_emissions,
                'net_zero_progress': net_zero_progress
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch dashboard data: {e}")


@router.post("/clients/{client_db_id}/insights")
def get_client_insights(client_db_id: int, _user: dict[str, str] = Depends(_current_user)):
    """Generate AI insights for a client using external LLM."""
    try:
        assert_client_access(_user, int(client_db_id))
        org_id = require_org(_user)
        with org_context(org_id):
            payload = ai_insights.generate_client_insights(client_db_id, org_id=org_id)
        return payload
    except HTTPException:
        # Re-raise known HTTP exceptions (e.g., our 400 for missing key)
        raise
    except Exception as e:
        message = str(e)
        if "Anthropic package not installed" in message:
            raise HTTPException(
                status_code=503,
                detail="AI insights are temporarily unavailable: Anthropic SDK is not installed on the backend server.",
            )
        if "ANTHROPIC_API_KEY not set" in message:
            raise HTTPException(
                status_code=400,
                detail="ANTHROPIC_API_KEY is not configured. Set it in the backend environment and restart.",
            )
        if "AI model call failed" in message:
            raise HTTPException(status_code=502, detail=message)
        raise HTTPException(status_code=500, detail=f"AI insight generation failed: {message}")


@router.post("/clients/{client_db_id}/insights-openai")
def get_client_insights_openai(client_db_id: int, _user: dict[str, str] = Depends(_current_user)):
    """Generate non-Anthropic insights (OpenAI provider with rule-based fallback)."""
    try:
        assert_client_access(_user, int(client_db_id))
        org_id = require_org(_user)
        with org_context(org_id):
            payload = ai_insights.generate_client_insights(client_db_id, provider="openai", org_id=org_id)
        return payload
    except HTTPException:
        raise
    except Exception as e:
        message = str(e)
        if "OpenAI package not installed" in message:
            raise HTTPException(
                status_code=503,
                detail="OpenAI insights are temporarily unavailable: OpenAI SDK is not installed on the backend server.",
            )
        if "OPENAI_API_KEY not set" in message:
            raise HTTPException(
                status_code=400,
                detail="OPENAI_API_KEY is not configured. Set it in the backend environment and restart.",
            )
        raise HTTPException(status_code=500, detail=f"OpenAI insight generation failed: {message}")
