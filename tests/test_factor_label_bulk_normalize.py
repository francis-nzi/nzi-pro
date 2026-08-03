from __future__ import annotations

from pathlib import Path
import sys

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.admin_datasets_routes as admin_routes


class _BulkConn:
    def __init__(self, rows: list[dict[str, object]]):
        self.rows = rows
        self.executed: list[tuple[str, list[object] | None]] = []
        self._last_sql = ""
        self._last_params: list[object] | None = None
        # Real writes go to two different tables depending on whether a row
        # is backed by emission_factor_definitions (see the dual-read view,
        # sql_migrations/0050_phase2_dual_read_view.sql) -- tracked separately
        # so the test can confirm both actually happen, not just the legacy one.
        self.updated: list[tuple[int, str]] = []
        self.updated_defs: list[tuple[int, str]] = []

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
        if "UPDATE emission_factor_definitions SET report_label = %s WHERE factor_id = %s" in sql and params:
            self.updated_defs.append((int(params[1]), str(params[0])))
        return self

    def df(self):
        if "FROM v_factor_lookup" in self._last_sql:
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
    base = {
        "level_1": None,
        "level_2": None,
        "level_3": None,
        "level_4": None,
        "uom": "kgCO2e",
        "ghg_unit": "kgCO2e",
        "source": "source",
        "region": "UK",
        "currency": None,
        "method": None,
        "valid_from": None,
        "valid_to": None,
    }
    return [
        {
            **base,
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
            "column_text": "Business travel- land - Cars (by size) - Average car",
            "current_label": "Business travel- land - Cars (by size) - Average car",
            "report_label": "Business travel- land - Cars (by size) - Average car",
            "factor": 0.20416,
            # Backed by emission_factor_definitions -- the view prefers this
            # table's report_label, so the apply path must write here too.
            "factor_definition_id": 501,
        },
        {
            **base,
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
            "column_text": "Employee commuting - Cars (by size) - Average car",
            "current_label": "Employee commuting - Cars (by size) - Average car",
            "report_label": "Employee commuting - Cars (by size) - Average car",
            "factor": 0.14876,
            # No emission_factor_definitions match -- legacy factor_lookup-only row.
            "factor_definition_id": None,
        },
        {
            **base,
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
            "column_text": "Company vehicles - Cars (by size) - Average car",
            "current_label": "Company vehicles - Cars (by size) - Average car",
            "report_label": "Company vehicles - Cars (by size) - Average car",
            "factor": 0.99,
            "factor_definition_id": 503,
        },
        {
            **base,
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
            "column_text": "Purchased goods and services - Office supplies",
            "current_label": "Purchased goods and services - Office supplies",
            "report_label": "Purchased goods and services - Office supplies",
            "factor": 0.1,
            "factor_definition_id": 504,
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
    # dry_run must not write anything, to either table.
    assert fake.updated == []
    assert fake.updated_defs == []

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
    # factor_lookup is written for every changed row, matched or not.
    assert fake.updated == [
        (101, "Business travel- land - Average car"),
        (102, "Employee commuting - Average car"),
        (103, "Company vehicles - Average car"),
    ]
    # emission_factor_definitions is written only for rows with a definitions
    # match (101, 103) -- 102 has no factor_definition_id and must be skipped.
    # This is the fix: previously only factor_lookup was written, which the
    # dual-read view's COALESCE silently ignored for ~91% of production rows.
    assert fake.updated_defs == [
        (501, "Business travel- land - Average car"),
        (503, "Company vehicles - Average car"),
    ]
