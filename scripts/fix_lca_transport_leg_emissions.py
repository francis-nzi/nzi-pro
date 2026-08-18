"""One-off recompute of lca_transport_legs.emissions_tco2e for legs created
before the factor_ghg_unit fix (see sql_migrations/0066_lca_transport_leg_ghg_unit.sql
and services/lca_transport.py). Backfills factor_ghg_unit by looking up each
leg's mapped_factor_id against v_factor_lookup, then job_custom_factors, then
custom_factors, defaulting to "kg CO2e" if none match. Idempotent -- rerunning
after the code fix recomputes the same (already-correct) values.
"""
from __future__ import annotations

from api.lca_routes import _recalculate_assessment, _recompute_line_transport_emissions
from core.database import get_conn
from services.lca_transport import compute_leg_emissions_tco2e

_SYSTEM_ACTOR = {"email": "system@netzero.international", "full_name": "LCA Transport Fix"}


def _resolve_ghg_unit(con, mapped_factor_id: int | None) -> str:
    if mapped_factor_id is None:
        return "kg CO2e"
    row = con.execute("SELECT ghg_unit FROM v_factor_lookup WHERE db_id = %s", [int(mapped_factor_id)]).fetchone()
    if row and row[0]:
        return str(row[0])
    row = con.execute("SELECT ghg_unit FROM job_custom_factors WHERE factor_id = %s", [int(mapped_factor_id)]).fetchone()
    if row and row[0]:
        return str(row[0])
    row = con.execute("SELECT ghg_unit FROM custom_factors WHERE factor_id = %s", [int(mapped_factor_id)]).fetchone()
    if row and row[0]:
        return str(row[0])
    return "kg CO2e"


def main() -> None:
    with get_conn(autocommit=False) as con:
        legs = con.execute(
            """
            SELECT t.leg_id, t.line_item_id, t.distance_km, t.factor_value, t.factor_unit,
                   t.mapped_factor_id, t.emissions_tco2e AS old_emissions, li.quantity, li.unit
            FROM lca_transport_legs t
            JOIN lca_line_items li ON li.line_item_id = t.line_item_id
            ORDER BY t.leg_id
            """
        ).fetchall()

        affected_line_items: set[int] = set()
        affected_assessments: set[int] = set()

        for (
            leg_id, line_item_id, distance_km, factor_value, factor_unit,
            mapped_factor_id, old_emissions, quantity, unit,
        ) in legs:
            if factor_value is None:
                continue

            ghg_unit = _resolve_ghg_unit(con, mapped_factor_id)
            mass_kg = quantity if str(unit or "").strip().lower() in ("kg", "kilogram", "kilograms") else 0.0
            new_emissions = compute_leg_emissions_tco2e(mass_kg, distance_km, factor_value, factor_unit, ghg_unit)

            print(
                f"leg {leg_id} (line {line_item_id}, {factor_unit!r}, ghg_unit={ghg_unit!r}): "
                f"{old_emissions} -> {new_emissions} tCO2e"
            )

            con.execute(
                "UPDATE lca_transport_legs SET factor_ghg_unit = %s, emissions_tco2e = %s WHERE leg_id = %s",
                [ghg_unit, new_emissions, int(leg_id)],
            )
            affected_line_items.add(int(line_item_id))

        for line_item_id in affected_line_items:
            _recompute_line_transport_emissions(con, line_item_id)
            assessment_id = con.execute(
                "SELECT assessment_id FROM lca_line_items WHERE line_item_id = %s", [line_item_id]
            ).fetchone()[0]
            affected_assessments.add(int(assessment_id))

        for assessment_id in affected_assessments:
            summary = _recalculate_assessment(con, assessment_id, _SYSTEM_ACTOR)
            print(f"assessment {assessment_id}: total_tco2e = {summary['total_tco2e']}")


if __name__ == "__main__":
    main()
