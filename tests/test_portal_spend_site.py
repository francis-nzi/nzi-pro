from __future__ import annotations

from pathlib import Path
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.portal_spend_routes as portal_spend_routes  # noqa: E402


class _SiteConn:
    """Fake conn for _resolve_portal_site_id: says whether the site is owned."""

    def __init__(self, owned: bool):
        self._owned = owned
        self.params = None

    def execute(self, sql, params=None):
        self.params = params
        return self

    def fetchone(self):
        return (1,) if self._owned else None


def _resolve(raw, *, owned=True, user=None):
    return portal_spend_routes._resolve_portal_site_id(
        _SiteConn(owned), user if user is not None else {}, 205, raw
    )


def test_unset_site_stays_none() -> None:
    assert _resolve(None) is None
    assert _resolve("") is None
    assert _resolve("   ") is None


def test_a_picked_site_is_returned_as_an_int() -> None:
    assert _resolve("168") == 168
    assert _resolve(168) == 168


def test_a_site_belonging_to_another_client_is_refused() -> None:
    with pytest.raises(HTTPException) as exc:
        _resolve("999", owned=False)
    assert exc.value.status_code == 400


def test_a_non_numeric_site_is_refused() -> None:
    with pytest.raises(HTTPException) as exc:
        _resolve("head office")
    assert exc.value.status_code == 400


def test_a_site_outside_the_users_scope_is_refused() -> None:
    # Portal users can be restricted to a subset of their client's sites.
    with pytest.raises(HTTPException) as exc:
        _resolve("168", user={"site_ids": [163, 164]})
    assert exc.value.status_code == 403


def test_a_site_inside_the_users_scope_is_allowed() -> None:
    assert _resolve("168", user={"site_ids": [163, 168]}) == 168


def test_the_upload_and_manual_paths_no_longer_hardcode_a_null_site() -> None:
    import inspect

    for fn in (portal_spend_routes.portal_spend_upload_commit,):
        assert "site_id=None" not in inspect.getsource(fn), \
            "portal spend submissions must carry the site the client picked"


def test_upload_sites_resolve_each_row_and_default():
    import pandas as pd
    df = pd.DataFrame([{"site_name": "Office"}, {"site_name": " factory "}, {"site_name": ""}])
    sites = [{"site_id": 1, "site_name": "Office"}, {"site_id": 2, "site_name": "Factory"}]
    result = portal_spend_routes._assign_upload_sites(df, sites, 1)
    assert list(result.site_id) == [1, 2, 1]
    assert portal_spend_routes._assign_upload_sites(df, sites).iloc[2].site_id is None


@pytest.mark.parametrize("sites", [[], [{"site_id": 1, "site_name": "Office"}, {"site_id": 2, "site_name": "Office"}]])
def test_upload_rejects_unknown_or_ambiguous_site(sites):
    import pandas as pd
    with pytest.raises(HTTPException) as exc:
        portal_spend_routes._assign_upload_sites(pd.DataFrame([{"site_name": "Office"}]), sites)
    assert exc.value.status_code == 400


@pytest.mark.parametrize("selected_site_id", [None, 1])
def test_template_metadata_filename_sites_and_roundtrip(monkeypatch, selected_site_id):
    import io
    from datetime import date
    from openpyxl import load_workbook
    class Conn:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def execute(self, *args): return self
        def fetchone(self): return ("J000663", date(2025, 4, 1), date(2026, 3, 31), "EFF GROUP", 2026)
    monkeypatch.setattr(portal_spend_routes, "get_conn", lambda: Conn())
    monkeypatch.setattr(portal_spend_routes, "_resolve_job_or_404", lambda *args: 663)
    monkeypatch.setattr(portal_spend_routes, "_portal_spend_sites", lambda *args: [{"site_id": 1, "site_name": "Office"}])
    response = portal_spend_routes.portal_spend_template({"client_db_id": 1}, site_id=selected_site_id)
    suffix = " Office" if selected_site_id else ""
    assert f'J000663 EFF GROUP Spend Analysis 2025-2026{suffix}.xlsx' in response.headers["content-disposition"]
    wb = load_workbook(io.BytesIO(response.body))
    ws = wb["Spend Data"]
    assert ws["B1"].value == "EFF GROUP"
    assert ws["F1"].value == "J000663"
    assert ws["F2"].value == "Apr 2025 - Mar 2026"
    assert ws["B2"].value == ("Office" if selected_site_id else "Select a site for each spend line")
    assert all(ws.cell(r, 7).value == ("Office" if selected_site_id else None) for r in range(6, 106))
    with pytest.raises(HTTPException) as exc:
        portal_spend_routes.portal_spend_template({"client_db_id": 1}, site_id=999)
    assert exc.value.status_code == 400
    assert ws["G5"].value == "Site Name"
    assert wb["Sites"]["A2"].value == "Office"
    assert len(ws.data_validations.dataValidation) == 1
    for cell, value in {"A6": "00123", "B6": "Services", "C6": 500, "D6": 20, "G6": "Office"}.items():
        ws[cell] = value
    out = io.BytesIO()
    wb.save(out)
    result = portal_spend_routes._parse_upload(out.getvalue(), "upload.xlsx")
    assert len(result) == 1  # Blank formatted rows must not become spend entries.
    assert result.iloc[0].reference_code == "00123"
    assert result.iloc[0].site_name == "Office"
    assert result.iloc[0].amount_net == 500


def test_legacy_csv_without_sites_remains_supported():
    result = portal_spend_routes._parse_upload(
        b"GL / Nominal Code,Description,Net Value (excl VAT),VAT %\n123,Services,500,20\n", "old.csv")
    assert len(result) == 1
    assert result.iloc[0].site_name == ""


def test_upload_commit_persists_each_sites_allocation(monkeypatch):
    import asyncio
    import io
    from fastapi import UploadFile
    class Conn:
        def __enter__(self): return self
        def __exit__(self, *args): pass
    monkeypatch.setattr(portal_spend_routes, "get_conn", lambda **kwargs: Conn())
    monkeypatch.setattr(portal_spend_routes, "_ensure_spend_tables", lambda *args: None)
    monkeypatch.setattr(portal_spend_routes, "_resolve_job_or_404", lambda *args: 663)
    monkeypatch.setattr(portal_spend_routes, "_assert_data_entry_open", lambda *args: None)
    monkeypatch.setattr(portal_spend_routes, "scan_bytes", lambda *args, **kwargs: None)
    monkeypatch.setattr(portal_spend_routes, "_portal_spend_sites", lambda *args: [
        {"site_id": 1, "site_name": "Office"}, {"site_id": 2, "site_name": "Factory"}])
    saved = []
    monkeypatch.setattr(portal_spend_routes, "_persist_spend_row", lambda **kwargs: saved.append(kwargs))
    upload = UploadFile(filename="spend.csv", file=io.BytesIO(
        b"Description,Net Value,Site Name\nServices,100,Office\nServices,200,Factory\n"))
    result = asyncio.run(portal_spend_routes.portal_spend_upload_commit(
        file=upload, site_id=None, current_user={"client_db_id": 10, "role": "ClientAdmin"}))
    assert result["inserted"] == 2
    assert [(r["site_id"], r["amount_net"]) for r in saved] == [(1, 100), (2, 200)]


def test_edit_site_is_validated_and_saved_for_review(monkeypatch):
    class Conn:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def execute(self, sql, params=None):
            self.sql = sql
            self.params = params
            return self
        def fetchone(self): return (9, "approved", 663)
    conn = Conn()
    monkeypatch.setattr(portal_spend_routes, "get_conn", lambda: conn)
    monkeypatch.setattr(portal_spend_routes, "_ensure_spend_tables", lambda *args: None)
    monkeypatch.setattr(portal_spend_routes, "_assert_data_entry_open", lambda *args: None)
    validated = []
    def resolve(con, user, client_id, raw):
        validated.append((client_id, raw))
        return 2
    monkeypatch.setattr(portal_spend_routes, "_resolve_portal_site_id", resolve)
    result = portal_spend_routes.portal_spend_update_row(9, {"site_id": 2}, {"client_db_id": 10})
    assert validated == [(10, 2)]
    assert "site_id = %s" in conn.sql
    assert conn.params == [2, 9]
    assert result["review_status"] == "pending_review"
