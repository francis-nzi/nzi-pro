from __future__ import annotations

import json
import mimetypes
import os
import urllib.parse
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4

import pandas as pd

from core.database import db_backend, get_conn
from services import sites as sites_service
from services.audit_log import fetch_row_dict

PROJECT_ROOT = Path(__file__).resolve().parents[1]
# PERSISTENT_UPLOADS_DIR points at the Render disk mount in production
# (/var/data/nzi-pro-api/uploads) -- without it, uploaded files land on the
# container's own ephemeral filesystem and are silently wiped on every
# deploy/restart. Falls back to the old in-repo path for local dev, where
# there's no mounted disk.
_persistent_uploads = os.getenv("PERSISTENT_UPLOADS_DIR")
UPLOADS_DIR = Path(_persistent_uploads) if _persistent_uploads else PROJECT_ROOT / "frontend" / "public" / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Client logo storage: SharePoint/OneDrive-backed, same as job files.
#
# Render has no persistent disk actually provisioned (confirmed against the
# account -- render.yaml declares one but it was never created), so anything
# written to UPLOADS_DIR is wiped on every deploy/restart. Client logos now
# go to the same SharePoint document library job files already use, mirroring
# api/job_files_routes.py's onedrive helpers. Local disk remains the fallback
# when OneDrive isn't configured (local dev) and for the brief window before
# a brand-new client has a db_id to scope a folder to.
# ---------------------------------------------------------------------------


def _onedrive_enabled() -> bool:
    required_auth = [
        str(os.getenv("MS_TENANT_ID") or "").strip(),
        str(os.getenv("MS_CLIENT_ID") or "").strip(),
        str(os.getenv("MS_CLIENT_SECRET") or "").strip(),
    ]
    has_target = any(
        [
            str(os.getenv("MS_ONEDRIVE_DRIVE_ID") or "").strip(),
            str(os.getenv("MS_ONEDRIVE_SITE_ID") or "").strip(),
            (
                str(os.getenv("MS_ONEDRIVE_SITE_HOST") or "").strip()
                and str(os.getenv("MS_ONEDRIVE_SITE_PATH") or "").strip()
            ),
            str(os.getenv("MS_ONEDRIVE_USER_ID") or "").strip(),
        ]
    )
    return all(required_auth) and bool(has_target)


def _ensure_client_logo_storage_columns(con) -> None:
    con.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS logo_storage_provider VARCHAR DEFAULT 'local'")
    con.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS logo_external_item_id VARCHAR")


def _onedrive_ensure_folder(token: str, folder_path: str) -> None:
    from api.onedrive_routes import _drive_base_path, _graph_request
    from fastapi import HTTPException

    drive_base = _drive_base_path(token)
    segments = [seg for seg in str(folder_path or "").strip("/").split("/") if seg]
    current = ""
    for segment in segments:
        current = f"{current}/{segment}" if current else f"/{segment}"
        encoded = urllib.parse.quote(current, safe="/")
        try:
            _graph_request("GET", f"{drive_base}/root:{encoded}:", token)
            continue
        except HTTPException as e:
            if "Graph API error 404" not in str(e.detail):
                raise
        parent = current.rsplit("/", 1)[0]
        parent_target = (
            f"{drive_base}/root:{urllib.parse.quote(parent, safe='/')}:/children" if parent else f"{drive_base}/root/children"
        )
        payload = json.dumps(
            {"name": segment, "folder": {}, "@microsoft.graph.conflictBehavior": "replace"}
        ).encode("utf-8")
        _graph_request("POST", parent_target, token, body=payload, content_type="application/json")


def _upload_client_logo_to_onedrive(client_db_id: int, filename: str, content: bytes) -> dict[str, str]:
    from api.onedrive_routes import _drive_base_path, _graph_request, _graph_token, _joined_remote_path

    token = _graph_token()
    drive_base = _drive_base_path(token)
    remote_folder = _joined_remote_path(f"client-logos/client-{int(client_db_id)}")
    _onedrive_ensure_folder(token, remote_folder)

    full_path = f"{remote_folder}/{filename}"
    encoded = urllib.parse.quote(full_path, safe="/")
    meta = _graph_request(
        "PUT",
        f"{drive_base}/root:{encoded}:/content",
        token,
        body=content,
        content_type="application/octet-stream",
    )
    return {"external_item_id": str(meta.get("id") or ""), "external_web_url": str(meta.get("webUrl") or "")}


def fetch_client_logo_bytes(client_db_id: int) -> tuple[bytes, str] | None:
    """Returns (content, content_type) if this client's logo is SharePoint-stored, else None
    (caller should fall back to serving from local disk)."""
    from api.onedrive_routes import _drive_base_path, _graph_download, _graph_token

    with get_conn() as con:
        _ensure_client_logo_storage_columns(con)
        row = con.execute(
            "SELECT logo_storage_provider, logo_external_item_id FROM clients WHERE db_id = %s",
            [int(client_db_id)],
        ).fetchone()
    if not row or str(row[0] or "") != "onedrive" or not row[1]:
        return None
    token = _graph_token()
    drive_base = _drive_base_path(token)
    return _graph_download(f"{drive_base}/items/{urllib.parse.quote(str(row[1]))}/content", token)


def _client_audit_snapshot(con, client_db_id: int, org_id: str | None = None) -> dict | None:
    if org_id is not None and str(org_id).strip():
        return fetch_row_dict(
            con,
            "SELECT * FROM clients WHERE db_id = ? AND org_id = ?",
            [int(client_db_id), str(org_id).strip()],
        )
    return fetch_row_dict(
        con,
        "SELECT * FROM clients WHERE db_id = ?",
        [int(client_db_id)],
    )


def _client_site_audit_snapshot(con, client_db_id: int, site_id: int, org_id: str | None = None) -> dict | None:
    if org_id is not None and str(org_id).strip():
        row = fetch_row_dict(
            con,
            "SELECT * FROM client_sites WHERE client_db_id = ? AND site_id = ? AND org_id = ?",
            [int(client_db_id), int(site_id), str(org_id).strip()],
        )
        if row:
            return row
        return fetch_row_dict(
            con,
            "SELECT * FROM client_sites WHERE client_db_id = ? AND site_id = ? AND org_id IS NULL",
            [int(client_db_id), int(site_id)],
        )
    return fetch_row_dict(
        con,
        "SELECT * FROM client_sites WHERE client_db_id = ? AND site_id = ?",
        [int(client_db_id), int(site_id)],
    )


def _ensure_client_sites_runtime_columns(con) -> None:
    fn = getattr(sites_service, "ensure_client_sites_runtime_columns", None)
    if callable(fn):
        fn(con)


def _ensure_registered_office_site(client_db_id: int, con=None) -> int | None:
    fn = getattr(sites_service, "ensure_registered_office_site", None)
    if callable(fn):
        return fn(client_db_id, con=con)
    return None


def _list_sites(client_db_id: int):
    fn = getattr(sites_service, "list_sites", None)
    if callable(fn):
        return fn(client_db_id)
    return pd.DataFrame(columns=["site_id", "site_name", "location", "is_registered_office"])


def _fetch_client_sites_payload(client_db_id: int, con=None) -> dict[str, object]:
    fn = getattr(sites_service, "fetch_client_sites_payload", None)
    if callable(fn):
        return fn(client_db_id, con=con)

    df = _list_sites(client_db_id)
    active_sites: list[dict[str, object]] = []
    if df is not None and (not df.empty):
        for _, r in df.iterrows():
            active_sites.append(
                {
                    "site_id": int(r.get("site_id")) if r.get("site_id") is not None else None,
                    "site_name": r.get("site_name"),
                    "location": r.get("location"),
                    "is_registered_office": bool(r.get("is_registered_office"))
                    if r.get("is_registered_office") is not None
                    else False,
                    "vacated_date": None,
                }
            )
    return {
        "client_db_id": int(client_db_id),
        "active_sites": active_sites,
        "vacated_sites": [],
    }


def _client_contact_audit_snapshot(con, client_db_id: int, contact_id: int, org_id: str | None = None) -> dict | None:
    if org_id is not None and str(org_id).strip():
        return fetch_row_dict(
            con,
            "SELECT * FROM client_contacts WHERE client_db_id = ? AND contact_id = ? AND org_id = ?",
            [int(client_db_id), int(contact_id), str(org_id).strip()],
        )
    return fetch_row_dict(
        con,
        "SELECT * FROM client_contacts WHERE client_db_id = ? AND contact_id = ?",
        [int(client_db_id), int(contact_id)],
    )


def _client_logo_scope_dir(client_db_id: int | None) -> str:
    if client_db_id is not None and int(client_db_id) > 0:
        return f"client-{int(client_db_id)}"
    return f"temp-{uuid4().hex}"


def _client_logo_upload_path(client_db_id: int | None, filename: str, content_type: str | None) -> tuple[Path, str]:
    scope_dir = _client_logo_scope_dir(client_db_id)
    upload_dir = UPLOADS_DIR / "clients" / scope_dir
    upload_dir.mkdir(parents=True, exist_ok=True)

    ext = Path(filename or "").suffix.lower()
    if ext and ext not in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"}:
        ext = ""
    if not ext:
        guessed = mimetypes.guess_extension(str(content_type or "").split(";")[0].strip().lower())
        if guessed == ".jpe":
            guessed = ".jpg"
        ext = guessed if guessed in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"} else ".png"

    target_path = upload_dir / f"logo{ext}"
    return target_path, f"/uploads/clients/{scope_dir}/logo{ext}"


def _resolve_uploaded_logo_path(raw_url: str | None) -> Path | None:
    raw = str(raw_url or "").strip()
    if not raw:
        return None
    parsed = urlparse(raw)
    path = parsed.path if parsed.scheme else raw
    rel = path.lstrip("/")
    if not rel.startswith("uploads/"):
        return None
    return UPLOADS_DIR / rel[len("uploads/"):]


def _ensure_client_billing_columns(con) -> None:
    """Ensure client billing-address columns exist for older deployments."""
    statements = [
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS org_id UUID",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS create_site_from_address BOOLEAN",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_company VARCHAR",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_same_as_main BOOLEAN DEFAULT TRUE",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_addr_line1 VARCHAR",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_addr_line2 VARCHAR",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_addr_city VARCHAR",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_addr_region VARCHAR",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_addr_postcode VARCHAR",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_addr_country VARCHAR",
    ]
    for statement in statements:
        con.execute(statement)


def _ensure_client_org_columns(con) -> None:
    """Ensure client/org tenancy columns exist."""
    statements = [
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS org_id UUID",
        "ALTER TABLE client_sites ADD COLUMN IF NOT EXISTS org_id UUID",
        "ALTER TABLE client_contacts ADD COLUMN IF NOT EXISTS org_id UUID",
    ]
    for statement in statements:
        try:
            con.execute(statement)
        except Exception:
            pass
