from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.factor_label_normalize import titlecase_report_label


def test_already_clean_label_unchanged():
    assert titlecase_report_label("Business Travel Medium Car Petrol") == "Business Travel Medium Car Petrol"


def test_stray_dash_and_mixed_case():
    assert (
        titlecase_report_label("Employee commuting- land - Large car - Petrol")
        == "Employee Commuting- Land - Large Car - Petrol"
    )


def test_hgv_acronym_preserved():
    assert (
        titlecase_report_label("Freighting goods - HGV (all diesel) - All artics - Average laden")
        == "Freighting Goods - HGV (All Diesel) - All Artics - Average Laden"
    )


def test_dwt_unit_preserved_lowercase():
    assert (
        titlecase_report_label("Freighting goods - Sea tanker - Crude tanker - 80,000-119,999 dwt")
        == "Freighting Goods - Sea Tanker - Crude Tanker - 80,000-119,999 dwt"
    )


def test_lng_and_m3_preserved():
    assert (
        titlecase_report_label("Freighting goods - Sea tanker - LNG tanker - 0-199,999 m3")
        == "Freighting Goods - Sea Tanker - LNG Tanker - 0-199,999 m3"
    )


def test_numeric_range_with_percent_untouched():
    assert (
        titlecase_report_label("Freighting goods - HGV refrigerated (all diesel) - Rigid (>7.5 tonnes-17 tonnes) - 100% Laden")
        == "Freighting Goods - HGV Refrigerated (All Diesel) - Rigid (>7.5 Tonnes-17 Tonnes) - 100% Laden"
    )


def test_uk_acronym_preserved_with_colon():
    assert (
        titlecase_report_label("UK Renewable Electricity - Electricity generated - Renewable Electricity: Grid")
        == "UK Renewable Electricity - Electricity Generated - Renewable Electricity: Grid"
    )


def test_compound_word_hyphen_and_small_word_in():
    # "by" is a small connector word, stays lowercase mid-label (not the
    # first word of the whole string) -- standard title-case convention.
    assert (
        titlecase_report_label("Passenger vehicles - Cars (by size) - Medium car - Plug-in Hybrid Electric Vehicle")
        == "Passenger Vehicles - Cars (by Size) - Medium Car - Plug-in Hybrid Electric Vehicle"
    )


def test_percent_and_parens_untouched():
    assert (
        titlecase_report_label("Fuels - Liquid fuels - Diesel (100% mineral diesel)")
        == "Fuels - Liquid Fuels - Diesel (100% Mineral Diesel)"
    )


def test_roman_numeral_class_and_to_lowercase():
    # "to" is a small connector word, stays lowercase mid-label.
    assert (
        titlecase_report_label("Freighting goods - Vans - Class II (1.305 to 1.74 tonnes) - Petrol")
        == "Freighting Goods - Vans - Class II (1.305 to 1.74 Tonnes) - Petrol"
    )


def test_co2e_digit_glued_acronym():
    assert titlecase_report_label("co2e emissions factor") == "CO2e Emissions Factor"


def test_kwh_mixed_case_unit():
    assert titlecase_report_label("grid electricity - kwh basis") == "Grid Electricity - kWh Basis"


def test_all_is_capitalized_not_lowercased():
    assert titlecase_report_label("Freighting goods - HGV (all diesel) - All HGVs - 0% Laden") == (
        "Freighting Goods - HGV (All Diesel) - All HGVs - 0% Laden"
    )


def test_empty_and_none_pass_through():
    assert titlecase_report_label("") == ""
    assert titlecase_report_label(None) == ""


def test_tonne_abbreviation_stays_lowercase():
    assert (
        titlecase_report_label("Delivery vehicles - HGV (all diesel) - Articulated (>33t) - Average laden")
        == "Delivery Vehicles - HGV (All Diesel) - Articulated (>33t) - Average Laden"
    )
    assert (
        titlecase_report_label("Freighting goods - HGV refrigerated (all diesel) - Articulated (>3.5 - 33t) - 100% Laden")
        == "Freighting Goods - HGV Refrigerated (All Diesel) - Articulated (>3.5 - 33t) - 100% Laden"
    )


def test_kg_unit_preserved_lowercase():
    # "with" is mid-label here (not the first word of the whole string), so
    # it stays lowercase along with the "kg"/"m3" units and "per"/"of".
    assert (
        titlecase_report_label("Concrete - average UK cement replacement rate - with total cementitious content of 180 kg per m3 of concrete")
        == "Concrete - Average UK Cement Replacement Rate - with Total Cementitious Content of 180 kg per m3 of Concrete"
    )


def test_from_stays_lowercase_across_slash():
    assert (
        titlecase_report_label("Business travel- air - Flights - Domestic, to/from UK - Average passenger")
        == "Business Travel- Air - Flights - Domestic, to/from UK - Average Passenger"
    )


def test_idempotent_on_already_normalized_input():
    once = titlecase_report_label("Freighting goods - Sea tanker - LNG tanker - 0-199,999 m3")
    twice = titlecase_report_label(once)
    assert once == twice
