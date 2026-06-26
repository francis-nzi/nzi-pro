"""
Tests for the report data integrity comparison logic.

compare_canonical_vs_report() is the pure function extracted from the
GET /jobs/{job_id}/report-data-check endpoint. These tests verify it
correctly identifies — and clears — discrepancies at scope, category,
and row level without requiring a database connection.
"""
from __future__ import annotations

from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api.job_live_report_routes import compare_canonical_vs_report


# ---------------------------------------------------------------------------
# Helpers to build the dicts the function expects
# ---------------------------------------------------------------------------

def _canon(scope: str, category: str, emission: float, row_id: str):
    return {"scope": scope, "category": category, "label": category, "emission": emission}, row_id

def _make_scopes(*pairs):
    """Build canonical_scopes from (scope, total) pairs."""
    base = {"Scope 1": 0.0, "Scope 2": 0.0, "Scope 3": 0.0}
    for scope, total in pairs:
        base[scope] = total
    return base

def _make_cats(*rows):
    """Build canonical_cats / report_cats from (scope, category, emission) tuples."""
    cats: dict[str, float] = {}
    for scope, category, emission in rows:
        k = f"{scope}||{category}"
        cats[k] = round(cats.get(k, 0.0) + emission, 4)
    return cats

def _make_rows(*rows):
    """Build canonical_rows / report_rows from (row_id, scope, category, emission) tuples."""
    d = {}
    for row_id, scope, category, emission in rows:
        d[str(row_id)] = {"scope": scope, "category": category, "label": category, "emission": emission}
    return d


# ---------------------------------------------------------------------------
# 1. Perfect match — should return "pass"
# ---------------------------------------------------------------------------

def test_identical_data_returns_pass():
    canonical_rows = _make_rows(
        ("r1", "Scope 1", "Company Vehicles", 10.63),
        ("r2", "Scope 2", "Electricity",       6.37),
        ("r3", "Scope 3", "Business Travel",  103.10),
    )
    canonical_cats = _make_cats(
        ("Scope 1", "Company Vehicles", 10.63),
        ("Scope 2", "Electricity",       6.37),
        ("Scope 3", "Business Travel",  103.10),
    )
    canonical_scopes = _make_scopes(("Scope 1", 10.63), ("Scope 2", 6.37), ("Scope 3", 103.10))

    result = compare_canonical_vs_report(
        canonical_rows, canonical_cats, canonical_scopes,
        canonical_rows.copy(), canonical_cats.copy(),  # report = same as canonical
    )

    assert result["status"] == "pass"
    assert result["issue_count"] == 0
    assert result["canonical_total"] == pytest.approx(120.10, abs=0.005)


# ---------------------------------------------------------------------------
# 2. Scope-level discrepancy detected
# ---------------------------------------------------------------------------

def test_scope_discrepancy_detected():
    canonical_scopes = _make_scopes(("Scope 1", 10.63), ("Scope 2", 6.37), ("Scope 3", 103.10))
    canonical_cats   = _make_cats(("Scope 1", "Fuel", 10.63), ("Scope 2", "Electricity", 6.37), ("Scope 3", "Travel", 103.10))
    report_cats      = _make_cats(("Scope 1", "Fuel", 10.00), ("Scope 2", "Electricity", 6.37), ("Scope 3", "Travel", 103.10))

    result = compare_canonical_vs_report({}, canonical_cats, canonical_scopes, {}, report_cats)

    scope_issues = [i for i in result["issues"] if i["level"] == "scope"]
    assert len(scope_issues) == 1
    assert scope_issues[0]["label"] == "Scope 1"
    assert scope_issues[0]["canonical"] == pytest.approx(10.63, abs=0.005)
    assert scope_issues[0]["report"]    == pytest.approx(10.00, abs=0.005)
    assert result["status"] == "fail"


# ---------------------------------------------------------------------------
# 3. Category-level discrepancy detected
# ---------------------------------------------------------------------------

def test_category_discrepancy_detected():
    scopes     = _make_scopes(("Scope 3", 103.10))
    canon_cats = _make_cats(("Scope 3", "Business Travel", 85.50), ("Scope 3", "Commuting", 17.60))
    report_cats = _make_cats(("Scope 3", "Business Travel", 85.00), ("Scope 3", "Commuting", 17.60))

    result = compare_canonical_vs_report({}, canon_cats, scopes, {}, report_cats)

    cat_issues = [i for i in result["issues"] if i["level"] == "category"]
    assert any("Business Travel" in i["label"] for i in cat_issues)
    assert result["status"] == "fail"


# ---------------------------------------------------------------------------
# 4. Row-level discrepancy detected
# ---------------------------------------------------------------------------

def test_row_discrepancy_detected():
    canon_rows  = _make_rows(("r1", "Scope 1", "Fuel", 10.63), ("r2", "Scope 2", "Electricity", 6.37))
    report_rows = _make_rows(("r1", "Scope 1", "Fuel", 10.00), ("r2", "Scope 2", "Electricity", 6.37))
    scopes = _make_scopes(("Scope 1", 10.63), ("Scope 2", 6.37))
    cats   = _make_cats(("Scope 1", "Fuel", 10.63), ("Scope 2", "Electricity", 6.37))

    result = compare_canonical_vs_report(canon_rows, cats, scopes, report_rows, cats.copy())

    row_issues = [i for i in result["issues"] if i["level"] == "row"]
    assert len(row_issues) == 1
    assert row_issues[0]["diff"] == pytest.approx(0.63, abs=0.005)


# ---------------------------------------------------------------------------
# 5. Missing row in report detected
# ---------------------------------------------------------------------------

def test_missing_row_in_report_detected():
    canon_rows  = _make_rows(("r1", "Scope 1", "Fuel", 10.63), ("r2", "Scope 3", "Travel", 50.00))
    report_rows = _make_rows(("r1", "Scope 1", "Fuel", 10.63))  # r2 missing
    scopes = _make_scopes(("Scope 1", 10.63), ("Scope 3", 50.00))
    cats   = _make_cats(("Scope 1", "Fuel", 10.63), ("Scope 3", "Travel", 50.00))

    result = compare_canonical_vs_report(canon_rows, cats, scopes, report_rows, _make_cats(("Scope 1", "Fuel", 10.63)))

    row_issues = [i for i in result["issues"] if i["level"] == "row"]
    assert any("MISSING" in i["label"] for i in row_issues)


# ---------------------------------------------------------------------------
# 6. Values within tolerance are ignored
# ---------------------------------------------------------------------------

def test_within_tolerance_ignored():
    """Differences ≤ 0.05 tCO2e are floating-point noise and should not flag."""
    canon_cats  = _make_cats(("Scope 1", "Fuel", 10.63))
    report_cats = _make_cats(("Scope 1", "Fuel", 10.64))   # 0.01 diff — within 0.05 tolerance
    scopes = _make_scopes(("Scope 1", 10.63))

    result = compare_canonical_vs_report({}, canon_cats, scopes, {}, report_cats)

    assert result["status"] == "pass"
    assert result["issue_count"] == 0


# ---------------------------------------------------------------------------
# 7. Multiple issues counted correctly
# ---------------------------------------------------------------------------

def test_multiple_issues_counted():
    canon_rows  = _make_rows(
        ("r1", "Scope 1", "Fuel",        10.63),
        ("r2", "Scope 2", "Electricity",  6.37),
        ("r3", "Scope 3", "Travel",      85.50),
    )
    report_rows = _make_rows(
        ("r1", "Scope 1", "Fuel",        10.00),  # row diff
        ("r2", "Scope 2", "Electricity",  5.00),  # row diff
        ("r3", "Scope 3", "Travel",      85.50),  # ok
    )
    scopes     = _make_scopes(("Scope 1", 10.63), ("Scope 2", 6.37), ("Scope 3", 85.50))
    canon_cats = _make_cats(("Scope 1", "Fuel", 10.63), ("Scope 2", "Electricity", 6.37), ("Scope 3", "Travel", 85.50))
    report_cats = _make_cats(("Scope 1", "Fuel", 10.00), ("Scope 2", "Electricity", 5.00), ("Scope 3", "Travel", 85.50))

    result = compare_canonical_vs_report(canon_rows, canon_cats, scopes, report_rows, report_cats)

    assert result["status"] == "fail"
    assert result["scope_issues"] == 2
    assert result["category_issues"] == 2
    assert result["row_issues"] == 2
    assert result["issue_count"] == 6
