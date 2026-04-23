from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi import HTTPException

import api.business_development_routes as bdr


class _LimitConn:
    def __init__(self):
        self.queries: list[tuple[str, list[object] | None]] = []
        self._last_sql = ""

    def execute(self, sql: str, params: list[object] | None = None):
        self.queries.append((sql, params))
        self._last_sql = sql
        return self

    def fetchone(self):
        if "SELECT db_id FROM clients WHERE org_id = ?" in self._last_sql:
            return None
        if "FROM organisation_entitlements" in self._last_sql:
            return (
                "org-a",
                "growth",
                "active",
                5,
                1,
                None,
                None,
                None,
                "active",
                None,
                None,
                True,
                None,
                None,
            )
        if "SELECT COALESCE(archived, FALSE) FROM organisations WHERE org_id = ? LIMIT 1" in self._last_sql:
            return (False,)
        if "FROM organisation_memberships" in self._last_sql and "COUNT(*)" in self._last_sql:
            return (1,)
        if "FROM organisation_invitations" in self._last_sql and "COUNT(*)" in self._last_sql:
            return (0,)
        if "FROM clients" in self._last_sql and "COUNT(*)" in self._last_sql:
            return (1,)
        return None


def test_ensure_client_for_opportunity_rejects_on_client_limit() -> None:
    conn = _LimitConn()
    opp = {
        "opportunity_id": 123,
        "company_name": "New Lead Co",
        "industry": "Energy",
        "country": "GB",
        "currency": "GBP",
    }

    with pytest.raises(HTTPException) as exc_info:
        bdr._ensure_client_for_opportunity(conn, opp, "Tester", "org-a")

    assert exc_info.value.status_code == 403
    assert "client limit" in str(exc_info.value.detail).lower()
    assert not any("INSERT INTO clients" in sql for sql, _ in conn.queries)
