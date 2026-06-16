"""
AI prompt management and preview endpoints.

This is the first backend slice of the governed AI prompt system.
It intentionally starts with schema-backed preview and lightweight CRUD,
without wiring any current generation flows over yet.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from api.auth import _current_user
from api.permissions import assert_client_access, assert_job_access, assert_permission
from core.database import get_conn
from services.ai_prompt_compiler import compile_prompt
from services.ai_prompt_registry import (
    get_report_family_definition,
    is_supported_section,
    normalize_report_family_key,
    normalize_section_key,
)
from services.ai_prompt_schema import GLOBAL_TEMPLATE_ORG_ID, ensure_ai_prompt_schema
from services.tenancy import require_org

router = APIRouter(tags=["ai-prompts"])


def _ensure_schema() -> None:
    with get_conn() as con:
        ensure_ai_prompt_schema(con)


class AiPromptTemplateCreate(BaseModel):
    prompt_key: str | None = None
    report_family_key: str
    section_key: str
    name: str
    description: str | None = None
    scope: str = "global"
    system_prompt: str
    user_prompt: str
    variables_json: dict[str, Any] | None = None
    model_hint: str | None = None
    temperature: float | None = None
    status: str = "draft"
    client_db_id: int | None = None


class AiClientPromptProfileCreate(BaseModel):
    profile_name: str
    industry_context: str | None = None
    company_context: str | None = None
    tone: str | None = None
    audience_notes: str | None = None
    preferred_terms_json: dict[str, Any] | list[Any] | None = None
    forbidden_terms_json: dict[str, Any] | list[Any] | None = None
    narrative_notes: str | None = None
    section_notes_json: dict[str, Any] | None = None
    status: str = "draft"


class AiJobPromptOverrideCreate(BaseModel):
    report_family_key: str
    section_key: str
    override_title: str
    instruction_text: str | None = None
    variables_json: dict[str, Any] | None = None
    status: str = "draft"


class AiPromptPreviewRequest(BaseModel):
    report_family_key: str
    section_key: str
    client_db_id: int | None = None
    job_id: int | None = None
    template_id: int | None = None
    facts: dict[str, Any] | None = None


def _json_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, default=str)
    except Exception:
        return json.dumps(str(value))


def _row_to_template(row) -> dict[str, Any]:
    return {
        "template_id": int(row[0]),
        "org_id": str(row[1]),
        "prompt_key": str(row[2]),
        "report_family_key": str(row[3]),
        "section_key": str(row[4]),
        "name": str(row[5] or ""),
        "description": str(row[6] or ""),
        "scope": str(row[7] or "global"),
        "system_prompt": str(row[8] or ""),
        "user_prompt": str(row[9] or ""),
        "variables_json": json.loads(row[10]) if row[10] else {},
        "model_hint": str(row[11] or ""),
        "temperature": float(row[12]) if row[12] is not None else None,
        "status": str(row[13] or "draft"),
        "version": int(row[14] or 1),
        "parent_template_id": int(row[15]) if row[15] is not None else None,
        "created_by_user_id": str(row[16] or ""),
        "created_at": row[17],
        "updated_at": row[18],
        "archived_at": row[19],
    }


def _row_to_profile(row) -> dict[str, Any]:
    return {
        "profile_id": int(row[0]),
        "org_id": str(row[1]),
        "client_db_id": int(row[2]),
        "profile_name": str(row[3] or ""),
        "industry_context": str(row[4] or ""),
        "company_context": str(row[5] or ""),
        "tone": str(row[6] or ""),
        "audience_notes": str(row[7] or ""),
        "preferred_terms_json": json.loads(row[8]) if row[8] else {},
        "forbidden_terms_json": json.loads(row[9]) if row[9] else {},
        "narrative_notes": str(row[10] or ""),
        "section_notes_json": json.loads(row[11]) if row[11] else {},
        "status": str(row[12] or "draft"),
        "version": int(row[13] or 1),
        "created_by_user_id": str(row[14] or ""),
        "created_at": row[15],
        "updated_at": row[16],
    }


def _row_to_override(row) -> dict[str, Any]:
    return {
        "override_id": int(row[0]),
        "org_id": str(row[1]),
        "job_id": int(row[2]),
        "report_family_key": str(row[3]),
        "section_key": str(row[4]),
        "override_title": str(row[5] or ""),
        "instruction_text": str(row[6] or ""),
        "variables_json": json.loads(row[7]) if row[7] else {},
        "status": str(row[8] or "draft"),
        "version": int(row[9] or 1),
        "created_by_user_id": str(row[10] or ""),
        "created_at": row[11],
        "updated_at": row[12],
    }


def _deactivate_sibling_versions(con, *, table_name: str, where_sql: str, params: list[Any]) -> None:
    con.execute(
        f"""
        UPDATE {table_name}
        SET status = CASE WHEN status = 'active' THEN 'draft' ELSE status END,
            updated_at = NOW()
        WHERE {where_sql}
        """,
        params,
    )


def _get_template_row(con, template_id: int) -> dict[str, Any] | None:
    row = con.execute(
        """
        SELECT
          template_id, org_id, prompt_key, report_family_key, section_key, name,
          description, scope, system_prompt, user_prompt, variables_json,
          model_hint, temperature, status, version, parent_template_id,
          created_by_user_id, created_at, updated_at, archived_at
        FROM ai_prompt_templates
        WHERE template_id = %s
        LIMIT 1
        """,
        [int(template_id)],
    ).fetchone()
    return _row_to_template(row) if row else None


def _get_latest_profile_row(con, org_id: str, client_db_id: int) -> dict[str, Any] | None:
    row = con.execute(
        """
        SELECT
          profile_id, org_id, client_db_id, profile_name, industry_context, company_context,
          tone, audience_notes, preferred_terms_json, forbidden_terms_json,
          narrative_notes, section_notes_json, status, version, created_by_user_id,
          created_at, updated_at
        FROM ai_client_prompt_profiles
        WHERE org_id = %s AND client_db_id = %s
        ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, version DESC, profile_id DESC
        LIMIT 1
        """,
        [org_id, int(client_db_id)],
    ).fetchone()
    return _row_to_profile(row) if row else None


def _get_latest_override_row(con, org_id: str, job_id: int, report_family_key: str, section_key: str) -> dict[str, Any] | None:
    row = con.execute(
        """
        SELECT
          override_id, org_id, job_id, report_family_key, section_key, override_title,
          instruction_text, variables_json, status, version, created_by_user_id,
          created_at, updated_at
        FROM ai_job_prompt_overrides
        WHERE org_id = %s
          AND job_id = %s
          AND report_family_key = %s
          AND section_key = %s
        ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, version DESC, override_id DESC
        LIMIT 1
        """,
        [org_id, int(job_id), report_family_key, section_key],
    ).fetchone()
    return _row_to_override(row) if row else None


@router.get("/ai-prompts/templates")
def list_ai_prompt_templates(
    report_family_key: str | None = Query(default=None),
    section_key: str | None = Query(default=None),
    status: str | None = Query(default=None),
    _user: dict[str, str] = Depends(_current_user),
):
    assert_permission(_user, "admin.reporting.manage")
    org_id = require_org(_user)
    _ensure_schema()
    with get_conn() as con:
        rows = con.execute(
            """
            SELECT
              template_id, org_id, prompt_key, report_family_key, section_key, name,
              description, scope, system_prompt, user_prompt, variables_json,
              model_hint, temperature, status, version, parent_template_id,
              created_by_user_id, created_at, updated_at, archived_at
            FROM ai_prompt_templates
            WHERE org_id IN (%s, %s)
            ORDER BY prompt_key ASC, version DESC, template_id DESC
            """,
            [org_id, GLOBAL_TEMPLATE_ORG_ID],
        ).fetchall()

    payload = [_row_to_template(row) for row in rows or []]
    if report_family_key:
        payload = [item for item in payload if normalize_report_family_key(item["report_family_key"]) == normalize_report_family_key(report_family_key)]
    if section_key:
        payload = [item for item in payload if normalize_section_key(item["section_key"]) == normalize_section_key(section_key)]
    if status:
        payload = [item for item in payload if str(item["status"]).lower() == str(status).lower()]
    return {"templates": payload}


@router.post("/ai-prompts/templates")
def create_ai_prompt_template(
    payload: AiPromptTemplateCreate,
    _user: dict[str, str] = Depends(_current_user),
):
    assert_permission(_user, "admin.reporting.manage")
    org_id = require_org(_user)
    _ensure_schema()

    report_family_key = normalize_report_family_key(payload.report_family_key)
    section_key = normalize_section_key(payload.section_key)
    if not get_report_family_definition(report_family_key):
        raise HTTPException(status_code=400, detail=f"Unsupported report_family_key='{payload.report_family_key}'")
    if not is_supported_section(section_key, report_family_key):
        raise HTTPException(status_code=400, detail=f"Unsupported section_key='{payload.section_key}' for family='{report_family_key}'")

    prompt_key = str(payload.prompt_key or f"{report_family_key}.{section_key}").strip()
    template_org_id = GLOBAL_TEMPLATE_ORG_ID if str(payload.scope or "global").lower() == "global" else org_id

    with get_conn() as con:
        next_version_row = con.execute(
            """
            SELECT COALESCE(MAX(version), 0) + 1
            FROM ai_prompt_templates
            WHERE org_id = %s AND prompt_key = %s
            """,
            [template_org_id, prompt_key],
        ).fetchone()
        next_version = int(next_version_row[0] if next_version_row else 1)

        row = con.execute(
            """
            INSERT INTO ai_prompt_templates (
              org_id, prompt_key, report_family_key, section_key, name, description,
              scope, system_prompt, user_prompt, variables_json, model_hint, temperature,
              status, version, created_by_user_id, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
            RETURNING
              template_id, org_id, prompt_key, report_family_key, section_key, name,
              description, scope, system_prompt, user_prompt, variables_json,
              model_hint, temperature, status, version, parent_template_id,
              created_by_user_id, created_at, updated_at, archived_at
            """,
            [
                template_org_id,
                prompt_key,
                report_family_key,
                section_key,
                payload.name,
                payload.description,
                str(payload.scope or "global").lower(),
                payload.system_prompt,
                payload.user_prompt,
                _json_text(payload.variables_json),
                payload.model_hint,
                payload.temperature,
                str(payload.status or "draft").lower(),
                next_version,
                _user.get("user_id") or _user.get("id") or _user.get("email") or "system",
            ],
        ).fetchone()
        if str(payload.status or "draft").lower() == "active":
            _deactivate_sibling_versions(
                con,
                table_name="ai_prompt_templates",
                where_sql="org_id = %s AND prompt_key = %s AND template_id <> %s",
                params=[template_org_id, prompt_key, int(row[0])],
            )

    return {"template": _row_to_template(row)}


@router.get("/ai-prompts/templates/{template_id}")
def get_ai_prompt_template(template_id: int, _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "admin.reporting.manage")
    _ensure_schema()
    with get_conn() as con:
        row = _get_template_row(con, int(template_id))
    if row is None:
        raise HTTPException(status_code=404, detail="AI prompt template not found")
    return {"template": row}


@router.post("/ai-prompts/templates/{template_id}/activate")
def activate_ai_prompt_template(template_id: int, _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "admin.reporting.manage")
    _ensure_schema()
    with get_conn() as con:
        template = _get_template_row(con, int(template_id))
        if template is None:
            raise HTTPException(status_code=404, detail="AI prompt template not found")
        con.execute(
            """
            UPDATE ai_prompt_templates
            SET status = CASE WHEN template_id = %s THEN 'active' ELSE 'draft' END,
                updated_at = NOW()
            WHERE org_id = %s
              AND prompt_key = %s
            """,
            [int(template_id), template["org_id"], template["prompt_key"]],
        )
    return {"ok": True, "template_id": int(template_id)}


@router.get("/ai-prompts/templates/{template_id}/versions")
def list_ai_prompt_template_versions(template_id: int, _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "admin.reporting.manage")
    _ensure_schema()
    with get_conn() as con:
        template = _get_template_row(con, int(template_id))
        if template is None:
            raise HTTPException(status_code=404, detail="AI prompt template not found")
        rows = con.execute(
            """
            SELECT
              template_id, org_id, prompt_key, report_family_key, section_key, name,
              description, scope, system_prompt, user_prompt, variables_json,
              model_hint, temperature, status, version, parent_template_id,
              created_by_user_id, created_at, updated_at, archived_at
            FROM ai_prompt_templates
            WHERE org_id = %s
              AND prompt_key = %s
            ORDER BY version DESC, template_id DESC
            """,
            [template["org_id"], template["prompt_key"]],
        ).fetchall()
    return {"templates": [_row_to_template(row) for row in rows or []]}


@router.get("/clients/{client_db_id}/ai-prompt-profile")
def get_ai_prompt_profile(client_db_id: int, _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "clients.view")
    assert_client_access(_user, int(client_db_id))
    org_id = require_org(_user)
    _ensure_schema()
    with get_conn() as con:
        row = _get_latest_profile_row(con, org_id, int(client_db_id))
    if row is None:
        return {"profile": None}
    return {"profile": row}


@router.post("/clients/{client_db_id}/ai-prompt-profile")
def create_ai_prompt_profile(
    client_db_id: int,
    payload: AiClientPromptProfileCreate,
    _user: dict[str, str] = Depends(_current_user),
):
    assert_permission(_user, "clients.edit")
    assert_client_access(_user, int(client_db_id))
    org_id = require_org(_user)
    _ensure_schema()
    with get_conn() as con:
        next_version_row = con.execute(
            """
            SELECT COALESCE(MAX(version), 0) + 1
            FROM ai_client_prompt_profiles
            WHERE org_id = %s AND client_db_id = %s
            """,
            [org_id, int(client_db_id)],
        ).fetchone()
        next_version = int(next_version_row[0] if next_version_row else 1)
        row = con.execute(
            """
            INSERT INTO ai_client_prompt_profiles (
              org_id, client_db_id, profile_name, industry_context, company_context,
              tone, audience_notes, preferred_terms_json, forbidden_terms_json,
              narrative_notes, section_notes_json, status, version,
              created_by_user_id, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
            RETURNING
              profile_id, org_id, client_db_id, profile_name, industry_context, company_context,
              tone, audience_notes, preferred_terms_json, forbidden_terms_json,
              narrative_notes, section_notes_json, status, version, created_by_user_id,
              created_at, updated_at
            """,
            [
                org_id,
                int(client_db_id),
                payload.profile_name,
                payload.industry_context,
                payload.company_context,
                payload.tone,
                payload.audience_notes,
                _json_text(payload.preferred_terms_json),
                _json_text(payload.forbidden_terms_json),
                payload.narrative_notes,
                _json_text(payload.section_notes_json),
                str(payload.status or "draft").lower(),
                next_version,
                _user.get("user_id") or _user.get("id") or _user.get("email") or "system",
            ],
        ).fetchone()
        if str(payload.status or "draft").lower() == "active":
            _deactivate_sibling_versions(
                con,
                table_name="ai_client_prompt_profiles",
                where_sql="org_id = %s AND client_db_id = %s AND profile_id <> %s",
                params=[org_id, int(client_db_id), int(row[0])],
            )
    return {"profile": _row_to_profile(row)}


@router.get("/jobs/{job_id}/ai-prompt-overrides")
def list_ai_prompt_overrides(
    job_id: int,
    report_family_key: str | None = Query(default=None),
    section_key: str | None = Query(default=None),
    _user: dict[str, str] = Depends(_current_user),
):
    assert_permission(_user, "jobs.view")
    assert_job_access(_user, int(job_id))
    org_id = require_org(_user)
    _ensure_schema()
    with get_conn() as con:
        rows = con.execute(
            """
            SELECT
              override_id, org_id, job_id, report_family_key, section_key, override_title,
              instruction_text, variables_json, status, version, created_by_user_id,
              created_at, updated_at
            FROM ai_job_prompt_overrides
            WHERE org_id = %s AND job_id = %s
            ORDER BY report_family_key ASC, section_key ASC, version DESC, override_id DESC
            """,
            [org_id, int(job_id)],
        ).fetchall()
    payload = [_row_to_override(row) for row in rows or []]
    if report_family_key:
        payload = [item for item in payload if normalize_report_family_key(item["report_family_key"]) == normalize_report_family_key(report_family_key)]
    if section_key:
        payload = [item for item in payload if normalize_section_key(item["section_key"]) == normalize_section_key(section_key)]
    return {"overrides": payload}


@router.post("/jobs/{job_id}/ai-prompt-overrides")
def create_ai_prompt_override(
    job_id: int,
    payload: AiJobPromptOverrideCreate,
    _user: dict[str, str] = Depends(_current_user),
):
    assert_permission(_user, "jobs.edit")
    assert_job_access(_user, int(job_id))
    org_id = require_org(_user)
    _ensure_schema()

    report_family_key = normalize_report_family_key(payload.report_family_key)
    section_key = normalize_section_key(payload.section_key)
    if not get_report_family_definition(report_family_key):
        raise HTTPException(status_code=400, detail=f"Unsupported report_family_key='{payload.report_family_key}'")
    if not is_supported_section(section_key, report_family_key):
        raise HTTPException(status_code=400, detail=f"Unsupported section_key='{payload.section_key}' for family='{report_family_key}'")

    with get_conn() as con:
        next_version_row = con.execute(
            """
            SELECT COALESCE(MAX(version), 0) + 1
            FROM ai_job_prompt_overrides
            WHERE org_id = %s AND job_id = %s AND report_family_key = %s AND section_key = %s
            """,
            [org_id, int(job_id), report_family_key, section_key],
        ).fetchone()
        next_version = int(next_version_row[0] if next_version_row else 1)
        row = con.execute(
            """
            INSERT INTO ai_job_prompt_overrides (
              org_id, job_id, report_family_key, section_key, override_title,
              instruction_text, variables_json, status, version, created_by_user_id,
              created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
            RETURNING
              override_id, org_id, job_id, report_family_key, section_key, override_title,
              instruction_text, variables_json, status, version, created_by_user_id,
              created_at, updated_at
            """,
            [
                org_id,
                int(job_id),
                report_family_key,
                section_key,
                payload.override_title,
                payload.instruction_text,
                _json_text(payload.variables_json),
                str(payload.status or "draft").lower(),
                next_version,
                _user.get("user_id") or _user.get("id") or _user.get("email") or "system",
            ],
        ).fetchone()
        if str(payload.status or "draft").lower() == "active":
            _deactivate_sibling_versions(
                con,
                table_name="ai_job_prompt_overrides",
                where_sql="org_id = %s AND job_id = %s AND report_family_key = %s AND section_key = %s AND override_id <> %s",
                params=[org_id, int(job_id), report_family_key, section_key, int(row[0])],
            )
    return {"override": _row_to_override(row)}


@router.post("/ai-prompts/preview")
def preview_ai_prompt(
    payload: AiPromptPreviewRequest,
    _user: dict[str, str] = Depends(_current_user),
):
    assert_permission(_user, "jobs.reporting.view")
    org_id = require_org(_user)
    if payload.client_db_id is not None:
        assert_client_access(_user, int(payload.client_db_id))
    if payload.job_id is not None:
        assert_job_access(_user, int(payload.job_id))

    compiled = compile_prompt(
        org_id=org_id,
        report_family_key=payload.report_family_key,
        section_key=payload.section_key,
        facts=payload.facts or {},
        template_id=payload.template_id,
        client_db_id=payload.client_db_id,
        job_id=payload.job_id,
    )
    return {"compiled_prompt": compiled.model_dump()}


@router.post("/clients/{client_db_id}/ai-prompt-profile/{profile_id}/activate")
def activate_ai_prompt_profile(
    client_db_id: int,
    profile_id: int,
    _user: dict[str, str] = Depends(_current_user),
):
    assert_permission(_user, "clients.edit")
    assert_client_access(_user, int(client_db_id))
    org_id = require_org(_user)
    _ensure_schema()
    with get_conn() as con:
        row = con.execute(
            "SELECT profile_id FROM ai_client_prompt_profiles WHERE profile_id = %s AND org_id = %s AND client_db_id = %s",
            [int(profile_id), org_id, int(client_db_id)],
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="AI prompt profile not found")
        con.execute(
            """
            UPDATE ai_client_prompt_profiles
            SET status = CASE WHEN profile_id = %s THEN 'active' ELSE 'draft' END,
                updated_at = NOW()
            WHERE org_id = %s AND client_db_id = %s
            """,
            [int(profile_id), org_id, int(client_db_id)],
        )
    return {"ok": True, "profile_id": int(profile_id)}


class AiPromptRunRequest(BaseModel):
    report_family_key: str
    section_key: str
    client_db_id: int | None = None
    job_id: int | None = None
    template_id: int | None = None
    provider: str = "anthropic"


@router.post("/ai-prompts/run")
def run_ai_prompt(
    payload: AiPromptRunRequest,
    _user: dict[str, str] = Depends(_current_user),
):
    assert_permission(_user, "jobs.reporting.view")
    org_id = require_org(_user)
    if payload.client_db_id is not None:
        assert_client_access(_user, int(payload.client_db_id))
    if payload.job_id is not None:
        assert_job_access(_user, int(payload.job_id))

    report_family_key = normalize_report_family_key(payload.report_family_key)

    if report_family_key == "client_insights":
        if payload.client_db_id is None:
            raise HTTPException(status_code=400, detail="client_db_id is required for client_insights runs")
        from services.ai_insights import generate_client_insights
        result = generate_client_insights(
            client_db_id=int(payload.client_db_id),
            provider=payload.provider or "anthropic",
            org_id=org_id,
            template_id=payload.template_id,
        )
        return {"run": result, "report_family_key": report_family_key, "section_key": payload.section_key}

    raise HTTPException(
        status_code=400,
        detail=(
            f"Direct runs for '{report_family_key}' are not supported from here. "
            "Open the job's report page to generate CRP/SECR section drafts."
        ),
    )


@router.get("/ai-prompts/runs")
def list_ai_prompt_runs(
    client_db_id: int | None = Query(default=None),
    job_id: int | None = Query(default=None),
    section_key: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    _user: dict[str, str] = Depends(_current_user),
):
    assert_permission(_user, "jobs.reporting.view")
    org_id = require_org(_user)
    with get_conn() as con:
        rows = con.execute(
            """
            SELECT
              run_id, org_id, user_id, client_db_id, job_id, prompt_template_id,
              client_prompt_profile_id, job_prompt_override_id, report_family_key,
              section_key, provider, model_name, input_tokens, output_tokens,
              total_tokens, cost_estimate, resolved_system_prompt, resolved_user_prompt,
              input_facts_json, output_text, output_json, status, started_at,
              streaming_at, completed_at, created_at
            FROM ai_prompt_runs
            WHERE org_id = %s
              AND (%s IS NULL OR client_db_id = %s)
              AND (%s IS NULL OR job_id = %s)
              AND (%s IS NULL OR section_key = %s)
            ORDER BY created_at DESC, run_id DESC
            LIMIT %s
            """,
            [
                org_id,
                client_db_id,
                client_db_id,
                job_id,
                job_id,
                section_key,
                section_key,
                int(limit),
            ],
        ).fetchall()

    runs = []
    for row in rows or []:
        runs.append(
            {
                "run_id": int(row[0]),
                "org_id": str(row[1]),
                "user_id": row[2],
                "client_db_id": row[3],
                "job_id": row[4],
                "prompt_template_id": row[5],
                "client_prompt_profile_id": row[6],
                "job_prompt_override_id": row[7],
                "report_family_key": row[8],
                "section_key": row[9],
                "provider": row[10],
                "model_name": row[11],
                "input_tokens": row[12],
                "output_tokens": row[13],
                "total_tokens": row[14],
                "cost_estimate": str(row[15]) if row[15] is not None else None,
                "resolved_system_prompt": row[16],
                "resolved_user_prompt": row[17],
                "input_facts_json": row[18],
                "output_text": row[19],
                "output_json": row[20],
                "status": row[21],
                "started_at": row[22],
                "streaming_at": row[23],
                "completed_at": row[24],
                "created_at": row[25],
            }
        )
    return {"runs": runs}


# ---------------------------------------------------------------------------
# Org-level profile template (house-style defaults)
# ---------------------------------------------------------------------------

class OrgProfileTemplateUpdate(BaseModel):
    tone: str | None = None
    audience_notes: str | None = None
    narrative_notes: str | None = None
    preferred_terms: list[str] | None = None
    forbidden_terms: list[str] | None = None
    section_notes: dict[str, str] | None = None


def _row_to_org_template(row) -> dict[str, Any] | None:
    if row is None:
        return None
    preferred = None
    forbidden = None
    section_notes = None
    try:
        preferred = json.loads(row[4]) if row[4] else None
    except Exception:
        preferred = None
    try:
        forbidden = json.loads(row[5]) if row[5] else None
    except Exception:
        forbidden = None
    try:
        section_notes = json.loads(row[6]) if row[6] else None
    except Exception:
        section_notes = None
    return {
        "org_id": row[0],
        "tone": row[1],
        "audience_notes": row[2],
        "narrative_notes": row[3],
        "preferred_terms": preferred,
        "forbidden_terms": forbidden,
        "section_notes": section_notes,
        "updated_at": str(row[7]) if row[7] else None,
    }


@router.get("/ai-prompts/org-profile-template")
def get_org_profile_template(_user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "admin.view")
    org_id = require_org(_user)
    _ensure_schema()
    with get_conn() as con:
        row = con.execute(
            """
            SELECT org_id, tone, audience_notes, narrative_notes,
                   preferred_terms_json, forbidden_terms_json, section_notes_json, updated_at
            FROM ai_org_profile_template
            WHERE org_id = %s
            """,
            [org_id],
        ).fetchone()
    return {"template": _row_to_org_template(row)}


@router.post("/ai-prompts/org-profile-template")
def save_org_profile_template(
    payload: OrgProfileTemplateUpdate,
    _user: dict[str, str] = Depends(_current_user),
):
    assert_permission(_user, "admin.edit")
    org_id = require_org(_user)
    _ensure_schema()
    preferred_json = json.dumps(payload.preferred_terms) if payload.preferred_terms is not None else None
    forbidden_json = json.dumps(payload.forbidden_terms) if payload.forbidden_terms is not None else None
    section_json = json.dumps(payload.section_notes) if payload.section_notes is not None else None
    with get_conn() as con:
        row = con.execute(
            """
            INSERT INTO ai_org_profile_template
              (org_id, tone, audience_notes, narrative_notes,
               preferred_terms_json, forbidden_terms_json, section_notes_json, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (org_id) DO UPDATE SET
              tone = EXCLUDED.tone,
              audience_notes = EXCLUDED.audience_notes,
              narrative_notes = EXCLUDED.narrative_notes,
              preferred_terms_json = EXCLUDED.preferred_terms_json,
              forbidden_terms_json = EXCLUDED.forbidden_terms_json,
              section_notes_json = EXCLUDED.section_notes_json,
              updated_at = NOW()
            RETURNING org_id, tone, audience_notes, narrative_notes,
                      preferred_terms_json, forbidden_terms_json, section_notes_json, updated_at
            """,
            [org_id, payload.tone, payload.audience_notes, payload.narrative_notes,
             preferred_json, forbidden_json, section_json],
        ).fetchone()
    return {"template": _row_to_org_template(row)}


# ---------------------------------------------------------------------------
# Generate draft profile using LLM + website scraping
# ---------------------------------------------------------------------------

@router.post("/clients/{client_db_id}/ai-prompt-profile/generate-draft")
def generate_ai_profile_draft(
    client_db_id: int,
    _user: dict[str, str] = Depends(_current_user),
):
    assert_permission(_user, "clients.edit")
    assert_client_access(_user, int(client_db_id))
    org_id = require_org(_user)
    _ensure_schema()

    with get_conn() as con:
        from services.client_context_columns import ensure_client_context_columns
        ensure_client_context_columns(con)
        client_row = con.execute(
            """
            SELECT client_name, industry, website, headquarters,
                   net_zero_year, benchmark_year, status,
                   sic_code, description_long, parent_company,
                   group_structure, reporting_frameworks, certifications,
                   primary_scope3_categories, benchmark_period_end
            FROM clients
            WHERE db_id = %s
            """,
            [int(client_db_id)],
        ).fetchone()
        if client_row is None:
            raise HTTPException(status_code=404, detail="Client not found")

        org_row = con.execute(
            """
            SELECT org_id, tone, audience_notes, narrative_notes,
                   preferred_terms_json, forbidden_terms_json, section_notes_json, updated_at
            FROM ai_org_profile_template
            WHERE org_id = %s
            """,
            [org_id],
        ).fetchone()

    import datetime as _dt
    benchmark_end = client_row[14]
    years_reporting = None
    if benchmark_end:
        try:
            end_year = int(str(benchmark_end)[:4])
            years_reporting = _dt.date.today().year - end_year
        except Exception:
            pass

    client_data = {
        "client_name": client_row[0],
        "industry": client_row[1],
        "website": client_row[2],
        "headquarters": client_row[3],
        "net_zero_year": client_row[4],
        "benchmark_year": client_row[5],
        "sic_code": client_row[7],
        "description_long": client_row[8],
        "parent_company": client_row[9],
        "group_structure": client_row[10],
        "reporting_frameworks": client_row[11],
        "certifications": client_row[12],
        "primary_scope3_categories": client_row[13],
        "years_reporting": years_reporting,
    }

    org_defaults = _row_to_org_template(org_row) if org_row else {}

    try:
        from services.ai_profile_generator import generate_profile_draft
        draft = generate_profile_draft(client=client_data, org_defaults=org_defaults or {})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Profile generation failed: {exc}")

    return {
        "draft": draft,
        "website_scraped": bool(client_data.get("website")),
        "website_url": client_data.get("website") or None,
    }
