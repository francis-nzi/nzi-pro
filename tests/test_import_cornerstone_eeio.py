from __future__ import annotations

from datetime import date
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from utils import import_cornerstone_eeio as eeio


def _data(**overrides) -> eeio.WorkbookData:
    data = eeio.WorkbookData(
        version="2026-rc",
        doi="https://doi.org/x",
        file_name="cornerstone.xlsx",
        years=[2024, 2025, 2026],
        sectors={"484000": "Truck transport", "541100": "Legal services", "S00402": "Used and secondhand goods"},
        locations={
            "DEU": {"name": "Germany", "region": "Western Europe", "has_efs": "Yes"},
            "GBR": {"name": "United Kingdom", "region": "Northern Europe", "has_efs": "Yes"},
            "AND": {"name": "Andorra", "region": "Southern Europe", "has_efs": "No"},
        },
        fx={
            "DEU": {2024: ("EUR", 0.9), 2025: ("EUR", 0.8), 2026: ("EUR", 0.5)},
            "GBR": {2024: ("GBP", 0.8), 2025: ("GBP", 0.76), 2026: ("GBP", 0.74)},
        },
        factors={
            yr: {
                (iso, code): value
                for iso in ("DEU", "GBR")
                for code, value in (("484000", 0.4), ("541100", 0.03), ("S00402", 0.0))
            }
            for yr in (2024, 2025, 2026)
        },
    )
    for key, value in overrides.items():
        setattr(data, key, value)
    return data


def test_countries_skip_uk_and_those_without_own_factors():
    assert eeio.countries_to_import(_data(), {"GBR", "ARE"}) == ["DEU"]


def test_factor_is_converted_from_usd_with_that_years_rate():
    rows = eeio.factor_rows(_data(), "DEU", 2026, dataset_id=901)
    truck = next(r for r in rows if r[3] == "CEDA-DEU-484000")
    # 0.4 kgCO2e/USD at 0.5 EUR per USD -> 0.8 kgCO2e/EUR
    assert truck[13] == 0.4 / 0.5
    assert (truck[0], truck[2], truck[4], truck[11], truck[16]) == (901, 2026, "Scope 3", "EUR", "EUR")


def test_ids_carry_country_but_not_year():
    ids_2024 = {r[3] for r in eeio.factor_rows(_data(), "DEU", 2024, 1)}
    ids_2026 = {r[3] for r in eeio.factor_rows(_data(), "DEU", 2026, 2)}
    assert ids_2024 == ids_2026 == {"CEDA-DEU-484000", "CEDA-DEU-541100", "CEDA-DEU-S00402"}


def test_sectors_get_ghg_protocol_categories():
    assert eeio.ghg_category("484000") == "Upstream Transportation and Distribution"
    assert eeio.ghg_category("481000") == "Business Travel"
    assert eeio.ghg_category("562212") == "Waste Generated in Operations"
    assert eeio.ghg_category("562910") == "Purchased Goods and Services"
    assert eeio.ghg_category("541100") == "Purchased Goods and Services"


def test_zero_factors_are_labelled():
    rows = eeio.factor_rows(_data(), "DEU", 2025, 1)
    used = next(r for r in rows if r[3] == "CEDA-DEU-S00402")
    assert used[10].endswith("(zero in source data)")


def test_first_and_last_years_cover_earlier_and_later_periods():
    years = [2024, 2025, 2026]
    assert eeio.dataset_window(2024, years) == (eeio.OPEN_START, date(2024, 12, 31))
    assert eeio.dataset_window(2025, years) == (date(2025, 1, 1), date(2025, 12, 31))
    assert eeio.dataset_window(2026, years) == (date(2026, 1, 1), eeio.OPEN_END)


def test_validation_reports_missing_sector_and_exchange_rates():
    data = _data()
    del data.factors[2025][("DEU", "541100")]
    data.fx["DEU"] = {}
    errors = eeio.validate(data, ["DEU"])
    assert any("2025PUR DEU" in e and "541100" in e for e in errors)
    assert any("DEU: no exchange rate for any year" in e for e in errors)


def test_currency_can_change_between_years():
    """Bulgaria: BGN for 2024-2025, EUR from 2026."""
    data = _data()
    data.fx["DEU"] = {2024: ("BGN", 1.8), 2025: ("BGN", 1.75), 2026: ("EUR", 0.86)}
    assert eeio.dataset_meta(data, "DEU", 2025)["currency"] == "BGN"
    assert eeio.dataset_meta(data, "DEU", 2026)["currency"] == "EUR"
    rows_2025 = eeio.factor_rows(data, "DEU", 2025, 1)
    assert {r[11] for r in rows_2025} == {"BGN"}
    assert next(r for r in rows_2025 if r[3] == "CEDA-DEU-484000")[13] == 0.4 / 1.75


def test_country_missing_some_rates_uses_its_nearest_year_for_all_periods():
    """Sierra Leone: only a 2026 rate, so its 2026 dataset covers every period."""
    data = _data()
    data.fx["DEU"] = {2026: ("SLE", 24.4)}
    assert eeio.validate(data, ["DEU"]) == []
    assert data.country_years("DEU") == [2026]
    assert eeio.missing_years(data, ["DEU"]) == {"DEU": [2024, 2025]}
    meta = eeio.dataset_meta(data, "DEU", 2026)
    assert (meta["valid_from"], meta["valid_to"]) == (eeio.OPEN_START, eeio.OPEN_END)


def test_validation_passes_clean_data():
    assert eeio.validate(_data(), ["DEU"]) == []
