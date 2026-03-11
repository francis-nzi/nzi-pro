"""
Main Dashboard API Routes
Provides overview metrics for the main dashboard
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from core.database import get_conn
from api.auth import _current_user

router = APIRouter()


def _table_exists(con, table_name: str) -> bool:
    """Best-effort table existence check that works across backends."""
    try:
        row = con.execute(
            "SELECT 1 FROM information_schema.tables WHERE table_name = ? LIMIT 1",
            [table_name],
        ).fetchone()
        return bool(row)
    except Exception:
        # Fallback for engines/environments where information_schema is unavailable
        try:
            con.execute(f"SELECT 1 FROM {table_name} LIMIT 1").fetchone()
            return True
        except Exception:
            return False


def _column_exists(con, table_name: str, column_name: str) -> bool:
    """Best-effort column existence check that works across backends."""
    try:
        row = con.execute(
            "SELECT 1 FROM information_schema.columns WHERE table_name = ? AND column_name = ? LIMIT 1",
            [table_name, column_name],
        ).fetchone()
        return bool(row)
    except Exception:
        # Fallback for engines/environments where information_schema is unavailable
        try:
            con.execute(f"SELECT {column_name} FROM {table_name} LIMIT 1").fetchone()
            return True
        except Exception:
            return False


@router.get("/dashboard/overview")
def get_dashboard_overview(
    year: int = Query(None, description="Reporting year to filter emissions (defaults to current year)"),
    industry: str | None = Query(None, description="Optional industry filter"),
    crm_owner: str | None = Query(None, description="Optional CRM owner filter"),
    _user: dict[str, str] = Depends(_current_user)
):
    """
    Get main dashboard overview metrics including:
    - Total number of clients
    - Total CO2 emissions (by year)
    - Job status breakdown
    - Active jobs count
    - Total datasets
    - Year-over-year emissions change
    - Top emitting clients
    """
    try:
        with get_conn() as con:
            # build filters for industry / crm owner
            client_filters: list[str] = []
            job_filters: list[str] = []
            client_params: list[object] = []
            job_params: list[object] = []

            if industry:
                client_filters.append("industry = ?")
                client_params.append(industry)
                job_filters.append("c.industry = ?")
                job_params.append(industry)
            if crm_owner:
                crm_value = str(crm_owner).strip()
                # CRM owner is stored on clients; support explicit "Unassigned" filter.
                if crm_value.lower() == "unassigned":
                    job_filters.append("(c.crm_owner IS NULL OR TRIM(c.crm_owner) = '')")
                else:
                    job_filters.append("c.crm_owner = ?")
                    job_params.append(crm_value)

            # helper clauses
            client_where = "WHERE " + " AND ".join(client_filters) if client_filters else ""
            # note: job_where will often be embedded in queries that already have WHERE
            job_where = " AND " + " AND ".join(job_filters) if job_filters else ""

            # Get current year if not specified
            if year is None:
                current_year_result = con.execute(
                    "SELECT MAX(reporting_year) FROM jobs WHERE reporting_year IS NOT NULL"
                ).fetchone()
                year = current_year_result[0] if current_year_result and current_year_result[0] else 2024
            
            # Total number of clients (optionally filtered by industry)
            clients_count_sql = f"SELECT COUNT(*) FROM clients c {client_where}"
            clients_count = con.execute(clients_count_sql, client_params).fetchone()[0]
            
            has_scope_rows = _table_exists(con, "job_scope_rows")
            has_jobs_is_crp = _column_exists(con, "jobs", "is_crp")
            has_jsr_enabled = has_scope_rows and _column_exists(con, "job_scope_rows", "enabled")

            # Total CO2 emissions for selected year (graceful fallback on legacy schemas)
            total_emissions = 0.0
            prev_year_emissions = 0.0
            if has_scope_rows:
                emissions_filters = ["j.reporting_year = ?"]
                if has_jsr_enabled:
                    emissions_filters.append("jsr.enabled = TRUE")
                if has_jobs_is_crp:
                    emissions_filters.append("j.is_crp = TRUE")
                # apply job/client filters
                if job_filters:
                    emissions_filters.extend(job_filters)

                emissions_sql = f"""
                    SELECT COALESCE(SUM(
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
                    FROM job_scope_rows jsr
                    JOIN jobs j ON jsr.job_id = j.job_id
                    LEFT JOIN clients c ON c.db_id = j.client_db_id
                    WHERE {' AND '.join(emissions_filters)}
                    """
                try:
                    emissions_result = con.execute(emissions_sql, [int(year), *job_params]).fetchone()
                    total_emissions = float(emissions_result[0]) if emissions_result else 0.0
                except Exception:
                    total_emissions = 0.0

                if year > 1900:
                    try:
                        prev_result = con.execute(emissions_sql, [int(year) - 1, *job_params]).fetchone()
                        prev_year_emissions = float(prev_result[0]) if prev_result else 0.0
                    except Exception:
                        prev_year_emissions = 0.0
            # Job status breakdown (apply job filters if any)
            job_statuses_query = f"""
                SELECT 
                    COALESCE(j.status, 'Unknown') as status,
                    COUNT(*) as count
                FROM jobs j
                LEFT JOIN clients c ON c.db_id = j.client_db_id
                WHERE 1=1{job_where}
                GROUP BY j.status
                ORDER BY count DESC
                """
            job_statuses_df = con.execute(job_statuses_query, job_params).df()
            
            status_breakdown = []
            if job_statuses_df is not None and not job_statuses_df.empty:
                for _, row in job_statuses_df.iterrows():
                    status_breakdown.append({
                        "status": row['status'],
                        "count": int(row['count'])
                    })
            
            # Active jobs (not completed/archived) with filters
            try:
                active_jobs_query = f"""
                    SELECT COUNT(*) FROM jobs j
                    LEFT JOIN clients c ON c.db_id = j.client_db_id
                    WHERE (status NOT IN ('Completed', 'Archived', 'Cancelled') OR status IS NULL){job_where}
                    """
                active_jobs = con.execute(active_jobs_query, job_params).fetchone()[0]
            except Exception:
                active_jobs = con.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]
            
            # Total datasets
            if _table_exists(con, "datasets"):
                try:
                    total_datasets = con.execute(
                        "SELECT COUNT(*) FROM datasets WHERE archived = FALSE OR archived IS NULL"
                    ).fetchone()[0]
                except Exception:
                    total_datasets = con.execute("SELECT COUNT(*) FROM datasets").fetchone()[0]
            else:
                total_datasets = 0
            
            # Top 5 emitting clients for selected year (respecting filters)
            top_clients_sql = """
                SELECT
                    c.client_name,
                    c.db_id,
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
                FROM clients c
                LEFT JOIN jobs j ON c.db_id = j.client_db_id
                LEFT JOIN job_scope_rows jsr ON j.job_id = jsr.job_id AND jsr.enabled = TRUE
                WHERE (j.reporting_year = ? OR j.reporting_year IS NULL) AND (j.is_crp = TRUE OR j.is_crp IS NULL){job_where}
                GROUP BY c.client_name, c.db_id
                HAVING COALESCE(SUM(
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
                ), 0) > 0
                ORDER BY total_emissions DESC
                LIMIT 5
                """
            top_emitting_clients = []
            if has_scope_rows:
                join_enabled = " AND jsr.enabled = TRUE" if has_jsr_enabled else ""
                is_crp_clause = " AND (j.is_crp = TRUE OR j.is_crp IS NULL)" if has_jobs_is_crp else ""
                top_clients_sql = top_clients_sql.replace(
                    "LEFT JOIN job_scope_rows jsr ON j.job_id = jsr.job_id AND jsr.enabled = TRUE",
                    f"LEFT JOIN job_scope_rows jsr ON j.job_id = jsr.job_id{join_enabled}",
                ).replace(
                    " AND (j.is_crp = TRUE OR j.is_crp IS NULL)",
                    is_crp_clause,
                )

                try:
                    top_clients_df = con.execute(top_clients_sql, [int(year), *job_params]).df()
                except Exception:
                    top_clients_df = None

                if top_clients_df is not None and not top_clients_df.empty:
                    for _, row in top_clients_df.iterrows():
                        top_emitting_clients.append({
                            "client_name": row['client_name'],
                            "client_id": int(row['db_id']),
                            "emissions": float(row['total_emissions'])
                        })
            
            # Available years for year selector
            available_years_df = con.execute(
                """
                SELECT DISTINCT reporting_year 
                FROM jobs 
                WHERE reporting_year IS NOT NULL
                ORDER BY reporting_year DESC
                """
            ).df()
            
            years_list = []
            if available_years_df is not None and not available_years_df.empty:
                years_list = [int(year) for year in available_years_df['reporting_year'].tolist() if year is not None]

            # Available industries (for filter dropdown)
            industries_df = con.execute(
                "SELECT DISTINCT industry FROM clients WHERE industry IS NOT NULL ORDER BY industry"
            ).df()
            available_industries = [row['industry'] for _, row in industries_df.iterrows()] if industries_df is not None else []

            # Available CRM owners (from client table)
            crm_list_df = con.execute(
                "SELECT DISTINCT COALESCE(crm_owner, 'Unassigned') AS crm_owner FROM clients ORDER BY crm_owner"
            ).df()
            available_crm = [row['crm_owner'] for _, row in crm_list_df.iterrows()] if crm_list_df is not None else []

            # Year trend of emissions (ignoring year filter to show full history)
            year_trend = []
            if has_scope_rows:
                trend_filters = []
                if has_jsr_enabled:
                    trend_filters.append("jsr.enabled = TRUE")
                if has_jobs_is_crp:
                    trend_filters.append("j.is_crp = TRUE")
                if job_filters:
                    trend_filters.extend(job_filters)
                trend_where = "WHERE " + " AND ".join(trend_filters) if trend_filters else ""

                trend_sql = f"""
                    SELECT j.reporting_year,
                           COALESCE(SUM(
                               CASE
                                   WHEN LOWER(COALESCE(jsr.ghg_unit, 'kgCO2e')) LIKE '%%kg%%' THEN
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
                           ),0) as total_emissions
                    FROM job_scope_rows jsr
                    JOIN jobs j ON jsr.job_id = j.job_id
                    LEFT JOIN clients c ON c.db_id = j.client_db_id
                    {trend_where}
                    GROUP BY j.reporting_year
                    ORDER BY j.reporting_year
                """
                try:
                    trend_df = con.execute(trend_sql, job_params).df()
                except Exception:
                    trend_df = None
                if trend_df is not None and not trend_df.empty:
                    for _, r in trend_df.iterrows():
                        year_trend.append({
                            "year": int(r['reporting_year']) if r['reporting_year'] is not None else None,
                            "total_emissions": float(r['total_emissions'])
                        })

            # Industry breakdown (count of active clients by industry)
            industry_breakdown = []
            client_count_sql = "SELECT COALESCE(industry,'Unspecified') AS industry, COUNT(*) AS client_count FROM clients c"
            if client_filters:
                client_count_sql += f" WHERE {' AND '.join(client_filters)}"
            client_count_sql += " GROUP BY COALESCE(industry,'Unspecified') ORDER BY client_count DESC"
            try:
                ind_df = con.execute(client_count_sql, client_params).df()
            except Exception:
                ind_df = None
            if ind_df is not None and not ind_df.empty:
                for _, r in ind_df.iterrows():
                    industry_breakdown.append({
                        "industry": r['industry'],
                        "client_count": int(r['client_count'])
                    })

            # Recent jobs (last 5, ordered by most recent changes)
            if _table_exists(con, "job_plan"):
                try:
                    recent_jobs_df = con.execute(
                        f"""
                        SELECT
                            j.job_id,
                            j.title,
                            j.reporting_year,
                            j.status,
                            c.client_name,
                            j.start_date,
                            j.created_at,
                            jp.data_collection_due,
                            jp.data_collection_completed_at,
                            jp.first_draft_due,
                            jp.first_draft_completed_at,
                            jp.final_report_due,
                            jp.final_report_completed_at
                        FROM jobs j
                        LEFT JOIN clients c ON j.client_db_id = c.db_id
                        LEFT JOIN job_plan jp ON j.job_id = jp.job_id
                        WHERE 1=1{job_where}
                        ORDER BY j.created_at DESC NULLS LAST, j.job_id DESC
                        LIMIT 5
                        """,
                        job_params
                    ).df()
                except Exception:
                    recent_jobs_df = con.execute(
                        f"""
                        SELECT
                            j.job_id,
                            j.title,
                            j.reporting_year,
                            j.status,
                            c.client_name,
                            j.start_date,
                            j.created_at,
                            NULL as data_collection_due,
                            NULL as data_collection_completed_at,
                            NULL as first_draft_due,
                            NULL as first_draft_completed_at,
                            NULL as final_report_due,
                            NULL as final_report_completed_at
                        FROM jobs j
                        LEFT JOIN clients c ON j.client_db_id = c.db_id
                        WHERE 1=1{job_where}
                        ORDER BY j.created_at DESC NULLS LAST, j.job_id DESC
                        LIMIT 5
                        """,
                        job_params
                    ).df()
            else:
                recent_jobs_df = con.execute(
                    f"""
                    SELECT
                        j.job_id,
                        j.title,
                        j.reporting_year,
                        j.status,
                        c.client_name,
                        j.start_date,
                        j.created_at,
                        NULL as data_collection_due,
                        NULL as data_collection_completed_at,
                        NULL as first_draft_due,
                        NULL as first_draft_completed_at,
                        NULL as final_report_due,
                        NULL as final_report_completed_at
                    FROM jobs j
                    LEFT JOIN clients c ON j.client_db_id = c.db_id
                    WHERE 1=1{job_where}
                    ORDER BY j.created_at DESC NULLS LAST, j.job_id DESC
                    LIMIT 5
                    """,
                    job_params
                ).df()
            
            # Helper function to calculate milestone status
            def get_milestone_status(due_date, completed_at):
                """Calculate traffic light status: green, amber, red, completed"""
                if completed_at:
                    return "completed"
                if not due_date:
                    return "green"
                
                from datetime import date, timedelta
                today = date.today()
                days_until_due = (due_date - today).days
                
                if days_until_due < -1:  # Overdue by more than 1 day
                    return "red"
                elif days_until_due <= 7:  # Due within 7 days or 1 day overdue
                    return "amber"
                else:
                    return "green"
            
            def get_overall_status(statuses):
                """Get the worst status from a list of statuses"""
                if "red" in statuses:
                    return "red"
                elif "amber" in statuses:
                    return "amber"
                elif "green" in statuses:
                    return "green"
                elif "completed" in statuses:
                    return "completed"
                else:
                    return None
            
            recent_activity = []
            if recent_jobs_df is not None and not recent_jobs_df.empty:
                for _, row in recent_jobs_df.iterrows():
                    # Calculate individual milestone statuses
                    milestone_statuses = []
                    if row.get("data_collection_due"):
                        milestone_statuses.append(get_milestone_status(row.get("data_collection_due"), row.get("data_collection_completed_at")))
                    if row.get("first_draft_due"):
                        milestone_statuses.append(get_milestone_status(row.get("first_draft_due"), row.get("first_draft_completed_at")))
                    if row.get("final_report_due"):
                        milestone_statuses.append(get_milestone_status(row.get("final_report_due"), row.get("final_report_completed_at")))
                    
                    # Calculate overall status
                    overall_milestone_status = get_overall_status(milestone_statuses) if milestone_statuses else None
                    
                    recent_activity.append({
                        "job_id": int(row['job_id']),
                        "title": row['title'],
                        "reporting_year": int(row['reporting_year']) if row['reporting_year'] is not None else None,
                        "status": row['status'],
                        "client_name": row['client_name'],
                        "start_date": row['start_date'],
                        "milestone_status": overall_milestone_status
                    })
            
            # Jobs per CRM by status (using current client CRM owner)
            crm_status_df = con.execute(
                f"""
                SELECT 
                    COALESCE(c.crm_owner, 'Unassigned') as crm_name,
                    COALESCE(j.status, 'Unknown') as status,
                    COUNT(*) as count
                FROM jobs j
                LEFT JOIN clients c ON j.client_db_id = c.db_id
                WHERE 1=1{job_where}
                GROUP BY c.crm_owner, j.status
                ORDER BY crm_name, status
                """,
                job_params,
            ).df()
            
            # Organize data by CRM with status breakdown
            crm_status_data = {}
            if crm_status_df is not None and not crm_status_df.empty:
                for _, row in crm_status_df.iterrows():
                    crm = row['crm_name']
                    status = row['status']
                    count = int(row['count'])
                    
                    if crm not in crm_status_data:
                        crm_status_data[crm] = {
                            "crm_name": crm,
                            "total_jobs": 0,
                            "statuses": {}
                        }
                    
                    crm_status_data[crm]["statuses"][status] = count
                    crm_status_data[crm]["total_jobs"] += count
            
            jobs_per_crm = list(crm_status_data.values())

            # Year-over-year emissions change (%), null when prior year has no baseline
            yoy_change = None
            if prev_year_emissions and prev_year_emissions > 0:
                yoy_change = ((total_emissions - prev_year_emissions) / prev_year_emissions) * 100.0
            
            return {
                "selected_year": int(year),
                "available_years": years_list,
                "available_industries": available_industries,
                "available_crm": available_crm,
                "year_trend": year_trend,
                "industry_breakdown": industry_breakdown,
                "metrics": {
                    "total_clients": int(clients_count),
                    "total_emissions": round(total_emissions, 1),
                    "active_jobs": int(active_jobs),
                    "total_datasets": int(total_datasets),
                    "yoy_change": round(yoy_change, 1) if yoy_change is not None else None
                },
                "job_status_breakdown": status_breakdown,
                "top_emitting_clients": top_emitting_clients,
                "recent_activity": recent_activity,
                "jobs_per_crm": jobs_per_crm
            }
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch dashboard overview: {e}")


@router.get("/dashboard/jobs-by-milestone-status")
def get_jobs_by_milestone_status(_user: dict[str, str] = Depends(_current_user)):
    """
    Get count of jobs grouped by their overall milestone status (green, amber, red)
    """
    try:
        from datetime import date
        import pandas as pd
        
        def get_milestone_status(due_date, completed_at):
            """Calculate traffic light status: green, amber, red, completed"""
            if completed_at:
                return "completed"
            if not due_date:
                return "green"
            
            # Handle pandas Timestamp
            if isinstance(due_date, pd.Timestamp):
                due_date = due_date.date()
            
            today = date.today()
            days_until_due = (due_date - today).days
            
            if days_until_due < -1:
                return "red"
            elif days_until_due <= 7:
                return "amber"
            else:
                return "green"
        
        def get_overall_status(statuses):
            """Get overall status: red if any red, amber if any amber, else green"""
            if "red" in statuses:
                return "red"
            elif "amber" in statuses:
                return "amber"
            else:
                return "green"
        
        with get_conn() as con:
            # If milestone table does not exist yet, return safe empty counts
            if not _table_exists(con, "job_plan"):
                total_jobs = con.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]
                return {
                    "green": 0,
                    "amber": 0,
                    "red": 0,
                    "no_milestones": int(total_jobs),
                    "total": int(total_jobs),
                }

            # Get all jobs with their milestone data
            try:
                jobs_df = con.execute(
                    """
                    SELECT
                        j.job_id,
                        jp.data_collection_due, jp.data_collection_completed_at,
                        jp.first_draft_due, jp.first_draft_completed_at,
                        jp.final_report_due, jp.final_report_completed_at
                    FROM jobs j
                    LEFT JOIN job_plan jp ON jp.job_id = j.job_id
                    """
                ).df()
            except Exception:
                total_jobs = con.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]
                return {
                    "green": 0,
                    "amber": 0,
                    "red": 0,
                    "no_milestones": int(total_jobs),
                    "total": int(total_jobs),
                }
            
            status_counts = {
                "green": 0,
                "amber": 0,
                "red": 0,
                "no_milestones": 0
            }
            
            if jobs_df is not None and not jobs_df.empty:
                for _, row in jobs_df.iterrows():
                    milestone_statuses = []
                    
                    if row.get("data_collection_due"):
                        milestone_statuses.append(get_milestone_status(
                            row.get("data_collection_due"), 
                            row.get("data_collection_completed_at")
                        ))
                    if row.get("first_draft_due"):
                        milestone_statuses.append(get_milestone_status(
                            row.get("first_draft_due"), 
                            row.get("first_draft_completed_at")
                        ))
                    if row.get("final_report_due"):
                        milestone_statuses.append(get_milestone_status(
                            row.get("final_report_due"), 
                            row.get("final_report_completed_at")
                        ))
                    
                    if milestone_statuses:
                        overall_status = get_overall_status(milestone_statuses)
                        status_counts[overall_status] += 1
                    else:
                        status_counts["no_milestones"] += 1
            
            return {
                "green": status_counts["green"],
                "amber": status_counts["amber"],
                "red": status_counts["red"],
                "no_milestones": status_counts["no_milestones"],
                "total": sum(status_counts.values())
            }
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch jobs by milestone status: {e}")
