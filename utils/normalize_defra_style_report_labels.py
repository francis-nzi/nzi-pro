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
            SELECT db_id, factor_definition_id, category, report_label
            FROM v_factor_lookup
            WHERE report_label ~ %s
              AND (category IS NULL OR category NOT IN ({placeholders}))
            ORDER BY category, report_label
            """,
            [SEPARATOR_DASH_REGEX, *excluded],
        ).df()

        if df is None or df.empty:
            print("No matching rows.")
            return 0

        changed = 0
        for _, row in df.iterrows():
            current = str(row["report_label"] or "")
            new_label = titlecase_report_label(current)
            if not new_label or new_label == current:
                continue
            changed += 1

            if dry_run:
                if changed <= 40:
                    print(f"[DRY RUN] db_id={int(row['db_id'])} {current!r} -> {new_label!r}")
                continue

            con.execute(
                "UPDATE factor_lookup SET report_label = %s WHERE db_id = %s",
                [new_label, int(row["db_id"])],
            )
            factor_definition_id = row.get("factor_definition_id")
            if factor_definition_id is not None:
                con.execute(
                    "UPDATE emission_factor_definitions SET report_label = %s WHERE factor_id = %s",
                    [new_label, int(factor_definition_id)],
                )

    print(f"{'Would change' if dry_run else 'Changed'} {changed} of {len(df)} matched row(s).")
    return changed


def main() -> int:
    parser = argparse.ArgumentParser(description="Title-case DEFRA-style factor report labels.")
    parser.add_argument("--dry-run", action="store_true", help="Show intended changes without writing them.")
    args = parser.parse_args()
    normalize_defra_style_report_labels(dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
