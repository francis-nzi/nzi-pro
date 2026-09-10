"""Approved portal rows stay editable across every Data Entry tab, matching
the behaviour Employee Commuting has always had: data arrives through the year,
and a client shouldn't lose access to a row the moment the CRM reviews what has
been entered so far. Saving sends the row back for review. Deleting an approved
row is still refused.
"""
from __future__ import annotations

from pathlib import Path
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.portal_data_entry_routes as portal_data_entry_routes
import api.portal_spend_routes as portal_spend_routes

PORTAL_USER = {"client_db_id": 7, "role": "ClientAdmin", "email": "client@example.com", "full_name": "Client User"}


class _Conn:
    """Returns a canned row for the ownership SELECT and records writes."""

    def __init__(self, existing_row):
        self._existing = existing_row
        self.writes: list[tuple[str, list]] = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, sql, params=None):
        stripped = sql.strip().upper()
        if stripped.startswith("UPDATE") or stripped.startswith("DELETE"):
            self.writes.append((sql, list(params or [])))
        self._last = sql
        return self

    def fetchone(self):
        if "SELECT" in self._last.upper() and "UPDATE" not in self._last.strip().upper()[:6]:
            return self._existing
        return None

    def df(self):
        import pandas as pd

        return pd.DataFrame()


def _patch_common(monkeypatch, module, conn):
    monkeypatch.setattr(module, "get_conn", lambda: conn)
    monkeypatch.setattr(module, "_assert_data_entry_open", lambda *_a, **_k: None)
    monkeypatch.setattr(module, "record_audit_event", lambda *_a, **_k: None, raising=False)


def test_generic_bucket_row_is_editable_after_approval(monkeypatch):
    # row_id, job_id, site_id, review_status
    conn = _Conn((5001, 217, 3, "approved"))
    _patch_common(monkeypatch, portal_data_entry_routes, conn)
    monkeypatch.setattr(portal_data_entry_routes, "_ensure_job_scope_rows_schema", lambda *_a: None)

    result = portal_data_entry_routes.portal_data_entry_update_row(
        request=None, bucket_key="other", row_id=5001, payload={"qty": 42.0}, current_user=PORTAL_USER
    )

    assert result["review_status"] == "pending_review"
    update_sql = " ".join(sql for sql, _p in conn.writes)
    assert "review_status = 'pending_review'" in update_sql
    # enabled is deliberately untouched so an approved row doesn't drop out of
    # reports mid-year just because another month was added.
    assert "enabled" not in update_sql


def test_register_bucket_row_is_editable_after_approval(monkeypatch):
    # source_id, job_id, site_id, review_status, factor, ghg_unit, apply_pct
    conn = _Conn((470, 217, 3, "approved", 0.26902, "kgCO2e", 100))
    _patch_common(monkeypatch, portal_data_entry_routes, conn)
    monkeypatch.setattr(portal_data_entry_routes, "_ensure_emission_register_schema", lambda *_a: None)

    result = portal_data_entry_routes.portal_data_entry_update_row(
        request=None, bucket_key="company_vehicles", row_id=470, payload={"qty": 1000.0}, current_user=PORTAL_USER
    )

    assert result["review_status"] == "pending_review"
    update_sql = " ".join(sql for sql, _p in conn.writes)
    assert "job_emission_sources" in update_sql
    assert "calc_tco2e" in update_sql


def test_spend_row_is_editable_after_approval(monkeypatch):
    # entry_id, review_status, job_id
    conn = _Conn((900, "approved", 217))
    _patch_common(monkeypatch, portal_spend_routes, conn)
    monkeypatch.setattr(portal_spend_routes, "_ensure_spend_tables", lambda *_a: None)

    result = portal_spend_routes.portal_spend_update_row(
        entry_id=900, payload={"spend_description": "Revised description"}, current_user=PORTAL_USER
    )

    assert result["review_status"] == "pending_review"


@pytest.mark.parametrize("bucket_key", ["other", "company_vehicles"])
def test_deleting_an_approved_row_is_still_refused(monkeypatch, bucket_key):
    conn = _Conn((5001, 217, 3, "approved"))
    _patch_common(monkeypatch, portal_data_entry_routes, conn)
    monkeypatch.setattr(portal_data_entry_routes, "_ensure_job_scope_rows_schema", lambda *_a: None)
    monkeypatch.setattr(portal_data_entry_routes, "_ensure_emission_register_schema", lambda *_a: None)

    with pytest.raises(HTTPException) as excinfo:
        portal_data_entry_routes.portal_data_entry_delete_row(
            request=None, bucket_key=bucket_key, row_id=5001, current_user=PORTAL_USER
        )

    assert excinfo.value.status_code == 409
    assert "deleted" in str(excinfo.value.detail)
    assert not conn.writes


def test_deleting_an_approved_spend_row_is_still_refused(monkeypatch):
    conn = _Conn((900, "approved", 217))
    _patch_common(monkeypatch, portal_spend_routes, conn)
    monkeypatch.setattr(portal_spend_routes, "_ensure_spend_tables", lambda *_a: None)

    with pytest.raises(HTTPException) as excinfo:
        portal_spend_routes.portal_spend_delete_row(entry_id=900, current_user=PORTAL_USER)

    assert excinfo.value.status_code == 409
    assert not conn.writes
