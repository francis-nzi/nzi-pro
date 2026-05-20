"""Client portal data routes — protected by portal JWT.

All routes verify the portal JWT via _portal_user dependency and then
enforce client_db_id ownership so a client can only access their own data.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from api.portal_auth_routes import portal_user_dep
from core.database import get_conn
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
# Report HTML — reuse existing render, scoped to portal client
# ---------------------------------------------------------------------------

@router.get("/portal/jobs/{job_id}/report-html", response_class=HTMLResponse)
def portal_report_html(job_id: int, current_user: dict = Depends(portal_user_dep)):
    client_db_id = int(current_user["client_db_id"])
    with get_conn() as con:
        _assert_job_belongs_to_client(job_id, client_db_id, con)

    # Delegate to the existing report render (which does its own DB access)
    from api.job_report_routes import generate_html_report
    from fastapi import Request
    from starlette.datastructures import QueryParams

    class _MockRequest:
        query_params = QueryParams("")

    try:
        response = generate_html_report(int(job_id), request=_MockRequest())
        if hasattr(response, "body"):
            return HTMLResponse(content=response.body.decode("utf-8"), status_code=200)
        return response
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Report render failed: {exc}") from exc


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
        job_ref = f"{row[0]} — {row[1]}" if row[0] else str(row[1] or f"Job {job_id}")
        send_tracked_email(
            to_email=row[2],
            subject=f"New client comment on {job_ref}",
            body_text=(
                f"Hi {row[3] or 'there'},\n\n"
                f"{client_name} has added a comment to {job_ref} in NZInsights.\n\n"
                f"Log in to the NZI app to review and respond."
            ),
            body_html=(
                f"<p>Hi {row[3] or 'there'},</p>"
                f"<p><strong>{client_name}</strong> has added a comment to <strong>{job_ref}</strong> in NZInsights.</p>"
                f"<p>Log in to the NZI app to review and respond.</p>"
            ),
            template_key="portal_client_commented",
            entity_type="job",
            entity_id=str(job_id),
            job_id=job_id,
            created_by="portal",
        )
    except Exception:
        pass  # Non-fatal


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
        job_ref = f"{row[0]} — {row[1]}" if row[0] else str(row[1] or f"Job {job_id}")
        send_tracked_email(
            to_email=row[2],
            subject=f"Report approved: {job_ref}",
            body_text=(
                f"Hi {row[3] or 'there'},\n\n"
                f"{approver_name} ({approver_email}) has approved the report for {job_ref}.\n\n"
                f"PDF generation has been triggered and will be uploaded to the client files automatically."
            ),
            body_html=(
                f"<p>Hi {row[3] or 'there'},</p>"
                f"<p><strong>{approver_name}</strong> ({approver_email}) has approved the report for <strong>{job_ref}</strong>.</p>"
                f"<p>PDF generation has been triggered and will be uploaded to the client files automatically.</p>"
            ),
            template_key="portal_report_approved",
            entity_type="job",
            entity_id=str(job_id),
            job_id=job_id,
            created_by="portal",
        )
    except Exception:
        pass
