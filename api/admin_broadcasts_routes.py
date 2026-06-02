"""Admin routes for the portal broadcasting system.

Broadcasts appear in the portal status bar and can be:
- global: visible to all clients
- client: visible to a single targeted client

Requires admin.access permission.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field

from api.auth import _current_user
from api.permissions import assert_permission
from core.database import get_conn

router = APIRouter(tags=["admin-broadcasts"])
logger = logging.getLogger(__name__)


def _actor(user: dict) -> str:
    return str(user.get("email") or user.get("user_id") or "system").strip()


def _row_to_broadcast(row) -> dict[str, Any]:
    def _dt(v):
        try: return v.isoformat() if v else None
        except Exception: return None
    return {
        "broadcast_id": int(row[0]),
        "title": str(row[1] or "") or None,
        "message": str(row[2] or ""),
        "broadcast_type": str(row[3] or "global"),
        "target_client_db_id": int(row[4]) if row[4] is not None else None,
        "target_client_name": str(row[5] or "") or None,
        "style": str(row[6] or "info"),
        "link_url": str(row[7] or "") or None,
        "link_label": str(row[8] or "") or None,
        "is_active": bool(row[9]),
        "active_from": _dt(row[10]),
        "active_until": _dt(row[11]),
        "created_by": str(row[12] or ""),
        "created_at": _dt(row[13]),
        "deactivated_at": _dt(row[14]),
        "deactivated_by": str(row[15] or "") or None,
    }


_SELECT = """
    SELECT pb.broadcast_id, pb.title, pb.message, pb.broadcast_type,
           pb.target_client_db_id, c.client_name AS target_client_name,
           pb.style, pb.link_url, pb.link_label, pb.is_active,
           pb.active_from, pb.active_until, pb.created_by, pb.created_at,
           pb.deactivated_at, pb.deactivated_by
    FROM portal_broadcasts pb
    LEFT JOIN clients c ON c.db_id = pb.target_client_db_id
"""


@router.get("/admin/portal-broadcasts")
def list_broadcasts(
    include_inactive: bool = False,
    _user: dict = Depends(_current_user),
):
    assert_permission(_user, "admin.access")
    with get_conn() as con:
        where = "" if include_inactive else "WHERE pb.is_active = TRUE"
        rows = con.execute(
            f"{_SELECT} {where} ORDER BY pb.created_at DESC LIMIT 200"
        ).fetchall()
    return {"ok": True, "items": [_row_to_broadcast(r) for r in (rows or [])]}


class CreateBroadcastPayload(BaseModel):
    title: str | None = None
    message: str = Field(..., min_length=1, max_length=500)
    broadcast_type: str = Field(default="global", pattern="^(global|client)$")
    target_client_db_id: int | None = None
    style: str = Field(default="info", pattern="^(info|warning|success|promo)$")
    link_url: str | None = None
    link_label: str | None = None
    active_from: str | None = None   # ISO datetime string, optional
    active_until: str | None = None  # ISO datetime string, optional


@router.post("/admin/portal-broadcasts")
def create_broadcast(
    payload: CreateBroadcastPayload = Body(...),
    _user: dict = Depends(_current_user),
):
    assert_permission(_user, "admin.access")
    actor = _actor(_user)

    if payload.broadcast_type == "client" and not payload.target_client_db_id:
        raise HTTPException(status_code=400, detail="target_client_db_id is required for client broadcasts")

    with get_conn(autocommit=False) as con:
        row = con.execute(
            """
            INSERT INTO portal_broadcasts
                (title, message, broadcast_type, target_client_db_id, style,
                 link_url, link_label, active_from, active_until, created_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING broadcast_id
            """,
            [
                payload.title or None,
                payload.message.strip(),
                payload.broadcast_type,
                payload.target_client_db_id,
                payload.style,
                payload.link_url or None,
                payload.link_label or None,
                payload.active_from or None,
                payload.active_until or None,
                actor,
            ],
        ).fetchone()
        broadcast_id = int(row[0])
        result = con.execute(f"{_SELECT} WHERE pb.broadcast_id = %s", [broadcast_id]).fetchone()

    logger.info("create_broadcast: id=%s by=%s type=%s", broadcast_id, actor, payload.broadcast_type)
    return {"ok": True, "item": _row_to_broadcast(result)}


class UpdateBroadcastPayload(BaseModel):
    title: str | None = None
    message: str | None = None
    style: str | None = None
    link_url: str | None = None
    link_label: str | None = None
    active_from: str | None = None
    active_until: str | None = None
    is_active: bool | None = None


@router.patch("/admin/portal-broadcasts/{broadcast_id}")
def update_broadcast(
    broadcast_id: int,
    payload: UpdateBroadcastPayload = Body(...),
    _user: dict = Depends(_current_user),
):
    assert_permission(_user, "admin.access")
    actor = _actor(_user)

    with get_conn(autocommit=False) as con:
        existing = con.execute(
            "SELECT broadcast_id, is_active FROM portal_broadcasts WHERE broadcast_id = %s",
            [int(broadcast_id)],
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Broadcast not found")

        sets = ["updated_at = NOW()"]
        params: list = []

        if payload.message is not None:
            sets.append("message = %s"); params.append(payload.message.strip())
        if payload.title is not None:
            sets.append("title = %s"); params.append(payload.title or None)
        if payload.style is not None:
            sets.append("style = %s"); params.append(payload.style)
        if payload.link_url is not None:
            sets.append("link_url = %s"); params.append(payload.link_url or None)
        if payload.link_label is not None:
            sets.append("link_label = %s"); params.append(payload.link_label or None)
        if payload.active_from is not None:
            sets.append("active_from = %s"); params.append(payload.active_from or None)
        if payload.active_until is not None:
            sets.append("active_until = %s"); params.append(payload.active_until or None)
        if payload.is_active is not None:
            sets.append("is_active = %s"); params.append(payload.is_active)
            if not payload.is_active and bool(existing[1]):
                sets.append("deactivated_at = NOW()"); sets.append("deactivated_by = %s"); params.append(actor)

        params.append(int(broadcast_id))
        con.execute(f"UPDATE portal_broadcasts SET {', '.join(sets)} WHERE broadcast_id = %s", params)
        result = con.execute(f"{_SELECT} WHERE pb.broadcast_id = %s", [int(broadcast_id)]).fetchone()

    return {"ok": True, "item": _row_to_broadcast(result)}


@router.delete("/admin/portal-broadcasts/{broadcast_id}")
def delete_broadcast(
    broadcast_id: int,
    _user: dict = Depends(_current_user),
):
    assert_permission(_user, "admin.access")
    with get_conn() as con:
        existing = con.execute(
            "SELECT broadcast_id FROM portal_broadcasts WHERE broadcast_id = %s",
            [int(broadcast_id)],
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Broadcast not found")
        con.execute("DELETE FROM portal_broadcasts WHERE broadcast_id = %s", [int(broadcast_id)])
    logger.info("delete_broadcast: id=%s by=%s", broadcast_id, _actor(_user))
    return {"ok": True}
