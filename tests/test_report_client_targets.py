from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pytest
from api import job_report_routes as routes

class Conn:
    def __init__(self, row): self.row = row
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def execute(self, *args): return self
    def fetchone(self): return self.row

@pytest.mark.parametrize("years,pcts", [([2030,2030,2030],[50,50,50]), ([2028,2030,2032],[0,30,75])])
def test_client_scope_targets_override_shared_legacy_values(monkeypatch, years, pcts):
    row = [2021,2040,None,2035,2040,2035,50,50,50,*years,*pcts,90,2021]
    monkeypatch.setattr(routes, "get_conn", lambda: Conn(row))
    result = routes.get_job_target_data(776)
    for i in (1,2,3):
        assert result[f"target_s{i}_year"] == years[i-1]
        assert result[f"interim_s{i}_pct"] == pcts[i-1]
    assert result["interim_target_year"] == years[0]
    assert result["baseline_year"] == 2021


def test_legacy_targets_still_work(monkeypatch):
    row = [2021,None,None,None,2040,2035,0,30,50,None,None,None,None,None,None,90,2021]
    monkeypatch.setattr(routes, "get_conn", lambda: Conn(row))
    result = routes.get_job_target_data(776)
    assert result["target_s1_year"] == 2035
    assert result["interim_s1_pct"] == 0
    assert result["interim_s2_pct"] == 30


def test_portal_refreshes_targets_without_changing_reviewed_snapshot(monkeypatch):
    import json
    from api import portal_routes as portal
    original = {"target_data": {"baseline_year": 2021, "interim_target_year": 2035},
                "scope_totals": {"Scope 1": 123}}
    raw = json.dumps(original)
    class PortalConn(Conn):
        def __init__(self): self.count = 0
        def execute(self, *args):
            self.count += 1
            return self
        def fetchone(self):
            if self.count == 1: return ["sent_for_review", 1, None, None, None, None, None, 1, None]
            return [raw, "Version 1", 1, None]
    monkeypatch.setattr(portal, "get_conn", PortalConn)
    monkeypatch.setattr(portal, "_assert_section_allowed", lambda *a: None)
    monkeypatch.setattr(portal, "_assert_job_belongs_to_client", lambda *a: None)
    monkeypatch.setattr(routes, "get_job_target_data", lambda *a: {"baseline_year": 2022, "interim_target_year": 2030, "target_s1_year": 2030})
    result = portal.portal_snapshot_data(776, {"client_db_id": 54})
    assert result["snapshot"]["target_data"]["interim_target_year"] == 2030
    assert result["snapshot"]["target_data"]["baseline_year"] == 2021
    assert result["snapshot"]["scope_totals"] == original["scope_totals"]
    assert json.loads(raw) == original
