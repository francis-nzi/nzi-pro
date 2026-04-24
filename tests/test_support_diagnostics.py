from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.main as main_module


class _FakeConn:
    def __init__(self):
        self.executed: list[tuple[str, list[object] | None]] = []

    def execute(self, sql: str, params: list[object] | None = None):
        self.executed.append((sql, params))
        return self

    def fetchone(self):
        sql = self.executed[-1][0] if self.executed else ""
        if "current_database()" in sql:
            return ("postgres", "postgres", "2a05:d018:135e:16da:ee57:eae0:1ad5:259b", 5432, "PostgreSQL 17.6")
        return None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def test_support_diagnostics_includes_session_and_database(monkeypatch):
    fake_conn = _FakeConn()
    monkeypatch.setattr(main_module, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(
        main_module,
        "_current_org_summary",
        lambda user: {
            "org_id": "org-123",
            "name": "Acme Org",
            "slug": "acme-org",
            "role": "Admin",
            "archived": False,
        },
    )

    result = main_module.support_diagnostics(
        user={
            "user_id": "u1",
            "email": "owner@example.com",
            "role": "Admin",
            "org_id": "org-123",
            "mfa_enabled": True,
            "must_change_password": False,
            "is_super_admin": False,
            "effective_permissions": ["admin.access", "admin.organisations"],
        }
    )

    assert result["database"]["db_name"] == "postgres"
    assert result["session"]["user_id"] == "u1"
    assert result["session"]["email"] == "owner@example.com"
    assert result["session"]["effective_permissions"] == ["admin.access", "admin.organisations"]
    assert result["current_org"]["name"] == "Acme Org"
    assert result["can_manage_organisations"] is True
    assert any("current_database()" in sql for sql, _ in fake_conn.executed)
