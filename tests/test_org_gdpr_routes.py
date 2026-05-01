from __future__ import annotations

from io import BytesIO
from pathlib import Path
import json
import sys
import zipfile

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.admin_routes as admin_routes


class _FakeRow:
    def __init__(self, *values: object):
        self.values = values

    def __getitem__(self, idx: int) -> object:
        return self.values[idx]


class _FakeConn:
    def __init__(self, *, user_ids: list[str] | None = None):
        self.executed: list[tuple[str, list[object] | None]] = []
        self._last_sql = ""
        self._user_ids = user_ids or []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql: str, params: list[object] | None = None):
        self.executed.append((sql, params))
        self._last_sql = sql
        return self

    def fetchone(self):
        sql = self._last_sql
        if "FROM organisations" in sql:
            return _FakeRow("org-123", "Shredit ME", "shredit-me", "trial", "active", None, None, None, 3, 10, False, None, None, "2026-05-01", "2026-05-01")
        if "FROM organisation_memberships" in sql and "SELECT role, is_active, is_owner" in sql:
            return _FakeRow("Owner", True, True)
        return None

    def fetchall(self):
        sql = self._last_sql
        if "SELECT user_id FROM organisation_memberships" in sql:
            return [_FakeRow(user_id) for user_id in self._user_ids]
        if "SELECT job_id FROM jobs" in sql:
            return [_FakeRow(101)]
        if "SELECT db_id FROM clients" in sql:
            return [_FakeRow(205)]
        if sql.strip().startswith("DELETE FROM"):
            return [_FakeRow(1)]
        return []


def test_build_org_export_zip_includes_manifest_and_csv(monkeypatch):
    fake = _FakeConn()
    monkeypatch.setattr(admin_routes, "_organisation_entitlement_info", lambda _con, org_id: {"org_id": org_id, "plan": "trial"})
    monkeypatch.setattr(admin_routes, "_org_export_frames", lambda _con, _org_id: [("clients.csv", pd.DataFrame([{"client_name": "Example"}]))])

    payload, archive_name, manifest = admin_routes._build_org_export_zip(fake, "org-123", actor="owner@example.com")

    assert archive_name.startswith("gdpr_export_shredit-me_")
    assert manifest["org_id"] == "org-123"
    assert manifest["exported_by"] == "owner@example.com"

    with zipfile.ZipFile(BytesIO(payload.getvalue())) as zf:
        names = set(zf.namelist())
        assert "clients.csv" in names
        assert "manifest.json" in names
        manifest_data = json.loads(zf.read("manifest.json").decode("utf-8"))
        assert manifest_data["org_name"] == "Shredit ME"
        assert manifest_data["files"][0]["name"] == "clients.csv"


def test_delete_org_data_captures_member_users(monkeypatch):
    fake = _FakeConn(user_ids=["u-1", "u-2"])
    monkeypatch.setattr(admin_routes, "_table_exists", lambda _con, _table_name: True)

    summary = admin_routes._delete_org_data(fake, "org-123")

    users_sql = next(sql for sql, _ in fake.executed if sql.startswith("DELETE FROM users"))
    users_params = next(params for sql, params in fake.executed if sql.startswith("DELETE FROM users"))
    membership_sql = next(sql for sql, _ in fake.executed if sql.startswith("DELETE FROM organisation_memberships"))

    assert "user_id IN (%s, %s)" in users_sql
    assert users_params == ["org-123", "u-1", "u-2"]
    assert fake.executed.index((membership_sql, ["org-123"])) < fake.executed.index((users_sql, ["org-123", "u-1", "u-2"]))
    assert summary["org_id"] == "org-123"
    assert summary["jobs_scanned"] == 1
    assert summary["clients_scanned"] == 1


def test_org_export_route_returns_attachment(monkeypatch):
    fake_payload = BytesIO(b"zip-bytes")
    monkeypatch.setattr(admin_routes, "get_conn", lambda: _FakeConn())
    monkeypatch.setattr(admin_routes, "_ensure_org_lifecycle_schema", lambda con: None)
    monkeypatch.setattr(admin_routes, "_ensure_org_entitlement_schema", lambda con: None)
    monkeypatch.setattr(admin_routes, "_require_org_management_role", lambda con, user, org_id: None)
    monkeypatch.setattr(admin_routes, "_build_org_export_zip", lambda con, org_id, actor=None: (fake_payload, "export.zip", {"org_id": org_id}))

    response = admin_routes.export_current_organisation_data(_user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123"})

    assert response.media_type == "application/zip"
    assert response.headers["content-disposition"] == 'attachment; filename="export.zip"'


def test_org_delete_route_requires_confirmation(monkeypatch):
    monkeypatch.setattr(admin_routes, "get_conn", lambda: _FakeConn())
    monkeypatch.setattr(admin_routes, "_ensure_org_lifecycle_schema", lambda con: None)
    monkeypatch.setattr(admin_routes, "_ensure_org_entitlement_schema", lambda con: None)
    monkeypatch.setattr(admin_routes, "_require_org_owner_role", lambda con, user, org_id: None)
    monkeypatch.setattr(admin_routes, "_delete_org_data", lambda con, org_id: {"org_id": org_id, "tables": []})

    with pytest.raises(admin_routes.HTTPException) as exc_info:
        admin_routes.delete_current_organisation_data(body={"confirm_text": "NOPE"}, _user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123"})

    assert exc_info.value.status_code == 400

    result = admin_routes.delete_current_organisation_data(body={"confirm_text": "DELETE"}, _user={"user_id": "u1", "email": "owner@example.com", "org_id": "org-123"})
    assert result["ok"] is True
    assert result["organisation"]["org_id"] == "org-123"
