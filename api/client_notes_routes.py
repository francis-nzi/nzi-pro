from __future__ import annotations

from typing import Any

import pandas as pd
from fastapi import APIRouter, Body, Depends, HTTPException, Query

from api.auth import _current_user
from api.crm_timeline_routes import _ensure_tables as _ensure_crm_timeline_tables
from api.job_communications_routes import _ensure_tables as _ensure_job_comm_tables
from core.database import get_conn
from services.audit_log import ensure_audit_log_table, record_audit_event

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


def _display_name(con, value: Any) -> str | None:
    raw = _safe_text(value)
    if not raw:
        return None
    try:
        row = con.execute(
            """
            SELECT COALESCE(NULLIF(TRIM(full_name), ''), email)
            FROM users
            WHERE lower(COALESCE(email, '')) = lower(%s)
               OR lower(COALESCE(full_name, '')) = lower(%s)
            LIMIT 1
            """,
            [raw, raw],
        ).fetchone()
        if row and row[0]:
            return _safe_text(row[0]) or None
    except Exception:
        pass
    return raw


def _safe_int(value: Any, default: int | None = None) -> int | None:
    try:
        if value is None or str(value).strip() == "":
            return default
        return int(value)
    except Exception:
        return default


def _ensure_client_notes_schema(con) -> None:
    con.execute("ALTER TABLE client_notes ADD COLUMN IF NOT EXISTS job_id INTEGER")
    con.execute("ALTER TABLE client_notes ADD COLUMN IF NOT EXISTS subject TEXT")
    con.execute("ALTER TABLE client_notes ADD COLUMN IF NOT EXISTS is_high_importance BOOLEAN NOT NULL DEFAULT FALSE")
    con.execute("ALTER TABLE client_notes ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE")
    con.execute("ALTER TABLE client_notes ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP")
    con.execute("ALTER TABLE client_notes ADD COLUMN IF NOT EXISTS archived_by VARCHAR")
    con.execute("ALTER TABLE client_notes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP")
    con.execute("ALTER TABLE client_notes ADD COLUMN IF NOT EXISTS updated_by VARCHAR")


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


def _serialize_client_note_row(con, row: dict[str, Any], client_id: int, job_lookup: dict[int, dict[str, Any]]) -> dict[str, Any]:
    raw_id = _safe_int(row.get("note_id"), 0) or 0
    note_text = _safe_text(row.get("note_text"))
    subject = _safe_text(row.get("subject")) or None
    job_id_val = _safe_int(row.get("job_id"), None)
    job_info = job_lookup.get(job_id_val or -1, {}) if job_id_val is not None else {}
    job_number = _safe_text(row.get("job_number") or job_info.get("job_number")) or None
    job_title = _safe_text(row.get("job_title") or job_info.get("job_title")) or None
    location_bits = ["Client Note"]
    if job_number:
        location_bits.append(f"Job {job_number}")
    elif job_id_val is not None:
        location_bits.append(f"Job {job_id_val}")
    if subject:
        location_bits.append(subject)
    created_at = row.get("created_at")
    updated_at = row.get("updated_at") or created_at
    author = _display_name(con, row.get("author"))
    updated_by = _display_name(con, row.get("updated_by"))
    return {
        "note_id": f"client-note-{raw_id}",
        "source_type": "client",
        "note_backend": "client_notes",
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
        "note_author": author,
        "updated_by": updated_by,
        "is_high_importance": bool(row.get("is_high_importance")) if row.get("is_high_importance") is not None else False,
        "archived": bool(row.get("archived")) if row.get("archived") is not None else False,
        "archived_at": _to_iso(row.get("archived_at")),
        "archived_by": _safe_text(row.get("archived_by")) or None,
        "note_created_at": _to_iso(created_at),
        "note_updated_at": _to_iso(updated_at),
        "row_created_at": _to_iso(created_at),
        "row_updated_at": _to_iso(updated_at),
        "note_edit_timestamps": [],
    }


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
            _ensure_client_notes_schema(con)
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
            audit_df = _safe_df(
                """
                SELECT entity_id, action, created_at
                FROM audit_log
                WHERE client_id = %s
                  AND entity_type = 'client_note'
                ORDER BY created_at ASC, audit_id ASC
                """,
                [int(client_id)],
            )
            audit_map: dict[int, dict[str, list[str]]] = {}
            if audit_df is not None and not audit_df.empty:
                for _, audit_row in audit_df.iterrows():
                    note_id_val = _safe_int(audit_row.get("entity_id"), None)
                    if note_id_val is None:
                        continue
                    entry = audit_map.setdefault(note_id_val, {"edits": [], "all": []})
                    timestamp = _to_iso(audit_row.get("created_at"))
                    if timestamp:
                        entry["all"].append(timestamp)
                        if _safe_text(audit_row.get("action")).lower() != "create":
                            entry["edits"].append(timestamp)

            items: list[dict[str, Any]] = []

            client_notes_df = _safe_df(
                """
                SELECT
                    cn.note_id,
                    cn.client_db_id,
                    cn.job_id,
                    cn.subject,
                    cn.note_text,
                    cn.author,
                    cn.is_high_importance,
                    cn.archived,
                    cn.archived_at,
                    cn.archived_by,
                    cn.created_at,
                    cn.updated_at,
                    cn.updated_by,
                    j.job_number,
                    j.title AS job_title
                FROM client_notes cn
                LEFT JOIN jobs j ON j.job_id = cn.job_id
                WHERE cn.client_db_id = %s
                  AND COALESCE(cn.archived, FALSE) = FALSE
                ORDER BY COALESCE(cn.updated_at, cn.created_at) DESC NULLS LAST, cn.note_id DESC
                """,
                [int(client_id)],
            )
            if client_notes_df is not None and not client_notes_df.empty:
                for _, row in client_notes_df.iterrows():
                    try:
                        note_text = _safe_text(row.get("note_text"))
                        if not note_text:
                            continue
                        serialized = _serialize_client_note_row(con, row.to_dict(), int(client_id), job_lookup)
                        note_id_val = _safe_int(row.get("note_id"), None)
                        if note_id_val is not None:
                            serialized["note_edit_timestamps"] = audit_map.get(note_id_val, {}).get("edits", [])
                        items.append(serialized)
                    except Exception:
                        continue

            client_events_df = _safe_df(
                """
                SELECT
                    e.event_id,
                    e.client_db_id,
                    e.job_id,
                    e.subject,
                    e.body_text,
                    e.is_high_importance,
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
                        updated_by = _display_name(con, row.get("updated_by"))
                        items.append(
                            {
                                "note_id": f"client-event-{raw_id}",
                                "source_type": "client",
                                "note_backend": "crm_event",
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
                                "note_author": _display_name(con, row.get("created_by")),
                                "updated_by": updated_by,
                                "is_high_importance": bool(row.get("is_high_importance")) if row.get("is_high_importance") is not None else False,
                                "archived": bool(row.get("archived")) if row.get("archived") is not None else False,
                                "archived_at": _to_iso(row.get("archived_at")),
                                "archived_by": _safe_text(row.get("archived_by")) or None,
                                "note_created_at": _to_iso(row.get("created_at")),
                                "note_updated_at": _to_iso(row.get("event_at") or row.get("updated_at") or row.get("created_at")),
                                "row_created_at": _to_iso(row.get("created_at")),
                                "row_updated_at": _to_iso(row.get("updated_at")),
                                "note_edit_timestamps": [],
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
                        updated_by = _display_name(con, row.get("updated_by"))
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
                                "note_author": _display_name(con, row.get("created_by")),
                                "updated_by": updated_by,
                                "is_high_importance": False,
                                "archived": bool(row.get("archived")) if row.get("archived") is not None else False,
                                "archived_at": _to_iso(row.get("archived_at")),
                                "archived_by": _safe_text(row.get("archived_by")) or None,
                                "note_created_at": _to_iso(row.get("created_at")),
                                "note_updated_at": _to_iso(row.get("event_at") or row.get("updated_at") or row.get("created_at")),
                                "row_created_at": _to_iso(row.get("created_at")),
                                "row_updated_at": _to_iso(row.get("updated_at")),
                                "note_edit_timestamps": [],
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
            filtered.sort(key=lambda item: 0 if bool(item.get("is_high_importance")) else 1)

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


@router.post("/clients/{client_id}/notes")
def create_client_note(client_id: int, body: dict = Body(...), _user: dict[str, str] = Depends(_current_user)):
    try:
        with get_conn() as con:
            _ensure_client_notes_schema(con)
            ensure_audit_log_table(con)
            client_row = con.execute("SELECT db_id FROM clients WHERE db_id = %s", [int(client_id)]).fetchone()
            if not client_row:
                raise HTTPException(status_code=404, detail="Client not found")
            author = _display_name(con, _user.get("email") or _user.get("user_id") or "system") or _safe_text(_user.get("email") or _user.get("user_id")) or "system"
            subject = _safe_text(body.get("subject")) or None
            note_text = _safe_text(body.get("note_text"))
            if not note_text:
                raise HTTPException(status_code=400, detail="note_text is required")
            job_id_value = _safe_int(body.get("job_id"), None)
            row = con.execute(
                """
                INSERT INTO client_notes (
                    client_db_id, job_id, subject, note_text, author, is_high_importance, created_at, updated_at, updated_by
                )
                VALUES (%s, %s, %s, %s, %s, %s, NOW(), NOW(), %s)
                RETURNING note_id
                """,
                [
                    int(client_id),
                    job_id_value,
                    subject,
                    note_text,
                    author,
                    bool(body.get("is_high_importance", False)),
                    author,
                ],
            ).fetchone()
            note_id = int(row[0])
            row_df = con.execute("SELECT * FROM client_notes WHERE note_id = %s", [note_id]).df()
            after = row_df.iloc[0].to_dict() if row_df is not None and not row_df.empty else None
            record_audit_event(
                con,
                request=None,
                actor={"user_id": _user.get("user_id"), "email": _user.get("email"), "full_name": author, "org_id": _user.get("org_id")},
                action="create",
                entity_type="client_note",
                entity_id=note_id,
                client_id=int(client_id),
                job_id=job_id_value,
                after=after,
                metadata={"updated_fields": ["subject", "note_text", "is_high_importance"]},
            )
            payload = {
                "note_id": note_id,
                "client_db_id": int(client_id),
                "job_id": job_id_value,
                "subject": subject,
                "note_text": note_text,
                "author": author,
                "is_high_importance": bool(body.get("is_high_importance", False)),
                "archived": False,
                "created_at": None,
                "updated_at": None,
                "updated_by": author,
            }
            return {"ok": True, "item": payload}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create client note: {e}")


@router.patch("/client-notes/{note_id}")
def update_client_note(note_id: int, body: dict = Body(...), _user: dict[str, str] = Depends(_current_user)):
    try:
        with get_conn() as con:
            _ensure_client_notes_schema(con)
            ensure_audit_log_table(con)
            row = con.execute(
                "SELECT note_id, client_db_id, archived FROM client_notes WHERE note_id = %s",
                [int(note_id)],
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Client note not found")
            if bool(row[2]):
                raise HTTPException(status_code=400, detail="Client note is archived")
            author = _display_name(con, _user.get("email") or _user.get("user_id") or "system") or _safe_text(_user.get("email") or _user.get("user_id")) or "system"
            updates: list[str] = []
            params: list[Any] = []
            if "subject" in body:
                updates.append("subject = %s")
                params.append(_safe_text(body.get("subject")) or None)
            if "note_text" in body:
                note_text = _safe_text(body.get("note_text"))
                if not note_text:
                    raise HTTPException(status_code=400, detail="note_text is required")
                updates.append("note_text = %s")
                params.append(note_text)
            if "is_high_importance" in body:
                updates.append("is_high_importance = %s")
                params.append(bool(body.get("is_high_importance")))
            if updates:
                before_row = con.execute("SELECT * FROM client_notes WHERE note_id = %s", [int(note_id)]).df()
                before = before_row.iloc[0].to_dict() if before_row is not None and not before_row.empty else None
                updates.extend(["updated_at = NOW()", "updated_by = %s"])
                params.extend([author, int(note_id)])
                con.execute(f"UPDATE client_notes SET {', '.join(updates)} WHERE note_id = %s", params)
            row_df = con.execute("SELECT * FROM client_notes WHERE note_id = %s", [int(note_id)]).df()
            item = row_df.iloc[0].to_dict() if row_df is not None and not row_df.empty else {"note_id": int(note_id)}
            record_audit_event(
                con,
                request=None,
                actor={"user_id": _user.get("user_id"), "email": _user.get("email"), "full_name": author, "org_id": _user.get("org_id")},
                action="update",
                entity_type="client_note",
                entity_id=int(note_id),
                client_id=int(row[1]) if row[1] is not None else None,
                job_id=_safe_int(item.get("job_id"), None),
                before=before if updates else None,
                after=item,
                metadata={"updated_fields": sorted([key for key in ("subject", "note_text", "is_high_importance") if key in body])},
            )
            return {"ok": True, "item": item}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update client note: {e}")


@router.patch("/client-notes/{note_id}/archive")
def archive_client_note(note_id: int, _user: dict[str, str] = Depends(_current_user)):
    try:
        with get_conn() as con:
            _ensure_client_notes_schema(con)
            ensure_audit_log_table(con)
            exists = con.execute("SELECT note_id FROM client_notes WHERE note_id = %s", [int(note_id)]).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="Client note not found")
            actor = _display_name(con, _user.get("email") or _user.get("user_id") or "system") or _safe_text(_user.get("email") or _user.get("user_id")) or "system"
            before_row = con.execute("SELECT * FROM client_notes WHERE note_id = %s", [int(note_id)]).df()
            before = before_row.iloc[0].to_dict() if before_row is not None and not before_row.empty else None
            con.execute(
                """
                UPDATE client_notes
                SET archived = TRUE, archived_at = NOW(), archived_by = %s, updated_at = NOW(), updated_by = %s
                WHERE note_id = %s
                """,
                [actor, actor, int(note_id)],
            )
            after_row = con.execute("SELECT * FROM client_notes WHERE note_id = %s", [int(note_id)]).df()
            after = after_row.iloc[0].to_dict() if after_row is not None and not after_row.empty else None
            record_audit_event(
                con,
                request=None,
                actor={"user_id": _user.get("user_id"), "email": _user.get("email"), "full_name": actor, "org_id": _user.get("org_id")},
                action="archive",
                entity_type="client_note",
                entity_id=int(note_id),
                client_id=_safe_int(after.get("client_db_id"), None) if after else None,
                job_id=_safe_int(after.get("job_id"), None) if after else None,
                before=before,
                after=after,
                metadata={"updated_fields": ["archived"]},
            )
            return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to archive client note: {e}")
