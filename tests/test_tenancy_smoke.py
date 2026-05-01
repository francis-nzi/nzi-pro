from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd
import pytest

import api.admin_routes as admin_routes
import api.client_dashboard_routes as client_dashboard_routes
import api.main as main


class _SmokeRow:
    def __init__(self, *values: object):
        self.values = values

    def __getitem__(self, idx: int) -> object:
        return self.values[idx]


class _SmokeConn:
    def __init__(self):
        self.queries: list[tuple[str, list[object] | None]] = []
        self._last_sql = ""
        self._last_params: list[object] | None = None

    def execute(self, sql: str, params: list[object] | None = None):
        self.queries.append((sql, params))
        self._last_sql = sql
        self._last_params = params
        return self

    def fetchone(self):
        sql = self._last_sql
        params = self._last_params or []
        if "current_database()" in sql:
            return ("postgres", "postgres", "127.0.0.1", 5432, "PostgreSQL 17")
        if "FROM organisation_entitlements" in sql:
            return _SmokeRow("org-a", "growth", "active", 20, 200, None, None, None, "active", None, None, True, None, None)
        if "SELECT COALESCE(archived, FALSE) FROM organisations WHERE org_id = %s LIMIT 1" in sql:
            return (False,)
        if "SELECT org_id, name, slug, plan, plan_status, max_users, max_clients, archived, archived_at, archived_by, created_at, updated_at" in sql:
            return _SmokeRow("org-a", "Org A", "org-a", "growth", "active", 20, 200, False, None, None, "2026-04-23", "2026-04-23")
        if "FROM organisation_memberships" in sql and "COUNT(*)" in sql:
            return (1,)
        if "FROM organisation_invitations" in sql and "COUNT(*)" in sql:
            return (0,)
        if "FROM clients" in sql and "COUNT(*)" in sql:
            return (1,)
        if "SELECT industry, net_zero_year FROM clients WHERE db_id = %s" in sql:
            return ("Engineering", 2030)
        if "SELECT currency FROM clients WHERE db_id = %s" in sql:
            return ("GBP",)
        if "SELECT COUNT(*)" in sql and "FROM jobs j" in sql:
            return (1,)
        if "SELECT org_id, name, slug, plan, plan_status, max_users, max_clients, archived, archived_at, archived_by, created_at, updated_at FROM organisations WHERE org_id = %s" in sql:
            return _SmokeRow("org-a", "Org A", "org-a", "growth", "active", 20, 200, False, None, None, "2026-04-23", "2026-04-23")
        if "UPDATE users SET org_id = %s WHERE lower(user_id) = lower(%s)" in sql:
            return None
        if "SELECT db_id" in sql and "FROM clients" in sql:
            return _SmokeRow(178)
        return None

    def fetchall(self):
        sql = self._last_sql
        if "FROM organisations" in sql:
            return [
                _SmokeRow("org-a", "Org A", "org-a", "growth", "active", 20, 200, False, None, None, "2026-04-23", "2026-04-23"),
                _SmokeRow("org-b", "Org B", "org-b", "growth", "active", 10, 100, False, None, None, "2026-04-23", "2026-04-23"),
            ]
        if "FROM organisation_memberships m" in sql:
            return [
                _SmokeRow("org-a", "u-a", "User A", "a@example.com", "Owner", True, True, "2026-04-23", "2026-04-23"),
                _SmokeRow("org-b", "u-b", "User B", "b@example.com", "Owner", True, True, "2026-04-23", "2026-04-23"),
            ]
        return []

    def df(self):
        sql = self._last_sql
        params = self._last_params or []
        if "FROM jobs j" in sql and "LIMIT ? OFFSET ?" in sql:
            org_id = str(params[1]) if len(params) > 1 else ""
            if org_id == "org-a":
                return pd.DataFrame(
                    [
                        {
                            "job_id": 627,
                            "job_number": "J000627",
                            "title": "Org A Annual Support",
                            "reporting_year": 2025,
                            "status": "Open",
                            "job_type": "CRP",
                            "is_crp": True,
                            "reporting_period_end": pd.Timestamp("2025-12-31"),
                            "data_collection_due": None,
                            "data_collection_completed_at": None,
                            "first_draft_due": None,
                            "first_draft_completed_at": None,
                            "final_report_due": None,
                            "final_report_completed_at": None,
                            "total_emissions": 39.0,
                        }
                    ]
                )
            return pd.DataFrame(
                [
                    {
                        "job_id": 728,
                        "job_number": "J000728",
                        "title": "Org B Annual Support",
                        "reporting_year": 2026,
                        "status": "Open",
                        "job_type": "CRP",
                        "is_crp": True,
                        "reporting_period_end": pd.Timestamp("2026-12-31"),
                        "data_collection_due": None,
                        "data_collection_completed_at": None,
                        "first_draft_due": None,
                        "first_draft_completed_at": None,
                        "final_report_due": None,
                        "final_report_completed_at": None,
                        "total_emissions": 18.25,
                    }
                ]
            )
        return pd.DataFrame([])

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def _dashboard_rows(org_id: str) -> pd.DataFrame:
    if org_id == "org-a":
        return pd.DataFrame(
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
    return pd.DataFrame(
        [
            {
                "job_id": 728,
                "dashboard_year": 2026,
                "scope": "Scope 2",
                "category": "Electricity",
                "emissions": 18.25,
                "record_type": "source_register",
            }
        ]
    )


def test_tenant_smoke_flow_across_two_orgs(monkeypatch: pytest.MonkeyPatch) -> None:
    conn = _SmokeConn()
    user_a = {
        "user_id": "u-a",
        "email": "a@example.com",
        "org_id": "org-a",
        "role": "Owner",
        "effective_permissions": ["admin.access", "jobs.view"],
    }
    user_b = {
        "user_id": "u-b",
        "email": "b@example.com",
        "org_id": "org-b",
        "role": "Owner",
        "effective_permissions": ["admin.access", "jobs.view"],
    }

    monkeypatch.setattr(admin_routes, "get_conn", lambda: conn)
    monkeypatch.setattr(main, "get_conn", lambda: conn)
    monkeypatch.setattr(client_dashboard_routes, "get_conn", lambda: conn)

    monkeypatch.setattr(admin_routes, "_ensure_org_lifecycle_schema", lambda con: None)
    monkeypatch.setattr(admin_routes, "_ensure_org_entitlement_schema", lambda con: None)
    monkeypatch.setattr(admin_routes, "_require_org_switch_role", lambda *_args, **_kwargs: {"capabilities": {"can_switch": True}})
    monkeypatch.setattr(admin_routes, "_require_org_capacity", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(admin_routes, "record_audit_event", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(admin_routes, "_organisation_row_to_dict", lambda row: {
        "org_id": row[0],
        "name": row[1],
        "slug": row[2],
        "plan": row[3],
        "plan_status": row[4],
        "max_users": row[5],
        "max_clients": row[6],
        "archived": bool(row[7]),
        "archived_at": row[8],
        "archived_by": row[9],
        "created_at": row[10],
        "updated_at": row[11],
    })
    monkeypatch.setattr(admin_routes, "_organisation_entitlement_info", lambda _con, org_id: {"plan": "growth", "plan_status": "active", "max_users": 20 if org_id == "org-a" else 10, "max_clients": 200 if org_id == "org-a" else 100, "auto_renew": True})
    monkeypatch.setattr(admin_routes, "_organisation_usage_info", lambda _con, org_id: {"org_id": org_id, "users": 1, "clients": 1})
    monkeypatch.setattr(admin_routes, "_normalize_org_role", lambda role, default=None: str(role or default or "Member"))
    monkeypatch.setattr(admin_routes, "_org_role_capabilities", lambda role: {"can_switch": True, "can_manage_members": True, "can_transfer_ownership": True})

    monkeypatch.setattr(main, "assert_permission", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "assert_client_access", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "require_org", lambda user: user["org_id"])
    monkeypatch.setattr(main, "_current_org_summary", lambda user: {"org_id": user["org_id"], "name": f"Org {user['org_id'][-1].upper()}", "slug": user["org_id"], "role": user["role"], "archived": False})
    monkeypatch.setattr(main, "exact_job_total_emissions", lambda _con, job_id: 39.0 if int(job_id) == 627 else 18.25)

    monkeypatch.setattr(client_dashboard_routes, "assert_client_access", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(client_dashboard_routes, "require_org", lambda user: user["org_id"])
    monkeypatch.setattr(client_dashboard_routes, "_load_client_jobs", lambda _con, client_db_id, org_id, crp_only=True: pd.DataFrame(
        [
            {
                "job_id": 627 if org_id == "org-a" else 728,
                "reporting_year": 2025 if org_id == "org-a" else 2026,
                "dashboard_year": 2025 if org_id == "org-a" else 2026,
                "title": "Org A Annual Support" if org_id == "org-a" else "Org B Annual Support",
            }
        ]
    ))
    monkeypatch.setattr(client_dashboard_routes, "load_combined_emissions_summary_rows", lambda _con, job_ids: _dashboard_rows("org-a" if 627 in job_ids else "org-b"))
    monkeypatch.setattr(client_dashboard_routes, "load_combined_reporting_rows", lambda _con, job_ids: _dashboard_rows("org-a" if 627 in job_ids else "org-b"))
    monkeypatch.setattr(client_dashboard_routes, "attach_exact_emissions", lambda _con, rows_df: rows_df)
    monkeypatch.setattr(client_dashboard_routes, "get_client_benchmark_metrics", lambda *_args, **_kwargs: None)

    organisations = admin_routes.list_organisations(_user=user_a)
    assert organisations["active_org_id"] == "org-a"
    assert len(organisations["items"]) == 2

    switched = admin_routes.switch_active_organisation("org-b", _user=user_a)
    assert switched["ok"] is True
    assert switched["org_id"] == "org-b"
    assert any("UPDATE users SET org_id = %s" in sql for sql, _ in conn.queries)

    diagnostics = main.support_diagnostics(user=user_b)
    assert diagnostics["current_org"]["org_id"] == "org-b"
    assert diagnostics["database"]["db_name"] == "postgres"

    dashboard_a = client_dashboard_routes.get_client_dashboard(178, _user=user_a)
    dashboard_b = client_dashboard_routes.get_client_dashboard(179, _user=user_b)
    assert dashboard_a["current_metrics"]["total_emissions"] == 40.57
    assert dashboard_b["current_metrics"]["total_emissions"] == 18.25
    assert dashboard_a["top_categories"][0]["category"] == "Office"
    assert dashboard_b["top_categories"][0]["category"] == "Electricity"

    jobs_a = main.client_jobs(178, limit=50, offset=0, _user=user_a)
    jobs_b = main.client_jobs(178, limit=50, offset=0, _user=user_b)
    assert jobs_a["items"][0]["job_number"] == "J000627"
    assert jobs_b["items"][0]["job_number"] == "J000728"
    assert jobs_a["items"][0]["total_emissions"] == 39.0
    assert jobs_b["items"][0]["total_emissions"] == 18.25
    assert any("COALESCE(NULLIF(TRIM(COALESCE(j.org_id, '')), ''), c.org_id) = ?" in sql for sql, _ in conn.queries if "FROM jobs j" in sql)
