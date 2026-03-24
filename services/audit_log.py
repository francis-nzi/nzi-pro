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


def ensure_audit_log_table(con) -> None:
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_log (
          audit_id BIGSERIAL PRIMARY KEY,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    ensure_audit_log_table(con)
    context = request_ui_context(request)
    diff = _compute_diff(before, after)
    row = con.execute(
        """
        INSERT INTO audit_log (
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING audit_id
        """,
        [
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
