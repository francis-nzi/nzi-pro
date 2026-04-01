from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from services.ai_insights import _get_anthropic_client, _get_openai_client

DEFAULT_ANTHROPIC_MODEL = os.environ.get("REPORT_DRAFT_ANTHROPIC_MODEL", os.environ.get("ANTHROPIC_MODEL", "claude-opus-4-6"))
DEFAULT_OPENAI_MODEL = os.environ.get("REPORT_DRAFT_OPENAI_MODEL", os.environ.get("OPENAI_MODEL", "gpt-4.1"))

SECTION_CONFIGS: dict[str, dict[str, str]] = {
    "executive_summary": {
        "title": "Executive Summary",
        "purpose": "Write the opening summary for a client-ready carbon report.",
        "focus": "headline story, direction of travel, biggest drivers, and business meaning",
        "length": "Write 2 short paragraphs, around 120-180 words in total.",
        "style": "Open with the client name, total emissions, and the comparison story. Then explain the largest driver, the action picture, and the business implication.",
    },
    "emissions_overview": {
        "title": "Emissions Overview",
        "purpose": "Explain the current emissions footprint and what is driving it.",
        "focus": "scope split, total emissions, category drivers, trend movement, and caveats",
        "length": "Write 2 short paragraphs, around 120-180 words in total.",
        "style": "Lead with total emissions and the scope split. Then cover the biggest categories, any year-on-year movement, and the key hotspot to watch.",
    },
    "actions": {
        "title": "Actions",
        "purpose": "Translate the active action plan into report-ready narrative.",
        "focus": "what is already underway, priorities, horizons, and practical next steps",
        "length": "Write 1-2 short paragraphs, around 100-150 words in total.",
        "style": "Summarise the current action mix, call out the practical priorities, and show how the plan moves from short-term wins to longer-term delivery.",
    },
}


def _load_env() -> None:
    project_env = Path(__file__).resolve().parents[1] / ".env"
    if project_env.exists():
        load_dotenv(dotenv_path=project_env, override=False)


def _get_section_config(section_key: str) -> dict[str, str]:
    return SECTION_CONFIGS.get(
        section_key,
        {
            "title": section_key.replace("_", " ").title(),
            "purpose": "Draft the report section using the supplied evidence.",
            "focus": "client-ready narrative grounded in the evidence pack",
        },
    )


def _as_float(value: Any) -> float:
    try:
        if value is None:
            return 0.0
        return float(value)
    except Exception:
        return 0.0


def _text(value: Any) -> str:
    return str(value or "").strip()


def _strip_code_fences(text: str) -> str:
    raw = _text(text)
    if not raw:
        return ""
    raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
    raw = re.sub(r"\s*```$", "", raw)
    return raw.strip()


def _looks_like_json_text(text: str) -> bool:
    raw = _strip_code_fences(text)
    if not raw:
        return False
    if (raw.startswith("{") and raw.endswith("}")) or (raw.startswith("[") and raw.endswith("]")):
        return True
    return bool(re.search(r'"(?:section_key|draft_text|bullet_points|evidence_used|summary|narrative)"\s*:', raw))


def _word_count(text: str) -> int:
    raw = _text(text)
    if not raw:
        return 0
    return len(re.findall(r"\S+", raw))


def _looks_like_placeholder_draft(text: str) -> bool:
    raw = _strip_code_fences(text)
    if not raw:
        return True
    lowered = raw.lower()
    if _looks_like_json_text(raw):
        return True
    if "draft the section" in lowered:
        return True
    if "supplied evidence" in lowered:
        return True
    if "use the strongest available evidence" in lowered:
        return True
    if _word_count(raw) < 30:
        return True
    return False


def _join_text_parts(parts: list[str], *, separator: str = " ") -> str:
    cleaned = [_text(part) for part in parts if _text(part)]
    return separator.join(cleaned).strip()


def _format_category_list(categories: list[dict[str, Any]], *, limit: int = 3) -> str:
    items: list[str] = []
    for item in categories[:limit]:
        category = _text(item.get("category") or "Uncategorized")
        emissions = _as_float(item.get("emissions"))
        if category:
            items.append(f"{category} ({emissions:.2f} tCO2e)")
    return ", ".join(items)


def _format_action_list(items: list[dict[str, Any]], *, limit: int = 3) -> str:
    parts: list[str] = []
    for item in items[:limit]:
        name = _text(item.get("action_name") or item.get("name") or "Untitled action")
        term = _text(item.get("action_term_label") or item.get("action_term") or "")
        category = _text(item.get("action_category") or "")
        detail_bits = [bit for bit in [term, category] if bit]
        if detail_bits:
            parts.append(f"{name} ({', '.join(detail_bits)})")
        else:
            parts.append(name)
    return "; ".join(parts)


def _build_section_fallback_draft(context: dict[str, Any], section_key: str) -> str:
    job_data = context.get("job_data") or {}
    previous_job_data = context.get("previous_job_data") or {}
    scope_totals = context.get("scope_totals") or {}
    benchmark_totals = context.get("benchmark_totals") or {}
    categories = _sort_categories(context.get("categories") or [])
    previous_categories = _sort_categories(context.get("previous_categories") or [])
    job_actions = context.get("job_actions") or {}
    items = job_actions.get("items") or []
    current_total = _as_float(scope_totals.get("Total"))
    previous_total = _as_float(benchmark_totals.get("Total"))
    change_sentence, _change_pct = _change_text(current_total, previous_total)
    top = _top_category(categories)
    top_list = _format_category_list(categories, limit=3)
    prev_top_list = _format_category_list(previous_categories, limit=3)
    action_list = _format_action_list(items, limit=3)
    short_count = int((job_actions.get("term_counts") or {}).get("short") or 0)
    medium_count = int((job_actions.get("term_counts") or {}).get("medium") or 0)
    long_count = int((job_actions.get("term_counts") or {}).get("long") or 0)
    client_name = _text(job_data.get("client_name") or "The client")
    reporting_year = _text(job_data.get("reporting_year") or "the reporting period")
    comparison_year = _text(previous_job_data.get("reporting_year") or "the comparison period")
    comparison_job = _text(previous_job_data.get("job_number") or "")

    if section_key == "executive_summary":
        paragraph_1 = f"{client_name} reported {current_total:.2f} tCO2e in {reporting_year}. {change_sentence}".strip()
        if previous_job_data:
            paragraph_1 += f" The comparison period is {comparison_year}{f' ({comparison_job})' if comparison_job else ''}."
        paragraph_2_bits = []
        if top:
            paragraph_2_bits.append(
                f"The largest driver is { _text(top.get('category')) } at {_as_float(top.get('emissions')):.2f} tCO2e"
            )
        if action_list:
            paragraph_2_bits.append(
                f"the current action plan includes {len(items)} actions, with {short_count} short-term, {medium_count} medium-term, and {long_count} long-term priorities"
            )
        if paragraph_2_bits:
            paragraph_2 = " and ".join(paragraph_2_bits).strip()
            if not paragraph_2.endswith("."):
                paragraph_2 += "."
        else:
            paragraph_2 = "The report should focus on the main emissions drivers and the practical reduction themes most likely to move the footprint."
        return f"{paragraph_1} {paragraph_2}"

    if section_key == "emissions_overview":
        paragraph_1 = (
            f"Total emissions are {current_total:.2f} tCO2e across Scope 1 {_as_float(scope_totals.get('Scope 1')):.2f}, "
            f"Scope 2 {_as_float(scope_totals.get('Scope 2')):.2f}, and Scope 3 {_as_float(scope_totals.get('Scope 3')):.2f} tCO2e. "
            f"{change_sentence}"
        ).strip()
        paragraph_2_bits = []
        if top_list:
            paragraph_2_bits.append(f"the main categories are {top_list}")
        if prev_top_list:
            paragraph_2_bits.append(f"the comparison period concentrated on {prev_top_list}")
        if paragraph_2_bits:
            paragraph_2 = " ".join(paragraph_2_bits).strip()
            if not paragraph_2.endswith("."):
                paragraph_2 += "."
        else:
            paragraph_2 = "The footprint should be read alongside the category split to identify the biggest hotspots and any change in trend."
        return f"{paragraph_1} {paragraph_2}"

    if section_key == "actions":
        paragraph_1 = (
            f"The current plan contains {len(items)} actions: {short_count} short-term, {medium_count} medium-term, and {long_count} long-term items."
        )
        paragraph_2_bits = []
        if action_list:
            paragraph_2_bits.append(f"Priority actions include {action_list}")
        if top:
            paragraph_2_bits.append(
                f"These should remain aligned to the largest emissions source, { _text(top.get('category')) }, at {_as_float(top.get('emissions')):.2f} tCO2e"
            )
        if paragraph_2_bits:
            paragraph_2 = ". ".join(paragraph_2_bits).strip()
            paragraph_2 = paragraph_2[0].upper() + paragraph_2[1:] if paragraph_2 else paragraph_2
            if not paragraph_2.endswith("."):
                paragraph_2 += "."
        else:
            paragraph_2 = "The practical next step is to sequence quick wins first and keep the longer-horizon measures moving into a funded delivery roadmap."
        return f"{paragraph_1} {paragraph_2}"

    return (
        f"Draft the { _get_section_config(section_key)['title'].lower() } section using the supplied evidence. "
        f"Current emissions are {current_total:.2f} tCO2e and the comparison note is: {change_sentence}"
    )


def _coerce_readable_draft_text(
    payload: dict[str, Any],
    fallback_text: str,
    section_key: str,
    context: dict[str, Any] | None = None,
) -> str:
    section_title = _get_section_config(section_key)["title"]
    candidates = [
        payload.get("draft_text"),
        payload.get("draftText"),
        payload.get("summary"),
        payload.get("narrative"),
        payload.get("content"),
        payload.get("text"),
    ]

    for candidate in candidates:
        candidate_text = _strip_code_fences(candidate)
        if candidate_text and not _looks_like_placeholder_draft(candidate_text):
            return candidate_text

    paragraphs = payload.get("paragraphs")
    if isinstance(paragraphs, list):
        paragraph_text = _join_text_parts([_strip_code_fences(item) for item in paragraphs], separator="\n\n")
        if paragraph_text:
            return paragraph_text

    bullet_points = _safe_list(payload.get("bullet_points") or payload.get("bulletPoints"))
    if bullet_points:
        if section_key == "actions":
            lead_in = _text(payload.get("summary") or payload.get("narrative"))
            bullet_text = "\n".join(f"- {point}" for point in bullet_points)
            return _join_text_parts([lead_in, bullet_text], separator="\n\n").strip()
        return " ".join(f"{point}." if point and not point.endswith((".", "!", "?")) else point for point in bullet_points).strip()

    headline_points = _safe_list(payload.get("headline_points") or payload.get("key_points") or payload.get("takeaways"))
    if headline_points:
        return " ".join(
            f"{point}." if point and not point.endswith((".", "!", "?")) else point
            for point in headline_points
        ).strip()

    fallback_candidate = _strip_code_fences(fallback_text)
    if fallback_candidate and not _looks_like_placeholder_draft(fallback_candidate):
        return fallback_candidate

    rich_fallback = _build_section_fallback_draft(context or {}, section_key)
    if rich_fallback.strip():
        return rich_fallback.strip()

    if section_key == "executive_summary":
        return (
            f"{section_title}: open with the key story, the direction of travel, and the most important headline points."
        )
    if section_key == "emissions_overview":
        return (
            f"{section_title}: summarise the current emissions totals, the scope split, and the main drivers of change."
        )
    if section_key == "actions":
        return (
            f"{section_title}: summarise the current actions, prioritise the next steps, and highlight the most practical delivery themes."
        )
    return f"Draft the {section_title.lower()} section using the supplied evidence."


def _extract_balanced_json_object(raw: str) -> str | None:
    start = raw.find("{")
    if start == -1:
        return None

    depth = 0
    in_str = False
    escape = False
    for idx in range(start, len(raw)):
        ch = raw[idx]
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue

        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return raw[start : idx + 1]
    return None


def _extract_json(text: str) -> dict[str, Any] | None:
    raw = (text or "").strip()
    if not raw:
        return None

    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass

    balanced = _extract_balanced_json_object(raw)
    if balanced:
        try:
            parsed = json.loads(balanced)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass

    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            parsed = json.loads(raw[start : end + 1])
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass

    m = re.search(r"```(?:json)?\s*(\{.*\})\s*```", raw, flags=re.DOTALL)
    if m:
        try:
            parsed = json.loads(m.group(1))
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass

    return None


def _safe_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _top_category(categories: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not categories:
        return None
    return max(categories, key=lambda item: _as_float(item.get("emissions")))


def _sort_categories(categories: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(categories or [], key=lambda item: _as_float(item.get("emissions")), reverse=True)


def _scope_total_text(scope_totals: dict[str, Any]) -> str:
    total = _as_float(scope_totals.get("Total"))
    s1 = _as_float(scope_totals.get("Scope 1"))
    s2 = _as_float(scope_totals.get("Scope 2"))
    s3 = _as_float(scope_totals.get("Scope 3"))
    return f"Scope 1 {s1:.2f} tCO2e, Scope 2 {s2:.2f} tCO2e, Scope 3 {s3:.2f} tCO2e, Total {total:.2f} tCO2e"


def _change_text(current_total: float, previous_total: float) -> tuple[str, float | None]:
    if previous_total <= 0:
        return ("No prior-year comparison is available.", None)
    pct = ((current_total - previous_total) / previous_total) * 100.0
    direction = "higher" if pct > 0 else "lower" if pct < 0 else "flat"
    return (f"Total emissions are {abs(pct):.1f}% {direction} than the comparison period.", pct)


def _build_context_lines(context: dict[str, Any]) -> list[str]:
    job_data = context.get("job_data") or {}
    previous_job_data = context.get("previous_job_data") or {}
    scope_totals = context.get("scope_totals") or {}
    benchmark_totals = context.get("benchmark_totals") or {}
    categories = _sort_categories(context.get("categories") or [])
    previous_categories = _sort_categories(context.get("previous_categories") or [])
    job_actions = context.get("job_actions") or {}
    draft_profile = context.get("draft_profile") or {}
    client_insights = context.get("client_insights") or {}

    lines = [
        f"Section: {_get_section_config(str(context.get('section_key') or '')).get('title')}",
        f"Job: {_text(job_data.get('job_number') or context.get('job_id'))} | {_text(job_data.get('client_name') or 'Client')} | Reporting year {_text(job_data.get('reporting_year') or 'N/A')}",
        f"Client: {_text(job_data.get('industry') or 'Unknown industry')} | {_text(job_data.get('country') or 'Unknown country')}",
        f"Current totals: {_scope_total_text(scope_totals)}",
        f"Benchmark totals: {_scope_total_text(benchmark_totals)}",
    ]

    current_total = _as_float(scope_totals.get("Total"))
    previous_total = _as_float(benchmark_totals.get("Total"))
    change_sentence, _change_pct = _change_text(current_total, previous_total)
    lines.append(f"Comparison note: {change_sentence}")

    if previous_job_data:
        lines.append(
            "Previous job: "
            f"{_text(previous_job_data.get('job_number') or '')} | "
            f"{_text(previous_job_data.get('reporting_year') or 'N/A')} | "
            f"Total {_as_float(benchmark_totals.get('Total')):.2f} tCO2e"
        )

    if categories:
        lines.append("Top categories:")
        for item in categories[:5]:
            lines.append(
                "- "
                f"{_text(item.get('category') or 'Uncategorized')}: "
                f"{_as_float(item.get('emissions')):.2f} tCO2e"
            )

    if previous_categories:
        lines.append("Previous period categories:")
        for item in previous_categories[:3]:
            lines.append(
                "- "
                f"{_text(item.get('category') or 'Uncategorized')}: "
                f"{_as_float(item.get('emissions')):.2f} tCO2e"
            )

    items = job_actions.get("items") or []
    if items:
        lines.append(
            f"Actions: {len(items)} total | "
            f"Short {int((job_actions.get('term_counts') or {}).get('short') or 0)} | "
            f"Medium {int((job_actions.get('term_counts') or {}).get('medium') or 0)} | "
            f"Long {int((job_actions.get('term_counts') or {}).get('long') or 0)}"
        )
        for item in items[:8]:
            lines.append(
                "- "
                f"{_text(item.get('action_name') or '')} | "
                f"{_text(item.get('action_term_label') or item.get('action_term') or '')} | "
                f"{_text(item.get('action_category') or '')}"
            )

    if draft_profile:
        lines.append(
            "Profile: "
            f"{_text(draft_profile.get('title') or '')} - {_text(draft_profile.get('subtitle') or '')}"
        )

    if client_insights:
        summary = _text(client_insights.get("summary") or client_insights.get("insights") or "")
        if summary:
            lines.append(f"Client insight summary: {summary}")

    return lines


def _build_prompt(context: dict[str, Any], section_key: str) -> str:
    config = _get_section_config(section_key)
    lines = _build_context_lines({**context, "section_key": section_key})
    schema = {
        "section_key": section_key,
        "section_title": config["title"],
        "draft_text": "string",
        "bullet_points": ["string"],
        "evidence_used": [{"label": "string", "source": "string", "value": "string"}],
        "caveats": ["string"],
        "confidence": "low|medium|high",
    }
    prompt = "\n".join(
        [
            "You are drafting a client-ready carbon report section.",
            "Use only the evidence provided below. Do not invent data, dates, or claims.",
            "If a detail is missing, say so plainly.",
            "Write the draft_text as finished report prose, not as a prompt, note, or placeholder sentence.",
            "Do not write phrases like 'draft the section' or 'use the supplied evidence' in the draft_text field.",
            f"{config['length']} {config['style']}",
            "The draft_text should read naturally in a report and should be specific to the evidence pack.",
            "Return ONLY valid JSON with this schema:",
            json.dumps(schema, ensure_ascii=False),
            "",
            f"Section purpose: {config['purpose']}",
            f"Section focus: {config['focus']}",
            "",
            "Evidence pack:",
            *[f"- {line}" for line in lines],
        ]
    )
    return prompt


def _fallback_payload(context: dict[str, Any], section_key: str, *, reason: str) -> dict[str, Any]:
    config = _get_section_config(section_key)
    job_data = context.get("job_data") or {}
    scope_totals = context.get("scope_totals") or {}
    benchmark_totals = context.get("benchmark_totals") or {}
    categories = _sort_categories(context.get("categories") or [])
    job_actions = context.get("job_actions") or {}
    items = job_actions.get("items") or []
    current_total = _as_float(scope_totals.get("Total"))
    previous_total = _as_float(benchmark_totals.get("Total"))
    change_sentence, _change_pct = _change_text(current_total, previous_total)
    top = _top_category(categories)
    draft_text = _build_section_fallback_draft(context, section_key)

    evidence_used: list[dict[str, str]] = []
    if current_total:
        evidence_used.append({"label": "Current total emissions", "source": "jobs + data output", "value": f"{current_total:.2f} tCO2e"})
    if previous_total:
        evidence_used.append({"label": "Comparison total emissions", "source": "benchmark job", "value": f"{previous_total:.2f} tCO2e"})
    if top:
        evidence_used.append(
            {
                "label": "Top category",
                "source": "job_scope_rows.level_2",
                "value": f"{_text(top.get('category'))}: {_as_float(top.get('emissions')):.2f} tCO2e",
            }
        )

    caveats = [f"Fallback draft used because {reason}."]
    return {
        "section_key": section_key,
        "section_title": config["title"],
        "draft_text": draft_text.strip(),
        "bullet_points": [],
        "evidence_used": evidence_used,
        "caveats": caveats,
        "confidence": "low",
        "provider": "rule-based",
        "model": None,
    }


def _normalize_payload(
    payload: dict[str, Any],
    fallback_text: str,
    section_key: str,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    config = _get_section_config(section_key)
    confidence = _text(payload.get("confidence")).lower()
    if confidence not in {"low", "medium", "high"}:
        confidence = "medium"

    draft_text = _coerce_readable_draft_text(payload, fallback_text, section_key, context=context)
    if _looks_like_placeholder_draft(draft_text):
        draft_text = _build_section_fallback_draft(context or {}, section_key)

    evidence_used = []
    for row in payload.get("evidence_used") or []:
        if isinstance(row, dict):
            label = _text(row.get("label"))
            source = _text(row.get("source"))
            value = _text(row.get("value"))
            if label or source or value:
                evidence_used.append({"label": label, "source": source, "value": value})

    return {
        "section_key": _text(payload.get("section_key") or section_key),
        "section_title": _text(payload.get("section_title") or config["title"]),
        "draft_text": draft_text,
        "bullet_points": _safe_list(payload.get("bullet_points") or payload.get("bulletPoints")),
        "evidence_used": evidence_used,
        "caveats": _safe_list(payload.get("caveats")),
        "confidence": confidence,
    }


def generate_report_section_draft(
    context: dict[str, Any],
    section_key: str,
    *,
    provider: str = "anthropic",
    model: str | None = None,
) -> dict[str, Any]:
    _load_env()
    section_key = (section_key or "").strip().lower()
    if section_key not in SECTION_CONFIGS:
        raise ValueError(f"Unsupported draft section: {section_key}")

    prompt = _build_prompt(context, section_key)
    provider_key = (provider or "anthropic").strip().lower()
    raw_text = ""
    model_name = model or (DEFAULT_OPENAI_MODEL if provider_key == "openai" else DEFAULT_ANTHROPIC_MODEL)

    if provider_key == "openai":
        try:
            client = _get_openai_client()
            response = client.chat.completions.create(
                model=model_name,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2,
                max_tokens=1200,
            )
            raw_text = (response.choices[0].message.content or "").strip() if response.choices else ""
        except Exception as exc:
            return _fallback_payload(context, section_key, reason=f"OpenAI unavailable: {exc}")
    else:
        try:
            client = _get_anthropic_client()
            response = client.messages.create(
                model=model_name,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2,
                max_tokens=1200,
            )
            if response.content and hasattr(response.content[0], "text"):
                raw_text = response.content[0].text.strip()
            else:
                raw_text = str(response)
        except Exception as exc:
            return _fallback_payload(context, section_key, reason=f"Anthropic unavailable: {exc}")

    parsed = _extract_json(raw_text)
    if parsed:
        normalized = _normalize_payload(parsed, raw_text, section_key, context)
    else:
        normalized = _fallback_payload(context, section_key, reason="model returned unstructured output")
        if raw_text.strip() and not _looks_like_placeholder_draft(raw_text):
            normalized["draft_text"] = raw_text.strip()
        else:
            normalized["draft_text"] = _build_section_fallback_draft(context, section_key)
        normalized["confidence"] = normalized.get("confidence") or "low"
        if raw_text.strip():
            normalized["caveats"] = _safe_list(normalized.get("caveats")) + ["Model response could not be parsed as JSON; review before use."]

    normalized.update(
        {
            "provider": provider_key,
            "model": model_name,
            "raw_text": raw_text,
        }
    )
    return normalized
