from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.intelligence_routes as intelligence_routes


class _FakeConn:
    def __init__(self):
        self.queries: list[tuple[str, list[object] | None]] = []

    def execute(self, sql: str, params: list[object] | None = None):
        self.queries.append((sql, params))
        return self

    def fetchone(self):
        return None

    def fetchall(self):
        return []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def test_intelligence_routes_are_exposed():
    paths = {getattr(route, "path", "") for route in intelligence_routes.router.routes}

    assert "/intelligence/dashboard" in paths
    assert "/intelligence/client/{client_db_id}/call-prep" in paths
    assert "/intelligence/touchpoints/{client_db_id}" in paths
    assert "/intelligence/touchpoints" in paths


def test_dashboard_defaults_to_current_users_crm(monkeypatch):
    conn = _FakeConn()
    captured: dict[str, object] = {}

    monkeypatch.setattr(intelligence_routes, "get_conn", lambda: conn)
    monkeypatch.setattr(intelligence_routes, "_ensure_schema", lambda _con: None)

    def load_scoped_clients(_con, _org_id, crm_owner):
        captured["crm_owner"] = crm_owner
        return [
            {
                "client_db_id": 205,
                "client_name": "Shredit ME",
                "crm_owner": crm_owner or "Unassigned",
                "net_zero_year": 2050,
                "benchmark_year": 2022,
                "benchmark_total_tco2e": 513.47,
                "engagement_start_date": None,
                "engagement_end_date": None,
                "touchpoint_cadence": "monthly",
            }
        ]

    monkeypatch.setattr(intelligence_routes, "_load_scoped_clients", load_scoped_clients)
    monkeypatch.setattr(intelligence_routes, "_load_touchpoints", lambda *_args, **_kwargs: {205: []})
    monkeypatch.setattr(intelligence_routes, "_load_invoice_stats", lambda *_args, **_kwargs: {205: {}})
    monkeypatch.setattr(intelligence_routes, "_load_jobs", lambda *_args, **_kwargs: {205: []})
    monkeypatch.setattr(intelligence_routes, "_aggregate_emissions", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(intelligence_routes, "_compute_client_record", lambda **_kwargs: {
        "health_score": 82,
        "risk_flags": "",
        "days_since_contact": None,
        "touchpoint_due_date": None,
        "engagement_end_date": None,
        "latest_year": None,
        "latest_total_tco2e": None,
        "emissions_variance_pct": None,
        "open_invoices": 0,
        "overdue_invoices": 0,
    })
    monkeypatch.setattr(intelligence_routes, "_pick_active_job", lambda _jobs: None)
    monkeypatch.setattr(intelligence_routes, "_refresh_snapshots", lambda *_args, **_kwargs: None)

    result = intelligence_routes.get_dashboard(crm_owner=None, _user={"user_id": "u1", "full_name": "Jane Smith", "org_id": "org-a"})

    assert captured["crm_owner"] == "Jane Smith"
    assert result["crm_owner"] == "Jane Smith"
    assert result["portfolio_summary"]["total_clients"] == 1


def test_dashboard_all_crms_override_requires_superadmin(monkeypatch):
    conn = _FakeConn()
    captured: dict[str, object] = {}

    monkeypatch.setattr(intelligence_routes, "get_conn", lambda: conn)
    monkeypatch.setattr(intelligence_routes, "_ensure_schema", lambda _con: None)

    def load_scoped_clients(_con, _org_id, crm_owner):
        captured["crm_owner"] = crm_owner
        return [
            {
                "client_db_id": 205,
                "client_name": "Shredit ME",
                "crm_owner": "Unassigned",
                "net_zero_year": 2050,
                "benchmark_year": 2022,
                "benchmark_total_tco2e": 513.47,
                "engagement_start_date": None,
                "engagement_end_date": None,
                "touchpoint_cadence": "monthly",
            }
        ]

    monkeypatch.setattr(intelligence_routes, "_load_scoped_clients", load_scoped_clients)
    monkeypatch.setattr(intelligence_routes, "_load_touchpoints", lambda *_args, **_kwargs: {205: []})
    monkeypatch.setattr(intelligence_routes, "_load_invoice_stats", lambda *_args, **_kwargs: {205: {}})
    monkeypatch.setattr(intelligence_routes, "_load_jobs", lambda *_args, **_kwargs: {205: []})
    monkeypatch.setattr(intelligence_routes, "_aggregate_emissions", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(intelligence_routes, "_compute_client_record", lambda **_kwargs: {
        "health_score": 82,
        "risk_flags": "",
        "days_since_contact": None,
        "touchpoint_due_date": None,
        "engagement_end_date": None,
        "latest_year": None,
        "latest_total_tco2e": None,
        "emissions_variance_pct": None,
        "open_invoices": 0,
        "overdue_invoices": 0,
    })
    monkeypatch.setattr(intelligence_routes, "_pick_active_job", lambda _jobs: None)
    monkeypatch.setattr(intelligence_routes, "_refresh_snapshots", lambda *_args, **_kwargs: None)

    result = intelligence_routes.get_dashboard(all_crms=True, _user={"user_id": "u1", "full_name": "Jane Smith", "org_id": "org-a", "is_super_admin": True})

    assert captured["crm_owner"] is None
    assert result["crm_owner"] == "__all__"
    assert result["portfolio_summary"]["total_clients"] == 1
