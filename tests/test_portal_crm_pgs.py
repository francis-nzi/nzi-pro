from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pandas as pd
import pytest
import api.portal_spend_routes as routes


class Conn:
    def __init__(self): self.sql = ""
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def execute(self, sql, params=None):
        self.sql = sql
        if "FROM job_scope_rows" in sql:
            assert "r.job_id = %s" in sql
            assert "r.enabled = TRUE" in sql
            assert params[0] == 487
            assert "Purchased Goods and Services" in params[1]
        return self
    def df(self):
        if "FROM job_scope_rows" in self.sql:
            return pd.DataFrame([
                {"row_id": 6354, "site_id": 31, "report_label": "Food", "qty": 1125, "uom": "GBP"},
                {"row_id": 6351, "site_id": 32, "report_label": "Rental", "qty": 4320, "uom": "GBP"},
                {"row_id": 6355, "site_id": 31, "report_label": "Office", "qty": 360, "uom": "GBP"},
            ])
        return pd.DataFrame()


@pytest.mark.parametrize("site_ids,expected", [(None, 3), ([31], 2), ([], 0)])
def test_crm_rows_visible_with_no_portal_spend_and_respect_sites(monkeypatch, site_ids, expected):
    monkeypatch.setattr(routes, "get_conn", lambda: Conn())
    monkeypatch.setattr(routes, "_ensure_spend_tables", lambda *a: None)
    monkeypatch.setattr(routes, "_resolve_job_or_404", lambda *a: 487)
    monkeypatch.setattr(routes, "get_job_summary", lambda *a: {})
    result = routes.portal_spend_list_rows({"client_db_id": 400, "site_ids": site_ids})
    assert result["rows"] == []
    assert len(result["crm_rows"]) == expected
    if site_ids is None:
        assert sum(row["qty"] for row in result["crm_rows"]) == 5805
