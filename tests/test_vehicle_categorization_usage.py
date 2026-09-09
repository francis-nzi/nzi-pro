"""Regression tests for the 2026-09 Employee Commuting mis-categorisation.

A commuting registration lookup used to resolve into the Company Vehicles
factor family, so the entry carried a "Passenger vehicles" factor whose own
category is Company Vehicles. Every downstream category resolution prefers
the factor's lookup category over the stored row category, so Scope 3
commuting reported as Company Vehicles -- both on Data Entry (via the
consolidated rows) and in report category breakdowns.
"""
from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from services import vehicle_categorization
from services.vehicle_categorization import (
    USAGE_COMPANY_VEHICLE,
    USAGE_EMPLOYEE_COMMUTING,
    categorize_vehicle,
)

DATASET_ID = 7

# (level_1, level_2, level_3, level_4) -> list of (uom, factor, report_label,
# category, scope). Mirrors the real v_factor_lookup shape closely enough for
# the banding logic: most distance factors exist as both a km and a miles row.
_FACTORS: dict[tuple[str, str, str, str | None], list[tuple]] = {
    ("Passenger vehicles", "Cars (by size)", "Medium car", "Diesel"): [
        ("km", 0.16716, "Passenger Vehicles: Medium Car Diesel (1701-2000cc)", "Company Vehicles", "Scope 1"),
        ("miles", 0.26902, "Passenger Vehicles: Medium Car Diesel (1701-2000cc)", "Company Vehicles", "Scope 1"),
    ],
    ("UK electricity for EVs", "Cars (by size)", "Small car", "Battery Electric Vehicle"): [
        ("miles", 0.07143, "UK Electricity for EVs: Small Car Battery Electric Vehicle", "Company Vehicles", "Scope 2"),
    ],
    ("Delivery vehicles", "Vans", "Class III (1.74 to 3.5 tonnes)", "Diesel"): [
        ("miles", 0.40794, "Delivery Vehicles: Vans Class III (1.74 to 3.5 Tonnes) Diesel", "Company Vehicles", "Scope 1"),
    ],
    ("Employee commuting- land", "Cars (by size)", "Medium car", "Diesel"): [
        ("km", 0.168, "Employee Commuting: Medium Car Diesel (1701-2000cc)", "Employee Commuting", "Scope 3"),
        ("miles", 0.27039, "Employee Commuting: Medium Car Diesel (1701-2000cc)", "Employee Commuting", "Scope 3"),
    ],
    ("Employee commuting- land", "Cars (by size)", "Small car", "Battery Electric Vehicle"): [
        ("miles", 0.07107, "Employee Commuting: Small Car Battery Electric Vehicle", "Employee Commuting", "Scope 3"),
    ],
    ("Employee commuting- land", "Cars (by size)", "Average car", "Diesel"): [
        ("miles", 0.28306, "Employee Commuting: Average Car Diesel", "Employee Commuting", "Scope 3"),
    ],
    ("Employee commuting- land", "Motorbike", "Medium", None): [
        ("miles", 0.16237, "Employee Commuting: Motorbike Medium", "Employee Commuting", "Scope 3"),
    ],
}


class _FakeResult:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _FakeConn:
    """Answers the single _find_factor_row query against _FACTORS."""

    def execute(self, sql, params):
        level_1, level_2, level_3 = params[1], params[2], params[3]
        idx = 4
        level_4 = None
        if "AND level_4 = %s" in sql:
            level_4 = params[idx]
            idx += 1
        matches = list(_FACTORS.get((level_1, level_2, level_3, level_4), []))
        if not matches:
            return _FakeResult(None)
        if "LOWER(TRIM(uom)) = LOWER(%s)" in sql:
            preferred = str(params[idx]).lower()
            matches.sort(key=lambda m: 0 if m[0].lower() == preferred else 1)
        uom, factor, report_label, category, scope = matches[0]
        return _FakeResult((1, DATASET_ID, "orig-1", scope, category, report_label, uom, factor, "kgCO2e"))


@pytest.fixture(autouse=True)
def _stub_datasets(monkeypatch):
    monkeypatch.setattr(
        vehicle_categorization, "get_scope_primary_datasets", lambda job_id: {"Scope 1": DATASET_ID}
    )


MEDIUM_DIESEL_CAR = {"type_approval": "M1", "fuel_type": "DIESEL", "engine_capacity": 1950}
SMALL_EV_CAR = {"type_approval": "M1", "fuel_type": "ELECTRICITY", "engine_capacity": 1000}
DIESEL_VAN = {"type_approval": "N1", "fuel_type": "DIESEL", "revenue_weight": 3270}
MOTORBIKE = {"type_approval": "", "fuel_type": "PETROL", "engine_capacity": 400}


def test_commuting_car_resolves_into_the_commuting_family():
    factor, error = categorize_vehicle(
        _FakeConn(), 1, MEDIUM_DIESEL_CAR, usage=USAGE_EMPLOYEE_COMMUTING
    )

    assert error is None
    assert factor["report_label"] == "Employee Commuting: Medium Car Diesel (1701-2000cc)"
    assert factor["category"] == "Employee Commuting"
    assert factor["scope"] == "Scope 3"


def test_company_vehicle_car_is_unchanged():
    factor, error = categorize_vehicle(_FakeConn(), 1, MEDIUM_DIESEL_CAR)

    assert error is None
    assert factor["report_label"] == "Passenger Vehicles: Medium Car Diesel (1701-2000cc)"
    assert factor["category"] == "Company Vehicles"


def test_commuting_ev_stays_in_the_commuting_family():
    """Company vehicle EVs route to the separate "UK electricity for EVs"
    level_1; commuting EVs are a fuel within the commuting family."""
    factor, error = categorize_vehicle(_FakeConn(), 1, SMALL_EV_CAR, usage=USAGE_EMPLOYEE_COMMUTING)

    assert error is None
    assert factor["report_label"] == "Employee Commuting: Small Car Battery Electric Vehicle"
    assert factor["category"] == "Employee Commuting"


def test_commuting_van_falls_back_to_commuting_car_not_a_company_van():
    """DEFRA publishes no commuting van factor -- the fallback must stay in
    the commuting family rather than borrowing the Delivery vehicles one."""
    factor, error = categorize_vehicle(_FakeConn(), 1, DIESEL_VAN, usage=USAGE_EMPLOYEE_COMMUTING)

    assert error is None
    assert factor["category"] == "Employee Commuting"
    assert "Delivery Vehicles" not in factor["report_label"]


def test_commuting_motorbike_resolves_into_the_commuting_family():
    factor, error = categorize_vehicle(_FakeConn(), 1, MOTORBIKE, usage=USAGE_EMPLOYEE_COMMUTING)

    assert error is None
    assert factor["report_label"] == "Employee Commuting: Motorbike Medium"


def test_miles_row_wins_when_a_factor_exists_in_both_units():
    """Every screen feeding this takes distance in miles and stores the
    resolved factor's own uom against it, so a km row would silently
    mis-state the entry."""
    factor, _error = categorize_vehicle(
        _FakeConn(), 1, MEDIUM_DIESEL_CAR, usage=USAGE_EMPLOYEE_COMMUTING
    )

    assert factor["uom"] == "miles"
    assert factor["factor"] == 0.27039
