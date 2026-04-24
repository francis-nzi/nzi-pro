from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd

import api.client_dashboard_routes as client_dashboard_routes
import api.quotes_routes as quotes_routes


class _FakeConn:
    def __init__(self, row=None):
        self.row = row
        self.queries: list[tuple[str, list[object] | None]] = []
        self._last_sql = ""

    def execute(self, sql: str, params: list[object] | None = None):
        self.queries.append((sql, params))
        self._last_sql = sql
        return self

    def fetchone(self):
        return self.row

    def df(self):
        return pd.DataFrame([])

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class _DashboardConn(_FakeConn):
    def fetchone(self):
        sql = self._last_sql
        if "SELECT industry, net_zero_year FROM clients" in sql:
            return ("Engineering", 2030)
        return None


def test_quote_lookups_allows_client_row_without_org_filter(monkeypatch) -> None:
    conn = _FakeConn(("Advanced Electric Machines (AEM)", "London, UK", "GBP"))
    monkeypatch.setattr(quotes_routes, "assert_client_access", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(quotes_routes, "_quote_org_id", lambda *_args, **_kwargs: "org-a")
    monkeypatch.setattr(quotes_routes, "get_conn", lambda: conn)

    result = quotes_routes.quote_lookups(89, _user={"user_id": "u1", "org_id": "org-a"})

    assert result["client"]["client_name"] == "Advanced Electric Machines (AEM)"
    assert result["client"]["currency"] == "GBP"
    assert any("FROM clients" in sql and "WHERE db_id = %s" in sql for sql, _ in conn.queries)


def test_client_dashboard_jobs_use_job_org_matching(monkeypatch) -> None:
    conn = _FakeConn()
    monkeypatch.setattr(client_dashboard_routes, "get_conn", lambda: conn)

    client_dashboard_routes._load_client_jobs(conn, 89, "org-a", crp_only=True)

    assert any("COALESCE(j.org_id, c.org_id) = %s" in sql for sql, _ in conn.queries)


def test_client_dashboard_uses_exact_emissions_totals(monkeypatch) -> None:
    conn = _DashboardConn()
    jobs_df = pd.DataFrame(
        [
            {
                "job_id": 627,
                "reporting_year": 2025,
                "dashboard_year": 2025,
                "title": "Lendco Annual Support 2025",
            }
        ]
    )
    emissions_df = pd.DataFrame(
        [
            {
                "job_id": 627,
                "dashboard_year": 2025,
                "dashboard_year_norm": 2025,
                "scope": "Scope 3",
                "category": "Office",
                "emissions": 40.57,
                "record_type": "source_register",
            },
            {
                "job_id": 627,
                "dashboard_year": pd.NA,
                "dashboard_year_norm": pd.NA,
                "scope": "Scope 3",
                "category": "Ignored",
                "emissions": 1.0,
                "record_type": "source_register",
            }
        ]
    )

    monkeypatch.setattr(client_dashboard_routes, "get_conn", lambda: conn)
    monkeypatch.setattr(client_dashboard_routes, "assert_client_access", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(client_dashboard_routes, "require_org", lambda *_args, **_kwargs: "org-a")
    monkeypatch.setattr(client_dashboard_routes, "_load_client_jobs", lambda *_args, **_kwargs: jobs_df)
    monkeypatch.setattr(client_dashboard_routes, "load_combined_reporting_rows", lambda *_args, **_kwargs: emissions_df)
    monkeypatch.setattr(client_dashboard_routes, "attach_exact_emissions", lambda _con, rows_df: rows_df)
    monkeypatch.setattr(client_dashboard_routes, "get_client_benchmark_metrics", lambda *_args, **_kwargs: None)

    result = client_dashboard_routes.get_client_dashboard(89, _user={"user_id": "u1", "org_id": "org-a"})

    assert result["available_years"] == [2025]
    assert result["selected_year"] == 2025
    assert result["current_metrics"]["total_emissions"] == 40.57
    assert result["top_categories"][0]["category"] == "Office"
    assert result["top_categories"][0]["emissions"] == 40.57


def test_client_dashboard_falls_back_to_summary_when_exact_empty(monkeypatch) -> None:
    conn = _DashboardConn()
    jobs_df = pd.DataFrame(
        [
            {
                "job_id": 627,
                "reporting_year": 2025,
                "dashboard_year": 2025,
                "title": "Lendco Annual Support 2025",
            }
        ]
    )
    summary_rows_df = pd.DataFrame(
        [
            {
                "job_id": 627,
                "dashboard_year": 2025,
                "scope": "Scope 3",
                "category": "Office",
                "emissions": 40.57,
                "record_type": "source_register",
            }
        ]
    )

    monkeypatch.setattr(client_dashboard_routes, "get_conn", lambda: conn)
    monkeypatch.setattr(client_dashboard_routes, "assert_client_access", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(client_dashboard_routes, "require_org", lambda *_args, **_kwargs: "org-a")
    monkeypatch.setattr(client_dashboard_routes, "_load_client_jobs", lambda *_args, **_kwargs: jobs_df)
    monkeypatch.setattr(client_dashboard_routes, "load_combined_reporting_rows", lambda *_args, **_kwargs: pd.DataFrame([]))
    monkeypatch.setattr(client_dashboard_routes, "attach_exact_emissions", lambda _con, rows_df: rows_df)
    monkeypatch.setattr(client_dashboard_routes, "load_combined_emissions_summary_rows", lambda *_args, **_kwargs: summary_rows_df)
    monkeypatch.setattr(client_dashboard_routes, "get_client_benchmark_metrics", lambda *_args, **_kwargs: None)

    result = client_dashboard_routes.get_client_dashboard(89, _user={"user_id": "u1", "org_id": "org-a"})

    assert result["available_years"] == [2025]
    assert result["selected_year"] == 2025
    assert result["current_metrics"]["total_emissions"] == 40.57
    assert result["top_categories"][0]["category"] == "Office"


def test_client_dashboard_falls_back_when_summary_years_are_missing(monkeypatch) -> None:
    conn = _DashboardConn()
    jobs_df = pd.DataFrame(
        [
            {
                "job_id": 627,
                "reporting_year": 2025,
                "dashboard_year": 2025,
                "title": "Lendco Annual Support 2025",
            }
        ]
    )
    summary_rows_df = pd.DataFrame(
        [
            {
                "job_id": 627,
                "dashboard_year": pd.NA,
                "scope": "Scope 3",
                "category": "Office",
                "emissions": 0.0,
                "record_type": "source_register",
            }
        ]
    )
    exact_rows_df = pd.DataFrame(
        [
            {
                "job_id": 627,
                "dashboard_year": 2025,
                "scope": "Scope 3",
                "category": "Office",
                "emissions": 40.57,
                "record_type": "legacy",
            }
        ]
    )

    monkeypatch.setattr(client_dashboard_routes, "get_conn", lambda: conn)
    monkeypatch.setattr(client_dashboard_routes, "assert_client_access", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(client_dashboard_routes, "require_org", lambda *_args, **_kwargs: "org-a")
    monkeypatch.setattr(client_dashboard_routes, "_load_client_jobs", lambda *_args, **_kwargs: jobs_df)
    monkeypatch.setattr(client_dashboard_routes, "load_combined_emissions_summary_rows", lambda *_args, **_kwargs: summary_rows_df)
    monkeypatch.setattr(client_dashboard_routes, "load_combined_reporting_rows", lambda *_args, **_kwargs: exact_rows_df)
    monkeypatch.setattr(client_dashboard_routes, "attach_exact_emissions", lambda _con, rows_df: rows_df)
    monkeypatch.setattr(client_dashboard_routes, "get_client_benchmark_metrics", lambda *_args, **_kwargs: None)

    result = client_dashboard_routes.get_client_dashboard(89, _user={"user_id": "u1", "org_id": "org-a"})

    assert result["available_years"] == [2025]
    assert result["selected_year"] == 2025
    assert result["current_metrics"]["total_emissions"] == 40.57
