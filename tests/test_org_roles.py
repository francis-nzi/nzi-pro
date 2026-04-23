from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi import HTTPException

import api.admin_routes as admin_routes


class _FakeRow:
    def __init__(self, *values: object):
        self.values = values

    def __getitem__(self, idx: int) -> object:
        return self.values[idx]


class _RoleConn:
    def __init__(self):
        self.executed: list[tuple[str, list[object] | None]] = []
        self._transfer_complete = False
        self._mode = "admin"

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql: str, params: list[object] | None = None):
        self.executed.append((sql, params))
        if "UPDATE organisation_memberships" in sql and "SET role = CASE WHEN lower(user_id)" in sql:
            self._transfer_complete = True
        return self

    def fetchone(self):
        sql = self.executed[-1][0] if self.executed else ""
        if "SELECT org_id, user_id, role, is_active, is_owner" in sql and not self._transfer_complete:
            if self._mode == "owner":
                return _FakeRow("org-123", "u1", "Owner", True, True)
            return _FakeRow("org-123", "u1", "Admin", True, False)
        if "SELECT membership_id, org_id, user_id, role, is_active, is_owner" in sql:
            return _FakeRow("mem-1", "org-123", "u2", "Consultant", True, False)
        if "SELECT org_id, user_id, role, is_active, is_owner" in sql and self._transfer_complete:
            return _FakeRow("org-123", "u2", "Owner", True, True)
        if "SELECT COALESCE(max_users, 0), COALESCE(max_clients, 0), COALESCE(archived, FALSE), COALESCE(plan_status, 'active')" in sql:
            return _FakeRow(3, 10, False, "active")
        return None

    def fetchall(self):
        sql = self.executed[-1][0] if self.executed else ""
        if "FROM organisations" in sql:
            return [_FakeRow("org-123", "Acme Org", "acme-org", "trial", "active", 3, 10, False, None, None, "2026-04-23", "2026-04-23")]
        if "FROM organisation_memberships" in sql:
            return [
                _FakeRow("org-123", "Owner", True, True),
                _FakeRow("org-123", "Admin", True, False),
            ]
        return []


def test_list_organisations_exposes_role_capabilities(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _RoleConn()
    monkeypatch.setattr(admin_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(admin_routes, "_ensure_org_lifecycle_schema", lambda con: None)

    result = admin_routes.list_organisations(_user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123", "role": "Administrator"})

    assert result["current_capabilities"]["can_manage_members"] is True
    assert result["current_capabilities"]["can_transfer_ownership"] is False
    assert result["items"][0]["membership"]["capabilities"]["can_manage_members"] is True
    assert result["items"][0]["membership"]["capabilities"]["can_transfer_ownership"] is False


def test_admin_cannot_transfer_ownership(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _RoleConn()
    fake._mode = "admin"
    monkeypatch.setattr(admin_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(admin_routes, "_ensure_org_lifecycle_schema", lambda con: None)

    with pytest.raises(HTTPException) as exc_info:
        admin_routes.update_organisation_member(
            "org-123",
            "u2",
            {"role": "Owner"},
            _user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123", "role": "Administrator"},
        )

    assert exc_info.value.status_code == 403
    assert "owner role required" in str(exc_info.value.detail).lower()


def test_owner_can_transfer_ownership(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _RoleConn()
    fake._mode = "owner"
    monkeypatch.setattr(admin_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(admin_routes, "_ensure_org_lifecycle_schema", lambda con: None)

    transferred = admin_routes.transfer_organisation_ownership(
        "org-123",
        {"member_user_id": "u2"},
        _user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123", "role": "Owner"},
    )
    assert transferred["ok"] is True
    assert transferred["owner_user_id"] == "u2"
    assert any("UPDATE organisation_memberships" in sql for sql, _ in fake.executed)
