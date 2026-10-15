from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pytest
from api import employee_commuting_routes as routes

CAR_KEYS = [key for key in routes.COMMUTE_FACTOR_MAP if key[0].startswith("car - ") and key[2] == "miles"]

@pytest.mark.parametrize("key", CAR_KEYS)
def test_all_car_services_accept_kilometres(key):
    original, mode, variant, error, matched = routes._resolve_commuting_original_id(key[0], key[1], "km")
    assert error is None
    assert (mode, variant) == key[:2]
    assert original == routes.COMMUTE_FACTOR_MAP.get((*key[:2], "km"), routes.COMMUTE_FACTOR_MAP[key])


def test_exact_km_mapping_is_preferred(monkeypatch):
    monkeypatch.setattr(routes, "COMMUTE_FACTOR_MAP", {("car - petrol", "average", "km"): "km-factor", ("car - petrol", "average", "miles"): "mile-factor"})
    assert routes._resolve_commuting_original_id("Car petrol", "Average", "km")[0] == "km-factor"


@pytest.mark.parametrize("factor_unit,factor,expected_qty", [("miles", 0.3218688, 100), ("km", 0.2, 160.9344)])
def test_bulk_preview_keeps_quantity_and_factor_units_consistent(monkeypatch, factor_unit, factor, expected_qty):
    monkeypatch.setattr(routes, "_job_employee_count", lambda *a: 1)
    monkeypatch.setattr(routes, "_effective_employee_count", lambda *a: 1)
    monkeypatch.setattr(routes, "_resolve_commuting_factor_record", lambda *a: {
        "original_id": "test-c", "factor_db_id": 1, "dataset_id": 1, "factor": factor,
        "uom": factor_unit, "ghg_unit": "kgCO2e", "scope": "Scope 3"})
    result = routes._resolve_preview_rows(None, 663, 1, [{
        "row_type": "commuting", "sheet": "Employee Commuting", "row_number": 2,
        "employee_name": "Employee", "annual_quantity": 160.9344,
        "mode_value": "Car petrol", "service_value": "Average", "unit_value": "km",
    }], disable_scaling=True)
    assert not result["unresolved_rows"]
    row = result["ready_rows"][0]
    assert row["qty"] == pytest.approx(expected_qty)
    assert row["uom"] == factor_unit
    assert row["calc_tco2e"] == pytest.approx(0.03218688)


def test_invalid_car_service_is_not_silently_substituted():
    assert routes._resolve_commuting_original_id("Car petrol", "not a service", "km")[3]
