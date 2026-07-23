"""Client Portal Data Entry — Employee Commuting.

Clients submit direct-entry commuting/WFH rows using the same fixed
mode/service vocabulary as the CRM form (no free-text factor search --
picking a category is deterministic, see _resolve_commuting_original_id in
api/employee_commuting_routes.py). Rows land in job_emission_sources with
enabled=FALSE, review_status='pending_review' until a CRM approves them --
see CLIENT_PORTAL_DATA_ENTRY_SCOPE.md.
"""
from __future__ import annotations

import logging
import re
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException

from api.employee_commuting_routes import (
    COMMUTE_MODE_OPTIONS,
    DIRECT_COMMUTING_DATA_SOURCE,
    SERVICE_TYPE_OPTIONS,
    UNIT_OPTIONS,
    _calc_commuting_tco2e,
    _ensure_emission_register_schema,
    _insert_manual_commuting_rows,
    _resolve_manual_commuting_rows,
)
from api.portal_auth_routes import portal_user_dep
from core.database import get_conn
from services.portal import PORTAL_ROLE_CAN_MANAGE_ACTIONS
from services.portal_data_entry import get_job_summary, resolve_current_job_for_client
from services.vehicle_categorization import categorize_vehicle
from services.vehicle_lookup import lookup_vehicle_by_registration

logger = logging.getLogger(__name__)
router = APIRouter(tags=["portal-commuting"])


def _assert_can_manage(current_user: dict) -> None:
    if current_user.get("role", "ClientAdmin") not in PORTAL_ROLE_CAN_MANAGE_ACTIONS:
        raise HTTPException(status_code=403, detail="Your portal role doesn't allow this action")


# Soft heuristic only -- catches the obvious "Firstname Lastname" case so
# clients don't accidentally enter real names, not a guarantee. Deliberately
# permissive: initials ("JD"), staff numbers ("EMP-4471"), and single words
# all pass, since staff-number formats vary and over-blocking is worse than
# under-blocking here.
_LOOKS_LIKE_FULL_NAME = re.compile(r"^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+$")


def _assert_not_a_full_name(employee_name: str) -> None:
    if _LOOKS_LIKE_FULL_NAME.match(employee_name.strip()):
        raise HTTPException(
            status_code=400,
            detail="Please use initials or a staff number instead of a full name (e.g. \"JD\" or \"EMP-4471\").",
        )


def _resolve_job_or_404(con, client_db_id: int) -> int:
    job_id = resolve_current_job_for_client(con, client_db_id)
    if job_id is None:
        raise HTTPException(status_code=404, detail="No open job found for this account yet — contact your NZI consultant")
    return job_id


@router.get("/portal/commuting/options")
def portal_commuting_options(current_user: dict = Depends(portal_user_dep)):
    return {
        "mode_options": COMMUTE_MODE_OPTIONS,
        "service_options": SERVICE_TYPE_OPTIONS,
        "unit_options": UNIT_OPTIONS,
    }


@router.get("/portal/commuting/rows")
def portal_commuting_list_rows(current_user: dict = Depends(portal_user_dep)):
    client_db_id = int(current_user["client_db_id"])
    with get_conn() as con:
        _ensure_emission_register_schema(con)
        job_id = _resolve_job_or_404(con, client_db_id)
        job_summary = get_job_summary(con, job_id)
        df = con.execute(
            """
            SELECT source_id, employee_name, source_subtype, qty, uom, calc_tco2e,
                   review_status, review_note, notes, created_at
            FROM job_emission_sources
            WHERE job_id = %s AND source_type = 'employee_commuting' AND submitted_by_portal = TRUE
            ORDER BY source_id DESC
            """,
            [int(job_id)],
        ).df()
    if df is None or df.empty:
        return {"job_id": job_id, "rows": [], **job_summary}
    df = df.where(df.notna(), None)
    rows = []
    for _, r in df.iterrows():
        row = {k: r.get(k) for k in r.index}
        if row.get("created_at") is not None:
            row["created_at"] = str(row["created_at"])
        rows.append(row)
    return {"job_id": job_id, "rows": rows, **job_summary}


@router.post("/portal/commuting/rows")
def portal_commuting_create_row(
    payload: dict = Body(...),
    current_user: dict = Depends(portal_user_dep),
):
    _assert_can_manage(current_user)
    client_db_id = int(current_user["client_db_id"])

    row_type = str(payload.get("row_type") or "").strip().lower()
    if row_type not in ("commuting", "wfh"):
        raise HTTPException(status_code=400, detail="row_type must be 'commuting' or 'wfh'")
    employee_name = str(payload.get("employee_name") or "").strip()
    if not employee_name:
        raise HTTPException(status_code=400, detail="employee_name is required")
    _assert_not_a_full_name(employee_name)

    with get_conn() as con:
        _ensure_emission_register_schema(con)
        job_id = _resolve_job_or_404(con, client_db_id)

        preview = _resolve_manual_commuting_rows(con, job_id, None, [payload])
        if preview["unresolved_count"] > 0:
            raise HTTPException(
                status_code=400,
                detail={
                    "message": "This entry couldn't be resolved — check the mode/service and quantity fields.",
                    "unresolved_rows": preview["unresolved_rows"],
                },
            )
        if preview["ready_count"] <= 0:
            raise HTTPException(status_code=400, detail="Nothing to submit")

        _inserted, inserted_ids = _insert_manual_commuting_rows(
            con, job_id, preview["ready_rows"], submitted_by_portal=True
        )

    return {
        "ok": True,
        "job_id": job_id,
        "source_id": inserted_ids[0] if inserted_ids else None,
        "review_status": "pending_review",
    }


@router.post("/portal/commuting/rows-by-vehicle")
def portal_commuting_create_row_by_vehicle(
    payload: dict = Body(...),
    current_user: dict = Depends(portal_user_dep),
):
    """'I drive my own car' path -- resolves a factor directly from a
    registration lookup instead of the mode/service dropdowns, bypassing
    _resolve_manual_commuting_rows entirely for this branch (an additive
    path, not a change to the existing, already-tested dropdown flow). The
    registration number is used transiently here and never persisted."""
    _assert_can_manage(current_user)
    client_db_id = int(current_user["client_db_id"])

    employee_name = str(payload.get("employee_name") or "").strip()
    registration = str(payload.get("registration_number") or "").strip()
    if not employee_name:
        raise HTTPException(status_code=400, detail="employee_name is required")
    _assert_not_a_full_name(employee_name)
    if not registration:
        raise HTTPException(status_code=400, detail="registration_number is required")
    try:
        annual_quantity = float(payload.get("annual_quantity"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="annual_quantity is required and must be a number")
    if annual_quantity <= 0:
        raise HTTPException(status_code=400, detail="annual_quantity must be greater than zero")

    vehicle_data, lookup_error = lookup_vehicle_by_registration(registration)
    if lookup_error:
        status = 503 if "not configured" in lookup_error else 404
        raise HTTPException(status_code=status, detail=lookup_error)

    with get_conn() as con:
        _ensure_emission_register_schema(con)
        job_id = _resolve_job_or_404(con, client_db_id)

        factor, category_error = categorize_vehicle(con, job_id, vehicle_data)
        if category_error:
            raise HTTPException(status_code=422, detail=category_error)

        calc_tco2e = _calc_commuting_tco2e(annual_quantity, factor.get("factor"), 100, factor.get("ghg_unit"))
        ready_row = {
            "scope": "Scope 3",
            "site_id": None,
            "source_type": "employee_commuting",
            "source_subtype": "commuting",
            "source_name": f"{employee_name} - Employee Commuting - {factor.get('report_label')}".strip(" -"),
            "asset_identifier": None,
            "employee_name": employee_name,
            "dataset_id": factor.get("dataset_id"),
            "factor_db_id": factor.get("factor_db_id"),
            "original_id": factor.get("original_id"),
            "category": "Employee Commuting",
            "qty": float(annual_quantity),
            "uom": factor.get("uom"),
            "factor": factor.get("factor"),
            "ghg_unit": factor.get("ghg_unit"),
            "calc_tco2e": calc_tco2e,
            "apply_pct": 100,
            "data_source": DIRECT_COMMUTING_DATA_SOURCE,
            "data_confidence": "M",
            "notes": f"Employee/Team: {employee_name} — matched via registration lookup to {factor.get('report_label')}",
            "detail_json": {"entry_type": "commuting", "manual_entry": True, "via": "registration_lookup"},
        }

        _inserted, inserted_ids = _insert_manual_commuting_rows(con, job_id, [ready_row], submitted_by_portal=True)

    return {
        "ok": True,
        "job_id": job_id,
        "source_id": inserted_ids[0] if inserted_ids else None,
        "matched_category": factor.get("report_label"),
        "review_status": "pending_review",
    }
