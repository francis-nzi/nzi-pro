"""One rule for a client's baseline (benchmark) year.

The baseline period end decides the year, matching how each job's
dashboard year is the year of its reporting period end (a 1/4/2024 to
31/3/2025 baseline is the 2025 column). The stored clients.benchmark_year
is only a fallback for clients with no period set: the client edit form
saves the period without touching that column, so it can go stale.
"""

from __future__ import annotations

from typing import Any


def resolve_benchmark_year(benchmark_year: Any, benchmark_period_end: Any) -> int | None:
    if benchmark_period_end not in (None, ""):
        try:
            return int(str(benchmark_period_end).strip()[:4])
        except (TypeError, ValueError):
            pass
    if benchmark_year not in (None, ""):
        try:
            return int(benchmark_year)
        except (TypeError, ValueError):
            pass
    return None
