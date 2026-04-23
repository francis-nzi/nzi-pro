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
            return _FakeRow("org-123", "Acme Org", "acme-org", "trial", "active", 3, 10, "2026-04-23", "2026-04-23")
        if "SELECT org_id, name, slug, plan, plan_status, max_users, max_clients, created_at, updated_at FROM organisations WHERE org_id = %s" in sql:
            return _FakeRow("org-123", "Acme Org", "acme-org", "trial", "active", 3, 10, "2026-04-23", "2026-04-23")
        if "SELECT invitation_id, org_id, email, role, accepted_at, expires_at" in sql:
            return _FakeRow("inv-1", "org-123", "user@example.com", "Consultant", None, "2026-05-01T00:00:00+00:00")
        if "FROM organisation_memberships" in sql and "SELECT 1" in sql:
            return _FakeRow(1)
        if "SELECT org_id, name, slug, plan, plan_status, max_users, max_clients, created_at, updated_at FROM organisations" in sql:
            return _FakeRow("org-123", "Acme Org", "acme-org", "trial", "active", 3, 10, "2026-04-23", "2026-04-23")
        return None

    def fetchall(self):
        sql = self.executed[-1][0] if self.executed else ""
        if "FROM organisations" in sql:
            return [
                _FakeRow("org-123", "Acme Org", "acme-org", "trial", "active", 3, 10, "2026-04-23", "2026-04-23"),
                _FakeRow("org-456", "Other Org", "other-org", "active", "active", 5, 20, "2026-04-23", "2026-04-23"),
            ]
        if "FROM organisation_memberships" in sql:
            return [_FakeRow("org-123", "Administrator", True, True)]
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
