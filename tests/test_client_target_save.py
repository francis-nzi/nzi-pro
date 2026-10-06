import sqlite3
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pytest
from api import client_management_routes as routes


@pytest.fixture
def client_db(monkeypatch):
    db = sqlite3.connect(":memory:")
    columns = ["db_id INTEGER", "org_id TEXT", "client_name TEXT", "billing_same_as_main BOOLEAN"]
    columns += [f"{prefix}{part} TEXT" for prefix in ("addr_", "billing_addr_") for part in ("line1", "line2", "city", "region", "postcode", "country")]
    columns += ["interim_year INTEGER"] + [f"interim_s{i}_pct NUMERIC" for i in (1, 2, 3)]
    columns += [f"target_s{i}_{kind} NUMERIC" for i in (1, 2, 3) for kind in ("year", "pct")]
    db.execute("CREATE TABLE clients (" + ",".join(columns) + ")")
    db.execute("INSERT INTO clients (db_id, org_id, client_name, interim_year, interim_s1_pct) VALUES (140, 'test', 'Client', 2035, 50)")
    monkeypatch.setattr(routes, "get_conn", lambda: db)
    for name in ("assert_permission", "assert_client_access", "_ensure_client_org_columns", "_ensure_client_billing_columns", "ensure_client_benchmark_columns", "ensure_client_context_columns", "record_audit_event"):
        monkeypatch.setattr(routes, name, lambda *a, **kw: None)
    monkeypatch.setattr(routes, "require_org", lambda *a: "test")
    monkeypatch.setattr(routes, "_client_audit_snapshot", lambda *a: {})
    monkeypatch.setattr(routes, "_client_column_names", lambda con: {r[1] for r in con.execute("PRAGMA table_info(clients)")})
    def fetch(con, sql, params):
        cur = con.execute(sql, params)
        row = cur.fetchone()
        return dict(zip([d[0] for d in cur.description], row)) if row else None
    monkeypatch.setattr(routes, "fetch_row_dict", fetch)
    yield db
    db.close()


@pytest.mark.parametrize("pct", [30, 0, 100])
def test_edit_targets_persist_after_reload(client_db, pct):
    body = {f"target_s{i}_{kind}": (pct if kind == "pct" else 2030 + i)
            for i in (1, 2, 3) for kind in ("year", "pct")}
    assert routes.update_client(None, 140, body, {})["ok"]
    result = routes.get_client(140, {})
    for i in (1, 2, 3):
        assert result[f"target_s{i}_pct"] == pct
        assert result[f"interim_s{i}_pct"] == pct
        assert result[f"target_s{i}_year"] == 2030 + i


def test_legacy_values_load_when_scope_targets_unset(client_db):
    result = routes.get_client(140, {})
    assert result["target_s1_pct"] == 50
    assert result["target_s1_year"] == 2035


def test_unrelated_save_preserves_targets(client_db):
    routes.update_client(None, 140, {"target_s1_pct": 30}, {})
    routes.update_client(None, 140, {"client_name": "Updated"}, {})
    assert routes.get_client(140, {})["target_s1_pct"] == 30
