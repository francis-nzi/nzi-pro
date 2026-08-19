"""Free-text location -> coordinates via OpenStreetMap's Nominatim.

No account/API key required. Nominatim's usage policy caps public-instance
traffic at 1 request/second and requires a real identifying User-Agent.
Every outbound request in this module -- including from the live
autocomplete endpoint (api/lca_routes.py search_locations_endpoint) -- goes
through _throttled_get, a single process-wide lock + minimum-interval gate,
so concurrent callers queue rather than burst past that limit. Safe as
in-process state because this app is a single-instance Render deployment
(same assumption api/job_live_report_routes.py's PDF-render semaphore
relies on).
"""

from __future__ import annotations

import logging
import re
import threading
import time

import requests

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "NZI-Insights-Portal/1.0 (+francis@netzero.international)"

_MIN_INTERVAL_SECONDS = 1.05
_throttle_lock = threading.Lock()
_last_call_at = 0.0


def _throttled_get(params: dict[str, object]) -> requests.Response:
    """Issues one Nominatim GET, blocking as needed so no two calls from
    anywhere in the process land less than _MIN_INTERVAL_SECONDS apart."""
    global _last_call_at
    with _throttle_lock:
        wait = _MIN_INTERVAL_SECONDS - (time.monotonic() - _last_call_at)
        if wait > 0:
            time.sleep(wait)
        response = requests.get(
            NOMINATIM_URL, params=params, headers={"User-Agent": USER_AGENT}, timeout=10,
        )
        _last_call_at = time.monotonic()
        return response

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
    for query, used_fallback in candidates:
        # _throttled_get itself enforces the >=1s spacing Nominatim requires,
        # both between these fallback queries and against any other caller
        # in the process (e.g. a concurrent autocomplete request).
        try:
            resp = _throttled_get({"q": query, "format": "jsonv2", "addressdetails": 1, "limit": 1, "accept-language": "en"})
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


def search_locations(query: str, limit: int = 5) -> list[dict[str, object]]:
    """Live autocomplete: returns up to `limit` candidate places matching
    `query`, for a UI to let the user pick a real, Nominatim-confirmed name
    instead of typing one blind (Nominatim does prefix/token matching, not
    edit-distance fuzzy matching, so this still won't surface "Perak" for
    "perac" -- but it lets a user course-correct as they type instead of
    only finding out at save time). Goes through the same _throttled_get
    every other geocoding call in this module uses, so this is safe to call
    from a live per-keystroke UI path."""
    text = str(query or "").strip()
    if len(text) < 3:
        return []
    try:
        resp = _throttled_get({"q": text, "format": "jsonv2", "addressdetails": 1, "limit": max(1, min(limit, 10)), "accept-language": "en"})
        resp.raise_for_status()
        results = resp.json()
    except (requests.RequestException, ValueError) as exc:
        logger.warning("Nominatim search request failed: %s", type(exc).__name__)
        return []
    if not isinstance(results, list):
        return []

    out: list[dict[str, object]] = []
    for result in results:
        try:
            latitude = float(result["lat"])
            longitude = float(result["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        label = str(result.get("display_name") or "").strip()
        if not label:
            continue
        out.append(
            {
                "label": label,
                "latitude": latitude,
                "longitude": longitude,
                "precision": _result_precision(result, False),
            }
        )
    return out
