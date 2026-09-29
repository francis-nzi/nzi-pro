from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pytest
from fastapi import HTTPException
import services.report_actions as actions
from test_action_sites import Conn
from test_update_client_action import _FakeConn, _patch_common


@pytest.mark.parametrize("report_only,expected", [(False, 3), (True, 2)])
def test_report_payload_filters_items_groups_and_counts(monkeypatch, report_only, expected):
    items = [{"action_name": "Yes", "action_term": "short", "add_to_report": True},
             {"action_name": "No", "action_term": "short", "add_to_report": False},
             {"action_name": "Legacy", "action_term": "long"}]
    monkeypatch.setattr(actions, "list_client_report_actions", lambda *a, **k: items)
    monkeypatch.setattr(actions, "list_action_sites", lambda *a, **k: [])
    monkeypatch.setattr(actions, "list_action_levers", lambda *a, **k: [])
    result = actions.get_client_report_actions_payload(1, report_only=report_only, con=object())
    assert result["total_actions"] == expected
    assert sum(result["term_counts"].values()) == expected
    assert sum(len(g["items"]) for g in result["grouped"]) == expected
    assert ("No" in [i["action_name"] for i in result["items"]]) is (not report_only)


@pytest.mark.parametrize("flag", [None, True, False])
def test_save_defaults_to_yes_and_persists_explicit_choice(monkeypatch, flag):
    con = Conn()
    monkeypatch.setattr(actions, "ensure_report_actions_schema", lambda *a: None)
    monkeypatch.setattr(actions, "list_report_action_options", lambda **k: [])
    monkeypatch.setattr(actions, "_resolve_lever_id", lambda *a, **k: 1)
    monkeypatch.setattr(actions, "list_client_report_actions", lambda *a, **k: [])
    actions.replace_client_report_actions(1, [{"action_name": "Test", "add_to_report": flag}], actor="test", con=con)
    assert con.saved[0][-3] is (flag if flag is not None else True)


def test_portal_cannot_change_report_inclusion(monkeypatch):
    con = _FakeConn()
    _patch_common(monkeypatch, con)
    with pytest.raises(HTTPException) as exc:
        actions.update_client_action(1, 1, payload={"add_to_report": False}, actor="portal", source="portal", con=con)
    assert exc.value.status_code == 403
    assert con.update_params is None


def test_crm_can_change_report_inclusion(monkeypatch):
    class C(_FakeConn):
        flag_params = None
        def execute(self, sql, params=None):
            if "SET add_to_report" in sql:
                self.flag_params = params
                return self
            return super().execute(sql, params)
    con = C()
    _patch_common(monkeypatch, con)
    actions.update_client_action(1, 1, payload={"add_to_report": False}, actor="crm", con=con)
    assert con.flag_params == [False, 1, 1]


def test_existing_no_is_preserved_when_older_crm_omits_field(monkeypatch):
    con = Conn()
    con.existing = [(5, "open", 0, None, None, None, "main", [], False)]
    monkeypatch.setattr(actions, "ensure_report_actions_schema", lambda *a: None)
    monkeypatch.setattr(actions, "list_report_action_options", lambda **k: [])
    monkeypatch.setattr(actions, "_resolve_lever_id", lambda *a, **k: 1)
    monkeypatch.setattr(actions, "list_client_report_actions", lambda *a, **k: [])
    actions.replace_client_report_actions(1, [{"client_action_id": 5, "action_name": "Test"}], actor="test", con=con)
    assert con.saved[0][-3] is False
