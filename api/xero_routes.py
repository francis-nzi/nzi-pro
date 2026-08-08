from __future__ import annotations

from urllib.parse import quote_plus, urlparse, urlunparse
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse

from api.auth import _current_user
from api.permissions import ADMIN_ACCESS_PERMISSION, assert_permission
from core.database import get_conn
from services import xero as xero_service

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
def sync_invoice(invoice_id: int, _user: dict = Depends(_current_user)):
    _require_admin(_user)
    with get_conn() as con:
        xero_service._ensure_schema(con)  # type: ignore[attr-defined]
        invoice = xero_service._invoice_row(con, int(invoice_id))  # type: ignore[attr-defined]
        if str(invoice.get("xero_invoice_id") or "").strip():
            return xero_service.update_xero_invoice(int(invoice_id), con=con)
        return xero_service.create_xero_invoice(int(invoice_id), con=con)


@router.post("/invoices/{invoice_id}/resync")
def resync_invoice(invoice_id: int, _user: dict = Depends(_current_user)):
    _require_admin(_user)
    with get_conn() as con:
        xero_service._ensure_schema(con)  # type: ignore[attr-defined]
        return xero_service.update_xero_invoice(int(invoice_id), con=con)


@router.get("/invoices/{invoice_id}/status")
def invoice_status(invoice_id: int, _user: dict = Depends(_current_user)):
    _require_admin(_user)
    with get_conn() as con:
        xero_service._ensure_schema(con)  # type: ignore[attr-defined]
        invoice = xero_service._invoice_row(con, int(invoice_id))  # type: ignore[attr-defined]
        link = xero_service._invoice_link(con, int(invoice_id))  # type: ignore[attr-defined]
        return {"invoice": invoice, "xero": link}


@router.post("/webhook")
def webhook(payload: dict = Body(default={})):
    return xero_service.handle_xero_webhook(payload)

