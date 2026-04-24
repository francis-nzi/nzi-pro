from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException
import pytest

import api.admin_routes as admin_routes
import api.quotes_routes as quotes_routes
import api.time_routes as time_routes


class _FakeRow:
    def __init__(self, *values: object):
        self.values = values

    def __getitem__(self, idx: int) -> object:
        return self.values[idx]


class _RecordingConn:
    def __init__(self):
        self.executed: list[tuple[str, list[object] | None]] = []

    def execute(self, sql: str, params: list[object] | None = None):
        self.executed.append((sql, params))
        return self

    def fetchone(self):
        sql = self.executed[-1][0] if self.executed else ""
        params = self.executed[-1][1] or []

        if "FROM clients WHERE db_id = %s" in sql:
            return _FakeRow(1) if "%s AND org_id = %s" in sql and params[-1] == "org-a" else None
        if "FROM jobs WHERE job_id = ?" in sql:
            return _FakeRow(1) if params[-1] == "org-a" else None
        if "FROM jobs WHERE job_id = %s" in sql:
            return _FakeRow(1) if "%s AND org_id = %s" in sql and params[-1] == "org-a" else None
        if "SELECT 1 FROM time_subjects" in sql:
            return None
        if "SELECT quote_number FROM quotes" in sql:
            return None
        if "SELECT MAX(quote_id)" in sql:
            return _FakeRow(77)
        if "SELECT COALESCE(MAX" in sql:
            return _FakeRow(2)
        return None

    def df(self):
        class _Empty:
            empty = True

            def iterrows(self):
                return []

        return _Empty()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class _QuoteListConn(_RecordingConn):
    def df(self):
        class _Rows:
            empty = False

            def iterrows(self):
                return iter([
                    (0, {
                        "quote_id": 44,
                        "quote_number": "Q000044/1",
                        "quote_date": None,
                        "valid_to": None,
                        "currency_code": "GBP",
                        "status": "Draft",
                        "updated_at": None,
                        "job_number": "J-1",
                    })
                ])

        return _Rows()


def test_list_client_quotes_includes_org_filter(monkeypatch: pytest.MonkeyPatch):
    fake = _QuoteListConn()
    monkeypatch.setattr(quotes_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(quotes_routes, "_ensure_quote_tables", lambda con: None)
    monkeypatch.setattr(quotes_routes, "_quote_org_id", lambda _user: "org-a")
    monkeypatch.setattr(quotes_routes, "_compute_totals", lambda lines: {"total": 0.0})
    monkeypatch.setattr(quotes_routes, "assert_client_access", lambda *_args, **_kwargs: None)

    quotes_routes.list_client_quotes(10, _user={"user_id": "u1", "org_id": "org-a"})

    assert any("FROM quotes" in sql and "org_id = %s" in sql for sql, _ in fake.executed)
    assert any("FROM quote_lines" in sql and "q.org_id = %s" in sql for sql, _ in fake.executed)


def test_create_quote_rejects_cross_org_client(monkeypatch: pytest.MonkeyPatch):
    fake = _RecordingConn()
    monkeypatch.setattr(quotes_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(quotes_routes, "_ensure_quote_tables", lambda con: None)
    monkeypatch.setattr(quotes_routes, "_quote_org_id", lambda _user: "org-b")
    monkeypatch.setattr(quotes_routes, "_require_org_plan_active", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(quotes_routes, "_next_quote_number", lambda con: "Q000999/1")
    monkeypatch.setattr(quotes_routes, "_write_lines", lambda con, quote_id, lines: None)
    monkeypatch.setattr(quotes_routes, "_serialize_quote", lambda con, quote_id, org_id=None: {"quote_id": quote_id, "org_id": org_id})

    with pytest.raises(HTTPException) as exc_info:
        quotes_routes.create_quote(10, {"description": "x"}, _user={"user_id": "u1", "org_id": "org-b"})

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "Client not found"
    assert any("FROM clients" in sql and "org_id = %s" in sql for sql, _ in fake.executed)


def test_create_time_log_rejects_cross_org_job(monkeypatch: pytest.MonkeyPatch):
    fake = _RecordingConn()
    monkeypatch.setattr(time_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(time_routes, "_ensure_time_tracking_schema", lambda con: None)
    monkeypatch.setattr(time_routes, "_column_exists", lambda con, table_name, column_name: True)

    with pytest.raises(HTTPException) as exc_info:
        time_routes.create_time_log(
            {"job_id": 55, "subject": "Work", "work_date": "2026-04-23", "minutes": 30},
            _user={"user_id": "u1", "org_id": "org-b"},
        )

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "Job not found"
    assert any("FROM jobs" in sql and "org_id = ?" in sql for sql, _ in fake.executed)


def test_create_lookup_item_scopes_org_lookup_tables(monkeypatch: pytest.MonkeyPatch):
    fake = _RecordingConn()
    monkeypatch.setattr(admin_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(admin_routes, "_ensure_lookup_table", lambda *args, **kwargs: None)

    result = admin_routes.create_lookup_item(
        "time_subjects",
        {"name": "Materiality Review", "budget_hours": 4},
        _user={"user_id": "u1", "org_id": "org-a"},
    )

    assert result["ok"] is True
    assert any("FROM time_subjects" in sql and "COALESCE(org_id, '') = %s" in sql for sql, _ in fake.executed)
    assert any(
        "INSERT INTO time_subjects" in sql and params is not None and params[0] == "org-a"
        for sql, params in fake.executed
    )
