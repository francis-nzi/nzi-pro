"""One-off backfill of lca_line_items.factor_ghg_unit for lines mapped
before the factor_ghg_unit fix (see sql_migrations/0067_lca_line_item_ghg_unit.sql
and services/lca_engine.py). Pure hygiene, not a numeric correction: every
currently-mapped line item uses a kg-denominated factor, where the bug this
column fixes is invisible either way (verified by re-running
_recalculate_assessment and confirming totals are unchanged). This just
brings existing rows in line with what new factor-mapping calls now store,
so a future edit/recompute doesn't silently lose the ghg_unit.
"""
from __future__ import annotations

from api.lca_routes import _recalculate_assessment
from core.database import get_conn

_SYSTEM_ACTOR = {"email": "system@netzero.international", "full_name": "LCA Line Item Fix"}

_SOURCE_TABLE_LOOKUP = {
    "factor_lookup": ("v_factor_lookup", "db_id"),
    "job_custom_factor": ("job_custom_factors", "factor_id"),
    "admin_custom_factor": ("custom_factors", "factor_id"),
}


def main() -> None:
    with get_conn(autocommit=False) as con:
        rows = con.execute(
            """
            SELECT line_item_id, assessment_id, mapped_factor_source, mapped_factor_id, factor_unit
            FROM lca_line_items
            WHERE mapped_factor_id IS NOT NULL AND factor_ghg_unit IS NULL
            ORDER BY line_item_id
            """
        ).fetchall()

        affected_assessments: set[int] = set()

        for line_item_id, assessment_id, mapped_factor_source, mapped_factor_id, factor_unit in rows:
            table, id_col = _SOURCE_TABLE_LOOKUP.get(str(mapped_factor_source), ("v_factor_lookup", "db_id"))
            row = con.execute(f"SELECT ghg_unit FROM {table} WHERE {id_col} = %s", [int(mapped_factor_id)]).fetchone()
            ghg_unit = str(row[0]) if row and row[0] else "kg CO2e"

            print(f"line {line_item_id} (source={mapped_factor_source}, factor_unit={factor_unit!r}): ghg_unit -> {ghg_unit!r}")
            con.execute(
                "UPDATE lca_line_items SET factor_ghg_unit = %s WHERE line_item_id = %s",
                [ghg_unit, int(line_item_id)],
            )
            affected_assessments.add(int(assessment_id))

        for assessment_id in affected_assessments:
            summary = _recalculate_assessment(con, assessment_id, _SYSTEM_ACTOR)
            print(f"assessment {assessment_id}: total_tco2e = {summary['total_tco2e']}")


if __name__ == "__main__":
    main()
