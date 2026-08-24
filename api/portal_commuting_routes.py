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
    _months_sum,
    _parse_months,
    _resolve_manual_commuting_rows,
)
from api.portal_auth_routes import portal_user_dep
from core.database import get_conn
from services.employee_commuting_consolidation import sync_commuting_scope_rows
from services.portal import PORTAL_ROLE_CAN_MANAGE_ACTIONS
from services.portal_data_entry import (
    PORTAL_DATA_ENTRY_EXPIRED_MESSAGE,
    get_job_summary,
    get_portal_data_entry_status,
    load_client_category_history,
    resolve_current_job_for_client,
)
from services.vehicle_categorization import categorize_vehicle
from services.vehicle_lookup import lookup_vehicle_by_registration, normalize_registration

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


def _default_client_site_id(con, client_db_id: int) -> int | None:
    """Registered office if one is flagged, else the client's first
    non-archived site, else None -- same ordering PortalCommutingTab.tsx's
    renderSiteSelect() already uses to *display* a default, which is what
    made this look chosen even when nothing was actually being saved (see
    portal_commuting_create_row / _create_row_by_vehicle below)."""
    row = con.execute(
        """
        SELECT site_id FROM client_sites
        WHERE client_db_id = %s AND COALESCE(archived, FALSE) = FALSE
        ORDER BY COALESCE(is_registered_office, FALSE) DESC, site_id ASC
        LIMIT 1
        """,
        [int(client_db_id)],
    ).fetchone()
    return int(row[0]) if row else None


def _assert_data_entry_open(con, job_id: int) -> None:
    if get_portal_data_entry_status(con, job_id)["portal_data_entry_expired"]:
        raise HTTPException(status_code=403, detail=PORTAL_DATA_ENTRY_EXPIRED_MESSAGE)


@router.get("/portal/commuting/options")
def portal_commuting_options(current_user: dict = Depends(portal_user_dep)):
    return {
        "mode_options": COMMUTE_MODE_OPTIONS,
        "service_options": SERVICE_TYPE_OPTIONS,
        "unit_options": UNIT_OPTIONS,
    }


@router.get("/portal/commuting/history")
def portal_commuting_history(current_user: dict = Depends(portal_user_dep)):
    """This client's own prior-year Employee Commuting totals across every
    historical job -- see services/portal_data_entry.py
    load_client_category_history."""
    client_db_id = int(current_user["client_db_id"])
    with get_conn() as con:
        items = load_client_category_history(con, client_db_id, lambda cat: cat == "Employee Commuting")
    return {"items": items}


@router.get("/portal/commuting/rows")
def portal_commuting_list_rows(current_user: dict = Depends(portal_user_dep)):
    client_db_id = int(current_user["client_db_id"])
    with get_conn() as con:
        _ensure_emission_register_schema(con)
        job_id = _resolve_job_or_404(con, client_db_id)
        job_summary = get_job_summary(con, job_id)
        # enabled=FALSE covers both a brand new pending submission (by design,
        # see services/portal_data_entry.py) and a row the CRM has since
        # deleted (soft-deleted via enabled=FALSE without touching
        # review_status) -- only the former should still show here.
        df = con.execute(
            """
            SELECT s.source_id, s.employee_name, s.source_subtype, s.qty, s.uom, s.calc_tco2e,
                   s.review_status, s.review_note, s.notes, s.created_at,
                   s.month_1, s.month_2, s.month_3, s.month_4, s.month_5, s.month_6,
                   s.month_7, s.month_8, s.month_9, s.month_10, s.month_11, s.month_12,
                   s.site_id, cs.site_name, fl.report_label
            FROM job_emission_sources s
            LEFT JOIN client_sites cs ON cs.site_id = s.site_id
            LEFT JOIN v_factor_lookup fl ON fl.db_id = s.factor_db_id
            WHERE s.job_id = %s AND s.source_type = 'employee_commuting' AND s.submitted_by_portal = TRUE
              AND (s.enabled = TRUE OR s.review_status IN ('pending_review', 'rejected'))
            ORDER BY s.source_id DESC
            """,
            [int(job_id)],
        ).df()
    if df is None or df.empty:
        return {"job_id": job_id, "rows": [], **job_summary}
    # astype(object) first -- see api/portal_data_entry_routes.py for why the
    # plain df.where(df.notna(), None) is a no-op on float64 columns and
    # breaks JSON serialization for rows with a null qty/calc_tco2e.
    df = df.astype(object).where(df.notna(), None)
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
        _assert_data_entry_open(con, job_id)

        default_site_id = _default_client_site_id(con, client_db_id)
        preview = _resolve_manual_commuting_rows(con, job_id, default_site_id, [payload])
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
    registration is stored on asset_identifier (normalized, same convention
    as Asset Register) so the same vehicle/person can be matched year on
    year -- previously discarded after the lookup."""
    _assert_can_manage(current_user)
    client_db_id = int(current_user["client_db_id"])

    employee_name = str(payload.get("employee_name") or "").strip()
    registration = str(payload.get("registration_number") or "").strip()
    if not employee_name:
        raise HTTPException(status_code=400, detail="employee_name is required")
    _assert_not_a_full_name(employee_name)
    if not registration:
        raise HTTPException(status_code=400, detail="registration_number is required")

    months = _parse_months(payload)
    annual_quantity = _months_sum(months)
    if annual_quantity is None:
        try:
            annual_quantity = float(payload.get("annual_quantity"))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="months or annual_quantity is required")
    if annual_quantity <= 0:
        raise HTTPException(status_code=400, detail="Total annual distance must be greater than zero")

    vehicle_data, lookup_error = lookup_vehicle_by_registration(registration)
    if lookup_error:
        status = 503 if "not configured" in lookup_error else 404
        raise HTTPException(status_code=status, detail=lookup_error)

    with get_conn() as con:
        _ensure_emission_register_schema(con)
        job_id = _resolve_job_or_404(con, client_db_id)
        _assert_data_entry_open(con, job_id)

        factor, category_error = categorize_vehicle(con, job_id, vehicle_data)
        if category_error:
            raise HTTPException(status_code=422, detail=category_error)

        calc_tco2e = _calc_commuting_tco2e(annual_quantity, factor.get("factor"), 100, factor.get("ghg_unit"))
        normalized_registration = normalize_registration(registration)
        ready_row = {
            "scope": "Scope 3",
            "site_id": _default_client_site_id(con, client_db_id),
            "source_type": "employee_commuting",
            "source_subtype": "commuting",
            "source_name": f"{employee_name} - Employee Commuting - {factor.get('report_label')}".strip(" -"),
            "asset_identifier": normalized_registration,
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
            "notes": f"Employee/Team: {employee_name} — matched via registration lookup ({normalized_registration}) to {factor.get('report_label')}",
            "detail_json": {"entry_type": "commuting", "manual_entry": True, "via": "registration_lookup", "registration_number": normalized_registration},
        }
        if months:
            for i in range(12):
                ready_row[f"month_{i + 1}"] = months[i]

        _inserted, inserted_ids = _insert_manual_commuting_rows(con, job_id, [ready_row], submitted_by_portal=True)

    return {
        "ok": True,
        "job_id": job_id,
        "source_id": inserted_ids[0] if inserted_ids else None,
        "matched_category": factor.get("report_label"),
        "review_status": "pending_review",
    }


@router.patch("/portal/commuting/rows/{source_id}")
def portal_commuting_update_row(
    source_id: int,
    payload: dict = Body(...),
    current_user: dict = Depends(portal_user_dep),
):
    _assert_can_manage(current_user)
    client_db_id = int(current_user["client_db_id"])

    employee_name = payload.get("employee_name")
    if employee_name is not None:
        employee_name = str(employee_name).strip()
        if not employee_name:
            raise HTTPException(status_code=400, detail="employee_name is required")
        _assert_not_a_full_name(employee_name)

    site_id = payload.get("site_id") if "site_id" in payload else None
    if site_id is not None:
        try:
            site_id = int(site_id)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="site_id must be a number")

    with get_conn() as con:
        _ensure_emission_register_schema(con)
        existing = con.execute(
            """
            SELECT s.source_id, s.review_status, s.factor, s.ghg_unit, s.apply_pct, s.job_id
            FROM job_emission_sources s JOIN jobs j ON j.job_id = s.job_id
            WHERE s.source_id = %s AND j.client_db_id = %s
              AND s.source_type = 'employee_commuting' AND s.submitted_by_portal = TRUE
            """,
            [int(source_id), client_db_id],
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Row not found")
        # Approved rows are still editable -- a client entering commuting data
        # monthly (see the 12-month grid) needs to keep adding to an already-
        # approved row as the year goes on, not lose access to it the moment
        # the CRM reviews the months entered so far. The edit below already
        # resets review_status to pending_review so the CRM sees it needs
        # another look; enabled is left as-is so the row doesn't vanish from
        # reports mid-year just because a new month was added.
        _assert_data_entry_open(con, int(existing[5]))

        if site_id is not None:
            site_row = con.execute(
                "SELECT 1 FROM client_sites WHERE site_id = %s AND client_db_id = %s AND COALESCE(archived, FALSE) = FALSE",
                [site_id, client_db_id],
            ).fetchone()
            if not site_row:
                raise HTTPException(status_code=400, detail="Selected site was not found")

        set_clauses: list[str] = []
        params: list = []
        if employee_name is not None:
            set_clauses.append("employee_name = %s")
            params.append(employee_name)
        if site_id is not None:
            set_clauses.append("site_id = %s")
            params.append(site_id)
        if "notes" in payload:
            set_clauses.append("notes = %s")
            params.append(str(payload.get("notes") or "").strip() or None)

        new_qty = None
        if "months" in payload:
            months_in = payload.get("months")
            if not isinstance(months_in, list):
                raise HTTPException(status_code=400, detail="months must be a list of 12 numbers")
            parsed_months: list[float | None] = [None] * 12
            for i in range(min(12, len(months_in))):
                value = months_in[i]
                if value is None:
                    continue
                try:
                    parsed_months[i] = float(value)
                except (TypeError, ValueError):
                    raise HTTPException(status_code=400, detail=f"months[{i}] must be a number or null")
            total = sum(v for v in parsed_months if v is not None)
            if total <= 0:
                raise HTTPException(status_code=400, detail="Total distance must be greater than zero")
            for i in range(12):
                set_clauses.append(f"month_{i + 1} = %s")
                params.append(parsed_months[i])
            new_qty = total
            set_clauses.append("qty = %s")
            params.append(new_qty)
        elif "qty" in payload:
            try:
                new_qty = float(payload.get("qty"))
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="qty must be a number")
            set_clauses.append("qty = %s")
            params.append(new_qty)

        if not set_clauses:
            return {"ok": True, "source_id": source_id, "review_status": existing[1]}

        if new_qty is not None:
            calc_tco2e = _calc_commuting_tco2e(new_qty, existing[2], existing[4] or 100, existing[3])
            set_clauses.append("calc_tco2e = %s")
            params.append(calc_tco2e)

        set_clauses.append("review_status = 'pending_review'")
        set_clauses.append("review_note = NULL")
        set_clauses.append("updated_at = NOW()")
        params.append(int(source_id))

        con.execute(f"UPDATE job_emission_sources SET {', '.join(set_clauses)} WHERE source_id = %s", params)
        sync_commuting_scope_rows(con, int(existing[5]))

    return {"ok": True, "source_id": source_id, "review_status": "pending_review"}


@router.delete("/portal/commuting/rows/{source_id}")
def portal_commuting_delete_row(source_id: int, current_user: dict = Depends(portal_user_dep)):
    _assert_can_manage(current_user)
    client_db_id = int(current_user["client_db_id"])

    with get_conn() as con:
        _ensure_emission_register_schema(con)
        existing = con.execute(
            """
            SELECT s.source_id, s.review_status, s.job_id
            FROM job_emission_sources s JOIN jobs j ON j.job_id = s.job_id
            WHERE s.source_id = %s AND j.client_db_id = %s
              AND s.source_type = 'employee_commuting' AND s.submitted_by_portal = TRUE
            """,
            [int(source_id), client_db_id],
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Row not found")
        if existing[1] == "approved":
            raise HTTPException(status_code=409, detail="This row has already been approved and can no longer be deleted here")
        _assert_data_entry_open(con, int(existing[2]))

        con.execute("DELETE FROM job_emission_sources WHERE source_id = %s", [int(source_id)])

    return {"ok": True, "source_id": source_id}
