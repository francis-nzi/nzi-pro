from __future__ import annotations

from pathlib import Path
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api import client_files_routes as cfr


class _LookupCon:
    """Answers the active client file type names; ignores the table bootstrap."""

    def __init__(self, names):
        self.names = names

    def execute(self, sql, params=None):
        names = self.names
        return type("R", (), {"fetchall": staticmethod(lambda: [(n,) for n in names])})()


ACTIVE = ["Contract", "General", "Report", "Time Report"]


def test_names_from_the_admin_lookup_are_accepted():
    assert cfr._resolve_client_file_type(_LookupCon(ACTIVE), "Contract") == "Contract"


def test_legacy_snake_case_keys_resolve_to_the_lookup_name():
    """Rows and callers from before the lookup used keys like "time_report"."""
    assert cfr._resolve_client_file_type(_LookupCon(ACTIVE), "time_report") == "Time Report"
    assert cfr._resolve_client_file_type(_LookupCon(ACTIVE), "general") == "General"


def test_blank_type_falls_back_to_general():
    assert cfr._resolve_client_file_type(_LookupCon(ACTIVE), "") == "General"


def test_archived_or_unknown_type_is_rejected():
    with pytest.raises(HTTPException) as exc:
        cfr._resolve_client_file_type(_LookupCon(ACTIVE), "Invoice")
    assert exc.value.status_code == 400
