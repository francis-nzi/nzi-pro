from __future__ import annotations

from pathlib import Path
import sys

import pandas as pd
import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.client_management_routes as client_routes
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


def test_site_display_name_prefers_name_then_location_then_id() -> None:
    assert sites.site_display_name(101, " Main Office ", "London") == "Main Office"
    assert sites.site_display_name(102, "", " Great Yarmouth ") == "Great Yarmouth"
    assert sites.site_display_name(103, None, None) == "Site 103"
    assert sites.site_display_name(None, pd.NA, pd.NA) == "Unnamed Site"


class _CreateSiteConn:
    def __init__(self):
        self.queries: list[tuple[str, list[object] | None]] = []
        self._last_sql = ""

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, sql: str, params: list[object] | None = None):
        self.queries.append((sql, params))
        self._last_sql = sql
        return self

    def fetchone(self):
        if "INSERT INTO client_sites" in self._last_sql:
            return (280,)
        return None


def _patch_create_site_dependencies(monkeypatch, conn: _CreateSiteConn) -> None:
    monkeypatch.setattr(client_routes, "assert_permission", lambda *_args: None)
    monkeypatch.setattr(client_routes, "assert_client_access", lambda *_args: None)
    monkeypatch.setattr(client_routes, "require_org", lambda *_args: "org-1")
    monkeypatch.setattr(client_routes, "get_conn", lambda: conn)
    monkeypatch.setattr(client_routes, "_ensure_client_org_columns", lambda *_args: None)
    monkeypatch.setattr(client_routes, "_ensure_client_sites_runtime_columns", lambda *_args: None)
    monkeypatch.setattr(client_routes, "_client_site_audit_snapshot", lambda *_args: {})
    monkeypatch.setattr(client_routes, "record_audit_event", lambda *_args, **_kwargs: None)


def test_create_site_uses_location_when_name_is_blank(monkeypatch) -> None:
    conn = _CreateSiteConn()
    _patch_create_site_dependencies(monkeypatch, conn)

    result = client_routes.create_client_site(
        request=None,
        client_db_id=93,
        body={"site_name": "", "location": " Great Yarmouth "},
        _user={},
    )

    assert result == {"ok": True, "site_id": 280}
    insert_params = next(
        params for sql, params in conn.queries if "INSERT INTO client_sites" in sql
    )
    assert insert_params == ["org-1", 93, "Great Yarmouth", "Great Yarmouth", False]


def test_create_site_rejects_blank_name_and_location(monkeypatch) -> None:
    conn = _CreateSiteConn()
    _patch_create_site_dependencies(monkeypatch, conn)

    with pytest.raises(HTTPException) as error:
        client_routes.create_client_site(
            request=None,
            client_db_id=93,
            body={"site_name": " ", "location": " "},
            _user={},
        )

    assert error.value.status_code == 400
    assert not conn.queries
