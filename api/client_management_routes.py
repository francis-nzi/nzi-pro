from __future__ import annotations

import pandas as pd
from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Request, UploadFile

from api.auth import _current_user
from api.client_management_helpers import (
    _client_audit_snapshot,
    _client_contact_audit_snapshot,
    _client_logo_upload_path,
    _client_site_audit_snapshot,
    _ensure_client_billing_columns,
    _ensure_client_org_columns,
    _ensure_client_sites_runtime_columns,
    _fetch_client_sites_payload,
    _resolve_uploaded_logo_path,
)
from api.permissions import assert_client_access, assert_permission
from core.database import get_conn
from services.audit_log import record_audit_event
from services.client_benchmark import ensure_client_benchmark_columns
from services.tenancy import require_org
from api.org_admin_helpers import _require_org_capacity

router = APIRouter()


@router.post("/clients")
def create_client(
    request: Request,
    body: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user),
):
    """Create a new client."""
    try:
        assert_permission(_user, "clients.create")
        org_id = require_org(_user)
        client_name = body.get("client_name", "").strip()
        if not client_name:
            raise HTTPException(status_code=400, detail="client_name is required")

        billing_same_as_main = bool(body.get("billing_same_as_main", True))
        billing_company = str(body.get("billing_company") or client_name).strip() or client_name
        main_addr_line1 = body.get("addr_line1")
        main_addr_line2 = body.get("addr_line2")
        main_addr_city = body.get("addr_city")
        main_addr_region = body.get("addr_region")
        main_addr_postcode = body.get("addr_postcode")
        main_addr_country = body.get("addr_country")

        billing_addr_line1 = main_addr_line1 if billing_same_as_main else body.get("billing_addr_line1")
        billing_addr_line2 = main_addr_line2 if billing_same_as_main else body.get("billing_addr_line2")
        billing_addr_city = main_addr_city if billing_same_as_main else body.get("billing_addr_city")
        billing_addr_region = main_addr_region if billing_same_as_main else body.get("billing_addr_region")
        billing_addr_postcode = main_addr_postcode if billing_same_as_main else body.get("billing_addr_postcode")
        billing_addr_country = main_addr_country if billing_same_as_main else body.get("billing_addr_country")

        with get_conn() as con:
            _ensure_client_billing_columns(con)
            _ensure_client_org_columns(con)
            ensure_client_benchmark_columns(con)
            _require_org_capacity(con, org_id, additional_clients=1)
            existing = con.execute(
                """
                SELECT db_id
                FROM clients
                WHERE org_id = ? AND lower(trim(client_name)) = lower(trim(?))
                ORDER BY db_id DESC
                LIMIT 1
                """,
                [org_id, client_name],
            ).fetchone()
            if existing:
                raise HTTPException(
                    status_code=409,
                    detail=f"Client '{client_name}' already exists (ID: {int(existing[0])})",
                )

            row = con.execute(
                """
                INSERT INTO clients (
                    org_id, client_name, billing_company, industry, description_long, website, year_end_month,
                    company_reg, sic_code, headquarters, addr_line1, addr_line2, addr_city,
                    addr_region, addr_postcode, addr_country, logo_url, portfolio,
                    crm_owner, currency, status, net_zero_year, benchmark_year,
                    benchmark_scope_1_tco2e, benchmark_scope_2_tco2e,
                    benchmark_scope_3_tco2e, benchmark_total_tco2e,
                    target_s1_year, target_s1_pct, target_s2_year, target_s2_pct,
                    target_s3_year, target_s3_pct, billing_same_as_main,
                    billing_addr_line1, billing_addr_line2, billing_addr_city,
                    billing_addr_region, billing_addr_postcode, billing_addr_country,
                    create_site_from_address
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                RETURNING db_id
                """,
                [
                    org_id,
                    client_name,
                    billing_company,
                    body.get("industry"),
                    body.get("description_long"),
                    body.get("website"),
                    body.get("year_end_month"),
                    body.get("company_reg"),
                    body.get("sic_code"),
                    body.get("headquarters"),
                    main_addr_line1,
                    main_addr_line2,
                    main_addr_city,
                    main_addr_region,
                    main_addr_postcode,
                    main_addr_country,
                    body.get("logo_url"),
                    body.get("portfolio"),
                    body.get("crm_owner"),
                    str(body.get("currency") or "GBP").upper(),
                    body.get("status", "Active"),
                    body.get("net_zero_year"),
                    body.get("benchmark_year"),
                    body.get("benchmark_scope_1_tco2e"),
                    body.get("benchmark_scope_2_tco2e"),
                    body.get("benchmark_scope_3_tco2e"),
                    body.get("benchmark_total_tco2e"),
                    body.get("target_s1_year"),
                    body.get("target_s1_pct"),
                    body.get("target_s2_year"),
                    body.get("target_s2_pct"),
                    body.get("target_s3_year"),
                    body.get("target_s3_pct"),
                    billing_same_as_main,
                    billing_addr_line1,
                    billing_addr_line2,
                    billing_addr_city,
                    billing_addr_region,
                    billing_addr_postcode,
                    billing_addr_country,
                    body.get("create_site_from_address", False),
                ],
            ).fetchone()

            client_db_id = int(row[0])

            if body.get("create_site_from_address", False):
                addr_parts = []
                if body.get("addr_line1"):
                    addr_parts.append(body.get("addr_line1"))
                if body.get("addr_line2"):
                    addr_parts.append(body.get("addr_line2"))
                if body.get("addr_city"):
                    addr_parts.append(body.get("addr_city"))
                if body.get("addr_region"):
                    addr_parts.append(body.get("addr_region"))
                if body.get("addr_postcode"):
                    addr_parts.append(body.get("addr_postcode"))
                if body.get("addr_country"):
                    addr_parts.append(body.get("addr_country"))

                location = ", ".join(addr_parts) if addr_parts else "Registered Office"

                con.execute(
                    """
                    INSERT INTO client_sites (org_id, client_db_id, site_name, location, is_registered_office)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    [org_id, client_db_id, "Registered Office", location, True],
                )

            after = _client_audit_snapshot(con, client_db_id, org_id)
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="create",
                entity_type="client",
                entity_id=int(client_db_id),
                client_id=int(client_db_id),
                after=after,
                metadata={
                    "create_site_from_address": bool(body.get("create_site_from_address", False)),
                },
            )

            return {"ok": True, "client_db_id": client_db_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create client: {e}")


@router.post("/clients/logo-upload")
async def upload_client_logo(
    request: Request,
    file: UploadFile = File(...),
    client_db_id: int | None = Form(None),
    _user: dict[str, str] = Depends(_current_user),
):
    """Upload a client logo and optionally persist it against the client record."""
    if not file.content_type or not str(file.content_type).startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(raw) > (5 * 1024 * 1024):
        raise HTTPException(status_code=400, detail="Logo exceeds 5MB limit")

    target_path, logo_url = _client_logo_upload_path(client_db_id, file.filename or "logo.png", file.content_type)
    target_path.parent.mkdir(parents=True, exist_ok=True)

    if client_db_id is not None and int(client_db_id) > 0:
        assert_permission(_user, "clients.edit")
        assert_client_access(_user, int(client_db_id))
    else:
        assert_permission(_user, "clients.create")

    try:
        if client_db_id is not None and int(client_db_id) > 0 and target_path.parent.exists():
            for existing in target_path.parent.glob("logo.*"):
                try:
                    if existing.is_file():
                        existing.unlink()
                except Exception:
                    pass

        with target_path.open("wb") as buffer:
            buffer.write(raw)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save client logo: {exc}")

    actor = _user.get("email", "unknown")
    if client_db_id is not None and int(client_db_id) > 0:
        client_db_id = int(client_db_id)
        org_id = require_org(_user)
        with get_conn() as con:
            before = _client_audit_snapshot(con, client_db_id, org_id)
            if not before:
                raise HTTPException(status_code=404, detail="Client not found")
            existing_logo = str(before.get("logo_url") or "").strip()
            con.execute(
                "UPDATE clients SET logo_url = ? WHERE db_id = ? AND org_id = ?",
                [logo_url, client_db_id, org_id],
            )
            after = _client_audit_snapshot(con, client_db_id, org_id)
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="update",
                entity_type="client",
                entity_id=client_db_id,
                client_id=client_db_id,
                before=before,
                after=after,
                metadata={
                    "field": "logo_url",
                    "uploaded_filename": target_path.name,
                },
            )
            old_path = _resolve_uploaded_logo_path(existing_logo)
            if old_path and old_path.exists() and old_path != target_path:
                try:
                    old_path.unlink()
                except Exception:
                    pass

    return {
        "ok": True,
        "message": "Client logo uploaded successfully",
        "logo_url": logo_url,
        "filename": target_path.name,
    }


@router.get("/clients/{client_db_id}")
def get_client(client_db_id: int, _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "clients.view")
    require_org(_user)
    with get_conn() as con:
        assert_client_access(_user, int(client_db_id))
        row = con.execute(
            """
            SELECT c.db_id, c.client_name, c.industry, c.description_long, c.status,
                   c.website, c.year_end_month, c.company_reg, c.sic_code, c.headquarters,
                   c.addr_line1, c.addr_line2, c.addr_city, c.addr_region,
            c.addr_postcode, c.addr_country, c.logo_url, c.crm_owner,
            c.net_zero_year, c.interim_year, c.interim_s1_pct, c.interim_s2_pct,
            c.interim_s3_pct, c.portfolio, c.benchmark_year,
            c.benchmark_period_start, c.benchmark_period_end, c.currency,
            COALESCE(c.billing_same_as_main, TRUE), c.billing_addr_line1,
                   c.billing_addr_line2, c.billing_addr_city, c.billing_addr_region,
                   c.billing_addr_postcode, c.billing_addr_country,
            c.create_site_from_address,
            c.benchmark_scope_1_tco2e, c.benchmark_scope_2_tco2e,
            c.benchmark_scope_3_tco2e, c.benchmark_total_tco2e,
            COALESCE(c.billing_company, c.client_name)
            FROM clients c
            WHERE c.db_id=?
            LIMIT 1
            """,
            [int(client_db_id)],
        ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Client not found")

    return {
        "client_db_id": int(row[0]),
        "client_name": row[1],
        "industry": row[2],
        "description_long": row[3],
        "status": row[4],
        "website": row[5],
        "year_end_month": row[6],
        "company_reg": row[7],
        "sic_code": row[8],
        "headquarters": row[9],
        "addr_line1": row[10],
        "addr_line2": row[11],
        "addr_city": row[12],
        "addr_region": row[13],
        "addr_postcode": row[14],
        "addr_country": row[15],
        "logo_url": row[16],
        "crm_owner": row[17],
        "net_zero_year": (int(row[18]) if row[18] is not None else None),
        "interim_year": (int(row[19]) if row[19] is not None else None),
        "interim_s1_pct": (int(row[20]) if row[20] is not None else None),
        "interim_s2_pct": (int(row[21]) if row[21] is not None else None),
        "interim_s3_pct": (int(row[22]) if row[22] is not None else None),
        "portfolio": row[23],
        "benchmark_year": (int(row[24]) if row[24] is not None else None),
        "benchmark_period_start": str(row[25]) if row[25] is not None else None,
        "benchmark_period_end": str(row[26]) if row[26] is not None else None,
        "currency": row[27] if row[27] is not None else "GBP",
        "billing_same_as_main": bool(row[28]) if row[28] is not None else True,
        "billing_addr_line1": row[29],
        "billing_addr_line2": row[30],
        "billing_addr_city": row[31],
        "billing_addr_region": row[32],
        "billing_addr_postcode": row[33],
        "billing_addr_country": row[34],
        "create_site_from_address": bool(row[35]) if row[35] is not None else bool(
            row[10] or row[11] or row[12] or row[13] or row[14] or row[15]
        ),
        "benchmark_scope_1_tco2e": float(row[36]) if row[36] is not None else None,
        "benchmark_scope_2_tco2e": float(row[37]) if row[37] is not None else None,
        "benchmark_scope_3_tco2e": float(row[38]) if row[38] is not None else None,
        "benchmark_total_tco2e": float(row[39]) if row[39] is not None else None,
        "billing_company": row[40] if len(row) > 40 else row[1],
        }


@router.patch("/clients/{client_db_id}")
def update_client(
    request: Request,
    client_db_id: int,
    body: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user),
):
    """Update client information."""
    try:
        assert_permission(_user, "clients.edit")
        assert_client_access(_user, int(client_db_id))
        org_id = require_org(_user)
        with get_conn() as con:
            _ensure_client_org_columns(con)
            _ensure_client_billing_columns(con)
            ensure_client_benchmark_columns(con)
            before = _client_audit_snapshot(con, int(client_db_id), org_id)
            existing_client = con.execute(
                """
                SELECT
                    org_id,
                    addr_line1, addr_line2, addr_city, addr_region, addr_postcode, addr_country,
                    billing_same_as_main, billing_addr_line1, billing_addr_line2, billing_addr_city,
                    billing_addr_region, billing_addr_postcode, billing_addr_country
                FROM clients
                WHERE db_id = ? AND org_id = ?
                LIMIT 1
                """,
                [int(client_db_id), org_id],
            ).fetchone()
            if not existing_client:
                raise HTTPException(status_code=404, detail="Client not found")

            updates = []
            params = []
            normalized_body = dict(body)
            billing_related_fields = {
                "billing_same_as_main",
                "billing_addr_line1",
                "billing_addr_line2",
                "billing_addr_city",
                "billing_addr_region",
                "billing_addr_postcode",
                "billing_addr_country",
                "addr_line1",
                "addr_line2",
                "addr_city",
                "addr_region",
                "addr_postcode",
                "addr_country",
            }
            if any(field in normalized_body for field in billing_related_fields):
                current_main_addr = {
                    "addr_line1": existing_client[1] if existing_client else None,
                    "addr_line2": existing_client[2] if existing_client else None,
                    "addr_city": existing_client[3] if existing_client else None,
                    "addr_region": existing_client[4] if existing_client else None,
                    "addr_postcode": existing_client[5] if existing_client else None,
                    "addr_country": existing_client[6] if existing_client else None,
                }
                billing_same_default = bool(existing_client[7]) if existing_client and existing_client[7] is not None else True
                billing_same_as_main = bool(normalized_body.get("billing_same_as_main", billing_same_default))
                normalized_body["billing_same_as_main"] = billing_same_as_main
                if billing_same_as_main:
                    normalized_body["billing_addr_line1"] = normalized_body.get("addr_line1", current_main_addr["addr_line1"])
                    normalized_body["billing_addr_line2"] = normalized_body.get("addr_line2", current_main_addr["addr_line2"])
                    normalized_body["billing_addr_city"] = normalized_body.get("addr_city", current_main_addr["addr_city"])
                    normalized_body["billing_addr_region"] = normalized_body.get("addr_region", current_main_addr["addr_region"])
                    normalized_body["billing_addr_postcode"] = normalized_body.get("addr_postcode", current_main_addr["addr_postcode"])
                    normalized_body["billing_addr_country"] = normalized_body.get("addr_country", current_main_addr["addr_country"])

            field_mapping = {
                "client_name": "client_name",
                "industry": "industry",
                "description_long": "description_long",
                "website": "website",
                "year_end_month": "year_end_month",
                "company_reg": "company_reg",
                "sic_code": "sic_code",
                "headquarters": "headquarters",
                "addr_line1": "addr_line1",
                "addr_line2": "addr_line2",
                "addr_city": "addr_city",
                "addr_region": "addr_region",
                "addr_postcode": "addr_postcode",
                "addr_country": "addr_country",
                "logo_url": "logo_url",
                "crm_owner": "crm_owner",
                "net_zero_year": "net_zero_year",
                "interim_year": "interim_year",
                "interim_s1_pct": "interim_s1_pct",
                "interim_s2_pct": "interim_s2_pct",
                "interim_s3_pct": "interim_s3_pct",
                "portfolio": "portfolio",
                "benchmark_year": "benchmark_year",
                "currency": "currency",
                "billing_same_as_main": "billing_same_as_main",
                "billing_company": "billing_company",
                "billing_addr_line1": "billing_addr_line1",
                "billing_addr_line2": "billing_addr_line2",
                "billing_addr_city": "billing_addr_city",
                "billing_addr_region": "billing_addr_region",
                "billing_addr_postcode": "billing_addr_postcode",
                "billing_addr_country": "billing_addr_country",
                "create_site_from_address": "create_site_from_address",
                "status": "status",
            }

            for field_name, col_name in field_mapping.items():
                if field_name in normalized_body:
                    updates.append(f"{col_name} = ?")
                    params.append(normalized_body[field_name])

            if updates:
                params.extend([int(client_db_id), org_id])
                query = f"""
                    UPDATE clients
                    SET {', '.join(updates)}
                    WHERE db_id = ? AND org_id = ?
                """
                con.execute(query, params)

            after = _client_audit_snapshot(con, int(client_db_id), org_id)
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="update",
                entity_type="client",
                entity_id=int(client_db_id),
                client_id=int(client_db_id),
                before=before,
                after=after,
                metadata={"updated_fields": list(body.keys())},
            )

            return {"ok": True, "message": "Client updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Update failed: {e}")


@router.get("/clients/{client_db_id}/sites")
def client_sites(client_db_id: int, _user: dict[str, str] = Depends(_current_user)):
    try:
        assert_permission(_user, "clients.view")
        assert_client_access(_user, int(client_db_id))
        org_id = require_org(_user)
        with get_conn() as con:
            _ensure_client_org_columns(con)
            _ensure_client_billing_columns(con)
            payload = _fetch_client_sites_payload(int(client_db_id), con=con)
            payload["org_id"] = org_id
            return payload
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch sites: {e}")


@router.post("/clients/{client_db_id}/sites")
def create_client_site(
    request: Request,
    client_db_id: int,
    body: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user),
):
    """Create a new site for a client."""
    try:
        assert_permission(_user, "clients.sites.manage")
        assert_client_access(_user, int(client_db_id))
        org_id = require_org(_user)
        with get_conn() as con:
            _ensure_client_org_columns(con)
            _ensure_client_sites_runtime_columns(con)
            if body.get("is_registered_office", False):
                con.execute(
                    "UPDATE client_sites SET is_registered_office = FALSE WHERE client_db_id = ? AND org_id = ?",
                    [int(client_db_id), org_id],
                )

            row = con.execute(
                """
                INSERT INTO client_sites (org_id, client_db_id, site_name, location, is_registered_office)
                VALUES (?, ?, ?, ?, ?)
                RETURNING site_id
                """,
                [
                    org_id,
                    int(client_db_id),
                    body.get("site_name"),
                    body.get("location"),
                    body.get("is_registered_office", False),
                ],
            ).fetchone()

            site_id_value = int(row[0])
            after = _client_site_audit_snapshot(con, int(client_db_id), site_id_value, org_id)
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="create",
                entity_type="client_site",
                entity_id=site_id_value,
                client_id=int(client_db_id),
                after=after,
                metadata={"is_registered_office": bool(body.get("is_registered_office", False))},
            )

            return {"ok": True, "site_id": site_id_value}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create site: {e}")


@router.patch("/clients/{client_db_id}/sites/{site_id}")
def update_client_site(
    request: Request,
    client_db_id: int,
    site_id: int,
    body: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user),
):
    """Update a client site."""
    try:
        assert_permission(_user, "clients.sites.manage")
        assert_client_access(_user, int(client_db_id))
        org_id = require_org(_user)
        with get_conn() as con:
            _ensure_client_org_columns(con)
            _ensure_client_sites_runtime_columns(con)
            before = _client_site_audit_snapshot(con, int(client_db_id), int(site_id), org_id)
            exists = con.execute(
                """
                SELECT site_id, org_id
                FROM client_sites
                WHERE site_id = ?
                  AND client_db_id = ?
                  AND org_id = ?
                LIMIT 1
                """,
                [int(site_id), int(client_db_id), org_id],
            ).fetchone()

            if not exists:
                raise HTTPException(status_code=404, detail="Site not found")

            if body.get("is_registered_office", False):
                con.execute(
                    """
                    UPDATE client_sites
                    SET is_registered_office = FALSE
                    WHERE client_db_id = ?
                      AND site_id != ?
                      AND org_id = ?
                    """,
                    [int(client_db_id), int(site_id), org_id],
                )

            updates = []
            params = []

            field_mapping = {
                "site_name": "site_name",
                "location": "location",
                "is_registered_office": "is_registered_office",
            }

            for field_name, col_name in field_mapping.items():
                if field_name in body:
                    updates.append(f"{col_name} = ?")
                    params.append(body[field_name])

            if updates:
                params.extend([int(site_id), int(client_db_id), org_id])
                query = f"""
                    UPDATE client_sites
                    SET {', '.join(updates)}
                    WHERE site_id = ?
                      AND client_db_id = ?
                      AND org_id = ?
                """
                con.execute(query, params)

            after = _client_site_audit_snapshot(con, int(client_db_id), int(site_id), org_id)
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="update",
                entity_type="client_site",
                entity_id=int(site_id),
                client_id=int(client_db_id),
                before=before,
                after=after,
                metadata={"updated_fields": list(body.keys())},
            )

            return {"ok": True, "message": "Site updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update site: {e}")


@router.patch("/clients/{client_db_id}/sites/{site_id}/vacate")
def vacate_client_site(
    request: Request,
    client_db_id: int,
    site_id: int,
    body: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user),
):
    """Mark a site as vacated with a date (preserves historical emissions data)."""
    try:
        assert_permission(_user, "clients.sites.manage")
        assert_client_access(_user, int(client_db_id))
        org_id = require_org(_user)
        with get_conn() as con:
            _ensure_client_org_columns(con)
            _ensure_client_sites_runtime_columns(con)
            before = _client_site_audit_snapshot(con, int(client_db_id), int(site_id), org_id)
            exists = con.execute(
                """
                SELECT site_id, org_id
                FROM client_sites
                WHERE site_id = ?
                  AND client_db_id = ?
                  AND org_id = ?
                LIMIT 1
                """,
                [int(site_id), int(client_db_id), org_id],
            ).fetchone()

            if not exists:
                raise HTTPException(status_code=404, detail="Site not found")

            vacated_date = body.get("vacated_date")
            if not vacated_date:
                raise HTTPException(status_code=400, detail="vacated_date is required")

            con.execute(
                """
                UPDATE client_sites
                SET vacated_date = ?,
                    archived = TRUE,
                    archived_by = ?,
                    archived_at = CURRENT_TIMESTAMP
                WHERE site_id = ? AND client_db_id = ? AND org_id = ?
                """,
                [vacated_date, _user.get("email", "unknown"), int(site_id), int(client_db_id), org_id],
            )

            after = _client_site_audit_snapshot(con, int(client_db_id), int(site_id), org_id)
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="vacate",
                entity_type="client_site",
                entity_id=int(site_id),
                client_id=int(client_db_id),
                before=before,
                after=after,
                metadata={"vacated_date": vacated_date},
            )

            return {"ok": True, "message": "Site vacated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to vacate site: {e}")


@router.get("/clients/{client_db_id}/contacts")
def get_client_contacts(client_db_id: int, _user: dict[str, str] = Depends(_current_user)):
    """Get all contacts for a client."""
    try:
        assert_permission(_user, "clients.view")
        assert_client_access(_user, int(client_db_id))
        org_id = require_org(_user)
        with get_conn() as con:
            _ensure_client_org_columns(con)
            try:
                if org_id:
                    df = con.execute(
                        """
                        SELECT contact_id, client_db_id, full_name, job_title, email, phone, is_primary
                        FROM client_contacts
                        WHERE client_db_id = ? AND org_id = ?
                        ORDER BY is_primary DESC, full_name ASC
                        """,
                        [int(client_db_id), org_id],
                    ).df()
                else:
                    df = con.execute(
                        """
                        SELECT contact_id, client_db_id, full_name, job_title, email, phone, is_primary
                        FROM client_contacts
                        WHERE client_db_id = ?
                        ORDER BY is_primary DESC, full_name ASC
                        """,
                        [int(client_db_id)],
                    ).df()
            except Exception:
                df = con.execute(
                    """
                    SELECT contact_id, client_db_id, full_name, job_title, email, phone, is_primary
                    FROM client_contacts
                    WHERE client_db_id = ?
                    ORDER BY is_primary DESC, full_name ASC
                    """,
                    [int(client_db_id)],
                ).df()

            def _contact_is_missing(value) -> bool:
                try:
                    return pd.isna(value)
                except Exception:
                    return value is None

            def _contact_int_or_none(value):
                if _contact_is_missing(value):
                    return None
                try:
                    return int(value)
                except Exception:
                    return None

            def _contact_bool_or_false(value) -> bool:
                if _contact_is_missing(value):
                    return False
                try:
                    return bool(value)
                except Exception:
                    return False

            contacts = []
            if df is not None and not df.empty:
                for _, row in df.iterrows():
                    contact_id_value = _contact_int_or_none(row.get("contact_id"))
                    client_db_id_value = _contact_int_or_none(row.get("client_db_id"))
                    if contact_id_value is None or client_db_id_value is None:
                        continue
                    contacts.append(
                        {
                            "contact_id": contact_id_value,
                            "client_db_id": client_db_id_value,
                            "full_name": None if _contact_is_missing(row.get("full_name")) else row.get("full_name"),
                            "job_title": None if _contact_is_missing(row.get("job_title")) else row.get("job_title"),
                            "email": None if _contact_is_missing(row.get("email")) else row.get("email"),
                            "phone": None if _contact_is_missing(row.get("phone")) else row.get("phone"),
                            "is_primary": _contact_bool_or_false(row.get("is_primary")),
                        }
                    )

            return {"client_db_id": int(client_db_id), "contacts": contacts}
    except Exception:
        return {"client_db_id": int(client_db_id), "contacts": []}


@router.post("/clients/{client_db_id}/contacts")
def create_client_contact(
    request: Request,
    client_db_id: int,
    body: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user),
):
    """Create a new contact for a client."""
    try:
        assert_permission(_user, "clients.contacts.manage")
        assert_client_access(_user, int(client_db_id))
        org_id = require_org(_user)
        with get_conn() as con:
            _ensure_client_org_columns(con)
            if body.get("is_primary", False):
                con.execute(
                    "UPDATE client_contacts SET is_primary = FALSE WHERE client_db_id = ? AND org_id = ?",
                    [int(client_db_id), org_id],
                )

            row = con.execute(
                """
                INSERT INTO client_contacts (org_id, client_db_id, full_name, job_title, email, phone, is_primary)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                RETURNING contact_id
                """,
                [
                    org_id,
                    int(client_db_id),
                    body.get("full_name"),
                    body.get("job_title"),
                    body.get("email"),
                    body.get("phone"),
                    body.get("is_primary", False),
                ],
            ).fetchone()

            contact_id_value = int(row[0])
            after = _client_contact_audit_snapshot(con, int(client_db_id), contact_id_value)
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="create",
                entity_type="client_contact",
                entity_id=contact_id_value,
                client_id=int(client_db_id),
                after=after,
                metadata={"is_primary": bool(body.get("is_primary", False))},
            )

            return {"ok": True, "contact_id": contact_id_value}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create contact: {e}")


@router.patch("/clients/{client_db_id}/contacts/{contact_id}")
def update_client_contact(
    request: Request,
    client_db_id: int,
    contact_id: int,
    body: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user),
):
    """Update a client contact."""
    try:
        assert_permission(_user, "clients.contacts.manage")
        assert_client_access(_user, int(client_db_id))
        org_id = require_org(_user)
        with get_conn() as con:
            _ensure_client_org_columns(con)
            before = _client_contact_audit_snapshot(con, int(client_db_id), int(contact_id), org_id)
            exists = con.execute(
                "SELECT 1 FROM client_contacts WHERE contact_id = ? AND client_db_id = ? AND org_id = ?",
                [int(contact_id), int(client_db_id), org_id],
            ).fetchone()

            if not exists:
                raise HTTPException(status_code=404, detail="Contact not found")

            if body.get("is_primary", False):
                con.execute(
                    "UPDATE client_contacts SET is_primary = FALSE WHERE client_db_id = ? AND contact_id != ? AND org_id = ?",
                    [int(client_db_id), int(contact_id), org_id],
                )

            updates = []
            params = []

            field_mapping = {
                "full_name": "full_name",
                "job_title": "job_title",
                "email": "email",
                "phone": "phone",
                "is_primary": "is_primary",
            }

            for field_name, col_name in field_mapping.items():
                if field_name in body:
                    updates.append(f"{col_name} = ?")
                    params.append(body[field_name])

            if updates:
                params.extend([int(contact_id), int(client_db_id), org_id])
                query = f"UPDATE client_contacts SET {', '.join(updates)} WHERE contact_id = ? AND client_db_id = ? AND org_id = ?"
                con.execute(query, params)

            after = _client_contact_audit_snapshot(con, int(client_db_id), int(contact_id))
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="update",
                entity_type="client_contact",
                entity_id=int(contact_id),
                client_id=int(client_db_id),
                before=before,
                after=after,
                metadata={"updated_fields": list(body.keys())},
            )

            return {"ok": True, "message": "Contact updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update contact: {e}")


@router.delete("/clients/{client_db_id}/contacts/{contact_id}")
def delete_client_contact(
    request: Request,
    client_db_id: int,
    contact_id: int,
    _user: dict[str, str] = Depends(_current_user),
):
    """Delete a client contact."""
    try:
        assert_permission(_user, "clients.contacts.manage")
        assert_client_access(_user, int(client_db_id))
        org_id = require_org(_user)
        with get_conn() as con:
            _ensure_client_org_columns(con)
            before = _client_contact_audit_snapshot(con, int(client_db_id), int(contact_id), org_id)
            result = con.execute(
                "DELETE FROM client_contacts WHERE contact_id = ? AND client_db_id = ? AND org_id = ?",
                [int(contact_id), int(client_db_id), org_id],
            )

            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="delete",
                entity_type="client_contact",
                entity_id=int(contact_id),
                client_id=int(client_db_id),
                before=before,
                metadata={"deleted": bool(result is not None)},
            )

            return {"ok": True, "message": "Contact deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete contact: {e}")
