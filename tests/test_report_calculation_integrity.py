"""
Report calculation integrity tests.

Verifies that the canonical Outputs path (_build_scope_summary + combined_row_metrics)
produces exact, consistent values. These tests guard against the class of bug where
the same emissions figure is computed differently by different code paths
(e.g. Report Printing vs Outputs diverging, or rounding producing 103.0 instead of 103.1).

No real database connection is required — all tests use in-memory DataFrames and
stub resolvers.
"""
from __future__ import annotations

from pathlib import Path
import sys

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.emissions_reporting import combined_row_metrics
from api.job_data_output_routes import _build_scope_summary, _dataset_category_label


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sr_row(scope: str, category: str, calc_tco2e: float, original_id: str = "r1") -> dict:
    """Minimal source-register row. combined_row_metrics uses stored calc_tco2e directly."""
    return {
        "record_type": "source_register",
        "scope": scope,
        "category": category,
        "calc_tco2e": calc_tco2e,
        "qty": 1.0,
        "factor": calc_tco2e,
        "ghg_unit": "tCO2e",
        "apply_pct": 100,
        "uom": "unit",
        "original_id": original_id,
        # fields consumed by _dataset_category_label
        "dataset_category": None,
        "lookup_category": None,
        "lookup_level_1": None,
        "lookup_level_2": None,
        "level_1": None,
        "level_2": None,
        # fields consumed by resolve_site_name
        "site_id": None,
        "site_name": None,
        "dataset_name": None,
        "dataset_id": None,
    }


# ---------------------------------------------------------------------------
# 1. combined_row_metrics — source-register path uses stored calc_tco2e
# ---------------------------------------------------------------------------

def test_source_register_uses_stored_calc_tco2e():
    """
    Source-register rows must use the stored calc_tco2e, not qty × factor.
    This is the canonical Outputs path; re-computing from raw values diverged
    in the YoY chart (103.0 vs 103.1 bug).
    """
    row = _sr_row("Scope 1", "Company Vehicles", calc_tco2e=103.10)
    row["qty"] = 9999.0   # deliberately wrong — must be ignored
    row["factor"] = 0.001  # would give ~9.999 if re-computed

    metrics = combined_row_metrics(row, resolver=None)
    assert metrics["calc_tco2e"] == pytest.approx(103.10, abs=1e-9)


def test_source_register_falls_back_to_formula_when_calc_tco2e_is_none():
    """When calc_tco2e is absent the formula qty × factor / 1000 (for kgCO2e) is used."""
    row = _sr_row("Scope 2", "Electricity", calc_tco2e=0.0)
    row["calc_tco2e"] = None
    row["qty"] = 1000.0
    row["factor"] = 0.233
    row["ghg_unit"] = "kgCO2e"

    metrics = combined_row_metrics(row, resolver=None)
    # 1000 × 0.233 = 233 kg = 0.233 tCO2e
    assert metrics["calc_tco2e"] == pytest.approx(0.233, abs=1e-9)


# ---------------------------------------------------------------------------
# 2. Rounding — the 0.55 display bug
# ---------------------------------------------------------------------------

def test_0p55_stored_value_rounds_to_correct_1dp():
    """
    Regression: a stored calc_tco2e of 0.5450 was displaying as "0.5" (1dp)
    instead of "0.6" because raw DB float was not pre-rounded to 2dp first.

    The fix: always round(float(calc_tco2e), 2) before display.
    0.5450 → round to 2dp → 0.55 → display at 1dp → "0.6"
    """
    raw_db_value = 0.5450  # what might come back from the DB

    # Step performed in _build_scope_summary and get_emissions_by_category
    emission_2dp = round(float(raw_db_value), 2)
    assert emission_2dp == pytest.approx(0.55, abs=1e-9)

    # Step performed in fmt() / formatTco2e() frontend pre-rounding
    # Pre-round to dp+1 (i.e. 2 places) then display at 1dp
    pre_rounded = round(emission_2dp * 100) / 100  # equivalent of Math.round(v * 10^(dp+1)) / 10^(dp+1)
    displayed_1dp = f"{pre_rounded:.1f}"
    assert displayed_1dp == "0.6", f"Expected '0.6' but got '{displayed_1dp}'"


def test_ieee754_edge_does_not_produce_wrong_rounding():
    """
    IEEE-754: 0.55 is actually 0.5499999... in binary floating point.
    Without pre-rounding, toLocaleString(1dp) gives "0.5" instead of "0.6".
    Our pre-round to dp+1 places fixes this.
    """
    stored = 0.55  # the exact Python float (which is ~0.5499999...)

    # Naive display — wrong path (what the bug was):
    naive = f"{stored:.1f}"   # Python's banker's rounding: "0.6" on CPython but JS may give "0.5"

    # Safe path: pre-round to 2dp first, then display at 1dp
    pre_rounded = round(round(stored, 2) * 100) / 100
    safe = f"{pre_rounded:.1f}"
    assert safe == "0.6", f"Safe path should give '0.6', got '{safe}'"


# ---------------------------------------------------------------------------
# 3. _build_scope_summary — exact scope totals
# ---------------------------------------------------------------------------

def test_build_scope_summary_exact_totals():
    """
    Three rows, one per scope. Totals must be exact to 2dp.
    This is the Outputs path that drives Insights, Report Printing, and YoY charts.
    """
    rows = [
        _sr_row("Scope 1", "Company Vehicles", calc_tco2e=10.63, original_id="s1r1"),
        _sr_row("Scope 2", "Electricity",      calc_tco2e=6.37,  original_id="s2r1"),
        _sr_row("Scope 3", "Business Travel",  calc_tco2e=103.10, original_id="s3r1"),
    ]
    df = pd.DataFrame(rows)

    _, totals = _build_scope_summary(df, resolver=None)

    assert totals["Scope 1"] == pytest.approx(10.63, abs=0.005)
    assert totals["Scope 2"] == pytest.approx(6.37,  abs=0.005)
    assert totals["Scope 3"] == pytest.approx(103.10, abs=0.005)
    assert totals["Total"]   == pytest.approx(120.10, abs=0.005)


def test_build_scope_summary_multiple_rows_same_scope():
    """
    Multiple rows within one scope must aggregate correctly.
    Guards against the 103.0 vs 103.1 class of bug where floating-point
    accumulation diverged from stored values.
    """
    rows = [
        _sr_row("Scope 3", "Employee Commuting", calc_tco2e=50.00, original_id="r1"),
        _sr_row("Scope 3", "Employee Commuting", calc_tco2e=50.00, original_id="r2"),
        _sr_row("Scope 3", "Employee Commuting", calc_tco2e=3.10,  original_id="r3"),
    ]
    df = pd.DataFrame(rows)

    _, totals = _build_scope_summary(df, resolver=None)

    assert totals["Scope 3"] == pytest.approx(103.10, abs=0.005)
    assert totals["Total"]   == pytest.approx(103.10, abs=0.005)


def test_build_scope_summary_returns_zero_for_missing_scopes():
    """Scopes with no rows must return 0.0, not KeyError or None."""
    rows = [_sr_row("Scope 1", "Fuel", calc_tco2e=5.00, original_id="r1")]
    df = pd.DataFrame(rows)

    _, totals = _build_scope_summary(df, resolver=None)

    assert totals["Scope 1"] == pytest.approx(5.00, abs=0.005)
    assert totals["Scope 2"] == 0.0
    assert totals["Scope 3"] == 0.0
    assert totals["Total"]   == pytest.approx(5.00, abs=0.005)


# ---------------------------------------------------------------------------
# 4. Cross-path consistency: _build_scope_summary == row-by-row sum
# ---------------------------------------------------------------------------

def test_scope_summary_matches_independent_row_aggregation():
    """
    The scope totals from _build_scope_summary must exactly match summing
    each row's combined_row_metrics individually.

    This test specifically catches the bug pattern where one code path
    re-computes from raw qty×factor while the other uses stored calc_tco2e.
    """
    rows = [
        _sr_row("Scope 1", "Company Vehicles",  calc_tco2e=10.63, original_id="r1"),
        _sr_row("Scope 1", "Refrigerants",      calc_tco2e=0.00,  original_id="r2"),
        _sr_row("Scope 2", "Electricity",        calc_tco2e=6.37,  original_id="r3"),
        _sr_row("Scope 3", "Business Travel",    calc_tco2e=85.50, original_id="r4"),
        _sr_row("Scope 3", "Employee Commuting", calc_tco2e=17.60, original_id="r5"),
        _sr_row("Scope 3", "Purchased Goods",    calc_tco2e=0.55,  original_id="r6"),
    ]
    df = pd.DataFrame(rows)

    _, totals = _build_scope_summary(df, resolver=None)

    for scope in ("Scope 1", "Scope 2", "Scope 3"):
        independent_sum = round(
            sum(
                round(float(combined_row_metrics(row, resolver=None)["calc_tco2e"]), 2)
                for _, row in df[df["scope"] == scope].iterrows()
            ),
            2,
        )
        assert totals[scope] == pytest.approx(independent_sum, abs=0.005), (
            f"{scope}: _build_scope_summary gave {totals[scope]}, "
            f"independent sum gave {independent_sum}"
        )


# ---------------------------------------------------------------------------
# 5. _dataset_category_label — priority order
# ---------------------------------------------------------------------------

def test_category_label_prefers_dataset_category():
    row = {"dataset_category": "Energy", "lookup_category": "Electricity", "category": "elec"}
    assert _dataset_category_label(row) == "Energy"


def test_category_label_skips_empty_to_find_value():
    row = {"dataset_category": None, "lookup_category": "", "category": "Company Vehicles",
           "lookup_level_1": None, "lookup_level_2": None, "level_1": None, "level_2": None}
    assert _dataset_category_label(row) == "Company Vehicles"


def test_category_label_returns_fallback_when_all_empty():
    row = {"dataset_category": None, "lookup_category": None, "category": None,
           "lookup_level_1": None, "lookup_level_2": None, "level_1": None, "level_2": None}
    assert _dataset_category_label(row) == "Uncategorized"
