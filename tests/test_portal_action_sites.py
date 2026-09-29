from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pytest
from fastapi import HTTPException
import api.portal_routes as routes
import services.report_actions as actions


def test_portal_actions_returns_site_assignments_and_active_choices(monkeypatch):
    class Conn:
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def execute(self, sql, params):
            assert params == [7]
            assert "WHERE a.client_db_id = %s" in sql
            assert "a.site_scope, a.site_ids" in sql
            return self
        def fetchall(self):
            return [(1, "Energy", None, "short", None, None, False, "open", 0,
                     None, None, None, None, None, None, 1, "L1", "Lever", "specified", [20], True)]
    monkeypatch.setattr(routes, "get_conn", lambda: Conn())
    monkeypatch.setattr(actions, "ensure_report_actions_schema", lambda *a: None)
    sites = [{"site_id": 20, "site_name": "Factory", "is_main": True}]
    monkeypatch.setattr(actions, "list_action_sites", lambda client_id, **k: sites if client_id == 7 else [])
    result = routes.portal_list_actions({"client_db_id": 7})
    assert result["sites"] == sites
    assert result["items"][0]["site_scope"] == "specified"
    assert result["items"][0]["site_ids"] == [20]


def test_site_scoped_portal_account_still_cannot_access_shared_actions():
    with pytest.raises(HTTPException) as exc:
        routes.portal_list_actions({"client_db_id": 7, "site_ids": [20]})
    assert exc.value.status_code == 403


def test_update_payload_preserves_site_fields_and_partial_update_semantics():
    payload = routes._PortalUpdateActionPayload(site_scope="specified", site_ids=[20])
    assert payload.model_dump(exclude_unset=True) == {"site_scope": "specified", "site_ids": [20]}
    assert "site_scope" not in routes._PortalUpdateActionPayload(status="open").model_dump(exclude_unset=True)
