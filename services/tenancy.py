"""Tenant scoping helpers used during the staged rollout."""
from fastapi import HTTPException

from core.database import get_conn


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
    """Attach or hydrate the user's org id without enforcing tenant scope."""
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
                return user
    except Exception:
        pass

    org_id = get_default_org_id()
    if org_id:
        try:
            with get_conn() as con:
                con.execute(
                    "UPDATE users SET org_id = ? WHERE user_id = ? AND org_id IS NULL",
                    [org_id, user_id],
                )
        except Exception:
            pass
    user["org_id"] = org_id
    return user


def require_org(user: dict) -> str:
    """Return the org id, falling back to the default org when possible."""
    org_id = str(user.get("org_id") or "").strip()
    if org_id:
        return org_id

    fallback = get_default_org_id()
    if fallback:
        user["org_id"] = fallback
        return fallback

    raise HTTPException(
        status_code=403,
        detail="No organisation associated with this account.",
    )
