from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from api.auth import _current_user
from api.portal_auth_routes import portal_user_dep
from core.database import get_conn
from services.portfolio import build_portfolio_overview
from services.tenancy import org_context, require_org

router = APIRouter(tags=["portfolio"])


def _owner_org_id(con, owner_client_db_id: int) -> str | None:
    row = con.execute(
        "SELECT org_id FROM clients WHERE db_id = %s",
        [int(owner_client_db_id)],
    ).fetchone()
    return str(row[0]) if row and row[0] else None


@router.get("/admin/portfolio-owners/{owner_client_db_id}")
def get_portfolio_owner_overview(
    owner_client_db_id: int,
    _user: dict[str, str] = Depends(_current_user),
):
    with get_conn() as con:
        org_id = require_org(_user)
        owner_org_id = _owner_org_id(con, owner_client_db_id)
        if org_id and owner_org_id and str(org_id) != str(owner_org_id):
            raise HTTPException(status_code=403, detail="Access denied")
        with org_context(owner_org_id or org_id):
            return build_portfolio_overview(con, owner_client_db_id)


@router.get("/portal/portfolio-dashboard")
def get_portal_portfolio_dashboard(
    current_user: dict = Depends(portal_user_dep),
):
    owner_client_db_id = int(current_user["client_db_id"])
    with get_conn() as con:
        owner_row = con.execute(
            "SELECT status, org_id FROM clients WHERE db_id = %s",
            [owner_client_db_id],
        ).fetchone()
        if not owner_row:
            raise HTTPException(status_code=404, detail="Client not found")
        if str(owner_row[0] or "").strip().lower() != "portfolio owner":
            raise HTTPException(status_code=403, detail="This portal is only available to portfolio owners")
        org_id = str(owner_row[1]) if owner_row[1] else None
        with org_context(org_id):
            return build_portfolio_overview(con, owner_client_db_id)
