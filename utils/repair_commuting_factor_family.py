"""Re-points Employee Commuting rows that were saved against a Company
Vehicles factor onto the equivalent Employee Commuting factor.

Before the 2026-09 fix in services/vehicle_categorization.py, a commuting
"I drive my own car" registration lookup resolved into the Company Vehicles
factor family. The row itself was stored correctly (scope 'Scope 3',
category 'Employee Commuting'), but every downstream category resolution
prefers the *factor's* lookup category over the stored one, so those
entries reported as Company Vehicles -- on Data Entry via the consolidated
rows and in every report category breakdown.

The commuting family carries the same level_2/level_3/level_4 shape, so the
repair is a level_1 swap holding size, fuel and unit constant -- exactly
what the fixed categorizer now resolves for the same vehicle. Factor values
differ slightly between the two families, so calc_tco2e is recomputed and
the consolidated job_scope_rows are regenerated.

Rows are selected up front and updated by source_id: the scoping predicate
is factor_db_id, which is also what gets written, so re-reading it mid-run
would silently change the working set.

Usage:
    python -m utils.repair_commuting_factor_family                # dry run, all jobs
    python -m utils.repair_commuting_factor_family --apply
    python -m utils.repair_commuting_factor_family --job 217 --apply
    python -m utils.repair_commuting_factor_family --include-disabled --apply
"""
from __future__ import annotations

import argparse
import os
import sys

import psycopg

COMMUTING_LEVEL_1 = "Employee commuting- land"


def _load_candidates(cur, job_ids: list[int], include_disabled: bool) -> list[dict]:
    job_clause = "AND s.job_id = ANY(%s)" if job_ids else ""
    # Disabled rows are superseded submissions kept as history and count
    # towards nothing, so they are left as they were submitted by default.
    enabled_clause = "" if include_disabled else "AND COALESCE(s.enabled, TRUE) = TRUE"
    params: list = []
    if job_ids:
        params.append(job_ids)
    cur.execute(
        f"""
        SELECT s.source_id, s.job_id, j.job_number, s.source_name, s.employee_name,
               s.qty, s.uom, s.factor, s.ghg_unit, s.apply_pct, s.calc_tco2e,
               s.enabled, s.notes, s.dataset_id, s.factor_db_id,
               fl.level_2, fl.level_3, fl.level_4, fl.report_label
        FROM job_emission_sources s
        JOIN jobs j ON j.job_id = s.job_id
        JOIN v_factor_lookup fl ON fl.db_id = s.factor_db_id
        WHERE s.source_type = 'employee_commuting'
          AND fl.category IS DISTINCT FROM 'Employee Commuting'
          {enabled_clause}
          {job_clause}
        ORDER BY s.job_id, s.source_id
        """,
        params,
    )
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def _find_commuting_equivalent(cur, row: dict) -> dict | None:
    """Same size/fuel, same unit, commuting family. Falls back to the km/miles
    sibling only if the row's own unit has no commuting row."""
    level_4 = row["level_4"]
    level_4_clause = "AND level_4 = %s" if level_4 else "AND level_4 IS NULL"
    params: list = [row["dataset_id"], COMMUTING_LEVEL_1, row["level_2"], row["level_3"]]
    if level_4:
        params.append(level_4)
    params.append(row["uom"] or "miles")
    cur.execute(
        f"""
        SELECT db_id, dataset_id, original_id, report_label, uom, factor, ghg_unit
        FROM v_factor_lookup
        WHERE dataset_id = %s
          AND level_1 = %s AND level_2 = %s AND level_3 = %s
          {level_4_clause}
        ORDER BY CASE WHEN LOWER(TRIM(uom)) = LOWER(%s) THEN 0 ELSE 1 END, db_id DESC
        LIMIT 1
        """,
        params,
    )
    found = cur.fetchone()
    if not found:
        return None
    cols = ["factor_db_id", "dataset_id", "original_id", "report_label", "uom", "factor", "ghg_unit"]
    return dict(zip(cols, found))


def _calc_tco2e(quantity, factor, apply_pct, ghg_unit) -> float:
    """Mirrors _calc_commuting_tco2e in api/employee_commuting_routes.py."""
    value = float(quantity or 0.0) * float(factor or 0.0) * (float(apply_pct or 100.0) / 100.0)
    if "kg" in str(ghg_unit or "kgCO2e").lower():
        value /= 1000.0
    return float(value)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--job", action="append", type=int, default=[], help="Limit to these job ids")
    parser.add_argument("--apply", action="store_true", help="Write changes (default is a dry run)")
    parser.add_argument(
        "--include-disabled",
        action="store_true",
        help="Also repair superseded (disabled) rows, which count towards nothing",
    )
    args = parser.parse_args()

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is not set")

    with psycopg.connect(database_url) as con:
        cur = con.cursor()
        candidates = _load_candidates(cur, args.job, args.include_disabled)
        if not candidates:
            print("Nothing to repair.")
            return 0

        planned: list[tuple[dict, dict, float]] = []
        skipped: list[dict] = []
        for row in candidates:
            target = _find_commuting_equivalent(cur, row)
            if not target:
                skipped.append(row)
                continue
            new_tco2e = _calc_tco2e(row["qty"], target["factor"], row["apply_pct"], target["ghg_unit"])
            planned.append((row, target, new_tco2e))

        delta = 0.0
        print(f"{'APPLY' if args.apply else 'DRY RUN'} -- {len(planned)} row(s) to repair\n")
        for row, target, new_tco2e in planned:
            old_tco2e = float(row["calc_tco2e"] or 0.0)
            delta += new_tco2e - old_tco2e
            state = "" if row["enabled"] else "  [disabled]"
            print(f"  job {row['job_id']} ({row['job_number']}) source {row['source_id']}{state}")
            print(f"    {row['report_label']}  ->  {target['report_label']}")
            print(
                f"    {row['qty']} {row['uom']} | factor {row['factor']} -> {target['factor']}"
                f" | tCO2e {old_tco2e:.6f} -> {new_tco2e:.6f}"
            )
        if skipped:
            print(f"\n  {len(skipped)} row(s) had no commuting equivalent and were left alone:")
            for row in skipped:
                print(f"    job {row['job_id']} source {row['source_id']}: {row['report_label']}")
        print(f"\n  net change across all listed rows: {delta:+.6f} tCO2e")

        if not args.apply:
            print("\nDry run -- nothing written. Re-run with --apply.")
            return 0

        for row, target, new_tco2e in planned:
            source_name = row["source_name"] or ""
            if row["report_label"] and row["report_label"] in source_name:
                source_name = source_name.replace(row["report_label"], target["report_label"])
            notes = row["notes"] or ""
            correction = f"Factor recategorised to the Employee Commuting family (was {row['report_label']})"
            notes = f"{notes} — {correction}" if notes else correction
            cur.execute(
                """
                UPDATE job_emission_sources
                SET factor_db_id = %s, dataset_id = %s, original_id = %s,
                    factor = %s, uom = %s, ghg_unit = %s, calc_tco2e = %s,
                    source_name = %s, notes = %s, updated_at = NOW()
                WHERE source_id = %s
                """,
                [
                    target["factor_db_id"], target["dataset_id"], target["original_id"],
                    target["factor"], target["uom"], target["ghg_unit"], new_tco2e,
                    source_name, notes, row["source_id"],
                ],
            )

        # Regenerate the consolidated Data Entry rows for every touched job.
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from services.employee_commuting_consolidation import sync_commuting_scope_rows

        for job_id in sorted({row["job_id"] for row, _t, _v in planned}):
            sync_commuting_scope_rows(con, job_id)
            print(f"  re-consolidated job {job_id}")

        con.commit()
        print(f"\nDone -- {len(planned)} row(s) repaired.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
