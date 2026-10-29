from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api import report_template_routes as rtr

CLIENT = {
    "company_number": "09876543",
    "registered_address": "1 New Street, Lowestoft, NR32 1AA",
}


def test_stale_client_fields_follow_the_client():
    """Brock FMD, job 786: the report still printed the old Kessingland address
    because it was copied once and never refreshed."""
    meta = {
        "company_number": "01234567",
        "registered_address": "Old Farm, Kessingland, NR33 7AA",
    }

    assert rtr._sync_client_fields_from_client(meta, CLIENT, set()) is True
    assert meta == CLIENT


def test_hand_edited_client_field_is_left_alone():
    meta = {
        "company_number": "01234567",
        "registered_address": "Trading address for this report",
    }

    assert rtr._sync_client_fields_from_client(meta, CLIENT, {"registered_address"}) is True
    assert meta["registered_address"] == "Trading address for this report"
    assert meta["company_number"] == "09876543"


def test_blank_client_value_does_not_wipe_the_report():
    meta = dict(CLIENT)

    assert rtr._sync_client_fields_from_client(meta, {"registered_address": None}, set()) is False
    assert meta == CLIENT


def test_up_to_date_fields_report_no_change():
    meta = dict(CLIENT)

    assert rtr._sync_client_fields_from_client(meta, CLIENT, set()) is False
