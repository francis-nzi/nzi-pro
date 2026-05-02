from pathlib import Path
import sys
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd

import api.main_dashboard_routes as main_dashboard_routes


class _FakeConn:
    def __init__(self):
        self.queries: list[tuple[str, list[object] | None]] = []
        self._last_sql = ""

    def execute(self, sql: str, params: list[object] | None = None):
        self.queries.append((sql, params))
        self._last_sql = sql
        return self

    def fetchone(self):
        sql = self._last_sql
        if "SELECT MAX(reporting_year) FROM jobs" in sql:
            return (2025,)
        if "SELECT COUNT(*) FROM clients" in sql:
            return (1,)
        if "SELECT COUNT(*) FROM jobs" in sql and "job_plan" not in sql:
            return (1,)
        return (0,)

    def fetchall(self):
        sql = self._last_sql
        if "AVG(s.health_score) AS avg_health_score" in sql:
            return [("Unassigned", 88.4)]
        if "MAX(ct.occurred_at) AS last_contact_at" in sql:
            return [("Unassigned", datetime(2025, 4, 10, 9, 30, tzinfo=timezone.utc))]
        return []

    def df(self):
        sql = self._last_sql
        if "SELECT DISTINCT reporting_year" in sql:
            return pd.DataFrame([{"reporting_year": 2025}])
        if "SELECT DISTINCT industry FROM clients" in sql:
            return pd.DataFrame([{"industry": "Engineering"}])
        if "SELECT DISTINCT COALESCE(crm_owner, 'Unassigned') AS crm_owner" in sql:
            return pd.DataFrame([{"crm_owner": "Unassigned"}])
        if "GROUP BY COALESCE(industry,'Unspecified')" in sql:
            return pd.DataFrame([{"industry": "Engineering", "client_count": 1}])
        if "COALESCE(c.crm_owner, 'Unassigned') as crm_name" in sql:
            return pd.DataFrame([{"crm_name": "Unassigned", "status": "Open", "count": 1}])
        if "COALESCE(j.status, 'Unknown') as status" in sql:
            return pd.DataFrame([{"status": "Open", "count": 1}])
        if "SELECT" in sql and "COALESCE(NULLIF(TRIM(j.status), ''), 'Unknown') AS status" in sql and "FROM jobs j" in sql:
            return pd.DataFrame(
                [
                    {
                        "job_id": 664,
                        "job_number": "J000664",
                        "title": "Shredit ME Carbon Reduction Plan 2023",
                        "status": "Open",
                        "client_name": "Shredit ME",
                        "crm_name": "Unassigned",
                        "estimated_hours": 12.0,
                        "start_date": pd.Timestamp("2023-01-01"),
                        "due_date": pd.Timestamp("2025-05-10"),
                        "data_collection_due": pd.Timestamp("2025-04-15"),
                        "data_collection_completed_at": None,
                        "first_draft_due": None,
                        "first_draft_completed_at": None,
                        "final_report_due": None,
                        "final_report_completed_at": None,
                        "created_at": pd.Timestamp("2023-01-15"),
                    }
                ]
            )
        if "FROM jobs j" in sql and "LIMIT 5" in sql:
            return pd.DataFrame(
                [
                {
                        "job_id": 664,
                        "title": "Shredit ME Carbon Reduction Plan 2023",
                        "reporting_year": pd.NA,
                        "status": "Open",
                        "client_name": "Shredit ME",
                        "start_date": pd.Timestamp("2023-01-01"),
                        "created_at": pd.Timestamp("2023-01-15"),
                        "data_collection_due": None,
                        "data_collection_completed_at": None,
                        "first_draft_due": None,
                        "first_draft_completed_at": None,
                        "final_report_due": None,
                        "final_report_completed_at": None,
                    }
                ]
            )
        return pd.DataFrame([])

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def test_dashboard_overview_handles_null_reporting_year(monkeypatch):
    conn = _FakeConn()
    monkeypatch.setattr(main_dashboard_routes, "get_conn", lambda: conn)
    monkeypatch.setattr(main_dashboard_routes, "_table_exists", lambda _con, _table_name: True)
    monkeypatch.setattr(main_dashboard_routes, "_column_exists", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(main_dashboard_routes, "_load_dashboard_emissions_jobs", lambda *_args, **_kwargs: pd.DataFrame([{"job_id": 664, "client_id": 205, "client_name": "Shredit ME", "reporting_year": 2023, "dashboard_year": 2023}]))
    monkeypatch.setattr(
        main_dashboard_routes,
        "load_combined_emissions_summary_rows",
        lambda *_args, **_kwargs: pd.DataFrame(
            [
                {
                    "job_id": 664,
                    "client_id": 205,
                    "client_name": "Shredit ME",
                    "dashboard_year": 2023,
                    "dashboard_year_norm": 2023,
                    "scope": "Scope 3",
                    "category": "Office",
                    "emissions": 40.57,
                    "record_type": "source_register",
                }
            ]
        ),
    )

    result = main_dashboard_routes.get_dashboard_overview(year=None, _user={"user_id": "u1", "org_id": "org-a"})

    assert result["selected_year"] == 2025
    assert result["recent_activity"][0]["job_id"] == 664
    assert result["recent_activity"][0]["reporting_year"] is None


def test_dashboard_operations_overview_includes_crm_health_fields(monkeypatch):
    conn = _FakeConn()
    monkeypatch.setattr(main_dashboard_routes, "get_conn", lambda: conn)
    monkeypatch.setattr(main_dashboard_routes, "_table_exists", lambda _con, table: table != "time_logs")
    monkeypatch.setattr(main_dashboard_routes, "_column_exists", lambda *_args, **_kwargs: True)

    result = main_dashboard_routes.get_dashboard_operations_overview(year=2025, industry=None, crm_owner=None, _user={"user_id": "u1", "org_id": "org-a"})

    assert result["crm_workload"], "expected at least one CRM workload row"
    row = result["crm_workload"][0]
    assert row["crm_name"] == "Unassigned"
    assert row["avg_health_score"] == 88.4
    assert row["last_contact_date"] == "2025-04-10T09:30:00+00:00"
