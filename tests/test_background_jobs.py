from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

import api.admin_routes as admin_routes


class _FakeJob:
    def __init__(self, *, token: str = "job-123", status: str = "failed"):
        self.id = token
        self.func_name = "services.pdf_generation_tasks.generate_pdf_task"
        self.args = (5,)
        self.kwargs = {"template_id": 11, "user_id": "u1", "org_id": "org-1"}
        self.timeout = 300
        self.result_ttl = 3600
        self.meta = {"org_id": "org-1", "user_id": "u1", "job_id": 5, "template_id": 11, "message": "Queued"}
        self.created_at = datetime(2026, 4, 24, 11, 0, tzinfo=timezone.utc)
        self.started_at = None
        self.ended_at = datetime(2026, 4, 24, 11, 5, tzinfo=timezone.utc)
        self._status = status
        self.exc_info = "boom"
        self.result = {"ok": True}
        self.is_failed = status == "failed"
        self.is_finished = status == "finished"

    def get_status(self):
        return self._status

    def save_meta(self):
        self.meta_saved = dict(self.meta)


class _FakeQueue:
    def __init__(self, job: _FakeJob):
        self.job = job
        self.name = "pdf_generation"
        self.job_ids = [job.id]
        self.connection = SimpleNamespace(
            connection_pool=SimpleNamespace(connection_kwargs={"host": "localhost", "port": 6379, "db": 0})
        )
        self.enqueued: dict[str, object] | None = None

    def __len__(self):
        return 1

    def fetch_job(self, token: str):
        return self.job if token == self.job.id else None

    def enqueue(self, func_name, *args, **kwargs):
        self.enqueued = {"func_name": func_name, "args": args, "kwargs": kwargs}
        replayed = _FakeJob(token="job-456", status="queued")
        replayed.meta = {}
        self.replayed_job = replayed
        return replayed


def test_background_jobs_status_uses_snapshot(monkeypatch):
    monkeypatch.setattr(
        admin_routes,
        "_bg_monitor_snapshot",
        lambda: {
            "queue_name": "pdf_generation",
            "counts": {"queued": 1, "failed": 2, "started": 0, "deferred": 0, "finished": 0, "canceled": 0},
            "jobs": [{"job_token": "job-123", "status": "failed"}],
            "connection": {"host": "localhost"},
        },
    )

    result = admin_routes.background_jobs_status(_user={"user_id": "u1", "email": "owner@example.com"})

    assert result["ok"] is True
    assert result["counts"]["failed"] == 2
    assert result["jobs"][0]["status"] == "failed"


def test_background_job_replay_requeues_failed_job(monkeypatch):
    job = _FakeJob()
    queue = _FakeQueue(job)
    monkeypatch.setattr(admin_routes, "get_pdf_queue", lambda: queue)

    result = admin_routes.replay_background_job(
        {"job_token": "job-123"},
        _user={"user_id": "u1", "email": "owner@example.com"},
    )

    assert result["ok"] is True
    assert result["original_job_token"] == "job-123"
    assert result["replayed_job_token"] == "job-456"
    assert queue.enqueued is not None
    assert queue.enqueued["func_name"] == "services.pdf_generation_tasks.generate_pdf_task"
    assert queue.enqueued["args"] == job.args
    assert queue.enqueued["kwargs"]["org_id"] == "org-1"
    assert queue.replayed_job.meta_saved["replayed_from"] == "job-123"


def test_background_job_replay_rejects_running_job(monkeypatch):
    job = _FakeJob(status="started")
    queue = _FakeQueue(job)
    monkeypatch.setattr(admin_routes, "get_pdf_queue", lambda: queue)

    with pytest.raises(admin_routes.HTTPException) as exc_info:
        admin_routes.replay_background_job(
            {"job_token": "job-123"},
            _user={"user_id": "u1", "email": "owner@example.com"},
        )

    assert exc_info.value.status_code == 409
