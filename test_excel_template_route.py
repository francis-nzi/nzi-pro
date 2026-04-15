from __future__ import annotations

import api.permissions as permissions_module
from fastapi.testclient import TestClient

from api.auth import _current_user
import services.generate_single_sheet_template as template_module

if not hasattr(permissions_module, "ADMIN_ACCESS_PERMISSION"):
    permissions_module.ADMIN_ACCESS_PERMISSION = "admin_access"

import api.main as main_module
from api.main import app


def test_job_excel_template_single_sheet_uses_helper_without_extra_reference_path(monkeypatch):
    captured = {}

    class FakeResult:
        def fetchone(self):
            return ("J000566", 2026, "2025-02-01", "2026-01-31", "First Event")

    class FakeConnection:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, *_args, **_kwargs):
            return FakeResult()

    def fake_get_conn():
        return FakeConnection()

    def fake_job_template_paths(job_id: int):
        assert job_id == 556
        return {"excel_template_path": "/tmp/fake-template.xlsx"}

    def fake_generate_single_sheet_template(**kwargs):
        captured.update(kwargs)
        return b"excel-bytes", "helper-name.xlsx"

    monkeypatch.setattr(main_module, "get_conn", fake_get_conn)
    monkeypatch.setattr(main_module, "_job_template_paths", fake_job_template_paths)
    monkeypatch.setattr(template_module, "generate_single_sheet_template", fake_generate_single_sheet_template)
    monkeypatch.setattr(main_module, "build_excel_template_bytes", lambda **_kwargs: (b"legacy-bytes", "legacy.xlsx"))

    app.dependency_overrides[_current_user] = lambda: {"sub": "test"}
    try:
        client = TestClient(app)
        response = client.get(
            "/jobs/556/excel-template",
            params={"site": "Registered Office", "include_prev_year": "true", "template_format": "single"},
        )
    finally:
        app.dependency_overrides.pop(_current_user, None)

    assert response.status_code == 200, response.text
    assert response.content == b"excel-bytes"
    assert response.headers["content-disposition"] == 'attachment; filename="J000566_First-Event_Registered-Office_2025-02-01-to-2026-01-31_data_upload.xlsx"'
    assert captured == {
        "job_id": 556,
        "client_name": "First Event",
        "site_name": "Registered Office",
        "job_number": "J000566",
        "reporting_year": "2026",
        "report_from": "",
        "report_to": "",
        "include_custom_factors": True,
        "include_prev_year": True,
    }
