"""
Generate a draft AI client profile using LLM + optional website scraping.

The generator fetches the client's website homepage (best-effort, with a
short timeout so it never blocks the request), combines that with structured
client data, and calls Anthropic to produce a ready-to-review JSON draft.

Org-level defaults (tone, audience, preferred/forbidden terms, section notes)
are layered in: the LLM is asked to refine those defaults for the specific
client rather than replacing them wholesale.
"""

from __future__ import annotations

import html
import json
import os
import re
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any

from dotenv import load_dotenv


def _get_anthropic_client():
    project_env = Path(__file__).resolve().parents[1] / ".env"
    if project_env.exists():
        load_dotenv(dotenv_path=project_env, override=False)
    try:
        from anthropic import Anthropic
    except ImportError:
        raise RuntimeError("anthropic package not installed")
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")
    return Anthropic(api_key=api_key, timeout=60.0)


def _fetch_website_text(url: str, max_chars: int = 4000) -> str | None:
    """Fetch a website's homepage and return plain text, best-effort."""
    if not url:
        return None
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (compatible; NZI-ProfileBot/1.0; "
                    "sustainability report assistant)"
                )
            },
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            raw = resp.read(65536).decode("utf-8", errors="replace")
    except Exception:
        return None

    # Strip scripts, styles, and HTML tags
    raw = re.sub(r"<(script|style)[^>]*>[\s\S]*?</\1>", " ", raw, flags=re.IGNORECASE)
    raw = re.sub(r"<[^>]+>", " ", raw)
    raw = html.unescape(raw)
    raw = re.sub(r"\s+", " ", raw).strip()
    return raw[:max_chars] if raw else None


def generate_profile_draft(
    client: dict[str, Any],
    org_defaults: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Call the LLM and return a dict with all profile field values.

    Returns a dict with keys:
      company_context, industry_context, tone, audience_notes,
      narrative_notes, preferred_terms (list), forbidden_terms (list),
      section_notes (dict with executive_summary, emissions_overview,
      actions, declaration)
    """
    defaults = org_defaults or {}

    # Best-effort website fetch
    website_text = _fetch_website_text(str(client.get("website") or ""))

    # Build structured context for the LLM
    client_facts = []
    if client.get("client_name"):
        client_facts.append(f"Company name: {client['client_name']}")
    if client.get("industry"):
        client_facts.append(f"Industry: {client['industry']}")
    if client.get("headquarters"):
        client_facts.append(f"Headquarters: {client['headquarters']}")
    if client.get("website"):
        client_facts.append(f"Website: {client['website']}")
    if client.get("net_zero_year"):
        client_facts.append(f"Net zero target year: {client['net_zero_year']}")
    if client.get("benchmark_year"):
        client_facts.append(f"Baseline year: {client['benchmark_year']}")

    facts_block = "\n".join(client_facts) if client_facts else "No structured data available."

    # Org defaults block (tell LLM what the house style is)
    defaults_lines = []
    if defaults.get("tone"):
        defaults_lines.append(f"House tone: {defaults['tone']}")
    if defaults.get("audience_notes"):
        defaults_lines.append(f"Typical audience: {defaults['audience_notes']}")
    if defaults.get("narrative_notes"):
        defaults_lines.append(f"Default narrative direction: {defaults['narrative_notes']}")
    if defaults.get("preferred_terms"):
        terms = defaults["preferred_terms"]
        if isinstance(terms, list):
            defaults_lines.append(f"Preferred terms (house style): {', '.join(terms)}")
    if defaults.get("forbidden_terms"):
        terms = defaults["forbidden_terms"]
        if isinstance(terms, list):
            defaults_lines.append(f"Forbidden terms (house style): {', '.join(terms)}")
    section_defaults = defaults.get("section_notes") or {}
    for section_key, label in [
        ("executive_summary", "Executive summary"),
        ("emissions_overview", "Emissions overview"),
        ("actions", "Actions"),
        ("declaration", "Declaration"),
    ]:
        if section_defaults.get(section_key):
            defaults_lines.append(f"Default {label} guidance: {section_defaults[section_key]}")

    defaults_block = "\n".join(defaults_lines) if defaults_lines else "No house defaults configured."

    website_block = (
        f"WEBSITE CONTENT (first ~4000 chars of homepage):\n{website_text}"
        if website_text
        else "No website content available."
    )

    system_prompt = (
        "You are an expert sustainability consultant at Net Zero International. "
        "Your job is to draft an AI client profile that will be used to make carbon "
        "reporting AI insights more relevant and accurate for a specific client. "
        "Return ONLY valid JSON with no markdown, no explanation, no code fences."
    )

    user_prompt = f"""Draft an AI client profile for the following company.

CLIENT FACTS:
{facts_block}

{website_block}

HOUSE STYLE DEFAULTS (apply these unless the client data suggests a better fit):
{defaults_block}

Return a JSON object with exactly these keys:
{{
  "company_context": "2-4 sentences describing what this company does, their size, structure, and carbon reporting context. Be specific and grounded in the facts above.",
  "industry_context": "2-3 sentences about the industry sector, typical regulatory pressures, supply chain characteristics, and decarbonisation challenges relevant to this type of company.",
  "tone": "A short phrase describing the right report tone for this client (e.g. 'professional and board-ready, plain English').",
  "audience_notes": "Who typically reads this company's carbon report — reference the house default but tailor it if the company type suggests otherwise.",
  "narrative_notes": "What story should the carbon report tell for this client? Include any themes to emphasise given their sector and target year.",
  "preferred_terms": ["list", "of", "preferred", "terms"],
  "forbidden_terms": ["list", "of", "terms", "to", "avoid"],
  "section_notes": {{
    "executive_summary": "Guidance for the executive summary section for this client.",
    "emissions_overview": "Guidance for the emissions overview section.",
    "actions": "Guidance for the actions section.",
    "declaration": "Guidance for the declaration section."
  }}
}}

Rules:
- Use the house defaults as starting points and adapt them for this client.
- If no website content is available, generate sensible guidance based on the industry alone.
- Keep each field concise and actionable — this will be read by a consultant before running AI insights.
- Do not invent specific emissions figures or regulatory requirements that are not in the facts.
"""

    client = _get_anthropic_client()
    model = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")

    message = client.messages.create(
        model=model,
        max_tokens=2048,
        temperature=0.3,
        messages=[{"role": "user", "content": user_prompt}],
        system=system_prompt,
    )

    raw = message.content[0].text if message.content else ""

    # Strip any accidental markdown fences
    raw = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.IGNORECASE)
    raw = re.sub(r"\s*```$", "", raw.strip())

    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        # Last-resort: extract first {...} block
        m = re.search(r"\{[\s\S]+\}", raw)
        if m:
            result = json.loads(m.group(0))
        else:
            raise ValueError(f"LLM did not return valid JSON: {raw[:200]}")

    # Normalise types
    if isinstance(result.get("preferred_terms"), str):
        result["preferred_terms"] = [t.strip() for t in result["preferred_terms"].split(",") if t.strip()]
    if isinstance(result.get("forbidden_terms"), str):
        result["forbidden_terms"] = [t.strip() for t in result["forbidden_terms"].split(",") if t.strip()]
    if not isinstance(result.get("section_notes"), dict):
        result["section_notes"] = {}

    return result
