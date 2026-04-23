from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi import HTTPException

import api.admin_routes as admin_routes
import api.auth_routes as auth_routes


class _FakeRow:
    def __init__(self, *values: object):
        self.values = values

    def __getitem__(self, idx: int) -> object:
        return self.values[idx]


class _ArchivedOrgConn:
    def __init__(self):
        self.executed: list[tuple[str, list[object] | None]] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql: str, params: list[object] | None = None):
        self.executed.append((sql, params))
        return self

    def fetchone(self):
        sql = self.executed[-1][0] if self.executed else ""
        if "SELECT org_id, user_id, role, is_active, is_owner" in sql:
            return _FakeRow("org-123", "u1", "Owner", True, True)
        if "SELECT COALESCE(max_users, 0), COALESCE(max_clients, 0), COALESCE(archived, FALSE), COALESCE(plan_status, 'active')" in sql:
            return _FakeRow(3, 10, True, "active")
        return None


class _RoleUpdateConn:
    def __init__(self):
        self.executed: list[tuple[str, list[object] | None]] = []
        self._ownership_transferred = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql: str, params: list[object] | None = None):
        self.executed.append((sql, params))
        if "UPDATE organisation_memberships" in sql and "SET role = CASE WHEN lower(user_id)" in sql:
            self._ownership_transferred = True
        return self

    def fetchone(self):
        sql = self.executed[-1][0] if self.executed else ""
        if "SELECT membership_id, org_id, user_id, role, is_active, is_owner" in sql:
            return _FakeRow("mem-1", "org-123", "u2", "Consultant", True, False)
        if "SELECT org_id, user_id, role, is_active, is_owner" in sql and self._ownership_transferred:
            return _FakeRow("org-123", "u2", "Owner", True, True)
        if "SELECT COALESCE(max_users, 0), COALESCE(max_clients, 0), COALESCE(archived, FALSE), COALESCE(plan_status, 'active')" in sql:
            return _FakeRow(3, 10, False, "active")
        return None


class _MissingOrgConn:
    def __init__(self):
        self.executed: list[tuple[str, list[object] | None]] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql: str, params: list[object] | None = None):
        self.executed.append((sql, params))
        return self

    def fetchone(self):
        return None


def test_switch_active_organisation_rejects_archived_org(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _ArchivedOrgConn()
    monkeypatch.setattr(admin_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(admin_routes, "_ensure_org_lifecycle_schema", lambda con: None)

    with pytest.raises(HTTPException) as exc_info:
        admin_routes.switch_active_organisation(
            "org-123",
            _user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123", "role": "Administrator"},
        )

    assert exc_info.value.status_code == 403
    assert "archived" in str(exc_info.value.detail).lower()


def test_update_organisation_member_normalizes_administrator_to_owner(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _RoleUpdateConn()
    monkeypatch.setattr(admin_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(admin_routes, "_ensure_org_lifecycle_schema", lambda con: None)

    result = admin_routes.update_organisation_member(
        "org-123",
        "u2",
        {"role": "Administrator"},
        _user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123", "role": "Administrator"},
    )

    assert result["ok"] is True
    assert result["member"]["role"] == "Owner"
    assert result["member"]["is_owner"] is True
    assert any("SET role = CASE WHEN lower(user_id)" in sql for sql, _ in fake.executed)


def test_current_org_summary_falls_back_when_org_row_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _MissingOrgConn()
    monkeypatch.setattr(auth_routes, "get_conn", lambda: fake)

    result = auth_routes.me(user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123"})

    assert result["current_org"]["org_id"] == "org-123"
    assert result["current_org"]["name"] == "org-123"
    assert result["current_org"]["slug"] is None
    assert any("FROM organisations" in sql for sql, _ in fake.executed)
