"""
Client Dashboard API Routes
Provides aggregated emissions data and metrics for client dashboards
"""

from fastapi import APIRouter, HTTPException, Depends, Query
import os
from core.database import get_conn
from api.auth import _current_user
from services import ai_insights

router = APIRouter()


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
        with get_conn() as con:
            # Get all jobs for this client with their emissions data
            jobs_df = con.execute(
                """
                SELECT 
                    j.job_id,
                    j.reporting_year,
                    j.reporting_period_end,
                    COALESCE(
                        EXTRACT(YEAR FROM j.reporting_period_end),
                        EXTRACT(YEAR FROM cjd.reporting_period_to),
                        j.reporting_year
                    ) as dashboard_year,
                    j.title,
                    COALESCE(SUM(
                        CASE WHEN jsr.scope = 'Scope 1' THEN
                            CASE 
                                WHEN LOWER(COALESCE(jsr.ghg_unit, 'kgCO2e')) LIKE '%%kg%%' 
                                THEN (COALESCE(jsr.qty, 
                                        COALESCE(jsr.month_1, 0) + COALESCE(jsr.month_2, 0) + 
                                        COALESCE(jsr.month_3, 0) + COALESCE(jsr.month_4, 0) + 
                                        COALESCE(jsr.month_5, 0) + COALESCE(jsr.month_6, 0) + 
                                        COALESCE(jsr.month_7, 0) + COALESCE(jsr.month_8, 0) + 
                                        COALESCE(jsr.month_9, 0) + COALESCE(jsr.month_10, 0) + 
                                        COALESCE(jsr.month_11, 0) + COALESCE(jsr.month_12, 0), 0
                                    ) * COALESCE(jsr.factor, 0) * COALESCE(jsr.apply_pct, 100) / 100.0) / 1000.0
                                ELSE (COALESCE(jsr.qty, 
                                        COALESCE(jsr.month_1, 0) + COALESCE(jsr.month_2, 0) + 
                                        COALESCE(jsr.month_3, 0) + COALESCE(jsr.month_4, 0) + 
                                        COALESCE(jsr.month_5, 0) + COALESCE(jsr.month_6, 0) + 
                                        COALESCE(jsr.month_7, 0) + COALESCE(jsr.month_8, 0) + 
                                        COALESCE(jsr.month_9, 0) + COALESCE(jsr.month_10, 0) + 
                                        COALESCE(jsr.month_11, 0) + COALESCE(jsr.month_12, 0), 0
                                    ) * COALESCE(jsr.factor, 0) * COALESCE(jsr.apply_pct, 100) / 100.0)
                            END
                        ELSE 0 END
                    ), 0) as scope1_total,
                    COALESCE(SUM(
                        CASE WHEN jsr.scope = 'Scope 2' THEN
                            CASE 
                                WHEN LOWER(COALESCE(jsr.ghg_unit, 'kgCO2e')) LIKE '%%kg%%' 
                                THEN (COALESCE(jsr.qty, 
                                        COALESCE(jsr.month_1, 0) + COALESCE(jsr.month_2, 0) + 
                                        COALESCE(jsr.month_3, 0) + COALESCE(jsr.month_4, 0) + 
                                        COALESCE(jsr.month_5, 0) + COALESCE(jsr.month_6, 0) + 
                                        COALESCE(jsr.month_7, 0) + COALESCE(jsr.month_8, 0) + 
                                        COALESCE(jsr.month_9, 0) + COALESCE(jsr.month_10, 0) + 
                                        COALESCE(jsr.month_11, 0) + COALESCE(jsr.month_12, 0), 0
                                    ) * COALESCE(jsr.factor, 0) * COALESCE(jsr.apply_pct, 100) / 100.0) / 1000.0
                                ELSE (COALESCE(jsr.qty, 
                                        COALESCE(jsr.month_1, 0) + COALESCE(jsr.month_2, 0) + 
                                        COALESCE(jsr.month_3, 0) + COALESCE(jsr.month_4, 0) + 
                                        COALESCE(jsr.month_5, 0) + COALESCE(jsr.month_6, 0) + 
                                        COALESCE(jsr.month_7, 0) + COALESCE(jsr.month_8, 0) + 
                                        COALESCE(jsr.month_9, 0) + COALESCE(jsr.month_10, 0) + 
                                        COALESCE(jsr.month_11, 0) + COALESCE(jsr.month_12, 0), 0
                                    ) * COALESCE(jsr.factor, 0) * COALESCE(jsr.apply_pct, 100) / 100.0)
                            END
                        ELSE 0 END
                    ), 0) as scope2_total,
                    COALESCE(SUM(
                        CASE WHEN jsr.scope = 'Scope 3' THEN
                            CASE 
                                WHEN LOWER(COALESCE(jsr.ghg_unit, 'kgCO2e')) LIKE '%%kg%%' 
                                THEN (COALESCE(jsr.qty, 
                                        COALESCE(jsr.month_1, 0) + COALESCE(jsr.month_2, 0) + 
                                        COALESCE(jsr.month_3, 0) + COALESCE(jsr.month_4, 0) + 
                                        COALESCE(jsr.month_5, 0) + COALESCE(jsr.month_6, 0) + 
                                        COALESCE(jsr.month_7, 0) + COALESCE(jsr.month_8, 0) + 
                                        COALESCE(jsr.month_9, 0) + COALESCE(jsr.month_10, 0) + 
                                        COALESCE(jsr.month_11, 0) + COALESCE(jsr.month_12, 0), 0
                                    ) * COALESCE(jsr.factor, 0) * COALESCE(jsr.apply_pct, 100) / 100.0) / 1000.0
                                ELSE (COALESCE(jsr.qty, 
                                        COALESCE(jsr.month_1, 0) + COALESCE(jsr.month_2, 0) + 
                                        COALESCE(jsr.month_3, 0) + COALESCE(jsr.month_4, 0) + 
                                        COALESCE(jsr.month_5, 0) + COALESCE(jsr.month_6, 0) + 
                                        COALESCE(jsr.month_7, 0) + COALESCE(jsr.month_8, 0) + 
                                        COALESCE(jsr.month_9, 0) + COALESCE(jsr.month_10, 0) + 
                                        COALESCE(jsr.month_11, 0) + COALESCE(jsr.month_12, 0), 0
                                    ) * COALESCE(jsr.factor, 0) * COALESCE(jsr.apply_pct, 100) / 100.0)
                            END
                        ELSE 0 END
                    ), 0) as scope3_total,
                    COALESCE(SUM(
                        CASE 
                            WHEN LOWER(COALESCE(jsr.ghg_unit, 'kgCO2e')) LIKE '%%kg%%' 
                            THEN (COALESCE(jsr.qty, 
                                    COALESCE(jsr.month_1, 0) + COALESCE(jsr.month_2, 0) + 
                                    COALESCE(jsr.month_3, 0) + COALESCE(jsr.month_4, 0) + 
                                    COALESCE(jsr.month_5, 0) + COALESCE(jsr.month_6, 0) + 
                                    COALESCE(jsr.month_7, 0) + COALESCE(jsr.month_8, 0) + 
                                    COALESCE(jsr.month_9, 0) + COALESCE(jsr.month_10, 0) + 
                                    COALESCE(jsr.month_11, 0) + COALESCE(jsr.month_12, 0), 0
                                ) * COALESCE(jsr.factor, 0) * COALESCE(jsr.apply_pct, 100) / 100.0) / 1000.0
                            ELSE (COALESCE(jsr.qty, 
                                    COALESCE(jsr.month_1, 0) + COALESCE(jsr.month_2, 0) + 
                                    COALESCE(jsr.month_3, 0) + COALESCE(jsr.month_4, 0) + 
                                    COALESCE(jsr.month_5, 0) + COALESCE(jsr.month_6, 0) + 
                                    COALESCE(jsr.month_7, 0) + COALESCE(jsr.month_8, 0) + 
                                    COALESCE(jsr.month_9, 0) + COALESCE(jsr.month_10, 0) + 
                                    COALESCE(jsr.month_11, 0) + COALESCE(jsr.month_12, 0), 0
                                ) * COALESCE(jsr.factor, 0) * COALESCE(jsr.apply_pct, 100) / 100.0)
                        END
                    ), 0) as total_emissions
                FROM jobs j
                LEFT JOIN job_scope_rows jsr ON j.job_id = jsr.job_id AND jsr.enabled = TRUE
                LEFT JOIN crp_job_details cjd ON cjd.job_id = j.job_id
                WHERE j.client_db_id = %s AND j.is_crp = TRUE
                GROUP BY j.job_id, j.reporting_year, j.reporting_period_end, cjd.reporting_period_to, j.title
                ORDER BY dashboard_year ASC NULLS LAST
                """,
                [int(client_db_id)]
            ).df()
            
            # Aggregate by dashboard year (reporting_period_end year, fallback reporting_year)
            yearly_emissions = []
            if jobs_df is not None and not jobs_df.empty:
                year_groups = jobs_df.groupby('dashboard_year').agg({
                    'scope1_total': 'sum',
                    'scope2_total': 'sum',
                    'scope3_total': 'sum',
                    'total_emissions': 'sum'
                }).reset_index()
                
                for _, row in year_groups.iterrows():
                    year_val = row['dashboard_year']
                    yearly_emissions.append({
                        'year': int(year_val) if year_val is not None and year_val == year_val else None,
                        'scope1': float(row['scope1_total']),
                        'scope2': float(row['scope2_total']),
                        'scope3': float(row['scope3_total']),
                        'total': float(row['total_emissions'])
                    })
            
            yearly_emissions = sorted(
                [x for x in yearly_emissions if x.get('year') is not None],
                key=lambda x: int(x['year']),
            )
            available_years = [int(x['year']) for x in yearly_emissions]
            selected_year = (
                int(year)
                if year is not None and int(year) in available_years
                else (available_years[-1] if available_years else None)
            )

            # Calculate current year metrics (selected year, default latest year)
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

            # Get top emission categories for selected year
            year_filter_sql = ""
            year_filter_params: list[int] = []
            if selected_year is not None:
                year_filter_sql = """
                    AND COALESCE(
                        EXTRACT(YEAR FROM j.reporting_period_end),
                        EXTRACT(YEAR FROM cjd.reporting_period_to),
                        j.reporting_year
                    ) = %s
                """
                year_filter_params = [int(selected_year)]

            categories_df = con.execute(
                f"""
                SELECT 
                    jsr.level_2 as category,
                    SUM(
                        CASE 
                            WHEN LOWER(COALESCE(jsr.ghg_unit, 'kgCO2e')) LIKE '%%kg%%' 
                            THEN (COALESCE(jsr.qty, 
                                    COALESCE(jsr.month_1, 0) + COALESCE(jsr.month_2, 0) + 
                                    COALESCE(jsr.month_3, 0) + COALESCE(jsr.month_4, 0) + 
                                    COALESCE(jsr.month_5, 0) + COALESCE(jsr.month_6, 0) + 
                                    COALESCE(jsr.month_7, 0) + COALESCE(jsr.month_8, 0) + 
                                    COALESCE(jsr.month_9, 0) + COALESCE(jsr.month_10, 0) + 
                                    COALESCE(jsr.month_11, 0) + COALESCE(jsr.month_12, 0), 0
                                ) * COALESCE(jsr.factor, 0) * COALESCE(jsr.apply_pct, 100) / 100.0) / 1000.0
                            ELSE (COALESCE(jsr.qty, 
                                    COALESCE(jsr.month_1, 0) + COALESCE(jsr.month_2, 0) + 
                                    COALESCE(jsr.month_3, 0) + COALESCE(jsr.month_4, 0) + 
                                    COALESCE(jsr.month_5, 0) + COALESCE(jsr.month_6, 0) + 
                                    COALESCE(jsr.month_7, 0) + COALESCE(jsr.month_8, 0) + 
                                    COALESCE(jsr.month_9, 0) + COALESCE(jsr.month_10, 0) + 
                                    COALESCE(jsr.month_11, 0) + COALESCE(jsr.month_12, 0), 0
                                ) * COALESCE(jsr.factor, 0) * COALESCE(jsr.apply_pct, 100) / 100.0)
                        END
                    ) as total_emissions
                FROM job_scope_rows jsr
                JOIN jobs j ON jsr.job_id = j.job_id
                LEFT JOIN crp_job_details cjd ON cjd.job_id = j.job_id
                WHERE j.client_db_id = %s 
                    AND jsr.enabled = TRUE
                    AND j.is_crp = TRUE
                    {year_filter_sql}
                    AND jsr.level_2 IS NOT NULL 
                    AND LOWER(jsr.level_2) != 'nan'
                    AND TRIM(jsr.level_2) != ''
                GROUP BY jsr.level_2
                ORDER BY total_emissions DESC
                LIMIT 10
                """,
                [int(client_db_id), *year_filter_params]
            ).df()
            
            top_categories = []
            total_selected_emissions = float(current_metrics['total_emissions'] or 0)

            # Additional summary: industry average and net-zero progress
            industry_average_emissions = None
            net_zero_progress = None

            client_info = con.execute(
                "SELECT industry, net_zero_year FROM clients WHERE db_id = %s",
                [int(client_db_id)],
            ).fetchone()
            if client_info:
                industry = client_info[0] if len(client_info) > 0 else None
                net_year = client_info[1] if len(client_info) > 1 else None
                if industry:
                    try:
                        avg_df = con.execute(
                            """
                            SELECT AVG(total_emissions) FROM (
                                SELECT j.client_db_id,
                                       COALESCE(SUM(
                                           CASE
                                               WHEN LOWER(COALESCE(jsr.ghg_unit,'kgCO2e')) LIKE '%%kg%%' THEN
                                                   (COALESCE(jsr.qty,
                                                           COALESCE(jsr.month_1,0)+COALESCE(jsr.month_2,0)+
                                                           COALESCE(jsr.month_3,0)+COALESCE(jsr.month_4,0)+
                                                           COALESCE(jsr.month_5,0)+COALESCE(jsr.month_6,0)+
                                                           COALESCE(jsr.month_7,0)+COALESCE(jsr.month_8,0)+
                                                           COALESCE(jsr.month_9,0)+COALESCE(jsr.month_10,0)+
                                                           COALESCE(jsr.month_11,0)+COALESCE(jsr.month_12,0),0)
                                                       * COALESCE(jsr.factor,0) * COALESCE(jsr.apply_pct,100)/100.0)/1000.0
                                               ELSE
                                                   (COALESCE(jsr.qty,
                                                           COALESCE(jsr.month_1,0)+COALESCE(jsr.month_2,0)+
                                                           COALESCE(jsr.month_3,0)+COALESCE(jsr.month_4,0)+
                                                           COALESCE(jsr.month_5,0)+COALESCE(jsr.month_6,0)+
                                                           COALESCE(jsr.month_7,0)+COALESCE(jsr.month_8,0)+
                                                           COALESCE(jsr.month_9,0)+COALESCE(jsr.month_10,0)+
                                                           COALESCE(jsr.month_11,0)+COALESCE(jsr.month_12,0),0)
                                                       * COALESCE(jsr.factor,0) * COALESCE(jsr.apply_pct,100)/100.0)
                                           END
                                       ),0) AS total_emissions
                                FROM jobs j
                                LEFT JOIN job_scope_rows jsr ON j.job_id = jsr.job_id AND jsr.enabled = TRUE
                                LEFT JOIN clients c ON c.db_id = j.client_db_id
                                WHERE c.industry = %s AND j.is_crp = TRUE
                                GROUP BY j.client_db_id
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
            
            if categories_df is not None and not categories_df.empty:
                for _, row in categories_df.iterrows():
                    # Get the raw category value
                    raw_category = row['category']
                    
                    # Convert to string and clean
                    if raw_category is None or (isinstance(raw_category, float) and (raw_category != raw_category)):  # Check for NaN
                        continue
                    
                    category = str(raw_category).strip()
                    
                    # Skip invalid categories
                    if not category or category.lower() in ['nan', 'none', 'null']:
                        continue
                        
                    emissions = float(row['total_emissions'])
                    percentage = (emissions / total_selected_emissions * 100) if total_selected_emissions > 0 else 0
                    top_categories.append({
                        'category': category,
                        'emissions': emissions,
                        'percentage': round(percentage, 1)
                    })

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
                'industry_average_emissions': industry_average_emissions,
                'net_zero_progress': net_zero_progress
            }
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch dashboard data: {e}")


@router.post("/clients/{client_db_id}/insights")
def get_client_insights(client_db_id: int, _user: dict[str, str] = Depends(_current_user)):
    """Generate AI insights for a client using external LLM."""
    try:
        payload = ai_insights.generate_client_insights(client_db_id)
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
        payload = ai_insights.generate_client_insights(client_db_id, provider="openai")
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
