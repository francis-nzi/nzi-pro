from __future__ import annotations

from pathlib import Path
import sys

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.client_dashboard_routes as client_dashboard_routes
import api.job_data_output_routes as job_data_output_routes
import api.job_report_routes as job_report_routes
import services.emissions_reporting as emissions_reporting


def test_dataset_category_label_prefers_category_over_level_1() -> None:
    row = {
        "dataset_category": None,
        "lookup_category": None,
        "category": "Company Vehicles",
        "lookup_level_1": "Delivery vehicles",
        "lookup_level_2": "Cars",
        "level_1": "Delivery vehicles",
        "level_2": "Cars",
    }

    assert job_data_output_routes._dataset_category_label(row) == "Company Vehicles"
    assert client_dashboard_routes._dataset_category_label(row) == "Company Vehicles"
    assert job_report_routes._dataset_category_label(row) == "Company Vehicles"


def test_dataset_category_label_uses_lookup_category_when_present() -> None:
    row = {
        "dataset_category": None,
        "lookup_category": "Business Travel",
        "category": "Business travel - air",
        "lookup_level_1": "Business travel - air",
        "level_1": "Business travel - air",
        "level_2": "Flights",
    }

    assert job_data_output_routes._dataset_category_label(row) == "Business Travel"
    assert client_dashboard_routes._dataset_category_label(row) == "Business Travel"
    assert job_report_routes._dataset_category_label(row) == "Business Travel"


def test_emissions_reporting_prefers_category_before_level_1_in_sql() -> None:
    class _CaptureConn:
        def __init__(self):
            self.sql = ""

        def execute(self, sql, params=None):
            self.sql = sql
            return self

        def df(self):
            return pd.DataFrame([])

    fake = _CaptureConn()
    emissions_reporting.load_combined_reporting_rows(fake, [123])

    sql = fake.sql.lower()
    assert "nullif(trim(cast(jsr.category as varchar)), '')" in sql
    assert sql.index("nullif(trim(cast(jsr.category as varchar)), '')") < sql.index(
        "nullif(trim(cast(jsr.level_1 as varchar)), '')"
    )


def test_load_combined_reporting_rows_resolves_site_name_from_site_id() -> None:
    class _Result:
        def __init__(self, df=None, rows=None):
            self._df = df
            self._rows = rows or []

        def fetchall(self):
            return self._rows

        def df(self):
            return self._df

    class _CaptureConn:
        def __init__(self):
            self.sql = ""

        def execute(self, sql, params=None):
            self.sql = sql
            if "information_schema.columns" in sql:
                return _Result(rows=[])
            if "FROM client_sites" in sql and "LEFT JOIN" not in sql:
                return _Result(rows=[(22, "Registered Office")])
            return _Result(
                df=pd.DataFrame(
                    [
                        {
                            "job_id": 123,
                            "row_id": 1,
                            "dashboard_year": 2025,
                            "record_type": "legacy",
                            "scope": "Scope 3",
                            "level_1": None,
                            "dataset_category": "Employee Commuting",
                            "category": "Employee Commuting",
                            "site_id": 22,
                            "site_name": "No Site Assigned",
                            "dataset_id": 1,
                            "factor_db_id": 1,
                            "original_id": "row-1",
                            "source_family": "Legacy Data Entry",
                            "lookup_category": "Employee Commuting",
                            "lookup_level_1": "Employee Commuting",
                            "lookup_level_2": "Employee Commuting",
                            "source_qty": None,
                            "source_uom": None,
                            "qty": 1.0,
                            "uom": "km",
                            "factor": 0.1,
                            "ghg_unit": "kgCO2e",
                            "apply_pct": 100,
                            "calc_tco2e": None,
                            "notes": None,
                            "source_type": None,
                            "group_name": None,
                            "asset_identifier": None,
                            "employee_name": None,
                            "month_1": None,
                            "month_2": None,
                            "month_3": None,
                            "month_4": None,
                            "month_5": None,
                            "month_6": None,
                            "month_7": None,
                            "month_8": None,
                            "month_9": None,
                            "month_10": None,
                            "month_11": None,
                            "month_12": None,
                        }
                    ]
                )
            )

    fake = _CaptureConn()
    df = emissions_reporting.load_combined_reporting_rows(fake, [123])

    assert df.iloc[0]["site_name"] == "Registered Office"
