from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta

import pandas as pd
from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request

from api.auth import _current_user
from api.job_management_helpers import (
    _build_reporting_period_end,
    _col_exists,
    _ensure_job_original_portfolio_column,
    _job_audit_snapshot,
    _month_value,
    _next_job_number,
    _table_exists,
)
from api.permissions import assert_job_access, assert_permission
from core.database import db_backend, get_conn
from services.audit_log import record_audit_event
from services.client_benchmark import ensure_client_benchmark_columns
from services.tenancy import require_org
from api.org_admin_helpers import _require_org_plan_active

router = APIRouter()
@router.post("/jobs")
def create_job(request: Request, body: dict = Body(...), _user: dict[str, str] = Depends(_current_user)):
    """Create a new job with automatic period calculation."""
    try:
        from datetime import date, timedelta
        import calendar
        from dateutil.relativedelta import relativedelta
        assert_permission(_user, "jobs.create")

        def _ensure_job_original_portfolio_column(con) -> None:
            try:
                con.execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS original_portfolio VARCHAR DEFAULT 'NZI'")
            except Exception:
                pass

        def _col_exists(con, table_name: str, col_name: str) -> bool:
            try:
                row = con.execute(
                    """
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_name = ? AND column_name = ?
                    LIMIT 1
                    """,
                    [table_name, col_name],
                ).fetchone()
                return bool(row)
            except Exception:
                return False

        def _month_value(value):
            if value is None:
                return None
            if isinstance(value, int):
                return value
            try:
                numeric = int(str(value).strip())
                if 1 <= numeric <= 12:
                    return numeric
            except Exception:
                pass
            month_map = {
                "january": 1,
                "jan": 1,
                "february": 2,
                "feb": 2,
                "march": 3,
                "mar": 3,
                "april": 4,
                "apr": 4,
                "may": 5,
                "june": 6,
                "jun": 6,
                "july": 7,
                "jul": 7,
                "august": 8,
                "aug": 8,
                "september": 9,
                "sep": 9,
                "sept": 9,
                "october": 10,
                "oct": 10,
                "november": 11,
                "nov": 11,
                "december": 12,
                "dec": 12,
            }
            return month_map.get(str(value).strip().lower())

        def _build_reporting_period_end(reporting_year_value, month_value, day_value):
            try:
                reporting_year_int = int(reporting_year_value)
            except Exception as exc:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot determine reporting year/period. Please provide reporting_year or ensure client has benchmark period set.",
                ) from exc

            month_int = month_value or 12
            if month_int < 1 or month_int > 12:
                raise HTTPException(
                    status_code=400,
                    detail="Client financial year end month is invalid. Please update the client benchmark settings.",
                )

            try:
                day_int = int(day_value) if day_value is not None else 31
            except Exception as exc:
                raise HTTPException(
                    status_code=400,
                    detail="Client financial year end day is invalid. Please update the client benchmark settings.",
                ) from exc

            if day_int < 1:
                raise HTTPException(
                    status_code=400,
                    detail="Client financial year end day is invalid. Please update the client benchmark settings.",
                )

            last_day = calendar.monthrange(reporting_year_int, month_int)[1]
            safe_day = min(day_int, last_day)
            return date(reporting_year_int, month_int, safe_day)

        def _next_job_number(con) -> str:
            rows = con.execute(
                """
                SELECT job_number
                FROM jobs
                WHERE job_number IS NOT NULL
                """
            ).fetchall()
            max_number = 0
            for row in rows:
                job_number_value = str((row[0] if row else "") or "").strip()
                if not job_number_value or job_number_value.upper() == "PENDING":
                    continue
                if not job_number_value.upper().startswith("J"):
                    continue
                numeric_part = "".join(ch for ch in job_number_value[1:] if ch.isdigit())
                if not numeric_part:
                    continue
                try:
                    max_number = max(max_number, int(numeric_part))
                except Exception:
                    continue
            return f"J{max_number + 1:06d}"
        
        client_db_id = body.get("client_db_id")
        job_type_name = body.get("job_type")
        reporting_year = body.get("reporting_year")
        is_benchmark = body.get("is_benchmark", False)
        start_date = body.get("start_date")
        due_date = body.get("due_date")
        
        if not client_db_id or not job_type_name:
            raise HTTPException(status_code=400, detail="client_db_id and job_type are required")
        
        if not start_date or not due_date:
            raise HTTPException(status_code=400, detail="start_date and due_date are required")
        assert_client_access(_user, int(client_db_id))
        org_id = require_org(_user)

        with get_conn() as con:
            _ensure_job_original_portfolio_column(con)
            _require_org_plan_active(con, org_id)
            # Lookup job_type_id and is_crp from job_types table
            job_type_row = con.execute(
                "SELECT job_type_id, is_crp FROM job_types WHERE name = ? AND is_active = TRUE",
                [job_type_name]
            ).fetchone()
            
            if not job_type_row:
                raise HTTPException(status_code=400, detail=f"Job type '{job_type_name}' not found or inactive")
            
            job_type_id = job_type_row[0]
            is_crp = job_type_row[1] or False
            
            # Get client's benchmark period and financial year info
            fy_month_expr = "financial_year_end_month" if _col_exists(con, "clients", "financial_year_end_month") else "NULL"
            fy_day_expr = "financial_year_end_day" if _col_exists(con, "clients", "financial_year_end_day") else "NULL"
            year_end_expr = "year_end_month" if _col_exists(con, "clients", "year_end_month") else "NULL"
            client_row = con.execute(
                """
                SELECT benchmark_period_start, benchmark_period_end,
                       {fy_month_expr}, {fy_day_expr},
                       benchmark_year,
                       {year_end_expr}
                FROM clients
                WHERE db_id = ?
                """.format(
                    fy_month_expr=fy_month_expr,
                    fy_day_expr=fy_day_expr,
                    year_end_expr=year_end_expr,
                ),
                [int(client_db_id)]
            ).fetchone()
            
            if not client_row:
                raise HTTPException(status_code=404, detail="Client not found")
            
            benchmark_start, benchmark_end, fy_month, fy_day, benchmark_year, year_end_month = client_row
            fy_month = fy_month or _month_value(year_end_month)
            
            # Calculate reporting period
            reporting_period_start = None
            reporting_period_end = None
            
            if is_benchmark:
                # This is the benchmark job - use client's benchmark period
                if benchmark_start and benchmark_end:
                    reporting_period_start = benchmark_start
                    reporting_period_end = benchmark_end
                    if not reporting_year and benchmark_end:
                        reporting_year = benchmark_end.year
                elif reporting_year:
                    # Calculate from reporting_year and financial year end
                    reporting_period_end = _build_reporting_period_end(reporting_year, fy_month, fy_day)
                    reporting_period_start = reporting_period_end - relativedelta(years=1) + timedelta(days=1)
            elif reporting_year:
                # Subsequent job - calculate period based on reporting_year
                reporting_period_end = _build_reporting_period_end(reporting_year, fy_month, fy_day)
                reporting_period_start = reporting_period_end - relativedelta(years=1) + timedelta(days=1)
            elif benchmark_start and benchmark_end:
                # Auto-calculate next period after benchmark
                # Find the latest job for this client
                latest_job = con.execute(
                    """
                    SELECT reporting_period_end, reporting_year
                    FROM jobs
                    WHERE client_db_id = ?
                    ORDER BY reporting_period_end DESC NULLS LAST, reporting_year DESC NULLS LAST
                    LIMIT 1
                    """,
                    [int(client_db_id)]
                ).fetchone()
                
                if latest_job and latest_job[0]:
                    # Add 1 year to the latest period
                    reporting_period_start = latest_job[0] + timedelta(days=1)
                    reporting_period_end = reporting_period_start + relativedelta(years=1) - timedelta(days=1)
                    reporting_year = reporting_period_end.year
                else:
                    # First job after benchmark - use benchmark + 1 year
                    reporting_period_start = benchmark_end + timedelta(days=1)
                    reporting_period_end = reporting_period_start + relativedelta(years=1) - timedelta(days=1)
                    reporting_year = reporting_period_end.year
            
            if not reporting_year:
                raise HTTPException(status_code=400, detail="Cannot determine reporting year/period. Please provide reporting_year or ensure client has benchmark period set.")
            
            row = con.execute(
                """
                INSERT INTO jobs (
                    client_db_id, org_id, job_type_id, job_type, original_portfolio, job_number, title, reporting_year,
                    reporting_period_start, reporting_period_end, is_benchmark, is_crp,
                    status, start_date, due_date, legacy_job_no
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                RETURNING job_id
                """,
                [
                    int(client_db_id),
                    org_id,
                    job_type_id,
                    job_type_name,
                    "NZI",
                    "PENDING",
                    body.get("title", "Untitled").strip() or "Untitled",
                    int(reporting_year),
                    reporting_period_start,
                    reporting_period_end,
                    is_benchmark,
                    is_crp,
                    body.get("status", "Open"),
                    start_date,
                    due_date,
                    body.get("legacy_job_no"),
                ],
            ).fetchone()
            
            job_id = int(row[0])
            job_number = _next_job_number(con)
            
            con.execute(
                "UPDATE jobs SET job_number = ? WHERE job_id = ?",
                [job_number, job_id],
            )
            after = _job_audit_snapshot(con, job_id)
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="create",
                entity_type="job",
                entity_id=job_id,
                client_id=int(client_db_id),
                job_id=job_id,
                after=after,
                metadata={
                    "job_number": job_number,
                    "job_type": job_type_name,
                    "is_benchmark": bool(is_benchmark),
                },
            )
            
            return {
                "ok": True, 
                "job_id": job_id, 
                "job_number": job_number,
                "reporting_period_start": str(reporting_period_start) if reporting_period_start else None,
                "reporting_period_end": str(reporting_period_end) if reporting_period_end else None,
                "is_benchmark": is_benchmark
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create job: {e}")


@router.get("/jobs")
def list_jobs(
    q: str | None = None,
    crm: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _user: dict[str, str] = Depends(_current_user),
):
    assert_permission(_user, "jobs.view")
    query = (q or "").strip()
    crm_filter = (crm or "").strip()

    def _col_exists(con, table_name: str, col_name: str) -> bool:
        try:
            row = con.execute(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = ? AND column_name = ?
                LIMIT 1
                """,
                [table_name, col_name],
            ).fetchone()
            return bool(row)
        except Exception:
            return False

    def _table_exists(con, table_name: str) -> bool:
        try:
            row = con.execute(
                """
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = ?
                LIMIT 1
                """,
                [table_name],
            ).fetchone()
            return bool(row)
        except Exception:
            return False

    try:
        with get_conn() as con:
            has_reporting_period_start = _col_exists(con, "jobs", "reporting_period_start")
            has_reporting_period_end = _col_exists(con, "jobs", "reporting_period_end")
            has_is_benchmark = _col_exists(con, "jobs", "is_benchmark")
            has_due_date = _col_exists(con, "jobs", "due_date")
            has_client_crm_owner = _col_exists(con, "clients", "crm_owner")
            has_job_crm_name = _col_exists(con, "jobs", "crm_name")
            has_job_plan = _table_exists(con, "job_plan")

            reporting_period_start_expr = "j.reporting_period_start" if has_reporting_period_start else "NULL::date AS reporting_period_start"
            reporting_period_end_expr = "j.reporting_period_end" if has_reporting_period_end else "NULL::date AS reporting_period_end"
            is_benchmark_expr = "j.is_benchmark" if has_is_benchmark else "NULL::boolean AS is_benchmark"
            due_date_expr = "j.due_date" if has_due_date else "NULL::date AS due_date"
            if has_job_crm_name and has_client_crm_owner:
                crm_name_value_expr = "COALESCE(NULLIF(j.crm_name, ''), NULLIF(c.crm_owner, ''))"
            elif has_job_crm_name:
                crm_name_value_expr = "NULLIF(j.crm_name, '')"
            elif has_client_crm_owner:
                crm_name_value_expr = "NULLIF(c.crm_owner, '')"
            else:
                crm_name_value_expr = "NULL::text"
            crm_name_expr = f"{crm_name_value_expr} AS crm_name"

            where_clauses = []
            params: list[object] = []
            if not bool(_user.get("is_super_admin")) and str(_user.get("access_scope") or "").strip().lower() == "linked_clients":
                linked_client_ids = sorted(
                    {
                        int(client_id)
                        for client_id in (_user.get("linked_client_ids") or [])
                        if client_id is not None
                    }
                )
                if not linked_client_ids:
                    return {"items": [], "limit": int(limit), "offset": int(offset), "total": 0}
                where_clauses.append(f"j.client_db_id IN ({','.join(['?'] * len(linked_client_ids))})")
                params.extend(linked_client_ids)

            if query:
                if db_backend() == "postgres":
                    where_clauses.append(
                        "(j.job_number ILIKE ? OR j.title ILIKE ? OR c.client_name ILIKE ?)"
                    )
                    like = f"%{query}%"
                    params.extend([like, like, like])
                else:
                    where_clauses.append(
                        "(lower(coalesce(j.job_number,'')) LIKE ? OR lower(coalesce(j.title,'')) LIKE ? OR lower(coalesce(c.client_name,'')) LIKE ?)"
                    )
                    like = f"%{query.lower()}%"
                    params.extend([like, like, like])

            if crm_filter:
                if db_backend() == "postgres":
                    where_clauses.append(f"{crm_name_value_expr} ILIKE ?")
                    params.append(f"%{crm_filter}%")
                else:
                    where_clauses.append(f"lower(coalesce({crm_name_value_expr},'')) LIKE ?")
                    params.append(f"%{crm_filter.lower()}%")

            where_sql = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""

            total_row = con.execute(
                f"""
                SELECT COUNT(*)
                FROM jobs j
                JOIN clients c ON c.db_id = j.client_db_id
                {where_sql}
                """,
                params,
            ).fetchone()

            job_plan_join_sql = ""
            job_plan_select_sql = ""
            milestone_sort_expr = "2 AS milestone_sort_rank"
            if has_job_plan:
                job_plan_join_sql = "LEFT JOIN job_plan jp ON jp.job_id = j.job_id"
                job_plan_select_sql = """
                               , jp.data_collection_due, jp.data_collection_completed_at
                               , jp.first_draft_due, jp.first_draft_completed_at
                               , jp.final_report_due, jp.final_report_completed_at
                """
                if db_backend() == "postgres":
                    milestone_sort_expr = """
                        CASE
                            WHEN (
                                (jp.data_collection_due IS NOT NULL AND jp.data_collection_completed_at IS NULL AND jp.data_collection_due < (CURRENT_DATE - INTERVAL '1 day'))
                                OR (jp.first_draft_due IS NOT NULL AND jp.first_draft_completed_at IS NULL AND jp.first_draft_due < (CURRENT_DATE - INTERVAL '1 day'))
                                OR (jp.final_report_due IS NOT NULL AND jp.final_report_completed_at IS NULL AND jp.final_report_due < (CURRENT_DATE - INTERVAL '1 day'))
                            ) THEN 0
                            WHEN (
                                (jp.data_collection_due IS NOT NULL AND jp.data_collection_completed_at IS NULL AND jp.data_collection_due <= (CURRENT_DATE + INTERVAL '7 day'))
                                OR (jp.first_draft_due IS NOT NULL AND jp.first_draft_completed_at IS NULL AND jp.first_draft_due <= (CURRENT_DATE + INTERVAL '7 day'))
                                OR (jp.final_report_due IS NOT NULL AND jp.final_report_completed_at IS NULL AND jp.final_report_due <= (CURRENT_DATE + INTERVAL '7 day'))
                            ) THEN 1
                            ELSE 2
                        END AS milestone_sort_rank
                    """
                else:
                    milestone_sort_expr = """
                        CASE
                            WHEN (
                                (jp.data_collection_due IS NOT NULL AND jp.data_collection_completed_at IS NULL AND DATE(jp.data_collection_due) < DATE('now', '-1 day'))
                                OR (jp.first_draft_due IS NOT NULL AND jp.first_draft_completed_at IS NULL AND DATE(jp.first_draft_due) < DATE('now', '-1 day'))
                                OR (jp.final_report_due IS NOT NULL AND jp.final_report_completed_at IS NULL AND DATE(jp.final_report_due) < DATE('now', '-1 day'))
                            ) THEN 0
                            WHEN (
                                (jp.data_collection_due IS NOT NULL AND jp.data_collection_completed_at IS NULL AND DATE(jp.data_collection_due) <= DATE('now', '+7 day'))
                                OR (jp.first_draft_due IS NOT NULL AND jp.first_draft_completed_at IS NULL AND DATE(jp.first_draft_due) <= DATE('now', '+7 day'))
                                OR (jp.final_report_due IS NOT NULL AND jp.final_report_completed_at IS NULL AND DATE(jp.final_report_due) <= DATE('now', '+7 day'))
                            ) THEN 1
                            ELSE 2
                        END AS milestone_sort_rank
                    """

            rows = (
                con.execute(
                    f"""
                    SELECT j.job_id, j.job_number, j.title, j.reporting_year,
                           {reporting_period_start_expr}, {reporting_period_end_expr}, {is_benchmark_expr},
                           j.status, j.client_db_id, c.client_name, {crm_name_expr}, {due_date_expr},
                           {milestone_sort_expr}
                           {job_plan_select_sql}
                    FROM jobs j
                    JOIN clients c ON c.db_id = j.client_db_id
                    {job_plan_join_sql}
                    {where_sql}
                    ORDER BY milestone_sort_rank ASC, COALESCE(j.job_number, '') DESC, j.job_id DESC
                    LIMIT ? OFFSET ?
                    """,
                    [*params, int(limit), int(offset)],
                )
                .df()
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"/jobs failed: {e}")

    # Helper function to calculate milestone status
    def get_milestone_status(due_date, completed_at):
        """Calculate traffic light status: green, amber, red, completed"""
        from datetime import date
        import pandas as pd

        if completed_at is not None and not pd.isna(completed_at):
            return "completed"
        if due_date is None or pd.isna(due_date):
            return "green"

        # Handle pandas/python datetime values safely.
        if hasattr(due_date, "date"):
            due_date = due_date.date()

        today = date.today()
        days_until_due = (due_date - today).days

        if days_until_due < -1:  # Overdue by more than 1 day
            return "red"
        elif days_until_due <= 7:  # Due within 7 days or 1 day overdue
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

            items: list[dict[str, object]] = []
    if rows is not None and (not rows.empty):
        for _, r in rows.iterrows():
            # Calculate individual milestone statuses
            milestone_statuses = []
            if r.get("data_collection_due"):
                milestone_statuses.append(get_milestone_status(r.get("data_collection_due"), r.get("data_collection_completed_at")))
            if r.get("first_draft_due"):
                milestone_statuses.append(get_milestone_status(r.get("first_draft_due"), r.get("first_draft_completed_at")))
            if r.get("final_report_due"):
                milestone_statuses.append(get_milestone_status(r.get("final_report_due"), r.get("final_report_completed_at")))
            
            # Calculate overall status
            overall_milestone_status = get_overall_status(milestone_statuses) if milestone_statuses else None
            
            items.append(
                {
                    "job_id": int(r.get("job_id")),
                    "job_number": _json_null_if_na(r.get("job_number")),
                    "title": _json_null_if_na(r.get("title")),
                    "reporting_year": (
                        int(r.get("reporting_period_end").year)
                        if r.get("reporting_period_end") is not None and hasattr(r.get("reporting_period_end"), "year")
                        else (
                            int(r.get("reporting_year"))
                            if _json_null_if_na(r.get("reporting_year")) is not None
                            else None
                        )
                    ),
                    "reporting_period_start": (
                        str(r.get("reporting_period_start"))
                        if _json_null_if_na(r.get("reporting_period_start")) is not None
                        else None
                    ),
                    "reporting_period_end": (
                        str(r.get("reporting_period_end"))
                        if _json_null_if_na(r.get("reporting_period_end")) is not None
                        else None
                    ),
                    "is_benchmark": (
                        bool(r.get("is_benchmark"))
                        if _json_null_if_na(r.get("is_benchmark")) is not None
                        else None
                    ),
                    "status": _json_null_if_na(r.get("status")),
                    "client_db_id": int(r.get("client_db_id")),
                    "client_name": _json_null_if_na(r.get("client_name")),
                    "crm_name": _json_null_if_na(r.get("crm_name")),
                    "due_date": (
                        str(r.get("due_date"))
                        if _json_null_if_na(r.get("due_date")) is not None
                        else None
                    ),
                    "milestone_status": overall_milestone_status,
                }
            )

    # Sort by milestone status priority: red > amber > green > None/completed
    def status_priority(item):
        status = item.get("milestone_status")
        if status == "red":
            return 0
        elif status == "amber":
            return 1
        elif status == "green":
            return 2
        else:
            return 3
    
    items.sort(key=status_priority)

    total = int(total_row[0] if total_row else 0)
    return {"items": items, "limit": int(limit), "offset": int(offset), "total": total}


@router.get("/jobs/{job_id}")
def get_job(job_id: int, _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.view")
    try:
        with get_conn() as con:
            _ensure_job_original_portfolio_column(con)
            assert_job_access(_user, int(job_id))

            def _table_exists(table_name: str) -> bool:
                row = con.execute(
                    """
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = ?
                    LIMIT 1
                    """,
                    [table_name],
                ).fetchone()
                return bool(row)

            def _col_exists(table_name: str, col_name: str) -> bool:
                row = con.execute(
                    """
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = ? AND column_name = ?
                    LIMIT 1
                    """,
                    [table_name, col_name],
                ).fetchone()
                return bool(row)

            reporting_period_start_expr = "j.reporting_period_start" if _col_exists("jobs", "reporting_period_start") else "NULL::date AS reporting_period_start"
            reporting_period_end_expr = "j.reporting_period_end" if _col_exists("jobs", "reporting_period_end") else "NULL::date AS reporting_period_end"
            is_benchmark_expr = "j.is_benchmark" if _col_exists("jobs", "is_benchmark") else "NULL::boolean AS is_benchmark"
            milestone_template_expr = "j.milestone_template_id" if _col_exists("jobs", "milestone_template_id") else "NULL::integer AS milestone_template_id"
            crm_name_expr = "j.crm_name" if _col_exists("jobs", "crm_name") else "NULL::text AS crm_name"
            crm_owner_expr = "c.crm_owner" if _col_exists("clients", "crm_owner") else "NULL::text AS crm_owner"
            legacy_job_no_expr = "j.legacy_job_no" if _col_exists("jobs", "legacy_job_no") else "NULL::text AS legacy_job_no"
            job_template_expr = "j.job_template_id" if _col_exists("jobs", "job_template_id") else "NULL::integer AS job_template_id"
            has_job_types_table = _table_exists("job_types")
            job_type_name_expr = "jt.name" if has_job_types_table else "NULL::text AS job_type"
            original_portfolio_expr = "COALESCE(j.original_portfolio, 'NZI')" if _col_exists("jobs", "original_portfolio") else "'NZI'::text AS original_portfolio"

            row = con.execute(
                f"""
                SELECT j.job_id, j.job_number, j.title, j.reporting_year,
                       {reporting_period_start_expr}, {reporting_period_end_expr}, {is_benchmark_expr},
                       j.status, {job_template_expr}, {milestone_template_expr},
                       j.client_db_id, c.client_name,
                       {crm_name_expr}, j.start_date, j.due_date, {legacy_job_no_expr},
                       {job_type_name_expr},
                       j.job_type_id,
                       {original_portfolio_expr}
                FROM jobs j
                LEFT JOIN clients c ON c.db_id = j.client_db_id
                {"LEFT JOIN job_types jt ON jt.job_type_id = j.job_type_id" if has_job_types_table else ""}
                WHERE j.job_id=?
                """,
                [int(job_id)],
            ).fetchone()
        
            if not row:
                raise HTTPException(status_code=404, detail="Job not found")
        
            # Try to get estimated_hours from job_types if the column exists
            estimated_hours = 0
            if row[16] and _col_exists("job_types", "estimated_hours"):  # job_type_id (17th column, 0-indexed)
                try:
                    jt_row = con.execute(
                        "SELECT estimated_hours FROM job_types WHERE job_type_id=?",
                        [row[16]]
                    ).fetchone()
                    if jt_row and jt_row[0] is not None:
                        estimated_hours = float(jt_row[0])
                except Exception:
                    pass  # Column might not exist yet

            # Fetch milestones with completion status
            milestones = None
            if _table_exists("job_plan"):
                milestone_completion_columns = [
                    "data_collection_completed_at",
                    "data_collection_completed_by",
                    "first_draft_completed_at",
                    "first_draft_completed_by",
                    "final_report_completed_at",
                    "final_report_completed_by",
                ]
                has_completion_columns = all(_col_exists("job_plan", col) for col in milestone_completion_columns)

                if has_completion_columns:
                    milestones = con.execute(
                        """
                        SELECT data_collection_due, first_draft_due, final_report_due,
                               data_collection_completed_at, data_collection_completed_by,
                               first_draft_completed_at, first_draft_completed_by,
                               final_report_completed_at, final_report_completed_by
                        FROM job_plan
                        WHERE job_id=?
                        """,
                        [int(job_id)],
                    ).fetchone()
                else:
                    milestones = con.execute(
                        """
                        SELECT data_collection_due, first_draft_due, final_report_due,
                               NULL AS data_collection_completed_at, NULL AS data_collection_completed_by,
                               NULL AS first_draft_completed_at, NULL AS first_draft_completed_by,
                               NULL AS final_report_completed_at, NULL AS final_report_completed_by
                        FROM job_plan
                        WHERE job_id=?
                        """,
                        [int(job_id)],
                    ).fetchone()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load job detail: {e}")

    (
        jid,
        job_number,
        title,
        reporting_year,
        reporting_period_start,
        reporting_period_end,
        is_benchmark,
        status,
        job_template_id,
        milestone_template_id,
        client_db_id,
        client_name,
        crm_name,
        start_date,
        due_date,
        legacy_job_no,
        job_type,
        job_type_id,
        original_portfolio,
    ) = row

    # Calculate traffic light status for each milestone
    def get_milestone_status(due_date, completed_at):
        """Calculate traffic light status: green, amber, red"""
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
    
    milestone_data = {}
    if milestones:
        milestone_data = {
            "data_collection_due": str(milestones[0]) if milestones[0] else None,
            "data_collection_completed_at": str(milestones[3]) if milestones[3] else None,
            "data_collection_completed_by": milestones[4] if milestones[4] else None,
            "data_collection_status": get_milestone_status(milestones[0], milestones[3]),
            "first_draft_due": str(milestones[1]) if milestones[1] else None,
            "first_draft_completed_at": str(milestones[5]) if milestones[5] else None,
            "first_draft_completed_by": milestones[6] if milestones[6] else None,
            "first_draft_status": get_milestone_status(milestones[1], milestones[5]),
            "final_report_due": str(milestones[2]) if milestones[2] else None,
            "final_report_completed_at": str(milestones[7]) if milestones[7] else None,
            "final_report_completed_by": milestones[8] if milestones[8] else None,
            "final_report_status": get_milestone_status(milestones[2], milestones[7]),
        }

    return {
        "job_id": int(jid),
        "job_number": job_number,
        "title": title,
        "reporting_year": (int(reporting_year) if reporting_year is not None else None),
        "reporting_period_start": (str(reporting_period_start) if reporting_period_start else None),
        "reporting_period_end": (str(reporting_period_end) if reporting_period_end else None),
        "is_benchmark": bool(is_benchmark) if is_benchmark is not None else False,
        "status": status,
        "job_template_id": (int(job_template_id) if job_template_id is not None else None),
        "milestone_template_id": (int(milestone_template_id) if milestone_template_id is not None else None),
        "client_db_id": (int(client_db_id) if client_db_id is not None else None),
        "client_name": client_name,
        "crm_name": crm_name,
        "start_date": (str(start_date) if start_date else None),
        "due_date": (str(due_date) if due_date else None),
        "legacy_job_no": legacy_job_no,
        "job_type": job_type,
        "job_type_id": (int(job_type_id) if job_type_id is not None else None),
        "original_portfolio": str(original_portfolio or "NZI").strip() or "NZI",
        "estimated_hours": estimated_hours,
        **milestone_data,
    }


@router.patch("/jobs/{job_id}")
def update_job(
    request: Request,
    job_id: int,
    body: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user)
):
    """Update job fields including reporting period."""
    try:
        assert_permission(_user, "jobs.edit")
        assert_job_access(_user, int(job_id))
        with get_conn() as con:
            _ensure_job_original_portfolio_column(con)
            before = _job_audit_snapshot(con, int(job_id))
            # Check job exists
            exists = con.execute("SELECT 1 FROM jobs WHERE job_id = ?", [int(job_id)]).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="Job not found")
            
            # Build update query dynamically based on provided fields
            updates = []
            params = []
            
            if "reporting_period_start" in body:
                updates.append("reporting_period_start = ?")
                params.append(body["reporting_period_start"])
            
            if "reporting_period_end" in body:
                updates.append("reporting_period_end = ?")
                params.append(body["reporting_period_end"])
            
            if "title" in body:
                updates.append("title = ?")
                params.append(body["title"])
            
            if "status" in body:
                updates.append("status = ?")
                params.append(body["status"])
            
            if "crm_name" in body:
                updates.append("crm_name = ?")
                params.append(body["crm_name"])
            
            if "start_date" in body:
                updates.append("start_date = ?")
                params.append(body["start_date"])
            
            if "due_date" in body:
                updates.append("due_date = ?")
                params.append(body["due_date"])
            
            if "legacy_job_no" in body:
                updates.append("legacy_job_no = ?")
                params.append(body["legacy_job_no"])

            if "original_portfolio" in body:
                original_portfolio = str(body.get("original_portfolio") or "NZI").strip() or "NZI"
                updates.append("original_portfolio = ?")
                params.append(original_portfolio)

            if "job_type" in body:
                job_type_name = str(body.get("job_type") or "").strip()
                if not job_type_name:
                    raise HTTPException(status_code=400, detail="job_type is required")
                job_type_row = con.execute(
                    "SELECT job_type_id, is_crp FROM job_types WHERE name = ? AND is_active = TRUE",
                    [job_type_name],
                ).fetchone()
                if not job_type_row:
                    raise HTTPException(status_code=400, detail=f"Job type '{job_type_name}' not found or inactive")
                updates.append("job_type_id = ?")
                params.append(int(job_type_row[0]))
                updates.append("job_type = ?")
                params.append(job_type_name)
                updates.append("is_crp = ?")
                params.append(bool(job_type_row[1]) if job_type_row[1] is not None else False)

            if "milestone_template_id" in body:
                updates.append("milestone_template_id = ?")
                params.append(body["milestone_template_id"])
            
            if not updates:
                return {"ok": True, "message": "No fields to update"}
            
            params.append(int(job_id))
            query = f"UPDATE jobs SET {', '.join(updates)} WHERE job_id = ?"
            
            con.execute(query, params)
            after = _job_audit_snapshot(con, int(job_id))
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="update",
                entity_type="job",
                entity_id=int(job_id),
                client_id=int(after.get("client_db_id")) if after and after.get("client_db_id") is not None else None,
                job_id=int(job_id),
                before=before,
                after=after,
                metadata={"updated_fields": list(body.keys())},
            )
            
            # Auto-create/update milestones if anchor-driving fields changed:
            # - start_date
            # - reporting_period_start
            # - milestone template
            if ("start_date" in body) or ("reporting_period_start" in body) or ("milestone_template_id" in body):
                from datetime import datetime, timedelta

                def _to_date(value):
                    if value is None:
                        return None
                    if hasattr(value, "date"):
                        try:
                            return value.date()
                        except Exception:
                            pass
                    if hasattr(value, "year") and hasattr(value, "month") and hasattr(value, "day"):
                        return value
                    try:
                        return datetime.strptime(str(value), "%Y-%m-%d").date()
                    except Exception:
                        return None

                # Get both start_date and reporting_period_start from body (if provided) or DB.
                if "start_date" in body:
                    start_date = _to_date(body.get("start_date"))
                else:
                    start_date = None

                if "reporting_period_start" in body:
                    reporting_period_start = _to_date(body.get("reporting_period_start"))
                else:
                    reporting_period_start = None

                if start_date is None or reporting_period_start is None:
                    job_data = con.execute(
                        "SELECT start_date, reporting_period_start FROM jobs WHERE job_id = ?",
                        [int(job_id)]
                    ).fetchone()
                    if job_data:
                        if start_date is None:
                            start_date = _to_date(job_data[0])
                        if reporting_period_start is None:
                            reporting_period_start = _to_date(job_data[1])

                # Anchor logic:
                # - Use Job Start Date by default
                # - If Reporting Period Start is later, use that instead
                # - If one is missing, use the available date
                anchor_date = None
                if start_date and reporting_period_start:
                    anchor_date = reporting_period_start if reporting_period_start > start_date else start_date
                else:
                    anchor_date = start_date or reporting_period_start

                if anchor_date is None:
                    return {"ok": True, "message": "Job updated successfully"}
                
                # Get the milestone template for this job (or use default)
                job_template = con.execute(
                    "SELECT milestone_template_id FROM jobs WHERE job_id = ?",
                    [int(job_id)]
                ).fetchone()
                
                template_id = job_template[0] if job_template and job_template[0] else None
                
                # If no template assigned, get the default template
                if not template_id:
                    default_template = con.execute(
                        "SELECT template_id FROM milestone_templates WHERE is_default = TRUE LIMIT 1"
                    ).fetchone()
                    template_id = default_template[0] if default_template else None
                
                if template_id:
                    # Get milestone items from template
                    milestone_items_df = con.execute(
                        """
                        SELECT milestone_name, days_offset, sort_order
                        FROM milestone_template_items
                        WHERE template_id = %s
                        ORDER BY sort_order
                        """,
                        [template_id]
                    ).df()
                    
                    if not milestone_items_df.empty:
                        # For backward compatibility, map to job_plan table
                        # Assuming first 3 items map to data_collection, first_draft, final_report
                        milestones = {}
                        for idx, row in enumerate(milestone_items_df.head(3).iterrows()):
                            item = row[1]  # row is (index, data)
                            milestone_date = anchor_date + timedelta(days=int(item['days_offset']))
                            if idx == 0:
                                milestones['data_collection_due'] = milestone_date
                            elif idx == 1:
                                milestones['first_draft_due'] = milestone_date
                            elif idx == 2:
                                milestones['final_report_due'] = milestone_date
                        
                        # Check if job_plan exists
                        plan_exists = con.execute(
                            "SELECT 1 FROM job_plan WHERE job_id = ?",
                            [int(job_id)]
                        ).fetchone()
                        
                        if plan_exists:
                            # Update only if override_dates is False
                            con.execute(
                                """
                                UPDATE job_plan
                                SET data_collection_due = %s,
                                    first_draft_due = %s,
                                    final_report_due = %s,
                                    updated_at = CURRENT_TIMESTAMP
                                WHERE job_id = %s AND (override_dates = FALSE OR override_dates IS NULL)
                                """,
                                [
                                    milestones.get('data_collection_due'),
                                    milestones.get('first_draft_due'),
                                    milestones.get('final_report_due'),
                                    int(job_id)
                                ]
                            )
                        else:
                            # Create new job_plan entry
                            con.execute(
                                """
                                INSERT INTO job_plan (job_id, data_collection_due, first_draft_due, final_report_due, override_dates, updated_at)
                                VALUES (%s, %s, %s, %s, FALSE, CURRENT_TIMESTAMP)
                                """,
                                [
                                    int(job_id),
                                    milestones.get('data_collection_due'),
                                    milestones.get('first_draft_due'),
                                    milestones.get('final_report_due')
                                ]
                            )
            
            return {"ok": True, "message": "Job updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Update failed: {e}")


@router.post("/jobs/{job_id}/milestones/{milestone_type}/complete")
def complete_milestone(
    job_id: int,
    milestone_type: str,
    body: dict = Body(...),
    user: dict[str, str] = Depends(_current_user)
):
    """Mark a milestone as complete or incomplete"""
    try:
        # Validate milestone type
        valid_types = ["data_collection", "first_draft", "final_report"]
        if milestone_type not in valid_types:
            raise HTTPException(status_code=400, detail=f"Invalid milestone type. Must be one of: {valid_types}")
        
        completed = body.get("completed", True)
        
        with get_conn() as con:
            # Check if job_plan exists
            plan_exists = con.execute(
                "SELECT 1 FROM job_plan WHERE job_id = %s",
                [int(job_id)]
            ).fetchone()
            
            if not plan_exists:
                raise HTTPException(status_code=404, detail="Job plan not found")
            
            # Update completion status
            if completed:
                # Mark as complete with timestamp and user
                from datetime import datetime
                query = f"""
                    UPDATE job_plan
                    SET {milestone_type}_completed_at = %s,
                        {milestone_type}_completed_by = %s,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE job_id = %s
                """
                con.execute(query, [datetime.now(), user.get("email", "unknown"), int(job_id)])
            else:
                # Mark as incomplete (clear timestamp and user)
                query = f"""
                    UPDATE job_plan
                    SET {milestone_type}_completed_at = NULL,
                        {milestone_type}_completed_by = NULL,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE job_id = %s
                """
                con.execute(query, [int(job_id)])
            
            return {"ok": True, "message": f"Milestone {milestone_type} marked as {'complete' if completed else 'incomplete'}"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update milestone: {e}")


