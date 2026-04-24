from __future__ import annotations

from pathlib import Path
import json
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.admin_routes as admin_routes


class _FakeRow:
    def __init__(self, *values: object):
        self.values = values

    def __getitem__(self, idx: int) -> object:
        return self.values[idx]


class _FakeConn:
    def __init__(self):
        self.executed: list[tuple[str, list[object] | None]] = []

    def execute(self, sql: str, params: list[object] | None = None):
        self.executed.append((sql, params))
        return self

    def fetchone(self):
        sql = self.executed[-1][0] if self.executed else ""
        params = self.executed[-1][1] or []
        if "SELECT setting_value FROM system_settings WHERE setting_key = %s LIMIT 1" in sql:
            return None
        if "SELECT setting_id FROM system_settings WHERE setting_key = %s LIMIT 1" in sql:
            return None
        if "COUNT(*) FROM" in sql:
            return _FakeRow(0)
        return None

    def fetchall(self):
        return []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def test_disaster_recovery_backup_and_status(monkeypatch):
    fake = _FakeConn()
    stored: dict[str, str] = {}
    inventory = {
        "generated_at_utc": "2026-04-24T12:00:00+00:00",
        "inventory": {
            "clients": 3,
            "jobs": 5,
            "datasets": 2,
        },
    }

    monkeypatch.setattr(admin_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(admin_routes, "_dr_inventory_snapshot", lambda con: inventory)
    monkeypatch.setattr(
        admin_routes,
        "_dr_upsert_setting",
        lambda con, *, key, value, updated_by, description=None: stored.__setitem__(key, value),
    )
    monkeypatch.setattr(
        admin_routes,
        "_dr_setting_value",
        lambda con, key: stored.get(key),
    )

    result = admin_routes.create_disaster_recovery_backup(_user={"user_id": "u1", "email": "owner@example.com"})
    assert result["ok"] is True
    assert result["snapshot"]["inventory"]["clients"] == 3
    assert stored["dr_last_backup_snapshot_json"]

    status = admin_routes.disaster_recovery_status(_user={"user_id": "u1", "email": "owner@example.com"})
    assert status["backup_available"] is True
    assert status["backup"]["inventory"]["jobs"] == 5


def test_disaster_recovery_restore_check_detects_mismatch(monkeypatch):
    fake = _FakeConn()
    stored: dict[str, str] = {}
    backup_snapshot = {
        "generated_at_utc": "2026-04-24T12:00:00+00:00",
        "inventory": {
            "clients": 3,
            "jobs": 5,
        },
    }
    live_snapshot = {
        "generated_at_utc": "2026-04-24T12:30:00+00:00",
        "inventory": {
            "clients": 4,
            "jobs": 5,
        },
    }
    stored["dr_last_backup_snapshot_json"] = json.dumps(backup_snapshot)

    monkeypatch.setattr(admin_routes, "get_conn", lambda: fake)
    monkeypatch.setattr(admin_routes, "_dr_inventory_snapshot", lambda con: live_snapshot)
    monkeypatch.setattr(
        admin_routes,
        "_dr_setting_value",
        lambda con, key: stored.get(key),
    )
    monkeypatch.setattr(
        admin_routes,
        "_dr_upsert_setting",
        lambda con, *, key, value, updated_by, description=None: stored.__setitem__(key, value),
    )

    result = admin_routes.run_disaster_recovery_restore_check(_user={"user_id": "u1", "email": "owner@example.com"})

    assert result["ok"] is True
    assert result["status"] == "warn"
    assert result["mismatches"][0]["table"] == "clients"
    assert stored["dr_last_restore_check_json"]
