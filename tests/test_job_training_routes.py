from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.responses import FileResponse

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
