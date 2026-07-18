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
from api.admin_routes import _ensure_lookup_table, _ensure_lookup_table_once
from api.admin_user_helpers import _ensure_positions_lookup_table
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
_JOB_FILE_TYPE_CORE_KEYS = {"client_provided", "generated_report"}
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



@router.get("/lookups/{table_name}")
def list_lookup_items(
    table_name: str,
    include_archived: bool = Query(False),
    _user: dict = Depends(_current_user),
):
    """List items from a lookup table."""
    # Whitelist allowed tables for security
    allowed_tables = [
        "job_types", "job_statuses_lookup", "vat_rates_lookup",
        "payment_terms_lookup", "time_subjects", "portfolios_lookup",
        "industries_lookup", "currency_lookup", "positions_lookup",
        "processes_lookup", "job_item_categories_lookup", "uom_lookup",
        "bd_bin_reasons_lookup", "job_file_types_lookup", "action_categories_lookup",
        "governance_subjects_lookup", "lca_material_categories_lookup",
    ]
    
    if table_name not in allowed_tables:
        raise HTTPException(status_code=400, detail="Invalid table name")
    org_id = require_org(_user) if table_name in _ORG_SCOPED_LOOKUP_TABLES else None
    org_match = str(org_id or "").strip()
    
    # Get the actual table name to query - handle the currency_lookup alias
    table_map = {
        "currency_lookup": "currency_lookup"
    }
    query_table = table_map.get(table_name, table_name)
    
    def _lookup_has_active_flag(con, name: str) -> bool:
        try:
            row = con.execute(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = %s
                  AND column_name = 'is_active'
                LIMIT 1
                """,
                [name],
            ).fetchone()
            return bool(row)
        except Exception:
            return False

    def _fetch_data():
        with get_conn() as con:
            _ensure_lookup_table_once(con, table_name, org_id)
            if table_name == "positions_lookup":
                _ensure_positions_lookup_table(con)
            has_active_flag = _lookup_has_active_flag(con, query_table)
            active_filter = ""
            if has_active_flag and not include_archived:
                active_filter = "WHERE COALESCE(is_active, TRUE) = TRUE"
            if org_id is not None:
                if table_name == "portfolios_lookup":
                    # Portfolios are global — return all active regardless of org
                    active_params = []
                else:
                    active_filter = (
                        f"{active_filter} AND COALESCE(org_id, '') = %s"
                        if active_filter
                        else "WHERE COALESCE(org_id, '') = %s"
                    )
                    active_params = [org_match]
            else:
                active_params = []
            # Different tables might have different sort columns
            if table_name == "job_statuses_lookup":
                df = con.execute(f"SELECT * FROM {query_table} {active_filter} ORDER BY sort_order, name", active_params).df()
            elif table_name == "currency_lookup":
                # Query with explicit column names - avoid using 'name' column since it doesn't exist
                df = con.execute(
                    f"""
                    SELECT currency_id, currency_code, currency_name, symbol, exchange_rate, is_default, is_active, sort_order
                    FROM {query_table}
                    {active_filter}
                    ORDER BY sort_order, currency_code
                    """
                , active_params).df()
            elif table_name in ("job_item_categories_lookup", "uom_lookup", "bd_bin_reasons_lookup"):
                df = con.execute(f"SELECT * FROM {query_table} {active_filter} ORDER BY sort_order, name", active_params).df()
            elif table_name == "job_file_types_lookup":
                df = con.execute(
                    f"""
                    SELECT file_type_id, file_type_key, display_name, storage_folder_key, sort_order, is_active
                    FROM {query_table}
                    {active_filter}
                    ORDER BY sort_order, display_name
                    """,
                    active_params,
                ).df()
            else:
                # Try to order by name, fallback to no ordering if column doesn't exist
                try:
                    df = con.execute(f"SELECT * FROM {query_table} {active_filter} ORDER BY name", active_params).df()
                except Exception:
                    df = con.execute(f"SELECT * FROM {query_table} {active_filter}", active_params).df()
            
            items = []
            if df is not None and not df.empty:
                # Replace NaN with None for proper JSON serialization
                import numpy as np
                df = df.replace({np.nan: None})
                items = df.to_dict(orient="records")
            
            return {"items": items}
    
    try:
        return _fetch_data()
    except Exception as e:
        error_msg = str(e)
        # If transaction aborted error, try once more with fresh connection
        if "transaction is aborted" in error_msg.lower() or "current transaction is aborted" in error_msg.lower():
            try:
                return _fetch_data()
            except Exception as e2:
                raise HTTPException(status_code=500, detail=f"Failed to list {table_name}: {e2}")
        raise HTTPException(status_code=500, detail=f"Failed to list {table_name}: {e}")


@router.delete("/lookups/{table_name}/{item_id}")
def permanently_delete_lookup_item(
    table_name: str,
    item_id: int,
    _user: dict = Depends(_current_user),
):
    """Permanently delete an archived lookup item."""
    allowed_tables = [
        "job_types", "job_statuses_lookup", "vat_rates_lookup",
        "payment_terms_lookup", "time_subjects", "portfolios_lookup",
        "industries_lookup", "currency_lookup", "positions_lookup",
        "processes_lookup", "job_item_categories_lookup", "uom_lookup",
        "bd_bin_reasons_lookup", "job_file_types_lookup", "action_categories_lookup",
        "governance_subjects_lookup", "lca_material_categories_lookup",
    ]

    if table_name not in allowed_tables:
        raise HTTPException(status_code=400, detail="Invalid table name")

    id_col_map = {
        "job_types": "job_type_id",
        "job_statuses_lookup": "status_id",
        "vat_rates_lookup": "vat_rate_id",
        "payment_terms_lookup": "term_id",
        "time_subjects": "subject_id",
        "portfolios_lookup": "portfolio_id",
        "industries_lookup": "industry_id",
        "currency_lookup": "currency_id",
        "positions_lookup": "position_id",
        "processes_lookup": "process_id",
        "job_item_categories_lookup": "category_id",
        "uom_lookup": "uom_id",
        "bd_bin_reasons_lookup": "bin_reason_id",
        "job_file_types_lookup": "file_type_id",
        "action_categories_lookup": "category_id",
        "governance_subjects_lookup": "governance_subject_id",
        "lca_material_categories_lookup": "category_id",
    }
    id_col = id_col_map.get(table_name)
    if not id_col:
        raise HTTPException(status_code=400, detail="Unknown table")

    try:
        with get_conn() as con:
            org_id = require_org(_user) if table_name in _ORG_SCOPED_LOOKUP_TABLES else None
            _ensure_lookup_table(con, table_name, org_id)
            if table_name == "job_file_types_lookup":
                key_row = con.execute(
                    "SELECT file_type_key FROM job_file_types_lookup WHERE file_type_id = %s",
                    [int(item_id)],
                ).fetchone()
                if key_row and str(key_row[0] or "").strip().lower() in _JOB_FILE_TYPE_CORE_KEYS:
                    raise HTTPException(status_code=400, detail="System job file types cannot be deleted")
            where_clause = f"WHERE {id_col} = %s"
            params = [int(item_id)]
            if org_id is not None:
                where_clause += " AND org_id = %s"
                params.append(org_id)
            row = con.execute(
                f"SELECT is_active FROM {table_name} {where_clause}",
                params,
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Lookup item not found")
            is_active = bool(row[0]) if row[0] is not None else True
            if is_active:
                raise HTTPException(status_code=400, detail="Item must be archived before permanent deletion")
            con.execute(
                f"DELETE FROM {table_name} {where_clause}",
                params,
            )
        return {"ok": True, "message": "Lookup item permanently deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete lookup item: {e}")


@router.post("/lookups/{table_name}")
def create_lookup_item(
    table_name: str,
    body: dict = Body(...),
    _user: dict = Depends(_current_user)
):
    """Create a new lookup item."""
    allowed_tables = [
        "job_types", "job_statuses_lookup", "vat_rates_lookup",
        "payment_terms_lookup", "time_subjects", "portfolios_lookup",
        "industries_lookup", "currency_lookup", "positions_lookup",
        "processes_lookup", "job_item_categories_lookup", "uom_lookup",
        "bd_bin_reasons_lookup", "job_file_types_lookup", "action_categories_lookup",
        "governance_subjects_lookup", "lca_material_categories_lookup",
    ]
    
    if table_name not in allowed_tables:
        raise HTTPException(status_code=400, detail="Invalid table name")
    
    try:
        with get_conn() as con:
            org_id = require_org(_user) if table_name in _ORG_SCOPED_LOOKUP_TABLES else None
            _ensure_lookup_table(con, table_name, org_id)
            org_match = str(org_id or "").strip()
            # This is simplified - you'd need table-specific logic for different schemas
            if table_name == "vat_rates_lookup":
                name = str(body.get("name", "")).strip()
                if not name:
                    raise HTTPException(status_code=400, detail="Name is required")
                rate_pct = float(body.get("rate_pct", 0) or 0)
                if rate_pct < 0:
                    raise HTTPException(status_code=400, detail="VAT rate % cannot be negative")
                con.execute(
                    """
                    INSERT INTO vat_rates_lookup (name, rate_pct, is_default, is_active)
                    VALUES (%s, %s, %s, %s)
                    """,
                    [name, rate_pct, body.get("is_default", False), body.get("is_active", True)],
                )
            elif table_name == "payment_terms_lookup":
                name = str(body.get("name", "")).strip()
                if not name:
                    raise HTTPException(status_code=400, detail="Name is required")
                next_term_id = con.execute(
                    "SELECT COALESCE(MAX(term_id), 0) + 1 FROM payment_terms_lookup"
                ).fetchone()[0]
                con.execute(
                    """
                    INSERT INTO payment_terms_lookup (term_id, name, is_active)
                    VALUES (%s, %s, %s)
                    """,
                    [next_term_id, name, body.get("is_active", True)],
                )
            elif table_name == "industries_lookup":
                name = str(body.get("name", "")).strip()
                if not name:
                    raise HTTPException(status_code=400, detail="Name is required")
                next_industry_id = con.execute(
                    "SELECT COALESCE(MAX(industry_id), 0) + 1 FROM industries_lookup"
                ).fetchone()[0]
                con.execute(
                    """
                    INSERT INTO industries_lookup (industry_id, name, is_active)
                    VALUES (%s, %s, %s)
                    """,
                    [next_industry_id, name, body.get("is_active", True)],
                )
            elif table_name == "currency_lookup":
                currency_name = str(body.get("currency_name", "")).strip()
                symbol = str(body.get("symbol", "")).strip()
                if not currency_name:
                    raise HTTPException(status_code=400, detail="Currency label is required")
                if not symbol:
                    raise HTTPException(status_code=400, detail="Currency symbol is required")
                currency_code = str(body.get("currency_code", "")).strip().upper()
                if not currency_code:
                    generated = "".join(ch for ch in currency_name.upper() if ch.isalpha())
                    currency_code = (generated[:3] or "CUR")
                con.execute(
                    """
                    INSERT INTO currency_lookup (currency_code, currency_name, symbol, exchange_rate, is_default, is_active, sort_order)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    [
                        currency_code,
                        currency_name,
                        symbol,
                        body.get("exchange_rate", 1.0),
                        body.get("is_default", False),
                        body.get("is_active", True),
                        body.get("sort_order", 0)
                    ],
                )
            elif table_name == "job_file_types_lookup":
                file_type_key = str(body.get("file_type_key", "")).strip()
                display_name = str(body.get("display_name", "")).strip()
                storage_folder_key = str(body.get("storage_folder_key", "")).strip() or "client-provided"
                if not file_type_key:
                    raise HTTPException(status_code=400, detail="File type key is required")
                if not display_name:
                    raise HTTPException(status_code=400, detail="Display name is required")
                sort_order = int(body.get("sort_order", 0) or 0)
                con.execute(
                    """
                    INSERT INTO job_file_types_lookup (file_type_key, display_name, storage_folder_key, sort_order, is_active)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    [
                        file_type_key,
                        display_name,
                        storage_folder_key,
                        sort_order,
                        body.get("is_active", True),
                    ],
                )
            elif table_name == "job_types":
                name = str(body.get("name", "")).strip()
                if not name:
                    raise HTTPException(status_code=400, detail="Name is required")
                job_group = str(body.get("job_group") or body.get("job_family") or "crp").strip().lower()
                if job_group not in {"crp", "training", "consultancy", "lca", "pcf"}:
                    raise HTTPException(status_code=400, detail="job_group must be one of crp, training, consultancy, lca, or pcf")
                con.execute(
                    """
                    INSERT INTO job_types (org_id, name, description, unit_price_ex_vat, estimated_hours, is_crp, is_active, job_family, job_group)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    [
                        org_id,
                        name,
                        str(body.get("description", "")).strip(),
                        float(body.get("unit_price_ex_vat", 0) or 0),
                        float(body.get("estimated_hours", 0) or 0),
                        bool(body.get("is_crp", job_group == "crp")),
                        body.get("is_active", True),
                        job_group,
                        job_group,
                    ],
                )
            elif table_name in _ORG_SCOPED_LOOKUP_TABLES:
                name = str(body.get("name", "")).strip()
                if not name:
                    raise HTTPException(status_code=400, detail="Name is required")

                if table_name == "portfolios_lookup":
                    # Portfolios are global — check by name only, insert with org_id=NULL
                    portfolio_owner_client_db_id = body.get("portfolio_owner_client_db_id")
                    portfolio_owner_client_db_id = (
                        int(portfolio_owner_client_db_id)
                        if portfolio_owner_client_db_id not in (None, "", "null")
                        else None
                    )
                    existing = con.execute(
                        "SELECT 1 FROM portfolios_lookup WHERE lower(name) = lower(%s) LIMIT 1",
                        [name],
                    ).fetchone()
                    if existing:
                        raise HTTPException(status_code=409, detail=f"Portfolio '{name}' already exists")
                    con.execute(
                        "INSERT INTO portfolios_lookup (org_id, name, portfolio_owner_client_db_id, is_active) VALUES (NULL, %s, %s, %s)",
                        [name, portfolio_owner_client_db_id, body.get("is_active", True)],
                    )
                    if portfolio_owner_client_db_id is not None:
                        con.execute(
                            "UPDATE clients SET status = %s WHERE db_id = %s AND COALESCE(org_id, '') = %s",
                            ["Portfolio Owner", portfolio_owner_client_db_id, org_match],
                        )
                else:
                    existing = con.execute(
                        f"""
                        SELECT 1
                        FROM {table_name}
                        WHERE lower(name) = lower(%s)
                          AND COALESCE(org_id, '') = %s
                        LIMIT 1
                        """,
                        [name, org_match],
                    ).fetchone()
                    if existing:
                        raise HTTPException(
                            status_code=409,
                            detail=f"{table_name.replace('_', ' ').title()} '{name}' already exists",
                        )
                    columns = ["org_id", "name", "is_active"]
                    values = [org_id if org_match else None, name, body.get("is_active", True)]
                    if table_name == "time_subjects":
                        columns.append("budget_hours")
                        values.append(float(body.get("budget_hours", 0) or 0))
                    con.execute(
                        f"INSERT INTO {table_name} ({', '.join(columns)}) VALUES ({', '.join(['%s'] * len(values))})",
                        values,
                    )
            else:
                name = str(body.get("name", "")).strip()
                if not name:
                    raise HTTPException(status_code=400, detail="Name is required")
                # Generic insert for simple lookup tables
                con.execute(
                    f"INSERT INTO {table_name} (name, is_active) VALUES (%s, %s)",
                    [name, body.get("is_active", True)],
                )
        
        return {"ok": True, "message": "Item created successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create item: {e}")


@router.patch("/lookups/{table_name}/{item_id}")
def update_lookup_item(
    table_name: str,
    item_id: int,
    body: dict = Body(...),
    _user: dict = Depends(_current_user)
):
    """Update a lookup item (typically to archive/deactivate it)."""
    allowed_tables = [
        "job_types", "job_statuses_lookup", "vat_rates_lookup",
        "payment_terms_lookup", "time_subjects", "portfolios_lookup",
        "industries_lookup", "currency_lookup", "positions_lookup",
        "processes_lookup", "job_item_categories_lookup", "uom_lookup",
        "bd_bin_reasons_lookup", "job_file_types_lookup", "action_categories_lookup",
        "governance_subjects_lookup", "lca_material_categories_lookup",
    ]
    
    if table_name not in allowed_tables:
        raise HTTPException(status_code=400, detail="Invalid table name")
    
    # Map table names to their ID columns
    id_col_map = {
        "job_types": "job_type_id",
        "job_statuses_lookup": "status_id",
        "vat_rates_lookup": "vat_rate_id",
        "payment_terms_lookup": "term_id",
        "time_subjects": "subject_id",
        "portfolios_lookup": "portfolio_id",
        "industries_lookup": "industry_id",
        "currency_lookup": "currency_id",
        "positions_lookup": "position_id",
        "processes_lookup": "process_id",
        "job_item_categories_lookup": "category_id",
        "uom_lookup": "uom_id",
        "bd_bin_reasons_lookup": "bin_reason_id",
        "job_file_types_lookup": "file_type_id",
        "action_categories_lookup": "category_id",
        "governance_subjects_lookup": "governance_subject_id",
        "lca_material_categories_lookup": "category_id",
    }

    id_col = id_col_map.get(table_name)
    if not id_col:
        raise HTTPException(status_code=400, detail="Unknown table")
    
    try:
        with get_conn() as con:
            org_id = require_org(_user) if table_name in _ORG_SCOPED_LOOKUP_TABLES else None
            _ensure_lookup_table(con, table_name, org_id)
            org_match = str(org_id or "").strip()
            current_row = None
            if table_name == "job_file_types_lookup":
                current_row = con.execute(
                    """
                    SELECT file_type_key, display_name, storage_folder_key, sort_order, is_active
                    FROM job_file_types_lookup
                    WHERE file_type_id = %s
                    """,
                    [int(item_id)],
                ).fetchone()
                if not current_row:
                    raise HTTPException(status_code=404, detail="Lookup item not found")
                current_key = str(current_row[0] or "").strip().lower()
                if "file_type_key" in body:
                    new_key = str(body["file_type_key"]).strip().lower()
                    if new_key != current_key:
                        raise HTTPException(status_code=400, detail="File type key cannot be changed after creation")
                if body.get("is_active") is False and current_key in _JOB_FILE_TYPE_CORE_KEYS:
                    raise HTTPException(status_code=400, detail="System job file types cannot be archived")
            # Build update query
            updates = []
            params = []
            
            if "is_active" in body:
                updates.append("is_active = %s")
                params.append(body["is_active"])
            
            if "name" in body:
                updates.append("name = %s")
                params.append(body["name"])

            if table_name == "vat_rates_lookup" and "rate_pct" in body:
                rate_pct = float(body["rate_pct"] or 0)
                if rate_pct < 0:
                    raise HTTPException(status_code=400, detail="VAT rate % cannot be negative")
                updates.append("rate_pct = %s")
                params.append(rate_pct)
            
            if table_name == "currency_lookup":
                if "currency_name" in body:
                    updates.append("currency_name = %s")
                    params.append(str(body["currency_name"]).strip())
                if "symbol" in body:
                    updates.append("symbol = %s")
                    params.append(str(body["symbol"]).strip())
                if "currency_code" in body:
                    updates.append("currency_code = %s")
                    params.append(str(body["currency_code"]).strip().upper())
                if "exchange_rate" in body:
                    updates.append("exchange_rate = %s")
                    params.append(float(body["exchange_rate"] or 1.0))

            if table_name == "job_file_types_lookup":
                if "display_name" in body:
                    updates.append("display_name = %s")
                    params.append(str(body["display_name"]).strip())
                if "storage_folder_key" in body:
                    updates.append("storage_folder_key = %s")
                    params.append(str(body["storage_folder_key"]).strip() or "client-provided")
                if "sort_order" in body:
                    updates.append("sort_order = %s")
                    params.append(int(body["sort_order"] or 0))
            
            # Allow updating estimated_hours for job_types
            if table_name == "job_types" and "estimated_hours" in body:
                updates.append("estimated_hours = %s")
                params.append(float(body["estimated_hours"]))
            if table_name == "job_types" and ("job_group" in body or "job_family" in body):
                job_group = str(body.get("job_group", body.get("job_family", "")) or "").strip().lower()
                if job_group and job_group not in {"crp", "training", "consultancy", "lca", "pcf"}:
                    raise HTTPException(status_code=400, detail="job_group must be one of crp, training, consultancy, lca, or pcf")
                updates.append("job_group = %s")
                params.append(job_group or None)
                updates.append("job_family = %s")
                params.append(job_group or None)
            if table_name == "portfolios_lookup" and "portfolio_owner_client_db_id" in body:
                owner_id = body.get("portfolio_owner_client_db_id")
                owner_id = (
                    int(owner_id)
                    if owner_id not in (None, "", "null")
                    else None
                )
                updates.append("portfolio_owner_client_db_id = %s")
                params.append(owner_id)
                if owner_id is not None:
                    con.execute(
                        "UPDATE clients SET status = %s WHERE db_id = %s AND COALESCE(org_id, '') = %s",
                        ["Portfolio Owner", owner_id, org_match],
                    )

            if not updates:
                return {"ok": True, "message": "No fields to update"}
            
            params.append(int(item_id))
            if org_id is not None and table_name not in ("portfolios_lookup", "job_types"):
                params.append(org_match)
                query = f"UPDATE {table_name} SET {', '.join(updates)} WHERE {id_col} = %s AND COALESCE(org_id, '') = %s"
            else:
                query = f"UPDATE {table_name} SET {', '.join(updates)} WHERE {id_col} = %s"
            
            con.execute(query, params)
        
        return {"ok": True, "message": "Item updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update item: {e}")


# =========================
# PORTFOLIO OWNER WORKFLOW
# =========================
# Membership is derived from portfolios_lookup (the source of truth for which
# client owns which portfolio) joined against clients.portfolio -- see
# services.portfolio._resolve_owner_portfolio_name for the matching logic
# shared with the client-portal/admin dashboards.

@router.get("/portfolios")
def list_portfolios(_user: dict = Depends(_current_user)):
    """Every portfolio with its owner and live member count, plus any
    'Portfolio Owner' clients that were promoted by hand and never linked to
    a portfolio (so the admin UI can flag them instead of silently ignoring)."""
    with get_conn() as con:
        rows = con.execute(
            """
            SELECT pl.portfolio_id, pl.name, pl.is_active,
                   c.db_id, c.client_name, c.status,
                   (
                     SELECT COUNT(*) FROM clients m
                     WHERE lower(m.portfolio) = lower(pl.name)
                       AND m.db_id <> COALESCE(c.db_id, -1)
                       AND lower(COALESCE(m.status, '')) <> 'archived'
                   )
            FROM portfolios_lookup pl
            LEFT JOIN clients c ON c.db_id = pl.portfolio_owner_client_db_id
            ORDER BY pl.name ASC
            """
        ).fetchall()
        portfolios = [
            {
                "portfolio_id": int(r[0]),
                "name": r[1],
                "is_active": bool(r[2]) if r[2] is not None else True,
                "owner": (
                    {"client_db_id": int(r[3]), "client_name": r[4], "status": r[5]}
                    if r[3] is not None else None
                ),
                "member_count": int(r[6] or 0),
            }
            for r in rows or []
        ]

        unlinked_rows = con.execute(
            """
            SELECT db_id, client_name
            FROM clients
            WHERE lower(COALESCE(status, '')) = 'portfolio owner'
              AND db_id NOT IN (
                SELECT portfolio_owner_client_db_id FROM portfolios_lookup
                WHERE portfolio_owner_client_db_id IS NOT NULL
              )
            ORDER BY client_name ASC
            """
        ).fetchall()
        unlinked_owners = [{"client_db_id": int(r[0]), "client_name": r[1]} for r in unlinked_rows or []]

    return {"ok": True, "portfolios": portfolios, "unlinked_owners": unlinked_owners}


def _resolve_portfolio(con, portfolio_id: int) -> tuple[str, dict | None]:
    row = con.execute(
        """
        SELECT pl.name, c.db_id, c.client_name, c.status
        FROM portfolios_lookup pl
        LEFT JOIN clients c ON c.db_id = pl.portfolio_owner_client_db_id
        WHERE pl.portfolio_id = %s
        """,
        [int(portfolio_id)],
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    owner = {"client_db_id": int(row[1]), "client_name": row[2], "status": row[3]} if row[1] is not None else None
    return row[0], owner


@router.get("/portfolios/{portfolio_id}/members")
def get_portfolio_members(portfolio_id: int, _user: dict = Depends(_current_user)):
    with get_conn() as con:
        name, owner = _resolve_portfolio(con, portfolio_id)
        owner_id = owner["client_db_id"] if owner else None
        rows = con.execute(
            """
            SELECT db_id, client_name, status, industry, crm_owner
            FROM clients
            WHERE lower(portfolio) = lower(%s)
              AND db_id <> COALESCE(%s, -1)
              AND lower(COALESCE(status, '')) <> 'archived'
            ORDER BY lower(COALESCE(client_name, '')) ASC
            """,
            [name, owner_id],
        ).fetchall()
        members = [
            {"client_db_id": int(r[0]), "client_name": r[1], "status": r[2], "industry": r[3], "crm_owner": r[4]}
            for r in rows or []
        ]
    return {"ok": True, "portfolio_id": int(portfolio_id), "name": name, "owner": owner, "members": members}


@router.post("/portfolios/{portfolio_id}/members")
def add_portfolio_members(
    portfolio_id: int,
    body: dict = Body(...),
    _user: dict = Depends(_current_user),
):
    client_ids = [int(cid) for cid in (body.get("client_ids") or [])]
    if not client_ids:
        raise HTTPException(status_code=400, detail="client_ids is required")
    with get_conn() as con:
        name, _owner = _resolve_portfolio(con, portfolio_id)
        con.execute(
            "UPDATE clients SET portfolio = %s WHERE db_id = ANY(%s)",
            [name, client_ids],
        )
    return {"ok": True, "portfolio_id": int(portfolio_id), "client_ids": client_ids}


@router.delete("/portfolios/{portfolio_id}/members")
def remove_portfolio_members(
    portfolio_id: int,
    body: dict = Body(...),
    _user: dict = Depends(_current_user),
):
    client_ids = [int(cid) for cid in (body.get("client_ids") or [])]
    if not client_ids:
        raise HTTPException(status_code=400, detail="client_ids is required")
    with get_conn() as con:
        name, _owner = _resolve_portfolio(con, portfolio_id)
        con.execute(
            "UPDATE clients SET portfolio = NULL WHERE db_id = ANY(%s) AND lower(portfolio) = lower(%s)",
            [client_ids, name],
        )
    return {"ok": True, "portfolio_id": int(portfolio_id), "client_ids": client_ids}


# =========================
# SUPPLIERS
# =========================

