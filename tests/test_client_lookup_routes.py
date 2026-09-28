from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
import pandas as pd

import api.client_dashboard_routes as client_dashboard_routes
import api.quotes_routes as quotes_routes


@pytest.fixture(autouse=True)
def _clear_client_dashboard_cache():
    client_dashboard_routes._dashboard_cache.clear()
    yield
    client_dashboard_routes._dashboard_cache.clear()


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
    conn = _FakeConn((
        "Advanced Electric Machines (AEM)", "London, UK", "GBP",
        "1 Example Road", "", "London", "", "SW1A 1AA", "United Kingdom",
        None, None, None, None, None, None, None,
    ))
    monkeypatch.setattr(quotes_routes, "assert_client_access", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(quotes_routes, "_quote_org_id", lambda *_args, **_kwargs: "org-a")
    monkeypatch.setattr(quotes_routes, "get_conn", lambda: conn)

    result = quotes_routes.quote_lookups(89, _user={"user_id": "u1", "org_id": "org-a"})

    assert result["client"]["client_name"] == "Advanced Electric Machines (AEM)"
    assert result["client"]["currency"] == "GBP"
    assert result["client"]["default_bill_to"] == (
        "Advanced Electric Machines (AEM)\n1 Example Road\nLondon\nSW1A 1AA\nUnited Kingdom"
    )
    assert any("FROM clients" in sql and "WHERE db_id = %s" in sql for sql, _ in conn.queries)


@pytest.mark.parametrize("billing_company", ["Ailsa ESG Solutions - Scotia Windows and Doors", None, "", "   "])
@pytest.mark.parametrize("use_billing_address", [True, False])
def test_quote_bill_to_uses_billing_company(monkeypatch, billing_company, use_billing_address):
    registered = ("Registered Road", "", "London", "", "SW1A 1AA", "UK")
    billing = ("Montgomerie House", "2A Byrehill Drive", "Kilwinning", "North Ayrshire", "KA13 6HN", "UK")
    conn = _FakeConn(("Scotia Windows and Doors", "", "GBP", *registered,
                      *(billing if use_billing_address else (None,) * 6), billing_company))
    monkeypatch.setattr(quotes_routes, "assert_client_access", lambda *a, **k: None)
    monkeypatch.setattr(quotes_routes, "_quote_org_id", lambda *a, **k: "org-a")
    monkeypatch.setattr(quotes_routes, "get_conn", lambda: conn)
    result = quotes_routes.quote_lookups(321, _user={"org_id": "org-a"})
    expected_name = (billing_company or "").strip() or "Scotia Windows and Doors"
    expected_address = billing if use_billing_address else registered
    assert result["client"]["default_bill_to"] == "\n".join(
        line for line in (expected_name, *expected_address) if line
    )
    assert result["client"]["client_name"] == "Scotia Windows and Doors"
    assert any("billing_company" in sql for sql, _ in conn.queries)


@pytest.mark.parametrize("saved_bill_to", [None, "", "Custom recipient\nCustom address"])
def test_invoice_bill_to_uses_billing_company_unless_quote_has_saved_address(monkeypatch, saved_bill_to):
    class InvoiceConn(_FakeConn):
        def fetchone(self):
            if "FROM invoices" in self._last_sql:
                return (1, 321, None, 29 if saved_bill_to is not None else None,
                        "INV-1", None, None, "GBP", 0, 0, 0, "Draft", "", None, 0,
                        None, None, None, None, None, None, None, None, "")
            if "FROM quotes" in self._last_sql:
                return ("", saved_bill_to, "", None, "Q-29")
            if "FROM clients" in self._last_sql:
                return ("Scotia Windows and Doors", "Registered Road", "", "", "", "", "",
                        "Montgomerie House", "", "Kilwinning", "", "KA13 6HN", "UK",
                        "Ailsa ESG Solutions - Scotia Windows and Doors")
            return None

    monkeypatch.setattr(quotes_routes, "_invoice_lines_for", lambda *a, **k: [])
    monkeypatch.setattr(quotes_routes, "get_company_profile", lambda *a, **k: {})
    result = quotes_routes._serialize_invoice(InvoiceConn(), 1, org_id="org-a")
    assert result["bill_to"] == (saved_bill_to or
        "Ailsa ESG Solutions - Scotia Windows and Doors\nMontgomerie House\nKilwinning\nKA13 6HN\nUK")
    assert result["client_name"] == "Scotia Windows and Doors"


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

    result = client_dashboard_routes.get_client_dashboard(89, lite=False, _user={"user_id": "u1", "org_id": "org-a"})

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

    result = client_dashboard_routes.get_client_dashboard(89, lite=False, _user={"user_id": "u1", "org_id": "org-a"})

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

    result = client_dashboard_routes.get_client_dashboard(89, lite=False, _user={"user_id": "u1", "org_id": "org-a"})

    assert result["available_years"] == [2025]
    assert result["selected_year"] == 2025
    assert result["current_metrics"]["total_emissions"] == 40.57
