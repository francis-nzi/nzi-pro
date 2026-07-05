"""Automatic dataset resolution utilities.

This module resolves conversion-factor datasets at *report level* using:
- job reporting period (including split-year periods)
- client country
- dataset validity windows (valid_from/valid_to)

It keeps legacy scope-config mappings as fallback only.
"""

from __future__ import annotations

import contextlib
import time
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from typing import Any, Dict, Iterable, List, Sequence

from core.database import get_conn

# ── Reference-data caches ─────────────────────────────────────────────────────
# Datasets and scope maps are queried on every scope-data / scope-totals
# request via JobMonthlyEmissionsResolver. The data changes only when an admin
# uploads a new dataset, so a short TTL cache dramatically reduces DB load.
_DATASET_CACHE_TTL = 300  # seconds
_datasets_cache: list[dict[str, Any]] | None = None
_datasets_cache_ts: float = 0.0

_SCOPE_MAP_CACHE_TTL = 300  # seconds
_scope_map_cache: dict[frozenset[int], tuple[dict[int, set[str]], float]] = {}


DEFAULT_SCOPES: tuple[str, str, str] = ("Scope 1", "Scope 2", "Scope 3")
GLOBAL_COUNTRY_TOKENS = {
    "",
    "global",
    "international",
    "all",
    "all countries",
    "multi-country",
    "n/a",
    "na",
}


def _coerce_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text).date()
    except Exception:
        try:
            return datetime.strptime(text[:10], "%Y-%m-%d").date()
        except Exception:
            return None


def _normalize_country(value: Any) -> str:
    return str(value or "").strip().lower()


def _month_start(d: date) -> date:
    return date(d.year, d.month, 1)


def _next_month(d: date) -> date:
    if d.month == 12:
        return date(d.year + 1, 1, 1)
    return date(d.year, d.month + 1, 1)


def _month_sequence(period_start: date, period_end: date, target_months: int = 12) -> list[date]:
    if period_end < period_start:
        period_start, period_end = period_end, period_start

    months: list[date] = []
    cursor = _month_start(period_start)
    while cursor <= period_end and len(months) < target_months:
        months.append(cursor)
        cursor = _next_month(cursor)

    while len(months) < target_months:
        months.append(cursor)
        cursor = _next_month(cursor)

    return months


def _month_label(d: date) -> str:
    return f"{d.month:02d}/{d.year}"


def _month_text(d: date) -> str:
    return d.strftime("%b %Y")


def _compress_month_labels(labels: Iterable[str]) -> str:
    dates: list[date] = []
    for label in set(labels):
        try:
            mm, yyyy = str(label).split("/")
            dates.append(date(int(yyyy), int(mm), 1))
        except Exception:
            continue

    if not dates:
        return ""

    dates.sort()
    spans: list[tuple[date, date]] = []
    start = dates[0]
    prev = dates[0]
    for d in dates[1:]:
        if d == _next_month(prev):
            prev = d
            continue
        spans.append((start, prev))
        start = d
        prev = d
    spans.append((start, prev))

    parts: list[str] = []
    for s, e in spans:
        if s == e:
            parts.append(_month_text(s))
        elif s.year == e.year:
            parts.append(f"{s.strftime('%b')}–{e.strftime('%b %Y')}")
        else:
            parts.append(f"{_month_text(s)}–{_month_text(e)}")

    return ", ".join(parts)


def _get_job_context(con, job_id: int) -> dict[str, Any]:
    row = con.execute(
        """
        SELECT j.job_id,
               j.reporting_period_start,
               j.reporting_period_end,
               j.reporting_year,
               c.addr_country,
               c.client_name
        FROM jobs j
        JOIN clients c ON c.db_id = j.client_db_id
        WHERE j.job_id = ?
        """,
        [int(job_id)],
    ).fetchone()

    if not row:
        raise ValueError(f"Job {job_id} not found")

    period_start = _coerce_date(row[1])
    period_end = _coerce_date(row[2])
    reporting_year = int(row[3]) if row[3] is not None else None

    if period_start is None and reporting_year is not None:
        period_start = date(reporting_year, 1, 1)
    if period_end is None and reporting_year is not None:
        period_end = date(reporting_year, 12, 31)

    if period_start is None:
        this_year = datetime.now().year
        period_start = date(this_year, 1, 1)
    if period_end is None:
        period_end = _next_month(_month_start(period_start)) + timedelta(days=-1)
        period_end = date(period_start.year, 12, 31)

    if period_end < period_start:
        period_start, period_end = period_end, period_start

    return {
        "job_id": int(row[0]),
        "reporting_period_start": period_start,
        "reporting_period_end": period_end,
        "reporting_year": reporting_year,
        "country": str(row[4] or "").strip(),
        "client_name": str(row[5] or "").strip(),
    }


def _get_legacy_scope_dataset_map(con, job_id: int, scopes: Sequence[str]) -> dict[str, int | None]:
    legacy: dict[str, int | None] = {scope: None for scope in scopes}
    try:
        df = con.execute(
            """
            SELECT scope, dataset_id
            FROM job_scope_config
            WHERE job_id = ?
            """,
            [int(job_id)],
        ).df()
    except Exception:
        df = None

    if df is None or df.empty:
        return legacy

    for _, row in df.iterrows():
        scope = str(row.get("scope") or "").strip()
        if scope not in legacy:
            continue
        dsid = row.get("dataset_id")
        if dsid is None or str(dsid) == "nan":
            legacy[scope] = None
        else:
            try:
                legacy[scope] = int(dsid)
            except Exception:
                legacy[scope] = None
    return legacy


def _fetch_datasets(con) -> list[dict[str, Any]]:
    global _datasets_cache, _datasets_cache_ts
    now = time.monotonic()
    if _datasets_cache is not None and (now - _datasets_cache_ts) < _DATASET_CACHE_TTL:
        return _datasets_cache

    df = con.execute(
        """
        SELECT dataset_id,
               name,
               analysis_type,
               country,
               year,
               valid_from,
               valid_to,
               COALESCE(archived, FALSE) AS archived
        FROM datasets
        ORDER BY year DESC NULLS LAST, dataset_id DESC
        """
    ).df()

    datasets: list[dict[str, Any]] = []
    if df is None or df.empty:
        _datasets_cache = datasets
        _datasets_cache_ts = now
        return datasets

    for _, row in df.iterrows():
        archived = bool(row.get("archived")) if row.get("archived") is not None else False
        if archived:
            continue

        dsid_raw = row.get("dataset_id")
        if dsid_raw is None or str(dsid_raw) == "nan":
            continue
        try:
            dsid = int(dsid_raw)
        except Exception:
            continue

        year_raw = row.get("year")
        year_val: int | None
        try:
            year_val = int(year_raw) if year_raw is not None and str(year_raw) != "nan" else None
        except Exception:
            year_val = None

        datasets.append(
            {
                "dataset_id": dsid,
                "name": str(row.get("name") or f"Dataset {dsid}").strip(),
                "analysis_type": str(row.get("analysis_type") or "").strip(),
                "country": str(row.get("country") or "").strip(),
                "year": year_val,
                "valid_from": _coerce_date(row.get("valid_from")),
                "valid_to": _coerce_date(row.get("valid_to")),
            }
        )
    _datasets_cache = datasets
    _datasets_cache_ts = now
    return datasets


def _filter_datasets_by_period(datasets: Sequence[dict[str, Any]], period_start: date, period_end: date) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    for ds in datasets:
        vf = _coerce_date(ds.get("valid_from"))
        vt = _coerce_date(ds.get("valid_to"))
        year_val = ds.get("year")

        if vf and vt:
            if vt < period_start or vf > period_end:
                continue
            selected.append(ds)
            continue

        if year_val is not None:
            if int(year_val) < period_start.year - 1 or int(year_val) > period_end.year + 1:
                continue

        selected.append(ds)
    return selected


def _fetch_dataset_scope_map(con, dataset_ids: Sequence[int]) -> dict[int, set[str]]:
    if not dataset_ids:
        return {}

    key = frozenset(int(d) for d in dataset_ids)
    now = time.monotonic()
    cached = _scope_map_cache.get(key)
    if cached is not None and (now - cached[1]) < _SCOPE_MAP_CACHE_TTL:
        return cached[0]

    ph = ",".join(["?"] * len(dataset_ids))
    df = con.execute(
        f"""
        SELECT dataset_id, scope
        FROM factor_lookup
        WHERE dataset_id IN ({ph})
        GROUP BY dataset_id, scope
        """,
        list(dataset_ids),
    ).df()

    scope_map: dict[int, set[str]] = defaultdict(set)
    if df is None or df.empty:
        result: dict[int, set[str]] = {}
        _scope_map_cache[key] = (result, now)
        return result

    for _, row in df.iterrows():
        dsid = row.get("dataset_id")
        scope = str(row.get("scope") or "").strip()
        if dsid is None or str(dsid) == "nan" or not scope:
            continue
        try:
            scope_map[int(dsid)].add(scope)
        except Exception:
            continue

    result = dict(scope_map)
    _scope_map_cache[key] = (result, now)
    return result


def _dataset_supports_scope(scope_map: dict[int, set[str]], dataset_id: int, scope: str) -> bool:
    scopes = scope_map.get(int(dataset_id), set())
    if not scopes:
        # If we don't know, allow as fallback rather than blocking.
        return True
    return scope in scopes


def _dataset_rank(
    ds: dict[str, Any],
    *,
    scope: str,
    month_date: date,
    country_norm: str,
    scope_map: dict[int, set[str]],
) -> tuple[int, int, int, int, int, int]:
    dsid = int(ds["dataset_id"])
    ds_country_norm = _normalize_country(ds.get("country"))

    if country_norm and ds_country_norm == country_norm:
        country_rank = 0
    elif ds_country_norm in GLOBAL_COUNTRY_TOKENS:
        country_rank = 1
    elif not country_norm:
        country_rank = 1
    else:
        country_rank = 2

    scope_rank = 0 if _dataset_supports_scope(scope_map, dsid, scope) else 1

    vf = _coerce_date(ds.get("valid_from"))
    vt = _coerce_date(ds.get("valid_to"))
    ds_year = ds.get("year")

    if vf and vt and vf <= month_date <= vt:
        validity_rank = 0
    elif ds_year is not None and int(ds_year) == month_date.year:
        validity_rank = 1
    elif vf is None and vt is None:
        validity_rank = 2
    else:
        validity_rank = 3

    if ds_year is None:
        year_distance = 99
        year_preference = 0
    else:
        year_distance = abs(int(ds_year) - month_date.year)
        year_preference = -int(ds_year)

    return (country_rank, scope_rank, validity_rank, year_distance, year_preference, -dsid)


def _select_best_dataset(
    datasets: Sequence[dict[str, Any]],
    *,
    scope: str,
    month_date: date,
    country_norm: str,
    scope_map: dict[int, set[str]],
) -> dict[str, Any] | None:
    if not datasets:
        return None

    ranked = sorted(
        datasets,
        key=lambda ds: _dataset_rank(
            ds,
            scope=scope,
            month_date=month_date,
            country_norm=country_norm,
            scope_map=scope_map,
        ),
    )
    return ranked[0] if ranked else None


def resolve_dataset_resolution(job_id: int, scopes: Sequence[str] | None = None, *, con=None) -> dict[str, Any]:
    """Resolve month-by-month datasets for each scope for a given job.

    Pass ``con`` to reuse an already-open connection (avoids the cost of a
    second Supabase TLS handshake when called from within a route handler).
    """
    scopes = tuple(scopes or DEFAULT_SCOPES)

    with contextlib.ExitStack() as stack:
        if con is None:
            con = stack.enter_context(get_conn())
        ctx = _get_job_context(con, int(job_id))
        period_start: date = ctx["reporting_period_start"]
        period_end: date = ctx["reporting_period_end"]
        country_norm = _normalize_country(ctx.get("country"))

        legacy_map = _get_legacy_scope_dataset_map(con, int(job_id), scopes)

        all_datasets = _fetch_datasets(con)
        candidate_datasets = _filter_datasets_by_period(all_datasets, period_start, period_end)
        if not candidate_datasets:
            candidate_datasets = all_datasets

        dataset_ids = [int(ds["dataset_id"]) for ds in candidate_datasets]
        scope_map = _fetch_dataset_scope_map(con, dataset_ids)
        dataset_lookup = {int(ds["dataset_id"]): ds for ds in candidate_datasets}

        months = _month_sequence(period_start, period_end, target_months=12)
        month_records: list[dict[str, Any]] = []

        for idx, month_date in enumerate(months, start=1):
            scope_datasets: dict[str, int | None] = {}
            for scope in scopes:
                selected = _select_best_dataset(
                    candidate_datasets,
                    scope=scope,
                    month_date=month_date,
                    country_norm=country_norm,
                    scope_map=scope_map,
                )
                if selected:
                    scope_datasets[scope] = int(selected["dataset_id"])
                else:
                    scope_datasets[scope] = legacy_map.get(scope)

            month_records.append(
                {
                    "index": idx,
                    "date": month_date.isoformat(),
                    "label": _month_label(month_date),
                    "scope_datasets": scope_datasets,
                }
            )

        scope_primary: dict[str, int | None] = {}
        for scope in scopes:
            month_values = [m["scope_datasets"].get(scope) for m in month_records]
            counter = Counter([int(v) for v in month_values if v is not None])
            if counter:
                scope_primary[scope] = counter.most_common(1)[0][0]
            else:
                scope_primary[scope] = legacy_map.get(scope)

        # Fill empty month-level values from primary/fallback.
        for month_record in month_records:
            for scope in scopes:
                if month_record["scope_datasets"].get(scope) is None:
                    month_record["scope_datasets"][scope] = scope_primary.get(scope)

        # Add dataset names per month for easier UI rendering.
        for month_record in month_records:
            scope_names: dict[str, str | None] = {}
            for scope in scopes:
                dsid = month_record["scope_datasets"].get(scope)
                ds = dataset_lookup.get(int(dsid)) if dsid is not None else None
                scope_names[scope] = (ds.get("name") if ds else None)
            month_record["scope_dataset_names"] = scope_names

        scope_summaries: list[dict[str, Any]] = []
        unresolved_scopes: list[str] = []
        for scope in scopes:
            ids = sorted(
                {
                    int(m["scope_datasets"][scope])
                    for m in month_records
                    if m["scope_datasets"].get(scope) is not None
                }
            )
            names = [dataset_lookup.get(dsid, {}).get("name") or f"Dataset {dsid}" for dsid in ids]
            if not ids:
                unresolved_scopes.append(scope)
            scope_summaries.append(
                {
                    "scope": scope,
                    "primary_dataset_id": scope_primary.get(scope),
                    "dataset_ids": ids,
                    "dataset_names": names,
                    "legacy_dataset_id": legacy_map.get(scope),
                }
            )

        # Dataset coverage summary for report references.
        coverage: dict[int, set[str]] = defaultdict(set)
        for month_record in month_records:
            month_label = month_record["label"]
            for dsid in set(
                int(v)
                for v in month_record["scope_datasets"].values()
                if v is not None
            ):
                coverage[dsid].add(month_label)

        dataset_references: list[dict[str, Any]] = []
        for dsid in sorted(coverage.keys()):
            ds = dataset_lookup.get(dsid, {})
            dataset_references.append(
                {
                    "dataset_id": dsid,
                    "name": ds.get("name") or f"Dataset {dsid}",
                    "analysis_type": ds.get("analysis_type") or "",
                    "country": ds.get("country") or "",
                    "year": ds.get("year"),
                    "month_coverage": _compress_month_labels(coverage[dsid]),
                }
            )

        uses_legacy_fallback = any(
            month_record["scope_datasets"].get(scope) == legacy_map.get(scope)
            for month_record in month_records
            for scope in scopes
            if legacy_map.get(scope) is not None
        )

        return {
            "job_id": int(job_id),
            "client_name": ctx.get("client_name"),
            "country": ctx.get("country") or None,
            "reporting_period_start": period_start.isoformat(),
            "reporting_period_end": period_end.isoformat(),
            "mode": "automatic",
            "uses_legacy_fallback": bool(uses_legacy_fallback),
            "legacy_scope_dataset_map": legacy_map,
            "scope_primary_datasets": scope_primary,
            "scope_summaries": scope_summaries,
            "months": month_records,
            "datasets_for_report": dataset_references,
            "unresolved_scopes": unresolved_scopes,
            "dataset_catalog": [
                {
                    "dataset_id": int(ds["dataset_id"]),
                    "name": ds.get("name"),
                    "analysis_type": ds.get("analysis_type"),
                    "country": ds.get("country"),
                    "year": ds.get("year"),
                    "valid_from": ds.get("valid_from").isoformat() if ds.get("valid_from") else None,
                    "valid_to": ds.get("valid_to").isoformat() if ds.get("valid_to") else None,
                }
                for ds in candidate_datasets
            ],
        }


def get_scope_primary_datasets(job_id: int) -> Dict[str, int | None]:
    resolution = resolve_dataset_resolution(int(job_id))
    primary = resolution.get("scope_primary_datasets") or {}
    return {
        str(scope): (int(dsid) if dsid is not None else None)
        for scope, dsid in primary.items()
    }


def get_scope_month_dataset_map(job_id: int) -> Dict[int, Dict[str, int | None]]:
    resolution = resolve_dataset_resolution(int(job_id))
    month_map: dict[int, dict[str, int | None]] = {}
    for month_record in resolution.get("months") or []:
        idx = int(month_record.get("index") or 0)
        if idx <= 0:
            continue
        scope_map: dict[str, int | None] = {}
        for scope, dsid in (month_record.get("scope_datasets") or {}).items():
            scope_map[str(scope)] = int(dsid) if dsid is not None else None
        month_map[idx] = scope_map
    return month_map


def get_datasets_names_for_report(job_id: int) -> str:
    resolution = resolve_dataset_resolution(int(job_id))
    refs = resolution.get("datasets_for_report") or []
    parts: list[str] = []
    for ref in refs:
        name = str(ref.get("name") or "").strip() or f"Dataset {ref.get('dataset_id')}"
        coverage = str(ref.get("month_coverage") or "").strip()
        if coverage:
            parts.append(f"{name} ({coverage})")
        else:
            parts.append(name)
    return "; ".join(parts)


def get_applicable_datasets(job_id: int) -> Dict[str, List[int]]:
    """Backwards-compatible helper used by template utilities."""
    resolution = resolve_dataset_resolution(int(job_id))
    out: dict[str, list[int]] = {}
    for summary in resolution.get("scope_summaries") or []:
        scope = str(summary.get("scope") or "")
        if not scope:
            continue
        ids = [int(d) for d in (summary.get("dataset_ids") or []) if d is not None]
        out[scope] = ids
    return out


def get_monthly_headers(job_id: int) -> List[str]:
    resolution = resolve_dataset_resolution(int(job_id))
    months = resolution.get("months") or []
    if months:
        return [str(m.get("label") or "") for m in months]

    # Defensive fallback (should rarely execute)
    current_year = datetime.now().year
    return [f"{m:02d}/{current_year}" for m in range(1, 13)]


def get_reporting_period_display(job_id: int) -> str:
    resolution = resolve_dataset_resolution(int(job_id))
    start_txt = str(resolution.get("reporting_period_start") or "")
    end_txt = str(resolution.get("reporting_period_end") or "")
    if not start_txt or not end_txt:
        return "Not configured"

    start = _coerce_date(start_txt)
    end = _coerce_date(end_txt)
    if not start or not end:
        return "Not configured"
    return f"{_month_text(start)} - {_month_text(end)}"
