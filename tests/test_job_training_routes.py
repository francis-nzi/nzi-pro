from __future__ import annotations

import asyncio
import io
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.responses import FileResponse
from fastapi import UploadFile

import api.job_training_routes as job_training_routes


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows

    def fetchone(self):
        return self._rows[0] if self._rows else None


class _FakeConn:
    def __init__(self, rows_by_query):
        self.rows_by_query = rows_by_query

    def execute(self, sql, params=None):
        for needle, rows in self.rows_by_query.items():
            if needle in sql:
                return _FakeResult(rows)
        raise AssertionError(f"Unexpected SQL: {sql}")


def test_download_training_document_file_prefers_primary_storage(monkeypatch, tmp_path):
    primary = tmp_path / "training_documents"
    legacy = tmp_path / "legacy_training_documents"
    primary.mkdir()
    legacy.mkdir()

    primary_file = primary / "training_pack.pdf"
    primary_file.write_bytes(b"primary-content")
    (legacy / "training_pack.pdf").write_bytes(b"legacy-content")

    monkeypatch.setattr(job_training_routes, "_TRAINING_DOCUMENTS_DIR", primary)
    monkeypatch.setattr(job_training_routes, "_LEGACY_TRAINING_DOCUMENTS_DIR", legacy)
    monkeypatch.setattr(job_training_routes, "assert_permission", lambda user, perm: None)

    response = job_training_routes.download_training_document_file(
        "training_pack.pdf",
        _user={"user_id": "u1", "org_id": "org-a"},
    )

    assert isinstance(response, FileResponse)
    assert Path(response.path) == primary_file


def test_download_training_document_file_falls_back_to_legacy_storage(monkeypatch, tmp_path):
    primary = tmp_path / "training_documents"
    legacy = tmp_path / "legacy_training_documents"
    primary.mkdir()
    legacy.mkdir()

    legacy_file = legacy / "training_pack.pdf"
    legacy_file.write_bytes(b"legacy-content")

    monkeypatch.setattr(job_training_routes, "_TRAINING_DOCUMENTS_DIR", primary)
    monkeypatch.setattr(job_training_routes, "_LEGACY_TRAINING_DOCUMENTS_DIR", legacy)
    monkeypatch.setattr(job_training_routes, "assert_permission", lambda user, perm: None)

    response = job_training_routes.download_training_document_file(
        "training_pack.pdf",
        _user={"user_id": "u1", "org_id": "org-a"},
    )

    assert isinstance(response, FileResponse)
    assert Path(response.path) == legacy_file


def test_upload_training_document_file_writes_to_primary_storage(monkeypatch, tmp_path):
    primary = tmp_path / "training_documents"
    monkeypatch.setattr(job_training_routes, "_TRAINING_DOCUMENTS_DIR", primary)
    monkeypatch.setattr(job_training_routes, "assert_permission", lambda user, perm: None)

    upload = UploadFile(file=io.BytesIO(b"pdf-bytes"), filename="Training Pack.pdf")
    response = asyncio.run(
        job_training_routes.upload_training_document_file(
            file=upload,
            _user={"user_id": "u1", "org_id": "org-a"},
        )
    )

    saved = Path(primary) / Path(response["file_url"].split("/download", 1)[0].rsplit("/", 1)[-1])
    assert saved.exists()
    assert saved.read_bytes() == b"pdf-bytes"
    assert response["file_name"] == "Training Pack.pdf"


def test_get_training_completion_pack_recipients_marks_sent_and_eligible(monkeypatch):
    monkeypatch.setattr(
        job_training_routes,
        "_get_run_bookings",
        lambda con, org_id, run_id: [
            {
                "training_booking_id": 11,
                "person_name": "Sarah McNabb",
                "person_email": "sarah@example.com",
                "client_name": "Bloom Procurement Services",
                "participant_type": "client_contact",
                "attendance_status": "attended",
                "billing_status": "included",
            },
            {
                "training_booking_id": 12,
                "person_name": "No Email",
                "person_email": None,
                "client_name": "No Email Co",
                "participant_type": "client_contact",
                "attendance_status": "attended",
                "billing_status": "included",
            },
        ],
    )
    fake_con = _FakeConn(
        {
            "FROM training_automation_log": [
                (11, 99, "sent", None, "Completion Pack", "2026-07-23 10:15:00", "2026-07-23 10:00:00", "Sarah McNabb", "sarah@example.com", "training-completion:77:11"),
            ]
        }
    )

    recipients = job_training_routes._get_training_completion_pack_recipients(fake_con, "org-a", 77)

    assert recipients[0]["training_booking_id"] == 11
    assert recipients[0]["sent_status"] == "sent"
    assert recipients[0]["can_send"] is False
    assert recipients[0]["sent_at"] == "2026-07-23 10:15:00"
    assert recipients[1]["training_booking_id"] == 12
    assert recipients[1]["sent_status"] == "not_eligible"
    assert recipients[1]["can_send"] is False


def test_run_training_course_automation_passes_selected_completion_pack_booking_ids(monkeypatch):
    captured = {}

    monkeypatch.setattr(job_training_routes, "assert_permission", lambda user, perm: None)
    monkeypatch.setattr(job_training_routes, "require_org", lambda user: "org-a")
    monkeypatch.setattr(job_training_routes, "_actor", lambda user: "tester")
    monkeypatch.setattr(job_training_routes, "_ensure_tables", lambda con: None)
    monkeypatch.setattr(job_training_routes, "_assert_run_access", lambda user, con, run_id, org_id: None)

    def fake_execute_training_completion_pack(con, **kwargs):
        captured["kwargs"] = kwargs
        return {"ok": True, "mode": kwargs["mode"], "trigger_key": "completion_pack", "planned": [], "sent_count": 0}

    monkeypatch.setattr(job_training_routes, "_execute_training_completion_pack", fake_execute_training_completion_pack)

    response = job_training_routes.run_training_course_automation(
        77,
        body={"trigger_key": "completion_pack", "mode": "send", "booking_ids": [11, "12"]},
        _user={"user_id": "u1", "org_id": "org-a"},
    )

    assert response["ok"] is True
    assert captured["kwargs"]["booking_ids"] == [11, 12]
    assert captured["kwargs"]["training_course_run_id"] == 77
