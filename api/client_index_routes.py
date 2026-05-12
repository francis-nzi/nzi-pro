from __future__ import annotations

from datetime import date

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query

from api.auth import _current_user
from api.client_route_helpers import ensure_client_org_columns
from api.permissions import assert_client_access, assert_permission
from core.database import db_backend, get_conn
from services.tenancy import require_org

router = APIRouter()


def _json_null_if_na(value):
    try:
        return None if pd.isna(value) else value
    except Exception:
        return value


@router.get("/clients")
def list_clients(
    q: str | None = None,
    industry: str | None = None,
    status: str | None = None,
    crm_owner: str | None = None,
    risk: str | None = None,
    include_archived: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    sort_by: str = Query("client"),
    sort_dir: str = Query("asc"),
    _user: dict[str, str] = Depends(_current_user),
):
    assert_permission(_user, "clients.view")
    org_id = require_org(_user)
    query = (q or "").strip()
    org_placeholder = "%s" if db_backend() == "postgres" else "?"

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

    def _normalize_filter_value(value: object, fallback: str) -> str:
        text = str(value or "").strip()
        return text if text else fallback

    def _normalize_lookup_value(value: object) -> str:
        return str(value or "").strip().lower()

    def _client_visibility_clause() -> tuple[str, list[object]]:
        if not org_id:
            return "", []

        params: list[object] = [org_id, org_id]
        clause = (
            f"(c.org_id = {org_placeholder} "
            f"OR EXISTS (SELECT 1 FROM jobs j WHERE j.client_db_id = c.db_id AND j.org_id = {org_placeholder})"
        )
        clause += ")"
        return clause, params

    try:
        with get_conn() as con:
            ensure_client_org_columns(con)
            has_industry = _col_exists(con, "clients", "industry")
            has_status = _col_exists(con, "clients", "status")
            has_crm_owner = _col_exists(con, "clients", "crm_owner")

            where_clauses: list[str] = []
            params: list[object] = []
            visibility_clause, visibility_params = _client_visibility_clause()
            if visibility_clause:
                where_clauses.append(visibility_clause)
                params.extend(visibility_params)
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
                where_clauses.append(f"c.db_id IN ({','.join(['%s'] * len(linked_client_ids))})")
                params.extend(linked_client_ids)
            if not include_archived and has_status:
                where_clauses.append("(c.status IS NULL OR lower(c.status) <> 'archived')")

            if query:
                if db_backend() == "postgres":
                    if has_industry:
                        where_clauses.append("(c.client_name ILIKE %s OR c.industry ILIKE %s)")
                        like = f"%{query}%"
                        params.extend([like, like])
                    else:
                        where_clauses.append("c.client_name ILIKE %s")
                        params.append(f"%{query}%")
                else:
                    if has_industry:
                        where_clauses.append("(lower(coalesce(c.client_name,'')) LIKE %s OR lower(coalesce(c.industry,'')) LIKE %s)")
                        like = f"%{query.lower()}%"
                        params.extend([like, like])
                    else:
                        where_clauses.append("lower(coalesce(c.client_name,'')) LIKE %s")
                        params.append(f"%{query.lower()}%")
            where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

            total_row = con.execute(
                f"""
                SELECT COUNT(*)
                FROM clients c
                {where_sql}
                """,
                params,
            ).fetchone()

            industry_col = "c.industry" if has_industry else "NULL::text as industry"
            status_col = "c.status" if has_status else "NULL::text as status"
            crm_col = "c.crm_owner" if has_crm_owner else "NULL::text as crm_owner"

            rows = (
                con.execute(
                    f"""
                    SELECT c.db_id as client_db_id,
                           c.client_name,
                           {industry_col},
                           {status_col},
                           {crm_col}
                    FROM clients c
                    {where_sql}
                    ORDER BY LOWER(COALESCE(c.client_name, '')) ASC, c.db_id ASC
                    """,
                    params,
                )
                .df()
            )

            milestone_data = None
            if rows is not None and not rows.empty:
                client_ids = [int(r["client_db_id"]) for _, r in rows.iterrows()]
                try:
                    milestone_data = con.execute(
                        f"""
                        SELECT 
                            j.client_db_id,
                            jp.data_collection_due, jp.data_collection_completed_at,
                            jp.first_draft_due, jp.first_draft_completed_at,
                            jp.final_report_due, jp.final_report_completed_at
                        FROM jobs j
                        LEFT JOIN job_plan jp ON jp.job_id = j.job_id
                        WHERE j.client_db_id IN ({','.join(['%s'] * len(client_ids))})
                        """,
                        client_ids,
                    ).df()
                except Exception:
                    milestone_data = None
    except Exception as e:
        # Final defensive fallback for schema drift: return a minimal list instead of 500.
        try:
            with get_conn() as con:
                where_clauses = []
                params: list[object] = []
                visibility_clause, visibility_params = _client_visibility_clause()
                if visibility_clause:
                    where_clauses.append(visibility_clause)
                    params.extend(visibility_params)
                if query:
                    where_clauses.append("c.client_name ILIKE %s")
                    params.append(f"%{query}%")
                where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

                total_row = con.execute(
                    f"SELECT COUNT(*) FROM clients c {where_sql}",
                    params,
                ).fetchone()
                rows = (
                    con.execute(
                        f"""
                        SELECT c.db_id as client_db_id,
                               c.client_name,
                               NULL::text as industry,
                               NULL::text as status,
                               NULL::text as crm_owner
                        FROM clients c
                        {where_sql}
                        ORDER BY LOWER(COALESCE(c.client_name, '')) ASC, c.db_id ASC
                        """,
                        params,
                    )
                    .df()
                )
                milestone_data = None
        except Exception:
            raise HTTPException(status_code=500, detail=f"/clients failed: {e}")

    # Helper function to calculate milestone status
    def get_milestone_status(due_date, completed_at):
        """Calculate traffic light status: green, amber, red, completed"""
        from datetime import date as _date
        import pandas as pd

        if completed_at is not None and not pd.isna(completed_at):
            return "completed"
        if due_date is None or pd.isna(due_date):
            return "green"

        # Handle pandas/python datetime values safely.
        if hasattr(due_date, "date"):
            due_date = due_date.date()

        today = _date.today()
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

    # Calculate milestone status for each client
    client_milestone_status = {}
    if rows is not None and not rows.empty and 'milestone_data' in locals() and milestone_data is not None and not milestone_data.empty:
        for client_id in client_ids:
            client_jobs = milestone_data[milestone_data['client_db_id'] == client_id]
            all_statuses = []

            for _, job in client_jobs.iterrows():
                job_statuses = []
                if job.get("data_collection_due"):
                    job_statuses.append(get_milestone_status(job.get("data_collection_due"), job.get("data_collection_completed_at")))
                if job.get("first_draft_due"):
                    job_statuses.append(get_milestone_status(job.get("first_draft_due"), job.get("first_draft_completed_at")))
                if job.get("final_report_due"):
                    job_statuses.append(get_milestone_status(job.get("final_report_due"), job.get("final_report_completed_at")))

                if job_statuses:
                    all_statuses.extend(job_statuses)

            if all_statuses:
                client_milestone_status[client_id] = get_overall_status(all_statuses)
            else:
                client_milestone_status[client_id] = None

    items: list[dict[str, object]] = []
    facet_industries: dict[str, int] = {}
    facet_statuses: dict[str, int] = {}
    facet_owners: dict[str, int] = {}
    facet_risks: dict[str, int] = {}
    if rows is not None and (not rows.empty):
        for _, r in rows.iterrows():
            client_id = int(r.get("client_db_id"))
            industry_value = _normalize_filter_value(_json_null_if_na(r.get("industry")), "Unspecified")
            status_value = _normalize_filter_value(_json_null_if_na(r.get("status")), "Unspecified")
            owner_value = _normalize_filter_value(_json_null_if_na(r.get("crm_owner")), "Unassigned")
            risk_value = _normalize_filter_value(client_milestone_status.get(client_id) or "green", "green")
            risk_label = "Overdue" if risk_value == "red" else "Due" if risk_value == "amber" else "Healthy"

            facet_industries[industry_value] = facet_industries.get(industry_value, 0) + 1
            facet_statuses[status_value] = facet_statuses.get(status_value, 0) + 1
            facet_owners[owner_value] = facet_owners.get(owner_value, 0) + 1
            facet_risks[risk_label] = facet_risks.get(risk_label, 0) + 1

            items.append(
                {
                    "client_db_id": client_id,
                    "client_name": _json_null_if_na(r.get("client_name")),
                    "industry": industry_value,
                    "status": status_value,
                    "crm_owner": owner_value,
                    "milestone_status": _json_null_if_na(client_milestone_status.get(client_id)),
                }
            )

        def matches_filters(item: dict[str, object]) -> bool:
            if industry and _normalize_lookup_value(item.get("industry")) != _normalize_lookup_value(industry):
                return False
            if status and _normalize_lookup_value(item.get("status")) != _normalize_lookup_value(status):
                return False
            if crm_owner and _normalize_lookup_value(item.get("crm_owner")) != _normalize_lookup_value(crm_owner):
                return False
            if risk:
                item_risk = item.get("milestone_status")
                risk_label = "Overdue" if item_risk == "red" else "Due" if item_risk == "amber" else "Healthy"
                if _normalize_lookup_value(risk_label) != _normalize_lookup_value(risk):
                    return False
            return True

        items = [item for item in items if matches_filters(item)]

    def sort_value(item: dict[str, object]):
        key = (sort_by or "client").strip().lower()
        if key == "industry":
            return _normalize_lookup_value(item.get("industry"))
        if key == "status":
            return _normalize_lookup_value(item.get("status"))
        if key == "owner":
            return _normalize_lookup_value(item.get("crm_owner"))
        if key == "risk":
            status = item.get("milestone_status")
            return 0 if status == "red" else 1 if status == "amber" else 2
        return _normalize_lookup_value(item.get("client_name"))

    reverse = str(sort_dir or "asc").strip().lower() == "desc"
    items.sort(key=sort_value, reverse=reverse)

    total = len(items)
    start = int(offset)
    end = start + int(limit)
    page_items = items[start:end]

    facet_payload = {
        "industries": [{"value": key, "count": count} for key, count in sorted(facet_industries.items(), key=lambda kv: (-kv[1], kv[0].lower()))],
        "statuses": [{"value": key, "count": count} for key, count in sorted(facet_statuses.items(), key=lambda kv: (-kv[1], kv[0].lower()))],
        "owners": [{"value": key, "count": count} for key, count in sorted(facet_owners.items(), key=lambda kv: (-kv[1], kv[0].lower()))],
        "risks": [{"value": key, "count": count} for key, count in sorted(facet_risks.items(), key=lambda kv: (-kv[1], kv[0].lower()))],
    }

    return {
        "items": page_items,
        "limit": int(limit),
        "offset": int(offset),
        "total": total,
        "facets": facet_payload,
    }


@router.get("/clients/{client_db_id}/jobs")
def client_jobs(
    client_db_id: int,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _user: dict[str, str] = Depends(_current_user),
):
    try:
        assert_permission(_user, "jobs.view")
        assert_client_access(_user, int(client_db_id))
        with get_conn() as con:
            try:
                total_row = con.execute(
                    """
                    SELECT COUNT(*)
                    FROM jobs j
                    WHERE j.client_db_id = ?
                    """,
                    [int(client_db_id)],
                ).fetchone()
                rows = (
                    con.execute(
                        """
                        SELECT j.job_id, j.job_number, j.title, j.reporting_year, j.status,
                               j.job_type, j.is_crp, j.reporting_period_end
                        FROM jobs j
                        WHERE j.client_db_id = ?
                        ORDER BY j.job_type, j.reporting_year DESC, j.job_id DESC
                        LIMIT ? OFFSET ?
                        """,
                        [int(client_db_id), int(limit), int(offset)],
                    )
                    .df()
                )
            except Exception:
                total_row = (0,)
                rows = pd.DataFrame()
    except Exception:
        total_row = (0,)
        rows = pd.DataFrame()

    def _is_missing(value) -> bool:
        try:
            return pd.isna(value)
        except Exception:
            return value is None

    def _int_or_none(value):
        if _is_missing(value):
            return None
        try:
            return int(value)
        except Exception:
            return None

    def _float_or_zero(value) -> float:
        if _is_missing(value):
            return 0.0
        try:
            out = float(value)
            return 0.0 if pd.isna(out) else out
        except Exception:
            return 0.0

    def _bool_or_false(value) -> bool:
        if _is_missing(value):
            return False
        try:
            return bool(value)
        except Exception:
            return False

    def _reporting_year_from_row(row) -> int | None:
        reporting_period_end = row.get("reporting_period_end")
        if not _is_missing(reporting_period_end):
            try:
                if hasattr(reporting_period_end, "year"):
                    return int(reporting_period_end.year)
            except Exception:
                pass
        return _int_or_none(row.get("reporting_year"))

    items: list[dict[str, object]] = []
    if rows is not None and (not rows.empty):
        for _, r in rows.iterrows():
            job_id = _int_or_none(r.get("job_id"))
            if job_id is None:
                continue

            items.append(
                {
                    "job_id": job_id,
                    "job_number": None if _is_missing(r.get("job_number")) else r.get("job_number"),
                    "title": None if _is_missing(r.get("title")) else r.get("title"),
                    "reporting_year": _reporting_year_from_row(r),
                    "status": None if _is_missing(r.get("status")) else r.get("status"),
                    "job_type": None if _is_missing(r.get("job_type")) else r.get("job_type"),
                    "is_crp": _bool_or_false(r.get("is_crp")),
                    "milestone_status": None,
                }
            )

    total = int(total_row[0] if total_row else 0)
    return {"client_db_id": int(client_db_id), "items": items, "limit": int(limit), "offset": int(offset), "total": total}
