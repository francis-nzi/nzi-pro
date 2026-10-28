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


# ── Registered address → Registered Office site sync (update_client) ──────────


class _SyncConn:
    """Fake conn for _sync_registered_office_site_from_address: one RO site
    lookup returning `site_row`, records every UPDATE/INSERT issued."""

    def __init__(self, site_row):
        self._site_row = site_row
        self._last_sql = ""
        self.updates: list[tuple[str, list]] = []

    def execute(self, sql: str, params=None):
        self._last_sql = sql
        stripped = sql.strip().upper()
        if stripped.startswith(("UPDATE CLIENT_SITES", "INSERT INTO CLIENT_SITES")):
            self.updates.append((sql, params or []))
        return self

    def fetchone(self):
        if "FROM client_sites" in self._last_sql:
            return self._site_row
        if "INSERT INTO client_sites" in self._last_sql:
            return (555,)
        return None


def _sync(monkeypatch, conn, **kwargs):
    monkeypatch.setattr(client_routes, "_client_site_audit_snapshot", lambda *_a, **_k: {})
    monkeypatch.setattr(client_routes, "record_audit_event", lambda *_a, **_k: None)
    defaults = dict(
        client_db_id=154, org_id="org-1",
        new_location="The Motte, Berkhamsted, HP4 1HR, United Kingdom",
        previous_location="Old Hall, Norwich, NR1 1AA, United Kingdom",
        request=None, actor={},
    )
    defaults.update(kwargs)
    client_routes._sync_registered_office_site_from_address(conn, **defaults)


def test_sync_updates_untouched_registered_office_site(monkeypatch) -> None:
    conn = _SyncConn((333, "Old Hall, Norwich, NR1 1AA, United Kingdom"))
    _sync(monkeypatch, conn)

    assert len(conn.updates) == 1
    sql, params = conn.updates[0]
    assert sql.strip().upper().startswith("UPDATE CLIENT_SITES")
    assert params[0] == "The Motte, Berkhamsted, HP4 1HR, United Kingdom"
    # geocode is cleared so "Geocode Sites" re-resolves it
    assert "latitude = NULL" in sql


def test_sync_leaves_hand_edited_site_alone(monkeypatch) -> None:
    conn = _SyncConn((333, "Client's actual HQ, 5 Some Street, Leeds, LS1 1AA"))
    _sync(monkeypatch, conn)

    assert conn.updates == []


def test_sync_is_noop_when_address_unchanged(monkeypatch) -> None:
    conn = _SyncConn((333, "Old Hall, Norwich, NR1 1AA, United Kingdom"))
    _sync(
        monkeypatch, conn,
        new_location="Old Hall, Norwich, NR1 1AA, United Kingdom",
        previous_location="Old Hall, Norwich, NR1 1AA, United Kingdom",
    )

    assert conn.updates == []


def test_sync_creates_site_when_none_exists(monkeypatch) -> None:
    conn = _SyncConn(None)
    _sync(monkeypatch, conn)

    assert len(conn.updates) == 1
    sql, params = conn.updates[0]
    assert "INSERT INTO client_sites" in sql
    assert params[3] == "The Motte, Berkhamsted, HP4 1HR, United Kingdom"


# ── Registered address → job report metadata sync (update_client) ─────────────


class _ReportMetaConn:
    def __init__(self, updated_job_ids, table_exists=True):
        self._updated = [(j,) for j in updated_job_ids]
        self._table_exists = table_exists
        self._last_sql = ""
        self.updates: list[tuple[str, list]] = []

    def execute(self, sql: str, params=None):
        self._last_sql = sql
        if sql.strip().upper().startswith("UPDATE JOB_REPORT_METADATA"):
            self.updates.append((sql, params or []))
        return self

    def fetchone(self):
        return ("job_report_metadata" if self._table_exists else None,)

    def fetchall(self):
        return self._updated


_OLD_ADDR = ("20 Field Lane", "Kessingland", "Lowestoft", "Suffolk", "NR33 7QB", "United Kingdom")
_NEW_ADDR = ("61 Alexandra Road", "", "Lowestoft", "Suffolk", "NR33 1PL", "United Kingdom")


def _sync_report(monkeypatch, conn, **kwargs):
    events: list[dict] = []
    monkeypatch.setattr(client_routes, "record_audit_event", lambda *_a, **k: events.append(k))
    defaults = dict(
        client_db_id=129, new_parts=_NEW_ADDR, previous_parts=_OLD_ADDR,
        request=None, actor={"email": "consultant@example.com"},
    )
    defaults.update(kwargs)
    client_routes._sync_report_registered_address_from_client(conn, **defaults)
    return events


def test_report_address_follows_client_address_on_open_jobs(monkeypatch) -> None:
    conn = _ReportMetaConn([786])
    events = _sync_report(monkeypatch, conn)

    assert len(conn.updates) == 1
    sql, params = conn.updates[0]
    assert params[0] == "61 Alexandra Road, Lowestoft, Suffolk, NR33 1PL, United Kingdom"
    assert params[1] == "consultant@example.com"
    assert params[2] == 129
    # only rows still holding the previously derived address are touched
    assert "m.registered_address = ?" in sql
    assert params[3] == "20 Field Lane, Kessingland, Lowestoft, Suffolk, NR33 7QB, United Kingdom"
    # closed jobs keep the address they were reported with
    assert "closed" in params[4:]
    assert [e["job_id"] for e in events] == [786]


def test_report_address_sync_is_noop_when_address_unchanged(monkeypatch) -> None:
    conn = _ReportMetaConn([786])
    _sync_report(monkeypatch, conn, new_parts=_OLD_ADDR)

    assert conn.updates == []


def test_report_address_sync_skips_when_metadata_table_missing(monkeypatch) -> None:
    conn = _ReportMetaConn([], table_exists=False)
    _sync_report(monkeypatch, conn)

    assert conn.updates == []
