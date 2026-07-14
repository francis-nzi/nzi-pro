"""
Shared dataset import helpers used by archive flows.
"""

from pathlib import Path
import inspect


def _ingest_csv_for_dataset(csv_path: Path, *, replace: bool, dataset_id: int) -> tuple[int, int]:
    """Call ingest_csv in a way that works with both older and newer signatures."""
    from ingest_conversion_factors import ingest_csv

    signature = inspect.signature(ingest_csv)
    if "dataset_id" in signature.parameters:
        return ingest_csv(csv_path, replace=replace, dataset_id=dataset_id)
    return ingest_csv(csv_path, replace=replace)


def _ingest_csv_report_for_dataset(csv_path: Path, *, replace: bool, dataset_id: int) -> dict:
    """Use the richer dataset ingest report when available."""
    from ingest_conversion_factors import ingest_csv_with_report

    signature = inspect.signature(ingest_csv_with_report)
    if "dataset_id" in signature.parameters:
        return ingest_csv_with_report(csv_path, replace=replace, dataset_id=dataset_id)
    ds_id, factor_count = _ingest_csv_for_dataset(csv_path, replace=replace, dataset_id=dataset_id)
    return {
        "dataset_id": ds_id,
        "accepted_rows": factor_count,
        "rejected_rows": 0,
        "rejected_details": [],
        "deleted_rows": 0,
    }


def _preview_csv_report_for_dataset(csv_path: Path, *, dataset_id: int) -> dict:
    """Dry-run parse + validate a CSV against an existing dataset, writing nothing."""
    from ingest_conversion_factors import preview_conversion_factor_upload

    return preview_conversion_factor_upload(csv_path, dataset_id=dataset_id)
