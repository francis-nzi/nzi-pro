from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import requests
from starlette.requests import Request

import api.client_management_routes as client_management_routes
import services.geocoding as geocoding


class _Response:
    def __init__(self, payload, status_code: int = 200):
        self.payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")

    def json(self):
        return self.payload


def test_full_address_retries_at_postcode_precision(monkeypatch) -> None:
    calls: list[dict[str, object]] = []
    responses = iter([
        _Response([]),
        _Response([
            {
                "lat": "51.6392700",
                "lon": "-0.7521800",
                "addresstype": "postcode",
                "address": {"postcode": "HP13 5RE", "town": "High Wycombe"},
            }
        ]),
    ])

    def fake_get(_url, **kwargs):
        calls.append(kwargs)
        return next(responses)

    sleeps: list[float] = []
    monkeypatch.setattr(geocoding.requests, "get", fake_get)
    monkeypatch.setattr(geocoding.time, "sleep", sleeps.append)

    result, failure = geocoding.geocode_location_detailed(
        "9-10 Manor Courtyard Hughenden Avenue, High Wycombe, "
        "Buckinghamshire, HP13 5RE, United Kingdom"
    )

    assert failure is None
    assert result == {
        "latitude": 51.63927,
        "longitude": -0.75218,
        "precision": "postcode",
        "fallback_used": True,
    }
    assert calls[0]["params"]["q"].startswith("9-10 Manor Courtyard")
    assert calls[1]["params"]["q"] == "HP13 5RE, United Kingdom"
    assert sleeps == [1.05]


def test_exact_road_result_remains_address_precision(monkeypatch) -> None:
    monkeypatch.setattr(
        geocoding.requests,
        "get",
        lambda *_args, **_kwargs: _Response([
            {
                "lat": "51.6390053",
                "lon": "-0.7524545",
                "addresstype": "road",
                "address": {"road": "Hughenden Avenue", "postcode": "HP13 5RE"},
            }
        ]),
    )

    result, failure = geocoding.geocode_location_detailed("Hughenden Avenue, High Wycombe")

    assert failure is None
    assert result is not None
    assert result["precision"] == "address"
    assert result["fallback_used"] is False


def test_provider_error_is_distinct_from_no_match(monkeypatch) -> None:
    monkeypatch.setattr(
        geocoding.requests,
        "get",
        lambda *_args, **_kwargs: _Response({}, status_code=503),
    )

    result, failure = geocoding.geocode_location_detailed("High Wycombe")

    assert result is None
    assert failure == "service_unavailable"


class _SiteConn:
    def __init__(self):
        self.queries: list[tuple[str, list[object] | None]] = []
        self._last_sql = ""

    def execute(self, sql: str, params: list[object] | None = None):
        self.queries.append((sql, params))
        self._last_sql = sql
        return self

    def fetchall(self):
        if "SELECT site_id, location" in self._last_sql:
            return [(101, "HP13 5RE, United Kingdom")]
        return []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def test_site_batch_only_selects_active_sites(monkeypatch) -> None:
    conn = _SiteConn()
    monkeypatch.setattr(client_management_routes, "get_conn", lambda: conn)
    monkeypatch.setattr(client_management_routes, "assert_permission", lambda *_args: None)
    monkeypatch.setattr(client_management_routes, "assert_client_access", lambda *_args: None)
    monkeypatch.setattr(client_management_routes, "_ensure_client_org_columns", lambda *_args: None)
    monkeypatch.setattr(client_management_routes, "_ensure_client_sites_runtime_columns", lambda *_args: None)
    monkeypatch.setattr(client_management_routes, "record_audit_event", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        geocoding,
        "geocode_location_detailed",
        lambda _location: ({
            "latitude": 51.63927,
            "longitude": -0.75218,
            "precision": "postcode",
            "fallback_used": True,
        }, None),
    )
    request = Request({"type": "http", "method": "POST", "path": "/", "headers": []})

    result = client_management_routes.geocode_client_sites(
        request,
        248,
        _user={"user_id": "u1", "org_id": "org-a"},
    )

    select_sql = next(sql for sql, _params in conn.queries if "SELECT site_id, location" in sql)
    assert "vacated_date IS NULL" in select_sql
    assert "archived = FALSE OR archived IS NULL" in select_sql
    assert result["attempted"] == 1
    assert result["geocoded"] == 1
    assert result["results"][0]["fallback_used"] is True
