from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import services.sites as sites


class _ExistingRegisteredOfficeConn:
    def __init__(self):
        self.queries: list[tuple[str, list[object] | None]] = []
        self._last_sql = ""

    def execute(self, sql: str, params: list[object] | None = None):
        self.queries.append((sql, params))
        self._last_sql = sql
        return self

    def fetchone(self):
        if "FROM clients" in self._last_sql:
            return (
                True,
                "9-10 Manor Courtyard Hughenden Avenue",
                None,
                "High Wycombe",
                "Buckinghamshire",
                "HP13 5RE",
                "United Kingdom",
            )
        if "FROM client_sites" in self._last_sql:
            return (
                101,
                "Registered Office",
                "9-10 Manor Courtyard, Hughenden Avenue, High Wycombe, "
                "Buckinghamshire, HP13 5RE, United Kingdom",
            )
        return None


def test_existing_registered_office_keeps_user_edited_location(monkeypatch) -> None:
    conn = _ExistingRegisteredOfficeConn()
    monkeypatch.setattr(sites, "ensure_client_sites_runtime_columns", lambda _con: None)
    monkeypatch.setattr(sites, "_ensure_client_site_flag_column", lambda _con: None)

    site_id = sites.ensure_registered_office_site(248, con=conn)

    assert site_id == 101
    assert not any(
        sql.lstrip().upper().startswith("UPDATE CLIENT_SITES")
        for sql, _params in conn.queries
    )
