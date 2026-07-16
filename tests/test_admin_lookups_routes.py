from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd

import api.admin_lookups_routes as admin_lookups_routes


class _FakeResult:
    def __init__(self, *, fetchone_value=None, df_value=None):
        self._fetchone_value = fetchone_value
        self._df_value = df_value if df_value is not None else pd.DataFrame()

    def fetchone(self):
        return self._fetchone_value

    def df(self):
        return self._df_value


class _FakeConn:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql: str, params=None):
        sql_norm = " ".join(sql.lower().split())
        if "information_schema.columns" in sql_norm:
            return _FakeResult(fetchone_value=None)
        if "select * from positions_lookup" in sql_norm:
            return _FakeResult(
                df_value=pd.DataFrame(
                    [
                        {"position_id": 1, "name": "Director", "is_active": True},
                        {"position_id": 2, "name": "Manager", "is_active": True},
                    ]
                )
            )
        return _FakeResult(fetchone_value=None)


def test_positions_lookup_list_does_not_raise(monkeypatch):
    monkeypatch.setattr(admin_lookups_routes, "_ensure_lookup_table_once", lambda *args, **kwargs: None)
    monkeypatch.setattr(admin_lookups_routes, "get_conn", lambda: _FakeConn())

    result = admin_lookups_routes.list_lookup_items("positions_lookup", False, {"is_super_admin": True})

    assert len(result["items"]) == 2
    assert result["items"][0]["name"] == "Director"


def test_portfolios_lookup_create_and_update_support_owner_link(monkeypatch):
    class _PortfolioLookupConn:
        def __init__(self):
            self.executed: list[tuple[str, list[object] | None]] = []
            self._last_sql = ""

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, sql: str, params=None):
            self.executed.append((sql, params))
            self._last_sql = sql
            return self

        def fetchone(self):
            if "SELECT 1 FROM portfolios_lookup" in self._last_sql:
                return None
            if "SELECT is_active FROM portfolios_lookup" in self._last_sql:
                return (True,)
            return None

    fake = _PortfolioLookupConn()
    monkeypatch.setattr(admin_lookups_routes, "_ensure_lookup_table", lambda *args, **kwargs: None)
    monkeypatch.setattr(admin_lookups_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(admin_lookups_routes, "require_org", lambda _user: "org-123")

    create_result = admin_lookups_routes.create_lookup_item(
        "portfolios_lookup",
        {"name": "Acme Group", "portfolio_owner_client_db_id": 42, "is_active": True},
        {"user_id": "u1", "org_id": "org-123"},
    )

    update_result = admin_lookups_routes.update_lookup_item(
        "portfolios_lookup",
        7,
        {"name": "Acme Group", "portfolio_owner_client_db_id": 84},
        {"user_id": "u1", "org_id": "org-123"},
    )

    assert create_result["ok"] is True
    assert update_result["ok"] is True
    assert any("portfolio_owner_client_db_id" in sql for sql, _ in fake.executed)
