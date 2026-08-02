"""Distance and emissions calculation for LCA transport legs (A2/A4/C2).

No routing API exists in this codebase (see services/geocoding.py -- only
free-text -> lat/long via Nominatim). Distance is a straight-line (haversine)
estimate between geocoded points, scaled by a mode-specific detour factor --
a standard, documented LCA approximation, not real road/sea-lane routing.
"""
from __future__ import annotations

import math

from services.lca_engine import factor_unit_to_tonnes_multiplier, safe_float

EARTH_RADIUS_KM = 6371.0088

# Coarse circuity/detour estimates -- real journeys aren't straight lines.
# Sea is left at 1.0 (shipping lanes are long relative to any local detour
# and a precise multiplier would be spurious precision); road/rail/air get
# a modest bump. Hardcoded for v1 -- promote to an editable lookup table
# only if the approximation proves too coarse against a real client report.
DETOUR_FACTORS: dict[str, float] = {
    "road": 1.25,
    "rail": 1.2,
    "sea": 1.0,
    "air": 1.05,
}

VALID_MODES = tuple(DETOUR_FACTORS.keys())


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def estimate_leg_distance_km(
    mode: str, origin_lat: float, origin_lon: float, destination_lat: float, destination_lon: float,
) -> tuple[float, float]:
    """Returns (straight_line_km, distance_km) where distance_km applies the
    mode's detour factor to the straight-line figure."""
    straight_line_km = haversine_km(origin_lat, origin_lon, destination_lat, destination_lon)
    detour_factor = DETOUR_FACTORS.get(mode, 1.0)
    return straight_line_km, straight_line_km * detour_factor


def _factor_unit_denominator_kind(factor_unit: str | None) -> str:
    """'tonne_km' | 'km' | 'unknown', from the part after the first '/'.

    Mirrors factor_unit_to_tonnes_multiplier's numerator-only parsing, but
    looks at the denominator instead -- the two are independent questions
    (numerator = which emissions unit, denominator = which activity unit).
    """
    unit = str(factor_unit or "").strip().lower()
    if "/" not in unit:
        return "unknown"
    denominator = unit.split("/", 1)[1]
    has_tonne = "tonne" in denominator or "tonnes" in denominator
    has_km = "km" in denominator
    if has_tonne and has_km:
        return "tonne_km"
    if has_km:
        return "km"
    return "unknown"


def compute_leg_emissions_tco2e(mass_kg: float, distance_km: float, factor_value: float, factor_unit: str | None) -> float:
    """tCO2e for one leg. mass_kg is only used for a tonne.km-denominated
    factor (e.g. DEFRA "Freighting goods... tonne.km"); a plain per-km
    (per-vehicle-trip) factor is distance-only and mass-independent."""
    distance = max(safe_float(distance_km), 0.0)
    factor = max(safe_float(factor_value), 0.0)
    numerator_multiplier = factor_unit_to_tonnes_multiplier(factor_unit)
    kind = _factor_unit_denominator_kind(factor_unit)

    if kind == "tonne_km":
        mass_tonnes = max(safe_float(mass_kg), 0.0) / 1000.0
        return mass_tonnes * distance * factor * numerator_multiplier
    if kind == "km":
        return distance * factor * numerator_multiplier
    # Unrecognized denominator (e.g. a non-freight factor picked by mistake):
    # fall back to the km-only treatment rather than silently returning 0,
    # which would make a mapped-but-odd factor look like "no data".
    return distance * factor * numerator_multiplier
