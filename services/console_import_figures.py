"""V7's own figures for a job, for the console's import checks (contract v7-import-figures/1).

Nothing here prices anything. The totals come from ``_build_scope_summary`` and
each row's figure from ``combined_row_metrics`` -- the same functions V7's own
report and /jobs/{id}/scope-totals call -- and a row's spans are read back out
of the ``monthly_factor_details`` that ``JobMonthlyEmissionsResolver.row_metrics``
already returns, grouped the way ``_build_monthly_factor_summary`` groups them.
A second pricing path would let the console's check agree with a number V7 does
not report.

Read-only: no function in this module writes, and the route runs it inside a
read-only transaction.
"""
from __future__ import annotations

import logging
import math
import threading
from contextlib import contextmanager
from datetime import date, datetime, timezone
from typing import Any, Iterator

logger = logging.getLogger(__name__)

CONTRACT = "v7-import-figures/1"

# Decision 8, as the console's view set has it (v7_import_views.sql): the jobs of
# Active / Portfolio Owner clients that are not archived. Mirrored, not re-ruled:
# the view set does not filter on the job's own `archived` flag either.
_SCOPE_STATUSES = ("Active", "Portfolio Owner")


class FiguresError(Exception):
    """A refusal the route turns into a status code. Never carries row data."""

    status = 500
    code = "ERROR"

    def __init__(self, code: str | None = None, detail: str | None = None):
        super().__init__(detail or code or self.code)
        if code:
            self.code = code
        self.detail = detail or self.code


class JobOutOfScope(FiguresError):
    status = 404
    code = "JOB_NOT_FOUND"


class CannotCompute(FiguresError):
    status = 422
    code = "COMPUTE_FAILED"


class Busy(FiguresError):
    status = 503
    code = "BUSY"


# ── One computation per job at a time ─────────────────────────────────────────
# A second request for a job already being computed is refused (503), not queued:
# the console retries through its own throttle, and a queue behind a slow job is
# how the 22 Nov incident piled up. Per process, which is the whole deployment
# (one uvicorn worker, see render.yaml).
_inflight: set[int] = set()
_inflight_guard = threading.Lock()


@contextmanager
def one_computation_per_job(job_id: int) -> Iterator[None]:
    key = int(job_id)
    with _inflight_guard:
        if key in _inflight:
            raise Busy("JOB_BUSY", "This job is already being computed")
        _inflight.add(key)
    try:
        yield
    finally:
        with _inflight_guard:
            _inflight.discard(key)


# ── Small helpers ─────────────────────────────────────────────────────────────

def _finite(value: Any, what: str) -> float:
    try:
        number = float(value if value is not None else 0.0)
    except (TypeError, ValueError):
        raise CannotCompute("NON_NUMERIC_FIGURE", f"{what} is not a number") from None
    if not math.isfinite(number):
        raise CannotCompute("NON_FINITE_FIGURE", f"{what} is not finite")
    return number


def _int_or_none(value: Any) -> int | None:
    try:
        if value is None or value != value:
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _text_or_none(value: Any) -> str | None:
    if value is None:
        return None
    try:
        if value != value:
            return None
    except Exception:
        pass
    text = str(value).strip()
    return text or None


def _iso_date(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)[:10]


def _utc_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _now_iso() -> str:
    return _utc_iso(datetime.now(timezone.utc)) or ""


# ── Scope and job facts ───────────────────────────────────────────────────────

def load_job_in_scope(con, job_id: int) -> dict[str, Any]:
    """The job's id, number and period, or JobOutOfScope (404) -- never a hint why."""
    row = con.execute(
        """
        SELECT j.job_id, j.job_number, j.reporting_period_start, j.reporting_period_end
        FROM jobs j
        JOIN clients c ON c.db_id = j.client_db_id
        WHERE j.job_id = %s
          AND COALESCE(c.status, 'Active') IN (%s, %s)
          AND NOT COALESCE(c.archived, FALSE)
        """,
        [int(job_id), *_SCOPE_STATUSES],
    ).fetchone()
    if not row:
        raise JobOutOfScope()
    return {
        "job_id": int(row[0]),
        "job_number": _text_or_none(row[1]),
        "period_from": _iso_date(row[2]),
        "period_to": _iso_date(row[3]),
    }


def rows_updated_at(con, job_id: int) -> str | None:
    """Latest change to any of the job's rows or register sources (UTC)."""
    row = con.execute(
        """
        SELECT GREATEST(
            (SELECT MAX(updated_at) FROM job_scope_rows WHERE job_id = %s),
            (SELECT MAX(updated_at) FROM job_emission_sources WHERE job_id = %s)
        )
        """,
        [int(job_id), int(job_id)],
    ).fetchone()
    return _utc_iso(row[0]) if row and row[0] is not None else None


def _build_resolver(con, job_id: int):
    from services.monthly_emissions import JobMonthlyEmissionsResolver

    try:
        return JobMonthlyEmissionsResolver(con, int(job_id))
    except Exception as exc:  # V7 cannot work out this job's datasets
        if type(exc).__module__.startswith("psycopg"):
            raise  # a timeout or a dropped connection is "busy", not "cannot compute": the route says so
        raise CannotCompute("RESOLVER_FAILED", f"V7 could not resolve the job's datasets ({type(exc).__name__})") from exc


# ── Endpoint 1: the job's totals ──────────────────────────────────────────────

def compute_scope_totals(con, job_id: int) -> dict[str, Any]:
    from api.job_data_output_routes import _build_scope_summary, _load_data_output_rows

    meta = load_job_in_scope(con, job_id)
    resolver = _build_resolver(con, job_id)
    data_df = _load_data_output_rows(con, int(job_id))

    counted = 0 if data_df is None else int(len(data_df))
    if counted == 0:
        totals: dict[str, float] = {}
    else:
        # Same call, same arguments as /jobs/{id}/scope-totals.
        _, totals = _build_scope_summary(data_df, resolver)

    return {
        "contract": CONTRACT,
        "job_id": meta["job_id"],
        "job_number": meta["job_number"],
        "computed_at": _now_iso(),
        "period": {"from": meta["period_from"], "to": meta["period_to"]},
        "scope_totals": {
            "scope_1": round(_finite(totals.get("Scope 1"), "Scope 1"), 2),
            "scope_2": round(_finite(totals.get("Scope 2"), "Scope 2"), 2),
            "scope_3": round(_finite(totals.get("Scope 3"), "Scope 3"), 2),
            "total": round(_finite(totals.get("Total"), "Total"), 2),
        },
        "counted_rows": counted,
        "rows_updated_at": rows_updated_at(con, job_id),
    }


# ── Endpoint 2: row figures and spans ─────────────────────────────────────────

def _dataset_years(resolver) -> dict[int, int]:
    years: dict[int, int] = {}
    for dataset in (getattr(resolver, "resolution", None) or {}).get("dataset_catalog") or []:
        dataset_id = _int_or_none(dataset.get("dataset_id"))
        year = _int_or_none(dataset.get("year"))
        if dataset_id is not None and year is not None:
            years[dataset_id] = year
    return years


def _month_key(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


def _spans_from_months(details: list[dict[str, Any]], dataset_years: dict[int, int]) -> list[dict[str, Any]]:
    """Runs of months priced from one dataset and factor, in V7's own grouping.

    The key is the one ``_build_monthly_factor_summary`` groups on, so ``blended``
    here is V7's own ``factor_blended``. Every dated month is kept (a zero-quantity
    month still extends a run, as it does in V7's summary), so the spans sum to the
    row's figure. A month with no date that carries an emission cannot be placed in
    any span: that is a refusal, not a guess.
    """
    ordered = sorted(details, key=lambda d: (d.get("year") or 0, int(d.get("month_index") or 0)))
    spans: list[dict[str, Any]] = []
    current_key: tuple | None = None
    for detail in ordered:
        emission = _finite(detail.get("emissions_tco2e"), "a month's figure")
        year = _int_or_none(detail.get("year"))
        month = _int_or_none(detail.get("month_index"))
        if year is None or month is None:
            if emission != 0.0:
                raise CannotCompute("UNDATED_MONTH", "A priced month falls outside the job's reporting period")
            continue
        if detail.get("factor") is None:
            continue
        key = (detail.get("dataset_id"), detail.get("factor"), detail.get("ghg_unit"), detail.get("original_id"))
        label = _month_key(year, month)
        if key == current_key:
            spans[-1]["to"] = label
            spans[-1]["tco2e"] += emission
            continue
        current_key = key
        dataset_id = _int_or_none(detail.get("dataset_id"))
        # A client's custom factor has no dataset: its year is the custom value's year.
        dataset_year = dataset_years.get(dataset_id) if dataset_id is not None else _int_or_none(detail.get("factor_year"))
        spans.append(
            {
                "from": label,
                "to": label,
                "dataset_id": dataset_id,
                "dataset_year": dataset_year,
                "factor": _finite(detail.get("factor"), "a factor"),
                "ghg_unit": _text_or_none(detail.get("ghg_unit")),
                "tco2e": emission,
            }
        )
    return spans


def _single_span(row, metrics: dict[str, Any], tco2e: float, meta: dict[str, Any], dataset_years: dict[int, int]) -> dict[str, Any]:
    dataset_id = _int_or_none(metrics.get("display_dataset_id"))
    if dataset_id is None:
        dataset_id = _int_or_none(row.get("dataset_id"))
    factor = metrics.get("display_factor")
    return {
        "from": (meta["period_from"] or "")[:7] or None,
        "to": (meta["period_to"] or "")[:7] or None,
        "dataset_id": dataset_id,
        "dataset_year": dataset_years.get(dataset_id) if dataset_id is not None else None,
        "factor": None if factor is None else _finite(factor, "a factor"),
        "ghg_unit": _text_or_none(metrics.get("reference_ghg_unit")) or _text_or_none(row.get("ghg_unit")),
        "tco2e": tco2e,
    }


def _row_sort_key(item: dict[str, Any]) -> tuple[int, int]:
    row_id = item["row_id"]
    return (1, int(str(row_id).split(":", 1)[1])) if isinstance(row_id, str) else (0, int(row_id))


def compute_row_figures(con, job_id: int) -> dict[str, Any]:
    from api.job_data_output_routes import _clean_label, _fallback_audit_metrics, _load_data_output_rows
    from services.emissions_reporting import combined_row_metrics

    meta = load_job_in_scope(con, job_id)
    resolver = _build_resolver(con, job_id)
    data_df = _load_data_output_rows(con, int(job_id), include_disabled=True)
    dataset_years = _dataset_years(resolver)

    rows: list[dict[str, Any]] = []
    if data_df is not None and not data_df.empty:
        for _, row in data_df.iterrows():
            try:
                metrics = combined_row_metrics(row, resolver)
            except Exception:
                # Exactly what _build_scope_summary does, so the rows still sum to the totals.
                # V7's own report does this silently; the figure is the stored one, so say so in the log.
                logger.warning("console-import figures: job %s row %s priced from stored figures (resolver raised)", job_id, row.get("row_id"))
                metrics = _fallback_audit_metrics(row)
            tco2e = _finite(metrics.get("calc_tco2e"), "a row's figure")

            details = list(metrics.get("monthly_factor_details") or []) if metrics.get("uses_monthly_factors") else []
            spans = _spans_from_months(details, dataset_years) if details else []
            if not spans:
                spans = [_single_span(row, metrics, tco2e, meta, dataset_years)]
            # The resolver's custom-factor path is the only one that returns a factor_year
            # with no dataset; a standard factor always has a dataset (or none, and no year).
            custom = any(d.get("dataset_id") is None and d.get("factor_year") is not None for d in details)

            is_register = str(row.get("record_type") or "legacy").strip().lower() == "source_register"
            raw_id = int(row.get("row_id"))
            rows.append(
                {
                    "row_id": f"source:{raw_id}" if is_register else raw_id,
                    "scope": _clean_label(row.get("scope"), "Unknown"),
                    "enabled": bool(row.get("row_enabled")),
                    "tco2e": tco2e,
                    "blended": len(spans) > 1,
                    "custom_factor": custom,
                    "spans": spans,
                }
            )

    rows.sort(key=_row_sort_key)
    return {
        "contract": CONTRACT,
        "job_id": meta["job_id"],
        "computed_at": _now_iso(),
        "rows": rows,
    }
