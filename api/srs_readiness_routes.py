from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends
from pydantic import BaseModel, Field

from api.auth import _current_user
from api.permissions import assert_client_access, assert_permission, require_permission
from core.database import get_conn
from services.permissions import ADMIN_ACCESS_PERMISSION, user_has_permission
from services.srs_readiness import (
    SRS_READINESS_SECTIONS,
    get_client_srs_responses,
    get_srs_readiness_summary,
    list_srs_readiness_questions,
    save_client_srs_responses,
    upsert_srs_readiness_question,
)

router = APIRouter(tags=["srs-readiness"])


def _actor_identifier(user: dict[str, Any] | None) -> str:
    if not isinstance(user, dict):
        return "system"
    return str(user.get("email") or user.get("user_id") or user.get("full_name") or "system").strip()


class SrsQuestionPayload(BaseModel):
    section: str = Field(..., min_length=1)
    theme: str | None = None
    question_text: str = Field(..., min_length=1)
    evidence_examples: str | None = None
    is_active: bool = True
    sort_order: int = 0


class SrsResponseItem(BaseModel):
    question_id: int
    score: int | None = None
    evidence_notes: str | None = None
    priority: str | None = None
    owner: str | None = None
    target_date: str | None = None
    status: str | None = None


class SaveSrsResponsesPayload(BaseModel):
    items: list[SrsResponseItem] = Field(default_factory=list)


@router.get("/admin/srs-readiness-questions")
def admin_list_srs_readiness_questions(
    include_inactive: bool = False,
    _user: dict = Depends(require_permission(ADMIN_ACCESS_PERMISSION)),
    _reporting_user: dict = Depends(require_permission("admin.reporting.manage")),
):
    with get_conn() as con:
        items = list_srs_readiness_questions(include_inactive=include_inactive, con=con)
    return {"items": items, "sections": SRS_READINESS_SECTIONS}


@router.post("/admin/srs-readiness-questions")
def admin_create_srs_readiness_question(
    payload: SrsQuestionPayload = Body(...),
    _user: dict = Depends(require_permission(ADMIN_ACCESS_PERMISSION)),
    _reporting_user: dict = Depends(require_permission("admin.reporting.manage")),
):
    actor = _actor_identifier(_reporting_user)
    with get_conn(autocommit=False) as con:
        item = upsert_srs_readiness_question(payload=payload.model_dump(), actor=actor, question_id=None, con=con)
    return {"ok": True, "item": item}


@router.put("/admin/srs-readiness-questions/{question_id}")
def admin_update_srs_readiness_question(
    question_id: int,
    payload: SrsQuestionPayload = Body(...),
    _user: dict = Depends(require_permission(ADMIN_ACCESS_PERMISSION)),
    _reporting_user: dict = Depends(require_permission("admin.reporting.manage")),
):
    actor = _actor_identifier(_reporting_user)
    with get_conn(autocommit=False) as con:
        item = upsert_srs_readiness_question(payload=payload.model_dump(), actor=actor, question_id=int(question_id), con=con)
    return {"ok": True, "item": item}


@router.get("/clients/{client_db_id}/srs-readiness")
def client_srs_readiness(
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
        responses = get_client_srs_responses(int(client_db_id), con=con)
        summary = get_srs_readiness_summary(int(client_db_id), con=con)
    return {**responses, "summary": summary}


@router.put("/clients/{client_db_id}/srs-readiness")
def save_client_srs_readiness(
    client_db_id: int,
    payload: SaveSrsResponsesPayload = Body(...),
    _user: dict = Depends(_current_user),
):
    if not (user_has_permission(_user, "jobs.reporting.view") or user_has_permission(_user, "jobs.edit")):
        assert_permission(_user, "jobs.reporting.view")
    assert_client_access(_user, int(client_db_id))
    actor = _actor_identifier(_user)
    with get_conn(autocommit=False) as con:
        responses = save_client_srs_responses(
            int(client_db_id),
            [item.model_dump() for item in payload.items],
            actor=actor,
            con=con,
        )
        summary = get_srs_readiness_summary(int(client_db_id), con=con)
    return {**responses, "summary": summary}
