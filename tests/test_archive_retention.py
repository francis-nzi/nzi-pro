from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.admin_routes as admin_routes


class _FakeRow:
    def __init__(self, *values: object):
        self.values = values

    def __getitem__(self, idx: int) -> object:
        return self.values[idx]


class _ArchiveConn:
    def __init__(self):
        self.executed: list[tuple[str, list[object] | None]] = []

    def execute(self, sql: str, params: list[object] | None = None):
        self.executed.append((sql, params))
        return self

    def fetchone(self):
        sql = self.executed[-1][0] if self.executed else ""
        params = self.executed[-1][1] or []
        if "setting_value FROM system_settings" in sql:
            return _FakeRow("90")
        if "COUNT(*) AS archived_total" in sql and "FROM datasets" in sql:
            return _FakeRow(2, 1)
        if "COUNT(*) AS archived_total" in sql and "FROM clients" in sql:
            return _FakeRow(2, 1)
        if "SELECT COUNT(*) FROM jobs WHERE client_db_id" in sql:
            return _FakeRow(0 if params and params[0] == 21 else 1)
        if "SELECT COUNT(*) FROM quotes WHERE client_db_id" in sql:
            return _FakeRow(0 if params and params[0] == 21 else 1)
        if "SELECT COUNT(*) FROM invoices WHERE client_db_id" in sql:
            return _FakeRow(0 if params and params[0] == 21 else 1)
        if "SELECT COUNT(*) FROM client_spend_mappings WHERE client_db_id" in sql:
            return _FakeRow(0 if params and params[0] == 21 else 1)
        if "FROM clients WHERE db_id = %s" in sql:
            return _FakeRow("Client A", "Archived")
        if "SELECT archived FROM datasets WHERE dataset_id = %s" in sql:
            return _FakeRow(True)
        return None

    def fetchall(self):
        sql = self.executed[-1][0] if self.executed else ""
        cutoff_old = datetime.now() - timedelta(days=120)
        if "FROM datasets" in sql and "archived_at" in sql:
            return [_FakeRow(11, "Dataset A"), _FakeRow(12, "Dataset B")]
        if "FROM clients" in sql and "archived_at" in sql:
            return [
                _FakeRow(21, "Client A", cutoff_old),
                _FakeRow(22, "Client B", cutoff_old),
            ]
        return []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def test_archive_retention_summary_reports_cutoff(monkeypatch):
    fake = _ArchiveConn()
    monkeypatch.setattr(admin_routes, "get_conn", lambda: fake)

    result = admin_routes.archive_retention_summary(_user={"user_id": "u1", "email": "owner@example.com"})

    assert result["retention_days"] == 90
    assert result["datasets"]["purgeable_total"] == 1
    assert result["clients"]["purgeable_total"] == 1
    assert any("setting_key = %s" in sql for sql, _ in fake.executed)


def test_purge_archived_data_deletes_eligible_items_and_skips_dependent_clients(monkeypatch):
    fake = _ArchiveConn()
    monkeypatch.setattr(admin_routes, "get_conn", lambda: fake)

    result = admin_routes.purge_archived_data(
        {"retention_days": 90},
        _user={"user_id": "u1", "email": "owner@example.com"},
    )

    assert result["ok"] is True
    assert result["counts"]["datasets_deleted"] == 2
    assert result["counts"]["clients_deleted"] == 1
    assert result["counts"]["clients_skipped"] == 1
    assert any("DELETE FROM factor_lookup" in sql for sql, _ in fake.executed)
    assert any("DELETE FROM clients" in sql for sql, _ in fake.executed)
