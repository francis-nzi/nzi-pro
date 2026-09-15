"""One-off: repair auto-generated T&D rows that were stamped with twelve
zero month values by the old _recompute_td_row_totals (api/job_scope_data_routes.py),
which COALESCEd each month SUM to 0 instead of leaving it NULL.

Any month column being non-NULL pushes a row onto the per-month branch of
services/monthly_emissions.py, which derives the displayed quantity from the
months alone -- so a T&D row whose parents hold annual-only electricity read
as 0 kWh / 0 tCO2e in both the job data-entry grid and the client portal,
even though its annual qty column was correct all along.

Re-runs the (now fixed) recompute over every enabled auto-generated T&D row.
Rows whose parents all carry a real monthly split are rewritten with the same
values they already had; the annual-only ones get their months reset to NULL.
"""
from __future__ import annotations

from api.job_scope_data_routes import _recompute_td_row_totals
from core.database import get_conn


def main() -> None:
    with get_conn(autocommit=False) as con:
        rows = con.execute(
            """
            SELECT row_id, job_id, qty
            FROM job_scope_rows
            WHERE auto_pair_kind LIKE 'td_electricity%%'
              AND COALESCE(enabled, TRUE) = TRUE
            ORDER BY job_id, row_id
            """
        ).fetchall()
        print(f"{len(rows)} enabled auto-generated T&D rows to recompute")

        repaired = 0
        for row_id, job_id, _qty in rows:
            before = con.execute(
                "SELECT qty, month_1 FROM job_scope_rows WHERE row_id=%s", [int(row_id)]
            ).fetchone()
            _recompute_td_row_totals(con, int(row_id))
            after = con.execute(
                "SELECT qty, month_1 FROM job_scope_rows WHERE row_id=%s", [int(row_id)]
            ).fetchone()
            if before[1] is not None and after[1] is None:
                repaired += 1
                print(
                    f"  job {job_id} row {row_id}: months reset to NULL, "
                    f"qty {float(after[0]):,.2f} now reads through"
                )

        print(f"{repaired} row(s) repaired, {len(rows) - repaired} already consistent")


if __name__ == "__main__":
    main()
