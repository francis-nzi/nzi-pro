from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pandas as pd
import pytest
from fastapi import HTTPException
from api import job_report_routes as routes
from services.report_sites import visible_report_rows, report_sites


class Connection:
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def execute(self, sql, params=None):
        self.sql = sql
        return self
    def fetchone(self): return [1]
    def df(self): return pd.DataFrame([{"site_id": 1, "site_name": "UK"}, {"site_id": 2, "site_name": "Dubai"}])


@pytest.mark.parametrize("has_data", [False, True])
def test_excluded_site_absent_from_all_breakdowns(monkeypatch, has_data):
    monkeypatch.setattr(routes, "get_conn", lambda: Connection())
    monkeypatch.setattr(routes, "excluded_report_sites", lambda *a: [{"site_id": 2, "site_name": "Dubai"}])
    rows = [{"site_id": sid, "site_name": name, "scope": "Scope 1", "report_label": "Gas"}
            for sid, name in [(1, "UK"), (2, "Dubai")]] if has_data else []
    monkeypatch.setattr(routes, "_load_reporting_rows", lambda *a: rows)
    monkeypatch.setattr(routes, "JobMonthlyEmissionsResolver", lambda *a: None)
    monkeypatch.setattr(routes, "combined_row_metrics", lambda *a: {"calc_tco2e": 10, "display_qty": 1, "display_uom": "kWh"})
    result = routes.get_site_emissions_breakdowns(663)
    for key in ["overall", "scope", "activity", "appendix_rows"]:
        assert all(r["site_name"] != "Dubai" for r in result[key])
    if has_data:
        assert result["scope"][0]["total"] == 10
        assert len(rows) == 2  # visibility must not mutate source data


def test_id_filter_handles_same_names_and_unassigned():
    rows = [{"site_id": 1, "site_name": "Office"}, {"site_id": 2, "site_name": "Office"}, {"site_id": None, "site_name": "Unassigned"}]
    assert visible_report_rows(rows, [{"site_id": 2, "site_name": "Office"}]) == [rows[0], rows[2]]


def test_benchmark_cannot_reintroduce_hidden_site():
    current = {"overall": [{"site_name": "UK", "total": 10}], "excluded_site_names": ["Dubai"]}
    benchmark = {"overall": [{"site_name": "Dubai", "total": 9}]}
    assert [r["site_name"] for r in routes._build_site_overall_comparison(current, benchmark)] == ["UK"]


def test_report_settings_default_and_job_scope():
    class Con(Connection):
        def execute(self, sql, params=None):
            self.params = params
            return super().execute(sql, params)
        def fetchall(self):
            assert self.params == [663]
            assert "COALESCE(r.include_in_report, TRUE)" in self.sql
            assert "r.job_id = j.job_id" in self.sql
            return [(1, "UK", "", True, None, True)]
    assert report_sites(Con(), 663)[0]["include_in_report"] is True


def test_cannot_update_another_clients_site(monkeypatch):
    monkeypatch.setattr(routes, "assert_permission", lambda *a: None)
    monkeypatch.setattr(routes, "assert_job_access", lambda *a: None)
    monkeypatch.setattr(routes, "get_conn", lambda: Connection())
    monkeypatch.setattr(routes, "report_sites", lambda *a: [{"site_id": 1, "include_in_report": True}])
    with pytest.raises(HTTPException) as exc:
        routes.update_report_site(663, 99, routes.ReportSiteSelection(include_in_report=False), None, {})
    assert exc.value.status_code == 404


def test_save_is_job_specific(monkeypatch):
    con = Connection()
    monkeypatch.setattr(routes, "assert_permission", lambda *a: None)
    monkeypatch.setattr(routes, "assert_job_access", lambda *a: None)
    monkeypatch.setattr(routes, "get_conn", lambda: con)
    monkeypatch.setattr(routes, "report_sites", lambda *a: [{"site_id": 1, "include_in_report": True}])
    monkeypatch.setattr(routes, "record_audit_event", lambda *a, **kw: None)
    assert routes.update_report_site(663, 1, routes.ReportSiteSelection(include_in_report=False), None, {}) == {"site_id": 1, "include_in_report": False}
    assert "ON CONFLICT (job_id, site_id)" in con.sql
