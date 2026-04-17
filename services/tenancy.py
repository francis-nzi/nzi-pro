"""Tenant scoping helpers - ensure every query is scoped to the current org."""
from fastapi import HTTPException


def require_org(user: dict) -> str:
    """Extract org_id from the current user dict, raising 403 if missing."""
    org_id = str(user.get("org_id") or "").strip()
    if not org_id:
        raise HTTPException(status_code=403, detail="No organisation associated with this account.")
    return org_id


def org_where(org_id: str, alias: str = "") -> tuple[str, list]:
    """Return a SQL WHERE fragment and params list for org scoping."""
    prefix = f"{alias}." if alias else ""
    return f"{prefix}org_id = %s", [org_id]
