from __future__ import annotations

import base64
import json
import os
from datetime import date, datetime, timedelta
from typing import Any, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import HTTPException

from core.database import get_conn
from services.audit_log import fetch_row_dict

XERO_CONNECTION_KEY = "default"
XERO_API_BASE = "https://api.xero.com/api.xro/2.0"
XERO_TOKEN_URL = "https://identity.xero.com/connect/token"
XERO_DEFAULT_AUTH_TYPE = "custom_connection"
XERO_DEFAULT_SCOPE = "accounting.contacts accounting.transactions offline_access"
XERO_DEFAULT_ACCOUNT_CODE = "200"
XERO_DEFAULT_TAX_TYPE = "NONE"


def _env(name: str, default: str = "") -> str:
    return str(os.getenv(name, default) or "").strip()


def _now() -> datetime:
    return datetime.utcnow()


def _today() -> date:
    return date.today()


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value if value is not None else default)
    except Exception:
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
        return text[:10] or (fallback.isoformat() if fallback else None)


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
            pass
        raise HTTPException(status_code=502, detail=f"Xero request failed: {detail}") from exc
    except URLError as exc:
        raise HTTPException(status_code=502, detail=f"Xero request failed: {exc.reason}") from exc


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
        pass
    try:
        con.execute("CREATE INDEX IF NOT EXISTS xero_contact_links_contact_idx ON xero_contact_links (xero_contact_id)")
    except Exception:
        pass
    try:
        con.execute("CREATE INDEX IF NOT EXISTS invoices_xero_invoice_idx ON invoices (xero_invoice_id)")
    except Exception:
        pass


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
        "scope": _env("XERO_SCOPE", XERO_DEFAULT_SCOPE) or XERO_DEFAULT_SCOPE,
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
        merged.update({k: v for k, v in connection.items() if v is not None})
        if test_result:
            merged.update({k: v for k, v in test_result.items() if v is not None})
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


def _refresh_token(connection: Mapping[str, Any]) -> dict[str, Any]:
    token = str(connection.get("access_token") or "").strip()
    expires_at = str(connection.get("expires_at") or "").strip()
    if token and expires_at:
        try:
            if datetime.fromisoformat(expires_at.replace("Z", "+00:00")) > (_now() + timedelta(seconds=60)):
                return dict(connection)
        except Exception:
            pass

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
            "scope": str(connection.get("scope") or _env("XERO_SCOPE", XERO_DEFAULT_SCOPE) or XERO_DEFAULT_SCOPE).strip(),
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
               xero_synced_at, xero_sync_error
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
        payload["EmailAddress"] = str(email_row.get("email") or "").strip()
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


def _save_invoice_link(con, *, invoice_id: int, xero_invoice: Mapping[str, Any] | None, sync_status: str, sync_error: str | None = None) -> dict[str, Any]:
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
            status = COALESCE(%s, status)
        WHERE invoice_id = %s
        """,
        [xero_invoice_id or None, xero_invoice_number or None, xero_status or None, sync_status, sync_error, xero_invoice_number or None, xero_status or None, int(invoice_id)],
    )
    return {
        "invoice_id": int(invoice_id),
        "xero_invoice_id": xero_invoice_id or None,
        "xero_invoice_number": xero_invoice_number or None,
        "xero_status": xero_status or None,
        "xero_sync_status": sync_status,
        "xero_sync_error": sync_error,
    }


def _line_items(con, invoice_id: int) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    account_code = _env("XERO_DEFAULT_ACCOUNT_CODE", XERO_DEFAULT_ACCOUNT_CODE) or XERO_DEFAULT_ACCOUNT_CODE
    tax_type = _env("XERO_DEFAULT_TAX_TYPE", XERO_DEFAULT_TAX_TYPE) or XERO_DEFAULT_TAX_TYPE
    for line in _invoice_lines(con, int(invoice_id)):
        qty = _safe_float(line.get("qty"), 1.0) or 1.0
        amount = _safe_float(line.get("amount_ex_vat"), 0.0)
        unit_amount = _safe_float(line.get("unit_price_ex_vat"), 0.0)
        if not unit_amount and qty:
            unit_amount = amount / qty if qty else amount
        description = " - ".join(
            part
            for part in [
                str(line.get("description") or "").strip(),
                str(line.get("notes") or "").strip(),
            ]
            if part
        ) or f"Invoice line {int(line.get('invoice_line_id') or 0)}"
        item = {
            "Description": description,
            "Quantity": round(qty, 4),
            "UnitAmount": round(unit_amount, 2),
            "LineAmount": round(amount or (qty * unit_amount), 2),
            "AccountCode": account_code,
            "TaxType": tax_type,
        }
        if str(line.get("unit") or "").strip():
            item["ItemCode"] = str(line.get("unit") or "").strip()
        items.append(item)
    return items


def build_xero_invoice_payload(con, invoice_id: int, *, contact_id: str | None = None, include_invoice_number: bool = False) -> dict[str, Any]:
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

    payload: dict[str, Any] = {
        "Type": "ACCREC",
        "Contact": {"ContactID": contact_id, "Name": str(client.get("client_name") or "").strip()},
        "Date": invoice_date,
        "DueDate": due_date,
        "Reference": job_reference or str(invoice.get("invoice_number") or "").strip() or None,
        "LineAmountTypes": "Exclusive",
        "Status": str(invoice.get("status") or "DRAFT").strip().upper(),
        "CurrencyCode": str(invoice.get("currency_code") or client.get("currency") or "GBP").strip().upper(),
        "LineItems": _line_items(con, int(invoice_id)),
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
                pass


def test_xero_connection(*, con=None) -> dict[str, Any]:
    manage_con = con is None
    if con is None:
        con = get_conn()
    assert con is not None
    try:
        _ensure_schema(con)
        connection = _refresh_token(get_xero_connection(con) or _connection_defaults())
        response = _json_request("GET", f"{XERO_API_BASE.rstrip('/')}/Organisation", headers=_xero_headers(connection))
        org = (response.get("Organisations") or [{}])[0]
        org_name = str(org.get("Name") or org.get("LegalName") or "").strip() or None
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
        return {"ok": True, "status": "connected", "connection": updated, "organisation": org}
    except HTTPException as exc:
        try:
            save_xero_connection({"status": "error", "last_error": str(exc.detail)})
        except Exception:
            pass
        raise
    finally:
        if manage_con:
            try:
                con.__exit__(None, None, None)  # type: ignore[attr-defined]
            except Exception:
                pass


def _sync_local_invoice(con, invoice_id: int, xero_invoice: Mapping[str, Any], sync_status: str = "synced", sync_error: str | None = None) -> dict[str, Any]:
    return _save_invoice_link(con, invoice_id=int(invoice_id), xero_invoice=xero_invoice, sync_status=sync_status, sync_error=sync_error)


def create_xero_invoice(invoice_id: int, *, con=None, connection: Mapping[str, Any] | None = None) -> dict[str, Any]:
    manage_con = con is None
    if con is None:
        con = get_conn()
    assert con is not None
    try:
        _ensure_schema(con)
        invoice = _invoice_row(con, int(invoice_id))
        connection = _refresh_token(connection or get_xero_connection(con) or {})
        contact = upsert_xero_contact(int(invoice.get("client_db_id") or 0), con=con, connection=connection)
        payload = build_xero_invoice_payload(con, int(invoice_id), contact_id=contact.get("xero_contact_id"), include_invoice_number=False)
        response = _json_request("PUT", f"{XERO_API_BASE.rstrip('/')}/Invoices", headers=_xero_headers(connection), payload={"Invoices": [payload]})
        xero_invoice = (response.get("Invoices") or [{}])[0]
        if not isinstance(xero_invoice, Mapping) or not str(xero_invoice.get("InvoiceID") or "").strip():
            raise HTTPException(status_code=502, detail="Xero did not return an invoice")
        result = _sync_local_invoice(con, int(invoice_id), xero_invoice, sync_status="synced")
        return {"ok": True, "invoice": result, "contact": contact, "xero_invoice": xero_invoice}
    except HTTPException as exc:
        try:
            _save_invoice_link(con, invoice_id=int(invoice_id), xero_invoice={}, sync_status="failed", sync_error=str(exc.detail))
        except Exception:
            pass
        raise
    finally:
        if manage_con:
            try:
                con.__exit__(None, None, None)  # type: ignore[attr-defined]
            except Exception:
                pass


def update_xero_invoice(invoice_id: int, *, con=None, connection: Mapping[str, Any] | None = None) -> dict[str, Any]:
    manage_con = con is None
    if con is None:
        con = get_conn()
    assert con is not None
    try:
        _ensure_schema(con)
        invoice = _invoice_row(con, int(invoice_id))
        if not str(invoice.get("xero_invoice_id") or "").strip():
            return create_xero_invoice(int(invoice_id), con=con, connection=connection)
        connection = _refresh_token(connection or get_xero_connection(con) or {})
        contact = upsert_xero_contact(int(invoice.get("client_db_id") or 0), con=con, connection=connection)
        payload = build_xero_invoice_payload(con, int(invoice_id), contact_id=contact.get("xero_contact_id"), include_invoice_number=True)
        payload["InvoiceID"] = str(invoice.get("xero_invoice_id") or "").strip()
        response = _json_request("PUT", f"{XERO_API_BASE.rstrip('/')}/Invoices", headers=_xero_headers(connection), payload={"Invoices": [payload]})
        xero_invoice = (response.get("Invoices") or [{}])[0]
        if not isinstance(xero_invoice, Mapping) or not str(xero_invoice.get("InvoiceID") or "").strip():
            raise HTTPException(status_code=502, detail="Xero did not return an updated invoice")
        result = _sync_local_invoice(con, int(invoice_id), xero_invoice, sync_status="synced")
        return {"ok": True, "invoice": result, "contact": contact, "xero_invoice": xero_invoice}
    except HTTPException as exc:
        try:
            _save_invoice_link(con, invoice_id=int(invoice_id), xero_invoice={}, sync_status="failed", sync_error=str(exc.detail))
        except Exception:
            pass
        raise
    finally:
        if manage_con:
            try:
                con.__exit__(None, None, None)  # type: ignore[attr-defined]
            except Exception:
                pass


def sync_invoice_status_from_xero(invoice_id: int, *, con=None, connection: Mapping[str, Any] | None = None) -> dict[str, Any]:
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
        connection = _refresh_token(connection or get_xero_connection(con) or {})
        response = _json_request("GET", f"{XERO_API_BASE.rstrip('/')}/Invoices/{xero_invoice_id}", headers=_xero_headers(connection))
        xero_invoice = (response.get("Invoices") or [{}])[0]
        if not isinstance(xero_invoice, Mapping) or not str(xero_invoice.get("InvoiceID") or "").strip():
            raise HTTPException(status_code=502, detail="Xero did not return an invoice")
        result = _sync_local_invoice(con, int(invoice_id), xero_invoice, sync_status="synced")
        return {"ok": True, "invoice": result, "xero_invoice": xero_invoice}
    finally:
        if manage_con:
            try:
                con.__exit__(None, None, None)  # type: ignore[attr-defined]
            except Exception:
                pass


def handle_xero_webhook(payload: Mapping[str, Any] | list[Any] | None) -> dict[str, Any]:
    events = []
    if isinstance(payload, Mapping):
        events = list(payload.get("events") or payload.get("Events") or [])
    elif isinstance(payload, list):
        events = list(payload)
    invoice_ids: list[str] = []
    for event in events:
        if not isinstance(event, Mapping):
            continue
        resource = str(event.get("resourceUrl") or event.get("resource_url") or event.get("resource") or "").lower()
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
    if invoice_ids:
        with get_conn() as con:
            _ensure_schema(con)
            for xero_invoice_id in invoice_ids:
                local = _fetch_one(con, "SELECT invoice_id FROM invoices WHERE xero_invoice_id = %s", [xero_invoice_id])
                if not local:
                    continue
                try:
                    synced.append(sync_invoice_status_from_xero(int(local["invoice_id"]), con=con))
                except Exception as exc:
                    synced.append({"invoice_id": int(local["invoice_id"]), "error": str(exc)})
    return {"ok": True, "received_events": len(events), "invoice_ids": invoice_ids, "synced": synced}


def normalize_xero_error(error: Any) -> str:
    if error is None:
        return "Unknown Xero error"
    if isinstance(error, HTTPException):
        return str(error.detail)
    if isinstance(error, Mapping):
        return str(error.get("Message") or error.get("message") or error.get("detail") or json.dumps(error, ensure_ascii=False))
    return str(error)
