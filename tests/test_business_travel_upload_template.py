from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd

import services.business_travel_upload_template as template


class _FakeConn:
    def __init__(self):
        self.queries: list[tuple[str, list[object] | None]] = []
        self._last_sql = ""

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql: str, params: list[object] | None = None):
        self.queries.append((sql, params))
        self._last_sql = sql
        return self

    def df(self):
        if "FROM factor_lookup" in self._last_sql:
            return pd.DataFrame(
                [
                    {
                        "db_id": 1,
                        "dataset_id": 10,
                        "dataset": "UK Activity & Spend 2022",
                        "analysis_type": "Activity",
                        "country": "United Kingdom",
                        "year": 2022,
                        "file_name": "United_kingdom_2025_dataset_template.xlsx",
                        "original_id": "25_313_3141_11_1",
                        "scope": "Scope 3",
                        "category": "Business Travel",
                        "level_1": "Business Travel",
                        "level_2": "Business Travel",
                        "level_3": None,
                        "level_4": None,
                        "column_text": "Business travel - land - Taxis - Regular taxi",
                        "report_label": "Business travel - land - Taxis - Regular taxi",
                        "uom": "km",
                        "ghg_unit": "kgCO2e",
                        "factor": 0.14876,
                        "source": "DESNZ",
                        "region": "UK",
                        "currency": "GBP",
                        "method": "Default",
                        "valid_from": None,
                        "valid_to": None,
                    },
                    {
                        "db_id": 2,
                        "dataset_id": 10,
                        "dataset": "UK Activity & Spend 2022",
                        "analysis_type": "Activity",
                        "country": "United Kingdom",
                        "year": 2022,
                        "file_name": "United_kingdom_2025_dataset_template.xlsx",
                        "original_id": "SPEND-PROD-2022-4-1-1",
                        "scope": "Scope 3",
                        "category": "Purchased Goods & Services",
                        "level_1": "Purchased Goods & Services",
                        "level_2": "Purchased Goods & Services",
                        "level_3": None,
                        "level_4": None,
                        "column_text": "Should be filtered out",
                        "report_label": "Should be filtered out",
                        "uom": "kg",
                        "ghg_unit": "kgCO2e",
                        "factor": 1.0,
                        "source": "DESNZ",
                        "region": "UK",
                        "currency": "GBP",
                        "method": "Default",
                        "valid_from": None,
                        "valid_to": None,
                    },
                ]
            )
        return pd.DataFrame([])


def test_business_travel_reference_rows_are_category_pure(monkeypatch):
    monkeypatch.setattr(template, "get_conn", lambda: _FakeConn())

    factors = template._load_reference_rows(2022)

    assert factors, "Expected business travel reference rows to be available"
    assert all(str(item.get("category") or "").strip().lower() == "business travel" for item in factors)

    original_ids = {str(item.get("original_id") or "").strip() for item in factors}
    assert "SPEND-PROD-2022-4-1-1" not in original_ids
    assert "SPEND-PROD-2022-7-1-4" not in original_ids
    assert "25_313_3141_11_1" in original_ids
