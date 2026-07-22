"""DVLA Vehicle Enquiry Service (VES) client.

Client Portal Data Entry Phase 3 -- lets a client enter a UK registration
number and get back vehicle specs (fuel type, engine size, revenue weight,
type approval) for carbon-accounting category resolution, instead of
manually searching for the right factor.

IMPORTANT (flagged during implementation, not verified live): the request/
response shape below is based on general knowledge of DVLA's published VES
API, not confirmed against live DVLA documentation in this environment (no
internet access here). Before relying on this for real client use, smoke-
test it against the live API with a real DVLA_VES_API_KEY and a real
registration -- see CLIENT_PORTAL_DATA_ENTRY_SCOPE.md Phase 3 Verification.

Never persist the registration number itself -- it is used transiently in
the request only. Callers must not log or store it either.
"""
from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

VES_URL = "https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles"


def _api_key() -> str:
    project_env = Path(__file__).resolve().parents[1] / ".env"
    if project_env.exists():
        load_dotenv(dotenv_path=project_env, override=False)
    return str(os.environ.get("DVLA_VES_API_KEY") or "").strip()


def _normalize_registration(registration: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", str(registration or "")).upper()


def lookup_vehicle_by_registration(registration: str) -> tuple[dict[str, Any] | None, str | None]:
    """Returns (vehicle_data, error_message). Never raises. vehicle_data only
    contains the fields needed for category resolution -- never echoes the
    registration number back, so callers never accidentally persist it by
    passing the whole response through to a database write."""
    api_key = _api_key()
    if not api_key:
        return None, "Vehicle lookup is not configured (DVLA_VES_API_KEY not set)"

    plate = _normalize_registration(registration)
    if not plate or not (2 <= len(plate) <= 8):
        return None, "That doesn't look like a valid UK registration number"

    body = json.dumps({"registrationNumber": plate}).encode("utf-8")
    req = Request(
        VES_URL,
        data=body,
        method="POST",
        headers={
            "x-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urlopen(req, timeout=15) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        if e.code == 404:
            return None, "No vehicle found for that registration"
        if e.code in (401, 403):
            logger.warning("DVLA VES auth failed (%s) -- check DVLA_VES_API_KEY", e.code)
            return None, "Vehicle lookup is temporarily unavailable"
        if e.code == 429:
            return None, "Too many lookups right now -- please try again shortly"
        logger.warning("DVLA VES request failed with HTTP %s", e.code)
        return None, "Vehicle lookup failed -- please try again or search manually"
    except URLError:
        logger.warning("DVLA VES network error", exc_info=True)
        return None, "Vehicle lookup failed -- please try again or search manually"
    except Exception:
        logger.warning("DVLA VES lookup failed unexpectedly", exc_info=True)
        return None, "Vehicle lookup failed -- please try again or search manually"

    return {
        "type_approval": payload.get("typeApproval"),
        "fuel_type": payload.get("fuelType"),
        "engine_capacity": payload.get("engineCapacity"),
        "revenue_weight": payload.get("revenueWeight"),
        "co2_emissions": payload.get("co2Emissions"),
        "wheelplan": payload.get("wheelplan"),
        "make": payload.get("make"),
    }, None
