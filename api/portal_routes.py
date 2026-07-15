"""Client portal data routes — protected by portal JWT.

All routes verify the portal JWT via _portal_user dependency and then
enforce client_db_id ownership so a client can only access their own data.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse

logger = logging.getLogger(__name__)
from pydantic import BaseModel, Field

from api.portal_auth_routes import portal_user_dep
from core.database import get_conn
from pydantic import BaseModel as _BaseModel, Field as _Field
from services.portal import (
    add_comment,
    approve_review,
    get_or_create_review,
    list_comments,
    list_portal_users,
    mark_pdf_generated,
    portal_dashboard_jobs,
    send_review_to_client,
)
from services.portfolio import build_portfolio_overview
from services.tenancy import org_context

router = APIRouter(tags=["portal"])


# ---------------------------------------------------------------------------
# Ownership helpers
# ---------------------------------------------------------------------------

def _assert_job_belongs_to_client(job_id: int, client_db_id: int, con) -> None:
    row = con.execute(
        "SELECT client_db_id FROM jobs WHERE job_id = %s",
        [int(job_id)],
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    if int(row[0]) != int(client_db_id):
        raise HTTPException(status_code=403, detail="Access denied")


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

@router.get("/portal/dashboard")
def portal_dashboard(current_user: dict = Depends(portal_user_dep)):
    client_db_id = int(current_user["client_db_id"])
    with get_conn() as con:
        jobs = portal_dashboard_jobs(client_db_id, con=con)
        # Client name
        client_row = con.execute(
            "SELECT client_name FROM clients WHERE db_id = %s",
            [client_db_id],
        ).fetchone()
    return {
        "ok": True,
        "client_name": str(client_row[0] or "") if client_row else "",
        "jobs": jobs,
    }


@router.get("/portal/portfolio-dashboard")
def portal_portfolio_dashboard(current_user: dict = Depends(portal_user_dep)):
    client_db_id = int(current_user["client_db_id"])
    with get_conn() as con:
        client_row = con.execute(
            "SELECT status, org_id FROM clients WHERE db_id = %s",
            [client_db_id],
        ).fetchone()
        if not client_row:
            raise HTTPException(status_code=404, detail="Client not found")
        if str(client_row[0] or "").strip().lower() != "portfolio owner":
            raise HTTPException(status_code=403, detail="Portfolio dashboard is only available to portfolio owners")
        org_id = str(client_row[1]) if client_row[1] else None
        with org_context(org_id):
            return build_portfolio_overview(con, client_db_id)


# ---------------------------------------------------------------------------
# Job overview (emissions summary)
# ---------------------------------------------------------------------------

@router.get("/portal/jobs/{job_id}")
def portal_job_overview(job_id: int, current_user: dict = Depends(portal_user_dep)):
    client_db_id = int(current_user["client_db_id"])
    with get_conn() as con:
        _assert_job_belongs_to_client(job_id, client_db_id, con)
        job_row = con.execute(
            "SELECT job_id, job_number, title, reporting_year, status FROM jobs WHERE job_id = %s",
            [int(job_id)],
        ).fetchone()
        if not job_row:
            raise HTTPException(status_code=404, detail="Job not found")

        review = get_or_create_review(job_id, con=con)
        comments = list_comments(review["review_id"], con=con)

    # Fetch emissions data via existing functions
    try:
        from api.job_report_routes import get_scope_totals, get_emissions_by_category
        scope_totals = get_scope_totals(job_id)
        emissions_by_category = get_emissions_by_category(job_id)
    except Exception:
        scope_totals = {"Scope 1": 0.0, "Scope 2": 0.0, "Scope 3": 0.0, "Total": 0.0}
        emissions_by_category = []

    open_count = sum(1 for c in comments if c["status"] == "open")

    return {
        "ok": True,
        "job": {
            "job_id": int(job_row[0]),
            "job_number": str(job_row[1] or ""),
            "title": str(job_row[2] or ""),
            "reporting_year": int(job_row[3]) if job_row[3] else None,
            "status": str(job_row[4] or ""),
        },
        "review": review,
        "open_comment_count": open_count,
        "scope_totals": scope_totals,
        "emissions_by_category": emissions_by_category,
    }


# ---------------------------------------------------------------------------
# Live report data — mirrors CRM's /jobs/{job_id}/live-report-data
# ---------------------------------------------------------------------------

@router.get("/portal/jobs/{job_id}/live-report-data")
def portal_live_report_data(job_id: int, current_user: dict = Depends(portal_user_dep)):
    from services.tenancy import org_context
    from api.job_live_report_routes import get_job_live_report_data

    try:
        client_db_id = int(current_user["client_db_id"])
        with get_conn() as con:
            _assert_job_belongs_to_client(job_id, client_db_id, con)
            _org_id = _portal_org_id(con, client_db_id)

        _mock_user = {
            "email": current_user["email"],
            "role": "portal",
            "sub": "portal",
            "org_id": _org_id,
            "user_id": "portal",
        }
        with org_context(_org_id):
            try:
                return get_job_live_report_data(int(job_id), _user=_mock_user)
            except HTTPException as exc:
                if exc.status_code != 500:
                    raise
                logger.exception(
                    "portal_live_report_data failed for job %s with HTTP 500; returning fallback payload",
                    job_id,
                )
                return _portal_fallback_live_report_payload(int(job_id))
            except Exception:
                logger.exception("portal_live_report_data failed for job %s; returning fallback payload", job_id)
                return _portal_fallback_live_report_payload(int(job_id))
    except HTTPException as exc:
        if exc.status_code != 500:
            raise
        logger.exception("portal_live_report_data preflight failed for job %s with HTTP 500; returning fallback payload", job_id)
        return _portal_fallback_live_report_payload(int(job_id))
    except Exception:
        logger.exception("portal_live_report_data preflight failed for job %s; returning fallback payload", job_id)
        return _portal_fallback_live_report_payload(int(job_id))


# ---------------------------------------------------------------------------
# Report HTML — serves saved final-version snapshot (avoids heavyweight render)
# ---------------------------------------------------------------------------

@router.get("/portal/jobs/{job_id}/report-html", response_class=HTMLResponse)
def portal_report_html(job_id: int, current_user: dict = Depends(portal_user_dep)):
    from services.tenancy import org_context
    from api.job_report_routes import _render_report_snapshot_html

    client_db_id = int(current_user["client_db_id"])
    with get_conn() as con:
        _assert_job_belongs_to_client(job_id, client_db_id, con)
        _org_id = _portal_org_id(con, client_db_id)

    with org_context(_org_id):
        with get_conn() as con:
            import json as _json
            version_row_raw = con.execute(
                """
                SELECT report_version_id, snapshot_json, status, version_label, version_number
                FROM job_report_versions
                WHERE job_id = %s
                  AND lower(COALESCE(status, '')) IN ('final', 'review', 'draft')
                  AND snapshot_json IS NOT NULL
                ORDER BY
                    CASE lower(COALESCE(status, ''))
                        WHEN 'final' THEN 1
                        WHEN 'review' THEN 2
                        WHEN 'draft' THEN 3
                        ELSE 4
                    END,
                    COALESCE(finalized_at, reviewed_at, generated_at) DESC NULLS LAST,
                    version_number DESC NULLS LAST
                LIMIT 1
                """,
                [int(job_id)],
            ).fetchone()

    if not version_row_raw or not version_row_raw[1]:
        raise HTTPException(
            status_code=404,
            detail="No report has been published for review yet. Please ask your NZI consultant to send the report for review.",
        )

    try:
        snapshot_payload = _json.loads(version_row_raw[1])
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Report snapshot is corrupted: {exc}") from exc
    try:
        html_content = _render_report_snapshot_html(snapshot_payload, portal_view=True)
    except Exception as exc:
        logger.exception("portal_report_html: snapshot render failed for job %s", job_id)
        raise HTTPException(status_code=500, detail=f"Report render failed: {exc}") from exc

    return HTMLResponse(content=html_content, status_code=200)


@router.get("/portal/jobs/{job_id}/report-meta")
def portal_report_meta(job_id: int, current_user: dict = Depends(portal_user_dep)):
    from services.tenancy import org_context

    client_db_id = int(current_user["client_db_id"])
    with get_conn() as con:
        _assert_job_belongs_to_client(job_id, client_db_id, con)
        _org_id = _portal_org_id(con, client_db_id)

    with org_context(_org_id):
        with get_conn() as con:
            row = con.execute(
                """
                SELECT report_version_id, version_label, version_number, status,
                       generated_at, reviewed_at, finalized_at
                FROM job_report_versions
                WHERE job_id = %s
                  AND lower(COALESCE(status, '')) IN ('final', 'review', 'draft')
                  AND snapshot_json IS NOT NULL
                ORDER BY
                    CASE lower(COALESCE(status, ''))
                        WHEN 'final' THEN 1
                        WHEN 'review' THEN 2
                        WHEN 'draft' THEN 3
                        ELSE 4
                    END,
                    COALESCE(finalized_at, reviewed_at, generated_at) DESC NULLS LAST,
                    version_number DESC NULLS LAST
                LIMIT 1
                """,
                [int(job_id)],
            ).fetchone()

    if not row:
        raise HTTPException(
            status_code=404,
            detail="No report has been published for review yet. Please ask your NZI consultant to send the report for review.",
        )

    def _dt_to_iso(value):
        try:
            return value.isoformat() if value else None
        except Exception:
            return None

    snapshot_at = row[6] or row[5] or row[4]
    return {
        "ok": True,
        "report_version_id": int(row[0]) if row[0] is not None else None,
        "version_label": str(row[1] or ""),
        "version_number": int(row[2]) if row[2] is not None else None,
        "status": str(row[3] or ""),
        "generated_at": _dt_to_iso(row[4]),
        "reviewed_at": _dt_to_iso(row[5]),
        "finalized_at": _dt_to_iso(row[6]),
        "snapshot_at": _dt_to_iso(snapshot_at),
    }


# ---------------------------------------------------------------------------
# Portal snapshot data — frozen JSON payload sent by CRM via Send to Portal
# ---------------------------------------------------------------------------

@router.get("/portal/jobs/{job_id}/portal-snapshot-data")
def portal_snapshot_data(job_id: int, current_user: dict = Depends(portal_user_dep)):
    """Return the frozen report data snapshot that the CRM sent to this client.

    The snapshot is keyed by report_reviews.portal_version_id so the client
    always sees exactly the version the CRM explicitly sent, not live data.
    Returns { status: 'not_sent' } with 404 if no version has been sent yet.
    """
    import json as _json

    client_db_id = int(current_user["client_db_id"])
    with get_conn() as con:
        _assert_job_belongs_to_client(job_id, client_db_id, con)

        # Load the review record and resolve the portal version
        review_row = con.execute(
            """
            SELECT rr.status, rr.portal_version_id,
                   rr.approved_at, rr.approved_by_name,
                   rr.published_at, rr.pdf_version_id,
                   rr.sent_for_review_at, rr.review_id
            FROM report_reviews rr
            WHERE rr.job_id = %s
            """,
            [int(job_id)],
        ).fetchone()

        if not review_row or not review_row[1]:
            raise HTTPException(
                status_code=404,
                detail="not_sent",
            )

        review_status = str(review_row[0] or "draft")
        portal_version_id = int(review_row[1])

        version_row = con.execute(
            """
            SELECT snapshot_json, version_label, version_number, reviewed_at
            FROM job_report_versions
            WHERE report_version_id = %s AND snapshot_json IS NOT NULL
            """,
            [portal_version_id],
        ).fetchone()

    if not version_row or not version_row[0]:
        raise HTTPException(
            status_code=404,
            detail="not_sent",
        )

    try:
        snapshot = _json.loads(version_row[0])
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Snapshot is corrupted: {exc}") from exc

    def _dt(v):
        try:
            return v.isoformat() if v else None
        except Exception:
            return None

    return {
        "ok": True,
        "snapshot": snapshot,
        "review_status": review_status,
        "version_label": str(version_row[1] or ""),
        "version_number": int(version_row[2]) if version_row[2] is not None else None,
        "sent_at": _dt(version_row[3]),
        "approved_at": _dt(review_row[2]),
        "approved_by_name": str(review_row[3] or "") or None,
        "published_at": _dt(review_row[4]),
        "review_id": int(review_row[7]) if review_row[7] is not None else None,
    }


# ---------------------------------------------------------------------------
# PDF download — available to client after CRM publishes
# ---------------------------------------------------------------------------

@router.get("/portal/jobs/{job_id}/download-pdf")
def portal_download_pdf(job_id: int, current_user: dict = Depends(portal_user_dep)):
    """Serve the published PDF to the client.  Only available after CRM clicks Publish PDF."""
    from fastapi.responses import Response as _Response
    import pathlib as _pathlib

    client_db_id = int(current_user["client_db_id"])
    with get_conn() as con:
        _assert_job_belongs_to_client(job_id, client_db_id, con)

        review_row = con.execute(
            "SELECT published_at, pdf_version_id FROM report_reviews WHERE job_id = %s",
            [int(job_id)],
        ).fetchone()

    if not review_row or not review_row[0]:
        raise HTTPException(
            status_code=404,
            detail="The PDF is not yet available. Your consultant will notify you when it has been published.",
        )

    pdf_version_id = review_row[1]
    if not pdf_version_id:
        raise HTTPException(status_code=404, detail="PDF version not found.")

    with get_conn() as con:
        version_row = con.execute(
            "SELECT file_path, file_name FROM job_report_versions WHERE report_version_id = %s",
            [int(pdf_version_id)],
        ).fetchone()

    if not version_row or not version_row[0]:
        raise HTTPException(status_code=404, detail="PDF file not found.")

    file_path = _pathlib.Path(str(version_row[0]))
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="PDF file not found on server.")

    pdf_bytes = file_path.read_bytes()
    filename = str(version_row[1] or f"report-job-{job_id}.pdf")
    return _Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------

class AddCommentPayload(BaseModel):
    comment_text: str = Field(..., min_length=1)
    section_reference: str | None = None


@router.get("/portal/jobs/{job_id}/comments")
def portal_list_comments(job_id: int, current_user: dict = Depends(portal_user_dep)):
    client_db_id = int(current_user["client_db_id"])
    with get_conn() as con:
        _assert_job_belongs_to_client(job_id, client_db_id, con)
        review = get_or_create_review(job_id, con=con)
        comments = list_comments(review["review_id"], con=con)
    return {"ok": True, "review": review, "comments": comments}


@router.post("/portal/jobs/{job_id}/comments")
def portal_add_comment(
    job_id: int,
    payload: AddCommentPayload = Body(...),
    current_user: dict = Depends(portal_user_dep),
):
    client_db_id = int(current_user["client_db_id"])
    with get_conn(autocommit=False) as con:
        _assert_job_belongs_to_client(job_id, client_db_id, con)
        review = get_or_create_review(job_id, con=con)

        if review["status"] == "approved":
            raise HTTPException(status_code=400, detail="This report has already been approved and cannot receive new comments")

        comment = add_comment(
            review["review_id"],
            author_type="client",
            author_name=current_user["full_name"],
            author_email=current_user["email"],
            comment_text=payload.comment_text,
            section_reference=payload.section_reference,
            con=con,
        )

    # Notify assigned CRM
    _notify_crm_new_comment(job_id, current_user["full_name"])

    return {"ok": True, "comment": comment}


def _notify_crm_new_comment(job_id: int, client_name: str) -> None:
    try:
        with get_conn() as con:
            row = con.execute(
                """
                SELECT j.job_number, j.title, u.email AS crm_email, u.full_name AS crm_name
                FROM jobs j
                LEFT JOIN users u ON u.user_id = j.assigned_user_id
                WHERE j.job_id = %s
                """,
                [int(job_id)],
            ).fetchone()
        if not row or not row[2]:
            return
        from services.outbound_email import send_tracked_email
        from services.messaging_templates import build_email_content
        job_ref = f"{row[0]} — {row[1]}" if row[0] else str(row[1] or f"Job {job_id}")
        crm_name = row[3] or "there"
        context = {"crm_name": crm_name, "client_name": client_name, "job_ref": job_ref}
        fallback_body = (
            f"<p>Hi {crm_name},</p>"
            f"<p><strong>{client_name}</strong> has added a comment to <strong>{job_ref}</strong> in NZInsights.</p>"
            f"<p>Log in to the NZI app to review and respond.</p>"
        )
        with get_conn() as con:
            rendered = build_email_content(
                con=con,
                template_key="portal_client_commented",
                context=context,
                fallback_subject=f"New client comment on {job_ref}",
                fallback_body=fallback_body,
                sender_identifier="portal",
            )
            send_tracked_email(
                con,
                to_email=row[2],
                subject=rendered["subject"],
                body_text=rendered["body_text"],
                body_html=rendered["body_html"],
                template_key="portal_client_commented",
                entity_type="job",
                entity_id=str(job_id),
                job_id=job_id,
                created_by="portal",
            )
    except Exception:
        pass  # Non-fatal


# ---------------------------------------------------------------------------
# Debug — raw data counts for portal client (temporary)
# ---------------------------------------------------------------------------

@router.get("/portal/debug-data")
def portal_debug_data(current_user: dict = Depends(portal_user_dep)):
    client_db_id = int(current_user["client_db_id"])
    with get_conn() as con:
        jobs_df = _portal_load_jobs(con, client_db_id)
        job_ids = [] if (jobs_df is None or jobs_df.empty) else [int(j) for j in jobs_df["job_id"].tolist()]

        result: dict = {
            "client_db_id": client_db_id,
            "job_ids": job_ids,
            "job_details": [],
            "scope_rows_count": 0,
            "emission_sources_count": 0,
            "crp_scope_entries_count": 0,
        }

        for jid in job_ids:
            jr = con.execute(
                "SELECT job_id, title, reporting_year, is_crp FROM jobs WHERE job_id = %s",
                [jid],
            ).fetchone()
            if jr:
                result["job_details"].append({
                    "job_id": jr[0], "title": str(jr[1] or ""), "reporting_year": jr[2],
                    "is_crp": jr[3],
                })

        if job_ids:
            ph = ",".join(["%s"] * len(job_ids))
            r = con.execute(
                f"SELECT COUNT(*) FROM job_scope_rows WHERE job_id IN ({ph}) AND enabled = TRUE",
                job_ids,
            ).fetchone()
            result["scope_rows_count"] = int(r[0] or 0) if r else 0

            r2 = con.execute(
                f"SELECT COUNT(*) FROM job_emission_sources WHERE job_id IN ({ph}) AND COALESCE(enabled, TRUE) = TRUE",
                job_ids,
            ).fetchone()
            result["emission_sources_count"] = int(r2[0] or 0) if r2 else 0

            r3 = con.execute(
                f"SELECT COUNT(*) FROM crp_scope_entries WHERE job_id IN ({ph}) AND is_archived = FALSE",
                job_ids,
            ).fetchone()
            result["crp_scope_entries_count"] = int(r3[0] or 0) if r3 else 0

    return result


# ---------------------------------------------------------------------------
# Metrics (dashboard data) — replicates /clients/{id}/dashboard?lite=1
# ---------------------------------------------------------------------------

def _portal_safe_year(value):
    try:
        if value is None:
            return None
        if str(value).strip().lower() in {"nan", "<na>", "none", "null", ""}:
            return None
        return int(value)
    except Exception:
        return None


def _portal_clean_label(value, fallback: str) -> str:
    txt = str(value or "").strip()
    if not txt or txt.lower() in {"nan", "none", "null"}:
        return fallback
    return txt


def _table_columns(con, table_name: str) -> set[str]:
    try:
        rows = con.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE lower(table_name) = lower(%s)
            """,
            [str(table_name or "").strip()],
        ).fetchall()
        return {str(r[0]).strip().lower() for r in (rows or []) if r and r[0] is not None}
    except Exception:
        return set()


def _portal_category_label(row) -> str:
    for value in (
        row.get("dataset_category"),
        row.get("lookup_category"),
        row.get("category"),
        row.get("lookup_level_1"),
        row.get("level_1"),
        row.get("level_2"),
    ):
        txt = str(value or "").strip()
        if txt and txt.lower() not in {"nan", "none", "null", "uncategorized", "uncategorised"}:
            return txt
    return "Uncategorized"


def _portal_load_crp_entries(con, job_ids: list[int]):
    """Return crp_scope_entries rows shaped like load_combined_reporting_rows output."""
    import pandas as pd
    if not job_ids:
        return pd.DataFrame()
    ph = ",".join(["%s"] * len(job_ids))
    return con.execute(
        f"""
        SELECT
            cse.job_id,
            COALESCE(
                EXTRACT(YEAR FROM j.reporting_period_end),
                EXTRACT(YEAR FROM cjd.reporting_period_to),
                j.reporting_year
            ) AS dashboard_year,
            cse.scope,
            COALESCE(NULLIF(TRIM(CAST(cse.category AS VARCHAR)), ''), 'Uncategorized') AS dataset_category,
            COALESCE(NULLIF(TRIM(CAST(cse.category AS VARCHAR)), ''), 'Uncategorized') AS category,
            COALESCE(NULLIF(TRIM(CAST(cse.category AS VARCHAR)), ''), 'Uncategorized') AS lookup_category,
            'source_register'::text AS record_type,
            COALESCE(cse.tco2e, 0) AS calc_tco2e,
            'No Site Assigned'::text AS site_name
        FROM crp_scope_entries cse
        JOIN jobs j ON j.job_id = cse.job_id
        LEFT JOIN crp_job_details cjd ON cjd.job_id = cse.job_id
        WHERE cse.job_id IN ({ph})
          AND cse.is_archived = FALSE
          AND COALESCE(cse.tco2e, 0) != 0
        """,
        job_ids,
    ).df()


def _portal_org_id(con, client_db_id: int) -> str | None:
    """Look up the org_id for this client so we can mirror the CRM's org context."""
    if "org_id" not in _table_columns(con, "clients"):
        return None
    try:
        row = con.execute(
            "SELECT org_id FROM clients WHERE db_id = %s", [int(client_db_id)]
        ).fetchone()
        if row and row[0]:
            return str(row[0])
    except Exception:
        return None
    return None


def _portal_load_jobs(con, client_db_id: int):
    return con.execute(
        """
        SELECT j.job_id, j.reporting_year,
               COALESCE(
                   EXTRACT(YEAR FROM j.reporting_period_end),
                   EXTRACT(YEAR FROM cjd.reporting_period_to),
                   j.reporting_year
               ) AS dashboard_year
        FROM jobs j
        LEFT JOIN crp_job_details cjd ON cjd.job_id = j.job_id
        WHERE j.client_db_id = %s
        ORDER BY dashboard_year ASC NULLS LAST
        """,
        [int(client_db_id)],
    ).df()


def _portal_fallback_live_report_payload(job_id: int) -> dict[str, Any]:
    """Return a minimal live-report payload without ever raising."""
    from api.job_report_routes import get_job_data

    try:
        job_data = get_job_data(int(job_id))
    except Exception:
        job_data = None

    if not job_data:
        try:
            with get_conn() as con:
                row = con.execute(
                    """
                    SELECT j.job_id, j.client_db_id, j.org_id, j.job_number, j.title, j.reporting_year, j.status,
                           j.reporting_period_start, j.reporting_period_end,
                           c.client_name, c.crm_owner, c.industry, c.logo_url, c.description_long,
                           c.net_zero_year, c.interim_year, c.benchmark_year,
                           c.benchmark_period_start, c.benchmark_period_end,
                           c.interim_s1_pct, c.interim_s2_pct, c.interim_s3_pct,
                           c.target_s1_year, c.target_s2_year, c.target_s3_year,
                           c.target_s1_pct, c.target_s2_pct, c.target_s3_pct,
                           c.addr_city, c.addr_country
                    FROM jobs j
                    LEFT JOIN clients c ON c.db_id = j.client_db_id
                    WHERE j.job_id = %s
                    """,
                    [int(job_id)],
                ).fetchone()
            if row:
                job_data = {
                    "job_id": row[0],
                    "client_db_id": row[1],
                    "org_id": row[2],
                    "job_number": row[3],
                    "title": row[4],
                    "reporting_year": row[5],
                    "status": row[6],
                    "period_start": row[7],
                    "period_end": row[8],
                    "reporting_period_start": row[7],
                    "reporting_period_end": row[8],
                    "client_name": row[9] if len(row) > 9 else None,
                    "crm_owner": row[10] if len(row) > 10 else None,
                    "industry": row[11] if len(row) > 11 else None,
                    "logo_url": row[12] if len(row) > 12 else None,
                    "client_logo_url": row[12] if len(row) > 12 else None,
                    "description": row[13] if len(row) > 13 else None,
                    "net_zero_year": row[14] if len(row) > 14 else None,
                    "interim_year": row[15] if len(row) > 15 else None,
                    "benchmark_year": row[16] if len(row) > 16 else None,
                    "benchmark_period_start": row[17] if len(row) > 17 else None,
                    "benchmark_period_end": row[18] if len(row) > 18 else None,
                    "interim_s1_pct": row[19] if len(row) > 19 else None,
                    "interim_s2_pct": row[20] if len(row) > 20 else None,
                    "interim_s3_pct": row[21] if len(row) > 21 else None,
                    "target_s1_year": row[22] if len(row) > 22 else None,
                    "target_s2_year": row[23] if len(row) > 23 else None,
                    "target_s3_year": row[24] if len(row) > 24 else None,
                    "target_s1_pct": row[25] if len(row) > 25 else None,
                    "target_s2_pct": row[26] if len(row) > 26 else None,
                    "target_s3_pct": row[27] if len(row) > 27 else None,
                    "city": row[28] if len(row) > 28 else None,
                    "country": row[29] if len(row) > 29 else None,
                    "job_family": None,
                    "data_collection_due": None,
                    "first_draft_due": None,
                    "final_report_due": None,
                    "no_of_staff": None,
                    "no_premises_owned": None,
                    "no_premises_leased": None,
                    "no_vehicles_owned": None,
                    "no_vehicles_leased": None,
                }
        except Exception:
            job_data = None

    if not job_data:
        raise HTTPException(status_code=404, detail="Job not found")

    try:
        from api.job_report_routes import get_scope_totals, get_emissions_by_category
        scope_totals = get_scope_totals(int(job_id))
    except Exception:
        scope_totals = {"Scope 1": 0.0, "Scope 2": 0.0, "Scope 3": 0.0, "Total": 0.0}

    try:
        from api.job_report_routes import get_emissions_by_category
        categories = get_emissions_by_category(int(job_id))
    except Exception:
        categories = []

    total_emissions = float(scope_totals.get("Total") or 0.0)
    return {
        "job_data": job_data,
        "scope_totals": scope_totals,
        "benchmark_totals": {"Scope 1": 0.0, "Scope 2": 0.0, "Scope 3": 0.0, "Total": 0.0},
        "categories": categories,
        "benchmark_categories": [],
        "activity_groups": {},
        "activity_totals": {},
        "activity_details": {},
        "activity_group_order": [],
        "activity_group_colors": {},
        "job_actions": {},
        "intensity_metrics": {},
        "yearly_emissions": [],
        "target_data": {},
        "report_metadata": {},
        "template_variables": {},
        "site_breakdowns": {},
        "glossary_cards": [],
        "render_values": {},
        "nzi_logo_src": "",
        "summary": {
            "current_total": total_emissions,
            "benchmark_total": 0.0,
            "delta_total": total_emissions,
            "delta_pct": None,
            "top_category": None,
        },
    }


@router.get("/portal/metrics")
def portal_metrics(
    year: int | None = Query(default=None),
    current_user: dict = Depends(portal_user_dep),
):
    from services.emissions_reporting import load_combined_reporting_rows, attach_exact_emissions
    from services.client_benchmark import get_client_benchmark_metrics
    from services.tenancy import org_context
    from datetime import date as _date

    client_db_id = int(current_user["client_db_id"])
    with get_conn() as con:
        client_row = con.execute(
            "SELECT client_name, net_zero_year, org_id FROM clients WHERE db_id = %s",
            [client_db_id],
        ).fetchone()
        if not client_row:
            raise HTTPException(status_code=404, detail="Client not found")

        _org_id = str(client_row[2]) if client_row[2] else None

    with org_context(_org_id):
        with get_conn() as con:
            jobs_df = _portal_load_jobs(con, client_db_id)
            job_ids = [] if (jobs_df is None or jobs_df.empty) else [int(j) for j in jobs_df["job_id"].tolist()]

            scope_df = None
            if job_ids:
                import pandas as pd
                try:
                    rows_df = load_combined_reporting_rows(con, job_ids)
                    if rows_df is not None and not rows_df.empty:
                        scope_df = attach_exact_emissions(con, rows_df)
                except Exception as exc:
                    logger.exception(
                        "portal_metrics: emissions load failed client_db_id=%s job_ids=%s",
                        client_db_id, job_ids,
                    )
                    scope_df = None

                # Merge CRP scope entries (jobs that store data in crp_scope_entries
                # rather than job_scope_rows / job_emission_sources)
                try:
                    crp_df = _portal_load_crp_entries(con, job_ids)
                    if crp_df is not None and not crp_df.empty:
                        crp_df["emissions"] = crp_df["calc_tco2e"].astype(float)
                        if scope_df is None or scope_df.empty:
                            scope_df = crp_df
                        else:
                            scope_df = pd.concat([scope_df, crp_df], ignore_index=True)
                except Exception as exc:
                    logger.exception(
                        "portal_metrics: crp entries load failed client_db_id=%s", client_db_id,
                    )

            try:
                benchmark_metrics = get_client_benchmark_metrics(con, client_db_id)
            except Exception:
                benchmark_metrics = None

            net_zero_progress = None
            if client_row[1]:
                nz_year = int(client_row[1])
                net_zero_progress = {
                    "net_zero_year": nz_year,
                    "years_to_target": max(0, nz_year - _date.today().year),
                }

            if scope_df is None or scope_df.empty:
                avail: list[int] = []
                if jobs_df is not None and not jobs_df.empty:
                    avail = sorted({_portal_safe_year(r.get("dashboard_year")) for _, r in jobs_df.iterrows() if _portal_safe_year(r.get("dashboard_year"))})
                sel_yr = year if year in avail else (avail[-1] if avail else None)
                return {
                    "client_db_id": client_db_id, "client_name": str(client_row[0] or ""),
                    "selected_year": sel_yr, "available_years": avail,
                    "current_metrics": {"total_emissions": 0, "scope1": 0, "scope2": 0, "scope3": 0, "year": None},
                    "yoy_change": None, "yearly_emissions": [], "yearly_top_categories": [],
                    "yearly_intensity_metrics": [], "top_categories": [], "intensity_metrics": [],
                    "currency": "GBP", "benchmark_metrics": benchmark_metrics, "net_zero_progress": net_zero_progress,
                }

            scope_df = scope_df.copy()
            scope_df["dashboard_year_norm"] = scope_df["dashboard_year"].apply(_portal_safe_year)
            scope_df = scope_df[scope_df["dashboard_year_norm"].notna()].copy()
            scope_df["dataset_category"] = scope_df.apply(lambda r: _portal_category_label(r), axis=1)

            years_set = {int(y) for y in scope_df["dashboard_year_norm"].dropna().unique() if _portal_safe_year(y) is not None}
            job_years_set = {_portal_safe_year(r.get("dashboard_year")) for _, r in jobs_df.iterrows() if _portal_safe_year(r.get("dashboard_year"))} if jobs_df is not None else set()
            available_years = sorted(years_set | job_years_set)

            req_year = _portal_safe_year(year)
            selected_year = req_year if req_year in available_years else (available_years[-1] if available_years else None)

            scope_groups = scope_df.groupby(["dashboard_year_norm", "scope"])["emissions"].sum().reset_index()
            yearly_emissions: list[dict[str, Any]] = []
            for yr in available_years:
                yr_rows = scope_groups[scope_groups["dashboard_year_norm"] == yr]
                yearly_emissions.append({
                    "year": yr,
                    "scope1": float(yr_rows[yr_rows["scope"] == "Scope 1"]["emissions"].sum()),
                    "scope2": float(yr_rows[yr_rows["scope"] == "Scope 2"]["emissions"].sum()),
                    "scope3": float(yr_rows[yr_rows["scope"] == "Scope 3"]["emissions"].sum()),
                    "total": float(yr_rows["emissions"].sum()),
                })

            current_metrics: dict[str, Any] = {"total_emissions": 0, "scope1": 0, "scope2": 0, "scope3": 0, "year": selected_year}
            if selected_year is not None:
                sd = next((y for y in yearly_emissions if y["year"] == selected_year), None)
                if sd:
                    current_metrics = {"total_emissions": sd["total"], "scope1": sd["scope1"], "scope2": sd["scope2"], "scope3": sd["scope3"], "year": selected_year}

            yoy_change = None
            if selected_year is not None and len(yearly_emissions) >= 2:
                idx = next((i for i, y in enumerate(yearly_emissions) if y["year"] == selected_year), None)
                if idx is not None and idx > 0 and yearly_emissions[idx - 1]["total"] > 0:
                    yoy_change = round((yearly_emissions[idx]["total"] - yearly_emissions[idx - 1]["total"]) / yearly_emissions[idx - 1]["total"] * 100, 1)

            yearly_top_categories: list[dict[str, Any]] = []
            for yr in available_years:
                yr_df = scope_df[scope_df["dashboard_year_norm"] == yr]
                yr_total = float(next((y["total"] for y in yearly_emissions if y["year"] == yr), 0))
                cats: list[dict[str, Any]] = []
                if not yr_df.empty:
                    cg = yr_df.groupby("dataset_category")["emissions"].sum().reset_index()
                    cg = cg.sort_values("emissions", ascending=False).head(10)
                    for _, row in cg.iterrows():
                        cat = str(row["dataset_category"]).strip()
                        if not cat or cat.lower() in ["nan", "none", "null"]:
                            continue
                        em = float(row["emissions"])
                        cats.append({"category": cat, "dataset_category": cat, "emissions": em, "percentage": round((em / yr_total * 100) if yr_total > 0 else 0, 1)})
                yearly_top_categories.append({"year": yr, "categories": cats})

            top_categories: list[dict[str, Any]] = []
            if selected_year is not None:
                sel_tc = next((y for y in yearly_top_categories if y["year"] == selected_year), None)
                if sel_tc:
                    top_categories = sel_tc["categories"]

            yearly_intensity_metrics: list[dict[str, Any]] = []
            for yr in available_years:
                yr_metrics: list[dict[str, Any]] = []
                yr_total = float(next((y["total"] for y in yearly_emissions if y["year"] == yr), 0))
                if jobs_df is not None and not jobs_df.empty:
                    yr_jobs = jobs_df[jobs_df["dashboard_year"].apply(_portal_safe_year) == yr]
                    if not yr_jobs.empty:
                        latest_job_id = int(yr_jobs.iloc[-1]["job_id"])
                        try:
                            r = con.execute("SELECT intensity_metrics FROM jobs WHERE job_id = %s", [latest_job_id]).fetchone()
                            if r and r[0]:
                                for key, metric in r[0].items():
                                    if metric.get("value", 0) > 0:
                                        intensity = (yr_total / metric["value"]) * metric.get("divider", 1)
                                        yr_metrics.append({"key": key, "label": metric.get("label", key), "value": metric.get("value"), "divider": metric.get("divider", 1), "intensity": round(intensity, 2)})
                        except Exception:
                            pass
                yearly_intensity_metrics.append({"year": yr, "metrics": yr_metrics})

            intensity_metrics: list[dict[str, Any]] = []
            if selected_year is not None:
                sel_m = next((y for y in yearly_intensity_metrics if y["year"] == selected_year), None)
                if sel_m:
                    intensity_metrics = sel_m["metrics"]

            return {
                "client_db_id": client_db_id,
                "client_name": str(client_row[0] or ""),
                "selected_year": selected_year,
                "available_years": available_years,
                "current_metrics": current_metrics,
                "yoy_change": yoy_change,
                "yearly_emissions": yearly_emissions,
                "yearly_top_categories": yearly_top_categories,
                "yearly_intensity_metrics": yearly_intensity_metrics,
                "top_categories": top_categories,
                "intensity_metrics": intensity_metrics,
                "currency": "GBP",
                "benchmark_metrics": benchmark_metrics,
                "net_zero_progress": net_zero_progress,
            }


# ---------------------------------------------------------------------------
# Reporting data — replicates /clients/{id}/reporting
# ---------------------------------------------------------------------------

@router.get("/portal/reporting-data")
def portal_reporting_data(current_user: dict = Depends(portal_user_dep)):
    from services.emissions_reporting import load_combined_reporting_rows, combined_row_metrics
    from services.monthly_emissions import JobMonthlyEmissionsResolver
    from services.tenancy import org_context

    client_db_id = int(current_user["client_db_id"])

    # Step 1: look up client + org_id without org context (clients table is not org-scoped in our queries)
    with get_conn() as con:
        client_row = con.execute(
            "SELECT client_name, org_id FROM clients WHERE db_id = %s", [client_db_id]
        ).fetchone()
        if not client_row:
            raise HTTPException(status_code=404, detail="Client not found")
        _org_id = str(client_row[1]) if client_row[1] else None

    empty_resp = {
        "client_db_id": client_db_id,
        "client_name": str(client_row[0] or ""),
        "years": [], "by_scope": [], "by_scope_category": [], "by_activity": [], "by_site": [],
    }

    # Step 2: all emissions queries run with org context so RLS matches the CRM
    with org_context(_org_id):
        with get_conn() as con:
            jobs_df = _portal_load_jobs(con, client_db_id)
            if jobs_df is None or jobs_df.empty:
                return empty_resp

            job_ids = [int(j) for j in jobs_df["job_id"].tolist()]
            try:
                scope_df = load_combined_reporting_rows(con, job_ids)
            except Exception as exc:
                logger.exception(
                    "portal_reporting_data: rows load failed client_db_id=%s job_ids=%s",
                    client_db_id, job_ids,
                )
                raise HTTPException(status_code=500, detail=f"Failed to load emissions data: {exc}") from exc

            # Merge CRP scope entries for jobs that use crp_scope_entries
            try:
                import pandas as pd
                crp_df = _portal_load_crp_entries(con, job_ids)
                if crp_df is not None and not crp_df.empty:
                    if scope_df is None or scope_df.empty:
                        scope_df = crp_df
                    else:
                        scope_df = pd.concat([scope_df, crp_df], ignore_index=True)
            except Exception as exc:
                logger.exception(
                    "portal_reporting_data: crp entries load failed client_db_id=%s", client_db_id,
                )

            if scope_df is None or scope_df.empty:
                avail = sorted({_portal_safe_year(y) for y in jobs_df["dashboard_year"].dropna().unique() if _portal_safe_year(y)})
                return {**empty_resp, "years": avail}

            resolver_cache: dict[int, Any] = {}
            emissions_vals: list[float] = []
            for _, row in scope_df.iterrows():
                row_type = str(row.get("record_type") or "legacy").strip().lower()
                if row_type == "source_register":
                    metrics = combined_row_metrics(row)
                else:
                    row_job_id = int(row.get("job_id"))
                    resolver = resolver_cache.get(row_job_id)
                    if resolver is None:
                        resolver = JobMonthlyEmissionsResolver(con, row_job_id)
                        resolver_cache[row_job_id] = resolver
                    metrics = combined_row_metrics(row, resolver)
                emissions_vals.append(round(float(metrics.get("calc_tco2e") or 0.0), 2))

            scope_df = scope_df.copy()
            scope_df["emissions"] = emissions_vals
            scope_df["scope"] = scope_df["scope"].apply(lambda v: _portal_clean_label(v, "Unknown"))
            scope_df["dataset_category"] = scope_df.apply(lambda r: _portal_category_label(r), axis=1)
            scope_df["category"] = scope_df["dataset_category"]
            scope_df["site_name"] = scope_df["site_name"].apply(lambda v: _portal_clean_label(v, "Unknown"))
            if "activity_name" in scope_df.columns:
                scope_df["activity_name"] = scope_df["activity_name"].apply(lambda v: _portal_clean_label(v, "Unknown"))
            else:
                scope_df["activity_name"] = scope_df["category"]

            years = sorted({_portal_safe_year(y) for y in scope_df["dashboard_year"].dropna().unique() if _portal_safe_year(y)})

            def _by_key(groups, key_col: str, yr: int) -> dict[str, Any]:
                yr_data: dict[str, Any] = {"year": yr}
                yr_rows = groups[groups["dashboard_year"] == yr]
                for _, r in yr_rows.iterrows():
                    yr_data[_portal_clean_label(r[key_col], "Unknown")] = round(float(r["emissions"]), 2)
                yr_data["total"] = round(float(yr_rows["emissions"].sum()), 2)
                return yr_data

            scope_groups = scope_df.groupby(["dashboard_year", "scope"])["emissions"].sum().reset_index()
            by_scope = [_by_key(scope_groups, "scope", yr) for yr in years]

            scat_groups = scope_df.groupby(["dashboard_year", "scope", "category"])["emissions"].sum().reset_index()
            by_scope_category: list[dict[str, Any]] = []
            for yr in years:
                yr_rows = scat_groups[scat_groups["dashboard_year"] == yr]
                scopes: dict[str, dict[str, float]] = {}
                for _, r in yr_rows.iterrows():
                    s = _portal_clean_label(r["scope"], "Unknown")
                    c = _portal_clean_label(r["category"], "Uncategorized")
                    if s not in scopes:
                        scopes[s] = {}
                    scopes[s][c] = round(float(r["emissions"]), 2)
                by_scope_category.append({"year": yr, "scopes": scopes})

            act_groups = scope_df.groupby(["dashboard_year", "category"])["emissions"].sum().reset_index()
            by_activity = [_by_key(act_groups, "category", yr) for yr in years]

            site_groups = scope_df.groupby(["dashboard_year", "site_name"])["emissions"].sum().reset_index()
            by_site = [_by_key(site_groups, "site_name", yr) for yr in years]

            detail_groups = scope_df.groupby(
                ["dashboard_year", "scope", "category", "activity_name"]
            )["emissions"].sum().reset_index()
            by_activity_detail: list[dict] = []
            for _, dr in detail_groups.iterrows():
                yr = _portal_safe_year(dr["dashboard_year"])
                if yr:
                    by_activity_detail.append({
                        "year": yr,
                        "scope": str(dr["scope"]),
                        "category": str(dr["category"]),
                        "activity": str(dr["activity_name"]),
                        "emissions": round(float(dr["emissions"]), 2),
                    })

            return {
                "client_db_id": client_db_id,
                "client_name": str(client_row[0] or ""),
                "years": years,
                "by_scope": by_scope,
                "by_scope_category": by_scope_category,
                "by_activity": by_activity,
                "by_site": by_site,
                "by_activity_detail": by_activity_detail,
            }


# ---------------------------------------------------------------------------
# Approval
# ---------------------------------------------------------------------------

class ApprovePayload(BaseModel):
    approver_name: str = Field(..., min_length=1)
    confirmed: bool = Field(...)


@router.post("/portal/jobs/{job_id}/approve")
def portal_approve_report(
    job_id: int,
    payload: ApprovePayload = Body(...),
    current_user: dict = Depends(portal_user_dep),
):
    if not payload.confirmed:
        raise HTTPException(status_code=400, detail="Approval confirmation is required")

    client_db_id = int(current_user["client_db_id"])
    with get_conn(autocommit=False) as con:
        _assert_job_belongs_to_client(job_id, client_db_id, con)
        review = approve_review(
            job_id,
            approver_name=payload.approver_name,
            approver_email=current_user["email"],
            con=con,
        )

    # Trigger PDF generation asynchronously
    _trigger_pdf_on_approval(job_id)

    # Notify CRM
    _notify_crm_approval(job_id, payload.approver_name, current_user["email"])

    return {"ok": True, "review": review}


def _trigger_pdf_on_approval(job_id: int) -> None:
    """Queue PDF generation after approval. Non-fatal if it fails."""
    try:
        from services.pdf_generation_queue import queue_pdf_generation
        queue_pdf_generation(job_id)
    except Exception:
        try:
            # Fallback to synchronous generation
            from api.job_report_routes import _generate_professional_pdf_impl
            _generate_professional_pdf_impl(
                job_id=job_id,
                save_version=True,
                report_version_status="final",
                report_version_label="Approved",
                report_version_notes="Generated on client approval via NZInsights portal",
                current_user={"email": "portal-approval", "user_id": "portal-approval"},
            )
            mark_pdf_generated(job_id)
        except Exception:
            pass


def _notify_crm_approval(job_id: int, approver_name: str, approver_email: str) -> None:
    try:
        with get_conn() as con:
            row = con.execute(
                """
                SELECT j.job_number, j.title, u.email AS crm_email, u.full_name AS crm_name
                FROM jobs j
                LEFT JOIN users u ON u.user_id = j.assigned_user_id
                WHERE j.job_id = %s
                """,
                [int(job_id)],
            ).fetchone()
        if not row or not row[2]:
            return
        from services.outbound_email import send_tracked_email
        from services.messaging_templates import build_email_content
        job_ref = f"{row[0]} — {row[1]}" if row[0] else str(row[1] or f"Job {job_id}")
        crm_name = row[3] or "there"
        context = {
            "crm_name": crm_name,
            "approver_name": approver_name,
            "approver_email": approver_email,
            "job_ref": job_ref,
        }
        fallback_body = (
            f"<p>Hi {crm_name},</p>"
            f"<p><strong>{approver_name}</strong> ({approver_email}) has approved the report for <strong>{job_ref}</strong>.</p>"
            f"<p>PDF generation has been triggered and will be uploaded to the client files automatically.</p>"
        )
        with get_conn() as con:
            rendered = build_email_content(
                con=con,
                template_key="portal_report_approved",
                context=context,
                fallback_subject=f"Report approved: {job_ref}",
                fallback_body=fallback_body,
                sender_identifier="portal",
            )
            send_tracked_email(
                con,
                to_email=row[2],
                subject=rendered["subject"],
                body_text=rendered["body_text"],
                body_html=rendered["body_html"],
                template_key="portal_report_approved",
                entity_type="job",
                entity_id=str(job_id),
                job_id=job_id,
                created_by="portal",
            )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Status bar — broadcasts + action items for the portal header
# ---------------------------------------------------------------------------

@router.get("/portal/status-bar")
def portal_status_bar(current_user: dict = Depends(portal_user_dep)):
    """Return active broadcasts and derived action items for this client.

    Broadcasts: global rows + rows targeting this client, filtered by active window.
    Actions: derived from review state (open comments, reports awaiting review, etc.)
    """
    client_db_id = int(current_user["client_db_id"])
    now_sql = "NOW()"

    with get_conn() as con:
        # Active broadcasts (global + this client)
        broadcast_rows = con.execute(
            f"""
            SELECT broadcast_id, title, message, style, link_url, link_label, broadcast_type
            FROM portal_broadcasts
            WHERE is_active = TRUE
              AND (active_from IS NULL OR active_from <= {now_sql})
              AND (active_until IS NULL OR active_until >= {now_sql})
              AND (broadcast_type = 'global' OR target_client_db_id = %s)
            ORDER BY broadcast_type DESC, created_at DESC
            LIMIT 10
            """,
            [client_db_id],
        ).fetchall()

        # Action items: open client comments across all jobs
        comment_rows = con.execute(
            """
            SELECT rrc.comment_id, rr.job_id, j.job_number, j.title AS job_title,
                   COUNT(*) OVER (PARTITION BY rr.job_id) AS open_count
            FROM report_review_comments rrc
            JOIN report_reviews rr ON rr.review_id = rrc.review_id
            JOIN jobs j ON j.job_id = rr.job_id
            WHERE j.client_db_id = %s
              AND rrc.author_type = 'client'
              AND rrc.status = 'open'
            LIMIT 20
            """,
            [client_db_id],
        ).fetchall()

        # Action items: reports sent for review
        review_rows = con.execute(
            """
            SELECT rr.job_id, j.job_number, j.title AS job_title, rr.status,
                   rr.portal_version_id
            FROM report_reviews rr
            JOIN jobs j ON j.job_id = rr.job_id
            WHERE j.client_db_id = %s
              AND rr.status IN ('sent_for_review', 'changes_requested')
              AND rr.portal_version_id IS NOT NULL
            ORDER BY rr.sent_for_review_at DESC
            LIMIT 5
            """,
            [client_db_id],
        ).fetchall()

    broadcasts = [
        {
            "broadcast_id": int(r[0]),
            "title": str(r[1] or "") or None,
            "message": str(r[2] or ""),
            "style": str(r[3] or "info"),
            "link_url": str(r[4] or "") or None,
            "link_label": str(r[5] or "") or None,
            "broadcast_type": str(r[6] or "global"),
        }
        for r in (broadcast_rows or [])
    ]

    # Aggregate open comments by job
    job_comment_map: dict[int, dict] = {}
    for r in (comment_rows or []):
        jid = int(r[1])
        if jid not in job_comment_map:
            job_comment_map[jid] = {
                "job_id": jid,
                "job_number": str(r[2] or ""),
                "job_title": str(r[3] or ""),
                "open_count": int(r[4] or 0),
            }

    actions: list[dict[str, Any]] = []
    for jdata in job_comment_map.values():
        n = jdata["open_count"]
        ref = jdata["job_number"] or jdata["job_title"] or f"Job {jdata['job_id']}"
        actions.append({
            "type": "open_comments",
            "job_id": jdata["job_id"],
            "message": f"You have {n} open comment{'s' if n != 1 else ''} on {ref}",
            "href": f"/jobs/{jdata['job_id']}/review",
            "style": "warning",
        })

    for r in (review_rows or []):
        jid = int(r[0])
        if any(a.get("job_id") == jid and a.get("type") == "report_ready" for a in actions):
            continue
        ref = str(r[1] or "") or str(r[2] or "") or f"Job {jid}"
        actions.append({
            "type": "report_ready",
            "job_id": jid,
            "message": f"Your report for {ref} is ready to review",
            "href": f"/jobs/{jid}/view",
            "style": "info",
        })

    return {"ok": True, "broadcasts": broadcasts, "actions": actions}


# ---------------------------------------------------------------------------
# Actions — client portal action tracker
# ---------------------------------------------------------------------------

class _PortalUpdateActionPayload(_BaseModel):
    status: str | None = None
    progress: int | None = None
    note: str | None = None
    target_date: str | None = None
    owner_contact_id: int | None = None


class _PortalAddActionPayload(_BaseModel):
    action_name: str = _Field(..., min_length=1)
    description: str | None = None
    action_category: str | None = None
    action_term: str = "medium"
    scope_focus: str | None = None
    target_date: str | None = None
    owner_contact_id: int | None = None


@router.get("/portal/actions/library")
def portal_actions_library(current_user: dict = Depends(portal_user_dep)):
    """Return full active action library with 'already_added' flag for this client."""
    client_db_id = int(current_user["client_db_id"])
    with get_conn() as con:
        from services.report_actions import ensure_report_actions_schema
        ensure_report_actions_schema(con)

        existing_rows = con.execute(
            """
            SELECT DISTINCT a.action_option_id
            FROM job_report_actions a
            JOIN jobs j ON j.job_id = a.job_id
            WHERE j.client_db_id = %s
              AND a.action_option_id IS NOT NULL
              AND COALESCE(a.status, 'open') != 'cancelled'
            """,
            [client_db_id],
        ).fetchall()
        existing_ids = {int(r[0]) for r in (existing_rows or [])}

        rows = con.execute(
            """
            SELECT action_option_id, action_name, description,
                   action_term, action_category, scope_focus, sort_order
            FROM report_action_options
            WHERE COALESCE(is_active, TRUE) = TRUE
            ORDER BY sort_order ASC, action_name ASC
            """,
        ).fetchall()

        items = [
            {
                "action_option_id": int(r[0]),
                "action_name": str(r[1] or ""),
                "description": str(r[2] or "") or None,
                "action_term": str(r[3] or "medium"),
                "action_category": str(r[4] or "") or None,
                "scope_focus": str(r[5] or "") or None,
                "sort_order": int(r[6] or 0),
                "already_added": int(r[0]) in existing_ids,
            }
            for r in (rows or [])
        ]

    return {"ok": True, "items": items}


@router.post("/portal/actions/from-library")
def portal_add_action_from_library(
    body: dict = Body(...),
    current_user: dict = Depends(portal_user_dep),
):
    """Add a library action template to this client's plan."""
    from services.report_actions import ensure_report_actions_schema, list_job_report_actions, normalize_action_term

    action_option_id = body.get("action_option_id")
    if not action_option_id:
        raise HTTPException(status_code=400, detail="action_option_id is required")
    action_option_id = int(action_option_id)

    client_db_id = int(current_user["client_db_id"])
    actor = str(current_user.get("email") or current_user.get("full_name") or "portal")

    with get_conn(autocommit=False) as con:
        ensure_report_actions_schema(con)

        template = con.execute(
            """
            SELECT action_name, description, action_term, action_category, scope_focus
            FROM report_action_options
            WHERE action_option_id = %s AND COALESCE(is_active, TRUE) = TRUE
            """,
            [action_option_id],
        ).fetchone()
        if not template:
            raise HTTPException(status_code=404, detail="Action option not found")

        already = con.execute(
            """
            SELECT a.job_action_id FROM job_report_actions a
            JOIN jobs j ON j.job_id = a.job_id
            WHERE j.client_db_id = %s AND a.action_option_id = %s
              AND COALESCE(a.status, 'open') != 'cancelled'
            LIMIT 1
            """,
            [client_db_id, action_option_id],
        ).fetchone()
        if already:
            raise HTTPException(status_code=409, detail="This action is already in your plan")

        job_row = con.execute(
            """
            SELECT job_id FROM jobs WHERE client_db_id = %s
            ORDER BY reporting_year DESC NULLS LAST, job_id DESC LIMIT 1
            """,
            [client_db_id],
        ).fetchone()
        if not job_row:
            raise HTTPException(status_code=400, detail="No job found for this client")
        job_id = int(job_row[0])

        action_term = normalize_action_term(template[2] or "medium")
        max_row = con.execute(
            "SELECT COALESCE(MAX(sort_order), 0) FROM job_report_actions WHERE job_id = %s",
            [job_id],
        ).fetchone()
        sort_order = int(max_row[0] or 0) + 10

        new_row = con.execute(
            """
            INSERT INTO job_report_actions
              (job_id, action_option_id, action_name, description, action_term,
               action_category, scope_focus, is_custom, sort_order, status, progress,
               created_by, updated_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, FALSE, %s, 'open', 0, %s, %s)
            RETURNING job_action_id
            """,
            [
                job_id, action_option_id,
                str(template[0] or ""),
                str(template[1] or "") or None,
                action_term,
                str(template[3] or "") or None,
                str(template[4] or "") or None,
                sort_order,
                actor, actor,
            ],
        ).fetchone()
        new_action_id = int(new_row[0])

        con.execute(
            """
            INSERT INTO job_report_action_updates
              (job_action_id, changed_by, source, old_status, new_status, old_progress, new_progress, note)
            VALUES (%s, %s, 'portal', NULL, 'open', NULL, 0, 'Added from library via client portal')
            """,
            [new_action_id, actor],
        )

    rows = list_job_report_actions(job_id)
    for r in rows:
        if int(r["job_action_id"]) == new_action_id:
            return {"ok": True, "item": r}
    raise HTTPException(status_code=500, detail="Created action could not be reloaded")


@router.get("/portal/actions/contacts")
def portal_action_contacts(current_user: dict = Depends(portal_user_dep)):
    """Return client contacts for the owner dropdown."""
    client_db_id = int(current_user["client_db_id"])
    with get_conn() as con:
        rows = con.execute(
            """
            SELECT contact_id, full_name, job_title, email
            FROM client_contacts
            WHERE client_db_id = %s
            ORDER BY full_name ASC
            """,
            [client_db_id],
        ).fetchall()
    return {
        "ok": True,
        "contacts": [
            {
                "contact_id": int(r[0]),
                "full_name": str(r[1] or ""),
                "job_title": str(r[2] or "") or None,
                "email": str(r[3] or "") or None,
            }
            for r in (rows or [])
        ],
    }


@router.get("/portal/actions/categories")
def portal_action_categories(current_user: dict = Depends(portal_user_dep)):
    """Return active action categories for the category dropdown."""
    with get_conn() as con:
        from services.report_actions import ensure_report_actions_schema
        ensure_report_actions_schema(con)
        rows = con.execute(
            "SELECT category_id, name FROM action_categories_lookup WHERE is_active = TRUE ORDER BY name ASC",
        ).fetchall()
    return {
        "ok": True,
        "categories": [{"category_id": int(r[0]), "name": str(r[1] or "")} for r in (rows or [])],
    }


@router.get("/portal/actions")
def portal_list_actions(current_user: dict = Depends(portal_user_dep)):
    """Return all actions for this client across all their jobs."""
    client_db_id = int(current_user["client_db_id"])
    with get_conn() as con:
        from services.report_actions import ensure_report_actions_schema
        ensure_report_actions_schema(con)
        rows = con.execute(
            """
            SELECT
                a.job_action_id,
                a.job_id,
                j.reporting_year,
                j.title           AS job_title,
                a.action_name,
                a.description,
                a.action_term,
                a.action_category,
                a.scope_focus,
                a.is_custom,
                COALESCE(a.status, 'open')  AS status,
                COALESCE(a.progress, 0)     AS progress,
                a.target_date,
                a.completed_at,
                a.owner_contact_id,
                cc.full_name                AS owner_name,
                a.created_at,
                a.updated_at
            FROM job_report_actions a
            JOIN jobs j ON j.job_id = a.job_id
            LEFT JOIN client_contacts cc ON cc.contact_id = a.owner_contact_id
            WHERE j.client_db_id = %s
            ORDER BY
                CASE COALESCE(a.status, 'open')
                    WHEN 'in_progress' THEN 1
                    WHEN 'open'        THEN 2
                    WHEN 'completed'   THEN 3
                    WHEN 'cancelled'   THEN 4
                    ELSE 5
                END,
                a.sort_order ASC, a.action_name ASC
            """,
            [client_db_id],
        ).fetchall()

        items = []
        for r in rows or []:
            items.append({
                "job_action_id": int(r[0]),
                "job_id": int(r[1]),
                "reporting_year": int(r[2]) if r[2] is not None else None,
                "job_title": str(r[3] or ""),
                "action_name": str(r[4] or ""),
                "description": str(r[5] or "") or None,
                "action_term": str(r[6] or "medium"),
                "action_category": str(r[7] or "") or None,
                "scope_focus": str(r[8] or "") or None,
                "is_custom": bool(r[9]),
                "status": str(r[10] or "open"),
                "progress": int(r[11] or 0),
                "target_date": str(r[12]) if r[12] is not None else None,
                "completed_at": str(r[13]) if r[13] is not None else None,
                "owner_contact_id": int(r[14]) if r[14] is not None else None,
                "owner_name": str(r[15] or "") or None,
                "created_at": str(r[16]) if r[16] is not None else None,
                "updated_at": str(r[17]) if r[17] is not None else None,
            })

    return {"ok": True, "items": items}


@router.patch("/portal/actions/{job_action_id}")
def portal_update_action(
    job_action_id: int,
    payload: _PortalUpdateActionPayload = Body(...),
    current_user: dict = Depends(portal_user_dep),
):
    """Update progress/status/note on an action owned by this client."""
    from services.report_actions import update_job_action

    client_db_id = int(current_user["client_db_id"])
    with get_conn() as con:
        row = con.execute(
            """
            SELECT j.job_id FROM job_report_actions a
            JOIN jobs j ON j.job_id = a.job_id
            WHERE a.job_action_id = %s AND j.client_db_id = %s
            """,
            [int(job_action_id), client_db_id],
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Action not found")
        job_id = int(row[0])

    actor = str(current_user.get("email") or current_user.get("full_name") or "portal")
    item = update_job_action(
        job_id,
        int(job_action_id),
        payload=payload.model_dump(exclude_unset=True),
        actor=actor,
        source="portal",
    )
    return {"ok": True, "item": item}


@router.post("/portal/actions")
def portal_add_action(
    payload: _PortalAddActionPayload = Body(...),
    current_user: dict = Depends(portal_user_dep),
):
    """Add a new custom action for this client, assigned to their most recent job."""
    from services.report_actions import ensure_report_actions_schema, list_job_report_actions, normalize_action_term

    client_db_id = int(current_user["client_db_id"])
    actor = str(current_user.get("email") or current_user.get("full_name") or "portal")

    with get_conn(autocommit=False) as con:
        ensure_report_actions_schema(con)

        job_row = con.execute(
            """
            SELECT job_id FROM jobs WHERE client_db_id = %s
            ORDER BY reporting_year DESC NULLS LAST, job_id DESC LIMIT 1
            """,
            [client_db_id],
        ).fetchone()
        if not job_row:
            raise HTTPException(status_code=400, detail="No job found for this client")
        job_id = int(job_row[0])

        action_term = normalize_action_term(payload.action_term or "medium")
        max_row = con.execute(
            "SELECT COALESCE(MAX(sort_order), 0) FROM job_report_actions WHERE job_id = %s",
            [job_id],
        ).fetchone()
        sort_order = int(max_row[0] or 0) + 10

        new_row = con.execute(
            """
            INSERT INTO job_report_actions
              (job_id, action_name, description, action_term, action_category, scope_focus,
               is_custom, sort_order, status, progress, target_date, owner_contact_id,
               created_by, updated_by)
            VALUES (%s, %s, %s, %s, %s, %s, TRUE, %s, 'open', 0, %s, %s, %s, %s)
            RETURNING job_action_id
            """,
            [
                job_id,
                payload.action_name.strip(),
                str(payload.description or "").strip() or None,
                action_term,
                str(payload.action_category or "").strip() or None,
                str(payload.scope_focus or "").strip() or None,
                sort_order,
                str(payload.target_date or "").strip() or None,
                int(payload.owner_contact_id) if payload.owner_contact_id else None,
                actor, actor,
            ],
        ).fetchone()
        new_action_id = int(new_row[0])

        con.execute(
            """
            INSERT INTO job_report_action_updates
              (job_action_id, changed_by, source, old_status, new_status, old_progress, new_progress, note)
            VALUES (%s, %s, 'portal', NULL, 'open', NULL, 0, 'Action created via client portal')
            """,
            [new_action_id, actor],
        )

    rows = list_job_report_actions(job_id)
    for r in rows:
        if int(r["job_action_id"]) == new_action_id:
            return {"ok": True, "item": r}
    raise HTTPException(status_code=500, detail="Created action could not be reloaded")


# ── Insights ──────────────────────────────────────────────────────────────────


@router.get("/portal/insights/widget-pngs")
def portal_insights_widget_pngs(
    year: int | None = None,
    current_user: dict = Depends(portal_user_dep),
):
    """Return stored widget PNGs for the client's job in the specified year."""
    client_db_id = int(current_user["client_db_id"])
    with get_conn() as con:
        jobs_df = _portal_load_jobs(con, client_db_id)
        if jobs_df.empty:
            return {
                "ok": True, "year": year, "job_id": None,
                "available_years": [], "pngs": {}, "captured_at": None,
            }

        available_years = sorted(
            int(y) for y in jobs_df["dashboard_year"].dropna().unique()
        )

        selected_year = year or (max(available_years) if available_years else None)

        job_row = None
        if selected_year is not None:
            yr_rows = jobs_df[jobs_df["dashboard_year"] == selected_year]
            if not yr_rows.empty:
                job_row = yr_rows.iloc[-1]
        if job_row is None and not jobs_df.empty:
            job_row = jobs_df.iloc[-1]

        job_id = int(job_row["job_id"]) if job_row is not None else None
        if job_id is None:
            return {
                "ok": True, "year": selected_year, "job_id": None,
                "available_years": available_years, "pngs": {}, "captured_at": None,
            }

        try:
            rows = con.execute(
                "SELECT widget_id, png_data, captured_at FROM job_widget_pngs WHERE job_id = %s",
                [job_id],
            ).fetchall()
        except Exception:
            rows = []

        pngs = {r[0]: r[1] for r in rows} if rows else {}
        captured_at = str(rows[0][2]) if rows else None

    return {
        "ok": True,
        "year": selected_year,
        "job_id": job_id,
        "available_years": available_years,
        "pngs": pngs,
        "captured_at": captured_at,
    }


# ---------------------------------------------------------------------------
# Files — read-only view of job files uploaded by NZI
# ---------------------------------------------------------------------------

@router.get("/portal/files")
def portal_files(current_user: dict = Depends(portal_user_dep)):
    """Return all files attached to this client's jobs (read-only, no upload)."""
    client_db_id = int(current_user["client_db_id"])
    with get_conn() as con:
        # Ensure portal visibility columns exist (may not be present on older deployments)
        for _stmt in [
            "ALTER TABLE job_files ADD COLUMN IF NOT EXISTS portal_visible BOOLEAN DEFAULT FALSE",
            "ALTER TABLE job_files ADD COLUMN IF NOT EXISTS portal_description TEXT",
            "ALTER TABLE job_files ADD COLUMN IF NOT EXISTS portal_expires_at TIMESTAMP",
        ]:
            try:
                con.execute(_stmt)
            except Exception:
                pass

        rows = con.execute(
            """
            SELECT
                jf.file_id,
                jf.job_id,
                j.reporting_year,
                j.title         AS job_title,
                jf.file_name,
                jf.file_type,
                COALESCE(jf.portal_description, jf.description) AS description,
                jf.file_size,
                jf.storage_provider,
                jf.uploaded_at,
                j.job_number
            FROM job_files jf
            JOIN jobs j ON j.job_id = jf.job_id
            WHERE j.client_db_id = %s
              AND jf.portal_visible = TRUE
              AND (jf.portal_expires_at IS NULL OR jf.portal_expires_at > NOW())
            ORDER BY jf.uploaded_at DESC NULLS LAST
            """,
            [client_db_id],
        ).fetchall()

    def _dt(v):
        try:
            return v.isoformat() if v else None
        except Exception:
            return str(v) if v else None

    return {
        "ok": True,
        "files": [
            {
                "file_id": int(r[0]),
                "job_id": int(r[1]),
                "reporting_year": int(r[2]) if r[2] is not None else None,
                "job_title": str(r[3] or ""),
                "file_name": str(r[4] or ""),
                "file_type": str(r[5] or ""),
                "description": str(r[6] or "") or None,
                "file_size": int(r[7]) if r[7] is not None else None,
                "storage_provider": str(r[8] or "local"),
                "uploaded_at": _dt(r[9]),
                "job_number": str(r[10] or ""),
            }
            for r in (rows or [])
        ],
    }


@router.get("/portal/files/{file_id}/download")
def portal_file_download(file_id: int, current_user: dict = Depends(portal_user_dep)):
    """Proxy file download through the server — never redirect to SharePoint directly."""
    import io as _io
    import pathlib as _pathlib
    import urllib.parse as _urlparse
    from fastapi.responses import Response as _Response, StreamingResponse as _StreamingResponse
    from api.onedrive_routes import _graph_token, _drive_base_path, _graph_download

    client_db_id = int(current_user["client_db_id"])
    with get_conn() as con:
        row = con.execute(
            """
            SELECT jf.file_id, jf.file_name, jf.file_path, jf.external_item_id,
                   jf.storage_provider, jf.mime_type
            FROM job_files jf
            JOIN jobs j ON j.job_id = jf.job_id
            WHERE jf.file_id = %s AND j.client_db_id = %s
            """,
            [file_id, client_db_id],
        ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="File not found")

    file_name      = str(row[1] or "download")
    local_path     = str(row[2] or "").strip()
    item_id        = str(row[3] or "").strip()
    storage        = str(row[4] or "local")
    mime           = str(row[5] or "application/octet-stream")

    if storage == "onedrive":
        if not item_id:
            raise HTTPException(status_code=404, detail="External file ID missing")
        token = _graph_token()
        drive_base = _drive_base_path(token)
        content, content_type = _graph_download(
            f"{drive_base}/items/{_urlparse.quote(item_id)}/content",
            token,
        )
        return _StreamingResponse(
            _io.BytesIO(content),
            media_type=content_type or mime,
            headers={"Content-Disposition": f'attachment; filename="{file_name}"'},
        )

    p = _pathlib.Path(local_path)
    if not local_path or not p.exists():
        raise HTTPException(status_code=404, detail="File not found on server")

    return _Response(
        content=p.read_bytes(),
        media_type=mime,
        headers={"Content-Disposition": f'attachment; filename="{file_name}"'},
    )
