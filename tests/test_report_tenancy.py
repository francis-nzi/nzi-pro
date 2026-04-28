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


class _InsertCheckingConn:
    def __init__(self):
        self.executed: list[tuple[str, list[object] | None]] = []
        self._insert_index = 0

    def execute(self, sql: str, params: list[object] | None = None):
        self.executed.append((sql, params))
        if "INSERT INTO job_files" in sql or "INSERT INTO job_report_versions" in sql:
            expected = sql.count("%s")
            actual = len(params or [])
            assert actual == expected, (expected, actual, sql)
            self._insert_index += 1
        return self

    def fetchone(self):
        if not self.executed:
            return None
        sql = self.executed[-1][0]
        if "INSERT INTO job_files" in sql:
            return [101]
        if "INSERT INTO job_report_versions" in sql:
            return [202]
        if "SELECT COALESCE(MAX(version_number), 0) + 1" in sql:
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


def test_report_version_artifact_insert_matches_placeholders(monkeypatch, tmp_path):
    fake = _InsertCheckingConn()
    monkeypatch.setattr(job_report_routes, "get_conn", lambda **kwargs: fake)
    monkeypatch.setattr(job_report_routes, "_ensure_job_files_table", lambda con: None)
    monkeypatch.setattr(job_report_routes, "_ensure_report_versions_schema", lambda con: None)
    monkeypatch.setattr(job_report_routes, "_files_onedrive_enabled", lambda: False)
    monkeypatch.setattr(job_report_routes, "JOB_FILES_UPLOAD_DIR", tmp_path)

    result = job_report_routes._store_report_version_artifact(
        con=fake,
        job_data={
            "job_id": 3,
            "client_db_id": 5,
            "org_id": "org-1",
            "job_number": "J000003",
            "client_name": "Hana Group",
        },
        version_number=1,
        pdf_bytes=b"pdf-bytes",
        generated_by="tester@example.com",
        status="review",
        template_id=11,
        template_version_id=22,
        data_hash="hash-123",
        snapshot_json="{\"ok\": true}",
        version_label="v1",
        notes="note",
    )

    assert result["report_version_id"] == 202
    assert result["file_id"] == 101


def test_report_template_assignment_persists_org_id(monkeypatch):
    fake = _FakeConn()
    monkeypatch.setattr(report_template_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(report_template_routes, "_ensure_report_template_schema", lambda con: None)
    monkeypatch.setattr(report_template_routes, "_get_job_client_id", lambda con, job_id: 1)
    monkeypatch.setattr(report_template_routes, "_get_job_org_id", lambda con, job_id: "org-1")

    payload = report_template_routes.AssignTemplatePayload(template_id=5, version_id=6)
    report_template_routes.upsert_job_report_template_assignment(10, payload, _user={"email": "tester@example.com"})

    assert any("org_id" in sql and "job_report_template_assignments" in sql for sql, _ in fake.executed)
