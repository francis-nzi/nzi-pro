from __future__ import annotations

from datetime import date

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query

from api.auth import _current_user
from api.client_route_helpers import ensure_client_org_columns
from api.permissions import assert_client_access, assert_permission
from core.database import db_backend, get_conn
from services.emissions_reporting import exact_job_total_emissions
from services.portal_data_entry import ensure_portal_expiry_schema, max_portal_data_entry_override_date
from services.tenancy import require_org

router = APIRouter()


def _json_null_if_na(value):
    try:
        return None if pd.isna(value) else value
    except Exception:
        return value


_EMPTY_FACETS = {
    "industries": [], "statuses": [], "owners": [], "risks": [], "portfolios": [], "client_managers": [],
}

# Risk (traffic-light) SQL, mirroring the previous Python get_milestone_status/get_overall_status
# logic exactly: red if any incomplete milestone is more than 1 day overdue, else amber if any
# incomplete milestone is due within 7 days (including up to 1 day overdue), else green/NULL.
_RISK_CASE_SQL = """
    CASE
        WHEN bool_or(
            (jp.data_collection_completed_at IS NULL AND jp.data_collection_due IS NOT NULL AND jp.data_collection_due < (CURRENT_DATE - INTERVAL '1 day'))
            OR (jp.first_draft_completed_at IS NULL AND jp.first_draft_due IS NOT NULL AND jp.first_draft_due < (CURRENT_DATE - INTERVAL '1 day'))
            OR (jp.final_report_completed_at IS NULL AND jp.final_report_due IS NOT NULL AND jp.final_report_due < (CURRENT_DATE - INTERVAL '1 day'))
        ) THEN 'red'
        WHEN bool_or(
            (jp.data_collection_completed_at IS NULL AND jp.data_collection_due IS NOT NULL AND jp.data_collection_due <= (CURRENT_DATE + INTERVAL '7 day'))
            OR (jp.first_draft_completed_at IS NULL AND jp.first_draft_due IS NOT NULL AND jp.first_draft_due <= (CURRENT_DATE + INTERVAL '7 day'))
            OR (jp.final_report_completed_at IS NULL AND jp.final_report_due IS NOT NULL AND jp.final_report_due <= (CURRENT_DATE + INTERVAL '7 day'))
        ) THEN 'amber'
        ELSE 'green'
    END
"""


@router.get("/clients")
def list_clients(
    q: str | None = None,
    industry: str | None = None,
    status: str | None = None,
    crm_owner: str | None = None,
    client_manager: str | None = None,
    crm_person: str | None = None,
    risk: str | None = None,
    portfolio: str | None = None,
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

    def _col_exists_many(con, table_name: str, col_names: list[str]) -> set[str]:
        try:
            df = con.execute(
                f"""
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = {org_placeholder}
                  AND column_name IN ({','.join([org_placeholder] * len(col_names))})
                """,
                [table_name, *col_names],
            ).df()
            return set(df["column_name"].tolist()) if df is not None and not df.empty else set()
        except Exception:
            return set()

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
            existing_cols = _col_exists_many(
                con, "clients", ["industry", "status", "crm_owner", "portfolio", "client_manager"]
            )
            has_industry = "industry" in existing_cols
            has_status = "status" in existing_cols
            has_crm_owner = "crm_owner" in existing_cols
            has_portfolio = "portfolio" in existing_cols
            has_client_manager = "client_manager" in existing_cols

            industry_expr = "COALESCE(NULLIF(c.industry,''),'Unspecified')" if has_industry else "'Unspecified'"
            status_expr = "COALESCE(NULLIF(c.status,''),'Unspecified')" if has_status else "'Unspecified'"
            owner_expr = "COALESCE(NULLIF(c.crm_owner,''),'Unassigned')" if has_crm_owner else "'Unassigned'"
            portfolio_expr = "COALESCE(NULLIF(c.portfolio,''),'Unassigned')" if has_portfolio else "'Unassigned'"
            manager_expr = "NULLIF(c.client_manager,'')" if has_client_manager else "NULL::text"

            base_where: list[str] = []
            base_params: list[object] = []
            visibility_clause, visibility_params = _client_visibility_clause()
            if visibility_clause:
                base_where.append(visibility_clause)
                base_params.extend(visibility_params)
            if not bool(_user.get("is_super_admin")) and str(_user.get("access_scope") or "").strip().lower() == "linked_clients":
                linked_client_ids = sorted(
                    {int(cid) for cid in (_user.get("linked_client_ids") or []) if cid is not None}
                )
                if not linked_client_ids:
                    return {"items": [], "limit": int(limit), "offset": int(offset), "total": 0, "facets": _EMPTY_FACETS}
                base_where.append(f"c.db_id IN ({','.join(['%s'] * len(linked_client_ids))})")
                base_params.extend(linked_client_ids)
            if not include_archived and has_status:
                base_where.append("(c.status IS NULL OR lower(c.status) <> 'archived')")
            if query:
                if has_industry:
                    base_where.append("(c.client_name ILIKE %s OR c.industry ILIKE %s)")
                    like = f"%{query}%"
                    base_params.extend([like, like])
                else:
                    base_where.append("c.client_name ILIKE %s")
                    base_params.append(f"%{query}%")
            if client_manager and has_client_manager:
                base_where.append("c.client_manager ILIKE %s")
                base_params.append(f"%{client_manager}%")

            base_where_sql = f"WHERE {' AND '.join(base_where)}" if base_where else ""

            # `base` = every client visible to this user matching search/visibility/manager
            # filters only (mirrors the previous implementation's facet scope: facets reflect
            # what's available before the industry/status/owner/portfolio/risk drill-down).
            cte_sql = f"""
                WITH client_risk AS (
                    SELECT j.client_db_id, {_RISK_CASE_SQL} AS milestone_status
                    FROM jobs j
                    LEFT JOIN job_plan jp ON jp.job_id = j.job_id
                    GROUP BY j.client_db_id
                ),
                base AS (
                    SELECT
                        c.db_id AS client_db_id,
                        c.client_name,
                        {industry_expr} AS industry,
                        {status_expr} AS status,
                        {owner_expr} AS crm_owner,
                        {portfolio_expr} AS portfolio,
                        {manager_expr} AS client_manager,
                        cr.milestone_status AS milestone_status,
                        CASE cr.milestone_status WHEN 'red' THEN 'Overdue' WHEN 'amber' THEN 'Due' ELSE 'Healthy' END AS risk_label
                    FROM clients c
                    LEFT JOIN client_risk cr ON cr.client_db_id = c.db_id
                    {base_where_sql}
                )
            """

            facet_rows = con.execute(
                f"""
                {cte_sql}
                SELECT 'industry' AS dim, industry AS key, COUNT(*) AS n FROM base GROUP BY industry
                UNION ALL
                SELECT 'status', status, COUNT(*) FROM base GROUP BY status
                UNION ALL
                SELECT 'owner', crm_owner, COUNT(*) FROM base GROUP BY crm_owner
                UNION ALL
                SELECT 'portfolio', portfolio, COUNT(*) FROM base GROUP BY portfolio
                UNION ALL
                SELECT 'risk', risk_label, COUNT(*) FROM base GROUP BY risk_label
                UNION ALL
                SELECT 'manager', client_manager, COUNT(*) FROM base WHERE client_manager IS NOT NULL GROUP BY client_manager
                """,
                base_params,
            ).df()

            # Drill-down filters applied on top of `base` for the actual item list/count.
            item_where: list[str] = []
            item_params: list[object] = list(base_params)
            if industry:
                item_where.append("LOWER(TRIM(industry)) = LOWER(TRIM(%s))")
                item_params.append(industry)
            if status:
                item_where.append("LOWER(TRIM(status)) = LOWER(TRIM(%s))")
                item_params.append(status)
            if crm_owner:
                item_where.append("LOWER(TRIM(crm_owner)) = LOWER(TRIM(%s))")
                item_params.append(crm_owner)
            if crm_person:
                # "Is this my client" for a CRM's personal portfolio view -- most staff
                # are set up as client_manager rather than the formal crm_owner, so
                # match either instead of only the exact owner (unlike the crm_owner
                # facet filter above, which stays owner-only for precise drill-down).
                item_where.append("(LOWER(TRIM(crm_owner)) = LOWER(TRIM(%s)) OR LOWER(TRIM(COALESCE(client_manager, ''))) = LOWER(TRIM(%s)))")
                item_params.extend([crm_person, crm_person])
            if portfolio:
                item_where.append("LOWER(TRIM(portfolio)) = LOWER(TRIM(%s))")
                item_params.append(portfolio)
            if risk:
                item_where.append("LOWER(TRIM(risk_label)) = LOWER(TRIM(%s))")
                item_params.append(risk)
            item_where_sql = f"WHERE {' AND '.join(item_where)}" if item_where else ""

            total_row = con.execute(
                f"{cte_sql} SELECT COUNT(*) FROM base {item_where_sql}",
                item_params,
            ).fetchone()
            total = int(total_row[0] if total_row else 0)

            sort_col_map = {
                "industry": "industry",
                "status": "status",
                "owner": "crm_owner",
                "risk": "CASE risk_label WHEN 'Overdue' THEN 0 WHEN 'Due' THEN 1 ELSE 2 END",
            }
            sort_col = sort_col_map.get((sort_by or "client").strip().lower(), "LOWER(COALESCE(client_name,''))")
            sort_dir_sql = "DESC" if str(sort_dir or "asc").strip().lower() == "desc" else "ASC"

            page_df = con.execute(
                f"""
                {cte_sql}
                SELECT client_db_id, client_name, industry, status, crm_owner, portfolio, client_manager, milestone_status
                FROM base
                {item_where_sql}
                ORDER BY {sort_col} {sort_dir_sql}, client_db_id ASC
                LIMIT %s OFFSET %s
                """,
                item_params + [int(limit), int(offset)],
            ).df()
    except Exception as e:
        # Final defensive fallback for schema drift: return a minimal, still-paginated list
        # instead of a 500.
        try:
            with get_conn() as con:
                where_clauses: list[str] = []
                params: list[object] = []
                visibility_clause, visibility_params = _client_visibility_clause()
                if visibility_clause:
                    where_clauses.append(visibility_clause)
                    params.extend(visibility_params)
                if query:
                    where_clauses.append("c.client_name ILIKE %s")
                    params.append(f"%{query}%")
                where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

                total_row = con.execute(f"SELECT COUNT(*) FROM clients c {where_sql}", params).fetchone()
                total = int(total_row[0] if total_row else 0)
                page_df = con.execute(
                    f"""
                    SELECT c.db_id as client_db_id, c.client_name,
                           NULL::text as industry, NULL::text as status,
                           NULL::text as crm_owner, NULL::text as portfolio,
                           NULL::text as client_manager, NULL::text as milestone_status
                    FROM clients c
                    {where_sql}
                    ORDER BY LOWER(COALESCE(c.client_name, '')) ASC, c.db_id ASC
                    LIMIT %s OFFSET %s
                    """,
                    params + [int(limit), int(offset)],
                ).df()
                facet_rows = pd.DataFrame(columns=["dim", "key", "n"])
        except Exception:
            raise HTTPException(status_code=500, detail=f"/clients failed: {e}")

    page_items: list[dict[str, object]] = []
    if page_df is not None and not page_df.empty:
        for _, r in page_df.iterrows():
            page_items.append(
                {
                    "client_db_id": int(r.get("client_db_id")),
                    "client_name": _json_null_if_na(r.get("client_name")),
                    "industry": _json_null_if_na(r.get("industry")),
                    "status": _json_null_if_na(r.get("status")),
                    "crm_owner": _json_null_if_na(r.get("crm_owner")),
                    "portfolio": _json_null_if_na(r.get("portfolio")),
                    "client_manager": _json_null_if_na(r.get("client_manager")) or "",
                    "milestone_status": _json_null_if_na(r.get("milestone_status")),
                }
            )

    facet_payload = dict(_EMPTY_FACETS)
    if facet_rows is not None and not facet_rows.empty:
        dim_to_key = {
            "industry": "industries",
            "status": "statuses",
            "owner": "owners",
            "portfolio": "portfolios",
            "risk": "risks",
            "manager": "client_managers",
        }
        for dim, payload_key in dim_to_key.items():
            dim_rows = facet_rows[facet_rows["dim"] == dim]
            entries = [
                {"value": str(row["key"]), "count": int(row["n"])}
                for _, row in dim_rows.iterrows()
                if not pd.isna(row["key"])
            ]
            if dim == "manager":
                entries.sort(key=lambda kv: kv["value"].lower())
            else:
                entries.sort(key=lambda kv: (-kv["count"], kv["value"].lower()))
            facet_payload[payload_key] = entries

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

    def get_milestone_status(due_date, completed_at):
        """Calculate traffic light status: green, amber, red, completed."""
        from datetime import date as _date, datetime as _dt

        try:
            if completed_at is not None and completed_at not in ("", "None") and not pd.isna(completed_at):
                return "completed"
        except Exception:
            pass
        try:
            if due_date is None or due_date in ("", "None") or pd.isna(due_date):
                return "green"
        except Exception:
            return "green"
        try:
            if isinstance(due_date, str):
                due_date = _dt.strptime(due_date[:10], "%Y-%m-%d").date()
            elif hasattr(due_date, "date"):
                due_date = due_date.date()
            days_until_due = (due_date - _date.today()).days
            if days_until_due < -1:
                return "red"
            if days_until_due <= 7:
                return "amber"
            return "green"
        except Exception:
            return "green"

    def get_overall_status(statuses: list[str]) -> str | None:
        if not statuses:
            return None
        if "red" in statuses:
            return "red"
        if "amber" in statuses:
            return "amber"
        if "green" in statuses:
            return "green"
        return "completed" if "completed" in statuses else None

    total_emissions_by_job: dict[int, float] = {}
    ph = "%s" if db_backend() == "postgres" else "?"

    try:
        assert_permission(_user, "jobs.view")
        assert_client_access(_user, int(client_db_id))
    except Exception:
        raise

    org_id = str(_user.get("org_id") or "").strip() or None
    try:
        with get_conn() as con:
            ensure_portal_expiry_schema(con)
            has_job_group = _col_exists(con, "jobs", "job_group")
            has_job_family = _col_exists(con, "jobs", "job_family")
            rows = pd.DataFrame()
            total_row = (0,)
            if org_id:
                total_row = con.execute(
                    f"""
                    SELECT COUNT(*)
                    FROM jobs j
                    LEFT JOIN clients c ON c.db_id = j.client_db_id
                    WHERE j.client_db_id = {ph}
                      AND COALESCE(j.org_id::text, c.org_id::text) = {ph}
                    """,
                    [int(client_db_id), org_id],
                ).fetchone()
                rows = con.execute(
                    f"""
                    SELECT j.job_id, j.job_number, j.title, j.reporting_year, j.status,
                           j.job_type, {("j.job_group" if has_job_group else "NULL::text AS job_group")}, {("j.job_family" if has_job_family else "NULL::text AS job_family")}, j.is_crp, j.reporting_period_end::text AS reporting_period_end,
                           j.portal_visible, j.portal_data_entry_expiry_override::text AS portal_data_entry_expiry_override,
                           jp.data_collection_due::text AS data_collection_due, jp.data_collection_completed_at::text AS data_collection_completed_at,
                           jp.first_draft_due::text AS first_draft_due, jp.first_draft_completed_at::text AS first_draft_completed_at,
                           jp.final_report_due::text AS final_report_due, jp.final_report_completed_at::text AS final_report_completed_at
                    FROM jobs j
                    LEFT JOIN clients c ON c.db_id = j.client_db_id
                    LEFT JOIN job_plan jp ON jp.job_id = j.job_id
                    WHERE j.client_db_id = {ph}
                      AND COALESCE(j.org_id::text, c.org_id::text) = {ph}
                    ORDER BY j.job_type, j.reporting_year DESC, j.job_id DESC
                    LIMIT {ph} OFFSET {ph}
                    """,
                    [int(client_db_id), org_id, int(limit), int(offset)],
                ).df()

            if rows is None or rows.empty:
                total_row = con.execute(
                    f"""
                    SELECT COUNT(*)
                    FROM jobs j
                    WHERE j.client_db_id = {ph}
                    """,
                    [int(client_db_id)],
                ).fetchone()
                rows = con.execute(
                    f"""
                    SELECT j.job_id, j.job_number, j.title, j.reporting_year, j.status,
                           j.job_type, {("j.job_group" if has_job_group else "NULL::text AS job_group")}, {("j.job_family" if has_job_family else "NULL::text AS job_family")}, j.is_crp, j.reporting_period_end::text AS reporting_period_end,
                           j.portal_visible, j.portal_data_entry_expiry_override::text AS portal_data_entry_expiry_override,
                           jp.data_collection_due::text AS data_collection_due, jp.data_collection_completed_at::text AS data_collection_completed_at,
                           jp.first_draft_due::text AS first_draft_due, jp.first_draft_completed_at::text AS first_draft_completed_at,
                           jp.final_report_due::text AS final_report_due, jp.final_report_completed_at::text AS final_report_completed_at
                    FROM jobs j
                    LEFT JOIN job_plan jp ON jp.job_id = j.job_id
                    WHERE j.client_db_id = {ph}
                    ORDER BY j.job_type, j.reporting_year DESC, j.job_id DESC
                    LIMIT {ph} OFFSET {ph}
                    """,
                    [int(client_db_id), int(limit), int(offset)],
                ).df()

            total_emissions_by_job = {}
            if rows is not None and not rows.empty:
                try:
                    for job_id in [int(job_id) for job_id in rows["job_id"].dropna().tolist()]:
                        try:
                            total_emissions_by_job[job_id] = round(float(exact_job_total_emissions(con, job_id) or 0.0), 1)
                        except Exception:
                            total_emissions_by_job[job_id] = 0.0
                except Exception:
                    total_emissions_by_job = {}
    except Exception as exc:
        import traceback, sys
        traceback.print_exc(file=sys.stderr)
        raise HTTPException(status_code=500, detail=f"client_jobs query failed: {exc}") from exc

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
                s = str(reporting_period_end)
                year = int(s[:4])
                if 1900 <= year <= 9999:
                    return year
            except Exception:
                pass
        return _int_or_none(row.get("reporting_year"))

    items: list[dict[str, object]] = []
    if rows is not None and (not rows.empty):
        for _, r in rows.iterrows():
            job_id = _int_or_none(r.get("job_id"))
            if job_id is None:
                continue

            milestone_statuses = []
            if r.get("data_collection_due"):
                milestone_statuses.append(get_milestone_status(r.get("data_collection_due"), r.get("data_collection_completed_at")))
            if r.get("first_draft_due"):
                milestone_statuses.append(get_milestone_status(r.get("first_draft_due"), r.get("first_draft_completed_at")))
            if r.get("final_report_due"):
                milestone_statuses.append(get_milestone_status(r.get("final_report_due"), r.get("final_report_completed_at")))
            overall_milestone_status = get_overall_status(milestone_statuses)

            data_collection_due_str = None if _is_missing(r.get("data_collection_due")) else str(r.get("data_collection_due"))
            expiry_override_str = None if _is_missing(r.get("portal_data_entry_expiry_override")) else str(r.get("portal_data_entry_expiry_override"))
            data_collection_due_date = date.fromisoformat(data_collection_due_str) if data_collection_due_str else None
            expiry_override_date = date.fromisoformat(expiry_override_str) if expiry_override_str else None
            effective_expiry_date = expiry_override_date or data_collection_due_date
            max_override_str = max_portal_data_entry_override_date()

            items.append(
                {
                    "job_id": job_id,
                    "job_number": None if _is_missing(r.get("job_number")) else r.get("job_number"),
                    "title": None if _is_missing(r.get("title")) else r.get("title"),
                    "reporting_year": _reporting_year_from_row(r),
                    "reporting_period_end": None if _is_missing(r.get("reporting_period_end")) else str(r.get("reporting_period_end")),
                    "status": None if _is_missing(r.get("status")) else r.get("status"),
                    "job_type": None if _is_missing(r.get("job_type")) else r.get("job_type"),
                    "job_group": None if _is_missing(r.get("job_group")) else r.get("job_group") or r.get("job_family"),
                    "job_family": None if _is_missing(r.get("job_group")) else r.get("job_group") or r.get("job_family"),
                    "is_crp": _bool_or_false(r.get("is_crp")),
                    "milestone_status": overall_milestone_status,
                    "total_emissions": total_emissions_by_job.get(job_id),
                    "portal_visible": True if _is_missing(r.get("portal_visible")) else _bool_or_false(r.get("portal_visible")),
                    "data_collection_due": data_collection_due_str,
                    "portal_data_entry_expiry_override": expiry_override_str,
                    "portal_data_entry_expiry": effective_expiry_date.isoformat() if effective_expiry_date else None,
                    "portal_data_entry_expired": bool(effective_expiry_date and effective_expiry_date < date.today()),
                    "portal_data_entry_max_override_date": max_override_str,
                }
            )

    total = int(total_row[0] if total_row else 0)
    return {"client_db_id": int(client_db_id), "items": items, "limit": int(limit), "offset": int(offset), "total": total}
