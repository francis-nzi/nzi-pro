from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.job_scope_data_routes as job_scope_data_routes


class _ScopeDataResult:
    def __init__(self, fetchone_value=None, rows=None, description=None):
        self._fetchone_value = fetchone_value
        self._rows = rows or []
        self._description = description or []

    @property
    def cursor(self):
        return self

    @property
    def description(self):
        return self._description

    def fetchone(self):
        return self._fetchone_value

    def fetchall(self):
        return self._rows


class _ScopeDataConn:
    def __init__(self, rows=None, description=None):
        self.sql = ""
        self.params = None
        self._rows = rows or []
        self._description = description or []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql: str, params: list[object] | None = None):
        self.sql = sql
        self.params = params
        if "SELECT 1 FROM jobs WHERE job_id=%s" in sql:
            return _ScopeDataResult(fetchone_value=(1,))
        if "FROM job_scope_rows jsr" in sql:
            return _ScopeDataResult(rows=self._rows, description=self._description)
        return _ScopeDataResult()


class _DummyResolver:
    def __init__(self, *_args, **_kwargs):
        pass

    def row_metrics(self, row):
        return {
            "display_dataset_id": row.get("dataset_id"),
            "display_qty": row.get("qty"),
            "display_uom": row.get("uom"),
            "display_factor": row.get("factor"),
            "calc_tco2e": 0.0,
            "tco2e_before_apply": 0.0,
        }


class _BrokenResolver:
    def __init__(self, *_args, **_kwargs):
        raise RuntimeError("dataset resolution failed")


def test_get_job_scope_data_handles_empty_results(monkeypatch) -> None:
    conn = _ScopeDataConn()

    monkeypatch.setattr(job_scope_data_routes, "get_conn", lambda: conn)
    monkeypatch.setattr(job_scope_data_routes, "_ensure_job_scope_rows_schema", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(job_scope_data_routes, "_table_columns", lambda *_args, **_kwargs: {"category"})
    monkeypatch.setattr(job_scope_data_routes, "JobMonthlyEmissionsResolver", _DummyResolver)

    result = job_scope_data_routes.get_job_scope_data(175, _user={"user_id": "u1", "org_id": "org-123"})

    assert result == {"job_id": 175, "rows": [], "total": 0}


def test_get_job_scope_data_falls_back_when_resolver_breaks(monkeypatch) -> None:
    columns = [
        "row_id",
        "job_id",
        "scope",
        "site_id",
        "site_name",
        "dataset_id",
        "factor_db_id",
        "original_id",
        "category",
        "level_1",
        "level_2",
        "level_3",
        "level_4",
        "column_text",
        "report_label",
        "qty",
        "uom",
        "factor",
        "ghg_unit",
        "calc_tco2e",
        "apply_pct",
        "source_qty",
        "source_uom",
        "month_1",
        "month_2",
        "month_3",
        "month_4",
        "month_5",
        "month_6",
        "month_7",
        "month_8",
        "month_9",
        "month_10",
        "month_11",
        "month_12",
        "data_source",
        "data_confidence",
        "notes",
        "is_custom_entry",
        "enabled",
        "created_at",
        "updated_at",
        "lookup_factor",
        "lookup_ghg_unit",
        "lookup_category",
        "lookup_level_1",
        "lookup_level_2",
        "lookup_level_3",
        "lookup_level_4",
        "lookup_column_text",
        "lookup_report_label",
    ]
    rows = [
        (
            11,
            175,
            "Scope 1",
            22,
            "HQ",
            7,
            91,
            "OID-1",
            "Category A",
            "Level 1",
            "Level 2",
            "Level 3",
            "Level 4",
            "Column",
            "Report",
            10.0,
            "kWh",
            0.5,
            "kgCO2e",
            5.0,
            100.0,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            "Company Data",
            "H",
            "storage_reason=annual",
            True,
            True,
            "2026-04-01",
            "2026-04-02",
            0.5,
            "kgCO2e",
            "Lookup category",
            "Lookup level 1",
            "Lookup level 2",
            "Lookup level 3",
            "Lookup level 4",
            "Lookup column",
            "Lookup report",
        )
    ]
    conn = _ScopeDataConn(rows=rows, description=[(name,) for name in columns])

    monkeypatch.setattr(job_scope_data_routes, "get_conn", lambda: conn)
    monkeypatch.setattr(job_scope_data_routes, "_ensure_job_scope_rows_schema", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(job_scope_data_routes, "_table_columns", lambda *_args, **_kwargs: {"category"})
    monkeypatch.setattr(job_scope_data_routes, "JobMonthlyEmissionsResolver", _BrokenResolver)

    result = job_scope_data_routes.get_job_scope_data(175, _user={"user_id": "u1", "org_id": "org-123"})

    assert result["job_id"] == 175
    assert result["total"] == 1
    assert result["rows"][0]["row_id"] == 11
    assert result["rows"][0]["calc_tco2e"] == 0.005
