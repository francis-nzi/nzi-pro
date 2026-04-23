from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from types import SimpleNamespace

import api.job_report_routes as job_report_routes
import api.report_template_routes as report_template_routes


class _FakeConn:
    def __init__(self, row_map: dict[str, object] | None = None):
        self.row_map = row_map or {}
        self.executed: list[tuple[str, list[object] | None]] = []

    def execute(self, sql: str, params: list[object] | None = None):
        self.executed.append((sql, params))
        return self

    def fetchone(self):
        sql = self.executed[-1][0] if self.executed else ""
        if "SELECT client_db_id FROM jobs" in sql:
            return [1]
        if "SELECT c.org_id" in sql:
            return ["org-1"]
        if "SELECT template_id, is_active" in sql:
            return [1, True, True, 1]
        if "SELECT version_id" in sql and "report_template_versions" in sql:
            return [2]
        if "SELECT 1 FROM report_template_versions" in sql:
            return [1]
        return None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def df(self):
        return SimpleNamespace(empty=True, iterrows=lambda: [])


def test_report_template_schema_includes_org_columns(monkeypatch):
    fake = _FakeConn()
    report_template_routes._REPORT_TEMPLATE_SCHEMA_READY = False
    report_template_routes._seed_default_report_templates = lambda con: None
    report_template_routes.get_conn = lambda: fake

    report_template_routes._ensure_report_template_schema(fake)

    joined = "\n".join(sql for sql, _ in fake.executed)
    assert "job_report_variable_values" in joined
    assert "job_report_template_assignments" in joined
    assert "org_id TEXT" in joined


def test_report_version_and_draft_schema_include_org_columns(monkeypatch):
    fake = _FakeConn()
    job_report_routes._ensure_job_files_table = lambda con: None
    job_report_routes._ensure_report_versions_schema(fake)
    job_report_routes._ensure_report_drafts_schema(fake)

    joined = "\n".join(sql for sql, _ in fake.executed)
    assert "job_report_versions" in joined
    assert "job_report_drafts" in joined
    assert "org_id TEXT" in joined


def test_report_template_variable_save_persists_org_id(monkeypatch):
    fake = _FakeConn()
    monkeypatch.setattr(report_template_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(report_template_routes, "_ensure_report_template_schema", lambda con: None)
    monkeypatch.setattr(report_template_routes, "_get_job_client_id", lambda con, job_id: 1)
    monkeypatch.setattr(report_template_routes, "_get_job_org_id", lambda con, job_id: "org-1")
    monkeypatch.setattr(report_template_routes, "_resolve_effective_version_id", lambda con, job_id, template_id, version_id: 2)
    monkeypatch.setattr(report_template_routes, "_validate_template_version", lambda con, template_id, version_id: None)

    payload = [report_template_routes.JobVariableValue(variable_key="k1", variable_value="v1")]
    report_template_routes.save_job_report_variables(10, 20, payload, _user={"email": "tester@example.com"})

    assert any("org_id" in sql and "job_report_variable_values" in sql for sql, _ in fake.executed)


def test_report_template_assignment_persists_org_id(monkeypatch):
    fake = _FakeConn()
    monkeypatch.setattr(report_template_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(report_template_routes, "_ensure_report_template_schema", lambda con: None)
    monkeypatch.setattr(report_template_routes, "_get_job_client_id", lambda con, job_id: 1)
    monkeypatch.setattr(report_template_routes, "_get_job_org_id", lambda con, job_id: "org-1")

    payload = report_template_routes.AssignTemplatePayload(template_id=5, version_id=6)
    report_template_routes.upsert_job_report_template_assignment(10, payload, _user={"email": "tester@example.com"})

    assert any("org_id" in sql and "job_report_template_assignments" in sql for sql, _ in fake.executed)
