from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from api.auth import _current_user
from core.database import get_conn
from services.outbound_email import send_tracked_email

router = APIRouter(tags=["crm-timeline"])

_timeline_schema_seeded: bool = False


def _actor(user: dict) -> str:
    return str(user.get("email") or user.get("user_id") or "system").strip()


def _safe_int(v) -> int | None:
    """Convert a value to int, returning None for NULL/NaN (DuckDB returns NaN for NULL ints)."""
    if v is None:
        return None
    try:
        f = float(v)
        import math
        if math.isnan(f) or math.isinf(f):
            return None
        return int(f)
    except (TypeError, ValueError):
        return None


def _ensure_tables(con) -> None:
    global _timeline_schema_seeded
    if _timeline_schema_seeded:
        return
    import sys
    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS crm_events (
              event_id BIGSERIAL PRIMARY KEY,
              client_db_id INTEGER NOT NULL,
              job_id INTEGER,
              event_type VARCHAR(50) NOT NULL,
              channel VARCHAR(30) NOT NULL,
              direction VARCHAR(20),
              subject TEXT,
              body_text TEXT,
              body_html TEXT,
              status VARCHAR(30) NOT NULL DEFAULT 'logged',
              owner_user_id VARCHAR,
              due_at TIMESTAMP,
              source VARCHAR(50) NOT NULL DEFAULT 'manual',
              source_ref VARCHAR(120),
              payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
              is_private BOOLEAN NOT NULL DEFAULT FALSE,
              is_high_importance BOOLEAN NOT NULL DEFAULT FALSE,
              created_by VARCHAR,
              created_at TIMESTAMP NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            )
            """
        )
        con.execute("CREATE INDEX IF NOT EXISTS ix_crm_events_client_created ON crm_events (client_db_id, created_at DESC)")
        con.execute("CREATE INDEX IF NOT EXISTS ix_crm_events_job_created ON crm_events (job_id, created_at DESC)")
        con.execute("CREATE INDEX IF NOT EXISTS ix_crm_events_type ON crm_events (event_type)")
        con.execute("CREATE INDEX IF NOT EXISTS ix_crm_events_status ON crm_events (status)")
        try:
            con.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS ux_crm_events_source_ref
                ON crm_events (source, source_ref)
                WHERE source_ref IS NOT NULL AND source_ref <> ''
                """
            )
        except Exception as _idx_err:
            print(f"[warn] ux_crm_events_source_ref: {_idx_err}", file=sys.stderr)
        con.execute("ALTER TABLE crm_events ADD COLUMN IF NOT EXISTS updated_by VARCHAR")
        con.execute("ALTER TABLE crm_events ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE")
        con.execute("ALTER TABLE crm_events ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP")
        con.execute("ALTER TABLE crm_events ADD COLUMN IF NOT EXISTS archived_by VARCHAR")
        con.execute("ALTER TABLE crm_events ADD COLUMN IF NOT EXISTS is_high_importance BOOLEAN NOT NULL DEFAULT FALSE")

        con.execute(
            """
            CREATE TABLE IF NOT EXISTS crm_tasks (
              task_id BIGSERIAL PRIMARY KEY,
              event_id BIGINT REFERENCES crm_events(event_id) ON DELETE SET NULL,
              client_db_id INTEGER NOT NULL,
              job_id INTEGER,
              title VARCHAR(255) NOT NULL,
              details TEXT,
              assignee_user_id VARCHAR,
              priority VARCHAR(20) NOT NULL DEFAULT 'normal',
              sla_due_at TIMESTAMP,
              due_at TIMESTAMP,
              status VARCHAR(30) NOT NULL DEFAULT 'open',
              completed_at TIMESTAMP,
              created_by VARCHAR,
              created_at TIMESTAMP NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            )
            """
        )
        con.execute("CREATE INDEX IF NOT EXISTS ix_crm_tasks_client_status ON crm_tasks (client_db_id, status, due_at)")
        con.execute("CREATE INDEX IF NOT EXISTS ix_crm_tasks_job_status ON crm_tasks (job_id, status, due_at)")
        con.execute("CREATE INDEX IF NOT EXISTS ix_crm_tasks_assignee_status ON crm_tasks (assignee_user_id, status, due_at)")

        try:
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS crm_task_history (
                  history_id BIGSERIAL PRIMARY KEY,
                  task_id BIGINT NOT NULL,
                  changed_at TIMESTAMP NOT NULL DEFAULT NOW(),
                  changed_by VARCHAR,
                  changes TEXT NOT NULL DEFAULT '[]'
                )
                """
            )
            con.execute("CREATE INDEX IF NOT EXISTS ix_crm_task_history_task ON crm_task_history (task_id, changed_at DESC)")
        except Exception as _hist_err:
            print(f"[warn] crm_task_history setup: {_hist_err}", file=sys.stderr)

        con.execute(
            """
            CREATE TABLE IF NOT EXISTS crm_tags (
              tag_id BIGSERIAL PRIMARY KEY,
              tag_name VARCHAR(80) NOT NULL UNIQUE,
              color_hex VARCHAR(7),
              is_active BOOLEAN NOT NULL DEFAULT TRUE
            )
            """
        )
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS crm_event_tags (
              event_id BIGINT NOT NULL REFERENCES crm_events(event_id) ON DELETE CASCADE,
              tag_id BIGINT NOT NULL REFERENCES crm_tags(tag_id) ON DELETE CASCADE,
              created_at TIMESTAMP NOT NULL DEFAULT NOW(),
              PRIMARY KEY (event_id, tag_id)
            )
            """
        )

        defaults = [
            ("follow-up", "#F59E0B"),
            ("risk", "#EF4444"),
            ("finance", "#10B981"),
            ("client-waiting", "#3B82F6"),
        ]
        for tag_name, color_hex in defaults:
            try:
                con.execute(
                    """
                    INSERT INTO crm_tags (tag_name, color_hex, is_active)
                    SELECT %s, %s, TRUE
                    WHERE NOT EXISTS (SELECT 1 FROM crm_tags WHERE lower(tag_name) = lower(%s))
                    """,
                    [tag_name, color_hex, tag_name],
                )
            except Exception:
                pass

        _timeline_schema_seeded = True
    except Exception as _ddl_err:
        print(f"[warn] crm_timeline _ensure_tables: {_ddl_err}", file=sys.stderr)


def _serialize_event(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "event_id": _safe_int(row.get("event_id")) or 0,
        "client_db_id": _safe_int(row.get("client_db_id")) or 0,
        "job_id": _safe_int(row.get("job_id")),
        "event_type": str(row.get("event_type") or ""),
        "channel": str(row.get("channel") or ""),
        "direction": str(row.get("direction") or ""),
        "subject": str(row.get("subject") or ""),
        "body_text": str(row.get("body_text") or ""),
        "body_html": str(row.get("body_html") or ""),
        "status": str(row.get("status") or "logged"),
        "owner_user_id": str(row.get("owner_user_id") or ""),
        "due_at": row.get("due_at").isoformat() if row.get("due_at") else None,
        "source": str(row.get("source") or "manual"),
        "source_ref": str(row.get("source_ref") or ""),
        "payload_json": row.get("payload_json") if isinstance(row.get("payload_json"), dict) else {},
        "is_private": bool(row.get("is_private") if row.get("is_private") is not None else False),
        "is_high_importance": bool(row.get("is_high_importance") if row.get("is_high_importance") is not None else False),
        "created_by": str(row.get("created_by") or ""),
        "created_at": row.get("created_at").isoformat() if row.get("created_at") else None,
        "updated_at": row.get("updated_at").isoformat() if row.get("updated_at") else None,
        "updated_by": str(row.get("updated_by") or "") or None,
        "archived": bool(row.get("archived") if row.get("archived") is not None else False),
        "archived_at": row.get("archived_at").isoformat() if row.get("archived_at") else None,
        "archived_by": str(row.get("archived_by") or "") or None,
    }


def _serialize_task(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "task_id": _safe_int(row.get("task_id")) or 0,
        "event_id": _safe_int(row.get("event_id")),
        "client_db_id": _safe_int(row.get("client_db_id")) or 0,
        "job_id": _safe_int(row.get("job_id")),
        "title": str(row.get("title") or ""),
        "details": str(row.get("details") or ""),
        "assignee_user_id": str(row.get("assignee_user_id") or ""),
        "priority": str(row.get("priority") or "normal"),
        "sla_due_at": row.get("sla_due_at").isoformat() if row.get("sla_due_at") else None,
        "due_at": row.get("due_at").isoformat() if row.get("due_at") else None,
        "status": str(row.get("status") or "open"),
        "completed_at": row.get("completed_at").isoformat() if row.get("completed_at") else None,
        "created_by": str(row.get("created_by") or ""),
        "created_at": row.get("created_at").isoformat() if row.get("created_at") else None,
        "updated_at": row.get("updated_at").isoformat() if row.get("updated_at") else None,
    }


def _tags_for_event(con, event_id: int) -> list[str]:
    df = con.execute(
        """
        SELECT t.tag_name
        FROM crm_event_tags et
        JOIN crm_tags t ON t.tag_id = et.tag_id
        WHERE et.event_id = %s
        ORDER BY lower(t.tag_name)
        """,
        [int(event_id)],
    ).df()
    if df is None or df.empty:
        return []
    return [str(r.get("tag_name") or "") for _, r in df.iterrows() if str(r.get("tag_name") or "").strip()]


def _replace_event_tags(con, event_id: int, tags: list[str]) -> None:
    con.execute("DELETE FROM crm_event_tags WHERE event_id = %s", [int(event_id)])
    for raw in tags:
        tag = str(raw or "").strip()
        if not tag:
            continue
        con.execute(
            """
            INSERT INTO crm_tags (tag_name, is_active)
            SELECT %s, TRUE
            WHERE NOT EXISTS (SELECT 1 FROM crm_tags WHERE lower(tag_name)=lower(%s))
            """,
            [tag, tag],
        )
        tag_row = con.execute("SELECT tag_id FROM crm_tags WHERE lower(tag_name)=lower(%s) LIMIT 1", [tag]).fetchone()
        if not tag_row:
            continue
        con.execute(
            "INSERT INTO crm_event_tags (event_id, tag_id, created_at) VALUES (%s, %s, NOW()) ON CONFLICT DO NOTHING",
            [int(event_id), int(tag_row[0])],
        )


@router.get("/clients/{client_id}/timeline")
def list_client_timeline(
    client_id: int,
    job_id: int | None = Query(default=None),
    event_type: str | None = Query(default=None),
    channel: str | None = Query(default=None),
    status: str | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _user: dict = Depends(_current_user),
):
    import sys, traceback
    try:
        with get_conn() as con:
            _ensure_tables(con)
            where = ["e.client_db_id = %s", "COALESCE(e.archived, FALSE) = FALSE"]
            params: list[Any] = [int(client_id)]
            if job_id is not None:
                where.append("e.job_id = %s")
                params.append(int(job_id))
            if event_type:
                where.append("lower(e.event_type) = lower(%s)")
                params.append(str(event_type).strip())
            if channel:
                where.append("lower(e.channel) = lower(%s)")
                params.append(str(channel).strip())
            if status:
                where.append("lower(e.status) = lower(%s)")
                params.append(str(status).strip())
            if q and str(q).strip():
                needle = f"%{str(q).strip()}%"
                where.append("(e.subject ILIKE %s OR e.body_text ILIKE %s)")
                params.extend([needle, needle])

            where_sql = " AND ".join(where)
            try:
                count_row = con.execute(f"SELECT COUNT(*) FROM crm_events e WHERE {where_sql}", params).fetchone()
                total_count = int(count_row[0]) if count_row and count_row[0] is not None else 0

                rows_df = con.execute(
                    f"""
                    SELECT e.*
                    FROM crm_events e
                    WHERE {where_sql}
                    ORDER BY e.created_at DESC, e.event_id DESC
                    LIMIT %s OFFSET %s
                    """,
                    [*params, int(limit), int(offset)],
                ).df()
            except Exception as _qerr:
                print(f"[warn] crm_events query failed: {_qerr}\n{traceback.format_exc()}", file=sys.stderr)
                return {"items": [], "count": 0}

            items: list[dict[str, Any]] = []
            if rows_df is not None and not rows_df.empty:
                for _, row in rows_df.iterrows():
                    item = _serialize_event(row.to_dict())
                    item["tags"] = _tags_for_event(con, int(item["event_id"]))
                    items.append(item)
            return {"items": items, "count": total_count}
    except Exception as e:
        print(f"[error] list_client_timeline: {e}\n{traceback.format_exc()}", file=sys.stderr)
        raise HTTPException(status_code=500, detail=f"Failed to load timeline: {e}")


@router.post("/clients/{client_id}/timeline/events")
def create_client_timeline_event(client_id: int, body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        actor = _actor(_user)
        event_type = str(body.get("event_type") or "").strip() or "note"
        channel = str(body.get("channel") or "").strip() or "internal"
        with get_conn() as con:
            _ensure_tables(con)
            con.execute(
                """
                INSERT INTO crm_events (
                  client_db_id, job_id, event_type, channel, direction, subject,
                  body_text, body_html, status, owner_user_id, due_at, source, source_ref,
                  payload_json, is_private, is_high_importance, created_by, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, NOW(), NOW())
                RETURNING event_id
                """,
                [
                    int(client_id),
                    int(body["job_id"]) if body.get("job_id") is not None else None,
                    event_type,
                    channel,
                    str(body.get("direction") or "").strip() or None,
                    str(body.get("subject") or "").strip() or None,
                    str(body.get("body_text") or "").strip() or None,
                    str(body.get("body_html") or "").strip() or None,
                    str(body.get("status") or "logged"),
                    str(body.get("owner_user_id") or "").strip() or None,
                    str(body.get("due_at") or "").strip() or None,
                    str(body.get("source") or "manual"),
                    str(body.get("source_ref") or "").strip() or None,
                    body.get("payload_json") or {},
                    bool(body.get("is_private", False)),
                    bool(body.get("is_high_importance", False)),
                    actor,
                ],
            )
            event_row = con.execute("SELECT MAX(event_id) FROM crm_events WHERE client_db_id = %s", [int(client_id)]).fetchone()
            if not event_row or event_row[0] is None:
                raise HTTPException(status_code=500, detail="Failed to create event")
            event_id = int(event_row[0])
            tags = body.get("tags") or []
            if isinstance(tags, list):
                _replace_event_tags(con, event_id, tags)
            row_df = con.execute("SELECT * FROM crm_events WHERE event_id = %s", [event_id]).df()
            item = _serialize_event(row_df.iloc[0].to_dict()) if row_df is not None and not row_df.empty else {"event_id": event_id}
            item["tags"] = _tags_for_event(con, event_id)
            return item
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create timeline event: {e}")


@router.patch("/timeline/events/{event_id}")
def update_timeline_event(event_id: int, body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        actor = _actor(_user)
        with get_conn() as con:
            _ensure_tables(con)
            exists = con.execute("SELECT event_id FROM crm_events WHERE event_id = %s", [int(event_id)]).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="Event not found")

            updates: list[str] = []
            params: list[Any] = []
            for key in ("subject", "body_text", "body_html", "status", "owner_user_id", "due_at", "is_private", "is_high_importance"):
                if key not in body:
                    continue
                updates.append(f"{key} = %s")
                value = body.get(key)
                if key in ("is_private", "is_high_importance"):
                    params.append(bool(value))
                else:
                    params.append(str(value).strip() if value is not None else None)

            if "payload_json" in body:
                updates.append("payload_json = %s::jsonb")
                params.append(body.get("payload_json") or {})

            if updates:
                updates.append("updated_at = NOW()")
                updates.append("updated_by = %s")
                params.extend([actor, int(event_id)])
                con.execute(f"UPDATE crm_events SET {', '.join(updates)} WHERE event_id = %s", params)

            if "tags" in body and isinstance(body.get("tags"), list):
                _replace_event_tags(con, int(event_id), body.get("tags") or [])

            row_df = con.execute("SELECT * FROM crm_events WHERE event_id = %s", [int(event_id)]).df()
            item = _serialize_event(row_df.iloc[0].to_dict()) if row_df is not None and not row_df.empty else {"event_id": int(event_id)}
            item["tags"] = _tags_for_event(con, int(event_id))
            return item
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update event: {e}")


@router.patch("/timeline/events/{event_id}/archive")
def archive_timeline_event(event_id: int, _user: dict = Depends(_current_user)):
    try:
        actor = _actor(_user)
        with get_conn() as con:
            _ensure_tables(con)
            exists = con.execute("SELECT event_id FROM crm_events WHERE event_id = %s", [int(event_id)]).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="Event not found")
            con.execute(
                "UPDATE crm_events SET archived = TRUE, archived_at = NOW(), archived_by = %s, updated_at = NOW() WHERE event_id = %s",
                [actor, int(event_id)],
            )
            row_df = con.execute("SELECT * FROM crm_events WHERE event_id = %s", [int(event_id)]).df()
            item = _serialize_event(row_df.iloc[0].to_dict()) if row_df is not None and not row_df.empty else {"event_id": int(event_id)}
            item["tags"] = _tags_for_event(con, int(event_id))
            return item
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to archive event: {e}")


def _lookup_assignee_email(con, assignee: str, client_db_id: int | None = None) -> str | None:
    """Resolve an assignee identifier to an email address for notification."""
    s = str(assignee or "").strip()
    if not s:
        return None
    # Strip frontend picker prefixes
    if s.startswith("team:"):
        s = s[5:].strip()
    elif s.startswith("client:"):
        tail = s[7:].strip()
        # If it looks like a contact_id integer, look it up in client_contacts
        if tail.isdigit():
            try:
                row = con.execute(
                    "SELECT email FROM client_contacts WHERE contact_id = %s AND email IS NOT NULL LIMIT 1",
                    [int(tail)],
                ).fetchone()
                return str(row[0] or "").strip() or None if row else None
            except Exception:
                return None
        s = tail  # might already be an email
    # If it looks like an email, try users table first then accept as-is
    if "@" in s:
        try:
            row = con.execute(
                "SELECT email FROM users WHERE lower(email) = lower(%s) LIMIT 1", [s]
            ).fetchone()
            if row:
                return str(row[0] or "").strip() or None
        except Exception:
            pass
        # Accept the email directly
        if "." in s.split("@")[-1]:
            return s
    # Try matching as user_id
    try:
        row = con.execute(
            "SELECT email FROM users WHERE lower(user_id) = lower(%s) LIMIT 1", [s]
        ).fetchone()
        if row:
            return str(row[0] or "").strip() or None
    except Exception:
        pass
    return None


def _send_task_assignment_email(
    con,
    *,
    task_id: int,
    title: str,
    details: str | None,
    due_at: str | None,
    priority: str,
    assignee: str | None,
    job_id: int | None,
    client_db_id: int | None,
    actor: str,
) -> None:
    if not assignee:
        return
    to_email = _lookup_assignee_email(con, assignee, client_db_id)
    if not to_email:
        return
    # Try to get job name
    job_name: str | None = None
    if job_id:
        try:
            row = con.execute(
                "SELECT job_number, title FROM jobs WHERE job_id = %s LIMIT 1", [int(job_id)]
            ).fetchone()
            if row:
                job_name = f"{row[0]} – {row[1]}".strip(" –")
        except Exception:
            pass
    lines = [f"A task has been assigned to you."]
    lines.append(f"\nTitle: {title}")
    if job_name:
        lines.append(f"Job: {job_name}")
    if due_at:
        lines.append(f"Due: {due_at}")
    if priority and priority != "normal":
        lines.append(f"Priority: {priority.title()}")
    if details:
        lines.append(f"\nDetails:\n{details}")
    lines.append("\nLog in to the app to update the status.")
    send_tracked_email(
        con,
        to_email=to_email,
        subject=f"Task assigned to you: {title}",
        body_text="\n".join(lines),
        created_by=actor,
        entity_type="task",
        entity_id=task_id,
        job_id=job_id,
        client_db_id=client_db_id,
        template_key="task_assignment",
        raise_on_error=False,
    )


@router.post("/clients/{client_id}/tasks")
def create_client_task(client_id: int, body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        actor = _actor(_user)
        title = str(body.get("title") or "").strip()
        if not title:
            raise HTTPException(status_code=400, detail="title is required")
        notify = bool(body.get("notify_assignee", False))
        assignee = str(body.get("assignee_user_id") or "").strip() or None
        job_id = int(body["job_id"]) if body.get("job_id") is not None else None
        due_at = str(body.get("due_at") or "").strip() or None

        with get_conn() as con:
            _ensure_tables(con)
            row = con.execute(
                """
                INSERT INTO crm_tasks (
                  event_id, client_db_id, job_id, title, details, assignee_user_id,
                  priority, sla_due_at, due_at, status, created_by, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                RETURNING task_id
                """,
                [
                    int(body["event_id"]) if body.get("event_id") is not None else None,
                    int(client_id),
                    job_id,
                    title,
                    str(body.get("details") or "").strip() or None,
                    assignee,
                    str(body.get("priority") or "normal"),
                    str(body.get("sla_due_at") or "").strip() or None,
                    due_at,
                    str(body.get("status") or "open"),
                    actor,
                ],
            ).fetchone()
            if not row:
                raise HTTPException(status_code=500, detail="Failed to create task")
            task_id = int(row[0])

            if notify and assignee:
                _send_task_assignment_email(
                    con,
                    task_id=task_id,
                    title=title,
                    details=str(body.get("details") or "").strip() or None,
                    due_at=due_at,
                    priority=str(body.get("priority") or "normal"),
                    assignee=assignee,
                    job_id=job_id,
                    client_db_id=int(client_id),
                    actor=actor,
                )

            df = con.execute("SELECT * FROM crm_tasks WHERE task_id = %s", [task_id]).df()
            return _serialize_task(df.iloc[0].to_dict()) if df is not None and not df.empty else {"task_id": task_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create task: {e}")


@router.patch("/tasks/{task_id}")
def update_task(task_id: int, body: dict = Body(...), _user: dict = Depends(_current_user)):
    import json as _json
    try:
        with get_conn() as con:
            _ensure_tables(con)
            current = con.execute(
                "SELECT task_id, title, details, assignee_user_id, priority, sla_due_at, due_at, status FROM crm_tasks WHERE task_id = %s",
                [int(task_id)],
            ).fetchone()
            if not current:
                raise HTTPException(status_code=404, detail="Task not found")

            tracked_fields = ("title", "details", "assignee_user_id", "priority", "sla_due_at", "due_at", "status")
            col_names = ("task_id", "title", "details", "assignee_user_id", "priority", "sla_due_at", "due_at", "status")
            current_map = dict(zip(col_names, current))

            updates: list[str] = []
            params: list[Any] = []
            history_changes: list[dict] = []

            for key in tracked_fields:
                if key not in body:
                    continue
                value = body.get(key)
                new_val = str(value).strip() if value is not None else None
                old_val = str(current_map.get(key, "") or "").strip() or None
                if new_val != old_val:
                    history_changes.append({"field": key, "from": old_val, "to": new_val})
                updates.append(f"{key} = %s")
                params.append(new_val)

            status_val = str(body.get("status") or "").strip().lower()
            if "status" in body:
                if status_val == "done":
                    updates.append("completed_at = NOW()")
                elif status_val in ("open", "in_progress", "blocked", "cancelled"):
                    updates.append("completed_at = NULL")

            if not updates:
                return {"ok": True, "message": "No fields to update"}

            updates.append("updated_at = NOW()")
            params.append(int(task_id))
            con.execute(f"UPDATE crm_tasks SET {', '.join(updates)} WHERE task_id = %s", params)

            if history_changes:
                try:
                    con.execute(
                        "INSERT INTO crm_task_history (task_id, changed_by, changes) VALUES (%s, %s, %s)",
                        [int(task_id), _actor(_user), _json.dumps(history_changes)],
                    )
                except Exception:
                    pass

            df = con.execute("SELECT * FROM crm_tasks WHERE task_id = %s", [int(task_id)]).df()
            return _serialize_task(df.iloc[0].to_dict()) if df is not None and not df.empty else {"task_id": int(task_id)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update task: {e}")


@router.get("/tasks/{task_id}/history")
def get_task_history(task_id: int, _user: dict = Depends(_current_user)):
    import json as _json
    try:
        with get_conn() as con:
            _ensure_tables(con)
            rows = con.execute(
                "SELECT history_id, changed_at, changed_by, changes FROM crm_task_history WHERE task_id = %s ORDER BY changed_at DESC LIMIT 100",
                [int(task_id)],
            ).fetchall()
            items = []
            for row in rows:
                history_id, changed_at, changed_by, changes_raw = row
                try:
                    changes = _json.loads(changes_raw) if isinstance(changes_raw, str) else (changes_raw if isinstance(changes_raw, list) else [])
                except Exception:
                    changes = []
                items.append({
                    "history_id": history_id,
                    "changed_at": changed_at.isoformat() if changed_at else None,
                    "changed_by": changed_by or "system",
                    "changes": changes,
                })
            return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load task history: {e}")


@router.get("/clients/{client_id}/tasks")
def list_client_tasks(
    client_id: int,
    job_id: int | None = Query(default=None),
    assignee: str | None = Query(default=None),
    status: str | None = Query(default=None),
    priority: str | None = Query(default=None),
    due_before: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=300),
    offset: int = Query(default=0, ge=0),
    _user: dict = Depends(_current_user),
):
    try:
        with get_conn() as con:
            _ensure_tables(con)
            where = ["client_db_id = %s"]
            params: list[Any] = [int(client_id)]
            if job_id is not None:
                where.append("job_id = %s")
                params.append(int(job_id))
            if assignee:
                where.append("lower(assignee_user_id) = lower(%s)")
                params.append(str(assignee).strip())
            if status:
                where.append("lower(status) = lower(%s)")
                params.append(str(status).strip())
            if priority:
                where.append("lower(priority) = lower(%s)")
                params.append(str(priority).strip())
            if due_before:
                where.append("due_at <= %s")
                params.append(str(due_before).strip())

            where_sql = " AND ".join(where)
            count_row = con.execute(f"SELECT COUNT(*) FROM crm_tasks WHERE {where_sql}", params).fetchone()
            total_count = int(count_row[0]) if count_row and count_row[0] is not None else 0
            df = con.execute(
                f"""
                SELECT *
                FROM crm_tasks
                WHERE {where_sql}
                ORDER BY COALESCE(due_at, created_at) ASC, task_id DESC
                LIMIT %s OFFSET %s
                """,
                [*params, int(limit), int(offset)],
            ).df()
            items: list[dict[str, Any]] = []
            if df is not None and not df.empty:
                for _, r in df.iterrows():
                    items.append(_serialize_task(r.to_dict()))
            return {"items": items, "count": total_count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load tasks: {e}")


@router.get("/clients/{client_id}/email-recipients")
def get_email_recipients(client_id: int, _user: dict = Depends(_current_user)):
    """Returns client contacts + active team members for To/CC/BCC autocomplete in the email composer."""
    try:
        with get_conn() as con:
            contacts_df = con.execute(
                """
                SELECT full_name, email, TRUE AS is_contact
                FROM client_contacts
                WHERE client_db_id = %s
                  AND email IS NOT NULL AND trim(email) <> ''
                ORDER BY COALESCE(is_primary, FALSE) DESC, lower(full_name)
                """,
                [int(client_id)],
            ).df()

            users_df = con.execute(
                """
                SELECT full_name, email, FALSE AS is_contact
                FROM users
                WHERE COALESCE(status, 'Active') = 'Active'
                  AND email IS NOT NULL AND trim(email) <> ''
                ORDER BY lower(full_name)
                """
            ).df()

        contacts = []
        if contacts_df is not None and not contacts_df.empty:
            for _, r in contacts_df.iterrows():
                name = str(r.get("full_name") or "").strip()
                email = str(r.get("email") or "").strip()
                if email:
                    contacts.append({"name": name, "email": email, "group": "Client Contacts"})

        team = []
        if users_df is not None and not users_df.empty:
            for _, r in users_df.iterrows():
                name = str(r.get("full_name") or "").strip()
                email = str(r.get("email") or "").strip()
                if email:
                    team.append({"name": name, "email": email, "group": "Team"})

        return {"contacts": contacts, "team": team}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load email recipients: {e}")


@router.post("/timeline/events/{event_id}/tags")
def replace_event_tags(event_id: int, body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        tags = body.get("tags") or []
        if not isinstance(tags, list):
            raise HTTPException(status_code=400, detail="tags must be an array")
        with get_conn() as con:
            _ensure_tables(con)
            exists = con.execute("SELECT event_id FROM crm_events WHERE event_id = %s", [int(event_id)]).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="Event not found")
            _replace_event_tags(con, int(event_id), tags)
            return {"ok": True, "event_id": int(event_id), "tags": _tags_for_event(con, int(event_id))}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update tags: {e}")
