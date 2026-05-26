from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
import pandas as pd
from fastapi import HTTPException

import api.main as main


class _FakeConn:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, *args, **kwargs):
        raise AssertionError("get_conn should not be reached when org context is missing")


class _ClientConn(_FakeConn):
    def __init__(self, row):
        self.row = row
        self.queries = []

    def execute(self, sql: str, params: list[object] | None = None):
        self.queries.append((sql, params))
        return self

    def fetchone(self):
        return self.row

    def fetchall(self):
        if "information_schema.columns" in self.queries[-1][0]:
            return [
                ("db_id",),
                ("client_name",),
                ("industry",),
                ("description_long",),
                ("status",),
                ("website",),
                ("year_end_month",),
                ("company_reg",),
                ("sic_code",),
                ("headquarters",),
                ("addr_line1",),
                ("addr_line2",),
                ("addr_city",),
                ("addr_region",),
                ("addr_postcode",),
                ("addr_country",),
                ("logo_url",),
                ("crm_owner",),
                ("net_zero_year",),
                ("interim_year",),
                ("interim_s1_pct",),
                ("interim_s2_pct",),
                ("interim_s3_pct",),
                ("portfolio",),
                ("net_zero_target_reduction_pct",),
                ("benchmark_year",),
                ("benchmark_period_start",),
                ("benchmark_period_end",),
                ("currency",),
                ("billing_same_as_main",),
                ("billing_addr_line1",),
                ("billing_addr_line2",),
                ("billing_addr_city",),
                ("billing_addr_region",),
                ("billing_addr_postcode",),
                ("billing_addr_country",),
                ("create_site_from_address",),
                ("benchmark_scope_1_tco2e",),
                ("benchmark_scope_2_tco2e",),
                ("benchmark_scope_3_tco2e",),
                ("benchmark_total_tco2e",),
                ("billing_company",),
            ]
        return []

    def df(self):
        if "SELECT c.db_id AS client_db_id" in self.queries[-1][0]:
            columns = [
                "client_db_id",
                "client_name",
                "industry",
                "description_long",
                "status",
                "website",
                "year_end_month",
                "company_reg",
                "sic_code",
                "headquarters",
                "addr_line1",
                "addr_line2",
                "addr_city",
                "addr_region",
                "addr_postcode",
                "addr_country",
                "logo_url",
                "crm_owner",
                "net_zero_year",
                "interim_year",
                "interim_s1_pct",
                "interim_s2_pct",
                "interim_s3_pct",
                "portfolio",
                "net_zero_target_reduction_pct",
                "benchmark_year",
                "benchmark_period_start",
                "benchmark_period_end",
                "currency",
                "billing_same_as_main",
                "billing_addr_line1",
                "billing_addr_line2",
                "billing_addr_city",
                "billing_addr_region",
                "billing_addr_postcode",
                "billing_addr_country",
                "create_site_from_address",
                "benchmark_scope_1_tco2e",
                "benchmark_scope_2_tco2e",
                "benchmark_scope_3_tco2e",
                "benchmark_total_tco2e",
                "billing_company",
            ]
            return pd.DataFrame([self.row], columns=columns)
        return pd.DataFrame([])


class _ListClientsConn(_FakeConn):
    def __init__(self):
        self.queries = []
        self._last_sql = ""
        self._fetchone_calls = 0

    def execute(self, sql: str, params: list[object] | None = None):
        self.queries.append((sql, params))
        self._last_sql = sql
        return self

    def fetchone(self):
        self._fetchone_calls += 1
        if "COUNT(*)" in self._last_sql:
            return (1,)
        return (1,)

    def df(self):
        if "FROM clients c" in self._last_sql:
            return pd.DataFrame(
                [
                    {
                        "client_db_id": 89,
                        "client_name": "Advanced Electric Machines (AEM)",
                        "industry": "Engineering",
                        "status": "Active",
                        "crm_owner": "David Hawes",
                    }
                ]
            )
        if "FROM jobs j" in self._last_sql:
            return pd.DataFrame([])
        return pd.DataFrame([])


class _ClientJobsConn(_FakeConn):
    def __init__(self):
        self.queries = []
        self._last_sql = ""

    def execute(self, sql: str, params: list[object] | None = None):
        self.queries.append((sql, params))
        self._last_sql = sql
        return self

    def fetchone(self):
        if "COUNT(*)" in self._last_sql and "WHERE j.client_db_id = ?" in self._last_sql:
            return (1,)
        if "COUNT(*)" in self._last_sql:
            return (0,)
        return None

    def df(self):
        if "FROM jobs j" in self._last_sql and "WHERE j.client_db_id = ?" in self._last_sql:
            return pd.DataFrame(
                [
                    {
                        "job_id": 640,
                        "job_number": "J000640",
                        "title": "Job title",
                        "reporting_year": 2025,
                        "reporting_period_end": pd.Timestamp("2026-03-31"),
                        "status": "Open",
                        "job_type": "CRP",
                        "is_crp": True,
                        "data_collection_due": None,
                        "data_collection_completed_at": None,
                        "first_draft_due": None,
                        "first_draft_completed_at": None,
                        "final_report_due": None,
                        "final_report_completed_at": None,
                        "total_emissions": 0,
                    }
                ]
            )
        return pd.DataFrame([])


class _ClientJobsExactConn(_ClientJobsConn):
    def df(self):
        if "FROM jobs j" in self._last_sql:
            return pd.DataFrame(
                [
                    {
                        "job_id": 640,
                        "job_number": "J000640",
                        "title": "Job title",
                        "reporting_year": 2025,
                        "reporting_period_end": pd.Timestamp("2026-03-31"),
                        "status": "Open",
                        "job_type": "CRP",
                        "is_crp": True,
                        "data_collection_due": None,
                        "data_collection_completed_at": None,
                        "first_draft_due": None,
                        "first_draft_completed_at": None,
                        "final_report_due": None,
                        "final_report_completed_at": None,
                        "total_emissions": 0,
                    }
                ]
            )
        return pd.DataFrame([])


class _ClientJobsMismatchConn(_ClientJobsConn):
    def fetchone(self):
        if "COUNT(*)" in self._last_sql and "WHERE j.client_db_id = ?" in self._last_sql:
            return (1,)
        if "COUNT(*)" in self._last_sql:
            return (0,)
        return None

    def df(self):
        if "FROM jobs j" in self._last_sql and "WHERE j.client_db_id = ?" in self._last_sql:
            return pd.DataFrame(
                [
                    {
                        "job_id": 640,
                        "job_number": "J000640",
                        "title": "Job title",
                        "reporting_year": 2025,
                        "reporting_period_end": pd.Timestamp("2026-03-31"),
                        "status": "Open",
                        "job_type": "CRP",
                        "is_crp": True,
                        "data_collection_due": None,
                        "data_collection_completed_at": None,
                        "first_draft_due": None,
                        "first_draft_completed_at": None,
                        "final_report_due": None,
                        "final_report_completed_at": None,
                        "total_emissions": 0,
                    }
                ]
            )
        return super().df()


class _ClientJobsOrgMatchConn(_FakeConn):
    def __init__(self):
        self.queries = []
        self._last_sql = ""

    def execute(self, sql: str, params: list[object] | None = None):
        self.queries.append((sql, params))
        self._last_sql = sql
        return self

    def fetchone(self):
        if "COUNT(*)" in self._last_sql and "COALESCE(j.org_id, c.org_id) = ?" in self._last_sql:
            return (1,)
        if "COUNT(*)" in self._last_sql:
            return (0,)
        return None

    def df(self):
        if "FROM jobs j" in self._last_sql and "COALESCE(j.org_id, c.org_id) = ?" in self._last_sql:
            return pd.DataFrame(
                [
                    {
                        "job_id": 640,
                        "job_number": "J000640",
                        "title": "Job title",
                        "reporting_year": 2025,
                        "reporting_period_end": pd.Timestamp("2026-03-31"),
                        "status": "Open",
                        "job_type": "CRP",
                        "is_crp": True,
                        "data_collection_due": None,
                        "data_collection_completed_at": None,
                        "first_draft_due": None,
                        "first_draft_completed_at": None,
                        "final_report_due": None,
                        "final_report_completed_at": None,
                        "total_emissions": 0,
                    }
                ]
            )
        return pd.DataFrame([])


class _ClientLimitConn(_FakeConn):
    def __init__(self):
        self.queries = []
        self._last_sql = ""

    def execute(self, sql: str, params: list[object] | None = None):
        self.queries.append((sql, params))
        self._last_sql = sql
        return self

    def fetchone(self):
        if "FROM organisation_entitlements" in self._last_sql:
            return (
                "org-a",
                "growth",
                "active",
                5,
                1,
                None,
                None,
                None,
                "active",
                None,
                None,
                True,
                None,
                None,
            )
        if "SELECT COALESCE(archived, FALSE) FROM organisations WHERE org_id = %s LIMIT 1" in self._last_sql:
            return (False,)
        if "FROM organisation_memberships" in self._last_sql and "COUNT(*)" in self._last_sql:
            return (1,)
        if "FROM organisation_invitations" in self._last_sql and "COUNT(*)" in self._last_sql:
            return (0,)
        if "FROM clients" in self._last_sql and "COUNT(*)" in self._last_sql:
            return (1,)
        if "SELECT org_id, name, slug, plan, plan_status, max_users, max_clients, archived, archived_at, archived_by, created_at, updated_at FROM organisations WHERE org_id = %s" in self._last_sql:
            return (
                "org-a",
                "Acme Org",
                "acme-org",
                "growth",
                "active",
                5,
                1,
                False,
                None,
                None,
                "2026-04-23",
                "2026-04-23",
            )
        if "SELECT db_id" in self._last_sql and "FROM clients" in self._last_sql:
            return None
        return None


class _ExcelImportConn(_FakeConn):
    def __init__(self):
        self.queries = []
        self._last_sql = ""

    def execute(self, sql: str, params: list[object] | None = None):
        self.queries.append((sql, params))
        self._last_sql = sql
        return self

    def fetchone(self):
        if "SELECT client_db_id FROM jobs WHERE job_id=?" in self._last_sql:
            return (89,)
        if "SELECT 1 FROM client_sites WHERE site_id=? AND client_db_id=?" in self._last_sql:
            return (1,)
        if "SELECT row_id" in self._last_sql and "FROM job_scope_rows" in self._last_sql:
            return None
        return None


def test_list_clients_requires_org(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main, "assert_permission", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "get_conn", lambda: _FakeConn())
    monkeypatch.setattr(main, "db_backend", lambda: "postgres")

    with pytest.raises(HTTPException) as exc_info:
        main.list_clients(_user={"user_id": "u1", "org_id": ""})

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Organisation context required"


def test_list_clients_includes_job_reachable_client(monkeypatch: pytest.MonkeyPatch) -> None:
    conn = _ListClientsConn()
    monkeypatch.setattr(main, "assert_permission", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "get_conn", lambda: conn)
    monkeypatch.setattr(main, "db_backend", lambda: "postgres")

    result = main.list_clients(
        limit=50,
        offset=0,
        sort_by="client",
        sort_dir="asc",
        _user={"user_id": "u1", "org_id": "org-a"},
    )

    assert result["total"] == 1
    assert result["items"][0]["client_name"] == "Advanced Electric Machines (AEM)"
    assert any("EXISTS (SELECT 1 FROM jobs j" in sql for sql, _ in conn.queries)


def test_get_client_requires_org(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main, "assert_permission", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "get_conn", lambda: _FakeConn())

    with pytest.raises(HTTPException) as exc_info:
        main.get_client(123, _user={"user_id": "u1", "org_id": ""})

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Organisation context required"


def test_get_client_allows_legacy_rows_when_accessible(monkeypatch: pytest.MonkeyPatch) -> None:
    row = (
        123,
        "Legacy Client",
        "Industry",
        "Description",
        "Active",
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        "GBP",
        True,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        "Legacy Client",
    )
    conn = _ClientConn(row)
    monkeypatch.setattr(main, "assert_permission", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "assert_client_access", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "get_conn", lambda: conn)

    result = main.get_client(123, _user={"user_id": "u1", "org_id": "org-a"})

    assert result["client_db_id"] == 123
    assert result["client_name"] == "Legacy Client"
    assert conn.queries


def test_get_job_does_not_fail_open_on_legacy_org_gap(monkeypatch: pytest.MonkeyPatch) -> None:
    class _JobConn(_FakeConn):
        def execute(self, *args, **kwargs):
            raise AssertionError("get_job should stop at assert_job_access when org is missing")

    monkeypatch.setattr(main, "assert_permission", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "assert_job_access", lambda *_args, **_kwargs: (_ for _ in ()).throw(HTTPException(status_code=403, detail="Organisation context required")))
    monkeypatch.setattr(main, "get_conn", lambda: _JobConn())

    with pytest.raises(HTTPException) as exc_info:
        main.get_job(123, _user={"user_id": "u1", "org_id": ""})

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Organisation context required"


def test_client_jobs_include_rows_for_client_scope(monkeypatch: pytest.MonkeyPatch) -> None:
    conn = _ClientJobsConn()
    monkeypatch.setattr(main, "assert_permission", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "assert_client_access", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "get_conn", lambda: conn)

    result = main.client_jobs(
        58,
        limit=50,
        offset=0,
        _user={"user_id": "u1", "org_id": "org-a"},
    )

    assert result["total"] == 1
    assert result["items"][0]["job_id"] == 640
    assert result["items"][0]["job_number"] == "J000640"
    assert any("WHERE j.client_db_id = ?" in sql for sql, _ in conn.queries)


def test_client_jobs_use_exact_emissions_totals(monkeypatch: pytest.MonkeyPatch) -> None:
    conn = _ClientJobsExactConn()
    monkeypatch.setattr(main, "assert_permission", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "assert_client_access", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "get_conn", lambda: conn)
    monkeypatch.setattr(main, "exact_job_total_emissions", lambda *_args, **_kwargs: 40.57)

    result = main.client_jobs(
        58,
        limit=50,
        offset=0,
        _user={"user_id": "u1", "org_id": "org-a"},
    )

    assert result["items"][0]["job_id"] == 640


def test_client_jobs_returns_client_rows_even_when_org_lookup_differs(monkeypatch: pytest.MonkeyPatch) -> None:
    conn = _ClientJobsMismatchConn()
    monkeypatch.setattr(main, "assert_permission", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "assert_client_access", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "get_conn", lambda: conn)

    result = main.client_jobs(
        58,
        limit=50,
        offset=0,
        _user={"user_id": "u1", "org_id": "org-a"},
    )

    assert result["total"] == 1
    assert result["items"][0]["job_id"] == 640


def test_client_jobs_matches_client_org_when_scoping_jobs(monkeypatch: pytest.MonkeyPatch) -> None:
    conn = _ClientJobsOrgMatchConn()
    monkeypatch.setattr(main, "assert_permission", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "assert_client_access", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "require_org", lambda user: user["org_id"])
    monkeypatch.setattr(main, "get_conn", lambda: conn)

    result = main.client_jobs(
        58,
        limit=50,
        offset=0,
        _user={"user_id": "u1", "org_id": "org-a"},
    )

    assert result["total"] == 1
    assert result["items"][0]["job_id"] == 640
    assert any("COALESCE(j.org_id, c.org_id) = ?" in sql for sql, _ in conn.queries if "FROM jobs j" in sql)


def test_create_client_rejects_when_org_at_client_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    conn = _ClientLimitConn()
    monkeypatch.setattr(main, "assert_permission", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "require_org", lambda *_args, **_kwargs: "org-a")
    monkeypatch.setattr(main, "get_conn", lambda: conn)

    with pytest.raises(HTTPException) as exc_info:
        main.create_client(
            request=None,
            body={"client_name": "New Client"},
            _user={"user_id": "u1", "org_id": "org-a"},
        )

    assert exc_info.value.status_code == 403
    assert "client limit" in str(exc_info.value.detail).lower()
    assert not any("INSERT INTO clients" in sql for sql, _ in conn.queries)


def test_job_excel_import_expands_month_placeholders(monkeypatch: pytest.MonkeyPatch) -> None:
    conn = _ExcelImportConn()
    monkeypatch.setattr(main, "get_conn", lambda: conn)

    result = main.job_excel_import(
        job_id=3,
        payload={
            "site_id": 11,
            "rows_ready": [
                {
                    "scope": "Scope 3",
                    "original_id": "BT-ROW-1",
                    "dataset_id": 321,
                    "db_id": 654,
                    "qty": 1.0,
                    "uom": "km",
                    "factor": 0.25,
                    "ghg_unit": "kgCO2e",
                    "calc_tco2e": 0.25,
                    "apply_pct": 100,
                    "data_source": "Imported",
                    "data_confidence": "high",
                    "notes": "business travel import",
                    "report_label": "Business Travel",
                    "column_text": "Mode",
                }
            ],
        },
        _user={"user_id": "u1", "org_id": "org-a"},
    )

    assert result["ok"] is True
    insert_sql = next(sql for sql, _ in conn.queries if "INSERT INTO job_scope_rows" in sql)
    assert "{month_placeholders}" not in insert_sql
    assert insert_sql.count("?") >= 12
