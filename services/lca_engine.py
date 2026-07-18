from __future__ import annotations

from dataclasses import dataclass
from typing import Any

# Module whose quantity represents the product's raw-material mass, used
# for the confirmed-vs-captured mass reconciliation. A1 = raw material
# supply in both EN 15804 and ISO 14067 usage.
MASS_RECONCILIATION_MODULE = "A1"


@dataclass
class LcaLineResult:
    line_item_id: int
    module_code: str
    line_label: str
    material_category_id: int | None
    quantity: float
    unit: str
    factor_value: float
    factor_unit: str
    emissions_tco2e: float
    is_gap_filled: bool
    is_placeholder: bool
    data_quality: str


def safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        text = str(value).strip()
        if not text:
            return default
        return float(text)
    except Exception:
        return default


def factor_unit_to_tonnes_multiplier(factor_unit: str | None) -> float:
    """Convert a factor's emissions unit to a tCO2e multiplier.

    Only the numerator (before the first "/") indicates the emissions
    unit -- e.g. "kgCO2e/tonne-km" is still a kg-denominated factor even
    though "tonne" appears in the denominator, so a naive whole-string
    substring check would misclassify it.
    """
    unit = str(factor_unit or "").strip().lower()
    numerator = unit.split("/", 1)[0] if "/" in unit else unit
    if "tco2e" in numerator or "tonne" in numerator:
        return 1.0
    if "gco2e" in numerator and "kg" not in numerator:
        return 0.000001
    # default: kgCO2e-style factors (also the fallback for unrecognized units)
    return 0.001


def compute_line_emissions_tco2e(quantity: float, factor_value: float, factor_unit: str | None) -> float:
    raw = max(quantity, 0.0) * max(factor_value, 0.0)
    return raw * factor_unit_to_tonnes_multiplier(factor_unit)


def summarize_assessment(
    lines: list[dict[str, Any]],
    confirmed_quantity: float | None,
    confirmed_quantity_unit: str | None,
) -> dict[str, Any]:
    """Pure aggregation over an assessment's line items.

    Placeholder rows (assembly-grouping labels with no real weight/factor,
    matching the real-world convention of flattening a multi-level BOM
    export) are excluded from every calculation below but still counted
    separately so the API layer can report them for data-quality purposes.
    """
    module_totals: dict[str, float] = {}
    category_totals: dict[int, dict[str, float]] = {}
    line_results: list[LcaLineResult] = []
    total = 0.0
    placeholder_count = 0
    gap_filled_count = 0
    captured_mass = 0.0

    for row in lines:
        is_placeholder = bool(row.get("is_placeholder") or False)
        if is_placeholder:
            placeholder_count += 1
            continue

        module_code = str(row.get("module_code") or "").strip().upper()
        qty = safe_float(row.get("quantity"))
        factor = safe_float(row.get("factor_value"))
        factor_unit = str(row.get("factor_unit") or "kgCO2e/kg")
        emissions = compute_line_emissions_tco2e(qty, factor, factor_unit)

        module_totals[module_code] = module_totals.get(module_code, 0.0) + emissions
        total += emissions

        category_id = row.get("material_category_id")
        if category_id is not None:
            cid = int(category_id)
            bucket = category_totals.setdefault(cid, {"mass": 0.0, "emissions": 0.0})
            bucket["emissions"] += emissions
            unit = str(row.get("unit") or "").strip().lower()
            if unit in ("kg", "kilogram", "kilograms"):
                bucket["mass"] += qty

        if module_code == MASS_RECONCILIATION_MODULE:
            unit = str(row.get("unit") or "").strip().lower()
            if unit in ("kg", "kilogram", "kilograms"):
                captured_mass += qty

        is_gap_filled = bool(row.get("is_gap_filled") or False)
        if is_gap_filled:
            gap_filled_count += 1

        line_results.append(
            LcaLineResult(
                line_item_id=int(row.get("line_item_id") or 0),
                module_code=module_code,
                line_label=str(row.get("line_label") or "Unnamed line"),
                material_category_id=int(category_id) if category_id is not None else None,
                quantity=qty,
                unit=str(row.get("unit") or ""),
                factor_value=factor,
                factor_unit=factor_unit,
                emissions_tco2e=emissions,
                is_gap_filled=is_gap_filled,
                is_placeholder=False,
                data_quality=str(row.get("data_quality") or "secondary"),
            )
        )

    module_breakdown = [
        {
            "module_code": module_code,
            "emissions_tco2e": round(emissions, 6),
            "share_pct": round((emissions / total * 100.0) if total > 0 else 0.0, 2),
        }
        for module_code, emissions in sorted(module_totals.items(), key=lambda kv: kv[1], reverse=True)
    ]

    category_breakdown = [
        {
            "material_category_id": cid,
            "mass_kg": round(bucket["mass"], 6),
            "emissions_tco2e": round(bucket["emissions"], 6),
            "share_pct": round((bucket["emissions"] / total * 100.0) if total > 0 else 0.0, 2),
        }
        for cid, bucket in sorted(category_totals.items(), key=lambda kv: kv[1]["emissions"], reverse=True)
    ]

    hotspot_items = sorted(line_results, key=lambda x: x.emissions_tco2e, reverse=True)[:10]

    confirmed_qty = safe_float(confirmed_quantity, 0.0) if confirmed_quantity is not None else None
    mass_gap = (confirmed_qty - captured_mass) if confirmed_qty is not None else None

    return {
        "total_tco2e": round(total, 6),
        "module_breakdown": module_breakdown,
        "category_breakdown": category_breakdown,
        "hotspots": [
            {
                "line_item_id": x.line_item_id,
                "module_code": x.module_code,
                "line_label": x.line_label,
                "material_category_id": x.material_category_id,
                "emissions_tco2e": round(x.emissions_tco2e, 6),
                "factor_value": x.factor_value,
                "factor_unit": x.factor_unit,
                "is_gap_filled": x.is_gap_filled,
                "data_quality": x.data_quality,
            }
            for x in hotspot_items
        ],
        "mass_reconciliation": {
            "confirmed_quantity": confirmed_qty,
            "confirmed_quantity_unit": str(confirmed_quantity_unit or "kg"),
            "captured_mass_kg": round(captured_mass, 6),
            "mass_gap_kg": round(mass_gap, 6) if mass_gap is not None else None,
        },
        "items_count": len(line_results),
        "placeholder_count": placeholder_count,
        "gap_filled_count": gap_filled_count,
    }
