from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd

import api.job_management_routes as job_management_routes


class _FakeResult:
    def __init__(self, *, fetchone_value=None, df_value=None):
        self._fetchone_value = fetchone_value
        self._df_value = df_value if df_value is not None else pd.DataFrame()

    def fetchone(self):
        return self._fetchone_value

    def df(self):
        return self._df_value


class _FakeConn:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql: str, params=None):
        sql_norm = " ".join(sql.lower().split())
        if "select count(*)" in sql_norm and "from jobs" in sql_norm:
            return _FakeResult(fetchone_value=(0,))
        if "information_schema.columns" in sql_norm or "information_schema.tables" in sql_norm:
            return _FakeResult(fetchone_value=None)
        return _FakeResult(df_value=pd.DataFrame())


def test_list_jobs_returns_empty_payload_without_crashing(monkeypatch):
    monkeypatch.setattr(job_management_routes, "assert_permission", lambda user, perm: None)
    monkeypatch.setattr(job_management_routes, "get_conn", lambda: _FakeConn())

    result = job_management_routes.list_jobs(
        _user={"is_super_admin": True, "access_scope": "all", "linked_client_ids": []},
        limit=5,
        offset=0,
    )

    assert result["items"] == []
    assert result["total"] == 0
    assert result["limit"] == 5
    assert result["offset"] == 0
