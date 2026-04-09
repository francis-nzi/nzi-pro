from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException

from api.auth import _current_user
from api.permissions import ADMIN_ACCESS_PERMISSION, assert_permission
from core.database import get_conn
from services import xero as xero_service

router = APIRouter(prefix="/xero", tags=["xero"])


def _require_admin(user: dict[str, Any]) -> None:
    assert_permission(user, ADMIN_ACCESS_PERMISSION)


@router.get("/status")
def xero_status(_user: dict = Depends(_current_user)):
    _require_admin(_user)
    return {"connection": xero_service.get_xero_connection(), "connected": bool((xero_service.get_xero_connection() or {}).get("status") == "connected")}


@router.post("/connect")
def connect_xero(body: dict = Body(default={}), _user: dict = Depends(_current_user)):
    _require_admin(_user)
    connection = xero_service.save_xero_connection(
        {
            "integration_type": str(body.get("integration_type") or "").strip() or None,
            "tenant_id": str(body.get("tenant_id") or "").strip() or None,
            "org_name": str(body.get("org_name") or "").strip() or None,
            "access_token": str(body.get("access_token") or "").strip() or None,
            "refresh_token": str(body.get("refresh_token") or "").strip() or None,
            "expires_at": body.get("expires_at"),
            "scope": str(body.get("scope") or "").strip() or None,
            "status": "connected",
        },
        actor_email=_user.get("email"),
    )
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

