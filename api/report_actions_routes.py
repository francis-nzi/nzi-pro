from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends
from pydantic import BaseModel, Field

from api.auth import _current_user
from api.permissions import assert_client_access, assert_permission, require_permission
from core.database import get_conn
from services.permissions import ADMIN_ACCESS_PERMISSION, user_has_permission
from services.report_actions import (
    action_term_options,
    create_custom_lever,
    get_action_lever_summary,
    get_client_report_actions_payload,
    list_action_levers,
    list_report_action_options,
    replace_client_report_actions,
    update_client_action,
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
    is_default: bool = False
    lever_id: int


class ClientActionPayload(BaseModel):
    client_action_id: int | None = None
    action_option_id: int | None = None
    action_name: str | None = None
    description: str | None = None
    action_term: str | None = None
    action_category: str | None = None
    scope_focus: str | None = None
    lever_id: int | None = None
    is_custom: bool | None = None
    sort_order: int | None = None
    status: str | None = None
    progress: int | None = None
    target_date: str | None = None
    owner_contact_id: int | None = None


class UpdateClientActionPayload(BaseModel):
    status: str | None = None
    progress: int | None = None
    target_date: str | None = None
    owner_contact_id: int | None = None
    lever_id: int | None = None
    note: str | None = None


class SaveClientActionsPayload(BaseModel):
    items: list[ClientActionPayload] = Field(default_factory=list)


class CustomLeverPayload(BaseModel):
    lever_name: str = Field(..., min_length=1)
    lever_description: str | None = None


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


@router.get("/admin/action-levers")
def admin_list_action_levers(
    include_inactive: bool = False,
    _user: dict = Depends(require_permission(ADMIN_ACCESS_PERMISSION)),
    _reporting_user: dict = Depends(require_permission("admin.reporting.manage")),
):
    with get_conn() as con:
        items = list_action_levers(include_inactive=include_inactive, con=con)
    return {"items": items}


@router.post("/admin/action-levers")
def admin_create_custom_lever(
    payload: CustomLeverPayload = Body(...),
    _user: dict = Depends(require_permission(ADMIN_ACCESS_PERMISSION)),
    _reporting_user: dict = Depends(require_permission("admin.reporting.manage")),
):
    actor = _actor_identifier(_reporting_user)
    with get_conn(autocommit=False) as con:
        item = create_custom_lever(
            name=payload.lever_name,
            description=payload.lever_description,
            actor=actor,
            con=con,
        )
    return {"ok": True, "item": item}


@router.get("/clients/{client_db_id}/action-lever-summary")
def client_action_lever_summary(
    client_db_id: int,
    _user: dict = Depends(_current_user),
):
    if not (
        user_has_permission(_user, "jobs.reporting.view")
        or user_has_permission(_user, "jobs.view")
        or user_has_permission(_user, "jobs.edit")
    ):
        assert_permission(_user, "jobs.reporting.view")
    assert_client_access(_user, int(client_db_id))
    with get_conn() as con:
        return get_action_lever_summary(int(client_db_id), con=con)


@router.get("/clients/{client_db_id}/report-actions")
def get_client_report_actions(
    client_db_id: int,
    _user: dict = Depends(_current_user),
):
    # Reporting users may need to see the action library even if they are not
    # full job editors, so allow reporting view, job view, or job edit access.
    if not (
        user_has_permission(_user, "jobs.reporting.view")
        or user_has_permission(_user, "jobs.view")
        or user_has_permission(_user, "jobs.edit")
    ):
        assert_permission(_user, "jobs.reporting.view")
    assert_client_access(_user, int(client_db_id))
    with get_conn() as con:
        return get_client_report_actions_payload(
            int(client_db_id),
            include_suggested_options=True,
            con=con,
        )


@router.put("/clients/{client_db_id}/report-actions")
def save_client_report_actions(
    client_db_id: int,
    payload: SaveClientActionsPayload = Body(...),
    _user: dict = Depends(_current_user),
):
    assert_permission(_user, "jobs.edit")
    assert_client_access(_user, int(client_db_id))
    actor = _actor_identifier(_user)

    with get_conn(autocommit=False) as con:
        replace_client_report_actions(
            int(client_db_id),
            [item.model_dump() for item in payload.items],
            actor=actor,
            con=con,
        )
        response = get_client_report_actions_payload(
            int(client_db_id),
            include_suggested_options=True,
            con=con,
        )

    return {
        "ok": True,
        **response,
    }


@router.patch("/clients/{client_db_id}/report-actions/{client_action_id}")
def patch_client_report_action(
    client_db_id: int,
    client_action_id: int,
    payload: UpdateClientActionPayload = Body(...),
    _user: dict = Depends(_current_user),
):
    assert_permission(_user, "jobs.edit")
    assert_client_access(_user, int(client_db_id))
    actor = _actor_identifier(_user)
    with get_conn(autocommit=False) as con:
        item = update_client_action(
            int(client_db_id),
            int(client_action_id),
            payload=payload.model_dump(exclude_unset=True),
            actor=actor,
            source="crm",
            con=con,
        )
    return {"ok": True, "item": item}
