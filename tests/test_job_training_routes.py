from __future__ import annotations

import asyncio
import io
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.responses import FileResponse
from fastapi import UploadFile

import api.job_training_routes as job_training_routes


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
