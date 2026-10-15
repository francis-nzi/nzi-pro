import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pytest
from fastapi import HTTPException
from api import portal_commuting_routes as routes

@pytest.mark.parametrize("raw,expected", [(2,2),("2",2),(None,1)])
def test_selected_site_and_default(monkeypatch, raw, expected):
    monkeypatch.setattr(routes, "permitted_sites", lambda *a: [{"site_id":1},{"site_id":2}])
    assert routes._manual_entry_site_id(None, {}, {"site_id":raw}) == expected

@pytest.mark.parametrize("raw", [99,"invalid",1.5,True])
def test_rejects_unavailable_or_invalid_site(monkeypatch, raw):
    monkeypatch.setattr(routes, "permitted_sites", lambda *a: [{"site_id":2}])
    with pytest.raises(HTTPException):
        routes._manual_entry_site_id(None, {}, {"site_id":raw})

@pytest.mark.parametrize("row_type", ["commuting","wfh"])
def test_manual_submission_saves_chosen_site(monkeypatch, row_type):
    class Con:
        def __enter__(self): return self
        def __exit__(self,*a): pass
    monkeypatch.setattr(routes, "get_conn", Con)
    for name in ("_assert_can_manage", "_assert_not_a_full_name", "_ensure_emission_register_schema", "_assert_data_entry_open", "_assert_employee_id_unique"):
        monkeypatch.setattr(routes, name, lambda *a, **kw: None)
    monkeypatch.setattr(routes, "_resolve_job_or_404", lambda *a: 663)
    monkeypatch.setattr(routes, "permitted_sites", lambda *a: [{"site_id":1},{"site_id":2}])
    monkeypatch.setattr(routes, "_resolve_manual_commuting_rows", lambda con, job, site, entries: {"ready_count":1,"unresolved_count":0,"ready_rows":[{"site_id":site}]})
    captured = []
    def insert(con, job, rows, **kwargs):
        captured.extend(rows)
        return 1, [7]
    monkeypatch.setattr(routes, "_insert_manual_commuting_rows", insert)
    routes.portal_commuting_create_row({"row_type":row_type,"employee_name":"JD","site_id":2}, {"client_db_id":140})
    assert captured == [{"site_id":2}]
