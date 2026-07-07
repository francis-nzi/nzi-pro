from __future__ import annotations

import asyncio
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.admin_routes as admin_routes
import api.admin_audit_routes as admin_audit_routes
from services.audit_log import record_audit_event


class _FakeRow:
    def __init__(self, *values: object):
        self.values = values

    def __getitem__(self, idx: int) -> object:
        return self.values[idx]


class _AuditConn:
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
        return self

    def fetchone(self):
        sql = self._last_sql
        if "SELECT COUNT(*) FROM audit_log" in sql:
            return _FakeRow(1)
        if "FROM audit_log" in sql:
            return _FakeRow(
                1,
                "2026-04-23 10:00:00",
                "org-123",
                "u1",
                "owner@example.com",
                "Owner Name",
                "create",
                "organisation",
                "org-123",
                None,
                None,
                "admin",
                "organisations",
                None,
                "/admin/organisations",
                "POST",
                None,
                None,
                None,
                '{"org_id":"org-123"}',
                "127.0.0.1",
                "pytest",
            )
        if "RETURNING audit_id" in sql:
            return _FakeRow(1)
        return None

    def fetchall(self):
        sql = self._last_sql
        if "FROM audit_log" in sql:
            return [
                _FakeRow(
                    1,
                    "2026-04-23 10:00:00",
                    "org-123",
                    "u1",
                    "owner@example.com",
                    "Owner Name",
                    "create",
                    "organisation",
                    "org-123",
                    None,
                    None,
                    "admin",
                    "organisations",
                    None,
                    "/admin/organisations",
                    "POST",
                    None,
                    None,
                    None,
                    '{"org_id":"org-123"}',
                    "127.0.0.1",
                    "pytest",
                )
            ]
        return []


def test_record_audit_event_includes_org_id(monkeypatch):
    fake = _AuditConn()
    monkeypatch.setattr("services.audit_log.ensure_audit_log_table", lambda con: None)

    audit_id = record_audit_event(
        fake,
        request=None,
        actor={"user_id": "u1", "email": "owner@example.com", "full_name": "Owner Name", "org_id": "org-123"},
        action="create",
        entity_type="organisation",
        entity_id="org-123",
        metadata={"org_id": "org-123"},
    )

    assert audit_id == 1
    insert_sql, insert_params = next((sql, params) for sql, params in fake.executed if "INSERT INTO audit_log" in sql)
    assert "org_id" in insert_sql
    assert insert_params[0] == "org-123"


def test_audit_log_filter_and_export_include_org_id(monkeypatch):
    fake = _AuditConn()
    monkeypatch.setattr(admin_audit_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(admin_audit_routes, "ensure_audit_log_table", lambda con: None)

    result = admin_audit_routes.get_audit_log(
        org_id="org-123",
        limit=50,
        offset=0,
        _user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123", "role": "Owner"},
    )
    assert result["items"][0]["org_id"] == "org-123"
    assert result["total"] == 1
    assert any("LOWER(COALESCE(a.org_id, ''))" in sql for sql, _ in fake.executed)

    export_response = admin_audit_routes.export_audit_log(
        org_id="org-123",
        _user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123", "role": "Owner"},
    )

    async def _read_stream() -> str:
      chunks: list[str] = []
      async for chunk in export_response.body_iterator:
          chunks.append(chunk if isinstance(chunk, str) else chunk.decode("utf-8"))
      return "".join(chunks)

    csv_text = asyncio.run(_read_stream())
    assert "org_id" in csv_text.splitlines()[0]
    assert "org-123" in csv_text


def test_audit_log_auth_filter_limits_to_auth_events(monkeypatch):
    fake = _AuditConn()
    monkeypatch.setattr(admin_audit_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(admin_audit_routes, "ensure_audit_log_table", lambda con: None)

    result = admin_audit_routes.get_audit_log(
        event_group="auth",
        limit=50,
        offset=0,
        _user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123", "role": "Owner"},
    )

    assert result["total"] == 1
    assert any("entity_type" in sql and "auth_session" in sql for sql, _ in fake.executed)
    assert any("login_success" in (params or []) for _, params in fake.executed)
