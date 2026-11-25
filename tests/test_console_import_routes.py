"""The console-import figures endpoints (contract v7-import-figures/1): access, bounds, shape.

No database: the connection and the resolver are stood in for. What is not
stood in for is the pricing -- ``_build_scope_summary`` and ``combined_row_metrics``
run as they do in production -- so the totals and the rows are the report's own
arithmetic over the stubbed month-by-month factors.
"""
from __future__ import annotations

import math
import re
import sys
import threading
from contextlib import contextmanager
from pathlib import Path

import jwt
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.console_import_routes as routes
import api.job_data_output_routes as data_output
import services.console_import_figures as figures
from api.internal_cron_routes import router as cron_router
from services.monthly_emissions import JobMonthlyEmissionsResolver

TOKEN = "t" * 48
JWT_SECRET = "j" * 48
AUTH = {"Authorization": f"Bearer {TOKEN}"}


# ── Fixtures ──────────────────────────────────────────────────────────────────

class _FakeCon:
    def __init__(self):
        self.statements: list[str] = []

    def execute(self, sql, params=None):
        self.statements.append(" ".join(str(sql).split()))
        return self

    def fetchone(self):
        return None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.fixture
def con(monkeypatch):
    fake = _FakeCon()
    seen: dict = {}

    def fake_get_conn(*, autocommit=True, statement_timeout_ms=None):
        seen["autocommit"] = autocommit
        seen["statement_timeout_ms"] = statement_timeout_ms
        return fake

    monkeypatch.setattr(routes, "get_conn", fake_get_conn)
    fake.seen = seen
    return fake


@pytest.fixture
def client(monkeypatch, con):
    monkeypatch.setenv(routes.TOKEN_ENV, TOKEN)
    app = FastAPI()
    app.include_router(routes.router)
    return TestClient(app, raise_server_exceptions=False)


def _stub_job(monkeypatch, job_id=265, period=("2025-04-01", "2026-03-31")):
    meta = {"job_id": job_id, "job_number": f"J{job_id:06d}", "period_from": period[0], "period_to": period[1]}
    monkeypatch.setattr(figures, "load_job_in_scope", lambda con, jid: meta if int(jid) == job_id else (_ for _ in ()).throw(figures.JobOutOfScope()))
    monkeypatch.setattr(figures, "rows_updated_at", lambda con, jid: "2026-11-24T16:40:02Z")
    return meta


def _two_edition_resolver() -> JobMonthlyEmissionsResolver:
    """Apr-Dec 2025 priced from dataset 41 (0.177), Jan-Mar 2026 from dataset 52 (0.13096)."""
    resolver = JobMonthlyEmissionsResolver.__new__(JobMonthlyEmissionsResolver)
    resolver.resolution = {"dataset_catalog": [{"dataset_id": 41, "year": 2025}, {"dataset_id": 52, "year": 2026}]}
    resolver.dataset_name_by_id = {41: "DESNZ 2025", 52: "DESNZ 2026"}
    resolver.month_year_map = {m: (2025 if m >= 4 else 2026) for m in range(1, 13)}
    resolver.month_label_map = {m: f"M{m}" for m in range(1, 13)}
    resolver._lookup_factor = lambda *a, **k: None
    resolver._lookup_factor_by_original_id = lambda *a, **k: None
    resolver._resolve_custom_factor_for_month = lambda *a, **k: None

    def standard(row, month_idx):
        if month_idx >= 4:
            return {"dataset_id": 41, "factor": 0.177, "ghg_unit": "kgCO2e", "original_id": "ELEC-1"}
        return {"dataset_id": 52, "factor": 0.13096, "ghg_unit": "kgCO2e", "original_id": "ELEC-1"}

    resolver._resolve_standard_factor_for_month = standard
    return resolver


def _row(row_id, scope="Scope 2", enabled=True, record_type="legacy", months=None, **extra):
    months = months if months is not None else {m: (8000.0 if m >= 4 else 6600.0) for m in range(1, 13)}
    base = {
        "row_id": row_id, "scope": scope, "record_type": record_type, "row_enabled": enabled, "category": "Electricity",
        "site_name": "No Site Assigned", "site_id": None, "dataset_id": 41, "factor_db_id": 7, "original_id": "ELEC-1",
        "qty": sum(v or 0 for v in months.values()), "uom": "kWh", "factor": 0.177, "ghg_unit": "kgCO2e", "apply_pct": 100,
        "notes": None, "source_qty": None, "source_uom": None, "calc_tco2e": None,
    }
    base.update({f"month_{m}": months.get(m) for m in range(1, 13)})
    base.update(extra)
    return base


def _use_rows(monkeypatch, rows, resolver):
    def loader(con, job_id, *, include_disabled=False):
        frame = pd.DataFrame(rows)
        if frame.empty:
            return frame
        if not include_disabled:
            frame = frame[frame["row_enabled"]].drop(columns=["row_enabled"])
        return frame

    monkeypatch.setattr(data_output, "_load_data_output_rows", loader)
    monkeypatch.setattr(figures, "_build_resolver", lambda con, job_id: resolver)


# ── Access: the token ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("path", ["/api/console-import/v1/jobs/265/scope-totals", "/api/console-import/v1/jobs/265/row-figures"])
def test_no_token_and_wrong_token_are_refused(client, path):
    assert client.get(path).status_code == 401
    assert client.get(path, headers={"Authorization": "Bearer " + "x" * 48}).status_code == 401
    assert client.get(path, headers={"Authorization": TOKEN}).status_code == 401  # not a Bearer header
    assert client.get(path, headers={"X-User": "someone@example.com"}).status_code == 401


def test_unconfigured_or_weak_token_fails_closed(monkeypatch, con):
    app = FastAPI()
    app.include_router(routes.router)
    c = TestClient(app, raise_server_exceptions=False)
    path = "/api/console-import/v1/jobs/265/scope-totals"
    monkeypatch.delenv(routes.TOKEN_ENV, raising=False)
    assert c.get(path, headers=AUTH).status_code == 503
    monkeypatch.setenv(routes.TOKEN_ENV, "short")
    assert c.get(path, headers={"Authorization": "Bearer short"}).status_code == 503


def test_only_get_is_served_under_the_prefix(client):
    for method in ("post", "put", "patch", "delete"):
        for tail in ("scope-totals", "row-figures"):
            assert getattr(client, method)(f"/api/console-import/v1/jobs/265/{tail}", headers=AUTH).status_code == 405


def test_every_route_under_the_prefix_is_get_only():
    assert routes.router.routes
    for route in routes.router.routes:
        assert route.path.startswith(routes.PREFIX)
        assert route.methods == {"GET", "HEAD"} or route.methods == {"GET"}


def test_a_valid_app_login_is_not_a_credential_here(monkeypatch, client):
    monkeypatch.setenv("NZI_JWT_SECRET", JWT_SECRET)
    login = jwt.encode({"sub": "someone@example.com"}, JWT_SECRET, algorithm="HS256")
    r = client.get("/api/console-import/v1/jobs/265/scope-totals", headers={"Authorization": f"Bearer {login}"})
    assert r.status_code == 401


def test_the_token_is_refused_by_the_app_login_and_the_cron_guard(monkeypatch, con):
    monkeypatch.setenv(routes.TOKEN_ENV, TOKEN)
    monkeypatch.setenv("NZI_JWT_SECRET", JWT_SECRET)
    monkeypatch.setenv("CRON_SECRET", "c" * 48)
    app = FastAPI()
    app.include_router(routes.router)
    app.include_router(data_output.router)  # a person's-login route (_current_user)
    app.include_router(cron_router)  # a shared-secret route
    c = TestClient(app, raise_server_exceptions=False)

    assert c.get("/jobs/265/data-output", headers=AUTH).status_code == 401
    assert c.post("/internal/cron/m365-renew", headers=AUTH).status_code == 401
    assert c.post("/internal/cron/m365-renew", headers={"X-Cron-Secret": TOKEN}).status_code == 401
    # and the cron secret is not this token's credential
    assert c.get("/api/console-import/v1/jobs/265/scope-totals", headers={"Authorization": "Bearer " + "c" * 48}).status_code == 401


def test_the_token_is_read_in_one_module_only():
    root = Path(__file__).resolve().parents[1]
    readers = []
    for path in list(root.glob("*.py")) + list(root.glob("api/**/*.py")) + list(root.glob("services/**/*.py")) + list(root.glob("core/**/*.py")):
        if "NZI_CONSOLE_IMPORT_TOKEN" in path.read_text(encoding="utf-8", errors="ignore"):
            readers.append(path.relative_to(root).as_posix())
    assert readers == ["api/console_import_routes.py"]


# ── Scope and errors ──────────────────────────────────────────────────────────

def test_a_job_out_of_scope_or_malformed_is_404(monkeypatch, client):
    _stub_job(monkeypatch, job_id=265)
    for bad in ("999", "0", "abc", "-1", "1.5", "9" * 20):
        for tail in ("scope-totals", "row-figures"):
            r = client.get(f"/api/console-import/v1/jobs/{bad}/{tail}", headers=AUTH)
            assert r.status_code == 404, (bad, tail, r.text)
            assert r.json()["detail"]["code"] == "JOB_NOT_FOUND"


def test_cannot_compute_is_422_with_a_code(monkeypatch, client):
    _stub_job(monkeypatch)

    def boom(con, job_id):
        raise figures.CannotCompute("MISSING_DATASET", "no dataset")

    monkeypatch.setattr(figures, "_build_resolver", boom)
    r = client.get("/api/console-import/v1/jobs/265/scope-totals", headers=AUTH)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "MISSING_DATASET"


def test_a_timeout_is_503_and_an_unexpected_error_is_500_without_its_message(monkeypatch, client):
    _stub_job(monkeypatch)

    class QueryCanceled(Exception):
        pass

    def timeout(con, job_id):
        raise QueryCanceled("canceling statement due to statement timeout")

    monkeypatch.setattr(figures, "_build_resolver", timeout)
    assert client.get("/api/console-import/v1/jobs/265/row-figures", headers=AUTH).status_code == 503

    def bug(con, job_id):
        raise ValueError("secret value 12345 from a row")

    monkeypatch.setattr(figures, "_build_resolver", bug)
    r = client.get("/api/console-import/v1/jobs/265/row-figures", headers=AUTH)
    assert r.status_code == 500 and "12345" not in r.text and r.json()["detail"]["code"] == "INTERNAL"


# ── Bounds ────────────────────────────────────────────────────────────────────

def test_runs_in_a_read_only_transaction_under_a_statement_timeout(monkeypatch, client, con):
    _stub_job(monkeypatch)
    _use_rows(monkeypatch, [], _two_edition_resolver())
    assert client.get("/api/console-import/v1/jobs/265/scope-totals", headers=AUTH).status_code == 200
    assert con.statements[0] == "SET TRANSACTION READ ONLY"
    assert con.seen == {"autocommit": False, "statement_timeout_ms": 20_000}
    assert not [s for s in con.statements if re.match(r"(?i)\s*(insert|update|delete|create|alter|drop)", s)]


def test_statement_timeout_is_configurable_and_clamped(monkeypatch):
    monkeypatch.setenv(routes.TIMEOUT_ENV, "5000")
    assert routes._statement_timeout_ms() == 5000
    monkeypatch.setenv(routes.TIMEOUT_ENV, "999999")
    assert routes._statement_timeout_ms() == 25_000
    monkeypatch.setenv(routes.TIMEOUT_ENV, "nonsense")
    assert routes._statement_timeout_ms() == 20_000


def test_one_computation_per_job_at_a_time(monkeypatch, client):
    _stub_job(monkeypatch)
    _use_rows(monkeypatch, [], _two_edition_resolver())
    with figures.one_computation_per_job(265):
        r = client.get("/api/console-import/v1/jobs/265/scope-totals", headers=AUTH)
        assert r.status_code == 503 and r.json()["detail"]["code"] == "JOB_BUSY"
    assert client.get("/api/console-import/v1/jobs/265/scope-totals", headers=AUTH).status_code == 200


def test_the_lock_is_released_after_a_failure_and_other_jobs_are_not_blocked():
    with pytest.raises(RuntimeError):
        with figures.one_computation_per_job(7):
            with figures.one_computation_per_job(8):  # another job is fine
                pass
            raise RuntimeError("fail")
    with figures.one_computation_per_job(7):
        pass


def test_concurrent_requests_for_one_job_compute_once():
    entered, release, results = threading.Event(), threading.Event(), []

    def first():
        with figures.one_computation_per_job(99):
            entered.set()
            release.wait(5)

    t = threading.Thread(target=first)
    t.start()
    assert entered.wait(5)
    try:
        with figures.one_computation_per_job(99):
            results.append("ran")
    except figures.Busy:
        results.append("busy")
    release.set()
    t.join()
    assert results == ["busy"]


# ── Shape and arithmetic ──────────────────────────────────────────────────────

def test_row_figures_blend_across_two_editions_with_spans_that_sum(monkeypatch, client):
    _stub_job(monkeypatch)
    _use_rows(monkeypatch, [_row(9278)], _two_edition_resolver())
    body = client.get("/api/console-import/v1/jobs/265/row-figures", headers=AUTH).json()
    assert body["contract"] == "v7-import-figures/1" and body["job_id"] == 265
    assert set(body) == {"contract", "job_id", "computed_at", "rows"}
    (row,) = body["rows"]
    assert set(row) == {"row_id", "scope", "enabled", "tco2e", "blended", "custom_factor", "spans"}
    assert row["row_id"] == 9278 and row["blended"] is True and row["custom_factor"] is False
    assert round(row["tco2e"], 1) == 15.3
    first, second = row["spans"]
    assert (first["from"], first["to"], first["dataset_id"], first["dataset_year"], first["factor"], first["ghg_unit"]) == ("2025-04", "2025-12", 41, 2025, 0.177, "kgCO2e")
    assert (second["from"], second["to"], second["dataset_id"], second["dataset_year"], second["factor"]) == ("2026-01", "2026-03", 52, 2026, 0.13096)
    assert set(first) == {"from", "to", "dataset_id", "dataset_year", "factor", "ghg_unit", "tco2e"}
    assert math.isclose(sum(s["tco2e"] for s in row["spans"]), row["tco2e"], rel_tol=1e-12)
    assert math.isclose(first["tco2e"], 72000 * 0.177 / 1000, rel_tol=1e-9)


def test_a_single_edition_row_is_one_span_and_not_blended(monkeypatch, client):
    _stub_job(monkeypatch, job_id=434, period=("2024-01-01", "2024-12-31"))
    resolver = _two_edition_resolver()
    resolver.month_year_map = {m: 2024 for m in range(1, 13)}
    resolver._resolve_standard_factor_for_month = lambda row, m: {"dataset_id": 41, "factor": 0.2, "ghg_unit": "kgCO2e", "original_id": "ELEC-1"}
    _use_rows(monkeypatch, [_row(1)], resolver)
    (row,) = client.get("/api/console-import/v1/jobs/434/row-figures", headers=AUTH).json()["rows"]
    assert len(row["spans"]) == 1 and row["blended"] is False
    assert (row["spans"][0]["from"], row["spans"][0]["to"]) == ("2024-01", "2024-12")


def test_blended_matches_the_resolvers_own_factor_blended(monkeypatch):
    resolver = _two_edition_resolver()
    metrics = resolver.row_metrics(pd.Series(_row(1)))
    spans = figures._spans_from_months(metrics["monthly_factor_details"], figures._dataset_years(resolver))
    assert (len(spans) > 1) == metrics["factor_blended"] is True


def test_disabled_rows_and_register_sources_are_included_but_not_in_the_totals(monkeypatch, client):
    _stub_job(monkeypatch)
    enabled = _row(1)
    disabled = _row(2, enabled=False)
    source = _row(30, record_type="source_register", scope="Scope 1", months={m: None for m in range(1, 13)}, calc_tco2e=4.5, qty=1.0, factor=4.5, uom="tCO2e", ghg_unit="tCO2e")
    _use_rows(monkeypatch, [source, disabled, enabled], _two_edition_resolver())

    rows = client.get("/api/console-import/v1/jobs/265/row-figures", headers=AUTH).json()["rows"]
    assert [r["row_id"] for r in rows] == [1, 2, "source:30"]
    assert [r["enabled"] for r in rows] == [True, False, True]
    assert rows[2]["tco2e"] == 4.5 and len(rows[2]["spans"]) == 1 and rows[2]["blended"] is False

    totals = client.get("/api/console-import/v1/jobs/265/scope-totals", headers=AUTH).json()
    assert totals["counted_rows"] == 2  # the disabled row is not counted, as in V7's own totals
    assert totals["scope_totals"]["scope_1"] == 4.5


def test_rows_sum_per_scope_to_the_totals_endpoint(monkeypatch, client):
    _stub_job(monkeypatch)
    rows_in = [_row(i, scope=s) for i, s in enumerate(["Scope 1", "Scope 2", "Scope 2", "Scope 3", "Scope 3", "Scope 3"], start=1)]
    _use_rows(monkeypatch, rows_in, _two_edition_resolver())
    rows = client.get("/api/console-import/v1/jobs/265/row-figures", headers=AUTH).json()["rows"]
    totals = client.get("/api/console-import/v1/jobs/265/scope-totals", headers=AUTH).json()["scope_totals"]
    for key, scope in (("scope_1", "Scope 1"), ("scope_2", "Scope 2"), ("scope_3", "Scope 3")):
        assert round(sum(round(r["tco2e"], 2) for r in rows if r["scope"] == scope and r["enabled"]), 2) == totals[key]
    assert totals["total"] == round(sum(r["tco2e"] for r in rows), 2)


def test_scope_totals_shape(monkeypatch, client):
    _stub_job(monkeypatch)
    _use_rows(monkeypatch, [_row(1)], _two_edition_resolver())
    body = client.get("/api/console-import/v1/jobs/265/scope-totals", headers=AUTH).json()
    assert set(body) == {"contract", "job_id", "job_number", "computed_at", "period", "scope_totals", "counted_rows", "rows_updated_at"}
    assert body["contract"] == "v7-import-figures/1" and body["job_number"] == "J000265"
    assert body["period"] == {"from": "2025-04-01", "to": "2026-03-31"}
    assert set(body["scope_totals"]) == {"scope_1", "scope_2", "scope_3", "total"}
    assert body["rows_updated_at"] == "2026-11-24T16:40:02Z" and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", body["computed_at"])


def test_an_empty_job_has_zero_totals_and_no_rows(monkeypatch, client):
    _stub_job(monkeypatch)
    _use_rows(monkeypatch, [], _two_edition_resolver())
    assert client.get("/api/console-import/v1/jobs/265/scope-totals", headers=AUTH).json()["scope_totals"] == {"scope_1": 0.0, "scope_2": 0.0, "scope_3": 0.0, "total": 0.0}
    assert client.get("/api/console-import/v1/jobs/265/row-figures", headers=AUTH).json()["rows"] == []


def test_a_priced_month_outside_the_period_is_refused_not_guessed(monkeypatch, client):
    _stub_job(monkeypatch)
    resolver = _two_edition_resolver()
    resolver.month_year_map = {m: (2025 if m >= 4 else None) for m in range(1, 13)}
    _use_rows(monkeypatch, [_row(1)], resolver)
    r = client.get("/api/console-import/v1/jobs/265/row-figures", headers=AUTH)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "UNDATED_MONTH"


def test_custom_factor_rows_are_flagged(monkeypatch, client):
    _stub_job(monkeypatch)
    resolver = _two_edition_resolver()
    resolver._resolve_standard_factor_for_month = lambda *a, **k: None
    resolver._resolve_custom_factor_for_month = lambda original_id, scope, m: {
        "dataset_id": None, "dataset_name": "Custom factor", "factor": 0.5 if m >= 4 else 0.4, "factor_year": 2025 if m >= 4 else 2026,
        "ghg_unit": "kgCO2e", "original_id": "CUST-1",
    }
    _use_rows(monkeypatch, [_row(1, dataset_id=None, factor_db_id=None, original_id="CUST-1")], resolver)
    (row,) = client.get("/api/console-import/v1/jobs/265/row-figures", headers=AUTH).json()["rows"]
    assert row["custom_factor"] is True and row["blended"] is True
    assert [s["dataset_id"] for s in row["spans"]] == [None, None] and [s["dataset_year"] for s in row["spans"]] == [2025, 2026]


def test_nothing_outside_the_contract_crosses(monkeypatch, client):
    _stub_job(monkeypatch)
    row = _row(1, site_name="Acme Head Office, 1 High Street", notes="factor_original_id=X; contact jane@example.com", report_label="Mains electricity", employee_name="Jane Doe")
    _use_rows(monkeypatch, [row], _two_edition_resolver())
    text = client.get("/api/console-import/v1/jobs/265/row-figures", headers=AUTH).text + client.get("/api/console-import/v1/jobs/265/scope-totals", headers=AUTH).text
    for leaked in ("Acme", "High Street", "jane", "Jane", "example.com", "Mains electricity", "Electricity", "factor_original_id"):
        assert leaked not in text


def test_scope_filter_mirrors_the_view_set(con):
    statements: list[tuple[str, list]] = []

    class Con:
        def execute(self, sql, params=None):
            statements.append((" ".join(sql.split()), list(params or [])))
            return self

        def fetchone(self):
            return None

    with pytest.raises(figures.JobOutOfScope):
        figures.load_job_in_scope(Con(), 5)
    sql, params = statements[0]
    assert "COALESCE(c.status, 'Active') IN (%s, %s)" in sql and "NOT COALESCE(c.archived, FALSE)" in sql
    assert params == [5, "Active", "Portfolio Owner"]
