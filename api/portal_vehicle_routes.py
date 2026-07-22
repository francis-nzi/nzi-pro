"""Client Portal Data Entry Phase 3 — vehicle registration lookup.

Looks up a UK registration via DVLA VES and resolves it to a real Company
Vehicles factor category. The registration number itself is never
persisted -- only the derived category/factor is returned to the caller,
which feeds straight into the existing row-creation endpoints (Phase 1's
generic bucket rows, or Phase-3's commuting-by-vehicle path) unchanged.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Body, Depends, HTTPException

from api.portal_auth_routes import portal_user_dep
from core.database import get_conn
from services.portal import PORTAL_ROLE_CAN_MANAGE_ACTIONS
from services.portal_data_entry import resolve_current_job_for_client
from services.vehicle_categorization import categorize_vehicle
from services.vehicle_lookup import lookup_vehicle_by_registration

logger = logging.getLogger(__name__)
router = APIRouter(tags=["portal-vehicle"])


@router.post("/portal/vehicle-lookup")
def portal_vehicle_lookup(
    payload: dict = Body(...),
    current_user: dict = Depends(portal_user_dep),
):
    if current_user.get("role", "ClientAdmin") not in PORTAL_ROLE_CAN_MANAGE_ACTIONS:
        raise HTTPException(status_code=403, detail="Your portal role doesn't allow this action")

    registration = str(payload.get("registration_number") or "").strip()
    if not registration:
        raise HTTPException(status_code=400, detail="registration_number is required")

    client_db_id = int(current_user["client_db_id"])
    vehicle_data, lookup_error = lookup_vehicle_by_registration(registration)
    if lookup_error:
        status = 503 if "not configured" in lookup_error else 404
        raise HTTPException(status_code=status, detail=lookup_error)

    with get_conn() as con:
        job_id = resolve_current_job_for_client(con, client_db_id)
        if job_id is None:
            raise HTTPException(status_code=404, detail="No open job found for this account yet — contact your NZI consultant")
        factor, category_error = categorize_vehicle(con, job_id, vehicle_data)

    if category_error:
        raise HTTPException(status_code=422, detail=category_error)

    return {
        "job_id": job_id,
        "make": vehicle_data.get("make"),
        "fuel_type": vehicle_data.get("fuel_type"),
        "factor": factor,
    }
