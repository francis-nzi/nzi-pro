from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
from datetime import date, datetime, timedelta
from typing import Any, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import HTTPException

from core.database import get_conn
from services.audit_log import fetch_row_dict, record_audit_event

import logging

XERO_CONNECTION_KEY = "default"
XERO_API_BASE = "https://api.xero.com/api.xro/2.0"
XERO_AUTH_URL = "https://login.xero.com/identity/connect/authorize"
XERO_TOKEN_URL = "https://identity.xero.com/connect/token"
XERO_CONNECTIONS_URL = "https://api.xero.com/connections"
XERO_DEFAULT_AUTH_TYPE = "custom_connection"

# Deliberately loose (not RFC 5322) -- just enough to catch the common CRM
# data-entry mistake of a truncated address (e.g. "name@company" with no
# TLD), which Xero's own validation rejects outright and fails the whole
# contact/invoice sync rather than just omitting the email.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _looks_like_valid_email(value: str) -> bool:
    return bool(_EMAIL_RE.match(value.strip()))
XERO_DEFAULT_SCOPE = "accounting.contacts accounting.invoices"
XERO_DEFAULT_ACCOUNT_CODE = "200"
XERO_DEFAULT_TAX_TYPE = "NONE"
logger = logging.getLogger(__name__)


def _env(name: str, default: str = "") -> str:
    return str(os.getenv(name, default) or "").strip()


def _scope_value(raw: str | None = None) -> str:
    """Return the scope string exactly as configured (deduped, offline_access
    stripped since it isn't valid for the client_credentials grant), falling
    back to XERO_DEFAULT_SCOPE only when nothing is configured at all. Does
    NOT force-inject any scope -- Xero's granular scopes vary per app/
    connection, so silently adding tokens the caller didn't ask for just
    reintroduces scopes that may not be authorized and breaks the request.
    """
    text = str(raw if raw is not None else _env("XERO_SCOPE", XERO_DEFAULT_SCOPE) or XERO_DEFAULT_SCOPE).strip()
    if not text:
        text = XERO_DEFAULT_SCOPE

    tokens: list[str] = []
    for token in text.split():
        token = token.strip()
        if not token or token.lower() == "offline_access":
            continue
        if token not in tokens:
            tokens.append(token)

    if not tokens:
        tokens = XERO_DEFAULT_SCOPE.split()
    return " ".join(tokens)


def _now() -> datetime:
    return datetime.utcnow()


def _today() -> date:
    return date.today()


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value if value is not None else default)
    except Exception:
        logger.debug("Failed to coerce Xero numeric value; using default", exc_info=True)
        return default


def _safe_date(value: Any, fallback: date | None = None) -> str | None:
    if value is None:
        return fallback.isoformat() if fallback else None
    if isinstance(value, date):
        return value.isoformat()
    text = str(value or "").strip()
    if not text:
        return fallback.isoformat() if fallback else None
    try:
        return date.fromisoformat(text[:10]).isoformat()
    except Exception:
        logger.debug("Failed to parse Xero date value; using fallback", exc_info=True)
        return text[:10] or (fallback.isoformat() if fallback else None)


_MS_JSON_DATE_RE = re.compile(r"/Date\((\d+)")


def _parse_xero_date_value(value: Any) -> date | None:
    """Parse a date coming *from* Xero, which the Accounting API renders as
    either a plain ISO string ("2024-01-15" / "2024-01-15T00:00:00") or the
    legacy MS-AJAX form ("/Date(1705276800000+0000)/") depending on the
    field and API version -- handle both rather than assume one."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text:
        return None
    ms_match = _MS_JSON_DATE_RE.match(text)
    if ms_match:
        try:
            return datetime.utcfromtimestamp(int(ms_match.group(1)) / 1000).date()
        except Exception:
            return None
    try:
        return date.fromisoformat(text[:10])
    except Exception:
        return None


def _xero_webhook_key() -> str:
    return _env("XERO_WEBHOOK_KEY")


def verify_xero_webhook_signature(raw_body: bytes, signature: str | None) -> bool:
    """Validate the `x-xero-signature` header Xero sends with every webhook
    delivery: base64(HMAC-SHA256(raw request body, webhook signing key)).
    Without this, the webhook endpoint would process a POST from anyone who
    finds the URL, not just Xero."""
    key = _xero_webhook_key()
    if not key or not signature:
        return False
    computed = base64.b64encode(hmac.new(key.encode("utf-8"), raw_body, hashlib.sha256).digest()).decode("utf-8")
    return hmac.compare_digest(computed, signature.strip())


# Xero's own Status enum for an ACCREC invoice: DRAFT, SUBMITTED, AUTHORISED,
# PAID, VOIDED, DELETED. It has no "Sent"/"Part Paid"/"Overdue" concept --
# those are this CRM's own vocabulary -- so an AUTHORISED invoice has to be
# further disambiguated using AmountPaid/AmountDue/DueDate.
def _map_xero_invoice_payment_fields(xero_invoice: Mapping[str, Any]) -> dict[str, Any]:
    raw_status = str(xero_invoice.get("Status") or "").strip().upper()
    amount_paid = _safe_float(xero_invoice.get("AmountPaid"), 0.0)
    amount_due = _safe_float(xero_invoice.get("AmountDue"), 0.0)

    if raw_status in ("VOIDED", "DELETED"):
        crm_status = "Void"
    elif raw_status == "PAID":
        crm_status = "Paid"
    elif raw_status in ("DRAFT", "SUBMITTED"):
        crm_status = "Draft"
    elif raw_status == "AUTHORISED":
        if amount_paid > 0 and amount_due > 0:
            crm_status = "Part Paid"
        else:
            due = _parse_xero_date_value(xero_invoice.get("DueDate"))
            crm_status = "Overdue" if (due is not None and due < _today() and amount_due > 0) else "Sent"
    else:
        crm_status = None

    paid_date = None
    if crm_status == "Paid":
        fully_paid_on = _parse_xero_date_value(xero_invoice.get("FullyPaidOnDate"))
        paid_date = (fully_paid_on or _today()).isoformat()

    return {
        "status": crm_status,
        "amount_paid": round(amount_paid, 2),
        "paid_date": paid_date,
        "raw_xero_status": raw_status,
    }


# Same idea as _map_xero_invoice_payment_fields but for ACCRECCREDIT credit
# notes, which reuse the same Xero Status enum -- "PAID" here means fully
# applied/refunded (RemainingCredit == 0), not literally paid. This CRM's
# own credit-note vocabulary has no "Part Applied"/"Overdue" equivalent
# (see credit-notes/new/page.tsx STATUS_OPTIONS), so an AUTHORISED credit
# note -- applied or not -- just maps to "Sent".
def _map_xero_credit_note_payment_fields(xero_credit_note: Mapping[str, Any]) -> dict[str, Any]:
    raw_status = str(xero_credit_note.get("Status") or "").strip().upper()
    total = _safe_float(xero_credit_note.get("Total"), 0.0)
    remaining_credit = _safe_float(xero_credit_note.get("RemainingCredit"), 0.0)
    applied_amount = round(max(total - remaining_credit, 0.0), 2)

    if raw_status in ("VOIDED", "DELETED"):
        crm_status = "Void"
    elif raw_status == "PAID":
        crm_status = "Applied"
    elif raw_status in ("DRAFT", "SUBMITTED"):
        crm_status = "Draft"
    elif raw_status == "AUTHORISED":
        crm_status = "Sent"
    else:
        crm_status = None

    applied_date = None
    if crm_status == "Applied":
        fully_applied_on = _parse_xero_date_value(xero_credit_note.get("FullyPaidOnDate"))
        applied_date = (fully_applied_on or _today()).isoformat()

    return {
        "status": crm_status,
        "applied_amount": applied_amount,
        "applied_date": applied_date,
        "raw_xero_status": raw_status,
    }


def _json_request(
    method: str,
    url: str,
    *,
    headers: Mapping[str, str] | None = None,
    payload: Any = None,
    timeout: int = 30,
) -> dict[str, Any]:
    req_headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if headers:
        req_headers.update({str(k): str(v) for k, v in headers.items() if str(v or "").strip()})
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = Request(url, data=body, headers=req_headers, method=method.upper())
    try:
        with urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
        return json.loads(raw) if raw.strip() else {}
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace") if hasattr(exc, "read") else ""
        detail = raw.strip() or exc.reason or f"HTTP {exc.code}"
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                detail = parsed
        except Exception:
            logger.debug("Failed to parse Xero error payload as JSON; using raw error detail", exc_info=True)
        raise HTTPException(status_code=502, detail=f"Xero request failed: {detail}") from exc
    except URLError as exc:
        raise HTTPException(status_code=502, detail=f"Xero request failed: {exc.reason}") from exc


def _form_request(
    method: str,
    url: str,
    *,
    headers: Mapping[str, str] | None = None,
    payload: Mapping[str, Any] | None = None,
    timeout: int = 30,
) -> dict[str, Any]:
    req_headers = {"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"}
    if headers:
        req_headers.update({str(k): str(v) for k, v in headers.items() if str(v or "").strip()})
    body = urlencode({str(k): str(v) for k, v in (payload or {}).items() if v is not None}).encode("utf-8")
    req = Request(url, data=body, headers=req_headers, method=method.upper())
    try:
        with urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
        return json.loads(raw) if raw.strip() else {}
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace") if hasattr(exc, "read") else ""
        detail = raw.strip() or exc.reason or f"HTTP {exc.code}"
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                detail = parsed
        except Exception:
            pass
        raise HTTPException(status_code=502, detail=f"Xero token request failed: {detail}") from exc
    except URLError as exc:
        raise HTTPException(status_code=502, detail=f"Xero token request failed: {exc.reason}") from exc


def _ensure_schema(con) -> None:
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS xero_connections (
          connection_key VARCHAR PRIMARY KEY,
          integration_type VARCHAR NOT NULL DEFAULT 'custom_connection',
          tenant_id VARCHAR,
          org_name VARCHAR,
          access_token TEXT,
          refresh_token TEXT,
          expires_at TIMESTAMP,
          scope TEXT,
          status VARCHAR NOT NULL DEFAULT 'disconnected',
          last_tested_at TIMESTAMP,
          last_error TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW(),
          created_by VARCHAR,
          updated_by VARCHAR
        )
        """
    )
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS xero_contact_links (
          client_db_id INTEGER PRIMARY KEY,
          xero_contact_id VARCHAR,
          xero_contact_name VARCHAR,
          xero_contact_email VARCHAR,
          sync_status VARCHAR NOT NULL DEFAULT 'pending',
          sync_error TEXT,
          last_synced_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
        """
    )
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS xero_invoice_links (
          invoice_id INTEGER PRIMARY KEY,
          xero_invoice_id VARCHAR,
          xero_invoice_number VARCHAR,
          xero_status VARCHAR,
          xero_sync_status VARCHAR NOT NULL DEFAULT 'pending',
          xero_sync_error TEXT,
          last_synced_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
        """
    )
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS xero_credit_note_links (
          credit_note_id INTEGER PRIMARY KEY,
          xero_credit_note_id VARCHAR,
          xero_credit_note_number VARCHAR,
          xero_status VARCHAR,
          xero_sync_status VARCHAR NOT NULL DEFAULT 'pending',
          xero_sync_error TEXT,
          last_synced_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
        """
    )
    con.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS xero_contact_id VARCHAR")
    con.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS xero_contact_name VARCHAR")
    con.execute("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xero_invoice_id VARCHAR")
    con.execute("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xero_invoice_number VARCHAR")
    con.execute("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xero_status VARCHAR")
    con.execute("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xero_sync_status VARCHAR DEFAULT 'pending'")
    con.execute("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xero_synced_at TIMESTAMP")
    con.execute("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xero_sync_error TEXT")
    try:
        con.execute("CREATE INDEX IF NOT EXISTS xero_invoice_links_xero_invoice_idx ON xero_invoice_links (xero_invoice_id)")
    except Exception:
        logger.debug("Failed to ensure xero_invoice_links index; continuing", exc_info=True)
    try:
        con.execute("CREATE INDEX IF NOT EXISTS xero_credit_note_links_xero_credit_note_idx ON xero_credit_note_links (xero_credit_note_id)")
    except Exception:
        logger.debug("Failed to ensure xero_credit_note_links index; continuing", exc_info=True)
    try:
        con.execute("CREATE INDEX IF NOT EXISTS xero_contact_links_contact_idx ON xero_contact_links (xero_contact_id)")
    except Exception:
        logger.debug("Failed to ensure xero_contact_links index; continuing", exc_info=True)
    try:
        con.execute("CREATE INDEX IF NOT EXISTS invoices_xero_invoice_idx ON invoices (xero_invoice_id)")
    except Exception:
        logger.debug("Failed to ensure invoices_xero_invoice index; continuing", exc_info=True)


def _fetch_one(con, sql: str, params: list[Any] | tuple[Any, ...] | None = None) -> dict[str, Any] | None:
    df = con.execute(sql, list(params or [])).df()
    if df is None or df.empty:
        return None
    return fetch_row_dict(con, sql, list(params or []))


def _fetch_all(con, sql: str, params: list[Any] | tuple[Any, ...] | None = None) -> list[dict[str, Any]]:
    df = con.execute(sql, list(params or [])).df()
    if df is None or df.empty:
        return []
    return [dict(row) for _, row in df.iterrows()]


def _connection_defaults() -> dict[str, Any]:
    return {
        "connection_key": XERO_CONNECTION_KEY,
        "integration_type": _env("XERO_AUTH_TYPE", XERO_DEFAULT_AUTH_TYPE) or XERO_DEFAULT_AUTH_TYPE,
        "tenant_id": _env("XERO_TENANT_ID"),
        "org_name": _env("XERO_ORGANISATION_NAME"),
        "access_token": None,
        "refresh_token": None,
        "expires_at": None,
        "scope": _scope_value(),
        "status": "disconnected",
        "last_tested_at": None,
        "last_error": None,
        "created_at": None,
        "updated_at": None,
        "created_by": None,
        "updated_by": None,
    }


def get_xero_connection(con=None) -> dict[str, Any] | None:
    if con is None:
        with get_conn() as db:
            row = _fetch_one(db, "SELECT * FROM xero_connections WHERE connection_key = %s", [XERO_CONNECTION_KEY])
    else:
        row = _fetch_one(con, "SELECT * FROM xero_connections WHERE connection_key = %s", [XERO_CONNECTION_KEY])
    if row:
        return row
    env = _connection_defaults()
    if _env("XERO_CLIENT_ID") and _env("XERO_CLIENT_SECRET"):
        env["status"] = "configured"
        return env
    return None


def save_xero_connection(connection: Mapping[str, Any] | None = None, *, actor_email: str | None = None, test_result: Mapping[str, Any] | None = None) -> dict[str, Any]:
    connection = dict(connection or {})
    with get_conn() as con:
        _ensure_schema(con)
        current = get_xero_connection(con) or _connection_defaults()
        merged = dict(current)
        # Merge every key the caller explicitly passed, including None --
        # callers rely on None to intentionally clear a field (e.g.
        # clear_xero_connection nulling out the stored token). Only keys
        # NOT present in `connection` at all should fall back to `current`.
        merged.update(dict(connection))
        if test_result:
            merged.update(dict(test_result))
        merged["connection_key"] = XERO_CONNECTION_KEY
        merged["updated_by"] = actor_email or merged.get("updated_by")
        merged["created_by"] = merged.get("created_by") or actor_email
        con.execute(
            """
            INSERT INTO xero_connections (
              connection_key, integration_type, tenant_id, org_name,
              access_token, refresh_token, expires_at, scope, status,
              last_tested_at, last_error, created_at, updated_at, created_by, updated_by
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, COALESCE(%s, NOW()), NOW(), %s, %s)
            ON CONFLICT (connection_key) DO UPDATE SET
              integration_type = EXCLUDED.integration_type,
              tenant_id = EXCLUDED.tenant_id,
              org_name = EXCLUDED.org_name,
              access_token = EXCLUDED.access_token,
              refresh_token = EXCLUDED.refresh_token,
              expires_at = EXCLUDED.expires_at,
              scope = EXCLUDED.scope,
              status = EXCLUDED.status,
              last_tested_at = COALESCE(EXCLUDED.last_tested_at, xero_connections.last_tested_at),
              last_error = EXCLUDED.last_error,
              updated_at = NOW(),
              updated_by = EXCLUDED.updated_by
            """,
            [
                merged.get("connection_key"),
                merged.get("integration_type"),
                merged.get("tenant_id"),
                merged.get("org_name"),
                merged.get("access_token"),
                merged.get("refresh_token"),
                merged.get("expires_at"),
                merged.get("scope"),
                merged.get("status") or "connected",
                merged.get("last_tested_at"),
                merged.get("last_error"),
                merged.get("created_at"),
                merged.get("created_by"),
                merged.get("updated_by"),
            ],
        )
        return get_xero_connection(con) or merged


def clear_xero_connection(*, actor_email: str | None = None) -> dict[str, Any]:
    return save_xero_connection(
        {
            "status": "disconnected",
            "access_token": None,
            "refresh_token": None,
            "expires_at": None,
            "last_error": None,
        },
        actor_email=actor_email,
    )


def _client_credentials() -> tuple[str, str]:
    client_id = _env("XERO_CLIENT_ID")
    client_secret = _env("XERO_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise HTTPException(status_code=500, detail="Xero client credentials are not configured")
    return client_id, client_secret


def _redirect_uri() -> str:
    uri = _env("XERO_REDIRECT_URI")
    if uri:
        return uri
    raise HTTPException(status_code=500, detail="Xero redirect URI is not configured")


def _oauth_state() -> str:
    return secrets.token_urlsafe(32)


def build_oauth_authorize_url(*, state: str | None = None) -> tuple[str, str]:
    client_id, _client_secret = _client_credentials()
    redirect_uri = _redirect_uri()
    scope = _scope_value()
    auth_state = state or _oauth_state()
    params = urlencode(
        {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "scope": scope,
            "state": auth_state,
        }
    )
    return f"{XERO_AUTH_URL}?{params}", auth_state


def _exchange_authorization_code(code: str) -> dict[str, Any]:
    client_id, client_secret = _client_credentials()
    redirect_uri = _redirect_uri()
    basic = base64.b64encode(f"{client_id}:{client_secret}".encode("utf-8")).decode("ascii")
    return _form_request(
        "POST",
        XERO_TOKEN_URL,
        headers={
            "Authorization": f"Basic {basic}",
        },
        payload={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
        },
    )


def _connections_from_access_token(access_token: str) -> list[dict[str, Any]]:
    response = _json_request(
        "GET",
        XERO_CONNECTIONS_URL,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    if isinstance(response, list):
        return [dict(item) for item in response if isinstance(item, Mapping)]
    if isinstance(response, dict):
        items = response.get("items")
        if isinstance(items, list):
            return [dict(item) for item in items if isinstance(item, Mapping)]
    return []


def _refresh_token(connection: Mapping[str, Any]) -> dict[str, Any]:
    token = str(connection.get("access_token") or "").strip()
    expires_at = str(connection.get("expires_at") or "").strip()
    if token and expires_at:
        try:
            if datetime.fromisoformat(expires_at.replace("Z", "+00:00")) > (_now() + timedelta(seconds=60)):
                return dict(connection)
        except Exception:
            logger.debug("Failed to parse Xero token expiry; refreshing token", exc_info=True)

    client_id, client_secret = _client_credentials()
    auth_type = str(connection.get("integration_type") or _env("XERO_AUTH_TYPE", XERO_DEFAULT_AUTH_TYPE)).strip().lower()
    body: dict[str, str]
    if auth_type == "oauth2" and str(connection.get("refresh_token") or "").strip():
        body = {
            "grant_type": "refresh_token",
            "refresh_token": str(connection.get("refresh_token") or "").strip(),
        }
    else:
        body = {
            "grant_type": "client_credentials",
            "scope": _scope_value(str(connection.get("scope") or "")),
        }

    basic = base64.b64encode(f"{client_id}:{client_secret}".encode("utf-8")).decode("ascii")
    req = Request(
        XERO_TOKEN_URL,
        data=urlencode(body).encode("utf-8"),
        headers={
            "Authorization": f"Basic {basic}",
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=30) as response:
            parsed = json.loads(response.read().decode("utf-8") or "{}")
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace") if hasattr(exc, "read") else ""
        raise HTTPException(status_code=502, detail=f"Xero token request failed: {raw or exc.reason or exc.code}") from exc
    except URLError as exc:
        raise HTTPException(status_code=502, detail=f"Xero token request failed: {exc.reason}") from exc

    access_token = str(parsed.get("access_token") or "").strip()
    if not access_token:
        raise HTTPException(status_code=502, detail="Xero token response did not include an access token")
    updated = dict(connection)
    updated["access_token"] = access_token
    updated["expires_at"] = (_now() + timedelta(seconds=max(int(parsed.get("expires_in") or 1800) - 60, 60))).isoformat(sep=" ")
    if parsed.get("refresh_token"):
        updated["refresh_token"] = str(parsed.get("refresh_token") or "").strip()
    if parsed.get("scope"):
        updated["scope"] = str(parsed.get("scope") or "").strip()
    return updated


def complete_oauth_connection(*, code: str) -> dict[str, Any]:
    if not str(code or "").strip():
        raise HTTPException(status_code=400, detail="Missing OAuth code")
    with get_conn() as con:
        _ensure_schema(con)
        token_result = _exchange_authorization_code(str(code).strip())
        access_token = str(token_result.get("access_token") or "").strip()
        if not access_token:
            raise HTTPException(status_code=502, detail="Xero token response did not include an access token")
        refresh_token = str(token_result.get("refresh_token") or "").strip() or None
        scope = _scope_value(str(token_result.get("scope") or ""))
        expires_at = (_now() + timedelta(seconds=max(int(token_result.get("expires_in") or 1800) - 60, 60))).isoformat(sep=" ")
        connections = _connections_from_access_token(access_token)
        connection_item = connections[0] if connections else {}
        tenant_id = str(connection_item.get("tenantId") or connection_item.get("tenant_id") or "").strip() or None
        org_name = str(connection_item.get("tenantName") or connection_item.get("org_name") or connection_item.get("name") or "").strip() or None
        updated = save_xero_connection(
            {
                "integration_type": "oauth2",
                "tenant_id": tenant_id,
                "org_name": org_name,
                "access_token": access_token,
                "refresh_token": refresh_token,
                "expires_at": expires_at,
                "scope": scope,
                "status": "connected",
                "last_tested_at": _now(),
                "last_error": None,
            }
        )
        if tenant_id:
            updated["tenant_id"] = tenant_id
        if org_name:
            updated["org_name"] = org_name
        return {"ok": True, "connection": updated, "connections": connections, "token": token_result}


def _xero_headers(connection: Mapping[str, Any]) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {str(connection.get('access_token') or '').strip()}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    tenant_id = str(connection.get("tenant_id") or "").strip()
    if tenant_id and str(connection.get("integration_type") or "").strip().lower() != "custom_connection":
        headers["xero-tenant-id"] = tenant_id
    return headers


def _xero_request(method: str, path: str, connection: Mapping[str, Any], payload: Any = None) -> dict[str, Any]:
    token_connection = _refresh_token(connection)
    url = f"{XERO_API_BASE.rstrip('/')}/{path.lstrip('/')}"
    return _json_request(method, url, headers=_xero_headers(token_connection), payload=payload)


def _client_row(con, client_db_id: int) -> dict[str, Any]:
    row = _fetch_one(
        con,
        """
        SELECT db_id, client_name, company_reg, addr_line1, addr_line2, addr_city, addr_region, addr_postcode, addr_country, headquarters, currency
        FROM clients
        WHERE db_id = %s
        """,
        [int(client_db_id)],
    )
    if not row:
        raise HTTPException(status_code=404, detail="Client not found")
    return row


def _invoice_row(con, invoice_id: int) -> dict[str, Any]:
    row = _fetch_one(
        con,
        """
        SELECT invoice_id, client_db_id, job_id, quote_id, invoice_number, invoice_date, due_date,
               currency_code, subtotal, vat, total, status, notes, paid_date, amount_paid,
               xero_invoice_id, xero_invoice_number, xero_status, xero_sync_status,
               xero_synced_at, xero_sync_error, your_ref, org_id
        FROM invoices
        WHERE invoice_id = %s
        """,
        [int(invoice_id)],
    )
    if not row:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return row


def _invoice_lines(con, invoice_id: int) -> list[dict[str, Any]]:
    return _fetch_all(
        con,
        """
        SELECT invoice_line_id, sort_order, item_id, description, unit, qty, unit_price_ex_vat, amount_ex_vat, vat_rate_pct, notes
        FROM invoice_lines
        WHERE invoice_id = %s
        ORDER BY COALESCE(sort_order, invoice_line_id), invoice_line_id
        """,
        [int(invoice_id)],
    )


def _contact_link(con, client_db_id: int) -> dict[str, Any] | None:
    return _fetch_one(con, "SELECT * FROM xero_contact_links WHERE client_db_id = %s", [int(client_db_id)])


def _invoice_link(con, invoice_id: int) -> dict[str, Any] | None:
    return _fetch_one(con, "SELECT * FROM xero_invoice_links WHERE invoice_id = %s", [int(invoice_id)])


def _connection_row(con) -> dict[str, Any] | None:
    return _fetch_one(con, "SELECT * FROM xero_connections WHERE connection_key = %s", [XERO_CONNECTION_KEY])


def _contact_payload(con, client_db_id: int) -> dict[str, Any]:
    client = _client_row(con, int(client_db_id))
    email_row = _fetch_one(
        con,
        """
        SELECT email
        FROM client_contacts
        WHERE client_db_id = %s AND COALESCE(is_primary, FALSE) = TRUE
        ORDER BY contact_id ASC
        LIMIT 1
        """,
        [int(client_db_id)],
    ) or _fetch_one(
        con,
        """
        SELECT email
        FROM client_contacts
        WHERE client_db_id = %s AND COALESCE(email, '') <> ''
        ORDER BY contact_id ASC
        LIMIT 1
        """,
        [int(client_db_id)],
    )
    payload: dict[str, Any] = {"Name": str(client.get("client_name") or f"Client {client_db_id}").strip()}
    if email_row and email_row.get("email"):
        candidate_email = str(email_row.get("email") or "").strip()
        # Xero rejects the whole contact (and every invoice/quote sync that
        # depends on it) if EmailAddress isn't a valid address -- e.g. a
        # truncated CRM contact email missing its domain suffix. Omit it
        # rather than failing the sync; the contact still syncs everything
        # else, and fixing the contact's email in the CRM picks it up next sync.
        if _looks_like_valid_email(candidate_email):
            payload["EmailAddress"] = candidate_email
    if str(client.get("company_reg") or "").strip():
        payload["TaxNumber"] = str(client.get("company_reg") or "").strip()
    address = {
        "AddressType": "STREET",
        "AddressLine1": str(client.get("addr_line1") or "").strip() or None,
        "AddressLine2": str(client.get("addr_line2") or "").strip() or None,
        "City": str(client.get("addr_city") or "").strip() or None,
        "Region": str(client.get("addr_region") or "").strip() or None,
        "PostalCode": str(client.get("addr_postcode") or "").strip() or None,
        "Country": str(client.get("addr_country") or "").strip() or None,
    }
    if any(value for value in address.values() if value not in (None, "")):
        payload["Addresses"] = [address]
    phone = str(client.get("headquarters") or "").strip()
    if phone:
        payload["Phones"] = [{"PhoneType": "DEFAULT", "PhoneNumber": phone}]
    return {k: v for k, v in payload.items() if v not in (None, "", [], {})}


def _save_contact_link(con, *, client_db_id: int, contact: Mapping[str, Any], sync_status: str, sync_error: str | None = None) -> dict[str, Any]:
    xero_contact_id = str(contact.get("ContactID") or "").strip()
    if not xero_contact_id:
        raise HTTPException(status_code=502, detail="Xero did not return a contact ID")
    xero_contact_name = str(contact.get("Name") or "").strip() or None
    xero_contact_email = str(contact.get("EmailAddress") or "").strip() or None
    con.execute(
        """
        INSERT INTO xero_contact_links (
          client_db_id, xero_contact_id, xero_contact_name, xero_contact_email,
          sync_status, sync_error, last_synced_at, created_at, updated_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, NOW(), COALESCE((SELECT created_at FROM xero_contact_links WHERE client_db_id = %s), NOW()), NOW())
        ON CONFLICT (client_db_id) DO UPDATE SET
          xero_contact_id = EXCLUDED.xero_contact_id,
          xero_contact_name = EXCLUDED.xero_contact_name,
          xero_contact_email = EXCLUDED.xero_contact_email,
          sync_status = EXCLUDED.sync_status,
          sync_error = EXCLUDED.sync_error,
          last_synced_at = EXCLUDED.last_synced_at,
          updated_at = NOW()
        """,
        [int(client_db_id), xero_contact_id, xero_contact_name, xero_contact_email, sync_status, sync_error, int(client_db_id)],
    )
    con.execute(
        "UPDATE clients SET xero_contact_id = %s, xero_contact_name = %s WHERE db_id = %s",
        [xero_contact_id, xero_contact_name, int(client_db_id)],
    )
    return {
        "client_db_id": int(client_db_id),
        "xero_contact_id": xero_contact_id,
        "xero_contact_name": xero_contact_name,
        "xero_contact_email": xero_contact_email,
        "sync_status": sync_status,
        "sync_error": sync_error,
    }


def _save_invoice_link(
    con,
    *,
    invoice_id: int,
    xero_invoice: Mapping[str, Any] | None,
    sync_status: str,
    sync_error: str | None = None,
    sync_direction: str = "push",
) -> dict[str, Any]:
    """Persist Xero bookkeeping fields (link, raw status, sync state) for an
    invoice.  `sync_direction` controls whether the CRM's own `status` /
    `amount_paid` / `paid_date` get touched:
      - "push" (default): we just told Xero what status to have (via
        create/update), so those fields are left alone -- Xero's echoed-back
        status doesn't necessarily reflect real payment reconciliation yet.
      - "pull": we're reading Xero as the source of truth (webhook or
        reconciliation sync), so status/amount_paid/paid_date get mapped
        from Xero's actual Status/AmountPaid/AmountDue/FullyPaidOnDate.
    """
    xero_invoice_id = str((xero_invoice or {}).get("InvoiceID") or "").strip() if xero_invoice else ""
    xero_invoice_number = str((xero_invoice or {}).get("InvoiceNumber") or "").strip() if xero_invoice else ""
    xero_status = str((xero_invoice or {}).get("Status") or "").strip() if xero_invoice else ""
    con.execute(
        """
        INSERT INTO xero_invoice_links (
          invoice_id, xero_invoice_id, xero_invoice_number, xero_status,
          xero_sync_status, xero_sync_error, last_synced_at, created_at, updated_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, NOW(), COALESCE((SELECT created_at FROM xero_invoice_links WHERE invoice_id = %s), NOW()), NOW())
        ON CONFLICT (invoice_id) DO UPDATE SET
          xero_invoice_id = EXCLUDED.xero_invoice_id,
          xero_invoice_number = EXCLUDED.xero_invoice_number,
          xero_status = EXCLUDED.xero_status,
          xero_sync_status = EXCLUDED.xero_sync_status,
          xero_sync_error = EXCLUDED.xero_sync_error,
          last_synced_at = EXCLUDED.last_synced_at,
          updated_at = NOW()
        """,
        [int(invoice_id), xero_invoice_id or None, xero_invoice_number or None, xero_status or None, sync_status, sync_error, int(invoice_id)],
    )

    payment_fields = _map_xero_invoice_payment_fields(xero_invoice or {}) if (xero_invoice and sync_direction == "pull") else None
    mapped_status = payment_fields.get("status") if payment_fields else None
    mapped_amount_paid = payment_fields.get("amount_paid") if payment_fields else None
    mapped_paid_date = payment_fields.get("paid_date") if payment_fields else None

    con.execute(
        """
        UPDATE invoices
        SET xero_invoice_id = %s,
            xero_invoice_number = %s,
            xero_status = %s,
            xero_sync_status = %s,
            xero_sync_error = %s,
            xero_synced_at = NOW(),
            invoice_number = COALESCE(%s, invoice_number),
            status = COALESCE(%s, status),
            amount_paid = CASE WHEN %s THEN %s ELSE amount_paid END,
            paid_date = CASE WHEN %s THEN %s ELSE paid_date END
        WHERE invoice_id = %s
        """,
        [
            xero_invoice_id or None,
            xero_invoice_number or None,
            xero_status or None,
            sync_status,
            sync_error,
            xero_invoice_number or None,
            mapped_status,
            payment_fields is not None,
            mapped_amount_paid,
            payment_fields is not None,
            mapped_paid_date,
            int(invoice_id),
        ],
    )
    return {
        "invoice_id": int(invoice_id),
        "xero_invoice_id": xero_invoice_id or None,
        "xero_invoice_number": xero_invoice_number or None,
        "xero_status": xero_status or None,
        "xero_sync_status": sync_status,
        "xero_sync_error": sync_error,
        "status": mapped_status,
        "amount_paid": mapped_amount_paid,
        "paid_date": mapped_paid_date,
    }


_xero_tax_rates_cache: list[dict[str, Any]] | None = None


def _fetch_xero_tax_rates(connection: Mapping[str, Any]) -> list[dict[str, Any]]:
    global _xero_tax_rates_cache
    if _xero_tax_rates_cache is not None:
        return _xero_tax_rates_cache
    response = _json_request("GET", f"{XERO_API_BASE.rstrip('/')}/TaxRates", headers=_xero_headers(connection))
    _xero_tax_rates_cache = list(response.get("TaxRates") or [])
    return _xero_tax_rates_cache


def _resolve_xero_tax_type(vat_rate_pct: Any, connection: Mapping[str, Any] | None) -> str:
    """Map a VAT percentage (e.g. 20.0) to this Xero organisation's own
    configured sales TaxType code, instead of assuming a fixed code --
    different orgs can rename/customise their tax rates. Every invoice/
    credit note line was previously sent with a single hardcoded TaxType
    regardless of what VAT the CRM had actually calculated, so a 20%-VAT
    line would silently show as "No VAT" once it reached Xero."""
    default = _env("XERO_DEFAULT_TAX_TYPE", XERO_DEFAULT_TAX_TYPE) or XERO_DEFAULT_TAX_TYPE
    try:
        target = round(float(vat_rate_pct), 2)
    except Exception:
        return default
    if target <= 0 or connection is None:
        return default
    try:
        rates = _fetch_xero_tax_rates(connection)
    except Exception:
        logger.warning("Failed to fetch Xero tax rates; falling back to default TaxType", exc_info=True)
        return default
    for rate in rates:
        if str(rate.get("Status") or "").upper() != "ACTIVE":
            continue
        if not rate.get("CanApplyToRevenue"):
            continue
        try:
            display_rate = round(float(rate.get("DisplayTaxRate") or rate.get("EffectiveRate") or 0), 2)
        except Exception:
            continue
        if abs(display_rate - target) < 0.01:
            return str(rate.get("TaxType") or default)
    return default


def _line_items(con, invoice_id: int, connection: Mapping[str, Any] | None = None) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    account_code = _env("XERO_DEFAULT_ACCOUNT_CODE", XERO_DEFAULT_ACCOUNT_CODE) or XERO_DEFAULT_ACCOUNT_CODE
    tax_type_cache: dict[float, str] = {}
    for line in _invoice_lines(con, int(invoice_id)):
        qty = _safe_float(line.get("qty"), 1.0) or 1.0
        amount = _safe_float(line.get("amount_ex_vat"), 0.0)
        unit_amount = _safe_float(line.get("unit_price_ex_vat"), 0.0)
        if not unit_amount and qty:
            unit_amount = amount / qty if qty else amount
        # Xero rejects a negative Quantity outright ("Quantity must not be
        # less than zero"), even though negative amounts/discounts are
        # otherwise fine. A discount line entered as e.g. qty=-1, rate=160
        # must be sent as Quantity=1, UnitAmount=-160 instead -- same
        # LineAmount, but a Xero-legal shape.
        if qty < 0:
            qty = -qty
            unit_amount = -unit_amount
        description = " - ".join(
            part
            for part in [
                str(line.get("description") or "").strip(),
                str(line.get("notes") or "").strip(),
            ]
            if part
        ) or f"Invoice line {int(line.get('invoice_line_id') or 0)}"
        vat_rate_pct = _safe_float(line.get("vat_rate_pct"), 0.0)
        if vat_rate_pct not in tax_type_cache:
            tax_type_cache[vat_rate_pct] = _resolve_xero_tax_type(vat_rate_pct, connection)
        # Note: no ItemCode is set here. Xero's ItemCode must reference an
        # actual entry in that organisation's own Inventory Items catalog --
        # our "unit" field (hour/day/each) is a free-text unit of measure
        # with no Xero equivalent, and sending it as ItemCode makes Xero
        # reject the whole invoice with "Item code '<unit>' is not valid".
        item = {
            "Description": description,
            "Quantity": round(qty, 4),
            "UnitAmount": round(unit_amount, 2),
            "LineAmount": round(amount or (qty * unit_amount), 2),
            "AccountCode": account_code,
            "TaxType": tax_type_cache[vat_rate_pct],
        }
        items.append(item)
    return items


def _xero_invoice_status(local_status: str | None) -> str:
    """Map our CRM invoice status to a valid Xero ACCREC invoice status.
    Xero's writable statuses are DRAFT, SUBMITTED, AUTHORISED, VOIDED --
    Draft invoices are excluded from Xero's Accounts Receivable/financial
    reports, so anything past Draft in our workflow (Sent, Part Paid,
    Paid, Overdue) needs to push as AUTHORISED for it to actually count.
    """
    key = str(local_status or "").strip().lower()
    if key == "void":
        return "VOIDED"
    if not key or key == "draft":
        return "DRAFT"
    return "AUTHORISED"


def build_xero_invoice_payload(
    con, invoice_id: int, *, contact_id: str | None = None, include_invoice_number: bool = False, connection: Mapping[str, Any] | None = None
) -> dict[str, Any]:
    invoice = _invoice_row(con, int(invoice_id))
    client = _client_row(con, int(invoice.get("client_db_id") or 0))
    if not contact_id:
        contact_id = str(client.get("xero_contact_id") or "").strip() or None
    if not contact_id:
        link = _contact_link(con, int(invoice.get("client_db_id") or 0))
        contact_id = str((link or {}).get("xero_contact_id") or "").strip() or None
    if not contact_id:
        raise HTTPException(status_code=400, detail="Xero contact is missing")

    job_reference = ""
    job_id = invoice.get("job_id")
    if job_id is not None:
        job_row = _fetch_one(con, "SELECT job_number FROM jobs WHERE job_id = %s", [int(job_id)])
        if job_row and job_row.get("job_number"):
            job_reference = str(job_row.get("job_number") or "").strip()

    invoice_date = _safe_date(invoice.get("invoice_date"), _today()) or _today().isoformat()
    due_date = _safe_date(invoice.get("due_date"), date.fromisoformat(invoice_date) + timedelta(days=7))
    if not due_date:
        due_date = (date.fromisoformat(invoice_date) + timedelta(days=7)).isoformat()

    line_items = _line_items(con, int(invoice_id), connection=connection)
    if job_reference:
        # Reference already carries the job number, but it isn't always
        # prominent in Xero's UI/printed invoice -- add it as its own
        # zero-value line so it's visible directly on the invoice itself.
        line_items.append(
            {
                "Description": f"Job Number: {job_reference}",
                "Quantity": 1,
                "UnitAmount": 0,
                "LineAmount": 0,
                "AccountCode": _env("XERO_DEFAULT_ACCOUNT_CODE", XERO_DEFAULT_ACCOUNT_CODE) or XERO_DEFAULT_ACCOUNT_CODE,
                "TaxType": _env("XERO_DEFAULT_TAX_TYPE", XERO_DEFAULT_TAX_TYPE) or XERO_DEFAULT_TAX_TYPE,
            }
        )

    payload: dict[str, Any] = {
        "Type": "ACCREC",
        "Contact": {"ContactID": contact_id, "Name": str(client.get("client_name") or "").strip()},
        "Date": invoice_date,
        "DueDate": due_date,
        # The client's own PO/reference takes priority in Xero's Reference
        # field -- it's what that field is actually for. The job number is
        # still visible on the invoice regardless via its own zero-value
        # line item above, so nothing is lost when Your Ref is set.
        "Reference": str(invoice.get("your_ref") or "").strip() or job_reference or str(invoice.get("invoice_number") or "").strip() or None,
        "LineAmountTypes": "Exclusive",
        "Status": _xero_invoice_status(invoice.get("status")),
        "CurrencyCode": str(invoice.get("currency_code") or client.get("currency") or "GBP").strip().upper(),
        "LineItems": line_items,
    }
    if include_invoice_number and str(invoice.get("invoice_number") or "").strip():
        payload["InvoiceNumber"] = str(invoice.get("invoice_number") or "").strip()
    if str(invoice.get("xero_invoice_id") or "").strip():
        payload["InvoiceID"] = str(invoice.get("xero_invoice_id") or "").strip()
    return {k: v for k, v in payload.items() if v not in (None, "", [], {})}


def upsert_xero_contact(client_db_id: int, *, con=None, connection: Mapping[str, Any] | None = None) -> dict[str, Any]:
    manage_con = con is None
    if con is None:
        con = get_conn()
    assert con is not None
    try:
        _ensure_schema(con)
        client = _client_row(con, int(client_db_id))
        existing_client_contact = str(client.get("xero_contact_id") or "").strip()
        link = _contact_link(con, int(client_db_id))
        if existing_client_contact:
            if not link or not str(link.get("xero_contact_id") or "").strip():
                _save_contact_link(
                    con,
                    client_db_id=int(client_db_id),
                    contact={"ContactID": existing_client_contact, "Name": str(client.get("client_name") or "").strip(), "EmailAddress": None},
                    sync_status="synced",
                )
            return _contact_link(con, int(client_db_id)) or {"client_db_id": int(client_db_id), "xero_contact_id": existing_client_contact}
        if link and str(link.get("xero_contact_id") or "").strip():
            return link
        if connection is None:
            connection = get_xero_connection(con) or {}
        connection = _refresh_token(connection)
        contact_payload = _contact_payload(con, int(client_db_id))
        response = _json_request("POST", f"{XERO_API_BASE.rstrip('/')}/Contacts", headers=_xero_headers(connection), payload={"Contacts": [contact_payload]})
        contact = (response.get("Contacts") or [{}])[0]
        if not isinstance(contact, Mapping) or not str(contact.get("ContactID") or "").strip():
            raise HTTPException(status_code=502, detail="Xero did not return a contact")
        return _save_contact_link(con, client_db_id=int(client_db_id), contact=contact, sync_status="synced")
    finally:
        if manage_con:
            try:
                con.__exit__(None, None, None)  # type: ignore[attr-defined]
            except Exception:
                logger.debug("Failed to close Xero connection context cleanly", exc_info=True)


def test_xero_connection(*, con=None) -> dict[str, Any]:
    manage_con = con is None
    if con is None:
        con = get_conn()
    assert con is not None
    try:
        _ensure_schema(con)
        connection = _refresh_token(get_xero_connection(con) or _connection_defaults())
        # Verify the token against an endpoint covered by the connection's
        # actually-granted scopes. GET /Organisation requires
        # accounting.settings, which this integration deliberately doesn't
        # request (it only needs accounting.contacts/accounting.invoices),
        # so testing against it would fail with a valid token.
        response = _json_request("GET", f"{XERO_API_BASE.rstrip('/')}/Contacts?page=1", headers=_xero_headers(connection))
        contacts = response.get("Contacts") or []
        org_name = str(connection.get("org_name") or "").strip() or None
        updated = save_xero_connection(
            {
                "integration_type": connection.get("integration_type"),
                "tenant_id": connection.get("tenant_id"),
                "org_name": org_name,
                "access_token": connection.get("access_token"),
                "refresh_token": connection.get("refresh_token"),
                "expires_at": connection.get("expires_at"),
                "scope": connection.get("scope"),
                "status": "connected",
                "last_tested_at": _now(),
                "last_error": None,
            }
        )
        return {"ok": True, "status": "connected", "connection": updated, "Name": org_name, "contact_count": len(contacts)}
    except HTTPException as exc:
        try:
            save_xero_connection({"status": "error", "last_error": str(exc.detail)})
        except Exception:
            logger.debug("Failed to persist Xero connection error state", exc_info=True)
        raise
    finally:
        if manage_con:
            try:
                con.__exit__(None, None, None)  # type: ignore[attr-defined]
            except Exception:
                logger.debug("Failed to close Xero connection context cleanly", exc_info=True)


def _sync_local_invoice(
    con,
    invoice_id: int,
    xero_invoice: Mapping[str, Any],
    sync_status: str = "synced",
    sync_error: str | None = None,
    sync_direction: str = "push",
) -> dict[str, Any]:
    return _save_invoice_link(
        con,
        invoice_id=int(invoice_id),
        xero_invoice=xero_invoice,
        sync_status=sync_status,
        sync_error=sync_error,
        sync_direction=sync_direction,
    )


def _find_unclaimed_xero_invoice_by_reference(
    con, connection: Mapping[str, Any], *, contact_id: str, reference: str, exclude_invoice_id: int
) -> dict[str, Any] | None:
    """Look up an existing ACCREC invoice in Xero for this contact with a
    matching Reference, so a sync whose local xero_invoice_id link was lost
    (e.g. the CRM invoice row was deleted and recreated, or a prior sync's
    DB write silently failed after Xero already created the invoice)
    reattaches to the real invoice instead of creating a duplicate.

    Only returns a match that no *other* CRM invoice already links to --
    a client can legitimately have several real invoices against the same
    job (partial billing), which would share the same Reference. Without
    this guard, syncing the second real invoice would incorrectly grab the
    first one's Xero record instead of creating its own.
    """
    if not contact_id or not reference:
        return None
    escaped_ref = reference.replace('"', '\\"')
    where = f'Contact.ContactID=Guid("{contact_id}")&&Reference=="{escaped_ref}"&&Status!="VOIDED"&&Status!="DELETED"'
    url = f"{XERO_API_BASE.rstrip('/')}/Invoices?{urlencode({'where': where, 'order': 'Date DESC'})}"
    try:
        response = _json_request("GET", url, headers=_xero_headers(connection))
    except HTTPException:
        logger.warning("Xero reference lookup failed for invoice_id=%s reference=%r", exclude_invoice_id, reference, exc_info=True)
        return None
    for candidate in response.get("Invoices") or []:
        xero_invoice_id = str((candidate or {}).get("InvoiceID") or "").strip()
        if not xero_invoice_id:
            continue
        claimed = _fetch_one(
            con,
            "SELECT invoice_id FROM invoices WHERE xero_invoice_id = %s AND invoice_id != %s",
            [xero_invoice_id, int(exclude_invoice_id)],
        )
        if not claimed:
            return dict(candidate)
    return None


def create_xero_invoice(invoice_id: int, *, con=None, connection: Mapping[str, Any] | None = None) -> dict[str, Any]:
    manage_con = con is None
    if con is None:
        con = get_conn()
    assert con is not None
    xero_invoice: Mapping[str, Any] | None = None
    try:
        _ensure_schema(con)
        invoice = _invoice_row(con, int(invoice_id))
        connection = _refresh_token(connection or get_xero_connection(con) or {})
        contact = upsert_xero_contact(int(invoice.get("client_db_id") or 0), con=con, connection=connection)
        payload = build_xero_invoice_payload(con, int(invoice_id), contact_id=contact.get("xero_contact_id"), include_invoice_number=False, connection=connection)

        existing = _find_unclaimed_xero_invoice_by_reference(
            con,
            connection,
            contact_id=str(contact.get("xero_contact_id") or ""),
            reference=str(payload.get("Reference") or ""),
            exclude_invoice_id=int(invoice_id),
        )
        if existing:
            xero_invoice = existing
            result = _sync_local_invoice(con, int(invoice_id), xero_invoice, sync_status="synced")
            return {"ok": True, "invoice": result, "contact": contact, "xero_invoice": xero_invoice, "relinked_existing": True}

        response = _json_request("PUT", f"{XERO_API_BASE.rstrip('/')}/Invoices", headers=_xero_headers(connection), payload={"Invoices": [payload]})
        xero_invoice = (response.get("Invoices") or [{}])[0]
        if not isinstance(xero_invoice, Mapping) or not str(xero_invoice.get("InvoiceID") or "").strip():
            raise HTTPException(status_code=502, detail="Xero did not return an invoice")
        result = _sync_local_invoice(con, int(invoice_id), xero_invoice, sync_status="synced")
        return {"ok": True, "invoice": result, "contact": contact, "xero_invoice": xero_invoice}
    except Exception as exc:
        # If Xero already created/returned an invoice before something else
        # failed (e.g. a transient DB error on the write-back below), we must
        # still persist that InvoiceID -- otherwise it becomes invisible to
        # us and the next sync attempt creates a second, orphaned invoice in
        # Xero instead of updating this one. Only catching HTTPException here
        # (as before) missed exactly that case.
        error_detail = str(exc.detail) if isinstance(exc, HTTPException) else str(exc)
        try:
            if isinstance(xero_invoice, Mapping) and str(xero_invoice.get("InvoiceID") or "").strip():
                _save_invoice_link(con, invoice_id=int(invoice_id), xero_invoice=xero_invoice, sync_status="synced", sync_error=error_detail)
            else:
                _save_invoice_link(con, invoice_id=int(invoice_id), xero_invoice={}, sync_status="failed", sync_error=error_detail)
        except Exception:
            logger.debug("Failed to persist Xero invoice sync failure state", exc_info=True)
        raise
    finally:
        if manage_con:
            try:
                con.__exit__(None, None, None)  # type: ignore[attr-defined]
            except Exception:
                logger.debug("Failed to close Xero connection context cleanly", exc_info=True)


def update_xero_invoice(invoice_id: int, *, con=None, connection: Mapping[str, Any] | None = None) -> dict[str, Any]:
    manage_con = con is None
    if con is None:
        con = get_conn()
    assert con is not None
    xero_invoice: Mapping[str, Any] | None = None
    try:
        _ensure_schema(con)
        invoice = _invoice_row(con, int(invoice_id))
        if not str(invoice.get("xero_invoice_id") or "").strip():
            return create_xero_invoice(int(invoice_id), con=con, connection=connection)
        connection = _refresh_token(connection or get_xero_connection(con) or {})
        contact = upsert_xero_contact(int(invoice.get("client_db_id") or 0), con=con, connection=connection)
        payload = build_xero_invoice_payload(con, int(invoice_id), contact_id=contact.get("xero_contact_id"), include_invoice_number=True, connection=connection)
        payload["InvoiceID"] = str(invoice.get("xero_invoice_id") or "").strip()
        response = _json_request("PUT", f"{XERO_API_BASE.rstrip('/')}/Invoices", headers=_xero_headers(connection), payload={"Invoices": [payload]})
        xero_invoice = (response.get("Invoices") or [{}])[0]
        if not isinstance(xero_invoice, Mapping) or not str(xero_invoice.get("InvoiceID") or "").strip():
            raise HTTPException(status_code=502, detail="Xero did not return an updated invoice")
        result = _sync_local_invoice(con, int(invoice_id), xero_invoice, sync_status="synced")
        return {"ok": True, "invoice": result, "contact": contact, "xero_invoice": xero_invoice}
    except Exception as exc:
        # See create_xero_invoice() -- persist the InvoiceID Xero already gave
        # us even if something after that fails, so a retry updates this same
        # invoice instead of creating an orphaned duplicate.
        error_detail = str(exc.detail) if isinstance(exc, HTTPException) else str(exc)
        try:
            if isinstance(xero_invoice, Mapping) and str(xero_invoice.get("InvoiceID") or "").strip():
                _save_invoice_link(con, invoice_id=int(invoice_id), xero_invoice=xero_invoice, sync_status="synced", sync_error=error_detail)
            else:
                _save_invoice_link(con, invoice_id=int(invoice_id), xero_invoice={}, sync_status="failed", sync_error=error_detail)
        except Exception:
            logger.debug("Failed to persist Xero invoice sync failure state", exc_info=True)
        raise
    finally:
        if manage_con:
            try:
                con.__exit__(None, None, None)  # type: ignore[attr-defined]
            except Exception:
                logger.debug("Failed to close Xero connection context cleanly after invoice sync", exc_info=True)


def void_xero_invoice(invoice_id: int, *, con=None, connection: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Void (not delete) the Xero invoice linked to this CRM invoice, if any.
    Xero doesn't allow deleting AUTHORISED invoices via the API, only voiding
    them, which keeps a record in Xero but removes it from Accounts
    Receivable. Called from delete_invoice so a synced invoice's Xero
    counterpart doesn't become an orphan the moment the CRM record is
    deleted -- best-effort: any failure here (not connected, already paid,
    etc.) is returned rather than raised, so it never blocks the CRM delete
    itself."""
    manage_con = con is None
    if con is None:
        con = get_conn()
    assert con is not None
    try:
        _ensure_schema(con)
        invoice = _invoice_row(con, int(invoice_id))
        xero_invoice_id = str(invoice.get("xero_invoice_id") or "").strip()
        if not xero_invoice_id:
            return {"ok": True, "skipped": "not_linked"}
        conn_row = connection or get_xero_connection(con)
        if not conn_row:
            return {"ok": True, "skipped": "not_connected"}
        connection = _refresh_token(conn_row)
        response = _json_request(
            "PUT",
            f"{XERO_API_BASE.rstrip('/')}/Invoices",
            headers=_xero_headers(connection),
            payload={"Invoices": [{"InvoiceID": xero_invoice_id, "Status": "VOIDED"}]},
        )
        xero_invoice = (response.get("Invoices") or [{}])[0]
        return {"ok": True, "xero_invoice": xero_invoice}
    except Exception as exc:
        error_detail = str(exc.detail) if isinstance(exc, HTTPException) else str(exc)
        logger.warning("Failed to void Xero invoice for invoice_id=%s: %s", invoice_id, error_detail)
        return {"ok": False, "error": error_detail}
    finally:
        if manage_con:
            try:
                con.__exit__(None, None, None)  # type: ignore[attr-defined]
            except Exception:
                logger.debug("Failed to close Xero connection context cleanly after voiding invoice", exc_info=True)


def sync_invoice_status_from_xero(
    invoice_id: int, *, con=None, connection: Mapping[str, Any] | None = None, source: str = "manual"
) -> dict[str, Any]:
    """Pull the current state of an invoice from Xero and treat it as the
    source of truth for status/amount_paid/paid_date -- this is how a
    payment recorded directly in Xero (marked paid, partially paid, etc.)
    makes its way back into the CRM. `source` is just for the audit trail
    (e.g. "webhook", "reconciliation", "manual")."""
    manage_con = con is None
    if con is None:
        con = get_conn()
    assert con is not None
    try:
        _ensure_schema(con)
        invoice = _invoice_row(con, int(invoice_id))
        xero_invoice_id = str(invoice.get("xero_invoice_id") or "").strip()
        if not xero_invoice_id:
            raise HTTPException(status_code=400, detail="Invoice is not linked to Xero")
        prior_status = str(invoice.get("status") or "")
        connection = _refresh_token(connection or get_xero_connection(con) or {})
        response = _json_request("GET", f"{XERO_API_BASE.rstrip('/')}/Invoices/{xero_invoice_id}", headers=_xero_headers(connection))
        xero_invoice = (response.get("Invoices") or [{}])[0]
        if not isinstance(xero_invoice, Mapping) or not str(xero_invoice.get("InvoiceID") or "").strip():
            raise HTTPException(status_code=502, detail="Xero did not return an invoice")
        result = _sync_local_invoice(con, int(invoice_id), xero_invoice, sync_status="synced", sync_direction="pull")
        new_status = str(result.get("status") or "")
        if new_status and new_status != prior_status:
            try:
                record_audit_event(
                    con,
                    request=None,
                    actor={"email": "xero-sync@system", "full_name": "Xero", "org_id": invoice.get("org_id")},
                    action="invoice_status_synced_from_xero",
                    entity_type="invoice",
                    entity_id=int(invoice_id),
                    client_id=invoice.get("client_db_id"),
                    job_id=invoice.get("job_id"),
                    before={"status": prior_status},
                    after={"status": new_status, "amount_paid": result.get("amount_paid"), "paid_date": result.get("paid_date")},
                    metadata={"source": source, "xero_status": result.get("xero_status")},
                )
            except Exception:
                logger.warning("Failed to record audit event for invoice_id=%s Xero status sync", invoice_id, exc_info=True)
        return {"ok": True, "invoice": result, "xero_invoice": xero_invoice}
    finally:
        if manage_con:
            try:
                con.__exit__(None, None, None)  # type: ignore[attr-defined]
            except Exception:
                logger.debug("Failed to close Xero connection context cleanly after invoice status sync", exc_info=True)


def reconcile_open_invoices_with_xero(limit: int = 200) -> dict[str, Any]:
    """Safety net for missed/failed webhook deliveries: re-pull every invoice
    that's linked to Xero and not already Paid/Void, so a payment recorded
    in Xero eventually lands here even if the webhook never arrived. Meant
    to be called periodically (see api/internal_cron_routes.py)."""
    with get_conn() as con:
        _ensure_schema(con)
        rows = _fetch_all(
            con,
            """
            SELECT invoice_id FROM invoices
            WHERE xero_invoice_id IS NOT NULL AND xero_invoice_id != ''
              AND LOWER(COALESCE(status, '')) NOT IN ('paid', 'void')
            ORDER BY updated_at ASC
            LIMIT %s
            """,
            [int(limit)],
        )
        if not rows:
            return {"ok": True, "checked": 0, "changed": 0, "errors": []}
        checked = 0
        changed = 0
        errors: list[dict[str, Any]] = []
        connection = _refresh_token(get_xero_connection(con) or {})
        for row in rows:
            invoice_id = int(row["invoice_id"])
            checked += 1
            try:
                before = _invoice_row(con, invoice_id).get("status")
                result = sync_invoice_status_from_xero(invoice_id, con=con, connection=connection, source="reconciliation")
                after = (result.get("invoice") or {}).get("status")
                if after and after != before:
                    changed += 1
            except Exception as exc:
                errors.append({"invoice_id": invoice_id, "error": str(exc)})
        return {"ok": True, "checked": checked, "changed": changed, "errors": errors}


def _credit_note_row(con, credit_note_id: int) -> dict[str, Any]:
    row = _fetch_one(
        con,
        """
        SELECT credit_note_id, client_db_id, job_id, invoice_id, credit_note_number, credit_note_date,
               currency_code, subtotal, vat, total, status, notes,
               xero_credit_note_id, xero_credit_note_number, xero_status, xero_sync_status,
               xero_synced_at, xero_sync_error, org_id
        FROM credit_notes
        WHERE credit_note_id = %s
        """,
        [int(credit_note_id)],
    )
    if not row:
        raise HTTPException(status_code=404, detail="Credit note not found")
    return row


def _credit_note_lines(con, credit_note_id: int) -> list[dict[str, Any]]:
    return _fetch_all(
        con,
        """
        SELECT credit_note_line_id, sort_order, item_id, description, unit, qty, unit_price_ex_vat, amount_ex_vat, vat_rate_pct, notes
        FROM credit_note_lines
        WHERE credit_note_id = %s
        ORDER BY COALESCE(sort_order, credit_note_line_id), credit_note_line_id
        """,
        [int(credit_note_id)],
    )


def _credit_note_link(con, credit_note_id: int) -> dict[str, Any] | None:
    return _fetch_one(con, "SELECT * FROM xero_credit_note_links WHERE credit_note_id = %s", [int(credit_note_id)])


def _save_credit_note_link(
    con,
    *,
    credit_note_id: int,
    xero_credit_note: Mapping[str, Any] | None,
    sync_status: str,
    sync_error: str | None = None,
    sync_direction: str = "push",
) -> dict[str, Any]:
    """See _save_invoice_link()'s docstring -- same push/pull distinction:
    "push" leaves the CRM's own status/applied_amount/applied_date alone,
    "pull" treats Xero as the source of truth for them."""
    xero_credit_note_id = str((xero_credit_note or {}).get("CreditNoteID") or "").strip() if xero_credit_note else ""
    xero_credit_note_number = str((xero_credit_note or {}).get("CreditNoteNumber") or "").strip() if xero_credit_note else ""
    xero_status = str((xero_credit_note or {}).get("Status") or "").strip() if xero_credit_note else ""
    con.execute(
        """
        INSERT INTO xero_credit_note_links (
          credit_note_id, xero_credit_note_id, xero_credit_note_number, xero_status,
          xero_sync_status, xero_sync_error, last_synced_at, created_at, updated_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, NOW(), COALESCE((SELECT created_at FROM xero_credit_note_links WHERE credit_note_id = %s), NOW()), NOW())
        ON CONFLICT (credit_note_id) DO UPDATE SET
          xero_credit_note_id = EXCLUDED.xero_credit_note_id,
          xero_credit_note_number = EXCLUDED.xero_credit_note_number,
          xero_status = EXCLUDED.xero_status,
          xero_sync_status = EXCLUDED.xero_sync_status,
          xero_sync_error = EXCLUDED.xero_sync_error,
          last_synced_at = EXCLUDED.last_synced_at,
          updated_at = NOW()
        """,
        [int(credit_note_id), xero_credit_note_id or None, xero_credit_note_number or None, xero_status or None, sync_status, sync_error, int(credit_note_id)],
    )

    payment_fields = (
        _map_xero_credit_note_payment_fields(xero_credit_note or {}) if (xero_credit_note and sync_direction == "pull") else None
    )
    mapped_status = payment_fields.get("status") if payment_fields else None
    mapped_applied_amount = payment_fields.get("applied_amount") if payment_fields else None
    mapped_applied_date = payment_fields.get("applied_date") if payment_fields else None

    con.execute(
        """
        UPDATE credit_notes
        SET xero_credit_note_id = %s,
            xero_credit_note_number = %s,
            xero_status = %s,
            xero_sync_status = %s,
            xero_sync_error = %s,
            xero_synced_at = NOW(),
            credit_note_number = COALESCE(%s, credit_note_number),
            status = COALESCE(%s, status),
            applied_amount = CASE WHEN %s THEN %s ELSE applied_amount END,
            applied_date = CASE WHEN %s THEN %s ELSE applied_date END
        WHERE credit_note_id = %s
        """,
        [
            xero_credit_note_id or None,
            xero_credit_note_number or None,
            xero_status or None,
            sync_status,
            sync_error,
            xero_credit_note_number or None,
            mapped_status,
            payment_fields is not None,
            mapped_applied_amount,
            payment_fields is not None,
            mapped_applied_date,
            int(credit_note_id),
        ],
    )
    return {
        "credit_note_id": int(credit_note_id),
        "xero_credit_note_id": xero_credit_note_id or None,
        "xero_credit_note_number": xero_credit_note_number or None,
        "xero_status": xero_status or None,
        "xero_sync_status": sync_status,
        "xero_sync_error": sync_error,
        "status": mapped_status,
        "applied_amount": mapped_applied_amount,
        "applied_date": mapped_applied_date,
    }


def _credit_note_line_items(con, credit_note_id: int, connection: Mapping[str, Any] | None = None) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    account_code = _env("XERO_DEFAULT_ACCOUNT_CODE", XERO_DEFAULT_ACCOUNT_CODE) or XERO_DEFAULT_ACCOUNT_CODE
    tax_type_cache: dict[float, str] = {}
    for line in _credit_note_lines(con, int(credit_note_id)):
        qty = _safe_float(line.get("qty"), 1.0) or 1.0
        amount = _safe_float(line.get("amount_ex_vat"), 0.0)
        unit_amount = _safe_float(line.get("unit_price_ex_vat"), 0.0)
        if not unit_amount and qty:
            unit_amount = amount / qty if qty else amount
        # See _line_items(): Xero rejects negative Quantity outright, so fold
        # the sign into UnitAmount instead -- same LineAmount, Xero-legal.
        if qty < 0:
            qty = -qty
            unit_amount = -unit_amount
        description = " - ".join(
            part
            for part in [
                str(line.get("description") or "").strip(),
                str(line.get("notes") or "").strip(),
            ]
            if part
        ) or f"Credit note line {int(line.get('credit_note_line_id') or 0)}"
        vat_rate_pct = _safe_float(line.get("vat_rate_pct"), 0.0)
        if vat_rate_pct not in tax_type_cache:
            tax_type_cache[vat_rate_pct] = _resolve_xero_tax_type(vat_rate_pct, connection)
        item = {
            "Description": description,
            "Quantity": round(qty, 4),
            "UnitAmount": round(unit_amount, 2),
            "LineAmount": round(amount or (qty * unit_amount), 2),
            "AccountCode": account_code,
            "TaxType": tax_type_cache[vat_rate_pct],
        }
        items.append(item)
    return items


def build_xero_credit_note_payload(
    con, credit_note_id: int, *, contact_id: str | None = None, include_credit_note_number: bool = False, connection: Mapping[str, Any] | None = None
) -> dict[str, Any]:
    credit_note = _credit_note_row(con, int(credit_note_id))
    client = _client_row(con, int(credit_note.get("client_db_id") or 0))
    if not contact_id:
        contact_id = str(client.get("xero_contact_id") or "").strip() or None
    if not contact_id:
        link = _contact_link(con, int(credit_note.get("client_db_id") or 0))
        contact_id = str((link or {}).get("xero_contact_id") or "").strip() or None
    if not contact_id:
        raise HTTPException(status_code=400, detail="Xero contact is missing")

    job_reference = ""
    job_id = credit_note.get("job_id")
    if job_id is not None:
        job_row = _fetch_one(con, "SELECT job_number FROM jobs WHERE job_id = %s", [int(job_id)])
        if job_row and job_row.get("job_number"):
            job_reference = str(job_row.get("job_number") or "").strip()

    credit_note_date = _safe_date(credit_note.get("credit_note_date"), _today()) or _today().isoformat()

    line_items = _credit_note_line_items(con, int(credit_note_id), connection=connection)
    if job_reference:
        line_items.append(
            {
                "Description": f"Job Number: {job_reference}",
                "Quantity": 1,
                "UnitAmount": 0,
                "LineAmount": 0,
                "AccountCode": _env("XERO_DEFAULT_ACCOUNT_CODE", XERO_DEFAULT_ACCOUNT_CODE) or XERO_DEFAULT_ACCOUNT_CODE,
                "TaxType": _env("XERO_DEFAULT_TAX_TYPE", XERO_DEFAULT_TAX_TYPE) or XERO_DEFAULT_TAX_TYPE,
            }
        )

    payload: dict[str, Any] = {
        "Type": "ACCRECCREDIT",
        "Contact": {"ContactID": contact_id, "Name": str(client.get("client_name") or "").strip()},
        "Date": credit_note_date,
        "Reference": job_reference or str(credit_note.get("credit_note_number") or "").strip() or None,
        "LineAmountTypes": "Exclusive",
        "Status": _xero_invoice_status(credit_note.get("status")),
        "CurrencyCode": str(credit_note.get("currency_code") or client.get("currency") or "GBP").strip().upper(),
        "LineItems": line_items,
    }
    if include_credit_note_number and str(credit_note.get("credit_note_number") or "").strip():
        payload["CreditNoteNumber"] = str(credit_note.get("credit_note_number") or "").strip()
    if str(credit_note.get("xero_credit_note_id") or "").strip():
        payload["CreditNoteID"] = str(credit_note.get("xero_credit_note_id") or "").strip()
    return {k: v for k, v in payload.items() if v not in (None, "", [], {})}


def _sync_local_credit_note(
    con,
    credit_note_id: int,
    xero_credit_note: Mapping[str, Any],
    sync_status: str = "synced",
    sync_error: str | None = None,
    sync_direction: str = "push",
) -> dict[str, Any]:
    return _save_credit_note_link(
        con,
        credit_note_id=int(credit_note_id),
        xero_credit_note=xero_credit_note,
        sync_status=sync_status,
        sync_error=sync_error,
        sync_direction=sync_direction,
    )


def create_xero_credit_note(credit_note_id: int, *, con=None, connection: Mapping[str, Any] | None = None) -> dict[str, Any]:
    manage_con = con is None
    if con is None:
        con = get_conn()
    assert con is not None
    xero_credit_note: Mapping[str, Any] | None = None
    try:
        _ensure_schema(con)
        credit_note = _credit_note_row(con, int(credit_note_id))
        connection = _refresh_token(connection or get_xero_connection(con) or {})
        contact = upsert_xero_contact(int(credit_note.get("client_db_id") or 0), con=con, connection=connection)
        payload = build_xero_credit_note_payload(con, int(credit_note_id), contact_id=contact.get("xero_contact_id"), include_credit_note_number=False, connection=connection)
        response = _json_request("PUT", f"{XERO_API_BASE.rstrip('/')}/CreditNotes", headers=_xero_headers(connection), payload={"CreditNotes": [payload]})
        xero_credit_note = (response.get("CreditNotes") or [{}])[0]
        if not isinstance(xero_credit_note, Mapping) or not str(xero_credit_note.get("CreditNoteID") or "").strip():
            raise HTTPException(status_code=502, detail="Xero did not return a credit note")
        result = _sync_local_credit_note(con, int(credit_note_id), xero_credit_note, sync_status="synced")
        return {"ok": True, "credit_note": result, "contact": contact, "xero_credit_note": xero_credit_note}
    except Exception as exc:
        # See create_xero_invoice() -- persist the CreditNoteID Xero already
        # gave us even if something after that fails, so a retry updates this
        # same credit note instead of creating an orphaned duplicate.
        error_detail = str(exc.detail) if isinstance(exc, HTTPException) else str(exc)
        try:
            if isinstance(xero_credit_note, Mapping) and str(xero_credit_note.get("CreditNoteID") or "").strip():
                _save_credit_note_link(con, credit_note_id=int(credit_note_id), xero_credit_note=xero_credit_note, sync_status="synced", sync_error=error_detail)
            else:
                _save_credit_note_link(con, credit_note_id=int(credit_note_id), xero_credit_note={}, sync_status="failed", sync_error=error_detail)
        except Exception:
            logger.debug("Failed to persist Xero credit note sync failure state", exc_info=True)
        raise
    finally:
        if manage_con:
            try:
                con.__exit__(None, None, None)  # type: ignore[attr-defined]
            except Exception:
                logger.debug("Failed to close Xero connection context cleanly", exc_info=True)


def update_xero_credit_note(credit_note_id: int, *, con=None, connection: Mapping[str, Any] | None = None) -> dict[str, Any]:
    manage_con = con is None
    if con is None:
        con = get_conn()
    assert con is not None
    xero_credit_note: Mapping[str, Any] | None = None
    try:
        _ensure_schema(con)
        credit_note = _credit_note_row(con, int(credit_note_id))
        if not str(credit_note.get("xero_credit_note_id") or "").strip():
            return create_xero_credit_note(int(credit_note_id), con=con, connection=connection)
        connection = _refresh_token(connection or get_xero_connection(con) or {})
        contact = upsert_xero_contact(int(credit_note.get("client_db_id") or 0), con=con, connection=connection)
        payload = build_xero_credit_note_payload(con, int(credit_note_id), contact_id=contact.get("xero_contact_id"), include_credit_note_number=True, connection=connection)
        payload["CreditNoteID"] = str(credit_note.get("xero_credit_note_id") or "").strip()
        response = _json_request("PUT", f"{XERO_API_BASE.rstrip('/')}/CreditNotes", headers=_xero_headers(connection), payload={"CreditNotes": [payload]})
        xero_credit_note = (response.get("CreditNotes") or [{}])[0]
        if not isinstance(xero_credit_note, Mapping) or not str(xero_credit_note.get("CreditNoteID") or "").strip():
            raise HTTPException(status_code=502, detail="Xero did not return an updated credit note")
        result = _sync_local_credit_note(con, int(credit_note_id), xero_credit_note, sync_status="synced")
        return {"ok": True, "credit_note": result, "contact": contact, "xero_credit_note": xero_credit_note}
    except Exception as exc:
        error_detail = str(exc.detail) if isinstance(exc, HTTPException) else str(exc)
        try:
            if isinstance(xero_credit_note, Mapping) and str(xero_credit_note.get("CreditNoteID") or "").strip():
                _save_credit_note_link(con, credit_note_id=int(credit_note_id), xero_credit_note=xero_credit_note, sync_status="synced", sync_error=error_detail)
            else:
                _save_credit_note_link(con, credit_note_id=int(credit_note_id), xero_credit_note={}, sync_status="failed", sync_error=error_detail)
        except Exception:
            logger.debug("Failed to persist Xero credit note sync failure state", exc_info=True)
        raise
    finally:
        if manage_con:
            try:
                con.__exit__(None, None, None)  # type: ignore[attr-defined]
            except Exception:
                logger.debug("Failed to close Xero connection context cleanly after credit note sync", exc_info=True)


def sync_credit_note_status_from_xero(
    credit_note_id: int, *, con=None, connection: Mapping[str, Any] | None = None, source: str = "manual"
) -> dict[str, Any]:
    """Pull the current state of a credit note from Xero and treat it as the
    source of truth for status/applied_amount/applied_date -- mirrors
    sync_invoice_status_from_xero(). `source` is for the audit trail."""
    manage_con = con is None
    if con is None:
        con = get_conn()
    assert con is not None
    try:
        _ensure_schema(con)
        credit_note = _credit_note_row(con, int(credit_note_id))
        xero_credit_note_id = str(credit_note.get("xero_credit_note_id") or "").strip()
        if not xero_credit_note_id:
            raise HTTPException(status_code=400, detail="Credit note is not linked to Xero")
        prior_status = str(credit_note.get("status") or "")
        connection = _refresh_token(connection or get_xero_connection(con) or {})
        response = _json_request("GET", f"{XERO_API_BASE.rstrip('/')}/CreditNotes/{xero_credit_note_id}", headers=_xero_headers(connection))
        xero_credit_note = (response.get("CreditNotes") or [{}])[0]
        if not isinstance(xero_credit_note, Mapping) or not str(xero_credit_note.get("CreditNoteID") or "").strip():
            raise HTTPException(status_code=502, detail="Xero did not return a credit note")
        result = _sync_local_credit_note(con, int(credit_note_id), xero_credit_note, sync_status="synced", sync_direction="pull")
        new_status = str(result.get("status") or "")
        if new_status and new_status != prior_status:
            try:
                record_audit_event(
                    con,
                    request=None,
                    actor={"email": "xero-sync@system", "full_name": "Xero", "org_id": credit_note.get("org_id")},
                    action="credit_note_status_synced_from_xero",
                    entity_type="credit_note",
                    entity_id=int(credit_note_id),
                    client_id=credit_note.get("client_db_id"),
                    job_id=credit_note.get("job_id"),
                    before={"status": prior_status},
                    after={"status": new_status, "applied_amount": result.get("applied_amount"), "applied_date": result.get("applied_date")},
                    metadata={"source": source, "xero_status": result.get("xero_status")},
                )
            except Exception:
                logger.warning("Failed to record audit event for credit_note_id=%s Xero status sync", credit_note_id, exc_info=True)
        return {"ok": True, "credit_note": result, "xero_credit_note": xero_credit_note}
    finally:
        if manage_con:
            try:
                con.__exit__(None, None, None)  # type: ignore[attr-defined]
            except Exception:
                logger.debug("Failed to close Xero connection context cleanly after credit note status sync", exc_info=True)


def reconcile_open_credit_notes_with_xero(limit: int = 200) -> dict[str, Any]:
    """Safety net for missed/failed webhook deliveries -- mirrors
    reconcile_open_invoices_with_xero() for credit notes."""
    with get_conn() as con:
        _ensure_schema(con)
        rows = _fetch_all(
            con,
            """
            SELECT credit_note_id FROM credit_notes
            WHERE xero_credit_note_id IS NOT NULL AND xero_credit_note_id != ''
              AND LOWER(COALESCE(status, '')) NOT IN ('applied', 'void')
            ORDER BY updated_at ASC
            LIMIT %s
            """,
            [int(limit)],
        )
        if not rows:
            return {"ok": True, "checked": 0, "changed": 0, "errors": []}
        checked = 0
        changed = 0
        errors: list[dict[str, Any]] = []
        connection = _refresh_token(get_xero_connection(con) or {})
        for row in rows:
            credit_note_id = int(row["credit_note_id"])
            checked += 1
            try:
                before = _credit_note_row(con, credit_note_id).get("status")
                result = sync_credit_note_status_from_xero(credit_note_id, con=con, connection=connection, source="reconciliation")
                after = (result.get("credit_note") or {}).get("status")
                if after and after != before:
                    changed += 1
            except Exception as exc:
                errors.append({"credit_note_id": credit_note_id, "error": str(exc)})
        return {"ok": True, "checked": checked, "changed": changed, "errors": errors}


def handle_xero_webhook(payload: Mapping[str, Any] | list[Any] | None) -> dict[str, Any]:
    events = []
    if isinstance(payload, Mapping):
        events = list(payload.get("events") or payload.get("Events") or [])
    elif isinstance(payload, list):
        events = list(payload)
    invoice_ids: list[str] = []
    credit_note_ids: list[str] = []
    for event in events:
        if not isinstance(event, Mapping):
            continue
        resource = str(event.get("resourceUrl") or event.get("resource_url") or event.get("resource") or "").lower()
        if "creditnote" in resource:
            xero_credit_note_id = str(
                event.get("creditNoteID")
                or event.get("CreditNoteID")
                or event.get("resourceId")
                or event.get("resource_id")
                or ""
            ).strip()
            if xero_credit_note_id:
                credit_note_ids.append(xero_credit_note_id)
            continue
        if "invoice" not in resource:
            continue
        xero_invoice_id = str(
            event.get("invoiceID")
            or event.get("InvoiceID")
            or event.get("resourceId")
            or event.get("resource_id")
            or ""
        ).strip()
        if xero_invoice_id:
            invoice_ids.append(xero_invoice_id)
    synced: list[dict[str, Any]] = []
    if invoice_ids or credit_note_ids:
        with get_conn() as con:
            _ensure_schema(con)
            for xero_invoice_id in invoice_ids:
                local = _fetch_one(con, "SELECT invoice_id FROM invoices WHERE xero_invoice_id = %s", [xero_invoice_id])
                if not local:
                    continue
                try:
                    synced.append(sync_invoice_status_from_xero(int(local["invoice_id"]), con=con, source="webhook"))
                except Exception as exc:
                    synced.append({"invoice_id": int(local["invoice_id"]), "error": str(exc)})
            for xero_credit_note_id in credit_note_ids:
                local = _fetch_one(con, "SELECT credit_note_id FROM credit_notes WHERE xero_credit_note_id = %s", [xero_credit_note_id])
                if not local:
                    continue
                try:
                    synced.append(sync_credit_note_status_from_xero(int(local["credit_note_id"]), con=con, source="webhook"))
                except Exception as exc:
                    synced.append({"credit_note_id": int(local["credit_note_id"]), "error": str(exc)})
    return {"ok": True, "received_events": len(events), "invoice_ids": invoice_ids, "credit_note_ids": credit_note_ids, "synced": synced}


def normalize_xero_error(error: Any) -> str:
    if error is None:
        return "Unknown Xero error"
    if isinstance(error, HTTPException):
        return str(error.detail)
    if isinstance(error, Mapping):
        return str(error.get("Message") or error.get("message") or error.get("detail") or json.dumps(error, ensure_ascii=False))
    return str(error)
