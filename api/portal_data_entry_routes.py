"""Client Portal Data Entry (Phase 1) — generic tabbed scope-data submission.

See services/portal_data_entry.py for the schema/bucket/job-resolution
helpers this file wraps as portal-authenticated HTTP endpoints, and
CLIENT_PORTAL_DATA_ENTRY_SCOPE.md for the overall plan. Employee Commuting
and Purchased Goods & Services are NOT covered here (see that doc for why).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request

from api.job_scope_data_routes import (
    _ensure_job_scope_rows_schema,
    _resolve_scope_row_factor_for_creation,
    get_template_factors,
)
from api.portal_auth_routes import portal_user_dep
from core.database import get_conn
from services.audit_log import record_audit_event
from services.portal import PORTAL_ROLE_CAN_MANAGE_ACTIONS
from services.portal_data_entry import (
    BUCKET_KEYS,
    BUCKET_LABELS,
    bucket_for_category,
    ensure_portal_data_entry_schema,
    get_job_summary,
    job_scope_row_to_dict,
    load_bucket_category_map,
    resolve_current_job_for_client,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["portal-data-entry"])


def _assert_valid_bucket(bucket_key: str) -> None:
    if bucket_key not in BUCKET_KEYS:
        raise HTTPException(status_code=404, detail="Unknown data-entry category")


def _resolve_job_or_404(con, client_db_id: int) -> int:
    job_id = resolve_current_job_for_client(con, client_db_id)
    if job_id is None:
        raise HTTPException(status_code=404, detail="No open job found for this account yet — contact your NZI consultant")
    return job_id


@router.get("/portal/data-entry/buckets")
def portal_data_entry_buckets(current_user: dict = Depends(portal_user_dep)):
    return {"buckets": [{"bucket_key": key, "label": BUCKET_LABELS[key]} for key in BUCKET_KEYS]}


@router.get("/portal/data-entry/{bucket_key}/factors")
def portal_data_entry_factors(
    bucket_key: str,
    search: str = Query(""),
    scope: str = Query(""),
    current_user: dict = Depends(portal_user_dep),
):
    """Category-filtered wrapper around the CRM's template-factors search
    (FactorBrowserCard's backend) -- reuses that function directly rather
    than re-implementing dataset resolution, then filters to this bucket's
    matched categories in Python. Known Phase-1 simplification: pagination
    is computed post-filter, so a single large page is fetched rather than
    paginating server-side per bucket -- acceptable at today's ~30-40
    category scale (see CLIENT_PORTAL_DATA_ENTRY_SCOPE.md)."""
    _assert_valid_bucket(bucket_key)
    client_db_id = int(current_user["client_db_id"])

    with get_conn() as con:
        ensure_portal_data_entry_schema(con)
        job_id = _resolve_job_or_404(con, client_db_id)
        category_map = load_bucket_category_map(con)

    result = get_template_factors(
        job_id=job_id, limit=1000, offset=0, search=search, scope=scope, category="", _user={}
    )
    matched = [
        f for f in (result.get("factors") or [])
        if bucket_for_category(category_map, f.get("category")) == bucket_key
    ]
    return {
        "job_id": job_id,
        "bucket_key": bucket_key,
        "factors": matched,
        "total": len(matched),
    }


@router.get("/portal/data-entry/{bucket_key}/rows")
def portal_data_entry_list_rows(
    bucket_key: str,
    current_user: dict = Depends(portal_user_dep),
):
    _assert_valid_bucket(bucket_key)
    client_db_id = int(current_user["client_db_id"])
    site_ids = current_user.get("site_ids")

    with get_conn() as con:
        ensure_portal_data_entry_schema(con)
        job_id = _resolve_job_or_404(con, client_db_id)
        job_summary = get_job_summary(con, job_id)
        category_map = load_bucket_category_map(con)

        df = con.execute(
            """
            SELECT row_id, site_id, scope, category, report_label, original_id, uom, qty, factor,
                   calc_tco2e, month_1, month_2, month_3, month_4, month_5, month_6,
                   month_7, month_8, month_9, month_10, month_11, month_12,
                   review_status, review_note, reviewed_by, reviewed_at, submitted_by_portal, enabled
            FROM job_scope_rows
            WHERE job_id = %s
            ORDER BY row_id DESC
            """,
            [int(job_id)],
        ).df()

    if df is None or df.empty:
        return {"job_id": job_id, "bucket_key": bucket_key, "rows": [], **job_summary}

    df = df.where(df.notna(), None)
    rows = []
    for _, row in df.iterrows():
        row_dict = {k: row.get(k) for k in row.index}
        if bucket_for_category(category_map, row_dict.get("category")) != bucket_key:
            continue
        if site_ids is not None and row_dict.get("site_id") not in site_ids:
            continue
        rows.append(job_scope_row_to_dict(row_dict))

    return {"job_id": job_id, "bucket_key": bucket_key, "rows": rows, **job_summary}


@router.post("/portal/data-entry/{bucket_key}/rows")
def portal_data_entry_create_row(
    request: Request,
    bucket_key: str,
    payload: dict = Body(...),
    current_user: dict = Depends(portal_user_dep),
):
    _assert_valid_bucket(bucket_key)
    client_db_id = int(current_user["client_db_id"])
    if current_user.get("role", "ClientAdmin") not in PORTAL_ROLE_CAN_MANAGE_ACTIONS:
        raise HTTPException(status_code=403, detail="Your portal role doesn't allow this action")

    scope = payload.get("scope")
    original_id = payload.get("original_id")
    if not scope or not original_id:
        raise HTTPException(status_code=400, detail="scope and original_id are required")

    site_id = payload.get("site_id")
    if site_id is not None:
        try:
            site_id = int(site_id)
        except (ValueError, TypeError):
            site_id = None
    site_ids = current_user.get("site_ids")
    if site_ids is not None and site_id not in site_ids:
        raise HTTPException(status_code=403, detail="Not one of your assigned sites")

    with get_conn() as con:
        _ensure_job_scope_rows_schema(con)
        ensure_portal_data_entry_schema(con)
        job_id = _resolve_job_or_404(con, client_db_id)

        category_map = load_bucket_category_map(con)
        submitted_category = (
            payload.get("category") or payload.get("level_1") or payload.get("level_2")
        )
        if bucket_for_category(category_map, submitted_category) != bucket_key:
            raise HTTPException(
                status_code=400,
                detail=f"That category doesn't belong under {BUCKET_LABELS[bucket_key]}",
            )

        # Verify the site (if any) really belongs to this client before attaching a row to it.
        if site_id is not None:
            site_row = con.execute(
                "SELECT 1 FROM client_sites WHERE site_id = %s AND client_db_id = %s",
                [int(site_id), client_db_id],
            ).fetchone()
            if not site_row:
                raise HTTPException(status_code=400, detail="Site not found for this account")

        final_dataset_id, final_factor_db_id, final_factor, final_ghg_unit = (
            _resolve_scope_row_factor_for_creation(con, job_id, scope, original_id, payload)
        )

        result = con.execute(
            """
            INSERT INTO job_scope_rows (
                job_id, scope, site_id, dataset_id, factor_db_id, original_id,
                category, level_1, level_2, level_3, level_4, column_text, report_label,
                qty, uom, factor, ghg_unit, apply_pct, data_source, data_confidence, notes,
                is_custom_entry, enabled, review_status, submitted_by_portal,
                month_1, month_2, month_3, month_4, month_5, month_6,
                month_7, month_8, month_9, month_10, month_11, month_12
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, FALSE, 'pending_review', TRUE,
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING row_id
            """,
            [
                int(job_id), scope, site_id, final_dataset_id, final_factor_db_id, original_id,
                submitted_category, payload.get("level_1"), payload.get("level_2"),
                payload.get("level_3"), payload.get("level_4"), payload.get("column_text"),
                payload.get("report_label"),
                payload.get("qty"), payload.get("uom"), final_factor, final_ghg_unit,
                payload.get("apply_pct", 100), "Client Portal", payload.get("data_confidence", "M"),
                payload.get("notes"), False,
                payload.get("month_1"), payload.get("month_2"), payload.get("month_3"),
                payload.get("month_4"), payload.get("month_5"), payload.get("month_6"),
                payload.get("month_7"), payload.get("month_8"), payload.get("month_9"),
                payload.get("month_10"), payload.get("month_11"), payload.get("month_12"),
            ],
        ).fetchone()
        row_id = int(result[0])

        record_audit_event(
            con,
            request=request,
            actor={"email": current_user.get("email"), "full_name": current_user.get("full_name"), "user_id": "portal"},
            action="portal_submit",
            entity_type="job_scope_row",
            entity_id=row_id,
            client_id=client_db_id,
            job_id=job_id,
            metadata={"bucket_key": bucket_key, "scope": scope, "original_id": original_id},
        )

    return {"ok": True, "row_id": row_id, "job_id": job_id, "review_status": "pending_review"}


@router.patch("/portal/data-entry/{bucket_key}/rows/{row_id}")
def portal_data_entry_update_row(
    request: Request,
    bucket_key: str,
    row_id: int,
    payload: dict = Body(...),
    current_user: dict = Depends(portal_user_dep),
):
    _assert_valid_bucket(bucket_key)
    client_db_id = int(current_user["client_db_id"])
    if current_user.get("role", "ClientAdmin") not in PORTAL_ROLE_CAN_MANAGE_ACTIONS:
        raise HTTPException(status_code=403, detail="Your portal role doesn't allow this action")

    with get_conn() as con:
        _ensure_job_scope_rows_schema(con)
        existing = con.execute(
            """
            SELECT r.row_id, r.job_id, r.site_id, r.review_status
            FROM job_scope_rows r JOIN jobs j ON j.job_id = r.job_id
            WHERE r.row_id = %s AND j.client_db_id = %s
            """,
            [int(row_id), client_db_id],
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Row not found")
        if existing[3] == "approved":
            raise HTTPException(status_code=409, detail="This row has already been approved and can no longer be edited here")

        site_ids = current_user.get("site_ids")
        if site_ids is not None and existing[2] not in site_ids:
            raise HTTPException(status_code=403, detail="Not one of your assigned sites")

        editable_fields = [
            "qty", "uom", "notes",
            "month_1", "month_2", "month_3", "month_4", "month_5", "month_6",
            "month_7", "month_8", "month_9", "month_10", "month_11", "month_12",
        ]
        set_clauses = []
        params: list = []
        for field in editable_fields:
            if field in payload:
                set_clauses.append(f"{field} = %s")
                params.append(payload.get(field))
        if not set_clauses:
            return {"ok": True, "row_id": row_id, "review_status": existing[3]}

        set_clauses.append("review_status = 'pending_review'")
        set_clauses.append("review_note = NULL")
        set_clauses.append("updated_at = NOW()")
        params.append(int(row_id))

        con.execute(
            f"UPDATE job_scope_rows SET {', '.join(set_clauses)} WHERE row_id = %s",
            params,
        )
        record_audit_event(
            con,
            request=request,
            actor={"email": current_user.get("email"), "full_name": current_user.get("full_name"), "user_id": "portal"},
            action="portal_update",
            entity_type="job_scope_row",
            entity_id=int(row_id),
            client_id=client_db_id,
            job_id=int(existing[1]),
            metadata={"bucket_key": bucket_key, "fields": list(payload.keys())},
        )

    return {"ok": True, "row_id": row_id, "review_status": "pending_review"}
