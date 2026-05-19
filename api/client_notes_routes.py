from __future__ import annotations

from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query

from api.auth import _current_user
from api.crm_timeline_routes import _ensure_tables as _ensure_crm_timeline_tables
from api.job_communications_routes import _ensure_tables as _ensure_job_comm_tables
from core.database import get_conn

router = APIRouter(tags=["client-notes"])


def _to_iso(value: Any) -> str | None:
    if value is None:
        return None
    try:
        if hasattr(value, "isoformat"):
            return value.isoformat()
    except Exception:
        pass
    text_value = str(value).strip()
    return text_value or None


def _safe_text(value: Any) -> str:
    return str(value or "").strip()


def _safe_int(value: Any, default: int | None = None) -> int | None:
    try:
        if value is None or str(value).strip() == "":
            return default
        return int(value)
    except Exception:
        return default


def _matches_search(search: str, values: list[Any]) -> bool:
    terms = [term.strip().lower() for term in str(search or "").split() if term.strip()]
    if not terms:
        return True
    haystack = " ".join(_safe_text(value).lower() for value in values)
    return all(term in haystack for term in terms)


def _build_job_lookup(jobs_df: pd.DataFrame | None) -> dict[int, dict[str, Any]]:
    lookup: dict[int, dict[str, Any]] = {}
    if jobs_df is None or jobs_df.empty:
        return lookup
    for _, row in jobs_df.iterrows():
        try:
            job_id = int(row.get("job_id") or 0)
        except Exception:
            continue
        if job_id <= 0:
            continue
        lookup[job_id] = {
            "job_id": job_id,
            "job_number": _safe_text(row.get("job_number")) or None,
            "job_title": _safe_text(row.get("title")) or None,
            "reporting_year": int(row.get("reporting_year")) if row.get("reporting_year") is not None else None,
            "status": _safe_text(row.get("status")) or None,
        }
    return lookup


@router.get("/clients/{client_id}/notes-summary")
def get_client_notes_summary(
    client_id: int,
    source: str | None = Query(default=None),
    job_id: int | None = Query(default=None),
    scope: str | None = Query(default=None),
    site_id: int | None = Query(default=None),
    author: str | None = Query(default=None),
    q: str | None = Query(default=None),
    _user: dict[str, str] = Depends(_current_user),
):
    """Return client-level and job-level notes for a client (excludes job data row notes)."""

    try:
        with get_conn() as con:
            _ensure_crm_timeline_tables(con)
            _ensure_job_comm_tables(con)

            def _safe_df(sql: str, params: list[Any] | None = None) -> pd.DataFrame | None:
                try:
                    return con.execute(sql, params or []).df()
                except Exception:
                    return None

            client_row = con.execute(
                """
                SELECT db_id, client_name
                FROM clients
                WHERE db_id = %s
                """,
                [int(client_id)],
            ).fetchone()
            if not client_row:
                raise HTTPException(status_code=404, detail="Client not found")

            jobs_df = _safe_df(
                """
                SELECT job_id, job_number, title, reporting_year, status
                FROM jobs
                WHERE client_db_id = %s
                ORDER BY reporting_year DESC NULLS LAST, job_id DESC
                """,
                [int(client_id)],
            )
            job_lookup = _build_job_lookup(jobs_df)

            items: list[dict[str, Any]] = []

            client_events_df = _safe_df(
                """
                SELECT
                    e.event_id,
                    e.client_db_id,
                    e.job_id,
                    e.subject,
                    e.body_text,
                    e.created_by,
                    e.created_at,
                    e.updated_at,
                    e.updated_by,
                    e.archived,
                    e.archived_at,
                    e.archived_by,
                    e.event_at,
                    j.job_number,
                    j.title AS job_title
                FROM crm_events e
                LEFT JOIN jobs j ON j.job_id = e.job_id
                WHERE e.client_db_id = %s
                  AND lower(COALESCE(e.event_type, '')) = 'note'
                  AND COALESCE(e.archived, FALSE) = FALSE
                ORDER BY COALESCE(e.event_at, e.created_at) DESC NULLS LAST, e.event_id DESC
                """,
                [int(client_id)],
            )
            if client_events_df is not None and not client_events_df.empty:
                for _, row in client_events_df.iterrows():
                    try:
                        note_text = _safe_text(row.get("body_text"))
                        if not note_text:
                            continue
                        job_id_val = _safe_int(row.get("job_id"), None)
                        job_info = job_lookup.get(job_id_val or -1, {}) if job_id_val is not None else {}
                        job_number = _safe_text(row.get("job_number") or job_info.get("job_number")) or None
                        job_title = _safe_text(row.get("job_title") or job_info.get("job_title")) or None
                        subject = _safe_text(row.get("subject")) or None
                        location_bits = ["Client Note"]
                        if job_number:
                            location_bits.append(f"Job {job_number}")
                        elif job_id_val is not None:
                            location_bits.append(f"Job {job_id_val}")
                        if subject:
                            location_bits.append(subject)
                        raw_id = _safe_int(row.get("event_id"), 0) or 0
                        updated_by = _safe_text(row.get("updated_by")) or None
                        items.append(
                            {
                                "note_id": f"client-event-{raw_id}",
                                "source_type": "client",
                                "source_label": "Client Note",
                                "raw_id": raw_id,
                                "raw_job_id": job_id_val,
                                "client_db_id": _safe_int(row.get("client_db_id"), client_id) or client_id,
                                "job_id": job_id_val,
                                "job_number": job_number,
                                "job_title": job_title,
                                "scope": "",
                                "site_id": None,
                                "site_name": "",
                                "category": "",
                                "report_label": "",
                                "original_id": "",
                                "note_location": " | ".join(location_bits),
                                "note_subject": subject,
                                "note_text": note_text,
                                "note_author": _safe_text(row.get("created_by")) or None,
                                "updated_by": updated_by,
                                "archived": bool(row.get("archived")) if row.get("archived") is not None else False,
                                "archived_at": _to_iso(row.get("archived_at")),
                                "archived_by": _safe_text(row.get("archived_by")) or None,
                                "note_updated_at": _to_iso(row.get("event_at") or row.get("updated_at") or row.get("created_at")),
                                "row_created_at": _to_iso(row.get("created_at")),
                                "row_updated_at": _to_iso(row.get("updated_at")),
                            }
                        )
                    except Exception:
                        continue

            job_comm_df = _safe_df(
                """
                SELECT
                    jc.communication_id,
                    jc.job_id,
                    jc.client_db_id,
                    jc.channel,
                    jc.subject,
                    jc.message_text,
                    jc.scope,
                    jc.category,
                    jc.site_id,
                    COALESCE(jc.site_name, cs.site_name, '') AS site_name,
                    jc.created_by,
                    jc.created_at,
                    jc.updated_at,
                    jc.updated_by,
                    jc.archived,
                    jc.archived_at,
                    jc.archived_by,
                    jc.event_at,
                    j.job_number,
                    j.title AS job_title
                FROM job_communications jc
                JOIN jobs j ON j.job_id = jc.job_id
                LEFT JOIN client_sites cs ON cs.site_id = jc.site_id
                WHERE j.client_db_id = %s
                  AND lower(COALESCE(jc.channel, '')) = 'note'
                  AND COALESCE(jc.archived, FALSE) = FALSE
                ORDER BY COALESCE(jc.event_at, jc.created_at) DESC NULLS LAST, jc.communication_id DESC
                """,
                [int(client_id)],
            )
            if job_comm_df is not None and not job_comm_df.empty:
                for _, row in job_comm_df.iterrows():
                    try:
                        note_text = _safe_text(row.get("message_text"))
                        if not note_text:
                            continue
                        job_id_val = _safe_int(row.get("job_id"), None)
                        job_info = job_lookup.get(job_id_val or -1, {}) if job_id_val is not None else {}
                        job_number = _safe_text(row.get("job_number") or job_info.get("job_number")) or None
                        job_title = _safe_text(row.get("job_title") or job_info.get("job_title")) or None
                        subject = _safe_text(row.get("subject")) or None
                        location_bits = ["Job Note"]
                        if job_number:
                            location_bits.append(f"Job {job_number}")
                        elif job_id_val is not None:
                            location_bits.append(f"Job {job_id_val}")
                        if subject:
                            location_bits.append(subject)
                        raw_id = _safe_int(row.get("communication_id"), 0) or 0
                        updated_by = _safe_text(row.get("updated_by")) or None
                        items.append(
                            {
                                "note_id": f"job-comm-{raw_id}",
                                "source_type": "job-communication",
                                "source_label": "Job Note",
                                "raw_id": raw_id,
                                "raw_job_id": job_id_val,
                                "client_db_id": _safe_int(row.get("client_db_id"), client_id) or client_id,
                                "job_id": job_id_val,
                                "job_number": job_number,
                                "job_title": job_title,
                                "scope": _safe_text(row.get("scope")),
                                "site_id": _safe_int(row.get("site_id")),
                                "site_name": _safe_text(row.get("site_name")),
                                "category": _safe_text(row.get("category")),
                                "report_label": "",
                                "original_id": "",
                                "note_location": " | ".join(location_bits),
                                "note_subject": subject,
                                "note_text": note_text,
                                "note_author": _safe_text(row.get("created_by")) or None,
                                "updated_by": updated_by,
                                "archived": bool(row.get("archived")) if row.get("archived") is not None else False,
                                "archived_at": _to_iso(row.get("archived_at")),
                                "archived_by": _safe_text(row.get("archived_by")) or None,
                                "note_updated_at": _to_iso(row.get("event_at") or row.get("updated_at") or row.get("created_at")),
                                "row_created_at": _to_iso(row.get("created_at")),
                                "row_updated_at": _to_iso(row.get("updated_at")),
                            }
                        )
                    except Exception:
                        continue

            filtered: list[dict[str, Any]] = []
            source_val = _safe_text(source).lower()
            scope_val = _safe_text(scope)
            author_val = _safe_text(author)
            search_val = _safe_text(q)

            for item in items:
                if source_val and source_val != "all" and _safe_text(item.get("source_type")).lower() != source_val:
                    continue
                if job_id is not None and int(item.get("job_id") or 0) != int(job_id):
                    continue
                if scope_val and _safe_text(item.get("scope")) != scope_val:
                    continue
                if site_id is not None and int(item.get("site_id") or 0) != int(site_id):
                    continue
                if author_val and _safe_text(item.get("note_author")) != author_val:
                    continue
                if search_val and not _matches_search(
                    search_val,
                    [
                        item.get("note_text"),
                        item.get("note_location"),
                        item.get("note_subject"),
                        item.get("note_author"),
                        item.get("source_label"),
                        item.get("job_number"),
                        item.get("job_title"),
                        item.get("scope"),
                        item.get("site_name"),
                        item.get("category"),
                        item.get("report_label"),
                        item.get("original_id"),
                    ],
                ):
                    continue
                filtered.append(item)

            filtered.sort(
                key=lambda item: str(
                    item.get("note_updated_at") or item.get("row_updated_at") or item.get("row_created_at") or ""
                ),
                reverse=True,
            )

            jobs = [
                {
                    "job_id": int(job["job_id"]),
                    "job_number": job.get("job_number"),
                    "job_title": job.get("job_title"),
                    "reporting_year": job.get("reporting_year"),
                    "status": job.get("status"),
                }
                for job in job_lookup.values()
            ]

            return {
                "client_db_id": int(client_id),
                "client_name": str(client_row[1]) if len(client_row) > 1 and client_row[1] is not None else None,
                "total": len(filtered),
                "items": filtered,
                "jobs": jobs,
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch client notes summary: {e}")
