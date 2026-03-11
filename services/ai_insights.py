import json
import os
import re
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from core.database import get_conn

# allow customers to override the model via environment variable if new models
# are released; default to a model that works with the newer "messages" API.
# "claude-opus-4-6" is currently available; older deployments may fall back to
# the completions-compatible models, but we'll prefer the modern interface.
DEFAULT_ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-opus-4-6")
DEFAULT_OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4.1")

# we will lazily import anthropic to avoid hard dependency until needed

def _get_anthropic_client():
    # Ensure .env is loaded even if backend process CWD differs from project root.
    project_env = Path(__file__).resolve().parents[1] / ".env"
    if project_env.exists():
        load_dotenv(dotenv_path=project_env, override=False)

    try:
        from anthropic import Anthropic
    except ImportError:
        raise RuntimeError("Anthropic package not installed; please add `anthropic` to requirements.txt")
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")
    return Anthropic(api_key=api_key)


def _get_openai_client():
    try:
        from openai import OpenAI
    except ImportError:
        raise RuntimeError("OpenAI package not installed; please add `openai` to requirements.txt")
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set")
    return OpenAI(api_key=api_key)


def _build_prompt(
    client_info: dict[str, Any],
    emissions_summary: Optional[str],
    top_categories: list[dict[str, Any]],
    databank_context: list[dict[str, Any]] | None = None,
) -> str:
    # Build a strict JSON prompt with explicit response schema.
    cat_lines = []
    for c in top_categories[:5]:
        cat_lines.append(f"- {c.get('category')}: {float(c.get('emissions') or 0):.1f} tCO2e ({float(c.get('percentage') or 0):.1f}%)")

    parts = [
        "You are an expert sustainability consultant.",
        "Return ONLY valid JSON (no markdown) using this schema:",
        "{",
        '  "summary": "string",',
        '  "confidence": "low|medium|high",',
        '  "top_drivers": [{"title":"string","detail":"string","metric":"string","citation":"string"}],',
        '  "risks": [{"title":"string","detail":"string","citation":"string"}],',
        '  "recommended_actions": [{"title":"string","owner":"string","effort":"S|M|L","expected_impact":"string","timeframe":"string","rationale":"string","citation":"string"}],',
        '  "regulatory_context": [{"title":"string","detail":"string","source":"string"}],',
        '  "reduction_roadmap": {"short_term":["string"],"medium_term":["string"],"long_term":["string"]},',
        '  "data_gaps": ["string"]',
        "}",
        "Keep output concise and specific to the provided numbers.",
        "Include country-specific legislation/regulatory context relevant to emissions reporting and decarbonisation.",
    ]

    if client_info.get("client_name"):
        parts.append(f"Client name: {client_info['client_name']}")
    if client_info.get("industry"):
        parts.append(f"Industry/sector: {client_info['industry']}")
    if client_info.get("website"):
        parts.append(f"Website: {client_info['website']}")
    if client_info.get("addr_country"):
        parts.append(f"Country: {client_info['addr_country']}")
    if emissions_summary:
        parts.append("Emissions summary by year:")
        parts.append(emissions_summary)
    if cat_lines:
        parts.append("Top emission categories:")
        parts.extend(cat_lines)
    if databank_context:
        parts.append("Data Bank context (internal references to consider):")
        for row in databank_context[:30]:
            parts.append(
                "- "
                f"[{row.get('subject_name') or 'Subject'} | {row.get('category') or 'Category'} | "
                f"{row.get('country') or 'Global'} | {row.get('reporting_year') or 'N/A'}] "
                f"{row.get('title') or ''} :: {row.get('content') or ''} "
                f"(ref: {row.get('reference_text') or 'n/a'}, url: {row.get('source_url') or 'n/a'})"
            )

    prompt = "\n".join(parts)
    return prompt


def _extract_json(text: str) -> dict[str, Any] | None:
    raw = (text or "").strip()
    if not raw:
        return None
    # Direct JSON
    try:
        obj = json.loads(raw)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass
    # Try extracting the first balanced JSON object from noisy output.
    balanced = _extract_balanced_json_object(raw)
    if balanced:
        try:
            obj = json.loads(balanced)
            if isinstance(obj, dict):
                return obj
        except Exception:
            pass
    # Try extracting the largest JSON object span.
    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end != -1 and end > start:
        candidate = raw[start : end + 1]
        try:
            obj = json.loads(candidate)
            if isinstance(obj, dict):
                return obj
        except Exception:
            pass
    # Fenced JSON fallback
    m = re.search(r"```(?:json)?\s*(\{.*\})\s*```", raw, flags=re.DOTALL)
    if not m:
        return _extract_keyed_fragments(raw)
    try:
        obj = json.loads(m.group(1))
        return obj if isinstance(obj, dict) else None
    except Exception:
        return _extract_keyed_fragments(raw)


def _extract_balanced_json_object(raw: str) -> str | None:
    start = raw.find("{")
    if start == -1:
        return None

    depth = 0
    in_str = False
    escape = False
    for i in range(start, len(raw)):
        ch = raw[i]
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
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return raw[start : i + 1]
    return None


def _extract_keyed_fragments(raw: str) -> dict[str, Any] | None:
    """Best-effort parser for quasi-JSON snippets like: '"summary": "..."'."""
    def _find_str(key: str) -> str | None:
        # Quoted value
        m = re.search(rf'"{re.escape(key)}"\s*:\s*"((?:[^"\\]|\\.)*)"', raw, flags=re.DOTALL)
        if m:
            try:
                return bytes(m.group(1), "utf-8").decode("unicode_escape").strip()
            except Exception:
                return m.group(1).strip()
        # Bare token value
        m2 = re.search(rf'"{re.escape(key)}"\s*:\s*([A-Za-z0-9_-]+)', raw)
        if m2:
            return m2.group(1).strip()
        return None

    summary = _find_str("summary")
    confidence = _find_str("confidence")
    if not summary and not confidence:
        return None

    payload: dict[str, Any] = {}
    if summary:
        payload["summary"] = summary.rstrip(",")
    if confidence:
        payload["confidence"] = confidence.lower()
    return payload


def _normalize_structured(payload: dict[str, Any], fallback_text: str) -> dict[str, Any]:
    def _list_of_dicts(value: Any) -> list[dict[str, Any]]:
        if not isinstance(value, list):
            return []
        return [x for x in value if isinstance(x, dict)]

    confidence = str(payload.get("confidence") or "").strip().lower()
    if confidence not in ("low", "medium", "high"):
        confidence = "medium"

    summary = str(payload.get("summary") or "").strip()
    if not summary:
        summary = fallback_text.splitlines()[0].strip() if fallback_text else "Insights generated."

    return {
        "summary": summary,
        "confidence": confidence,
        "top_drivers": _list_of_dicts(payload.get("top_drivers")),
        "risks": _list_of_dicts(payload.get("risks")),
        "recommended_actions": _list_of_dicts(payload.get("recommended_actions")),
        "regulatory_context": _list_of_dicts(payload.get("regulatory_context")),
        "reduction_roadmap": payload.get("reduction_roadmap") if isinstance(payload.get("reduction_roadmap"), dict) else {
            "short_term": [],
            "medium_term": [],
            "long_term": [],
        },
        "data_gaps": [str(x) for x in (payload.get("data_gaps") or []) if str(x).strip()],
    }


def _fallback_structured(text: str) -> dict[str, Any]:
    # Remove markdown code-fence wrappers and empty lines to avoid noisy summaries.
    lines = []
    for ln in (text or "").splitlines():
        s = ln.strip()
        if not s:
            continue
        if s.startswith("```"):
            continue
        clean = s.strip("- ").strip()
        if clean in ("{", "}", "[", "]", ","):
            continue
        lines.append(clean)
    summary = lines[0] if lines else "Insights generated."
    return {
        "summary": summary,
        "confidence": "low",
        "top_drivers": [],
        "risks": [],
        "recommended_actions": [],
        "regulatory_context": [],
        "reduction_roadmap": {"short_term": [], "medium_term": [], "long_term": []},
        "data_gaps": ["Model returned unstructured output; consider regenerating insights."],
    }


def _local_insight_payload(
    client_info: dict[str, Any],
    yearly_rows: list[dict[str, Any]],
    top_categories: list[dict[str, Any]],
    reason: str,
) -> dict[str, Any]:
    latest = None
    previous = None
    valid_years = [r for r in yearly_rows if r.get("year") is not None]
    if valid_years:
        ordered = sorted(valid_years, key=lambda x: x["year"])
        latest = ordered[-1]
        if len(ordered) > 1:
            previous = ordered[-2]

    yoy_text = "No prior year available for change analysis."
    yoy_change = None
    if latest and previous and float(previous.get("total") or 0) > 0:
        yoy_change = ((float(latest.get("total") or 0) - float(previous.get("total") or 0)) / float(previous.get("total") or 0)) * 100
        yoy_text = f"Year-over-year change is {yoy_change:+.1f}%."

    top = top_categories[0] if top_categories else None
    top_title = str(top.get("category") or "No category data") if top else "No category data"
    top_emissions = float(top.get("emissions") or 0) if top else 0.0
    top_pct = float(top.get("percentage") or 0) if top else 0.0

    client_name = str(client_info.get("client_name") or "Client")
    latest_year = latest.get("year") if latest else "N/A"
    latest_total = float(latest.get("total") or 0) if latest else 0.0
    summary = (
        f"{client_name} recorded {latest_total:.1f} tCO2e in {latest_year}. "
        f"{yoy_text} Top driver: {top_title} ({top_emissions:.1f} tCO2e, {top_pct:.1f}%)."
    )

    country = str(client_info.get("addr_country") or "").strip().lower()
    regulatory_context = []
    if "united kingdom" in country or country == "uk":
        regulatory_context = [
            {"title": "UK Streamlined Energy and Carbon Reporting (SECR)", "detail": "Large UK entities may need annual energy and carbon disclosures.", "source": "UK government guidance"},
            {"title": "UK net-zero policy direction", "detail": "Transition planning and decarbonisation evidence are increasingly expected by stakeholders.", "source": "UK policy landscape"},
        ]
    elif "united states" in country or country == "usa" or country == "us":
        regulatory_context = [
            {"title": "US climate disclosure trend", "detail": "Federal and state-level disclosure expectations are evolving and should be tracked.", "source": "US regulatory landscape"},
        ]
    elif "australia" in country:
        regulatory_context = [
            {"title": "Australian climate disclosure trend", "detail": "Mandatory climate-related reporting requirements are expanding over phased periods.", "source": "Australian regulatory landscape"},
        ]
    else:
        regulatory_context = [
            {"title": "Jurisdiction-specific climate regulation", "detail": "Country-level emissions reporting and transition disclosure rules should be monitored annually.", "source": "Local regulator guidance"},
        ]

    roadmap = {
        "short_term": [
            "Improve data quality controls for top emitting categories and sites.",
            "Prioritise no-regret efficiency actions in highest-emitting operations.",
            "Set owner-level monthly tracking for top 3 emission drivers.",
        ],
        "medium_term": [
            "Execute targeted reduction projects for dominant Scope 1/2/3 categories.",
            "Embed supplier engagement and procurement criteria for lower-carbon inputs.",
            "Align annual budgets with quantified emissions reduction initiatives.",
        ],
        "long_term": [
            "Plan structural decarbonisation roadmap aligned to net-zero target year.",
            "Integrate transition planning with capital planning and asset replacement cycles.",
            "Mature governance and external assurance for recurring climate disclosures.",
        ],
    }

    structured = {
        "summary": summary,
        "confidence": "medium",
        "top_drivers": (
            [{
                "title": top_title,
                "detail": f"Largest emissions contributor in selected data at {top_emissions:.1f} tCO2e.",
                "metric": f"{top_pct:.1f}% of total",
                "citation": "job_scope_rows.level_2",
            }] if top else []
        ),
        "risks": (
            [{
                "title": "Rising emissions risk",
                "detail": "Total emissions increased versus previous year.",
                "citation": "jobs + job_scope_rows",
            }] if yoy_change is not None and yoy_change > 0 else []
        ),
        "recommended_actions": (
            [{
                "title": f"Reduce {top_title} emissions",
                "owner": "Client sustainability lead",
                "effort": "M",
                "expected_impact": "Medium",
                "timeframe": "Next reporting cycle",
                "rationale": "Target the highest emitting category first to maximize reduction impact.",
                "citation": "job_scope_rows.level_2",
            }] if top else []
        ),
        "regulatory_context": regulatory_context,
        "reduction_roadmap": roadmap,
        "data_gaps": [f"AI model unavailable: {reason}. Generated rule-based insights instead."],
    }

    citations: list[dict[str, str]] = []
    if latest:
        citations.append(
            {
                "label": "Latest total emissions",
                "value": f"{latest_total:.1f} tCO2e ({latest_year})",
                "source": "jobs + job_scope_rows",
            }
        )
    if top:
        citations.append(
            {
                "label": "Top emission category",
                "value": f"{top_title}: {top_emissions:.1f} tCO2e",
                "source": "job_scope_rows.level_2",
            }
        )

    return {"insights": summary, "structured": structured, "citations": citations}


def generate_client_insights(client_db_id: int, provider: str = "anthropic") -> dict[str, Any]:
    """Fetch client data, call the LLM, and return structured + raw insight output.

    Returns:
    {
      "insights": "<raw text>",
      "structured": {...},
      "citations": [{"label": "...", "value": "...", "source": "..."}]
    }
    """
    # collect client info
    with get_conn() as con:
        row = con.execute(
            "SELECT client_name, industry, website, addr_country FROM clients WHERE db_id = %s",
            [int(client_db_id)],
        ).fetchone()
        if not row:
            raise ValueError(f"Client {client_db_id} not found")

        # some DB drivers return tuples rather than mapping objects; normalize
        if isinstance(row, tuple):
            # columns in SELECT order
            client_info = {
                "client_name": row[0],
                "industry": row[1],
                "website": row[2],
                "addr_country": row[3],
            }
        else:
            # mapping-like interface
            client_info = {
                "client_name": row.get("client_name"),
                "industry": row.get("industry"),
                "website": row.get("website"),
                "addr_country": row.get("addr_country"),
            }

        # Emissions summary: totals by year.
        emissions_df = con.execute(
            """
            SELECT j.reporting_year,
                   COALESCE(SUM(
                       CASE WHEN LOWER(COALESCE(jsr.ghg_unit,'kgCO2e')) LIKE '%%kg%%' THEN
                           (COALESCE(jsr.qty,
                                   COALESCE(jsr.month_1,0)+COALESCE(jsr.month_2,0)+
                                   COALESCE(jsr.month_3,0)+COALESCE(jsr.month_4,0)+
                                   COALESCE(jsr.month_5,0)+COALESCE(jsr.month_6,0)+
                                   COALESCE(jsr.month_7,0)+COALESCE(jsr.month_8,0)+
                                   COALESCE(jsr.month_9,0)+COALESCE(jsr.month_10,0)+
                                   COALESCE(jsr.month_11,0)+COALESCE(jsr.month_12,0),0)
                               * COALESCE(jsr.factor,0) * COALESCE(jsr.apply_pct,100)/100.0)/1000.0
                       ELSE
                           (COALESCE(jsr.qty,
                                   COALESCE(jsr.month_1,0)+COALESCE(jsr.month_2,0)+
                                   COALESCE(jsr.month_3,0)+COALESCE(jsr.month_4,0)+
                                   COALESCE(jsr.month_5,0)+COALESCE(jsr.month_6,0)+
                                   COALESCE(jsr.month_7,0)+COALESCE(jsr.month_8,0)+
                                   COALESCE(jsr.month_9,0)+COALESCE(jsr.month_10,0)+
                                   COALESCE(jsr.month_11,0)+COALESCE(jsr.month_12,0),0)
                               * COALESCE(jsr.factor,0) * COALESCE(jsr.apply_pct,100)/100.0)
                       END
                   ),0) as total_emissions
            FROM jobs j
            LEFT JOIN job_scope_rows jsr ON jsr.job_id = j.job_id AND jsr.enabled = TRUE
            WHERE j.client_db_id = %s AND j.is_crp = TRUE
            GROUP BY j.reporting_year
            ORDER BY j.reporting_year
            """,
            [int(client_db_id)],
        ).df()

        categories_df = con.execute(
            """
            SELECT jsr.level_2 as category,
                   COALESCE(SUM(
                       CASE
                           WHEN LOWER(COALESCE(jsr.ghg_unit, 'kgCO2e')) LIKE '%%kg%%' THEN
                               (COALESCE(jsr.qty,
                                       COALESCE(jsr.month_1,0)+COALESCE(jsr.month_2,0)+
                                       COALESCE(jsr.month_3,0)+COALESCE(jsr.month_4,0)+
                                       COALESCE(jsr.month_5,0)+COALESCE(jsr.month_6,0)+
                                       COALESCE(jsr.month_7,0)+COALESCE(jsr.month_8,0)+
                                       COALESCE(jsr.month_9,0)+COALESCE(jsr.month_10,0)+
                                       COALESCE(jsr.month_11,0)+COALESCE(jsr.month_12,0),0)
                                   * COALESCE(jsr.factor,0) * COALESCE(jsr.apply_pct,100)/100.0)/1000.0
                           ELSE
                               (COALESCE(jsr.qty,
                                       COALESCE(jsr.month_1,0)+COALESCE(jsr.month_2,0)+
                                       COALESCE(jsr.month_3,0)+COALESCE(jsr.month_4,0)+
                                       COALESCE(jsr.month_5,0)+COALESCE(jsr.month_6,0)+
                                       COALESCE(jsr.month_7,0)+COALESCE(jsr.month_8,0)+
                                       COALESCE(jsr.month_9,0)+COALESCE(jsr.month_10,0)+
                                       COALESCE(jsr.month_11,0)+COALESCE(jsr.month_12,0),0)
                                   * COALESCE(jsr.factor,0) * COALESCE(jsr.apply_pct,100)/100.0)
                       END
                   ),0) as total_emissions
            FROM job_scope_rows jsr
            JOIN jobs j ON j.job_id = jsr.job_id
            WHERE j.client_db_id = %s
              AND j.is_crp = TRUE
              AND jsr.enabled = TRUE
              AND jsr.level_2 IS NOT NULL
              AND TRIM(jsr.level_2) != ''
              AND LOWER(jsr.level_2) != 'nan'
            GROUP BY jsr.level_2
            ORDER BY total_emissions DESC
            LIMIT 5
            """,
            [int(client_db_id)],
        ).df()

        # Optional Data Bank context to enrich prompt grounding.
        databank_df = None
        try:
            databank_df = con.execute(
                """
                SELECT
                  c.title, c.content, c.category, c.country, c.reporting_year,
                  c.reference_text, c.source_url,
                  s.name AS subject_name
                FROM databank_cards c
                LEFT JOIN databank_subjects_lookup s ON s.subject_id = c.subject_id
                WHERE c.is_active = TRUE
                  AND (
                    COALESCE(c.country, '') = ''
                    OR lower(c.country) = 'global'
                    OR lower(c.country) = lower(%s)
                  )
                ORDER BY c.created_at DESC
                LIMIT 30
                """,
                [str(client_info.get("addr_country") or "").strip()],
            ).df()
        except Exception:
            databank_df = None

    emissions_summary = None
    yearly_rows: list[dict[str, Any]] = []
    if emissions_df is not None and not emissions_df.empty:
        lines = []
        for _, r in emissions_df.iterrows():
            yr = r.get("reporting_year")
            tot = r.get("total_emissions") or 0
            lines.append(f"{yr}: {tot:.1f} tCO2e")
            yearly_rows.append({"year": yr, "total": float(tot)})
        emissions_summary = "; ".join(lines)

    top_categories: list[dict[str, Any]] = []
    if categories_df is not None and not categories_df.empty:
        total = float(categories_df["total_emissions"].sum() or 0)
        for _, r in categories_df.iterrows():
            emissions = float(r.get("total_emissions") or 0)
            top_categories.append(
                {
                    "category": str(r.get("category") or "").strip(),
                    "emissions": emissions,
                    "percentage": ((emissions / total) * 100.0) if total > 0 else 0.0,
                }
            )

    databank_context: list[dict[str, Any]] = []
    if databank_df is not None and not databank_df.empty:
        for _, r in databank_df.iterrows():
            databank_context.append(
                {
                    "title": str(r.get("title") or "").strip(),
                    "content": str(r.get("content") or "").strip(),
                    "category": str(r.get("category") or "").strip(),
                    "country": str(r.get("country") or "").strip(),
                    "reporting_year": int(r.get("reporting_year")) if r.get("reporting_year") is not None and r.get("reporting_year") == r.get("reporting_year") else None,
                    "reference_text": str(r.get("reference_text") or "").strip(),
                    "source_url": str(r.get("source_url") or "").strip(),
                    "subject_name": str(r.get("subject_name") or "").strip(),
                }
            )

    prompt = _build_prompt(client_info, emissions_summary, top_categories, databank_context)

    provider_key = (provider or "anthropic").strip().lower()
    raw_text = ""
    if provider_key == "openai":
        try:
            client = _get_openai_client()
            response = client.chat.completions.create(
                model=DEFAULT_OPENAI_MODEL,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=1000,
                temperature=0.2,
            )
            raw_text = (response.choices[0].message.content or "").strip() if response.choices else ""
        except Exception as exc:
            return _local_insight_payload(client_info, yearly_rows, top_categories, f"OpenAI unavailable: {exc}")
    else:
        try:
            client = _get_anthropic_client()
            response = client.messages.create(
                model=DEFAULT_ANTHROPIC_MODEL,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=1000,
                temperature=0.2,
            )
            if response.content and hasattr(response.content[0], "text"):
                raw_text = response.content[0].text.strip()
            else:
                raw_text = str(response)
        except Exception as exc:
            return _local_insight_payload(client_info, yearly_rows, top_categories, f"Anthropic unavailable: {exc}")

    parsed = _extract_json(raw_text)
    structured = _normalize_structured(parsed or {}, raw_text) if parsed else _fallback_structured(raw_text)

    citations: list[dict[str, str]] = []
    if yearly_rows:
        latest = sorted([r for r in yearly_rows if r.get("year") is not None], key=lambda x: x["year"])[-1]
        citations.append(
            {
                "label": "Latest total emissions",
                "value": f"{latest.get('total', 0):.1f} tCO2e ({latest.get('year')})",
                "source": "jobs + job_scope_rows",
            }
        )
    if top_categories:
        top = top_categories[0]
        citations.append(
            {
                "label": "Top emission category",
                "value": f"{top.get('category')}: {float(top.get('emissions') or 0):.1f} tCO2e",
                "source": "job_scope_rows.level_2",
            }
        )
    if databank_context:
        citations.append(
            {
                "label": "Data Bank context cards used",
                "value": str(len(databank_context)),
                "source": "databank_cards",
            }
        )

    return {"insights": raw_text, "structured": structured, "citations": citations}
