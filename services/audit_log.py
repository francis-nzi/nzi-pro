from __future__ import annotations

import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from fastapi import Request


REDACTED_KEYS = {
    "password",
    "password_hash",
    "token",
    "access_token",
    "refresh_token",
    "secret",
    "authorization",
}

_audit_log_table_seeded: bool = False


def ensure_audit_log_table(con) -> None:
    global _audit_log_table_seeded
    if _audit_log_table_seeded:
        return
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_log (
          audit_id BIGSERIAL PRIMARY KEY,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          org_id VARCHAR,
          actor_user_id VARCHAR,
          actor_email VARCHAR,
          actor_name VARCHAR,
          action VARCHAR NOT NULL,
          entity_type VARCHAR NOT NULL,
          entity_id VARCHAR,
          client_id INTEGER,
          job_id INTEGER,
          page VARCHAR,
          section VARCHAR,
          container VARCHAR,
          route VARCHAR,
          method VARCHAR,
          before_json TEXT,
          after_json TEXT,
          diff_json TEXT,
          metadata_json TEXT,
          ip_address VARCHAR,
          user_agent TEXT
        )
        """
    )
    try:
        con.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC)")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS org_id VARCHAR")
    except Exception:
        pass
    try:
        con.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_org_created ON audit_log(org_id, created_at DESC)")
    except Exception:
        pass
    try:
        con.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id)")
    except Exception:
        pass
    try:
        con.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_client_job ON audit_log(client_id, job_id)")
    except Exception:
        pass
    try:
        con.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_actor_email ON audit_log(actor_email)")
    except Exception:
        pass
    _audit_log_table_seeded = True


def _json_safe(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            key_text = str(key)
            if key_text.strip().lower() in REDACTED_KEYS:
                out[key_text] = "[REDACTED]"
            else:
                out[key_text] = _json_safe(item)
        return out
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(item) for item in value]
    if hasattr(value, "item"):
        try:
            return _json_safe(value.item())
        except Exception:
            pass
    if hasattr(value, "tolist"):
        try:
            return _json_safe(value.tolist())
        except Exception:
            pass
    return str(value)


def _to_json_text(value: Any) -> str | None:
    if value is None:
        return None
    return json.dumps(_json_safe(value), ensure_ascii=False, sort_keys=True)


def _compute_diff(before: Any, after: Any) -> Any:
    before_safe = _json_safe(before)
    after_safe = _json_safe(after)
    if before_safe == after_safe:
        return None
    if isinstance(before_safe, dict) and isinstance(after_safe, dict):
        diff: dict[str, Any] = {}
        keys = sorted(set(before_safe.keys()) | set(after_safe.keys()))
        for key in keys:
            left = before_safe.get(key)
            right = after_safe.get(key)
            if left != right:
                diff[key] = {"before": left, "after": right}
        return diff
    return {"before": before_safe, "after": after_safe}


def request_ip_address(request: Request | None) -> str | None:
    if request is None:
        return None
    xff = str(request.headers.get("x-forwarded-for") or "").strip()
    if xff:
        return xff.split(",")[0].strip() or None
    try:
        if request.client and request.client.host:
            return str(request.client.host)
    except Exception:
        pass
    return None


def request_ui_context(request: Request | None) -> dict[str, str | None]:
    if request is None:
        return {"page": None, "section": None, "container": None}
    return {
        "page": str(request.headers.get("x-audit-page") or "").strip() or None,
        "section": str(request.headers.get("x-audit-section") or "").strip() or None,
        "container": str(request.headers.get("x-audit-container") or "").strip() or None,
    }


def request_org_id(request: Request | None) -> str | None:
    if request is None:
        return None
    try:
        header_value = str(request.headers.get("x-audit-org-id") or "").strip()
        return header_value or None
    except Exception:
        return None


def fetch_entity_history(
    con,
    *,
    entity_type: str,
    entity_id: Any,
    org_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    """Return paginated audit_log events for one specific entity (e.g. a single
    quote/invoice/credit note), regardless of which job or client it's on."""
    ensure_audit_log_table(con)
    where_parts = ["a.entity_type = %s", "a.entity_id = %s"]
    params: list[Any] = [str(entity_type), str(entity_id)]
    if org_id:
        where_parts.append("COALESCE(a.org_id, '') = %s")
        params.append(str(org_id))
    where_sql = " AND ".join(where_parts)

    rows = con.execute(
        f"""
        SELECT a.audit_id, a.created_at, a.actor_email, a.actor_name,
               a.action, a.entity_type, a.entity_id, a.diff_json, a.section
        FROM audit_log a
        WHERE {where_sql}
        ORDER BY a.created_at DESC
        LIMIT %s OFFSET %s
        """,
        params + [limit, offset],
    ).fetchall()

    total_row = con.execute(f"SELECT COUNT(*) FROM audit_log a WHERE {where_sql}", params).fetchone()
    total = int(total_row[0]) if total_row else 0

    items = []
    for r in rows:
        items.append({
            "audit_id": r[0],
            "created_at": str(r[1]) if r[1] else None,
            "actor_email": r[2],
            "actor_name": r[3],
            "action": r[4],
            "entity_type": r[5],
            "entity_id": r[6],
            "diff": parse_json_text(r[7]),
            "section": r[8],
        })
    return {"items": items, "total": total}


def fetch_row_dict(con, sql: str, params: list[Any] | tuple[Any, ...] | None = None) -> dict[str, Any] | None:
    df = con.execute(sql, list(params or [])).df()
    if df is None or df.empty:
        return None
    row = df.iloc[0].to_dict()
    return _json_safe(row)


def parse_json_text(value: Any) -> Any:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        return text


def record_audit_event(
    con,
    *,
    request: Request | None,
    actor: dict[str, Any] | None,
    action: str,
    entity_type: str,
    entity_id: Any = None,
    client_id: int | None = None,
    job_id: int | None = None,
    before: Any = None,
    after: Any = None,
    metadata: Any = None,
) -> int | None:
    # Run DDL (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS) in a
    # separate autocommit connection.  Calling DDL on the caller's `con` when
    # it is a non-autocommit (transactional) connection aborts the whole
    # transaction in PostgreSQL if any statement fails, even when the Python
    # exception is silently caught.
    try:
        from core.database import get_conn as _get_conn
        with _get_conn() as _ddl_con:
            ensure_audit_log_table(_ddl_con)
    except Exception:
        pass
    context = request_ui_context(request)
    org_id = None
    if actor and actor.get("org_id"):
        org_id = str(actor.get("org_id")).strip() or None
    if not org_id:
        org_id = request_org_id(request)
    diff = _compute_diff(before, after)
    row = con.execute(
        """
        INSERT INTO audit_log (
          org_id,
          actor_user_id,
          actor_email,
          actor_name,
          action,
          entity_type,
          entity_id,
          client_id,
          job_id,
          page,
          section,
          container,
          route,
          method,
          before_json,
          after_json,
          diff_json,
          metadata_json,
          ip_address,
          user_agent
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING audit_id
        """,
        [
            org_id,
            actor.get("user_id") if actor else None,
            actor.get("email") if actor else None,
            actor.get("full_name") if actor else None,
            str(action or "").strip(),
            str(entity_type or "").strip(),
            str(entity_id) if entity_id is not None else None,
            int(client_id) if client_id is not None else None,
            int(job_id) if job_id is not None else None,
            context.get("page"),
            context.get("section"),
            context.get("container"),
            str(request.url.path) if request is not None else None,
            str(request.method).upper() if request is not None else None,
            _to_json_text(before),
            _to_json_text(after),
            _to_json_text(diff),
            _to_json_text(metadata),
            request_ip_address(request),
            str(request.headers.get("user-agent") or "").strip() if request is not None else None,
        ],
    ).fetchone()
    return int(row[0]) if row and row[0] is not None else None
