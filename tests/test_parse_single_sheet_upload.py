from __future__ import annotations

from pathlib import Path
import sys

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.parse_single_sheet_upload as parser


class _FakeConn:
    def __init__(self):
        self.executed: list[tuple[str, list[object] | None]] = []
        self._last_sql = ""

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql: str, params: list[object] | None = None):
        self.executed.append((sql, params))
        self._last_sql = sql
        if "custom_conversion_factors" in sql and "?" in sql:
            raise AssertionError("Postgres branch must not use question-mark placeholders")
        return self

    def df(self):
        if "FROM factor_lookup" in self._last_sql:
            return pd.DataFrame(
                [
                    {
                        "db_id": 101,
                        "original_id": "ID-1",
                        "level_1": "Level 1",
                        "level_2": "Level 2",
                        "level_3": None,
                        "level_4": None,
                        "column_text": "Column",
                        "uom": "km",
                        "ghg_unit": "kgCO2e",
                        "factor": 0.25,
                        "report_label": "Report",
                    }
                ]
            )
        if "FROM custom_conversion_factors" in self._last_sql:
            return pd.DataFrame(
                [
                    {
                        "custom_factor_id": 201,
                        "custom_id": "ID-2",
                        "level_1": "Custom Level 1",
                        "level_2": None,
                        "level_3": None,
                        "level_4": None,
                        "uom": "km",
                        "ghg_unit": "kgCO2e",
                        "factor": 0.5,
                        "report_label": "Custom Report",
                        "category": "Custom",
                    }
                ]
            )
        return pd.DataFrame()


def test_lookup_factors_uses_postgres_placeholders_for_custom_factors(monkeypatch):
    fake = _FakeConn()
    monkeypatch.setattr(parser, "get_conn", lambda: fake)
    monkeypatch.setattr(parser, "db_backend", lambda: "postgres")

    result = parser._lookup_factors(10, "Scope 3", ["ID-1", "ID-2"], job_id=3)

    assert result["ID-1"]["db_id"] == 101
    assert result["ID-2"]["custom_factor_id"] == 201
    custom_sql = next(sql for sql, _ in fake.executed if "FROM custom_conversion_factors" in sql)
    assert "ANY(%s)" in custom_sql
    assert "?" not in custom_sql
