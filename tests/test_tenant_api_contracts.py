from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.admin_routes as admin_routes
import api.client_management_routes as client_routes
import api.main as main
import api.job_management_routes as job_routes
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
            return _FakeRow("inv-1", "org-123", "user@example.com", "Consultant", None, "2026-05-08T00:00:00+00:00")
        if "SELECT 1 FROM jobs WHERE job_id = ?" in sql:
            return _FakeRow(1) if len(params) > 1 and params[1] == "org-a" else None
        if "SELECT 1 FROM jobs WHERE job_id = %s" in sql:
            return _FakeRow(1) if len(params) > 1 and params[1] == "org-a" else None
        if "FROM job_types" in sql:
            return _FakeRow(7, True)
        if "FROM clients" in sql and "benchmark_period_start" in sql:
            return _FakeRow(None, None, 12, None, None, 12)
        if "SELECT" in sql and "FROM clients" in sql and "billing_same_as_main" in sql and "LIMIT 1" in sql:
            return _FakeRow(
                "org-a",
                "1 Main St",
                None,
                "London",
                None,
                "SW1A 1AA",
                "UK",
                True,
                "1 Main St",
                None,
                "London",
                None,
                "SW1A 1AA",
                "UK",
            )
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
    monkeypatch.setattr(job_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(job_routes, "assert_permission", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(job_routes, "assert_client_access", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(job_routes, "require_org", lambda _user: "org-a")
    monkeypatch.setattr(job_routes, "_require_org_plan_active", lambda *args, **kwargs: None)
    monkeypatch.setattr(job_routes, "_job_audit_snapshot", lambda con, job_id: {"job_id": job_id, "org_id": "org-a"})
    monkeypatch.setattr(job_routes, "record_audit_event", lambda *args, **kwargs: None)

    result = job_routes.create_job(
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
    insert_sql, insert_params = next((sql, params) for sql, params in fake.executed if "INSERT INTO jobs" in sql)
    assert "org_id" in insert_sql
    assert insert_params is not None and insert_params[1] == "org-a"


def test_update_client_benchmark_contract(monkeypatch):
    fake = _ContractConn()
    monkeypatch.setattr(client_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(client_routes, "assert_permission", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(client_routes, "assert_client_access", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(client_routes, "require_org", lambda _user: "org-a")
    monkeypatch.setattr(client_routes, "_client_audit_snapshot", lambda con, client_db_id, org_id: {"client_db_id": client_db_id, "org_id": org_id})
    monkeypatch.setattr(client_routes, "record_audit_event", lambda *args, **kwargs: None)
    monkeypatch.setattr(client_routes, "_ensure_client_org_columns", lambda con: None)
    monkeypatch.setattr(client_routes, "_ensure_client_billing_columns", lambda con: None)

    result = client_routes.update_client(
        request=None,
        client_db_id=58,
        body={
            "benchmark_year": 2024,
            "benchmark_period_start": "2024-01-01",
            "benchmark_period_end": "2024-12-31",
            "benchmark_scope_1_tco2e": 12.3,
            "benchmark_scope_2_tco2e": 0.0,
            "benchmark_scope_3_tco2e": 45.6,
            "benchmark_total_tco2e": 57.9,
        },
        _user={"user_id": "u1", "org_id": "org-a"},
    )

    assert result["ok"] is True
    update_sql, update_params = next((sql, params) for sql, params in fake.executed if sql.strip().startswith("UPDATE clients"))
    assert "benchmark_year" in update_sql
    assert "benchmark_period_start" in update_sql
    assert "benchmark_period_end" in update_sql
    assert "benchmark_scope_1_tco2e" in update_sql
    assert "benchmark_scope_2_tco2e" in update_sql
    assert "benchmark_scope_3_tco2e" in update_sql
    assert "benchmark_total_tco2e" in update_sql
    assert update_params is not None


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
