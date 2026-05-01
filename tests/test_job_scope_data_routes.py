from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.job_scope_data_routes as job_scope_data_routes


class _ScopeDataResult:
    def __init__(self, fetchone_value=None):
        self._fetchone_value = fetchone_value

    @property
    def cursor(self):
        return self

    @property
    def description(self):
        return []

    def fetchone(self):
        return self._fetchone_value

    def fetchall(self):
        return []


class _ScopeDataConn:
    def __init__(self):
        self.sql = ""
        self.params = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql: str, params: list[object] | None = None):
        self.sql = sql
        self.params = params
        if "SELECT 1 FROM jobs WHERE job_id=%s" in sql:
            return _ScopeDataResult(fetchone_value=(1,))
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


def test_get_job_scope_data_handles_empty_results(monkeypatch) -> None:
    conn = _ScopeDataConn()

    monkeypatch.setattr(job_scope_data_routes, "get_conn", lambda: conn)
    monkeypatch.setattr(job_scope_data_routes, "_ensure_job_scope_rows_schema", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(job_scope_data_routes, "_table_columns", lambda *_args, **_kwargs: {"category"})
    monkeypatch.setattr(job_scope_data_routes, "JobMonthlyEmissionsResolver", _DummyResolver)

    result = job_scope_data_routes.get_job_scope_data(175, _user={"user_id": "u1", "org_id": "org-123"})

    assert result == {"job_id": 175, "rows": [], "total": 0}
