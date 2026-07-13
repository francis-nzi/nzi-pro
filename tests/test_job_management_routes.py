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
    def __init__(self):
        self.executed: list[tuple[str, list[object] | None]] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql: str, params=None):
        self.executed.append((sql, params))
        sql_norm = " ".join(sql.lower().split())
        if "select count(*)" in sql_norm and "from jobs" in sql_norm:
            return _FakeResult(fetchone_value=(0,))
        if "select 1 from jobs where job_id = ?" in sql_norm:
            return _FakeResult(fetchone_value=(1,))
        if "information_schema.columns" in sql_norm or "information_schema.tables" in sql_norm:
            return _FakeResult(fetchone_value=None)
        return _FakeResult(df_value=pd.DataFrame())


def test_update_job_can_change_client_title_and_crm(monkeypatch):
    fake = _FakeConn()
    captured: dict[str, object] = {}

    monkeypatch.setattr(job_management_routes, "assert_permission", lambda user, perm: None)
    monkeypatch.setattr(job_management_routes, "assert_job_access", lambda user, job_id: None)
    monkeypatch.setattr(job_management_routes, "assert_client_access", lambda user, client_id: None)
    monkeypatch.setattr(job_management_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(job_management_routes, "_job_audit_snapshot", lambda con, job_id: {"job_id": job_id, "client_db_id": 7})
    monkeypatch.setattr(job_management_routes, "record_audit_event", lambda *args, **kwargs: captured.update({"recorded": True}))

    result = job_management_routes.update_job(
        request=object(),
        job_id=7,
        body={
            "title": "Updated training title",
            "client_db_id": 42,
            "crm_name": "Jane Smith",
        },
        _user={"user_id": "u1", "org_id": "org-a"},
    )

    assert result["ok"] is True
    assert fake.executed, "expected an update query to be executed"
    update_sql, update_params = fake.executed[-1]
    assert "update jobs set" in update_sql.lower()
    assert "client_db_id = ?" in update_sql
    assert update_params == ["Updated training title", 42, "Jane Smith", 7]
    assert captured.get("recorded") is True


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
