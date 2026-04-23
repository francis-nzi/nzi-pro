from __future__ import annotations

from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query

from api.auth import _current_user
from api.crm_timeline_routes import _ensure_tables as _ensure_crm_timeline_tables
from api.job_scope_data_routes import _ensure_job_scope_rows_schema
from core.database import get_conn
from services.audit_log import ensure_audit_log_table, parse_json_text

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
    """Return all notes for a client across client communications, job communications, and job data."""

    try:
        with get_conn() as con:
            _ensure_crm_timeline_tables(con)
            _ensure_job_scope_rows_schema(con)
            ensure_audit_log_table(con)

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
            job_ids = list(job_lookup.keys())

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
                    e.event_at,
                    j.job_number,
                    j.title AS job_title
                FROM crm_events e
                LEFT JOIN jobs j ON j.job_id = e.job_id
                WHERE e.client_db_id = %s
                  AND lower(COALESCE(e.event_type, '')) = 'note'
                ORDER BY COALESCE(e.event_at, e.created_at) DESC NULLS LAST, e.event_id DESC
                """,
                [int(client_id)],
            )
            if client_events_df is not None and not client_events_df.empty:
                for _, row in client_events_df.iterrows():
                    note_text = _safe_text(row.get("body_text"))
                    if not note_text:
                        continue
                    job_id_val = int(row.get("job_id")) if row.get("job_id") is not None else None
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
                    items.append(
                        {
                            "note_id": f"client-event-{int(row.get('event_id') or 0)}",
                            "source_type": "client",
                            "source_label": "Client Note",
                            "client_db_id": int(row.get("client_db_id") or client_id),
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
                            "note_updated_at": _to_iso(row.get("event_at") or row.get("updated_at") or row.get("created_at")),
                            "row_created_at": _to_iso(row.get("created_at")),
                            "row_updated_at": _to_iso(row.get("updated_at")),
                        }
                    )

            job_comm_df = _safe_df(
                """
                SELECT
                    jc.communication_id,
                    jc.job_id,
                    jc.client_db_id,
                    jc.channel,
                    jc.subject,
                    jc.message_text,
                    jc.created_by,
                    jc.created_at,
                    jc.updated_at,
                    jc.event_at,
                    j.job_number,
                    j.title AS job_title
                FROM job_communications jc
                JOIN jobs j ON j.job_id = jc.job_id
                WHERE j.client_db_id = %s
                  AND lower(COALESCE(jc.channel, '')) = 'note'
                ORDER BY COALESCE(jc.event_at, jc.created_at) DESC NULLS LAST, jc.communication_id DESC
                """,
                [int(client_id)],
            )
            if job_comm_df is not None and not job_comm_df.empty:
                for _, row in job_comm_df.iterrows():
                    note_text = _safe_text(row.get("message_text"))
                    if not note_text:
                        continue
                    job_id_val = int(row.get("job_id")) if row.get("job_id") is not None else None
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
                    items.append(
                        {
                            "note_id": f"job-comm-{int(row.get('communication_id') or 0)}",
                            "source_type": "job-communication",
                            "source_label": "Job Note",
                            "client_db_id": int(row.get("client_db_id") or client_id),
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
                            "note_updated_at": _to_iso(row.get("event_at") or row.get("updated_at") or row.get("created_at")),
                            "row_created_at": _to_iso(row.get("created_at")),
                            "row_updated_at": _to_iso(row.get("updated_at")),
                        }
                    )

            if job_ids:
                placeholders = ", ".join(["%s"] * len(job_ids))
                job_data_df = _safe_df(
                    f"""
                    SELECT
                        jsr.row_id,
                        jsr.job_id,
                        j.job_number,
                        j.title AS job_title,
                        jsr.scope,
                        jsr.site_id,
                        cs.site_name,
                        jsr.category,
                        jsr.level_1,
                        jsr.level_2,
                        jsr.level_3,
                        jsr.level_4,
                        jsr.column_text,
                        jsr.report_label,
                        jsr.original_id,
                        jsr.notes,
                        jsr.created_at,
                        jsr.updated_at
                    FROM job_scope_rows jsr
                    JOIN jobs j ON j.job_id = jsr.job_id
                    LEFT JOIN client_sites cs ON cs.site_id = jsr.site_id
                    WHERE j.client_db_id = %s
                      AND jsr.job_id IN ({placeholders})
                      AND COALESCE(TRIM(CAST(jsr.notes AS VARCHAR)), '') <> ''
                    ORDER BY jsr.updated_at DESC NULLS LAST, jsr.created_at DESC NULLS LAST, jsr.row_id DESC
                    """,
                    [int(client_id), *job_ids],
                )

                audit_df = _safe_df(
                    f"""
                    SELECT audit_id, job_id, entity_id, created_at, actor_email, actor_name, diff_json, metadata_json
                    FROM audit_log
                    WHERE job_id IN ({placeholders})
                      AND entity_type = 'job_scope_row'
                    ORDER BY created_at DESC, audit_id DESC
                    """,
                    job_ids,
                )

                latest_note_events: dict[str, dict[str, Any]] = {}
                if audit_df is not None and not audit_df.empty:
                    for _, audit_row in audit_df.iterrows():
                        entity_id = _safe_text(audit_row.get("entity_id"))
                        if not entity_id or entity_id in latest_note_events:
                            continue

                        diff_data = parse_json_text(audit_row.get("diff_json"))
                        meta_data = parse_json_text(audit_row.get("metadata_json"))
                        note_change_detected = False
                        if isinstance(diff_data, dict) and "notes" in diff_data:
                            note_change_detected = True
                        if not note_change_detected and isinstance(meta_data, dict):
                            updated_fields = meta_data.get("updated_fields")
                            if isinstance(updated_fields, list) and any(str(field).strip() == "notes" for field in updated_fields):
                                note_change_detected = True
                        if not note_change_detected:
                            continue

                        latest_note_events[entity_id] = {
                            "updated_at": _to_iso(audit_row.get("created_at")),
                            "updated_by": _safe_text(audit_row.get("actor_name") or audit_row.get("actor_email")) or None,
                        }

                if job_data_df is not None and not job_data_df.empty:
                    for _, row in job_data_df.iterrows():
                        row_id = int(row.get("row_id"))
                        note_text = _safe_text(row.get("notes"))
                        if not note_text:
                            continue
                        job_id_val = int(row.get("job_id")) if row.get("job_id") is not None else None
                        job_info = job_lookup.get(job_id_val or -1, {}) if job_id_val is not None else {}
                        job_number = _safe_text(row.get("job_number") or job_info.get("job_number")) or None
                        job_title = _safe_text(row.get("job_title") or job_info.get("job_title")) or None
                        site_name = _safe_text(row.get("site_name")) or (
                            f"Site {row.get('site_id')}" if row.get("site_id") is not None else "No Site Assigned"
                        )
                        location_parts = []
                        if job_number:
                            location_parts.append(f"Job {job_number}")
                        elif job_id_val is not None:
                            location_parts.append(f"Job {job_id_val}")
                        if site_name:
                            location_parts.append(site_name)
                        location_parts.extend(
                            [
                                _safe_text(row.get("scope")),
                                _safe_text(row.get("category") or row.get("level_2") or row.get("level_1")),
                                _safe_text(row.get("report_label") or row.get("column_text") or row.get("original_id")),
                            ]
                        )
                        note_event = latest_note_events.get(str(row_id), {})
                        items.append(
                            {
                                "note_id": f"job-data-{row_id}",
                                "source_type": "job-data",
                                "source_label": "Job Data Note",
                                "client_db_id": int(client_id),
                                "job_id": job_id_val,
                                "job_number": job_number,
                                "job_title": job_title,
                                "scope": _safe_text(row.get("scope")),
                                "site_id": int(row.get("site_id")) if row.get("site_id") is not None else None,
                                "site_name": site_name,
                                "category": _safe_text(row.get("category") or row.get("level_2") or row.get("level_1")),
                                "report_label": _safe_text(row.get("report_label") or row.get("column_text") or row.get("original_id")),
                                "original_id": _safe_text(row.get("original_id")),
                                "note_location": " | ".join(part for part in location_parts if part),
                                "note_subject": _safe_text(row.get("report_label") or row.get("column_text") or row.get("original_id")) or None,
                                "note_text": note_text,
                                "note_author": _safe_text(note_event.get("updated_by")) or None,
                                "note_updated_at": _safe_text(note_event.get("updated_at")) or _to_iso(row.get("updated_at")),
                                "row_created_at": _to_iso(row.get("created_at")),
                                "row_updated_at": _to_iso(row.get("updated_at")),
                            }
                        )

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
