"""API authentication helpers.

Supports JWT Bearer tokens when `NZI_JWT_SECRET` is set.
Otherwise supports header-based identity via `X-User` / `X-User-Email`.
Anonymous access is not allowed.
"""
from typing import Dict, Optional
import os

from fastapi import Header, HTTPException, Request

from core.auth import get_user_by_id
from core.database import get_conn
from services.permissions import enrich_user_permissions

try:
    import jwt
except Exception:  # pragma: no cover - optional until JWT mode is enabled
    jwt = None


def _env_truthy(name: str, default: str = "false") -> bool:
    val = str(os.getenv(name, default) or "").strip().lower()
    return val in ("1", "true", "yes", "y", "on")


def _allow_dev_login() -> bool:
    env = str(os.getenv("APP_ENV", "") or "").strip().lower()
    return env in ("local", "dev", "development") or _env_truthy("ALLOW_DEV_LOGIN", "false")


def _strict_auth_required() -> bool:
    env = str(os.getenv("APP_ENV", "") or "").strip().lower()
    if env in ("prod", "production"):
        return True
    return _env_truthy("ENFORCE_JWT_AUTH", "false")


def _active_user_from_identifier(identifier: str) -> Optional[Dict[str, str]]:
    ident = (identifier or "").strip()
    if not ident:
        return None

    user = get_user_by_id(ident)
    if user and str(user.get("status", "")).strip().lower() == "active":
        return user

    try:
        with get_conn() as con:
            row = con.execute(
                """
                SELECT user_id, full_name, role, email, status, COALESCE(must_change_password, FALSE),
                       accepted_portal_terms_at, accepted_portal_terms_version
                FROM users
                WHERE lower(email) = lower(?)
                LIMIT 1
                """,
                [ident],
            ).fetchone()
    except Exception:
        row = None

    if not row:
        return None

    status = str(row[4] or "").strip().lower()
    if status != "active":
        return None

    return {
        "user_id": row[0],
        "full_name": row[1],
        "role": row[2],
        "email": row[3],
        "status": row[4],
        "must_change_password": bool(row[5]),
        "accepted_portal_terms_at": row[6].isoformat() if row[6] else None,
        "accepted_portal_terms_version": row[7],
    }


def _current_user(
    request: Request,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    x_user: Optional[str] = Header(default=None, alias="X-User"),
    x_user_email: Optional[str] = Header(default=None, alias="X-User-Email"),
) -> Dict[str, str]:
    def _enforce_password_change(user: Dict[str, str]) -> Dict[str, str]:
        must_change = bool(user.get("must_change_password"))
        if not must_change:
            return user
        path = request.url.path or ""
        if path in ("/auth/change-password", "/auth/me"):
            return user
        raise HTTPException(status_code=403, detail="Password change required")

    secret = os.getenv("NZI_JWT_SECRET", "")
    if _strict_auth_required() and not secret:
        raise HTTPException(status_code=500, detail="Server auth misconfigured: NZI_JWT_SECRET missing in strict mode")

    # If a JWT secret is configured, prefer Bearer token authentication
    if secret:
        if jwt is None:
            raise HTTPException(status_code=500, detail="Server auth misconfigured: PyJWT missing")
        parts = (authorization or "").split()
        if len(parts) != 2 or parts[0].lower() != "bearer":
            raise HTTPException(status_code=401, detail="Missing bearer token")
        token = parts[1]
        try:
            payload = jwt.decode(token, secret, algorithms=["HS256"])
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Token expired")
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid token")

        sub = payload.get("sub")
        user = _active_user_from_identifier(str(sub or ""))
        if not user:
            raise HTTPException(status_code=401, detail="Unknown or inactive user")
        return _enforce_password_change(enrich_user_permissions(user) or user)

    # Header-based compatibility mode (still strict; no anonymous access)
    ident = (x_user_email or x_user or "").strip()
    if not ident:
        # Allow same-browser new-tab navigation to backend routes.
        ident = str(request.cookies.get("nzi_user") or "").strip()
    if not ident and _allow_dev_login():
        ident = str(os.getenv("DEV_LOGIN_EMAIL") or os.getenv("NZI_DEV_LOGIN_EMAIL") or "").strip()

    if not ident:
        raise HTTPException(status_code=401, detail="Missing authenticated user headers")

    user = _active_user_from_identifier(ident)
    if not user:
        raise HTTPException(status_code=401, detail="Unknown or inactive user")
    return _enforce_password_change(enrich_user_permissions(user) or user)
