from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.auth_routes as auth_routes


class _FakeRow:
    def __init__(self, *values: object):
        self.values = values

    def __getitem__(self, idx: int) -> object:
        return self.values[idx]


class _AuthConn:
    def __init__(self):
        self.executed: list[tuple[str, list[object] | None]] = []

    def execute(self, sql: str, params: list[object] | None = None):
        self.executed.append((sql, params))
        return self

    def fetchone(self):
        sql = self.executed[-1][0] if self.executed else ""
        if "FROM organisation_memberships" in sql:
            return _FakeRow("Admin", True, True)
        if "FROM organisations" in sql:
            return _FakeRow("org-123", "Acme Org", "acme-org", "trial", "active", False)
        return None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def test_me_includes_current_org_summary(monkeypatch):
    fake = _AuthConn()
    monkeypatch.setattr(auth_routes, "get_conn", lambda: fake)

    result = auth_routes.me(user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123"})

    assert result["current_org"]["org_id"] == "org-123"
    assert result["current_org"]["name"] == "Acme Org"
    assert result["current_org"]["slug"] == "acme-org"
    assert result["current_org"]["role"] == "Admin"
    assert any("FROM organisations" in sql for sql, _ in fake.executed)
