"""
Admin API routes for team, lookups, datasets, and system management.
"""

from fastapi import APIRouter, Depends, HTTPException, Body, UploadFile, File, Form, Query
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool
from api.auth import _current_user
from api.permissions import require_permission
from core.database import get_conn
from core.auth import set_user_password
from services.messaging_templates import build_email_content
from services.outbound_email import send_tracked_email
from services.tenancy import get_default_org_id, require_org
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
from services.legacy_annual_import import parse_legacy_annual_workbook, commit_legacy_rows, resolve_unresolved_rows
from services.attribute_override_import import (
    build_override_template_workbook,
    commit_override_rows,
    parse_override_workbook,
)
from services.audit_log import ensure_audit_log_table, parse_json_text
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

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_permission(ADMIN_ACCESS_PERMISSION))],
)

_LOOKUP_BOOTSTRAP_LOCK = Lock()
_LOOKUP_BOOTSTRAPPED: set[str] = set()
_ADMIN_USER_BOOTSTRAPPED = False
_ADMIN_USER_BOOTSTRAP_LOCK = Lock()
_ORG_SCOPED_LOOKUP_TABLES = {"job_types", "time_subjects", "portfolios_lookup"}


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
        except Exception:
            pass


def _normalize_user_type(value: object | None) -> str:
    normalized = str(value or "internal").strip().lower()
    return "client_portal" if normalized == "client_portal" else "internal"


def _normalize_access_scope(user_type: str, value: object | None) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in ACCESS_SCOPES:
        return normalized
    if user_type == "client_portal":
        return DEFAULT_PORTAL_ACCESS_SCOPE
    return DEFAULT_INTERNAL_ACCESS_SCOPE


def _fetch_linked_clients(con, email: str) -> list[dict[str, object]]:
    rows = con.execute(
        """
        SELECT cu.client_db_id, COALESCE(cu.role_name, ''), COALESCE(c.client_name, '')
        FROM client_users cu
        LEFT JOIN clients c ON c.db_id = cu.client_db_id
        WHERE LOWER(COALESCE(cu.user_id, '')) = LOWER(?)
          AND COALESCE(cu.is_active, TRUE) = TRUE
        ORDER BY c.client_name ASC, cu.client_db_id ASC
        """,
        [str(email or "").strip().lower()],
    ).fetchall()
    items: list[dict[str, object]] = []
    for row in rows or []:
        if not row or row[0] is None:
            continue
        items.append(
            {
                "client_db_id": int(row[0]),
                "role_name": str(row[1] or "").strip() or None,
                "client_name": str(row[2] or "").strip() or None,
            }
        )
    return items


def _replace_linked_clients(
    con,
    *,
    email: str,
    actor: str,
    linked_clients: list[dict[str, object]] | list[int],
) -> list[dict[str, object]]:
    email_norm = str(email or "").strip().lower()
    con.execute(
        "DELETE FROM client_users WHERE LOWER(COALESCE(user_id, '')) = LOWER(?)",
        [email_norm],
    )
    seen: set[int] = set()
    for item in linked_clients or []:
        if isinstance(item, dict):
            client_id = item.get("client_db_id")
            role_name = str(item.get("role_name") or "").strip() or None
        else:
            client_id = item
            role_name = None
        try:
            client_id_int = int(client_id)  # type: ignore[arg-type]
        except Exception:
            continue
        if client_id_int in seen:
            continue
        seen.add(client_id_int)
        con.execute(
            """
            INSERT INTO client_users (user_id, client_db_id, role_name, is_active, created_by, updated_at)
            VALUES (?, ?, ?, TRUE, ?, NOW())
            """,
            [email_norm, client_id_int, role_name, actor],
        )
    return _fetch_linked_clients(con, email_norm)


@router.get("/audit-log")
def get_audit_log(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    actor_email: str | None = Query(None),
    entity_type: str | None = Query(None),
    action: str | None = Query(None),
    client_id: int | None = Query(None),
    job_id: int | None = Query(None),
    q: str | None = Query(None),
    _user: dict = Depends(_current_user),
    _audit_access: dict = Depends(require_permission("admin.audit.view")),
):
    try:
        with get_conn() as con:
            ensure_audit_log_table(con)

            where_parts: list[str] = []
            params: list[object] = []

            if actor_email:
                where_parts.append("LOWER(COALESCE(actor_email, '')) LIKE LOWER(%s)")
                params.append(f"%{str(actor_email).strip()}%")
            if entity_type:
                where_parts.append("LOWER(COALESCE(entity_type, '')) = LOWER(%s)")
                params.append(str(entity_type).strip())
            if action:
                where_parts.append("LOWER(COALESCE(action, '')) = LOWER(%s)")
                params.append(str(action).strip())
            if client_id is not None:
                where_parts.append("client_id = %s")
                params.append(int(client_id))
            if job_id is not None:
                where_parts.append("job_id = %s")
                params.append(int(job_id))
            if q:
                where_parts.append(
                    "("
                    "LOWER(COALESCE(actor_name, '')) LIKE LOWER(%s) OR "
                    "LOWER(COALESCE(actor_email, '')) LIKE LOWER(%s) OR "
                    "LOWER(COALESCE(entity_type, '')) LIKE LOWER(%s) OR "
                    "LOWER(COALESCE(action, '')) LIKE LOWER(%s) OR "
                    "LOWER(COALESCE(page, '')) LIKE LOWER(%s) OR "
                    "LOWER(COALESCE(section, '')) LIKE LOWER(%s) OR "
                    "LOWER(COALESCE(container, '')) LIKE LOWER(%s)"
                    ")"
                )
                q_like = f"%{str(q).strip()}%"
                params.extend([q_like, q_like, q_like, q_like, q_like, q_like, q_like])

            where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
            total_row = con.execute(
                f"SELECT COUNT(*) FROM audit_log {where_sql}",
                params,
            ).fetchone()

            rows = con.execute(
                f"""
                SELECT
                    audit_id, created_at, actor_user_id, actor_email, actor_name,
                    action, entity_type, entity_id, client_id, job_id,
                    page, section, container, route, method,
                    before_json, after_json, diff_json, metadata_json,
                    ip_address, user_agent
                FROM audit_log
                {where_sql}
                ORDER BY created_at DESC, audit_id DESC
                LIMIT %s OFFSET %s
                """,
                [*params, int(limit), int(offset)],
            ).fetchall()

        items: list[dict[str, object]] = []
        for row in rows or []:
            items.append(
                {
                    "audit_id": int(row[0]),
                    "created_at": str(row[1]) if row[1] is not None else None,
                    "actor_user_id": row[2],
                    "actor_email": row[3],
                    "actor_name": row[4],
                    "action": row[5],
                    "entity_type": row[6],
                    "entity_id": row[7],
                    "client_id": row[8],
                    "job_id": row[9],
                    "page": row[10],
                    "section": row[11],
                    "container": row[12],
                    "route": row[13],
                    "method": row[14],
                    "before": parse_json_text(row[15]),
                    "after": parse_json_text(row[16]),
                    "diff": parse_json_text(row[17]),
                    "metadata": parse_json_text(row[18]),
                    "ip_address": row[19],
                    "user_agent": row[20],
                }
            )

        return {
            "items": items,
            "total": int(total_row[0] if total_row else 0),
            "limit": int(limit),
            "offset": int(offset),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch audit log: {e}")


def _resolve_job_reference(con, raw_value: object) -> tuple[int, str | None]:
    token = str(raw_value or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="job_id is required")

    row = con.execute(
        """
        SELECT job_id, job_number
        FROM jobs
        WHERE LOWER(COALESCE(job_number, '')) = LOWER(%s)
        LIMIT 1
        """,
        [token],
    ).fetchone()
    if row:
        return int(row[0]), str(row[1] or "").strip() or None

    digits_only = "".join(ch for ch in token if ch.isdigit())
    if digits_only:
        normalized_job_number = f"J{digits_only.zfill(6)}"
        normalized_row = con.execute(
            """
            SELECT job_id, job_number
            FROM jobs
            WHERE LOWER(COALESCE(job_number, '')) = LOWER(%s)
            LIMIT 1
            """,
            [normalized_job_number],
        ).fetchone()
        direct_id_row = None
        if token.isdigit():
            try:
                direct_id_row = con.execute(
                    "SELECT job_id, job_number FROM jobs WHERE job_id = %s LIMIT 1",
                    [int(token)],
                ).fetchone()
            except Exception:
                direct_id_row = None

        if normalized_row and direct_id_row and int(normalized_row[0]) != int(direct_id_row[0]):
            normalized_label = str(normalized_row[1] or "").strip() or normalized_job_number
            direct_label = str(direct_id_row[1] or "").strip() or f"job_id {int(direct_id_row[0])}"
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Ambiguous job reference '{token}'. It matches internal Job ID {int(direct_id_row[0])} "
                    f"({direct_label}) and Job Number {normalized_label}. Please enter the full job number "
                    f"(e.g. {normalized_label}) or use the internal Job ID shown on the job page."
                ),
            )

        if normalized_row:
            return int(normalized_row[0]), str(normalized_row[1] or "").strip() or normalized_job_number

        if direct_id_row:
            return int(direct_id_row[0]), str(direct_id_row[1] or "").strip() or None

    try:
        row = con.execute(
            "SELECT job_id, job_number FROM jobs WHERE job_id = %s LIMIT 1",
            [int(token)],
        ).fetchone()
        if row:
            return int(row[0]), str(row[1] or "").strip() or None
    except Exception:
        pass

    raise HTTPException(status_code=404, detail=f"Job not found for reference '{token}'")


def _ingest_csv_for_dataset(csv_path: Path, *, replace: bool, dataset_id: int) -> tuple[int, int]:
    """Call ingest_csv in a way that works with both older and newer signatures."""
    from ingest_conversion_factors import ingest_csv

    signature = inspect.signature(ingest_csv)
    if "dataset_id" in signature.parameters:
        return ingest_csv(csv_path, replace=replace, dataset_id=dataset_id)
    return ingest_csv(csv_path, replace=replace)


def _ingest_csv_report_for_dataset(csv_path: Path, *, replace: bool, dataset_id: int) -> dict:
    """Use the richer dataset ingest report when available."""
    from ingest_conversion_factors import ingest_csv_with_report, ingest_workbook_with_report

    signature = inspect.signature(ingest_csv_with_report)
    if "dataset_id" in signature.parameters:
        return ingest_csv_with_report(csv_path, replace=replace, dataset_id=dataset_id)
    ds_id, factor_count = _ingest_csv_for_dataset(csv_path, replace=replace, dataset_id=dataset_id)
    return {
        "dataset_id": ds_id,
        "accepted_rows": factor_count,
        "rejected_rows": 0,
        "rejected_details": [],
        "deleted_rows": 0,
    }


def _ensure_users_position_column(con) -> None:
    """Ensure users.position exists for consultant position metadata."""
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS position VARCHAR")
    except Exception:
        # Keep admin routes resilient if schema changes lag behind.
        pass


def _ensure_users_password_column(con) -> None:
    """Ensure users.password_hash exists for credential-based login."""
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE")
    except Exception:
        pass


def _ensure_users_invite_columns(con) -> None:
    """Ensure users invite lifecycle columns exist."""
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_at TIMESTAMP")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by VARCHAR")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMP")
    except Exception:
        pass


def _ensure_users_cost_sell_mobile_columns(con) -> None:
    """Ensure user commercial and mobile fields exist."""
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS cost_per_hour NUMERIC(12,2)")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS sell_per_hour NUMERIC(12,2)")
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile_phone VARCHAR")
    except Exception:
        pass


def _ensure_positions_lookup_table(con) -> None:
    """Ensure positions lookup table exists before admin lookup operations."""
    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS positions_lookup (
              position_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
              name VARCHAR NOT NULL UNIQUE,
              is_active BOOLEAN NOT NULL DEFAULT TRUE
            )
            """
        )
        default_positions = [
            "Chief Commercial Officer",
            "Chief Executive Officer",
            "Chief Information Officer",
            "Customer Relationship Manager",
        ]
        for position_name in default_positions:
            con.execute(
                """
                INSERT INTO positions_lookup (name, is_active)
                SELECT %s, TRUE
                WHERE NOT EXISTS (
                  SELECT 1 FROM positions_lookup WHERE lower(name) = lower(%s)
                )
                """,
                [position_name, position_name],
            )
    except Exception:
        # Keep admin routes resilient during schema transitions.
        pass


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
    except Exception:
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
    except Exception:
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
        except Exception:
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


def _ensure_job_types_lookup_table(con) -> None:
    """Ensure job types table is present with the columns the admin UI expects."""
    try:
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
        org_id = get_default_org_id()
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


def _ensure_time_subjects_lookup_table(con) -> None:
    """Ensure time subjects lookup exists and supports budget hours."""
    try:
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
        org_id = get_default_org_id()
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


def _ensure_portfolios_lookup_table(con) -> None:
    """Ensure portfolios lookup exists with the standard NZI portfolio."""
    try:
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
        org_id = get_default_org_id()
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


def _ensure_lookup_table(con, table_name: str) -> None:
    """Ensure lookup tables and standard seed options exist before admin operations."""
    if table_name == "job_types":
        _ensure_job_types_lookup_table(con)
    elif table_name == "job_statuses_lookup":
        _ensure_job_statuses_lookup_table(con)
    elif table_name == "vat_rates_lookup":
        _ensure_vat_rates_lookup_table(con)
    elif table_name == "payment_terms_lookup":
        _ensure_payment_terms_lookup_table(con)
    elif table_name == "time_subjects":
        _ensure_time_subjects_lookup_table(con)
    elif table_name == "portfolios_lookup":
        _ensure_portfolios_lookup_table(con)
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


def _ensure_lookup_table_once(con, table_name: str) -> None:
    with _LOOKUP_BOOTSTRAP_LOCK:
        if table_name in _LOOKUP_BOOTSTRAPPED:
            return
        _ensure_lookup_table(con, table_name)
        _LOOKUP_BOOTSTRAPPED.add(table_name)


def _ensure_admin_user_schema_once(con) -> None:
    global _ADMIN_USER_BOOTSTRAPPED
    with _ADMIN_USER_BOOTSTRAP_LOCK:
        if _ADMIN_USER_BOOTSTRAPPED:
            return
        ensure_permission_schema(con)
        _ensure_users_position_column(con)
        _ensure_users_password_column(con)
        _ensure_users_invite_columns(con)
        _ensure_users_cost_sell_mobile_columns(con)
        _ADMIN_USER_BOOTSTRAPPED = True


def _ensure_supplier_tables(con) -> None:
    """Ensure supplier master and supplier service item tables exist."""
    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS suppliers (
              supplier_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
              supplier_name VARCHAR NOT NULL,
              address TEXT,
              contact_name VARCHAR,
              contact_email VARCHAR,
              website VARCHAR,
              phone VARCHAR,
              notes TEXT,
              is_active BOOLEAN NOT NULL DEFAULT TRUE,
              created_at TIMESTAMP DEFAULT NOW(),
              updated_at TIMESTAMP DEFAULT NOW()
            )
            """
        )
        con.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_suppliers_name_ci ON suppliers (lower(supplier_name))")
    except Exception:
        pass

    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS supplier_service_items (
              supplier_item_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
              supplier_id INTEGER NOT NULL,
              cost_type VARCHAR,
              item_name VARCHAR NOT NULL,
              description TEXT,
              uom VARCHAR,
              agreed_rate DOUBLE PRECISION DEFAULT 0,
              is_vatable BOOLEAN DEFAULT FALSE,
              vat_rate_pct DOUBLE PRECISION DEFAULT 0,
              is_active BOOLEAN NOT NULL DEFAULT TRUE,
              created_at TIMESTAMP DEFAULT NOW(),
              updated_at TIMESTAMP DEFAULT NOW()
            )
            """
        )
        con.execute(
            "CREATE INDEX IF NOT EXISTS ix_supplier_service_items_supplier_id ON supplier_service_items (supplier_id)"
        )
    except Exception:
        pass


def _actor_identifier(user: dict) -> str:
    return str(
        user.get("email")
        or user.get("user_id")
        or user.get("full_name")
        or "system"
    ).strip()


def _invite_expiry(days: int = 7) -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=days)


def _send_team_access_email(
    *,
    to_email: str,
    full_name: str,
    role: str,
    temporary_password: str,
    invite_expires_at: datetime | None,
    template_key: str,
    sender_identifier: str,
) -> dict:
    if not str(to_email or "").strip():
        return {"status": "skipped", "error": "Recipient email is blank"}

    sender_name = sender_identifier
    context = {
        "full_name": str(full_name or "").strip() or str(to_email or "").strip(),
        "email": str(to_email or "").strip(),
        "role": str(role or "").strip(),
        "temporary_password": str(temporary_password or "").strip(),
        "invite_expires_at": invite_expires_at.isoformat() if invite_expires_at else "",
        "sender_name": sender_name,
    }

    fallback_subject = "Your NZI Pro account details"
    fallback_body = (
        f"<p>Hi {context['full_name']},</p>"
        "<p>Your NZI Pro access details are below:</p>"
        f"<p>Username: <strong>{context['email']}</strong><br/>"
        f"Temporary password: <strong>{context['temporary_password']}</strong><br/>"
        f"Expires: <strong>{context['invite_expires_at']}</strong></p>"
        "<p>Please sign in and change your password immediately.</p>"
        f"<p>Kind regards,<br/>{sender_name}</p>"
    )

    with get_conn() as con:
        rendered = build_email_content(
            con=con,
            template_key=template_key,
            context=context,
            fallback_subject=fallback_subject,
            fallback_body=fallback_body,
            sender_identifier=sender_identifier,
        )
        result = send_tracked_email(
            con,
            to_email=context["email"],
            subject=rendered["subject"],
            body_text=rendered["body_text"],
            body_html=rendered["body_html"],
            created_by=sender_identifier,
            template_key=template_key,
            entity_type="team_member",
            metadata={"flow": template_key},
            raise_on_error=False,
        )
    return result


def _is_invite_lapsed(expires_at, has_password: bool, must_change_password: bool) -> bool:
    if not expires_at:
        return False

    expiry_dt = expires_at
    if isinstance(expires_at, str):
        try:
            expiry_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        except Exception:
            return False

    try:
        if getattr(expiry_dt, "tzinfo", None) is None:
            now = datetime.utcnow()
        else:
            now = datetime.now(timezone.utc)
        return bool(now > expiry_dt and ((not has_password) or must_change_password))
    except Exception:
        return False


# =========================
# TEAM MANAGEMENT
# =========================

@router.get("/users")
def list_users(_user: dict = Depends(_current_user)):
    """List all users."""
    try:
        with get_conn() as con:
            _ensure_admin_user_schema_once(con)
            df = con.execute(
                """
                SELECT user_id, full_name, email, role, position, status, password_hash,
                       invited_at, invited_by, invite_expires_at, COALESCE(must_change_password, FALSE) AS must_change_password,
                       cost_per_hour, sell_per_hour, mobile_phone,
                       COALESCE(user_type, 'internal') AS user_type,
                       COALESCE(access_scope, 'all') AS access_scope
                FROM users
                ORDER BY status DESC, role, full_name
                """
            ).df()
        
        items = []
        if df is not None and not df.empty:
            for _, r in df.iterrows():
                items.append({
                    "user_id": str(r.get("user_id") or ""),
                    "full_name": str(r.get("full_name") or ""),
                    "email": str(r.get("email") or ""),
                    "role": str(r.get("role") or "ReadOnly"),
                    "position": str(r.get("position") or ""),
                    "status": str(r.get("status") or "Active"),
                    "has_password": bool(r.get("password_hash")),
                    "invited_at": str(r.get("invited_at")) if r.get("invited_at") else None,
                    "invited_by": str(r.get("invited_by") or "") or None,
                    "invite_expires_at": str(r.get("invite_expires_at")) if r.get("invite_expires_at") else None,
                    "invite_lapsed": _is_invite_lapsed(
                        r.get("invite_expires_at"),
                        bool(r.get("password_hash")),
                        bool(r.get("must_change_password")),
                    ),
                    "cost_per_hour": (float(r.get("cost_per_hour")) if r.get("cost_per_hour") is not None else None),
                    "sell_per_hour": (float(r.get("sell_per_hour")) if r.get("sell_per_hour") is not None else None),
                    "mobile_phone": str(r.get("mobile_phone") or "") or None,
                    "user_type": _normalize_user_type(r.get("user_type")),
                    "access_scope": _normalize_access_scope(
                        _normalize_user_type(r.get("user_type")),
                        r.get("access_scope"),
                    ),
                })
        
        return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list users: {e}")


@router.get("/roles")
def list_roles(_user: dict = Depends(_current_user)):
    """List all roles."""
    try:
        with get_conn() as con:
            df = con.execute(
                """
                SELECT role_name, is_active
                FROM roles_lookup
                ORDER BY role_name
                """
            ).df()
        
        items = []
        if df is not None and not df.empty:
            for _, r in df.iterrows():
                items.append({
                    "role_name": str(r.get("role_name") or ""),
                    "is_active": bool(r.get("is_active", True)),
                })
        else:
            # Default roles if table is empty
            items = [
                {"role_name": SUPERADMIN_ROLE, "is_active": True},
                {"role_name": "Admin", "is_active": True},
                {"role_name": "Consultant", "is_active": True},
                {"role_name": "ReadOnly", "is_active": True},
                {"role_name": "CRM", "is_active": True},
                {"role_name": "QA", "is_active": True},
                {"role_name": "Support", "is_active": True},
            ]
        
        return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list roles: {e}")


@router.get("/permissions")
def list_permissions(_user: dict = Depends(_current_user)):
    try:
        return {
            "items": [
                {"permission_key": key, "description": description}
                for key, description in sorted(PERMISSIONS.items(), key=lambda item: item[0])
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list permissions: {e}")


@router.get("/access/options")
def get_access_options(_user: dict = Depends(_current_user)):
    try:
        with get_conn() as con:
            ensure_permission_schema(con)
            roles_df = con.execute(
                """
                SELECT role_name, is_active
                FROM roles_lookup
                WHERE COALESCE(is_active, TRUE) = TRUE
                ORDER BY role_name
                """
            ).df()
            clients_df = con.execute(
                """
                SELECT db_id AS client_db_id, client_name
                FROM clients
                WHERE status IS NULL OR LOWER(COALESCE(status, '')) <> 'archived'
                ORDER BY client_name ASC, db_id ASC
                """
            ).df()
        roles = []
        if roles_df is not None and not roles_df.empty:
            for _, row in roles_df.iterrows():
                roles.append(
                    {
                        "role_name": str(row.get("role_name") or ""),
                        "is_active": bool(row.get("is_active", True)),
                    }
                )
        clients = []
        if clients_df is not None and not clients_df.empty:
            for _, row in clients_df.iterrows():
                if row.get("client_db_id") is None:
                    continue
                clients.append(
                    {
                        "client_db_id": int(row.get("client_db_id")),
                        "client_name": str(row.get("client_name") or ""),
                    }
                )
        return {
            "roles": roles,
            "permissions": [
                {"permission_key": key, "description": description}
                for key, description in sorted(PERMISSIONS.items(), key=lambda item: item[0])
            ],
            "access_scopes": sorted(ACCESS_SCOPES),
            "user_types": ["internal", "client_portal"],
            "clients": clients,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch access options: {e}")


@router.get("/users/{email}/access")
def get_user_access(email: str, _user: dict = Depends(_current_user)):
    try:
        email_norm = str(email or "").strip().lower()
        with get_conn() as con:
            ensure_permission_schema(con)
            row = con.execute(
                """
                SELECT email, COALESCE(role, 'ReadOnly'), COALESCE(user_type, 'internal'), COALESCE(access_scope, 'all')
                FROM users
                WHERE LOWER(COALESCE(email, '')) = LOWER(?)
                LIMIT 1
                """,
                [email_norm],
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="User not found")
            override_rows = con.execute(
                """
                SELECT permission_key, LOWER(COALESCE(effect, 'deny')) AS effect, reason
                FROM user_permission_overrides
                WHERE LOWER(COALESCE(user_id, '')) = LOWER(?)
                ORDER BY permission_key
                """,
                [email_norm],
            ).fetchall()
            linked_clients = _fetch_linked_clients(con, email_norm)

        effective = get_effective_permissions_for_user(email_norm, role_hint=str(row[1] or "ReadOnly"))
        return {
            "email": str(row[0] or email_norm),
            "role": str(row[1] or "ReadOnly"),
            "user_type": _normalize_user_type(row[2]),
            "access_scope": _normalize_access_scope(row[2], row[3]),
            "linked_clients": linked_clients,
            "overrides": [
                {
                    "permission_key": str(item[0] or ""),
                    "effect": str(item[1] or "deny"),
                    "reason": str(item[2] or "").strip() or None,
                }
                for item in (override_rows or [])
                if item and item[0]
            ],
            "effective_permissions": list(effective.get("effective_permissions") or []),
            "denied_permissions": list(effective.get("denied_permissions") or []),
            "is_super_admin": bool(effective.get("is_super_admin")),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch user access: {e}")


@router.put("/users/{email}/access")
def update_user_access(email: str, body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        email_norm = str(email or "").strip().lower()
        actor = _actor_identifier(_user)
        role_name = str(body.get("role") or "ReadOnly").strip() or "ReadOnly"
        user_type = _normalize_user_type(body.get("user_type"))
        access_scope = _normalize_access_scope(user_type, body.get("access_scope"))
        linked_clients_body = body.get("linked_clients") or []
        overrides_body = body.get("overrides") or []

        with get_conn() as con:
            ensure_permission_schema(con)
            exists = con.execute(
                "SELECT 1 FROM users WHERE LOWER(COALESCE(email, '')) = LOWER(?) LIMIT 1",
                [email_norm],
            ).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="User not found")

            con.execute(
                """
                UPDATE users
                SET role = ?, user_type = ?, access_scope = ?, user_id = COALESCE(NULLIF(user_id, ''), ?)
                WHERE LOWER(COALESCE(email, '')) = LOWER(?)
                """,
                [role_name, user_type, access_scope, email_norm, email_norm],
            )

            con.execute(
                "DELETE FROM user_permission_overrides WHERE LOWER(COALESCE(user_id, '')) = LOWER(?)",
                [email_norm],
            )
            for item in overrides_body:
                if not isinstance(item, dict):
                    continue
                permission_key = str(item.get("permission_key") or "").strip()
                effect = str(item.get("effect") or "").strip().lower()
                reason = str(item.get("reason") or "").strip() or None
                if permission_key not in PERMISSIONS or effect not in {"allow", "deny"}:
                    continue
                con.execute(
                    """
                    INSERT INTO user_permission_overrides (user_id, permission_key, effect, reason, updated_at)
                    VALUES (?, ?, ?, ?, NOW())
                    """,
                    [email_norm, permission_key, effect, reason],
                )

            linked_clients = _replace_linked_clients(
                con,
                email=email_norm,
                actor=actor,
                linked_clients=linked_clients_body,
            )

        invalidate_permission_cache(email_norm)
        effective = get_effective_permissions_for_user(email_norm, role_hint=role_name)
        return {
            "ok": True,
            "email": email_norm,
            "role": role_name,
            "user_type": user_type,
            "access_scope": access_scope,
            "linked_clients": linked_clients,
            "effective_permissions": list(effective.get("effective_permissions") or []),
            "denied_permissions": list(effective.get("denied_permissions") or []),
            "is_super_admin": bool(effective.get("is_super_admin")),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update user access: {e}")


@router.patch("/users/{user_id}/archive")
def archive_user(
    user_id: int,
    body: dict = Body(...),
    _user: dict = Depends(_current_user)
):
    """Archive or unarchive a team member."""
    try:
        with get_conn() as con:
            # Check user exists
            exists = con.execute(
                "SELECT 1 FROM users WHERE user_id = ?",
                [int(user_id)]
            ).fetchone()
            
            if not exists:
                raise HTTPException(status_code=404, detail="User not found")
            
            archived = body.get("archived", True)
            user_name = _user.get("name", "system")
            
            if archived:
                con.execute(
                    """
                    UPDATE users 
                    SET archived = ?, archived_at = CURRENT_TIMESTAMP, archived_by = ?
                    WHERE user_id = ?
                    """,
                    [True, user_name, int(user_id)]
                )
            else:
                con.execute(
                    """
                    UPDATE users 
                    SET archived = ?, archived_at = NULL, archived_by = NULL
                    WHERE user_id = ?
                    """,
                    [False, int(user_id)]
                )
            affected_email = con.execute(
                "SELECT LOWER(COALESCE(email, '')) FROM users WHERE user_id = ? LIMIT 1",
                [int(user_id)],
            ).fetchone()
            if affected_email and affected_email[0]:
                invalidate_permission_cache(str(affected_email[0]))
            
            return {"ok": True, "message": "User archived successfully" if archived else "User restored successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Archive failed: {e}")


@router.post("/users")
def create_or_update_user(body: dict = Body(...), _user: dict = Depends(_current_user)):
    """Create or update a user (upsert by email)."""
    try:
        email = body.get("email", "").strip().lower()
        full_name = body.get("full_name", "").strip()
        role = body.get("role", "ReadOnly")
        position = body.get("position", None)
        position = str(position).strip() if position is not None else None
        if position == "":
            position = None
        mobile_phone = body.get("mobile_phone", None)
        mobile_phone = str(mobile_phone).strip() if mobile_phone is not None else None
        if mobile_phone == "":
            mobile_phone = None
        cost_per_hour_raw = body.get("cost_per_hour", None)
        sell_per_hour_raw = body.get("sell_per_hour", None)
        cost_per_hour = float(cost_per_hour_raw) if cost_per_hour_raw not in (None, "") else None
        sell_per_hour = float(sell_per_hour_raw) if sell_per_hour_raw not in (None, "") else None
        status = body.get("status", "Active")
        user_type = _normalize_user_type(body.get("user_type"))
        access_scope = _normalize_access_scope(user_type, body.get("access_scope"))
        password = str(body.get("password") or "")
        manual_password_provided = bool(password)
        actor = _actor_identifier(_user)
        is_new_user = False
        generated_temp_password = ""
        invite_expires_at: datetime | None = None
        
        if not email or not full_name:
            raise HTTPException(status_code=400, detail="Email and full name are required")
        
        with get_conn() as con:
            ensure_permission_schema(con)
            _ensure_users_position_column(con)
            _ensure_users_password_column(con)
            _ensure_users_invite_columns(con)
            _ensure_users_cost_sell_mobile_columns(con)
            existing = con.execute(
                """
                SELECT password_hash
                FROM users
                WHERE lower(email) = lower(%s)
                LIMIT 1
                """,
                [email],
            ).fetchone()

            if existing:
                con.execute(
                    """
                    UPDATE users
                    SET full_name = %s,
                        role = %s,
                        position = %s,
                        mobile_phone = %s,
                        cost_per_hour = %s,
                        sell_per_hour = %s,
                        status = %s,
                        user_type = %s,
                        access_scope = %s,
                        user_id = %s
                    WHERE lower(email) = lower(%s)
                    """,
                    [full_name, role, position, mobile_phone, cost_per_hour, sell_per_hour, status, user_type, access_scope, email, email],
                )
            else:
                is_new_user = True
                if not password:
                    generated_temp_password = "".join(
                        secrets.choice(string.ascii_letters + string.digits + "!@#$%^&*")
                        for _ in range(14)
                    )
                    password = generated_temp_password
                invite_mode = not manual_password_provided
                invited_at = datetime.now(timezone.utc) if invite_mode else None
                invite_expires_at = _invite_expiry(7) if invite_mode else None
                invited_by = actor if invite_mode else None
                con.execute(
                    """
                    INSERT INTO users (user_id, full_name, role, position, mobile_phone, cost_per_hour, sell_per_hour, email, status, invited_at, invited_by, invite_expires_at, user_type, access_scope)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    [
                        email,
                        full_name,
                        role,
                        position,
                        mobile_phone,
                        cost_per_hour,
                        sell_per_hour,
                        email,
                        status,
                        invited_at,
                        invited_by,
                        invite_expires_at,
                        user_type,
                        access_scope,
                    ],
                )

        if password:
            if len(password) < 8:
                raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
            set_user_password(email, password, force_change=True)
            with get_conn() as con:
                _ensure_users_invite_columns(con)
                con.execute(
                    """
                    UPDATE users
                    SET invite_expires_at = %s
                    WHERE lower(email) = lower(%s)
                    """,
                    [invite_expires_at if is_new_user else None, email],
                )

        email_result = None
        if is_new_user and generated_temp_password:
            email_result = _send_team_access_email(
                to_email=email,
                full_name=full_name,
                role=role,
                temporary_password=generated_temp_password,
                invite_expires_at=invite_expires_at,
                template_key="team_member_invite",
                sender_identifier=actor,
            )

        invalidate_permission_cache(email)
        response = {"ok": True, "message": "User saved successfully"}
        if generated_temp_password:
            response["temporary_password"] = generated_temp_password
            response["invite_expires_at"] = invite_expires_at.isoformat() if invite_expires_at else None
        if email_result:
            response["email_status"] = str(email_result.get("status") or "")
            if email_result.get("error"):
                response["email_error"] = str(email_result.get("error") or "")
        return response
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save user: {e}")


@router.patch("/users/{email}")
def update_user(email: str, body: dict = Body(...), _user: dict = Depends(_current_user)):
    """Update a user's details."""
    try:
        with get_conn() as con:
            ensure_permission_schema(con)
            _ensure_users_position_column(con)
            _ensure_users_password_column(con)
            _ensure_users_cost_sell_mobile_columns(con)
            updates = []
            params = []
            
            if "full_name" in body:
                updates.append("full_name = %s")
                params.append(body["full_name"])
            if "role" in body:
                updates.append("role = %s")
                params.append(body["role"])
            if "position" in body:
                updates.append("position = %s")
                params.append(body["position"])
            if "status" in body:
                updates.append("status = %s")
                params.append(body["status"])
            if "user_type" in body:
                user_type = _normalize_user_type(body.get("user_type"))
                updates.append("user_type = %s")
                params.append(user_type)
                if "access_scope" not in body:
                    updates.append("access_scope = %s")
                    params.append(_normalize_access_scope(user_type, None))
            if "access_scope" in body:
                scope_user_type = body.get("user_type")
                if scope_user_type is None:
                    current_row = con.execute(
                        "SELECT COALESCE(user_type, 'internal') FROM users WHERE LOWER(COALESCE(email, '')) = LOWER(%s) LIMIT 1",
                        [email.lower()],
                    ).fetchone()
                    scope_user_type = current_row[0] if current_row else "internal"
                updates.append("access_scope = %s")
                params.append(_normalize_access_scope(_normalize_user_type(scope_user_type), body.get("access_scope")))
            if "mobile_phone" in body:
                updates.append("mobile_phone = %s")
                mobile_phone = body.get("mobile_phone")
                if mobile_phone is None:
                    params.append(None)
                else:
                    mobile_phone = str(mobile_phone).strip()
                    params.append(mobile_phone or None)
            if "cost_per_hour" in body:
                updates.append("cost_per_hour = %s")
                v = body.get("cost_per_hour")
                params.append((float(v) if v not in (None, "") else None))
            if "sell_per_hour" in body:
                updates.append("sell_per_hour = %s")
                v = body.get("sell_per_hour")
                params.append((float(v) if v not in (None, "") else None))
            
            if not updates:
                return {"ok": True, "message": "No fields to update"}
            
            params.append(email.lower())
            query = f"UPDATE users SET {', '.join(updates)} WHERE email = %s"
            
            con.execute(query, params)

        password = str(body.get("password") or "")
        if password:
            if len(password) < 8:
                raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
            set_user_password(email, password, force_change=True)

        invalidate_permission_cache(email)
        
        return {"ok": True, "message": "User updated successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update user: {e}")


@router.patch("/users/{email}/password")
def admin_set_user_password(
    email: str,
    body: dict = Body(...),
    _user: dict = Depends(_current_user),
):
    """Set a new password for a user by email."""
    try:
        new_password = str(body.get("new_password") or "").strip()
        if len(new_password) < 8:
            raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

        with get_conn() as con:
            _ensure_users_password_column(con)
            exists = con.execute(
                "SELECT 1 FROM users WHERE lower(email) = lower(?) LIMIT 1",
                [email],
            ).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="User not found")

        ok = set_user_password(email, new_password, force_change=True)
        if not ok:
            raise HTTPException(status_code=500, detail="Failed to set password")

        return {"ok": True, "message": "Password updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to set password: {e}")


@router.post("/users/{email}/password/reset")
def admin_reset_user_password(
    email: str,
    _user: dict = Depends(_current_user),
):
    """Reset user password and return a temporary password."""
    try:
        alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
        temp_password = "".join(secrets.choice(alphabet) for _ in range(14))
        now = datetime.now(timezone.utc)
        expiry = _invite_expiry(7)

        full_name = email
        role = "Team Member"
        with get_conn() as con:
            _ensure_users_password_column(con)
            _ensure_users_invite_columns(con)
            row = con.execute(
                "SELECT full_name, role FROM users WHERE lower(email) = lower(?) LIMIT 1",
                [email],
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="User not found")
            full_name = str(row[0] or "").strip() or email
            role = str(row[1] or "").strip() or "Team Member"

        ok = set_user_password(email, temp_password, force_change=True)
        if not ok:
            raise HTTPException(status_code=500, detail="Failed to reset password")

        with get_conn() as con:
            _ensure_users_invite_columns(con)
            con.execute(
                """
                UPDATE users
                SET invited_at = %s,
                    invited_by = %s,
                    invite_expires_at = %s
                WHERE lower(email) = lower(%s)
                """,
                [now, _actor_identifier(_user), expiry, email],
            )

        email_result = _send_team_access_email(
            to_email=email,
            full_name=full_name,
            role=role,
            temporary_password=temp_password,
            invite_expires_at=expiry,
            template_key="team_member_password_reset",
            sender_identifier=_actor_identifier(_user),
        )

        return {
            "ok": True,
            "message": "Temporary password generated",
            "temporary_password": temp_password,
            "invite_expires_at": expiry.isoformat(),
            "email_status": str(email_result.get("status") or ""),
            "email_error": str(email_result.get("error") or "") if email_result.get("error") else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reset password: {e}")


@router.post("/users/{email}/reinvite")
def admin_reinvite_user(
    email: str,
    _user: dict = Depends(_current_user),
):
    """Re-invite a user by generating a fresh temporary password and invite expiry."""
    try:
        alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
        temp_password = "".join(secrets.choice(alphabet) for _ in range(14))
        expiry = _invite_expiry(7)
        now = datetime.now(timezone.utc)

        full_name = email
        role = "Team Member"
        with get_conn() as con:
            _ensure_users_password_column(con)
            _ensure_users_invite_columns(con)
            row = con.execute(
                "SELECT full_name, role FROM users WHERE lower(email) = lower(?) LIMIT 1",
                [email],
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="User not found")
            full_name = str(row[0] or "").strip() or email
            role = str(row[1] or "").strip() or "Team Member"

        ok = set_user_password(email, temp_password, force_change=True)
        if not ok:
            raise HTTPException(status_code=500, detail="Failed to re-invite user")

        with get_conn() as con:
            _ensure_users_invite_columns(con)
            con.execute(
                """
                UPDATE users
                SET invited_at = %s,
                    invited_by = %s,
                    invite_expires_at = %s
                WHERE lower(email) = lower(%s)
                """,
                [now, _actor_identifier(_user), expiry, email],
            )

        email_result = _send_team_access_email(
            to_email=email,
            full_name=full_name,
            role=role,
            temporary_password=temp_password,
            invite_expires_at=expiry,
            template_key="team_member_reinvite",
            sender_identifier=_actor_identifier(_user),
        )

        return {
            "ok": True,
            "message": "User re-invited",
            "temporary_password": temp_password,
            "invite_expires_at": expiry.isoformat(),
            "email_status": str(email_result.get("status") or ""),
            "email_error": str(email_result.get("error") or "") if email_result.get("error") else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to re-invite user: {e}")


# =========================
# DATASETS & FACTORS
# =========================

@router.get("/datasets")
def list_datasets(_user: dict = Depends(_current_user)):
    """List all datasets with factor counts."""
    try:
        with get_conn() as con:
            df = con.execute(
                """
                SELECT d.dataset_id, d.name, d.source, d.analysis_type, d.country, d.region, d.currency, 
                       d.year, d.version, d.license, d.notes, d.valid_from, d.valid_to,
                       d.archived, d.archived_at, d.archived_by,
                       COUNT(f.db_id) as factor_count
                FROM datasets d
                LEFT JOIN factor_lookup f ON f.dataset_id = d.dataset_id
                GROUP BY d.dataset_id, d.name, d.source, d.analysis_type, d.country, d.region, d.currency,
                         d.year, d.version, d.license, d.notes, d.valid_from, d.valid_to,
                         d.archived, d.archived_at, d.archived_by
                ORDER BY d.year DESC, d.name
                """
            ).df()
        
        items = []
        if df is not None and not df.empty:
            for _, r in df.iterrows():
                items.append({
                    "dataset_id": int(r.get("dataset_id")),
                    "name": str(r.get("name") or ""),
                    "source": str(r.get("source") or ""),
                    "analysis_type": str(r.get("analysis_type") or ""),
                    "country": str(r.get("country") or ""),
                    "region": str(r.get("region") or ""),
                    "currency": str(r.get("currency") or ""),
                    "year": int(r.get("year")) if r.get("year") else None,
                    "version": str(r.get("version") or ""),
                    "valid_from": str(r.get("valid_from")) if r.get("valid_from") else None,
                    "valid_to": str(r.get("valid_to")) if r.get("valid_to") else None,
                    "archived": bool(r.get("archived")) if r.get("archived") is not None else False,
                    "archived_at": str(r.get("archived_at")) if r.get("archived_at") else None,
                    "archived_by": str(r.get("archived_by")) if r.get("archived_by") else None,
                    "factor_count": int(r.get("factor_count") or 0),
                })
        
        return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list datasets: {e}")


@router.post("/datasets")
def create_dataset(body: dict = Body(...), _user: dict = Depends(_current_user)):
    """Create a new dataset."""
    try:
        name = body.get("name", "").strip()
        source = body.get("source", "").strip()
        
        if not name or not source:
            raise HTTPException(status_code=400, detail="Name and source are required")
        
        with get_conn() as con:
            row = con.execute(
                """
                INSERT INTO datasets
                (name, source, analysis_type, country, region, currency, year, version, license, notes, valid_from, valid_to)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING dataset_id
                """,
                [
                    name,
                    source,
                    body.get("analysis_type", "Activity"),
                    body.get("country", "UK"),
                    body.get("region"),
                    body.get("currency", "GBP"),
                    body.get("year"),
                    body.get("version"),
                    body.get("license"),
                    body.get("notes"),
                    body.get("valid_from"),
                    body.get("valid_to"),
                ],
            ).fetchone()
            
            dataset_id = int(row[0])
        
        return {"ok": True, "dataset_id": dataset_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create dataset: {e}")


@router.put("/datasets/{dataset_id}")
def update_dataset(
    dataset_id: int,
    body: dict = Body(...),
    _user: dict = Depends(_current_user)
):
    """Update an existing dataset."""
    try:
        with get_conn() as con:
            # Check if dataset exists
            existing = con.execute(
                "SELECT dataset_id FROM datasets WHERE dataset_id = %s",
                [dataset_id]
            ).fetchone()
            
            if not existing:
                raise HTTPException(status_code=404, detail=f"Dataset {dataset_id} not found")
            
            # Update dataset
            con.execute(
                """
                UPDATE datasets
                SET name = %s, source = %s, analysis_type = %s, country = %s,
                    region = %s, currency = %s, year = %s, version = %s,
                    license = %s, notes = %s, valid_from = %s, valid_to = %s
                WHERE dataset_id = %s
                """,
                [
                    body.get("name"),
                    body.get("source"),
                    body.get("analysis_type"),
                    body.get("country"),
                    body.get("region"),
                    body.get("currency"),
                    body.get("year"),
                    body.get("version"),
                    body.get("license"),
                    body.get("notes"),
                    body.get("valid_from"),
                    body.get("valid_to"),
                    dataset_id,
                ]
            )
        
        return {"ok": True, "message": "Dataset updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update dataset: {e}")


@router.patch("/datasets/{dataset_id}/archive")
def archive_dataset(
    dataset_id: int,
    body: dict = Body(...),
    _user: dict = Depends(_current_user)
):
    """Archive or unarchive a dataset."""
    try:
        archived = body.get("archived", True)
        user_email = _user.get("user", "admin")
        
        with get_conn() as con:
            # Check if dataset exists
            existing = con.execute(
                "SELECT dataset_id FROM datasets WHERE dataset_id = %s",
                [dataset_id]
            ).fetchone()
            
            if not existing:
                raise HTTPException(status_code=404, detail=f"Dataset {dataset_id} not found")
            
            if archived:
                # Archive the dataset
                con.execute(
                    """
                    UPDATE datasets
                    SET archived = TRUE, archived_at = NOW(), archived_by = %s
                    WHERE dataset_id = %s
                    """,
                    [user_email, dataset_id]
                )
                message = "Dataset archived successfully"
            else:
                # Unarchive the dataset
                con.execute(
                    """
                    UPDATE datasets
                    SET archived = FALSE, archived_at = NULL, archived_by = NULL
                    WHERE dataset_id = %s
                    """,
                    [dataset_id]
                )
                message = "Dataset unarchived successfully"
        
        return {"ok": True, "message": message}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to archive dataset: {e}")


@router.delete("/datasets/{dataset_id}")
def delete_dataset(
    dataset_id: int,
    _user: dict = Depends(_current_user)
):
    """Permanently delete a dataset. Admin only. Should only be used on archived datasets."""
    try:
        with get_conn() as con:
            # Check if dataset exists and is archived
            existing = con.execute(
                "SELECT archived FROM datasets WHERE dataset_id = %s",
                [dataset_id]
            ).fetchone()
            
            if not existing:
                raise HTTPException(status_code=404, detail=f"Dataset {dataset_id} not found")
            
            # Delete associated factors first
            con.execute(
                "DELETE FROM factor_lookup WHERE dataset_id = %s",
                [dataset_id]
            )
            
            # Delete the dataset
            con.execute(
                "DELETE FROM datasets WHERE dataset_id = %s",
                [dataset_id]
            )
        
        return {"ok": True, "message": "Dataset permanently deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete dataset: {e}")


@router.get("/datasets/{dataset_id}/export")
def export_dataset(
    dataset_id: int,
    _user: dict = Depends(_current_user)
):
    """Export all factors from a dataset as CSV."""
    try:
        import io
        import csv
        from fastapi.responses import StreamingResponse
        
        with get_conn() as con:
            # Get dataset info
            dataset_row = con.execute(
                "SELECT name, source, analysis_type, year FROM datasets WHERE dataset_id = %s",
                [dataset_id]
            ).fetchone()
            
            if not dataset_row:
                raise HTTPException(status_code=404, detail=f"Dataset {dataset_id} not found")
            
            dataset_name = dataset_row[0]
            
            # Get all factors for this dataset
            df = con.execute(
                """
                SELECT original_id, scope, category, level_1, level_2, level_3, level_4,
                       column_text, report_label, uom, ghg_unit, factor, year, 
                       valid_from, valid_to, source, region, method
                FROM factor_lookup
                WHERE dataset_id = %s
                ORDER BY scope, COALESCE(category, level_1), level_2, level_3, original_id
                """,
                [dataset_id]
            ).df()
        
        if df is None or df.empty:
            raise HTTPException(status_code=404, detail=f"No factors found for dataset {dataset_id}")
        
        # Convert to CSV
        output = io.StringIO()
        df.to_csv(output, index=False)
        output.seek(0)
        
        # Create filename
        safe_name = dataset_name.replace(" ", "_").replace("/", "-")
        filename = f"{safe_name}_dataset_{dataset_id}.csv"
        
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to export dataset: {e}")


@router.get("/factors")
def search_factors(
    q: str = "",
    dataset_id: int | None = None,
    limit: int = 100,
    _user: dict = Depends(_current_user)
):
    """Search conversion factors (excludes archived datasets)."""
    try:
        with get_conn() as con:
            if dataset_id:
                df = con.execute(
                    """
                    SELECT fl.db_id, fl.original_id, d.name AS dataset, d.analysis_type, d.country,
                           fl.year, fl.scope, fl.category, fl.level_1, fl.level_2, fl.level_3, fl.level_4,
                           fl.column_text, fl.uom, fl.ghg_unit, fl.factor, fl.report_label
                    FROM factor_lookup fl
                    LEFT JOIN datasets d ON d.dataset_id = fl.dataset_id
                    WHERE fl.dataset_id = %s
                          AND (
                              fl.column_text ILIKE %s
                              OR COALESCE(fl.report_label, '') ILIKE %s
                              OR COALESCE(fl.category, fl.level_1, '') ILIKE %s
                          )
                          AND (d.archived IS NULL OR d.archived = FALSE)
                    ORDER BY fl.year DESC, COALESCE(fl.category, fl.level_1), fl.column_text
                    LIMIT %s
                    """,
                    [dataset_id, f"%{q}%", f"%{q}%", f"%{q}%", limit],
                ).df()
            else:
                df = con.execute(
                    """
                    SELECT fl.db_id, fl.original_id, d.name AS dataset, d.analysis_type, d.country,
                           fl.year, fl.scope, fl.category, fl.level_1, fl.level_2, fl.level_3, fl.level_4,
                           fl.column_text, fl.uom, fl.ghg_unit, fl.factor, fl.report_label
                    FROM factor_lookup fl
                    LEFT JOIN datasets d ON d.dataset_id = fl.dataset_id
                    WHERE (
                              fl.column_text ILIKE %s
                              OR COALESCE(fl.report_label, '') ILIKE %s
                              OR COALESCE(fl.category, fl.level_1, '') ILIKE %s
                          )
                          AND (d.archived IS NULL OR d.archived = FALSE)
                    ORDER BY fl.year DESC, COALESCE(fl.category, fl.level_1), fl.column_text
                    LIMIT %s
                    """,
                    [f"%{q}%", f"%{q}%", f"%{q}%", limit],
                ).df()
        
        items = []
        if df is not None and not df.empty:
            items = df.to_dict(orient="records")
        
        return {"items": items, "count": len(items)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to search factors: {e}")


# =========================
# LOOKUPS MANAGEMENT
# =========================

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
        "bd_bin_reasons_lookup"
    ]
    
    if table_name not in allowed_tables:
        raise HTTPException(status_code=400, detail="Invalid table name")
    org_id = require_org(_user) if table_name in _ORG_SCOPED_LOOKUP_TABLES else None
    
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
            _ensure_lookup_table_once(con, table_name)
            has_active_flag = _lookup_has_active_flag(con, query_table)
            active_filter = ""
            if has_active_flag and not include_archived:
                active_filter = "WHERE COALESCE(is_active, TRUE) = TRUE"
            if org_id is not None:
                active_filter = f"{active_filter} AND org_id = %s" if active_filter else "WHERE org_id = %s"
                active_params = [org_id]
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
        "bd_bin_reasons_lookup"
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
    }
    id_col = id_col_map.get(table_name)
    if not id_col:
        raise HTTPException(status_code=400, detail="Unknown table")

    try:
        with get_conn() as con:
            _ensure_lookup_table(con, table_name)
            org_id = require_org(_user) if table_name in _ORG_SCOPED_LOOKUP_TABLES else None
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
        "bd_bin_reasons_lookup"
    ]
    
    if table_name not in allowed_tables:
        raise HTTPException(status_code=400, detail="Invalid table name")
    
    try:
        with get_conn() as con:
            _ensure_lookup_table(con, table_name)
            org_id = require_org(_user) if table_name in _ORG_SCOPED_LOOKUP_TABLES else None
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
            elif table_name in _ORG_SCOPED_LOOKUP_TABLES:
                name = str(body.get("name", "")).strip()
                if not name:
                    raise HTTPException(status_code=400, detail="Name is required")

                columns = ["org_id", "name", "is_active"]
                values = [org_id, name, body.get("is_active", True)]
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
        "bd_bin_reasons_lookup"
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
    }
    
    id_col = id_col_map.get(table_name)
    if not id_col:
        raise HTTPException(status_code=400, detail="Unknown table")
    
    try:
        with get_conn() as con:
            _ensure_lookup_table(con, table_name)
            org_id = require_org(_user) if table_name in _ORG_SCOPED_LOOKUP_TABLES else None
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
            
            # Allow updating estimated_hours for job_types
            if table_name == "job_types" and "estimated_hours" in body:
                updates.append("estimated_hours = %s")
                params.append(float(body["estimated_hours"]))
            
            if not updates:
                return {"ok": True, "message": "No fields to update"}
            
            params.append(int(item_id))
            if org_id is not None:
                params.append(org_id)
                query = f"UPDATE {table_name} SET {', '.join(updates)} WHERE {id_col} = %s AND org_id = %s"
            else:
                query = f"UPDATE {table_name} SET {', '.join(updates)} WHERE {id_col} = %s"
            
            con.execute(query, params)
        
        return {"ok": True, "message": "Item updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update item: {e}")


# =========================
# SUPPLIERS
# =========================

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

@router.get("/archived-clients")
def list_archived_clients(q: str = "", _user: dict = Depends(_current_user)):
    """List archived clients."""
    try:
        with get_conn() as con:
            df = con.execute(
                """
                SELECT db_id, client_name, industry, status
                FROM clients
                WHERE status = 'Archived' AND client_name ILIKE %s
                ORDER BY client_name
                LIMIT 100
                """,
                [f"%{q}%"],
            ).df()
        
        items = []
        if df is not None and not df.empty:
            for _, r in df.iterrows():
                items.append({
                    "db_id": int(r.get("db_id")),
                    "client_name": str(r.get("client_name") or ""),
                    "industry": str(r.get("industry") or ""),
                    "status": str(r.get("status") or ""),
                })
        
        return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list archived clients: {e}")


@router.patch("/archived-clients/{client_id}/reactivate")
def reactivate_client(client_id: int, _user: dict = Depends(_current_user)):
    """Reactivate an archived client."""
    try:
        with get_conn() as con:
            con.execute(
                "UPDATE clients SET status = 'Active' WHERE db_id = %s",
                [int(client_id)],
            )
        
        return {"ok": True, "message": "Client reactivated successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reactivate client: {e}")


@router.delete("/archived-clients/{client_id}")
def permanently_delete_archived_client(client_id: int, _user: dict = Depends(_current_user)):
    """Permanently delete an archived client if there are no dependent financial/job records."""
    try:
        with get_conn() as con:
            client_row = con.execute(
                "SELECT client_name, status FROM clients WHERE db_id = %s",
                [int(client_id)],
            ).fetchone()
            if not client_row:
                raise HTTPException(status_code=404, detail="Client not found")

            client_name = str(client_row[0] or "")
            status = str(client_row[1] or "")
            if status.lower() != "archived":
                raise HTTPException(
                    status_code=400,
                    detail="Client must be archived before permanent deletion",
                )

            deps = {
                "jobs": int(
                    (con.execute("SELECT COUNT(*) FROM jobs WHERE client_db_id = %s", [int(client_id)]).fetchone() or [0])[0]
                ),
                "quotes": int(
                    (con.execute("SELECT COUNT(*) FROM quotes WHERE client_db_id = %s", [int(client_id)]).fetchone() or [0])[0]
                ),
                "invoices": int(
                    (con.execute("SELECT COUNT(*) FROM invoices WHERE client_db_id = %s", [int(client_id)]).fetchone() or [0])[0]
                ),
                "spend_mappings": int(
                    (
                        con.execute(
                            "SELECT COUNT(*) FROM client_spend_mappings WHERE client_db_id = %s",
                            [int(client_id)],
                        ).fetchone()
                        or [0]
                    )[0]
                ),
            }

            if any(v > 0 for v in deps.values()):
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "Cannot permanently delete client with dependent records: "
                        f"jobs={deps['jobs']}, quotes={deps['quotes']}, invoices={deps['invoices']}, "
                        f"spend_mappings={deps['spend_mappings']}"
                    ),
                )

            # Safe-to-delete child rows without financial/job dependency.
            con.execute("DELETE FROM client_contacts WHERE client_db_id = %s", [int(client_id)])
            con.execute("DELETE FROM client_sites WHERE client_db_id = %s", [int(client_id)])
            con.execute("DELETE FROM clients WHERE db_id = %s", [int(client_id)])

        return {"ok": True, "message": f"Client '{client_name}' permanently deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to permanently delete archived client: {e}")


@router.post("/datasets/{dataset_id}/upload-factors")
async def upload_dataset_factors(
    dataset_id: int,
    file: UploadFile = File(...),
    replace: bool = True,
    _user: dict = Depends(_current_user)
):
    """
    Upload a CSV file containing conversion factors for a dataset.
    
    Args:
        dataset_id: The ID of the dataset to upload factors to
        file: CSV file containing conversion factors
        replace: Full-replace flag. This endpoint always replaces existing factors for the dataset.
    """
    try:
        # Verify dataset exists
        with get_conn() as con:
            dataset_row = con.execute(
                "SELECT name FROM datasets WHERE dataset_id = %s",
                [dataset_id]
            ).fetchone()
            
            if not dataset_row:
                raise HTTPException(status_code=404, detail=f"Dataset {dataset_id} not found")
        
        # Save uploaded file to temporary location
        with tempfile.NamedTemporaryFile(mode='wb', suffix='.csv', delete=False) as tmp_file:
            content = await file.read()
            tmp_file.write(content)
            tmp_path = Path(tmp_file.name)
        
        try:
            report = await run_in_threadpool(
                _ingest_csv_report_for_dataset,
                tmp_path,
                replace=True,
                dataset_id=dataset_id,
            )
            
            return {
                "ok": True,
                "dataset_id": dataset_id,
                "factors_imported": int(report.get("accepted_rows") or 0),
                "rows_rejected": int(report.get("rejected_rows") or 0),
                "rejected_details": report.get("rejected_details") or [],
                "deleted_rows": int(report.get("deleted_rows") or 0),
                "replaced": True,
                "message": (
                    f"Successfully imported {int(report.get('accepted_rows') or 0)} conversion factors"
                    + (
                        f"; rejected {int(report.get('rejected_rows') or 0)} invalid row(s)"
                        if int(report.get("rejected_rows") or 0) > 0
                        else ""
                    )
                ),
            }
            
        finally:
            # Clean up temporary file
            if tmp_path.exists():
                tmp_path.unlink()
        
    except HTTPException:
        raise
    except Exception as e:
        from ingest_conversion_factors import DatasetReplacementBlocked

        if isinstance(e, DatasetReplacementBlocked):
            raise HTTPException(
                status_code=409,
                detail={
                    "message": str(e),
                    "dependency_summary": e.dependency_summary,
                },
            )
        raise HTTPException(status_code=500, detail=f"Failed to upload factors: {str(e)}")


@router.post("/datasets/import-conversion-factors-workbook")
async def import_conversion_factors_workbook(
    file: UploadFile = File(...),
    replace: bool = True,
    _user: dict = Depends(_current_user),
):
    """
    Import a year-split XLSX workbook into the existing UK datasets.

    The workbook is merged in place by year, keeping referenced factor DB IDs stable.
    """
    tmp_path: Path | None = None
    try:
        if not file.filename or not str(file.filename).lower().endswith(".xlsx"):
            raise HTTPException(status_code=400, detail="Only .xlsx files are supported")

        with tempfile.NamedTemporaryFile(mode="wb", suffix=".xlsx", delete=False) as tmp_file:
            content = await file.read()
            tmp_file.write(content)
            tmp_path = Path(tmp_file.name)

        try:
            report = await run_in_threadpool(
                ingest_workbook_with_report,
                tmp_path,
                replace=bool(replace),
            )
            totals = {
                "accepted": sum(int(item.get("accepted_rows") or 0) for item in report),
                "updated": sum(int(item.get("updated_rows") or 0) for item in report),
                "inserted": sum(int(item.get("inserted_rows") or 0) for item in report),
                "deleted": sum(int(item.get("deleted_rows") or 0) for item in report),
                "blocked": sum(int(item.get("blocked_rows") or 0) for item in report),
            }
            return {
                "ok": True,
                "sheets": report,
                "totals": totals,
                "message": (
                    f"Imported workbook: {totals['accepted']} valid rows, "
                    f"{totals['updated']} updated, {totals['inserted']} inserted"
                    + (f", {totals['deleted']} deleted" if totals["deleted"] else "")
                    + (f", {totals['blocked']} referenced rows retained" if totals["blocked"] else "")
                ),
            }
        finally:
            if tmp_path and tmp_path.exists():
                tmp_path.unlink()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to import workbook: {str(e)}")


# =========================
# JOB ITEMS MANAGEMENT
# =========================

def _ensure_job_items_table(con) -> None:
    """Ensure job_items table exists."""
    try:
        con.execute("""
            CREATE TABLE IF NOT EXISTS public.job_items (
              item_id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
              item_code text UNIQUE NOT NULL,
              item_name text NOT NULL,
              description text,
              notes text,
              category text,
              unit text DEFAULT 'day',
              estimated_hours numeric(10,2) DEFAULT 0,
              vat_rate_id integer REFERENCES vat_rates_lookup(vat_rate_id),
              cost_amount numeric(12,2) NOT NULL DEFAULT 0,
              cost_currency text DEFAULT 'GBP',
              sell_amount numeric(12,2) NOT NULL DEFAULT 0,
              sell_currency text DEFAULT 'GBP',
              vat_rate numeric(5,2) DEFAULT 20.00,
              is_active boolean NOT NULL DEFAULT true,
              sort_order integer DEFAULT 0,
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now()
            )
        """)
    except Exception:
        pass
    try:
        con.execute("ALTER TABLE public.job_items ADD COLUMN IF NOT EXISTS notes text")
    except Exception:
        pass
    
    # Create junction table if not exists
    try:
        con.execute("""
            CREATE TABLE IF NOT EXISTS public.job_type_items (
              job_type_item_id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
              job_type_id integer NOT NULL REFERENCES job_types(job_type_id) ON DELETE CASCADE,
              item_id integer NOT NULL REFERENCES job_items(item_id) ON DELETE CASCADE,
              quantity numeric(10,2) DEFAULT 1,
              is_required boolean DEFAULT true,
              sort_order integer DEFAULT 0,
              UNIQUE(job_type_id, item_id)
            )
        """)
    except Exception:
        pass

@router.get("/job-items")
def list_job_items(
    _user: dict = Depends(_current_user),
    include_inactive: bool = False
):
    """List all job items."""
    try:
        def _safe_int(value, default=None):
            if value is None:
                return default
            txt = str(value).strip().lower()
            if txt in ("", "nan", "none", "null"):
                return default
            try:
                return int(value)
            except Exception:
                return default

        with get_conn() as con:
            _ensure_job_items_table(con)
            if include_inactive:
                df = con.execute(
                    """
                    SELECT item_id, item_code, item_name, description, category, unit,
                           notes,
                           estimated_hours, vat_rate_id,
                           cost_amount, cost_currency, sell_amount, sell_currency,
                           vat_rate, is_active, sort_order, created_at, updated_at
                    FROM job_items
                    ORDER BY sort_order, item_name
                    """
                ).df()
            else:
                df = con.execute(
                    """
                    SELECT item_id, item_code, item_name, description, category, unit,
                           notes,
                           estimated_hours, vat_rate_id,
                           cost_amount, cost_currency, sell_amount, sell_currency,
                           vat_rate, is_active, sort_order, created_at, updated_at
                    FROM job_items
                    WHERE is_active = true
                    ORDER BY sort_order, item_name
                    """
                ).df()
        
        items = []
        if df is not None and not df.empty:
            for _, r in df.iterrows():
                items.append({
                    "item_id": _safe_int(r.get("item_id"), 0),
                    "item_code": str(r.get("item_code") or ""),
                    "item_name": str(r.get("item_name") or ""),
                    "description": str(r.get("description") or ""),
                    "notes": str(r.get("notes") or ""),
                    "category": str(r.get("category") or ""),
                    "unit": str(r.get("unit") or "day"),
                    "estimated_hours": float(r.get("estimated_hours") or 0),
                    "vat_rate_id": _safe_int(r.get("vat_rate_id"), None),
                    "cost_amount": float(r.get("cost_amount") or 0),
                    "cost_currency": str(r.get("cost_currency") or "GBP"),
                    "sell_amount": float(r.get("sell_amount") or 0),
                    "sell_currency": str(r.get("sell_currency") or "GBP"),
                    "vat_rate": float(r.get("vat_rate") or 20),
                    "is_active": bool(r.get("is_active", True)),
                    "sort_order": _safe_int(r.get("sort_order"), 0),
                    "created_at": str(r.get("created_at")) if r.get("created_at") else None,
                    "updated_at": str(r.get("updated_at")) if r.get("updated_at") else None,
                })
        
        return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list job items: {e}")


@router.get("/job-items/{item_id}")
def get_job_item(item_id: int, _user: dict = Depends(_current_user)):
    """Get a single job item by ID."""
    try:
        with get_conn() as con:
            df = con.execute(
                """
                SELECT item_id, item_code, item_name, description, category, unit,
                       notes,
                       estimated_hours, vat_rate_id,
                       cost_amount, cost_currency, sell_amount, sell_currency,
                       vat_rate, is_active, sort_order, created_at, updated_at
                FROM job_items
                WHERE item_id = %s
                """,
                [item_id]
            ).df()
        
        if df is None or df.empty:
            raise HTTPException(status_code=404, detail="Job item not found")
        
        r = df.iloc[0]
        return {
            "item_id": int(r.get("item_id")),
            "item_code": str(r.get("item_code") or ""),
            "item_name": str(r.get("item_name") or ""),
            "description": str(r.get("description") or ""),
            "notes": str(r.get("notes") or ""),
            "category": str(r.get("category") or ""),
            "unit": str(r.get("unit") or "day"),
            "estimated_hours": float(r.get("estimated_hours") or 0),
            "vat_rate_id": int(r.get("vat_rate_id")) if r.get("vat_rate_id") else None,
            "cost_amount": float(r.get("cost_amount") or 0),
            "cost_currency": str(r.get("cost_currency") or "GBP"),
            "sell_amount": float(r.get("sell_amount") or 0),
            "sell_currency": str(r.get("sell_currency") or "GBP"),
            "vat_rate": float(r.get("vat_rate") or 20),
            "is_active": bool(r.get("is_active", True)),
            "sort_order": int(r.get("sort_order") or 0),
            "created_at": str(r.get("created_at")) if r.get("created_at") else None,
            "updated_at": str(r.get("updated_at")) if r.get("updated_at") else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get job item: {e}")


@router.post("/job-items")
def create_job_item(body: dict = Body(...), _user: dict = Depends(_current_user)):
    """Create a new job item."""
    try:
        item_code = body.get("item_code", "").strip().upper()
        item_name = body.get("item_name", "").strip()
        
        if not item_code or not item_name:
            raise HTTPException(status_code=400, detail="Item code and name are required")
        
        with get_conn() as con:
            row = con.execute(
                """
                INSERT INTO job_items
                (item_code, item_name, description, notes, category, unit, estimated_hours, vat_rate_id,
                 cost_amount, cost_currency, sell_amount, sell_currency,
                 vat_rate, is_active, sort_order)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING item_id
                """,
                [
                    item_code,
                    item_name,
                    body.get("description", ""),
                    body.get("notes", ""),
                    body.get("category", ""),
                    body.get("unit", "day"),
                    body.get("estimated_hours", 0),
                    body.get("vat_rate_id"),
                    body.get("cost_amount", 0),
                    body.get("cost_currency", "GBP"),
                    body.get("sell_amount", 0),
                    body.get("sell_currency", "GBP"),
                    body.get("vat_rate", 20),
                    body.get("is_active", True),
                    body.get("sort_order", 0),
                ],
            ).fetchone()
            
            item_id = int(row[0])
        
        return {"ok": True, "item_id": item_id, "message": "Job item created successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create job item: {e}")


@router.put("/job-items/{item_id}")
def update_job_item(
    item_id: int,
    body: dict = Body(...),
    _user: dict = Depends(_current_user)
):
    """Update an existing job item."""
    try:
        with get_conn() as con:
            # Check if item exists
            existing = con.execute(
                "SELECT item_id FROM job_items WHERE item_id = %s",
                [item_id]
            ).fetchone()
            
            if not existing:
                raise HTTPException(status_code=404, detail=f"Job item {item_id} not found")
            
            # Build update query dynamically
            updates = []
            params = []
            
            allowed_fields = [
                "item_code", "item_name", "description", "notes", "category", "unit",
                "estimated_hours", "vat_rate_id",
                "cost_amount", "cost_currency", "sell_amount", "sell_currency",
                "vat_rate", "is_active", "sort_order"
            ]
            
            for field in allowed_fields:
                if field in body:
                    updates.append(f"{field} = %s")
                    params.append(body[field])
            
            if not updates:
                return {"ok": True, "message": "No fields to update"}
            
            # Add updated_at timestamp
            updates.append("updated_at = NOW()")
            
            params.append(item_id)
            query = f"UPDATE job_items SET {', '.join(updates)} WHERE item_id = %s"
            
            con.execute(query, params)
        
        return {"ok": True, "message": "Job item updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update job item: {e}")


@router.patch("/job-items/{item_id}")
def patch_job_item(
    item_id: int,
    body: dict = Body(...),
    _user: dict = Depends(_current_user)
):
    """Partially update a job item (archive/deactivate)."""
    try:
        with get_conn() as con:
            # Check if item exists
            existing = con.execute(
                "SELECT item_id FROM job_items WHERE item_id = %s",
                [item_id]
            ).fetchone()
            
            if not existing:
                raise HTTPException(status_code=404, detail=f"Job item {item_id} not found")
            
            updates = []
            params = []
            
            if "is_active" in body:
                updates.append("is_active = %s")
                params.append(body["is_active"])
                updates.append("updated_at = NOW()")
            
            if "sort_order" in body:
                updates.append("sort_order = %s")
                params.append(body["sort_order"])
            
            if not updates:
                return {"ok": True, "message": "No fields to update"}
            
            params.append(item_id)
            query = f"UPDATE job_items SET {', '.join(updates)} WHERE item_id = %s"
            
            con.execute(query, params)
        
        return {"ok": True, "message": "Job item updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update job item: {e}")


@router.delete("/job-items/{item_id}")
def delete_job_item(item_id: int, _user: dict = Depends(_current_user)):
    """Delete a job item. Only inactive items can be deleted."""
    try:
        with get_conn() as con:
            # Check if item exists and is inactive
            existing = con.execute(
                "SELECT item_id, is_active FROM job_items WHERE item_id = %s",
                [item_id]
            ).fetchone()
            
            if not existing:
                raise HTTPException(status_code=404, detail=f"Job item {item_id} not found")
            
            if existing[1]:  # is_active is True
                raise HTTPException(
                    status_code=400,
                    detail="Cannot delete active job items. First deactivate the item."
                )
            
            # Delete the item
            con.execute("DELETE FROM job_items WHERE item_id = %s", [item_id])
        
        return {"ok": True, "message": "Job item deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete job item: {e}")


# Job Type Items (Many-to-Many relationship)
@router.get("/job-types/{job_type_id}/items")
def get_job_type_items(job_type_id: int, _user: dict = Depends(_current_user)):
    """Get all job items associated with a job type."""
    try:
        with get_conn() as con:
            df = con.execute(
                """
                SELECT jti.job_type_item_id, jti.job_type_id, jti.item_id, jti.quantity,
                       jti.is_required, jti.sort_order,
                       ji.item_code, ji.item_name, ji.description, ji.category, ji.unit,
                       ji.cost_amount, ji.cost_currency, ji.sell_amount, ji.sell_currency,
                       ji.vat_rate
                FROM job_type_items jti
                JOIN job_items ji ON ji.item_id = jti.item_id
                WHERE jti.job_type_id = %s
                ORDER BY jti.sort_order, ji.item_name
                """,
                [job_type_id]
            ).df()
        
        items = []
        if df is not None and not df.empty:
            for _, r in df.iterrows():
                items.append({
                    "job_type_item_id": int(r.get("job_type_item_id")),
                    "job_type_id": int(r.get("job_type_id")),
                    "item_id": int(r.get("item_id")),
                    "quantity": float(r.get("quantity") or 1),
                    "is_required": bool(r.get("is_required", True)),
                    "sort_order": int(r.get("sort_order") or 0),
                    "item_code": str(r.get("item_code") or ""),
                    "item_name": str(r.get("item_name") or ""),
                    "description": str(r.get("description") or ""),
                    "category": str(r.get("category") or ""),
                    "unit": str(r.get("unit") or "day"),
                    "cost_amount": float(r.get("cost_amount") or 0),
                    "cost_currency": str(r.get("cost_currency") or "GBP"),
                    "sell_amount": float(r.get("sell_amount") or 0),
                    "sell_currency": str(r.get("sell_currency") or "GBP"),
                    "vat_rate": float(r.get("vat_rate") or 20),
                })
        
        return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get job type items: {e}")


@router.post("/job-types/{job_type_id}/items")
def add_job_type_item(
    job_type_id: int,
    body: dict = Body(...),
    _user: dict = Depends(_current_user)
):
    """Add a job item to a job type."""
    try:
        item_id = body.get("item_id")
        
        if not item_id:
            raise HTTPException(status_code=400, detail="item_id is required")
        
        with get_conn() as con:
            # Check if job type exists
            jt_exists = con.execute(
                "SELECT job_type_id FROM job_types WHERE job_type_id = %s",
                [job_type_id]
            ).fetchone()
            
            if not jt_exists:
                raise HTTPException(status_code=404, detail=f"Job type {job_type_id} not found")
            
            # Check if item exists
            item_exists = con.execute(
                "SELECT item_id FROM job_items WHERE item_id = %s",
                [item_id]
            ).fetchone()
            
            if not item_exists:
                raise HTTPException(status_code=404, detail=f"Job item {item_id} not found")
            
            # Insert the association
            con.execute(
                """
                INSERT INTO job_type_items (job_type_id, item_id, quantity, is_required, sort_order)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (job_type_id, item_id) DO UPDATE SET
                    quantity = EXCLUDED.quantity,
                    is_required = EXCLUDED.is_required,
                    sort_order = EXCLUDED.sort_order
                """,
                [
                    job_type_id,
                    item_id,
                    body.get("quantity", 1),
                    body.get("is_required", True),
                    body.get("sort_order", 0),
                ]
            )
        
        return {"ok": True, "message": "Job item added to job type"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to add job type item: {e}")


@router.delete("/job-types/{job_type_id}/items/{item_id}")
def remove_job_type_item(
    job_type_id: int,
    item_id: int,
    _user: dict = Depends(_current_user)
):
    """Remove a job item from a job type."""
    try:
        with get_conn() as con:
            con.execute(
                "DELETE FROM job_type_items WHERE job_type_id = %s AND item_id = %s",
                [job_type_id, item_id]
            )
        
        return {"ok": True, "message": "Job item removed from job type"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to remove job type item: {e}")


# =========================
# Missing Data
# =========================

@router.get("/missing-data/fields")
def admin_missing_data_fields(_user: dict = Depends(_current_user)):
    try:
        with get_conn() as con:
            return {"ok": True, "entities": _missing_data_field_catalog(con)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load missing-data fields: {e}")


@router.post("/missing-data/query")
def admin_missing_data_query(body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        entity = str(body.get("entity") or "").strip().lower()
        field_name = str(body.get("field") or "").strip()
        missing_only = bool(body.get("missing_only", True))
        search = str(body.get("search") or "").strip()
        limit = int(body.get("limit") or 200)
        with get_conn() as con:
            return _missing_data_query(
                con,
                entity=entity,
                field_name=field_name,
                missing_only=missing_only,
                search=search,
                limit=limit,
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to query missing data: {e}")


@router.post("/missing-data/update")
def admin_missing_data_update(body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        entity = str(body.get("entity") or "").strip().lower()
        field_name = str(body.get("field") or "").strip()
        record_id = body.get("record_id")
        if record_id is None:
            raise HTTPException(status_code=400, detail="record_id is required")
        with get_conn() as con:
            value = _missing_data_update_one(
                con,
                entity=entity,
                field_name=field_name,
                record_id=int(record_id),
                value=body.get("value"),
            )
        return {
            "ok": True,
            "entity": entity,
            "field": field_name,
            "record_id": int(record_id),
            "value": _serialize_missing_data_value(value),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update missing-data field: {e}")


@router.post("/missing-data/bulk-update")
def admin_missing_data_bulk_update(body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        entity = str(body.get("entity") or "").strip().lower()
        field_name = str(body.get("field") or "").strip()
        record_ids_raw = body.get("record_ids") or []
        if not isinstance(record_ids_raw, list) or not record_ids_raw:
            raise HTTPException(status_code=400, detail="record_ids must be a non-empty list")
        record_ids = [int(record_id) for record_id in record_ids_raw]
        with get_conn() as con:
            value = None
            updated = 0
            for record_id in record_ids:
                value = _missing_data_update_one(
                    con,
                    entity=entity,
                    field_name=field_name,
                    record_id=record_id,
                    value=body.get("value"),
                )
                updated += 1
        return {
            "ok": True,
            "entity": entity,
            "field": field_name,
            "updated_rows": updated,
            "value": _serialize_missing_data_value(value),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to bulk update missing-data field: {e}")


# =========================
# Import / Export (WFM)
# =========================

@router.post("/import-export/legacy/preview")
async def legacy_annual_preview(
    job_id: str = Form(...),
    file: UploadFile = File(...),
    _user: dict = Depends(_current_user),
):
    try:
        if not file.filename or not str(file.filename).lower().endswith(".xlsx"):
            raise HTTPException(status_code=400, detail="Only .xlsx files are supported")
        raw = await file.read()
        if not raw:
            raise HTTPException(status_code=400, detail="Empty upload")
        with get_conn() as con:
            resolved_job_id, resolved_job_number = _resolve_job_reference(con, job_id)
        parsed = parse_legacy_annual_workbook(raw)
        return {
            "ok": True,
            "job_id": int(resolved_job_id),
            "job_number": resolved_job_number,
            "filename": str(file.filename),
            "summary": parsed.get("summary") or {},
            "warnings": parsed.get("warnings") or [],
            "rows_ready": parsed.get("rows_ready") or [],
            "rows_unresolved": parsed.get("rows_unresolved") or [],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to preview legacy annual upload: {e}")


@router.post("/import-export/legacy/commit")
def legacy_annual_commit(
    body: dict = Body(...),
    _user: dict = Depends(_current_user),
):
    try:
        job_id_raw = body.get("job_id")
        site_id_raw = body.get("site_id")
        rows = body.get("rows_ready")
        if job_id_raw is None:
            raise HTTPException(status_code=400, detail="job_id is required")
        with get_conn() as con:
            job_id, _job_number = _resolve_job_reference(con, job_id_raw)
        site_id = None
        if site_id_raw is not None and str(site_id_raw).strip() != "":
            try:
                site_id = int(site_id_raw)
            except Exception:
                raise HTTPException(status_code=400, detail="site_id must be an integer")
        if not isinstance(rows, list) or not rows:
            raise HTTPException(status_code=400, detail="rows_ready must be a non-empty list")
        return commit_legacy_rows(job_id=job_id, site_id=site_id, rows=rows)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to commit legacy annual upload: {e}")


@router.post("/import-export/legacy/clear")
def legacy_annual_clear(
    body: dict = Body(...),
    _user: dict = Depends(_current_user),
):
    try:
        job_id_raw = body.get("job_id")
        site_id_raw = body.get("site_id")
        if job_id_raw is None:
            raise HTTPException(status_code=400, detail="job_id is required")

        with get_conn() as con:
            _ensure_legacy_cleanup_schema(con)
            job_id, job_number = _resolve_job_reference(con, job_id_raw)

            site_id = None
            if site_id_raw is not None and str(site_id_raw).strip() != "":
                try:
                    site_id = int(site_id_raw)
                except Exception:
                    raise HTTPException(status_code=400, detail="site_id must be an integer")

            where_clause = "WHERE job_id=%s AND data_source='Legacy Annual Upload' AND enabled=TRUE"
            params: list[object] = [int(job_id)]
            if site_id is not None:
                where_clause += " AND site_id=%s"
                params.append(int(site_id))

            affected_site_rows = con.execute(
                f"""
                SELECT DISTINCT site_id
                FROM job_scope_rows
                {where_clause}
                ORDER BY site_id
                """,
                params,
            ).fetchall()
            affected_site_ids = [int(r[0]) for r in affected_site_rows if r and r[0] is not None]

            count_row = con.execute(
                f"""
                SELECT COUNT(*)
                FROM job_scope_rows
                {where_clause}
                """,
                params,
            ).fetchone()
            disabled_rows = int(count_row[0] or 0) if count_row else 0

            con.execute(
                f"""
                UPDATE job_scope_rows
                SET enabled=FALSE, updated_at=NOW()
                {where_clause}
                """,
                params,
            )

        return {
            "ok": True,
            "job_id": int(job_id),
            "job_number": job_number,
            "site_id": int(site_id) if site_id is not None else None,
            "disabled_rows": disabled_rows,
            "affected_site_ids": affected_site_ids,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to clear legacy annual rows: {e}")


@router.post("/import-export/legacy/resolve")
def legacy_annual_resolve(
    body: dict = Body(...),
    _user: dict = Depends(_current_user),
):
    try:
        rows_ready = body.get("rows_ready") or []
        rows_unresolved = body.get("rows_unresolved") or []
        manual_entries = body.get("manual_lookup") or []
        if not isinstance(rows_ready, list) or not isinstance(rows_unresolved, list):
            raise HTTPException(status_code=400, detail="rows_ready and rows_unresolved must be lists")

        manual_lookup: dict[str, str] = {}
        if isinstance(manual_entries, list):
            for it in manual_entries:
                if not isinstance(it, dict):
                    continue
                lk = str(it.get("lookup_key") or "").strip()
                oid = str(it.get("original_id") or "").strip()
                if lk and oid:
                    manual_lookup[lk] = oid

        return resolve_unresolved_rows(
            rows_ready=rows_ready,
            rows_unresolved=rows_unresolved,
            manual_lookup=manual_lookup,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to resolve legacy annual rows: {e}")


@router.get("/import-export/attributes/template")
def download_attribute_override_template(_user: dict = Depends(_current_user)):
    try:
        payload = build_override_template_workbook()
        return StreamingResponse(
            io.BytesIO(payload),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": 'attachment; filename="attribute_override_template.xlsx"'},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to build attribute override template: {e}")


@router.get("/import-export/attributes/guide")
def download_attribute_override_guide(_user: dict = Depends(_current_user)):
    try:
        guide_path = Path(__file__).resolve().parents[1] / "ATTRIBUTE_OVERRIDE_CHEATSHEET.docx"
        if not guide_path.exists():
            raise HTTPException(status_code=404, detail="Attribute override guide not found")
        return StreamingResponse(
            io.BytesIO(guide_path.read_bytes()),
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": 'attachment; filename="ATTRIBUTE_OVERRIDE_CHEATSHEET.docx"'},
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to download attribute override guide: {e}")


@router.post("/import-export/attributes/preview")
async def preview_attribute_overrides(
    file: UploadFile = File(...),
    _user: dict = Depends(_current_user),
):
    try:
        if not file.filename or not str(file.filename).lower().endswith(".xlsx"):
            raise HTTPException(status_code=400, detail="Only .xlsx files are supported")
        raw = await file.read()
        if not raw:
            raise HTTPException(status_code=400, detail="Empty upload")
        return parse_override_workbook(raw, filename=str(file.filename))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to preview attribute override workbook: {e}")


@router.post("/import-export/attributes/commit")
def commit_attribute_overrides(
    body: dict = Body(...),
    _user: dict = Depends(_current_user),
):
    try:
        rows = body.get("rows_ready")
        if not isinstance(rows, list) or not rows:
            raise HTTPException(status_code=400, detail="rows_ready must be a non-empty list")
        actor = str(_user.get("email") or _user.get("user_id") or "unknown").strip()
        return commit_override_rows(rows=rows, actor=actor)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to commit attribute overrides: {e}")


@router.get("/import-export/wfm/summary")
def wfm_import_summary(_user: dict = Depends(_current_user)):
    try:
        raw_dir = _wfm_raw_dir()
        raw_data_available = raw_dir.exists()

        files: list[dict] = []
        total_size = 0
        if raw_data_available:
            for p in sorted(raw_dir.glob("*.csv")):
                size = int(p.stat().st_size)
                total_size += size
                row_count = 0
                try:
                    row_count = max(sum(1 for _ in p.open("r", encoding="utf-8", errors="ignore")) - 1, 0)
                except Exception:
                    row_count = 0
                files.append({"name": p.name, "size_bytes": size, "rows": row_count})

        preview_clients = []
        clients_path = raw_dir / "clients.csv"
        if raw_data_available and clients_path.exists():
            cdf = pd.read_csv(clients_path, dtype=str, keep_default_na=False, na_filter=False)
            for _, r in cdf.head(15).iterrows():
                preview_clients.append(
                    {"wfm_client_id": str(r.get("Id") or "").strip(), "name": str(r.get("Name") or "").strip()}
                )

        imported_counts = {"clients": 0, "contacts": 0, "jobs": 0}
        with get_conn() as con:
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS wfm_import_map (
                  entity_type VARCHAR NOT NULL,
                  wfm_id VARCHAR NOT NULL,
                  nzi_id INTEGER NOT NULL,
                  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                  PRIMARY KEY (entity_type, wfm_id)
                )
                """
            )
            rows = con.execute(
                """
                SELECT entity_type, COUNT(*) AS cnt
                FROM wfm_import_map
                GROUP BY entity_type
                """
            ).fetchall()
            for entity_type, cnt in rows:
                key = str(entity_type or "").strip().lower()
                if key in imported_counts:
                    imported_counts[key] = int(cnt or 0)

        return {
            "ok": True,
            "folder": str(raw_dir),
            "raw_data_available": bool(raw_data_available),
            "file_count": len(files),
            "total_size_bytes": total_size,
            "files": files,
            "preview_clients": preview_clients,
            "imported_counts": imported_counts,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load WFM summary: {e}")


def _sanitize_wfm_upload_name(name: str) -> str:
    base = Path(str(name or "").strip()).name
    if not base:
        raise HTTPException(status_code=400, detail="Uploaded WFM file is missing a filename")
    if base.startswith("."):
        raise HTTPException(status_code=400, detail=f"Unsupported WFM filename: {base}")
    return base


@router.post("/import-export/wfm/source-files")
async def upload_wfm_source_files(
    files: list[UploadFile] = File(...),
    replace_existing: bool = Form(True),
    _user: dict = Depends(_current_user),
):
    try:
        raw_dir = _wfm_raw_dir()
        raw_dir.mkdir(parents=True, exist_ok=True)

        if replace_existing:
            for existing in raw_dir.glob("*.csv"):
                try:
                    existing.unlink()
                except Exception:
                    pass

        saved_files: list[str] = []
        rejected_files: list[str] = []

        for upload in files:
            original_name = _sanitize_wfm_upload_name(upload.filename or "")
            lower_name = original_name.lower()
            payload = await upload.read()
            if not payload:
                rejected_files.append(f"{original_name}: empty file")
                continue

            if lower_name.endswith(".zip"):
                try:
                    with zipfile.ZipFile(io.BytesIO(payload)) as zf:
                        for member in zf.infolist():
                            if member.is_dir():
                                continue
                            member_name = _sanitize_wfm_upload_name(member.filename)
                            if not member_name.lower().endswith(".csv"):
                                continue
                            target = raw_dir / member_name
                            target.write_bytes(zf.read(member))
                            saved_files.append(member_name)
                except zipfile.BadZipFile:
                    rejected_files.append(f"{original_name}: invalid zip archive")
                continue

            if not lower_name.endswith(".csv"):
                rejected_files.append(f"{original_name}: only .csv or .zip files are supported")
                continue

            target = raw_dir / original_name
            target.write_bytes(payload)
            saved_files.append(original_name)

        if not saved_files:
            detail = "No WFM source files were saved"
            if rejected_files:
                detail = f"{detail}. Rejected: {'; '.join(rejected_files)}"
            raise HTTPException(status_code=400, detail=detail)

        files_summary: list[dict[str, int | str]] = []
        total_size = 0
        for p in sorted(raw_dir.glob("*.csv")):
            size = int(p.stat().st_size)
            total_size += size
            row_count = 0
            try:
                row_count = max(sum(1 for _ in p.open("r", encoding="utf-8", errors="ignore")) - 1, 0)
            except Exception:
                row_count = 0
            files_summary.append({"name": p.name, "size_bytes": size, "rows": row_count})

        return {
            "ok": True,
            "saved_files": sorted(set(saved_files)),
            "rejected_files": rejected_files,
            "file_count": len(files_summary),
            "total_size_bytes": total_size,
            "files": files_summary,
            "folder": str(raw_dir),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload WFM source files: {e}")


def _ensure_wfm_mapping_tables(con) -> None:
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS wfm_field_catalog (
          id BIGSERIAL PRIMARY KEY,
          file_name VARCHAR NOT NULL,
          field_name VARCHAR NOT NULL,
          source_entity VARCHAR,
          sample_values TEXT,
          non_empty_count INTEGER DEFAULT 0,
          distinct_count INTEGER DEFAULT 0,
          suggested_entity VARCHAR,
          suggested_target VARCHAR,
          suggestion_score NUMERIC,
          suggestion_reason TEXT,
          suggested_candidates_json TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          UNIQUE(file_name, field_name)
        )
        """
    )
    con.execute("ALTER TABLE wfm_field_catalog ADD COLUMN IF NOT EXISTS suggestion_score NUMERIC")
    con.execute("ALTER TABLE wfm_field_catalog ADD COLUMN IF NOT EXISTS suggestion_reason TEXT")
    con.execute("ALTER TABLE wfm_field_catalog ADD COLUMN IF NOT EXISTS suggested_candidates_json TEXT")
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS wfm_field_mappings (
          id BIGSERIAL PRIMARY KEY,
          source_entity VARCHAR NOT NULL,
          source_field VARCHAR NOT NULL,
          target_entity VARCHAR NOT NULL,
          target_field VARCHAR NOT NULL,
          priority INTEGER NOT NULL DEFAULT 100,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          notes TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          UNIQUE(source_entity, source_field, target_entity, target_field)
        )
        """
    )


def _default_wfm_targets():
    from wfm_import.wfm_import_routine import WFM_CLIENT_FIELD_CANDIDATES, WFM_JOB_FIELD_CANDIDATES

    return {
        "job": WFM_JOB_FIELD_CANDIDATES,
        "client": WFM_CLIENT_FIELD_CANDIDATES,
    }


WFM_RECOMMENDED_MAPPING_FILES = {
    "custom_fields.csv",
    "job_custom_field_values.csv",
    "client_custom_field_values.csv",
}


def _wfm_raw_dir() -> Path:
    """Resolve WFM raw_data directory from env override or project default.

    This keeps Render/local deployments resilient when the raw_data folder is not
    present in the repository artifact yet.
    """
    env_path = str(os.getenv("WFM_RAW_DATA_DIR") or "").strip()
    if env_path:
        env_dir = Path(env_path)
        try:
            env_dir.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass
        return env_dir

    candidates: list[Path] = []
    project_default = Path(__file__).resolve().parents[1] / "wfm_import" / "raw_data"
    candidates.append(project_default)
    candidates.append(Path.cwd() / "wfm_import" / "raw_data")

    for c in candidates:
        try:
            if c.exists():
                return c
        except Exception:
            continue

    # Last resort: create project default so routes don't fail purely on missing dir.
    try:
        project_default.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    return project_default


def _normalize_tokens(value: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9]+", str(value or "").lower()) if t]


def _score_field_mapping(field_name: str, source_entity: str, target_entity: str, target_field: str, candidates: list[str]) -> tuple[float, str]:
    lname = str(field_name or "").strip().lower()
    if not lname:
        return 0.0, "empty field"
    lcompact = re.sub(r"[^a-z0-9]", "", lname)
    best = 0.0
    reason = "low confidence"
    for cand in candidates:
        cl = str(cand or "").strip().lower()
        if not cl:
            continue
        ccompact = re.sub(r"[^a-z0-9]", "", cl)
        if lname == cl or lcompact == ccompact:
            score = 100.0
            local_reason = f"exact match to '{cand}'"
        elif cl in lname or lname in cl:
            score = 88.0
            local_reason = f"substring match with '{cand}'"
        else:
            lt = set(_normalize_tokens(lname))
            ct = set(_normalize_tokens(cl))
            overlap = len(lt & ct)
            union = max(len(lt | ct), 1)
            jacc = overlap / union
            score = jacc * 60.0
            local_reason = f"token similarity to '{cand}' ({overlap} overlap)"

        # Scope-special boosts
        if score > 0 and (("scope 1" in lname and "scope_1" in target_field) or ("scope 2" in lname and "scope_2" in target_field) or ("scope 3" in lname and "scope_3" in target_field)):
            score += 8.0
            local_reason += " + scope match"
        if score > 0 and source_entity and target_entity and source_entity == target_entity:
            score += 4.0
            local_reason += " + entity match"

        if score > best:
            best = score
            reason = local_reason

    return min(best, 100.0), reason


def _load_mapping_overrides_from_db(con) -> dict[str, dict[str, list[str]]]:
    _ensure_wfm_mapping_tables(con)
    rows = con.execute(
        """
        SELECT source_entity, source_field, target_entity, target_field, priority
        FROM wfm_field_mappings
        WHERE is_active = TRUE
        ORDER BY target_entity, target_field, priority, source_field
        """
    ).fetchall()
    out: dict[str, dict[str, list[str]]] = {}
    for source_entity, source_field, target_entity, target_field, _priority in rows:
        te = str(target_entity or "").strip().lower()
        tf = str(target_field or "").strip()
        sf = str(source_field or "").strip()
        if not te or not tf or not sf:
            continue
        out.setdefault(te, {}).setdefault(tf, []).append(sf)
    return out


def _merged_wfm_mapping_summary(con=None) -> dict[str, dict[str, list[str]]]:
    defaults = _default_wfm_targets()
    merged: dict[str, dict[str, list[str]]] = {
        "job": {str(k): list(v or []) for k, v in defaults.get("job", {}).items()},
        "client": {str(k): list(v or []) for k, v in defaults.get("client", {}).items()},
    }

    owns_conn = con is None
    if owns_conn:
        with get_conn() as local_con:
            overrides = _load_mapping_overrides_from_db(local_con)
    else:
        overrides = _load_mapping_overrides_from_db(con)

    for entity, targets in overrides.items():
        et = str(entity or "").strip().lower()
        if et not in {"job", "client"}:
            continue
        for target_field, source_fields in (targets or {}).items():
            tf = str(target_field or "").strip()
            if not tf:
                continue
            cleaned_sources = [str(sf or "").strip() for sf in source_fields or [] if str(sf or "").strip()]
            merged.setdefault(et, {})[tf] = cleaned_sources

    for entity in ("job", "client"):
        merged[entity] = dict(sorted(merged.get(entity, {}).items(), key=lambda item: item[0]))

    return merged


@router.get("/import-export/wfm/mapping")
def wfm_mapping_summary(_user: dict = Depends(_current_user)):
    try:
        raw_dir = _wfm_raw_dir()
        custom_fields_path = raw_dir / "custom_fields.csv"
        jobs_path = raw_dir / "jobs.csv"
        job_custom_values_path = raw_dir / "job_custom_field_values.csv"
        with get_conn() as con:
            merged_mappings = _merged_wfm_mapping_summary(con)
        if not custom_fields_path.exists():
            return {
                "ok": True,
                "raw_data_available": bool(raw_dir.exists()),
                "mappings": merged_mappings,
                "source_fields": {
                    "job_custom_field_names": [],
                    "client_custom_field_names": [],
                },
                "sample_job_custom_values": {},
            }

        cdf = pd.read_csv(custom_fields_path, dtype=str, keep_default_na=False, na_filter=False)
        for col in cdf.columns:
            cdf[col] = cdf[col].astype(str).str.strip()
        usage_job = cdf[cdf.get("Usage - Job", "").str.contains("1", regex=False, na=False)]["Name"].dropna().astype(str).tolist()
        usage_client = cdf[cdf.get("Usage - Client", "").str.contains("1", regex=False, na=False)]["Name"].dropna().astype(str).tolist()

        sample_job_fields = {}
        if jobs_path.exists() and job_custom_values_path.exists():
            jdf = pd.read_csv(jobs_path, dtype=str, keep_default_na=False, na_filter=False)
            vdf = pd.read_csv(job_custom_values_path, dtype=str, keep_default_na=False, na_filter=False)
            for col in jdf.columns:
                jdf[col] = jdf[col].astype(str).str.strip()
            for col in vdf.columns:
                vdf[col] = vdf[col].astype(str).str.strip()
            # Pick one representative job that has custom values.
            job_id = None
            if not jdf.empty and "Id" in jdf.columns:
                row = jdf.iloc[0]
                job_id = str(row.get("Id") or "").strip()
                job_no = str(row.get("Job No") or "").strip()
                sample_job_fields["_sample_job_number"] = job_no
            if job_id:
                vdf = vdf[vdf["Job ID"] == job_id]
                if not vdf.empty:
                    id_to_name = {str(r.get("Id")): str(r.get("Name")) for _, r in cdf.iterrows()}
                    for _, vr in vdf.iterrows():
                        name = id_to_name.get(str(vr.get("Custom Field Id") or "").strip(), "")
                        if not name:
                            continue
                        val = str(vr.get("Value") or "").strip()
                        if val.startswith('="') and val.endswith('"'):
                            val = val[2:-1].strip()
                        sample_job_fields[name] = val

        return {
            "ok": True,
            "raw_data_available": bool(raw_dir.exists()),
            "mappings": merged_mappings,
            "source_fields": {
                "job_custom_field_names": sorted(set(usage_job)),
                "client_custom_field_names": sorted(set(usage_client)),
            },
            "sample_job_custom_values": sample_job_fields,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load WFM mapping summary: {e}")


@router.post("/import-export/wfm/scan")
def scan_wfm_fields(body: dict = Body(default={}), _user: dict = Depends(_current_user)):
    try:
        defaults = _default_wfm_targets()
        raw_dir = _wfm_raw_dir()
        if not raw_dir.exists():
            raise HTTPException(status_code=404, detail=f"WFM raw_data folder not found: {raw_dir}")
        include_all = bool((body or {}).get("include_all", False))
        min_suggest_score = float((body or {}).get("min_suggest_score", 70))

        suggestions: list[dict] = []
        with get_conn() as con:
            _ensure_wfm_mapping_tables(con)
            for p in sorted(raw_dir.glob("*.csv")):
                if not include_all and p.name not in WFM_RECOMMENDED_MAPPING_FILES:
                    continue
                df = pd.read_csv(p, dtype=str, keep_default_na=False, na_filter=False)
                # Special case: custom_fields.csv should catalog actual custom field definitions,
                # not the metadata column names (e.g. "Dropdown List Options").
                if p.name.lower() == "custom_fields.csv":
                    for col in df.columns:
                        df[col] = df[col].astype(str).str.strip()

                    for _, fr in df.iterrows():
                        field_name = str(fr.get("Name") or "").strip()
                        if not field_name:
                            continue
                        usage_job = str(fr.get("Usage - Job") or "").strip()
                        usage_client = str(fr.get("Usage - Client") or "").strip()
                        source_entity = ""
                        if "1" in usage_client and "1" not in usage_job:
                            source_entity = "client"
                        elif "1" in usage_job and "1" not in usage_client:
                            source_entity = "job"
                        elif "1" in usage_job and "1" in usage_client:
                            source_entity = "job"

                        sample_values = str(fr.get("Dropdown List Options") or "").strip()
                        if sample_values:
                            sample_values = sample_values[:400]

                        suggested_entity = None
                        suggested_target = None
                        best_score = -1.0
                        best_reason = ""
                        ranked: list[dict[str, Any]] = []
                        for entity, target_map in defaults.items():
                            for target, candidates in target_map.items():
                                score, reason = _score_field_mapping(field_name, source_entity, entity, target, candidates)
                                ranked.append({"target_entity": entity, "target_field": target, "score": score, "reason": reason})
                                if score > best_score:
                                    best_score = score
                                    best_reason = reason
                                    suggested_entity = entity
                                    suggested_target = target
                        ranked = sorted(ranked, key=lambda x: float(x.get("score") or 0), reverse=True)[:3]
                        if best_score < min_suggest_score:
                            suggested_entity = None
                            suggested_target = None
                            best_reason = "below confidence threshold"

                        con.execute(
                            """
                            INSERT INTO wfm_field_catalog (
                              file_name, field_name, source_entity, sample_values, non_empty_count, distinct_count,
                              suggested_entity, suggested_target, suggestion_score, suggestion_reason, suggested_candidates_json, updated_at
                            )
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                            ON CONFLICT (file_name, field_name) DO UPDATE SET
                              source_entity = EXCLUDED.source_entity,
                              sample_values = EXCLUDED.sample_values,
                              non_empty_count = EXCLUDED.non_empty_count,
                              distinct_count = EXCLUDED.distinct_count,
                              suggested_entity = EXCLUDED.suggested_entity,
                              suggested_target = EXCLUDED.suggested_target,
                              suggestion_score = EXCLUDED.suggestion_score,
                              suggestion_reason = EXCLUDED.suggestion_reason,
                              suggested_candidates_json = EXCLUDED.suggested_candidates_json,
                              updated_at = NOW()
                            """,
                            [
                                p.name,
                                field_name,
                                source_entity or None,
                                sample_values or None,
                                1,
                                1,
                                suggested_entity,
                                suggested_target,
                                float(best_score if best_score >= 0 else 0),
                                best_reason or None,
                                json.dumps(ranked),
                            ],
                        )
                        suggestions.append(
                            {
                                "file_name": p.name,
                                "field_name": field_name,
                                "source_entity": source_entity,
                                "suggested_entity": suggested_entity,
                                "suggested_target": suggested_target,
                            }
                        )
                    continue

                for col in df.columns:
                    series = df[col].astype(str).str.strip()
                    series = series.map(lambda s: s[2:-1].strip() if s.startswith('="') and s.endswith('"') else s)
                    non_empty = series[series != ""]
                    distinct_count = int(non_empty.nunique()) if len(non_empty) else 0
                    sample_values = " | ".join(non_empty.head(3).tolist())
                    source_entity = "job" if "job" in p.name.lower() else ("client" if "client" in p.name.lower() else "")

                    lname = str(col).strip().lower()
                    suggested_entity = None
                    suggested_target = None
                    best_score = -1.0
                    best_reason = ""
                    ranked: list[dict[str, Any]] = []
                    for entity, target_map in defaults.items():
                        for target, candidates in target_map.items():
                            score, reason = _score_field_mapping(str(col), source_entity, entity, target, candidates)
                            ranked.append({"target_entity": entity, "target_field": target, "score": score, "reason": reason})
                            if score > best_score:
                                best_score = score
                                best_reason = reason
                                suggested_entity = entity
                                suggested_target = target
                    ranked = sorted(ranked, key=lambda x: float(x.get("score") or 0), reverse=True)[:3]
                    if best_score < min_suggest_score:
                        suggested_entity = None
                        suggested_target = None
                        best_reason = "below confidence threshold"

                    con.execute(
                        """
                        INSERT INTO wfm_field_catalog (
                          file_name, field_name, source_entity, sample_values, non_empty_count, distinct_count,
                          suggested_entity, suggested_target, suggestion_score, suggestion_reason, suggested_candidates_json, updated_at
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                        ON CONFLICT (file_name, field_name) DO UPDATE SET
                          source_entity = EXCLUDED.source_entity,
                          sample_values = EXCLUDED.sample_values,
                          non_empty_count = EXCLUDED.non_empty_count,
                          distinct_count = EXCLUDED.distinct_count,
                          suggested_entity = EXCLUDED.suggested_entity,
                          suggested_target = EXCLUDED.suggested_target,
                          suggestion_score = EXCLUDED.suggestion_score,
                          suggestion_reason = EXCLUDED.suggestion_reason,
                          suggested_candidates_json = EXCLUDED.suggested_candidates_json,
                          updated_at = NOW()
                        """,
                        [
                            p.name,
                            str(col),
                            source_entity or None,
                            sample_values or None,
                            int(len(non_empty)),
                            distinct_count,
                            suggested_entity,
                            suggested_target,
                            float(best_score if best_score >= 0 else 0),
                            best_reason or None,
                            json.dumps(ranked),
                        ],
                    )
                    suggestions.append(
                        {
                            "file_name": p.name,
                            "field_name": str(col),
                            "source_entity": source_entity,
                            "suggested_entity": suggested_entity,
                            "suggested_target": suggested_target,
                        }
                    )

        return {"ok": True, "scanned_fields": len(suggestions), "include_all": include_all}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to scan WFM fields: {e}")


@router.get("/import-export/wfm/catalog")
def wfm_catalog(
    q: str | None = None,
    file_name: str | None = None,
    mapped_only: bool = False,
    recommended_only: bool = True,
    _user: dict = Depends(_current_user),
):
    try:
        with get_conn() as con:
            _ensure_wfm_mapping_tables(con)
            sql = """
                SELECT
                  c.file_name, c.field_name, c.source_entity, c.sample_values, c.non_empty_count, c.distinct_count,
                  c.suggested_entity, c.suggested_target, c.suggestion_score, c.suggestion_reason, c.suggested_candidates_json,
                  m.source_entity, m.target_entity, m.target_field, m.priority, m.is_active, m.notes
                FROM wfm_field_catalog c
                LEFT JOIN LATERAL (
                  SELECT mm.source_entity, mm.target_entity, mm.target_field, mm.priority, mm.is_active, mm.notes
                  FROM wfm_field_mappings mm
                  WHERE lower(COALESCE(mm.source_field,'')) = lower(COALESCE(c.field_name,''))
                    AND (
                      lower(COALESCE(c.source_entity, c.suggested_entity, '')) = ''
                      OR lower(COALESCE(mm.source_entity,'')) = lower(COALESCE(c.source_entity, c.suggested_entity,''))
                    )
                  ORDER BY mm.is_active DESC, mm.updated_at DESC, mm.priority ASC
                  LIMIT 1
                ) m ON TRUE
                WHERE 1=1
            """
            params: list[Any] = []
            if q:
                sql += " AND (lower(c.field_name) LIKE %s OR lower(c.file_name) LIKE %s OR lower(COALESCE(c.sample_values,'')) LIKE %s)"
                qq = f"%{str(q).strip().lower()}%"
                params.extend([qq, qq, qq])
            if file_name:
                sql += " AND c.file_name = %s"
                params.append(str(file_name).strip())
            elif recommended_only:
                rec_files = sorted(WFM_RECOMMENDED_MAPPING_FILES)
                placeholders = ",".join(["%s"] * len(rec_files))
                sql += f" AND c.file_name IN ({placeholders})"
                params.extend(rec_files)
            if mapped_only:
                sql += " AND m.target_field IS NOT NULL"
            sql += " ORDER BY c.file_name, c.field_name"
            rows = con.execute(sql, params).fetchall()

            items = []
            for r in rows:
                items.append(
                    {
                        "file_name": r[0],
                        "field_name": r[1],
                        "source_entity": (r[2] or r[6] or None),
                        "sample_values": r[3],
                        "non_empty_count": int(r[4] or 0),
                        "distinct_count": int(r[5] or 0),
                        "suggested_entity": r[6],
                        "suggested_target": r[7],
                        "suggestion_score": float(r[8] or 0),
                        "suggestion_reason": r[9],
                        "suggested_candidates": json.loads(r[10]) if r[10] else [],
                        "source_entity": (r[11] or r[2] or r[6] or None),
                        "target_entity": r[12],
                        "target_field": r[13],
                        "priority": int(r[14] or 100) if r[14] is not None else 100,
                        "is_active": bool(r[15]) if r[15] is not None else False,
                        "notes": r[16],
                    }
                )
            return {"ok": True, "items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load WFM catalog: {e}")


@router.post("/import-export/wfm/mappings/upsert")
def upsert_wfm_mapping(body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        source_entity = str(body.get("source_entity") or "").strip().lower()
        source_field = str(body.get("source_field") or "").strip()
        target_entity = str(body.get("target_entity") or "").strip().lower()
        target_field = str(body.get("target_field") or "").strip()
        priority = int(body.get("priority") or 100)
        is_active = bool(body.get("is_active", True))
        exclusive = bool(body.get("exclusive", True))
        notes = str(body.get("notes") or "").strip() or None
        if not source_entity or not source_field or not target_entity or not target_field:
            raise HTTPException(status_code=400, detail="source_entity, source_field, target_entity, target_field are required")

        with get_conn() as con:
            _ensure_wfm_mapping_tables(con)
            con.execute(
                """
                INSERT INTO wfm_field_mappings (
                  source_entity, source_field, target_entity, target_field, priority, is_active, notes, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (source_entity, source_field, target_entity, target_field) DO UPDATE SET
                  priority = EXCLUDED.priority,
                  is_active = EXCLUDED.is_active,
                  notes = EXCLUDED.notes,
                  updated_at = NOW()
                """,
                [source_entity, source_field, target_entity, target_field, int(priority), bool(is_active), notes],
            )
            # Keep a single effective mapping per source field unless explicitly disabled.
            # This prevents stale earlier mappings from overriding the latest admin choice.
            if exclusive:
                con.execute(
                    """
                    UPDATE wfm_field_mappings
                    SET is_active = FALSE, updated_at = NOW()
                    WHERE lower(COALESCE(source_entity,'')) = lower(%s)
                      AND lower(COALESCE(source_field,'')) = lower(%s)
                      AND NOT (
                        lower(COALESCE(target_entity,'')) = lower(%s)
                        AND lower(COALESCE(target_field,'')) = lower(%s)
                      )
                    """,
                    [source_entity, source_field, target_entity, target_field],
                )
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upsert WFM mapping: {e}")


@router.post("/import-export/wfm/mappings/map-suggested")
def map_suggested_wfm_fields(body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        min_score = float(body.get("min_score") or 70)
        only_unmapped = bool(body.get("only_unmapped", True))
        recommended_only = bool(body.get("recommended_only", True))
        applied = 0
        skipped = 0
        with get_conn() as con:
            _ensure_wfm_mapping_tables(con)
            sql = """
                SELECT c.source_entity, c.field_name, c.suggested_entity, c.suggested_target, COALESCE(c.suggestion_score, 0),
                       m.id
                FROM wfm_field_catalog c
                LEFT JOIN wfm_field_mappings m
                  ON lower(COALESCE(m.source_entity,'')) = lower(COALESCE(c.source_entity, c.suggested_entity,''))
                 AND lower(COALESCE(m.source_field,'')) = lower(COALESCE(c.field_name,''))
                 AND m.is_active = TRUE
                WHERE c.suggested_entity IS NOT NULL
                  AND c.suggested_target IS NOT NULL
            """
            params: list[Any] = []
            if recommended_only:
                rec_files = sorted(WFM_RECOMMENDED_MAPPING_FILES)
                ph = ",".join(["%s"] * len(rec_files))
                sql += f" AND c.file_name IN ({ph})"
                params.extend(rec_files)
            sql += " ORDER BY c.file_name, c.field_name"
            rows = con.execute(sql, params).fetchall()
            for source_entity, source_field, suggested_entity, suggested_target, score, existing_id in rows:
                if float(score or 0) < min_score:
                    skipped += 1
                    continue
                if only_unmapped and existing_id is not None:
                    skipped += 1
                    continue
                src_entity = str(source_entity or suggested_entity or "").strip().lower()
                if not src_entity:
                    skipped += 1
                    continue
                con.execute(
                    """
                    INSERT INTO wfm_field_mappings (
                      source_entity, source_field, target_entity, target_field, priority, is_active, notes, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, TRUE, %s, NOW())
                    ON CONFLICT (source_entity, source_field, target_entity, target_field) DO UPDATE SET
                      is_active = TRUE,
                      updated_at = NOW()
                    """,
                    [
                        src_entity,
                        str(source_field or "").strip(),
                        str(suggested_entity or "").strip().lower(),
                        str(suggested_target or "").strip(),
                        10,
                        "Auto-mapped from suggestion",
                    ],
                )
                applied += 1
        return {
            "ok": True,
            "applied": applied,
            "skipped": skipped,
            "min_score": min_score,
            "recommended_only": recommended_only,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to map suggested fields: {e}")


@router.post("/import-export/wfm/mappings/preview-impact")
def preview_wfm_mapping_impact(body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        from wfm_import.wfm_import_routine import (
            WfmImporter,
            _setup_logger,
            _clean,
            _parse_date,
            _to_bool,
            _to_float,
            WFM_CLIENT_FIELD_CANDIDATES,
            WFM_JOB_FIELD_CANDIDATES,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"WFM importer unavailable: {e}")

    try:
        raw_dir = _wfm_raw_dir()
        required_files = [
            "jobs.csv",
            "job_custom_field_values.csv",
            "client_custom_field_values.csv",
            "custom_fields.csv",
            "clients.csv",
            "client_addresses.csv",
            "contacts.csv",
            "client_contact.csv",
            "staff.csv",
        ]
        missing = [name for name in required_files if not (raw_dir / name).exists()]
        if missing:
            raise HTTPException(status_code=404, detail=f"Required WFM files missing in raw_data: {', '.join(missing)}")

        job_numbers_raw = body.get("job_numbers") or []
        client_ids_raw = body.get("client_ids") or []
        client_names_raw = body.get("client_names") or []
        if isinstance(job_numbers_raw, str):
            job_numbers = [x.strip() for x in job_numbers_raw.split(",") if x.strip()]
        else:
            job_numbers = [str(x).strip() for x in job_numbers_raw if str(x).strip()]
        if isinstance(client_ids_raw, str):
            client_ids = [x.strip() for x in client_ids_raw.split(",") if x.strip()]
        else:
            client_ids = [str(x).strip() for x in client_ids_raw if str(x).strip()]
        if isinstance(client_names_raw, str):
            client_names = [x.strip() for x in client_names_raw.split(",") if x.strip()]
        else:
            client_names = [str(x).strip() for x in client_names_raw if str(x).strip()]

        with get_conn() as con:
            mapping_overrides = _load_mapping_overrides_from_db(con)

        importer = WfmImporter(
            dry_run=True,
            max_clients=None,
            client_ids=client_ids,
            client_names=client_names,
            job_numbers=job_numbers,
            mapping_overrides=mapping_overrides,
            logger=_setup_logger(),
        )
        importer.load()
        importer.pick_clients()

        selected_jobs = importer.data["jobs.csv"].copy()
        selected_clients = importer.data["clients.csv"].copy()

        impacts: dict[str, dict[str, dict[str, list[str] | int]]] = {"job": {}, "client": {}}

        def _pick_with_source(value_map: dict[str, str], candidates: list[str]) -> tuple[str, str]:
            if not value_map:
                return "", ""
            for candidate in candidates:
                value = _clean(value_map.get(str(candidate or "").strip().lower()))
                if value:
                    return value, str(candidate or "").strip()
            return "", ""

        def _sample_text(value) -> str:
            if isinstance(value, bool):
                return "true" if value else "false"
            if value is None:
                return ""
            if isinstance(value, float):
                if pd.isna(value):
                    return ""
                if value.is_integer():
                    return str(int(value))
                return f"{value:g}"
            return str(value).strip()

        def _record_impact(entity: str, target_field: str, value, source_label: str) -> None:
            sample = _sample_text(value)
            if not sample:
                return
            bucket = impacts[entity].setdefault(target_field, {"count": 0, "samples": [], "source_fields": []})
            bucket["count"] = int(bucket["count"]) + 1
            if source_label:
                existing_sources = {str(x).lower() for x in bucket["source_fields"]}
                if source_label.lower() not in existing_sources:
                    bucket["source_fields"].append(source_label)
            if sample not in bucket["samples"] and len(bucket["samples"]) < 5:
                bucket["samples"].append(sample)

        client_builtin_targets = set(WFM_CLIENT_FIELD_CANDIDATES.keys())
        job_builtin_targets = set(WFM_JOB_FIELD_CANDIDATES.keys())

        for _, row in selected_clients.iterrows():
            wfm_client_id = _clean(row.get("Id"))
            client_custom = importer.client_custom_values.get(wfm_client_id, {})

            company_reg_custom, company_reg_source = _pick_with_source(
                client_custom,
                importer._candidates("client", "company_reg", WFM_CLIENT_FIELD_CANDIDATES["company_reg"]),
            )
            company_reg = company_reg_custom or _clean(row.get("Company Number"))
            if not company_reg_source and company_reg:
                company_reg_source = "clients.csv::Company Number"
            _record_impact("client", "company_reg", company_reg, company_reg_source)

            sic_code, sic_code_source = _pick_with_source(
                client_custom,
                importer._candidates("client", "sic_code", WFM_CLIENT_FIELD_CANDIDATES["sic_code"]),
            )
            _record_impact("client", "sic_code", sic_code, sic_code_source)

            year_end = _parse_date(row.get("Year End Date"))
            year_end_month = year_end[5:7] if year_end else ""
            year_end_source = "clients.csv::Year End Date" if year_end_month else ""
            custom_year_end_raw, custom_year_end_source = _pick_with_source(
                client_custom,
                importer._candidates("client", "year_end_month", WFM_CLIENT_FIELD_CANDIDATES["year_end_month"]),
            )
            custom_year_end = _parse_date(custom_year_end_raw)
            if custom_year_end:
                year_end_month = custom_year_end[5:7]
                year_end_source = custom_year_end_source
            _record_impact("client", "year_end_month", year_end_month, year_end_source)

            industry, industry_source = _pick_with_source(
                client_custom,
                importer._candidates("client", "industry", WFM_CLIENT_FIELD_CANDIDATES["industry"]),
            )
            _record_impact("client", "industry", industry, industry_source)

            benchmark_period_start_raw, benchmark_period_start_source = _pick_with_source(
                client_custom,
                importer._candidates(
                    "client",
                    "benchmark_period_start",
                    WFM_CLIENT_FIELD_CANDIDATES["benchmark_period_start"],
                ),
            )
            _record_impact(
                "client",
                "benchmark_period_start",
                _parse_date(benchmark_period_start_raw),
                benchmark_period_start_source,
            )

            benchmark_period_end_raw, benchmark_period_end_source = _pick_with_source(
                client_custom,
                importer._candidates(
                    "client",
                    "benchmark_period_end",
                    WFM_CLIENT_FIELD_CANDIDATES["benchmark_period_end"],
                ),
            )
            _record_impact(
                "client",
                "benchmark_period_end",
                _parse_date(benchmark_period_end_raw),
                benchmark_period_end_source,
            )

            currency, currency_source = _pick_with_source(
                client_custom,
                importer._candidates("client", "currency", WFM_CLIENT_FIELD_CANDIDATES["currency"]),
            )
            _record_impact("client", "currency", currency, currency_source)

            description_long, description_long_source = _pick_with_source(
                client_custom,
                importer._candidates("client", "description_long", WFM_CLIENT_FIELD_CANDIDATES["description_long"]),
            )
            _record_impact("client", "description_long", description_long, description_long_source)

            client_turnover_raw, client_turnover_source = _pick_with_source(
                client_custom,
                importer._candidates("client", "turnover", WFM_CLIENT_FIELD_CANDIDATES["turnover"]),
            )
            _record_impact("client", "turnover", _to_float(client_turnover_raw), client_turnover_source)

            for target_field in importer._mapped_custom_targets("client", client_builtin_targets):
                dynamic_value, dynamic_source = _pick_with_source(
                    client_custom,
                    importer._candidates("client", target_field, [target_field]),
                )
                _record_impact("client", target_field, dynamic_value, dynamic_source)

        for _, row in selected_jobs.iterrows():
            wfm_job_id = _clean(row.get("Id"))
            wfm_client_id = _clean(row.get("Client"))
            job_custom = importer.job_custom_values.get(wfm_job_id, {})
            client_custom = importer.client_custom_values.get(wfm_client_id, {})

            start_date = _parse_date(row.get("Start Date (DD/MM/YYYY)"))
            due_date = _parse_date(row.get("Due Date (DD/MM/YYYY)"))

            report_from_raw, report_from_source = _pick_with_source(
                job_custom,
                importer._candidates("job", "report_from", WFM_JOB_FIELD_CANDIDATES["report_from"]),
            )
            report_from = _parse_date(report_from_raw) or start_date
            if not report_from_source and report_from:
                report_from_source = "jobs.csv::Start Date (DD/MM/YYYY)"
            _record_impact("job", "report_from", report_from, report_from_source)

            report_to_raw, report_to_source = _pick_with_source(
                job_custom,
                importer._candidates("job", "report_to", WFM_JOB_FIELD_CANDIDATES["report_to"]),
            )
            report_to = _parse_date(report_to_raw) or due_date
            if not report_to_source and report_to:
                report_to_source = "jobs.csv::Due Date (DD/MM/YYYY)"
            _record_impact("job", "report_to", report_to, report_to_source)

            crm_name_raw, crm_name_source = _pick_with_source(
                job_custom,
                importer._candidates("job", "crm_name", WFM_JOB_FIELD_CANDIDATES["crm_name"]),
            )
            crm_name = _clean(crm_name_raw) or importer.staff_name_by_id.get(_clean(row.get("Job Manager"))) or ""
            if not crm_name_source and crm_name:
                crm_name_source = "jobs.csv::Job Manager (via staff.csv)"
            _record_impact("job", "crm_name", crm_name, crm_name_source)

            is_benchmark_raw, is_benchmark_source = _pick_with_source(
                job_custom,
                importer._candidates("job", "is_benchmark", WFM_JOB_FIELD_CANDIDATES["is_benchmark"]),
            )
            _record_impact("job", "is_benchmark", _to_bool(is_benchmark_raw), is_benchmark_source)

            is_renewal_raw, is_renewal_source = _pick_with_source(
                job_custom,
                importer._candidates("job", "is_renewal", WFM_JOB_FIELD_CANDIDATES["is_renewal"]),
            )
            _record_impact("job", "is_renewal", _to_bool(is_renewal_raw), is_renewal_source)

            data_collection_due_raw, data_collection_due_source = _pick_with_source(
                job_custom,
                importer._candidates("job", "data_collection_due", WFM_JOB_FIELD_CANDIDATES["data_collection_due"]),
            )
            _record_impact("job", "data_collection_due", _parse_date(data_collection_due_raw), data_collection_due_source)

            first_draft_due_raw, first_draft_due_source = _pick_with_source(
                job_custom,
                importer._candidates("job", "first_draft_due", WFM_JOB_FIELD_CANDIDATES["first_draft_due"]),
            )
            _record_impact("job", "first_draft_due", _parse_date(first_draft_due_raw), first_draft_due_source)

            final_report_due_raw, final_report_due_source = _pick_with_source(
                job_custom,
                importer._candidates("job", "final_report_due", WFM_JOB_FIELD_CANDIDATES["final_report_due"]),
            )
            _record_impact("job", "final_report_due", _parse_date(final_report_due_raw), final_report_due_source)

            scope_1_raw, scope_1_source = _pick_with_source(
                job_custom,
                importer._candidates("job", "scope_1_tco2e", WFM_JOB_FIELD_CANDIDATES["scope_1_tco2e"]),
            )
            _record_impact("job", "scope_1_tco2e", _to_float(scope_1_raw), scope_1_source)

            scope_2_raw, scope_2_source = _pick_with_source(
                job_custom,
                importer._candidates("job", "scope_2_tco2e", WFM_JOB_FIELD_CANDIDATES["scope_2_tco2e"]),
            )
            _record_impact("job", "scope_2_tco2e", _to_float(scope_2_raw), scope_2_source)

            scope_3_raw, scope_3_source = _pick_with_source(
                job_custom,
                importer._candidates("job", "scope_3_tco2e", WFM_JOB_FIELD_CANDIDATES["scope_3_tco2e"]),
            )
            _record_impact("job", "scope_3_tco2e", _to_float(scope_3_raw), scope_3_source)

            employees_raw, employees_source = _pick_with_source(
                job_custom,
                importer._candidates("job", "employees", WFM_JOB_FIELD_CANDIDATES["employees"]),
            )
            _record_impact("job", "employees", _to_float(employees_raw), employees_source)

            turnover_raw, turnover_source = _pick_with_source(
                job_custom,
                importer._candidates("job", "turnover", WFM_JOB_FIELD_CANDIDATES["turnover"]),
            )
            turnover_value = _to_float(turnover_raw)
            if turnover_value is None:
                client_turnover_raw, client_turnover_source = _pick_with_source(
                    client_custom,
                    importer._candidates("client", "turnover", WFM_CLIENT_FIELD_CANDIDATES["turnover"]),
                )
                turnover_value = _to_float(client_turnover_raw)
                if turnover_value is not None:
                    turnover_source = f"client custom::{client_turnover_source}" if client_turnover_source else ""
            _record_impact("job", "turnover", turnover_value, turnover_source)

            for target_field in importer._mapped_custom_targets("job", job_builtin_targets):
                dynamic_value, dynamic_source = _pick_with_source(
                    job_custom,
                    importer._candidates("job", target_field, [target_field]),
                )
                _record_impact("job", target_field, dynamic_value, dynamic_source)

        direct = {
            "job.crm_name <- jobs.csv::Job Manager (via staff.csv)": {
                "count": int(
                    len(
                        selected_jobs[
                            selected_jobs["Job Manager"].astype(str).str.strip().isin(importer.staff_name_by_id.keys())
                        ]
                    )
                ),
                "samples": selected_jobs[
                    selected_jobs["Job Manager"].astype(str).str.strip().isin(importer.staff_name_by_id.keys())
                ]["Job No"].head(5).tolist(),
            },
            "job.report_from/report_to <- jobs.csv::Start Date / Due Date": {
                "count": int(
                    len(
                        selected_jobs[
                            selected_jobs["Start Date (DD/MM/YYYY)"].astype(str).str.strip().ne("")
                            | selected_jobs["Due Date (DD/MM/YYYY)"].astype(str).str.strip().ne("")
                        ]
                    )
                ),
                "samples": selected_jobs[
                    selected_jobs["Start Date (DD/MM/YYYY)"].astype(str).str.strip().ne("")
                    | selected_jobs["Due Date (DD/MM/YYYY)"].astype(str).str.strip().ne("")
                ]["Job No"].head(5).tolist(),
            },
        }

        return {
            "ok": True,
            "coverage_note": "Counts reflect unique selected jobs or clients with a resolved value after importer fallback rules.",
            "selection": {
                "jobs": int(len(selected_jobs)),
                "clients": int(len(selected_clients)),
                "job_numbers": selected_jobs["Job No"].head(20).tolist(),
            },
            "impacts": impacts,
            "direct_mappings": direct,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to preview mapping impact: {e}")


def _build_wfm_client_field_backfill_preview(con, *, target_field: str, overwrite_existing: bool) -> dict:
    try:
        from wfm_import.wfm_import_routine import (
            _clean,
            _parse_date,
            WFM_CLIENT_FIELD_CANDIDATES,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"WFM importer unavailable: {e}")

    field_key = str(target_field or "").strip()
    field_configs: dict[str, dict] = {
        "industry": {
            "label": "Industry",
            "target_column": "industry",
            "required_files": ["clients.csv", "custom_fields.csv", "client_custom_field_values.csv"],
            "default_candidates": WFM_CLIENT_FIELD_CANDIDATES.get("industry")
            or ["Industry", "Sector", "Business Sector", "Company Sector"],
            "needs_lookup_values": True,
        },
        "crm_owner": {
            "label": "Client Manager",
            "target_column": "crm_owner",
            "required_files": ["clients.csv", "staff.csv"],
            "default_candidates": ["Client Manager", "Account Manager", "CRM Owner", "Job Manager"],
            "direct_column": "Client Manager",
            "uses_staff_lookup": True,
        },
        "year_end_month": {
            "label": "Financial Year End Month",
            "target_column": "year_end_month",
            "required_files": ["clients.csv"],
            "default_candidates": WFM_CLIENT_FIELD_CANDIDATES.get("year_end_month") or ["Financial Year End", "Year End Date"],
            "direct_column": "Year End Date",
            "transform": "month_from_date",
        },
        "benchmark_period_start": {
            "label": "Benchmark Period Start",
            "target_column": "benchmark_period_start",
            "required_files": ["clients.csv", "custom_fields.csv", "client_custom_field_values.csv"],
            "default_candidates": WFM_CLIENT_FIELD_CANDIDATES.get("benchmark_period_start")
            or ["Benchmark Date From", "Benchmark Period Start"],
            "transform": "date",
        },
        "benchmark_period_end": {
            "label": "Benchmark Period End",
            "target_column": "benchmark_period_end",
            "required_files": ["clients.csv", "custom_fields.csv", "client_custom_field_values.csv"],
            "default_candidates": WFM_CLIENT_FIELD_CANDIDATES.get("benchmark_period_end")
            or ["Benchmark Date To", "Benchmark Period End"],
            "transform": "date",
        },
    }
    config = field_configs.get(field_key)
    if not config:
        raise HTTPException(status_code=400, detail=f"Unsupported client backfill field: {field_key}")

    raw_dir = _wfm_raw_dir()
    required_files = list(config.get("required_files") or [])
    missing = [name for name in required_files if not (raw_dir / name).exists()]
    if missing:
        raise HTTPException(status_code=404, detail=f"Required WFM files missing in raw_data: {', '.join(missing)}")

    mapping_overrides = _load_mapping_overrides_from_db(con)
    client_mapping_overrides = mapping_overrides.get("client", {}) if isinstance(mapping_overrides, dict) else {}
    if not isinstance(client_mapping_overrides, dict):
        client_mapping_overrides = {}
    default_industry_candidates = WFM_CLIENT_FIELD_CANDIDATES.get("industry") or [
        "Industry",
        "Sector",
        "Business Sector",
        "Company Sector",
    ]
    candidate_fields: list[str] = []
    default_candidates = list(config.get("default_candidates") or default_industry_candidates)
    for value in [*(client_mapping_overrides.get(field_key, []) or []), *default_candidates]:
        cleaned = _clean(value)
        if cleaned and cleaned.lower() not in {item.lower() for item in candidate_fields}:
            candidate_fields.append(cleaned)

    def _read_wfm_csv(name: str) -> pd.DataFrame:
        path = raw_dir / name
        df = pd.read_csv(path, dtype=str, keep_default_na=False, na_filter=False)
        for col in df.columns:
            df[col] = df[col].map(_clean)
        return df

    clients_df = _read_wfm_csv("clients.csv")
    custom_fields_df = _read_wfm_csv("custom_fields.csv") if (raw_dir / "custom_fields.csv").exists() else pd.DataFrame()
    client_custom_values_df = (
        _read_wfm_csv("client_custom_field_values.csv")
        if (raw_dir / "client_custom_field_values.csv").exists()
        else pd.DataFrame()
    )
    staff_df = _read_wfm_csv("staff.csv") if (raw_dir / "staff.csv").exists() else pd.DataFrame()

    field_name_by_id: dict[str, str] = {}
    for _, row in custom_fields_df.iterrows():
        field_id = _clean(row.get("Id"))
        field_name = _clean(row.get("Name"))
        if field_id and field_name:
            field_name_by_id[field_id] = field_name

    client_custom_values: dict[str, dict[str, str]] = {}
    for _, row in client_custom_values_df.iterrows():
        client_id = _clean(row.get("Client ID"))
        field_id = _clean(row.get("Custom Field Id"))
        field_value = _clean(row.get("Value"))
        if not client_id or not field_id:
            continue
        field_name = field_name_by_id.get(field_id, field_id)
        client_custom_values.setdefault(client_id, {})[field_name.lower()] = field_value

    staff_name_by_id: dict[str, str] = {}
    for _, row in staff_df.iterrows():
        staff_id = _clean(row.get("Id"))
        if not staff_id:
            continue
        staff_name = " ".join([part for part in [_clean(row.get("First Name")), _clean(row.get("Last Name"))] if part]).strip()
        staff_name_by_id[staff_id] = staff_name or _clean(row.get("Email")) or staff_id

    def _pick_field_value(value_map: dict[str, str], candidates: list[str]) -> str:
        if not value_map:
            return ""
        for name in candidates:
            value = _clean(value_map.get(str(name or "").strip().lower()))
            if value:
                return value
        return ""

    def _transform_value(raw_value: str) -> str:
        value = _clean(raw_value)
        transform = str(config.get("transform") or "").strip().lower()
        if not value:
            return ""
        if config.get("uses_staff_lookup"):
            return _clean(staff_name_by_id.get(value) or value)
        if transform == "date":
            return _clean(_parse_date(value))
        if transform == "month_from_date":
            parsed = _clean(_parse_date(value))
            return parsed[5:7] if len(parsed) >= 7 else ""
        return value

    client_columns = {
        str(row[0] or "").strip().lower()
        for row in con.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'clients'
            """
        ).fetchall()
    }
    target_column = str(config.get("target_column") or field_key).strip()
    if target_column.lower() not in client_columns:
        raise HTTPException(status_code=400, detail=f"Client field not available in this environment: {target_column}")

    if clients_df is None or clients_df.empty:
        return {
            "ok": True,
            "target_field": field_key,
            "target_label": str(config.get("label") or field_key),
            "summary": {
                "total_wfm_clients": 0,
                "clients_with_wfm_value": 0,
                "matched_by_map": 0,
                "matched_by_name": 0,
                "ready_updates": 0,
                "fill_updates": 0,
                "replace_updates": 0,
                "unchanged": 0,
                "missing_wfm_value": 0,
                "unmatched_clients": 0,
                "ambiguous_name_matches": 0,
                "missing_lookup_values": 0,
            },
            "rows_ready": [],
            "rows_unmatched": [],
            "rows_unchanged": [],
        }

    map_rows = con.execute(
        """
        SELECT wfm_id, nzi_id
        FROM wfm_import_map
        WHERE entity_type = 'client'
        """
    ).fetchall()
    client_map = {str(row[0] or "").strip(): int(row[1]) for row in map_rows if row and row[0] and row[1] is not None}

    client_rows = con.execute(
        f"""
        SELECT db_id, client_name, {target_column}
        FROM clients
        """
    ).fetchall()
    clients_by_id: dict[int, dict] = {}
    clients_by_name: dict[str, list[dict]] = {}
    for db_id, client_name, existing_value in client_rows:
        item = {
            "db_id": int(db_id),
            "client_name": str(client_name or "").strip(),
            "existing_value": str(existing_value or "").strip(),
        }
        clients_by_id[item["db_id"]] = item
        name_key = item["client_name"].lower()
        if name_key:
            clients_by_name.setdefault(name_key, []).append(item)

    lookup_value_names: set[str] = set()
    has_industries_lookup = bool(
        con.execute(
            """
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'industries_lookup'
            LIMIT 1
            """
        ).fetchone()
    )
    if config.get("needs_lookup_values") and has_industries_lookup:
        try:
            lookup_rows = con.execute("SELECT name FROM industries_lookup WHERE name IS NOT NULL").fetchall()
            lookup_value_names = {str(row[0] or "").strip().lower() for row in lookup_rows if str(row[0] or "").strip()}
        except Exception:
            lookup_value_names = set()

    rows_ready: list[dict] = []
    rows_unmatched: list[dict] = []
    rows_unchanged: list[dict] = []
    matched_by_map = 0
    matched_by_name = 0
    missing_wfm_value = 0
    ambiguous_name_matches = 0

    for _, row in clients_df.iterrows():
        wfm_client_id = _clean(row.get("Id"))
        client_name = _clean(row.get("Name"))
        client_custom = client_custom_values.get(wfm_client_id, {})
        direct_value = _transform_value(_clean(row.get(str(config.get("direct_column") or ""))))
        custom_value = _transform_value(_pick_field_value(client_custom, candidate_fields))
        wfm_value = custom_value or direct_value

        if not wfm_value:
            missing_wfm_value += 1
            continue

        matched = None
        match_method = ""
        if wfm_client_id in client_map:
            matched = clients_by_id.get(client_map[wfm_client_id])
            if matched:
                match_method = "wfm_import_map"
                matched_by_map += 1

        if matched is None and client_name:
            name_matches = clients_by_name.get(client_name.lower(), [])
            if len(name_matches) == 1:
                matched = name_matches[0]
                match_method = "client_name"
                matched_by_name += 1
            elif len(name_matches) > 1:
                ambiguous_name_matches += 1
                rows_unmatched.append(
                    {
                        "wfm_client_id": wfm_client_id,
                        "client_name": client_name,
                        "wfm_value": wfm_value,
                        "reason": f"Ambiguous client name match ({len(name_matches)} matches)",
                    }
                )
                continue

        if matched is None:
            rows_unmatched.append(
                {
                    "wfm_client_id": wfm_client_id,
                    "client_name": client_name,
                    "wfm_value": wfm_value,
                    "reason": "No NZI client match found",
                }
            )
            continue

        existing_value = str(matched.get("existing_value") or "").strip()
        same_value = existing_value.lower() == wfm_value.lower() if existing_value else False
        if same_value:
            rows_unchanged.append(
                {
                    "nzi_client_id": matched.get("db_id"),
                    "client_name": matched.get("client_name"),
                    "existing_value": existing_value,
                    "wfm_value": wfm_value,
                    "match_method": match_method,
                    "reason": f"Already matches WFM {config.get('label')}",
                }
            )
            continue

        if existing_value and not overwrite_existing:
            rows_unchanged.append(
                {
                    "nzi_client_id": matched.get("db_id"),
                    "client_name": matched.get("client_name"),
                    "existing_value": existing_value,
                    "wfm_value": wfm_value,
                    "match_method": match_method,
                    "reason": "Existing value kept",
                }
            )
            continue

        rows_ready.append(
            {
                "nzi_client_id": matched.get("db_id"),
                "wfm_client_id": wfm_client_id,
                "client_name": matched.get("client_name") or client_name,
                "existing_value": existing_value or None,
                "wfm_value": wfm_value,
                "match_method": match_method,
                "action": "replace" if existing_value else "fill",
            }
        )

    missing_lookup_values = sorted(
        {
            str(row.get("wfm_value") or "").strip()
            for row in rows_ready
            if str(row.get("wfm_value") or "").strip()
            and str(row.get("wfm_value") or "").strip().lower() not in lookup_value_names
        }
    ) if config.get("needs_lookup_values") else []

    return {
        "ok": True,
        "target_field": field_key,
        "target_label": str(config.get("label") or field_key),
        "target_column": target_column,
        "summary": {
            "total_wfm_clients": int(len(clients_df)),
            "clients_with_wfm_value": int(len(clients_df) - missing_wfm_value),
            "matched_by_map": int(matched_by_map),
            "matched_by_name": int(matched_by_name),
            "ready_updates": int(len(rows_ready)),
            "fill_updates": int(sum(1 for row in rows_ready if row.get("action") == "fill")),
            "replace_updates": int(sum(1 for row in rows_ready if row.get("action") == "replace")),
            "unchanged": int(len(rows_unchanged)),
            "missing_wfm_value": int(missing_wfm_value),
            "unmatched_clients": int(len(rows_unmatched)),
            "ambiguous_name_matches": int(ambiguous_name_matches),
            "missing_lookup_values": int(len(missing_lookup_values)),
        },
        "rows_ready": rows_ready,
        "rows_unmatched": rows_unmatched,
        "rows_unchanged": rows_unchanged,
        "missing_lookup_values": missing_lookup_values,
        "overwrite_existing": bool(overwrite_existing),
    }


@router.post("/import-export/wfm/client-fields/backfill")
@router.post("/import-export/wfm/client-industries/backfill")
def backfill_wfm_client_fields(body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        target_field = str(body.get("target_field") or "industry").strip()
        preview_only = bool(body.get("preview_only", True))
        overwrite_existing = bool(body.get("overwrite_existing", True))
        actor = str(_user.get("email") or _user.get("user_id") or "unknown").strip()

        with get_conn() as con:
            preview = _build_wfm_client_field_backfill_preview(
                con,
                target_field=target_field,
                overwrite_existing=overwrite_existing,
            )

            if preview_only:
                return {
                    **preview,
                    "preview_only": True,
                    "applied_updates": 0,
                    "lookup_rows_inserted": 0,
                }

            rows_ready = preview.get("rows_ready") or []
            applied_updates = 0
            lookup_rows_inserted = 0

            if target_field == "industry" and preview.get("missing_lookup_values"):
                for industry_name in preview["missing_lookup_values"]:
                    try:
                        con.execute(
                            """
                            INSERT INTO industries_lookup (name, is_active)
                            SELECT %s, TRUE
                            WHERE NOT EXISTS (
                                SELECT 1 FROM industries_lookup WHERE lower(name) = lower(%s)
                            )
                            """,
                            [industry_name, industry_name],
                        )
                        lookup_rows_inserted += 1
                    except Exception:
                        # Keep backfill resilient if lookup table or unique rules differ.
                        pass

            for row in rows_ready:
                target_column = str(preview.get("target_column") or target_field).strip()
                con.execute(
                    f"UPDATE clients SET {target_column} = %s WHERE db_id = %s",
                    [row.get("wfm_value"), int(row["nzi_client_id"])],
                )
                applied_updates += 1
                try:
                    con.execute(
                        """
                        INSERT INTO wfm_import_audit (mode, entity_type, wfm_id, nzi_id, action, message)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        """,
                        [
                            "import",
                            "client",
                            row.get("wfm_client_id"),
                            int(row["nzi_client_id"]),
                            "update_client_field",
                            f"Backfilled client field '{target_field}' to '{row.get('wfm_value')}' by {actor}",
                        ],
                    )
                except Exception:
                    pass

            return {
                **preview,
                "preview_only": False,
                "applied_updates": int(applied_updates),
                "lookup_rows_inserted": int(lookup_rows_inserted),
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to backfill WFM client field '{target_field}': {e}")


@router.get("/import-export/wfm/mapping-targets")
def wfm_mapping_targets(_user: dict = Depends(_current_user)):
    try:
        defaults = _default_wfm_targets()
        job_targets = set(defaults.get("job", {}).keys())
        client_targets = set(defaults.get("client", {}).keys())

        # Include active Admin custom fields so they are selectable as mapping targets.
        with get_conn() as con:
            try:
                rows = con.execute(
                    """
                    SELECT entity_type, field_name
                    FROM custom_field_definitions
                    WHERE is_active = TRUE
                      AND entity_type IN ('job', 'client')
                      AND field_name IS NOT NULL
                    ORDER BY entity_type, display_order, field_name
                    """
                ).fetchall()
                for entity_type, field_name in rows:
                    et = str(entity_type or "").strip().lower()
                    fn = str(field_name or "").strip()
                    if not fn:
                        continue
                    if et == "job":
                        job_targets.add(fn)
                    elif et == "client":
                        client_targets.add(fn)
            except Exception:
                # Keep endpoint resilient if custom field tables are not present in a local environment.
                pass

        return {
            "ok": True,
            "targets": {
                "job": sorted(list(job_targets)),
                "client": sorted(list(client_targets)),
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load mapping targets: {e}")


@router.post("/import-export/wfm/run")
def run_wfm_import(body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        from wfm_import.wfm_import_routine import WfmImporter, _setup_logger
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"WFM importer unavailable: {e}")

    try:
        mode = str(body.get("mode") or "dry-run").strip().lower()
        do_import = mode == "import"
        max_clients_raw = body.get("max_clients")
        max_clients = int(max_clients_raw) if str(max_clients_raw or "").strip().isdigit() else None

        raw_client_ids = body.get("client_ids") or []
        raw_client_names = body.get("client_names") or []
        raw_job_numbers = body.get("job_numbers") or []

        if isinstance(raw_client_ids, str):
            client_ids = [x.strip() for x in raw_client_ids.split(",") if x.strip()]
        else:
            client_ids = [str(x).strip() for x in raw_client_ids if str(x).strip()]

        if isinstance(raw_client_names, str):
            client_names = [x.strip() for x in raw_client_names.split(",") if x.strip()]
        else:
            client_names = [str(x).strip() for x in raw_client_names if str(x).strip()]
        if isinstance(raw_job_numbers, str):
            job_numbers = [x.strip() for x in raw_job_numbers.split(",") if x.strip()]
        else:
            job_numbers = [str(x).strip() for x in raw_job_numbers if str(x).strip()]

        with get_conn() as con:
            mapping_overrides = _load_mapping_overrides_from_db(con)

        importer = WfmImporter(
            dry_run=not do_import,
            max_clients=max_clients,
            client_ids=client_ids,
            client_names=client_names,
            job_numbers=job_numbers,
            mapping_overrides=mapping_overrides,
            logger=_setup_logger(),
        )
        rc = importer.run()
        selected = []
        cdf = importer.data.get("clients.csv")
        if cdf is not None and not cdf.empty:
            for _, r in cdf.iterrows():
                selected.append(
                    {"wfm_client_id": str(r.get("Id") or "").strip(), "name": str(r.get("Name") or "").strip()}
                )

        s = importer.stats
        return {
            "ok": rc == 0,
            "mode": "import" if do_import else "dry-run",
            "selected_clients": selected,
            "stats": {
                "clients": {"processed": s.clients_processed, "inserted": s.clients_inserted, "updated": s.clients_updated},
                "contacts": {"processed": s.contacts_processed, "inserted": s.contacts_inserted, "updated": s.contacts_updated},
                "jobs": {"processed": s.jobs_processed, "inserted": s.jobs_inserted, "updated": s.jobs_updated},
                "warnings": s.warnings,
                "errors": s.errors,
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to run WFM import: {e}")


@router.get("/import-export/wfm/export-imported")
def export_wfm_imported(_user: dict = Depends(_current_user)):
    try:
        with get_conn() as con:
            # Ensure support tables exist
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS wfm_import_map (
                  entity_type VARCHAR NOT NULL,
                  wfm_id VARCHAR NOT NULL,
                  nzi_id INTEGER NOT NULL,
                  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                  PRIMARY KEY (entity_type, wfm_id)
                )
                """
            )
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS wfm_import_audit (
                  id BIGSERIAL PRIMARY KEY,
                  run_at TIMESTAMP NOT NULL DEFAULT NOW(),
                  mode VARCHAR NOT NULL,
                  entity_type VARCHAR NOT NULL,
                  wfm_id VARCHAR,
                  nzi_id INTEGER,
                  action VARCHAR NOT NULL,
                  message TEXT
                )
                """
            )

            map_df = con.execute("SELECT * FROM wfm_import_map ORDER BY entity_type, wfm_id").df()
            audit_df = con.execute("SELECT * FROM wfm_import_audit ORDER BY id DESC LIMIT 20000").df()
            clients_df = con.execute(
                """
                SELECT c.*, m.wfm_id AS wfm_client_id
                FROM clients c
                JOIN wfm_import_map m ON m.entity_type = 'client' AND m.nzi_id = c.db_id
                ORDER BY c.db_id
                """
            ).df()
            contacts_df = con.execute(
                """
                SELECT cc.*, m.wfm_id AS wfm_contact_id
                FROM client_contacts cc
                JOIN wfm_import_map m ON m.entity_type = 'contact' AND m.nzi_id = cc.contact_id
                ORDER BY cc.contact_id
                """
            ).df()
            jobs_df = con.execute(
                """
                SELECT j.*, m.wfm_id AS wfm_job_id
                FROM jobs j
                JOIN wfm_import_map m ON m.entity_type = 'job' AND m.nzi_id = j.job_id
                ORDER BY j.job_id
                """
            ).df()

        buf = io.BytesIO()
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("wfm_import_map.csv", map_df.to_csv(index=False) if map_df is not None else "")
            zf.writestr("wfm_import_audit.csv", audit_df.to_csv(index=False) if audit_df is not None else "")
            zf.writestr("clients_imported.csv", clients_df.to_csv(index=False) if clients_df is not None else "")
            zf.writestr("contacts_imported.csv", contacts_df.to_csv(index=False) if contacts_df is not None else "")
            zf.writestr("jobs_imported.csv", jobs_df.to_csv(index=False) if jobs_df is not None else "")
        buf.seek(0)
        return StreamingResponse(
            buf,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="wfm_import_export_{ts}.zip"'},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to export imported WFM data: {e}")
