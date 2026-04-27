from __future__ import annotations

from pathlib import Path
import sys

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.admin_routes as admin_routes


class _BulkConn:
    def __init__(self, rows: list[dict[str, object]]):
        self.rows = rows
        self.executed: list[tuple[str, list[object] | None]] = []
        self._last_sql = ""
        self._last_params: list[object] | None = None
        self.updated: list[tuple[int, str]] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql: str, params: list[object] | None = None):
        self.executed.append((sql, params))
        self._last_sql = sql
        self._last_params = params
        if "UPDATE factor_lookup SET report_label = %s WHERE db_id = %s" in sql and params:
            self.updated.append((int(params[1]), str(params[0])))
        return self

    def df(self):
        if "FROM factor_lookup" in self._last_sql:
            rows = self.rows
            if self._last_params:
                needles = [
                    str(value).strip("%").lower()
                    for value in self._last_params
                    if isinstance(value, str) and value.startswith("%") and value.endswith("%") and str(value).strip("%")
                ]
                if needles:
                    filtered = []
                    for row in rows:
                        text = str(row.get("current_label") or row.get("report_label") or row.get("column_text") or "").lower()
                        if all(needle in text for needle in needles):
                            filtered.append(row)
                    rows = filtered
            return pd.DataFrame(rows)
        return pd.DataFrame()


def _bulk_rows() -> list[dict[str, object]]:
    return [
        {
            "db_id": 101,
            "dataset_id": 10,
            "dataset": "UK Activity & Spend 2022",
            "analysis_type": "Activity",
            "country": "United Kingdom",
            "year": 2022,
            "file_name": "uk.xlsx",
            "original_id": "SPEND-BT-1",
            "scope": "Scope 3",
            "category": "Business Travel",
            "level_1": None,
            "level_2": None,
            "level_3": None,
            "level_4": None,
            "column_text": "Business travel- land - Cars (by size) - Average car",
            "current_label": "Business travel- land - Cars (by size) - Average car",
            "report_label": "Business travel- land - Cars (by size) - Average car",
            "uom": "kgCO2e",
            "ghg_unit": "kgCO2e",
            "factor": 0.20416,
            "source": "source",
            "region": "UK",
            "currency": None,
            "method": None,
            "valid_from": None,
            "valid_to": None,
        },
        {
            "db_id": 102,
            "dataset_id": 10,
            "dataset": "UK Activity & Spend 2022",
            "analysis_type": "Activity",
            "country": "United Kingdom",
            "year": 2022,
            "file_name": "uk.xlsx",
            "original_id": "EMP-COMM-1",
            "scope": "Scope 3",
            "category": "Employee Commuting",
            "level_1": None,
            "level_2": None,
            "level_3": None,
            "level_4": None,
            "column_text": "Employee commuting - Cars (by size) - Average car",
            "current_label": "Employee commuting - Cars (by size) - Average car",
            "report_label": "Employee commuting - Cars (by size) - Average car",
            "uom": "kgCO2e",
            "ghg_unit": "kgCO2e",
            "factor": 0.14876,
            "source": "source",
            "region": "UK",
            "currency": None,
            "method": None,
            "valid_from": None,
            "valid_to": None,
        },
        {
            "db_id": 103,
            "dataset_id": 11,
            "dataset": "Company Vehicles 2022",
            "analysis_type": "Activity",
            "country": "United Kingdom",
            "year": 2022,
            "file_name": "veh.xlsx",
            "original_id": "VEH-1",
            "scope": "Scope 3",
            "category": "Company Vehicles",
            "level_1": None,
            "level_2": None,
            "level_3": None,
            "level_4": None,
            "column_text": "Company vehicles - Cars (by size) - Average car",
            "current_label": "Company vehicles - Cars (by size) - Average car",
            "report_label": "Company vehicles - Cars (by size) - Average car",
            "uom": "kgCO2e",
            "ghg_unit": "kgCO2e",
            "factor": 0.99,
            "source": "source",
            "region": "UK",
            "currency": None,
            "method": None,
            "valid_from": None,
            "valid_to": None,
        },
        {
            "db_id": 104,
            "dataset_id": 12,
            "dataset": "Other 2022",
            "analysis_type": "Activity",
            "country": "United Kingdom",
            "year": 2022,
            "file_name": "other.xlsx",
            "original_id": "OTHER-1",
            "scope": "Scope 3",
            "category": "Purchased Goods & Services",
            "level_1": None,
            "level_2": None,
            "level_3": None,
            "level_4": None,
            "column_text": "Purchased goods and services - Office supplies",
            "current_label": "Purchased goods and services - Office supplies",
            "report_label": "Purchased goods and services - Office supplies",
            "uom": "kgCO2e",
            "ghg_unit": "kgCO2e",
            "factor": 0.1,
            "source": "source",
            "region": "UK",
            "currency": None,
            "method": None,
            "valid_from": None,
            "valid_to": None,
        },
    ]


def test_bulk_normalize_report_labels_preview_and_apply(monkeypatch):
    fake = _BulkConn(_bulk_rows())
    monkeypatch.setattr(admin_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(admin_routes, "_ensure_factor_lookup_schema", lambda con: None)

    preview = admin_routes.bulk_normalize_factor_report_labels(
        {
            "q": "Cars (by size)",
            "remove_terms": "Cars (by size)",
            "dry_run": True,
        },
        _user={"user_id": "u1", "org_id": "org-1", "role": "Owner"},
    )

    assert preview["dry_run"] is True
    assert preview["matched_count"] == 3
    assert preview["changed_count"] == 3
    assert len(preview["preview"]) == 3
    assert preview["preview"][0]["new_label"] == "Business travel- land - Average car"
    assert all("Cars (by size)" not in item["new_label"] for item in preview["preview"])
    assert all(item["db_id"] != 104 for item in preview["preview"])

    applied = admin_routes.bulk_normalize_factor_report_labels(
        {
            "q": "Cars (by size)",
            "remove_terms": "Cars (by size)",
            "dry_run": False,
        },
        _user={"user_id": "u1", "org_id": "org-1", "role": "Owner"},
    )

    assert applied["dry_run"] is False
    assert applied["updated_count"] == 3
    assert fake.updated == [
        (101, "Business travel- land - Average car"),
        (102, "Employee commuting - Average car"),
        (103, "Company vehicles - Average car"),
    ]
