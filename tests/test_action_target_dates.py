import sys
from pathlib import Path
import pytest
from fastapi import HTTPException
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.report_actions import normalize_action_target_date

@pytest.mark.parametrize("value", ["20230-12-31", "0000-01-01", "2030-02-30", "2030-1-1", "infinity", "invalid"])
def test_invalid_target_dates_are_rejected(value):
    with pytest.raises(HTTPException) as exc:
        normalize_action_target_date(value)
    assert exc.value.status_code == 400

@pytest.mark.parametrize("value,expected", [("2030-12-31", "2030-12-31"), ("2024-02-29", "2024-02-29"), (None, None), ("", None)])
def test_valid_dates_and_clearing_are_supported(value, expected):
    assert normalize_action_target_date(value) == expected
