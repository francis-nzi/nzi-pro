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
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException

from api.employee_commuting_routes import (
    COMMUTE_MODE_OPTIONS,
    SERVICE_TYPE_OPTIONS,
    UNIT_OPTIONS,
    _ensure_emission_register_schema,
    _insert_manual_commuting_rows,
    _resolve_manual_commuting_rows,
)
from api.portal_auth_routes import portal_user_dep
from core.database import get_conn
from services.portal import PORTAL_ROLE_CAN_MANAGE_ACTIONS
from services.portal_data_entry import resolve_current_job_for_client

logger = logging.getLogger(__name__)
router = APIRouter(tags=["portal-commuting"])


def _assert_can_manage(current_user: dict) -> None:
    if current_user.get("role", "ClientAdmin") not in PORTAL_ROLE_CAN_MANAGE_ACTIONS:
        raise HTTPException(status_code=403, detail="Your portal role doesn't allow this action")


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
        return {"job_id": job_id, "rows": []}
    df = df.where(df.notna(), None)
    rows = []
    for _, r in df.iterrows():
        row = {k: r.get(k) for k in r.index}
        if row.get("created_at") is not None:
            row["created_at"] = str(row["created_at"])
        rows.append(row)
    return {"job_id": job_id, "rows": rows}


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
    if not str(payload.get("employee_name") or "").strip():
        raise HTTPException(status_code=400, detail="employee_name is required")

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
