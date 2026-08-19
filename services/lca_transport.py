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
MILES_PER_KM = 0.621371

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

# The three EN 15804 modules that get a Transport Legs section in the UI
# instead of a single line-level factor_value -- kept alongside VALID_MODES
# since both describe the same "this line is transport-managed" concept.
TRANSPORT_MODULE_CODES = ("A2", "A4", "C2")

# Curated, per-mode default freight factors -- DESNZ's full freight factor
# set (154 per-vehicle "Delivery Vehicles" factors x several laden states,
# 570 tonne.km "Freighting Goods" factors x vessel/vehicle subtypes) is too
# many confusable variables for day-to-day leg entry. This is a fixed
# shortlist of tonne.km factors, one per mode/subtype, confirmed present
# under these exact original_ids in every UK/UAE Activity & Spend dataset
# 2019-2026. Resolved against the job's actual active dataset at lookup
# time (see api/lca_routes.py list_transport_leg_default_factors) -- never
# hardcoded to one dataset/year. Free-text search stays available alongside
# this for anything that doesn't fit (e.g. an unusual vessel type).
FREIGHT_DEFAULT_FACTORS: dict[str, list[dict[str, str]]] = {
    "road": [
        {"sub_label": "Van (up to 3.5t) Diesel", "original_id": "27_303_3102_14_1"},
        {"sub_label": "HGV (All Diesel), Average Laden", "original_id": "27_304_3140_14_1"},
        {"sub_label": "HGV Refrigerated (All Diesel), Average Laden", "original_id": "27_306_3140_14_1"},
    ],
    "rail": [
        {"sub_label": "Freight Train", "original_id": "27_315_3151_14_1"},
    ],
    "sea": [
        {"sub_label": "Tanker -- Crude", "original_id": "27_319_3197_14_1"},
        {"sub_label": "Tanker -- Chemical", "original_id": "27_319_3208_14_1"},
        {"sub_label": "Tanker -- LNG", "original_id": "27_319_3211_14_1"},
        {"sub_label": "Tanker -- LPG", "original_id": "27_319_3214_14_1"},
        {"sub_label": "Cargo Ship -- Bulk Carrier", "original_id": "27_320_3221_14_1"},
        {"sub_label": "Cargo Ship -- General Cargo", "original_id": "27_320_3228_14_1"},
        {"sub_label": "Cargo Ship -- Container Ship", "original_id": "27_320_3235_14_1"},
    ],
    "air": [
        {"sub_label": "Freight Flight -- Domestic (to/from UK)", "original_id": "27_317_3152_14_1"},
        {"sub_label": "Freight Flight -- Short-Haul (to/from UK)", "original_id": "27_317_3154_14_1"},
        {"sub_label": "Freight Flight -- International (to/from non-UK)", "original_id": "27_317_3158_14_1"},
    ],
}


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


def _leg_denominator_kind(factor_unit: str | None) -> str:
    """'tonne_km' | 'tonne_mile' | 'km' | 'mile' | 'unknown', classified
    directly from the bare activity-unit string stored on a leg (e.g.
    "tonne.km", "km", "miles" -- the emission factor's own UOM column,
    copied through as-is). This is NOT a combined "numerator/denominator"
    string -- the numerator (emissions unit) is a separate field, see
    compute_leg_emissions_tco2e's ghg_unit parameter. Conflating the two
    into one string previously caused a bare "tonne.km" to be misread as
    tonne-scale *emissions* just because the word "tonne" appears in it."""
    unit = str(factor_unit or "").strip().lower()
    has_tonne = "tonne" in unit
    has_km = "km" in unit
    has_mile = "mile" in unit
    if has_tonne and has_km:
        return "tonne_km"
    if has_tonne and has_mile:
        return "tonne_mile"
    if has_mile:
        return "mile"
    if has_km:
        return "km"
    return "unknown"


def compute_leg_emissions_tco2e(
    mass_kg: float,
    distance_km: float,
    factor_value: float,
    factor_unit: str | None,
    ghg_unit: str | None = None,
) -> float:
    """tCO2e for one leg. mass_kg is only used for a tonne-denominated
    factor (e.g. DESNZ "Freighting goods... tonne.km"); a plain per-km or
    per-mile (per-vehicle-trip) factor is distance-only and mass-independent.

    factor_unit is the bare activity/denominator unit (e.g. "tonne.km",
    "miles"); ghg_unit is that same factor's separate GHG-Unit column (e.g.
    "kg CO2e", "tCO2e") and drives the kg-vs-tonne magnitude via
    factor_unit_to_tonnes_multiplier -- reused as-is since it already
    degrades correctly on a bare string with no "/"."""
    distance = max(safe_float(distance_km), 0.0)
    factor = max(safe_float(factor_value), 0.0)
    numerator_multiplier = factor_unit_to_tonnes_multiplier(ghg_unit)
    kind = _leg_denominator_kind(factor_unit)
    mass_tonnes = max(safe_float(mass_kg), 0.0) / 1000.0

    if kind == "tonne_km":
        return mass_tonnes * distance * factor * numerator_multiplier
    if kind == "tonne_mile":
        return mass_tonnes * (distance * MILES_PER_KM) * factor * numerator_multiplier
    if kind == "mile":
        return (distance * MILES_PER_KM) * factor * numerator_multiplier
    if kind == "km":
        return distance * factor * numerator_multiplier
    # Unrecognized denominator (e.g. a non-freight factor picked by mistake):
    # fall back to the km-only, mass-independent treatment rather than
    # silently returning 0, which would make a mapped-but-odd factor look
    # like "no data".
    return distance * factor * numerator_multiplier
