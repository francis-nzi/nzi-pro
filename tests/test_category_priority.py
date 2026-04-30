from api.client_dashboard_routes import _dataset_category_label as dashboard_category_label
from api.client_reporting_routes import _dataset_category_label as reporting_category_label
from api.job_data_output_routes import _dataset_category_label as output_category_label
from api.job_report_routes import _dataset_category_label as report_category_label


def _row(**kwargs):
    return kwargs


def test_dataset_category_prefers_top_level_category_fields():
    row = _row(
        category="Uncategorized",
        dataset_category=None,
        lookup_category="Purchased Goods",
        lookup_level_1="Business Travel",
        level_1="Business Travel",
        level_2="Air transport services",
    )

    assert dashboard_category_label(row) == "Business Travel"
    assert reporting_category_label(row) == "Business Travel"
    assert output_category_label(row) == "Business Travel"
    assert report_category_label(row) == "Business Travel"


def test_dataset_category_uses_dataset_category_when_present():
    row = _row(
        category="Purchased Goods",
        dataset_category="Energy",
        lookup_category="Purchased Goods",
        lookup_level_1="Business Travel",
        level_1="Business Travel",
        level_2="Air transport services",
    )

    assert dashboard_category_label(row) == "Energy"
    assert reporting_category_label(row) == "Energy"
    assert output_category_label(row) == "Energy"
    assert report_category_label(row) == "Energy"
