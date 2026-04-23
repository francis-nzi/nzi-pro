from __future__ import annotations

from pathlib import Path
import sys
import types

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import core.database as database
from services.tenancy import clear_current_org_context, set_current_org_context


class _FakeCursor:
    def __init__(self):
        self.executed: list[tuple[str, list[object] | None]] = []

    def execute(self, sql: str, params: list[object] | None = None):
        self.executed.append((sql, params))

    def close(self):
        pass


class _FakeConn:
    def __init__(self):
        self.cursor_calls: list[_FakeCursor] = []
        self.closed = False

    def cursor(self):
        cursor = _FakeCursor()
        self.cursor_calls.append(cursor)
        return cursor

    def commit(self):
        pass

    def rollback(self):
        pass

    def close(self):
        self.closed = True


def test_get_conn_applies_current_org_session_context(monkeypatch):
    fake_conn = _FakeConn()
    fake_psycopg = types.SimpleNamespace(connect=lambda *args, **kwargs: fake_conn)
    monkeypatch.setitem(sys.modules, "psycopg", fake_psycopg)

    set_current_org_context("org-123")
    try:
        with database.get_conn() as _con:
            pass
    finally:
        clear_current_org_context()

    assert fake_conn.cursor_calls
    executed_sql = "\n".join(sql for cursor in fake_conn.cursor_calls for sql, _ in cursor.executed)
    assert "set_config" in executed_sql
    assert fake_conn.cursor_calls[0].executed[0][1] == ["app.current_org_id", "org-123"]


def test_get_conn_skips_session_context_without_org(monkeypatch):
    fake_conn = _FakeConn()
    fake_psycopg = types.SimpleNamespace(connect=lambda *args, **kwargs: fake_conn)
    monkeypatch.setitem(sys.modules, "psycopg", fake_psycopg)

    clear_current_org_context()
    with database.get_conn() as _con:
        pass

    assert not fake_conn.cursor_calls or all(
        "set_config" not in sql for cursor in fake_conn.cursor_calls for sql, _ in cursor.executed
    )
