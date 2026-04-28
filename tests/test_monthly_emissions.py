from __future__ import annotations

from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.monthly_emissions import JobMonthlyEmissionsResolver


def _resolver_stub() -> JobMonthlyEmissionsResolver:
    resolver = JobMonthlyEmissionsResolver.__new__(JobMonthlyEmissionsResolver)
    resolver.dataset_name_by_id = {}
    resolver.month_label_map = {}
    resolver.month_year_map = {}
    resolver._lookup_factor = lambda *args, **kwargs: None
    resolver._resolve_custom_factor_for_month = lambda *args, **kwargs: None
    resolver._resolve_standard_factor_for_month = lambda *args, **kwargs: None
    return resolver


def test_row_metrics_prefers_lookup_kg_unit_for_spend_rows():
    resolver = _resolver_stub()

    row = {
        "scope": "Scope 3",
        "qty": 10839,
        "uom": "GBP",
        "factor": 1.35167,
        "ghg_unit": "tCO2e",
        "lookup_factor": 1.35167,
        "lookup_ghg_unit": "kg CO2e",
        "apply_pct": 100,
        "notes": None,
        "dataset_id": 123,
        "original_id": "SPEND-1",
    }

    metrics = resolver.row_metrics(row)

    assert metrics["calc_tco2e"] == pytest.approx(14.65075113, rel=1e-9)
    assert metrics["tco2e_before_apply"] == pytest.approx(14.65075113, rel=1e-9)
    assert metrics["unit_warning"] is not None
    assert "Stored unit" in metrics["unit_warning"]


def test_row_metrics_keeps_tco2e_storage_rows_unchanged():
    resolver = _resolver_stub()

    row = {
        "scope": "Scope 3",
        "qty": 14650.7815,
        "uom": "tCO2e",
        "factor": 1.0,
        "ghg_unit": "tCO2e",
        "lookup_factor": 1.0,
        "lookup_ghg_unit": "kg CO2e",
        "apply_pct": 100,
        "notes": "storage_reason=legacy_fallback",
        "dataset_id": 123,
        "original_id": "SPEND-2",
    }

    metrics = resolver.row_metrics(row)

    assert metrics["uses_emissions_fallback"] is True
    assert metrics["calc_tco2e"] == pytest.approx(14650.7815, rel=1e-9)
    assert metrics["tco2e_before_apply"] == pytest.approx(14650.7815, rel=1e-9)
    assert metrics["unit_warning"] is None
