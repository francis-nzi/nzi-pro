from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.admin_routes as admin_routes


class _FakeRow:
    def __init__(self, *values: object):
        self.values = values

    def __getitem__(self, idx: int) -> object:
        return self.values[idx]


class _OrgConn:
    def __init__(self):
        self.executed: list[tuple[str, list[object] | None]] = []

    def execute(self, sql: str, params: list[object] | None = None):
        self.executed.append((sql, params))
        return self

    def fetchone(self):
        sql = self.executed[-1][0] if self.executed else ""
        if "SELECT 1 FROM organisations WHERE lower(slug)" in sql:
            return None
        if "INSERT INTO organisations" in sql:
            return _FakeRow("org-123", "Acme Org", "acme-org", "trial", "active", 3, 10, False, None, None, "2026-04-23", "2026-04-23")
        if "SELECT org_id, user_id, role, is_active, is_owner" in sql:
            return _FakeRow("org-123", "u1", "Owner", True, True)
        if "SELECT org_id, name, slug, plan, plan_status, max_users, max_clients, archived, archived_at, archived_by, created_at, updated_at FROM organisations WHERE org_id = %s" in sql:
            return _FakeRow("org-123", "Acme Org", "acme-org", "trial", "active", 3, 10, False, None, None, "2026-04-23", "2026-04-23")
        if "SELECT org_id, name, slug, plan, plan_status, max_users, max_clients, archived, archived_at, archived_by, created_at, updated_at" in sql and "FROM organisations" in sql:
            return _FakeRow("org-123", "Acme Org", "acme-org", "trial", "active", 3, 10, False, None, None, "2026-04-23", "2026-04-23")
        if "SELECT invitation_id, org_id, email, role, accepted_at, expires_at" in sql:
            return _FakeRow("inv-1", "org-123", "user@example.com", "Consultant", None, "2026-05-01T00:00:00+00:00")
        if "SELECT membership_id, org_id, user_id, role, is_active, is_owner" in sql:
            return _FakeRow("mem-1", "org-123", "u2", "Consultant", True, False)
        if "FROM organisation_memberships" in sql and "SELECT 1" in sql:
            return _FakeRow(1)
        if "RETURNING org_id, user_id, role, is_active, is_owner" in sql and "UPDATE organisation_memberships" in sql:
            return _FakeRow("org-123", "u2", "Billing", True, False)
        if "SELECT org_id, name, slug, plan, plan_status, max_users, max_clients, archived, archived_at, archived_by, created_at, updated_at FROM organisations" in sql:
            return _FakeRow("org-123", "Acme Org", "acme-org", "trial", "active", 3, 10, False, None, None, "2026-04-23", "2026-04-23")
        if "UPDATE organisations" in sql and "RETURNING org_id, name, slug, plan, plan_status, max_users, max_clients, archived, archived_at, archived_by, created_at, updated_at" in sql:
            executed_params = self.executed[-1][1] or []
            archived = bool(executed_params[0]) if executed_params else False
            return _FakeRow("org-123", "Acme Org", "acme-org", "trial", "active", 3, 10, archived, "2026-04-23", "tester", "2026-04-23", "2026-04-23")
        if "UPDATE organisation_memberships" in sql and "SET role = CASE WHEN lower(user_id)" in sql:
            return _FakeRow("org-123", "u2", "Owner", True, True)
        return None

    def fetchall(self):
        sql = self.executed[-1][0] if self.executed else ""
        if "FROM organisations" in sql:
            return [
                _FakeRow("org-123", "Acme Org", "acme-org", "trial", "active", 3, 10, False, None, None, "2026-04-23", "2026-04-23"),
                _FakeRow("org-456", "Other Org", "other-org", "active", "active", 5, 20, False, None, None, "2026-04-23", "2026-04-23"),
            ]
        if "FROM organisation_memberships m" in sql:
            return [
                _FakeRow("org-123", "u1", "Owner Name", "owner@example.com", "Owner", True, True, "2026-04-23", "2026-04-23"),
                _FakeRow("org-123", "u2", "Member Name", "user@example.com", "Consultant", True, False, "2026-04-23", "2026-04-23"),
            ]
        if "FROM organisation_memberships" in sql:
            return [_FakeRow("org-123", "Owner", True, True)]
        return []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def test_create_organisation_persists_membership(monkeypatch):
    fake = _OrgConn()
    monkeypatch.setattr(admin_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(admin_routes, "_ensure_org_lifecycle_schema", lambda con: None)

    result = admin_routes.create_organisation(
        {"name": "Acme Org", "plan": "growth", "max_users": 12, "max_clients": 50},
        _user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-old"},
    )

    assert result["ok"] is True
    assert result["organisation"]["slug"] == "acme-org"
    assert any("INSERT INTO organisations" in sql for sql, _ in fake.executed)
    assert any("INSERT INTO organisation_memberships" in sql for sql, _ in fake.executed)
    assert any("UPDATE users SET org_id" in sql for sql, _ in fake.executed)


def test_invite_accept_and_switch_organisation(monkeypatch):
    fake = _OrgConn()
    monkeypatch.setattr(admin_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(admin_routes, "_ensure_org_lifecycle_schema", lambda con: None)

    invite = admin_routes.invite_user_to_organisation(
        "org-123",
        {"email": "user@example.com", "role": "Consultant", "days_valid": 7},
        _user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123"},
    )
    assert invite["ok"] is True
    assert invite["invite"]["token"]
    assert any("INSERT INTO organisation_invitations" in sql for sql, _ in fake.executed)

    accepted = admin_routes.accept_organisation_invitation(
        invite["invite"]["token"],
        _user={"user_id": "u2", "email": "user@example.com", "org_id": "org-old"},
    )
    assert accepted["ok"] is True
    assert any("INSERT INTO organisation_memberships" in sql for sql, _ in fake.executed)
    assert any("UPDATE users SET org_id" in sql for sql, _ in fake.executed)
    assert any("UPDATE organisation_invitations SET accepted_at" in sql for sql, _ in fake.executed)

    switched = admin_routes.switch_active_organisation(
        "org-123",
        _user={"user_id": "u2", "email": "user@example.com", "org_id": "org-old", "role": "Consultant"},
    )
    assert switched["ok"] is True
    assert any("FROM organisation_memberships" in sql for sql, _ in fake.executed)
    assert any("UPDATE users SET org_id" in sql for sql, _ in fake.executed)


def test_list_organisations_reports_membership(monkeypatch):
    fake = _OrgConn()
    monkeypatch.setattr(admin_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(admin_routes, "_ensure_org_lifecycle_schema", lambda con: None)

    result = admin_routes.list_organisations(_user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123"})

    assert result["active_org_id"] == "org-123"
    assert len(result["items"]) == 2
    assert result["items"][0]["is_member"] is True
    assert result["items"][0]["can_manage"] is True
    assert result["items"][0]["can_switch"] is True


def test_list_and_update_organisation_members(monkeypatch):
    fake = _OrgConn()
    monkeypatch.setattr(admin_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(admin_routes, "_ensure_org_lifecycle_schema", lambda con: None)

    members = admin_routes.list_organisation_members("org-123", _user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123", "role": "Administrator"})
    assert len(members["items"]) == 2
    assert members["items"][0]["role"] == "Owner"

    updated = admin_routes.update_organisation_member(
        "org-123",
        "u2",
        {"role": "Billing"},
        _user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123", "role": "Administrator"},
    )
    assert updated["ok"] is True
    assert updated["member"]["role"] == "Billing"
    assert any("UPDATE organisation_memberships" in sql for sql, _ in fake.executed)


def test_archive_reactivate_and_transfer_organisation(monkeypatch):
    fake = _OrgConn()
    monkeypatch.setattr(admin_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(admin_routes, "_ensure_org_lifecycle_schema", lambda con: None)

    archived = admin_routes.archive_organisation(
        "org-123",
        {"archived": True},
        _user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123", "role": "Administrator"},
    )
    assert archived["ok"] is True
    assert archived["organisation"]["archived"] is True
    assert any("UPDATE organisations" in sql and "archived = %s" in sql for sql, _ in fake.executed)

    restored = admin_routes.archive_organisation(
        "org-123",
        {"archived": False},
        _user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123", "role": "Administrator"},
    )
    assert restored["ok"] is True
    assert restored["organisation"]["archived"] is False

    transferred = admin_routes.transfer_organisation_ownership(
        "org-123",
        {"member_user_id": "u2"},
        _user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123", "role": "Administrator"},
    )
    assert transferred["ok"] is True
    assert transferred["owner_user_id"] == "u2"
