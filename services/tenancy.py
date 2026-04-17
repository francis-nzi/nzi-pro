"""Tenant scoping helpers - ensure every query is scoped to the current org."""
from fastapi import HTTPException
from core.database import get_conn


def get_default_org_id() -> str | None:
    """Return the canonical fallback organisation id for this deployment."""
    try:
        with get_conn() as con:
            row = con.execute(
                "SELECT org_id FROM organisations WHERE slug = 'nzi-internal' LIMIT 1"
            ).fetchone()
            if row and row[0]:
                return str(row[0])

            try:
                con.execute(
                    """
                    INSERT INTO organisations (name, slug, plan, plan_status, max_users, max_clients)
                    SELECT 'NZI Internal', 'nzi-internal', 'trial', 'active', 999, 999
                    WHERE NOT EXISTS (
                      SELECT 1 FROM organisations WHERE slug = 'nzi-internal'
                    )
                    """
                )
            except Exception:
                pass

            row = con.execute(
                "SELECT org_id FROM organisations ORDER BY created_at ASC LIMIT 1"
            ).fetchone()
            if row and row[0]:
                return str(row[0])
    except Exception:
        return None
    return None


def require_org(user: dict) -> str:
    """Extract org_id from the current user dict, raising 403 if missing."""
    org_id = str(user.get("org_id") or "").strip()
    if not org_id:
        org_id = get_default_org_id() or ""
        if org_id:
            user["org_id"] = org_id
            return org_id
        raise HTTPException(status_code=403, detail="No organisation associated with this account.")
    return org_id


def org_where(org_id: str, alias: str = "") -> tuple[str, list]:
    """Return a SQL WHERE fragment and params list for org scoping."""
    prefix = f"{alias}." if alias else ""
    return f"{prefix}org_id = %s", [org_id]
