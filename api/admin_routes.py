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
from api.org_admin_helpers import (
    _build_org_export_zip,
    _delete_org_data,
    _billing_event_row_to_dict,
    _billing_invoice_row_to_dict,
    _ensure_org_billing_schema,
    _ensure_org_entitlement_schema,
    _ensure_org_lifecycle_schema,
    _membership_for_user,
    _normalize_org_role,
    _org_role_capabilities,
    _org_role_info,
    _org_export_frames,
    _organisation_entitlement_info,
    _organisation_row_to_dict,
    _organisation_usage_info,
    _parse_amount_cents,
    _require_org_active,
    _require_org_capacity,
    _require_org_management_role,
    _require_org_owner_role,
    _require_org_plan_active,
    _require_org_switch_role,
    _table_exists,
    _slugify_org_name,
)
from api.admin_organisations_routes import (
    accept_organisation_invitation,
    archive_organisation,
    create_organisation,
    create_organisation_billing_event,
    create_organisation_billing_invoice,
    invite_user_to_organisation,
    list_organisation_billing,
    list_organisation_members,
    list_organisations,
    switch_active_organisation,
    transfer_organisation_ownership,
    update_organisation_billing_invoice,
    update_organisation_member,
)
from api.admin_archive_routes import (
    delete_current_organisation_data,
    export_current_organisation_data,
)
from api import admin_organisations_routes as _admin_org_routes
from api import admin_archive_routes as _admin_archive_routes
from api import org_admin_helpers as _org_helpers

_BUILD_ORG_EXPORT_ZIP_IMPL = _org_helpers._build_org_export_zip
_DELETE_ORG_DATA_IMPL = _org_helpers._delete_org_data
_REQUIRE_ORG_CAPACITY_IMPL = _org_helpers._require_org_capacity
_REQUIRE_ORG_PLAN_ACTIVE_IMPL = _org_helpers._require_org_plan_active


def _call_org_helper_with_patches(helper, patches: dict[str, object], *args, **kwargs):
    originals = {name: getattr(_org_helpers, name) for name in patches}
    try:
        for name, value in patches.items():
            setattr(_org_helpers, name, value)
        return helper(*args, **kwargs)
    finally:
        for name, value in originals.items():
            setattr(_org_helpers, name, value)


def _sync_org_route_globals() -> None:
    _admin_org_routes.get_conn = get_conn
    _admin_org_routes.record_audit_event = record_audit_event
    _admin_org_routes._ensure_org_lifecycle_schema = _ensure_org_lifecycle_schema
    _admin_org_routes._ensure_org_entitlement_schema = _ensure_org_entitlement_schema
    _admin_org_routes._ensure_org_billing_schema = _ensure_org_billing_schema
    _admin_org_routes._normalize_org_role = _normalize_org_role
    _admin_org_routes._org_role_capabilities = _org_role_capabilities
    _admin_org_routes._org_role_info = _org_role_info
    _admin_org_routes._organisation_entitlement_info = _organisation_entitlement_info
    _admin_org_routes._organisation_usage_info = _organisation_usage_info
    _admin_org_routes._require_org_active = _require_org_active
    _admin_org_routes._require_org_capacity = _require_org_capacity
    _admin_org_routes._require_org_management_role = _require_org_management_role
    _admin_org_routes._require_org_owner_role = _require_org_owner_role
    _admin_org_routes._require_org_plan_active = _require_org_plan_active
    _admin_org_routes._require_org_switch_role = _require_org_switch_role
    _admin_org_routes._organisation_row_to_dict = _organisation_row_to_dict
    _admin_org_routes._org_export_frames = _org_export_frames
    _admin_org_routes._table_exists = _table_exists
    _admin_org_routes._billing_invoice_row_to_dict = _billing_invoice_row_to_dict
    _admin_org_routes._billing_event_row_to_dict = _billing_event_row_to_dict
    _admin_org_routes._parse_amount_cents = _parse_amount_cents
    _admin_org_routes._slugify_org_name = _slugify_org_name
    _admin_org_routes._membership_for_user = _membership_for_user


def _sync_archive_route_globals() -> None:
    _admin_archive_routes.get_conn = get_conn
    _admin_archive_routes.record_audit_event = record_audit_event
    _admin_archive_routes._ensure_org_lifecycle_schema = _ensure_org_lifecycle_schema
    _admin_archive_routes._ensure_org_entitlement_schema = _ensure_org_entitlement_schema
    _admin_archive_routes._require_org_management_role = _require_org_management_role
    _admin_archive_routes._require_org_owner_role = _require_org_owner_role
    _admin_archive_routes._build_org_export_zip = _build_org_export_zip
    _admin_archive_routes._delete_org_data = _delete_org_data


def _build_org_export_zip(*args, **kwargs):
    _sync_org_route_globals()
    return _call_org_helper_with_patches(
        _BUILD_ORG_EXPORT_ZIP_IMPL,
        {
            "_organisation_entitlement_info": _organisation_entitlement_info,
            "_org_export_frames": _org_export_frames,
            "_slugify_org_name": _slugify_org_name,
        },
        *args,
        **kwargs,
    )


def _delete_org_data(*args, **kwargs):
    _sync_archive_route_globals()
    return _call_org_helper_with_patches(
        _DELETE_ORG_DATA_IMPL,
        {
            "_table_exists": _table_exists,
        },
        *args,
        **kwargs,
    )


def _require_org_capacity(*args, **kwargs):
    _sync_org_route_globals()
    return _call_org_helper_with_patches(
        _REQUIRE_ORG_CAPACITY_IMPL,
        {
            "_organisation_usage_info": _organisation_usage_info,
        },
        *args,
        **kwargs,
    )


def _require_org_plan_active(*args, **kwargs):
    _sync_org_route_globals()
    return _call_org_helper_with_patches(
        _REQUIRE_ORG_PLAN_ACTIVE_IMPL,
        {
            "_organisation_usage_info": _organisation_usage_info,
        },
        *args,
        **kwargs,
    )


def create_organisation(*args, **kwargs):
    _sync_org_route_globals()
    return _admin_org_routes.create_organisation(*args, **kwargs)


def invite_user_to_organisation(*args, **kwargs):
    _sync_org_route_globals()
    return _admin_org_routes.invite_user_to_organisation(*args, **kwargs)


def accept_organisation_invitation(*args, **kwargs):
    _sync_org_route_globals()
    return _admin_org_routes.accept_organisation_invitation(*args, **kwargs)


def switch_active_organisation(*args, **kwargs):
    _sync_org_route_globals()
    return _admin_org_routes.switch_active_organisation(*args, **kwargs)


def list_organisations(*args, **kwargs):
    _sync_org_route_globals()
    return _admin_org_routes.list_organisations(*args, **kwargs)


def list_organisation_members(*args, **kwargs):
    _sync_org_route_globals()
    return _admin_org_routes.list_organisation_members(*args, **kwargs)


def update_organisation_member(*args, **kwargs):
    _sync_org_route_globals()
    return _admin_org_routes.update_organisation_member(*args, **kwargs)


def update_organisation(*args, **kwargs):
    _sync_org_route_globals()
    return _admin_org_routes.update_organisation(*args, **kwargs)


def transfer_organisation_ownership(*args, **kwargs):
    _sync_org_route_globals()
    return _admin_org_routes.transfer_organisation_ownership(*args, **kwargs)


def archive_organisation(*args, **kwargs):
    _sync_org_route_globals()
    return _admin_org_routes.archive_organisation(*args, **kwargs)


def list_organisation_billing(*args, **kwargs):
    _sync_org_route_globals()
    return _admin_org_routes.list_organisation_billing(*args, **kwargs)


def create_organisation_billing_invoice(*args, **kwargs):
    _sync_org_route_globals()
    return _admin_org_routes.create_organisation_billing_invoice(*args, **kwargs)


def update_organisation_billing_invoice(*args, **kwargs):
    _sync_org_route_globals()
    return _admin_org_routes.update_organisation_billing_invoice(*args, **kwargs)


def create_organisation_billing_event(*args, **kwargs):
    _sync_org_route_globals()
    return _admin_org_routes.create_organisation_billing_event(*args, **kwargs)


def export_current_organisation_data(*args, **kwargs):
    _sync_archive_route_globals()
    return _admin_archive_routes.export_current_organisation_data(*args, **kwargs)


def delete_current_organisation_data(*args, **kwargs):
    _sync_archive_route_globals()
    return _admin_archive_routes.delete_current_organisation_data(*args, **kwargs)
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

def _ensure_legacy_cleanup_schema(con) -> None:
    """Keep legacy cleanup resilient on older production schemas."""
    statements = [
        "ALTER TABLE job_scope_rows ADD COLUMN IF NOT EXISTS site_id INTEGER",
        "ALTER TABLE job_scope_rows ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT TRUE",
        "ALTER TABLE job_scope_rows ADD COLUMN IF NOT EXISTS data_source VARCHAR DEFAULT 'Company Data'",
        "ALTER TABLE job_scope_rows ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()",
    ]
    for ddl in statements:
        try:
            con.execute(ddl)
        except Exception as exc:
            logger.warning("Ignoring legacy cleanup schema step %r: %s", ddl, exc)

MISSING_DATA_MONTH_OPTIONS = [
    {"value": "January", "label": "January"},
    {"value": "February", "label": "February"},
    {"value": "March", "label": "March"},
    {"value": "April", "label": "April"},
    {"value": "May", "label": "May"},
    {"value": "June", "label": "June"},
    {"value": "July", "label": "July"},
    {"value": "August", "label": "August"},
    {"value": "September", "label": "September"},
    {"value": "October", "label": "October"},
    {"value": "November", "label": "November"},
    {"value": "December", "label": "December"},
]

MISSING_DATA_FIELDS: dict[str, dict[str, dict[str, object]]] = {
    "client": {
        "client_name": {"label": "Client Name", "column": "client_name", "type": "text"},
        "industry": {
            "label": "Industry",
            "column": "industry",
            "type": "select",
            "options_source": "industries_lookup",
        },
        "description_long": {"label": "Description", "column": "description_long", "type": "textarea"},
        "website": {"label": "Website", "column": "website", "type": "text"},
        "year_end_month": {
            "label": "Financial Year End Month",
            "column": "year_end_month",
            "type": "select",
            "options_source": "months",
        },
        "company_reg": {"label": "Company Registration", "column": "company_reg", "type": "text"},
        "sic_code": {"label": "SIC Code", "column": "sic_code", "type": "text"},
        "headquarters": {"label": "Headquarters", "column": "headquarters", "type": "text"},
        "addr_line1": {"label": "Address Line 1", "column": "addr_line1", "type": "text"},
        "addr_line2": {"label": "Address Line 2", "column": "addr_line2", "type": "text"},
        "addr_city": {"label": "City", "column": "addr_city", "type": "text"},
        "addr_region": {"label": "Region", "column": "addr_region", "type": "text"},
        "addr_postcode": {"label": "Postcode", "column": "addr_postcode", "type": "text"},
        "addr_country": {"label": "Country", "column": "addr_country", "type": "text"},
        "crm_owner": {
            "label": "CRM Owner",
            "column": "crm_owner",
            "type": "select",
            "options_source": "users",
        },
        "portfolio": {
            "label": "Portfolio",
            "column": "portfolio",
            "type": "select",
            "options_source": "portfolios_lookup",
        },
        "currency": {
            "label": "Currency",
            "column": "currency",
            "type": "select",
            "options_source": "currency_lookup",
        },
        "benchmark_year": {"label": "Benchmark Year", "column": "benchmark_year", "type": "integer"},
        "benchmark_period_start": {"label": "Benchmark Period Start", "column": "benchmark_period_start", "type": "date"},
        "benchmark_period_end": {"label": "Benchmark Period End", "column": "benchmark_period_end", "type": "date"},
        "net_zero_year": {"label": "Net Zero Year", "column": "net_zero_year", "type": "integer"},
        "target_s1_year": {"label": "Scope 1 Target Year", "column": "target_s1_year", "type": "integer"},
        "target_s1_pct": {"label": "Scope 1 Target %", "column": "target_s1_pct", "type": "integer"},
        "target_s2_year": {"label": "Scope 2 Target Year", "column": "target_s2_year", "type": "integer"},
        "target_s2_pct": {"label": "Scope 2 Target %", "column": "target_s2_pct", "type": "integer"},
        "target_s3_year": {"label": "Scope 3 Target Year", "column": "target_s3_year", "type": "integer"},
        "target_s3_pct": {"label": "Scope 3 Target %", "column": "target_s3_pct", "type": "integer"},
    },
    "job": {
        "title": {"label": "Job Title", "column": "title", "type": "text"},
        "status": {
            "label": "Job Status",
            "column": "status",
            "type": "select",
            "options_source": "job_statuses_lookup",
        },
        "crm_name": {
            "label": "CRM Name",
            "column": "crm_name",
            "type": "select",
            "options_source": "users",
        },
        "reporting_year": {"label": "Reporting Year", "column": "reporting_year", "type": "integer"},
        "reporting_period_start": {"label": "Reporting Period Start", "column": "reporting_period_start", "type": "date"},
        "reporting_period_end": {"label": "Reporting Period End", "column": "reporting_period_end", "type": "date"},
        "start_date": {"label": "Job Start Date", "column": "start_date", "type": "date"},
        "due_date": {"label": "Job End Date", "column": "due_date", "type": "date"},
        "legacy_job_no": {"label": "Legacy Job No", "column": "legacy_job_no", "type": "text"},
    },
}

def _missing_data_table_options(con, table_name: str) -> list[dict[str, str]]:
    try:
        rows = con.execute(
            f"""
            SELECT name
            FROM {table_name}
            WHERE COALESCE(is_active, TRUE) = TRUE
            ORDER BY name
            """
        ).fetchall()
    except Exception as exc:
        logger.warning("Unable to load missing-data options from %s: %s", table_name, exc)
        return []
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in rows:
        value = str(row[0] or "").strip()
        lowered = value.lower()
        if not value or lowered in seen:
            continue
        seen.add(lowered)
        out.append({"value": value, "label": value})
    return out

def _missing_data_user_options(con) -> list[dict[str, str]]:
    try:
        rows = con.execute(
            """
            SELECT COALESCE(NULLIF(TRIM(full_name), ''), email) AS label
            FROM users
            WHERE COALESCE(status, 'Active') = 'Active'
            ORDER BY COALESCE(NULLIF(TRIM(full_name), ''), email)
            """
        ).fetchall()
    except Exception as exc:
        logger.warning("Unable to load missing-data user options: %s", exc)
        return []
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in rows:
        value = str(row[0] or "").strip()
        lowered = value.lower()
        if not value or lowered in seen:
            continue
        seen.add(lowered)
        out.append({"value": value, "label": value})
    return out

def _missing_data_field_options(con, entity: str, field_name: str, meta: dict[str, object]) -> list[dict[str, str]]:
    source = str(meta.get("options_source") or "").strip()
    if not source:
        return []
    if source == "months":
        return list(MISSING_DATA_MONTH_OPTIONS)
    if source == "users":
        return _missing_data_user_options(con)
    if source == "currency_lookup":
        try:
            rows = con.execute(
                """
                SELECT currency_code, currency_name
                FROM currency_lookup
                WHERE COALESCE(is_active, TRUE) = TRUE
                ORDER BY currency_code
                """
            ).fetchall()
            return [
                {
                    "value": str(row[0]),
                    "label": f"{row[0]} - {row[1]}" if str(row[1] or "").strip() else str(row[0]),
                }
                for row in rows
                if str(row[0] or "").strip()
            ]
        except Exception:
            logger.warning("Unable to load currency lookup options for missing-data fields", exc_info=True)
            return []
    if source in {"industries_lookup", "portfolios_lookup", "job_statuses_lookup"}:
        options = _missing_data_table_options(con, source)
        if options:
            return options
    if entity == "client" and field_name == "industry":
        try:
            rows = con.execute(
                """
                SELECT DISTINCT industry
                FROM clients
                WHERE NULLIF(TRIM(COALESCE(industry, '')), '') IS NOT NULL
                ORDER BY industry
                """
            ).fetchall()
            return [{"value": str(row[0]), "label": str(row[0])} for row in rows if str(row[0] or "").strip()]
        except Exception as exc:
            logger.warning("Unable to derive missing-data industry options from clients: %s", exc)
            return []
    return []

def _missing_data_field_catalog(con) -> dict[str, list[dict[str, object]]]:
    payload: dict[str, list[dict[str, object]]] = {"client": [], "job": []}
    for entity, fields in MISSING_DATA_FIELDS.items():
        for field_name, meta in fields.items():
            payload[entity].append(
                {
                    "name": field_name,
                    "label": str(meta.get("label") or field_name.replace("_", " ").title()),
                    "type": str(meta.get("type") or "text"),
                    "options": _missing_data_field_options(con, entity, field_name, meta),
                }
            )
        payload[entity].sort(key=lambda item: str(item.get("label") or ""))
    return payload

def _missing_data_field_meta(entity: str, field_name: str) -> dict[str, object]:
    entity_key = str(entity or "").strip().lower()
    fields = MISSING_DATA_FIELDS.get(entity_key) or {}
    meta = fields.get(str(field_name or "").strip())
    if not meta:
        raise HTTPException(status_code=400, detail=f"Unsupported missing-data field '{field_name}' for entity '{entity}'")
    return {"entity": entity_key, "name": field_name, **meta}

def _missing_data_missing_clause(value_sql: str, field_type: str) -> str:
    if field_type in {"integer", "number"}:
        return f"{value_sql} IS NULL"
    return f"NULLIF(TRIM(COALESCE(CAST({value_sql} AS TEXT), '')), '') IS NULL"

def _serialize_missing_data_value(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value
    return str(value)

def _coerce_missing_data_value(raw_value, field_type: str):
    if raw_value is None:
        return None
    if field_type in {"text", "textarea", "select"}:
        text = str(raw_value).strip()
        return text or None
    if field_type == "date":
        text = str(raw_value).strip()
        if not text:
            return None
        try:
            return datetime.strptime(text, "%Y-%m-%d").date().isoformat()
        except Exception:
            raise HTTPException(status_code=400, detail="Date values must be in YYYY-MM-DD format")
    if field_type == "integer":
        text = str(raw_value).strip()
        if not text:
            return None
        try:
            return int(text)
        except Exception:
            raise HTTPException(status_code=400, detail="Value must be an integer")
    if field_type == "number":
        text = str(raw_value).strip()
        if not text:
            return None
        try:
            return float(text)
        except Exception:
            raise HTTPException(status_code=400, detail="Value must be a number")
    return raw_value

def _missing_data_query(con, *, entity: str, field_name: str, missing_only: bool, search: str, limit: int) -> dict[str, object]:
    meta = _missing_data_field_meta(entity, field_name)
    field_type = str(meta.get("type") or "text")
    column = str(meta.get("column") or field_name)
    limit_i = max(1, min(int(limit or 200), 500))

    if entity == "client":
        from_sql = "FROM clients c"
        value_sql = f"c.{column}"
        order_sql = "ORDER BY c.client_name ASC, c.db_id ASC"
        select_sql = f"""
            SELECT
              c.db_id AS record_id,
              c.client_name AS primary_label,
              c.crm_owner AS owner_label,
              c.status AS status_label,
              {value_sql} AS current_value
            {from_sql}
        """
        search_clauses = [
            "LOWER(COALESCE(c.client_name, '')) LIKE %s",
            "LOWER(COALESCE(c.crm_owner, '')) LIKE %s",
            "LOWER(COALESCE(c.industry, '')) LIKE %s",
        ]
        edit_url_builder = lambda row: f"/clients/{int(row[0])}/edit"
    else:
        from_sql = "FROM jobs j LEFT JOIN clients c ON c.db_id = j.client_db_id"
        value_sql = f"j.{column}"
        order_sql = "ORDER BY COALESCE(j.job_number, ''), j.job_id ASC"
        select_sql = f"""
            SELECT
              j.job_id AS record_id,
              COALESCE(NULLIF(TRIM(j.job_number), ''), CONCAT('Job ', j.job_id)) AS primary_label,
              COALESCE(NULLIF(TRIM(j.title), ''), '') AS secondary_label,
              COALESCE(c.client_name, '') AS client_label,
              COALESCE(j.crm_name, '') AS owner_label,
              COALESCE(j.status, '') AS status_label,
              {value_sql} AS current_value
            {from_sql}
        """
        search_clauses = [
            "LOWER(COALESCE(j.job_number, '')) LIKE %s",
            "LOWER(COALESCE(j.title, '')) LIKE %s",
            "LOWER(COALESCE(c.client_name, '')) LIKE %s",
            "LOWER(COALESCE(j.crm_name, '')) LIKE %s",
        ]
        edit_url_builder = lambda row: f"/jobs/{int(row[0])}"

    where_clauses = ["COALESCE(c.archived, FALSE) = FALSE"] if entity == "client" else ["COALESCE(j.archived, FALSE) = FALSE"]
    params: list[object] = []
    if missing_only:
        where_clauses.append(_missing_data_missing_clause(value_sql, field_type))
    if str(search or "").strip():
        search_term = f"%{str(search).strip().lower()}%"
        where_clauses.append("(" + " OR ".join(search_clauses) + ")")
        params.extend([search_term] * len(search_clauses))
    where_sql = f"WHERE {' AND '.join(where_clauses)}"

    count_row = con.execute(f"SELECT COUNT(*) {from_sql} {where_sql}", params).fetchone()
    rows = con.execute(f"{select_sql} {where_sql} {order_sql} LIMIT %s", [*params, limit_i]).fetchall()

    items: list[dict[str, object]] = []
    for row in rows:
        if entity == "client":
            items.append(
                {
                    "record_id": int(row[0]),
                    "primary_label": str(row[1] or ""),
                    "secondary_label": "",
                    "client_label": "",
                    "owner_label": str(row[2] or ""),
                    "status_label": str(row[3] or ""),
                    "current_value": _serialize_missing_data_value(row[4]),
                    "edit_url": edit_url_builder(row),
                }
            )
        else:
            items.append(
                {
                    "record_id": int(row[0]),
                    "primary_label": str(row[1] or ""),
                    "secondary_label": str(row[2] or ""),
                    "client_label": str(row[3] or ""),
                    "owner_label": str(row[4] or ""),
                    "status_label": str(row[5] or ""),
                    "current_value": _serialize_missing_data_value(row[6]),
                    "edit_url": edit_url_builder(row),
                }
            )

    return {
        "ok": True,
        "entity": entity,
        "field": field_name,
        "summary": {
            "total_matching": int(count_row[0] or 0) if count_row else 0,
            "returned_rows": len(items),
            "missing_only": bool(missing_only),
            "limit": limit_i,
        },
        "rows": items,
    }

def _missing_data_update_one(con, *, entity: str, field_name: str, record_id: int, value):
    meta = _missing_data_field_meta(entity, field_name)
    column = str(meta.get("column") or field_name)
    field_type = str(meta.get("type") or "text")
    coerced_value = _coerce_missing_data_value(value, field_type)
    if entity == "client":
        exists = con.execute("SELECT 1 FROM clients WHERE db_id = %s", [int(record_id)]).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Client not found")
        con.execute(f"UPDATE clients SET {column} = %s WHERE db_id = %s", [coerced_value, int(record_id)])
    else:
        exists = con.execute("SELECT 1 FROM jobs WHERE job_id = %s", [int(record_id)]).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Job not found")
        con.execute(f"UPDATE jobs SET {column} = %s WHERE job_id = %s", [coerced_value, int(record_id)])
    return coerced_value

def _ensure_job_types_lookup_table(con, org_id: str | None) -> None:
    """Ensure job types table is present with the columns the admin UI expects."""
    try:
        org_id = str(org_id or "").strip() or None
        if not org_id:
            return
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS job_types (
              job_type_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
              name VARCHAR NOT NULL UNIQUE,
              is_active BOOLEAN NOT NULL DEFAULT TRUE
            )
            """
        )
        con.execute("ALTER TABLE job_types ADD COLUMN IF NOT EXISTS description TEXT")
        con.execute("ALTER TABLE job_types ADD COLUMN IF NOT EXISTS unit_price_ex_vat NUMERIC")
        con.execute("ALTER TABLE job_types ADD COLUMN IF NOT EXISTS vat_rate_id INTEGER")
        con.execute("ALTER TABLE job_types ADD COLUMN IF NOT EXISTS estimated_hours NUMERIC(10,2) DEFAULT 0")
        con.execute("ALTER TABLE job_types ADD COLUMN IF NOT EXISTS is_crp BOOLEAN DEFAULT FALSE")
        con.execute("ALTER TABLE job_types ADD COLUMN IF NOT EXISTS org_id TEXT")
        default_job_types = [
            ("Life Cycle Assessment", "", 0, 0, False, True),
            ("Net Zero Bronze/Core - CRP Only", "- Carbon Reduction Plan report only", 975, 0, True, True),
            (
                "Net Zero Gold",
                "Includes:\n-  Dedicated Customer Relationship Manager\n- Preparation and submission of carbon data for 1 x Carbon Reduction Report\n- 1 x verified Carbon Reduction Report \n- Report compliant with relevant frameworks, including SECR, NHS Evergreen and PPN006\n- 12 Months carbon accounting software license for 1 Site \n- Quarterly Net Zero updates, advice and support\n- Regulatory and legislative updates\n- Online promotional activities\n- 1 x CPD accredited training place\n- 20% discount on all further training places",
                2950,
                0,
                False,
                True,
            ),
            ("Net Zero Platinum", "", 0, 0, False, True),
            (
                "Net Zero Silver/Plus - CRP + software + Qtrly catch up",
                "Includes:\n- 12 Months Carbon Accounting Software License for 1 Site \n- 4 Hours Net Zero Updates, Advice and Support for the Year\n- Preparation and Submission of Carbon Data for 1 x Carbon Reduction Report\n- 1 x Carbon Reduction Report (SECR, PPN06/21, etc)\n- Regulatory and legislative updates\n- 20% discount on all further training places",
                1950,
                0,
                True,
                True,
            ),
        ]
        for name, description, unit_price_ex_vat, estimated_hours, is_crp, is_active in default_job_types:
            con.execute(
                """
                INSERT INTO job_types (org_id, name, description, unit_price_ex_vat, estimated_hours, is_crp, is_active)
                SELECT %s, %s, %s, %s, %s, %s, %s
                WHERE NOT EXISTS (
                  SELECT 1 FROM job_types WHERE lower(name)=lower(%s) AND COALESCE(org_id, '') = COALESCE(%s, '')
                )
                """,
                [org_id, name, description, unit_price_ex_vat, estimated_hours, is_crp, is_active, name, org_id],
            )
    except Exception:
        pass

def _ensure_job_statuses_lookup_table(con) -> None:
    """Ensure job statuses lookup table exists with standard default statuses."""
    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS job_statuses_lookup (
              status_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
              name TEXT UNIQUE,
              sort_order INTEGER,
              is_active BOOLEAN NOT NULL DEFAULT TRUE
            )
            """
        )
        default_statuses = [
            ("Open", 10, True),
            ("Data Gathering Phase", 20, True),
            ("Reporting Phase", 30, True),
            ("Awaiting Client Input", 40, True),
            ("Completed", 50, True),
            ("Closed", 60, True),
            ("Archived", 999, False),
        ]
        for name, sort_order, is_active in default_statuses:
            con.execute(
                """
                INSERT INTO job_statuses_lookup (name, sort_order, is_active)
                SELECT %s, %s, %s
                WHERE NOT EXISTS (
                  SELECT 1 FROM job_statuses_lookup WHERE lower(name)=lower(%s)
                )
                """,
                [name, sort_order, is_active, name],
            )
    except Exception:
        pass

def _ensure_vat_rates_lookup_table(con) -> None:
    """Ensure VAT rates lookup exists with standard defaults."""
    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS vat_rates_lookup (
              vat_rate_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
              name VARCHAR NOT NULL UNIQUE,
              rate_pct NUMERIC(8,2) NOT NULL DEFAULT 0,
              is_default BOOLEAN NOT NULL DEFAULT FALSE,
              is_active BOOLEAN NOT NULL DEFAULT TRUE
            )
            """
        )
        default_rates = [
            ("20% Standard Rate", 20, True, True),
            ("No VAT", 0, False, True),
            ("5%", 5, False, True),
        ]
        for name, rate_pct, is_default, is_active in default_rates:
            con.execute(
                """
                INSERT INTO vat_rates_lookup (name, rate_pct, is_default, is_active)
                SELECT %s, %s, %s, %s
                WHERE NOT EXISTS (
                  SELECT 1 FROM vat_rates_lookup WHERE lower(name)=lower(%s)
                )
                """,
                [name, rate_pct, is_default, is_active, name],
            )
    except Exception:
        pass

def _ensure_processes_lookup_table(con) -> None:
    """Ensure processes lookup table exists before admin lookup operations."""
    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS processes_lookup (
              process_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
              name VARCHAR NOT NULL UNIQUE,
              is_active BOOLEAN NOT NULL DEFAULT TRUE
            )
            """
        )
        default_processes = [
            "Client Onboarding",
            "Job Start",
            "Job Report",
            "General",
        ]
        for process_name in default_processes:
            con.execute(
                """
                INSERT INTO processes_lookup (name, is_active)
                SELECT %s, TRUE
                WHERE NOT EXISTS (
                  SELECT 1 FROM processes_lookup WHERE lower(name) = lower(%s)
                )
                """,
                [process_name, process_name],
            )
    except Exception:
        # Keep admin routes resilient during schema transitions.
        pass

def _ensure_payment_terms_lookup_table(con) -> None:
    """Ensure payment terms lookup exists and can be extended in clean environments."""
    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS payment_terms_lookup (
              term_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
              name VARCHAR NOT NULL UNIQUE,
              is_active BOOLEAN NOT NULL DEFAULT TRUE
            )
            """
        )
        try:
            con.execute("ALTER TABLE payment_terms_lookup ALTER COLUMN term_id ADD GENERATED BY DEFAULT AS IDENTITY")
        except Exception:
            pass
        con.execute(
            """
            INSERT INTO payment_terms_lookup (name, is_active)
            SELECT %s, TRUE
            WHERE NOT EXISTS (
              SELECT 1 FROM payment_terms_lookup WHERE lower(name)=lower(%s)
            )
            """,
            ["100% in advance", "100% in advance"],
        )
        for term_name in [
            "7 days from invoice date",
            "14 days from invoice date",
            "30 days from invoice date",
        ]:
            con.execute(
                """
                INSERT INTO payment_terms_lookup (name, is_active)
                SELECT %s, TRUE
                WHERE NOT EXISTS (
                  SELECT 1 FROM payment_terms_lookup WHERE lower(name)=lower(%s)
                )
                """,
                [term_name, term_name],
            )
    except Exception:
        pass

def _ensure_time_subjects_lookup_table(con, org_id: str | None) -> None:
    """Ensure time subjects lookup exists and supports budget hours."""
    try:
        org_id = str(org_id or "").strip() or None
        if not org_id:
            return
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS time_subjects (
              subject_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
              org_id TEXT,
              name VARCHAR,
              is_active BOOLEAN NOT NULL DEFAULT TRUE,
              budget_hours NUMERIC(10,2) DEFAULT 0
            )
            """
        )
        try:
            con.execute("ALTER TABLE time_subjects ADD COLUMN IF NOT EXISTS budget_hours NUMERIC(10,2) DEFAULT 0")
            con.execute("ALTER TABLE time_subjects ADD COLUMN IF NOT EXISTS org_id TEXT")
        except Exception:
            pass
        default_subjects = [
            "Client Calls",
            "Client Data Collection",
            "Client Reporting",
        ]
        for subject_name in default_subjects:
            con.execute(
                """
                INSERT INTO time_subjects (org_id, name, is_active, budget_hours)
                SELECT %s, %s, TRUE, 0
                WHERE NOT EXISTS (
                  SELECT 1 FROM time_subjects WHERE lower(name)=lower(%s) AND COALESCE(org_id, '') = COALESCE(%s, '')
                )
                """,
                [org_id, subject_name, subject_name, org_id],
            )
    except Exception:
        pass

def _ensure_portfolios_lookup_table(con, org_id: str | None) -> None:
    """Ensure portfolios lookup exists with the standard NZI portfolio."""
    try:
        org_id = str(org_id or "").strip() or None
        if not org_id:
            return
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS portfolios_lookup (
              portfolio_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
              org_id TEXT,
              name VARCHAR NOT NULL UNIQUE,
              is_active BOOLEAN NOT NULL DEFAULT TRUE
            )
            """
        )
        con.execute("ALTER TABLE portfolios_lookup ADD COLUMN IF NOT EXISTS org_id TEXT")
        con.execute(
            """
            INSERT INTO portfolios_lookup (org_id, name, is_active)
            SELECT %s, %s, TRUE
            WHERE NOT EXISTS (
              SELECT 1 FROM portfolios_lookup WHERE lower(name)=lower(%s) AND COALESCE(org_id, '') = COALESCE(%s, '')
            )
            """,
            [org_id, "NZI", "NZI", org_id],
        )
        con.execute(
            """
            INSERT INTO portfolios_lookup (org_id, name, is_active)
            SELECT %s, %s, TRUE
            WHERE NOT EXISTS (
              SELECT 1 FROM portfolios_lookup WHERE lower(name)=lower(%s) AND COALESCE(org_id, '') = COALESCE(%s, '')
            )
            """,
            [org_id, "NZN", "NZN", org_id],
        )
    except Exception:
        pass

def _ensure_industries_lookup_table(con) -> None:
    """Ensure industries lookup exists and supports adding rows in clean environments."""
    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS industries_lookup (
              industry_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
              name VARCHAR NOT NULL UNIQUE,
              is_active BOOLEAN NOT NULL DEFAULT TRUE
            )
            """
        )
        try:
            con.execute("ALTER TABLE industries_lookup ALTER COLUMN industry_id ADD GENERATED BY DEFAULT AS IDENTITY")
        except Exception:
            pass
        default_industries = [
            "Agriculture",
            "Architect",
            "Automotive",
            "Bid Management",
            "Business Services",
            "Charities and Not For Profit",
            "Chemicals",
            "Clothing",
            "Computing",
            "Construction",
            "Consultancy",
            "Digital Services",
            "Education",
            "Energy",
            "Engineering",
            "Facilities Management",
            "Finance",
            "Food & Drink",
            "Furniture",
            "Healthcare",
            "Hospitality and Travel",
            "Housing",
            "Insurance",
            "Local Authority",
            "Machinery",
            "Manufacturing",
            "Marketing",
            "Media",
            "Oil & Gas",
            "Pharmaceuticals",
            "Printing",
            "Procurement",
            "Property Management",
            "Recruitment",
            "Recycling",
            "Renewables",
            "Retail",
            "Shipping",
            "Software",
            "Sport",
            "Sustainability",
            "Technology",
            "Transport",
            "Utilities",
        ]
        for industry_name in default_industries:
            con.execute(
                """
                INSERT INTO industries_lookup (name, is_active)
                SELECT %s, TRUE
                WHERE NOT EXISTS (
                  SELECT 1 FROM industries_lookup WHERE lower(name)=lower(%s)
                )
                """,
                [industry_name, industry_name],
            )
    except Exception:
        pass

def _ensure_job_item_categories_lookup_table(con) -> None:
    """Ensure job item categories lookup table exists before admin lookup operations."""
    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS job_item_categories_lookup (
              category_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
              name VARCHAR NOT NULL UNIQUE,
              is_active BOOLEAN NOT NULL DEFAULT TRUE,
              sort_order INTEGER DEFAULT 0
            )
            """
        )
        default_categories = [
            ("Assessment", 1, False),
            ("Life Cycle Assessment", 1, True),
            ("Carbon Reporting Programme", 2, True),
            ("Reporting", 2, False),
            ("Advisory", 3, False),
            ("Consultancy", 3, True),
            ("Training", 4, True),
            ("Carbon Report Only", 5, True),
            ("Ongoing", 5, False),
            ("Other", 6, False),
        ]
        for category_name, sort_order, is_active in default_categories:
            con.execute(
                """
                INSERT INTO job_item_categories_lookup (name, is_active, sort_order)
                SELECT %s, %s, %s
                WHERE NOT EXISTS (
                  SELECT 1 FROM job_item_categories_lookup WHERE lower(name) = lower(%s)
                )
                """,
                [category_name, is_active, sort_order, category_name],
            )
    except Exception:
        # Keep admin routes resilient during schema transitions.
        pass

def _ensure_uom_lookup_table(con) -> None:
    """Ensure unit-of-measure lookup table exists with standard defaults."""
    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS uom_lookup (
              uom_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
              name VARCHAR NOT NULL UNIQUE,
              is_active BOOLEAN NOT NULL DEFAULT TRUE,
              sort_order INTEGER DEFAULT 0
            )
            """
        )
        default_uoms = [
            "hours",
            "days",
            "units",
            "months",
            "years",
            "kg",
            "litres",
            "miles",
            "km",
            "sessions",
            "projects",
        ]
        for idx, uom_name in enumerate(default_uoms, start=1):
            con.execute(
                """
                INSERT INTO uom_lookup (name, is_active, sort_order)
                SELECT %s, TRUE, %s
                WHERE NOT EXISTS (
                  SELECT 1 FROM uom_lookup WHERE lower(name) = lower(%s)
                )
                """,
                [uom_name, idx, uom_name],
            )
    except Exception:
        pass

def _ensure_bd_bin_reasons_lookup_table(con) -> None:
    """Ensure BD bin reasons lookup exists with defaults for lead qualification."""
    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS bd_bin_reasons_lookup (
              bin_reason_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
              name VARCHAR NOT NULL UNIQUE,
              is_active BOOLEAN NOT NULL DEFAULT TRUE,
              sort_order INTEGER DEFAULT 0
            )
            """
        )
        default_reasons = [
            "Competitor",
            "Company Too Large",
            "Likelihood Too Low",
            "Other",
        ]
        for idx, reason_name in enumerate(default_reasons, start=1):
            con.execute(
                """
                INSERT INTO bd_bin_reasons_lookup (name, is_active, sort_order)
                SELECT %s, TRUE, %s
                WHERE NOT EXISTS (
                  SELECT 1 FROM bd_bin_reasons_lookup WHERE lower(name) = lower(%s)
                )
                """,
                [reason_name, idx, reason_name],
            )
    except Exception:
        pass

def _ensure_currency_lookup_table(con) -> None:
    """Ensure currency lookup exists with the standard seed currencies."""
    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS currency_lookup (
              currency_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
              currency_code VARCHAR(3) NOT NULL UNIQUE,
              currency_name VARCHAR NOT NULL,
              symbol VARCHAR NOT NULL,
              exchange_rate NUMERIC(18,6) NOT NULL DEFAULT 1,
              is_default BOOLEAN NOT NULL DEFAULT FALSE,
              is_active BOOLEAN NOT NULL DEFAULT TRUE,
              sort_order INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        default_currencies = [
            ("UAE", "UAE Dirham", "AED", 1, False, 0),
            ("GBP", "British Pound", "£", 1, True, 10),
            ("EUR", "Euro", "€", 1.18, False, 20),
            ("USD", "US Dollar", "$", 1.27, False, 30),
            ("AUD", "Australian Dollar", "A$", 1.92, False, 40),
            ("CAD", "Canadian Dollar", "C$", 1.71, False, 50),
        ]
        for code, name, symbol, exchange_rate, is_default, sort_order in default_currencies:
            con.execute(
                """
                INSERT INTO currency_lookup (currency_code, currency_name, symbol, exchange_rate, is_default, is_active, sort_order)
                SELECT %s, %s, %s, %s, %s, TRUE, %s
                WHERE NOT EXISTS (
                  SELECT 1 FROM currency_lookup WHERE upper(currency_code)=upper(%s)
                )
                """,
                [code, name, symbol, exchange_rate, is_default, sort_order, code],
            )
    except Exception:
        pass

def _ensure_lookup_table(con, table_name: str, org_id: str | None = None) -> None:
    """Ensure lookup tables and standard seed options exist before admin operations."""
    if table_name == "job_types":
        _ensure_job_types_lookup_table(con, org_id)
    elif table_name == "job_statuses_lookup":
        _ensure_job_statuses_lookup_table(con)
    elif table_name == "vat_rates_lookup":
        _ensure_vat_rates_lookup_table(con)
    elif table_name == "payment_terms_lookup":
        _ensure_payment_terms_lookup_table(con)
    elif table_name == "time_subjects":
        _ensure_time_subjects_lookup_table(con, org_id)
    elif table_name == "portfolios_lookup":
        _ensure_portfolios_lookup_table(con, org_id)
    elif table_name == "industries_lookup":
        _ensure_industries_lookup_table(con)
    elif table_name == "currency_lookup":
        _ensure_currency_lookup_table(con)
    elif table_name == "positions_lookup":
        _ensure_positions_lookup_table(con)
    elif table_name == "processes_lookup":
        _ensure_processes_lookup_table(con)
    elif table_name == "job_item_categories_lookup":
        _ensure_job_item_categories_lookup_table(con)
    elif table_name == "uom_lookup":
        _ensure_uom_lookup_table(con)
    elif table_name == "bd_bin_reasons_lookup":
        _ensure_bd_bin_reasons_lookup_table(con)

def _ensure_lookup_table_once(con, table_name: str, org_id: str | None = None) -> None:
    with _LOOKUP_BOOTSTRAP_LOCK:
        if table_name in _LOOKUP_BOOTSTRAPPED:
            return
        _ensure_lookup_table(con, table_name, org_id)
        _LOOKUP_BOOTSTRAPPED.add(table_name)

# =========================
# TEAM MANAGEMENT
# =========================

