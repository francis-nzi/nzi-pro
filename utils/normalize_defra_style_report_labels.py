"""One-time cleanup: title-case the DEFRA/DESNZ-style "separator dash" factor
report labels (Business Travel, Employee Commuting, Company Vehicles, Fuels,
Energy, Freighting goods, etc.) into a consistent style, leaving the already-
correctly-formatted USEEIO/ecoinvent-style labels elsewhere in the same
tables untouched.

See services/factor_label_normalize.py for the normalization rules
(preserve-list for acronyms/units, small-word lowercasing, category
exclusions for Refrigerants/Cement and Mortar/Concrete/Steel/Timber) and the
reasoning behind each -- built from and verified against the live dataset,
not guessed.

Scoping and the target value are both derived from factor_lookup.column_text,
NOT report_label -- confirmed live, column_text is never written to
anywhere in this codebase after ingest (grepped for "SET column_text" and
"UPDATE factor_lookup...column_text", zero hits), making it a stable source
of truth. report_label is NOT safe to scope from: it's the write target
itself, and an earlier version of this script that scoped and idempotency-
checked against it (directly, or via the v_factor_lookup view) missed and
corrupted rows in three different ways across earlier runs this session:

1. v_factor_lookup's report_label prefers emission_factor_definitions over
   factor_lookup whenever the former is set -- once any ONE sibling
   factor_lookup row (multiple rows, e.g. different dataset years, commonly
   share one emission_factor_definitions row) got its write applied, the
   view made every OTHER sibling look already-normalized even though their
   own factor_lookup.report_label was untouched.
2. Once a row's report_label WAS correctly rewritten, it no longer contains
   a separator dash -- so a later run's "WHERE report_label ~ regex" scope
   query stopped finding it entirely, even for a resync-only pass.
3. A stale, only-partially-transformed report_label from an earlier
   iteration of this normalization logic (mid-development) can itself no
   longer match the messy-dash regex, while still not being byte-identical
   to what the CURRENT rules would produce -- invisible to any check that
   trusts report_label's current shape as a proxy for "already handled."

Writes both factor_lookup and emission_factor_definitions when a row is
backed by the latter (same reasoning as the bulk_normalize_factor_report_
labels admin-tool fix, api/admin_datasets_routes.py -- the dual-read view
prefers emission_factor_definitions.report_label whenever it's set, so a
factor_lookup-only write would silently do nothing for ~91% of rows).
"""
from __future__ import annotations

import argparse

from core.database import get_conn
from services.factor_label_normalize import EXCLUDED_CATEGORIES, SEPARATOR_DASH_REGEX, titlecase_report_label


def normalize_defra_style_report_labels(dry_run: bool) -> int:
    excluded = list(EXCLUDED_CATEGORIES)
    placeholders = ",".join(["%s"] * len(excluded))

    with get_conn() as con:
        df = con.execute(
            f"""
            SELECT fl.db_id, vfl.factor_definition_id, fl.category, fl.report_label, fl.column_text
            FROM factor_lookup fl
            JOIN v_factor_lookup vfl ON vfl.db_id = fl.db_id
            WHERE fl.column_text ~ %s
              AND (fl.category IS NULL OR fl.category NOT IN ({placeholders}))
            ORDER BY fl.category, fl.column_text
            """,
            [SEPARATOR_DASH_REGEX, *excluded],
        ).df()

        if df is None or df.empty:
            print("No matching rows.")
            return 0

        # astype(object).where(df.notna(), None) -- .df() upcasts nullable
        # integer columns (factor_definition_id, NULL for factor_lookup-only
        # rows) to float64, so a missing value comes back as NaN rather than
        # None. `is not None` doesn't catch that, and int(nan) raises.
        df = df.astype(object).where(df.notna(), None)

        fl_changed = 0
        efd_changed = 0
        for _, row in df.iterrows():
            source = str(row["column_text"] or "")
            expected = titlecase_report_label(source)
            if not expected:
                continue

            current_fl = str(row["report_label"] or "")
            factor_definition_id = row.get("factor_definition_id")
            needs_fl_write = current_fl != expected

            current_efd = None
            needs_efd_write = False
            if factor_definition_id is not None:
                current_efd = con.execute(
                    "SELECT report_label FROM emission_factor_definitions WHERE factor_id = %s",
                    [int(factor_definition_id)],
                ).fetchone()
                needs_efd_write = current_efd is not None and str(current_efd[0]) != expected

            if not needs_fl_write and not needs_efd_write:
                continue

            if dry_run:
                if needs_fl_write:
                    fl_changed += 1
                    if fl_changed <= 20:
                        print(f"[DRY RUN] factor_lookup db_id={int(row['db_id'])} {current_fl!r} -> {expected!r}")
                if needs_efd_write:
                    efd_changed += 1
                    if efd_changed <= 20:
                        print(f"[DRY RUN] emission_factor_definitions factor_id={int(factor_definition_id)} {current_efd[0]!r} -> {expected!r}")
                continue

            if needs_fl_write:
                con.execute(
                    "UPDATE factor_lookup SET report_label = %s WHERE db_id = %s",
                    [expected, int(row["db_id"])],
                )
                fl_changed += 1
            if needs_efd_write:
                con.execute(
                    "UPDATE emission_factor_definitions SET report_label = %s WHERE factor_id = %s",
                    [expected, int(factor_definition_id)],
                )
                efd_changed += 1

    verb = "Would change" if dry_run else "Changed"
    print(f"{verb} factor_lookup: {fl_changed}, emission_factor_definitions: {efd_changed} (of {len(df)} matched row(s)).")
    return fl_changed + efd_changed


def main() -> int:
    parser = argparse.ArgumentParser(description="Title-case DEFRA-style factor report labels.")
    parser.add_argument("--dry-run", action="store_true", help="Show intended changes without writing them.")
    args = parser.parse_args()
    normalize_defra_style_report_labels(dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
