"""CRM vehicle registration lookup -- staff-facing equivalent of
api/portal_vehicle_routes.py.

Looks up a UK registration via DVLA VES and resolves it to a real Company
Vehicles factor category, for the CRM's Job -> Data Entry "Browse & Add
Factors" flow (Company Vehicles / Business Travel). The registration number
itself is never persisted -- only the derived factor is returned, which
feeds directly into the existing POST /jobs/{job_id}/scope-data row-creation
endpoint unchanged (same factor shape as a template-factors search result).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Body, Depends, HTTPException

from api.auth import _current_user
from core.database import get_conn
from services.vehicle_categorization import categorize_vehicle
from services.vehicle_lookup import lookup_vehicle_by_registration

logger = logging.getLogger(__name__)
router = APIRouter(tags=["vehicle-lookup"])


@router.post("/jobs/{job_id}/vehicle-lookup")
def job_vehicle_lookup(
    job_id: int,
    payload: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user),
):
    registration = str(payload.get("registration_number") or "").strip()
    if not registration:
        raise HTTPException(status_code=400, detail="registration_number is required")

    vehicle_data, lookup_error = lookup_vehicle_by_registration(registration)
    if lookup_error:
        status = 503 if "not configured" in lookup_error else 404
        raise HTTPException(status_code=status, detail=lookup_error)

    with get_conn() as con:
        factor, category_error = categorize_vehicle(con, int(job_id), vehicle_data)

    if category_error:
        raise HTTPException(status_code=422, detail=category_error)

    return {
        "job_id": int(job_id),
        "make": vehicle_data.get("make"),
        "fuel_type": vehicle_data.get("fuel_type"),
        "factor": factor,
    }
