from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd

import api.client_dashboard_routes as client_dashboard_routes
import api.quotes_routes as quotes_routes


class _FakeConn:
    def __init__(self, row=None):
        self.row = row
        self.queries: list[tuple[str, list[object] | None]] = []
        self._last_sql = ""

    def execute(self, sql: str, params: list[object] | None = None):
        self.queries.append((sql, params))
        self._last_sql = sql
        return self

    def fetchone(self):
        return self.row

    def df(self):
        return pd.DataFrame([])

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def test_quote_lookups_allows_client_row_without_org_filter(monkeypatch) -> None:
    conn = _FakeConn(("Advanced Electric Machines (AEM)", "London, UK", "GBP"))
    monkeypatch.setattr(quotes_routes, "assert_client_access", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(quotes_routes, "_quote_org_id", lambda *_args, **_kwargs: "org-a")
    monkeypatch.setattr(quotes_routes, "get_conn", lambda: conn)

    result = quotes_routes.quote_lookups(89, _user={"user_id": "u1", "org_id": "org-a"})

    assert result["client"]["client_name"] == "Advanced Electric Machines (AEM)"
    assert result["client"]["currency"] == "GBP"
    assert any("FROM clients" in sql and "WHERE db_id = %s" in sql for sql, _ in conn.queries)


def test_client_dashboard_jobs_use_job_org_matching(monkeypatch) -> None:
    conn = _FakeConn()
    monkeypatch.setattr(client_dashboard_routes, "get_conn", lambda: conn)

    client_dashboard_routes._load_client_jobs(conn, 89, "org-a", crp_only=True)

    assert any("COALESCE(j.org_id, c.org_id) = %s" in sql for sql, _ in conn.queries)
