from __future__ import annotations

import json
from typing import Any

from core.database import get_conn


def _json_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, default=str)
    except Exception:
        return json.dumps(str(value))


def record_ai_prompt_run(
    *,
    org_id: str,
    user_id: str | None,
    report_family_key: str,
    section_key: str,
    provider: str,
    model_name: str | None = None,
    client_db_id: int | None = None,
    job_id: int | None = None,
    compiled_prompt: dict[str, Any],
    input_facts: dict[str, Any] | None = None,
    output_text: str | None = None,
    output_json: dict[str, Any] | None = None,
    status: str = "completed",
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    total_tokens: int | None = None,
    cost_estimate: float | None = None,
) -> int | None:
    metadata = compiled_prompt or {}
    resolved_versions = metadata.get("resolved_versions") if isinstance(metadata, dict) else {}
    prompt_template_id = None
    client_prompt_profile_id = None
    job_prompt_override_id = None
    if isinstance(metadata, dict):
        template_meta = metadata.get("template") if isinstance(metadata.get("template"), dict) else {}
        client_meta = metadata.get("client_profile") if isinstance(metadata.get("client_profile"), dict) else {}
        job_meta = metadata.get("job_override") if isinstance(metadata.get("job_override"), dict) else {}
        prompt_template_id = template_meta.get("template_id")
        client_prompt_profile_id = client_meta.get("profile_id")
        job_prompt_override_id = job_meta.get("override_id")

    with get_conn() as con:
        row = con.execute(
            """
            INSERT INTO ai_prompt_runs (
              org_id, user_id, client_db_id, job_id, prompt_template_id,
              client_prompt_profile_id, job_prompt_override_id, report_family_key,
              section_key, provider, model_name, input_tokens, output_tokens,
              total_tokens, cost_estimate, resolved_system_prompt, resolved_user_prompt,
              input_facts_json, output_text, output_json, status, started_at,
              streaming_at, completed_at, created_at
            )
            VALUES (
              %s, %s, %s, %s, %s,
              %s, %s, %s,
              %s, %s, %s, %s, %s,
              %s, %s, %s, %s,
              %s, %s, %s, %s, NOW(),
              NOW(), NOW(), NOW()
            )
            RETURNING run_id
            """,
            [
                str(org_id),
                user_id,
                int(client_db_id) if client_db_id is not None else None,
                int(job_id) if job_id is not None else None,
                int(prompt_template_id) if prompt_template_id is not None else None,
                int(client_prompt_profile_id) if client_prompt_profile_id is not None else None,
                int(job_prompt_override_id) if job_prompt_override_id is not None else None,
                str(report_family_key),
                str(section_key),
                str(provider),
                model_name,
                input_tokens,
                output_tokens,
                total_tokens,
                cost_estimate,
                compiled_prompt.get("system_prompt") if isinstance(compiled_prompt, dict) else None,
                compiled_prompt.get("user_prompt") if isinstance(compiled_prompt, dict) else None,
                _json_text(input_facts),
                output_text,
                _json_text(output_json),
                status,
            ],
        ).fetchone()
    return int(row[0]) if row else None
