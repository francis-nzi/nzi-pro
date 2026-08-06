from __future__ import annotations

import json
from typing import Any

import pandas as pd

from services.emailer import send_email_with_attachment, send_plain_email


def ensure_outbound_email_tables(con) -> None:
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS outbound_email_log (
          email_id BIGSERIAL PRIMARY KEY,
          channel VARCHAR NOT NULL DEFAULT 'email',
          template_key VARCHAR,
          entity_type VARCHAR,
          entity_id INTEGER,
          job_id INTEGER,
          client_db_id INTEGER,
          to_email VARCHAR NOT NULL,
          subject TEXT NOT NULL,
          body_text TEXT,
          body_html TEXT,
          attachment_count INTEGER NOT NULL DEFAULT 0,
          attachment_names TEXT,
          metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          status VARCHAR NOT NULL DEFAULT 'pending',
          error_text TEXT,
          created_by VARCHAR,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          sent_at TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
        """
    )
    con.execute("CREATE INDEX IF NOT EXISTS ix_outbound_email_created ON outbound_email_log (created_at DESC)")
    con.execute("CREATE INDEX IF NOT EXISTS ix_outbound_email_job ON outbound_email_log (job_id, created_at DESC)")
    con.execute("CREATE INDEX IF NOT EXISTS ix_outbound_email_client ON outbound_email_log (client_db_id, created_at DESC)")
    con.execute("CREATE INDEX IF NOT EXISTS ix_outbound_email_status ON outbound_email_log (status, created_at DESC)")
    con.execute("ALTER TABLE outbound_email_log ADD COLUMN IF NOT EXISTS from_name VARCHAR")
    con.execute("ALTER TABLE outbound_email_log ADD COLUMN IF NOT EXISTS cc_addresses TEXT")
    con.execute("ALTER TABLE outbound_email_log ADD COLUMN IF NOT EXISTS bcc_addresses TEXT")


def _lookup_sender_name(con, identifier: str) -> str | None:
    ident = str(identifier or "").strip()
    if not ident:
        return None
    try:
        row = con.execute(
            "SELECT full_name FROM users WHERE lower(email) = lower(%s) OR lower(user_id) = lower(%s) LIMIT 1",
            [ident, ident],
        ).fetchone()
        return str(row[0] or "").strip() or None if row else None
    except Exception:
        return None


def _safe_json(value: Any) -> str:
    if not isinstance(value, dict):
        return "{}"
    try:
        return json.dumps(value)
    except Exception:
        return "{}"


def _safe_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return int(value)


def _is_probable_email(value: str | None) -> bool:
    s = str(value or "").strip()
    return bool(s and "@" in s and "." in s.split("@")[-1])


def send_tracked_email(
    con,
    *,
    to_email: str,
    subject: str,
    body_text: str,
    body_html: str | None = None,
    created_by: str | None = None,
    from_name: str | None = None,
    cc: list[str] | None = None,
    bcc: list[str] | None = None,
    template_key: str | None = None,
    entity_type: str | None = None,
    entity_id: int | None = None,
    job_id: int | None = None,
    client_db_id: int | None = None,
    reply_to: str | None = None,
    metadata: dict[str, Any] | None = None,
    attachment: dict[str, Any] | None = None,
    attachments: list[dict[str, Any]] | None = None,
    raise_on_error: bool = True,
) -> dict[str, Any]:
    ensure_outbound_email_tables(con)

    # Merge single attachment (backwards compat) and list into one list
    all_attachments: list[dict[str, Any]] = list(attachments or [])
    if attachment:
        all_attachments.append(attachment)

    # Resolve sender display name from users table if not explicitly provided
    resolved_from_name = str(from_name or "").strip() or _lookup_sender_name(con, created_by or "") or None

    attachment_count = len(all_attachments)
    attachment_names = ", ".join(
        str((a or {}).get("filename") or "").strip()
        for a in all_attachments
        if str((a or {}).get("filename") or "").strip()
    ) or None
    cc_str = ", ".join([e.strip() for e in (cc or []) if str(e or "").strip()]) or None
    bcc_str = ", ".join([e.strip() for e in (bcc or []) if str(e or "").strip()]) or None

    row = con.execute(
        """
        INSERT INTO outbound_email_log (
          channel, template_key, entity_type, entity_id, job_id, client_db_id,
          to_email, subject, body_text, body_html, attachment_count, attachment_names,
          metadata_json, status, created_by, from_name, cc_addresses, bcc_addresses,
          created_at, updated_at
        )
        VALUES (
          'email', %s, %s, %s, %s, %s,
          %s, %s, %s, %s, %s, %s,
          %s::jsonb, 'pending', %s, %s, %s, %s,
          NOW(), NOW()
        )
        RETURNING email_id
        """,
        [
            template_key,
            entity_type,
            int(entity_id) if entity_id is not None else None,
            int(job_id) if job_id is not None else None,
            int(client_db_id) if client_db_id is not None else None,
            str(to_email or "").strip(),
            str(subject or "").strip(),
            str(body_text or ""),
            str(body_html or "") if body_html else None,
            int(attachment_count),
            attachment_names,
            _safe_json(metadata or {}),
            str(created_by or "").strip() or None,
            resolved_from_name,
            cc_str,
            bcc_str,
        ],
    ).fetchone()
    email_id = int(row[0])
    derived_reply_to = str(reply_to or "").strip() or None
    if not derived_reply_to and _is_probable_email(created_by):
        derived_reply_to = str(created_by or "").strip()

    try:
        if all_attachments:
            send_email_with_attachment(
                to_email=str(to_email or "").strip(),
                subject=str(subject or "").strip(),
                body_text=str(body_text or ""),
                body_html=body_html,
                reply_to=derived_reply_to,
                from_name=resolved_from_name,
                cc=cc,
                bcc=bcc,
                attachments=all_attachments,
            )
        else:
            send_plain_email(
                to_email=str(to_email or "").strip(),
                subject=str(subject or "").strip(),
                body_text=str(body_text or ""),
                body_html=body_html,
                reply_to=derived_reply_to,
                from_name=resolved_from_name,
                cc=cc,
                bcc=bcc,
            )
        con.execute(
            """
            UPDATE outbound_email_log
            SET status = 'sent', sent_at = NOW(), error_text = NULL, updated_at = NOW()
            WHERE email_id = %s
            """,
            [email_id],
        )
        return {"email_id": email_id, "status": "sent"}
    except Exception as e:
        error_text = str(e)[:4000]
        con.execute(
            """
            UPDATE outbound_email_log
            SET status = 'failed', error_text = %s, updated_at = NOW()
            WHERE email_id = %s
            """,
            [error_text, email_id],
        )
        result = {"email_id": email_id, "status": "failed", "error": error_text}
        if raise_on_error:
            raise RuntimeError(error_text)
        return result


def list_outbound_emails(
    con,
    *,
    job_id: int | None = None,
    client_db_id: int | None = None,
    entity_type: str | None = None,
    entity_id: int | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    ensure_outbound_email_tables(con)
    where: list[str] = []
    params: list[Any] = []
    if job_id is not None:
        where.append("job_id = %s")
        params.append(int(job_id))
    if client_db_id is not None:
        where.append("client_db_id = %s")
        params.append(int(client_db_id))
    if entity_type:
        where.append("lower(coalesce(entity_type,'')) = lower(%s)")
        params.append(str(entity_type).strip())
    if entity_id is not None:
        where.append("entity_id = %s")
        params.append(int(entity_id))
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    params.append(max(1, min(int(limit), 500)))

    df = con.execute(
        f"""
        SELECT email_id, channel, template_key, entity_type, entity_id, job_id, client_db_id, to_email, subject,
               status, error_text, created_by, created_at, sent_at, updated_at, attachment_count, attachment_names
        FROM outbound_email_log
        {where_sql}
        ORDER BY created_at DESC, email_id DESC
        LIMIT %s
        """,
        params,
    ).df()
    items: list[dict[str, Any]] = []
    if df is None or df.empty:
        return items
    for _, r in df.iterrows():
        items.append(
            {
                "email_id": int(r.get("email_id") or 0),
                "channel": str(r.get("channel") or "email"),
                "template_key": str(r.get("template_key") or ""),
                "entity_type": str(r.get("entity_type") or ""),
                "entity_id": _safe_int(r.get("entity_id")),
                "job_id": _safe_int(r.get("job_id")),
                "client_db_id": _safe_int(r.get("client_db_id")),
                "to_email": str(r.get("to_email") or ""),
                "subject": str(r.get("subject") or ""),
                "status": str(r.get("status") or ""),
                "error_text": str(r.get("error_text") or ""),
                "created_by": str(r.get("created_by") or ""),
                "created_at": r.get("created_at").isoformat() if r.get("created_at") else None,
                "sent_at": r.get("sent_at").isoformat() if r.get("sent_at") else None,
                "updated_at": r.get("updated_at").isoformat() if r.get("updated_at") else None,
                "attachment_count": int(r.get("attachment_count") or 0),
                "attachment_names": str(r.get("attachment_names") or ""),
            }
        )
    return items
