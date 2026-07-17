from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from api.auth import _current_user
from api.permissions import assert_permission
from core.database import get_conn
from services.portfolio import build_portfolio_overview
from services.tenancy import org_context, require_org

router = APIRouter(tags=["portfolio"])
logger = logging.getLogger(__name__)


def _owner_org_id(con, owner_client_db_id: int) -> str | None:
    try:
        row = con.execute(
            "SELECT org_id FROM clients WHERE db_id = %s",
            [int(owner_client_db_id)],
        ).fetchone()
    except Exception:
        logger.exception("Unable to resolve portfolio owner org_id for client %s", owner_client_db_id)
        return None
    return str(row[0]) if row and row[0] else None


@router.get("/admin/portfolio-owners/{owner_client_db_id}")
def get_portfolio_owner_overview(
    owner_client_db_id: int,
    _user: dict[str, str] = Depends(_current_user),
):
    assert_permission(_user, "clients.view")
    with get_conn() as con:
        org_id = require_org(_user)
        owner_org_id = _owner_org_id(con, owner_client_db_id)
        if org_id and owner_org_id and str(org_id) != str(owner_org_id):
            raise HTTPException(status_code=403, detail="Access denied")
        try:
            with org_context(owner_org_id or org_id):
                return build_portfolio_overview(con, owner_client_db_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc) or "Portfolio owner not found") from exc
