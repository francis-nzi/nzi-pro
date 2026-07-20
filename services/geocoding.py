"""Free-text location -> coordinates via OpenStreetMap's Nominatim.

No account/API key required. Nominatim's usage policy caps public-instance
traffic at 1 request/second and requires a real identifying User-Agent --
callers must only invoke this from a batch/admin-triggered job (sleeping
between calls), never from a live per-request path like a portal page load.
"""

from __future__ import annotations

import requests

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "NZI-Insights-Portal/1.0 (+francis@netzero.international)"

_ADDRESS_KEYS = ("house_number", "road", "postcode")
_CITY_KEYS = ("city", "town", "village", "suburb", "county", "state_district")


def geocode_location(location: str) -> dict[str, object] | None:
    """Return {"latitude", "longitude", "precision"} for a free-text location,
    or None if it couldn't be resolved. precision is "address" | "city" | "country".
    """
    text = str(location or "").strip()
    if not text:
        return None

    try:
        resp = requests.get(
            NOMINATIM_URL,
            params={"q": text, "format": "jsonv2", "addressdetails": 1, "limit": 1},
            headers={"User-Agent": USER_AGENT},
            timeout=10,
        )
        resp.raise_for_status()
        results = resp.json()
    except Exception:
        return None

    if not results:
        return None

    result = results[0]
    try:
        latitude = float(result["lat"])
        longitude = float(result["lon"])
    except (KeyError, TypeError, ValueError):
        return None

    address = result.get("address") or {}
    if any(address.get(k) for k in _ADDRESS_KEYS):
        precision = "address"
    elif any(address.get(k) for k in _CITY_KEYS):
        precision = "city"
    else:
        precision = "country"

    return {"latitude": latitude, "longitude": longitude, "precision": precision}
