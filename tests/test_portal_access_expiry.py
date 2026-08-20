from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

import api.job_review_routes as job_review_routes
import services.portal as portal_service


def _access_record(*, expires_at: str | None = "2030-06-01 12:30:00+00:00") -> dict:
    return {
        "client_db_id": 7,
        "is_enabled": True,
        "access_expires_at": expires_at,
        "payment_status": "paid",
        "payment_reference": "INV-7",
        "nav_config": {"dashboard": True},
        "notes": "existing",
        "portal_trained": False,
        "max_users": None,
    }


class _RecordingConnection:
    def __init__(self):
        self.executed: list[tuple[str, list[object]]] = []

    def execute(self, sql: str, params=None):
        self.executed.append((sql, list(params or [])))
        return self


def test_expiry_payload_accepts_existing_timestamp_shapes_and_year_9999():
    local_value = job_review_routes.UpsertPortalAccessPayload(
        access_expires_at="2030-06-01T12:30"
    )
    utc_value = job_review_routes.UpsertPortalAccessPayload(
        access_expires_at="2030-06-01T13:30:00+01:00"
    )
    max_value = job_review_routes.UpsertPortalAccessPayload(
        access_expires_at="9999-12-31T23:59:59"
    )

    assert local_value.access_expires_at == datetime(2030, 6, 1, 12, 30, tzinfo=timezone.utc)
    assert utc_value.access_expires_at == datetime(2030, 6, 1, 12, 30, tzinfo=timezone.utc)
    assert max_value.access_expires_at == datetime(9999, 12, 31, 23, 59, 59, tzinfo=timezone.utc)


@pytest.mark.parametrize(
    "value",
    [
        "not-a-timestamp",
        "",
        "1999-12-31T23:59:59Z",
        "10000-01-01T00:00:00Z",
    ],
)
def test_expiry_payload_rejects_invalid_or_out_of_range_values(value: str):
    with pytest.raises(ValidationError):
        job_review_routes.UpsertPortalAccessPayload(access_expires_at=value)


def test_update_route_distinguishes_omitted_expiry_from_explicit_null(monkeypatch):
    captured: list[dict] = []

    monkeypatch.setattr(job_review_routes, "assert_client_access", lambda *_args: None)
    monkeypatch.setattr(
        job_review_routes,
        "upsert_client_portal_access",
        lambda client_db_id, **kwargs: captured.append(
            {"client_db_id": client_db_id, **kwargs}
        )
        or _access_record(expires_at=kwargs.get("access_expires_at")),
    )

    job_review_routes.update_portal_access(
        7,
        job_review_routes.UpsertPortalAccessPayload(nav_config={"dashboard": False}),
        _user={"user_id": "u1"},
    )
    job_review_routes.update_portal_access(
        7,
        job_review_routes.UpsertPortalAccessPayload(access_expires_at=None),
        _user={"user_id": "u1"},
    )

    assert "access_expires_at" not in captured[0]
    assert "access_expires_at" in captured[1]
    assert captured[1]["access_expires_at"] is None


def test_service_explicit_null_clears_but_omitted_value_is_preserved(monkeypatch):
    existing = _access_record()
    monkeypatch.setattr(portal_service, "ensure_portal_schema", lambda _con: None)
    monkeypatch.setattr(
        portal_service,
        "get_client_portal_access",
        lambda *_args, **_kwargs: dict(existing),
    )

    clear_conn = _RecordingConnection()
    portal_service.upsert_client_portal_access(7, access_expires_at=None, con=clear_conn)

    preserve_conn = _RecordingConnection()
    portal_service.upsert_client_portal_access(
        7,
        nav_config={"dashboard": False},
        con=preserve_conn,
    )

    assert clear_conn.executed[0][1][2] is None
    assert preserve_conn.executed[0][1][2] == existing["access_expires_at"]


def test_service_rejects_invalid_expiry_before_any_sql():
    conn = _RecordingConnection()

    with pytest.raises(HTTPException) as exc_info:
        portal_service.upsert_client_portal_access(
            7,
            access_expires_at="1200-01-01T00:00:00Z",
            con=conn,
        )

    assert exc_info.value.status_code == 400
    assert conn.executed == []


def test_runtime_access_check_fails_closed_for_malformed_legacy_expiry(monkeypatch):
    monkeypatch.setattr(
        portal_service,
        "get_client_portal_access",
        lambda *_args, **_kwargs: _access_record(expires_at="not-a-timestamp"),
    )

    allowed, reason = portal_service.check_client_portal_access(7, con=object())

    assert allowed is False
    assert "unavailable" in reason.lower()


def test_expiry_constraint_migration_handles_new_and_existing_tables():
    sql = Path("sql_migrations/0063_client_portal_access_expiry_guard.sql").read_text(
        encoding="utf-8"
    )

    assert "CREATE TABLE IF NOT EXISTS public.client_portal_access" in sql
    assert "pg_constraint" in sql
    assert "ADD CONSTRAINT client_portal_access_expiry_year_check" in sql
    assert "NOT VALID" in sql
    assert "VALIDATE CONSTRAINT client_portal_access_expiry_year_check" in sql
    assert "TIMESTAMPTZ '10000-01-01 00:00:00+00'" in sql
