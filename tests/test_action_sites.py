from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pytest
from fastapi import HTTPException
import services.report_actions as actions


class Conn:
    def __init__(self):
        self.sql = ""
        self.saved = []
        self.deleted = False
        self.existing = []

    def execute(self, sql, params=None):
        self.sql = " ".join(sql.split())
        if self.sql.startswith("DELETE FROM client_report_actions"):
            self.deleted = True
        if self.sql.startswith("INSERT INTO client_report_actions"):
            assert self.sql.count("%s") == len(params)
            self.saved.append(params)
        return self

    def fetchone(self):
        return (1,)

    def fetchall(self):
        if "FROM client_sites" in self.sql:
            return [(10, "Head office", True), (20, "Factory", False)]
        return self.existing


@pytest.fixture
def conn(monkeypatch):
    con = Conn()
    monkeypatch.setattr(actions, "ensure_report_actions_schema", lambda *a: None)
    monkeypatch.setattr(actions, "list_report_action_options", lambda **k: [])
    monkeypatch.setattr(actions, "_resolve_lever_id", lambda *a, **k: 1)
    monkeypatch.setattr(actions, "list_client_report_actions", lambda *a, **k: [])
    return con


@pytest.mark.parametrize("scope,ids,expected", [(None, None, ("main", [])), ("all", [10], ("all", [])), ("specified", [20, 10, 20], ("specified", [10, 20]))])
def test_save_site_allocation(conn, scope, ids, expected):
    actions.replace_client_report_actions(1, [{"action_name": "Reduce energy", "site_scope": scope, "site_ids": ids}], actor="test", con=conn)
    assert tuple(conn.saved[0][-2:]) == expected


@pytest.mark.parametrize("scope,ids", [("specified", []), ("specified", [999]), ("invalid", []), ("specified", [True])])
def test_invalid_sites_rejected_before_replacing_actions(conn, scope, ids):
    with pytest.raises(HTTPException) as exc:
        actions.replace_client_report_actions(1, [{"action_name": "Reduce energy", "site_scope": scope, "site_ids": ids}], actor="test", con=conn)
    assert exc.value.status_code == 400
    assert not conn.deleted


def test_older_clients_preserve_saved_allocation(conn):
    conn.existing = [(5, "open", 20, None, None, None, "specified", [20], True)]
    actions.replace_client_report_actions(1, [{"client_action_id": 5, "action_name": "Reduce energy"}], actor="test", con=conn)
    assert conn.saved[0][-2:] == ["specified", [20]]


def test_read_returns_saved_allocation(monkeypatch):
    con = Conn()
    con.existing = [(5, None, "Reduce energy", None, "short", None, None, True, 10, None, None,
                     "open", 20, None, None, None, None, 1, "L1", "Lever", None, None, False,
                     "specified", [10, 20], True)]
    monkeypatch.setattr(actions, "ensure_report_actions_schema", lambda *a: None)
    result = actions.list_client_report_actions(1, con=con)
    assert result[0]["site_scope"] == "specified"
    assert result[0]["site_ids"] == [10, 20]


def test_no_sites_can_default_to_main():
    assert actions._normalize_action_sites({}, None, []) == ("main", [])


def test_site_choices_are_client_scoped():
    con = Conn()
    sites = actions.list_action_sites(1, con=con)
    assert "WHERE client_db_id = %s" in con.sql
    assert "vacated_date IS NULL" in con.sql
    assert "COALESCE(archived, FALSE) = FALSE" in con.sql
    assert sites[0]["is_main"] is True
    assert sites[1]["is_main"] is False
