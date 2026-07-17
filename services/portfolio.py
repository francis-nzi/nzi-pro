from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, timezone
import logging
from typing import Any

from services.emissions_reporting import exact_job_total_emissions


logger = logging.getLogger(__name__)


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


def _resolve_owner_portfolio_name(con, owner_client_db_id: int) -> str | None:
    """The portfolio name linked to this owner in Admin Center -> Lookups -> Portfolios.

    This is the single source of truth for portfolio membership -- a client's
    own `clients.portfolio` text field (or its client_name) is never used as a
    fallback, since both can silently match unrelated clients (e.g. every
    client defaults its portfolio field to "NZI").
    """
    row = con.execute(
        """
        SELECT name
        FROM portfolios_lookup
        WHERE portfolio_owner_client_db_id = %s
          AND COALESCE(is_active, TRUE) = TRUE
        ORDER BY portfolio_id ASC
        LIMIT 1
        """,
        [int(owner_client_db_id)],
    ).fetchone()
    return _safe_text(row[0]) if row and row[0] else None


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
            ORDER BY e.created_at DESC NULLS LAST, e.event_id DESC
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


def _empty_portfolio_overview(owner_client_db_id: int, owner_name: str | None = None, portfolio_key: str | None = None) -> dict[str, Any]:
    owner_label = _safe_text(owner_name) or f"Portfolio owner {owner_client_db_id}"
    resolved_portfolio_key = _safe_text(portfolio_key) or owner_label or f"portfolio-{owner_client_db_id}"
    return {
        "ok": True,
        "portfolio_key": resolved_portfolio_key,
        "owner": {
            "client_db_id": int(owner_client_db_id),
            "client_name": owner_label,
            "industry": None,
            "description_long": None,
            "website": None,
            "year_end_month": None,
            "company_reg": None,
            "sic_code": None,
            "headquarters": None,
            "addr_line1": None,
            "addr_line2": None,
            "addr_city": None,
            "addr_region": None,
            "addr_postcode": None,
            "addr_country": None,
            "logo_url": None,
            "crm_owner": None,
            "client_manager": None,
            "status": "Portfolio Owner",
            "portfolio": resolved_portfolio_key,
            "net_zero_year": None,
            "benchmark_year": None,
            "benchmark_total_tco2e": None,
            "created_at": None,
            "updated_at": None,
        },
        "summary": {
            "total_clients": 0,
            "active_clients": 0,
            "portfolio_owner_clients": 0,
            "total_contacts": 0,
            "total_jobs": 0,
            "open_jobs": 0,
            "overdue_jobs": 0,
            "total_emissions": 0.0,
            "recent_notes": 0,
        },
        "risk": {
            "critical_clients": 0,
            "watch_clients": 0,
            "stale_clients": 0,
            "no_contact_clients": 0,
            "no_recent_activity_clients": 0,
            "overdue_jobs": 0,
            "due_soon_jobs": 0,
            "upcoming_jobs": 0,
        },
        "client_status_breakdown": [],
        "annual_emissions": [],
        "risk_clients": [],
        "attention_jobs": [],
        "clients": [],
        "jobs": [],
        "recent_notes": [],
        "contacts": [],
    }


_TERMINAL_JOB_STATUSES = {"completed", "closed"}
_STALE_ACTIVITY_DAYS = 90


def _build_portfolio_overview_fallback(con, owner_client_db_id: int) -> dict[str, Any]:
    owner_row_raw = con.execute(
        """
        SELECT db_id, client_name, status, portfolio, NULL, NULL
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
        "status": _safe_text(owner_row_raw[2]) or None,
        "portfolio": _safe_text(owner_row_raw[3]) or None,
        "created_at": _to_iso(owner_row_raw[4]),
        "updated_at": _to_iso(owner_row_raw[5]),
    }
    portfolio_key = _resolve_owner_portfolio_name(con, owner_client_db_id)
    if not portfolio_key:
        return _empty_portfolio_overview(owner_client_db_id, owner_name=owner["client_name"])

    child_rows_raw = con.execute(
        """
        SELECT db_id, client_name, status, portfolio, NULL, NULL
        FROM clients
        WHERE lower(portfolio) = lower(%s)
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
            "status": _safe_text(row[2]) or None,
            "portfolio": _safe_text(row[3]) or None,
            "created_at": _to_iso(row[4]),
            "updated_at": _to_iso(row[5]),
            "industry": None,
            "website": None,
            "addr_city": None,
            "addr_country": None,
        }
        for row in child_rows_raw or []
    ]

    portfolio_clients = [owner, *child_clients]
    portfolio_client_ids = [int(client["client_db_id"]) for client in portfolio_clients]
    client_placeholders = ",".join(["%s"] * len(portfolio_client_ids))

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
            jp.data_collection_due, jp.data_collection_completed_at,
            jp.first_draft_due, jp.first_draft_completed_at,
            jp.final_report_due, jp.final_report_completed_at
        FROM jobs j
        LEFT JOIN clients c ON c.db_id = j.client_db_id
        LEFT JOIN job_plan jp ON jp.job_id = j.job_id
        WHERE j.client_db_id IN ({client_placeholders})
        ORDER BY j.created_at DESC NULLS LAST, j.job_id DESC
        """,
        portfolio_client_ids,
    ).fetchall()

    jobs: list[dict[str, Any]] = []
    attention_jobs: list[dict[str, Any]] = []
    annual_totals: defaultdict[int, float] = defaultdict(float)
    client_stats: dict[int, dict[str, Any]] = {
        cid: {"job_count": 0, "open_jobs": 0, "overdue_jobs": 0, "total_emissions": 0.0, "latest_job_at": None}
        for cid in portfolio_client_ids
    }

    for row in job_rows or []:
        job_id = int(row[0])
        client_db_id = int(row[1])
        client_name = _safe_text(row[2])
        status = _safe_text(row[5]) or "Unknown"
        is_terminal = status.lower() in _TERMINAL_JOB_STATUSES
        total = 0.0
        try:
            total = float(exact_job_total_emissions(con, job_id) or 0.0)
        except Exception:
            total = 0.0

        milestones = [
            ("Data collection", row[8], row[9]),
            ("First draft", row[10], row[11]),
            ("Final report", row[12], row[13]),
        ]
        milestone_status = _overall_status([_milestone_status(due, done) for _, due, done in milestones])

        next_due_at = None
        next_due_label = None
        days_until_next_due = None
        for label, due, done in milestones:
            due_date = _parse_date(due)
            if due_date is None or done is not None:
                continue
            days = (due_date - date.today()).days
            if days_until_next_due is None or days < days_until_next_due:
                days_until_next_due = days
                next_due_at = _to_iso(due)
                next_due_label = label
        attention_status = "none" if is_terminal else _job_attention_label(days_until_next_due)

        client_entry = client_stats.setdefault(
            client_db_id,
            {"job_count": 0, "open_jobs": 0, "overdue_jobs": 0, "total_emissions": 0.0, "latest_job_at": None},
        )
        client_entry["job_count"] += 1
        client_entry["open_jobs"] += 0 if is_terminal else 1
        client_entry["overdue_jobs"] += 1 if attention_status == "overdue" else 0
        client_entry["total_emissions"] += total
        if row[6] is not None:
            annual_totals[int(row[6])] += total
        latest_job_at = row[7]
        if latest_job_at:
            current_latest = client_entry["latest_job_at"]
            if current_latest is None or str(latest_job_at) > str(current_latest):
                client_entry["latest_job_at"] = latest_job_at
        jobs.append(
            {
                "job_id": job_id,
                "client_db_id": client_db_id,
                "client_name": client_name,
                "job_number": _safe_text(row[3]) or None,
                "title": _safe_text(row[4]) or None,
                "status": status,
                "reporting_year": _safe_int(row[6]),
                "created_at": _to_iso(row[7]),
                "updated_at": None,
                "data_collection_due": _to_iso(row[8]),
                "data_collection_completed_at": _to_iso(row[9]),
                "first_draft_due": _to_iso(row[10]),
                "first_draft_completed_at": _to_iso(row[11]),
                "final_report_due": _to_iso(row[12]),
                "final_report_completed_at": _to_iso(row[13]),
                "total_emissions": round(total, 2),
                "milestone_status": milestone_status,
                "next_due_at": next_due_at,
                "next_due_label": next_due_label,
                "days_until_next_due": days_until_next_due,
                "attention_status": attention_status,
            }
        )
        if not is_terminal:
            attention_jobs.append(jobs[-1])

    contact_rows = con.execute(
        f"""
        SELECT contact_id, client_db_id, full_name, job_title, email, phone, is_primary
        FROM client_contacts
        WHERE client_db_id IN ({client_placeholders})
        ORDER BY client_db_id, is_primary DESC, full_name ASC
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
    contact_count_by_client: Counter = Counter(c["client_db_id"] for c in contacts)

    note_stats_rows = con.execute(
        f"""
        SELECT client_db_id, COUNT(*), MAX(created_at)
        FROM (
            SELECT client_db_id, created_at FROM client_notes
            WHERE client_db_id IN ({client_placeholders}) AND COALESCE(archived, FALSE) = FALSE
            UNION ALL
            SELECT client_db_id, created_at FROM crm_events
            WHERE client_db_id IN ({client_placeholders})
              AND lower(COALESCE(event_type, '')) = 'note'
              AND COALESCE(archived, FALSE) = FALSE
        ) combined
        GROUP BY client_db_id
        """,
        [*portfolio_client_ids, *portfolio_client_ids],
    ).fetchall()
    note_count_by_client: dict[int, int] = {}
    last_note_at_by_client: dict[int, Any] = {}
    for cid, count, last_at in note_stats_rows or []:
        note_count_by_client[int(cid)] = int(count)
        last_note_at_by_client[int(cid)] = last_at

    def _is_stale(client_db_id: int, latest_job_at_iso: Any) -> bool:
        last_job = _parse_date(latest_job_at_iso)
        last_note = _parse_date(last_note_at_by_client.get(client_db_id))
        candidates = [d for d in (last_job, last_note) if d is not None]
        if not candidates:
            return True
        return (date.today() - max(candidates)).days > _STALE_ACTIVITY_DAYS

    client_rows: list[dict[str, Any]] = []
    for client in portfolio_clients:
        cid = int(client["client_db_id"])
        stats = client_stats.get(cid, {})
        client_rows.append(
            {
                **client,
                "contact_count": contact_count_by_client.get(cid, 0),
                "job_count": int(stats.get("job_count") or 0),
                "open_jobs": int(stats.get("open_jobs") or 0),
                "overdue_jobs": int(stats.get("overdue_jobs") or 0),
                "total_emissions": round(float(stats.get("total_emissions") or 0.0), 2),
                "latest_job_at": _to_iso(stats.get("latest_job_at")),
                "recent_notes": note_count_by_client.get(cid, 0),
            }
        )

    risk_clients: list[dict[str, Any]] = []
    critical_clients = 0
    watch_clients = 0
    no_contact_clients = 0
    no_recent_activity_clients = 0
    for client in client_rows:
        cid = int(client["client_db_id"])
        open_jobs = int(client.get("open_jobs") or 0)
        overdue_jobs = int(client.get("overdue_jobs") or 0)
        no_contacts = int(client.get("contact_count") or 0) == 0
        stale = _is_stale(cid, client.get("latest_job_at"))
        if no_contacts:
            no_contact_clients += 1
        if stale:
            no_recent_activity_clients += 1

        score = overdue_jobs * 35 + open_jobs * 5
        risk_factors = []
        if overdue_jobs:
            risk_factors.append("overdue jobs")
        if no_contacts:
            score += 20
            risk_factors.append("no contacts")
        if stale:
            score += 25
            risk_factors.append("no recent activity")
        level = _risk_level(score)
        if level == "critical":
            critical_clients += 1
        elif level == "watch":
            watch_clients += 1

        last_job_date = _parse_date(client.get("latest_job_at"))
        days_since_last_job = (date.today() - last_job_date).days if last_job_date else None

        risk_clients.append(
            {
                "client_db_id": cid,
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
                "risk_factors": risk_factors,
            }
        )

    overdue_job_count = sum(1 for job in attention_jobs if job["attention_status"] == "overdue")
    due_soon_job_count = sum(1 for job in attention_jobs if job["attention_status"] == "due soon")
    upcoming_job_count = len(attention_jobs) - overdue_job_count - due_soon_job_count
    recent_notes = _portfolio_note_rows(con, portfolio_client_ids)
    total_recent_notes = sum(note_count_by_client.values())

    return {
        "ok": True,
        "portfolio_key": portfolio_key,
        "owner": owner,
        "summary": {
            "total_clients": len(client_rows),
            "active_clients": sum(1 for client in client_rows if _safe_text(client.get("status")).lower() == "active"),
            "portfolio_owner_clients": sum(1 for client in client_rows if _safe_text(client.get("status")).lower() == "portfolio owner"),
            "total_contacts": len(contacts),
            "total_jobs": len(jobs),
            "open_jobs": sum(1 for job in jobs if _safe_text(job.get("status")).lower() not in _TERMINAL_JOB_STATUSES),
            "overdue_jobs": overdue_job_count,
            "total_emissions": round(sum(job.get("total_emissions") or 0.0 for job in jobs), 2),
            "recent_notes": total_recent_notes,
        },
        "risk": {
            "critical_clients": critical_clients,
            "watch_clients": watch_clients,
            "stale_clients": no_recent_activity_clients,
            "no_contact_clients": no_contact_clients,
            "no_recent_activity_clients": no_recent_activity_clients,
            "overdue_jobs": overdue_job_count,
            "due_soon_jobs": due_soon_job_count,
            "upcoming_jobs": upcoming_job_count,
        },
        "client_status_breakdown": [
            {"status": status, "count": count}
            for status, count in sorted(
                {
                    _safe_text(client.get("status")) or "Unspecified": sum(
                        1 for row in client_rows if (_safe_text(row.get("status")) or "Unspecified") == (_safe_text(client.get("status")) or "Unspecified")
                    )
                    for client in client_rows
                }.items(),
                key=lambda item: (-item[1], item[0].lower()),
            )
        ],
        "annual_emissions": [
            {"year": year, "total_emissions": round(total, 2)}
            for year, total in sorted(annual_totals.items(), key=lambda item: item[0])
        ],
        "risk_clients": risk_clients,
        "attention_jobs": attention_jobs,
        "clients": client_rows,
        "jobs": jobs[:18],
        "recent_notes": recent_notes,
        "contacts": contacts,
    }


def build_portfolio_overview(con, owner_client_db_id: int) -> dict[str, Any]:
    try:
        return _build_portfolio_overview_fallback(con, owner_client_db_id)
    except ValueError:
        raise
    except Exception:
        logger.exception("Failed to build portfolio overview for owner_client_db_id=%s", owner_client_db_id)
        return _empty_portfolio_overview(owner_client_db_id)
