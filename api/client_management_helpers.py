from __future__ import annotations

import mimetypes
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4

import pandas as pd

from core.database import db_backend, get_conn
from services import sites as sites_service
from services.audit_log import fetch_row_dict

PROJECT_ROOT = Path(__file__).resolve().parents[1]
UPLOADS_DIR = PROJECT_ROOT / "frontend" / "public" / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


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
    return PROJECT_ROOT / "frontend" / "public" / rel


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
