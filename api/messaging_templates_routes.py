from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from api.auth import _current_user
from api.permissions import require_permission
from core.database import get_conn
from services.messaging_templates import (
    ensure_message_template_tables,
    list_templates,
    resolve_template,
    render_template_text,
)
from services.permissions import ADMIN_ACCESS_PERMISSION

router = APIRouter(
    tags=["messaging-templates"],
    dependencies=[Depends(require_permission(ADMIN_ACCESS_PERMISSION))],
)


@router.get("/admin/message-templates")
def get_message_templates(
    channel: str = Query(default="email"),
    _user: dict = Depends(_current_user),
):
    try:
        with get_conn() as con:
            ensure_message_template_tables(con)
            return {"items": list_templates(con, channel=channel)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list message templates: {e}")


@router.post("/admin/message-templates")
def create_message_template(body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        key = str(body.get("template_key") or "").strip()
        if not key:
            raise HTTPException(status_code=400, detail="template_key is required")

        with get_conn() as con:
            ensure_message_template_tables(con)
            con.execute(
                """
                INSERT INTO message_templates (
                  template_key, template_name, channel, message_type,
                  subject_template, body_template, is_active, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                """,
                [
                    key,
                    str(body.get("template_name") or "").strip() or None,
                    str(body.get("channel") or "email").strip() or "email",
                    str(body.get("message_type") or "general").strip() or "general",
                    str(body.get("subject_template") or "").strip(),
                    str(body.get("body_template") or "").strip(),
                    bool(body.get("is_active", True)),
                ],
            )
            row = con.execute(
                "SELECT template_id FROM message_templates WHERE lower(template_key) = lower(%s) ORDER BY template_id DESC LIMIT 1",
                [key],
            ).fetchone()
            template_id = int(row[0]) if row and row[0] is not None else None
            return {"ok": True, "template_id": template_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create message template: {e}")


@router.patch("/admin/message-templates/{template_id}")
def update_message_template(template_id: int, body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        with get_conn() as con:
            ensure_message_template_tables(con)
            exists = con.execute("SELECT template_id FROM message_templates WHERE template_id = %s", [int(template_id)]).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="Template not found")

            updates: list[str] = []
            params: list[Any] = []
            for key in ("template_key", "template_name", "channel", "message_type", "subject_template", "body_template"):
                if key in body:
                    updates.append(f"{key} = %s")
                    value = body.get(key)
                    if value is None:
                        params.append(None)
                    else:
                        params.append(str(value).strip())
            if "is_active" in body:
                updates.append("is_active = %s")
                params.append(bool(body.get("is_active")))
            if not updates:
                return {"ok": True, "message": "No fields to update"}

            updates.append("updated_at = NOW()")
            params.append(int(template_id))
            con.execute(f"UPDATE message_templates SET {', '.join(updates)} WHERE template_id = %s", params)
            return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update message template: {e}")


@router.post("/admin/message-templates/{template_key}/preview")
def preview_message_template(template_key: str, body: dict = Body(default={}), _user: dict = Depends(_current_user)):
    try:
        context = body.get("context") or {}
        if not isinstance(context, dict):
            raise HTTPException(status_code=400, detail="context must be an object")
        with get_conn() as con:
            tpl = resolve_template(con, template_key)
            if not tpl:
                raise HTTPException(status_code=404, detail="Template not found")
            return {
                "template_key": tpl["template_key"],
                "subject": render_template_text(str(tpl.get("subject_template") or ""), context),
                "body_html": render_template_text(str(tpl.get("body_template") or ""), context),
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to preview template: {e}")
