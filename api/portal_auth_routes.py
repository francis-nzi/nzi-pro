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
        if payload.get("kind") != "portal_session":
            raise HTTPException(status_code=401, detail="Invalid token type")
        return payload
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


async def _portal_user(authorization: str = Header(default="")) -> dict[str, Any]:
    """FastAPI dependency — resolves portal JWT to portal user dict."""
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = _decode_portal_token(token)
    portal_user_id = int(payload["sub"])
    client_db_id = int(payload["client_db_id"])
    with get_conn() as con:
        ensure_portal_schema(con)
        user = get_portal_user_by_id(portal_user_id, con=con)
    if not user or not user.get("is_active"):
        raise HTTPException(status_code=401, detail="Account not found or inactive")
    if int(user["client_db_id"]) != client_db_id:
        raise HTTPException(status_code=401, detail="Token mismatch")
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

@router.post("/portal/auth/login")
def portal_login(payload: LoginPayload = Body(...)):
    with get_conn() as con:
        user = authenticate_portal_user(payload.email, payload.password, con=con)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = _issue_portal_token(user["portal_user_id"], user["client_db_id"])
    return {
        "ok": True,
        "access_token": token,
        "token_type": "bearer",
        "user": user,
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
