"""Portal authentication routes for nzinsights.co.uk.

Separate from NZI staff auth. Issues portal-scoped JWTs that carry
portal_user_id and client_db_id. Staff tokens are rejected here.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Body, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from core.database import get_conn
from services.portal import (
    authenticate_portal_user,
    consume_reset_token,
    create_reset_token,
    ensure_portal_schema,
    get_portal_user_by_id,
    set_portal_user_password,
)
from services.outbound_email import send_tracked_email
import logging

logger = logging.getLogger(__name__)

try:
    import jwt as pyjwt
except Exception:
    pyjwt = None

router = APIRouter(tags=["portal-auth"])

_PORTAL_TOKEN_HOURS = 24 * 7  # 7-day portal sessions


def _portal_jwt_secret() -> str | None:
    return str(os.getenv("PORTAL_JWT_SECRET") or os.getenv("NZI_JWT_SECRET") or "").strip() or None


def _portal_base_url() -> str:
    url = str(os.getenv("PORTAL_BASE_URL") or "https://www.nzinsights.co.uk").strip().rstrip("/")
    return url


def _issue_staff_portal_token(staff_email: str, staff_name: str, client_db_id: int) -> str | None:
    """Issue a portal JWT for a staff member (NZI Pro user) viewing a specific client portal."""
    secret = _portal_jwt_secret()
    if not secret or pyjwt is None:
        return None
    now = datetime.now(timezone.utc)
    payload = {
        "sub": f"staff:{staff_email}",
        "kind": "portal_staff_session",
        "client_db_id": int(client_db_id),
        "staff_email": staff_email,
        "staff_name": staff_name,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=_PORTAL_TOKEN_HOURS)).timestamp()),
    }
    return pyjwt.encode(payload, secret, algorithm="HS256")


def _issue_portal_token(portal_user_id: int, client_db_id: int) -> str | None:
    secret = _portal_jwt_secret()
    if not secret or pyjwt is None:
        return None
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(portal_user_id),
        "kind": "portal_session",
        "client_db_id": int(client_db_id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=_PORTAL_TOKEN_HOURS)).timestamp()),
    }
    return pyjwt.encode(payload, secret, algorithm="HS256")


def _decode_portal_token(token: str) -> dict[str, Any]:
    secret = _portal_jwt_secret()
    if not secret or pyjwt is None:
        raise HTTPException(status_code=401, detail="Portal auth not configured")
    try:
        payload = pyjwt.decode(token, secret, algorithms=["HS256"])
        if payload.get("kind") not in ("portal_session", "portal_staff_session"):
            raise HTTPException(status_code=401, detail="Invalid token type")
        return payload
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


async def _portal_user(authorization: str = Header(default="")) -> dict[str, Any]:
    """FastAPI dependency — resolves portal JWT to portal user dict.

    Handles two token kinds:
    - portal_session: regular client portal user (looked up in client_portal_users)
    - portal_staff_session: NZI Pro staff member accessing a client portal
    """
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = _decode_portal_token(token)
    client_db_id = int(payload["client_db_id"])

    if payload.get("kind") == "portal_staff_session":
        # Staff session — synthesise a portal user dict; no DB lookup required
        return {
            "portal_user_id": None,
            "client_db_id": client_db_id,
            "email": str(payload.get("staff_email") or ""),
            "full_name": str(payload.get("staff_name") or "Staff"),
            "is_active": True,
            "is_staff": True,
        }

    # Regular portal client session
    portal_user_id = int(payload["sub"])
    with get_conn() as con:
        ensure_portal_schema(con)
        user = get_portal_user_by_id(portal_user_id, con=con)
    if not user or not user.get("is_active"):
        raise HTTPException(status_code=401, detail="Account not found or inactive")
    if int(user["client_db_id"]) != client_db_id:
        raise HTTPException(status_code=401, detail="Token mismatch")
    user["is_staff"] = False
    return user


# Export for use by portal_routes
portal_user_dep = _portal_user


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class LoginPayload(BaseModel):
    email: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class PasswordResetRequestPayload(BaseModel):
    email: str = Field(..., min_length=1)


class PasswordResetConfirmPayload(BaseModel):
    token: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=8)


class ChangePasswordPayload(BaseModel):
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=8)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

def _get_staff_org_id(email: str) -> str | None:
    """Look up the org_id for an NZI Pro user by email."""
    try:
        with get_conn() as con:
            row = con.execute(
                "SELECT org_id FROM users WHERE lower(email) = lower(%s) LIMIT 1",
                [email.strip()],
            ).fetchone()
            return str(row[0]) if row and row[0] else None
    except Exception:
        return None


def _get_staff_accessible_clients(email: str) -> list[dict]:
    """Return all active clients in the staff member's org (staff can access any client)."""
    org_id = _get_staff_org_id(email)
    with get_conn() as con:
        if org_id:
            rows = con.execute(
                "SELECT db_id, client_name FROM clients WHERE org_id = %s AND COALESCE(archived, FALSE) = FALSE ORDER BY client_name",
                [org_id],
            ).fetchall()
        else:
            rows = con.execute(
                "SELECT db_id, client_name FROM clients WHERE COALESCE(archived, FALSE) = FALSE ORDER BY client_name"
            ).fetchall()
    return [{"client_db_id": int(r[0]), "client_name": str(r[1] or "")} for r in (rows or [])]


class StaffClientSelectPayload(BaseModel):
    email: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)
    client_db_id: int


@router.post("/portal/auth/login")
def portal_login(payload: LoginPayload = Body(...)):
    # Try portal client auth first
    with get_conn() as con:
        user = authenticate_portal_user(payload.email, payload.password, con=con)
    if user:
        token = _issue_portal_token(user["portal_user_id"], user["client_db_id"])
        return {
            "ok": True,
            "access_token": token,
            "token_type": "bearer",
            "user": user,
        }

    # Fall back to NZI Pro staff auth
    try:
        from core.auth import authenticate_user as _auth_staff
        staff = _auth_staff(payload.email, payload.password)
    except Exception:
        staff = None

    if not staff:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Staff: return client list for selection
    clients = _get_staff_accessible_clients(payload.email)
    return {
        "ok": True,
        "access_token": None,
        "needs_client_selection": True,
        "staff_name": staff.get("full_name") or payload.email,
        "staff_email": payload.email,
        "accessible_clients": clients,
    }


@router.post("/portal/auth/staff-select-client")
def portal_staff_select_client(payload: StaffClientSelectPayload = Body(...)):
    """Second step of staff login: re-authenticate and issue a token for the chosen client."""
    try:
        from core.auth import authenticate_user as _auth_staff
        staff = _auth_staff(payload.email, payload.password)
    except Exception:
        staff = None
    if not staff:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    clients = _get_staff_accessible_clients(payload.email)
    accessible_ids = {c["client_db_id"] for c in clients}
    if payload.client_db_id not in accessible_ids:
        raise HTTPException(status_code=403, detail="You do not have access to this client portal")

    token = _issue_staff_portal_token(
        staff_email=payload.email,
        staff_name=str(staff.get("full_name") or payload.email),
        client_db_id=payload.client_db_id,
    )
    return {
        "ok": True,
        "access_token": token,
        "token_type": "bearer",
        "is_staff": True,
    }


@router.get("/portal/auth/me")
def portal_me(current_user: dict = Depends(_portal_user)):
    return {"ok": True, "user": current_user}


@router.post("/portal/auth/password-reset-request")
def portal_password_reset_request(payload: PasswordResetRequestPayload = Body(...)):
    """Always returns 200 to avoid user enumeration."""
    with get_conn(autocommit=False) as con:
        token = create_reset_token(payload.email, con=con)

        if token:
            reset_url = f"{_portal_base_url()}/reset-password?token={token}"
            try:
                send_tracked_email(
                    con,
                    to_email=payload.email,
                    subject="NZInsights — reset your password",
                    body_text=(
                        f"You requested a password reset for your NZInsights account.\n\n"
                        f"Click the link below to set a new password (valid for 2 hours):\n\n"
                        f"{reset_url}\n\n"
                        f"If you did not request this, you can ignore this email."
                    ),
                    body_html=(
                        f"<p>You requested a password reset for your NZInsights account.</p>"
                        f"<p><a href='{reset_url}'>Reset your password</a></p>"
                        f"<p>This link is valid for 2 hours. If you did not request this, ignore this email.</p>"
                    ),
                    template_key="portal_password_reset",
                    entity_type="portal_user",
                    created_by="portal-self-service",
                    raise_on_error=False,
                )
                logger.info("portal password reset email queued for %s", payload.email)
            except Exception:
                logger.exception("portal password reset email failed for %s", payload.email)

    return {"ok": True, "message": "If that email is registered you will receive a reset link shortly"}


@router.post("/portal/auth/password-reset-confirm")
def portal_password_reset_confirm(payload: PasswordResetConfirmPayload = Body(...)):
    with get_conn(autocommit=False) as con:
        ok = consume_reset_token(payload.token, payload.new_password, con=con)
    if not ok:
        raise HTTPException(status_code=400, detail="Reset link is invalid or has expired")
    return {"ok": True, "message": "Password updated. You can now log in."}


@router.post("/portal/auth/change-password")
def portal_change_password(
    payload: ChangePasswordPayload = Body(...),
    current_user: dict = Depends(_portal_user),
):
    with get_conn() as con:
        from services.portal import get_portal_user_by_email
        user_with_hash = get_portal_user_by_email(current_user["email"], con=con)
    if not user_with_hash:
        raise HTTPException(status_code=404, detail="User not found")
    from services.portal import _verify_password
    if not _verify_password(payload.current_password, user_with_hash.get("password_hash") or ""):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    with get_conn(autocommit=False) as con:
        set_portal_user_password(current_user["portal_user_id"], payload.new_password, con=con)
    return {"ok": True, "message": "Password changed successfully"}
