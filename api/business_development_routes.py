from __future__ import annotations

from datetime import date, datetime, timedelta
import json
import math
import os
import re
import base64
from urllib.parse import quote_plus, urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from typing import Any
from pathlib import Path

from dotenv import dotenv_values

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from api.auth import _current_user
from core.database import get_conn

router = APIRouter(tags=["business-development"])

_DOTENV_CACHE: dict[str, str] | None = None


def _env_value(key: str, default: str = "") -> str:
    value = str(os.environ.get(key) or "").strip()
    if value:
        return value
    global _DOTENV_CACHE
    if _DOTENV_CACHE is None:
        try:
            env_path = Path(__file__).resolve().parents[1] / ".env"
            raw = dotenv_values(str(env_path))
            _DOTENV_CACHE = {str(k): str(v or "") for k, v in raw.items() if k}
        except Exception:
            _DOTENV_CACHE = {}
    return str((_DOTENV_CACHE or {}).get(key) or default).strip()


def _apollo_api_key() -> str:
    return _env_value("APOLLO_API_KEY", "")


def _apollo_headers() -> dict[str, str]:
    api_key = _apollo_api_key()
    if not api_key:
        raise RuntimeError("APOLLO_API_KEY is not set")
    return {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Cache-Control": "no-cache",
        "Authorization": f"Bearer {api_key}",
        "X-Api-Key": api_key,
        "User-Agent": "NZI-Pro-LeadGen/1.0",
    }


def _apollo_request(
    method: str,
    url: str,
    *,
    payload: dict[str, Any] | None = None,
    query: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if query:
        pairs: list[tuple[str, str]] = []
        for key, value in query.items():
            if value is None:
                continue
            if isinstance(value, list):
                for item in value:
                    if item is None:
                        continue
                    pairs.append((str(key), str(item)))
            else:
                pairs.append((str(key), str(value)))
        if pairs:
            sep = "&" if "?" in url else "?"
            url = f"{url}{sep}{urlencode(pairs, doseq=True)}"
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    req = Request(url, method=method.upper(), data=body, headers=_apollo_headers())
    try:
        with urlopen(req, timeout=40) as resp:
            raw = resp.read().decode("utf-8", errors="ignore")
    except HTTPError as e:
        raw = e.read().decode("utf-8", errors="ignore")
        detail = raw.strip() or str(e)
        raise RuntimeError(f"Apollo HTTP Error {e.code}: {detail}") from e
    except URLError as e:
        raise RuntimeError(f"Apollo network error: {e.reason}") from e
    except Exception as e:
        raise RuntimeError(f"Apollo request failed: {e}") from e
    try:
        parsed = json.loads(raw) if raw else {}
    except Exception:
        raise RuntimeError("Apollo returned non-JSON response")
    return parsed if isinstance(parsed, dict) else {}


def _apollo_extract_items(payload: dict[str, Any], *keys: str) -> list[dict[str, Any]]:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    return []


def _apollo_revenue_to_gbp_m(value: Any) -> float:
    revenue = _safe_float(value, 0)
    if revenue <= 0:
        return 0.0
    if revenue >= 1_000_000:
        return round(revenue / 1_000_000.0, 1)
    return round(revenue, 1)


def _apollo_company_employee_band(employee_count: Any) -> str:
    count = _safe_int(employee_count, None)
    if count is None or count <= 0:
        return ""
    if count < 50:
        return "under-50"
    if count < 250:
        return "50-249"
    if count < 1000:
        return "250-999"
    return "1000+"


def _apollo_normalize_company(row: dict[str, Any]) -> dict[str, Any]:
    website = (
        str(row.get("website_url") or "").strip()
        or str(row.get("website") or "").strip()
        or str(row.get("organization_website_url") or "").strip()
    )
    domain = (
        str(row.get("primary_domain") or "").strip()
        or str(row.get("domain") or "").strip()
        or _host_from_website(website)
    )
    company_name = (
        str(row.get("name") or "").strip()
        or str(row.get("organization_name") or "").strip()
        or str(row.get("account_name") or "").strip()
    )
    industry = ""
    if isinstance(row.get("industry"), str):
        industry = str(row.get("industry") or "").strip()
    elif isinstance(row.get("industries"), list):
        industry = ", ".join([str(x).strip() for x in row.get("industries") or [] if str(x).strip()])
    employee_count = _safe_int(
        row.get("estimated_num_employees")
        or row.get("num_employees")
        or row.get("employee_count"),
        None,
    )
    revenue_gbp_m = _apollo_revenue_to_gbp_m(
        row.get("annual_revenue")
        or row.get("estimated_annual_revenue")
        or row.get("revenue")
    )
    return {
        "provider_org_id": _safe_str(row.get("id") or row.get("organization_id") or row.get("account_id"), ""),
        "company_name": company_name,
        "website": website,
        "domain": domain,
        "industry": industry,
        "subindustry": _safe_str(row.get("subindustry") or row.get("industry_tag"), ""),
        "country": _safe_str(row.get("country") or row.get("organization_country"), ""),
        "region": _safe_str(row.get("state") or row.get("region") or row.get("organization_state"), ""),
        "city": _safe_str(row.get("city") or row.get("locality"), ""),
        "revenue_gbp_millions": revenue_gbp_m,
        "revenue_band_label": _revenue_band_label(revenue_gbp_m),
        "employee_count": employee_count,
        "employee_band_label": _apollo_company_employee_band(employee_count),
        "qualification_status": "new",
        "source_payload_json": json.dumps(row),
    }


def _apollo_normalize_contact(row: dict[str, Any]) -> dict[str, Any]:
    name = " ".join([str(row.get("first_name") or "").strip(), str(row.get("last_name") or "").strip()]).strip()
    company = row.get("organization") if isinstance(row.get("organization"), dict) else {}
    return {
        "provider_person_id": _safe_str(row.get("id"), ""),
        "full_name": name or _safe_str(row.get("name"), ""),
        "job_title": _safe_str(row.get("title"), ""),
        "seniority": _safe_str(row.get("seniority"), ""),
        "department": _safe_str(row.get("department"), ""),
        "email": _safe_str(row.get("email"), ""),
        "phone": _safe_str(row.get("phone_number") or row.get("sanitized_phone"), ""),
        "linkedin_url": _safe_str(row.get("linkedin_url"), ""),
        "company_name": _safe_str(company.get("name") or row.get("organization_name"), ""),
        "website": _safe_str(company.get("website_url") or row.get("organization_website_url"), ""),
        "country": _safe_str(company.get("country") or row.get("organization_country"), ""),
        "city": _safe_str(company.get("city") or row.get("organization_city"), ""),
        "industry": _safe_str(company.get("industry") or row.get("organization_industry"), ""),
        "source_payload_json": json.dumps(row),
    }


def _apollo_health() -> dict[str, Any]:
    payload = _apollo_request("GET", "https://api.apollo.io/api/v1/auth/health")
    usage: dict[str, Any] | None = None
    usage_error = ""
    try:
        usage = _apollo_request("GET", "https://api.apollo.io/api/v1/usage_stats")
    except Exception as e:
        usage_error = str(e)
    return {
        "auth": payload,
        "usage_stats": usage,
        "usage_error": usage_error or None,
    }


def _apollo_organization_enrich(*, domain: str = "", organization_name: str = "") -> dict[str, Any]:
    query: dict[str, Any] = {}
    if str(domain).strip():
        query["domain"] = str(domain).strip()
    if str(organization_name).strip():
        query["organization_name"] = str(organization_name).strip()
    if not query:
        raise RuntimeError("domain or organization_name is required")
    return _apollo_request("GET", "https://api.apollo.io/api/v1/organizations/enrich", query=query)


def _apollo_search_organizations(payload: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    raw = _apollo_request("POST", "https://api.apollo.io/api/v1/mixed_companies/search", payload=payload)
    items = _apollo_extract_items(raw, "organizations", "accounts", "companies")
    normalized = [_apollo_normalize_company(item) for item in items]
    normalized = [item for item in normalized if item.get("company_name")]
    return normalized, raw


def _apollo_search_people(payload: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    raw = _apollo_request("POST", "https://api.apollo.io/api/v1/mixed_people/search", payload=payload)
    items = _apollo_extract_items(raw, "people", "contacts")
    normalized = [_apollo_normalize_contact(item) for item in items]
    normalized = [item for item in normalized if item.get("full_name") or item.get("company_name")]
    return normalized, raw


def _actor(user: dict[str, str]) -> str:
    return str(user.get("email") or user.get("user_id") or "system").strip()


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or str(value).strip() == "":
            return default
        return float(value)
    except Exception:
        return default


def _safe_int(value: Any, default: int | None = None) -> int | None:
    try:
        if value is None or str(value).strip() == "":
            return default
        if isinstance(value, float) and math.isnan(value):
            return default
        return int(value)
    except Exception:
        return default


def _parse_json_array(text: str) -> list[dict[str, Any]]:
    raw = (text or "").strip()
    if not raw:
        return []
    try:
        value = json.loads(raw)
        if isinstance(value, list):
            return [v for v in value if isinstance(v, dict)]
    except Exception:
        pass
    m = re.search(r"```(?:json)?\s*(\[.*\])\s*```", raw, flags=re.DOTALL)
    if not m:
        try:
            obj = json.loads(raw)
            if isinstance(obj, dict):
                items = obj.get("items")
                if isinstance(items, list):
                    return [x for x in items if isinstance(x, dict)]
        except Exception:
            return []
        return []
    try:
        value = json.loads(m.group(1))
        if isinstance(value, list):
            return [v for v in value if isinstance(v, dict)]
    except Exception:
        return []
    return []


def _to_date(value: Any) -> date:
    if isinstance(value, date):
        return value
    text = str(value or "").strip()
    if not text:
        return date.today()
    try:
        return datetime.fromisoformat(text[:10]).date()
    except Exception:
        return date.today()


def _safe_str(value: Any, default: str = "") -> str:
    try:
        if value is None:
            return default
        if isinstance(value, float) and math.isnan(value):
            return default
        return str(value)
    except Exception:
        return default


def _ensure_tables(con) -> None:
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS bd_scan_batches (
          scan_batch_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          scan_type VARCHAR NOT NULL DEFAULT 'market_scan',
          provider VARCHAR,
          regions_json TEXT,
          industries_json TEXT,
          roles_json TEXT,
          revenue_min_gbp_m DOUBLE PRECISION,
          revenue_max_gbp_m DOUBLE PRECISION,
          requested_count INTEGER NOT NULL DEFAULT 0,
          returned_count INTEGER NOT NULL DEFAULT 0,
          status VARCHAR NOT NULL DEFAULT 'pending',
          diagnostics TEXT,
          created_by VARCHAR,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
        """
    )
    con.execute("CREATE INDEX IF NOT EXISTS ix_bd_scan_batches_created ON bd_scan_batches (scan_type, created_at DESC)")

    con.execute(
        """
        CREATE TABLE IF NOT EXISTS bd_market_companies (
          market_company_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          source_provider VARCHAR NOT NULL DEFAULT 'ai-open-source',
          provider_org_id VARCHAR,
          scan_batch_id INTEGER,
          service_key VARCHAR,
          company_name VARCHAR NOT NULL,
          normalized_company_key VARCHAR,
          website VARCHAR,
          domain VARCHAR,
          industry VARCHAR,
          subindustry VARCHAR,
          country VARCHAR,
          region VARCHAR,
          city VARCHAR,
          revenue_gbp_millions DOUBLE PRECISION,
          revenue_band_label VARCHAR,
          employee_count INTEGER,
          employee_band_label VARCHAR,
          source_payload_json TEXT,
          qualification_status VARCHAR NOT NULL DEFAULT 'new',
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
        """
    )
    con.execute("CREATE INDEX IF NOT EXISTS ix_bd_market_company_key ON bd_market_companies (normalized_company_key, country)")
    con.execute("CREATE INDEX IF NOT EXISTS ix_bd_market_company_domain ON bd_market_companies (domain)")
    con.execute("CREATE INDEX IF NOT EXISTS ix_bd_market_company_batch ON bd_market_companies (scan_batch_id, updated_at DESC)")

    con.execute(
        """
        CREATE TABLE IF NOT EXISTS bd_company_verifications (
          verification_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          market_company_id INTEGER NOT NULL,
          provider VARCHAR NOT NULL,
          registry_company_id VARCHAR,
          registry_jurisdiction VARCHAR,
          legal_name VARCHAR,
          company_status VARCHAR,
          company_number VARCHAR,
          sic_codes_json TEXT,
          registered_address TEXT,
          incorporation_date DATE,
          match_confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
          verified_at TIMESTAMP NOT NULL DEFAULT NOW(),
          source_url TEXT,
          source_payload_json TEXT
        )
        """
    )
    con.execute("CREATE INDEX IF NOT EXISTS ix_bd_company_verifications_company ON bd_company_verifications (market_company_id, verified_at DESC)")

    con.execute(
        """
        CREATE TABLE IF NOT EXISTS bd_company_contacts (
          company_contact_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          market_company_id INTEGER NOT NULL,
          source_provider VARCHAR NOT NULL DEFAULT 'apollo',
          provider_person_id VARCHAR,
          full_name VARCHAR,
          job_title VARCHAR,
          seniority VARCHAR,
          department VARCHAR,
          email VARCHAR,
          phone VARCHAR,
          linkedin_url VARCHAR,
          is_primary_target BOOLEAN NOT NULL DEFAULT FALSE,
          contact_fit_score DOUBLE PRECISION NOT NULL DEFAULT 0,
          source_payload_json TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
        """
    )
    con.execute("CREATE INDEX IF NOT EXISTS ix_bd_company_contacts_company ON bd_company_contacts (market_company_id, is_primary_target DESC, contact_fit_score DESC)")

    con.execute(
        """
        CREATE TABLE IF NOT EXISTS bd_market_scores (
          market_score_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          market_company_id INTEGER NOT NULL,
          primary_contact_id INTEGER,
          overall_score DOUBLE PRECISION NOT NULL DEFAULT 0,
          industry_fit_score DOUBLE PRECISION NOT NULL DEFAULT 0,
          revenue_fit_score DOUBLE PRECISION NOT NULL DEFAULT 0,
          buyer_role_score DOUBLE PRECISION NOT NULL DEFAULT 0,
          service_need_score DOUBLE PRECISION NOT NULL DEFAULT 0,
          verification_score DOUBLE PRECISION NOT NULL DEFAULT 0,
          priority_band VARCHAR,
          why_good_lead TEXT,
          trigger_reason TEXT,
          scored_by_model VARCHAR,
          scored_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
        """
    )
    con.execute("CREATE INDEX IF NOT EXISTS ix_bd_market_scores_company ON bd_market_scores (market_company_id, scored_at DESC)")

    con.execute(
        """
        CREATE TABLE IF NOT EXISTS bd_funnel_stages (
          stage_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          stage_key VARCHAR NOT NULL UNIQUE,
          stage_name VARCHAR NOT NULL,
          stage_order INTEGER NOT NULL,
          probability_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
        """
    )
    con.execute("CREATE INDEX IF NOT EXISTS ix_bd_stages_order ON bd_funnel_stages (stage_order)")

    con.execute(
        """
        CREATE TABLE IF NOT EXISTS bd_leads (
          lead_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          lead_name VARCHAR NOT NULL,
          company_name VARCHAR,
          contact_name VARCHAR,
          email VARCHAR,
          phone VARCHAR,
          country VARCHAR,
          industry VARCHAR,
          source VARCHAR,
          owner_user_id VARCHAR,
          notes TEXT,
          status VARCHAR NOT NULL DEFAULT 'new',
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          converted_at TIMESTAMP,
          converted_to_opportunity_id INTEGER
        )
        """
    )
    con.execute("CREATE INDEX IF NOT EXISTS ix_bd_leads_status ON bd_leads (status, created_at DESC)")

    con.execute(
        """
        CREATE TABLE IF NOT EXISTS bd_opportunities (
          opportunity_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          lead_id INTEGER,
          opportunity_name VARCHAR NOT NULL,
          company_name VARCHAR,
          contact_name VARCHAR,
          email VARCHAR,
          phone VARCHAR,
          country VARCHAR,
          industry VARCHAR,
          owner_user_id VARCHAR,
          stage_id INTEGER NOT NULL,
          expected_close_date DATE,
          estimated_value DOUBLE PRECISION NOT NULL DEFAULT 0,
          currency VARCHAR NOT NULL DEFAULT 'GBP',
          probability_pct DOUBLE PRECISION,
          status VARCHAR NOT NULL DEFAULT 'open',
          notes TEXT,
          client_db_id INTEGER,
          quote_id INTEGER,
          job_id INTEGER,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          won_at TIMESTAMP,
          lost_at TIMESTAMP,
          lost_reason TEXT
        )
        """
    )
    con.execute("CREATE INDEX IF NOT EXISTS ix_bd_opp_stage ON bd_opportunities (stage_id, status)")
    con.execute("CREATE INDEX IF NOT EXISTS ix_bd_opp_owner ON bd_opportunities (owner_user_id, status)")

    con.execute(
        """
        CREATE TABLE IF NOT EXISTS bd_service_lines (
          service_key VARCHAR PRIMARY KEY,
          service_name VARCHAR NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
        """
    )
    con.execute("ALTER TABLE bd_service_lines ADD COLUMN IF NOT EXISTS service_name VARCHAR")
    con.execute("ALTER TABLE bd_service_lines ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0")
    con.execute("ALTER TABLE bd_service_lines ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE")
    con.execute("ALTER TABLE bd_service_lines ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW()")
    con.execute("ALTER TABLE bd_service_lines ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()")

    con.execute(
        """
        CREATE TABLE IF NOT EXISTS bd_bin_reasons_lookup (
          bin_reason_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          name VARCHAR NOT NULL UNIQUE,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          sort_order INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    default_bin_reasons = [
        ("Competitor", 1),
        ("Company Too Large", 2),
        ("Likelihood Too Low", 3),
        ("Other", 4),
    ]
    for reason_name, sort_order in default_bin_reasons:
        con.execute(
            """
            INSERT INTO bd_bin_reasons_lookup (name, is_active, sort_order)
            SELECT ?, TRUE, ?
            WHERE NOT EXISTS (
              SELECT 1 FROM bd_bin_reasons_lookup WHERE lower(name) = lower(?)
            )
            """,
            [reason_name, int(sort_order), reason_name],
        )

    con.execute(
        """
        CREATE TABLE IF NOT EXISTS bd_ai_generated_leads (
          generated_lead_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          bin_date DATE NOT NULL,
          service_key VARCHAR NOT NULL,
          company_name VARCHAR NOT NULL,
          industry VARCHAR,
          country VARCHAR,
          city VARCHAR,
          website VARCHAR,
          contact_name VARCHAR,
          contact_role VARCHAR,
          contact_email VARCHAR,
          contact_phone VARCHAR,
          revenue_gbp_millions DOUBLE PRECISION,
          likelihood_score DOUBLE PRECISION NOT NULL DEFAULT 0,
          why_good_lead TEXT,
          trigger_reason TEXT,
          source_references TEXT,
          qualification_status VARCHAR NOT NULL DEFAULT 'new',
          bin_reason_id INTEGER,
          bin_reason_name VARCHAR,
          qualified_by VARCHAR,
          qualified_at TIMESTAMP,
          qualification_notes TEXT,
          bd_lead_id INTEGER,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
        """
    )
    con.execute("ALTER TABLE bd_ai_generated_leads ADD COLUMN IF NOT EXISTS bin_date DATE")
    con.execute("ALTER TABLE bd_ai_generated_leads ADD COLUMN IF NOT EXISTS service_key VARCHAR")
    con.execute("ALTER TABLE bd_ai_generated_leads ADD COLUMN IF NOT EXISTS company_name VARCHAR")
    con.execute("ALTER TABLE bd_ai_generated_leads ADD COLUMN IF NOT EXISTS industry VARCHAR")
    con.execute("ALTER TABLE bd_ai_generated_leads ADD COLUMN IF NOT EXISTS country VARCHAR")
    con.execute("ALTER TABLE bd_ai_generated_leads ADD COLUMN IF NOT EXISTS city VARCHAR")
    con.execute("ALTER TABLE bd_ai_generated_leads ADD COLUMN IF NOT EXISTS website VARCHAR")
    con.execute("ALTER TABLE bd_ai_generated_leads ADD COLUMN IF NOT EXISTS contact_name VARCHAR")
    con.execute("ALTER TABLE bd_ai_generated_leads ADD COLUMN IF NOT EXISTS contact_role VARCHAR")
    con.execute("ALTER TABLE bd_ai_generated_leads ADD COLUMN IF NOT EXISTS contact_email VARCHAR")
    con.execute("ALTER TABLE bd_ai_generated_leads ADD COLUMN IF NOT EXISTS contact_phone VARCHAR")
    con.execute("ALTER TABLE bd_ai_generated_leads ADD COLUMN IF NOT EXISTS revenue_gbp_millions DOUBLE PRECISION")
    con.execute("ALTER TABLE bd_ai_generated_leads ADD COLUMN IF NOT EXISTS likelihood_score DOUBLE PRECISION NOT NULL DEFAULT 0")
    con.execute("ALTER TABLE bd_ai_generated_leads ADD COLUMN IF NOT EXISTS why_good_lead TEXT")
    con.execute("ALTER TABLE bd_ai_generated_leads ADD COLUMN IF NOT EXISTS trigger_reason TEXT")
    con.execute("ALTER TABLE bd_ai_generated_leads ADD COLUMN IF NOT EXISTS source_references TEXT")
    con.execute("ALTER TABLE bd_ai_generated_leads ADD COLUMN IF NOT EXISTS qualification_status VARCHAR NOT NULL DEFAULT 'new'")
    con.execute("ALTER TABLE bd_ai_generated_leads ADD COLUMN IF NOT EXISTS bin_reason_id INTEGER")
    con.execute("ALTER TABLE bd_ai_generated_leads ADD COLUMN IF NOT EXISTS bin_reason_name VARCHAR")
    con.execute("ALTER TABLE bd_ai_generated_leads ADD COLUMN IF NOT EXISTS qualified_by VARCHAR")
    con.execute("ALTER TABLE bd_ai_generated_leads ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMP")
    con.execute("ALTER TABLE bd_ai_generated_leads ADD COLUMN IF NOT EXISTS qualification_notes TEXT")
    con.execute("ALTER TABLE bd_ai_generated_leads ADD COLUMN IF NOT EXISTS bd_lead_id INTEGER")
    con.execute("ALTER TABLE bd_ai_generated_leads ADD COLUMN IF NOT EXISTS market_company_id INTEGER")
    con.execute("ALTER TABLE bd_ai_generated_leads ADD COLUMN IF NOT EXISTS scan_batch_id INTEGER")
    con.execute("ALTER TABLE bd_ai_generated_leads ADD COLUMN IF NOT EXISTS source_provider VARCHAR")
    con.execute("ALTER TABLE bd_ai_generated_leads ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW()")
    con.execute("ALTER TABLE bd_ai_generated_leads ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()")
    con.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bd_ai_leads_day_service_company ON bd_ai_generated_leads (bin_date, service_key, company_name)"
    )
    con.execute("CREATE INDEX IF NOT EXISTS ix_bd_ai_leads_bin ON bd_ai_generated_leads (bin_date, service_key, qualification_status)")

    defaults = [
        ("lead", "Lead", 1, 10),
        ("qualified", "Qualified", 2, 35),
        ("proposal", "Proposal", 3, 65),
        ("closed", "Closed", 4, 100),
    ]
    for stage_key, stage_name, stage_order, probability in defaults:
        con.execute(
            """
            INSERT INTO bd_funnel_stages (stage_key, stage_name, stage_order, probability_pct, is_active, created_at, updated_at)
            SELECT ?, ?, ?, ?, TRUE, NOW(), NOW()
            WHERE NOT EXISTS (SELECT 1 FROM bd_funnel_stages WHERE lower(stage_key) = lower(?))
            """,
            [stage_key, stage_name, int(stage_order), float(probability), stage_key],
        )

    service_defaults = [
        ("market-targeting", "Industry & Role Targeting", 0),
        ("carbon-reduction-plan", "Carbon Reduction Plans", 1),
        ("net-zero-support", "Net Zero Support", 2),
        ("consultancy", "Consultancy", 3),
        ("training-workshops", "Training & Workshops", 4),
        ("life-cycle-assessments", "Life Cycle Assessments (LCA)", 5),
    ]
    for service_key, service_name, sort_order in service_defaults:
        con.execute(
            """
            INSERT INTO bd_service_lines (service_key, service_name, sort_order, is_active, created_at, updated_at)
            SELECT ?, ?, ?, TRUE, NOW(), NOW()
            WHERE NOT EXISTS (SELECT 1 FROM bd_service_lines WHERE lower(service_key)=lower(?))
            """,
            [service_key, service_name, int(sort_order), service_key],
        )


def _serialize_stage(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "stage_id": int(row.get("stage_id") or 0),
        "stage_key": str(row.get("stage_key") or ""),
        "stage_name": str(row.get("stage_name") or ""),
        "stage_order": int(row.get("stage_order") or 0),
        "probability_pct": float(row.get("probability_pct") or 0),
        "is_active": bool(row.get("is_active") if row.get("is_active") is not None else True),
    }


def _serialize_lead(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "lead_id": int(row.get("lead_id") or 0),
        "lead_name": str(row.get("lead_name") or ""),
        "company_name": str(row.get("company_name") or ""),
        "contact_name": str(row.get("contact_name") or ""),
        "email": str(row.get("email") or ""),
        "phone": str(row.get("phone") or ""),
        "country": str(row.get("country") or ""),
        "industry": str(row.get("industry") or ""),
        "source": str(row.get("source") or ""),
        "owner_user_id": str(row.get("owner_user_id") or ""),
        "notes": str(row.get("notes") or ""),
        "status": str(row.get("status") or "new"),
        "created_at": row.get("created_at").isoformat() if row.get("created_at") else None,
        "updated_at": row.get("updated_at").isoformat() if row.get("updated_at") else None,
        "converted_at": row.get("converted_at").isoformat() if row.get("converted_at") else None,
        "converted_to_opportunity_id": int(row.get("converted_to_opportunity_id")) if row.get("converted_to_opportunity_id") is not None else None,
    }


def _serialize_opportunity(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "opportunity_id": int(row.get("opportunity_id") or 0),
        "lead_id": int(row.get("lead_id")) if row.get("lead_id") is not None else None,
        "opportunity_name": str(row.get("opportunity_name") or ""),
        "company_name": str(row.get("company_name") or ""),
        "contact_name": str(row.get("contact_name") or ""),
        "email": str(row.get("email") or ""),
        "phone": str(row.get("phone") or ""),
        "country": str(row.get("country") or ""),
        "industry": str(row.get("industry") or ""),
        "owner_user_id": str(row.get("owner_user_id") or ""),
        "stage_id": int(row.get("stage_id") or 0),
        "stage_key": str(row.get("stage_key") or ""),
        "stage_name": str(row.get("stage_name") or ""),
        "stage_order": int(row.get("stage_order") or 0),
        "expected_close_date": str(row.get("expected_close_date")) if row.get("expected_close_date") else None,
        "estimated_value": float(row.get("estimated_value") or 0),
        "currency": str(row.get("currency") or "GBP"),
        "probability_pct": float(row.get("probability_pct") if row.get("probability_pct") is not None else (row.get("stage_probability") or 0)),
        "status": str(row.get("status") or "open"),
        "notes": str(row.get("notes") or ""),
        "client_db_id": int(row.get("client_db_id")) if row.get("client_db_id") is not None else None,
        "quote_id": int(row.get("quote_id")) if row.get("quote_id") is not None else None,
        "job_id": int(row.get("job_id")) if row.get("job_id") is not None else None,
        "created_at": row.get("created_at").isoformat() if row.get("created_at") else None,
        "updated_at": row.get("updated_at").isoformat() if row.get("updated_at") else None,
        "won_at": row.get("won_at").isoformat() if row.get("won_at") else None,
        "lost_at": row.get("lost_at").isoformat() if row.get("lost_at") else None,
        "lost_reason": str(row.get("lost_reason") or ""),
    }


def _serialize_generated_lead(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "generated_lead_id": int(_safe_int(row.get("generated_lead_id"), 0) or 0),
        "bin_date": str(row.get("bin_date")) if row.get("bin_date") else None,
        "service_key": _safe_str(row.get("service_key"), ""),
        "company_name": _safe_str(row.get("company_name"), ""),
        "industry": _safe_str(row.get("industry"), ""),
        "country": _safe_str(row.get("country"), ""),
        "city": _safe_str(row.get("city"), ""),
        "website": _safe_str(row.get("website"), ""),
        "contact_name": _safe_str(row.get("contact_name"), ""),
        "contact_role": _safe_str(row.get("contact_role"), ""),
        "contact_email": _safe_str(row.get("contact_email"), ""),
        "contact_phone": _safe_str(row.get("contact_phone"), ""),
        "revenue_gbp_millions": float(_safe_float(row.get("revenue_gbp_millions"), 0)),
        "likelihood_score": float(_safe_float(row.get("likelihood_score"), 0)),
        "why_good_lead": _safe_str(row.get("why_good_lead"), ""),
        "trigger_reason": _safe_str(row.get("trigger_reason"), ""),
        "source_references": _safe_str(row.get("source_references"), ""),
        "qualification_status": _safe_str(row.get("qualification_status"), "new") or "new",
        "bin_reason_id": _safe_int(row.get("bin_reason_id"), None),
        "bin_reason_name": _safe_str(row.get("bin_reason_name"), ""),
        "qualified_by": _safe_str(row.get("qualified_by"), ""),
        "qualified_at": row.get("qualified_at").isoformat() if row.get("qualified_at") else None,
        "qualification_notes": _safe_str(row.get("qualification_notes"), ""),
        "bd_lead_id": _safe_int(row.get("bd_lead_id"), None),
        "created_at": row.get("created_at").isoformat() if row.get("created_at") else None,
        "updated_at": row.get("updated_at").isoformat() if row.get("updated_at") else None,
    }


def _serialize_market_company(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "market_company_id": int(_safe_int(row.get("market_company_id"), 0) or 0),
        "scan_batch_id": _safe_int(row.get("scan_batch_id"), None),
        "source_provider": _safe_str(row.get("source_provider"), ""),
        "provider_org_id": _safe_str(row.get("provider_org_id"), ""),
        "service_key": _safe_str(row.get("service_key"), ""),
        "company_name": _safe_str(row.get("company_name"), ""),
        "normalized_company_key": _safe_str(row.get("normalized_company_key"), ""),
        "website": _safe_str(row.get("website"), ""),
        "domain": _safe_str(row.get("domain"), ""),
        "industry": _safe_str(row.get("industry"), ""),
        "subindustry": _safe_str(row.get("subindustry"), ""),
        "country": _safe_str(row.get("country"), ""),
        "region": _safe_str(row.get("region"), ""),
        "city": _safe_str(row.get("city"), ""),
        "revenue_gbp_millions": float(_safe_float(row.get("revenue_gbp_millions"), 0)),
        "revenue_band_label": _safe_str(row.get("revenue_band_label"), ""),
        "employee_count": _safe_int(row.get("employee_count"), None),
        "employee_band_label": _safe_str(row.get("employee_band_label"), ""),
        "qualification_status": _safe_str(row.get("qualification_status"), "new"),
        "created_at": row.get("created_at").isoformat() if row.get("created_at") else None,
        "updated_at": row.get("updated_at").isoformat() if row.get("updated_at") else None,
    }


def _host_from_website(url: str) -> str:
    text = str(url or "").strip().lower()
    text = re.sub(r"^https?://", "", text)
    text = text.split("/", 1)[0]
    text = re.sub(r"^www\.", "", text)
    return text.strip()


def _revenue_band_label(revenue_gbp_m: float) -> str:
    value = _safe_float(revenue_gbp_m, 0)
    if value <= 0:
        return "unknown"
    if value < 5:
        return "under-5m"
    if value <= 15:
        return "5m-15m"
    if value <= 50:
        return "15m-50m"
    return "50m+"


def _create_scan_batch(
    con,
    *,
    generation_mode: str,
    provider: str,
    regions: list[str],
    target_industries: list[str],
    target_roles: list[str],
    revenue_min: float,
    revenue_max: float,
    requested_count: int,
    created_by: str,
) -> int:
    row = con.execute(
        """
        INSERT INTO bd_scan_batches (
          scan_type, provider, regions_json, industries_json, roles_json,
          revenue_min_gbp_m, revenue_max_gbp_m, requested_count, status, created_by,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, NOW(), NOW())
        RETURNING scan_batch_id
        """,
        [
            generation_mode,
            provider,
            json.dumps(regions),
            json.dumps(target_industries),
            json.dumps(target_roles),
            revenue_min,
            revenue_max,
            requested_count,
            created_by,
        ],
    ).fetchone()
    return int(row[0]) if row else 0


def _finalize_scan_batch(con, scan_batch_id: int, *, returned_count: int, diagnostics: str = "", status: str = "completed") -> None:
    if not scan_batch_id:
        return
    con.execute(
        """
        UPDATE bd_scan_batches
        SET returned_count = ?, diagnostics = ?, status = ?, updated_at = NOW()
        WHERE scan_batch_id = ?
        """,
        [int(returned_count), diagnostics or None, status, int(scan_batch_id)],
    )


def _upsert_market_company(
    con,
    *,
    scan_batch_id: int,
    service_key: str,
    source_provider: str,
    item: dict[str, Any],
    region_hint: str,
) -> int | None:
    company_name = str(item.get("company_name") or "").strip()
    if not company_name:
        return None
    normalized_company_key = _normalize_company_key(company_name)
    country = str(item.get("country") or "").strip() or None
    website = str(item.get("website") or "").strip() or None
    domain = _host_from_website(website or "")
    existing = con.execute(
        """
        SELECT market_company_id
        FROM bd_market_companies
        WHERE normalized_company_key = ?
          AND coalesce(country, '') = coalesce(?, '')
          AND coalesce(domain, '') = coalesce(?, '')
        LIMIT 1
        """,
        [normalized_company_key, country, domain or None],
    ).fetchone()
    payload = json.dumps(item)
    revenue = _safe_float(item.get("revenue_gbp_millions"), 0)
    employee_count = _safe_int(item.get("employee_count"), None)
    params = [
        source_provider,
        str(item.get("provider_org_id") or "").strip() or None,
        scan_batch_id or None,
        service_key or None,
        company_name,
        normalized_company_key,
        website,
        domain or None,
        str(item.get("industry") or "").strip() or None,
        str(item.get("subindustry") or "").strip() or None,
        country,
        region_hint or None,
        str(item.get("city") or "").strip() or None,
        revenue if revenue > 0 else None,
        _revenue_band_label(revenue),
        employee_count,
        str(item.get("employee_band_label") or "").strip() or None,
        payload,
        str(item.get("qualification_status") or "new").strip() or "new",
    ]
    if existing:
        row = con.execute(
            """
            UPDATE bd_market_companies
            SET source_provider = ?, provider_org_id = ?, scan_batch_id = ?, service_key = ?, company_name = ?, website = ?, domain = ?,
                industry = ?, subindustry = ?, country = ?, region = ?, city = ?, revenue_gbp_millions = ?,
                revenue_band_label = ?, employee_count = ?, employee_band_label = ?, source_payload_json = ?, qualification_status = ?, updated_at = NOW()
            WHERE market_company_id = ?
            RETURNING market_company_id
            """,
            [
                params[0], params[1], params[2], params[3], params[4], params[6], params[7], params[8], params[9],
                params[10], params[11], params[12], params[13], params[14], params[15], params[16], params[17], params[18],
                int(existing[0]),
            ],
        ).fetchone()
        return int(row[0]) if row else int(existing[0])
    row = con.execute(
        """
        INSERT INTO bd_market_companies (
          source_provider, provider_org_id, scan_batch_id, service_key, company_name, normalized_company_key, website, domain,
          industry, subindustry, country, region, city, revenue_gbp_millions, revenue_band_label,
          employee_count, employee_band_label, source_payload_json, qualification_status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        RETURNING market_company_id
        """,
        params,
    ).fetchone()
    return int(row[0]) if row else None


def _normalize_company_key(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = re.sub(r"[^\w\s]", " ", text)
    text = re.sub(r"\b(limited|ltd|plc|llp|group|holdings|holding|uk)\b", " ", text)
    return " ".join(text.split())


def _normalize_likelihood_score(value: Any) -> float:
    score = _safe_float(value, 0)
    if 0 < score <= 1:
        score *= 100.0
    return round(max(0.0, min(100.0, score)), 1)


def _matches_target_industries(
    item: dict[str, Any],
    target_industries: list[str],
    *,
    include_narrative: bool = False,
) -> bool:
    targets = [str(x).strip().lower() for x in target_industries if str(x).strip()]
    if not targets:
        return True
    parts = [
        str(item.get("industry") or ""),
        str(item.get("company_name") or ""),
        str(item.get("website") or ""),
    ]
    if include_narrative:
        parts.extend(
            [
                str(item.get("why_good_lead") or ""),
                str(item.get("trigger_reason") or ""),
                str(item.get("source_references") or ""),
            ]
        )
    text = " ".join(parts).lower()
    aliases = {
        "construction": ["construction", "contractor", "housebuilding", "civil engineering", "fit-out", "refurbishment", "building"],
        "healthcare": ["healthcare", "health care", "hospital", "care home", "care provider", "medical", "clinical", "nhs", "social care"],
    }
    for target in targets:
        candidate_terms = aliases.get(target, [target])
        if any(term in text for term in candidate_terms):
            return True
    return False


def _matches_target_roles(item: dict[str, Any], target_roles: list[str]) -> bool:
    targets = [str(x).strip().lower() for x in target_roles if str(x).strip()]
    if not targets:
        return True
    role = str(item.get("contact_role") or "").strip().lower()
    if not role:
        return False
    return any(target in role or role in target for target in targets)


def _is_consultancy_competitor_candidate(item: dict[str, Any]) -> bool:
    text = " ".join(
        [
            str(item.get("company_name") or ""),
            str(item.get("industry") or ""),
            str(item.get("website") or ""),
            str(item.get("why_good_lead") or ""),
            str(item.get("trigger_reason") or ""),
        ]
    ).lower()
    consultancy_markers = [
        "consult",
        "consultancy",
        "consulting",
        "advisory",
        "advisor",
        "professional services",
        "management services",
        "social value consultant",
        "bid consultancy",
        "esg consultancy",
        "sustainability consultancy",
    ]
    climate_markers = [
        "carbon",
        "net zero",
        "sustainability",
        "esg",
        "decarbon",
        "climate",
        "environmental",
        "lca",
        "life cycle assessment",
    ]
    has_consultancy = any(marker in text for marker in consultancy_markers)
    has_climate = any(marker in text for marker in climate_markers)
    return has_consultancy and has_climate


def _is_unwanted_market_scan_company(item: dict[str, Any]) -> bool:
    text = " ".join(
        [
            str(item.get("company_name") or ""),
            str(item.get("industry") or ""),
            str(item.get("website") or ""),
            str(item.get("why_good_lead") or ""),
            str(item.get("trigger_reason") or ""),
        ]
    ).lower()
    blocked_markers = [
        "consulting",
        "consultancy",
        "consultant",
        "professional services",
        "advisory",
        "software",
        "saas",
        "systems integrator",
        "outsourcing",
        "it services",
        "technology services",
        "accounting software",
    ]
    return any(marker in text for marker in blocked_markers)


def _is_likely_large_enterprise(item: dict[str, Any]) -> bool:
    text = " ".join(
        [
            str(item.get("company_name") or ""),
            str(item.get("industry") or ""),
            str(item.get("website") or ""),
        ]
    ).lower()
    big_name_markers = [
        "accenture",
        "ibm",
        "tata consultancy",
        "tcs",
        "sage",
        "capgemini",
        "deloitte",
        "pwc",
        "kpmg",
        "ey",
        "microsoft",
        "oracle",
        "sap",
        "infosys",
        "wipro",
        "cgi",
    ]
    enterprise_markers = [
        "global plc",
        "international plc",
        "multinational",
        "fortune 500",
        "ftse 100",
        "ftse100",
        "listed company",
    ]
    return any(marker in text for marker in big_name_markers + enterprise_markers)


def _load_never_return_company_keys(con) -> set[str]:
    keys: set[str] = set()
    try:
        df = con.execute(
            """
            SELECT DISTINCT company_name
            FROM bd_ai_generated_leads
            WHERE lower(qualification_status) = 'binned'
              AND company_name IS NOT NULL
              AND trim(company_name) <> ''
            """
        ).df()
        if df is not None and not df.empty:
            for _, row in df.iterrows():
                key = _normalize_company_key(row.get("company_name"))
                if key:
                    keys.add(key)
    except Exception:
        pass
    return keys


def _leadgen_fallback(
    service_name: str,
    regions: list[str],
    revenue_min: float,
    revenue_max: float,
    limit: int,
    target_industries: list[str] | None = None,
    target_roles: list[str] | None = None,
) -> list[dict[str, Any]]:
    geo = regions[0] if regions else "United Kingdom"
    normalized_industries = [str(x).strip() for x in (target_industries or []) if str(x).strip()]
    templates = [
        ("Regional care services group", "Healthcare"),
        ("Private hospital operator", "Healthcare"),
        ("Specialist care home provider", "Healthcare"),
        ("Construction subcontractor", "Construction"),
        ("Regional building contractor", "Construction"),
        ("Fit-out and refurbishment specialist", "Construction"),
    ]
    if normalized_industries:
        templates = [row for row in templates if any(ind.lower() in row[1].lower() for ind in normalized_industries)] or templates
    role_templates = [str(x).strip() for x in (target_roles or []) if str(x).strip()]
    results: list[dict[str, Any]] = []
    for idx, (company, industry) in enumerate(templates[: max(1, limit)], start=1):
        company_name = f"{company} {idx}"
        company_query = company_name.replace(" ", "+")
        research_refs = [
            f"https://find-and-update.company-information.service.gov.uk/search/companies?q={company_query}",
            f"https://www.google.com/search?q={company_query}+{geo}+sustainability",
            "https://www.gov.uk/government/publications/procurement-policy-note-0621-taking-account-of-carbon-reduction-plans-ppn-0621",
        ]
        score = max(55.0, min(95.0, 62.0 + (idx * 4.2)))
        revenue = min(revenue_max, max(revenue_min, revenue_min + (idx * ((revenue_max - revenue_min) / max(2, limit + 1)))))
        results.append(
            {
                "company_name": company_name,
                "industry": industry,
                "country": geo,
                "city": "",
                "website": "",
                "contact_name": "",
                "contact_role": role_templates[(idx - 1) % len(role_templates)] if role_templates else "",
                "contact_email": "",
                "contact_phone": "",
                "revenue_gbp_millions": round(revenue, 1),
                "likelihood_score": _normalize_likelihood_score(score),
                "why_good_lead": (
                    f"Likely fit for {service_name} based on sector decarbonization pressure, buyer disclosure requirements, "
                    "and probable value-chain reporting requests."
                ),
                "trigger_reason": "Likely supplier to large organizations where CRP/disclosure evidence is increasingly required.",
                "source_references": " | ".join(research_refs),
            }
        )
    return results[:limit]


def _market_scan_search_terms(target_industries: list[str], regions: list[str]) -> list[str]:
    region_text = str(regions[0]).strip() if regions else ""
    mappings = {
        "construction": [
            "construction contractor",
            "building contractor",
            "civil engineering",
            "fit out contractor",
            "refurbishment contractor",
            "building services",
        ],
        "healthcare": [
            "healthcare provider",
            "care home operator",
            "private hospital",
            "medical services",
            "social care provider",
            "clinical services",
        ],
    }
    out: list[str] = []
    for industry in target_industries or ["Construction", "Healthcare"]:
        terms = mappings.get(str(industry).strip().lower(), [str(industry).strip()])
        for term in terms:
            out.append(term)
            if region_text:
                out.append(f"{term} {region_text}")
    return list(dict.fromkeys([x for x in out if x.strip()]))


def _market_scan_batch_specs(target_industries: list[str], regions: list[str]) -> list[dict[str, str]]:
    region_values = [str(r).strip() for r in regions if str(r).strip()] or ["United Kingdom", "Europe"]
    sector_terms = {
        "construction": [
            "regional building contractor",
            "fit out contractor",
            "civil engineering contractor",
            "refurbishment specialist",
            "mechanical electrical contractor",
            "housebuilder",
        ],
        "healthcare": [
            "care home operator",
            "private healthcare provider",
            "social care provider",
            "specialist hospital operator",
            "clinical services provider",
            "community healthcare provider",
        ],
    }
    diversity_cues = [
        "Focus on owner-managed and regional firms, not household-name multinationals.",
        "Prefer companies serving local or regional contracts rather than global enterprise accounts.",
        "Return different companies from previous batches and avoid famous blue-chip brands.",
    ]
    specs: list[dict[str, str]] = []
    for industry in target_industries or ["Construction", "Healthcare"]:
        normalized = str(industry).strip().lower()
        search_terms = sector_terms.get(normalized, [str(industry).strip()])
        for region in region_values:
            for idx, term in enumerate(search_terms, start=1):
                specs.append(
                    {
                        "industry": str(industry).strip(),
                        "region": region,
                        "segment": term,
                        "diversity": diversity_cues[(idx - 1) % len(diversity_cues)],
                    }
                )
    return specs


def _parse_market_scan_rows(
    parsed: list[dict[str, Any]],
    *,
    target_industries: list[str],
    revenue_min: float,
    revenue_max: float,
    limit: int,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in parsed:
        company = str(row.get("company_name") or "").strip()
        if not company:
            continue
        key = _normalize_company_key(company)
        if not key or key in seen:
            continue
        seen.add(key)
        revenue = _safe_float(row.get("revenue_gbp_millions"), 0)
        if revenue > 0 and (revenue < revenue_min or revenue > revenue_max):
            continue
        candidate = {
            "company_name": company,
            "industry": str(row.get("industry") or "").strip(),
            "country": str(row.get("country") or "").strip(),
            "city": str(row.get("city") or "").strip(),
            "website": str(row.get("website") or "").strip(),
            "contact_name": "",
            "contact_role": "",
            "contact_email": "",
            "contact_phone": "",
            "revenue_gbp_millions": round(revenue, 2),
            "likelihood_score": _normalize_likelihood_score(row.get("likelihood_score")),
            "why_good_lead": str(row.get("why_good_lead") or "").strip(),
            "trigger_reason": str(row.get("trigger_reason") or "").strip(),
            "source_references": str(row.get("source_references") or "").strip(),
        }
        if not _matches_target_industries(candidate, target_industries, include_narrative=False):
            continue
        if _is_consultancy_competitor_candidate(candidate) or _is_unwanted_market_scan_company(candidate):
            continue
        if revenue <= 0 and _is_likely_large_enterprise(candidate):
            continue
        website = candidate["website"]
        if not website or not website.lower().startswith(("http://", "https://")):
            candidate["website"] = f"https://www.google.com/search?q={quote_plus(company)}"
        if not candidate["source_references"]:
            candidate["source_references"] = candidate["website"]
        out.append(candidate)
        if len(out) >= limit:
            break
    return out


def _openai_generate_market_scan_leads(
    *,
    regions: list[str],
    revenue_min: float,
    revenue_max: float,
    limit: int,
    target_industries: list[str],
) -> tuple[list[dict[str, Any]], str | None]:
    try:
        from openai import OpenAI
    except Exception:
        return [], "OpenAI SDK unavailable."

    api_key = _env_value("OPENAI_API_KEY", "")
    if not api_key:
        return [], "OPENAI_API_KEY missing."

    configured_model = _env_value("OPENAI_MODEL", "gpt-4.1")
    model_candidates = list(dict.fromkeys([m for m in [configured_model, "gpt-4.1-mini", "gpt-4o-mini"] if str(m).strip()]))
    client = OpenAI(api_key=api_key)
    batch_specs = _market_scan_batch_specs(target_industries, regions)
    if not batch_specs:
        return [], "No market scan batch specs available."

    target_count = max(int(limit), 25)
    collected: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    errors: list[str] = []
    per_batch = max(6, min(10, target_count))

    for spec in batch_specs:
        if len(collected) >= target_count:
            break
        prompt = (
            "Return ONLY valid JSON array with up to "
            f"{per_batch} objects and keys: company_name, industry, country, city, website, revenue_gbp_millions, likelihood_score, why_good_lead, trigger_reason, source_references.\n"
            "Task: identify real mid-market companies from public/open sources only.\n"
            "Do NOT return contacts in this step. This is a company discovery pass, not a contact-enrichment pass.\n"
            "Only return companies whose overall company revenue is credibly within the requested revenue band.\n"
            "Exclude global household-name enterprises, software vendors, consultancies, outsourcers, advisory firms, and direct competitors.\n"
            f"Target industry: {spec['industry']}\n"
            f"Target region: {spec['region']}\n"
            f"Target subsegment: {spec['segment']}\n"
            f"Revenue band (GBP millions): {revenue_min} to {revenue_max}\n"
            f"{spec['diversity']}\n"
            "likelihood_score must be 0-100.\n"
            "source_references must include at least 2 verifiable URLs per company, separated by ' | '.\n"
            "Reject invented companies and reject companies where revenue fit is unclear."
        )
        parsed: list[dict[str, Any]] = []
        for model in model_candidates:
            try:
                response = client.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.1,
                    max_tokens=2600,
                )
                content = (response.choices[0].message.content or "").strip() if response.choices else ""
                parsed = _parse_json_array(content)
                if parsed:
                    break
                errors.append(f"{model}: non-parseable output")
            except Exception as e:
                errors.append(f"{model}: {str(e)}")
        if not parsed:
            continue
        for candidate in _parse_market_scan_rows(
            parsed,
            target_industries=target_industries,
            revenue_min=revenue_min,
            revenue_max=revenue_max,
            limit=target_count,
        ):
            key = _normalize_company_key(candidate.get("company_name"))
            if not key or key in seen_keys:
                continue
            seen_keys.add(key)
            collected.append(candidate)
            if len(collected) >= target_count:
                break

    collected.sort(
        key=lambda x: (
            0 if _safe_float(x.get("revenue_gbp_millions"), 0) > 0 else 1,
            -_safe_float(x.get("likelihood_score"), 0),
            str(x.get("company_name") or ""),
        )
    )
    if collected:
        return collected[:target_count], None
    return [], "; ".join(errors[:5]) if errors else "OpenAI returned no qualifying market-scan companies."


def _gemini_generate_market_scan_leads(
    *,
    regions: list[str],
    revenue_min: float,
    revenue_max: float,
    limit: int,
    target_industries: list[str],
) -> tuple[list[dict[str, Any]], str | None]:
    api_key = _env_value("GEMINI_API_KEY", "")
    if not api_key:
        return [], "GEMINI_API_KEY missing."

    configured_model = _env_value("GEMINI_MODEL", "gemini-2.0-flash")
    model_candidates = list(
        dict.fromkeys([m for m in [configured_model, "gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash"] if str(m).strip()])
    )
    batch_specs = _market_scan_batch_specs(target_industries, regions)
    if not batch_specs:
        return [], "No market scan batch specs available."

    target_count = max(int(limit), 25)
    collected: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    errors: list[str] = []
    per_batch = max(6, min(10, target_count))

    for spec in batch_specs:
        if len(collected) >= target_count:
            break
        prompt = (
            "Return ONLY valid JSON array with up to "
            f"{per_batch} objects and keys: company_name, industry, country, city, website, revenue_gbp_millions, likelihood_score, why_good_lead, trigger_reason, source_references.\n"
            "Identify real mid-market companies from public/open sources only.\n"
            "This is the company discovery pass. Do not return contacts in this step.\n"
            "Exclude global enterprises, consultancies, software vendors, outsourcers, advisory firms, and direct competitors.\n"
            f"Target industry: {spec['industry']}\n"
            f"Target region: {spec['region']}\n"
            f"Target subsegment: {spec['segment']}\n"
            f"Revenue band (GBP millions): {revenue_min} to {revenue_max}\n"
            f"{spec['diversity']}\n"
            "source_references must include at least 2 verifiable URLs per company, separated by ' | '."
        )
        parsed: list[dict[str, Any]] = []
        for model in model_candidates:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
            payload = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.1, "maxOutputTokens": 3200},
            }
            req = Request(
                url,
                method="POST",
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json", "User-Agent": "NZI-Pro-LeadGen/1.0"},
            )
            try:
                with urlopen(req, timeout=40) as resp:
                    body = resp.read().decode("utf-8", errors="ignore")
                data = json.loads(body) if body else {}
                candidates = data.get("candidates") if isinstance(data, dict) else None
                text = ""
                if isinstance(candidates, list) and candidates:
                    content = candidates[0].get("content") if isinstance(candidates[0], dict) else None
                    parts = content.get("parts") if isinstance(content, dict) else None
                    if isinstance(parts, list):
                        text = " ".join([str(p.get("text") or "") for p in parts if isinstance(p, dict)]).strip()
                parsed = _parse_json_array(text)
                if parsed:
                    break
                errors.append(f"{model}: non-parseable output")
            except Exception as e:
                errors.append(f"{model}: {str(e)}")
        if not parsed:
            continue
        for candidate in _parse_market_scan_rows(
            parsed,
            target_industries=target_industries,
            revenue_min=revenue_min,
            revenue_max=revenue_max,
            limit=target_count,
        ):
            key = _normalize_company_key(candidate.get("company_name"))
            if not key or key in seen_keys:
                continue
            seen_keys.add(key)
            collected.append(candidate)
            if len(collected) >= target_count:
                break

    collected.sort(
        key=lambda x: (
            0 if _safe_float(x.get("revenue_gbp_millions"), 0) > 0 else 1,
            -_safe_float(x.get("likelihood_score"), 0),
            str(x.get("company_name") or ""),
        )
    )
    if collected:
        return collected[:target_count], None
    return [], "; ".join(errors[:5]) if errors else "Gemini returned no qualifying market-scan companies."


def _companies_house_profile(company_number: str, api_key: str) -> dict[str, Any]:
    return _companies_house_get_json(f"https://api.company-information.service.gov.uk/company/{quote_plus(company_number)}", api_key)


def _market_scan_companies_house_leads(
    regions: list[str],
    target_industries: list[str],
    limit: int,
) -> tuple[list[dict[str, Any]], str | None]:
    api_key = _env_value("COMPANIES_HOUSE_API_KEY", "")
    if not api_key:
        return [], "COMPANIES_HOUSE_API_KEY is not set"

    candidates: list[dict[str, Any]] = []
    seen_numbers: set[str] = set()
    last_error: str | None = None
    for term in _market_scan_search_terms(target_industries, regions):
        if len(candidates) >= max(limit * 3, 60):
            break
        url = f"https://api.company-information.service.gov.uk/search/companies?q={quote_plus(term)}&items_per_page=50"
        try:
            payload = _companies_house_get_json(url, api_key)
        except HTTPError as e:
            last_error = f"Companies House HTTP error ({e.code})"
            continue
        except URLError as e:
            last_error = f"Companies House network error: {e.reason}"
            continue
        except Exception as e:
            last_error = f"Companies House request failed: {str(e)}"
            continue
        for item in payload.get("items") or []:
            if not isinstance(item, dict):
                continue
            company_number = str(item.get("company_number") or "").strip()
            if not company_number or company_number in seen_numbers:
                continue
            seen_numbers.add(company_number)
            title = str(item.get("title") or "").strip()
            if not title:
                continue
            try:
                profile = _companies_house_profile(company_number, api_key)
            except Exception:
                profile = {}
            sic_list = profile.get("sic_codes") if isinstance(profile.get("sic_codes"), list) else item.get("sic_codes")
            sic_text = ", ".join([str(s).strip() for s in (sic_list or []) if str(s).strip()])
            candidate = {
                "company_name": title,
                "industry": sic_text or str(item.get("description") or "").strip(),
                "country": "United Kingdom",
                "city": str(item.get("address_snippet") or "").strip(),
                "website": _ch_profile_link(company_number),
                "contact_name": "",
                "contact_role": "",
                "contact_email": "",
                "contact_phone": "",
                "revenue_gbp_millions": 0.0,
                "likelihood_score": _heuristic_likelihood_for_service("market-targeting", sic_text),
                "why_good_lead": "Broad market-scan match based on Companies House sector signals. Revenue and contacts still need qualification.",
                "trigger_reason": "Fits current industry targeting and should be reviewed for buyer role relevance.",
                "source_references": _ch_profile_link(company_number),
            }
            if _is_consultancy_competitor_candidate(candidate):
                continue
            if not _matches_target_industries(candidate, target_industries):
                continue
            candidates.append(candidate)
            if len(candidates) >= max(limit * 3, 60):
                break

    unique: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    for item in candidates:
        key = _normalize_company_key(item.get("company_name"))
        if not key or key in seen_keys:
            continue
        seen_keys.add(key)
        unique.append(item)
    unique.sort(key=lambda x: float(x.get("likelihood_score") or 0), reverse=True)
    if unique:
        return unique[:limit], None
    return [], last_error or "Companies House returned no matching companies."


def _parse_json_object(text: str) -> dict[str, Any]:
    raw = (text or "").strip()
    if not raw:
        return {}
    try:
        obj = json.loads(raw)
        return obj if isinstance(obj, dict) else {}
    except Exception:
        pass
    m = re.search(r"```(?:json)?\s*(\{.*\})\s*```", raw, flags=re.DOTALL)
    if not m:
        return {}
    try:
        obj = json.loads(m.group(1))
        return obj if isinstance(obj, dict) else {}
    except Exception:
        return {}


def _enrich_single_lead_with_ai(
    item: dict[str, Any],
    target_roles: list[str],
    revenue_min: float,
    revenue_max: float,
) -> tuple[dict[str, Any] | None, str | None]:
    prompt = (
        "Return ONLY valid JSON object with keys: contact_name, contact_role, contact_email, contact_phone, "
        "revenue_gbp_millions, likelihood_score, why_good_lead, trigger_reason, source_references.\n"
        "Only provide named contact, email or phone if publicly verifiable. If not verifiable, leave as empty strings.\n"
        "Prefer identifying the best-fit buyer role from the target roles rather than inventing a person.\n"
        f"Company: {item.get('company_name')}\n"
        f"Industry: {item.get('industry')}\n"
        f"Website: {item.get('website')}\n"
        f"Country: {item.get('country')}\n"
        f"Revenue target band (GBP millions): {revenue_min} to {revenue_max}\n"
        f"Preferred contact roles: {', '.join(target_roles)}\n"
        "likelihood_score must be 0-100.\n"
        "source_references should include at least 2 URLs when possible, separated by ' | '."
    )

    api_key = _env_value("OPENAI_API_KEY", "")
    if api_key:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=api_key)
            response = client.chat.completions.create(
                model=_env_value("OPENAI_MODEL", "gpt-4.1"),
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=900,
            )
            content = (response.choices[0].message.content or "").strip() if response.choices else ""
            parsed = _parse_json_object(content)
            if parsed:
                return parsed, None
        except Exception as e:
            return None, f"OpenAI enrich failed: {e}"

    gemini_key = _env_value("GEMINI_API_KEY", "")
    if gemini_key:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{_env_value('GEMINI_MODEL', 'gemini-2.0-flash')}:generateContent?key={gemini_key}"
            payload = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.1, "maxOutputTokens": 1200},
            }
            req = Request(url, method="POST", data=json.dumps(payload).encode("utf-8"), headers={"Content-Type": "application/json"})
            with urlopen(req, timeout=40) as resp:
                body = resp.read().decode("utf-8", errors="ignore")
            data = json.loads(body) if body else {}
            candidates = data.get("candidates") if isinstance(data, dict) else None
            text = ""
            if isinstance(candidates, list) and candidates:
                content = candidates[0].get("content") if isinstance(candidates[0], dict) else None
                parts = content.get("parts") if isinstance(content, dict) else None
                if isinstance(parts, list):
                    text = " ".join([str(p.get("text") or "") for p in parts if isinstance(p, dict)]).strip()
            parsed = _parse_json_object(text)
            if parsed:
                return parsed, None
        except Exception as e:
            return None, f"Gemini enrich failed: {e}"

    return None, "No AI provider configured for enrichment."


def _service_search_terms(service_key: str, regions: list[str]) -> list[str]:
    region_text = " ".join([r for r in regions if str(r).strip()]).strip()
    common = [region_text] if region_text else []
    mapping = {
        "carbon-reduction-plan": ["construction contractor", "facilities management", "engineering services", "nhs supplier"],
        "net-zero-support": ["manufacturer", "logistics services", "food producer", "industrial services"],
        "consultancy": ["professional services", "technology services", "business services"],
        "training-workshops": ["healthcare provider", "education provider", "public sector supplier"],
        "life-cycle-assessments": [
            "manufacturer product carbon footprint",
            "environmental product declaration epd",
            "cbam importer",
            "cement manufacturer",
            "iron steel manufacturer",
            "aluminium producer",
            "fertiliser producer",
            "hydrogen producer",
            "electricity importer",
            "packaging manufacturer",
            "consumer goods manufacturer",
        ],
    }
    terms = mapping.get(service_key, ["business services", "supplier"])
    out: list[str] = []
    for term in terms:
        out.append(term)
        if common:
            out.append(f"{term} {common[0]}")
    return out


def _companies_house_get_json(url: str, api_key: str) -> dict[str, Any]:
    token = base64.b64encode(f"{api_key}:".encode("utf-8")).decode("ascii")
    req = Request(url, headers={"Authorization": f"Basic {token}", "User-Agent": "NZI-Pro-LeadGen/1.0"})
    with urlopen(req, timeout=20) as resp:
        body = resp.read().decode("utf-8", errors="ignore")
    data = json.loads(body) if body else {}
    return data if isinstance(data, dict) else {}


def _ch_profile_link(company_number: str) -> str:
    number = str(company_number or "").strip()
    if not number:
        return ""
    return f"https://find-and-update.company-information.service.gov.uk/company/{number}"


def _heuristic_likelihood_for_service(service_key: str, sic_text: str) -> float:
    text = sic_text.lower()
    score = 62.0
    if "construction" in text or "facilities" in text or "engineering" in text:
        score += 12.0
    if "hospital" in text or "health" in text or "medical" in text:
        score += 10.0
    if "manufacture" in text or "logistics" in text or "transport" in text:
        score += 8.0
    cbam_markers = ["cement", "iron", "steel", "aluminium", "fertil", "electricity", "hydrogen"]
    if any(marker in text for marker in cbam_markers):
        score += 10.0
    if service_key == "carbon-reduction-plan":
        score += 6.0
    elif service_key == "net-zero-support":
        score += 4.0
    elif service_key == "life-cycle-assessments":
        score += 12.0
    elif service_key == "training-workshops":
        score += 2.0
    return round(max(40.0, min(96.0, score)), 1)


def _service_specific_prompt_guidance(service_key: str) -> str:
    if service_key == "life-cycle-assessments":
        return (
            "Prioritize companies that need to publish product/service-level emissions (PCF/LCA/EPD) "
            "or are likely impacted by CBAM obligations. Focus on CBAM-exposed sectors including cement, "
            "iron/steel, aluminium, fertilizers, electricity, and hydrogen, plus their import/export value chains. "
            "In why_good_lead or trigger_reason, explicitly reference the likely LCA/PCF/CBAM driver."
        )
    return ""


def _companies_house_leads(
    service_name: str,
    service_key: str,
    regions: list[str],
    limit: int,
) -> tuple[list[dict[str, Any]], str | None]:
    api_key = _env_value("COMPANIES_HOUSE_API_KEY", "")
    if not api_key:
        return [], "COMPANIES_HOUSE_API_KEY is not set"

    candidates: list[dict[str, Any]] = []
    seen_numbers: set[str] = set()
    attempts = 0
    last_error: str | None = None
    terms = _service_search_terms(service_key, regions)
    for term in terms:
        if len(candidates) >= limit * 2:
            break
        attempts += 1
        url = f"https://api.company-information.service.gov.uk/search/companies?q={quote_plus(term)}&items_per_page=35"
        try:
            payload = _companies_house_get_json(url, api_key)
        except HTTPError as e:
            if e.code in (401, 403):
                last_error = f"Companies House auth failed ({e.code}). Check COMPANIES_HOUSE_API_KEY."
            else:
                last_error = f"Companies House HTTP error ({e.code})."
            continue
        except URLError as e:
            last_error = f"Companies House network error: {e.reason}"
            continue
        except Exception as e:
            last_error = f"Companies House request failed: {str(e)}"
            continue
        for item in payload.get("items") or []:
            if not isinstance(item, dict):
                continue
            company_number = str(item.get("company_number") or "").strip()
            if not company_number or company_number in seen_numbers:
                continue
            seen_numbers.add(company_number)
            status = str(item.get("company_status") or "").strip().lower()
            if status and status != "active":
                continue
            title = str(item.get("title") or "").strip()
            address = str(item.get("address_snippet") or "").strip()
            sic_list = item.get("sic_codes") if isinstance(item.get("sic_codes"), list) else []
            sic_text = ", ".join([str(s).strip() for s in sic_list if str(s).strip()])
            profile_url = _ch_profile_link(company_number)
            trigger = "Active UK registered company; requires qualification for buyer/supplier CRP and disclosure obligations."
            why = (
                f"{title} is a real registered company in a potentially exposed sector for {service_name}. "
                "Profile and registry links are provided for qualification."
            )
            candidates.append(
                {
                    "company_name": title,
                    "industry": sic_text or "Unspecified industry (from Companies House)",
                    "country": "United Kingdom",
                    "city": address,
                    "website": profile_url,
                    "contact_name": "",
                    "contact_role": "",
                    "contact_email": "",
                    "contact_phone": "",
                    "revenue_gbp_millions": 0.0,
                    "likelihood_score": _heuristic_likelihood_for_service(service_key, sic_text),
                    "why_good_lead": why,
                    "trigger_reason": trigger,
                    "source_references": (
                        f"{profile_url} | "
                        f"https://find-and-update.company-information.service.gov.uk/search/companies?q={quote_plus(title)} | "
                        "https://www.gov.uk/government/publications/procurement-policy-note-0621-taking-account-of-carbon-reduction-plans-ppn-0621"
                    ),
                }
            )
            if len(candidates) >= limit * 2:
                break
    candidates.sort(key=lambda x: float(x.get("likelihood_score") or 0), reverse=True)
    if candidates:
        return candidates[:limit], None
    if last_error:
        return [], last_error
    if attempts == 0:
        return [], "No Companies House queries were attempted."
    return [], "Companies House returned no matching active companies for current criteria."


def _openai_generate_service_leads(
    service_name: str,
    service_key: str,
    regions: list[str],
    revenue_min: float,
    revenue_max: float,
    limit: int,
    target_industries: list[str],
    target_roles: list[str],
    allow_fallback: bool = False,
) -> tuple[list[dict[str, Any]], str | None]:
    try:
        from openai import OpenAI
    except Exception:
        if allow_fallback:
            return _leadgen_fallback(service_name, regions, revenue_min, revenue_max, limit, target_industries, target_roles), "OpenAI SDK unavailable; used fallback."
        return [], "OpenAI SDK unavailable."

    api_key = _env_value("OPENAI_API_KEY", "")
    if not api_key:
        if allow_fallback:
            return _leadgen_fallback(service_name, regions, revenue_min, revenue_max, limit, target_industries, target_roles), "OPENAI_API_KEY missing; used fallback."
        return [], "OPENAI_API_KEY missing."

    configured_model = _env_value("OPENAI_MODEL", "gpt-4.1")
    model_candidates = [configured_model, "gpt-4.1-mini", "gpt-4o-mini"]
    model_candidates = list(dict.fromkeys([m for m in model_candidates if str(m).strip()]))
    client = OpenAI(api_key=api_key)
    geography = ", ".join([r for r in regions if str(r).strip()]) or "United Kingdom, Europe"
    industries_text = ", ".join([x for x in target_industries if str(x).strip()]) or "Construction, Healthcare"
    roles_text = ", ".join([x for x in target_roles if str(x).strip()]) or (
        "Business Development Manager, Business Development Director, Sales Manager, "
        "Sales Director, Sustainability Manager, ESG Manager, Social Value Manager, Bid Manager"
    )
    service_guidance = _service_specific_prompt_guidance(service_key)
    prompt = (
        "Return ONLY valid JSON array with exactly up to "
        f"{int(limit)} objects and keys: company_name, industry, country, city, website, contact_name, "
        "contact_role, contact_email, contact_phone, revenue_gbp_millions, likelihood_score, why_good_lead, "
        "trigger_reason, source_references.\n"
        "Task: produce practical B2B prospects for sustainability services.\n"
        "Use real, verifiable companies from public/open sources only.\n"
        "Exclude sustainability/carbon/net-zero consultancies, advisory firms, and direct competitors.\n"
        f"Service line: {service_name} ({service_key})\n"
        f"Regions: {geography}\n"
        f"Revenue band (GBP millions): {revenue_min} to {revenue_max}\n"
        f"Target industries: {industries_text}\n"
        f"Preferred contact roles: {roles_text}\n"
        "Prioritize leads only in the target industries.\n"
        "Prefer leads where one of the preferred contact roles can be identified.\n"
        "Prioritize organizations likely to require carbon reduction plans or disclosure evidence as suppliers "
        "to NHS/public sector/large enterprise procurement chains.\n"
        "likelihood_score must be 0-100.\n"
        "Only include leads with estimated revenue in range.\n"
        "website must be a valid company URL when known.\n"
        "source_references must include at least 2 verifiable URLs per lead (separate using ' | '), "
        "such as company site, sustainability report, procurement/tender pages, regulator pages, or reputable directories.\n"
        "For unknown contact data, use empty strings.\n"
        "Keep why_good_lead and trigger_reason concise and actionable.\n"
        "Reject generic or invented companies; prefer organizations that can be externally verified."
    )
    if service_guidance:
        prompt = f"{prompt}\n{service_guidance}"
    last_error: str | None = None
    for model in model_candidates:
        try:
            response = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=3200,
            )
            content = (response.choices[0].message.content or "").strip() if response.choices else ""
            parsed = _parse_json_array(content)
            if not parsed:
                last_error = f"{model}: returned non-parseable output"
                continue
            out: list[dict[str, Any]] = []
            seen: set[str] = set()
            for row in parsed:
                company = str(row.get("company_name") or "").strip()
                if not company:
                    continue
                key = company.lower()
                if key in seen:
                    continue
                seen.add(key)
                score = _normalize_likelihood_score(row.get("likelihood_score"))
                revenue = _safe_float(row.get("revenue_gbp_millions"), 0)
                if revenue and (revenue < revenue_min or revenue > revenue_max):
                    continue
                candidate = {
                    "company_name": company,
                    "industry": str(row.get("industry") or "").strip(),
                    "country": str(row.get("country") or "").strip(),
                    "city": str(row.get("city") or "").strip(),
                    "website": "",
                    "contact_name": str(row.get("contact_name") or "").strip(),
                    "contact_role": str(row.get("contact_role") or "").strip(),
                    "contact_email": str(row.get("contact_email") or "").strip(),
                    "contact_phone": str(row.get("contact_phone") or "").strip(),
                    "revenue_gbp_millions": round(revenue, 2) if revenue else 0.0,
                    "likelihood_score": score,
                    "why_good_lead": str(row.get("why_good_lead") or "").strip(),
                    "trigger_reason": str(row.get("trigger_reason") or "").strip(),
                    "source_references": str(row.get("source_references") or "").strip(),
                }
                if not _matches_target_industries(candidate, target_industries):
                    continue
                if not _matches_target_roles(candidate, target_roles):
                    continue
                website = str(row.get("website") or "").strip()
                if not website or not website.lower().startswith(("http://", "https://")):
                    website = f"https://www.google.com/search?q={quote_plus(company)}"
                source_refs = str(row.get("source_references") or "").strip()
                if not source_refs:
                    source_refs = (
                        f"{website} | "
                        f"https://www.google.com/search?q={quote_plus(company + ' sustainability report')} | "
                        "https://www.gov.uk/government/publications/procurement-policy-note-0621-taking-account-of-carbon-reduction-plans-ppn-0621"
                    )
                candidate["website"] = website
                candidate["source_references"] = source_refs
                out.append(candidate)
                if len(out) >= limit:
                    break
            if out:
                if len(out) < limit and allow_fallback:
                    extra = _leadgen_fallback(service_name, regions, revenue_min, revenue_max, limit - len(out), target_industries, target_roles)
                    out.extend(extra)
                return out[:limit], None
            last_error = f"{model}: produced 0 qualifying leads"
        except Exception as e:
            last_error = f"{model}: {str(e)}"
            continue
    if allow_fallback:
        return _leadgen_fallback(service_name, regions, revenue_min, revenue_max, limit, target_industries, target_roles), (last_error or "OpenAI failed; used fallback.")
    return [], (last_error or "OpenAI returned no qualifying leads.")


def _gemini_generate_service_leads(
    service_name: str,
    service_key: str,
    regions: list[str],
    revenue_min: float,
    revenue_max: float,
    limit: int,
    target_industries: list[str],
    target_roles: list[str],
    allow_fallback: bool = False,
) -> tuple[list[dict[str, Any]], str | None]:
    api_key = _env_value("GEMINI_API_KEY", "")
    if not api_key:
        if allow_fallback:
            return _leadgen_fallback(service_name, regions, revenue_min, revenue_max, limit, target_industries, target_roles), "GEMINI_API_KEY missing; used fallback."
        return [], "GEMINI_API_KEY missing."

    configured_model = _env_value("GEMINI_MODEL", "gemini-2.0-flash")
    model_candidates = [
        configured_model,
        "gemini-2.0-flash",
        "gemini-2.0-flash-lite",
        "gemini-1.5-flash",
        "gemini-1.5-pro",
    ]
    model_candidates = list(dict.fromkeys([m for m in model_candidates if str(m).strip()]))

    # Prefer models actually available for this key/project.
    discovered_models: list[str] = []
    try:
        models_req = Request(
            f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}",
            method="GET",
            headers={"User-Agent": "NZI-Pro-LeadGen/1.0"},
        )
        with urlopen(models_req, timeout=20) as resp:
            body = resp.read().decode("utf-8", errors="ignore")
        payload = json.loads(body) if body else {}
        for row in payload.get("models") or []:
            if not isinstance(row, dict):
                continue
            methods = row.get("supportedGenerationMethods") or []
            if "generateContent" not in methods:
                continue
            name = str(row.get("name") or "").strip()
            if not name:
                continue
            # API returns "models/<id>".
            discovered_models.append(name.split("/", 1)[-1])
    except Exception:
        discovered_models = []

    if discovered_models:
        preferred = [m for m in model_candidates if m in discovered_models]
        others = [m for m in discovered_models if m not in preferred]
        model_candidates = preferred + others
    geography = ", ".join([r for r in regions if str(r).strip()]) or "United Kingdom, Europe"
    industries_text = ", ".join([x for x in target_industries if str(x).strip()]) or "Construction, Healthcare"
    roles_text = ", ".join([x for x in target_roles if str(x).strip()]) or (
        "Business Development Manager, Business Development Director, Sales Manager, "
        "Sales Director, Sustainability Manager, ESG Manager, Social Value Manager, Bid Manager"
    )
    service_guidance = _service_specific_prompt_guidance(service_key)
    prompt = (
        "Return ONLY valid JSON array with up to "
        f"{int(limit)} objects and keys: company_name, industry, country, city, website, contact_name, "
        "contact_role, contact_email, contact_phone, revenue_gbp_millions, likelihood_score, why_good_lead, "
        "trigger_reason, source_references.\n"
        "Use real, verifiable companies from public/open sources only.\n"
        "Exclude sustainability/carbon/net-zero consultancies, advisory firms, and direct competitors.\n"
        f"Service line: {service_name} ({service_key})\n"
        f"Regions: {geography}\n"
        f"Revenue band (GBP millions): {revenue_min} to {revenue_max}\n"
        f"Target industries: {industries_text}\n"
        f"Preferred contact roles: {roles_text}\n"
        "Prioritize leads only in the target industries.\n"
        "Prefer leads where one of the preferred contact roles can be identified.\n"
        "Prioritize likely suppliers to NHS/public sector/large enterprise procurement chains.\n"
        "source_references should include at least 2 URLs, separated by ' | '."
    )
    if service_guidance:
        prompt = f"{prompt}\n{service_guidance}"
    errors: list[str] = []
    for model in model_candidates:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.1, "maxOutputTokens": 4096},
        }
        req = Request(
            url,
            method="POST",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": "NZI-Pro-LeadGen/1.0"},
        )
        try:
            with urlopen(req, timeout=40) as resp:
                body = resp.read().decode("utf-8", errors="ignore")
            data = json.loads(body) if body else {}
            candidates = data.get("candidates") if isinstance(data, dict) else None
            text = ""
            if isinstance(candidates, list) and candidates:
                content = candidates[0].get("content") if isinstance(candidates[0], dict) else None
                parts = content.get("parts") if isinstance(content, dict) else None
                if isinstance(parts, list):
                    text = " ".join([str(p.get("text") or "") for p in parts if isinstance(p, dict)]).strip()
            parsed = _parse_json_array(text)
            if not parsed:
                errors.append(f"{model}: non-parseable output")
                continue

            out: list[dict[str, Any]] = []
            seen: set[str] = set()
            for row in parsed:
                company = str(row.get("company_name") or "").strip()
                if not company:
                    continue
                key = company.lower()
                if key in seen:
                    continue
                seen.add(key)
                score = _normalize_likelihood_score(row.get("likelihood_score"))
                revenue = _safe_float(row.get("revenue_gbp_millions"), 0)
                if revenue and (revenue < revenue_min or revenue > revenue_max):
                    continue
                candidate = {
                    "company_name": company,
                    "industry": str(row.get("industry") or "").strip(),
                    "country": str(row.get("country") or "").strip(),
                    "city": str(row.get("city") or "").strip(),
                    "website": "",
                    "contact_name": str(row.get("contact_name") or "").strip(),
                    "contact_role": str(row.get("contact_role") or "").strip(),
                    "contact_email": str(row.get("contact_email") or "").strip(),
                    "contact_phone": str(row.get("contact_phone") or "").strip(),
                    "revenue_gbp_millions": round(revenue, 2) if revenue else 0.0,
                    "likelihood_score": score,
                    "why_good_lead": str(row.get("why_good_lead") or "").strip(),
                    "trigger_reason": str(row.get("trigger_reason") or "").strip(),
                    "source_references": str(row.get("source_references") or "").strip(),
                }
                if not _matches_target_industries(candidate, target_industries):
                    continue
                if not _matches_target_roles(candidate, target_roles):
                    continue
                website = str(row.get("website") or "").strip()
                if not website or not website.lower().startswith(("http://", "https://")):
                    website = f"https://www.google.com/search?q={quote_plus(company)}"
                source_refs = str(row.get("source_references") or "").strip()
                if not source_refs:
                    source_refs = (
                        f"{website} | "
                        f"https://www.google.com/search?q={quote_plus(company + ' sustainability report')} | "
                        "https://www.gov.uk/government/publications/procurement-policy-note-0621-taking-account-of-carbon-reduction-plans-ppn-0621"
                    )
                candidate["website"] = website
                candidate["source_references"] = source_refs
                out.append(candidate)
                if len(out) >= limit:
                    break
            if out:
                if len(out) < limit and allow_fallback:
                    out.extend(_leadgen_fallback(service_name, regions, revenue_min, revenue_max, limit - len(out), target_industries, target_roles))
                return out[:limit], None
            errors.append(f"{model}: produced 0 qualifying leads")
        except HTTPError as e:
            details = ""
            try:
                details = e.read().decode("utf-8", errors="ignore")
            except Exception:
                details = ""
            message = f"{model}: HTTP {e.code}"
            if details:
                message = f"{message} - {details[:220].replace(chr(10), ' ').strip()}"
            errors.append(message)
            continue
        except Exception as e:
            errors.append(f"{model}: {str(e)}")
            continue
    detail = "; ".join(errors[:5]) if errors else "Gemini returned no qualifying leads."
    if allow_fallback:
        return _leadgen_fallback(service_name, regions, revenue_min, revenue_max, limit, target_industries, target_roles), detail + "; used fallback."
    return [], detail


def _next_quote_number(con) -> str:
    df = con.execute("SELECT quote_number FROM quotes WHERE quote_number IS NOT NULL").df()
    max_base = 999
    if df is not None and not df.empty:
        for _, r in df.iterrows():
            qn = str(r.get("quote_number") or "").strip().upper()
            if not qn.startswith("Q"):
                continue
            parts = qn[1:].split("/")
            try:
                value = int(parts[0])
            except Exception:
                continue
            if value > max_base:
                max_base = value
    return f"Q{max_base + 1:06d}/1"


def _ensure_quote_tables(con) -> None:
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS quotes (
          quote_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          client_db_id INTEGER NOT NULL,
          contact_id INTEGER,
          quote_date DATE,
          valid_to DATE,
          salesperson VARCHAR,
          payment_term_id INTEGER,
          currency_code VARCHAR,
          description TEXT,
          notes TEXT,
          status VARCHAR,
          revision_of_quote_id INTEGER,
          quote_number VARCHAR,
          job_number VARCHAR,
          attention VARCHAR,
          bill_to TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
        """
    )
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS quote_lines (
          line_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          quote_id INTEGER NOT NULL,
          line_type VARCHAR,
          sort_order INTEGER,
          description TEXT,
          qty DOUBLE PRECISION,
          unit_price_ex_vat DOUBLE PRECISION,
          amount_ex_vat DOUBLE PRECISION,
          vat_rate_pct DOUBLE PRECISION,
          is_selected BOOLEAN
        )
        """
    )


def _ensure_client_for_opportunity(con, opp: dict[str, Any], actor: str) -> int:
    existing_client_id = _safe_int(opp.get("client_db_id"))
    if existing_client_id is not None:
        return int(existing_client_id)

    company_name = str(opp.get("company_name") or "").strip() or str(opp.get("opportunity_name") or "").strip()
    if not company_name:
        raise HTTPException(status_code=400, detail="Cannot convert without company/opportunity name")

    existing = con.execute(
        "SELECT db_id FROM clients WHERE lower(trim(client_name)) = lower(trim(?)) ORDER BY db_id DESC LIMIT 1",
        [company_name],
    ).fetchone()
    if existing:
        client_id = int(existing[0])
    else:
        row = con.execute(
            """
            INSERT INTO clients (client_name, industry, addr_country, crm_owner, currency, status)
            VALUES (?, ?, ?, ?, ?, ?)
            RETURNING db_id
            """,
            [
                company_name,
                str(opp.get("industry") or "").strip() or None,
                str(opp.get("country") or "").strip() or None,
                actor,
                str(opp.get("currency") or "GBP").strip() or "GBP",
                "Active",
            ],
        ).fetchone()
        client_id = int(row[0])

    con.execute(
        "UPDATE bd_opportunities SET client_db_id = ?, updated_at = NOW() WHERE opportunity_id = ?",
        [client_id, int(opp.get("opportunity_id"))],
    )
    return client_id


@router.get("/bd/funnel/stages")
def list_stages(_user: dict = Depends(_current_user)):
    try:
        with get_conn() as con:
            _ensure_tables(con)
            df = con.execute(
                """
                SELECT stage_id, stage_key, stage_name, stage_order, probability_pct, is_active
                FROM bd_funnel_stages
                ORDER BY stage_order ASC, stage_id ASC
                """
            ).df()
            items: list[dict[str, Any]] = []
            if df is not None and not df.empty:
                for _, row in df.iterrows():
                    items.append(_serialize_stage(row.to_dict()))
            return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load funnel stages: {e}")


@router.post("/bd/funnel/stages")
def create_stage(body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        stage_name = str(body.get("stage_name") or "").strip()
        stage_key = str(body.get("stage_key") or "").strip().lower() or stage_name.lower().replace(" ", "-")
        if not stage_name:
            raise HTTPException(status_code=400, detail="stage_name is required")
        with get_conn() as con:
            _ensure_tables(con)
            max_order = con.execute("SELECT COALESCE(MAX(stage_order), 0) FROM bd_funnel_stages").fetchone()
            next_order = int(max_order[0] or 0) + 1
            con.execute(
                """
                INSERT INTO bd_funnel_stages (stage_key, stage_name, stage_order, probability_pct, is_active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, NOW(), NOW())
                """,
                [
                    stage_key,
                    stage_name,
                    int(body.get("stage_order") or next_order),
                    _safe_float(body.get("probability_pct"), 0),
                    bool(body.get("is_active", True)),
                ],
            )
            return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create funnel stage: {e}")


@router.patch("/bd/funnel/stages/{stage_id}")
def update_stage(stage_id: int, body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        with get_conn() as con:
            _ensure_tables(con)
            exists = con.execute("SELECT 1 FROM bd_funnel_stages WHERE stage_id = ?", [int(stage_id)]).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="Stage not found")
            updates: list[str] = []
            params: list[Any] = []
            for key in ("stage_key", "stage_name", "stage_order", "probability_pct", "is_active"):
                if key not in body:
                    continue
                updates.append(f"{key} = ?")
                if key in ("stage_order",):
                    params.append(_safe_int(body.get(key), 0))
                elif key in ("probability_pct",):
                    params.append(_safe_float(body.get(key), 0))
                elif key in ("is_active",):
                    params.append(bool(body.get(key)))
                else:
                    params.append(str(body.get(key) or "").strip())
            if not updates:
                return {"ok": True}
            updates.append("updated_at = NOW()")
            params.append(int(stage_id))
            con.execute(f"UPDATE bd_funnel_stages SET {', '.join(updates)} WHERE stage_id = ?", params)
            return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update funnel stage: {e}")


@router.get("/bd/providers/apollo/health")
def apollo_provider_health(_user: dict = Depends(_current_user)):
    try:
        return {
            "ok": True,
            "configured": bool(_apollo_api_key()),
            "provider": "apollo",
            "result": _apollo_health(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to check Apollo health: {e}")


@router.post("/bd/providers/apollo/organization-enrich")
def apollo_organization_enrich(body: dict = Body(default={}), _user: dict = Depends(_current_user)):
    try:
        domain = str(body.get("domain") or "").strip()
        organization_name = str(body.get("organization_name") or "").strip()
        raw = _apollo_organization_enrich(domain=domain, organization_name=organization_name)
        company = _apollo_normalize_company(raw)
        return {
            "ok": True,
            "provider": "apollo",
            "item": company,
            "raw": raw,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to enrich organization with Apollo: {e}")


@router.post("/bd/providers/apollo/organizations/search")
def apollo_organization_search(body: dict = Body(default={}), _user: dict = Depends(_current_user)):
    try:
        payload = body.get("payload") if isinstance(body.get("payload"), dict) else {}
        if not payload:
            raise HTTPException(status_code=400, detail="payload is required")
        save_to_market_pool = bool(body.get("save_to_market_pool", False))
        target_industries = body.get("target_industries")
        if not isinstance(target_industries, list):
            target_industries = [x.strip() for x in str(target_industries or "").split(",") if x.strip()]
        target_roles = body.get("target_roles")
        if not isinstance(target_roles, list):
            target_roles = [x.strip() for x in str(target_roles or "").split(",") if x.strip()]
        regions = body.get("regions")
        if not isinstance(regions, list):
            regions = [x.strip() for x in str(regions or "").split(",") if x.strip()]
        revenue_min = _safe_float(body.get("revenue_min_m_gbp"), 0)
        revenue_max = _safe_float(body.get("revenue_max_m_gbp"), 0)
        requested_count = _safe_int(body.get("requested_count"), _safe_int(payload.get("per_page"), 25) or 25) or 25
        service_key = str(body.get("service_key") or "market-targeting").strip() or "market-targeting"
        companies, raw = _apollo_search_organizations(payload)
        saved_count = 0
        scan_batch_id = 0
        if save_to_market_pool and companies:
            with get_conn() as con:
                _ensure_tables(con)
                scan_batch_id = _create_scan_batch(
                    con,
                    generation_mode="market-scan",
                    provider="apollo",
                    regions=regions or [],
                    target_industries=target_industries or [],
                    target_roles=target_roles or [],
                    revenue_min=revenue_min,
                    revenue_max=revenue_max,
                    requested_count=requested_count,
                    created_by=_actor(_user),
                )
                for company in companies:
                    if _upsert_market_company(
                        con,
                        scan_batch_id=scan_batch_id,
                        service_key=service_key,
                        source_provider="apollo",
                        item=company,
                        region_hint=", ".join(regions or []),
                    ):
                        saved_count += 1
                _finalize_scan_batch(
                    con,
                    scan_batch_id,
                    returned_count=saved_count,
                    diagnostics="Apollo organization search import",
                    status="completed" if saved_count > 0 else "empty",
                )
        return {
            "ok": True,
            "provider": "apollo",
            "scan_batch_id": scan_batch_id or None,
            "saved_to_market_pool": saved_count,
            "count": len(companies),
            "items": companies,
            "pagination": raw.get("pagination") if isinstance(raw.get("pagination"), dict) else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to search Apollo organizations: {e}")


@router.post("/bd/providers/apollo/people/search")
def apollo_people_search(body: dict = Body(default={}), _user: dict = Depends(_current_user)):
    try:
        payload = body.get("payload") if isinstance(body.get("payload"), dict) else {}
        if not payload:
            raise HTTPException(status_code=400, detail="payload is required")
        people, raw = _apollo_search_people(payload)
        return {
            "ok": True,
            "provider": "apollo",
            "count": len(people),
            "items": people,
            "pagination": raw.get("pagination") if isinstance(raw.get("pagination"), dict) else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to search Apollo people: {e}")


@router.get("/bd/lead-generator/services")
def list_lead_generator_services(_user: dict = Depends(_current_user)):
    try:
        with get_conn() as con:
            _ensure_tables(con)
            df = con.execute(
                """
                SELECT service_key, service_name, sort_order, is_active
                FROM bd_service_lines
                WHERE is_active = TRUE
                ORDER BY sort_order ASC, service_name ASC
                """
            ).df()
        items: list[dict[str, Any]] = []
        if df is not None and not df.empty:
            for _, row in df.iterrows():
                items.append(
                    {
                        "service_key": str(row.get("service_key") or ""),
                        "service_name": str(row.get("service_name") or ""),
                        "sort_order": int(row.get("sort_order") or 0),
                    }
                )
        return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load lead generator services: {e}")


@router.get("/bd/lead-generator/bin-reasons")
def list_bin_reasons(_user: dict = Depends(_current_user)):
    try:
        with get_conn() as con:
            _ensure_tables(con)
            df = con.execute(
                """
                SELECT bin_reason_id, name, is_active, sort_order
                FROM bd_bin_reasons_lookup
                WHERE is_active = TRUE
                ORDER BY sort_order ASC, name ASC
                """
            ).df()
        items: list[dict[str, Any]] = []
        if df is not None and not df.empty:
            for _, row in df.iterrows():
                items.append(
                    {
                        "bin_reason_id": int(_safe_int(row.get("bin_reason_id"), 0) or 0),
                        "name": str(row.get("name") or ""),
                        "is_active": bool(row.get("is_active") if row.get("is_active") is not None else True),
                        "sort_order": int(_safe_int(row.get("sort_order"), 0) or 0),
                    }
                )
        return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load bin reasons: {e}")


@router.post("/bd/lead-generator/generate")
def generate_daily_leads(body: dict = Body(default={}), _user: dict = Depends(_current_user)):
    try:
        actor = _actor(_user)
        generation_mode = str(body.get("generation_mode") or "daily-leads").strip().lower()
        bin_day = _to_date(body.get("bin_date"))
        leads_per_service = int(max(1, min(100, _safe_int(body.get("leads_per_service"), 25) or 25)))
        revenue_min = float(max(0, _safe_float(body.get("revenue_min_m_gbp"), 5.0)))
        revenue_max = float(max(revenue_min, _safe_float(body.get("revenue_max_m_gbp"), 15.0)))
        replace_existing = bool(body.get("replace_existing", True))
        allow_fallback = bool(body.get("allow_fallback", False))
        industries_input = body.get("target_industries")
        if isinstance(industries_input, list):
            target_industries = [str(x).strip() for x in industries_input if str(x).strip()]
        else:
            target_industries = [part.strip() for part in str(industries_input or "Construction, Healthcare").split(",") if part.strip()]
        if not target_industries:
            target_industries = ["Construction", "Healthcare"]
        roles_input = body.get("target_roles")
        if isinstance(roles_input, list):
            target_roles = [str(x).strip() for x in roles_input if str(x).strip()]
        else:
            target_roles = [
                part.strip()
                for part in str(
                    roles_input
                    or "Business Development Manager, Business Development Director, Sales Manager, Sales Director, Sustainability Manager, ESG Manager, Social Value Manager, Bid Manager"
                ).split(",")
                if part.strip()
            ]
        if not target_roles:
            target_roles = [
                "Business Development Manager",
                "Business Development Director",
                "Sales Manager",
                "Sales Director",
                "Sustainability Manager",
                "ESG Manager",
                "Social Value Manager",
                "Bid Manager",
            ]
        regions_input = body.get("regions")
        if isinstance(regions_input, list):
            regions = [str(r).strip() for r in regions_input if str(r).strip()]
        else:
            raw = str(regions_input or "United Kingdom, Europe")
            regions = [part.strip() for part in raw.split(",") if part.strip()]
        if not regions:
            regions = ["United Kingdom", "Europe"]

        with get_conn() as con:
            _ensure_tables(con)
            never_return_keys = _load_never_return_company_keys(con)
            services_df = con.execute(
                """
                SELECT service_key, service_name
                FROM bd_service_lines
                WHERE is_active = TRUE
                ORDER BY sort_order ASC, service_name ASC
                """
            ).df()
            all_services: list[dict[str, str]] = []
            if services_df is not None and not services_df.empty:
                for _, row in services_df.iterrows():
                    all_services.append(
                        {
                            "service_key": str(row.get("service_key") or ""),
                            "service_name": str(row.get("service_name") or ""),
                        }
                    )
            if not all_services:
                raise HTTPException(status_code=400, detail="No active service lines configured")

            selected_keys_raw = body.get("service_keys")
            selected_keys: set[str] = set()
            if isinstance(selected_keys_raw, list):
                selected_keys = {str(x).strip() for x in selected_keys_raw if str(x).strip()}
            if generation_mode == "market-scan":
                selected_services = [{"service_key": "market-targeting", "service_name": "Industry & Role Targeting"}]
            elif selected_keys:
                selected_services = [svc for svc in all_services if svc["service_key"] in selected_keys]
            else:
                selected_services = [{"service_key": "market-targeting", "service_name": "Industry & Role Targeting"}]
            if not selected_services:
                raise HTTPException(status_code=400, detail="No matching active services found for service_keys")

            scan_batch_id = 0
            if generation_mode == "market-scan":
                scan_batch_id = _create_scan_batch(
                    con,
                    generation_mode=generation_mode,
                    provider="ai-open-source",
                    regions=regions,
                    target_industries=target_industries,
                    target_roles=target_roles,
                    revenue_min=revenue_min,
                    revenue_max=revenue_max,
                    requested_count=leads_per_service,
                    created_by=actor,
                )

            if replace_existing:
                service_keys = [svc["service_key"] for svc in selected_services]
                placeholder = ", ".join(["?"] * len(service_keys))
                con.execute(
                    f"""
                    DELETE FROM bd_ai_generated_leads
                    WHERE bin_date = ? AND service_key IN ({placeholder})
                      AND lower(coalesce(qualification_status, 'new')) <> 'binned'
                    """,
                    [bin_day.isoformat(), *service_keys],
                )

            inserted_count = 0
            excluded_binned_count = 0
            excluded_competitor_count = 0
            generated_by_service: dict[str, int] = {}
            diagnostics: dict[str, str] = {}
            for svc in selected_services:
                service_key = svc["service_key"]
                service_name = svc["service_name"]
                if generation_mode == "market-scan":
                    generated, ai_diag = _openai_generate_market_scan_leads(
                        regions=regions,
                        revenue_min=revenue_min,
                        revenue_max=revenue_max,
                        limit=leads_per_service,
                        target_industries=target_industries,
                    )
                    if not generated:
                        generated, gemini_diag = _gemini_generate_market_scan_leads(
                            regions=regions,
                            revenue_min=revenue_min,
                            revenue_max=revenue_max,
                            limit=leads_per_service,
                            target_industries=target_industries,
                        )
                        combined_diags = [d for d in [ai_diag, gemini_diag] if d]
                        if combined_diags:
                            diagnostics[service_key] = " | ".join(combined_diags)
                    elif ai_diag:
                        diagnostics[service_key] = ai_diag
                else:
                    generated, ai_diag = _openai_generate_service_leads(
                        service_name=service_name,
                        service_key=service_key,
                        regions=regions,
                        revenue_min=revenue_min,
                        revenue_max=revenue_max,
                        limit=leads_per_service,
                        target_industries=target_industries,
                        target_roles=target_roles,
                        allow_fallback=allow_fallback,
                    )
                    if not generated:
                        generated, gemini_diag = _gemini_generate_service_leads(
                            service_name=service_name,
                            service_key=service_key,
                            regions=regions,
                            revenue_min=revenue_min,
                            revenue_max=revenue_max,
                            limit=leads_per_service,
                            target_industries=target_industries,
                            target_roles=target_roles,
                            allow_fallback=allow_fallback,
                        )
                        combined_diags = [d for d in [ai_diag, gemini_diag] if d]
                        if combined_diags:
                            diagnostics[service_key] = " | ".join(combined_diags)
                    elif ai_diag:
                        diagnostics[service_key] = ai_diag
                if not generated:
                    diagnostics[service_key] = diagnostics.get(service_key) or "No verifiable open-source leads returned for current filters."
                inserted_for_service = 0
                for item in generated:
                    company_name = str(item.get("company_name") or "").strip()
                    if not company_name:
                        continue
                    company_key = _normalize_company_key(company_name)
                    if company_key in never_return_keys:
                        excluded_binned_count += 1
                        continue
                    if _is_consultancy_competitor_candidate(item):
                        excluded_competitor_count += 1
                        continue
                    market_company_id = None
                    source_provider = "ai-open-source"
                    if generation_mode == "market-scan":
                        market_company_id = _upsert_market_company(
                            con,
                            scan_batch_id=scan_batch_id,
                            service_key=service_key,
                            source_provider=source_provider,
                            item=item,
                            region_hint=", ".join(regions),
                        )
                    con.execute(
                        """
                        INSERT INTO bd_ai_generated_leads (
                          bin_date, service_key, company_name, industry, country, city, website,
                          contact_name, contact_role, contact_email, contact_phone,
                          revenue_gbp_millions, likelihood_score, why_good_lead, trigger_reason,
                          source_references, qualification_status, qualified_by, qualified_at,
                          qualification_notes, bd_lead_id, market_company_id, scan_batch_id,
                          source_provider, created_at, updated_at
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', NULL, NULL, NULL, NULL, ?, ?, ?, NOW(), NOW())
                        ON CONFLICT (bin_date, service_key, company_name) DO UPDATE SET
                          industry = excluded.industry,
                          country = excluded.country,
                          city = excluded.city,
                          website = excluded.website,
                          contact_name = excluded.contact_name,
                          contact_role = excluded.contact_role,
                          contact_email = excluded.contact_email,
                          contact_phone = excluded.contact_phone,
                          revenue_gbp_millions = excluded.revenue_gbp_millions,
                          likelihood_score = excluded.likelihood_score,
                          why_good_lead = excluded.why_good_lead,
                          trigger_reason = excluded.trigger_reason,
                          source_references = excluded.source_references,
                          market_company_id = excluded.market_company_id,
                          scan_batch_id = excluded.scan_batch_id,
                          source_provider = excluded.source_provider,
                          updated_at = NOW()
                        """,
                        [
                            bin_day.isoformat(),
                            service_key,
                            company_name,
                            str(item.get("industry") or "").strip() or None,
                            str(item.get("country") or "").strip() or None,
                            str(item.get("city") or "").strip() or None,
                            str(item.get("website") or "").strip() or None,
                            str(item.get("contact_name") or "").strip() or None,
                            str(item.get("contact_role") or "").strip() or None,
                            str(item.get("contact_email") or "").strip() or None,
                            str(item.get("contact_phone") or "").strip() or None,
                            _safe_float(item.get("revenue_gbp_millions"), 0),
                            _safe_float(item.get("likelihood_score"), 0),
                            str(item.get("why_good_lead") or "").strip() or None,
                            str(item.get("trigger_reason") or "").strip() or None,
                            str(item.get("source_references") or "").strip() or None,
                            market_company_id,
                            scan_batch_id or None,
                            source_provider,
                        ],
                    )
                    if company_key:
                        never_return_keys.add(company_key)
                    inserted_count += 1
                    inserted_for_service += 1
                generated_by_service[service_key] = inserted_for_service

            if generation_mode == "market-scan":
                _finalize_scan_batch(
                    con,
                    scan_batch_id,
                    returned_count=inserted_count,
                    diagnostics="; ".join([f"{k}: {v}" for k, v in diagnostics.items()]) if diagnostics else "",
                    status="completed" if inserted_count > 0 else "empty",
                )

        if inserted_count == 0:
            if not _env_value("OPENAI_API_KEY", "") and not _env_value("GEMINI_API_KEY", ""):
                raise HTTPException(
                    status_code=422,
                    detail="No verifiable leads generated. Set OPENAI_API_KEY and/or GEMINI_API_KEY, or enable allow_fallback=true.",
                )
            diag_msg = ""
            if diagnostics:
                diag_msg = " Diagnostics: " + "; ".join([f"{k}: {v}" for k, v in diagnostics.items()])
            raise HTTPException(
                status_code=422,
                detail="No verifiable leads generated from open sources. Try broader regions/filters, or allow_fallback=true for placeholder research candidates." + diag_msg,
            )

        return {
            "ok": True,
            "bin_date": bin_day.isoformat(),
            "services": generated_by_service,
            "inserted_or_updated": inserted_count,
            "excluded": {
                "previously_binned": excluded_binned_count,
                "consultancy_competitor": excluded_competitor_count,
            },
            "criteria": {
                "generation_mode": generation_mode,
                "regions": regions,
                "revenue_min_m_gbp": revenue_min,
                "revenue_max_m_gbp": revenue_max,
                "target_industries": target_industries,
                "target_roles": target_roles,
                "leads_per_service": leads_per_service,
            },
            "note": "Leads are AI-generated candidates and should be team-qualified before outreach.",
            "suggestions": [
                "Add paid data providers (procurement feeds, LinkedIn/Snov/RocketReach) for stronger contact quality.",
                "Track conversion rates by service/industry to retrain scoring prompts.",
                "Use automated compliance-signal scraping for tender portals and supplier questionnaires.",
            ],
            "generated_by": actor,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate daily leads: {e}")


@router.post("/bd/lead-generator/enrich")
def enrich_generated_leads(body: dict = Body(default={}), _user: dict = Depends(_current_user)):
    try:
        actor = _actor(_user)
        bin_day = _to_date(body.get("bin_date"))
        limit = int(max(1, min(50, _safe_int(body.get("limit"), 15) or 15)))
        revenue_min = float(max(0, _safe_float(body.get("revenue_min_m_gbp"), 5.0)))
        revenue_max = float(max(revenue_min, _safe_float(body.get("revenue_max_m_gbp"), 15.0)))
        target_roles_input = body.get("target_roles")
        if isinstance(target_roles_input, list):
            target_roles = [str(x).strip() for x in target_roles_input if str(x).strip()]
        else:
            target_roles = [part.strip() for part in str(target_roles_input or "").split(",") if part.strip()]
        if not target_roles:
            target_roles = [
                "Business Development Manager",
                "Business Development Director",
                "Sales Manager",
                "Sales Director",
                "Sustainability Manager",
                "ESG Manager",
                "Social Value Manager",
                "Bid Manager",
            ]

        updated = 0
        diagnostics: list[str] = []
        with get_conn() as con:
            _ensure_tables(con)
            df = con.execute(
                """
                SELECT generated_lead_id, company_name, industry, country, city, website,
                       contact_name, contact_role, contact_email, contact_phone,
                       revenue_gbp_millions, likelihood_score, why_good_lead,
                       trigger_reason, source_references
                FROM bd_ai_generated_leads
                WHERE bin_date = ?
                  AND lower(coalesce(qualification_status, 'new')) = 'new'
                ORDER BY likelihood_score DESC, company_name ASC
                LIMIT ?
                """,
                [bin_day.isoformat(), limit],
            ).df()
            if df is None or df.empty:
                return {"ok": True, "updated": 0, "message": "No leads available for enrichment."}

            for _, row in df.iterrows():
                lead = _serialize_generated_lead(dict(row))
                enriched, error = _enrich_single_lead_with_ai(lead, target_roles, revenue_min, revenue_max)
                if error:
                    diagnostics.append(error)
                    continue
                if not enriched:
                    continue
                con.execute(
                    """
                    UPDATE bd_ai_generated_leads
                    SET contact_name = ?,
                        contact_role = ?,
                        contact_email = ?,
                        contact_phone = ?,
                        revenue_gbp_millions = ?,
                        likelihood_score = ?,
                        why_good_lead = ?,
                        trigger_reason = ?,
                        source_references = ?,
                        updated_at = NOW()
                    WHERE generated_lead_id = ?
                    """,
                    [
                        str(enriched.get("contact_name") or lead.get("contact_name") or "").strip() or None,
                        str(enriched.get("contact_role") or lead.get("contact_role") or "").strip() or None,
                        str(enriched.get("contact_email") or lead.get("contact_email") or "").strip() or None,
                        str(enriched.get("contact_phone") or lead.get("contact_phone") or "").strip() or None,
                        _safe_float(enriched.get("revenue_gbp_millions"), _safe_float(lead.get("revenue_gbp_millions"), 0)),
                        _normalize_likelihood_score(enriched.get("likelihood_score") if enriched.get("likelihood_score") is not None else lead.get("likelihood_score")),
                        str(enriched.get("why_good_lead") or lead.get("why_good_lead") or "").strip() or None,
                        str(enriched.get("trigger_reason") or lead.get("trigger_reason") or "").strip() or None,
                        str(enriched.get("source_references") or lead.get("source_references") or "").strip() or None,
                        int(lead.get("generated_lead_id") or 0),
                    ],
                )
                updated += 1

        return {
            "ok": True,
            "updated": updated,
            "bin_date": bin_day.isoformat(),
            "generated_by": actor,
            "diagnostics": diagnostics[:10],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to enrich generated leads: {e}")


@router.get("/bd/lead-generator/bins")
def list_daily_bins(
    bin_date: str | None = Query(default=None),
    service_key: str | None = Query(default=None),
    status: str | None = Query(default=None),
    include_fallback: bool = Query(default=False),
    _user: dict = Depends(_current_user),
):
    try:
        target_day = _to_date(bin_date)
        with get_conn() as con:
            _ensure_tables(con)
            where = ["l.bin_date = ?"]
            params: list[Any] = [target_day.isoformat()]
            if service_key and str(service_key).strip():
                where.append("lower(l.service_key) = lower(?)")
                params.append(str(service_key).strip())
            if status and str(status).strip():
                where.append("lower(l.qualification_status) = lower(?)")
                params.append(str(status).strip())
            if not include_fallback:
                where.append("(l.source_references IS NULL OR l.source_references NOT ILIKE ?)")
                params.append("%Generated fallback list%")
            where_sql = " AND ".join(where)
            df = con.execute(
                f"""
                SELECT l.*, s.service_name
                FROM bd_ai_generated_leads l
                LEFT JOIN bd_service_lines s ON s.service_key = l.service_key
                WHERE {where_sql}
                ORDER BY s.sort_order ASC, l.likelihood_score DESC, l.company_name ASC
                """,
                params,
            ).df()
        items: list[dict[str, Any]] = []
        by_service: dict[str, dict[str, Any]] = {}
        if df is not None and not df.empty:
            for _, row in df.iterrows():
                obj = row.to_dict()
                item = _serialize_generated_lead(obj)
                item["service_name"] = str(obj.get("service_name") or obj.get("service_key") or "")
                items.append(item)
                key = str(item.get("service_key") or "")
                if key not in by_service:
                    by_service[key] = {
                        "service_key": key,
                        "service_name": str(obj.get("service_name") or key),
                        "total": 0,
                        "new": 0,
                        "funnel": 0,
                        "binned": 0,
                    }
                by_service[key]["total"] += 1
                status_value = str(item.get("qualification_status") or "new").lower()
                if status_value in ("new", "funnel", "binned"):
                    by_service[key][status_value] += 1
        return {
            "bin_date": target_day.isoformat(),
            "items": items,
            "services": list(by_service.values()),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load daily bins: {e}")


@router.get("/bd/lead-generator/database")
def list_market_database(
    q: str | None = Query(default=None),
    service_key: str | None = Query(default=None),
    industry: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=50),
    offset: int = Query(default=0),
    _user: dict = Depends(_current_user),
):
    try:
        take = int(max(1, min(limit, 200)))
        skip = int(max(0, offset))
        with get_conn() as con:
            _ensure_tables(con)
            where = ["1=1"]
            params: list[Any] = []
            if q and str(q).strip():
                needle = f"%{str(q).strip()}%"
                where.append(
                    "(l.company_name ILIKE ? OR l.industry ILIKE ? OR l.contact_name ILIKE ? OR l.contact_role ILIKE ? OR l.website ILIKE ?)"
                )
                params.extend([needle, needle, needle, needle, needle])
            if service_key and str(service_key).strip():
                where.append("lower(l.service_key) = lower(?)")
                params.append(str(service_key).strip())
            if industry and str(industry).strip():
                where.append("l.industry ILIKE ?")
                params.append(f"%{str(industry).strip()}%")
            if status and str(status).strip():
                where.append("lower(l.qualification_status) = lower(?)")
                params.append(str(status).strip())
            where_sql = " AND ".join(where)

            total_row = con.execute(
                f"SELECT COUNT(*) AS total FROM bd_ai_generated_leads l WHERE {where_sql}",
                params,
            ).fetchone()
            total = int(total_row[0] or 0) if total_row else 0

            df = con.execute(
                f"""
                SELECT l.*, s.service_name
                FROM bd_ai_generated_leads l
                LEFT JOIN bd_service_lines s ON s.service_key = l.service_key
                WHERE {where_sql}
                ORDER BY l.updated_at DESC, l.likelihood_score DESC, l.company_name ASC
                LIMIT ? OFFSET ?
                """,
                [*params, take, skip],
            ).df()

        items: list[dict[str, Any]] = []
        if df is not None and not df.empty:
            for _, row in df.iterrows():
                obj = row.to_dict()
                item = _serialize_generated_lead(obj)
                item["service_name"] = str(obj.get("service_name") or obj.get("service_key") or "")
                items.append(item)

        return {
            "items": items,
            "total": total,
            "limit": take,
            "offset": skip,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load market database: {e}")


@router.get("/bd/market-companies")
def list_market_companies(
    q: str | None = Query(default=None),
    industry: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=100),
    offset: int = Query(default=0),
    _user: dict = Depends(_current_user),
):
    try:
        take = int(max(1, min(limit, 250)))
        skip = int(max(0, offset))
        with get_conn() as con:
            _ensure_tables(con)
            where = ["1=1"]
            params: list[Any] = []
            if q and str(q).strip():
                needle = f"%{str(q).strip()}%"
                where.append("(company_name ILIKE ? OR industry ILIKE ? OR website ILIKE ? OR city ILIKE ? OR country ILIKE ?)")
                params.extend([needle, needle, needle, needle, needle])
            if industry and str(industry).strip():
                where.append("industry ILIKE ?")
                params.append(f"%{str(industry).strip()}%")
            if status and str(status).strip():
                where.append("lower(qualification_status) = lower(?)")
                params.append(str(status).strip())
            where_sql = " AND ".join(where)
            total_row = con.execute(
                f"SELECT COUNT(*) FROM bd_market_companies WHERE {where_sql}",
                params,
            ).fetchone()
            total = int(total_row[0] or 0) if total_row else 0
            df = con.execute(
                f"""
                SELECT *
                FROM bd_market_companies
                WHERE {where_sql}
                ORDER BY updated_at DESC, company_name ASC
                LIMIT ? OFFSET ?
                """,
                [*params, take, skip],
            ).df()
        items: list[dict[str, Any]] = []
        if df is not None and not df.empty:
            for _, row in df.iterrows():
                items.append(_serialize_market_company(row.to_dict()))
        return {"items": items, "total": total, "limit": take, "offset": skip}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load market companies: {e}")


@router.post("/bd/lead-generator/leads/{generated_lead_id}/qualify")
def qualify_generated_lead(generated_lead_id: int, body: dict = Body(default={}), _user: dict = Depends(_current_user)):
    try:
        actor = _actor(_user)
        action = str(body.get("action") or "").strip().lower()
        if action not in {"funnel", "binned"}:
            raise HTTPException(status_code=400, detail="action must be 'funnel' or 'binned'")
        notes = str(body.get("notes") or "").strip() or None
        with get_conn() as con:
            _ensure_tables(con)
            row_df = con.execute(
                "SELECT * FROM bd_ai_generated_leads WHERE generated_lead_id = ?",
                [int(generated_lead_id)],
            ).df()
            if row_df is None or row_df.empty:
                raise HTTPException(status_code=404, detail="Generated lead not found")
            item = row_df.iloc[0].to_dict()

            linked_lead_id = _safe_int(item.get("bd_lead_id"))
            bin_reason_id: int | None = None
            bin_reason_name: str | None = None
            if action == "binned":
                bin_reason_id = _safe_int(body.get("bin_reason_id"), None)
                if bin_reason_id is None:
                    raise HTTPException(status_code=400, detail="bin_reason_id is required when action is 'binned'")
                reason_row = con.execute(
                    """
                    SELECT bin_reason_id, name, is_active
                    FROM bd_bin_reasons_lookup
                    WHERE bin_reason_id = ?
                    LIMIT 1
                    """,
                    [int(bin_reason_id)],
                ).fetchone()
                if not reason_row:
                    raise HTTPException(status_code=400, detail="Invalid bin_reason_id")
                if not bool(reason_row[2]):
                    raise HTTPException(status_code=400, detail="Selected bin reason is inactive")
                bin_reason_id = int(reason_row[0])
                bin_reason_name = str(reason_row[1] or "").strip() or None
            elif action == "funnel":
                bin_reason_id = None
                bin_reason_name = None

            if action == "funnel" and linked_lead_id is None:
                lead_name = str(item.get("company_name") or "").strip() or "AI Lead"
                lead_notes = "\n".join(
                    [
                        "AI lead generator rationale:",
                        str(item.get("why_good_lead") or "").strip(),
                        "",
                        "Procurement/compliance trigger:",
                        str(item.get("trigger_reason") or "").strip(),
                        "",
                        "Sources:",
                        str(item.get("source_references") or "").strip(),
                    ]
                ).strip()
                inserted = con.execute(
                    """
                    INSERT INTO bd_leads (
                      lead_name, company_name, contact_name, email, phone, country, industry, source,
                      owner_user_id, notes, status, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
                    RETURNING lead_id
                    """,
                    [
                        lead_name,
                        lead_name,
                        str(item.get("contact_name") or "").strip() or None,
                        str(item.get("contact_email") or "").strip() or None,
                        str(item.get("contact_phone") or "").strip() or None,
                        str(item.get("country") or "").strip() or None,
                        str(item.get("industry") or "").strip() or None,
                        "ai-lead-generator",
                        actor,
                        lead_notes or None,
                        "qualified",
                    ],
                ).fetchone()
                linked_lead_id = int(inserted[0])

            con.execute(
                """
                UPDATE bd_ai_generated_leads
                SET qualification_status = ?,
                    bin_reason_id = ?,
                    bin_reason_name = ?,
                    qualification_notes = ?,
                    qualified_by = ?,
                    qualified_at = NOW(),
                    bd_lead_id = ?,
                    updated_at = NOW()
                WHERE generated_lead_id = ?
                """,
                [
                    action,
                    bin_reason_id,
                    bin_reason_name,
                    notes,
                    actor,
                    linked_lead_id,
                    int(generated_lead_id),
                ],
            )
        return {
            "ok": True,
            "generated_lead_id": int(generated_lead_id),
            "action": action,
            "bd_lead_id": linked_lead_id,
            "bin_reason_id": bin_reason_id,
            "bin_reason_name": bin_reason_name,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to qualify generated lead: {e}")


@router.get("/bd/leads")
def list_leads(
    q: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=300),
    offset: int = Query(default=0, ge=0),
    _user: dict = Depends(_current_user),
):
    try:
        with get_conn() as con:
            _ensure_tables(con)
            where = []
            params: list[Any] = []
            if status:
                where.append("lower(status) = lower(?)")
                params.append(str(status).strip())
            if q and str(q).strip():
                where.append("(lead_name ILIKE ? OR company_name ILIKE ? OR contact_name ILIKE ? OR email ILIKE ?)")
                needle = f"%{str(q).strip()}%"
                params.extend([needle, needle, needle, needle])
            where_sql = f"WHERE {' AND '.join(where)}" if where else ""
            count_row = con.execute(f"SELECT COUNT(*) FROM bd_leads {where_sql}", params).fetchone()
            total = int(count_row[0] if count_row and count_row[0] is not None else 0)
            df = con.execute(
                f"""
                SELECT *
                FROM bd_leads
                {where_sql}
                ORDER BY lead_id DESC
                LIMIT ? OFFSET ?
                """,
                [*params, int(limit), int(offset)],
            ).df()
            items: list[dict[str, Any]] = []
            if df is not None and not df.empty:
                for _, row in df.iterrows():
                    items.append(_serialize_lead(row.to_dict()))
            return {"items": items, "total": total, "limit": int(limit), "offset": int(offset)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load leads: {e}")


@router.post("/bd/leads")
def create_lead(body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        lead_name = str(body.get("lead_name") or "").strip()
        if not lead_name:
            raise HTTPException(status_code=400, detail="lead_name is required")
        actor = _actor(_user)
        with get_conn() as con:
            _ensure_tables(con)
            row = con.execute(
                """
                INSERT INTO bd_leads (
                  lead_name, company_name, contact_name, email, phone, country, industry, source,
                  owner_user_id, notes, status, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
                RETURNING lead_id
                """,
                [
                    lead_name,
                    str(body.get("company_name") or "").strip() or None,
                    str(body.get("contact_name") or "").strip() or None,
                    str(body.get("email") or "").strip() or None,
                    str(body.get("phone") or "").strip() or None,
                    str(body.get("country") or "").strip() or None,
                    str(body.get("industry") or "").strip() or None,
                    str(body.get("source") or "").strip() or None,
                    str(body.get("owner_user_id") or "").strip() or actor,
                    str(body.get("notes") or "").strip() or None,
                    str(body.get("status") or "new"),
                ],
            ).fetchone()
            return {"ok": True, "lead_id": int(row[0])}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create lead: {e}")


@router.post("/bd/leads/{lead_id}/convert")
def convert_lead_to_opportunity(lead_id: int, body: dict = Body(default={}), _user: dict = Depends(_current_user)):
    try:
        actor = _actor(_user)
        with get_conn() as con:
            _ensure_tables(con)
            lead_df = con.execute("SELECT * FROM bd_leads WHERE lead_id = ?", [int(lead_id)]).df()
            if lead_df is None or lead_df.empty:
                raise HTTPException(status_code=404, detail="Lead not found")
            lead = lead_df.iloc[0].to_dict()
            stage = con.execute(
                "SELECT stage_id FROM bd_funnel_stages WHERE lower(stage_key) = 'lead' AND is_active = TRUE ORDER BY stage_order LIMIT 1"
            ).fetchone()
            if not stage:
                stage = con.execute("SELECT stage_id FROM bd_funnel_stages WHERE is_active = TRUE ORDER BY stage_order LIMIT 1").fetchone()
            if not stage:
                raise HTTPException(status_code=400, detail="No active funnel stages configured")
            row = con.execute(
                """
                INSERT INTO bd_opportunities (
                  lead_id, opportunity_name, company_name, contact_name, email, phone, country, industry,
                  owner_user_id, stage_id, expected_close_date, estimated_value, currency, probability_pct,
                  status, notes, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
                RETURNING opportunity_id
                """,
                [
                    int(lead_id),
                    str(body.get("opportunity_name") or lead.get("lead_name") or "New Opportunity"),
                    str(lead.get("company_name") or body.get("company_name") or "").strip() or None,
                    str(lead.get("contact_name") or body.get("contact_name") or "").strip() or None,
                    str(lead.get("email") or body.get("email") or "").strip() or None,
                    str(lead.get("phone") or body.get("phone") or "").strip() or None,
                    str(lead.get("country") or body.get("country") or "").strip() or None,
                    str(lead.get("industry") or body.get("industry") or "").strip() or None,
                    str(body.get("owner_user_id") or lead.get("owner_user_id") or actor),
                    int(stage[0]),
                    str(body.get("expected_close_date") or "").strip() or None,
                    _safe_float(body.get("estimated_value"), 0),
                    str(body.get("currency") or "GBP").upper(),
                    _safe_float(body.get("probability_pct"), 0),
                    "open",
                    str(body.get("notes") or lead.get("notes") or "").strip() or None,
                ],
            ).fetchone()
            opp_id = int(row[0])
            con.execute(
                "UPDATE bd_leads SET status='converted', converted_at=NOW(), converted_to_opportunity_id=?, updated_at=NOW() WHERE lead_id=?",
                [opp_id, int(lead_id)],
            )
            return {"ok": True, "opportunity_id": opp_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to convert lead: {e}")


@router.get("/bd/opportunities")
def list_opportunities(
    q: str | None = Query(default=None),
    stage_id: int | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    _user: dict = Depends(_current_user),
):
    try:
        with get_conn() as con:
            _ensure_tables(con)
            where = []
            params: list[Any] = []
            if stage_id is not None:
                where.append("o.stage_id = ?")
                params.append(int(stage_id))
            if status:
                where.append("lower(o.status) = lower(?)")
                params.append(str(status).strip())
            if q and str(q).strip():
                where.append("(o.opportunity_name ILIKE ? OR o.company_name ILIKE ? OR o.contact_name ILIKE ? OR o.email ILIKE ?)")
                needle = f"%{str(q).strip()}%"
                params.extend([needle, needle, needle, needle])
            where_sql = f"WHERE {' AND '.join(where)}" if where else ""
            count_row = con.execute(f"SELECT COUNT(*) FROM bd_opportunities o {where_sql}", params).fetchone()
            total = int(count_row[0] if count_row and count_row[0] is not None else 0)
            df = con.execute(
                f"""
                SELECT
                  o.*,
                  s.stage_key,
                  s.stage_name,
                  s.stage_order,
                  s.probability_pct AS stage_probability
                FROM bd_opportunities o
                JOIN bd_funnel_stages s ON s.stage_id = o.stage_id
                {where_sql}
                ORDER BY s.stage_order ASC, o.opportunity_id DESC
                LIMIT ? OFFSET ?
                """,
                [*params, int(limit), int(offset)],
            ).df()
            items: list[dict[str, Any]] = []
            if df is not None and not df.empty:
                for _, row in df.iterrows():
                    items.append(_serialize_opportunity(row.to_dict()))
            return {"items": items, "total": total, "limit": int(limit), "offset": int(offset)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load opportunities: {e}")


@router.post("/bd/opportunities")
def create_opportunity(body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        actor = _actor(_user)
        name = str(body.get("opportunity_name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="opportunity_name is required")
        with get_conn() as con:
            _ensure_tables(con)
            stage_id = _safe_int(body.get("stage_id"))
            if stage_id is None:
                row = con.execute("SELECT stage_id FROM bd_funnel_stages WHERE is_active = TRUE ORDER BY stage_order LIMIT 1").fetchone()
                if not row:
                    raise HTTPException(status_code=400, detail="No active funnel stage available")
                stage_id = int(row[0])
            con.execute(
                """
                INSERT INTO bd_opportunities (
                  lead_id, opportunity_name, company_name, contact_name, email, phone, country, industry,
                  owner_user_id, stage_id, expected_close_date, estimated_value, currency, probability_pct,
                  status, notes, client_db_id, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
                """,
                [
                    _safe_int(body.get("lead_id")),
                    name,
                    str(body.get("company_name") or "").strip() or None,
                    str(body.get("contact_name") or "").strip() or None,
                    str(body.get("email") or "").strip() or None,
                    str(body.get("phone") or "").strip() or None,
                    str(body.get("country") or "").strip() or None,
                    str(body.get("industry") or "").strip() or None,
                    str(body.get("owner_user_id") or "").strip() or actor,
                    int(stage_id),
                    str(body.get("expected_close_date") or "").strip() or None,
                    _safe_float(body.get("estimated_value"), 0),
                    str(body.get("currency") or "GBP").upper(),
                    _safe_float(body.get("probability_pct"), 0),
                    str(body.get("status") or "open"),
                    str(body.get("notes") or "").strip() or None,
                    _safe_int(body.get("client_db_id")),
                ],
            )
            return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create opportunity: {e}")


@router.patch("/bd/opportunities/{opportunity_id}")
def update_opportunity(opportunity_id: int, body: dict = Body(...), _user: dict = Depends(_current_user)):
    try:
        with get_conn() as con:
            _ensure_tables(con)
            exists = con.execute("SELECT 1 FROM bd_opportunities WHERE opportunity_id = ?", [int(opportunity_id)]).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="Opportunity not found")
            updates: list[str] = []
            params: list[Any] = []
            text_fields = (
                "opportunity_name",
                "company_name",
                "contact_name",
                "email",
                "phone",
                "country",
                "industry",
                "owner_user_id",
                "expected_close_date",
                "currency",
                "status",
                "notes",
                "lost_reason",
            )
            for key in text_fields:
                if key not in body:
                    continue
                updates.append(f"{key} = ?")
                params.append(str(body.get(key) or "").strip() or None)
            if "stage_id" in body:
                updates.append("stage_id = ?")
                params.append(_safe_int(body.get("stage_id")))
            if "lead_id" in body:
                updates.append("lead_id = ?")
                params.append(_safe_int(body.get("lead_id")))
            if "client_db_id" in body:
                updates.append("client_db_id = ?")
                params.append(_safe_int(body.get("client_db_id")))
            if "estimated_value" in body:
                updates.append("estimated_value = ?")
                params.append(_safe_float(body.get("estimated_value"), 0))
            if "probability_pct" in body:
                updates.append("probability_pct = ?")
                params.append(_safe_float(body.get("probability_pct"), 0))
            if "quote_id" in body:
                updates.append("quote_id = ?")
                params.append(_safe_int(body.get("quote_id")))
            if "job_id" in body:
                updates.append("job_id = ?")
                params.append(_safe_int(body.get("job_id")))
            if "status" in body:
                status_value = str(body.get("status") or "").strip().lower()
                if status_value == "won":
                    updates.append("won_at = NOW()")
                if status_value == "lost":
                    updates.append("lost_at = NOW()")
            if not updates:
                return {"ok": True}
            updates.append("updated_at = NOW()")
            params.append(int(opportunity_id))
            con.execute(f"UPDATE bd_opportunities SET {', '.join(updates)} WHERE opportunity_id = ?", params)
            return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update opportunity: {e}")


@router.post("/bd/opportunities/{opportunity_id}/convert-client")
def convert_opportunity_to_client(opportunity_id: int, _user: dict = Depends(_current_user)):
    try:
        actor = _actor(_user)
        with get_conn() as con:
            _ensure_tables(con)
            opp_df = con.execute("SELECT * FROM bd_opportunities WHERE opportunity_id = ?", [int(opportunity_id)]).df()
            if opp_df is None or opp_df.empty:
                raise HTTPException(status_code=404, detail="Opportunity not found")
            opp = opp_df.iloc[0].to_dict()
            client_id = _ensure_client_for_opportunity(con, opp, actor)
            return {"ok": True, "client_db_id": int(client_id)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to convert opportunity to client: {e}")


@router.post("/bd/opportunities/{opportunity_id}/create-quote")
def create_quote_from_opportunity(opportunity_id: int, body: dict = Body(default={}), _user: dict = Depends(_current_user)):
    try:
        actor = _actor(_user)
        with get_conn() as con:
            _ensure_tables(con)
            _ensure_quote_tables(con)
            opp_df = con.execute("SELECT * FROM bd_opportunities WHERE opportunity_id = ?", [int(opportunity_id)]).df()
            if opp_df is None or opp_df.empty:
                raise HTTPException(status_code=404, detail="Opportunity not found")
            opp = opp_df.iloc[0].to_dict()
            client_id = _ensure_client_for_opportunity(con, opp, actor)

            quote_number = _next_quote_number(con)
            today = date.today()
            valid_to = today + timedelta(days=30)
            estimated_value = _safe_float(opp.get("estimated_value"), 0.0)
            currency = str(opp.get("currency") or "GBP").upper()
            description = str(body.get("description") or opp.get("notes") or "").strip()
            attention = str(opp.get("contact_name") or "").strip() or None

            row = con.execute(
                """
                INSERT INTO quotes (
                  client_db_id, quote_date, valid_to, salesperson, currency_code, description, notes, status,
                  quote_number, attention, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
                RETURNING quote_id
                """,
                [
                    int(client_id),
                    today.isoformat(),
                    valid_to.isoformat(),
                    actor,
                    currency,
                    description or None,
                    str(opp.get("notes") or "").strip() or None,
                    "Draft",
                    quote_number,
                    attention,
                ],
            ).fetchone()
            quote_id = int(row[0])
            con.execute(
                """
                INSERT INTO quote_lines (
                  quote_id, line_type, sort_order, description, qty, unit_price_ex_vat, amount_ex_vat, vat_rate_pct, is_selected
                )
                VALUES (?, 'main', 1, ?, 1, ?, ?, 20, TRUE)
                """,
                [
                    int(quote_id),
                    str(body.get("line_description") or opp.get("opportunity_name") or "Service line"),
                    float(estimated_value),
                    float(estimated_value),
                ],
            )
            con.execute(
                "UPDATE bd_opportunities SET quote_id = ?, client_db_id = ?, updated_at = NOW() WHERE opportunity_id = ?",
                [int(quote_id), int(client_id), int(opportunity_id)],
            )
            return {"ok": True, "quote_id": int(quote_id), "client_db_id": int(client_id)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create quote from opportunity: {e}")


@router.post("/bd/opportunities/{opportunity_id}/create-job")
def create_job_from_opportunity(opportunity_id: int, body: dict = Body(default={}), _user: dict = Depends(_current_user)):
    try:
        actor = _actor(_user)
        with get_conn() as con:
            _ensure_tables(con)
            opp_df = con.execute("SELECT * FROM bd_opportunities WHERE opportunity_id = ?", [int(opportunity_id)]).df()
            if opp_df is None or opp_df.empty:
                raise HTTPException(status_code=404, detail="Opportunity not found")
            opp = opp_df.iloc[0].to_dict()
            client_id = _ensure_client_for_opportunity(con, opp, actor)

            job_type_name = str(body.get("job_type") or "").strip()
            job_type_row = None
            if job_type_name:
                job_type_row = con.execute(
                    "SELECT job_type_id, name, is_crp FROM job_types WHERE lower(name)=lower(?) AND is_active=TRUE LIMIT 1",
                    [job_type_name],
                ).fetchone()
            if not job_type_row:
                job_type_row = con.execute(
                    "SELECT job_type_id, name, is_crp FROM job_types WHERE is_active=TRUE ORDER BY job_type_id LIMIT 1"
                ).fetchone()
            if not job_type_row:
                raise HTTPException(status_code=400, detail="No active job type available")

            today = date.today()
            due_date = today + timedelta(days=30)
            reporting_year = int(body.get("reporting_year") or today.year)
            reporting_period_start = date(reporting_year, 1, 1)
            reporting_period_end = date(reporting_year, 12, 31)
            title = str(body.get("title") or opp.get("opportunity_name") or "New Job").strip()
            row = con.execute(
                """
                INSERT INTO jobs (
                  client_db_id, job_type_id, job_type, job_number, title, reporting_year,
                  reporting_period_start, reporting_period_end, is_benchmark, is_crp, status, start_date, due_date, legacy_job_no
                )
                VALUES (?, ?, ?, 'PENDING', ?, ?, ?, ?, FALSE, ?, 'Open', ?, ?, ?)
                RETURNING job_id
                """,
                [
                    int(client_id),
                    int(job_type_row[0]),
                    str(job_type_row[1]),
                    title,
                    int(reporting_year),
                    reporting_period_start.isoformat(),
                    reporting_period_end.isoformat(),
                    bool(job_type_row[2]) if job_type_row[2] is not None else False,
                    today.isoformat(),
                    due_date.isoformat(),
                    str(body.get("legacy_job_no") or "").strip() or None,
                ],
            ).fetchone()
            job_id = int(row[0])
            job_number = f"J{(job_id + 999):06d}"
            con.execute("UPDATE jobs SET job_number = ? WHERE job_id = ?", [job_number, int(job_id)])
            con.execute(
                """
                UPDATE bd_opportunities
                SET job_id = ?, client_db_id = ?, status = 'won', won_at = NOW(), updated_at = NOW()
                WHERE opportunity_id = ?
                """,
                [int(job_id), int(client_id), int(opportunity_id)],
            )
            return {"ok": True, "job_id": int(job_id), "job_number": job_number, "client_db_id": int(client_id)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create job from opportunity: {e}")


@router.get("/bd/overview")
def get_bd_overview(_user: dict = Depends(_current_user)):
    try:
        with get_conn() as con:
            _ensure_tables(con)
            try:
                stages_df = con.execute(
                    """
                    SELECT stage_id, stage_key, stage_name, stage_order, probability_pct, is_active
                    FROM bd_funnel_stages
                    WHERE is_active = TRUE
                    ORDER BY stage_order
                    """
                ).df()
            except Exception:
                stages_df = None
            try:
                agg_df = con.execute(
                    """
                    SELECT stage_id, COUNT(*) AS opportunity_count, COALESCE(SUM(estimated_value), 0) AS pipeline_value
                    FROM bd_opportunities
                    WHERE lower(coalesce(status, 'open')) = 'open'
                    GROUP BY stage_id
                    """
                ).df()
            except Exception:
                agg_df = None
            try:
                lead_row = con.execute(
                    "SELECT COUNT(*) FROM bd_leads WHERE lower(coalesce(status, 'new')) IN ('new','qualified','contacted')"
                ).fetchone()
            except Exception:
                lead_row = None
            total_leads = int(lead_row[0] if lead_row and lead_row[0] is not None else 0)

            agg_by_stage: dict[int, dict[str, Any]] = {}
            if agg_df is not None and not agg_df.empty:
                for _, row in agg_df.iterrows():
                    sid = int(row.get("stage_id") or 0)
                    agg_by_stage[sid] = {
                        "opportunity_count": int(row.get("opportunity_count") or 0),
                        "pipeline_value": float(row.get("pipeline_value") or 0),
                    }

            stages: list[dict[str, Any]] = []
            total_pipeline = 0.0
            total_opps = 0
            if stages_df is not None and not stages_df.empty:
                for _, row in stages_df.iterrows():
                    stage = _serialize_stage(row.to_dict())
                    agg = agg_by_stage.get(int(stage["stage_id"]), {"opportunity_count": 0, "pipeline_value": 0.0})
                    stage["opportunity_count"] = int(agg["opportunity_count"])
                    stage["pipeline_value"] = float(agg["pipeline_value"])
                    total_pipeline += float(agg["pipeline_value"])
                    total_opps += int(agg["opportunity_count"])
                    stages.append(stage)

            return {
                "stages": stages,
                "totals": {
                    "lead_count": total_leads,
                    "open_opportunities": total_opps,
                    "pipeline_value": round(total_pipeline, 2),
                },
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load business development overview: {e}")
