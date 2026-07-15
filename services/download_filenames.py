"""Shared filename conventions for job data-upload template/example downloads.

Every mass-upload flow (Spend Data, Employee Commuting, Asset Register,
Business Travel) downloads a workbook named
"{JobNumber} {ClientName} {Descriptor} {StartYear}-{EndYear}.xlsx" — this
module is the single place that builds that string, so the four flows
can't drift out of sync with each other.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any


def safe_filename_part(value: Any) -> str:
    text = str(value or "").strip()
    text = re.sub(r'[<>:"/\\|?*]+', "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text or "Unknown"


def _year(value: Any) -> str:
    if value is None:
        return "?"
    if hasattr(value, "year"):
        return str(value.year)
    try:
        return str(datetime.fromisoformat(str(value).strip()[:10]).year)
    except Exception:
        return str(value)[:4]


def year_range_label(period_start: Any, period_end: Any, reporting_year: Any = None) -> str:
    """Return "2025-2025" or "2024-2025", falling back to reporting_year on both sides
    if a period boundary is missing."""
    start = _year(period_start) if period_start is not None else _year(reporting_year)
    end = _year(period_end) if period_end is not None else _year(reporting_year)
    return f"{start}-{end}"


def build_download_filename(
    *,
    job_number: Any,
    client_name: Any,
    descriptor: str,
    period_start: Any = None,
    period_end: Any = None,
    reporting_year: Any = None,
    suffix: str = "",
) -> str:
    period_years = year_range_label(period_start, period_end, reporting_year)
    return (
        f"{safe_filename_part(job_number)} "
        f"{safe_filename_part(client_name)} "
        f"{descriptor} "
        f"{period_years}"
        f"{suffix}"
        f".xlsx"
    )
