from __future__ import annotations

from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api import spend_data_routes as sdr


@pytest.fixture
def factors(monkeypatch):
    """Map factor db_id -> dataset original_id, and count resolutions."""
    table: dict[int, str] = {}
    calls: list[int] = []

    def fake_factor_by_id(con, factor_db_id):
        calls.append(int(factor_db_id))
        oid = table.get(int(factor_db_id))
        return None if oid is None else {"db_id": int(factor_db_id), "original_id": oid}

    monkeypatch.setattr(sdr, "_factor_by_id", fake_factor_by_id)
    return type("F", (), {"table": table, "calls": calls})()


def test_identity_prefers_the_id_stored_on_the_spend_entry(factors):
    assert sdr._spend_factor_original_id(None, "SPEND-SIC-50-d", 102806) == "SPEND-SIC-50-d"
    # No factor lookup needed when the entry already carries the id.
    assert factors.calls == []


def test_identity_falls_back_to_resolving_the_factor(factors):
    factors.table[102806] = "SPEND-SIC-50-d"

    assert sdr._spend_factor_original_id(None, None, 102806) == "SPEND-SIC-50-d"
    assert sdr._spend_factor_original_id(None, "   ", 102806) == "SPEND-SIC-50-d"


def test_identity_is_empty_when_the_factor_cannot_be_resolved(factors):
    """Better to skip the row than invent an id that matches nothing."""
    assert sdr._spend_factor_original_id(None, None, 999999) == ""


def test_same_factor_in_two_dataset_years_shares_one_identity(factors):
    """The bug behind job 663: SPEND-SIC-50-d is db_id 102807 in the 2025
    dataset and 102806 in the 2026 one. Keyed on db_id those looked like two
    different factors and produced two rows for the same spend."""
    factors.table.update({102806: "SPEND-SIC-50-d", 102807: "SPEND-SIC-50-d"})

    id_2026 = sdr._spend_factor_original_id(None, None, 102806)
    id_2025 = sdr._spend_factor_original_id(None, None, 102807)

    assert id_2026 == id_2025 == "SPEND-SIC-50-d"


def test_identity_never_uses_the_factor_database_id(factors):
    factors.table[102806] = "SPEND-SIC-50-d"

    resolved = sdr._spend_factor_original_id(None, None, 102806)

    assert "102806" not in resolved
    assert not resolved.startswith("SPEND-F")
