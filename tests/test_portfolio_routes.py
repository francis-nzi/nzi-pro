from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.portal_auth_routes as portal_auth_routes
import api.portfolio_routes as portfolio_routes
import services.portfolio as portfolio_service


class _FakeRow:
    def __init__(self, *values: object):
        self.values = values

    def __getitem__(self, idx: int) -> object:
        return self.values[idx]


class _PortfolioConn:
    def __init__(self):
        self.executed: list[tuple[str, list[object] | None]] = []
        self._last_sql = ""

    def execute(self, sql: str, params: list[object] | None = None):
        self.executed.append((sql, params))
        self._last_sql = sql
        return self

    def fetchone(self):
        sql = self._last_sql
        if "FROM clients" in sql and "WHERE db_id = %s" in sql and "SELECT status, org_id" in sql:
            return _FakeRow("Portfolio Owner", "org-123")
        if "FROM clients" in sql and "WHERE db_id = %s" in sql:
            return _FakeRow(
                10, "Acme Holdings", "Consultancy", "Portfolio owner group", "https://acme.example",
                "December", "CR123", "SIC-1", "HQ", "1 High St", None, "London", "London", "SW1A 1AA",
                "UK", None, "Owner CRM", "Morgan", "Portfolio Owner", "Acme Group", 2035, 2030, 50, 50, 50,
                2024, None, None, None, None, None, None, "2026-01-01", "2026-06-01", "2025-01-01", None,
                "monthly",
            )
        return None

    def fetchall(self):
        sql = self._last_sql
        if "FROM clients" in sql and "db_id <> %s" in sql:
            return [
                (
                    11, "Child One", "Retail", "Active", "Acme Group", "Owner CRM", "Morgan",
                    "https://child.example", "2 High St", None, "Bristol", "Somerset", "BS1 2AB", "UK",
                    None, "2026-01-10", "2026-06-10",
                )
            ]
        if "FROM client_contacts" in sql:
            return [
                (1, 10, "Alice Owner", "Partner", "alice@example.com", "01234 111111", True),
                (2, 11, "Bob Client", "Director", "bob@example.com", "01234 222222", False),
            ]
        if "FROM jobs j" in sql:
            return [
                (
                    100, 10, "Acme Holdings", "J100", "Owner Job", "In Progress", 2025,
                    "2026-01-01", "2026-06-01", "2026-02-01", None, "2026-03-01", None, "2026-04-01", None,
                ),
                (
                    101, 11, "Child One", "J101", "Child Job", "Completed", 2025,
                    "2026-01-05", "2026-06-05", "2026-02-01", "2026-02-02", None, None, None, None,
                ),
            ]
        if "FROM client_notes cn" in sql or "FROM crm_events e" in sql:
            return []
        return []


def test_portfolio_overview_aggregates_clients_jobs_and_notes(monkeypatch):
    fake = _PortfolioConn()
    monkeypatch.setattr(portfolio_service, "exact_job_total_emissions", lambda _con, job_id: {100: 42.5, 101: 13.2}[job_id])

    result = portfolio_service.build_portfolio_overview(fake, 10)

    assert result["owner"]["client_name"] == "Acme Holdings"
    assert result["summary"]["total_clients"] == 2
    assert result["summary"]["total_jobs"] == 2
    assert result["summary"]["total_emissions"] == 55.7
    assert result["client_status_breakdown"][0]["status"] in {"Active", "Portfolio Owner"}
    assert result["annual_emissions"][0]["total_emissions"] == 55.7
    assert result["risk"]["overdue_jobs"] >= 1
    assert result["risk"]["watch_clients"] >= 1
    assert len(result["risk_clients"]) >= 1
    assert len(result["attention_jobs"]) >= 1
    assert result["attention_jobs"][0]["attention_status"] in {"overdue", "due soon", "upcoming"}
    assert result["clients"][0]["client_name"] == "Acme Holdings"
    assert result["clients"][1]["client_name"] == "Child One"


def test_portal_me_flags_portfolio_owner_mode(monkeypatch):
    class _Conn:
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
            if "FROM clients" in self._last_sql and "SELECT client_name, status, portfolio" in self._last_sql:
                return _FakeRow("Acme Holdings", "Portfolio Owner", "Acme Group")
            if "FROM client_portal_access" in self._last_sql:
                return _FakeRow(True, None, "unpaid", None, {"dashboard": True}, None, "2026-01-01", "2026-01-02")
            return None

    fake = _Conn()
    monkeypatch.setattr(portal_auth_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(portal_auth_routes, "ensure_portal_schema", lambda _con: None)

    result = portal_auth_routes.portal_me(
        current_user={"portal_user_id": 1, "client_db_id": 10, "email": "owner@example.com", "full_name": "Owner", "mfa_enabled": True}
    )

    assert result["portal_mode"] == "portfolio_owner"
    assert result["nav_config"]["portfolio"] is True
    assert result["nav_config"]["data"] is False
