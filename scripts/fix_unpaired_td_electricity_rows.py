"""One-off: pair the grid-electricity rows that auto-pairing should have
covered but didn't, because of two defects now fixed on main.

  * Portal-submitted rows (0fc60393) never paired at all: the portal stored
    level_1/level_2 as NULL and the electricity detection keys off exactly
    those, and nothing called the pairing on the portal path anyway.

  * CRM rows lost an existing pair to the site-change cascade (1be223cc).
    update_scope_data_row runs on get_conn(), which is autocommit=True, so
    when the cascade raised KeyError('auto_pair_kind') on its re-attach the
    preceding "linked_row_id = NULL" and _prune_td_row_if_orphaned had
    already committed -- the row kept the error *and* lost its T&D row.

Only touches rows created since auto-pairing went live (2026-07-16 08:33,
the first auto-generated T&D row) -- rows older than that predate the
feature and restating them is a separate decision -- and skips any job
whose status mentions "Closed".

Pairing goes through api.job_scope_data_routes._pair_td_for_enabled_row, the
same entry point the approve path now uses, so amalgamation into an existing
site T&D row, the Scope 3 dataset refresh and the audit trail all behave
exactly as they would have at the time.

Dry run by default. Set TD_REPAIR_APPLY=1 to write.
"""
from __future__ import annotations

import os
import sys

from api.job_scope_data_routes import _pair_td_for_enabled_row
from core.database import get_conn
from services.td_electricity_pairing import (
    detect_electricity_pair_kind,
    resolve_td_pair_for_new_row,
)

PAIRING_WENT_LIVE = "2026-07-16 08:33:22"
APPLY = os.getenv("TD_REPAIR_APPLY") == "1"

# Statuses treated as finished, so their reported figures are left alone.
# "Completed" is a status in its own right alongside "Closed" and "Job Closed
# - ...", and reads the same way: the work is done and the report may already
# be out. "Reporting Phase", "Data Gathering Phase" and "Awaiting Client
# Input" are live jobs -- correcting those before the report is issued is the
# whole point -- so they are in scope.
FINISHED_STATUSES = ("%Closed%", "Completed")

_ACTOR = {
    "email": "francis@netzero.international",
    "name": "Francis Doherty",
    "org_id": "cbb74c5b-af30-4ec2-b686-a14aa45a64c0",
}


def _candidates(con) -> list[tuple]:
    rows = con.execute(
        """
        SELECT r.row_id, r.job_id, j.job_number, j.status, r.dataset_id, r.original_id,
               r.scope, r.level_1, r.level_2, r.uom, r.qty,
               COALESCE(r.submitted_by_portal, FALSE), r.site_id
        FROM job_scope_rows r
        JOIN jobs j ON j.job_id = r.job_id
        WHERE COALESCE(r.enabled, TRUE) = TRUE
          AND r.linked_row_id IS NULL
          AND r.is_auto_generated IS NOT TRUE
          AND r.uom IN ('kWh', 'GBP')
          AND r.created_at >= %s
          AND NOT (COALESCE(j.status, '') LIKE ANY(%s))
        ORDER BY r.job_id, r.row_id
        """,
        [PAIRING_WENT_LIVE, list(FINISHED_STATUSES)],
    ).fetchall()

    out = []
    for (row_id, job_id, job_number, status, dataset_id, original_id,
         scope, level_1, level_2, uom, qty, is_portal, site_id) in rows:
        el1, el2 = level_1, level_2
        if not el1 and not el2:
            reference = con.execute(
                "SELECT level_1, level_2 FROM factor_lookup WHERE dataset_id=%s AND original_id=%s LIMIT 1",
                [dataset_id, original_id],
            ).fetchone()
            if reference:
                el1, el2 = reference
        if detect_electricity_pair_kind(level_1=el1, level_2=el2, uom=uom) is None:
            continue

        # A T&D line may already be on the job because somebody added one by
        # hand -- several arrived through the portal as an ordinary submitted
        # row once the auto pair stopped appearing. Those are NOT missing, and
        # pairing them would double-count the T&D emissions. Only an
        # auto-generated row is safe to amalgamate into.
        blocking_row = None
        td_pair = resolve_td_pair_for_new_row(
            con, dataset_id=dataset_id, level_1=el1, level_2=el2, uom=uom
        )
        if td_pair is not None:
            blocking_row = con.execute(
                """
                SELECT row_id, qty, data_source FROM job_scope_rows
                WHERE job_id = %s AND site_id IS NOT DISTINCT FROM %s
                  AND scope = 'Scope 3' AND original_id = %s
                  AND COALESCE(enabled, TRUE) = TRUE
                  AND is_auto_generated IS NOT TRUE
                LIMIT 1
                """,
                [int(job_id), site_id, td_pair["original_id"]],
            ).fetchone()

        out.append((row_id, job_id, job_number, status, float(qty or 0), uom,
                    bool(is_portal), td_pair is not None, blocking_row))
    return out


def main() -> None:
    with get_conn(autocommit=False) as con:
        candidates = _candidates(con)
        print(f"{'APPLY' if APPLY else 'DRY RUN'}: {len(candidates)} unpaired electricity row(s) "
              f"on {len({c[1] for c in candidates})} non-closed job(s)\n")

        paired, no_factor, already_covered = 0, [], []
        for (row_id, job_id, job_number, status, qty, uom,
             is_portal, has_pair, blocking_row) in candidates:
            origin = "portal" if is_portal else "CRM"
            label = f"job {job_id} {job_number} [{status}] row {row_id}: {qty:,.0f} {uom} ({origin})"

            if not has_pair:
                no_factor.append(label)
                print(f"  NO T&D FACTOR  {label}")
                continue
            if blocking_row is not None:
                already_covered.append((label, blocking_row))
                print(f"  ALREADY COVERED {label}")
                print(f"                  existing manual T&D row {blocking_row[0]} "
                      f"({float(blocking_row[1] or 0):,.0f}, {blocking_row[2]}) -- pairing would double-count")
                continue
            if not APPLY:
                print(f"  would pair      {label}")
                continue

            linked = _pair_td_for_enabled_row(
                con, job_id=int(job_id), row_id=int(row_id), request=None, actor=_ACTOR
            )
            if linked is None:
                no_factor.append(label)
                print(f"  NOT PAIRED     {label}")
                continue
            paired += 1
            td = con.execute(
                "SELECT qty, factor FROM job_scope_rows WHERE row_id=%s", [int(linked)]
            ).fetchone()
            tco2e = float(td[0] or 0) * float(td[1] or 0) / 1000.0
            print(f"  paired          {label} -> T&D row {linked} "
                  f"now {float(td[0] or 0):,.0f} = {tco2e:.4f} tCO2e")

        print(f"\n{'paired' if APPLY else 'would pair'}: "
              f"{paired if APPLY else len(candidates) - len(no_factor) - len(already_covered)}")
        print(f"already covered by a manual T&D row (left alone): {len(already_covered)}")
        print(f"no unambiguous T&D factor (left alone):           {len(no_factor)}")
        if not APPLY:
            print("\nNothing written. Re-run with TD_REPAIR_APPLY=1 to apply.")
            sys.exit(0)


if __name__ == "__main__":
    main()
