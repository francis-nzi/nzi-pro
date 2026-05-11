from __future__ import annotations

import calendar
from datetime import date

from services.audit_log import fetch_row_dict


def _job_audit_snapshot(con, job_id: int) -> dict | None:
    return fetch_row_dict(
        con,
        "SELECT * FROM jobs WHERE job_id = ?",
        [int(job_id)],
    )


def _ensure_job_original_portfolio_column(con) -> None:
    try:
        con.execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS original_portfolio VARCHAR DEFAULT 'NZI'")
    except Exception:
        pass


def _col_exists(con, table_name: str, col_name: str) -> bool:
    try:
        row = con.execute(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = ? AND column_name = ?
            LIMIT 1
            """,
            [table_name, col_name],
        ).fetchone()
        return bool(row)
    except Exception:
        return False


def _table_exists(con, table_name: str) -> bool:
    try:
        row = con.execute(
            """
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = ?
            LIMIT 1
            """,
            [table_name],
        ).fetchone()
        return bool(row)
    except Exception:
        return False


def _month_value(value):
    if value is None:
        return None
    if isinstance(value, int):
        return value
    try:
        numeric = int(str(value).strip())
        if 1 <= numeric <= 12:
            return numeric
    except Exception:
        pass
    month_map = {
        "january": 1,
        "jan": 1,
        "february": 2,
        "feb": 2,
        "march": 3,
        "mar": 3,
        "april": 4,
        "apr": 4,
        "may": 5,
        "june": 6,
        "jun": 6,
        "july": 7,
        "jul": 7,
        "august": 8,
        "aug": 8,
        "september": 9,
        "sep": 9,
        "sept": 9,
        "october": 10,
        "oct": 10,
        "november": 11,
        "nov": 11,
        "december": 12,
        "dec": 12,
    }
    return month_map.get(str(value).strip().lower())


def _build_reporting_period_end(reporting_year_value, month_value, day_value):
    try:
        reporting_year_int = int(reporting_year_value)
    except Exception as exc:
        raise ValueError(
            "Cannot determine reporting year/period. Please provide reporting_year or ensure client has benchmark period set."
        ) from exc

    month_int = month_value or 12
    if month_int < 1 or month_int > 12:
        raise ValueError("Client financial year end month is invalid. Please update the client benchmark settings.")

    try:
        day_int = int(day_value) if day_value is not None else 31
    except Exception as exc:
        raise ValueError("Client financial year end day is invalid. Please update the client benchmark settings.") from exc

    if day_int < 1:
        raise ValueError("Client financial year end day is invalid. Please update the client benchmark settings.")

    last_day = calendar.monthrange(reporting_year_int, month_int)[1]
    safe_day = min(day_int, last_day)
    return date(reporting_year_int, month_int, safe_day)


def _next_job_number(con) -> str:
    rows = con.execute(
        """
        SELECT job_number
        FROM jobs
        WHERE job_number IS NOT NULL
        """
    ).fetchall()
    max_number = 0
    for row in rows:
        job_number_value = str((row[0] if row else "") or "").strip()
        if not job_number_value or job_number_value.upper() == "PENDING":
            continue
        if not job_number_value.upper().startswith("J"):
            continue
        numeric_part = "".join(ch for ch in job_number_value[1:] if ch.isdigit())
        if not numeric_part:
            continue
        try:
            max_number = max(max_number, int(numeric_part))
        except Exception:
            continue
    return f"J{max_number + 1:06d}"
