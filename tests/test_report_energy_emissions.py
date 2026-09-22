from __future__ import annotations

from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api import report_template_routes as rtr


# DESNZ UK electricity, generation only.
FACTOR_2025 = 0.177
FACTOR_2026 = 0.13096
TD_2025 = 0.01853
TD_2026 = 0.01301


def _uk_samples(location: dict[int, float], td: dict[int, float] | None = None):
    return {
        "uk": {"location": dict(location), "td": dict(td or {})},
        "non_uk": {"location": {}, "td": {}},
    }


def _patch_factor_samples(monkeypatch, samples):
    monkeypatch.setattr(
        rtr,
        "_collect_monthly_energy_factor_samples",
        lambda con, job_id, resolution=None: samples,
    )
    monkeypatch.setattr(rtr, "get_scope_primary_datasets", lambda job_id: {})


# ── _blend_monthly_factor ────────────────────────────────────────────────


def test_blend_weights_factors_by_month_kwh():
    # 8 months on one factor, 4 on another, but every kWh drawn in the 4.
    factors = {**{m: FACTOR_2025 for m in range(5, 13)}, **{m: FACTOR_2026 for m in range(1, 5)}}
    weights = {m: 1000.0 for m in range(1, 5)}

    assert rtr._blend_monthly_factor(factors, weights) == pytest.approx(FACTOR_2026)


def test_blend_falls_back_to_plain_mean_without_weights():
    factors = {**{m: FACTOR_2025 for m in range(5, 13)}, **{m: FACTOR_2026 for m in range(1, 5)}}
    expected = (8 * FACTOR_2025 + 4 * FACTOR_2026) / 12

    assert rtr._blend_monthly_factor(factors, None) == pytest.approx(expected)
    assert rtr._blend_monthly_factor(factors, {m: 0.0 for m in range(1, 13)}) == pytest.approx(expected)


def test_blend_returns_none_without_factors():
    assert rtr._blend_monthly_factor({}, {1: 100.0}) is None


# ── _allocate_quantity_to_months ─────────────────────────────────────────


def test_allocation_follows_the_rows_monthly_split():
    row = {"month_9": 100.0, "month_10": 300.0}

    split = rtr._allocate_quantity_to_months(row, 800.0, [1, 2, 3])

    # Rescaled to the effective quantity, keeping the 1:3 shape.
    assert split == {9: pytest.approx(200.0), 10: pytest.approx(600.0)}


def test_allocation_spreads_annual_only_rows_over_the_period():
    split = rtr._allocate_quantity_to_months({"qty": 1200.0}, 1200.0, [5, 6, 7, 8])

    assert split == {5: 300.0, 6: 300.0, 7: 300.0, 8: 300.0}


# ── T&D exclusion ────────────────────────────────────────────────────────


def test_energy_emissions_exclude_td_from_both_methods(monkeypatch):
    _patch_factor_samples(
        monkeypatch,
        _uk_samples({m: FACTOR_2025 for m in range(1, 13)}, {m: TD_2025 for m in range(1, 13)}),
    )

    meta = {
        "energy_consumption_uk_kwh": 10000.0,
        "energy_consumption_non_uk_kwh": 0.0,
        "renewable_energy_kwh": 0.0,
    }
    _, factor_details = rtr._sync_energy_emissions_from_kwh(None, 1, meta, derived={}, resolution={})

    # Generation only: 10,000 x 0.177 / 1000. Adding T&D would give 1.9553.
    assert meta["energy_emissions_tco2e"] == pytest.approx(1.77)
    assert meta["energy_emissions_market_tco2e"] == pytest.approx(1.77)
    # The T&D factor is still disclosed, just not applied.
    assert factor_details["uk_transmission_distribution_kg_per_kwh"] == pytest.approx(TD_2025)
    assert factor_details["transmission_distribution_included"] is False


def test_renewable_kwh_is_grid_rated_for_location_but_zero_rated_for_market(monkeypatch):
    _patch_factor_samples(monkeypatch, _uk_samples({m: FACTOR_2025 for m in range(1, 13)}))

    meta = {
        "energy_consumption_uk_kwh": 10000.0,
        "energy_consumption_non_uk_kwh": 0.0,
        "renewable_energy_kwh": 7500.0,
    }
    rtr._sync_energy_emissions_from_kwh(None, 1, meta, derived={}, resolution={})

    assert meta["energy_emissions_tco2e"] == pytest.approx(1.77)
    assert meta["energy_emissions_market_tco2e"] == pytest.approx(2500 * FACTOR_2025 / 1000)


# ── Reconciliation with Data Entry ───────────────────────────────────────


def test_market_based_matches_data_entry_when_grid_draw_sits_in_one_factor_year(monkeypatch):
    """Job 699's shape: a May-Apr period spanning two factor years, 18,785.5 kWh
    of green tariff across all 12 months and 2,353.5 kWh of grid draw confined
    to four months that all fall in the 2025 dataset.

    Data Entry prices that grid row at a flat 0.177, so the market-based box has
    to land on the same 0.4166 -- it must not be diluted by 2026 factors from
    months where only renewable kWh was drawn.
    """
    _patch_factor_samples(
        monkeypatch,
        _uk_samples(
            {**{m: FACTOR_2025 for m in range(5, 13)}, **{m: FACTOR_2026 for m in range(1, 5)}}
        ),
    )

    renewable_per_month = 18785.5 / 12
    grid_per_month = 2353.5 / 4  # Sep-Dec 2025
    uk_by_month = {
        m: renewable_per_month + (grid_per_month if m in (9, 10, 11, 12) else 0.0)
        for m in range(1, 13)
    }
    derived = {
        "uk_kwh_by_month": uk_by_month,
        "uk_grid_kwh_by_month": {m: (grid_per_month if m in (9, 10, 11, 12) else 0.0) for m in range(1, 13)},
        "non_uk_kwh_by_month": {},
        "non_uk_grid_kwh_by_month": {},
    }
    meta = {
        "energy_consumption_uk_kwh": 21139.0,
        "energy_consumption_non_uk_kwh": 0.0,
        "renewable_energy_kwh": 18785.5,
    }

    _, factor_details = rtr._sync_energy_emissions_from_kwh(
        None, 699, meta, derived=derived, resolution={}
    )

    assert factor_details["uk_market_based_kg_per_kwh"] == pytest.approx(FACTOR_2025)
    assert factor_details["factor_blend_basis"] == "kwh_weighted"
    assert meta["energy_emissions_market_tco2e"] == pytest.approx(0.4166, abs=5e-5)

    # Location-based prices all 21,139 kWh at the kWh-weighted grid average,
    # which still spans both factor years because renewable kWh runs all year.
    expected_location_factor = sum(
        uk_by_month[m] * (FACTOR_2025 if m >= 5 else FACTOR_2026) for m in range(1, 13)
    ) / 21139.0
    assert factor_details["uk_location_based_kg_per_kwh"] == pytest.approx(
        expected_location_factor, abs=5e-9
    )
    assert meta["energy_emissions_tco2e"] == pytest.approx(
        21139.0 * expected_location_factor / 1000, abs=5e-5
    )
