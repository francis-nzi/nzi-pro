from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends
from pydantic import BaseModel, Field

from api.auth import _current_user
from api.permissions import assert_job_access, assert_permission, require_permission
from core.database import get_conn
from services.permissions import ADMIN_ACCESS_PERMISSION
from services.report_actions import (
    action_term_options,
    get_job_report_actions_payload,
    list_report_action_options,
    replace_job_report_actions,
    upsert_report_action_option,
)

router = APIRouter(tags=["report-actions"])


def _actor_identifier(user: dict[str, Any] | None) -> str:
    if not isinstance(user, dict):
        return "system"
    return str(
        user.get("email")
        or user.get("user_id")
        or user.get("full_name")
        or "system"
    ).strip()


class ActionOptionPayload(BaseModel):
    action_name: str = Field(..., min_length=1)
    description: str | None = None
    action_term: str = "medium"
    action_category: str | None = None
    scope_focus: str | None = None
    sort_order: int = 0
    is_active: bool = True


class JobActionPayload(BaseModel):
    action_option_id: int | None = None
    action_name: str | None = None
    description: str | None = None
    action_term: str | None = None
    action_category: str | None = None
    scope_focus: str | None = None
    is_custom: bool | None = None
    sort_order: int | None = None


class SaveJobActionsPayload(BaseModel):
    items: list[JobActionPayload] = Field(default_factory=list)


@router.get("/admin/report-action-options")
def admin_list_report_action_options(
    include_inactive: bool = False,
    _user: dict = Depends(require_permission(ADMIN_ACCESS_PERMISSION)),
    _reporting_user: dict = Depends(require_permission("admin.reporting.manage")),
):
    with get_conn() as con:
        items = list_report_action_options(include_inactive=include_inactive, con=con)
    return {
        "items": items,
        "term_options": action_term_options(),
    }


@router.post("/admin/report-action-options")
def admin_create_report_action_option(
    payload: ActionOptionPayload = Body(...),
    _user: dict = Depends(require_permission(ADMIN_ACCESS_PERMISSION)),
    _reporting_user: dict = Depends(require_permission("admin.reporting.manage")),
):
    actor = _actor_identifier(_reporting_user)
    with get_conn(autocommit=False) as con:
        item = upsert_report_action_option(
            payload=payload.model_dump(),
            actor=actor,
            action_option_id=None,
            con=con,
        )
    return {"ok": True, "item": item}


@router.put("/admin/report-action-options/{action_option_id}")
def admin_update_report_action_option(
    action_option_id: int,
    payload: ActionOptionPayload = Body(...),
    _user: dict = Depends(require_permission(ADMIN_ACCESS_PERMISSION)),
    _reporting_user: dict = Depends(require_permission("admin.reporting.manage")),
):
    actor = _actor_identifier(_reporting_user)
    with get_conn(autocommit=False) as con:
        item = upsert_report_action_option(
            payload=payload.model_dump(),
            actor=actor,
            action_option_id=int(action_option_id),
            con=con,
        )
    return {"ok": True, "item": item}


@router.get("/jobs/{job_id}/report-actions")
def get_job_report_actions(
    job_id: int,
    _user: dict = Depends(_current_user),
):
    assert_permission(_user, "jobs.view")
    assert_job_access(_user, int(job_id))
    with get_conn() as con:
        return get_job_report_actions_payload(
            int(job_id),
            include_suggested_options=True,
            con=con,
        )


@router.put("/jobs/{job_id}/report-actions")
def save_job_report_actions(
    job_id: int,
    payload: SaveJobActionsPayload = Body(...),
    _user: dict = Depends(_current_user),
):
    assert_permission(_user, "jobs.edit")
    assert_job_access(_user, int(job_id))
    actor = _actor_identifier(_user)

    with get_conn(autocommit=False) as con:
        replace_job_report_actions(
            int(job_id),
            [item.model_dump() for item in payload.items],
            actor=actor,
            con=con,
        )
        response = get_job_report_actions_payload(
            int(job_id),
            include_suggested_options=True,
            con=con,
        )

    return {
        "ok": True,
        **response,
    }
