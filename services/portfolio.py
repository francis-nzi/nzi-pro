from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timezone
from typing import Any

from services.emissions_reporting import exact_job_total_emissions


def _safe_text(value: Any) -> str:
    return str(value or "").strip()


def _safe_int(value: Any) -> int | None:
    try:
        if value is None or str(value).strip() == "":
            return None
        return int(value)
    except Exception:
        return None


def _safe_float(value: Any) -> float:
    try:
        if value is None or str(value).strip() == "":
            return 0.0
        return float(value)
    except Exception:
        return 0.0


def _table_columns(con, table_name: str) -> set[str]:
    try:
        rows = con.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = CURRENT_SCHEMA()
              AND table_name = %s
            """,
            [table_name],
        ).fetchall()
    except Exception:
        return set()
    return {str(row[0]).strip().lower() for row in rows or [] if row and row[0] is not None}


def _col_expr(columns: set[str], column_name: str, source_expr: str | None = None, alias: str | None = None) -> str:
    target = alias or column_name
    source = source_expr or column_name
    return f"{source} AS {target}" if column_name.lower() in columns else f"NULL AS {target}"


def _to_iso(value: Any) -> str | None:
    if value is None:
        return None
    try:
        if hasattr(value, "isoformat"):
            return value.isoformat()
    except Exception:
        pass
    text = str(value).strip()
    return text or None


def _parse_date(value: Any) -> date | None:
    iso = _to_iso(value)
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).date()
    except Exception:
        try:
            return date.fromisoformat(iso[:10])
        except Exception:
            return None


def _milestone_status(due_date: Any, completed_at: Any) -> str:
    if completed_at is not None and _to_iso(completed_at):
        return "completed"

    due = _parse_date(due_date)
    if not due:
        return "green"

    days_until_due = (due - date.today()).days
    if days_until_due < -1:
        return "red"
    if days_until_due <= 7:
        return "amber"
    return "green"


def _overall_status(statuses: list[str]) -> str:
    if "red" in statuses:
        return "red"
    if "amber" in statuses:
        return "amber"
    if "green" in statuses:
        return "green"
    if "completed" in statuses:
        return "completed"
    return "none"


def _job_attention_label(days_until_due: int | None) -> str:
    if days_until_due is None:
        return "unscheduled"
    if days_until_due < 0:
        return "overdue"
    if days_until_due <= 7:
        return "due soon"
    if days_until_due <= 30:
        return "upcoming"
    return "on track"


def _portfolio_key(owner_row: dict[str, Any]) -> str:
    portfolio = _safe_text(owner_row.get("portfolio"))
    if portfolio:
        return portfolio
    return _safe_text(owner_row.get("client_name")) or f"portfolio-{owner_row.get('db_id')}"


def _portfolio_note_rows(con, client_ids: list[int]) -> list[dict[str, Any]]:
    if not client_ids:
        return []
    placeholders = ",".join(["%s"] * len(client_ids))
    rows: list[dict[str, Any]] = []
    try:
        client_notes = con.execute(
            f"""
            SELECT
                cn.note_id,
                cn.client_db_id,
                cn.job_id,
                cn.subject,
                cn.note_text,
                cn.author,
                cn.is_high_importance,
                cn.created_at,
                cn.updated_at,
                cn.updated_by,
                c.client_name,
                j.job_number,
                j.title AS job_title
            FROM client_notes cn
            LEFT JOIN clients c ON c.db_id = cn.client_db_id
            LEFT JOIN jobs j ON j.job_id = cn.job_id
            WHERE cn.client_db_id IN ({placeholders})
              AND COALESCE(cn.archived, FALSE) = FALSE
            ORDER BY COALESCE(cn.updated_at, cn.created_at) DESC NULLS LAST, cn.note_id DESC
            LIMIT 25
            """,
            client_ids,
        ).fetchall()
        for row in client_notes or []:
            rows.append({
                "note_id": int(row[0]),
                "client_db_id": int(row[1]),
                "job_id": int(row[2]) if row[2] is not None else None,
                "subject": _safe_text(row[3]) or None,
                "note_text": _safe_text(row[4]),
                "author": _safe_text(row[5]) or None,
                "is_high_importance": bool(row[6]),
                "created_at": _to_iso(row[7]),
                "updated_at": _to_iso(row[8]),
                "updated_by": _safe_text(row[9]) or None,
                "client_name": _safe_text(row[10]),
                "job_number": _safe_text(row[11]) or None,
                "job_title": _safe_text(row[12]) or None,
                "source_type": "client_note",
            })
    except Exception:
        pass

    try:
        job_notes = con.execute(
            f"""
            SELECT
                e.event_id,
                e.client_db_id,
                e.job_id,
                e.subject,
                e.body_text,
                e.created_by,
                e.is_high_importance,
                e.created_at,
                e.updated_at,
                e.updated_by,
                c.client_name,
                j.job_number,
                j.title AS job_title
            FROM crm_events e
            LEFT JOIN clients c ON c.db_id = e.client_db_id
            LEFT JOIN jobs j ON j.job_id = e.job_id
            WHERE e.client_db_id IN ({placeholders})
              AND lower(COALESCE(e.event_type, '')) = 'note'
              AND COALESCE(e.archived, FALSE) = FALSE
            ORDER BY COALESCE(e.event_at, e.created_at) DESC NULLS LAST, e.event_id DESC
            LIMIT 25
            """,
            client_ids,
        ).fetchall()
        for row in job_notes or []:
            rows.append({
                "note_id": int(row[0]),
                "client_db_id": int(row[1]),
                "job_id": int(row[2]) if row[2] is not None else None,
                "subject": _safe_text(row[3]) or None,
                "note_text": _safe_text(row[4]),
                "author": _safe_text(row[5]) or None,
                "is_high_importance": bool(row[6]),
                "created_at": _to_iso(row[7]),
                "updated_at": _to_iso(row[8]),
                "updated_by": _safe_text(row[9]) or None,
                "client_name": _safe_text(row[10]),
                "job_number": _safe_text(row[11]) or None,
                "job_title": _safe_text(row[12]) or None,
                "source_type": "job_note",
            })
    except Exception:
        pass

    rows.sort(key=lambda item: item.get("updated_at") or item.get("created_at") or "", reverse=True)
    return rows[:20]


def _risk_level(score: int) -> str:
    if score >= 80:
        return "critical"
    if score >= 35:
        return "watch"
    return "stable"


def build_portfolio_overview(con, owner_client_db_id: int) -> dict[str, Any]:
    client_columns = _table_columns(con, "clients")
    job_plan_columns = _table_columns(con, "job_plan")
    job_plan_join = "LEFT JOIN job_plan jp ON jp.job_id = j.job_id" if job_plan_columns else ""
    owner_row_raw = con.execute(
        f"""
        SELECT
            db_id,
            client_name,
            industry,
            description_long,
            website,
            year_end_month,
            company_reg,
            sic_code,
            headquarters,
            addr_line1,
            addr_line2,
            addr_city,
            addr_region,
            addr_postcode,
            addr_country,
            logo_url,
            crm_owner,
            client_manager,
            status,
            portfolio,
            {_col_expr(client_columns, "net_zero_year")},
            {_col_expr(client_columns, "interim_year")},
            {_col_expr(client_columns, "interim_s1_pct")},
            {_col_expr(client_columns, "interim_s2_pct")},
            {_col_expr(client_columns, "interim_s3_pct")},
            {_col_expr(client_columns, "benchmark_year")},
            {_col_expr(client_columns, "benchmark_period_start")},
            {_col_expr(client_columns, "benchmark_period_end")},
            {_col_expr(client_columns, "benchmark_scope_1_tco2e")},
            {_col_expr(client_columns, "benchmark_scope_2_tco2e")},
            {_col_expr(client_columns, "benchmark_scope_3_tco2e")},
            {_col_expr(client_columns, "benchmark_total_tco2e")},
            {_col_expr(client_columns, "created_at")},
            {_col_expr(client_columns, "updated_at")},
            {_col_expr(client_columns, "engagement_start_date")},
            {_col_expr(client_columns, "engagement_end_date")},
            {_col_expr(client_columns, "touchpoint_cadence")}
        FROM clients
        WHERE db_id = %s
        """,
        [int(owner_client_db_id)],
    ).fetchone()
    if not owner_row_raw:
        raise ValueError("Portfolio owner not found")

    owner = {
        "client_db_id": int(owner_row_raw[0]),
        "client_name": _safe_text(owner_row_raw[1]),
        "industry": _safe_text(owner_row_raw[2]) or None,
        "description_long": _safe_text(owner_row_raw[3]) or None,
        "website": _safe_text(owner_row_raw[4]) or None,
        "year_end_month": _safe_text(owner_row_raw[5]) or None,
        "company_reg": _safe_text(owner_row_raw[6]) or None,
        "sic_code": _safe_text(owner_row_raw[7]) or None,
        "headquarters": _safe_text(owner_row_raw[8]) or None,
        "addr_line1": _safe_text(owner_row_raw[9]) or None,
        "addr_line2": _safe_text(owner_row_raw[10]) or None,
        "addr_city": _safe_text(owner_row_raw[11]) or None,
        "addr_region": _safe_text(owner_row_raw[12]) or None,
        "addr_postcode": _safe_text(owner_row_raw[13]) or None,
        "addr_country": _safe_text(owner_row_raw[14]) or None,
        "logo_url": _safe_text(owner_row_raw[15]) or None,
        "crm_owner": _safe_text(owner_row_raw[16]) or None,
        "client_manager": _safe_text(owner_row_raw[17]) or None,
        "status": _safe_text(owner_row_raw[18]) or None,
        "portfolio": _safe_text(owner_row_raw[19]) or None,
        "net_zero_year": _safe_int(owner_row_raw[20]),
        "interim_year": _safe_int(owner_row_raw[21]),
        "interim_s1_pct": _safe_int(owner_row_raw[22]),
        "interim_s2_pct": _safe_int(owner_row_raw[23]),
        "interim_s3_pct": _safe_int(owner_row_raw[24]),
        "benchmark_year": _safe_int(owner_row_raw[25]),
        "benchmark_period_start": _to_iso(owner_row_raw[26]),
        "benchmark_period_end": _to_iso(owner_row_raw[27]),
        "benchmark_scope_1_tco2e": _safe_float(owner_row_raw[28]),
        "benchmark_scope_2_tco2e": _safe_float(owner_row_raw[29]),
        "benchmark_scope_3_tco2e": _safe_float(owner_row_raw[30]),
        "benchmark_total_tco2e": _safe_float(owner_row_raw[31]),
        "created_at": _to_iso(owner_row_raw[32]),
        "updated_at": _to_iso(owner_row_raw[33]),
        "engagement_start_date": _to_iso(owner_row_raw[34]),
        "engagement_end_date": _to_iso(owner_row_raw[35]),
        "touchpoint_cadence": _safe_text(owner_row_raw[36]) or None,
    }

    portfolio_key = _portfolio_key(owner)
    child_rows_raw = con.execute(
        """
        SELECT
            db_id, client_name, industry, status, portfolio, crm_owner, client_manager, website,
            addr_line1, addr_line2, addr_city, addr_region, addr_postcode, addr_country,
            logo_url, created_at, updated_at
        FROM clients
        WHERE lower(COALESCE(portfolio, client_name)) = lower(%s)
          AND db_id <> %s
          AND lower(COALESCE(status, '')) <> 'archived'
        ORDER BY lower(COALESCE(client_name, '')) ASC, db_id ASC
        """,
        [portfolio_key, int(owner_client_db_id)],
    ).fetchall()

    child_clients = [
        {
            "client_db_id": int(row[0]),
            "client_name": _safe_text(row[1]),
            "industry": _safe_text(row[2]) or None,
            "status": _safe_text(row[3]) or None,
            "portfolio": _safe_text(row[4]) or None,
            "crm_owner": _safe_text(row[5]) or None,
            "client_manager": _safe_text(row[6]) or None,
            "website": _safe_text(row[7]) or None,
            "addr_line1": _safe_text(row[8]) or None,
            "addr_line2": _safe_text(row[9]) or None,
            "addr_city": _safe_text(row[10]) or None,
            "addr_region": _safe_text(row[11]) or None,
            "addr_postcode": _safe_text(row[12]) or None,
            "addr_country": _safe_text(row[13]) or None,
            "logo_url": _safe_text(row[14]) or None,
            "created_at": _to_iso(row[15]),
            "updated_at": _to_iso(row[16]),
        }
        for row in child_rows_raw
    ]

    portfolio_clients = [owner, *child_clients]
    portfolio_client_ids = [int(client["client_db_id"]) for client in portfolio_clients]
    client_placeholders = ",".join(["%s"] * len(portfolio_client_ids))

    contact_rows = con.execute(
        f"""
        SELECT contact_id, client_db_id, full_name, job_title, email, phone, is_primary
        FROM client_contacts
        WHERE client_db_id IN ({client_placeholders})
        ORDER BY COALESCE(is_primary, FALSE) DESC, lower(COALESCE(full_name, email, '')) ASC
        """,
        portfolio_client_ids,
    ).fetchall()
    contacts = [
        {
            "contact_id": int(row[0]),
            "client_db_id": int(row[1]),
            "full_name": _safe_text(row[2]) or None,
            "job_title": _safe_text(row[3]) or None,
            "email": _safe_text(row[4]) or None,
            "phone": _safe_text(row[5]) or None,
            "is_primary": bool(row[6]),
        }
        for row in contact_rows or []
    ]

    job_rows = con.execute(
        f"""
        SELECT
            j.job_id,
            j.client_db_id,
            c.client_name,
            j.job_number,
            j.title,
            j.status,
            j.reporting_year,
            j.created_at,
            j.updated_at,
            {_col_expr(job_plan_columns, "data_collection_due", "jp.data_collection_due", "data_collection_due")},
            {_col_expr(job_plan_columns, "data_collection_completed_at", "jp.data_collection_completed_at", "data_collection_completed_at")},
            {_col_expr(job_plan_columns, "first_draft_due", "jp.first_draft_due", "first_draft_due")},
            {_col_expr(job_plan_columns, "first_draft_completed_at", "jp.first_draft_completed_at", "first_draft_completed_at")},
            {_col_expr(job_plan_columns, "final_report_due", "jp.final_report_due", "final_report_due")},
            {_col_expr(job_plan_columns, "final_report_completed_at", "jp.final_report_completed_at", "final_report_completed_at")}
        FROM jobs j
        LEFT JOIN clients c ON c.db_id = j.client_db_id
        {job_plan_join}
        WHERE j.client_db_id IN ({client_placeholders})
        ORDER BY COALESCE(j.updated_at, j.created_at) DESC NULLS LAST, j.job_id DESC
        """,
        portfolio_client_ids,
    ).fetchall()

    jobs: list[dict[str, Any]] = []
    attention_jobs: list[dict[str, Any]] = []
    annual_totals: defaultdict[int, float] = defaultdict(float)
    status_counts: defaultdict[str, int] = defaultdict(int)
    client_stats: dict[int, dict[str, Any]] = {
        cid: {"job_count": 0, "open_jobs": 0, "overdue_jobs": 0, "total_emissions": 0.0, "latest_job_at": None}
        for cid in portfolio_client_ids
    }
    total_jobs = 0
    open_jobs = 0
    overdue_jobs = 0
    portfolio_emissions = 0.0

    for row in job_rows or []:
        job_id = int(row[0])
        client_db_id = int(row[1])
        client_name = _safe_text(row[2])
        status = _safe_text(row[5]) or "Unknown"
        reporting_year = _safe_int(row[6])
        due_dates = [row[9], row[11], row[13]]
        completed_dates = [row[10], row[12], row[14]]
        next_due_date: date | None = None
        next_due_label: str | None = None
        milestone_statuses = [
            _milestone_status(due, completed)
            for due, completed in zip(due_dates, completed_dates)
            if due is not None
        ]
        for label, due, completed in (
            ("Data collection", row[9], row[10]),
            ("First draft", row[11], row[12]),
            ("Final report", row[13], row[14]),
        ):
            if completed is not None and _to_iso(completed):
                continue
            parsed_due = _parse_date(due)
            if not parsed_due:
                continue
            if next_due_date is None or parsed_due < next_due_date:
                next_due_date = parsed_due
                next_due_label = label
        days_until_next_due = (next_due_date - date.today()).days if next_due_date else None
        overall_milestone = _overall_status(milestone_statuses)
        total = 0.0
        try:
            total = float(exact_job_total_emissions(con, job_id) or 0.0)
        except Exception:
            total = 0.0
        portfolio_emissions += total
        if reporting_year:
            annual_totals[int(reporting_year)] += total
        status_counts[status] += 1
        total_jobs += 1
        if status.lower() not in {"completed", "closed", "cancelled"}:
            open_jobs += 1
        if overall_milestone == "red":
            overdue_jobs += 1

        client_entry = client_stats.setdefault(
            client_db_id,
            {"job_count": 0, "open_jobs": 0, "overdue_jobs": 0, "total_emissions": 0.0, "latest_job_at": None},
        )
        client_entry["job_count"] += 1
        client_entry["open_jobs"] += 0 if status.lower() in {"completed", "closed", "cancelled"} else 1
        client_entry["overdue_jobs"] += 1 if overall_milestone == "red" else 0
        client_entry["total_emissions"] += total
        latest_job_at = row[8] or row[7]
        if latest_job_at:
            current_latest = client_entry["latest_job_at"]
            if current_latest is None or str(latest_job_at) > str(current_latest):
                client_entry["latest_job_at"] = latest_job_at

        job_entry = {
            "job_id": job_id,
            "client_db_id": client_db_id,
            "client_name": client_name,
            "job_number": _safe_text(row[3]) or None,
            "title": _safe_text(row[4]) or None,
            "status": status,
            "reporting_year": reporting_year,
            "created_at": _to_iso(row[7]),
            "updated_at": _to_iso(row[8]),
            "data_collection_due": _to_iso(row[9]),
            "data_collection_completed_at": _to_iso(row[10]),
            "first_draft_due": _to_iso(row[11]),
            "first_draft_completed_at": _to_iso(row[12]),
            "final_report_due": _to_iso(row[13]),
            "final_report_completed_at": _to_iso(row[14]),
            "total_emissions": round(total, 2),
            "milestone_status": overall_milestone,
            "next_due_at": next_due_date.isoformat() if next_due_date else None,
            "next_due_label": next_due_label,
            "days_until_next_due": days_until_next_due,
            "attention_status": _job_attention_label(days_until_next_due),
        }
        jobs.append(job_entry)
        if overall_milestone == "red" or (days_until_next_due is not None and days_until_next_due <= 30):
            attention_jobs.append(job_entry)

    client_rows: list[dict[str, Any]] = []
    for client in portfolio_clients:
        stats = client_stats.get(int(client["client_db_id"]), {})
        client_rows.append(
            {
                **client,
                "contact_count": sum(1 for contact in contacts if contact["client_db_id"] == client["client_db_id"]),
                "job_count": int(stats.get("job_count") or 0),
                "open_jobs": int(stats.get("open_jobs") or 0),
                "overdue_jobs": int(stats.get("overdue_jobs") or 0),
                "total_emissions": round(float(stats.get("total_emissions") or 0.0), 2),
                "latest_job_at": _to_iso(stats.get("latest_job_at")),
            }
        )

    recent_notes = _portfolio_note_rows(con, portfolio_client_ids)
    notes_by_client = defaultdict(int)
    for note in recent_notes:
        notes_by_client[int(note["client_db_id"])] += 1

    for client in client_rows:
        client["recent_notes"] = notes_by_client.get(int(client["client_db_id"]), 0)

    risk_clients: list[dict[str, Any]] = []
    stale_clients = 0
    no_contact_clients = 0
    no_recent_activity_clients = 0
    watch_clients = 0
    critical_clients = 0
    for client in client_rows:
        factors: list[str] = []
        score = 0
        overdue = int(client.get("overdue_jobs") or 0)
        open_count = int(client.get("open_jobs") or 0)
        contact_count = int(client.get("contact_count") or 0)
        note_count = int(client.get("recent_notes") or 0)
        latest_job_at = _parse_date(client.get("latest_job_at"))
        days_since_last_job = (date.today() - latest_job_at).days if latest_job_at else None

        if overdue > 0:
            score += overdue * 35
            factors.append(f"{overdue} overdue job{'s' if overdue != 1 else ''}")
        if open_count > overdue:
            open_risk = max(0, open_count - overdue)
            if open_risk:
                score += min(open_risk * 10, 30)
                factors.append(f"{open_risk} open job{'s' if open_risk != 1 else ''}")
        if days_since_last_job is None:
            score += 20
            factors.append("no recent job activity")
            no_recent_activity_clients += 1
        elif days_since_last_job >= 60:
            score += 20
            factors.append(f"stale for {days_since_last_job} days")
            stale_clients += 1
        elif days_since_last_job >= 30:
            score += 10
            factors.append(f"{days_since_last_job} days since last job update")
        if contact_count == 0:
            score += 15
            factors.append("no contacts")
            no_contact_clients += 1
        if note_count == 0:
            score += 5
            factors.append("no recent notes")

        level = _risk_level(score)
        if level == "critical":
            critical_clients += 1
        elif level == "watch":
            watch_clients += 1

        risk_clients.append(
            {
                "client_db_id": client["client_db_id"],
                "client_name": client["client_name"],
                "status": client.get("status"),
                "industry": client.get("industry"),
                "job_count": client.get("job_count"),
                "open_jobs": client.get("open_jobs"),
                "overdue_jobs": client.get("overdue_jobs"),
                "total_emissions": client.get("total_emissions"),
                "recent_notes": client.get("recent_notes"),
                "contact_count": client.get("contact_count"),
                "latest_job_at": client.get("latest_job_at"),
                "days_since_last_job": days_since_last_job,
                "risk_score": score,
                "risk_level": level,
                "risk_factors": factors[:4],
            }
        )

    risk_clients.sort(key=lambda item: (-int(item["risk_score"]), item["days_since_last_job"] is None, item["client_name"].lower()))
    attention_jobs.sort(
        key=lambda item: (
            item["days_until_next_due"] is None,
            item["days_until_next_due"] if item["days_until_next_due"] is not None else 9999,
            item["client_name"].lower(),
        )
    )

    client_status_breakdown: dict[str, int] = defaultdict(int)
    for client in client_rows:
        client_status_breakdown[_safe_text(client.get("status")) or "Unspecified"] += 1

    annual_emissions = [
        {"year": year, "total_emissions": round(total, 2)}
        for year, total in sorted(annual_totals.items(), key=lambda item: item[0])
    ]
    jobs.sort(key=lambda item: item.get("updated_at") or item.get("created_at") or "", reverse=True)
    client_rows.sort(key=lambda item: (-item["total_emissions"], item["client_name"].lower()))

    return {
        "ok": True,
        "portfolio_key": portfolio_key,
        "owner": owner,
        "summary": {
            "total_clients": len(client_rows),
            "active_clients": sum(1 for client in client_rows if _safe_text(client.get("status")).lower() == "active"),
            "portfolio_owner_clients": sum(1 for client in client_rows if _safe_text(client.get("status")).lower() == "portfolio owner"),
            "total_contacts": len(contacts),
            "total_jobs": total_jobs,
            "open_jobs": open_jobs,
            "overdue_jobs": overdue_jobs,
            "total_emissions": round(portfolio_emissions, 2),
            "recent_notes": len(recent_notes),
        },
        "risk": {
            "critical_clients": critical_clients,
            "watch_clients": watch_clients,
            "stale_clients": stale_clients,
            "no_contact_clients": no_contact_clients,
            "no_recent_activity_clients": no_recent_activity_clients,
            "overdue_jobs": sum(1 for job in jobs if job.get("attention_status") == "overdue"),
            "due_soon_jobs": sum(1 for job in jobs if job.get("days_until_next_due") is not None and 0 <= int(job["days_until_next_due"]) <= 7),
            "upcoming_jobs": sum(1 for job in jobs if job.get("days_until_next_due") is not None and 8 <= int(job["days_until_next_due"]) <= 30),
        },
        "client_status_breakdown": [
            {"status": status, "count": count}
            for status, count in sorted(client_status_breakdown.items(), key=lambda item: (-item[1], item[0].lower()))
        ],
        "annual_emissions": annual_emissions,
        "risk_clients": risk_clients[:12],
        "attention_jobs": attention_jobs[:12],
        "clients": client_rows,
        "jobs": jobs[:18],
        "recent_notes": recent_notes,
        "contacts": contacts,
    }
