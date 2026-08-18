from __future__ import annotations

import csv
from collections import Counter
from pathlib import Path

from core.database import get_conn


OUTPUT = Path("dataset_date_year_audit.csv")


def _year(value):
    return value.year if value is not None else None


def main() -> None:
    exceptions: list[dict[str, object]] = []

    with get_conn() as con:
        datasets = con.execute(
            """
            SELECT dataset_id, name, country, year, valid_from, valid_to
            FROM datasets
            ORDER BY dataset_id
            """
        ).fetchall()
        factors = con.execute(
            """
            SELECT
                d.dataset_id, d.name, d.country, d.year AS dataset_year,
                fl.db_id, fl.original_id, fl.report_label,
                fl.year AS factor_year, fl.valid_from, fl.valid_to,
                fl.factor_definition_id, fl.factor_year_value_id
            FROM v_factor_lookup fl
            JOIN datasets d ON d.dataset_id = fl.dataset_id
            ORDER BY d.dataset_id, fl.db_id
            """
        ).fetchall()

    dataset_factor_counts = Counter(row[0] for row in factors)
    null_date_counts = Counter()

    for dataset_id, name, country, dataset_year, valid_from, valid_to in datasets:
        if valid_from is None:
            null_date_counts[(dataset_id, "dataset_valid_from")] += 1
        if valid_to is None:
            null_date_counts[(dataset_id, "dataset_valid_to")] += 1
        reasons = []
        if dataset_year is not None and valid_from is not None and _year(valid_from) != dataset_year:
            reasons.append("valid_from_year_mismatch")
        if dataset_year is not None and valid_to is not None and _year(valid_to) != dataset_year:
            reasons.append("valid_to_year_mismatch")
        if reasons:
            exceptions.append(
                {
                    "record_type": "dataset",
                    "dataset_id": dataset_id,
                    "dataset_name": name,
                    "country": country,
                    "dataset_year": dataset_year,
                    "db_id": "",
                    "original_id": "",
                    "report_label": "",
                    "factor_year": "",
                    "valid_from": valid_from,
                    "valid_to": valid_to,
                    "factor_definition_id": "",
                    "factor_year_value_id": "",
                    "issues": ";".join(reasons),
                }
            )

    for row in factors:
        (
            dataset_id, name, country, dataset_year, db_id, original_id,
            report_label, factor_year, valid_from, valid_to,
            factor_definition_id, factor_year_value_id,
        ) = row
        if valid_from is None:
            null_date_counts[(dataset_id, "factor_valid_from")] += 1
        if valid_to is None:
            null_date_counts[(dataset_id, "factor_valid_to")] += 1
        applicable_year = factor_year if factor_year is not None else dataset_year
        reasons = []
        if dataset_year is not None and factor_year is not None and factor_year != dataset_year:
            reasons.append("factor_year_differs_from_dataset_year")
        if applicable_year is not None and valid_from is not None and _year(valid_from) != applicable_year:
            reasons.append("valid_from_year_mismatch")
        if applicable_year is not None and valid_to is not None and _year(valid_to) != applicable_year:
            reasons.append("valid_to_year_mismatch")
        if reasons:
            exceptions.append(
                {
                    "record_type": "factor",
                    "dataset_id": dataset_id,
                    "dataset_name": name,
                    "country": country,
                    "dataset_year": dataset_year,
                    "db_id": db_id,
                    "original_id": original_id,
                    "report_label": report_label,
                    "factor_year": factor_year,
                    "valid_from": valid_from,
                    "valid_to": valid_to,
                    "factor_definition_id": factor_definition_id,
                    "factor_year_value_id": factor_year_value_id,
                    "issues": ";".join(reasons),
                }
            )

    fields = [
        "record_type", "dataset_id", "dataset_name", "country", "dataset_year",
        "db_id", "original_id", "report_label", "factor_year", "valid_from",
        "valid_to", "factor_definition_id", "factor_year_value_id", "issues",
    ]
    with OUTPUT.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(exceptions)

    by_dataset = Counter((row["dataset_id"], row["dataset_name"], row["dataset_year"]) for row in exceptions)
    print(f"datasets_scanned={len(datasets)}")
    print(f"factor_rows_scanned={len(factors)}")
    print(f"datasets_with_factor_rows={len(dataset_factor_counts)}")
    print(f"exceptions={len(exceptions)}")
    print(f"datasets_with_exceptions={len(by_dataset)}")
    print(f"output={OUTPUT.resolve()}")
    print("exceptions_by_dataset:")
    for (dataset_id, name, year), count in sorted(by_dataset.items(), key=lambda item: (-item[1], item[0][0])):
        print(f"  {dataset_id}\t{year}\t{count}\t{name}")
    print("null_dates_by_dataset:")
    for dataset_id in sorted(dataset_factor_counts):
        name = next(row[1] for row in datasets if row[0] == dataset_id)
        print(
            f"  {dataset_id}\t{name}\t"
            f"factor_valid_from={null_date_counts[(dataset_id, 'factor_valid_from')]}\t"
            f"factor_valid_to={null_date_counts[(dataset_id, 'factor_valid_to')]}"
        )


if __name__ == "__main__":
    main()
