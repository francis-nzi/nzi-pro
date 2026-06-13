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

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException
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
    mark_published,
    respond_to_comment,
    send_review_to_client,
    send_to_portal,
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


@router.get("/clients/{client_db_id}/portal-candidate-users")
def list_portal_candidate_users(
    client_db_id: int,
    _user: dict = Depends(_current_user),
):
    """Return client contacts + NZI team members as candidates for portal user creation."""
    assert_client_access(_user, int(client_db_id))
    with get_conn() as con:
        contact_rows = con.execute(
            """
            SELECT contact_id, full_name, email, job_title
            FROM client_contacts
            WHERE client_db_id = %s AND email IS NOT NULL AND TRIM(email) <> ''
            ORDER BY COALESCE(NULLIF(TRIM(full_name), ''), email)
            """,
            [int(client_db_id)],
        ).fetchall()
        team_rows = con.execute(
            """
            SELECT user_id, full_name, email
            FROM users
            WHERE COALESCE(status, 'Active') = 'Active'
              AND email IS NOT NULL AND TRIM(email) <> ''
            ORDER BY COALESCE(NULLIF(TRIM(full_name), ''), email)
            """
        ).fetchall()
    contacts = [
        {
            "contact_id": int(r[0]),
            "full_name": str(r[1] or "").strip() or None,
            "email": str(r[2]).strip(),
            "job_title": str(r[3] or "").strip() or None,
        }
        for r in contact_rows
    ]
    team = [
        {
            "user_id": str(r[0]),
            "full_name": str(r[1] or "").strip() or None,
            "email": str(r[2]).strip(),
        }
        for r in team_rows
    ]
    return {"ok": True, "contacts": contacts, "team": team}


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


@router.get("/clients/{client_db_id}/portal-history")
def get_client_portal_history(
    client_db_id: int,
    _user: dict = Depends(_current_user),
):
    """Return all jobs for this client that have been sent to the portal."""
    assert_client_access(_user, int(client_db_id))
    with get_conn() as con:
        rows = con.execute(
            """
            SELECT
                j.job_id,
                j.job_number,
                j.title          AS job_title,
                j.reporting_year,
                j.reporting_period_start,
                j.reporting_period_end,
                rr.status        AS review_status,
                rr.portal_version_id,
                rr.sent_for_review_at,
                rr.sent_by,
                rr.published_at,
                rr.published_by
            FROM jobs j
            JOIN report_reviews rr ON rr.job_id = j.job_id
            WHERE j.client_db_id = %s
              AND rr.portal_version_id IS NOT NULL
            ORDER BY j.reporting_year DESC NULLS LAST, j.job_id DESC
            """,
            [int(client_db_id)],
        ).fetchall()

    items = [
        {
            "job_id": int(r[0]),
            "job_number": str(r[1] or ""),
            "job_title": str(r[2] or ""),
            "reporting_year": int(r[3]) if r[3] is not None else None,
            "reporting_period_start": str(r[4]) if r[4] else None,
            "reporting_period_end": str(r[5]) if r[5] else None,
            "review_status": str(r[6] or ""),
            "portal_version_id": int(r[7]) if r[7] is not None else None,
            "sent_for_review_at": str(r[8]) if r[8] else None,
            "sent_by": str(r[9]) if r[9] else None,
            "published_at": str(r[10]) if r[10] else None,
            "published_by": str(r[11]) if r[11] else None,
        }
        for r in (rows or [])
    ]

    return {"ok": True, "items": items}


@router.get("/clients/{client_db_id}/portal-files")
def get_client_portal_files(
    client_db_id: int,
    _user: dict = Depends(_current_user),
):
    """Return all job files for this client across all jobs, with portal visibility settings."""
    assert_client_access(_user, int(client_db_id))
    with get_conn() as con:
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
                j.job_number,
                j.title           AS job_title,
                j.reporting_year,
                jf.file_type,
                jf.file_name,
                jf.file_size,
                jf.description,
                jf.uploaded_at,
                jf.portal_visible,
                jf.portal_description,
                jf.portal_expires_at
            FROM job_files jf
            JOIN jobs j ON j.job_id = jf.job_id
            WHERE j.client_db_id = %s
            ORDER BY j.reporting_year DESC NULLS LAST, j.job_id DESC, jf.uploaded_at DESC NULLS LAST
            """,
            [int(client_db_id)],
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
                "job_number": str(r[2] or ""),
                "job_title": str(r[3] or ""),
                "reporting_year": int(r[4]) if r[4] is not None else None,
                "file_type": str(r[5] or ""),
                "file_name": str(r[6] or ""),
                "file_size": int(r[7]) if r[7] is not None else None,
                "description": str(r[8] or "") or None,
                "uploaded_at": _dt(r[9]),
                "portal_visible": bool(r[10]) if r[10] is not None else False,
                "portal_description": str(r[11] or "") or None,
                "portal_expires_at": _dt(r[12]),
            }
            for r in (rows or [])
        ],
    }


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
        _cid = int(row[0]) if (row and row[0] is not None) else None
        portal_users = list_portal_users(_cid, con=con) if _cid is not None else []

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
    background_tasks: BackgroundTasks,
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

    # Queue snapshot generation so the portal can serve it for review.
    # Runs after this response is sent — chart generation takes 60-120 s.
    background_tasks.add_task(_bg_generate_review_snapshot, job_id=int(job_id), user=_user)

    return {"ok": True, "review": review, "notified_count": len(portal_users)}


def _bg_generate_review_snapshot(job_id: int, user: dict) -> None:
    """Background task: generates the full report (including charts) and saves to job_report_versions."""
    try:
        from api.job_report_routes import generate_html_report
        generate_html_report(
            job_id=int(job_id),
            template_id=None,
            version_id=None,
            save_version=True,
            report_version_status="review",
            report_version_label="For Client Review",
            _user=user,
        )
        logger.info("_bg_generate_review_snapshot: completed for job %s", job_id)
    except Exception:
        logger.exception("_bg_generate_review_snapshot: failed for job %s", job_id)


@router.post("/jobs/{job_id}/review/generate-snapshot")
def generate_review_snapshot(
    job_id: int,
    background_tasks: BackgroundTasks,
    _user: dict = Depends(_current_user),
):
    """Queue a portal HTML snapshot refresh for this job without re-sending the client notification.

    Chart generation can take 60-120 seconds, so the work runs in the background
    after this response is returned.  The portal will reflect the new snapshot
    once the background task completes.
    """
    assert_permission(_user, "jobs.edit")
    assert_job_access(_user, int(job_id))

    background_tasks.add_task(_bg_generate_review_snapshot, job_id=int(job_id), user=_user)
    logger.info("generate_review_snapshot: queued background snapshot for job %s", job_id)
    return {
        "ok": True,
        "message": "Snapshot generation started. The portal will be updated in a moment — please allow up to a minute then refresh the portal.",
    }


def _get_active_portal_users_for_job(job_id: int, con) -> list[dict]:
    row = con.execute("SELECT client_db_id FROM jobs WHERE job_id = %s", [int(job_id)]).fetchone()
    cid = int(row[0]) if (row and row[0] is not None) else None
    if cid is None:
        return []
    return [u for u in list_portal_users(cid, con=con) if u.get("is_active")]


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
# Portal status — single endpoint for the Portal Management page
# ---------------------------------------------------------------------------

@router.get("/jobs/{job_id}/portal-status")
def get_job_portal_status(
    job_id: int,
    _user: dict = Depends(_current_user),
):
    """Return a full status summary for the Client Portal Management page.

    Includes the review record, active portal users, captured widget PNGs,
    and the current portal snapshot version — everything the management page
    needs to show readiness and allow a one-click Send to Portal.
    """
    assert_job_access(_user, int(job_id))
    with get_conn() as con:
        ensure_portal_schema(con)

        review = get_or_create_review(int(job_id), con=con)

        client_row = con.execute(
            "SELECT client_db_id FROM jobs WHERE job_id = %s", [int(job_id)]
        ).fetchone()
        client_db_id_val = int(client_row[0]) if (client_row and client_row[0] is not None) else None
        portal_users = list_portal_users(client_db_id_val, con=con) if client_db_id_val is not None else []

        # Widget PNG metadata (IDs + timestamps, no image data)
        widget_pngs: list[dict] = []
        try:
            rows = con.execute(
                """
                SELECT widget_id, captured_at
                FROM job_widget_pngs
                WHERE job_id = %s
                ORDER BY widget_id
                """,
                [int(job_id)],
            ).fetchall()
            widget_pngs = [
                {
                    "widget_id": str(r[0]),
                    "captured_at": str(r[1]) if r[1] else None,
                }
                for r in (rows or [])
            ]
        except Exception:
            pass

        # Current portal snapshot version details
        portal_version = None
        pid = review.get("portal_version_id")
        if pid:
            vrow = con.execute(
                """
                SELECT report_version_id, version_number, version_label, status, generated_at
                FROM job_report_versions
                WHERE report_version_id = %s
                LIMIT 1
                """,
                [int(pid)],
            ).fetchone()
            if vrow:
                portal_version = {
                    "report_version_id": int(vrow[0]),
                    "version_number": int(vrow[1]) if vrow[1] is not None else None,
                    "version_label": str(vrow[2] or "") or None,
                    "status": str(vrow[3] or ""),
                    "created_at": str(vrow[4]) if vrow[4] else None,
                }

    captured_ids = {w["widget_id"] for w in widget_pngs}
    latest_capture = max(
        (w["captured_at"] for w in widget_pngs if w["captured_at"]),
        default=None,
    )

    return {
        "ok": True,
        "review": review,
        "portal_users": portal_users,
        "active_portal_users_count": sum(1 for u in portal_users if u.get("is_active")),
        "widget_pngs": widget_pngs,
        "widget_png_count": len(widget_pngs),
        "captured_widget_ids": sorted(captured_ids),
        "latest_capture_at": latest_capture,
        "portal_version": portal_version,
        "client_db_id": client_db_id_val,
    }


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


# ---------------------------------------------------------------------------
# Send to Portal — saves a frozen snapshot and makes it visible to the client
# ---------------------------------------------------------------------------

@router.post("/jobs/{job_id}/review/send-to-portal")
def send_job_to_portal(
    job_id: int,
    background_tasks: BackgroundTasks,
    _user: dict = Depends(_current_user),
):
    """Save a frozen JSON snapshot of the current report and send it to the client portal.

    This is the single controlled action by which the CRM makes a version of the
    report visible to the client.  The snapshot is generated synchronously (JSON only,
    no Playwright PDF) so it completes quickly.  An email notification is queued to
    active portal users after the response is sent.
    """
    assert_permission(_user, "jobs.edit")
    assert_job_access(_user, int(job_id))
    actor = _actor(_user)

    try:
        import hashlib as _hashlib
        import json as _json
        from datetime import datetime, timezone
        from api.job_live_report_routes import get_job_live_report_data
        from api.job_report_routes import (
            _get_job_assigned_template_selection,
            _ensure_report_versions_schema,
        )

        # Use the same full LiveData payload the portal viewer renders from.
        # This ensures every section (intensity metrics, activity charts,
        # yearly emissions, targets, actions, etc.) is present in the snapshot.
        snapshot_payload: dict[str, Any] = get_job_live_report_data(
            int(job_id), _user=_user
        )
        if not snapshot_payload:
            raise HTTPException(status_code=404, detail="Job not found")

        job_data = snapshot_payload.get("job_data") or {}
        org_id_val = str(job_data.get("org_id") or "").strip() or None
        client_db_id_val = int(job_data.get("client_db_id") or 0)
        template_selection = _get_job_assigned_template_selection(int(job_id))
        tmpl_id = int(template_selection["template_id"]) if template_selection and template_selection.get("template_id") is not None else None
        tmpl_ver_id = int(template_selection["version_id"]) if template_selection and template_selection.get("version_id") is not None else None

        snapshot_json = _json.dumps(snapshot_payload, ensure_ascii=False, sort_keys=True, default=str)
        data_hash = _hashlib.sha256(snapshot_json.encode()).hexdigest()

        with get_conn(autocommit=False) as con:
            _ensure_report_versions_schema(con)
            next_v_row = con.execute(
                "SELECT COALESCE(MAX(version_number), 0) + 1 FROM job_report_versions WHERE job_id = %s",
                [int(job_id)],
            ).fetchone()
            version_number = int(next_v_row[0]) if next_v_row else 1

            # Insert snapshot-only version (no PDF file — portal serves the JSON directly)
            version_row = con.execute(
                """
                INSERT INTO job_report_versions (
                    org_id, job_id, client_db_id, version_number, version_label, status,
                    report_format, template_id, version_id, data_hash, snapshot_json,
                    generated_by, reviewed_at, reviewed_by
                ) VALUES (%s, %s, %s, %s, 'For Client Review', 'review',
                          'react', %s, %s, %s, %s,
                          %s, NOW(), %s)
                RETURNING report_version_id
                """,
                [
                    org_id_val, int(job_id), client_db_id_val, version_number,
                    tmpl_id, tmpl_ver_id, data_hash, snapshot_json,
                    actor, actor,
                ],
            ).fetchone()

        portal_version_id = int(version_row[0])

        with get_conn(autocommit=False) as con:
            review = send_to_portal(int(job_id), actor, portal_version_id, con=con)
            portal_users = _get_active_portal_users_for_job(int(job_id), con=con)
            job_row = con.execute(
                "SELECT job_number, title FROM jobs WHERE job_id = %s", [int(job_id)]
            ).fetchone()

        job_ref = f"{job_row[0]} — {job_row[1]}" if job_row and job_row[0] else (str(job_row[1]) if job_row else f"Job {job_id}")
        for pu in portal_users:
            _notify_client_review_ready(pu, job_ref, int(job_id))

        logger.info("send_job_to_portal: job %s sent to portal as version %s by %s", job_id, portal_version_id, actor)
        return {
            "ok": True,
            "portal_version_id": portal_version_id,
            "sent_to_count": len(portal_users),
            "review": review,
        }

    except HTTPException:
        raise
    except Exception:
        logger.exception("send_job_to_portal: failed for job %s", job_id)
        raise HTTPException(status_code=500, detail="Failed to send report to portal. Please try again.")


# ---------------------------------------------------------------------------
# Publish PDF — CRM explicitly publishes the final PDF for client download
# ---------------------------------------------------------------------------

@router.post("/jobs/{job_id}/review/publish-pdf")
def publish_pdf_for_client(
    job_id: int,
    _user: dict = Depends(_current_user),
):
    """Mark the latest final PDF version as published and available for client download."""
    assert_permission(_user, "jobs.edit")
    assert_job_access(_user, int(job_id))
    actor = _actor(_user)

    with get_conn() as con:
        review = get_or_create_review(int(job_id), con=con)
        if review["status"] != "approved":
            raise HTTPException(
                status_code=400,
                detail="The report must be approved by the client before publishing the PDF.",
            )
        # Find the most recent final version for this job
        version_row = con.execute(
            """
            SELECT report_version_id, version_number, file_path, file_id
            FROM job_report_versions
            WHERE job_id = %s
              AND lower(COALESCE(status, '')) = 'final'
              AND snapshot_json IS NOT NULL
            ORDER BY version_number DESC
            LIMIT 1
            """,
            [int(job_id)],
        ).fetchone()

    if not version_row:
        raise HTTPException(
            status_code=404,
            detail="No final report version found. Please generate and mark a version as Final in Report Printing before publishing.",
        )

    pdf_version_id = int(version_row[0])

    with get_conn(autocommit=False) as con:
        review = mark_published(int(job_id), actor, pdf_version_id, con=con)

    logger.info("publish_pdf_for_client: job %s published version %s by %s", job_id, pdf_version_id, actor)
    return {"ok": True, "published_at": review["published_at"], "pdf_version_id": pdf_version_id}
