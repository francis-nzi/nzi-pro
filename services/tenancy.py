"""Tenant scoping helpers for organization-aware requests."""
from contextvars import ContextVar
import logging

from fastapi import HTTPException

from core.database import get_conn

logger = logging.getLogger(__name__)

_CURRENT_ORG_ID: ContextVar[str | None] = ContextVar("nzi_current_org_id", default=None)


def set_current_org_context(org_id: str | None) -> None:
    """Store the active org for the current request context."""
    normalized = str(org_id or "").strip() or None
    _CURRENT_ORG_ID.set(normalized)


def get_current_org_context() -> str | None:
    """Return the active org for the current request context, if any."""
    org_id = _CURRENT_ORG_ID.get()
    return str(org_id).strip() if org_id else None


def clear_current_org_context() -> None:
    """Clear any org bound to the current request context."""
    _CURRENT_ORG_ID.set(None)


def get_default_org_id() -> str | None:
    """Return the fallback organisation id for this deployment."""
    try:
        with get_conn() as con:
            row = con.execute(
                "SELECT org_id FROM organisations WHERE slug = 'nzi-internal' LIMIT 1"
            ).fetchone()
            if row and row[0]:
                return str(row[0])

            row = con.execute(
                "SELECT org_id FROM organisations ORDER BY created_at ASC LIMIT 1"
            ).fetchone()
            if row and row[0]:
                return str(row[0])
    except Exception:
        return None
    return None


def attach_org_id(user: dict) -> dict:
    """Attach the user's stored org id, if present."""
    user_id = str(user.get("user_id") or "").strip()
    if not user_id:
        user["org_id"] = None
        return user

    try:
        with get_conn() as con:
            row = con.execute(
                "SELECT org_id FROM users WHERE user_id = ? LIMIT 1",
                [user_id],
            ).fetchone()
            if row and row[0]:
                user["org_id"] = str(row[0])
                set_current_org_context(user["org_id"])
                return user
    except Exception:
        pass

    user["org_id"] = None
    clear_current_org_context()
    logger.warning("Tenant resolution failed for user_id=%s", user_id or "unknown")
    return user


def require_org(user: dict) -> str:
    """Return the org id for a request."""
    org_id = str(user.get("org_id") or "").strip()
    if org_id:
        set_current_org_context(org_id)
        return org_id

    clear_current_org_context()
    logger.warning(
        "Organisation context missing for user_id=%s",
        str(user.get("user_id") or "unknown").strip() or "unknown",
    )
    raise HTTPException(status_code=403, detail="Organisation context required")
