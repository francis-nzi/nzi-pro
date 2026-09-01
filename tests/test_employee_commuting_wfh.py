"""Regression test for the WFH "hours" -> "per FTE Working Hour" unit
conversion bug (2026-08): _convert_quantity only understands distance units
(miles/km/passenger.km), so every WFH submission -- portal and CRM
spreadsheet-import alike -- was silently rejected as unresolvable."""
from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api.employee_commuting_routes import (
    _hours_equivalent_unit,
    _resolve_commuting_original_id,
)


def test_fte_working_hour_recognised_as_hours_equivalent():
    assert _hours_equivalent_unit("per FTE Working Hour") is True
    assert _hours_equivalent_unit("hours") is True
    assert _hours_equivalent_unit("Hour") is True


def test_distance_units_not_treated_as_hours_equivalent():
    assert _hours_equivalent_unit("miles") is False
    assert _hours_equivalent_unit("km") is False
    assert _hours_equivalent_unit("passenger.km") is False


def test_motorbike_km_resolves_to_miles_factor_for_conversion():
    original_id, mode, variant, error, matched_unit = _resolve_commuting_original_id(
        "Motorbike", "", "km"
    )

    assert original_id
    assert mode == "motorbike"
    assert variant == ""
    assert error is None
    assert matched_unit == "miles"
