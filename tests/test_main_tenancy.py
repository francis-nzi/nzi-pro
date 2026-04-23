from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
import pandas as pd
from fastapi import HTTPException

import api.main as main


class _FakeConn:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, *args, **kwargs):
        raise AssertionError("get_conn should not be reached when org context is missing")


class _ClientConn(_FakeConn):
    def __init__(self, row):
        self.row = row
        self.queries = []

    def execute(self, sql: str, params: list[object] | None = None):
        self.queries.append((sql, params))
        return self

    def fetchone(self):
        return self.row


class _ListClientsConn(_FakeConn):
    def __init__(self):
        self.queries = []
        self._last_sql = ""
        self._fetchone_calls = 0

    def execute(self, sql: str, params: list[object] | None = None):
        self.queries.append((sql, params))
        self._last_sql = sql
        return self

    def fetchone(self):
        self._fetchone_calls += 1
        if "COUNT(*)" in self._last_sql:
            return (1,)
        return (1,)

    def df(self):
        if "FROM clients c" in self._last_sql:
            return pd.DataFrame(
                [
                    {
                        "client_db_id": 89,
                        "client_name": "Advanced Electric Machines (AEM)",
                        "industry": "Engineering",
                        "status": "Active",
                        "crm_owner": "David Hawes",
                    }
                ]
            )
        if "FROM jobs j" in self._last_sql:
            return pd.DataFrame([])
        return pd.DataFrame([])


class _ClientJobsConn(_FakeConn):
    def __init__(self):
        self.queries = []
        self._last_sql = ""

    def execute(self, sql: str, params: list[object] | None = None):
        self.queries.append((sql, params))
        self._last_sql = sql
        return self

    def fetchone(self):
        if "COUNT(*)" in self._last_sql:
            return (1,)
        return None

    def df(self):
        if "FROM jobs j" in self._last_sql:
            return pd.DataFrame(
                [
                    {
                        "job_id": 640,
                        "job_number": "J000640",
                        "title": "Job title",
                        "reporting_year": 2025,
                        "status": "Open",
                        "job_type": "CRP",
                        "is_crp": True,
                        "data_collection_due": None,
                        "data_collection_completed_at": None,
                        "first_draft_due": None,
                        "first_draft_completed_at": None,
                        "final_report_due": None,
                        "final_report_completed_at": None,
                        "total_emissions": 0,
                    }
                ]
            )
        return pd.DataFrame([])


def test_list_clients_requires_org(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main, "assert_permission", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "get_default_org_id", lambda: None)
    monkeypatch.setattr(main, "get_conn", lambda: _FakeConn())
    monkeypatch.setattr(main, "db_backend", lambda: "postgres")

    with pytest.raises(HTTPException) as exc_info:
        main.list_clients(_user={"user_id": "u1", "org_id": ""})

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Organisation context required"


def test_list_clients_includes_job_reachable_client(monkeypatch: pytest.MonkeyPatch) -> None:
    conn = _ListClientsConn()
    monkeypatch.setattr(main, "assert_permission", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "get_default_org_id", lambda: None)
    monkeypatch.setattr(main, "get_conn", lambda: conn)
    monkeypatch.setattr(main, "db_backend", lambda: "postgres")

    result = main.list_clients(
        limit=50,
        offset=0,
        sort_by="client",
        sort_dir="asc",
        _user={"user_id": "u1", "org_id": "org-a"},
    )

    assert result["total"] == 1
    assert result["items"][0]["client_name"] == "Advanced Electric Machines (AEM)"
    assert any("EXISTS (SELECT 1 FROM jobs j" in sql for sql, _ in conn.queries)


def test_get_client_requires_org(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main, "assert_permission", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "get_default_org_id", lambda: None)
    monkeypatch.setattr(main, "get_conn", lambda: _FakeConn())

    with pytest.raises(HTTPException) as exc_info:
        main.get_client(123, _user={"user_id": "u1", "org_id": ""})

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Organisation context required"


def test_get_client_allows_default_org_legacy_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    row = (
        123,
        "Legacy Client",
        "Industry",
        "Description",
        "Active",
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
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        "GBP",
        True,
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
        "Legacy Client",
    )
    conn = _ClientConn(row)
    monkeypatch.setattr(main, "assert_permission", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "assert_client_access", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "get_default_org_id", lambda: "org-a")
    monkeypatch.setattr(main, "get_conn", lambda: conn)

    result = main.get_client(123, _user={"user_id": "u1", "org_id": "org-a"})

    assert result["client_db_id"] == 123
    assert result["client_name"] == "Legacy Client"
    assert conn.queries


def test_get_job_does_not_fail_open_on_legacy_org_gap(monkeypatch: pytest.MonkeyPatch) -> None:
    class _JobConn(_FakeConn):
        def execute(self, *args, **kwargs):
            raise AssertionError("get_job should stop at assert_job_access when org is missing")

    monkeypatch.setattr(main, "assert_permission", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "assert_job_access", lambda *_args, **_kwargs: (_ for _ in ()).throw(HTTPException(status_code=403, detail="Organisation context required")))
    monkeypatch.setattr(main, "get_conn", lambda: _JobConn())

    with pytest.raises(HTTPException) as exc_info:
        main.get_job(123, _user={"user_id": "u1", "org_id": ""})

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Organisation context required"


def test_client_jobs_include_legacy_null_org_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    conn = _ClientJobsConn()
    monkeypatch.setattr(main, "assert_permission", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "assert_client_access", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "get_conn", lambda: conn)

    result = main.client_jobs(
        58,
        limit=50,
        offset=0,
        _user={"user_id": "u1", "org_id": "org-a"},
    )

    assert result["total"] == 1
    assert result["items"][0]["job_id"] == 640
    assert any("CAST(j.org_id AS TEXT)" in sql for sql, _ in conn.queries)
