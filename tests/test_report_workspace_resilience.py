from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from types import SimpleNamespace

import api.job_report_routes as job_report_routes
import api.report_template_routes as report_template_routes


class _FakeConn:
    def __init__(self, row=None):
        self.row = row
        self.executed: list[tuple[str, list[object] | None]] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql: str, params: list[object] | None = None):
        self.executed.append((sql, params))
        return self

    def fetchone(self):
        return self.row

    def df(self):
        return SimpleNamespace(empty=True, iterrows=lambda: [])


def test_build_report_draft_context_survives_partial_helper_failures(monkeypatch):
    monkeypatch.setattr(
        job_report_routes,
        "get_job_data",
        lambda job_id: {
            "job_id": job_id,
            "client_name": "Blue Orange Brand Management Ltd",
            "reporting_year": 2026,
            "benchmark_year": 2025,
        },
    )
    monkeypatch.setattr(job_report_routes, "get_scope_totals", lambda job_id: (_ for _ in ()).throw(RuntimeError("scope")))
    monkeypatch.setattr(job_report_routes, "get_emissions_by_category", lambda job_id: (_ for _ in ()).throw(RuntimeError("categories")))
    monkeypatch.setattr(job_report_routes, "get_benchmark_emissions", lambda job_id, benchmark_year: (_ for _ in ()).throw(RuntimeError("benchmark")))
    monkeypatch.setattr(job_report_routes, "_resolve_benchmark_reference_job", lambda job_id, benchmark_year: (_ for _ in ()).throw(RuntimeError("resolve")))
    monkeypatch.setattr(job_report_routes, "get_job_report_actions_payload", lambda job_id: (_ for _ in ()).throw(RuntimeError("actions")))
    monkeypatch.setattr(job_report_routes, "_get_job_assigned_template_selection", lambda job_id: (_ for _ in ()).throw(RuntimeError("selection")))

    context = job_report_routes._build_report_draft_context(658, "crp_standard")

    assert context["job_id"] == 658
    assert context["template_key"] == "crp_standard"
    assert context["selected_template"] == {}
    assert context["scope_totals"]["Total"] == 0.0
    assert context["benchmark_totals"]["Total"] == 0.0
    assert context["categories"] == []
    assert context["previous_categories"] == []
    assert context["job_actions"] == {"items": [], "term_counts": {}}
    assert "Blue Orange Brand Management Ltd" in context["context_summary"]


def test_get_job_assigned_template_selection_ignores_null_assignment_row(monkeypatch):
    fake = _FakeConn(row=(None, None))
    monkeypatch.setattr(job_report_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(job_report_routes, "_get_template_selection", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("should not be called")))

    assert job_report_routes._get_job_assigned_template_selection(10) is None
