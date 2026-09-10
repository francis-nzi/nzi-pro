"""Step 1 of RE_BASELINING_DESIGN.md: one resolver, with _build_yearly_emissions
as its first caller.

resolve_baseline is a thin wrapper over today's clients.benchmark_* columns, so
these lock in the *current* precedence -- benchmark_year first, then the year of
benchmark_period_end -- rather than an improved one. Step 2 swaps the
implementation for client_baselines and these tests should still pass.
"""
from __future__ import annotations

from datetime import date
from pathlib import Path
import sys

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.job_live_report_routes as live
from services.baseline_resolution import resolve_baseline

CURRENT_START = date(2025, 5, 1)
CURRENT_END = date(2026, 4, 30)
PRIOR_START = date(2024, 5, 1)
PRIOR_END = date(2025, 4, 30)


class _ClientConn:
    """Answers the single clients SELECT resolve_baseline makes."""

    def __init__(self, row):
        self._row = row

    def execute(self, sql, params=None):
        return self

    def fetchone(self):
        return self._row


def _client_row(bm_start=None, bm_end=None, bm_year=None, s1=None, s2=None, s3=None, total=None):
    return (bm_start, bm_end, bm_year, s1, s2, s3, total)


# ── resolve_baseline ──────────────────────────────────────────────────────────

def test_client_with_a_period_but_no_benchmark_year_derives_the_year():
    """79 of the 93 clients with a baseline are in this shape. The report-
    generation paths pass clients.benchmark_year raw and get None; the resolver
    must not."""
    con = _ClientConn(_client_row(bm_start=CURRENT_START, bm_end=CURRENT_END))

    baseline = resolve_baseline(con, 248)

    assert baseline is not None
    assert baseline.year == 2026
    assert baseline.period_start == CURRENT_START
    assert baseline.period_end == CURRENT_END
    assert baseline.has_figures is False
    assert baseline.source == "client_record"


def test_benchmark_year_wins_over_the_period_end_year():
    con = _ClientConn(_client_row(bm_start=PRIOR_START, bm_end=PRIOR_END, bm_year=2019))

    assert resolve_baseline(con, 1).year == 2019


def test_client_with_cached_figures_only():
    """ABtec and AD Modular: the baseline period predates the platform and has
    no job on file, which is what the cached figures are for."""
    con = _ClientConn(_client_row(
        bm_start=date(2022, 1, 1), bm_end=date(2022, 12, 31), s1=0.0, s2=6.7, s3=30.2, total=36.9
    ))

    baseline = resolve_baseline(con, 243)

    assert baseline.has_figures is True
    assert baseline.total_tco2e == 36.9
    assert baseline.year == 2022


def test_a_missing_total_is_derived_from_the_scopes():
    """Mirrors services/client_benchmark.py so the wrapper stays faithful."""
    con = _ClientConn(_client_row(bm_end=date(2022, 12, 31), s1=1.0, s2=2.0, s3=3.0, total=None))

    assert resolve_baseline(con, 1).total_tco2e == 6.0


def test_job_that_is_its_own_baseline_is_flagged():
    con = _ClientConn(_client_row(bm_start=CURRENT_START, bm_end=CURRENT_END))

    same = resolve_baseline(con, 248, CURRENT_START, CURRENT_END)
    earlier = resolve_baseline(con, 248, PRIOR_START, PRIOR_END)

    assert same.is_reporting_period_baseline is True
    assert earlier.is_reporting_period_baseline is False


def test_self_baseline_accepts_dates_and_iso_strings():
    con = _ClientConn(_client_row(bm_start=CURRENT_START, bm_end=CURRENT_END))

    assert resolve_baseline(con, 248, "2025-05-01", "2026-04-30").is_reporting_period_baseline is True
    assert resolve_baseline(
        con, 248, "2025-05-01 00:00:00", "2026-04-30 00:00:00"
    ).is_reporting_period_baseline is True


@pytest.mark.parametrize("start,end", [(CURRENT_START, None), (None, CURRENT_END), (None, None)])
def test_a_half_given_reporting_period_is_never_the_baseline(start, end):
    con = _ClientConn(_client_row(bm_start=CURRENT_START, bm_end=CURRENT_END))

    assert resolve_baseline(con, 248, start, end).is_reporting_period_baseline is False


def test_client_with_no_baseline_at_all_returns_none():
    """425 of 753 jobs belong to clients in this shape. None means "no baseline
    exists", which callers must not confuse with "this period is the baseline"."""
    assert resolve_baseline(_ClientConn(_client_row()), 1) is None


def test_unknown_client_returns_none():
    assert resolve_baseline(_ClientConn(None), 99999) is None


# ── _build_yearly_emissions ───────────────────────────────────────────────────

class _YearlyConn:
    """Serves the jobs frame to _build_yearly_emissions and the clients row to
    resolve_baseline, telling them apart by the SQL."""

    def __init__(self, jobs_frame, client_row):
        self._jobs = jobs_frame
        self._client = client_row
        self._last = ""

    def execute(self, sql, params=None):
        self._last = sql
        return self

    def df(self):
        return self._jobs

    def fetchone(self):
        return self._client if "FROM clients" in self._last else None


def _jobs_frame(rows):
    return pd.DataFrame(
        rows,
        columns=[
            "job_id", "dashboard_year", "reporting_period_start",
            "reporting_period_end", "period_days", "intensity_metrics",
        ],
    )


@pytest.fixture
def _stub_year_totals(monkeypatch):
    """Each job contributes a Scope 1 total equal to its job_id, so the tests
    can tell which job represented a year."""
    monkeypatch.setattr(live, "JobMonthlyEmissionsResolver", lambda con, jid: object())
    monkeypatch.setattr(live, "_load_data_output_rows", lambda con, jid: pd.DataFrame({"job_id": [jid]}))
    monkeypatch.setattr(
        live, "_build_scope_summary",
        lambda df, resolver: (None, {"Scope 1": float(df["job_id"].iloc[0]), "Scope 2": 0.0, "Scope 3": 0.0}),
    )


def test_dedup_prefers_the_longest_period_not_the_highest_job_id(_stub_year_totals):
    """Gama Healthcare 2022: a 21-day job (J000032, id 31) sat beside the full
    year (J000019, id 19). Highest-job_id let the 21-day job represent the
    year, so the trend chart showed three weeks as that year's footprint."""
    conn = _YearlyConn(
        _jobs_frame([
            [19, 2022, date(2021, 4, 1), date(2022, 3, 31), 364, None],
            [31, 2022, date(2022, 5, 25), date(2022, 6, 15), 21, None],
        ]),
        _client_row(),
    )

    result = live._build_yearly_emissions(conn, 42)

    assert [e["year"] for e in result] == [2022]
    assert result[0]["scope1"] == 19.0  # job 19 won, not job 31


def test_dedup_still_prefers_the_later_job_for_an_identical_period(_stub_year_totals):
    """A genuine re-run of the same period must resolve exactly as before."""
    conn = _YearlyConn(
        _jobs_frame([
            [538, 2026, date(2025, 4, 1), date(2026, 3, 31), 364, None],
            [638, 2026, date(2025, 4, 1), date(2026, 3, 31), 364, None],
        ]),
        _client_row(),
    )

    assert live._build_yearly_emissions(conn, 42)[0]["scope1"] == 638.0


def test_years_before_the_baseline_are_excluded(_stub_year_totals):
    """Silent Sounds: baseline moved to 2026, so 2024 and 2025 stop being part
    of the reported trend even though their jobs and data remain."""
    conn = _YearlyConn(
        _jobs_frame([
            [222, 2024, date(2023, 5, 1), date(2024, 4, 30), 365, None],
            [437, 2025, PRIOR_START, PRIOR_END, 364, None],
            [699, 2026, CURRENT_START, CURRENT_END, 364, None],
        ]),
        _client_row(bm_start=CURRENT_START, bm_end=CURRENT_END),
    )

    result = live._build_yearly_emissions(conn, 248)

    assert [e["year"] for e in result] == [2026]


def test_all_years_kept_when_the_client_has_no_baseline(_stub_year_totals):
    conn = _YearlyConn(
        _jobs_frame([
            [222, 2024, date(2023, 5, 1), date(2024, 4, 30), 365, None],
            [437, 2025, PRIOR_START, PRIOR_END, 364, None],
        ]),
        _client_row(),
    )

    assert [e["year"] for e in live._build_yearly_emissions(conn, 248)] == [2024, 2025]


def test_the_baseline_year_itself_is_kept(_stub_year_totals):
    conn = _YearlyConn(
        _jobs_frame([
            [437, 2025, PRIOR_START, PRIOR_END, 364, None],
            [699, 2026, CURRENT_START, CURRENT_END, 364, None],
        ]),
        _client_row(bm_start=PRIOR_START, bm_end=PRIOR_END),
    )

    assert [e["year"] for e in live._build_yearly_emissions(conn, 248)] == [2025, 2026]


def test_cached_baseline_figures_are_still_prepended_when_no_job_covers_them(_stub_year_totals):
    """ABtec's 2022 baseline has no job. Without this the pathway charts fall
    back to the current job's totals as the baseline."""
    conn = _YearlyConn(
        _jobs_frame([[218, 2023, date(2023, 1, 1), date(2023, 12, 31), 364, None]]),
        _client_row(
            bm_start=date(2022, 1, 1), bm_end=date(2022, 12, 31),
            s1=0.0, s2=6.7, s3=30.2, total=36.9,
        ),
    )

    result = live._build_yearly_emissions(conn, 243)

    assert [e["year"] for e in result] == [2022, 2023]
    assert result[0]["total"] == 36.9
    assert result[0]["scope2"] == 6.7
