"""Maps DVLA VES vehicle specs to a real Company Vehicles factor row.

Client Portal Data Entry Phase 3. Band boundaries (engine cc for car size,
revenue weight for van class) are DEFRA-methodology conventions. Spot-checked
2026-07-24 against two real vehicles via the live DVLA VES API: a 3198cc N1
diesel van (revenue weight 3270kg) correctly resolved to Vans - Class III
(1.74-3.5t) - Diesel, and a 1950cc M1 diesel car correctly resolved to Cars
(by size) - Medium car - Diesel. Boundary edges (exactly 1400/2000cc, Large
car, HGV bands, motorbikes) remain unexercised by a real lookup.

DVLA type approval codes used to branch: M1 = car, N1 = light goods (van),
N2/N3 = heavier goods vehicles. Anything else (motorcycles, or a goods
vehicle DVLA left type_approval blank for -- common for HGVs on the free
VES API) falls back to revenue_weight-based van/HGV banding when a
revenue_weight is present (real motorbikes never have one), then a
best-effort motorbike match by engine size, else None. Fixed 2026-08 after
a real Scania HGV with no type_approval and a ~13,000cc diesel engine was
wrongly matched to "Motorbike Large" purely by engine size.
"""
from __future__ import annotations

import logging
from typing import Any

from services.dataset_selector import get_scope_primary_datasets

logger = logging.getLogger(__name__)

# Car engine-size bands (cc) -- DEFRA/DESNZ convention. Diesel uses higher
# thresholds than petrol (confirmed 2026-08 against DEFRA/DESNZ methodology
# sources -- diesel engines run larger displacement for an equivalent power
# class). Every other fuel (Hybrid, PHEV, CNG, LPG, EV, Unknown) has no
# DEFRA-published cc convention, so they keep the petrol bands as the
# existing best-effort default. See module docstring for what's been
# spot-checked against real vehicles vs. still assumed.
_CAR_SIZE_BANDS_PETROL = [
    (1400, "Small car"),
    (2000, "Medium car"),
    (float("inf"), "Large car"),
]
_CAR_SIZE_BANDS_DIESEL = [
    (1700, "Small car"),
    (2000, "Medium car"),
    (float("inf"), "Large car"),
]

# Van weight bands (kg) matching the real level_3 labels in v_factor_lookup.
_VAN_WEIGHT_BANDS = [
    (1305, "Class I (up to 1.305 tonnes)"),
    (1740, "Class II (1.305 to 1.74 tonnes)"),
    (3500, "Class III (1.74 to 3.5 tonnes)"),
]

# HGV weight bands (kg) -- rigid labels; articulated variants swapped in when
# wheelplan text suggests an artic/tractor unit.
_HGV_RIGID_BANDS = [
    (7500, "Rigid (>3.5 - 7.5 tonnes)"),
    (17000, "Rigid (>7.5 tonnes-17 tonnes)"),
    (float("inf"), "Rigid (>17 tonnes)"),
]
_HGV_ARTIC_BANDS = [
    (33000, "Articulated (>3.5 - 33t)"),
    (float("inf"), "Articulated (>33t)"),
]

_MOTORBIKE_CC_BANDS = [
    (125, "Small"),
    (500, "Medium"),
    (float("inf"), "Large"),
]

_FUEL_MAP = {
    "PETROL": "Petrol",
    "DIESEL": "Diesel",
    "HYBRID ELECTRIC": "Hybrid",
    "GAS": "CNG",
    "GAS/PETROL": "Petrol",
    "GAS BI-FUEL": "Petrol",
    "LPG": "LPG",
    "LIQUID PETROLEUM GAS": "LPG",
    "COMPRESSED NATURAL GAS": "CNG",
}


def _band(value: float | None, bands: list[tuple[float, str]]) -> str | None:
    if value is None:
        return None
    for threshold, label in bands:
        if value <= threshold:
            return label
    return bands[-1][1] if bands else None


def _fuel_label(fuel_type: str | None) -> tuple[str | None, bool]:
    """Returns (level_4_fuel_label, is_electric). is_electric routes the
    lookup to the separate 'UK electricity for EVs' level_1 branch."""
    text = str(fuel_type or "").strip().upper()
    if not text:
        return None, False
    if "ELECTRIC" in text and "HYBRID" not in text:
        return "Battery Electric Vehicle", True
    return _FUEL_MAP.get(text), False


def _find_factor_row(
    con, dataset_ids: list[int], level_1: str, level_2: str, level_3: str, level_4: str | None
) -> dict[str, Any] | None:
    if not dataset_ids:
        return None
    params: list[Any] = [dataset_ids, level_1, level_2, level_3]
    level_4_clause = "AND level_4 IS NULL"
    if level_4:
        level_4_clause = "AND level_4 = %s"
        params.append(level_4)
    row = con.execute(
        f"""
        SELECT db_id, dataset_id, original_id, scope, category, report_label, uom, factor, ghg_unit
        FROM v_factor_lookup
        WHERE dataset_id = ANY(%s)
          AND level_1 = %s AND level_2 = %s AND level_3 = %s
          {level_4_clause}
        ORDER BY db_id DESC
        LIMIT 1
        """,
        params,
    ).fetchone()
    if not row:
        return None
    return {
        "factor_db_id": int(row[0]),
        "dataset_id": int(row[1]) if row[1] is not None else None,
        "original_id": row[2],
        "scope": row[3],
        "category": row[4],
        "report_label": row[5],
        "uom": row[6],
        "factor": row[7],
        "ghg_unit": row[8],
    }


def categorize_vehicle(con, job_id: int, vehicle_data: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    """Returns (resolved_factor, error_message). resolved_factor has
    factor_db_id/original_id/scope/category/report_label/uom -- the same
    shape a manual factor-search result has, so callers can feed it straight
    into the existing row-creation endpoints unchanged."""
    dataset_map = get_scope_primary_datasets(int(job_id))
    dataset_ids = sorted({d for d in dataset_map.values() if d is not None})
    if not dataset_ids:
        return None, "No active factor dataset for this job"

    type_approval = str(vehicle_data.get("type_approval") or "").strip().upper()
    fuel_label, is_electric = _fuel_label(vehicle_data.get("fuel_type"))
    level_1 = "UK electricity for EVs" if is_electric else None

    if type_approval == "M1":
        car_bands = _CAR_SIZE_BANDS_DIESEL if fuel_label == "Diesel" else _CAR_SIZE_BANDS_PETROL
        size = _band(vehicle_data.get("engine_capacity"), car_bands) or "Average car"
        fuel = fuel_label or "Unknown"
        row = _find_factor_row(
            con, dataset_ids, level_1 or "Passenger vehicles", "Cars (by size)", size, fuel
        )
        if not row and size != "Average car":
            row = _find_factor_row(
                con, dataset_ids, level_1 or "Passenger vehicles", "Cars (by size)", "Average car", fuel
            )
        if not row:
            return None, "Couldn't match this car to a known category — please search manually"
        return row, None

    if type_approval == "N1":
        weight = vehicle_data.get("revenue_weight")
        band = _band(weight, _VAN_WEIGHT_BANDS) or "Average (up to 3.5 tonnes)"
        fuel = fuel_label or "Unknown"
        row = _find_factor_row(con, dataset_ids, level_1 or "Delivery vehicles", "Vans", band, fuel)
        if not row and band != "Average (up to 3.5 tonnes)":
            row = _find_factor_row(
                con, dataset_ids, level_1 or "Delivery vehicles", "Vans", "Average (up to 3.5 tonnes)", fuel
            )
        if not row:
            return None, "Couldn't match this van to a known category — please search manually"
        return row, None

    if type_approval in ("N2", "N3"):
        weight = vehicle_data.get("revenue_weight")
        wheelplan = str(vehicle_data.get("wheelplan") or "").upper()
        is_artic = "ARTIC" in wheelplan or "TRACTOR" in wheelplan
        band = _band(weight, _HGV_ARTIC_BANDS if is_artic else _HGV_RIGID_BANDS)
        band = band or ("All artics" if is_artic else "All rigids")
        row = _find_factor_row(con, dataset_ids, "Delivery vehicles", "HGV (all diesel)", band, "Average laden")
        if not row:
            row = _find_factor_row(
                con, dataset_ids, "Delivery vehicles", "HGV (all diesel)",
                "All artics" if is_artic else "All rigids", "Average laden",
            )
        if not row:
            return None, "Couldn't match this HGV to a known category — please search manually"
        return row, None

    # Anything else (motorcycles, unrecognised type approval): DVLA VES
    # often leaves type_approval blank for HGVs, which would otherwise land
    # here and get matched to Motorbike purely by engine size -- a Scania
    # truck's ~13,000cc diesel trivially clears the "Large motorbike"
    # >500cc threshold. revenue_weight is a goods-vehicle plating figure
    # that a real motorbike never has, so its presence is a far more
    # reliable signal this is actually a van/HGV than a missing type
    # approval code -- route it through the same weight-banded logic used
    # for N1/N2/N3 instead of guessing "motorbike".
    weight = vehicle_data.get("revenue_weight")
    if weight:
        fuel = fuel_label or "Unknown"
        if weight <= 3500:
            band = _band(weight, _VAN_WEIGHT_BANDS) or "Average (up to 3.5 tonnes)"
            row = _find_factor_row(con, dataset_ids, "Delivery vehicles", "Vans", band, fuel)
            if not row and band != "Average (up to 3.5 tonnes)":
                row = _find_factor_row(
                    con, dataset_ids, "Delivery vehicles", "Vans", "Average (up to 3.5 tonnes)", fuel
                )
        else:
            wheelplan = str(vehicle_data.get("wheelplan") or "").upper()
            is_artic = "ARTIC" in wheelplan or "TRACTOR" in wheelplan
            band = _band(weight, _HGV_ARTIC_BANDS if is_artic else _HGV_RIGID_BANDS)
            band = band or ("All artics" if is_artic else "All rigids")
            row = _find_factor_row(con, dataset_ids, "Delivery vehicles", "HGV (all diesel)", band, "Average laden")
            if not row:
                row = _find_factor_row(
                    con, dataset_ids, "Delivery vehicles", "HGV (all diesel)",
                    "All artics" if is_artic else "All rigids", "Average laden",
                )
        if row:
            return row, None

    # Only genuinely attempt a motorbike match when there's no revenue_weight
    # (real motorbikes don't have one) and the engine size is within a
    # plausible motorbike range -- an implausibly large reading here is more
    # likely bad/missing DVLA data than an actual superbike.
    engine_capacity = vehicle_data.get("engine_capacity")
    if not weight and engine_capacity is not None and engine_capacity <= 2500:
        size = _band(engine_capacity, _MOTORBIKE_CC_BANDS)
        if size:
            row = _find_factor_row(con, dataset_ids, "Passenger vehicles", "Motorbike", size, None)
            if row:
                return row, None

    return None, "Couldn't determine a category for this vehicle — please search manually"
