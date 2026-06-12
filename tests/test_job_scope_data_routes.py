from __future__ import annotations

from pathlib import Path
import sys

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.job_scope_data_routes as job_scope_data_routes
import api.job_data_output_routes as job_data_output_routes


class _ScopeDataResult:
    def __init__(self, fetchone_value=None, rows=None, description=None):
        self._fetchone_value = fetchone_value
        self._rows = rows or []
        self._description = description or []

    @property
    def cursor(self):
        return self

    @property
    def description(self):
        return self._description

    def fetchone(self):
        return self._fetchone_value

    def fetchall(self):
        return self._rows


class _ScopeDataConn:
    def __init__(self, rows=None, description=None):
        self.sql = ""
        self.params = None
        self._rows = rows or []
        self._description = description or []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql: str, params: list[object] | None = None):
        self.sql = sql
        self.params = params
        if "SELECT 1 FROM jobs WHERE job_id=%s" in sql:
            return _ScopeDataResult(fetchone_value=(1,))
        if "FROM job_scope_rows jsr" in sql:
            return _ScopeDataResult(rows=self._rows, description=self._description)
        return _ScopeDataResult()


class _DummyResolver:
    def __init__(self, *_args, **_kwargs):
        pass

    def row_metrics(self, row, include_monthly_details: bool = True):
        metrics = {
            "display_dataset_id": row.get("dataset_id"),
            "display_qty": row.get("qty"),
            "display_uom": row.get("uom"),
            "display_factor": row.get("factor"),
            "calc_tco2e": 0.0,
            "tco2e_before_apply": 0.0,
            "monthly_factor_details": [],
            "uses_monthly_factors": False,
        }
        if include_monthly_details:
            metrics["monthly_factor_details"] = [
                {
                    "month_index": 1,
                    "month_label": "Jan",
                    "year": 2026,
                    "dataset_name": "Dataset A",
                    "dataset_category": "Category A",
                    "qty": 1.0,
                    "uom": "kWh",
                    "factor": 2.0,
                    "factor_original_id": "OID-1",
                }
            ]
            metrics["uses_monthly_factors"] = True
        return metrics


class _BrokenResolver:
    def __init__(self, *_args, **_kwargs):
        raise RuntimeError("dataset resolution failed")


class _AuditConnResult:
    def __init__(self, fetchone_value=None):
        self._fetchone_value = fetchone_value

    def fetchone(self):
        return self._fetchone_value

    def df(self):
        return pd.DataFrame([])


class _AuditConn:
    def __init__(self):
        self.queries: list[str] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql: str, params: list[object] | None = None):
        self.queries.append(sql)
        if "SELECT job_id, reporting_year FROM jobs WHERE job_id = %s" in sql:
            return _AuditConnResult((664, 2026))
        return _AuditConnResult()


def test_get_job_scope_data_handles_empty_results(monkeypatch) -> None:
    conn = _ScopeDataConn()

    monkeypatch.setattr(job_scope_data_routes, "get_conn", lambda: conn)
    monkeypatch.setattr(job_scope_data_routes, "_ensure_job_scope_rows_schema", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(job_scope_data_routes, "_table_columns", lambda *_args, **_kwargs: {"category"})
    monkeypatch.setattr(job_scope_data_routes, "JobMonthlyEmissionsResolver", _DummyResolver)

    result = job_scope_data_routes.get_job_scope_data(175, _user={"user_id": "u1", "org_id": "org-123"})

    assert result == {"job_id": 175, "rows": [], "total": 0}


def test_get_job_scope_data_falls_back_when_resolver_breaks(monkeypatch) -> None:
    columns = [
        "row_id",
        "job_id",
        "scope",
        "site_id",
        "site_name",
        "dataset_id",
        "factor_db_id",
        "original_id",
        "category",
        "level_1",
        "level_2",
        "level_3",
        "level_4",
        "column_text",
        "report_label",
        "qty",
        "uom",
        "factor",
        "ghg_unit",
        "calc_tco2e",
        "apply_pct",
        "source_qty",
        "source_uom",
        "month_1",
        "month_2",
        "month_3",
        "month_4",
        "month_5",
        "month_6",
        "month_7",
        "month_8",
        "month_9",
        "month_10",
        "month_11",
        "month_12",
        "data_source",
        "data_confidence",
        "notes",
        "is_custom_entry",
        "enabled",
        "created_at",
        "updated_at",
        "lookup_factor",
        "lookup_ghg_unit",
        "lookup_category",
        "lookup_level_1",
        "lookup_level_2",
        "lookup_level_3",
        "lookup_level_4",
        "lookup_column_text",
        "lookup_report_label",
    ]
    rows = [
        (
            11,
            175,
            "Scope 1",
            22,
            "HQ",
            7,
            91,
            "OID-1",
            "Category A",
            "Level 1",
            "Level 2",
            "Level 3",
            "Level 4",
            "Column",
            "Report",
            10.0,
            "kWh",
            0.5,
            "kgCO2e",
            5.0,
            100.0,
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
            "Company Data",
            "H",
            "storage_reason=annual",
            True,
            True,
            "2026-04-01",
            "2026-04-02",
            0.5,
            "kgCO2e",
            "Lookup category",
            "Lookup level 1",
            "Lookup level 2",
            "Lookup level 3",
            "Lookup level 4",
            "Lookup column",
            "Lookup report",
        )
    ]
    conn = _ScopeDataConn(rows=rows, description=[(name,) for name in columns])

    monkeypatch.setattr(job_scope_data_routes, "get_conn", lambda: conn)
    monkeypatch.setattr(job_scope_data_routes, "_ensure_job_scope_rows_schema", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(job_scope_data_routes, "_table_columns", lambda *_args, **_kwargs: {"category"})
    monkeypatch.setattr(job_scope_data_routes, "JobMonthlyEmissionsResolver", _BrokenResolver)

    result = job_scope_data_routes.get_job_scope_data(175, _user={"user_id": "u1", "org_id": "org-123"})

    assert result["job_id"] == 175
    assert result["total"] == 1
    assert result["rows"][0]["row_id"] == 11
    assert result["rows"][0]["calc_tco2e"] == 0.005
    assert result["rows"][0].get("monthly_factor_details") is None


def test_get_job_scope_data_can_load_monthly_detail_on_demand(monkeypatch) -> None:
    columns = [
        "row_id",
        "job_id",
        "scope",
        "site_id",
        "site_name",
        "dataset_id",
        "factor_db_id",
        "original_id",
        "category",
        "level_1",
        "level_2",
        "level_3",
        "level_4",
        "column_text",
        "report_label",
        "qty",
        "uom",
        "factor",
        "ghg_unit",
        "calc_tco2e",
        "apply_pct",
        "source_qty",
        "source_uom",
        "month_1",
        "month_2",
        "month_3",
        "month_4",
        "month_5",
        "month_6",
        "month_7",
        "month_8",
        "month_9",
        "month_10",
        "month_11",
        "month_12",
        "data_source",
        "data_confidence",
        "notes",
        "is_custom_entry",
        "enabled",
        "created_at",
        "updated_at",
        "lookup_factor",
        "lookup_ghg_unit",
        "lookup_category",
        "lookup_level_1",
        "lookup_level_2",
        "lookup_level_3",
        "lookup_level_4",
        "lookup_column_text",
        "lookup_report_label",
    ]
    rows = [
        (
            11,
            175,
            "Scope 1",
            22,
            "HQ",
            7,
            91,
            "OID-1",
            "Category A",
            "Level 1",
            "Level 2",
            "Level 3",
            "Level 4",
            "Column",
            "Report",
            10.0,
            "kWh",
            0.5,
            "kgCO2e",
            5.0,
            100.0,
            None,
            None,
            1.0,
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
            "Company Data",
            "H",
            "storage_reason=annual",
            True,
            True,
            "2026-04-01",
            "2026-04-02",
            0.5,
            "kgCO2e",
            "Lookup category",
            "Lookup level 1",
            "Lookup level 2",
            "Lookup level 3",
            "Lookup level 4",
            "Lookup column",
            "Lookup report",
        )
    ]
    conn = _ScopeDataConn(rows=rows, description=[(name,) for name in columns])

    monkeypatch.setattr(job_scope_data_routes, "get_conn", lambda: conn)
    monkeypatch.setattr(job_scope_data_routes, "_ensure_job_scope_rows_schema", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(job_scope_data_routes, "_table_columns", lambda *_args, **_kwargs: {"category"})
    monkeypatch.setattr(job_scope_data_routes, "JobMonthlyEmissionsResolver", _DummyResolver)

    result = job_scope_data_routes.get_job_scope_data(
        175,
        row_id=11,
        include_monthly_details=True,
        _user={"user_id": "u1", "org_id": "org-123"},
    )

    assert conn.params[-1] == 11
    assert result["total"] == 1
    assert result["rows"][0]["monthly_factor_details"]
    assert result["rows"][0]["uses_monthly_factors"] is True


def test_build_scope_summary_orders_scopes_categories_and_sites(monkeypatch) -> None:
    df = pd.DataFrame(
        [
            {"scope": "Scope 3", "category": "Category Z", "site_name": "Site B", "emissions": 1.0},
            {"scope": "Scope 1", "category": "Category Alpha", "site_name": "Site A", "emissions": 2.0},
            {"scope": "Scope 1", "category": "Category Beta", "site_name": "Site C", "emissions": 4.0},
            {"scope": "Scope 2", "category": "Category Gamma", "site_name": "Site D", "emissions": 3.0},
            {"scope": "Scope 1", "category": "Category Beta", "site_name": "Site B", "emissions": 1.5},
        ]
    )

    class _SummaryResolver:
        def __init__(self, *_args, **_kwargs):
            pass

    monkeypatch.setattr(
        job_data_output_routes,
        "combined_row_metrics",
        lambda row, _resolver=None: {"calc_tco2e": float(row.get("emissions") or 0.0)},
    )

    scopes, totals = job_data_output_routes._build_scope_summary(df, _SummaryResolver())

    assert [scope["scope_name"] for scope in scopes] == ["Scope 1", "Scope 2", "Scope 3"]
    assert totals["Scope 1"] == 7.5
    assert totals["Scope 2"] == 3.0
    assert totals["Scope 3"] == 1.0
    assert totals["Total"] == 11.5

    scope1 = scopes[0]
    assert scope1["category_count"] == 2
    assert [cat["category_name"] for cat in scope1["categories"]] == ["Category Beta", "Category Alpha"]
    assert scope1["categories"][0]["site_count"] == 2
    assert [site["site_name"] for site in scope1["categories"][0]["sites"]] == ["Site B", "Site C"]
    assert scope1["categories"][0]["total_emissions"] == 5.5


def test_build_scope_summary_resolves_site_name_from_site_id(monkeypatch) -> None:
    df = pd.DataFrame(
        [
            {
                "scope": "Scope 3",
                "category": "Employee Commuting",
                "site_id": 22,
                "site_name": "No Site Assigned",
                "emissions": 9.36,
            }
        ]
    )

    class _SummaryResolver:
        def __init__(self, *_args, **_kwargs):
            pass

    monkeypatch.setattr(
        job_data_output_routes,
        "combined_row_metrics",
        lambda row, _resolver=None: {"calc_tco2e": float(row.get("emissions") or 0.0)},
    )

    scopes, _totals = job_data_output_routes._build_scope_summary(df, _SummaryResolver(), {22: "Registered Office"})

    assert scopes[0]["categories"][0]["sites"][0]["site_name"] == "Registered Office"


def test_get_job_data_output_audit_falls_back_when_resolver_fails(monkeypatch) -> None:
    fake_conn = _AuditConn()
    audit_df = pd.DataFrame(
        [
            {
                "scope": "Scope 1",
                "site_name": "Site A",
                "category": "Company Vehicles",
                "report_label": "Fuel use",
                "record_type": "legacy",
                "original_id": "row-1",
                "qty": 2,
                "uom": "litres",
                "factor": 5,
                "ghg_unit": "tCO2e",
                "apply_pct": 100,
                "dataset_name": "Dataset A",
                "dataset_version": "2026",
                "source_family": "Legacy Data Entry",
                "data_confidence": "H",
            }
        ]
    )

    monkeypatch.setattr(job_data_output_routes, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(job_data_output_routes, "_load_data_output_rows", lambda *_args, **_kwargs: audit_df)

    class _ExplodingResolver:
        def __init__(self, *_args, **_kwargs):
            pass

        def row_metrics(self, *_args, **_kwargs):
            raise RuntimeError("resolver exploded")

    monkeypatch.setattr(job_data_output_routes, "JobMonthlyEmissionsResolver", _ExplodingResolver)

    result = job_data_output_routes.get_job_data_output_audit(664, _user={"user_id": "u1", "org_id": "org-123"})

    assert result["job_id"] == 664
    assert result["reporting_year"] == 2026
    assert result["rows"][0]["category"] == "Company Vehicles"
    assert result["rows"][0]["tco2e_after_apply"] == 10
    assert result["scope_subtotals"][0]["subtotal_tco2e_after_apply"] == 10


def test_get_job_data_output_audit_falls_back_when_resolver_constructor_fails(monkeypatch) -> None:
    fake_conn = _AuditConn()
    audit_df = pd.DataFrame(
        [
            {
                "scope": "Scope 1",
                "site_name": "Site A",
                "category": "Company Vehicles",
                "report_label": "Fuel use",
                "record_type": "legacy",
                "original_id": "row-1",
                "qty": 2,
                "uom": "litres",
                "factor": 5,
                "ghg_unit": "tCO2e",
                "apply_pct": 100,
                "dataset_name": "Dataset A",
                "dataset_version": "2026",
                "source_family": "Legacy Data Entry",
                "data_confidence": "H",
            }
        ]
    )

    monkeypatch.setattr(job_data_output_routes, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(job_data_output_routes, "_load_data_output_rows", lambda *_args, **_kwargs: audit_df)

    class _BrokenConstructorResolver:
        def __init__(self, *_args, **_kwargs):
            raise RuntimeError("resolver constructor exploded")

    monkeypatch.setattr(job_data_output_routes, "JobMonthlyEmissionsResolver", _BrokenConstructorResolver)

    result = job_data_output_routes.get_job_data_output_audit(664, _user={"user_id": "u1", "org_id": "org-123"})

    assert result["rows"][0]["tco2e_after_apply"] == 10
    assert result["scope_subtotals"][0]["subtotal_tco2e_after_apply"] == 10


def test_get_job_data_output_audit_sanitises_optional_pandas_values(monkeypatch) -> None:
    fake_conn = _AuditConn()
    audit_df = pd.DataFrame(
        [
            {
                "scope": "Scope 1",
                "site_name": "Site A",
                "category": "Company Vehicles",
                "report_label": "Fuel use",
                "record_type": "legacy",
                "original_id": "row-1",
                "qty": 2,
                "uom": "litres",
                "factor": 5,
                "ghg_unit": "tCO2e",
                "apply_pct": 100,
                "dataset_name": "Dataset A",
                "dataset_version": "2026",
                "source_family": "Legacy Data Entry",
                "data_confidence": "H",
                "source_type": float("nan"),
                "group_name": float("nan"),
                "source_name": float("nan"),
                "asset_identifier": float("nan"),
                "employee_name": float("nan"),
            }
        ]
    )

    monkeypatch.setattr(job_data_output_routes, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(job_data_output_routes, "_load_data_output_rows", lambda *_args, **_kwargs: audit_df)

    class _ExplodingResolver:
        def __init__(self, *_args, **_kwargs):
            pass

        def row_metrics(self, *_args, **_kwargs):
            raise RuntimeError("resolver exploded")

    monkeypatch.setattr(job_data_output_routes, "JobMonthlyEmissionsResolver", _ExplodingResolver)

    result = job_data_output_routes.get_job_data_output_audit(664, _user={"user_id": "u1", "org_id": "org-123"})

    row = result["rows"][0]
    assert row["source_type"] is None
    assert row["group_name"] is None
    assert row["source_name"] is None
    assert row["asset_identifier"] is None
    assert row["employee_name"] is None
