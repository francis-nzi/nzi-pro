from __future__ import annotations

import json
from urllib.parse import quote_plus, urlparse, urlunparse
from typing import Any

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Request
from fastapi.responses import RedirectResponse

from api.auth import _current_user
from api.permissions import ADMIN_ACCESS_PERMISSION, assert_permission
from core.database import get_conn
from services import xero as xero_service
from services.audit_log import record_audit_event

router = APIRouter(prefix="/xero", tags=["xero"])


def _require_admin(user: dict[str, Any]) -> None:
    assert_permission(user, ADMIN_ACCESS_PERMISSION)


def _frontend_base_url() -> str:
    from os import getenv

    return str(getenv("FRONTEND_BASE_URL", "http://localhost:3000") or "http://localhost:3000").rstrip("/")


def _append_query(url: str, key: str, value: str) -> str:
    parts = urlparse(url)
    query = parts.query
    extra = f"{quote_plus(key)}={quote_plus(value)}"
    new_query = f"{query}&{extra}" if query else extra
    return urlunparse((parts.scheme, parts.netloc, parts.path, parts.params, new_query, parts.fragment))


@router.get("/status")
def xero_status(_user: dict = Depends(_current_user)):
    _require_admin(_user)
    return {"connection": xero_service.get_xero_connection(), "connected": bool((xero_service.get_xero_connection() or {}).get("status") == "connected")}


@router.post("/connect")
def connect_xero(body: dict = Body(default={}), _user: dict = Depends(_current_user)):
    _require_admin(_user)
    # Only include integration_type/tenant_id when the caller actually
    # provided one -- omitting the key (rather than passing None) lets
    # save_xero_connection fall back to the existing/default value instead
    # of nulling out integration_type, which is NOT NULL in the schema.
    payload: dict[str, Any] = {
        "org_name": str(body.get("org_name") or "").strip() or None,
        # Always clear any cached token here so the upcoming test below is
        # forced to request a genuinely fresh one rather than potentially
        # reusing a stale/expired cached token.
        "access_token": None,
        "refresh_token": None,
        "expires_at": None,
        "scope": str(body.get("scope") or "").strip() or None,
        "status": "connected",
    }
    integration_type = str(body.get("integration_type") or "").strip()
    if integration_type:
        payload["integration_type"] = integration_type
    tenant_id = str(body.get("tenant_id") or "").strip()
    if tenant_id:
        payload["tenant_id"] = tenant_id
    connection = xero_service.save_xero_connection(payload, actor_email=_user.get("email"))
    try:
        test = xero_service.test_xero_connection()
        return {"ok": True, "connection": connection, "test": test}
    except HTTPException as exc:
        return {"ok": False, "connection": connection, "error": xero_service.normalize_xero_error(exc)}


@router.post("/disconnect")
def disconnect_xero(_user: dict = Depends(_current_user)):
    _require_admin(_user)
    return {"ok": True, "connection": xero_service.clear_xero_connection(actor_email=_user.get("email"))}


@router.post("/test")
def test_xero(_user: dict = Depends(_current_user)):
    _require_admin(_user)
    return xero_service.test_xero_connection()


@router.get("/oauth/config")
def xero_oauth_config(_user: dict = Depends(_current_user)):
    _require_admin(_user)
    return {
        "redirect_uri": xero_service._redirect_uri(),  # type: ignore[attr-defined]
        "scope": xero_service._env("XERO_SCOPE", xero_service.XERO_DEFAULT_SCOPE),  # type: ignore[attr-defined]
        "start_url": "/xero/oauth/start",
    }


@router.get("/oauth/start")
def start_xero_oauth(request: Request, _user: dict = Depends(_current_user)):
    _require_admin(_user)
    auth_url, state = xero_service.build_oauth_authorize_url()
    response = RedirectResponse(url=auth_url, status_code=302)
    secure = request.url.scheme == "https"
    response.set_cookie(
        "xero_oauth_state",
        state,
        max_age=600,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )
    response.set_cookie(
        "xero_oauth_return_to",
        f"{_frontend_base_url()}/admin/settings?xero=oauth_start",
        max_age=600,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )
    return response


@router.get("/oauth/callback")
def xero_oauth_callback(request: Request, code: str | None = None, state: str | None = None, error: str | None = None):
    return_to = request.cookies.get("xero_oauth_return_to") or f"{_frontend_base_url()}/admin/settings"
    if error:
        response = RedirectResponse(url=_append_query(return_to, "xero", error), status_code=302)
        response.delete_cookie("xero_oauth_state", path="/")
        response.delete_cookie("xero_oauth_return_to", path="/")
        return response
    if not code or not state:
        response = RedirectResponse(url=_append_query(return_to, "xero", "missing_code"), status_code=302)
        response.delete_cookie("xero_oauth_state", path="/")
        response.delete_cookie("xero_oauth_return_to", path="/")
        return response

    expected_state = request.cookies.get("xero_oauth_state") or ""
    if not expected_state or expected_state != state:
        response = RedirectResponse(url=_append_query(return_to, "xero", "state_mismatch"), status_code=302)
        response.delete_cookie("xero_oauth_state", path="/")
        response.delete_cookie("xero_oauth_return_to", path="/")
        return response

    try:
        xero_service.complete_oauth_connection(code=code)
        response = RedirectResponse(url=_append_query(return_to, "xero", "connected"), status_code=302)
        response.delete_cookie("xero_oauth_state", path="/")
        response.delete_cookie("xero_oauth_return_to", path="/")
        return response
    except HTTPException as exc:
        response = RedirectResponse(url=_append_query(return_to, "xero", xero_service.normalize_xero_error(exc)), status_code=302)
        response.delete_cookie("xero_oauth_state", path="/")
        response.delete_cookie("xero_oauth_return_to", path="/")
        return response


@router.post("/invoices/{invoice_id}/sync")
def sync_invoice(invoice_id: int, _user: dict = Depends(_current_user), request: Request = None):
    _require_admin(_user)
    with get_conn() as con:
        xero_service._ensure_schema(con)  # type: ignore[attr-defined]
        invoice = xero_service._invoice_row(con, int(invoice_id))  # type: ignore[attr-defined]
        if str(invoice.get("xero_invoice_id") or "").strip():
            result = xero_service.update_xero_invoice(int(invoice_id), con=con)
        else:
            result = xero_service.create_xero_invoice(int(invoice_id), con=con)
        record_audit_event(
            con, request=request, actor=_user, action="invoice_synced_to_xero",
            entity_type="invoice", entity_id=int(invoice_id),
            client_id=invoice.get("client_db_id"), job_id=invoice.get("job_id"), after=result,
        )
        return result


@router.post("/invoices/{invoice_id}/resync")
def resync_invoice(invoice_id: int, _user: dict = Depends(_current_user), request: Request = None):
    _require_admin(_user)
    with get_conn() as con:
        xero_service._ensure_schema(con)  # type: ignore[attr-defined]
        invoice = xero_service._invoice_row(con, int(invoice_id))  # type: ignore[attr-defined]
        result = xero_service.update_xero_invoice(int(invoice_id), con=con)
        record_audit_event(
            con, request=request, actor=_user, action="invoice_synced_to_xero",
            entity_type="invoice", entity_id=int(invoice_id),
            client_id=invoice.get("client_db_id"), job_id=invoice.get("job_id"), after=result,
            metadata={"resync": True},
        )
        return result


@router.get("/invoices/{invoice_id}/status")
def invoice_status(invoice_id: int, _user: dict = Depends(_current_user)):
    _require_admin(_user)
    with get_conn() as con:
        xero_service._ensure_schema(con)  # type: ignore[attr-defined]
        invoice = xero_service._invoice_row(con, int(invoice_id))  # type: ignore[attr-defined]
        link = xero_service._invoice_link(con, int(invoice_id))  # type: ignore[attr-defined]
        return {"invoice": invoice, "xero": link}


@router.post("/credit-notes/{credit_note_id}/sync")
def sync_credit_note(credit_note_id: int, _user: dict = Depends(_current_user), request: Request = None):
    _require_admin(_user)
    with get_conn() as con:
        xero_service._ensure_schema(con)  # type: ignore[attr-defined]
        credit_note = xero_service._credit_note_row(con, int(credit_note_id))  # type: ignore[attr-defined]
        if str(credit_note.get("xero_credit_note_id") or "").strip():
            result = xero_service.update_xero_credit_note(int(credit_note_id), con=con)
        else:
            result = xero_service.create_xero_credit_note(int(credit_note_id), con=con)
        record_audit_event(
            con, request=request, actor=_user, action="credit_note_synced_to_xero",
            entity_type="credit_note", entity_id=int(credit_note_id),
            client_id=credit_note.get("client_db_id"), job_id=credit_note.get("job_id"), after=result,
        )
        return result


@router.post("/credit-notes/{credit_note_id}/resync")
def resync_credit_note(credit_note_id: int, _user: dict = Depends(_current_user), request: Request = None):
    _require_admin(_user)
    with get_conn() as con:
        xero_service._ensure_schema(con)  # type: ignore[attr-defined]
        credit_note = xero_service._credit_note_row(con, int(credit_note_id))  # type: ignore[attr-defined]
        result = xero_service.update_xero_credit_note(int(credit_note_id), con=con)
        record_audit_event(
            con, request=request, actor=_user, action="credit_note_synced_to_xero",
            entity_type="credit_note", entity_id=int(credit_note_id),
            client_id=credit_note.get("client_db_id"), job_id=credit_note.get("job_id"), after=result,
            metadata={"resync": True},
        )
        return result


@router.get("/credit-notes/{credit_note_id}/status")
def credit_note_status(credit_note_id: int, _user: dict = Depends(_current_user)):
    _require_admin(_user)
    with get_conn() as con:
        xero_service._ensure_schema(con)  # type: ignore[attr-defined]
        credit_note = xero_service._credit_note_row(con, int(credit_note_id))  # type: ignore[attr-defined]
        link = xero_service._credit_note_link(con, int(credit_note_id))  # type: ignore[attr-defined]
        return {"credit_note": credit_note, "xero": link}


@router.post("/webhook")
async def webhook(request: Request, x_xero_signature: str | None = Header(default=None, alias="x-xero-signature")):
    # Xero signs every delivery with HMAC-SHA256 over the raw body using the
    # webhook signing key from the Developer Portal -- verify it before
    # trusting anything in the payload, otherwise this endpoint would act on
    # a POST from anyone who finds the URL, not just Xero. Must read the raw
    # bytes (not the parsed body) since the signature is over the exact
    # bytes Xero sent.
    raw_body = await request.body()
    if not xero_service._xero_webhook_key():  # type: ignore[attr-defined]
        raise HTTPException(status_code=503, detail="XERO_WEBHOOK_KEY env var is not configured")
    if not xero_service.verify_xero_webhook_signature(raw_body, x_xero_signature):
        raise HTTPException(status_code=401, detail="Invalid Xero webhook signature")
    try:
        payload = json.loads(raw_body.decode("utf-8")) if raw_body else {}
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")
    return xero_service.handle_xero_webhook(payload)

