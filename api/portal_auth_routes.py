"""Portal authentication routes for nzinsights.co.uk.

Separate from NZI staff auth. Issues portal-scoped JWTs:
  portal_mfa_challenge  — short-lived (10 min); only valid for POST /portal/auth/mfa-verify
  portal_partial        — 24 h; valid for onboarding endpoints only (T&C + MFA setup)
  portal_session        — 7 days; full access
  portal_staff_session  — 7 days; NZI staff previewing a client portal
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Body, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from core.database import get_conn
from services.portal import (
    authenticate_portal_user,
    check_client_portal_access,
    consume_reset_token,
    create_reset_token,
    ensure_portal_schema,
    get_client_portal_access,
    get_portal_user_auth_data,
    get_portal_user_by_email,
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

try:
    import pyotp as _pyotp
except Exception:
    _pyotp = None

try:
    from cryptography.fernet import Fernet as _Fernet
except Exception:
    _Fernet = None

router = APIRouter(tags=["portal-auth"])

PORTAL_CLIENT_TAC_VERSION = "2026-v1"

_PORTAL_TOKEN_HOURS = 24 * 7       # full session — 7 days
_PORTAL_PARTIAL_HOURS = 24          # onboarding partial token — 24 h
_PORTAL_CHALLENGE_MINUTES = 10      # MFA challenge — 10 min


# ---------------------------------------------------------------------------
# JWT secret + Fernet encryption
# ---------------------------------------------------------------------------

def _portal_jwt_secret() -> str | None:
    return str(os.getenv("PORTAL_JWT_SECRET") or os.getenv("NZI_JWT_SECRET") or "").strip() or None


def _portal_base_url() -> str:
    return str(os.getenv("PORTAL_BASE_URL") or "https://www.nzinsights.co.uk").strip().rstrip("/")


def _portal_mfa_fernet():
    if _Fernet is None:
        raise HTTPException(status_code=500, detail="MFA unavailable: cryptography package missing")
    key = str(os.getenv("MFA_ENCRYPTION_KEY") or "").strip()
    if key:
        try:
            return _Fernet(key.encode())
        except Exception:
            raise HTTPException(status_code=500, detail="MFA_ENCRYPTION_KEY is invalid")
    seed = str(_portal_jwt_secret() or "nzi-portal-mfa-dev").encode()
    return _Fernet(base64.urlsafe_b64encode(hashlib.sha256(seed).digest()))


def _portal_encrypt(secret: str) -> str:
    return _portal_mfa_fernet().encrypt(secret.encode()).decode()


def _portal_decrypt(value: str) -> str:
    try:
        return _portal_mfa_fernet().decrypt(value.encode()).decode()
    except Exception:
        return ""


# ---------------------------------------------------------------------------
# T&C helpers
# ---------------------------------------------------------------------------

def _must_accept_tac(auth_data: dict) -> bool:
    return str(auth_data.get("accepted_tac_version") or "").strip() != PORTAL_CLIENT_TAC_VERSION


# ---------------------------------------------------------------------------
# Recovery-code helpers
# ---------------------------------------------------------------------------

def _generate_recovery_codes(n: int = 8) -> tuple[list[str], list[str]]:
    """Return (plaintext_codes, sha256_hashes)."""
    plain, hashed = [], []
    for _ in range(n):
        code = f"{secrets.token_hex(3).upper()}-{secrets.token_hex(3).upper()}"
        plain.append(code)
        hashed.append(hashlib.sha256(code.encode()).hexdigest())
    return plain, hashed


def _verify_recovery_code(code: str, stored_hashes_json: str) -> bool:
    h = hashlib.sha256(str(code or "").strip().upper().encode()).hexdigest()
    try:
        stored = json.loads(stored_hashes_json or "[]")
        return h in stored
    except Exception:
        return False


def _remove_recovery_code(code: str, stored_hashes_json: str) -> str:
    h = hashlib.sha256(str(code or "").strip().upper().encode()).hexdigest()
    try:
        stored = json.loads(stored_hashes_json or "[]")
        updated = [x for x in stored if x != h]
        return json.dumps(updated)
    except Exception:
        return stored_hashes_json


# ---------------------------------------------------------------------------
# JWT issuance
# ---------------------------------------------------------------------------

def _issue_token(kind: str, portal_user_id: int, client_db_id: int, hours: float) -> str | None:
    secret = _portal_jwt_secret()
    if not secret or pyjwt is None:
        return None
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(portal_user_id),
        "kind": kind,
        "client_db_id": int(client_db_id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=hours)).timestamp()),
    }
    return pyjwt.encode(payload, secret, algorithm="HS256")


def _issue_portal_token(portal_user_id: int, client_db_id: int) -> str | None:
    return _issue_token("portal_session", portal_user_id, client_db_id, _PORTAL_TOKEN_HOURS)


def _issue_partial_token(portal_user_id: int, client_db_id: int) -> str | None:
    return _issue_token("portal_partial", portal_user_id, client_db_id, _PORTAL_PARTIAL_HOURS)


def _issue_challenge_token(portal_user_id: int, client_db_id: int) -> str | None:
    return _issue_token("portal_mfa_challenge", portal_user_id, client_db_id, _PORTAL_CHALLENGE_MINUTES / 60)


def _issue_staff_portal_token(staff_email: str, staff_name: str, client_db_id: int) -> str | None:
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


# ---------------------------------------------------------------------------
# JWT decoding + dependencies
# ---------------------------------------------------------------------------

_FULL_KINDS = {"portal_session", "portal_staff_session"}
_ONBOARDING_KINDS = {"portal_session", "portal_partial", "portal_staff_session"}
_CHALLENGE_KINDS = {"portal_mfa_challenge"}


def _decode_portal_token(token: str, *, allowed_kinds: set[str]) -> dict[str, Any]:
    secret = _portal_jwt_secret()
    if not secret or pyjwt is None:
        raise HTTPException(status_code=401, detail="Portal auth not configured")
    try:
        payload = pyjwt.decode(token, secret, algorithms=["HS256"])
        if payload.get("kind") not in allowed_kinds:
            raise HTTPException(status_code=401, detail="Invalid token type for this operation")
        return payload
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


async def _portal_user(authorization: str = Header(default="")) -> dict[str, Any]:
    """Full access — accepts portal_session and portal_staff_session only."""
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = _decode_portal_token(token, allowed_kinds=_FULL_KINDS)
    client_db_id = int(payload["client_db_id"])

    if payload.get("kind") == "portal_staff_session":
        return {
            "portal_user_id": None,
            "client_db_id": client_db_id,
            "email": str(payload.get("staff_email") or ""),
            "full_name": str(payload.get("staff_name") or "Staff"),
            "is_active": True,
            "is_staff": True,
        }

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


async def _portal_onboarding_user(authorization: str = Header(default="")) -> dict[str, Any]:
    """Onboarding — accepts portal_session, portal_partial, and portal_staff_session.
    Used by /me, /accept-tac, /mfa/* endpoints so partial tokens work during setup."""
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = _decode_portal_token(token, allowed_kinds=_ONBOARDING_KINDS)
    client_db_id = int(payload["client_db_id"])

    if payload.get("kind") == "portal_staff_session":
        return {
            "portal_user_id": None,
            "client_db_id": client_db_id,
            "email": str(payload.get("staff_email") or ""),
            "full_name": str(payload.get("staff_name") or "Staff"),
            "is_active": True,
            "is_staff": True,
        }

    portal_user_id = int(payload["sub"])
    with get_conn() as con:
        ensure_portal_schema(con)
        auth_data = get_portal_user_auth_data(portal_user_id, con=con)
    if not auth_data or not auth_data.get("is_active"):
        raise HTTPException(status_code=401, detail="Account not found or inactive")
    if int(auth_data["client_db_id"]) != client_db_id:
        raise HTTPException(status_code=401, detail="Token mismatch")
    auth_data["is_staff"] = False
    return auth_data


async def _portal_challenge_user(authorization: str = Header(default="")) -> dict[str, Any]:
    """Accepts only portal_mfa_challenge tokens. Used by /mfa-verify."""
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = _decode_portal_token(token, allowed_kinds=_CHALLENGE_KINDS)
    portal_user_id = int(payload["sub"])
    client_db_id = int(payload["client_db_id"])
    with get_conn() as con:
        ensure_portal_schema(con)
        auth_data = get_portal_user_auth_data(portal_user_id, con=con)
    if not auth_data or not auth_data.get("is_active"):
        raise HTTPException(status_code=401, detail="Account not found or inactive")
    if int(auth_data["client_db_id"]) != client_db_id:
        raise HTTPException(status_code=401, detail="Token mismatch")
    return auth_data


# Export for use by portal_routes
portal_user_dep = _portal_user


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class LoginPayload(BaseModel):
    email: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class MfaVerifyPayload(BaseModel):
    otp_code: str | None = Field(default=None)
    recovery_code: str | None = Field(default=None)


class MfaSetupVerifyPayload(BaseModel):
    otp_code: str = Field(..., min_length=6, max_length=6)


class PasswordResetRequestPayload(BaseModel):
    email: str = Field(..., min_length=1)


class PasswordResetConfirmPayload(BaseModel):
    token: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=8)


class ChangePasswordPayload(BaseModel):
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=8)


# ---------------------------------------------------------------------------
# Staff helpers (unchanged)
# ---------------------------------------------------------------------------

def _get_staff_org_id(email: str) -> str | None:
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


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------

@router.post("/portal/auth/login")
def portal_login(payload: LoginPayload = Body(...)):
    # ── Try portal client auth ───────────────────────────────────────────────
    with get_conn() as con:
        user = authenticate_portal_user(payload.email, payload.password, con=con)

    if user:
        portal_user_id = int(user["portal_user_id"])
        client_db_id = int(user["client_db_id"])

        # Check client-level portal access before proceeding
        with get_conn() as con:
            ensure_portal_schema(con)
            access_ok, access_reason = check_client_portal_access(client_db_id, con=con)
        if not access_ok:
            raise HTTPException(status_code=403, detail=access_reason)

        with get_conn() as con:
            auth_data = get_portal_user_auth_data(portal_user_id, con=con)

        mfa_enabled = bool(auth_data and auth_data.get("mfa_enabled"))

        if mfa_enabled:
            # MFA already set up — issue a short-lived challenge token; OTP required
            challenge_token = _issue_challenge_token(portal_user_id, client_db_id)
            return {
                "ok": True,
                "mfa_required": True,
                "mfa_challenge_token": challenge_token,
            }

        # MFA not set up yet — issue partial token; onboarding required
        must_accept = _must_accept_tac(auth_data or {})
        partial_token = _issue_partial_token(portal_user_id, client_db_id)
        return {
            "ok": True,
            "mfa_required": False,
            "mfa_setup_required": True,
            "must_accept_tac": must_accept,
            "partial_token": partial_token,
        }

    # ── Fall back to NZI Pro staff auth ─────────────────────────────────────
    try:
        from core.auth import authenticate_user as _auth_staff
        staff = _auth_staff(payload.email, payload.password)
    except Exception:
        staff = None

    if not staff:
        raise HTTPException(status_code=401, detail="Invalid email or password")

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
    try:
        from core.auth import authenticate_user as _auth_staff
        staff = _auth_staff(payload.email, payload.password)
    except Exception:
        staff = None
    if not staff:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    clients = _get_staff_accessible_clients(payload.email)
    if payload.client_db_id not in {c["client_db_id"] for c in clients}:
        raise HTTPException(status_code=403, detail="You do not have access to this client portal")

    token = _issue_staff_portal_token(
        staff_email=payload.email,
        staff_name=str(staff.get("full_name") or payload.email),
        client_db_id=payload.client_db_id,
    )
    return {"ok": True, "access_token": token, "token_type": "bearer", "is_staff": True}


# ---------------------------------------------------------------------------
# MFA — login challenge verify
# ---------------------------------------------------------------------------

@router.post("/portal/auth/mfa-verify")
def portal_mfa_verify(
    payload: MfaVerifyPayload = Body(...),
    auth_data: dict = Depends(_portal_challenge_user),
):
    """Verify OTP (or recovery code) after password login. Issues full or partial token."""
    if _pyotp is None:
        raise HTTPException(status_code=500, detail="MFA unavailable: pyotp package missing")

    portal_user_id = int(auth_data["portal_user_id"])
    client_db_id = int(auth_data["client_db_id"])
    secret_encrypted = str(auth_data.get("mfa_secret_encrypted") or "")
    recovery_hashes = str(auth_data.get("mfa_recovery_codes_hash") or "[]")

    otp_code = str(payload.otp_code or "").strip()
    recovery_code = str(payload.recovery_code or "").strip()

    if otp_code:
        if not secret_encrypted:
            raise HTTPException(status_code=400, detail="MFA not configured")
        secret = _portal_decrypt(secret_encrypted)
        if not secret or not _pyotp.TOTP(secret).verify(otp_code, valid_window=1):
            raise HTTPException(status_code=400, detail="Invalid authenticator code")
        with get_conn() as con:
            con.execute(
                "UPDATE client_portal_users SET mfa_last_used_at = NOW() WHERE portal_user_id = %s",
                [portal_user_id],
            )
    elif recovery_code:
        if not _verify_recovery_code(recovery_code, recovery_hashes):
            raise HTTPException(status_code=400, detail="Invalid or already-used recovery code")
        # Consume the code
        updated_hashes = _remove_recovery_code(recovery_code, recovery_hashes)
        with get_conn() as con:
            con.execute(
                "UPDATE client_portal_users SET mfa_recovery_codes_hash = %s, mfa_last_used_at = NOW() WHERE portal_user_id = %s",
                [updated_hashes, portal_user_id],
            )
    else:
        raise HTTPException(status_code=400, detail="Provide otp_code or recovery_code")

    # Re-fetch latest T&C status after verify
    with get_conn() as con:
        latest = get_portal_user_auth_data(portal_user_id, con=con)
    must_accept = _must_accept_tac(latest or {})

    if must_accept:
        # Issue partial token — user must accept updated T&Cs
        partial_token = _issue_partial_token(portal_user_id, client_db_id)
        return {
            "ok": True,
            "must_accept_tac": True,
            "mfa_setup_required": False,
            "partial_token": partial_token,
        }

    # All good — issue full session token
    token = _issue_portal_token(portal_user_id, client_db_id)
    return {
        "ok": True,
        "must_accept_tac": False,
        "mfa_setup_required": False,
        "access_token": token,
        "token_type": "bearer",
    }


# ---------------------------------------------------------------------------
# MFA — setup (called with partial or full token)
# ---------------------------------------------------------------------------

@router.get("/portal/auth/mfa/status")
def portal_mfa_status(current_user: dict = Depends(_portal_onboarding_user)):
    if current_user.get("is_staff"):
        return {"mfa_enabled": True, "mfa_required": False, "is_staff": True}
    return {
        "mfa_enabled": bool(current_user.get("mfa_enabled")),
        "mfa_enabled_at": current_user.get("mfa_enabled_at"),
        "mfa_last_used_at": current_user.get("mfa_last_used_at"),
        "mfa_required": True,
        "mfa_setup_required": not bool(current_user.get("mfa_enabled")),
    }


@router.post("/portal/auth/mfa/setup/start")
def portal_mfa_setup_start(current_user: dict = Depends(_portal_onboarding_user)):
    """Generate a new TOTP secret, store it as the pending setup secret."""
    if _pyotp is None:
        raise HTTPException(status_code=500, detail="MFA unavailable: pyotp package missing")
    if current_user.get("is_staff"):
        raise HTTPException(status_code=403, detail="Staff accounts use NZI Pro MFA")

    portal_user_id = int(current_user["portal_user_id"])
    email = str(current_user.get("email") or "")

    secret = _pyotp.random_base32()
    encrypted = _portal_encrypt(secret)
    totp = _pyotp.TOTP(secret)
    provisioning_uri = totp.provisioning_uri(name=email, issuer_name="NZInsights")

    with get_conn() as con:
        con.execute(
            """
            UPDATE client_portal_users
            SET mfa_setup_secret_encrypted = %s, updated_at = NOW()
            WHERE portal_user_id = %s
            """,
            [encrypted, portal_user_id],
        )

    return {
        "ok": True,
        "secret": secret,
        "provisioning_uri": provisioning_uri,
    }


@router.post("/portal/auth/mfa/setup/verify")
def portal_mfa_setup_verify(
    payload: MfaSetupVerifyPayload = Body(...),
    current_user: dict = Depends(_portal_onboarding_user),
):
    """Confirm OTP from setup flow, enable MFA, issue a full session token."""
    if _pyotp is None:
        raise HTTPException(status_code=500, detail="MFA unavailable: pyotp package missing")
    if current_user.get("is_staff"):
        raise HTTPException(status_code=403, detail="Staff accounts use NZI Pro MFA")

    portal_user_id = int(current_user["portal_user_id"])
    client_db_id = int(current_user["client_db_id"])

    with get_conn() as con:
        row = con.execute(
            "SELECT mfa_setup_secret_encrypted FROM client_portal_users WHERE portal_user_id = %s",
            [portal_user_id],
        ).fetchone()

    if not row or not row[0]:
        raise HTTPException(status_code=400, detail="MFA setup not started — call /mfa/setup/start first")

    secret = _portal_decrypt(str(row[0]))
    if not secret:
        raise HTTPException(status_code=400, detail="Could not decrypt MFA secret")

    if not _pyotp.TOTP(secret).verify(payload.otp_code, valid_window=1):
        raise HTTPException(status_code=400, detail="Invalid authenticator code — check your device clock and try again")

    plain_codes, hashed_codes = _generate_recovery_codes()

    with get_conn() as con:
        con.execute(
            """
            UPDATE client_portal_users
            SET mfa_enabled = TRUE,
                mfa_secret_encrypted = %s,
                mfa_setup_secret_encrypted = NULL,
                mfa_recovery_codes_hash = %s,
                mfa_enabled_at = NOW(),
                mfa_last_used_at = NOW(),
                updated_at = NOW()
            WHERE portal_user_id = %s
            """,
            [_portal_encrypt(secret), json.dumps(hashed_codes), portal_user_id],
        )

    # Issue full session token now that MFA is set up
    token = _issue_portal_token(portal_user_id, client_db_id)
    return {
        "ok": True,
        "access_token": token,
        "token_type": "bearer",
        "recovery_codes": plain_codes,
    }


# ---------------------------------------------------------------------------
# T&C acceptance (called with partial or full token)
# ---------------------------------------------------------------------------

@router.post("/portal/auth/accept-tac")
def portal_accept_tac(current_user: dict = Depends(_portal_onboarding_user)):
    if current_user.get("is_staff"):
        return {"ok": True, "accepted_tac_version": PORTAL_CLIENT_TAC_VERSION}

    portal_user_id = int(current_user["portal_user_id"])
    with get_conn() as con:
        con.execute(
            """
            UPDATE client_portal_users
            SET accepted_tac_at = NOW(), accepted_tac_version = %s, updated_at = NOW()
            WHERE portal_user_id = %s
            """,
            [PORTAL_CLIENT_TAC_VERSION, portal_user_id],
        )

    # Tell the client whether MFA setup is still pending
    mfa_setup_required = not bool(current_user.get("mfa_enabled"))
    return {
        "ok": True,
        "accepted_tac_version": PORTAL_CLIENT_TAC_VERSION,
        "mfa_setup_required": mfa_setup_required,
    }


# ---------------------------------------------------------------------------
# /me — returns flags used by PortalShell guard
# ---------------------------------------------------------------------------

@router.get("/portal/auth/me")
def portal_me(current_user: dict = Depends(_portal_onboarding_user)):
    client_db_id = int(current_user["client_db_id"])

    with get_conn() as con:
        ensure_portal_schema(con)
        access_record = get_client_portal_access(client_db_id, con=con)
        client_row = con.execute(
            """
            SELECT client_name, status, portfolio
            FROM clients
            WHERE db_id = %s
            """,
            [client_db_id],
        ).fetchone()
    nav_config = access_record.get("nav_config", {})
    client_status = str(client_row[1] or "") if client_row else ""
    portal_mode = "portfolio_owner" if client_status.strip().lower() == "portfolio owner" else "client"

    if current_user.get("is_staff"):
        # Staff preview a client's portal using the same nav_config a real
        # client login would get, so what's toggled off in the admin is
        # actually reflected during preview instead of always showing
        # every section.
        return {
            "ok": True,
            "user": {
                "portal_user_id": None,
                "client_db_id": client_db_id,
                "email": current_user["email"],
                "full_name": current_user["full_name"],
                "is_staff": True,
            },
            "must_accept_tac": False,
            "mfa_setup_required": False,
            "nav_config": nav_config,
            "portal_mode": "staff",
        }

    must_accept = _must_accept_tac(current_user)
    mfa_setup_required = not bool(current_user.get("mfa_enabled"))

    return {
        "ok": True,
        "user": {
            "portal_user_id": current_user["portal_user_id"],
            "client_db_id": client_db_id,
            "email": current_user["email"],
            "full_name": current_user["full_name"],
            "is_staff": False,
        },
        "must_accept_tac": must_accept,
        "mfa_setup_required": mfa_setup_required,
        "nav_config": nav_config,
        "portal_mode": portal_mode,
        "portal_client": {
            "client_name": str(client_row[0] or "") if client_row else "",
            "status": client_status or None,
            "portfolio": str(client_row[2] or "") if client_row else None,
        } if client_row else None,
    }


# ---------------------------------------------------------------------------
# Password reset + change (unchanged logic)
# ---------------------------------------------------------------------------

@router.post("/portal/auth/password-reset-request")
def portal_password_reset_request(payload: PasswordResetRequestPayload = Body(...)):
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
        user_with_hash = get_portal_user_by_email(current_user["email"], con=con)
    if not user_with_hash:
        raise HTTPException(status_code=404, detail="User not found")
    from services.portal import _verify_password
    if not _verify_password(payload.current_password, user_with_hash.get("password_hash") or ""):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    with get_conn(autocommit=False) as con:
        set_portal_user_password(current_user["portal_user_id"], payload.new_password, con=con)
    return {"ok": True, "message": "Password changed successfully"}
