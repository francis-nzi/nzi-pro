from services.business_travel_upload_template import _load_reference_rows


def test_business_travel_reference_rows_are_category_pure():
    factors = _load_reference_rows()

    assert factors, "Expected business travel reference rows to be available"
    assert all(str(item.get("category") or "").strip().lower() == "business travel" for item in factors)

    original_ids = {str(item.get("original_id") or "").strip() for item in factors}
    assert "SPEND-PROD-2022-4-1-1" not in original_ids
    assert "SPEND-PROD-2022-7-1-4" not in original_ids

