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
