"""One place that answers "what is this client's baseline?".

Step 1 of RE_BASELINING_DESIGN.md. This is deliberately a thin wrapper over
today's `clients.benchmark_*` columns -- same inputs, same precedence, same
answers -- so that step 2 can swap the implementation for the `client_baselines`
history table without touching any caller.

Today the baseline is a single mutable row on `clients`, so `period_start` /
`period_end` cannot change the answer. They are in the signature anyway because
step 2's question is "which baseline was in force for *this* reporting period",
and callers should be written against that question now rather than be rewritten
later. They are used today only to report whether the period handed in IS the
baseline period.

Only `_build_yearly_emissions` calls this so far. The other ten derivations
catalogued in RE_BASELINING_DESIGN.md are deliberately left alone -- migrating
them is step 2, and doing it piecemeal would leave the estate in a state where
some screens filter pre-baseline years and others do not.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Baseline:
    """The baseline in force, as today's data model can express it."""

    period_start: Any | None
    period_end: Any | None
    # benchmark_year when set, else the year of benchmark_period_end. This is
    # the precedence every existing derivation uses; it is reproduced rather
    # than improved so step 1 changes no numbers.
    year: int | None
    scope_1_tco2e: float | None
    scope_2_tco2e: float | None
    scope_3_tco2e: float | None
    total_tco2e: float | None
    # True when the client record carries standalone baseline figures -- used
    # where the baseline period predates the platform and has no job on file.
    has_figures: bool
    # 'client_record' today. Step 2 adds 'declared' / 'migrated_unverified' so
    # a resolver can refuse to compare against an unverified baseline.
    source: str
    # True when the reporting period passed in IS the baseline period, i.e.
    # this period is the baseline and has nothing earlier to compare against.
    is_reporting_period_baseline: bool


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _as_year(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(str(value)[:4])
    except (TypeError, ValueError):
        return None


def _same_period(a_start: Any, a_end: Any, b_start: Any, b_end: Any) -> bool:
    """Date-only comparison. These arrive as `date` from one caller and as ISO
    strings from another, so both are normalised to their first 10 characters.
    A half-configured period never matches -- it isn't enough to say which
    period was meant."""
    if not (a_start and a_end and b_start and b_end):
        return False
    return str(a_start)[:10] == str(b_start)[:10] and str(a_end)[:10] == str(b_end)[:10]


def resolve_baseline(
    con,
    client_db_id: int,
    period_start: Any | None = None,
    period_end: Any | None = None,
) -> Baseline | None:
    """The baseline in force for a client, optionally for one reporting period.

    Returns None when the client has no baseline configured at all -- no
    period, no year and no figures. Callers must treat None as "no baseline
    exists", which is different from "the baseline is this period".
    """
    row = con.execute(
        """
        SELECT benchmark_period_start,
               benchmark_period_end,
               benchmark_year,
               benchmark_scope_1_tco2e,
               benchmark_scope_2_tco2e,
               benchmark_scope_3_tco2e,
               benchmark_total_tco2e
        FROM clients
        WHERE db_id = %s
        """,
        [int(client_db_id)],
    ).fetchone()
    if not row:
        return None

    bm_start, bm_end, bm_year, s1, s2, s3, total = row
    s1, s2, s3, total = _as_float(s1), _as_float(s2), _as_float(s3), _as_float(total)
    has_figures = any(v is not None for v in (s1, s2, s3, total))

    # Mirrors services/client_benchmark.py: a total that was never stored is
    # derived from whichever scopes were.
    if total is None and has_figures:
        total = sum(v for v in (s1, s2, s3) if v is not None)

    # benchmark_year first, then the year of benchmark_period_end. Same
    # precedence as _early_benchmark_year, _effective_benchmark_year and the
    # other derivations this will eventually replace.
    year = _as_year(bm_year)
    if year is None:
        year = _as_year(bm_end)

    if bm_start is None and bm_end is None and year is None and not has_figures:
        return None

    return Baseline(
        period_start=bm_start,
        period_end=bm_end,
        year=year,
        scope_1_tco2e=s1,
        scope_2_tco2e=s2,
        scope_3_tco2e=s3,
        total_tco2e=total,
        has_figures=has_figures,
        source="client_record",
        is_reporting_period_baseline=_same_period(period_start, period_end, bm_start, bm_end),
    )
