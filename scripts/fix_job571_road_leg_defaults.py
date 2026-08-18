"""One-off: re-point job 571's road transport legs (currently on
"Delivery Vehicles" per-vehicle-km/mile factors, each with its own laden
state -- 50%/100%/Average) onto the single curated tonne.km default
"Freighting Goods: HGV (All Diesel) All HGVs Average Laden"
(original_id=27_304_3140_14_1). Collapsing the laden-state variation onto
one default is the point of the curated list (see
services/lca_transport.py FREIGHT_DEFAULT_FACTORS) -- this is a one-time
migration for the legs that predate that list existing.
"""
from __future__ import annotations

from api.lca_routes import _recalculate_assessment, _recompute_line_transport_emissions, _resolve_dataset_ids
from core.database import get_conn
from services.lca_transport import compute_leg_emissions_tco2e

_SYSTEM_ACTOR = {"email": "system@netzero.international", "full_name": "LCA Freight Default Fix"}
_ROAD_DEFAULT_ORIGINAL_ID = "27_304_3140_14_1"


def main() -> None:
    with get_conn(autocommit=False) as con:
        legs = con.execute(
            """
            SELECT t.leg_id, t.line_item_id, t.distance_km, li.quantity, li.unit, li.assessment_id, la.job_id
            FROM lca_transport_legs t
            JOIN lca_line_items li ON li.line_item_id = t.line_item_id
            JOIN lca_assessments la ON la.assessment_id = li.assessment_id
            -- Structural match, not label text: any road leg mapped to a
            -- non-tonne.km factor (a per-vehicle-km/mile "Delivery Vehicles"
            -- factor, whatever its stored label format happens to be) is a
            -- pre-curated-default leg that needs re-pointing.
            WHERE t.mode = 'road' AND t.mapped_factor_id IS NOT NULL
              AND lower(COALESCE(t.factor_unit, '')) IN ('km', 'miles')
            ORDER BY t.leg_id
            """
        ).fetchall()
        if not legs:
            print("No legs found on a 'Delivery Vehicles' road factor -- nothing to do.")
            return

        affected_line_items: set[int] = set()
        affected_assessments: set[int] = set()

        for leg_id, line_item_id, distance_km, quantity, unit, assessment_id, job_id in legs:
            dataset_ids = _resolve_dataset_ids(con, int(job_id), int(assessment_id))
            row = con.execute(
                "SELECT db_id, report_label, uom, ghg_unit, factor FROM v_factor_lookup "
                "WHERE original_id = %s AND dataset_id = ANY(%s) ORDER BY dataset_id DESC LIMIT 1",
                [_ROAD_DEFAULT_ORIGINAL_ID, dataset_ids],
            ).fetchone()
            if not row:
                print(f"leg {leg_id}: couldn't resolve the road default in job {job_id}'s dataset(s) {dataset_ids} -- skipped")
                continue
            db_id, report_label, uom, ghg_unit, factor_value = row

            mass_kg = quantity if str(unit or "").strip().lower() in ("kg", "kilogram", "kilograms") else 0.0
            new_emissions = compute_leg_emissions_tco2e(mass_kg, distance_km, float(factor_value), uom, ghg_unit)

            old = con.execute(
                "SELECT factor_source_label, factor_value, factor_unit, emissions_tco2e FROM lca_transport_legs WHERE leg_id = %s",
                [leg_id],
            ).fetchone()
            print(f"leg {leg_id}: {old[0]!r} ({old[1]} {old[2]}, {old[3]} tCO2e) -> {report_label!r} ({factor_value} {uom}, {new_emissions} tCO2e)")

            con.execute(
                """
                UPDATE lca_transport_legs
                SET mapped_factor_id = %s, factor_value = %s, factor_unit = %s, factor_ghg_unit = %s,
                    factor_source_label = %s, emissions_tco2e = %s, updated_at = NOW(), updated_by = %s
                WHERE leg_id = %s
                """,
                [db_id, float(factor_value), uom, ghg_unit, report_label, new_emissions, _SYSTEM_ACTOR["email"], leg_id],
            )
            affected_line_items.add(int(line_item_id))
            affected_assessments.add(int(assessment_id))

        for line_item_id in affected_line_items:
            _recompute_line_transport_emissions(con, line_item_id)

        for assessment_id in affected_assessments:
            summary = _recalculate_assessment(con, assessment_id, _SYSTEM_ACTOR)
            print(f"assessment {assessment_id}: total_tco2e = {summary['total_tco2e']}")


if __name__ == "__main__":
    main()
