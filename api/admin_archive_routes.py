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



from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from core.database import get_conn
from api.auth import _current_user
from api.permissions import require_permission
from services.permissions import ADMIN_ACCESS_PERMISSION
from api.org_admin_helpers import (
    _actor_identifier,
    _build_org_export_zip,
    _delete_org_data,
    _ensure_org_entitlement_schema,
    _ensure_org_lifecycle_schema,
    _require_org_management_role,
    _require_org_owner_role,
)
from api.admin_suppliers_routes import _archive_cutoff, _archive_retention_days

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_permission(ADMIN_ACCESS_PERMISSION))],
)

# =========================
# ARCHIVE / EXPORT
# =========================

@router.get("/archived-clients")
def list_archived_clients(q: str = "", _user: dict = Depends(_current_user)):
    """List archived clients."""
    try:
        with get_conn() as con:
            df = con.execute(
                """
                SELECT db_id, client_name, industry, status, archived, archived_at, archived_by
                FROM clients
                WHERE (status = 'Archived' OR COALESCE(archived, FALSE) = TRUE)
                  AND client_name ILIKE %s
                ORDER BY COALESCE(archived_at, created_at) DESC NULLS LAST, client_name
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
                    "archived": bool(r.get("archived")) if r.get("archived") is not None else True,
                    "archived_at": str(r.get("archived_at")) if r.get("archived_at") else None,
                    "archived_by": str(r.get("archived_by")) if r.get("archived_by") else None,
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
                """
                UPDATE clients
                SET status = 'Active',
                    archived = FALSE,
                    archived_at = NULL,
                    archived_by = NULL
                WHERE db_id = %s
                """,
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


@router.get("/archived-notes")
def list_archived_notes(q: str = "", _user: dict = Depends(_current_user)):
    """List archived job communications/notes."""
    try:
        with get_conn() as con:
            search = f"%{q}%" if q else "%%"
            df = con.execute(
                """
                SELECT
                  jc.communication_id,
                  jc.job_id,
                  jc.channel,
                  jc.subject,
                  jc.message_text,
                  jc.scope,
                  jc.category,
                  jc.created_by,
                  jc.archived_at,
                  jc.archived_by,
                  jc.created_at,
                  j.job_number,
                  j.title AS job_title,
                  c.client_name
                FROM job_communications jc
                LEFT JOIN jobs j ON j.job_id = jc.job_id
                LEFT JOIN clients c ON c.db_id = j.client_db_id
                WHERE jc.archived = TRUE
                  AND (
                    %s = '%%%%'
                    OR jc.subject ILIKE %s
                    OR jc.message_text ILIKE %s
                    OR j.job_number ILIKE %s
                    OR j.title ILIKE %s
                    OR c.client_name ILIKE %s
                    OR jc.created_by ILIKE %s
                  )
                ORDER BY jc.archived_at DESC NULLS LAST, jc.communication_id DESC
                LIMIT 200
                """,
                [search, search, search, search, search, search, search],
            ).df()
        items = []
        if df is not None and not df.empty:
            for _, r in df.iterrows():
                items.append({
                    "communication_id": int(r["communication_id"]),
                    "job_id": int(r["job_id"]) if r.get("job_id") is not None else None,
                    "channel": str(r.get("channel") or "note"),
                    "subject": str(r.get("subject") or ""),
                    "message_text": str(r.get("message_text") or ""),
                    "scope": str(r.get("scope") or ""),
                    "category": str(r.get("category") or ""),
                    "created_by": str(r.get("created_by") or ""),
                    "archived_at": str(r["archived_at"]) if r.get("archived_at") else None,
                    "archived_by": str(r.get("archived_by") or ""),
                    "created_at": str(r["created_at"]) if r.get("created_at") else None,
                    "job_number": str(r.get("job_number") or ""),
                    "job_title": str(r.get("job_title") or ""),
                    "client_name": str(r.get("client_name") or ""),
                })
        return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list archived notes: {e}")


@router.patch("/archived-notes/{communication_id}/restore")
def restore_archived_note(communication_id: int, _user: dict = Depends(_current_user)):
    """Restore (unarchive) a note back to active status."""
    try:
        with get_conn() as con:
            row = con.execute(
                "SELECT communication_id FROM job_communications WHERE communication_id = %s AND archived = TRUE",
                [communication_id],
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Archived note not found")
            con.execute(
                """
                UPDATE job_communications
                SET archived = FALSE, archived_at = NULL, archived_by = NULL, status = 'logged'
                WHERE communication_id = %s
                """,
                [communication_id],
            )
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to restore note: {e}")


@router.delete("/archived-notes/{communication_id}")
def permanently_delete_archived_note(communication_id: int, _user: dict = Depends(_current_user)):
    """Permanently delete an archived note."""
    try:
        with get_conn() as con:
            row = con.execute(
                "SELECT communication_id, archived FROM job_communications WHERE communication_id = %s",
                [communication_id],
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Note not found")
            if not row[1]:
                raise HTTPException(status_code=400, detail="Note must be archived before permanent deletion")
            con.execute(
                "DELETE FROM job_communications WHERE communication_id = %s",
                [communication_id],
            )
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to permanently delete note: {e}")


@router.get("/archive/retention-summary")
def archive_retention_summary(_user: dict = Depends(_current_user)):
    """Summarize archived data and the current purge cutoff."""
    try:
        with get_conn() as con:
            retention_days = _archive_retention_days(con)
            cutoff = _archive_cutoff(retention_days)
            dataset_counts = con.execute(
                """
                SELECT
                  COUNT(*) AS archived_total,
                  COUNT(*) FILTER (WHERE archived_at IS NOT NULL AND archived_at <= %s) AS purgeable_total
                FROM datasets
                WHERE COALESCE(archived, FALSE) = TRUE
                """,
                [cutoff],
            ).fetchone()
            client_counts = con.execute(
                """
                SELECT
                  COUNT(*) AS archived_total,
                  COUNT(*) FILTER (WHERE archived_at IS NOT NULL AND archived_at <= %s) AS purgeable_total
                FROM clients
                WHERE status = 'Archived' OR COALESCE(archived, FALSE) = TRUE
                """,
                [cutoff],
            ).fetchone()
            note_counts = con.execute(
                "SELECT COUNT(*) FROM job_communications WHERE archived = TRUE",
            ).fetchone()
        return {
            "retention_days": retention_days,
            "cutoff_at": cutoff.isoformat(sep=" "),
            "datasets": {
                "archived_total": int(dataset_counts[0] or 0) if dataset_counts else 0,
                "purgeable_total": int(dataset_counts[1] or 0) if dataset_counts else 0,
            },
            "clients": {
                "archived_total": int(client_counts[0] or 0) if client_counts else 0,
                "purgeable_total": int(client_counts[1] or 0) if client_counts else 0,
            },
            "notes": {
                "archived_total": int(note_counts[0] or 0) if note_counts else 0,
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load archive retention summary: {e}")


@router.post("/archive/purge")
def purge_archived_data(body: dict = Body(default={}), _user: dict = Depends(_current_user)):
    """Purge archived datasets and clients that are older than the configured retention window."""
    try:
        actor = str(_user.get("email") or _user.get("user_id") or "admin").strip() or "admin"
        with get_conn() as con:
            retention_days = body.get("retention_days")
            if retention_days is None:
                retention_days = _archive_retention_days(con)
            try:
                retention_days = max(1, min(int(retention_days), 3650))
            except Exception:
                retention_days = _archive_retention_days(con)
            cutoff = _archive_cutoff(retention_days)

            dataset_rows = con.execute(
                """
                SELECT dataset_id, name
                FROM datasets
                WHERE COALESCE(archived, FALSE) = TRUE
                  AND archived_at IS NOT NULL
                  AND archived_at <= %s
                ORDER BY archived_at ASC NULLS LAST, dataset_id ASC
                """,
                [cutoff],
            ).fetchall()
            client_rows = con.execute(
                """
                SELECT db_id, client_name, archived_at
                FROM clients
                WHERE (status = 'Archived' OR COALESCE(archived, FALSE) = TRUE)
                  AND archived_at IS NOT NULL
                  AND archived_at <= %s
                ORDER BY archived_at ASC NULLS LAST, db_id ASC
                """,
                [cutoff],
            ).fetchall()

            deleted_datasets: list[dict[str, object]] = []
            for row in dataset_rows:
                dataset_id = int(row[0])
                dataset_name = str(row[1] or "")
                con.execute("DELETE FROM factor_lookup WHERE dataset_id = %s", [dataset_id])
                con.execute("DELETE FROM datasets WHERE dataset_id = %s", [dataset_id])
                deleted_datasets.append({"dataset_id": dataset_id, "name": dataset_name})

            deleted_clients: list[dict[str, object]] = []
            skipped_clients: list[dict[str, object]] = []
            for row in client_rows:
                client_id = int(row[0])
                client_name = str(row[1] or "")
                deps = {
                    "jobs": int((con.execute("SELECT COUNT(*) FROM jobs WHERE client_db_id = %s", [client_id]).fetchone() or [0])[0]),
                    "quotes": int((con.execute("SELECT COUNT(*) FROM quotes WHERE client_db_id = %s", [client_id]).fetchone() or [0])[0]),
                    "invoices": int((con.execute("SELECT COUNT(*) FROM invoices WHERE client_db_id = %s", [client_id]).fetchone() or [0])[0]),
                    "spend_mappings": int((con.execute("SELECT COUNT(*) FROM client_spend_mappings WHERE client_db_id = %s", [client_id]).fetchone() or [0])[0]),
                }
                if any(v > 0 for v in deps.values()):
                    skipped_clients.append({
                        "client_id": client_id,
                        "name": client_name,
                        "dependencies": deps,
                    })
                    continue

                con.execute("DELETE FROM client_contacts WHERE client_db_id = %s", [client_id])
                con.execute("DELETE FROM client_sites WHERE client_db_id = %s", [client_id])
                con.execute("DELETE FROM clients WHERE db_id = %s", [client_id])
                deleted_clients.append({"client_id": client_id, "name": client_name})

        return {
            "ok": True,
            "retention_days": int(retention_days),
            "cutoff_at": cutoff.isoformat(sep=" "),
            "datasets_deleted": deleted_datasets,
            "clients_deleted": deleted_clients,
            "clients_skipped": skipped_clients,
            "counts": {
                "datasets_deleted": len(deleted_datasets),
                "clients_deleted": len(deleted_clients),
                "clients_skipped": len(skipped_clients),
            },
            "actor": actor,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to purge archived data: {e}")


@router.get("/org/export")
def export_current_organisation_data(_user: dict = Depends(_current_user)):
    try:
        org_id = require_org(_user)
        with get_conn() as con:
            _ensure_org_lifecycle_schema(con)
            _ensure_org_entitlement_schema(con)
            _require_org_management_role(con, _user, org_id)
            payload, archive_name, _manifest = _build_org_export_zip(
                con,
                org_id,
                actor=_actor_identifier(_user),
            )
        return StreamingResponse(
            payload,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{archive_name}"'},
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to export organisation data: {e}")


@router.post("/org/delete")
def delete_current_organisation_data(body: dict = Body(default={}), _user: dict = Depends(_current_user)):
    try:
        org_id = require_org(_user)
        confirm_text = str(body.get("confirm_text") or body.get("confirm") or "").strip()
        if confirm_text != "DELETE":
            raise HTTPException(
                status_code=400,
                detail="Type DELETE in confirm_text to permanently delete the organisation",
            )

        with get_conn() as con:
            _ensure_org_lifecycle_schema(con)
            _ensure_org_entitlement_schema(con)
            _require_org_owner_role(con, _user, org_id)
            organisation = con.execute(
                "SELECT org_id, name, slug FROM organisations WHERE org_id = %s LIMIT 1",
                [org_id],
            ).fetchone()
            if not organisation:
                raise HTTPException(status_code=404, detail="Organisation not found")
            deletion_summary = _delete_org_data(con, org_id)
        logger.warning(
            "Organisation deleted org_id=%s org_name=%s actor=%s",
            org_id,
            str(organisation[1] or ""),
            _actor_identifier(_user),
        )
        return {
            "ok": True,
            "message": "Organisation and associated data deleted",
            "organisation": {
                "org_id": str(organisation[0] or org_id),
                "name": str(organisation[1] or ""),
                "slug": str(organisation[2] or ""),
            },
            "deletion_summary": deletion_summary,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete organisation data: {e}")


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
            current_org_id = get_current_org_context()
            report = await run_in_threadpool(
                run_with_org_context,
                _ingest_csv_report_for_dataset,
                current_org_id,
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
            current_org_id = get_current_org_context()
            report = await run_in_threadpool(
                run_with_org_context,
                ingest_workbook_with_report,
                current_org_id,
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


