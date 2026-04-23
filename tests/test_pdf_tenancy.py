from __future__ import annotations

from pathlib import Path
import sys
import types
import asyncio

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.responses import Response
import pytest

import api.pdf_generation_routes as pdf_routes
import services.pdf_generation_tasks as pdf_tasks


class _FakeRow:
    def __init__(self, *values: object):
        self.values = values

    def __getitem__(self, idx: int) -> object:
        return self.values[idx]


class _FakeConn:
    def __init__(self):
        self.executed: list[tuple[str, list[object] | None]] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql: str, params: list[object] | tuple[object, ...] | None = None):
        self.executed.append((sql, list(params) if params is not None else None))
        if "FROM jobs j" in sql and "JOIN clients c" in sql:
            return self
        return self

    def fetchone(self):
        if not self.executed:
            return None
        sql = self.executed[-1][0]
        if "FROM jobs j" in sql and "JOIN clients c" in sql:
            return _FakeRow(5, "JOB-5")
        return None


def test_queue_pdf_generation_passes_org_id(monkeypatch):
    fake_conn = _FakeConn()
    captured: dict[str, object] = {}

    def fake_queue_pdf_generation(**kwargs):
        captured.update(kwargs)
        return "token-123"

    monkeypatch.setattr(pdf_routes, "get_conn", lambda: fake_conn)
    monkeypatch.setattr("services.pdf_generation_queue.queue_pdf_generation", fake_queue_pdf_generation)

    result = asyncio.run(
        pdf_routes.api_queue_pdf_generation(
            5,
            template_id=11,
            current_user={"id": "u1", "org_id": "org-123"},
        )
    )

    assert result["job_token"] == "token-123"
    assert captured["job_id"] == 5
    assert captured["template_id"] == 11
    assert captured["org_id"] == "org-123"
    assert any("JOIN clients c" in sql for sql, _ in fake_conn.executed)


def test_queue_pdf_generation_requires_org_id(monkeypatch):
    with pytest.raises(ValueError):
        from services.pdf_generation_queue import queue_pdf_generation

        queue_pdf_generation(job_id=5, template_id=11, user_id="u1", org_id=None)


def test_pdf_progress_and_cancel_are_org_scoped(monkeypatch):
    captured: dict[str, object] = {}

    class _StatusJob:
        def __init__(self, org_id: str):
            self.id = "token-123"
            self.meta = {"org_id": org_id, "progress": 12, "message": "Queued"}
            self.result = {"ok": True}
            self.exc_info = None
            self.is_finished = False
            self.is_failed = False

        def get_status(self):
            return "queued"

    class _Queue:
        def fetch_job(self, token: str):
            captured["token"] = token
            return _StatusJob("org-123")

    monkeypatch.setattr("services.pdf_generation_queue.get_pdf_queue", lambda: _Queue())
    monkeypatch.setattr("services.pdf_generation_queue.cancel_pdf_job", lambda job_token, org_id=None: org_id == "org-123")
    status = asyncio.run(
        pdf_routes.api_check_pdf_progress("token-123", current_user={"user_id": "u1", "org_id": "org-123"})
    )
    assert status["status"] == "queued"
    assert status["org_id"] == "org-123"

    not_found = asyncio.run(
        pdf_routes.api_check_pdf_progress("token-123", current_user={"user_id": "u1", "org_id": "org-other"})
    )
    assert not_found["status"] == "not_found"

    canceled = asyncio.run(
        pdf_routes.api_cancel_pdf_generation("token-123", current_user={"user_id": "u1", "org_id": "org-123"})
    )
    assert canceled["status"] == "canceled"


def test_pdf_worker_uses_org_context(monkeypatch, caplog):
    caplog.set_level("INFO")
    captured: dict[str, object] = {}

    class _MockJob:
        def __init__(self):
            self.id = "mock-job"
            self.meta = {}

        def save_meta(self):
            pass

    def fake_get_current_job():
        return _MockJob()

    def fake_get_job_data(job_id: int, org_id: str | None = None):
        captured["job_data_org_id"] = org_id
        return {
            "job_id": job_id,
            "org_id": org_id,
            "job_number": "JOB-5",
            "client_db_id": 10,
        }

    def fake_generate_report_with_assets(*, job_id: int, request, skip_validation: bool, save_version: bool, _user: dict):
        captured["render_user"] = _user
        captured["save_version"] = save_version
        return Response(content=b"pdf-bytes", headers={"X-Report-Version-Id": "9", "X-Report-File-Id": "5"})

    monkeypatch.setitem(sys.modules, "rq", types.SimpleNamespace(get_current_job=fake_get_current_job))
    monkeypatch.setattr("api.job_report_routes.get_job_data", fake_get_job_data)
    monkeypatch.setattr("api.job_report_routes.generate_report_with_assets", fake_generate_report_with_assets)

    result = pdf_tasks.generate_pdf_task(5, template_id=11, user_id="user@example.com", org_id="org-123")

    assert captured["job_data_org_id"] == "org-123"
    assert captured["render_user"]["org_id"] == "org-123"
    assert captured["save_version"] is True
    assert result["version_id"] == 9
    assert result["file_id"] == 5
    assert result["download_url"] == "/jobs/5/report-versions/9/download"
    assert any("org_id=org-123" in record.message for record in caplog.records)
