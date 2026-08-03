from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.factor_label_normalize import split_top_level_segments, titlecase_report_label


def test_already_clean_single_segment_label_unchanged():
    assert titlecase_report_label("Business Travel Medium Car Petrol") == "Business Travel Medium Car Petrol"


def test_land_segment_dropped_and_colon_inserted():
    assert (
        titlecase_report_label("Business travel- land - Medium car - Diesel")
        == "Business Travel: Medium Car Diesel"
    )
    assert (
        titlecase_report_label("Employee commuting- land - Large car - Petrol")
        == "Employee Commuting: Large Car Petrol"
    )


def test_air_and_sea_segments_kept_not_treated_as_redundant():
    assert (
        titlecase_report_label("Business travel- air - Flights - Domestic, to/from UK - Average passenger")
        == "Business Travel: Air Flights Domestic, to/from UK Average Passenger"
    )


def test_hgv_acronym_preserved_with_colon_restructure():
    assert (
        titlecase_report_label("Freighting goods - HGV (all diesel) - All artics - Average laden")
        == "Freighting Goods: HGV (All Diesel) All Artics Average Laden"
    )


def test_dwt_and_numeric_range_outside_parens_untouched():
    assert (
        titlecase_report_label("Freighting goods - Sea tanker - Crude tanker - 80,000-119,999 dwt")
        == "Freighting Goods: Sea Tanker Crude Tanker 80,000-119,999 dwt"
    )


def test_paren_protected_numeric_range_survives_intact():
    # The " - " inside "(>3.5 - 33t)" must NOT be treated as a segment
    # separator -- confirmed live, 2,524 rows have this exact shape.
    assert (
        titlecase_report_label("Delivery vehicles - HGV (all diesel) - Articulated (>3.5 - 33t) - 0% Laden")
        == "Delivery Vehicles: HGV (All Diesel) Articulated (>3.5 - 33t) 0% Laden"
    )
    assert (
        titlecase_report_label("Freighting goods - HGV refrigerated (all diesel) - Rigid (>7.5 tonnes-17 tonnes) - 100% Laden")
        == "Freighting Goods: HGV Refrigerated (All Diesel) Rigid (>7.5 Tonnes-17 Tonnes) 100% Laden"
    )


def test_consecutive_duplicate_segments_collapsed_to_single_segment():
    assert titlecase_report_label("Water supply - Water supply - Water supply") == "Water Supply"


def test_consecutive_duplicate_segment_collapsed_leaving_remainder():
    assert titlecase_report_label("Hotel stay - Hotel stay - Egypt") == "Hotel Stay: Egypt"


def test_consecutive_duplicate_segment_collapsed_different_words_after():
    assert titlecase_report_label("Bioenergy - Biogas - Biogas") == "Bioenergy: Biogas"


def test_repeated_wtt_marker_collapsed_to_first_occurrence():
    # "WTT" is a genuine two-tier prefix marker in the source data, not
    # duplicate information, but it's written twice per label -- confirmed
    # live, never 3+ times. Collapsing it to the first occurrence also
    # brings the (also-repeated) "heat and steam" segment into adjacency,
    # which the ordinary adjacent-dedup pass then collapses too.
    assert (
        titlecase_report_label("WTT- heat and steam - WTT- heat and steam - Onsite heat and steam - kWh")
        == "WTT: Heat and Steam Onsite Heat and Steam kWh"
    )


def test_repeated_wtt_marker_with_non_duplicate_segments_between():
    assert (
        titlecase_report_label("WTT- delivery vehs & freight - WTT- HGV refrigerated (all diesel) - Rigid (>3.5 - 7.5 tonnes) - 0% Laden")
        == "WTT: Delivery Vehs & Freight HGV Refrigerated (All Diesel) Rigid (>3.5 - 7.5 Tonnes) 0% Laden"
    )


def test_repeated_wtt_marker_with_mode_qualifier_segment_between():
    # "air" sits between the two WTT markers here -- must survive (it's not
    # in _REDUNDANT_SEGMENTS) while both WTT occurrences still collapse to one.
    assert (
        titlecase_report_label("WTT- business travel- air - WTT- flights - Long-haul, to/from UK - Economy class")
        == "WTT: Business Travel Air Flights Long-Haul, to/from UK Economy Class"
    )


def test_repeated_wtt_marker_with_land_segment_between_both_removed():
    assert (
        titlecase_report_label("WTT- pass vehs & travel- land - WTT- cars (by size) - Small car - Petrol")
        == "WTT: Pass Vehs & Travel Cars (by Size) Small Car Petrol"
    )


def test_single_wtt_marker_left_alone():
    # Only one WTT segment here -- nothing to collapse, this is already fine.
    assert (
        titlecase_report_label("WTT- fuels - Liquid fuels - Marine fuel oil")
        == "WTT: Fuels Liquid Fuels Marine Fuel Oil"
    )


def test_compound_word_hyphen_and_small_word_by():
    assert (
        titlecase_report_label("Passenger vehicles - Cars (by size) - Medium car - Plug-in Hybrid Electric Vehicle")
        == "Passenger Vehicles: Cars (by Size) Medium Car Plug-in Hybrid Electric Vehicle"
    )


def test_roman_numeral_class_and_to_lowercase():
    assert (
        titlecase_report_label("Freighting goods - Vans - Class II (1.305 to 1.74 tonnes) - Petrol")
        == "Freighting Goods: Vans Class II (1.305 to 1.74 Tonnes) Petrol"
    )


def test_co2e_digit_glued_acronym():
    assert titlecase_report_label("co2e emissions factor") == "CO2e Emissions Factor"


def test_kwh_mixed_case_unit():
    assert titlecase_report_label("grid electricity - kwh basis") == "Grid Electricity: kWh Basis"


def test_all_is_capitalized_not_lowercased():
    assert (
        titlecase_report_label("Freighting goods - HGV (all diesel) - All HGVs - 0% Laden")
        == "Freighting Goods: HGV (All Diesel) All HGVs 0% Laden"
    )


def test_tonne_abbreviation_stays_lowercase():
    assert (
        titlecase_report_label("Delivery vehicles - HGV (all diesel) - Articulated (>33t) - Average laden")
        == "Delivery Vehicles: HGV (All Diesel) Articulated (>33t) Average Laden"
    )


def test_kg_unit_preserved_lowercase():
    assert (
        titlecase_report_label("Concrete - average UK cement replacement rate - with total cementitious content of 180 kg per m3 of concrete")
        == "Concrete: Average UK Cement Replacement Rate with Total Cementitious Content of 180 kg per m3 of Concrete"
    )


def test_from_stays_lowercase_across_slash():
    assert (
        titlecase_report_label("Business travel- air - Flights - Domestic, to/from UK - Average passenger")
        == "Business Travel: Air Flights Domestic, to/from UK Average Passenger"
    )


def test_empty_and_none_pass_through():
    assert titlecase_report_label("") == ""
    assert titlecase_report_label(None) == ""


def test_idempotent_on_already_normalized_input():
    once = titlecase_report_label("Freighting goods - Sea tanker - LNG tanker - 0-199,999 m3")
    twice = titlecase_report_label(once)
    assert once == twice


def test_idempotent_on_deduplicated_input():
    once = titlecase_report_label("Water supply - Water supply - Water supply")
    twice = titlecase_report_label(once)
    assert once == twice


# --- split_top_level_segments (the paren-aware splitter directly) ---

def test_split_ignores_dash_inside_parens():
    assert split_top_level_segments("Rigid (>3.5 - 33t) - Average laden") == [
        "Rigid (>3.5 - 33t)",
        "Average laden",
    ]


def test_split_handles_tight_hyphen_no_spaces():
    assert split_top_level_segments("80,000-119,999 dwt") == ["80,000-119,999 dwt"]


def test_split_handles_word_dash_space_form():
    assert split_top_level_segments("Business travel- land - Medium car") == [
        "Business travel",
        "land",
        "Medium car",
    ]


def test_split_single_segment_no_dash():
    assert split_top_level_segments("Business Travel Medium Car Petrol") == ["Business Travel Medium Car Petrol"]
