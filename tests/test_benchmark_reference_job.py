"""A job that IS the client's baseline has nothing to compare against.

Reported 2026-09-10 on J000699 (Silent Sounds), whose baseline was moved to its
own reporting year: the report still rendered a "BL 2025-2026" column, labelled
with the current period but populated from the previous year's job, because
every fallback in _resolve_benchmark_reference_job excludes the current job and
then reaches for the latest prior period.
"""
from __future__ import annotations

from datetime import date
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.job_report_routes as job_report_routes

CURRENT_START = date(2025, 5, 1)
CURRENT_END = date(2026, 4, 30)
PRIOR_START = date(2024, 5, 1)
PRIOR_END = date(2025, 4, 30)


class _Conn:
    """First execute() answers the current-job SELECT; later ones answer the
    fallback lookups with whatever prior job id the test supplies."""

    def __init__(self, current_row, fallback_job_id=437):
        self._current = current_row
        self._fallback = fallback_job_id
        self.queries = 0

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, sql, params=None):
        self.queries += 1
        self._first = self.queries == 1
        return self

    def fetchone(self):
        if self._first:
            return self._current
        return (self._fallback,) if self._fallback is not None else None


def _current_row(bm_start, bm_end):
    # job_id, client_db_id, reporting_year, period_end, period_start, bm_start, bm_end
    return (699, 248, 2026, CURRENT_END, CURRENT_START, bm_start, bm_end)


def test_job_that_is_its_own_baseline_has_no_comparison_job(monkeypatch):
    conn = _Conn(_current_row(CURRENT_START, CURRENT_END))
    monkeypatch.setattr(job_report_routes, "get_conn", lambda: conn)

    assert job_report_routes._resolve_benchmark_reference_job(699, None) is None
    # It must not even reach the prior-period fallback.
    assert conn.queries == 1


def test_baseline_in_an_earlier_period_still_resolves_a_comparison_job(monkeypatch):
    conn = _Conn(_current_row(PRIOR_START, PRIOR_END))
    monkeypatch.setattr(job_report_routes, "get_conn", lambda: conn)

    assert job_report_routes._resolve_benchmark_reference_job(699, None) == 437


def test_client_with_no_baseline_period_keeps_the_existing_fallbacks(monkeypatch):
    conn = _Conn(_current_row(None, None))
    monkeypatch.setattr(job_report_routes, "get_conn", lambda: conn)

    assert job_report_routes._resolve_benchmark_reference_job(699, None) == 437


@pytest.mark.parametrize(
    "bm_start,bm_end",
    [(CURRENT_START, None), (None, CURRENT_END)],
)
def test_a_half_configured_baseline_period_is_not_treated_as_self(monkeypatch, bm_start, bm_end):
    conn = _Conn(_current_row(bm_start, bm_end))
    monkeypatch.setattr(job_report_routes, "get_conn", lambda: conn)

    assert job_report_routes._resolve_benchmark_reference_job(699, None) == 437


def test_job_is_its_own_baseline_matches_on_both_dates():
    assert job_report_routes.job_is_its_own_baseline(
        CURRENT_START, CURRENT_END, CURRENT_START, CURRENT_END
    ) is True
    assert job_report_routes.job_is_its_own_baseline(
        CURRENT_START, CURRENT_END, PRIOR_START, PRIOR_END
    ) is False


def test_job_is_its_own_baseline_tolerates_datetime_and_string_shapes():
    """job_data carries these straight out of the DB, so they arrive as dates
    from one caller and ISO strings from another."""
    assert job_report_routes.job_is_its_own_baseline(
        "2025-05-01", "2026-04-30", CURRENT_START, CURRENT_END
    ) is True
    assert job_report_routes.job_is_its_own_baseline(
        "2025-05-01 00:00:00", "2026-04-30 00:00:00", CURRENT_START, CURRENT_END
    ) is True


@pytest.mark.parametrize(
    "rps,rpe,bms,bme",
    [
        (CURRENT_START, CURRENT_END, CURRENT_START, None),
        (CURRENT_START, CURRENT_END, None, CURRENT_END),
        (CURRENT_START, None, CURRENT_START, CURRENT_END),
        (None, None, None, None),
    ],
)
def test_job_is_its_own_baseline_needs_all_four_dates(rps, rpe, bms, bme):
    assert job_report_routes.job_is_its_own_baseline(rps, rpe, bms, bme) is False
