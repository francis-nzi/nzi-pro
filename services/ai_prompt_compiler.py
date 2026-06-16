from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from core.database import get_conn
from services.ai_prompt_registry import (
    get_report_family_definition,
    get_section_definition,
    is_supported_section,
    normalize_report_family_key,
    normalize_section_key,
)
from services.ai_prompt_schema import GLOBAL_TEMPLATE_ORG_ID


PLACEHOLDER_PATTERN = re.compile(r"\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}")


class CompiledPrompt(BaseModel):
    system_prompt: str
    user_prompt: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    resolved_versions: dict[str, Any] = Field(default_factory=dict)
    model_hint: str | None = None
    temperature: float | None = None


def _parse_json_text(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    try:
        return json.dumps(value, default=str, ensure_ascii=False)
    except Exception:
        return str(value)


def _render_template(text: str, values: dict[str, Any]) -> tuple[str, list[str]]:
    warnings: list[str] = []

    def replace(match: re.Match[str]) -> str:
        key = match.group(1).strip()
        value = values.get(key)
        if value is None:
            warnings.append(f"Missing value for placeholder '{key}'")
            return ""
        return _as_text(value)

    rendered = PLACEHOLDER_PATTERN.sub(replace, text or "")
    return rendered, warnings


def _status_label(value: Any) -> str:
    return str(value or "").strip().lower()


def _fetch_template_row(
    con,
    *,
    org_id: str,
    report_family_key: str,
    section_key: str,
    template_id: int | None = None,
) -> dict[str, Any] | None:
    if template_id is not None:
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
    else:
        row = con.execute(
            """
            SELECT
              template_id, org_id, prompt_key, report_family_key, section_key, name,
              description, scope, system_prompt, user_prompt, variables_json,
              model_hint, temperature, status, version, parent_template_id,
              created_by_user_id, created_at, updated_at, archived_at
            FROM ai_prompt_templates
            WHERE report_family_key = %s
              AND section_key = %s
              AND org_id IN (%s, %s)
            ORDER BY CASE WHEN org_id = %s THEN 0 ELSE 1 END, version DESC, template_id DESC
            LIMIT 1
            """,
            [
                report_family_key,
                section_key,
                org_id,
                GLOBAL_TEMPLATE_ORG_ID,
                org_id,
            ],
        ).fetchone()

    if not row:
        return None

    return {
        "template_id": row[0],
        "org_id": row[1],
        "prompt_key": row[2],
        "report_family_key": row[3],
        "section_key": row[4],
        "name": row[5],
        "description": row[6],
        "scope": row[7],
        "system_prompt": row[8] or "",
        "user_prompt": row[9] or "",
        "variables_json": _parse_json_text(row[10]),
        "model_hint": row[11],
        "temperature": row[12],
        "status": row[13],
        "version": int(row[14] or 1),
        "parent_template_id": row[15],
        "created_by_user_id": row[16],
        "created_at": row[17],
        "updated_at": row[18],
        "archived_at": row[19],
    }


def _fetch_client_profile_row(con, *, org_id: str, client_db_id: int) -> dict[str, Any] | None:
    row = con.execute(
        """
        SELECT
          profile_id, org_id, client_db_id, profile_name, industry_context, company_context,
          tone, audience_notes, preferred_terms_json, forbidden_terms_json,
          narrative_notes, section_notes_json, status, version, created_by_user_id,
          created_at, updated_at
        FROM ai_client_prompt_profiles
        WHERE org_id = %s
          AND client_db_id = %s
        ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, version DESC, profile_id DESC
        LIMIT 1
        """,
        [org_id, int(client_db_id)],
    ).fetchone()
    if not row:
        return None
    return {
        "profile_id": row[0],
        "org_id": row[1],
        "client_db_id": row[2],
        "profile_name": row[3],
        "industry_context": row[4] or "",
        "company_context": row[5] or "",
        "tone": row[6] or "",
        "audience_notes": row[7] or "",
        "preferred_terms_json": _parse_json_text(row[8]),
        "forbidden_terms_json": _parse_json_text(row[9]),
        "narrative_notes": row[10] or "",
        "section_notes_json": _parse_json_text(row[11]),
        "status": row[12],
        "version": int(row[13] or 1),
        "created_by_user_id": row[14],
        "created_at": row[15],
        "updated_at": row[16],
    }


def _fetch_job_override_row(
    con,
    *,
    org_id: str,
    job_id: int,
    report_family_key: str,
    section_key: str,
) -> dict[str, Any] | None:
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
    if not row:
        return None
    return {
        "override_id": row[0],
        "org_id": row[1],
        "job_id": row[2],
        "report_family_key": row[3],
        "section_key": row[4],
        "override_title": row[5],
        "instruction_text": row[6] or "",
        "variables_json": _parse_json_text(row[7]),
        "status": row[8],
        "version": int(row[9] or 1),
        "created_by_user_id": row[10],
        "created_at": row[11],
        "updated_at": row[12],
    }


def _build_system_block(template: dict[str, Any], client_profile: dict[str, Any] | None, job_override: dict[str, Any] | None) -> str:
    blocks: list[str] = []
    if template.get("system_prompt"):
        blocks.append(str(template["system_prompt"]).strip())

    if client_profile:
        client_blocks: list[str] = []
        if client_profile.get("company_context"):
            client_blocks.append(f"Client context: {client_profile['company_context']}".strip())
        if client_profile.get("industry_context"):
            client_blocks.append(f"Industry context: {client_profile['industry_context']}".strip())
        if client_profile.get("tone"):
            client_blocks.append(f"Tone: {client_profile['tone']}".strip())
        if client_profile.get("audience_notes"):
            client_blocks.append(f"Audience notes: {client_profile['audience_notes']}".strip())
        preferred = client_profile.get("preferred_terms_json") or {}
        if preferred:
            client_blocks.append(f"Preferred terms: {json.dumps(preferred, ensure_ascii=False)}")
        forbidden = client_profile.get("forbidden_terms_json") or {}
        if forbidden:
            client_blocks.append(f"Forbidden terms: {json.dumps(forbidden, ensure_ascii=False)}")
        narrative = client_profile.get("narrative_notes")
        if narrative:
            client_blocks.append(f"Narrative notes: {narrative}".strip())

        section_notes = client_profile.get("section_notes_json") or {}
        section_key = template.get("section_key")
        section_note = section_notes.get(section_key)
        if section_note:
            client_blocks.append(f"Section notes for {section_key}: {section_note}".strip())

        if client_blocks:
            blocks.append("\n".join(client_blocks))

    if job_override:
        job_blocks: list[str] = []
        if job_override.get("override_title"):
            job_blocks.append(f"Job override: {job_override['override_title']}")
        if job_override.get("instruction_text"):
            job_blocks.append(str(job_override["instruction_text"]).strip())
        override_vars = job_override.get("variables_json") or {}
        if override_vars:
            job_blocks.append(f"Job override variables: {json.dumps(override_vars, ensure_ascii=False)}")
        if job_blocks:
            blocks.append("\n".join(job_blocks))

    return "\n\n".join([block for block in blocks if block.strip()])


def _build_fact_values(
    *,
    facts: dict[str, Any] | None,
    template: dict[str, Any],
    client_profile: dict[str, Any] | None,
    job_override: dict[str, Any] | None,
) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    if facts:
        merged.update(facts)

    if client_profile:
        merged.setdefault("client_name", client_profile.get("company_context") or client_profile.get("profile_name"))
        merged.setdefault("client_profile_name", client_profile.get("profile_name"))
        merged.setdefault("industry", client_profile.get("industry_context"))

    if job_override:
        merged.setdefault("job_override_title", job_override.get("override_title"))

    merged.setdefault("report_family_key", template.get("report_family_key"))
    merged.setdefault("section_key", template.get("section_key"))
    return merged


def compile_prompt(
    *,
    org_id: str,
    report_family_key: str,
    section_key: str,
    facts: dict[str, Any] | None = None,
    template_id: int | None = None,
    client_db_id: int | None = None,
    job_id: int | None = None,
) -> CompiledPrompt:
    report_family_key = normalize_report_family_key(report_family_key)
    section_key = normalize_section_key(section_key)

    warnings: list[str] = []
    if not report_family_key:
        raise ValueError("report_family_key is required")
    if not section_key:
        raise ValueError("section_key is required")
    if not get_report_family_definition(report_family_key):
        warnings.append(f"Unsupported report family '{report_family_key}'")
    if not is_supported_section(section_key, report_family_key):
        warnings.append(f"Unsupported section '{section_key}' for report family '{report_family_key}'")

    with get_conn() as con:
        template = _fetch_template_row(
            con,
            org_id=org_id,
            report_family_key=report_family_key,
            section_key=section_key,
            template_id=template_id,
        )
        if template is None:
            raise LookupError(
                f"No active prompt template found for report_family_key='{report_family_key}' section_key='{section_key}'"
            )
        if _status_label(template.get("status")) != "active":
            warnings.append(
                f"Using inactive template version {template.get('version')} for prompt_key '{template.get('prompt_key')}'"
            )

        client_profile = None
        if client_db_id is not None:
            client_profile = _fetch_client_profile_row(con, org_id=org_id, client_db_id=int(client_db_id))
            if client_profile is None:
                warnings.append(f"No client prompt profile found for client_db_id={int(client_db_id)}")
            elif _status_label(client_profile.get("status")) != "active":
                warnings.append(
                    f"Using inactive client profile version {client_profile.get('version')} for client_db_id={int(client_db_id)}"
                )

        job_override = None
        if job_id is not None:
            job_override = _fetch_job_override_row(
                con,
                org_id=org_id,
                job_id=int(job_id),
                report_family_key=report_family_key,
                section_key=section_key,
            )
            if job_override is None:
                warnings.append(
                    f"No job prompt override found for job_id={int(job_id)} report_family_key='{report_family_key}' section_key='{section_key}'"
                )
            elif _status_label(job_override.get("status")) != "active":
                warnings.append(
                    f"Using inactive job override version {job_override.get('version')} for job_id={int(job_id)}"
                )

        merged_facts = _build_fact_values(
            facts=facts,
            template=template,
            client_profile=client_profile,
            job_override=job_override,
        )

        system_prompt = _build_system_block(template, client_profile, job_override)
        user_prompt_raw = template.get("user_prompt") or ""
        user_prompt, user_warnings = _render_template(user_prompt_raw, merged_facts)
        warnings.extend(user_warnings)

        template_vars = template.get("variables_json") or {}
        missing_template_vars = [
            key
            for key in template_vars.keys()
            if key not in merged_facts and key not in (client_profile or {}) and key not in (job_override or {})
        ]
        if missing_template_vars:
            warnings.append(f"Template has declared variables not present in facts: {', '.join(sorted(missing_template_vars))}")

        section_def = get_section_definition(section_key)
        metadata = {
            "report_family_key": report_family_key,
            "section_key": section_key,
            "section_label": section_def.label if section_def else section_key,
            "template": {
                "template_id": template.get("template_id"),
                "prompt_key": template.get("prompt_key"),
                "version": template.get("version"),
                "status": template.get("status"),
                "scope": template.get("scope"),
            },
            "client_profile": {
                "profile_id": client_profile.get("profile_id") if client_profile else None,
                "version": client_profile.get("version") if client_profile else None,
            },
            "job_override": {
                "override_id": job_override.get("override_id") if job_override else None,
                "version": job_override.get("version") if job_override else None,
            },
        }
        resolved_versions = {
            "template_version": template.get("version"),
            "client_profile_version": client_profile.get("version") if client_profile else None,
            "job_override_version": job_override.get("version") if job_override else None,
        }

    return CompiledPrompt(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        metadata=metadata,
        warnings=warnings,
        resolved_versions=resolved_versions,
        model_hint=str(template.get("model_hint") or "").strip() or None,
        temperature=template.get("temperature"),
    )

