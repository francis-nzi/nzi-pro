from __future__ import annotations

import json
import os
import re
import logging
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from services.ai_insights import _get_anthropic_client, _get_openai_client
from services.ai_prompt_compiler import compile_prompt
from services.ai_prompt_registry import normalize_report_family_key
from services.ai_prompt_runs import record_ai_prompt_run

logger = logging.getLogger(__name__)

DEFAULT_ANTHROPIC_MODEL = os.environ.get("REPORT_DRAFT_ANTHROPIC_MODEL", os.environ.get("ANTHROPIC_MODEL", "claude-opus-4-6"))
DEFAULT_OPENAI_MODEL = os.environ.get("REPORT_DRAFT_OPENAI_MODEL", os.environ.get("OPENAI_MODEL", "gpt-4.1"))

SECTION_CONFIGS: dict[str, dict[str, str]] = {
    "executive_summary": {
        "title": "Executive Summary",
        "purpose": "Write the opening summary for a client-ready carbon report.",
        "focus": "headline story, direction of travel, biggest drivers, and business meaning",
        "length": "Write 3-4 short paragraphs, around 180-280 words in total.",
        "style": "Open with the client name, total emissions, and the comparison story. Then explain the largest driver, the action picture, the operational context, and the business implication. Finish with the direction of travel and what leadership should focus on next.",
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


def _build_prompt_facts(context: dict[str, Any], section_key: str) -> dict[str, Any]:
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
    change_sentence, change_pct = _change_text(current_total, previous_total)
    top = _top_category(categories)
    top_previous = _top_category(previous_categories)

    action_lines = []
    for item in items[:5]:
        action_lines.append(
            f"- {_text(item.get('action_name') or item.get('name') or 'Untitled action')} "
            f"({_text(item.get('action_term_label') or item.get('action_term') or 'no term')}, "
            f"{_text(item.get('action_category') or 'no category')})"
        )

    category_lines = []
    for item in categories[:5]:
        category_lines.append(
            f"- {_text(item.get('category') or 'Uncategorised')}: {_as_float(item.get('emissions')):.1f} tCO2e "
            f"({_as_float(item.get('percentage')):.1f}%)"
        )

    facts = {
        "client_name": _text(job_data.get("client_name") or "Client"),
        "reporting_year": _text(job_data.get("reporting_year") or "the reporting period"),
        "previous_reporting_year": _text(previous_job_data.get("reporting_year") or "the comparison period"),
        "comparison_job_number": _text(previous_job_data.get("job_number") or ""),
        "current_total_emissions": f"{current_total:.1f}",
        "scope_1_total": f"{_as_float(scope_totals.get('Scope 1')):.1f}",
        "scope_2_total": f"{_as_float(scope_totals.get('Scope 2')):.1f}",
        "scope_3_total": f"{_as_float(scope_totals.get('Scope 3')):.1f}",
        "change_sentence": change_sentence,
        "change_pct": f"{change_pct:.1f}" if change_pct is not None else "",
        "top_category_name": _text(top.get("category") if top else ""),
        "top_category_emissions": f"{_as_float(top.get('emissions') if top else 0.0):.1f}",
        "top_category_percentage": f"{_as_float(top.get('percentage') if top else 0.0):.1f}",
        "previous_top_category_name": _text(top_previous.get("category") if top_previous else ""),
        "previous_top_category_emissions": f"{_as_float(top_previous.get('emissions') if top_previous else 0.0):.1f}",
        "selected_actions_count": str(len(items)),
        "short_term_actions": str(int((job_actions.get("term_counts") or {}).get("short") or 0)),
        "medium_term_actions": str(int((job_actions.get("term_counts") or {}).get("medium") or 0)),
        "long_term_actions": str(int((job_actions.get("term_counts") or {}).get("long") or 0)),
        "headcount": f"{_as_float(job_data.get('no_of_staff')):.0f}" if _as_float(job_data.get("no_of_staff")) > 0 else "",
        "premises_owned": f"{_as_float(job_data.get('no_premises_owned')):.0f}" if _as_float(job_data.get("no_premises_owned")) > 0 else "",
        "premises_leased": f"{_as_float(job_data.get('no_premises_leased')):.0f}" if _as_float(job_data.get("no_premises_leased")) > 0 else "",
        "vehicles_owned": f"{_as_float(job_data.get('no_vehicles_owned')):.0f}" if _as_float(job_data.get("no_vehicles_owned")) > 0 else "",
        "vehicles_leased": f"{_as_float(job_data.get('no_vehicles_leased')):.0f}" if _as_float(job_data.get("no_vehicles_leased")) > 0 else "",
        "net_zero_year": _text(job_data.get("net_zero_year") or ""),
        "interim_year": _text(job_data.get("interim_year") or ""),
        "context_summary": _text(context.get("context_summary") or ""),
        "top_categories": "\n".join(category_lines) if category_lines else "No category data available.",
        "selected_actions": "\n".join(action_lines) if action_lines else "No action data available.",
    }
    facts["prompt_facts"] = "\n".join(
        [
            f"Client: {facts['client_name']}",
            f"Reporting year: {facts['reporting_year']}",
            f"Previous reporting year: {facts['previous_reporting_year']}",
            f"Comparison job number: {facts['comparison_job_number']}",
            f"Current total emissions: {facts['current_total_emissions']} tCO2e",
            f"Scope 1 total: {facts['scope_1_total']} tCO2e",
            f"Scope 2 total: {facts['scope_2_total']} tCO2e",
            f"Scope 3 total: {facts['scope_3_total']} tCO2e",
            f"Change summary: {facts['change_sentence']}",
            f"Top category: {facts['top_category_name']} ({facts['top_category_emissions']} tCO2e, {facts['top_category_percentage']}%)",
            f"Previous top category: {facts['previous_top_category_name']} ({facts['previous_top_category_emissions']} tCO2e)",
            f"Action counts: {facts['selected_actions_count']} total, {facts['short_term_actions']} short-term, {facts['medium_term_actions']} medium-term, {facts['long_term_actions']} long-term",
            f"Headcount: {facts['headcount'] or 'N/A'}",
            f"Premises owned: {facts['premises_owned'] or 'N/A'}",
            f"Premises leased: {facts['premises_leased'] or 'N/A'}",
            f"Vehicles owned: {facts['vehicles_owned'] or 'N/A'}",
            f"Vehicles leased: {facts['vehicles_leased'] or 'N/A'}",
            f"Net zero year: {facts['net_zero_year'] or 'N/A'}",
            f"Interim year: {facts['interim_year'] or 'N/A'}",
            "Top categories:",
            facts["top_categories"],
            "Selected actions:",
            facts["selected_actions"],
            "Context summary:",
            facts["context_summary"] or "N/A",
        ]
    )
    return facts


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
            items.append(f"{category} ({emissions:.1f} tCO₂e)")
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
        paragraph_1 = f"{client_name} reported {current_total:.1f} tCO₂e in {reporting_year}. {change_sentence}".strip()
        if previous_job_data:
            paragraph_1 += f" The comparison period is {comparison_year}{f' ({comparison_job})' if comparison_job else ''}."
        paragraph_2_bits = []
        if top:
            paragraph_2_bits.append(
                f"The largest driver is { _text(top.get('category')) } at {_as_float(top.get('emissions')):.1f} tCO₂e"
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
        commitment_year = _text(job_data.get("net_zero_year") or "")
        interim_year = _text(job_data.get("interim_year") or "")
        intensity_bits: list[str] = []
        if _as_float(job_data.get("no_of_staff")) > 0:
            intensity_bits.append(f"the organisation reports an average headcount of {_as_float(job_data.get('no_of_staff')):.0f}")
        if any(_as_float(job_data.get(field)) > 0 for field in ("no_premises_owned", "no_premises_leased", "no_vehicles_owned", "no_vehicles_leased")):
            intensity_bits.append("the operational footprint spans premises and vehicle activity")
        if commitment_year:
            intensity_bits.append(
                "the wider Net Zero programme targets "
                f"{commitment_year}{f' with an interim milestone in {interim_year}' if interim_year else ''}"
            )
        extra_sentence = ""
        if intensity_bits:
            extra_sentence = " " + " ".join(
                [
                    "Additional context:",
                    "; ".join(intensity_bits).strip().capitalize() + ".",
                ]
            )
        return f"{paragraph_1} {paragraph_2}{extra_sentence}".strip()

    if section_key == "emissions_overview":
        paragraph_1 = (
            f"Total emissions are {current_total:.1f} tCO₂e across Scope 1 {_as_float(scope_totals.get('Scope 1')):.1f}, "
            f"Scope 2 {_as_float(scope_totals.get('Scope 2')):.1f}, and Scope 3 {_as_float(scope_totals.get('Scope 3')):.1f} tCO₂e. "
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
                f"These should remain aligned to the largest emissions source, { _text(top.get('category')) }, at {_as_float(top.get('emissions')):.1f} tCO₂e"
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
        f"Current emissions are {current_total:.1f} tCO₂e and the comparison note is: {change_sentence}"
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
        company_name = _text((context.get("job_data") or {}).get("client_name") or "the client")
        report_year = _text((context.get("job_data") or {}).get("reporting_year") or "the reporting period")
        commitment_year = _text((context.get("job_data") or {}).get("net_zero_year") or "")
        interim_year = _text((context.get("job_data") or {}).get("interim_year") or "")
        paragraphs = [
            f"{company_name} recorded {current_total:.1f} tCO₂e in {report_year}. {change_sentence}",
            (
                f"The main drivers are { _text(top.get('category')) if top else 'the leading operational hotspots' }"
                + (
                    f", with {len(items)} actions already in motion"
                    if items
                    else ", with the reduction programme still focused on the key hotspots"
                )
                + "."
            ),
            (
                "This is a strategic baseline that should be read alongside the company’s operational scale, "
                f"workforce context, and any Net Zero programme targets"
                + (f" ({commitment_year}" + (f", interim {interim_year}" if interim_year else "") + ")" if commitment_year else "")
                + "."
            ),
        ]
        return " ".join(paragraphs).strip()
    if section_key == "emissions_overview":
        return (
            f"{section_title}: summarise the current emissions totals, the scope split, and the main drivers of change."
        )
    if section_key == "actions":
        return (
            f"{section_title}: summarise the current actions, prioritise the next steps, and highlight the most practical delivery themes."
        )
    return f"Draft the {section_title.lower()} section using the supplied evidence."


def _enrich_executive_summary_text(context: dict[str, Any], draft_text: str) -> str:
    existing = _text(draft_text).strip()
    if not existing:
        return _build_section_fallback_draft(context, "executive_summary")

    paragraphs = [part.strip() for part in re.split(r"\n\s*\n+", existing) if part.strip()]
    word_count = len(re.findall(r"\S+", existing))
    if word_count >= 150 and len(paragraphs) >= 2:
        return existing

    job_data = context.get("job_data") or {}
    scope_totals = context.get("scope_totals") or {}
    benchmark_totals = context.get("benchmark_totals") or {}
    categories = _sort_categories(context.get("categories") or [])
    job_actions = context.get("job_actions") or {}
    items = job_actions.get("items") or []
    current_total = _as_float(scope_totals.get("Total"))
    previous_total = _as_float(benchmark_totals.get("Total"))
    change_sentence, _ = _change_text(current_total, previous_total)
    top = _top_category(categories)
    top_name = _text(top.get("category") if top else "")
    top_emissions = _as_float(top.get("emissions") if top else 0.0)
    company_name = _text(job_data.get("client_name") or "The client")
    reporting_year = _text(job_data.get("reporting_year") or "the reporting period")
    description = _text(job_data.get("description") or "")
    headcount = _as_float(job_data.get("no_of_staff"))
    premises_owned = _as_float(job_data.get("no_premises_owned"))
    premises_leased = _as_float(job_data.get("no_premises_leased"))
    vehicles_owned = _as_float(job_data.get("no_vehicles_owned"))
    vehicles_leased = _as_float(job_data.get("no_vehicles_leased"))
    commitment_year = _text(job_data.get("net_zero_year") or "")
    interim_year = _text(job_data.get("interim_year") or "")
    action_count = len(items)
    short_count = int((job_actions.get("term_counts") or {}).get("short") or 0)
    medium_count = int((job_actions.get("term_counts") or {}).get("medium") or 0)
    long_count = int((job_actions.get("term_counts") or {}).get("long") or 0)

    paragraphs = [existing.rstrip(".") + "."]

    context_bits = [
        f"Operational context: {description}" if description else "",
        f"The business reports an average headcount of {headcount:.0f} people" if headcount > 0 else "",
        (
            "Its footprint spans "
            + ", ".join(
                part
                for part in [
                    f"{premises_owned:.0f} owned premises" if premises_owned > 0 else "",
                    f"{premises_leased:.0f} leased premises" if premises_leased > 0 else "",
                    f"{vehicles_owned:.0f} owned vehicles" if vehicles_owned > 0 else "",
                    f"{vehicles_leased:.0f} leased vehicles" if vehicles_leased > 0 else "",
                ]
                if part
            )
        )
        if any(value > 0 for value in (premises_owned, premises_leased, vehicles_owned, vehicles_leased))
        else "",
    ]
    context_sentence = ". ".join(bit for bit in context_bits if bit).strip()
    if context_sentence:
        paragraphs.append(context_sentence + ".")

    strategy_bits = [
        f"{company_name}'s wider Net Zero programme targets {commitment_year}" if commitment_year else "",
        f"with an interim milestone in {interim_year}" if commitment_year and interim_year else "",
        (
            f"The current action plan contains {action_count} actions "
            f"({short_count} short-term, {medium_count} medium-term, {long_count} long-term)"
            if action_count > 0
            else ""
        ),
    ]
    strategy_sentence = " ".join(bit for bit in strategy_bits if bit).strip()
    if strategy_sentence:
        follow_up = strategy_sentence + "."
    else:
        follow_up = (
            "The summary should be read as a baseline for future reductions, with attention on the largest drivers and the practical delivery roadmap."
        )
    if top_name:
        follow_up = (
            f"{follow_up} The largest category is {top_name} at {top_emissions:.1f} tCO₂e, "
            f"which remains the most obvious operational focus."
        )
    if change_sentence:
        follow_up = f"{follow_up} {change_sentence}."
    paragraphs.append(follow_up)

    closing = (
        f"Overall, {company_name} is moving from measurement into delivery: {reporting_year} should be treated as the reference point for governance, business planning, and future reduction momentum."
    )
    paragraphs.append(closing)
    return "\n\n".join(paragraphs).strip()


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
    return f"Scope 1 {s1:.1f} tCO₂e, Scope 2 {s2:.1f} tCO₂e, Scope 3 {s3:.1f} tCO₂e, Total {total:.1f} tCO₂e"


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
        f"Company context: Net Zero target year {_text(job_data.get('net_zero_year') or 'N/A')} | Interim year {_text(job_data.get('interim_year') or 'N/A')} | Benchmark year {_text(job_data.get('benchmark_year') or 'N/A')}",
        f"Operational context: {_text(job_data.get('description') or 'No company description provided.')}",
        f"Workforce context: Headcount {_text(job_data.get('no_of_staff') or 'N/A')} | Premises owned {_text(job_data.get('no_premises_owned') or 'N/A')} | Premises leased {_text(job_data.get('no_premises_leased') or 'N/A')} | Vehicles owned {_text(job_data.get('no_vehicles_owned') or 'N/A')} | Vehicles leased {_text(job_data.get('no_vehicles_leased') or 'N/A')}",
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
            f"Total {_as_float(benchmark_totals.get('Total')):.1f} tCO₂e"
        )

    if categories:
        lines.append("Top categories:")
        for item in categories[:5]:
            lines.append(
                "- "
                f"{_text(item.get('category') or 'Uncategorized')}: "
                f"{_as_float(item.get('emissions')):.1f} tCO₂e"
            )

    if previous_categories:
        lines.append("Previous period categories:")
        for item in previous_categories[:3]:
            lines.append(
                "- "
                f"{_text(item.get('category') or 'Uncategorized')}: "
                f"{_as_float(item.get('emissions')):.1f} tCO₂e"
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


def _build_executive_summary_context_lines(context: dict[str, Any]) -> list[str]:
    job_data = context.get("job_data") or {}
    previous_job_data = context.get("previous_job_data") or {}
    scope_totals = context.get("scope_totals") or {}
    benchmark_totals = context.get("benchmark_totals") or {}
    categories = _sort_categories(context.get("categories") or [])
    job_actions = context.get("job_actions") or {}

    lines = [
        f"Section: {_get_section_config('executive_summary').get('title')}",
        f"Job: {_text(job_data.get('job_number') or context.get('job_id'))} | {_text(job_data.get('client_name') or 'Client')} | Reporting year {_text(job_data.get('reporting_year') or 'N/A')}",
        f"Client: {_text(job_data.get('industry') or 'Unknown industry')} | {_text(job_data.get('country') or 'Unknown country')}",
        f"Company context: Net Zero target year {_text(job_data.get('net_zero_year') or 'N/A')} | Interim year {_text(job_data.get('interim_year') or 'N/A')}",
        f"Operational context: {_text(job_data.get('description') or 'No company description provided.')}",
        f"Workforce context: Headcount {_text(job_data.get('no_of_staff') or 'N/A')} | Premises owned {_text(job_data.get('no_premises_owned') or 'N/A')} | Premises leased {_text(job_data.get('no_premises_leased') or 'N/A')} | Vehicles owned {_text(job_data.get('no_vehicles_owned') or 'N/A')} | Vehicles leased {_text(job_data.get('no_vehicles_leased') or 'N/A')}",
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
            f"Total {_as_float(benchmark_totals.get('Total')):.1f} tCO₂e"
        )

    if categories:
        lines.append("Top categories:")
        for item in categories[:3]:
            lines.append(
                "- "
                f"{_text(item.get('category') or 'Uncategorized')}: "
                f"{_as_float(item.get('emissions')):.1f} tCO₂e"
            )

    items = job_actions.get("items") or []
    if items:
        lines.append(
            f"Actions: {len(items)} total | "
            f"Short {int((job_actions.get('term_counts') or {}).get('short') or 0)} | "
            f"Medium {int((job_actions.get('term_counts') or {}).get('medium') or 0)} | "
            f"Long {int((job_actions.get('term_counts') or {}).get('long') or 0)}"
        )
        for item in items[:3]:
            lines.append(
                "- "
                f"{_text(item.get('action_name') or '')} | "
                f"{_text(item.get('action_term_label') or item.get('action_term') or '')} | "
                f"{_text(item.get('action_category') or '')}"
            )

    sibling_drafts = context.get("sibling_drafts") or {}
    emissions_draft = _text(sibling_drafts.get("emissions_overview") or "")
    actions_draft = _text(sibling_drafts.get("actions") or "")
    if emissions_draft:
        lines.append(f"Emissions Overview section (already drafted — reference and extend, do not repeat verbatim): {emissions_draft[:600]}")
    if actions_draft:
        lines.append(f"Actions section (already drafted — reference and extend, do not repeat verbatim): {actions_draft[:400]}")

    return lines


def _build_prompt(context: dict[str, Any], section_key: str) -> str:
    config = _get_section_config(section_key)
    lines = (
        _build_executive_summary_context_lines({**context, "section_key": section_key})
        if section_key == "executive_summary"
        else _build_context_lines({**context, "section_key": section_key})
    )
    client_name = _text((context.get("job_data") or {}).get("client_name") or "")
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
            "Use the exact client name provided below. Do not substitute another company or organisation name.",
            "If a detail is missing, say so plainly.",
            "Write the draft_text as finished report prose, not as a prompt, note, or placeholder sentence.",
            "Do not write phrases like 'draft the section' or 'use the supplied evidence' in the draft_text field.",
            f"{config['length']} {config['style']}",
            "For Executive Summary, write a fuller board-ready narrative in 3 short paragraphs: paragraph 1 should open with the emissions headline and year-on-year movement; paragraph 2 should explain the key drivers and what changed; paragraph 3 should describe what the numbers mean for the business, operational focus, and intensity. If useful, add a brief fourth sentence about targets, governance, momentum, and the practical direction of travel.",
            "Avoid opening with generic boilerplate such as 'recorded total greenhouse gas emissions'. Start with the client story, the change, and the business meaning in natural prose.",
            "Do not sound generic. Do not write a terse numbers-only recap. The summary should feel strategic, specific, and decision-useful.",
            "Where the evidence supports it, mention the Net Zero target year, interim milestone, workforce scale, operational footprint, and intensity context so the summary reads like a real executive brief rather than a dashboard note.",
            "Keep the tone confident, professional, and company-specific. Do not overstate claims that are not evidenced.",
            "Round emissions values to 1 decimal place in the prose unless a source value is explicitly shown with a different precision.",
            "The draft_text should read naturally in a report and should be specific to the evidence pack.",
            "Return ONLY valid JSON with this schema:",
            json.dumps(schema, ensure_ascii=False),
            "",
            f"Client name: {client_name or 'Client'}",
            f"Section purpose: {config['purpose']}",
            f"Section focus: {config['focus']}",
            "Style note: the executive summary should read like a polished narrative overview, not a short summary sentence.",
            "",
            "Evidence pack:",
            *[f"- {line}" for line in lines],
        ]
    )
    return prompt


def _build_system_prompt(section_key: str) -> str:
    if section_key == "executive_summary":
        return (
            "You are a senior carbon reporting strategist and executive ghostwriter. "
            "Write polished, board-ready prose that is specific, evidence-led, and commercially useful. "
            "For executive summaries, produce a narrative that sounds like a real leadership briefing: opening headline, main drivers, business meaning, and future direction. "
            "Never invent facts or rename the client. Never mention another company or organisation name. "
            "Avoid generic boilerplate and avoid language that reads like a template."
        )
    return (
        "You are a senior carbon reporting strategist and technical editor. "
        "Write polished, client-ready prose that is specific, evidence-led, and commercially useful. "
        "Never invent facts or rename the client. Never mention another company or organisation name. "
        "Avoid generic boilerplate and avoid language that reads like a template."
    )


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
        evidence_used.append({"label": "Current total emissions", "source": "jobs + data output", "value": f"{current_total:.1f} tCO₂e"})
    if previous_total:
        evidence_used.append({"label": "Comparison total emissions", "source": "benchmark job", "value": f"{previous_total:.1f} tCO₂e"})
    if top:
        evidence_used.append(
            {
                "label": "Top category",
                "source": "job_scope_rows.level_2",
                "value": f"{_text(top.get('category'))}: {_as_float(top.get('emissions')):.1f} tCO₂e",
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
    template_id: int | None = None,
) -> dict[str, Any]:
    _load_env()
    section_key = (section_key or "").strip().lower()
    if section_key not in SECTION_CONFIGS:
        raise ValueError(f"Unsupported draft section: {section_key}")

    prompt_facts = _build_prompt_facts(context, section_key)
    job_data_for_org = context.get("job_data") or {}
    report_family_key = normalize_report_family_key(context.get("template_key") or "crp")
    if report_family_key not in {"client_insights", "crp", "secr", "annual_carbon_report"}:
        report_family_key = "crp"

    compiled_prompt = None
    try:
        compiled_prompt = compile_prompt(
            org_id=str(job_data_for_org.get("org_id") or "global"),
            report_family_key=report_family_key,
            section_key=section_key,
            facts=prompt_facts,
            template_id=template_id,
        )
    except Exception:
        compiled_prompt = None

    if compiled_prompt:
        system_prompt = compiled_prompt.system_prompt
        prompt = compiled_prompt.user_prompt
        prompt_metadata = compiled_prompt.model_dump()
    else:
        prompt = _build_prompt(context, section_key)
        system_prompt = _build_system_prompt(section_key)
        prompt_metadata = {
            "system_prompt": system_prompt,
            "user_prompt": prompt,
            "metadata": {},
            "warnings": [],
            "resolved_versions": {},
        }
    prompt_warnings = list(prompt_metadata.get("warnings") or []) if isinstance(prompt_metadata, dict) else []
    provider_key = (provider or "anthropic").strip().lower()
    raw_text = ""
    model_name = model or (DEFAULT_OPENAI_MODEL if provider_key == "openai" else DEFAULT_ANTHROPIC_MODEL)
    temperature = 0.1 if section_key == "executive_summary" else 0.2
    max_tokens = 800 if section_key == "executive_summary" else 1200
    _provider_names = {"anthropic", "openai", "openai-api", "anthropic-api"}
    if compiled_prompt:
        hint = (compiled_prompt.model_hint or "").strip().lower()
        if hint and hint not in _provider_names and not model:
            model_name = compiled_prompt.model_hint  # type: ignore[assignment]
        if compiled_prompt.temperature is not None:
            temperature = compiled_prompt.temperature
    input_tokens = None
    output_tokens = None
    total_tokens = None

    if provider_key == "openai":
        try:
            client = _get_openai_client()
            response = client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt},
                ],
                temperature=temperature,
                max_tokens=max_tokens,
            )
            raw_text = (response.choices[0].message.content or "").strip() if response.choices else ""
            usage = getattr(response, "usage", None)
            input_tokens = int(getattr(usage, "prompt_tokens", None) or 0) or None
            output_tokens = int(getattr(usage, "completion_tokens", None) or 0) or None
            total_tokens = int(getattr(usage, "total_tokens", None) or 0) or None
        except Exception as exc:
            logger.warning("OpenAI draft generation failed; falling back to rule-based draft", exc_info=True)
            fallback = _fallback_payload(context, section_key, reason=f"OpenAI unavailable: {exc}")
            try:
                record_ai_prompt_run(
                    org_id=str(job_data_for_org.get("org_id") or "global"),
                    user_id=None,
                    report_family_key=report_family_key,
                    section_key=section_key,
                    provider=provider_key,
                    model_name=model_name,
                    client_db_id=int(job_data_for_org.get("client_db_id") or 0) or None,
                    job_id=int(context.get("job_id") or 0) or None,
                    compiled_prompt=prompt_metadata,
                    input_facts=prompt_facts,
                    output_text=str(fallback.get("draft_text") or ""),
                    output_json=fallback,
                    status="fallback",
                    input_tokens=None,
                    output_tokens=None,
                    total_tokens=None,
                )
            except Exception:
                pass
            return {
                **fallback,
                "prompt_warnings": prompt_warnings,
                "prompt_metadata": prompt_metadata,
                "resolved_versions": prompt_metadata.get("resolved_versions", {}) if isinstance(prompt_metadata, dict) else {},
            }
    else:
        try:
            client = _get_anthropic_client()
            response = client.messages.create(
                model=model_name,
                system=system_prompt,
                messages=[{"role": "user", "content": prompt}],
                temperature=temperature,
                max_tokens=max_tokens,
            )
            if response.content and hasattr(response.content[0], "text"):
                raw_text = response.content[0].text.strip()
            else:
                raw_text = str(response)
            usage = getattr(response, "usage", None)
            input_tokens = int(getattr(usage, "input_tokens", None) or 0) or None
            output_tokens = int(getattr(usage, "output_tokens", None) or 0) or None
            total_tokens = (input_tokens + output_tokens) if input_tokens is not None and output_tokens is not None else None
        except Exception as exc:
            logger.warning("Anthropic draft generation failed; falling back to rule-based draft", exc_info=True)
            fallback = _fallback_payload(context, section_key, reason=f"Anthropic unavailable: {exc}")
            try:
                record_ai_prompt_run(
                    org_id=str(job_data_for_org.get("org_id") or "global"),
                    user_id=None,
                    report_family_key=report_family_key,
                    section_key=section_key,
                    provider=provider_key,
                    model_name=model_name,
                    client_db_id=int(job_data_for_org.get("client_db_id") or 0) or None,
                    job_id=int(context.get("job_id") or 0) or None,
                    compiled_prompt=prompt_metadata,
                    input_facts=prompt_facts,
                    output_text=str(fallback.get("draft_text") or ""),
                    output_json=fallback,
                    status="fallback",
                    input_tokens=None,
                    output_tokens=None,
                    total_tokens=None,
                )
            except Exception:
                pass
            return {
                **fallback,
                "prompt_warnings": prompt_warnings,
                "prompt_metadata": prompt_metadata,
                "resolved_versions": prompt_metadata.get("resolved_versions", {}) if isinstance(prompt_metadata, dict) else {},
            }

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

    if section_key == "executive_summary":
        normalized["draft_text"] = _enrich_executive_summary_text(context, str(normalized.get("draft_text") or ""))

    normalized.update(
        {
            "provider": provider_key,
            "model": model_name,
            "raw_text": raw_text,
        }
    )

    try:
        record_ai_prompt_run(
            org_id=str(job_data_for_org.get("org_id") or "global"),
            user_id=None,
            report_family_key=report_family_key,
            section_key=section_key,
            provider=provider_key,
            model_name=model_name,
            client_db_id=int(job_data_for_org.get("client_db_id") or 0) or None,
            job_id=int(context.get("job_id") or 0) or None,
            compiled_prompt=prompt_metadata,
            input_facts=prompt_facts,
            output_text=str(normalized.get("draft_text") or ""),
            output_json=normalized,
            status="completed",
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
        )
    except Exception:
        pass
    return {
        **normalized,
        "prompt_warnings": prompt_warnings,
        "prompt_metadata": prompt_metadata,
        "resolved_versions": prompt_metadata.get("resolved_versions", {}) if isinstance(prompt_metadata, dict) else {},
    }
