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


def test_call_prep_uses_cached_snapshot_and_returns_payload(monkeypatch):
    conn = _FakeConn()

    monkeypatch.setattr(intelligence_routes, "get_conn", lambda: conn)
    monkeypatch.setattr(intelligence_routes, "_ensure_schema", lambda _con: None)
    monkeypatch.setattr(
        intelligence_routes,
        "_load_touchpoints",
        lambda *_args, **_kwargs: {
            205: [
                {
                    "occurred_at": "2026-05-02T10:30:00+00:00",
                    "summary": "Discussed renewal scope",
                    "outcome": "neutral",
                    "next_action": "Send proposal",
                }
            ]
        },
    )
    monkeypatch.setattr(intelligence_routes, "_load_invoice_stats", lambda *_args, **_kwargs: {205: {"open_invoices": 1, "overdue_invoices": 0}})
    monkeypatch.setattr(
        intelligence_routes,
        "_load_health_snapshots",
        lambda *_args, **_kwargs: {205: {"health_score": 77, "risk_flags": "OVERDUE_CALL"}},
    )

    row = (
        205,
        "Aberdeen Science Centre",
        "",
        2050,
        2022,
        513.47,
        None,
        None,
        "monthly",
    )
    conn.fetchone = lambda: row  # type: ignore[attr-defined]

    def execute(sql, params=None):
        conn.queries.append((sql, params))
        return conn

    conn.execute = execute  # type: ignore[assignment]

    result = intelligence_routes.get_call_prep(205, _user={"user_id": "u1", "full_name": "Jane Smith", "org_id": "org-a"})

    assert result["client_name"] == "Aberdeen Science Centre"
    assert result["crm_owner"] == "Unassigned"
    assert result["health_score"] == 77
    assert result["active_job"] is None
    assert result["open_invoices"] == 1
    assert result["talking_points"]


def test_call_prep_returns_fallback_when_snapshot_lookup_fails(monkeypatch):
    conn = _FakeConn()

    monkeypatch.setattr(intelligence_routes, "get_conn", lambda: conn)
    monkeypatch.setattr(intelligence_routes, "_ensure_schema", lambda _con: None)

    def load_touchpoints(*_args, **_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(intelligence_routes, "_load_touchpoints", load_touchpoints)
    conn.fetchone = lambda: (
        205,
        "Aberdeen Science Centre",
        "Francis Doherty",
        2050,
        2022,
        513.47,
        None,
        None,
        "monthly",
    )  # type: ignore[attr-defined]

    def execute(sql, params=None):
        conn.queries.append((sql, params))
        return conn

    conn.execute = execute  # type: ignore[assignment]

    result = intelligence_routes.get_call_prep(205, _user={"user_id": "u1", "full_name": "Jane Smith", "org_id": "org-a"})

    assert result["client_name"] == "Call Prep"
    assert result["health_score"] == 0
    assert result["detail"] == "Call prep data is temporarily unavailable."
