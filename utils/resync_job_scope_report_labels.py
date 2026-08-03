"""One-time resync: refresh job_scope_rows.report_label from the current,
corrected factor_lookup/emission_factor_definitions report_label for every
row still mapped to a real factor (factor_db_id IS NOT NULL).

job_scope_rows.report_label is copied at row-creation time and never
auto-updates when the source factor's label changes later -- the same
frozen-snapshot pattern as job_scope_rows.factor/calc_tco2e (see
utils/bulk_spend_factor_refresh.py and the DEFRA spend-factor incident).
This one just never got a resync pass when the report-label normalization
(services/factor_label_normalize.py) ran, so the "Frequently used"/
"Previously used" quick-pick pills in both the client portal
(PortalDataEntry.tsx) and the CRM (JobDataEntry.tsx, via
GET .../template-factors/top) -- both of which read jsr.report_label
directly, see services/portal_data_entry.py get_top_factors_for_categories/
get_previous_bucket_rows -- were still showing pre-normalization text even
after factor_lookup/emission_factor_definitions were fixed.

Scoped to factor_db_id IS NOT NULL only: rows without one are either
freeform custom entries (is_custom_entry=TRUE, no canonical factor to sync
from) or legacy client-specific spend mappings with no factor_lookup match
-- confirmed live, 942 + 260 rows respectively, correctly out of scope
since there's no corrected value to sync them to.

Display-text only (not a financial figure like factor/calc_tco2e), so this
records a single summary audit event rather than one per row.
"""
from __future__ import annotations

import argparse

from core.database import get_conn
from services.audit_log import record_audit_event

ACTOR = {"email": "francis@netzero.international", "full_name": "Francis Doherty", "user_id": "bulk-script"}
REASON = "Resync job_scope_rows.report_label from normalized factor_lookup/emission_factor_definitions labels (2026-08)"


def resync_job_scope_report_labels(dry_run: bool) -> int:
    with get_conn() as con:
        df = con.execute(
            """
            SELECT jsr.row_id, jsr.job_id, jsr.report_label AS current_label, vfl.report_label AS expected_label
            FROM job_scope_rows jsr
            JOIN v_factor_lookup vfl ON vfl.db_id = jsr.factor_db_id
            WHERE jsr.factor_db_id IS NOT NULL
              AND vfl.report_label IS NOT NULL
              AND vfl.report_label <> ''
              AND COALESCE(jsr.report_label, '') <> vfl.report_label
            """
        ).df()

        if df is None or df.empty:
            print("No rows need resyncing.")
            return 0

        df = df.astype(object).where(df.notna(), None)
        print(f"{'Would update' if dry_run else 'Updating'} {len(df)} job_scope_rows row(s).")
        for _, row in df.head(20).iterrows():
            print(f"  row_id={int(row['row_id'])} job_id={int(row['job_id'])} {row['current_label']!r} -> {row['expected_label']!r}")

        if dry_run:
            return len(df)

        for _, row in df.iterrows():
            con.execute(
                "UPDATE job_scope_rows SET report_label = %s, updated_at = NOW() WHERE row_id = %s",
                [row["expected_label"], int(row["row_id"])],
            )

        record_audit_event(
            con, request=None, actor=ACTOR, action="bulk_report_label_resync", entity_type="job_scope_rows",
            entity_id=None, metadata={"reason": REASON, "rows_updated": len(df)},
        )

    print(f"Updated {len(df)} row(s).")
    return len(df)


def main() -> int:
    parser = argparse.ArgumentParser(description="Resync job_scope_rows.report_label from the current factor label.")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    resync_job_scope_report_labels(dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
