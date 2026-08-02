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


def resolve_line_emissions_tco2e(row: dict[str, Any]) -> float:
    """A transport-module line item (A2/A4/C2) with legs has its emissions
    driven by services.lca_transport's per-leg mass x distance x factor
    calc, cached on transport_emissions_tco2e -- quantity x factor_value
    doesn't apply to it (there's no single line-level factor once a journey
    has multiple legs, each with its own mode/distance/factor). Every other
    line falls back to the original quantity x factor_value path unchanged.
    Both summarize_assessment and the line-items API response go through
    this so a row's displayed figure and the assessment total always agree.
    """
    transport_emissions = row.get("transport_emissions_tco2e")
    if transport_emissions is not None:
        return safe_float(transport_emissions)
    return compute_line_emissions_tco2e(
        safe_float(row.get("quantity")), safe_float(row.get("factor_value")), row.get("factor_unit"),
    )


def apply_scenario_multipliers(
    lines: list[dict[str, Any]],
    multiplier_rules: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Scale each line's factor_value by its scenario's "more specific wins" rule.

    For a line's module_code, the best matching rule is: a component_id
    match (product lines) or activity_id match (service lines) -- if the
    line has one --, else a material_category_id match (product lines
    only; service lines have no separate category-within-module level,
    since the Scope 3 category *is* the module for services), else a
    module-wide rule (component_id/activity_id/material_category_id all
    NULL on the rule), else no match -- multiplier 1.0 (baseline,
    unaffected). Scaling factor_value (rather than the final emissions
    number) keeps this a pure pre-processing step ahead of the
    already-verified summarize_assessment, which is left completely
    untouched.
    """
    by_module: dict[str, list[dict[str, Any]]] = {}
    for rule in multiplier_rules:
        by_module.setdefault(str(rule.get("module_code") or ""), []).append(rule)

    adjusted: list[dict[str, Any]] = []
    for line in lines:
        rules = by_module.get(str(line.get("module_code") or ""), [])
        multiplier = 1.0
        component_id = line.get("component_id")
        activity_id = line.get("activity_id")
        category_id = line.get("material_category_id")

        component_rule = next((r for r in rules if component_id is not None and r.get("component_id") == component_id), None)
        activity_rule = next((r for r in rules if activity_id is not None and r.get("activity_id") == activity_id), None)
        category_rule = next((r for r in rules if category_id is not None and r.get("component_id") is None and r.get("activity_id") is None and r.get("material_category_id") == category_id), None)
        module_rule = next((r for r in rules if r.get("component_id") is None and r.get("activity_id") is None and r.get("material_category_id") is None), None)
        matched = component_rule or activity_rule or category_rule or module_rule
        if matched is not None:
            multiplier = safe_float(matched.get("multiplier"), 1.0)

        new_line = dict(line)
        new_line["factor_value"] = safe_float(line.get("factor_value")) * multiplier
        adjusted.append(new_line)
    return adjusted


def summarize_assessment(
    lines: list[dict[str, Any]],
    confirmed_quantity: float | None,
    confirmed_quantity_unit: str | None,
    assessment_type: str = "product",
) -> dict[str, Any]:
    """Pure aggregation over an assessment's line items.

    Placeholder rows (assembly-grouping labels with no real weight/factor,
    matching the real-world convention of flattening a multi-level BOM
    export) are excluded from every calculation below but still counted
    separately so the API layer can report them for data-quality purposes.

    mass_reconciliation genuinely doesn't apply to service assessments
    (activity x quantity, not material x mass) -- it's None rather than a
    computed dict when assessment_type == "service", so every consumer
    (recalculate, frontend Impact panel, report template) has one branch
    point ("is this None?") instead of several.
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
        emissions = resolve_line_emissions_tco2e(row)

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
    mass_reconciliation = (
        None
        if assessment_type == "service"
        else {
            "confirmed_quantity": confirmed_qty,
            "confirmed_quantity_unit": str(confirmed_quantity_unit or "kg"),
            "captured_mass_kg": round(captured_mass, 6),
            "mass_gap_kg": round(mass_gap, 6) if mass_gap is not None else None,
        }
    )

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
        "mass_reconciliation": mass_reconciliation,
        "items_count": len(line_results),
        "placeholder_count": placeholder_count,
        "gap_filled_count": gap_filled_count,
    }


# (key, label, weight out of 100)
READINESS_CHECKS: list[tuple[str, str, float]] = [
    ("mass_balance", "Mass balance within tolerance", 25.0),
    ("line_coverage", "Lines with real quantities", 15.0),
    ("category_coverage", "Lines with a material category", 15.0),
    ("factor_confidence", "Lines with a trustworthy factor", 30.0),
    ("module_coverage", "Included modules with data", 15.0),
]

# Service assessments have no mass concept -- the mass_balance weight (25)
# is redistributed proportionally across the remaining 4 checks so they
# still sum to 100 (each old weight * 100/75).
SERVICE_READINESS_CHECKS: list[tuple[str, str, float]] = [
    ("line_coverage", "Lines with real quantities", 20.0),
    ("category_coverage", "Lines linked to a library activity", 20.0),
    ("factor_confidence", "Lines with a trustworthy factor", 40.0),
    ("module_coverage", "Scope 3 categories with data", 20.0),
]


def _readiness_status_label(score: float) -> str:
    if score < 40:
        return "Draft — significant gaps"
    if score < 70:
        return "Developing"
    if score < 90:
        return "Good — minor gaps"
    return "Verified-ready"


def compute_readiness(
    lines: list[dict[str, Any]],
    summary: dict[str, Any],
    included_modules: list[str],
    confidence_threshold: float,
    assessment_type: str = "product",
) -> dict[str, Any]:
    """Weighted, advisory readiness/data-quality score (0-100).

    Mirrors the real Britannia Fire "Readiness Tracker" pattern -- mass
    balance, % of lines with real weights, factors sourced, modules
    covered -- as a signal of how defensible an assessment currently is.
    This is informational only: it never gates or overrides the
    user-controlled `review_status` field on lca_assessments.

    Service assessments (assessment_type="service") drop the mass-balance
    check (mass doesn't apply to activity x quantity) and use activity_id
    presence instead of material_category_id for the "category" coverage
    check -- see SERVICE_READINESS_CHECKS.
    """
    is_service = assessment_type == "service"
    non_placeholder = [row for row in lines if not row.get("is_placeholder")]
    total_lines = len(lines)
    non_placeholder_count = len(non_placeholder)

    sub_scores: dict[str, float] = {}
    details: dict[str, str] = {}

    if not is_service:
        mass = summary.get("mass_reconciliation") or {}
        confirmed_quantity = mass.get("confirmed_quantity")
        mass_gap = mass.get("mass_gap_kg")
        if not confirmed_quantity:
            sub_scores["mass_balance"] = 0.0
            details["mass_balance"] = "Confirmed quantity not set"
        else:
            gap_ratio = abs(safe_float(mass_gap)) / confirmed_quantity
            sub_scores["mass_balance"] = max(0.0, min(1.0, 1.0 - gap_ratio))
            details["mass_balance"] = f"{mass.get('captured_mass_kg', 0)}kg captured vs {confirmed_quantity}kg confirmed"

    if total_lines == 0:
        sub_scores["line_coverage"] = 0.0
        details["line_coverage"] = "No line items yet"
    else:
        sub_scores["line_coverage"] = non_placeholder_count / total_lines
        details["line_coverage"] = f"{non_placeholder_count}/{total_lines} lines have real quantities"

    if non_placeholder_count == 0:
        sub_scores["category_coverage"] = 0.0
        sub_scores["factor_confidence"] = 0.0
        details["category_coverage"] = "No categorized lines yet" if not is_service else "No lines linked to a library activity yet"
        details["factor_confidence"] = "No mapped lines yet"
    else:
        if is_service:
            categorized = sum(1 for row in non_placeholder if row.get("activity_id") is not None)
            sub_scores["category_coverage"] = categorized / non_placeholder_count
            details["category_coverage"] = f"{categorized}/{non_placeholder_count} lines linked to a library activity"
        else:
            categorized = sum(1 for row in non_placeholder if row.get("material_category_id") is not None)
            sub_scores["category_coverage"] = categorized / non_placeholder_count
            details["category_coverage"] = f"{categorized}/{non_placeholder_count} lines categorized"

        trustworthy = 0
        for row in non_placeholder:
            source = row.get("mapped_factor_source")
            if not source:
                continue
            if source != "factor_lookup":
                trustworthy += 1
                continue
            confidence = row.get("factor_match_confidence")
            if confidence is None or safe_float(confidence) >= confidence_threshold:
                trustworthy += 1
        sub_scores["factor_confidence"] = trustworthy / non_placeholder_count
        details["factor_confidence"] = f"{trustworthy}/{non_placeholder_count} lines have a trustworthy factor"

    modules_in_scope = [m for m in (included_modules or []) if m]
    if not modules_in_scope:
        sub_scores["module_coverage"] = 0.0
        details["module_coverage"] = "No modules in scope" if not is_service else "No Scope 3 categories in scope"
    else:
        modules_with_data = {row.get("module_code") for row in non_placeholder if row.get("module_code")}
        covered = sum(1 for m in modules_in_scope if m in modules_with_data)
        sub_scores["module_coverage"] = covered / len(modules_in_scope)
        noun = "in-scope Scope 3 categories" if is_service else "in-scope modules"
        details["module_coverage"] = f"{covered}/{len(modules_in_scope)} {noun} have data"

    checks = []
    total_score = 0.0
    for key, label, weight in (SERVICE_READINESS_CHECKS if is_service else READINESS_CHECKS):
        sub = sub_scores.get(key, 0.0)
        points = round(sub * weight, 2)
        total_score += points
        checks.append(
            {
                "key": key,
                "label": label,
                "weight": weight,
                "sub_score": round(sub, 4),
                "points": points,
                "detail": details.get(key, ""),
            }
        )

    return {
        "score": round(total_score, 1),
        "status_label": _readiness_status_label(total_score),
        "checks": checks,
    }
