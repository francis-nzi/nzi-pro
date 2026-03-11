from __future__ import annotations

from dataclasses import dataclass
from typing import Any


STAGE_KEYS = ("materials", "manufacturing", "logistics", "use_end_of_life")


@dataclass
class LcaItemResult:
    item_id: int
    stage_key: str
    item_name: str
    quantity: float
    factor_value: float
    factor_unit: str
    emissions_tco2e: float
    is_gap_filled: bool
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
    unit = str(factor_unit or "").strip().lower()
    if "tco2e" in unit or "tonne" in unit:
        return 1.0
    # default to kgCO2e-style factors
    return 0.001


def compute_item_emissions_tco2e(
    quantity: float,
    factor_value: float,
    factor_unit: str | None,
    allocation_pct: float = 100.0,
) -> float:
    raw = max(quantity, 0.0) * max(factor_value, 0.0)
    raw *= max(min(allocation_pct, 100.0), 0.0) / 100.0
    return raw * factor_unit_to_tonnes_multiplier(factor_unit)


def summarize_items(items: list[dict[str, Any]]) -> dict[str, Any]:
    stage_totals = {key: 0.0 for key in STAGE_KEYS}
    result_items: list[LcaItemResult] = []
    total = 0.0

    for row in items:
        stage = str(row.get("stage_key") or "").strip().lower()
        if stage not in stage_totals:
            stage = "materials"
        qty = safe_float(row.get("quantity"))
        factor = safe_float(row.get("factor_value"))
        allocation = safe_float(row.get("allocation_pct"), 100.0)
        emissions = compute_item_emissions_tco2e(
            quantity=qty,
            factor_value=factor,
            factor_unit=str(row.get("factor_unit") or "kgCO2e/unit"),
            allocation_pct=allocation,
        )
        stage_totals[stage] += emissions
        total += emissions
        result_items.append(
            LcaItemResult(
                item_id=int(row.get("item_id") or 0),
                stage_key=stage,
                item_name=str(row.get("item_name") or "Unnamed item"),
                quantity=qty,
                factor_value=factor,
                factor_unit=str(row.get("factor_unit") or "kgCO2e/unit"),
                emissions_tco2e=emissions,
                is_gap_filled=bool(row.get("is_gap_filled") or False),
                data_quality=str(row.get("data_quality") or "secondary"),
            )
        )

    hotspot_items = sorted(result_items, key=lambda x: x.emissions_tco2e, reverse=True)[:10]

    stage_breakdown = []
    for stage_key in STAGE_KEYS:
        emissions = stage_totals[stage_key]
        stage_breakdown.append(
            {
                "stage_key": stage_key,
                "emissions_tco2e": round(emissions, 6),
                "share_pct": round((emissions / total * 100.0) if total > 0 else 0.0, 2),
            }
        )

    return {
        "total_tco2e": round(total, 6),
        "stage_breakdown": stage_breakdown,
        "hotspots": [
            {
                "item_id": x.item_id,
                "stage_key": x.stage_key,
                "item_name": x.item_name,
                "emissions_tco2e": round(x.emissions_tco2e, 6),
                "factor_value": x.factor_value,
                "factor_unit": x.factor_unit,
                "is_gap_filled": x.is_gap_filled,
                "data_quality": x.data_quality,
            }
            for x in hotspot_items
        ],
        "items_count": len(result_items),
    }
