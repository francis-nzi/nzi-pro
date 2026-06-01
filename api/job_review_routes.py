"""CRM-side review management routes.

These routes are protected by standard NZI staff auth and allow CRMs to:
- View and manage client portal users per client
- Send a report for client review
- Respond to or dismiss client comments
- View the current review status of any job
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field

from api.auth import _current_user
from api.permissions import assert_job_access, assert_permission, assert_client_access
from core.database import get_conn
from services.portal import (
    add_comment,
    create_portal_user,
    ensure_portal_schema,
    get_or_create_review,
    list_comments,
    list_portal_users,
    respond_to_comment,
    send_review_to_client,
    update_portal_user,
    set_portal_user_password,
)
from services.outbound_email import send_tracked_email

router = APIRouter(tags=["job-review"])
logger = logging.getLogger(__name__)


def _actor(user: dict) -> str:
    return str(user.get("email") or user.get("user_id") or "system").strip()


# ---------------------------------------------------------------------------
# Portal user management (admin creates accounts per client)
# ---------------------------------------------------------------------------

class CreatePortalUserPayload(BaseModel):
    email: str = Field(..., min_length=1)
    full_name: str = Field(..., min_length=1)
    password: str = Field(..., min_length=8)
    contact_id: int | None = None


class UpdatePortalUserPayload(BaseModel):
    full_name: str | None = None
    is_active: bool | None = None


class ResetPortalPasswordPayload(BaseModel):
    new_password: str = Field(..., min_length=8)


@router.get("/clients/{client_db_id}/portal-users")
def list_client_portal_users(
    client_db_id: int,
    _user: dict = Depends(_current_user),
):
    assert_client_access(_user, int(client_db_id))
    return {"ok": True, "items": list_portal_users(int(client_db_id))}


@router.post("/clients/{client_db_id}/portal-users")
def create_client_portal_user(
    client_db_id: int,
    payload: CreatePortalUserPayload = Body(...),
    _user: dict = Depends(_current_user),
):
    assert_permission(_user, "jobs.edit")
    assert_client_access(_user, int(client_db_id))

    # Verify contact belongs to this client if provided
    if payload.contact_id is not None:
        with get_conn() as con:
            row = con.execute(
                "SELECT contact_id FROM client_contacts WHERE contact_id = %s AND client_db_id = %s",
                [int(payload.contact_id), int(client_db_id)],
            ).fetchone()
            if not row:
                raise HTTPException(status_code=400, detail="Contact not found on this client")

    user = create_portal_user(
        client_db_id=int(client_db_id),
        email=payload.email,
        full_name=payload.full_name,
        password=payload.password,
        contact_id=payload.contact_id,
        created_by=_actor(_user),
    )

    # Send welcome email with login URL
    _send_welcome_email(user)

    return {"ok": True, "item": user}


@router.patch("/clients/{client_db_id}/portal-users/{portal_user_id}")
def update_client_portal_user(
    client_db_id: int,
    portal_user_id: int,
    payload: UpdatePortalUserPayload = Body(...),
    _user: dict = Depends(_current_user),
):
    assert_permission(_user, "jobs.edit")
    assert_client_access(_user, int(client_db_id))
    # Verify ownership
    with get_conn() as con:
        ensure_portal_schema(con)
        row = con.execute(
            "SELECT client_db_id FROM client_portal_users WHERE portal_user_id = %s",
            [int(portal_user_id)],
        ).fetchone()
    if not row or int(row[0]) != int(client_db_id):
        raise HTTPException(status_code=404, detail="Portal user not found")

    updated = update_portal_user(
        int(portal_user_id),
        full_name=payload.full_name,
        is_active=payload.is_active,
    )
    return {"ok": True, "item": updated}


@router.post("/clients/{client_db_id}/portal-users/{portal_user_id}/reset-password")
def reset_portal_user_password(
    client_db_id: int,
    portal_user_id: int,
    payload: ResetPortalPasswordPayload = Body(...),
    _user: dict = Depends(_current_user),
):
    assert_permission(_user, "jobs.edit")
    assert_client_access(_user, int(client_db_id))
    with get_conn() as con:
        ensure_portal_schema(con)
        row = con.execute(
            "SELECT client_db_id FROM client_portal_users WHERE portal_user_id = %s",
            [int(portal_user_id)],
        ).fetchone()
    if not row or int(row[0]) != int(client_db_id):
        raise HTTPException(status_code=404, detail="Portal user not found")
    set_portal_user_password(int(portal_user_id), payload.new_password)
    return {"ok": True}


def _send_welcome_email(portal_user: dict) -> None:
    from api.portal_auth_routes import _portal_base_url
    try:
        send_tracked_email(
            to_email=portal_user["email"],
            subject="Welcome to NZInsights — your carbon reporting portal",
            body_text=(
                f"Hi {portal_user['full_name']},\n\n"
                f"Your NZInsights account is ready. You can log in at:\n\n"
                f"{_portal_base_url()}/login\n\n"
                f"Use your email address and the password provided to you by your NZI contact.\n\n"
                f"NZInsights gives you secure access to your carbon reports and allows you to review and approve them online."
            ),
            body_html=(
                f"<p>Hi {portal_user['full_name']},</p>"
                f"<p>Your NZInsights account is ready.</p>"
                f"<p><a href='{_portal_base_url()}/login'>Log in to NZInsights</a></p>"
                f"<p>Use your email address and the password provided to you by your NZI contact.</p>"
            ),
            template_key="portal_welcome",
            entity_type="portal_user",
            entity_id=str(portal_user["portal_user_id"]),
            created_by="portal-admin",
        )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Review status for a job
# ---------------------------------------------------------------------------

@router.get("/jobs/{job_id}/review")
def get_job_review(
    job_id: int,
    _user: dict = Depends(_current_user),
):
    assert_job_access(_user, int(job_id))
    with get_conn() as con:
        review = get_or_create_review(int(job_id), con=con)
        comments = list_comments(review["review_id"], con=con)

        # Fetch portal users for this job's client
        row = con.execute("SELECT client_db_id FROM jobs WHERE job_id = %s", [int(job_id)]).fetchone()
        portal_users = list_portal_users(int(row[0]), con=con) if row else []

    open_count = sum(1 for c in comments if c["status"] == "open")
    return {
        "ok": True,
        "review": review,
        "comments": comments,
        "open_count": open_count,
        "portal_users": portal_users,
    }


# ---------------------------------------------------------------------------
# Send report for client review
# ---------------------------------------------------------------------------

@router.post("/jobs/{job_id}/review/send")
def send_job_for_review(
    job_id: int,
    _user: dict = Depends(_current_user),
):
    assert_permission(_user, "jobs.edit")
    assert_job_access(_user, int(job_id))

    actor = _actor(_user)
    with get_conn(autocommit=False) as con:
        review = send_review_to_client(int(job_id), actor, con=con)
        portal_users = _get_active_portal_users_for_job(int(job_id), con=con)
        job_row = con.execute(
            "SELECT job_number, title FROM jobs WHERE job_id = %s", [int(job_id)]
        ).fetchone()

    job_ref = f"{job_row[0]} — {job_row[1]}" if job_row and job_row[0] else (str(job_row[1]) if job_row else f"Job {job_id}")

    for pu in portal_users:
        _notify_client_review_ready(pu, job_ref, int(job_id))

    # Auto-generate an HTML snapshot so the portal can serve it for review.
    # Best-effort: if it fails the review notification has already been sent.
    try:
        from api.job_report_routes import generate_html_report
        generate_html_report(
            job_id=int(job_id),
            template_id=None,
            version_id=None,
            save_version=True,
            report_version_status="review",
            report_version_label="For Client Review",
            _user=_user,
        )
    except Exception:
        import logging as _logging
        _logging.getLogger(__name__).exception(
            "send_job_for_review: failed to auto-save review snapshot for job %s", job_id
        )

    return {"ok": True, "review": review, "notified_count": len(portal_users)}


@router.post("/jobs/{job_id}/review/generate-snapshot")
def generate_review_snapshot(
    job_id: int,
    _user: dict = Depends(_current_user),
):
    """Generate (or refresh) the portal HTML snapshot for this job without re-sending the client notification."""
    assert_permission(_user, "jobs.edit")
    assert_job_access(_user, int(job_id))

    try:
        from api.job_report_routes import generate_html_report

        generate_html_report(
            job_id=int(job_id),
            template_id=None,
            version_id=None,
            save_version=True,
            report_version_status="review",
            report_version_label="For Client Review",
            _user=_user,
        )
        logger.info("generate_review_snapshot: completed for job %s", job_id)
        return {
            "ok": True,
            "message": "Report snapshot refreshed and is now available in the portal.",
        }
    except Exception:
        logger.exception("generate_review_snapshot: failed for job %s", job_id)
        raise HTTPException(
            status_code=500,
            detail="Failed to refresh the portal snapshot. Please try again.",
        )


def _get_active_portal_users_for_job(job_id: int, con) -> list[dict]:
    row = con.execute("SELECT client_db_id FROM jobs WHERE job_id = %s", [int(job_id)]).fetchone()
    if not row:
        return []
    return [u for u in list_portal_users(int(row[0]), con=con) if u.get("is_active")]


def _notify_client_review_ready(portal_user: dict, job_ref: str, job_id: int) -> None:
    from api.portal_auth_routes import _portal_base_url
    try:
        review_url = f"{_portal_base_url()}/jobs/{job_id}/review"
        send_tracked_email(
            to_email=portal_user["email"],
            subject=f"Your report is ready to review — {job_ref}",
            body_text=(
                f"Hi {portal_user['full_name']},\n\n"
                f"Your carbon report for {job_ref} is now ready for your review in NZInsights.\n\n"
                f"Review it here: {review_url}\n\n"
                f"You can read the report, leave comments or change requests, and approve it when you are happy."
            ),
            body_html=(
                f"<p>Hi {portal_user['full_name']},</p>"
                f"<p>Your carbon report for <strong>{job_ref}</strong> is now ready for your review in NZInsights.</p>"
                f"<p><a href='{review_url}'>Review your report</a></p>"
                f"<p>You can read the report, leave comments or change requests, and approve it when you are happy.</p>"
            ),
            template_key="portal_review_ready",
            entity_type="job",
            entity_id=str(job_id),
            job_id=job_id,
            created_by="portal",
        )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# CRM responds to a comment
# ---------------------------------------------------------------------------

class RespondCommentPayload(BaseModel):
    status: str = Field(..., pattern="^(addressed|dismissed)$")
    crm_response: str | None = None


@router.patch("/jobs/{job_id}/review/comments/{comment_id}")
def crm_respond_to_comment(
    job_id: int,
    comment_id: int,
    payload: RespondCommentPayload = Body(...),
    _user: dict = Depends(_current_user),
):
    assert_permission(_user, "jobs.edit")
    assert_job_access(_user, int(job_id))

    actor = _actor(_user)
    with get_conn(autocommit=False) as con:
        # Verify comment belongs to this job's review
        row = con.execute(
            """
            SELECT rrc.comment_id, rr.job_id
            FROM report_review_comments rrc
            JOIN report_reviews rr ON rr.review_id = rrc.review_id
            WHERE rrc.comment_id = %s
            """,
            [int(comment_id)],
        ).fetchone()
        if not row or int(row[1]) != int(job_id):
            raise HTTPException(status_code=404, detail="Comment not found for this job")

        updated = respond_to_comment(
            int(comment_id),
            new_status=payload.status,
            crm_response=payload.crm_response,
            addressed_by=actor,
            con=con,
        )

        # Notify client if all comments are now resolved
        review = get_or_create_review(int(job_id), con=con)
        open_count = sum(1 for c in list_comments(review["review_id"], con=con) if c["status"] == "open")

    if open_count == 0:
        _notify_client_all_resolved(int(job_id))

    return {"ok": True, "comment": updated}


def _notify_client_all_resolved(job_id: int) -> None:
    from api.portal_auth_routes import _portal_base_url
    try:
        with get_conn() as con:
            job_row = con.execute(
                "SELECT job_number, title FROM jobs WHERE job_id = %s", [int(job_id)]
            ).fetchone()
            portal_users = _get_active_portal_users_for_job(job_id, con=con)
        if not portal_users or not job_row:
            return
        job_ref = f"{job_row[0]} — {job_row[1]}" if job_row[0] else str(job_row[1] or f"Job {job_id}")
        review_url = f"{_portal_base_url()}/jobs/{job_id}/review"
        for pu in portal_users:
            send_tracked_email(
                to_email=pu["email"],
                subject=f"Your comments have been addressed — {job_ref}",
                body_text=(
                    f"Hi {pu['full_name']},\n\n"
                    f"All your comments on {job_ref} have been addressed.\n\n"
                    f"Log in to NZInsights to review the responses and approve your report when happy:\n{review_url}"
                ),
                body_html=(
                    f"<p>Hi {pu['full_name']},</p>"
                    f"<p>All your comments on <strong>{job_ref}</strong> have been addressed.</p>"
                    f"<p><a href='{review_url}'>Log in to review and approve</a></p>"
                ),
                template_key="portal_comments_addressed",
                entity_type="job",
                entity_id=str(job_id),
                job_id=job_id,
                created_by="portal",
            )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# CRM adds an internal note to the review thread
# ---------------------------------------------------------------------------

class CrmNotePayload(BaseModel):
    comment_text: str = Field(..., min_length=1)
    section_reference: str | None = None


@router.post("/jobs/{job_id}/review/comments")
def crm_add_note(
    job_id: int,
    payload: CrmNotePayload = Body(...),
    _user: dict = Depends(_current_user),
):
    assert_permission(_user, "jobs.edit")
    assert_job_access(_user, int(job_id))
    actor = _actor(_user)
    name = str(_user.get("full_name") or actor)

    with get_conn(autocommit=False) as con:
        review = get_or_create_review(int(job_id), con=con)
        comment = add_comment(
            review["review_id"],
            author_type="crm",
            author_name=name,
            author_email=actor,
            comment_text=payload.comment_text,
            section_reference=payload.section_reference,
            con=con,
        )
    return {"ok": True, "comment": comment}
