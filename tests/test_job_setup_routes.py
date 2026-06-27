from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.job_setup_routes as job_setup_routes


class _FakeConn:
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
        normalized = " ".join(self._last_sql.split())
        if "FROM jobs j" in normalized:
            return ("JOB-1", 2026, "2026-01-01", "2026-12-31", "Example Client", None)
        if "FROM job_templates jt" in normalized:
            return ("templates/example.xlsx", b"fake-template-bytes", "Example Template", "EXAMPLE")
        return None


def test_job_excel_template_allows_unsaved_template_selection(monkeypatch):
    fake = _FakeConn()
    captured: dict[str, object] = {}

    def fake_generate_single_sheet_template(**kwargs):
        captured.update(kwargs)
        return b"excel-bytes", "example.xlsx"

    monkeypatch.setattr(job_setup_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(job_setup_routes, "_job_template_paths", lambda job_id: {"excel_template_path": None, "crp_template_path": None})
    monkeypatch.setattr("services.generate_single_sheet_template.generate_single_sheet_template", fake_generate_single_sheet_template)

    response = job_setup_routes.job_excel_template(
        1,
        site="Registered Office",
        include_prev_year=True,
        template_format="single",
        template_id=101,
        _user={"email": "owner@example.com"},
    )

    assert response.status_code == 200
    assert response.media_type == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    assert captured["job_id"] == 1
    assert captured["reference_template_path"] is not None
    assert any("FROM job_templates jt" in sql for sql, _ in fake.executed)
