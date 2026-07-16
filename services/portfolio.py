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


def _build_portfolio_overview_fallback(con, owner_client_db_id: int) -> dict[str, Any]:
    owner_row_raw = con.execute(
        """
        SELECT db_id, client_name, status, portfolio, created_at, updated_at
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
    portfolio_key = _portfolio_key(owner)

    child_rows_raw = con.execute(
        """
        SELECT db_id, client_name, status, portfolio, created_at, updated_at
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
            j.updated_at
        FROM jobs j
        LEFT JOIN clients c ON c.db_id = j.client_db_id
        WHERE j.client_db_id IN ({client_placeholders})
        ORDER BY COALESCE(j.updated_at, j.created_at) DESC NULLS LAST, j.job_id DESC
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
        total = 0.0
        try:
            total = float(exact_job_total_emissions(con, job_id) or 0.0)
        except Exception:
            total = 0.0
        client_entry = client_stats.setdefault(
            client_db_id,
            {"job_count": 0, "open_jobs": 0, "overdue_jobs": 0, "total_emissions": 0.0, "latest_job_at": None},
        )
        client_entry["job_count"] += 1
        client_entry["open_jobs"] += 0 if status.lower() in {"completed", "closed", "cancelled"} else 1
        client_entry["total_emissions"] += total
        if row[6] is not None:
            annual_totals[int(row[6])] += total
        latest_job_at = row[8] or row[7]
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
                "updated_at": _to_iso(row[8]),
                "data_collection_due": None,
                "data_collection_completed_at": None,
                "first_draft_due": None,
                "first_draft_completed_at": None,
                "final_report_due": None,
                "final_report_completed_at": None,
                "total_emissions": round(total, 2),
                "milestone_status": "none",
                "next_due_at": None,
                "next_due_label": None,
                "days_until_next_due": None,
                "attention_status": "unscheduled",
            }
        )
        if status.lower() not in {"completed", "closed", "cancelled"}:
            attention_jobs.append({**jobs[-1], "attention_status": "upcoming"})

    client_rows: list[dict[str, Any]] = []
    for client in portfolio_clients:
        stats = client_stats.get(int(client["client_db_id"]), {})
        client_rows.append(
            {
                **client,
                "contact_count": 0,
                "job_count": int(stats.get("job_count") or 0),
                "open_jobs": int(stats.get("open_jobs") or 0),
                "overdue_jobs": int(stats.get("overdue_jobs") or 0),
                "total_emissions": round(float(stats.get("total_emissions") or 0.0), 2),
                "latest_job_at": _to_iso(stats.get("latest_job_at")),
                "recent_notes": 0,
            }
        )

    risk_clients: list[dict[str, Any]] = []
    for client in client_rows:
        open_jobs = int(client.get("open_jobs") or 0)
        score = open_jobs * 10
        level = "watch" if score else "stable"
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
                "days_since_last_job": None,
                "risk_score": score,
                "risk_level": level,
                "risk_factors": ["open jobs"] if score else [],
            }
        )
    watch_clients = sum(1 for item in risk_clients if item["risk_level"] == "watch")
    active_attention_jobs = len(attention_jobs)

    return {
        "ok": True,
        "portfolio_key": portfolio_key,
        "owner": owner,
        "summary": {
            "total_clients": len(client_rows),
            "active_clients": sum(1 for client in client_rows if _safe_text(client.get("status")).lower() == "active"),
            "portfolio_owner_clients": sum(1 for client in client_rows if _safe_text(client.get("status")).lower() == "portfolio owner"),
            "total_contacts": 0,
            "total_jobs": len(jobs),
            "open_jobs": sum(1 for job in jobs if _safe_text(job.get("status")).lower() not in {"completed", "closed", "cancelled"}),
            "overdue_jobs": 0,
            "total_emissions": round(sum(job.get("total_emissions") or 0.0 for job in jobs), 2),
            "recent_notes": 0,
        },
        "risk": {
            "critical_clients": 0,
            "watch_clients": watch_clients,
            "stale_clients": sum(1 for client in client_rows if int(client.get("job_count") or 0) > 0),
            "no_contact_clients": len(client_rows),
            "no_recent_activity_clients": len(client_rows),
            "overdue_jobs": active_attention_jobs,
            "due_soon_jobs": active_attention_jobs,
            "upcoming_jobs": active_attention_jobs,
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
        "recent_notes": [],
        "contacts": [],
    }


def build_portfolio_overview(con, owner_client_db_id: int) -> dict[str, Any]:
    return _build_portfolio_overview_fallback(con, owner_client_db_id)
