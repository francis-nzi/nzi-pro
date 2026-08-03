"""Free-text location -> coordinates via OpenStreetMap's Nominatim.

No account/API key required. Nominatim's usage policy caps public-instance
traffic at 1 request/second and requires a real identifying User-Agent --
callers must only invoke this from a batch/admin-triggered job (sleeping
between calls), never from a live per-request path like a portal page load.
"""

from __future__ import annotations

import logging
import re
import time

import requests

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "NZI-Insights-Portal/1.0 (+francis@netzero.international)"

_CITY_KEYS = ("city", "town", "village", "suburb", "county", "state_district")
_UK_POSTCODE_RE = re.compile(
    r"\b(?:GIR\s?0AA|(?:[A-Z]{1,2}\d[A-Z\d]?|\d[A-Z]{2})\s?\d[A-Z]{2})\b",
    re.IGNORECASE,
)

logger = logging.getLogger(__name__)


def _candidate_queries(location: str) -> list[tuple[str, bool]]:
    """Build ordered queries, marking any deliberately broader fallback."""
    candidates: list[tuple[str, bool]] = [(location, False)]
    postcode_match = _UK_POSTCODE_RE.search(location)
    if postcode_match:
        postcode = postcode_match.group(0).upper()
        # The last comma-delimited component is normally the country. Keeping
        # it disambiguates postcodes without making Nominatim parse the
        # building name which caused the original full-address miss.
        parts = [part.strip() for part in location.split(",") if part.strip()]
        country = parts[-1] if parts and postcode.lower() not in parts[-1].lower() else "United Kingdom"
        fallback = f"{postcode}, {country}"
        if fallback.casefold() != location.casefold():
            candidates.append((fallback, True))
    return candidates


def _result_precision(result: dict[str, object], used_fallback: bool) -> str:
    address = result.get("address") or {}
    if not isinstance(address, dict):
        address = {}
    if address.get("house_number") or address.get("road"):
        return "address"
    if result.get("addresstype") == "postcode" or (used_fallback and address.get("postcode")):
        return "postcode"
    if any(address.get(k) for k in _CITY_KEYS):
        return "city"
    return "country"


def geocode_location_detailed(location: str) -> tuple[dict[str, object] | None, str | None]:
    """Geocode a location and return ``(result, failure_reason)``.

    A full UK address which Nominatim cannot parse is retried at postcode
    precision. Failure reasons are intentionally coarse enough to return to
    the UI while still distinguishing bad input from a provider problem.
    """
    text = str(location or "").strip()
    if not text:
        return None, "empty_location"

    candidates = _candidate_queries(text)
    for index, (query, used_fallback) in enumerate(candidates):
        if index:
            # Public Nominatim requires no more than one request per second.
            time.sleep(1.05)
        try:
            resp = requests.get(
                NOMINATIM_URL,
                params={"q": query, "format": "jsonv2", "addressdetails": 1, "limit": 1},
                headers={"User-Agent": USER_AGENT},
                timeout=10,
            )
            resp.raise_for_status()
            results = resp.json()
        except (requests.RequestException, ValueError) as exc:
            logger.warning("Nominatim request failed: %s", type(exc).__name__)
            return None, "service_unavailable"

        if not isinstance(results, list):
            logger.warning("Nominatim returned an unexpected response shape")
            return None, "invalid_response"
        if not results:
            continue

        result = results[0]
        try:
            latitude = float(result["lat"])
            longitude = float(result["lon"])
        except (KeyError, TypeError, ValueError):
            logger.warning("Nominatim returned a result without valid coordinates")
            return None, "invalid_response"

        return {
            "latitude": latitude,
            "longitude": longitude,
            "precision": _result_precision(result, used_fallback),
            "fallback_used": used_fallback,
        }, None

    return None, "not_found"


def geocode_location(location: str) -> dict[str, object] | None:
    """Return {"latitude", "longitude", "precision"} for a free-text location,
    or None if it couldn't be resolved. precision is "address" | "postcode" |
    "city" | "country".
    """
    result, _failure_reason = geocode_location_detailed(location)
    return result
