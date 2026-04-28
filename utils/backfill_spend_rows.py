from __future__ import annotations

import argparse
from dataclasses import dataclass
from typing import Any

from core.database import get_conn


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        out = float(value)
    except Exception:
        return default
    if out != out or out in (float("inf"), float("-inf")):
        return default
    return out


def _is_kg_based_unit(ghg_unit: str | None) -> bool:
    return "kg" in str(ghg_unit or "").replace(" ", "").lower()


def _calc_tco2e(qty: float | None, factor: float | None, ghg_unit: str | None, apply_pct: float | None) -> float:
    qty_val = float(qty or 0.0)
    factor_val = float(factor or 0.0)
    apply_pct_val = float(apply_pct or 100.0)
    emissions = qty_val * factor_val * (apply_pct_val / 100.0)
    if _is_kg_based_unit(ghg_unit):
        emissions /= 1000.0
    return float(emissions)


@dataclass
class ResolvedFactor:
    db_id: int
    dataset_id: int | None
    original_id: str | None
    scope: str | None
    category: str | None
    report_label: str | None
    factor: float
    ghg_unit: str | None


def _lookup_factor(con, row: dict[str, Any]) -> ResolvedFactor | None:
    factor_db_id = row.get("factor_db_id")
    if factor_db_id is not None:
        factor_row = con.execute(
            """
            SELECT db_id, dataset_id, original_id, scope, level_1, level_2, report_label, factor, ghg_unit
            FROM factor_lookup
            WHERE db_id = %s
            LIMIT 1
            """,
            [int(factor_db_id)],
        ).fetchone()
        if factor_row:
            return ResolvedFactor(
                db_id=int(factor_row[0]),
                dataset_id=int(factor_row[1]) if factor_row[1] is not None else None,
                original_id=str(factor_row[2]).strip() if factor_row[2] is not None else None,
                scope=str(factor_row[3]).strip() if factor_row[3] is not None else None,
                category=str(factor_row[5] or factor_row[4]).strip() if (factor_row[5] or factor_row[4]) is not None else None,
                report_label=str(factor_row[6]).strip() if factor_row[6] is not None else None,
                factor=_safe_float(factor_row[7]),
                ghg_unit=str(factor_row[8]).strip() if factor_row[8] is not None else None,
            )

    dataset_id = row.get("dataset_id")
    scope = row.get("scope")
    original_id = row.get("original_id")
    if dataset_id is None or scope is None or original_id is None:
        return None

    factor_row = con.execute(
        """
        SELECT db_id, dataset_id, original_id, scope, level_1, level_2, report_label, factor, ghg_unit
        FROM factor_lookup
        WHERE dataset_id = %s AND scope = %s AND original_id = %s
        ORDER BY db_id ASC
        LIMIT 1
        """,
        [int(dataset_id), str(scope), str(original_id)],
    ).fetchone()
    if not factor_row:
        return None

    return ResolvedFactor(
        db_id=int(factor_row[0]),
        dataset_id=int(factor_row[1]) if factor_row[1] is not None else None,
        original_id=str(factor_row[2]).strip() if factor_row[2] is not None else None,
        scope=str(factor_row[3]).strip() if factor_row[3] is not None else None,
        category=str(factor_row[5] or factor_row[4]).strip() if (factor_row[5] or factor_row[4]) is not None else None,
        report_label=str(factor_row[6]).strip() if factor_row[6] is not None else None,
        factor=_safe_float(factor_row[7]),
        ghg_unit=str(factor_row[8]).strip() if factor_row[8] is not None else None,
    )


def _effective_ghg_unit(storage_uom: str | None, storage_ghg_unit: str | None, reference_ghg_unit: str | None) -> str | None:
    storage_unit = str(storage_ghg_unit or "").strip() or None
    reference_unit = str(reference_ghg_unit or "").strip() or None
    storage_uom_norm = str(storage_uom or "").strip().lower()

    if not storage_unit:
        return reference_unit

    if _is_kg_based_unit(storage_unit):
        return storage_unit

    if storage_uom_norm == "tco2e":
        return storage_unit

    if _is_kg_based_unit(reference_unit):
        return reference_unit

    return storage_unit or reference_unit


def _build_where_clause(args: argparse.Namespace) -> tuple[str, list[Any]]:
    clauses: list[str] = []
    params: list[Any] = []

    if args.job_id is not None:
        clauses.append("job_id = %s")
        params.append(int(args.job_id))

    if args.row_id is not None:
        clauses.append("row_id = %s")
        params.append(int(args.row_id))

    if args.original_id:
        clauses.append("original_id = %s")
        params.append(str(args.original_id))

    if args.report_label:
        clauses.append("report_label ILIKE %s")
        params.append(f"%{args.report_label}%")

    if not clauses:
        clauses.append("TRUE")

    return " AND ".join(clauses), params


def backfill_spend_rows(args: argparse.Namespace) -> int:
    where_sql, params = _build_where_clause(args)
    updated = 0
    skipped = 0

    with get_conn() as con:
        rows = con.execute(
            f"""
            SELECT row_id, job_id, site_id, dataset_id, factor_db_id, original_id, scope,
                   category, report_label, qty, uom, factor, ghg_unit, calc_tco2e, apply_pct,
                   data_source, data_confidence, notes, enabled
            FROM job_scope_rows
            WHERE {where_sql}
              AND factor_db_id IS NOT NULL
              AND (
                COALESCE(data_source, '') = 'Spend Data'
                OR COALESCE(original_id, '') LIKE 'SPEND-%'
              )
            ORDER BY row_id
            """,
            params,
        ).df()

        if rows is None or rows.empty:
            print("No spend-derived scope rows matched the provided filters.")
            return 0

        for _, r in rows.iterrows():
            row = {k: r.get(k) for k in r.index}
            factor = _lookup_factor(con, row)
            if not factor:
                skipped += 1
                continue

            qty = _safe_float(row.get("qty"))
            apply_pct = _safe_float(row.get("apply_pct"), 100.0)
            effective_ghg_unit = _effective_ghg_unit(row.get("uom"), row.get("ghg_unit"), factor.ghg_unit)
            if effective_ghg_unit == str(row.get("ghg_unit") or "").strip():
                continue

            calc_tco2e = _calc_tco2e(qty, factor.factor, effective_ghg_unit or "kgCO2e", apply_pct)
            category = factor.category or row.get("category")
            report_label = factor.report_label or row.get("report_label")
            ghg_unit = effective_ghg_unit or factor.ghg_unit or "kgCO2e"

            if args.dry_run:
                print(
                    f"[DRY RUN] job_id={int(row['job_id'])} row_id={int(row['row_id'])} "
                    f"original_id={row.get('original_id')} factor={factor.factor} "
                    f"ghg_unit {row.get('ghg_unit')!r} -> {ghg_unit!r} calc_tco2e={calc_tco2e:.6f}"
                )
                updated += 1
                continue

            con.execute(
                """
                UPDATE job_scope_rows
                SET dataset_id = %s,
                    factor_db_id = %s,
                    category = %s,
                    report_label = %s,
                    qty = %s,
                    uom = %s,
                    factor = %s,
                    ghg_unit = %s,
                    calc_tco2e = %s,
                    apply_pct = COALESCE(%s, 100),
                    updated_at = NOW()
                WHERE row_id = %s
                """,
                [
                    factor.dataset_id,
                    factor.db_id,
                    category,
                    report_label,
                    row.get("qty"),
                    row.get("uom"),
                    factor.factor,
                    ghg_unit,
                    calc_tco2e,
                    apply_pct,
                    int(row["row_id"]),
                ],
            )
            updated += 1

    print(
        f"Processed {int(updated)} spend-derived row(s)"
        + (f", skipped {int(skipped)} unmatched row(s)." if skipped else ".")
    )
    return updated


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill spend-derived job scope rows with corrected factor units.")
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument("--job-id", type=int, default=None, help="Job ID to backfill.")
    scope.add_argument("--all-jobs", action="store_true", help="Scan every job and repair all affected rows.")
    parser.add_argument("--row-id", type=int, default=None, help="Optional specific job_scope_rows row_id to repair.")
    parser.add_argument("--original-id", type=str, default=None, help="Optional exact original_id to filter.")
    parser.add_argument("--report-label", type=str, default=None, help="Optional case-insensitive report label filter.")
    parser.add_argument("--dry-run", action="store_true", help="Show intended changes without writing them.")
    args = parser.parse_args()
    return 0 if backfill_spend_rows(args) >= 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
