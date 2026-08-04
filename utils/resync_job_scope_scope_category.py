"""One-time repair: correct job_scope_rows.scope/category (and level_1-4/
column_text) for rows whose stored value has drifted from their own factor's
current value, via factor_db_id -> v_factor_lookup.

Two distinct root causes surfaced together in the same audit (2026-08):

1. The repoint endpoint bug (api/job_scope_data_routes.py, fixed in
   8e6317dd): repointing a row to a factor in a different scope/category
   never updated the row's own scope/category columns at all -- only a
   small number of rows, scope actually differs (e.g. Scope 3 -> Scope 2
   for "UK Electricity for EVs").
2. A much larger, older population where `category` holds a raw
   level_1/level_2 segment ("Cars (by size)", "Business travel- land",
   "Gaseous fuels") instead of the curated top-level category ("Business
   Travel", "Fuels") -- predates the current category taxonomy convention,
   unrelated to repointing.

Both are the same "frozen snapshot, factor_db_id is the stable join key"
pattern used throughout this session (see utils/resync_job_scope_report_
labels.py) -- scope + derive the target from factor_db_id -> v_factor_lookup,
never from the row's own current scope/category.

Confirmed live 2026-08: all 176 affected rows are on Open/Data Gathering
Phase/Awaiting Client Input jobs -- zero on Completed/Closed jobs, so this
does not touch any already-delivered report's headline Scope 1/2/3 split.
Does NOT touch qty/factor/calc_tco2e -- purely re-labels which
scope/category bucket a row is reported under, using the source factor's
own current values.
"""
from __future__ import annotations

import argparse

from core.database import get_conn
from services.audit_log import fetch_row_dict, record_audit_event

ACTOR = {"email": "francis@netzero.international", "full_name": "Francis Doherty", "user_id": "bulk-script"}
REASON = "Resync job_scope_rows.scope/category/level_1-4/column_text from factor_lookup via factor_db_id (2026-08) -- repoint bug + legacy category drift"


def resync_job_scope_scope_category(dry_run: bool) -> int:
    with get_conn() as con:
        df = con.execute(
            """
            SELECT
                jsr.row_id, jsr.job_id, j.job_number, j.status,
                jsr.scope AS current_scope, vfl.scope AS expected_scope,
                jsr.category AS current_category, vfl.category AS expected_category,
                jsr.level_1 AS current_level_1, vfl.level_1 AS expected_level_1,
                jsr.level_2 AS current_level_2, vfl.level_2 AS expected_level_2,
                jsr.level_3 AS current_level_3, vfl.level_3 AS expected_level_3,
                jsr.level_4 AS current_level_4, vfl.level_4 AS expected_level_4,
                jsr.column_text AS current_column_text, vfl.column_text AS expected_column_text
            FROM job_scope_rows jsr
            JOIN v_factor_lookup vfl ON vfl.db_id = jsr.factor_db_id
            JOIN jobs j ON j.job_id = jsr.job_id
            WHERE jsr.factor_db_id IS NOT NULL
              AND (
                COALESCE(jsr.scope, '') <> COALESCE(vfl.scope, '')
                OR COALESCE(jsr.category, '') <> COALESCE(vfl.category, '')
              )
            ORDER BY jsr.job_id, jsr.row_id
            """
        ).df()

        if df is None or df.empty:
            print("No rows need resyncing.")
            return 0

        df = df.astype(object).where(df.notna(), None)

        closed_jobs = sorted({int(r["job_id"]) for _, r in df.iterrows() if str(r["status"] or "").strip().lower() in ("completed", "closed")})
        if closed_jobs:
            print(f"WARNING: {len(closed_jobs)} affected job(s) are Completed/Closed: {closed_jobs}")
            print("Review these manually -- their delivered report's Scope 1/2/3 split may change.")

        scope_changes = df[df["current_scope"].astype(str) != df["expected_scope"].astype(str)]
        print(f"{'Would update' if dry_run else 'Updating'} {len(df)} job_scope_rows row(s) across {df['job_id'].nunique()} job(s).")
        print(f"  Of which {len(scope_changes)} row(s) have a SCOPE change (the rest are category/level-only).")
        for _, row in df.head(20).iterrows():
            print(
                f"  row_id={int(row['row_id'])} job_id={int(row['job_id'])} ({row['job_number']}, {row['status']}) "
                f"scope: {row['current_scope']!r}->{row['expected_scope']!r}  "
                f"category: {row['current_category']!r}->{row['expected_category']!r}"
            )

        if dry_run:
            return len(df)

        for _, row in df.iterrows():
            row_id = int(row["row_id"])
            before = fetch_row_dict(con, "SELECT * FROM job_scope_rows WHERE row_id = %s", [row_id])
            con.execute(
                """
                UPDATE job_scope_rows
                SET scope = %s, category = %s, level_1 = %s, level_2 = %s, level_3 = %s, level_4 = %s,
                    column_text = %s, updated_at = NOW()
                WHERE row_id = %s
                """,
                [
                    row["expected_scope"],
                    row["expected_category"],
                    row["expected_level_1"],
                    row["expected_level_2"],
                    row["expected_level_3"],
                    row["expected_level_4"],
                    row["expected_column_text"],
                    row_id,
                ],
            )
            after = fetch_row_dict(con, "SELECT * FROM job_scope_rows WHERE row_id = %s", [row_id])
            record_audit_event(
                con, request=None, actor=ACTOR, action="update", entity_type="job_scope_row",
                entity_id=row_id, job_id=int(row["job_id"]), before=before, after=after,
                metadata={"operation": "scope_category_resync", "reason": REASON},
            )

    print(f"Updated {len(df)} row(s).")
    return len(df)


def main() -> int:
    parser = argparse.ArgumentParser(description="Resync job_scope_rows.scope/category from the current factor.")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    resync_job_scope_scope_category(dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
