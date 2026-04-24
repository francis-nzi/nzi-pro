from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.admin_routes as admin_routes
import api.main as main
import api.time_routes as time_routes


class _FakeRow:
    def __init__(self, *values: object):
        self.values = values

    def __getitem__(self, idx: int) -> object:
        return self.values[idx]


class _ContractConn:
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
        params = self.executed[-1][1] or []

        if "SELECT 1 FROM organisations WHERE lower(slug)" in sql:
            return None
        if "INSERT INTO organisations" in sql and "RETURNING org_id, name, slug, plan, plan_status, max_users, max_clients, archived, archived_at, archived_by, created_at, updated_at" in sql:
            return _FakeRow("org-123", "Acme Org", "acme-org", "trial", "active", 3, 10, False, None, None, "2026-04-23", "2026-04-23")
        if "INSERT INTO organisation_invitations" in sql:
            return None
        if "SELECT org_id, name, slug, plan, plan_status, max_users, max_clients, archived, archived_at, archived_by, created_at, updated_at FROM organisations WHERE org_id = %s" in sql:
            return _FakeRow("org-123", "Acme Org", "acme-org", "trial", "active", 3, 10, False, None, None, "2026-04-23", "2026-04-23")
        if "SELECT invitation_id, org_id, email, role, accepted_at, expires_at" in sql:
            return _FakeRow("inv-1", "org-123", "user@example.com", "Consultant", None, "2026-05-01T00:00:00+00:00")
        if "SELECT 1 FROM jobs WHERE job_id = ?" in sql:
            return _FakeRow(1) if len(params) > 1 and params[1] == "org-a" else None
        if "SELECT 1 FROM jobs WHERE job_id = %s" in sql:
            return _FakeRow(1) if len(params) > 1 and params[1] == "org-a" else None
        if "FROM job_types" in sql:
            return _FakeRow(7, True)
        if "FROM clients" in sql and "benchmark_period_start" in sql:
            return _FakeRow(None, None, 12, None, None, 12)
        if "INSERT INTO jobs" in sql and "RETURNING job_id" in sql:
            return _FakeRow(640)
        if "SELECT 1 FROM jobs WHERE job_id = ?" in sql and "AND org_id = ?" in sql:
            return _FakeRow(1)
        if "SELECT 1 FROM jobs WHERE job_id = ?" in sql:
            return _FakeRow(1)
        if "SELECT 1 FROM jobs WHERE job_id = %s" in sql and "AND org_id = %s" in sql:
            return _FakeRow(1)
        if "SELECT 1 FROM jobs WHERE job_id = %s" in sql:
            return _FakeRow(1)
        if "FROM time_logs" in sql and "COUNT(*)" not in sql:
            return _FakeRow(1)
        if "INSERT INTO time_logs" in sql:
            return _FakeRow(88)
        return None

    def fetchall(self):
        return []


def _patch_org_schema(monkeypatch):
    monkeypatch.setattr(admin_routes, "_ensure_org_lifecycle_schema", lambda con: None)
    monkeypatch.setattr(admin_routes, "_ensure_org_entitlement_schema", lambda con: None)
    monkeypatch.setattr(admin_routes, "_ensure_org_billing_schema", lambda con: None)
    monkeypatch.setattr(admin_routes, "_require_org_management_role", lambda *args, **kwargs: None)
    monkeypatch.setattr(admin_routes, "_require_org_switch_role", lambda *args, **kwargs: None)
    monkeypatch.setattr(admin_routes, "_require_org_capacity", lambda *args, **kwargs: None)
    monkeypatch.setattr(admin_routes, "record_audit_event", lambda *args, **kwargs: None)


def test_create_organisation_contract(monkeypatch):
    fake = _ContractConn()
    _patch_org_schema(monkeypatch)
    monkeypatch.setattr(admin_routes, "get_conn", lambda: fake)

    result = admin_routes.create_organisation(
        {"name": "Acme Org", "plan": "trial", "max_users": 3, "max_clients": 10},
        _user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-old"},
    )

    assert result["ok"] is True
    assert set(result["organisation"]).issuperset({"org_id", "name", "slug", "plan", "plan_status", "max_users", "max_clients"})
    assert result["organisation"]["slug"] == "acme-org"
    assert any("INSERT INTO organisations" in sql for sql, _ in fake.executed)
    assert any("INSERT INTO organisation_memberships" in sql for sql, _ in fake.executed)


def test_invite_accept_switch_contract(monkeypatch):
    fake = _ContractConn()
    _patch_org_schema(monkeypatch)
    monkeypatch.setattr(admin_routes, "get_conn", lambda: fake)

    invite = admin_routes.invite_user_to_organisation(
        "org-123",
        {"email": "user@example.com", "role": "Consultant", "days_valid": 7},
        _user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123"},
    )
    assert invite["ok"] is True
    assert set(invite["invite"]).issuperset({"email", "role", "token", "expires_at"})

    accepted = admin_routes.accept_organisation_invitation(
        invite["invite"]["token"],
        _user={"user_id": "u2", "email": "user@example.com", "org_id": "org-old"},
    )
    assert accepted == {"ok": True, "org_id": "org-123", "email": "user@example.com", "role": "Consultant"}

    switched = admin_routes.switch_active_organisation(
        "org-123",
        _user={"user_id": "u2", "email": "user@example.com", "org_id": "org-old", "role": "Consultant"},
    )
    assert switched == {"ok": True, "org_id": "org-123"}


def test_create_job_contract(monkeypatch):
    fake = _ContractConn()
    monkeypatch.setattr(main, "get_conn", lambda: fake)
    monkeypatch.setattr(main, "assert_permission", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "assert_client_access", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "require_org", lambda _user: "org-a")
    monkeypatch.setattr(main, "_require_org_plan_active", lambda *args, **kwargs: None)
    monkeypatch.setattr(main, "_job_audit_snapshot", lambda con, job_id: {"job_id": job_id, "org_id": "org-a"})
    monkeypatch.setattr(main, "record_audit_event", lambda *args, **kwargs: None)

    result = main.create_job(
        request=None,
        body={
            "client_db_id": 58,
            "job_type": "CRP",
            "title": "Contract Test Job",
            "status": "Open",
            "reporting_year": 2026,
            "start_date": "2026-04-01",
            "due_date": "2026-04-30",
        },
        _user={"user_id": "u1", "org_id": "org-a"},
    )

    assert result["ok"] is True
    assert result["job_id"] == 640
    assert result["job_number"].startswith("J")
    assert {"reporting_period_start", "reporting_period_end", "is_benchmark"}.issubset(result)
    assert any("INSERT INTO jobs" in sql for sql, _ in fake.executed)


def test_create_time_log_contract(monkeypatch):
    fake = _ContractConn()
    monkeypatch.setattr(time_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(time_routes, "_ensure_time_tracking_schema", lambda con: None)
    monkeypatch.setattr(time_routes, "_column_exists", lambda con, table_name, column_name: True)
    monkeypatch.setattr(time_routes, "require_org", lambda _user: "org-a")

    result = time_routes.create_time_log(
        {"job_id": 55, "subject": "Work", "work_date": "2026-04-23", "minutes": 45, "notes": "Contract check"},
        _user={"user_id": "u1", "org_id": "org-a"},
    )

    assert result == {"time_id": 88, "message": "Time log created successfully"}
    assert any("INSERT INTO time_logs" in sql for sql, _ in fake.executed)
