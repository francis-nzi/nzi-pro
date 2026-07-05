from __future__ import annotations

import math
import re
from datetime import date, datetime
from typing import Any, Mapping

from services.dataset_selector import resolve_dataset_resolution

_MONTH_FIELDS = tuple(f"month_{idx}" for idx in range(1, 13))
_FACTOR_ORIGINAL_ID_RE = re.compile(r"(?:^|[;( ])factor_original_id=([^;)\s]+)", re.IGNORECASE)
_STORAGE_REASON_RE = re.compile(r"(?:^|[;( ])storage_reason=([^;)\s]+)", re.IGNORECASE)


def _safe_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(float(value))
    except Exception:
        return None


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        out = float(value)
        if not math.isfinite(out):
            return None
        return out
    except Exception:
        return None


def _extract_note_token(notes: str | None, pattern: re.Pattern[str]) -> str | None:
    text = str(notes or "")
    if not text:
        return None
    match = pattern.search(text)
    if not match:
        return None
    value = str(match.group(1) or "").strip()
    return value or None


def _month_values_present(row: Mapping[str, Any]) -> bool:
    return any(row.get(field) is not None for field in _MONTH_FIELDS)


def _sum_month_values(row: Mapping[str, Any]) -> float:
    total = 0.0
    for field in _MONTH_FIELDS:
        total += _safe_float(row.get(field)) or 0.0
    return float(total)


def _calc_tco2e(qty: float | None, factor: float | None, ghg_unit: str | None, apply_pct: float | None) -> float:
    qty_val = float(qty or 0.0)
    factor_val = float(factor or 0.0)
    apply_pct_val = float(apply_pct or 100.0)
    emissions = qty_val * factor_val * (apply_pct_val / 100.0)
    if "kg" in str(ghg_unit or "kgCO2e").lower():
        emissions = emissions / 1000.0
    return float(emissions)


def _is_kg_based_unit(ghg_unit: str | None) -> bool:
    return "kg" in str(ghg_unit or "").replace(" ", "").lower()


def _effective_ghg_unit(
    storage_uom: str | None,
    storage_ghg_unit: str | None,
    reference_ghg_unit: str | None,
) -> str | None:
    """Prefer the resolved factor unit when the stored row unit looks wrong.

    Spend rows should normally retain kg-based factor units from the factor lookup.
    Legacy or fallback rows intentionally storing tCO2e should keep their stored unit.
    """
    storage_unit = str(storage_ghg_unit or "").strip() or None
    reference_unit = str(reference_ghg_unit or "").strip() or None
    storage_uom_norm = str(storage_uom or "").strip().lower()

    if not storage_unit:
        return reference_unit

    if _is_kg_based_unit(storage_unit):
        return storage_unit

    if storage_uom_norm == "tco2e":
        return storage_unit

    if _is_kg_based_unit(reference_unit):
        return reference_unit

    return storage_unit or reference_unit


def _unit_warning(
    storage_uom: str | None,
    storage_ghg_unit: str | None,
    reference_ghg_unit: str | None,
) -> str | None:
    storage_unit = str(storage_ghg_unit or "").strip() or None
    reference_unit = str(reference_ghg_unit or "").strip() or None
    storage_uom_norm = str(storage_uom or "").strip().lower()

    if not storage_unit:
        if reference_unit and _is_kg_based_unit(reference_unit):
            return "Stored unit missing; using factor lookup unit for calculation."
        return None

    if storage_uom_norm == "tco2e":
        return None

    if not _is_kg_based_unit(storage_unit) and _is_kg_based_unit(reference_unit):
        return f"Stored unit '{storage_unit}' differs from factor unit '{reference_unit}'; using factor unit for calculation."

    if reference_unit and storage_unit != reference_unit and _is_kg_based_unit(reference_unit):
        return f"Stored unit '{storage_unit}' differs from factor unit '{reference_unit}'; using factor unit for calculation."

    return None


def _choose_factor_for_year(year_values: Mapping[int, float], preferred_year: int | None) -> tuple[float | None, int | None]:
    if not year_values:
        return None, None

    years = sorted(int(y) for y in year_values.keys())
    if preferred_year is None:
        y = years[-1]
        return float(year_values[y]), int(y)

    if preferred_year in year_values:
        return float(year_values[preferred_year]), int(preferred_year)

    lower = [y for y in years if y <= preferred_year]
    if lower:
        y = max(lower)
        return float(year_values[y]), int(y)

    y = years[0]
    return float(year_values[y]), int(y)


class JobMonthlyEmissionsResolver:
    def __init__(self, con, job_id: int):
        self.con = con
        self.job_id = int(job_id)
        self.resolution = resolve_dataset_resolution(self.job_id, con=con)
        self.month_scope_dataset_map: dict[int, dict[str, int | None]] = {}
        self.month_year_map: dict[int, int | None] = {}
        self.month_label_map: dict[int, str] = {}
        self.dataset_name_by_id: dict[int, str] = {}
        self.job_client_db_id = self._load_job_client_db_id()
        self._factor_cache_by_key: dict[tuple[int, str, str], dict[str, Any] | None] = {}
        self._factor_cache_by_dbid: dict[int, dict[str, Any] | None] = {}
        self._custom_factor_cache: dict[tuple[str, str | None], dict[str, Any] | None] = {}
        self._custom_factor_year_value_cache: dict[int, dict[int, float]] = {}
        self._custom_year_table_exists: bool | None = None
        self._build_resolution_maps()

    def _load_job_client_db_id(self) -> int | None:
        try:
            row = self.con.execute(
                "SELECT client_db_id FROM jobs WHERE job_id = %s",
                [self.job_id],
            ).fetchone()
        except Exception:
            row = None
        if not row:
            return None
        return _safe_int(row[0])

    def _build_resolution_maps(self) -> None:
        for dataset in self.resolution.get("dataset_catalog") or []:
            dataset_id = _safe_int(dataset.get("dataset_id"))
            if dataset_id is None:
                continue
            name = str(dataset.get("name") or "").strip() or f"Dataset {dataset_id}"
            year = _safe_int(dataset.get("year"))
            if year is not None and str(year) not in name:
                self.dataset_name_by_id[int(dataset_id)] = f"{name} ({year})"
            else:
                self.dataset_name_by_id[int(dataset_id)] = name

        for month_record in self.resolution.get("months") or []:
            idx = _safe_int(month_record.get("index"))
            if idx is None or idx <= 0:
                continue
            date_txt = str(month_record.get("date") or "").strip()
            year_val: int | None = None
            if date_txt:
                try:
                    year_val = datetime.fromisoformat(date_txt).year
                except Exception:
                    try:
                        year_val = date.fromisoformat(date_txt).year
                    except Exception:
                        year_val = None
            self.month_year_map[int(idx)] = year_val
            self.month_label_map[int(idx)] = str(month_record.get("label") or f"M{idx}")
            scope_map: dict[str, int | None] = {}
            for scope, dataset_id in (month_record.get("scope_datasets") or {}).items():
                scope_map[str(scope)] = int(dataset_id) if dataset_id is not None else None
            self.month_scope_dataset_map[int(idx)] = scope_map

    def _load_factor_by_dbid(self, factor_db_id: int | None) -> dict[str, Any] | None:
        factor_id = _safe_int(factor_db_id)
        if factor_id is None:
            return None
        if factor_id in self._factor_cache_by_dbid:
            return self._factor_cache_by_dbid[factor_id]

        try:
            row = self.con.execute(
                """
                SELECT db_id, dataset_id, scope, original_id, factor, ghg_unit, level_1, level_2, column_text, report_label
                FROM factor_lookup
                WHERE db_id = %s
                LIMIT 1
""",
                [int(factor_id)],
            ).fetchone()
        except Exception:
            row = None

        result = None
        if row:
            result = {
                "db_id": _safe_int(row[0]),
                "dataset_id": _safe_int(row[1]),
                "scope": str(row[2]).strip() if row[2] is not None else None,
                "original_id": str(row[3]).strip() if row[3] is not None else None,
                "factor": _safe_float(row[4]),
                "ghg_unit": str(row[5]).strip() if row[5] is not None else None,
                "level_1": str(row[6]).strip() if row[6] is not None else None,
                "level_2": str(row[7]).strip() if row[7] is not None else None,
                "column_text": str(row[8]).strip() if row[8] is not None else None,
                "report_label": str(row[9]).strip() if row[9] is not None else None,
            }

        self._factor_cache_by_dbid[factor_id] = result
        return result

    def _lookup_factor(self, dataset_id: int | None, scope: str | None, original_id: str | None) -> dict[str, Any] | None:
        dsid = _safe_int(dataset_id)
        oid = str(original_id or "").strip()
        scope_name = str(scope or "").strip()
        if dsid is None or not oid:
            return None

        cache_key = (int(dsid), scope_name, oid)
        if cache_key in self._factor_cache_by_key:
            return self._factor_cache_by_key[cache_key]

        try:
            row = self.con.execute(
                """
                SELECT db_id, dataset_id, scope, original_id, factor, ghg_unit, level_1, level_2, column_text, report_label
                FROM factor_lookup
                WHERE dataset_id = %s
                  AND original_id = %s
                  AND (%s = '' OR scope = %s)
                ORDER BY CASE WHEN scope = %s THEN 0 ELSE 1 END, db_id ASC
                LIMIT 1
                """,
                [int(dsid), oid, scope_name, scope_name, scope_name],
            ).fetchone()
        except Exception:
            row = None

        result = None
        if row:
            result = {
                "db_id": _safe_int(row[0]),
                "dataset_id": _safe_int(row[1]),
                "scope": str(row[2]).strip() if row[2] is not None else None,
                "original_id": str(row[3]).strip() if row[3] is not None else None,
                "factor": _safe_float(row[4]),
                "ghg_unit": str(row[5]).strip() if row[5] is not None else None,
                "level_1": str(row[6]).strip() if row[6] is not None else None,
                "level_2": str(row[7]).strip() if row[7] is not None else None,
                "column_text": str(row[8]).strip() if row[8] is not None else None,
                "report_label": str(row[9]).strip() if row[9] is not None else None,
            }

        self._factor_cache_by_key[cache_key] = result
        return result

    def _lookup_factor_by_original_id(self, original_id: str | None) -> dict[str, Any] | None:
        """Look up a factor by original_id across ALL datasets with no scope or dataset constraint.
        Used as a tertiary fallback when factor_db_id and dataset_id are both NULL.
        Returns the entry from the most recently-dated dataset."""
        oid = str(original_id or "").strip()
        if not oid:
            return None

        cache_key = ("any_ds", oid)
        if cache_key in self._factor_cache_by_key:
            return self._factor_cache_by_key[cache_key]

        try:
            row = self.con.execute(
                """
                SELECT fl.db_id, fl.dataset_id, fl.scope, fl.original_id, fl.factor, fl.ghg_unit,
                       fl.level_1, fl.level_2, fl.column_text, fl.report_label
                FROM factor_lookup fl
                LEFT JOIN datasets d ON d.dataset_id = fl.dataset_id
                WHERE fl.original_id = %s
                ORDER BY COALESCE(d.year, 0) DESC, fl.db_id DESC
                LIMIT 1
                """,
                [oid],
            ).fetchone()
        except Exception:
            row = None

        result = None
        if row:
            result = {
                "db_id": _safe_int(row[0]),
                "dataset_id": _safe_int(row[1]),
                "scope": str(row[2]).strip() if row[2] is not None else None,
                "original_id": str(row[3]).strip() if row[3] is not None else None,
                "factor": _safe_float(row[4]),
                "ghg_unit": str(row[5]).strip() if row[5] is not None else None,
                "level_1": str(row[6]).strip() if row[6] is not None else None,
                "level_2": str(row[7]).strip() if row[7] is not None else None,
                "column_text": str(row[8]).strip() if row[8] is not None else None,
                "report_label": str(row[9]).strip() if row[9] is not None else None,
            }

        self._factor_cache_by_key[cache_key] = result
        return result

    def _ensure_custom_year_table_state(self) -> bool:
        if self._custom_year_table_exists is not None:
            return bool(self._custom_year_table_exists)
        try:
            self._custom_year_table_exists = bool(
                self.con.execute(
                    """
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_name = 'custom_factor_year_values'
                    LIMIT 1
                    """
                ).fetchone()
            )
        except Exception:
            self._custom_year_table_exists = False
        return bool(self._custom_year_table_exists)

    def _load_custom_factor(self, custom_id: str | None, scope: str | None) -> dict[str, Any] | None:
        cid = str(custom_id or "").strip()
        scope_name = str(scope or "").strip() or None
        if not cid:
            return None

        cache_key = (cid, scope_name)
        if cache_key in self._custom_factor_cache:
            return self._custom_factor_cache[cache_key]

        params: list[Any] = [cid]
        client_sql = "COALESCE(is_global, TRUE) = TRUE"
        if self.job_client_db_id is not None:
            client_sql = "(COALESCE(is_global, TRUE) = TRUE OR client_db_id = %s)"
            params.append(int(self.job_client_db_id))
        params.extend([scope_name or "", scope_name or "", scope_name or ""])

        try:
            row = self.con.execute(
                f"""
                SELECT factor_id, custom_id, scope, uom, ghg_unit,
                       factor_2018, factor_2019, factor_2020, factor_2021, factor_2022,
                       factor_2023, factor_2024, factor_2025, factor_2026, factor_2027,
                       factor_2028, factor_2029, factor_2030
                FROM custom_factors
                WHERE custom_id = %s
                  AND COALESCE(is_active, TRUE) = TRUE
                  AND {client_sql}
                  AND (%s = '' OR scope = %s OR scope IS NULL)
                ORDER BY CASE WHEN scope = %s THEN 0 ELSE 1 END,
                         CASE WHEN client_db_id = %s THEN 0 ELSE 1 END,
                         factor_id ASC
                LIMIT 1
                """,
                params + [int(self.job_client_db_id) if self.job_client_db_id is not None else -1],
            ).fetchone()
        except Exception:
            row = None

        result = None
        if row:
            factor_id = _safe_int(row[0])
            years: dict[int, float] = {}
            if factor_id is not None:
                for year in range(2018, 2031):
                    idx = 5 + (year - 2018)
                    value = _safe_float(row[idx])
                    if value is not None:
                        years[int(year)] = float(value)
                if self._ensure_custom_year_table_state():
                    if factor_id not in self._custom_factor_year_value_cache:
                        try:
                            year_df = self.con.execute(
                                """
                                SELECT year, factor
                                FROM custom_factor_year_values
                                WHERE factor_id = %s
                                ORDER BY year
                                """,
                                [int(factor_id)],
                            ).df()
                        except Exception:
                            year_df = None
                        loaded: dict[int, float] = {}
                        if year_df is not None and not year_df.empty:
                            for _, yr in year_df.iterrows():
                                year_val = _safe_int(yr.get("year"))
                                factor_val = _safe_float(yr.get("factor"))
                                if year_val is None or factor_val is None:
                                    continue
                                loaded[int(year_val)] = float(factor_val)
                        self._custom_factor_year_value_cache[factor_id] = loaded
                    years.update(self._custom_factor_year_value_cache.get(factor_id, {}))

            result = {
                "factor_id": factor_id,
                "custom_id": str(row[1]).strip() if row[1] is not None else cid,
                "scope": str(row[2]).strip() if row[2] is not None else scope_name,
                "uom": str(row[3]).strip() if row[3] is not None else None,
                "ghg_unit": str(row[4]).strip() if row[4] is not None else None,
                "year_values": years,
            }

        self._custom_factor_cache[cache_key] = result
        return result

    def _resolve_custom_factor_for_month(self, original_id: str | None, scope: str | None, month_idx: int) -> dict[str, Any] | None:
        custom = self._load_custom_factor(original_id, scope)
        if not custom:
            return None
        month_year = self.month_year_map.get(int(month_idx))
        factor_val, factor_year = _choose_factor_for_year(custom.get("year_values") or {}, month_year)
        if factor_val is None:
            return None
        return {
            "dataset_id": None,
            "dataset_name": "Custom factor",
            "db_id": None,
            "original_id": custom.get("custom_id"),
            "factor": float(factor_val),
            "factor_year": int(factor_year) if factor_year is not None else None,
            "ghg_unit": custom.get("ghg_unit"),
            "uom": custom.get("uom"),
            "level_1": None,
            "level_2": None,
        }

    def _resolve_standard_factor_for_month(self, row: Mapping[str, Any], month_idx: int) -> dict[str, Any] | None:
        scope = str(row.get("scope") or "").strip()
        row_dataset_id = _safe_int(row.get("dataset_id"))
        month_dataset_id = self.month_scope_dataset_map.get(int(month_idx), {}).get(scope)
        if month_dataset_id is None:
            month_dataset_id = row_dataset_id

        row_factor_db_id = _safe_int(row.get("factor_db_id"))
        row_original_id = str(row.get("original_id") or "").strip()
        row_factor = _safe_float(row.get("factor"))
        row_ghg_unit = str(row.get("ghg_unit")).strip() if row.get("ghg_unit") is not None else None

        if month_dataset_id is not None and row_factor_db_id is not None and month_dataset_id == row_dataset_id:
            return {
                "dataset_id": month_dataset_id,
                "dataset_name": self.dataset_name_by_id.get(int(month_dataset_id)),
                "db_id": row_factor_db_id,
                "original_id": row_original_id or None,
                "factor": row_factor,
                "ghg_unit": row_ghg_unit,
                "level_1": str(row.get("lookup_level_1") or row.get("level_1") or "").strip() or None,
                "level_2": str(row.get("lookup_level_2") or row.get("level_2") or "").strip() or None,
            }

        lookup = self._lookup_factor(month_dataset_id, scope, row_original_id)
        if lookup:
            return {
                "dataset_id": _safe_int(lookup.get("dataset_id")),
                "dataset_name": self.dataset_name_by_id.get(_safe_int(lookup.get("dataset_id")) or -1),
                "db_id": _safe_int(lookup.get("db_id")),
                "original_id": lookup.get("original_id") or row_original_id or None,
                "factor": _safe_float(lookup.get("factor")),
                "ghg_unit": lookup.get("ghg_unit") or row_ghg_unit,
                "level_1": lookup.get("level_1"),
                "level_2": lookup.get("level_2"),
            }

        if row_factor_db_id is not None:
            db_lookup = self._load_factor_by_dbid(row_factor_db_id)
            if db_lookup:
                dataset_id = _safe_int(db_lookup.get("dataset_id")) or month_dataset_id or row_dataset_id
                return {
                    "dataset_id": dataset_id,
                    "dataset_name": self.dataset_name_by_id.get(dataset_id or -1),
                    "db_id": _safe_int(db_lookup.get("db_id")),
                    "original_id": db_lookup.get("original_id") or row_original_id or None,
                    "factor": _safe_float(db_lookup.get("factor")) or row_factor,
                    "ghg_unit": db_lookup.get("ghg_unit") or row_ghg_unit,
                    "level_1": db_lookup.get("level_1"),
                    "level_2": db_lookup.get("level_2"),
                }

        if row_factor is None:
            return None

        return {
            "dataset_id": month_dataset_id or row_dataset_id,
            "dataset_name": self.dataset_name_by_id.get((month_dataset_id or row_dataset_id or -1)),
            "db_id": row_factor_db_id,
            "original_id": row_original_id or None,
            "factor": row_factor,
            "ghg_unit": row_ghg_unit,
            "level_1": str(row.get("lookup_level_1") or row.get("level_1") or "").strip() or None,
            "level_2": str(row.get("lookup_level_2") or row.get("level_2") or "").strip() or None,
        }

    def _build_monthly_factor_summary(self, month_details: list[dict[str, Any]]) -> tuple[float | None, str | None, str | None]:
        non_zero_factor_details = [
            detail for detail in month_details
            if detail.get("factor") is not None
        ]
        if not non_zero_factor_details:
            return None, None, None

        qty_total = 0.0
        weighted_sum = 0.0
        for detail in non_zero_factor_details:
            qty_val = _safe_float(detail.get("qty")) or 0.0
            factor_val = _safe_float(detail.get("factor")) or 0.0
            qty_total += qty_val
            weighted_sum += qty_val * factor_val

        grouped: list[str] = []
        current: dict[str, Any] | None = None
        for detail in sorted(non_zero_factor_details, key=lambda d: int(d.get("month_index") or 0)):
            group_key = (
                detail.get("dataset_id"),
                detail.get("factor"),
                detail.get("ghg_unit"),
                detail.get("original_id"),
            )
            if current and current.get("group_key") == group_key:
                current["end_label"] = detail.get("month_label")
                continue
            current = {
                "group_key": group_key,
                "start_label": detail.get("month_label"),
                "end_label": detail.get("month_label"),
                "dataset_name": detail.get("dataset_name"),
                "factor": detail.get("factor"),
            }
            grouped.append(current)

        dataset_parts: list[str] = []
        for group in grouped:
            if group["start_label"] == group["end_label"]:
                month_range = str(group["start_label"] or "")
            else:
                month_range = f"{group['start_label']}-{group['end_label']}"
            dataset_name = str(group.get("dataset_name") or "").strip() or "Unspecified dataset"
            dataset_parts.append(f"{month_range}: {dataset_name}")

        factor_val = (weighted_sum / qty_total) if qty_total > 0 else _safe_float(non_zero_factor_details[0].get("factor"))
        return factor_val, None, "; ".join(dataset_parts) if dataset_parts else None

    def row_metrics(self, row: Mapping[str, Any], include_monthly_details: bool = True) -> dict[str, Any]:
        scope = str(row.get("scope") or "").strip()
        notes = row.get("notes")
        apply_pct = _safe_float(row.get("apply_pct")) or 100.0

        storage_qty = _safe_float(row.get("qty"))
        storage_uom = str(row.get("uom")).strip() if row.get("uom") is not None else None
        storage_factor = _safe_float(row.get("factor"))
        storage_ghg_unit = str(row.get("ghg_unit")).strip() if row.get("ghg_unit") is not None else None

        source_qty = _safe_float(row.get("source_qty"))
        source_uom = str(row.get("source_uom")).strip() if row.get("source_uom") is not None else None
        factor_reference = _extract_note_token(notes, _FACTOR_ORIGINAL_ID_RE)
        storage_reason = _extract_note_token(notes, _STORAGE_REASON_RE)

        reference_factor = _safe_float(row.get("lookup_factor"))
        reference_ghg_unit = str(row.get("lookup_ghg_unit")).strip() if row.get("lookup_ghg_unit") is not None else None
        # Secondary: look up by original_id from notes + dataset_id
        if reference_factor is None and factor_reference:
            ref_lookup = self._lookup_factor(_safe_int(row.get("dataset_id")), scope, factor_reference)
            if ref_lookup:
                reference_factor = _safe_float(ref_lookup.get("factor"))
                reference_ghg_unit = ref_lookup.get("ghg_unit") or reference_ghg_unit
        # Tertiary: search by the row's own original_id across all datasets when both
        # factor_db_id and dataset_id are NULL (e.g. after a dataset re-upload cleared them)
        if reference_factor is None:
            row_oid = str(row.get("original_id") or "").strip()
            if row_oid:
                ref_lookup = self._lookup_factor_by_original_id(row_oid)
                if ref_lookup:
                    reference_factor = _safe_float(ref_lookup.get("factor"))
                    reference_ghg_unit = ref_lookup.get("ghg_unit") or reference_ghg_unit

        effective_ghg_unit = _effective_ghg_unit(storage_uom, storage_ghg_unit, reference_ghg_unit)
        unit_warning = _unit_warning(storage_uom, storage_ghg_unit, reference_ghg_unit)

        has_source_volume = bool(source_qty is not None and source_uom)
        fallback_storage = bool(
            storage_uom is not None
            and storage_uom.lower() == "tco2e"
            and storage_factor is not None
            and abs(float(storage_factor) - 1.0) < 1e-9
        )
        uses_emissions_fallback = bool(
            fallback_storage
            and (
                has_source_volume
                or reference_factor is not None
                or factor_reference is not None
                or storage_reason is not None
            )
        )

        monthly_total = _sum_month_values(row)
        display_qty = source_qty if uses_emissions_fallback and has_source_volume else (storage_qty if storage_qty is not None else monthly_total)
        display_uom = source_uom if uses_emissions_fallback and has_source_volume else storage_uom

        if uses_emissions_fallback:
            annual_storage_qty = storage_qty if storage_qty is not None else monthly_total
            # Infer reference_factor from stored tCO2e / source quantity when the factor
            # lookup failed (e.g. original factor row was deleted after a dataset re-upload).
            # These legacy fallback rows originate from kgCO2e-based DEFRA/DESNZ factors
            # where: tCO2e = qty × factor_kgCO2e / 1000
            # Reversing: factor_kgCO2e = tCO2e × 1000 / qty
            if reference_factor is None and has_source_volume and source_qty and source_qty > 0 and annual_storage_qty:
                reference_factor = (annual_storage_qty / source_qty) * 1000
            emissions = _calc_tco2e(annual_storage_qty, storage_factor, effective_ghg_unit, apply_pct)
            emissions_before = _calc_tco2e(annual_storage_qty, storage_factor, effective_ghg_unit, 100.0)
            factor_value = reference_factor if reference_factor is not None else storage_factor
            factor_label = None
            if factor_value is None and factor_reference:
                factor_label = factor_reference
            elif storage_reason == "multi_dataset_or_factor":
                factor_label = "Monthly factors"
            dataset_id = _safe_int(row.get("dataset_id"))
            return {
                "display_qty": display_qty,
                "display_uom": display_uom,
                "calc_tco2e": emissions,
                "tco2e_before_apply": emissions_before,
                "display_factor": factor_value,
                "factor_label": factor_label,
                "dataset_label": self.dataset_name_by_id.get(dataset_id) if dataset_id is not None else None,
                "monthly_factor_details": [],
                "uses_monthly_factors": False,
                "source_qty": source_qty,
                "source_uom": source_uom,
                "storage_qty": storage_qty if storage_qty is not None else monthly_total,
                "storage_uom": storage_uom,
                "storage_factor": storage_factor,
                "reference_factor": reference_factor,
                "reference_ghg_unit": reference_ghg_unit,
                "factor_reference": factor_reference,
                "storage_reason": storage_reason,
                "unit_warning": unit_warning,
                "uses_emissions_fallback": True,
                "source_volume_available": has_source_volume,
                "display_dataset_id": dataset_id,
            }

        month_values_present = _month_values_present(row)
        is_custom_factor = _safe_int(row.get("factor_db_id")) is None and _safe_int(row.get("dataset_id")) is None and bool(str(row.get("original_id") or "").strip())
        month_details: list[dict[str, Any]] = []

        if month_values_present:
            emissions = 0.0
            emissions_before = 0.0
            total_qty = 0.0
            dataset_id = _safe_int(row.get("dataset_id"))
            for idx in range(1, 13):
                raw_val = row.get(f"month_{idx}")
                month_qty = _safe_float(raw_val) or 0.0
                total_qty += month_qty

                factor_info = (
                    self._resolve_custom_factor_for_month(row.get("original_id"), scope, idx)
                    if is_custom_factor
                    else self._resolve_standard_factor_for_month(row, idx)
                )

                month_factor = _safe_float((factor_info or {}).get("factor")) or storage_factor or 0.0
                month_ghg_unit = (factor_info or {}).get("ghg_unit") or effective_ghg_unit
                month_dataset_id = _safe_int((factor_info or {}).get("dataset_id"))
                month_original_id = (factor_info or {}).get("original_id") or str(row.get("original_id") or "").strip() or None
                month_dataset_category = (factor_info or {}).get("level_1") or (factor_info or {}).get("category")

                month_before = _calc_tco2e(month_qty, month_factor, month_ghg_unit, 100.0)
                month_after = _calc_tco2e(month_qty, month_factor, month_ghg_unit, apply_pct)
                emissions_before += month_before
                emissions += month_after

                if include_monthly_details:
                    month_details.append(
                        {
                            "month_index": idx,
                            "month_label": self.month_label_map.get(idx) or f"M{idx}",
                            "year": self.month_year_map.get(idx),
                            "qty": month_qty,
                            "uom": storage_uom,
                            "dataset_id": month_dataset_id,
                            "dataset_name": (factor_info or {}).get("dataset_name") or self.dataset_name_by_id.get(month_dataset_id or -1),
                            "dataset_category": month_dataset_category,
                            "factor": month_factor,
                            "ghg_unit": month_ghg_unit,
                            "original_id": month_original_id,
                            "factor_db_id": _safe_int((factor_info or {}).get("db_id")),
                            "factor_year": _safe_int((factor_info or {}).get("factor_year")),
                            "emissions_tco2e": month_after,
                        }
                    )

            if include_monthly_details:
                display_factor, factor_label, dataset_label = self._build_monthly_factor_summary(month_details)
            else:
                display_factor = storage_factor
                factor_label = "Monthly factors"
                dataset_label = self.dataset_name_by_id.get(dataset_id) if dataset_id is not None else None
                if not dataset_label:
                    dataset_label = "Monthly factors"
            return {
                "display_qty": total_qty,
                "display_uom": storage_uom,
                "calc_tco2e": emissions,
                "tco2e_before_apply": emissions_before,
                "display_factor": display_factor,
                "factor_label": factor_label,
                "dataset_label": dataset_label,
                "monthly_factor_details": month_details if include_monthly_details else [],
                "uses_monthly_factors": True,
                "source_qty": source_qty,
                "source_uom": source_uom,
                "storage_qty": storage_qty if storage_qty is not None else total_qty,
                "storage_uom": storage_uom,
                "storage_factor": storage_factor,
                "reference_factor": reference_factor,
                "reference_ghg_unit": reference_ghg_unit,
                "factor_reference": factor_reference,
                "storage_reason": storage_reason,
                "unit_warning": unit_warning,
                "uses_emissions_fallback": False,
                "source_volume_available": has_source_volume,
                "display_dataset_id": _safe_int(row.get("dataset_id")),
            }

        annual_qty = storage_qty if storage_qty is not None else monthly_total
        emissions = _calc_tco2e(annual_qty, storage_factor, effective_ghg_unit, apply_pct)
        emissions_before = _calc_tco2e(annual_qty, storage_factor, effective_ghg_unit, 100.0)
        dataset_id = _safe_int(row.get("dataset_id"))
        return {
            "display_qty": annual_qty,
            "display_uom": storage_uom,
            "calc_tco2e": emissions,
            "tco2e_before_apply": emissions_before,
            "display_factor": storage_factor,
            "factor_label": None,
            "dataset_label": self.dataset_name_by_id.get(dataset_id) if dataset_id is not None else None,
            "monthly_factor_details": [],
            "uses_monthly_factors": False,
            "source_qty": source_qty,
            "source_uom": source_uom,
            "storage_qty": annual_qty,
            "storage_uom": storage_uom,
            "storage_factor": storage_factor,
            "reference_factor": reference_factor,
            "reference_ghg_unit": reference_ghg_unit,
            "factor_reference": factor_reference,
            "storage_reason": storage_reason,
            "unit_warning": unit_warning,
            "uses_emissions_fallback": False,
            "source_volume_available": has_source_volume,
            "display_dataset_id": dataset_id,
        }
