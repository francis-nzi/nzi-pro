"""Detect grid-electricity data-entry rows and resolve their paired
Scope 3 Transmission & Distribution (T&D) emission factor.

Grid electricity (Scope 2, whether metered in kWh or estimated from GBP
spend) always carries a companion Scope 3 Category 3 T&D loss factor.
This module identifies rows eligible for an auto-generated T&D pair and
looks up the matching T&D factor from ``factor_lookup`` for the same
dataset.
"""

from __future__ import annotations

from typing import Any


def detect_electricity_pair_kind(*, category: str | None, uom: str | None) -> str | None:
    """Return 'kwh' | 'spend' | None for a factor's category/uom.

    Matches only the exact purchased-grid-electricity line, not any
    electricity-adjacent category. Deliberately does not gate on
    scope=='Scope 2': the DEFRA spend-factor CSV tags its plain
    electricity spend factor as scope='Scope 3' even though it is
    conceptually Scope 2 purchased electricity, so category text is the
    only reliable signal across both source files. Also deliberately does
    not fire on "Managed assets- electricity" or "WTT- UK electricity"
    categories, which share the same level_3/uom but have no T&D pair of
    their own (or represent a different upstream stage).
    """
    cat = str(category or "").strip().lower()
    uom_norm = str(uom or "").strip().lower()

    if uom_norm == "kwh" and cat == "uk electricity":
        return "kwh"
    if uom_norm == "gbp" and cat == "electricity":
        return "spend"
    return None


def find_td_pair_factor(
    con,
    *,
    dataset_id: int,
    pair_kind: str,
    level_3: str | None,
    uom: str | None,
) -> dict[str, Any] | None:
    """Look up the single T&D factor pairing a grid-electricity factor.

    Returns None if no pair factor exists in this dataset, or if the
    match is ambiguous (more than one candidate) -- in either case it is
    safer to skip auto-pairing than to guess.
    """
    if pair_kind == "kwh":
        query = """
            SELECT db_id, original_id, factor, ghg_unit, uom, report_label,
                   category, level_1, level_2, level_3, level_4, column_text
            FROM factor_lookup
            WHERE dataset_id = %s
              AND scope = 'Scope 3'
              AND category = 'Transmission and distribution'
              AND level_3 IS NOT DISTINCT FROM %s
              AND uom IS NOT DISTINCT FROM %s
            ORDER BY db_id ASC
            LIMIT 2
        """
        params: list[Any] = [int(dataset_id), level_3, uom]
    elif pair_kind == "spend":
        query = """
            SELECT db_id, original_id, factor, ghg_unit, uom, report_label,
                   category, level_1, level_2, level_3, level_4, column_text
            FROM factor_lookup
            WHERE dataset_id = %s
              AND scope = 'Scope 3'
              AND TRIM(category) = 'Electricity, transmission and distribution'
            ORDER BY db_id ASC
            LIMIT 2
        """
        params = [int(dataset_id)]
    else:
        return None

    try:
        rows = con.execute(query, params).fetchall()
    except Exception:
        return None

    if len(rows) != 1:
        return None

    (db_id, original_id, factor, ghg_unit, uom_val, report_label,
     category, level_1, level_2, level_3_val, level_4, column_text) = rows[0]

    return {
        "db_id": int(db_id) if db_id is not None else None,
        "original_id": str(original_id).strip() if original_id is not None else None,
        "factor": float(factor) if factor is not None else None,
        "ghg_unit": str(ghg_unit).strip() if ghg_unit is not None else None,
        "uom": str(uom_val).strip() if uom_val is not None else None,
        "report_label": str(report_label).strip() if report_label is not None else None,
        "category": str(category).strip() if category is not None else None,
        "level_1": str(level_1).strip() if level_1 is not None else None,
        "level_2": str(level_2).strip() if level_2 is not None else None,
        "level_3": str(level_3_val).strip() if level_3_val is not None else None,
        "level_4": str(level_4).strip() if level_4 is not None else None,
        "column_text": str(column_text).strip() if column_text is not None else None,
    }


def resolve_td_pair_for_new_row(
    con,
    *,
    dataset_id: int | None,
    category: str | None,
    level_3: str | None,
    uom: str | None,
) -> dict[str, Any] | None:
    """Single entrypoint: detect + look up a T&D pair for a new row.

    Returns None when the row is not grid electricity, when no dataset_id
    is available to search within, or when no unambiguous pair factor is
    found.
    """
    if dataset_id is None:
        return None
    pair_kind = detect_electricity_pair_kind(category=category, uom=uom)
    if pair_kind is None:
        return None
    pair = find_td_pair_factor(con, dataset_id=dataset_id, pair_kind=pair_kind, level_3=level_3, uom=uom)
    if pair is not None:
        pair["auto_pair_kind"] = f"td_electricity_{pair_kind}"
    return pair
