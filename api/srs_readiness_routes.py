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
    delete_assessment,
    finalise_assessment,
    get_client_srs_responses,
    get_srs_progression,
    get_srs_readiness_summary,
    list_assessments,
    list_srs_readiness_questions,
    save_client_srs_responses,
    start_assessment,
    update_assessment_meta,
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


class StartAssessmentPayload(BaseModel):
    period_year: int | None = None
    conducted_on: str | None = None
    label: str | None = None
    period_label: str | None = None


class UpdateAssessmentPayload(BaseModel):
    label: str | None = None
    period_year: int | None = None
    period_label: str | None = None
    conducted_on: str | None = None
    workshop_notes: str | None = None


def _assert_srs_access(user: dict[str, Any], client_db_id: int) -> None:
    if not (
        user_has_permission(user, "jobs.reporting.view")
        or user_has_permission(user, "jobs.view")
        or user_has_permission(user, "jobs.edit")
    ):
        assert_permission(user, "jobs.reporting.view")
    assert_client_access(user, int(client_db_id))


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


# ── Assessments (timestamped survey rounds) ───────────────────────────────────


@router.get("/clients/{client_db_id}/srs-readiness/assessments")
def list_client_srs_assessments(client_db_id: int, _user: dict = Depends(_current_user)):
    _assert_srs_access(_user, int(client_db_id))
    with get_conn() as con:
        return {"assessments": list_assessments(int(client_db_id), con=con)}


@router.post("/clients/{client_db_id}/srs-readiness/assessments")
def start_client_srs_assessment(
    client_db_id: int,
    payload: StartAssessmentPayload = Body(default=StartAssessmentPayload()),
    _user: dict = Depends(_current_user),
):
    _assert_srs_access(_user, int(client_db_id))
    if not (user_has_permission(_user, "jobs.reporting.view") or user_has_permission(_user, "jobs.edit")):
        assert_permission(_user, "jobs.reporting.view")
    actor = _actor_identifier(_user)
    with get_conn(autocommit=False) as con:
        assessment = start_assessment(
            int(client_db_id),
            period_year=payload.period_year,
            conducted_on=payload.conducted_on,
            label=payload.label,
            period_label=payload.period_label,
            actor=actor,
            con=con,
        )
    return {"ok": True, "assessment": assessment}


@router.put("/clients/{client_db_id}/srs-readiness/assessments/{assessment_id}")
def update_client_srs_assessment(
    client_db_id: int,
    assessment_id: int,
    payload: UpdateAssessmentPayload = Body(...),
    _user: dict = Depends(_current_user),
):
    _assert_srs_access(_user, int(client_db_id))
    if not (user_has_permission(_user, "jobs.reporting.view") or user_has_permission(_user, "jobs.edit")):
        assert_permission(_user, "jobs.reporting.view")
    actor = _actor_identifier(_user)
    with get_conn(autocommit=False) as con:
        assessment = update_assessment_meta(
            int(assessment_id), int(client_db_id),
            payload.model_dump(exclude_unset=True), actor=actor, con=con,
        )
    return {"ok": True, "assessment": assessment}


@router.post("/clients/{client_db_id}/srs-readiness/assessments/{assessment_id}/finalise")
def finalise_client_srs_assessment(
    client_db_id: int,
    assessment_id: int,
    _user: dict = Depends(_current_user),
):
    _assert_srs_access(_user, int(client_db_id))
    if not (user_has_permission(_user, "jobs.reporting.view") or user_has_permission(_user, "jobs.edit")):
        assert_permission(_user, "jobs.reporting.view")
    actor = _actor_identifier(_user)
    with get_conn(autocommit=False) as con:
        assessment = finalise_assessment(int(assessment_id), int(client_db_id), actor=actor, con=con)
        summary = get_srs_readiness_summary(int(client_db_id), con=con)
    return {"ok": True, "assessment": assessment, "summary": summary}


@router.delete("/clients/{client_db_id}/srs-readiness/assessments/{assessment_id}")
def delete_client_srs_assessment(
    client_db_id: int,
    assessment_id: int,
    _user: dict = Depends(_current_user),
):
    _assert_srs_access(_user, int(client_db_id))
    if not (user_has_permission(_user, "jobs.reporting.view") or user_has_permission(_user, "jobs.edit")):
        assert_permission(_user, "jobs.reporting.view")
    with get_conn(autocommit=False) as con:
        delete_assessment(int(assessment_id), int(client_db_id), con=con)
        summary = get_srs_readiness_summary(int(client_db_id), con=con)
    return {"ok": True, "summary": summary}


@router.get("/clients/{client_db_id}/srs-readiness/progression")
def client_srs_progression(client_db_id: int, _user: dict = Depends(_current_user)):
    _assert_srs_access(_user, int(client_db_id))
    with get_conn() as con:
        return get_srs_progression(int(client_db_id), con=con)
