from __future__ import annotations

from pathlib import Path
import sys

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.client_notes_routes as client_notes_routes


class _FakeConn:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql: str, params: list[object] | None = None):
        self.sql = sql
        self.params = params or []
        if "FROM clients" in sql:
            return self
        if "FROM jobs" in sql:
            return self
        if "FROM crm_events" in sql:
            return self
        if "FROM job_communications" in sql:
            return self
        if "FROM job_scope_rows" in sql:
            raise RuntimeError("legacy missing job_scope_rows columns")
        if "FROM audit_log" in sql:
            raise RuntimeError("legacy missing audit rows")
        return self

    def fetchone(self):
        if "FROM clients" in getattr(self, "sql", ""):
            return (143, "Net Zero Nation - Lochcarron of Scotland")
        return None

    def df(self):
        if "FROM jobs" in getattr(self, "sql", ""):
            return pd.DataFrame([{"job_id": 640, "job_number": "J000640", "title": "Job title", "reporting_year": 2025, "status": "Open"}])
        return pd.DataFrame()


def test_client_notes_summary_survives_missing_legacy_tables(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(client_notes_routes, "get_conn", lambda: _FakeConn())
    monkeypatch.setattr(client_notes_routes, "_ensure_crm_timeline_tables", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(client_notes_routes, "_ensure_job_scope_rows_schema", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(client_notes_routes, "ensure_audit_log_table", lambda *_args, **_kwargs: None)

    result = client_notes_routes.get_client_notes_summary(143, _user={"user_id": "u1", "org_id": "org-123"})

    assert result["client_db_id"] == 143
    assert result["total"] == 0
    assert result["jobs"][0]["job_id"] == 640

