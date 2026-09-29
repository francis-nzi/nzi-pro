from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pandas as pd
import pytest
from fastapi import HTTPException
import api.portal_data_entry_routes as routes


class Conn:
    def __init__(self, register=None, scope=None, category="Business Travel", existing=None):
        self.register = register or []
        self.scope = scope or []
        self.category = category
        self.existing = existing or (7, 487, 31, None)
        self.writes = []
        self.sql = ""
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def execute(self, sql, params=None):
        self.sql = sql
        if sql.strip().startswith(("UPDATE", "DELETE")):
            self.writes.append((sql, params))
        return self
    def df(self):
        assert "enabled = TRUE OR review_status IN ('pending_review', 'rejected')" in self.sql
        return pd.DataFrame(self.register if "FROM job_emission_sources" in self.sql else self.scope)
    def fetchone(self):
        if "SELECT r.category" in self.sql:
            assert "j.client_db_id = %s" in self.sql
            return (self.category,) if self.category else None
        return self.existing


def setup(monkeypatch, con):
    monkeypatch.setattr(routes, "get_conn", lambda: con)
    for name in ["ensure_portal_data_entry_schema", "_ensure_job_scope_rows_schema", "_ensure_emission_register_schema", "_assert_data_entry_open", "record_audit_event"]:
        monkeypatch.setattr(routes, name, lambda *a, **k: None)
    monkeypatch.setattr(routes, "_resolve_job_or_404", lambda *a: 487)
    monkeypatch.setattr(routes, "get_job_summary", lambda *a: {})
    monkeypatch.setattr(routes, "load_bucket_category_map", lambda *a: {"Business Travel": "business_travel", "Company Vehicles": "company_vehicles", "Energy": "energy"})


@pytest.mark.parametrize("bucket,category", [("business_travel", "Business Travel"), ("company_vehicles", "Company Vehicles")])
def test_combines_stores_without_id_collisions(monkeypatch, bucket, category):
    con = Conn(register=[{"source_id": 7, "site_id": 31, "qty": 10}],
               scope=[{"row_id": 7, "site_id": 31, "category": category, "qty": 150},
                      {"row_id": 8, "site_id": 31, "category": "Energy", "qty": 20}])
    setup(monkeypatch, con)
    result = routes.portal_data_entry_list_rows(bucket, {"client_db_id": 400})
    assert [(r["row_source"], r["row_id"], r["qty"]) for r in result["rows"]] == [("register", 7, 10), ("scope", 7, 150)]


@pytest.mark.parametrize("empty_store", ["scope", "register"])
def test_one_empty_store_does_not_hide_other(monkeypatch, empty_store):
    con = Conn(register=[] if empty_store == "register" else [{"source_id": 7}],
               scope=[] if empty_store == "scope" else [{"row_id": 8, "category": "Business Travel"}])
    setup(monkeypatch, con)
    assert len(routes.portal_data_entry_list_rows("business_travel", {"client_db_id": 400})["rows"]) == 1


def test_site_scoping_applies_to_both_stores(monkeypatch):
    con = Conn(register=[{"source_id": 7, "site_id": 99}],
               scope=[{"row_id": 8, "site_id": 99, "category": "Business Travel"}])
    setup(monkeypatch, con)
    assert routes.portal_data_entry_list_rows("business_travel", {"client_db_id": 400, "site_ids": [31]})["rows"] == []


def test_scope_update_targets_correct_store_and_marks_for_review(monkeypatch):
    con = Conn()
    setup(monkeypatch, con)
    result = routes.portal_data_entry_update_row(None, "business_travel", 7,
        {"qty": 150, "month_1": 150}, {"client_db_id": 400}, row_source="scope")
    assert result["review_status"] == "pending_review"
    assert len(con.writes) == 1
    assert "UPDATE job_scope_rows" in con.writes[0][0]
    assert "month_1 = %s" in con.writes[0][0]


@pytest.mark.parametrize("category", [None, "Energy"])
def test_wrong_client_or_bucket_cannot_update_scope_row(monkeypatch, category):
    con = Conn(category=category)
    setup(monkeypatch, con)
    with pytest.raises(HTTPException) as exc:
        routes.portal_data_entry_update_row(None, "business_travel", 7,
            {"qty": 150}, {"client_db_id": 400}, row_source="scope")
    assert exc.value.status_code == 404
    assert not con.writes


def test_scope_site_access_checked_on_update(monkeypatch):
    con = Conn()
    setup(monkeypatch, con)
    with pytest.raises(HTTPException) as exc:
        routes.portal_data_entry_update_row(None, "business_travel", 7,
            {"qty": 150}, {"client_db_id": 400, "site_ids": [99]}, row_source="scope")
    assert exc.value.status_code == 403
    assert not con.writes


def test_invalid_source_rejected():
    with pytest.raises(HTTPException): routes._row_source_type("business_travel", "bad")
    with pytest.raises(HTTPException): routes._row_source_type("energy", "register")
    assert routes._row_source_type("business_travel", None) == "business_travel"


def test_bucket_flag_preserves_crm_rows_without_register_submissions(monkeypatch):
    class FlagsConn(Conn):
        def df(self):
            return pd.DataFrame([{"category": "Business Travel"}])
        def fetchone(self): return None
    con = FlagsConn()
    setup(monkeypatch, con)
    monkeypatch.setattr(routes, "resolve_current_job_for_client", lambda *a: 487)
    monkeypatch.setattr(routes, "_ensure_spend_tables", lambda *a: None)
    result = routes.portal_data_entry_buckets({"client_db_id": 400})
    assert next(b for b in result["buckets"] if b["bucket_key"] == "business_travel")["has_data"]


def test_scope_delete_uses_scope_store_and_keeps_approval_guard(monkeypatch):
    con = Conn(existing=(7, 487, 31, "approved"))
    setup(monkeypatch, con)
    with pytest.raises(HTTPException) as exc:
        routes.portal_data_entry_delete_row(None, "business_travel", 7,
            {"client_db_id": 400}, row_source="scope")
    assert exc.value.status_code == 409
    assert not con.writes
    assert "r.submitted_by_portal = TRUE" in con.sql
