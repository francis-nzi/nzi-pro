"""Data Entry is the sense-check screen for a job, but Asset Register and
Business Travel Register rows live in job_emission_sources, so a client's
whole vehicle fleet was invisible there while still counting in every report.
These cover the read-only consolidation that closes that gap.
"""
from __future__ import annotations

from pathlib import Path
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api.job_scope_data_routes import (
    _load_register_consolidated_rows,
    _reject_register_row_id,
)


def _source_row(
    source_type: str,
    site_id: int | None,
    factor_db_id: int,
    report_label: str,
    qty: float,
    tco2e: float,
    entry_count: int,
    anchor_source_id: int,
    entry_labels: str | None,
    category: str = "Company Vehicles",
    scope: str = "Scope 1",
    all_enabled: bool = True,
):
    """One aggregated row in the column order _load_register_consolidated_rows
    selects."""
    return (
        source_type, site_id, "Registered Office", factor_db_id, scope, 3, "orig-1",
        "miles", 0.26902, "kgCO2e", category, "Passenger vehicles", "Cars (by size)",
        "Medium car", "Diesel", "col text", report_label, qty, tco2e, entry_count,
        anchor_source_id, entry_labels, all_enabled,
        *([None] * 12),
    )


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows

    def df(self):
        import pandas as pd

        return pd.DataFrame({"column_name": ["month_1"]})


class _Conn:
    """Answers _table_columns' information_schema probe and the aggregate."""

    def __init__(self, rows):
        self._rows = rows
        self.last_sql = ""
        self.last_params = None

    def execute(self, sql, params=None):
        self.last_sql = sql
        self.last_params = params
        if "information_schema" in sql:
            return _Result([])
        return _Result(self._rows)


@pytest.fixture(autouse=True)
def _clear_column_cache():
    from api import job_scope_data_routes

    job_scope_data_routes._table_columns_cache.clear()
    yield
    job_scope_data_routes._table_columns_cache.clear()


def test_asset_rows_consolidate_into_one_read_only_line():
    con = _Conn([
        _source_row("asset", 5, 900, "Passenger Vehicles: Small Car Hybrid", 10934.0, 1.7862, 5, 463, "DB1, DB3, EB3, SB1, SB3"),
    ])

    rows = _load_register_consolidated_rows(con, 217)

    assert len(rows) == 1
    row = rows[0]
    assert row["qty"] == 10934.0
    assert row["calc_tco2e"] == 1.7862
    assert row["register_entry_count"] == 5
    assert row["is_register_row"] is True
    assert row["is_auto_generated"] is True
    assert row["auto_pair_kind"] == "asset_register"
    assert row["data_source"] == "Asset Register (Consolidated)"
    assert "5 Asset Register entries" in row["notes"]
    assert "SB1" in row["notes"]


def test_single_entry_note_reads_as_singular():
    con = _Conn([
        _source_row("asset", 5, 901, "Passenger Vehicles: Medium Car Diesel", 54000.0, 14.5271, 1, 468, "MN"),
    ])

    row = _load_register_consolidated_rows(con, 217)[0]

    assert "1 Asset Register entry:" in row["notes"]


def test_business_travel_rows_are_labelled_separately():
    con = _Conn([
        _source_row(
            "business_travel", 5, 910, "Business Travel: Rail National Rail", 2880.0, 0.1021,
            1, 474, "MN", category="Business Travel", scope="Scope 3",
        ),
    ])

    row = _load_register_consolidated_rows(con, 217)[0]

    assert row["auto_pair_kind"] == "business_travel_register"
    assert row["register_label"] == "Business Travel"
    assert row["data_source"] == "Business Travel Register (Consolidated)"


def test_row_id_is_negative_and_anchored_on_the_group():
    """Negative so it can never collide with a real job_scope_rows id, and
    anchored on the group's lowest source_id so it survives a reload."""
    con = _Conn([
        _source_row("asset", 5, 900, "Passenger Vehicles: Small Car Hybrid", 10934.0, 1.7862, 5, 463, "SB1"),
    ])

    row = _load_register_consolidated_rows(con, 217)[0]

    assert row["row_id"] == -463


def test_scope_filter_is_pushed_into_the_query():
    con = _Conn([])

    _load_register_consolidated_rows(con, 217, scope="Scope 1")

    assert "s.scope = %s" in con.last_sql
    assert "Scope 1" in con.last_params


def test_disabled_rows_excluded_unless_asked_for():
    con = _Conn([])

    _load_register_consolidated_rows(con, 217)
    assert "COALESCE(s.enabled, TRUE) = TRUE" in con.last_sql

    _load_register_consolidated_rows(con, 217, include_disabled=True)
    assert "COALESCE(s.enabled, TRUE) = TRUE" not in con.last_sql


def test_a_broken_register_read_never_breaks_data_entry():
    class _Boom:
        def execute(self, sql, params=None):
            if "information_schema" in sql:
                return _Result([])
            raise RuntimeError("register table missing")

    assert _load_register_consolidated_rows(_Boom(), 217) == []


@pytest.mark.parametrize("row_id", [-463, -1])
def test_write_endpoints_reject_consolidated_register_ids(row_id):
    with pytest.raises(HTTPException) as excinfo:
        _reject_register_row_id(row_id)

    assert excinfo.value.status_code == 400
    assert "Asset Register" in str(excinfo.value.detail)


@pytest.mark.parametrize("row_id", [1, 7557, "7557"])
def test_real_row_ids_pass_the_guard(row_id):
    _reject_register_row_id(row_id)
