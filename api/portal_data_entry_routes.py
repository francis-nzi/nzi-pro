"""Client Portal Data Entry (Phase 1) — generic tabbed scope-data submission.

See services/portal_data_entry.py for the schema/bucket/job-resolution
helpers this file wraps as portal-authenticated HTTP endpoints, and
CLIENT_PORTAL_DATA_ENTRY_SCOPE.md for the overall plan. Employee Commuting
and Purchased Goods & Services are NOT covered here (see that doc for why).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request

from api.job_emission_register_routes import _calc_tco2e as _register_calc_tco2e
from api.job_emission_register_routes import _ensure_schema as _ensure_emission_register_schema
from api.job_scope_data_routes import (
    _ensure_job_scope_rows_schema,
    _resolve_scope_row_factor_for_creation,
    get_template_factors,
)
from api.portal_auth_routes import portal_user_dep
from api.spend_data_routes import _ensure_spend_tables
from core.database import get_conn
from services.audit_log import record_audit_event
from services.portal import PORTAL_ROLE_CAN_MANAGE_ACTIONS
from services.portal_data_entry import (
    BUCKET_KEYS,
    BUCKET_LABELS,
    PORTAL_DATA_ENTRY_EXPIRED_MESSAGE,
    bucket_for_category,
    ensure_portal_data_entry_schema,
    get_job_summary,
    get_portal_data_entry_status,
    get_previous_bucket_rows,
    get_previous_register_bucket_rows,
    get_top_bucket_factors,
    get_top_register_bucket_factors,
    job_scope_row_to_dict,
    load_bucket_category_map,
    load_client_category_history,
    resolve_current_job_for_client,
)

# Company Vehicles and Business Travel submit into job_emission_sources --
# the same register table Asset Register / Business Travel Register are
# built on (api/job_emission_register_routes.py) -- rather than the generic
# job_scope_rows table every other bucket uses. This lets approved portal
# submissions show up directly on those CRM screens instead of the plain
# Data Entry pending list, and they already feed job totals once
# enabled=TRUE: every one of the 5 places totals get computed only excludes
# source_type='employee_commuting', so no extra consolidation step is
# needed the way Employee Commuting needed one.
_BUCKET_REGISTER_SOURCE_TYPE = {
    "company_vehicles": "asset",
    "business_travel": "business_travel",
}


def _register_source_type_for_bucket(bucket_key: str) -> str | None:
    return _BUCKET_REGISTER_SOURCE_TYPE.get(bucket_key)


def _register_source_to_portal_dict(row: dict) -> dict:
    """Shapes a job_emission_sources row the same way job_scope_row_to_dict
    shapes a job_scope_rows row, so the portal frontend's generic rows table
    doesn't need to know which table backed a given bucket."""
    return {
        "row_id": row.get("source_id"),
        "site_id": row.get("site_id"),
        "scope": row.get("scope"),
        "category": row.get("category"),
        "report_label": row.get("source_name"),
        "original_id": row.get("original_id"),
        "uom": row.get("uom"),
        "qty": row.get("qty"),
        "factor": row.get("factor"),
        "calc_tco2e": row.get("calc_tco2e"),
        "month_1": row.get("month_1"), "month_2": row.get("month_2"), "month_3": row.get("month_3"),
        "month_4": row.get("month_4"), "month_5": row.get("month_5"), "month_6": row.get("month_6"),
        "month_7": row.get("month_7"), "month_8": row.get("month_8"), "month_9": row.get("month_9"),
        "month_10": row.get("month_10"), "month_11": row.get("month_11"), "month_12": row.get("month_12"),
        "review_status": row.get("review_status"),
        "review_note": row.get("review_note"),
        "reviewed_by": row.get("reviewed_by"),
        "reviewed_at": str(row.get("reviewed_at")) if row.get("reviewed_at") else None,
        "submitted_by_portal": bool(row.get("submitted_by_portal")),
        "enabled": bool(row.get("enabled")),
    }


def _assert_data_entry_open(con, job_id: int) -> None:
    if get_portal_data_entry_status(con, job_id)["portal_data_entry_expired"]:
        raise HTTPException(status_code=403, detail=PORTAL_DATA_ENTRY_EXPIRED_MESSAGE)

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
    """Sub-tab list plus a has_data flag per tab, so the tab bar can show
    clients which categories they've already submitted something under. The
    two non-generic tabs (Employee Commuting, Purchased Goods & Services)
    aren't in BUCKET_KEYS -- see services/portal_data_entry.py -- so they're
    appended here with the same keys/labels PortalDataEntry.tsx hardcodes."""
    buckets = [{"bucket_key": key, "label": BUCKET_LABELS[key]} for key in BUCKET_KEYS]
    buckets.append({"bucket_key": "employee_commuting", "label": "Employee Commuting"})
    buckets.append({"bucket_key": "purchased_goods_and_services", "label": "Purchased Goods & Services"})
    has_data = {b["bucket_key"]: False for b in buckets}

    client_db_id = int(current_user["client_db_id"])
    with get_conn() as con:
        ensure_portal_data_entry_schema(con)
        job_id = resolve_current_job_for_client(con, client_db_id)
        if job_id is not None:
            category_map = load_bucket_category_map(con)
            # Same visibility rule as GET .../{bucket_key}/rows: a still-pending
            # or rejected portal submission counts as "there's something here",
            # a CRM soft-delete (enabled=FALSE, review_status untouched) doesn't.
            cat_df = con.execute(
                """
                SELECT DISTINCT category FROM job_scope_rows
                WHERE job_id = %s AND (enabled = TRUE OR review_status IN ('pending_review', 'rejected'))
                """,
                [int(job_id)],
            ).df()
            if cat_df is not None and not cat_df.empty:
                for category in cat_df["category"].tolist():
                    bucket_key = bucket_for_category(category_map, category)
                    if bucket_key in has_data:
                        has_data[bucket_key] = True

            _ensure_emission_register_schema(con)
            commuting_row = con.execute(
                """
                SELECT 1 FROM job_emission_sources
                WHERE job_id = %s AND source_type = 'employee_commuting' AND submitted_by_portal = TRUE
                  AND (enabled = TRUE OR review_status IN ('pending_review', 'rejected'))
                LIMIT 1
                """,
                [int(job_id)],
            ).fetchone()
            has_data["employee_commuting"] = bool(commuting_row)

            # Company Vehicles / Business Travel live in job_emission_sources,
            # not job_scope_rows -- see _BUCKET_REGISTER_SOURCE_TYPE above --
            # so the category scan above never sees them.
            for bucket_key, source_type in _BUCKET_REGISTER_SOURCE_TYPE.items():
                register_row = con.execute(
                    """
                    SELECT 1 FROM job_emission_sources
                    WHERE job_id = %s AND source_type = %s AND submitted_by_portal = TRUE
                      AND (enabled = TRUE OR review_status IN ('pending_review', 'rejected'))
                    LIMIT 1
                    """,
                    [int(job_id), source_type],
                ).fetchone()
                has_data[bucket_key] = bool(register_row)

            _ensure_spend_tables(con)
            spend_row = con.execute(
                """
                SELECT 1 FROM job_spend_entries
                WHERE job_id = %s AND COALESCE(is_deleted, FALSE) = FALSE AND submitted_by_portal = TRUE
                LIMIT 1
                """,
                [int(job_id)],
            ).fetchone()
            has_data["purchased_goods_and_services"] = bool(spend_row)

    for b in buckets:
        b["has_data"] = has_data[b["bucket_key"]]
    return {"buckets": buckets}


@router.get("/portal/data-entry/sites")
def portal_data_entry_sites(current_user: dict = Depends(portal_user_dep)):
    """Sites this portal user can attribute a Data Entry row to -- every
    row now requires a site (see job_scope_rows_job_site_scope_active_uidx:
    the CRM can only have one *approved* row per site+scope+factor, so
    consolidating duplicate submissions before approval depends on the
    client having actually picked a site up front)."""
    client_db_id = int(current_user["client_db_id"])
    site_ids = current_user.get("site_ids")
    with get_conn() as con:
        rows = con.execute(
            """
            SELECT site_id, site_name, COALESCE(is_registered_office, FALSE)
            FROM client_sites
            WHERE client_db_id = %s AND COALESCE(archived, FALSE) = FALSE
            ORDER BY site_name
            """,
            [client_db_id],
        ).fetchall()
    sites = [{"site_id": int(r[0]), "site_name": r[1], "is_registered_office": bool(r[2])} for r in rows]
    if site_ids is not None:
        sites = [s for s in sites if s["site_id"] in site_ids]
    return {"sites": sites}


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


@router.get("/portal/data-entry/{bucket_key}/previous-rows")
def portal_data_entry_previous_rows(
    bucket_key: str,
    current_user: dict = Depends(portal_user_dep),
):
    """Distinct factor rows this client used in prior jobs for this bucket --
    lets them re-add a recurring item without re-searching."""
    _assert_valid_bucket(bucket_key)
    client_db_id = int(current_user["client_db_id"])
    source_type = _register_source_type_for_bucket(bucket_key)

    with get_conn() as con:
        ensure_portal_data_entry_schema(con)
        job_id = _resolve_job_or_404(con, client_db_id)
        if source_type:
            _ensure_emission_register_schema(con)
            items = get_previous_register_bucket_rows(con, client_db_id, job_id, source_type)
        else:
            category_map = load_bucket_category_map(con)
            items = get_previous_bucket_rows(con, client_db_id, job_id, bucket_key, category_map)

    return {"job_id": job_id, "bucket_key": bucket_key, "items": items}


@router.get("/portal/data-entry/{bucket_key}/top-factors")
def portal_data_entry_top_factors(
    bucket_key: str,
    current_user: dict = Depends(portal_user_dep),
):
    """Most-used factors for this bucket -- this client's own usage first,
    falling back to the most-used factors across all clients so a brand-new
    client still gets a useful quick-pick."""
    _assert_valid_bucket(bucket_key)
    client_db_id = int(current_user["client_db_id"])
    source_type = _register_source_type_for_bucket(bucket_key)

    with get_conn() as con:
        ensure_portal_data_entry_schema(con)
        job_id = _resolve_job_or_404(con, client_db_id)
        if source_type:
            _ensure_emission_register_schema(con)
            items = get_top_register_bucket_factors(con, client_db_id, source_type)
        else:
            category_map = load_bucket_category_map(con)
            items = get_top_bucket_factors(con, client_db_id, bucket_key, category_map)

    return {"job_id": job_id, "bucket_key": bucket_key, "items": items}


@router.get("/portal/data-entry/{bucket_key}/history")
def portal_data_entry_history(
    bucket_key: str,
    current_user: dict = Depends(portal_user_dep),
):
    """This client's own prior-year totals for this bucket, across every
    historical job EXCEPT the currently-active one -- so clients can see
    what they reported last time while filling in this year's data. Same
    underlying calc as the CRM's own Year-over-Year breakdown, see
    services/portal_data_entry.py load_client_category_history."""
    _assert_valid_bucket(bucket_key)
    client_db_id = int(current_user["client_db_id"])

    with get_conn() as con:
        current_job_id = resolve_current_job_for_client(con, client_db_id)
        category_map = load_bucket_category_map(con)
        items = load_client_category_history(
            con,
            client_db_id,
            lambda cat: bucket_for_category(category_map, cat) == bucket_key,
            current_job_id=current_job_id,
        )

    return {"bucket_key": bucket_key, "items": items}


@router.get("/portal/data-entry/{bucket_key}/rows")
def portal_data_entry_list_rows(
    bucket_key: str,
    current_user: dict = Depends(portal_user_dep),
):
    _assert_valid_bucket(bucket_key)
    client_db_id = int(current_user["client_db_id"])
    site_ids = current_user.get("site_ids")
    source_type = _register_source_type_for_bucket(bucket_key)

    with get_conn() as con:
        ensure_portal_data_entry_schema(con)
        job_id = _resolve_job_or_404(con, client_db_id)
        job_summary = get_job_summary(con, job_id)

        if source_type:
            _ensure_emission_register_schema(con)
            df = con.execute(
                """
                SELECT source_id, site_id, scope, category, source_name, original_id, uom, qty, factor,
                       calc_tco2e, month_1, month_2, month_3, month_4, month_5, month_6,
                       month_7, month_8, month_9, month_10, month_11, month_12,
                       review_status, review_note, reviewed_by, reviewed_at, submitted_by_portal, enabled
                FROM job_emission_sources
                WHERE job_id = %s AND source_type = %s
                  AND (enabled = TRUE OR review_status IN ('pending_review', 'rejected'))
                ORDER BY source_id DESC
                """,
                [int(job_id), source_type],
            ).df()
            if df is None or df.empty:
                return {"job_id": job_id, "bucket_key": bucket_key, "rows": [], **job_summary}
            df = df.astype(object).where(df.notna(), None)
            rows = []
            for _, row in df.iterrows():
                row_dict = {k: row.get(k) for k in row.index}
                if site_ids is not None and row_dict.get("site_id") not in site_ids:
                    continue
                rows.append(_register_source_to_portal_dict(row_dict))
            return {"job_id": job_id, "bucket_key": bucket_key, "rows": rows, **job_summary}

        category_map = load_bucket_category_map(con)

        # enabled=FALSE covers two very different situations: a brand new
        # portal submission still awaiting review (review_status=
        # 'pending_review', by design -- see services/portal_data_entry.py),
        # and a row the CRM has since deleted (DELETE /jobs/{id}/scope-data/
        # {row_id} soft-deletes via enabled=FALSE without touching
        # review_status). Only the first should still show here.
        df = con.execute(
            """
            SELECT row_id, site_id, scope, category, report_label, original_id, uom, qty, factor,
                   calc_tco2e, month_1, month_2, month_3, month_4, month_5, month_6,
                   month_7, month_8, month_9, month_10, month_11, month_12,
                   review_status, review_note, reviewed_by, reviewed_at, submitted_by_portal, enabled
            FROM job_scope_rows
            WHERE job_id = %s
              AND (enabled = TRUE OR review_status IN ('pending_review', 'rejected'))
            ORDER BY row_id DESC
            """,
            [int(job_id)],
        ).df()

    if df is None or df.empty:
        return {"job_id": job_id, "bucket_key": bucket_key, "rows": [], **job_summary}

    # astype(object) first -- df.where(df.notna(), None) alone is a no-op on
    # float64 columns (pandas silently recasts the None back to NaN), which
    # then blows up JSON serialization ("Out of range float values are not
    # JSON compliant: nan") for any row with a null numeric column (qty,
    # factor, calc_tco2e, month_1..12 are all nullable).
    df = df.astype(object).where(df.notna(), None)
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

    try:
        site_id = int(payload.get("site_id"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="site_id is required")
    site_ids = current_user.get("site_ids")
    if site_ids is not None and site_id not in site_ids:
        raise HTTPException(status_code=403, detail="Not one of your assigned sites")

    with get_conn() as con:
        _ensure_job_scope_rows_schema(con)
        ensure_portal_data_entry_schema(con)
        job_id = _resolve_job_or_404(con, client_db_id)
        _assert_data_entry_open(con, job_id)

        category_map = load_bucket_category_map(con)
        submitted_category = (
            payload.get("category") or payload.get("level_1") or payload.get("level_2")
        )
        if bucket_for_category(category_map, submitted_category) != bucket_key:
            raise HTTPException(
                status_code=400,
                detail=f"That category doesn't belong under {BUCKET_LABELS[bucket_key]}",
            )

        # Verify the site really belongs to this client before attaching a row to it.
        site_row = con.execute(
            "SELECT 1 FROM client_sites WHERE site_id = %s AND client_db_id = %s",
            [int(site_id), client_db_id],
        ).fetchone()
        if not site_row:
            raise HTTPException(status_code=400, detail="Site not found for this account")

        final_dataset_id, final_factor_db_id, final_factor, final_ghg_unit = (
            _resolve_scope_row_factor_for_creation(con, job_id, scope, original_id, payload)
        )

        source_type = _register_source_type_for_bucket(bucket_key)
        if source_type:
            _ensure_emission_register_schema(con)
            calc_tco2e = _register_calc_tco2e(
                payload.get("qty"), final_factor, payload.get("apply_pct", 100), final_ghg_unit
            )
            result = con.execute(
                """
                INSERT INTO job_emission_sources (
                    job_id, scope, category, source_type, site_id, source_name, asset_identifier,
                    dataset_id, factor_db_id, original_id, qty, uom, factor, ghg_unit, apply_pct,
                    data_source, data_confidence, notes, calc_tco2e, enabled, review_status, submitted_by_portal,
                    month_1, month_2, month_3, month_4, month_5, month_6,
                    month_7, month_8, month_9, month_10, month_11, month_12
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, FALSE, 'pending_review', TRUE,
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING source_id
                """,
                [
                    int(job_id), scope, submitted_category, source_type, site_id,
                    payload.get("report_label") or original_id, payload.get("vehicle_registration"),
                    final_dataset_id, final_factor_db_id, original_id,
                    payload.get("qty"), payload.get("uom"), final_factor, final_ghg_unit,
                    payload.get("apply_pct", 100), "Client Portal", payload.get("data_confidence", "M"),
                    payload.get("notes"), calc_tco2e,
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
                entity_type="job_emission_source",
                entity_id=row_id,
                client_id=client_db_id,
                job_id=job_id,
                metadata={"bucket_key": bucket_key, "scope": scope, "original_id": original_id, "source_type": source_type},
            )
            return {"ok": True, "row_id": row_id, "job_id": job_id, "review_status": "pending_review"}

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

    source_type = _register_source_type_for_bucket(bucket_key)

    with get_conn() as con:
        if source_type:
            _ensure_emission_register_schema(con)
            existing = con.execute(
                """
                SELECT s.source_id, s.job_id, s.site_id, s.review_status, s.factor, s.ghg_unit, s.apply_pct
                FROM job_emission_sources s JOIN jobs j ON j.job_id = s.job_id
                WHERE s.source_id = %s AND j.client_db_id = %s AND s.source_type = %s
                """,
                [int(row_id), client_db_id, source_type],
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="Row not found")
            if existing[3] == "approved":
                raise HTTPException(status_code=409, detail="This row has already been approved and can no longer be edited here")
            _assert_data_entry_open(con, int(existing[1]))

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

            if "qty" in payload:
                set_clauses.append("calc_tco2e = %s")
                params.append(_register_calc_tco2e(payload.get("qty"), existing[4], existing[6], existing[5]))

            set_clauses.append("review_status = 'pending_review'")
            set_clauses.append("review_note = NULL")
            set_clauses.append("updated_at = NOW()")
            params.append(int(row_id))

            con.execute(
                f"UPDATE job_emission_sources SET {', '.join(set_clauses)} WHERE source_id = %s",
                params,
            )
            record_audit_event(
                con,
                request=request,
                actor={"email": current_user.get("email"), "full_name": current_user.get("full_name"), "user_id": "portal"},
                action="portal_update",
                entity_type="job_emission_source",
                entity_id=int(row_id),
                client_id=client_db_id,
                job_id=int(existing[1]),
                metadata={"bucket_key": bucket_key, "fields": list(payload.keys())},
            )
            return {"ok": True, "row_id": row_id, "review_status": "pending_review"}

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
        _assert_data_entry_open(con, int(existing[1]))

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


@router.delete("/portal/data-entry/{bucket_key}/rows/{row_id}")
def portal_data_entry_delete_row(
    request: Request,
    bucket_key: str,
    row_id: int,
    current_user: dict = Depends(portal_user_dep),
):
    """Hard-deletes a still-pending/rejected portal submission. A still-pending
    row was never enabled (never counted in a report), so unlike the CRM's
    own delete (which soft-deletes via enabled=FALSE to preserve an audit
    trail for rows that may have been live), there's nothing to preserve --
    hard delete avoids needing a new column just for this."""
    _assert_valid_bucket(bucket_key)
    client_db_id = int(current_user["client_db_id"])
    if current_user.get("role", "ClientAdmin") not in PORTAL_ROLE_CAN_MANAGE_ACTIONS:
        raise HTTPException(status_code=403, detail="Your portal role doesn't allow this action")

    source_type = _register_source_type_for_bucket(bucket_key)

    with get_conn() as con:
        if source_type:
            _ensure_emission_register_schema(con)
            existing = con.execute(
                """
                SELECT s.source_id, s.job_id, s.site_id, s.review_status
                FROM job_emission_sources s JOIN jobs j ON j.job_id = s.job_id
                WHERE s.source_id = %s AND j.client_db_id = %s AND s.source_type = %s AND s.submitted_by_portal = TRUE
                """,
                [int(row_id), client_db_id, source_type],
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="Row not found")
            if existing[3] == "approved":
                raise HTTPException(status_code=409, detail="This row has already been approved and can no longer be deleted here")
            _assert_data_entry_open(con, int(existing[1]))

            site_ids = current_user.get("site_ids")
            if site_ids is not None and existing[2] not in site_ids:
                raise HTTPException(status_code=403, detail="Not one of your assigned sites")

            con.execute("DELETE FROM job_emission_sources WHERE source_id = %s", [int(row_id)])

            record_audit_event(
                con,
                request=request,
                actor={"email": current_user.get("email"), "full_name": current_user.get("full_name"), "user_id": "portal"},
                action="portal_delete",
                entity_type="job_emission_source",
                entity_id=int(row_id),
                client_id=client_db_id,
                job_id=int(existing[1]),
                metadata={"bucket_key": bucket_key},
            )
            return {"ok": True, "row_id": row_id}

        _ensure_job_scope_rows_schema(con)
        existing = con.execute(
            """
            SELECT r.row_id, r.job_id, r.site_id, r.review_status
            FROM job_scope_rows r JOIN jobs j ON j.job_id = r.job_id
            WHERE r.row_id = %s AND j.client_db_id = %s AND r.submitted_by_portal = TRUE
            """,
            [int(row_id), client_db_id],
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Row not found")
        if existing[3] == "approved":
            raise HTTPException(status_code=409, detail="This row has already been approved and can no longer be deleted here")
        _assert_data_entry_open(con, int(existing[1]))

        site_ids = current_user.get("site_ids")
        if site_ids is not None and existing[2] not in site_ids:
            raise HTTPException(status_code=403, detail="Not one of your assigned sites")

        con.execute("DELETE FROM job_scope_rows WHERE row_id = %s", [int(row_id)])

        record_audit_event(
            con,
            request=request,
            actor={"email": current_user.get("email"), "full_name": current_user.get("full_name"), "user_id": "portal"},
            action="portal_delete",
            entity_type="job_scope_row",
            entity_id=int(row_id),
            client_id=client_db_id,
            job_id=int(existing[1]),
            metadata={"bucket_key": bucket_key},
        )

    return {"ok": True, "row_id": row_id}
