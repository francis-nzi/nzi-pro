"""
Admin API routes for team, lookups, datasets, and system management.
"""

import logging
import hashlib

from fastapi import APIRouter, Depends, HTTPException, Body, UploadFile, File, Form, Query, Request
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool
from api.auth import _current_user
from api.permissions import require_permission
from core.database import get_conn
from core.auth import set_user_password
from services.pdf_generation_queue import get_pdf_queue
from services.messaging_templates import build_email_content
from services.outbound_email import send_tracked_email
from services.tenancy import require_org, get_current_org_context, run_with_org_context
from pathlib import Path
import io
import zipfile
import tempfile
import secrets
import string
import re
import json
import os
from datetime import date, datetime, timedelta, timezone
import inspect
import pandas as pd
from threading import Lock
from decimal import Decimal, InvalidOperation
from services.legacy_annual_import import parse_legacy_annual_workbook, commit_legacy_rows, resolve_unresolved_rows
from services.attribute_override_import import (
    build_override_template_workbook,
    commit_override_rows,
    parse_override_workbook,
)
from services.audit_log import ensure_audit_log_table, parse_json_text, record_audit_event
from services.permissions import (
    ACCESS_SCOPES,
    ADMIN_ACCESS_PERMISSION,
    DEFAULT_INTERNAL_ACCESS_SCOPE,
    DEFAULT_PORTAL_ACCESS_SCOPE,
    PERMISSIONS,
    SUPERADMIN_ROLE,
    ensure_permission_schema,
    get_effective_permissions_for_user,
    invalidate_permission_cache,
)
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from typing import Any

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_permission(ADMIN_ACCESS_PERMISSION))],
)
logger = logging.getLogger(__name__)

_LOOKUP_BOOTSTRAP_LOCK = Lock()
_LOOKUP_BOOTSTRAPPED: set[str] = set()
_ADMIN_USER_BOOTSTRAPPED = False
_ADMIN_USER_BOOTSTRAP_LOCK = Lock()
_ORG_SCOPED_LOOKUP_TABLES = {"job_types", "time_subjects", "portfolios_lookup"}
_ORG_ROLE_RANKS = {
    "owner": 40,
    "admin": 30,
    "billing": 20,
    "member": 10,
    "consultant": 10,
}
_ORG_ROLE_LABELS = {
    "owner": "Owner",
    "admin": "Admin",
    "billing": "Billing",
    "member": "Member",
    "consultant": "Consultant",
}
_ORG_ROLE_CAPABILITIES = {
    "owner": {
        "can_switch": True,
        "can_manage_members": True,
        "can_invite": True,
        "can_manage_organisation": True,
        "can_transfer_ownership": True,
        "can_manage_billing": True,
    },
    "admin": {
        "can_switch": True,
        "can_manage_members": True,
        "can_invite": True,
        "can_manage_organisation": True,
        "can_transfer_ownership": False,
        "can_manage_billing": False,
    },
    "billing": {
        "can_switch": True,
        "can_manage_members": False,
        "can_invite": False,
        "can_manage_organisation": False,
        "can_transfer_ownership": False,
        "can_manage_billing": True,
    },
    "member": {
        "can_switch": True,
        "can_manage_members": False,
        "can_invite": False,
        "can_manage_organisation": False,
        "can_transfer_ownership": False,
        "can_manage_billing": False,
    },
    "consultant": {
        "can_switch": True,
        "can_manage_members": False,
        "can_invite": False,
        "can_manage_organisation": False,
        "can_transfer_ownership": False,
        "can_manage_billing": False,
    },
}
_ORG_MANAGEMENT_ROLES = {"owner", "admin"}
_ORG_SWITCH_ROLES = {"owner", "admin", "billing", "member", "consultant"}
_ORG_BILLING_INVOICE_STATUSES = {"draft", "issued", "paid", "overdue", "void", "refunded"}
_ORG_BILLING_EVENT_TYPES = {
    "invoice_created",
    "invoice_issued",
    "payment_received",
    "payment_failed",
    "subscription_created",
    "subscription_updated",
    "subscription_canceled",
    "renewal",
    "reminder_sent",
    "note",
}



@router.get("/suppliers")
def list_suppliers(include_inactive: bool = False, _user: dict = Depends(_current_user)):
    try:
        with get_conn() as con:
            _ensure_supplier_tables(con)
            where = "" if include_inactive else "WHERE is_active = TRUE"
            df = con.execute(
                f"""
                SELECT
                  s.supplier_id, s.supplier_name, s.address, s.contact_name, s.contact_email,
                  s.website, s.phone, s.notes, s.is_active, s.created_at, s.updated_at,
                  COUNT(si.supplier_item_id) AS item_count
                FROM suppliers s
                LEFT JOIN supplier_service_items si
                  ON si.supplier_id = s.supplier_id
                  AND (si.is_active = TRUE OR %s = TRUE)
                {where}
                GROUP BY
                  s.supplier_id, s.supplier_name, s.address, s.contact_name, s.contact_email,
                  s.website, s.phone, s.notes, s.is_active, s.created_at, s.updated_at
                ORDER BY lower(s.supplier_name)
                """,
                [bool(include_inactive)],
            ).df()
            items = []
            if df is not None and not df.empty:
                for _, r in df.iterrows():
                    items.append({
                        "supplier_id": int(r.get("supplier_id") or 0),
                        "supplier_name": str(r.get("supplier_name") or ""),
                        "address": str(r.get("address") or ""),
                        "contact_name": str(r.get("contact_name") or ""),
                        "contact_email": str(r.get("contact_email") or ""),
                        "website": str(r.get("website") or ""),
                        "phone": str(r.get("phone") or ""),
                        "notes": str(r.get("notes") or ""),
                        "is_active": bool(r.get("is_active") if r.get("is_active") is not None else True),
                        "item_count": int(r.get("item_count") or 0),
                    })
            return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list suppliers: {e}")


@router.post("/suppliers")
def create_supplier(body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        supplier_name = str(body.get("supplier_name") or "").strip()
        if not supplier_name:
            raise HTTPException(status_code=400, detail="supplier_name is required")
        with get_conn() as con:
            _ensure_supplier_tables(con)
            con.execute(
                """
                INSERT INTO suppliers (supplier_name, address, contact_name, contact_email, website, phone, notes, is_active, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
                """,
                [
                    supplier_name,
                    str(body.get("address") or "").strip() or None,
                    str(body.get("contact_name") or "").strip() or None,
                    str(body.get("contact_email") or "").strip() or None,
                    str(body.get("website") or "").strip() or None,
                    str(body.get("phone") or "").strip() or None,
                    str(body.get("notes") or "").strip() or None,
                    bool(body.get("is_active") if "is_active" in body else True),
                ],
            )
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create supplier: {e}")


@router.put("/suppliers/{supplier_id}")
def update_supplier(supplier_id: int, body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        with get_conn() as con:
            _ensure_supplier_tables(con)
            exists = con.execute("SELECT supplier_id FROM suppliers WHERE supplier_id = %s", [int(supplier_id)]).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="Supplier not found")
            supplier_name = str(body.get("supplier_name") or "").strip()
            if not supplier_name:
                raise HTTPException(status_code=400, detail="supplier_name is required")
            con.execute(
                """
                UPDATE suppliers
                SET supplier_name = %s,
                    address = %s,
                    contact_name = %s,
                    contact_email = %s,
                    website = %s,
                    phone = %s,
                    notes = %s,
                    is_active = %s,
                    updated_at = NOW()
                WHERE supplier_id = %s
                """,
                [
                    supplier_name,
                    str(body.get("address") or "").strip() or None,
                    str(body.get("contact_name") or "").strip() or None,
                    str(body.get("contact_email") or "").strip() or None,
                    str(body.get("website") or "").strip() or None,
                    str(body.get("phone") or "").strip() or None,
                    str(body.get("notes") or "").strip() or None,
                    bool(body.get("is_active") if "is_active" in body else True),
                    int(supplier_id),
                ],
            )
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update supplier: {e}")


@router.patch("/suppliers/{supplier_id}")
def patch_supplier(supplier_id: int, body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        with get_conn() as con:
            _ensure_supplier_tables(con)
            exists = con.execute("SELECT supplier_id FROM suppliers WHERE supplier_id = %s", [int(supplier_id)]).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="Supplier not found")
            updates = []
            params = []
            if "is_active" in body:
                updates.append("is_active = %s")
                params.append(bool(body.get("is_active")))
            if "supplier_name" in body:
                updates.append("supplier_name = %s")
                params.append(str(body.get("supplier_name") or "").strip())
            if not updates:
                return {"ok": True}
            updates.append("updated_at = NOW()")
            params.append(int(supplier_id))
            con.execute(f"UPDATE suppliers SET {', '.join(updates)} WHERE supplier_id = %s", params)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to patch supplier: {e}")


@router.get("/suppliers/{supplier_id}/items")
def list_supplier_items(supplier_id: int, include_inactive: bool = False, _user: dict = Depends(_current_user)):
    try:
        with get_conn() as con:
            _ensure_supplier_tables(con)
            where = "" if include_inactive else "AND si.is_active = TRUE"
            df = con.execute(
                f"""
                SELECT
                  si.supplier_item_id, si.supplier_id, si.cost_type, si.item_name, si.description,
                  si.uom, si.agreed_rate, si.is_vatable, si.vat_rate_pct, si.is_active,
                  si.created_at, si.updated_at
                FROM supplier_service_items si
                WHERE si.supplier_id = %s
                {where}
                ORDER BY lower(si.item_name)
                """,
                [int(supplier_id)],
            ).df()
            items = []
            if df is not None and not df.empty:
                for _, r in df.iterrows():
                    items.append({
                        "supplier_item_id": int(r.get("supplier_item_id") or 0),
                        "supplier_id": int(r.get("supplier_id") or 0),
                        "cost_type": str(r.get("cost_type") or ""),
                        "item_name": str(r.get("item_name") or ""),
                        "description": str(r.get("description") or ""),
                        "uom": str(r.get("uom") or ""),
                        "agreed_rate": float(r.get("agreed_rate") or 0),
                        "is_vatable": bool(r.get("is_vatable") if r.get("is_vatable") is not None else False),
                        "vat_rate_pct": float(r.get("vat_rate_pct") or 0),
                        "is_active": bool(r.get("is_active") if r.get("is_active") is not None else True),
                    })
            return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list supplier items: {e}")


@router.post("/suppliers/{supplier_id}/items")
def create_supplier_item(supplier_id: int, body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        item_name = str(body.get("item_name") or "").strip()
        if not item_name:
            raise HTTPException(status_code=400, detail="item_name is required")
        with get_conn() as con:
            _ensure_supplier_tables(con)
            exists = con.execute("SELECT supplier_id FROM suppliers WHERE supplier_id = %s", [int(supplier_id)]).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="Supplier not found")
            con.execute(
                """
                INSERT INTO supplier_service_items (
                  supplier_id, cost_type, item_name, description, uom, agreed_rate,
                  is_vatable, vat_rate_pct, is_active, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                """,
                [
                    int(supplier_id),
                    str(body.get("cost_type") or "").strip() or None,
                    item_name,
                    str(body.get("description") or "").strip() or None,
                    str(body.get("uom") or "").strip() or None,
                    float(body.get("agreed_rate") or 0),
                    bool(body.get("is_vatable") if "is_vatable" in body else False),
                    float(body.get("vat_rate_pct") or 0),
                    bool(body.get("is_active") if "is_active" in body else True),
                ],
            )
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create supplier item: {e}")


@router.put("/supplier-items/{supplier_item_id}")
def update_supplier_item(supplier_item_id: int, body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        item_name = str(body.get("item_name") or "").strip()
        if not item_name:
            raise HTTPException(status_code=400, detail="item_name is required")
        with get_conn() as con:
            _ensure_supplier_tables(con)
            exists = con.execute("SELECT supplier_item_id FROM supplier_service_items WHERE supplier_item_id = %s", [int(supplier_item_id)]).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="Supplier item not found")
            con.execute(
                """
                UPDATE supplier_service_items
                SET cost_type = %s,
                    item_name = %s,
                    description = %s,
                    uom = %s,
                    agreed_rate = %s,
                    is_vatable = %s,
                    vat_rate_pct = %s,
                    is_active = %s,
                    updated_at = NOW()
                WHERE supplier_item_id = %s
                """,
                [
                    str(body.get("cost_type") or "").strip() or None,
                    item_name,
                    str(body.get("description") or "").strip() or None,
                    str(body.get("uom") or "").strip() or None,
                    float(body.get("agreed_rate") or 0),
                    bool(body.get("is_vatable") if "is_vatable" in body else False),
                    float(body.get("vat_rate_pct") or 0),
                    bool(body.get("is_active") if "is_active" in body else True),
                    int(supplier_item_id),
                ],
            )
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update supplier item: {e}")


@router.patch("/supplier-items/{supplier_item_id}")
def patch_supplier_item(supplier_item_id: int, body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        with get_conn() as con:
            _ensure_supplier_tables(con)
            exists = con.execute("SELECT supplier_item_id FROM supplier_service_items WHERE supplier_item_id = %s", [int(supplier_item_id)]).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="Supplier item not found")
            updates = []
            params = []
            if "is_active" in body:
                updates.append("is_active = %s")
                params.append(bool(body.get("is_active")))
            if "agreed_rate" in body:
                updates.append("agreed_rate = %s")
                params.append(float(body.get("agreed_rate") or 0))
            if "uom" in body:
                updates.append("uom = %s")
                params.append(str(body.get("uom") or "").strip() or None)
            if not updates:
                return {"ok": True}
            updates.append("updated_at = NOW()")
            params.append(int(supplier_item_id))
            con.execute(f"UPDATE supplier_service_items SET {', '.join(updates)} WHERE supplier_item_id = %s", params)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to patch supplier item: {e}")


# =========================
# ARCHIVED CLIENTS
# =========================

def _archive_retention_days(con) -> int:
    try:
        row = con.execute(
            "SELECT setting_value FROM system_settings WHERE setting_key = %s LIMIT 1",
            ["archive_retention_days"],
        ).fetchone()
        raw = str(row[0] if row else "").strip()
        if raw:
            value = int(raw)
            if value > 0:
                return min(value, 3650)
    except Exception:
        pass
    return 365


def _archive_cutoff(retention_days: int) -> datetime:
    safe_days = max(1, min(int(retention_days or 0), 3650))
    return datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=safe_days)


