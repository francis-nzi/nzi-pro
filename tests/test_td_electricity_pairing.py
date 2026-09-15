from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.td_electricity_pairing import (  # noqa: E402
    detect_electricity_pair_kind,
    find_td_pair_factor,
)


class _FactorConn:
    """Fake conn returning canned factor_lookup rows, and recording the SQL so
    a test can assert on what the query does and doesn't filter by."""

    def __init__(self, rows):
        self._rows = rows
        self.sql = ""
        self.params = None

    def execute(self, sql, params=None):
        self.sql = sql
        self.params = params
        return self

    def fetchall(self):
        return self._rows


def _spend_td_row(scope: str):
    # db_id, original_id, factor, ghg_unit, uom, report_label,
    # category, level_1, level_2, level_3, level_4, column_text
    return (
        901, "SPEND-SIC-35.1", 0.0821, "kgCO2e", "GBP", "Electricity T&D",
        "Energy", "Electricity, transmission and distribution", None, None, None, None,
    )


def test_spend_pair_is_found_even_when_the_dataset_tags_it_scope_2() -> None:
    # T&D is Scope 3 Category 3 and the 2019-2024 datasets say so, but the 2025
    # and 2026 spend files label this factor 'Scope 2'. Filtering on Scope 3
    # silently stopped spend electricity pairing on the current datasets.
    conn = _FactorConn([_spend_td_row("Scope 2")])

    pair = find_td_pair_factor(conn, dataset_id=69, pair_kind="spend", uom="GBP")

    assert pair is not None
    assert pair["original_id"] == "SPEND-SIC-35.1"
    assert "scope" not in conn.sql.lower().split("where")[1].split("order by")[0], \
        "the spend lookup must not filter on scope"


def test_spend_pair_still_refuses_to_guess_between_two_candidates() -> None:
    conn = _FactorConn([_spend_td_row("Scope 3"), _spend_td_row("Scope 2")])

    assert find_td_pair_factor(conn, dataset_id=69, pair_kind="spend", uom="GBP") is None


def test_spend_pair_returns_none_when_the_dataset_has_no_td_factor() -> None:
    conn = _FactorConn([])

    assert find_td_pair_factor(conn, dataset_id=69, pair_kind="spend", uom="GBP") is None


def test_detect_recognises_electricity_spend_and_kwh() -> None:
    assert detect_electricity_pair_kind(level_1="Electricity", level_2=None, uom="GBP") == "spend"
    assert detect_electricity_pair_kind(
        level_1="UK electricity", level_2="Electricity generated", uom="kWh"
    ) == "kwh"


def test_detect_ignores_self_generated_renewables_and_unrelated_rows() -> None:
    # On-site generation never touches the public grid, so it has no T&D pair.
    assert detect_electricity_pair_kind(
        level_1="UK Renewable Electricity", level_2="Electricity self generated", uom="kWh"
    ) is None
    assert detect_electricity_pair_kind(
        level_1="Postal and courier services", level_2=None, uom="GBP"
    ) is None
