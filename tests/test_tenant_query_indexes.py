from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import core.migrations as migrations


class _FakeConn:
    def __init__(self):
        self.executed: list[str] = []

    def execute(self, sql: str, params: list[object] | None = None):
        self.executed.append(sql)
        return self

    def fetchone(self):
        return None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def test_run_migrations_emits_tenant_query_indexes(monkeypatch):
    fake = _FakeConn()
    monkeypatch.setattr(migrations, "get_conn", lambda: fake)
    monkeypatch.setattr(migrations, "db_backend", lambda: "postgres")
    monkeypatch.setattr(migrations, "ensure_permission_schema", lambda con: None)

    migrations.run_migrations()

    assert any("ix_clients_org_name_lookup" in sql for sql in fake.executed)
    assert any("ix_jobs_org_client_lookup" in sql for sql in fake.executed)
    assert any("ix_time_logs_org_job_lookup" in sql for sql in fake.executed)
    assert any("ix_job_types_org_name_lookup" in sql for sql in fake.executed)
    assert not any("job_report_variables_legacy_view" in sql for sql in fake.executed)
