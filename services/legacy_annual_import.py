from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime
import io
from pathlib import Path
import json
import re
from typing import Any

import pandas as pd
from openpyxl import load_workbook

from core.database import db_backend, get_conn

ID_RE = re.compile(r"^\d+_\d+_\d+_\d+_\d+$")


def _clean(value: Any) -> str:
    if value is None:
        return ""
    s = str(value).strip()
    if s.lower() == "nan":
        return ""
    return s


def _safe_float(value: Any) -> float | None:
    s = _clean(value)
    if not s:
        return None
    try:
        return float(s)
    except Exception:
        return None


def _norm_scope(value: Any) -> str | None:
    s = _clean(value).lower()
    if "scope 1" in s or s == "1":
        return "Scope 1"
    if "scope 2" in s or s == "2":
        return "Scope 2"
    if "scope 3" in s or s == "3":
        return "Scope 3"
    return None


def _template_lookup_path() -> Path:
    return Path(__file__).resolve().parents[1] / "wfm_import" / "analysis" / "wfm_template_id_lookup.json"


def _load_template_lookup() -> dict[str, str]:
    path = _template_lookup_path()
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        preferred = payload.get("preferred_items") or {}
        out: dict[str, str] = {}
        if isinstance(preferred, dict):
            for k, v in preferred.items():
                kk = _clean(k).lower()
                vv = _clean(v)
                if kk and vv:
                    out[kk] = vv
        return out
    except Exception:
        return {}


def _lookup_key(section: str, activity: str, c2: str, c3: str, c4: str, c5: str, c6: str, c7: str) -> str:
    return "|".join(
        [
            _clean(section).lower(),
            _clean(activity).lower(),
            _clean(c2).lower(),
            _clean(c3).lower(),
            _clean(c4).lower(),
            _clean(c5).lower(),
            _clean(c6).lower(),
            _clean(c7).lower(),
        ]
    )


def _parse_month_header(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return date(value.year, value.month, 1)
    if isinstance(value, date):
        return date(value.year, value.month, 1)
    s = _clean(value)
    if not s:
        return None
    for fmt in ("%b-%Y", "%b %Y", "%B-%Y", "%B %Y", "%Y-%m"):
        try:
            d = datetime.strptime(s, fmt)
            return date(d.year, d.month, 1)
        except Exception:
            pass
    try:
        d = pd.to_datetime(s, dayfirst=True, errors="coerce")
        if pd.notna(d):
            return date(int(d.year), int(d.month), 1)
    except Exception:
        pass
    return None


def _is_reporting_yes(value: Any) -> bool:
    s = _clean(value).lower()
    if not s:
        return True
    return s in {"yes", "y", "true", "1"}


def _dataset_by_year() -> dict[int, int]:
    sql = """
        SELECT dataset_id, year, source, analysis_type, name
        FROM datasets
        ORDER BY year DESC NULLS LAST, dataset_id DESC
    """
    chosen: dict[int, int] = {}
    fallback: dict[int, int] = {}
    with get_conn() as con:
        df = con.execute(sql).df()
    if df is None or df.empty:
        return chosen
    for _, r in df.iterrows():
        y = r.get("year")
        dsid = r.get("dataset_id")
        if y is None or dsid is None:
            continue
        year = int(y)
        dsi = int(dsid)
        fallback.setdefault(year, dsi)
        source = _clean(r.get("source")).lower()
        analysis = _clean(r.get("analysis_type")).lower()
        name = _clean(r.get("name")).lower()
        if ("desnz-defra" in source or "activity-and-spend" in name) and ("activity" in analysis and "spend" in analysis):
            chosen.setdefault(year, dsi)
    for year, dsi in fallback.items():
        chosen.setdefault(year, dsi)
    return chosen


@dataclass
class FactorRec:
    db_id: int | None
    level_1: str | None
    level_2: str | None
    level_3: str | None
    level_4: str | None
    column_text: str | None
    report_label: str | None
    uom: str | None
    ghg_unit: str | None
    factor: float | None


def _factor_lookup_batch(req: dict[tuple[int, str], set[str]]) -> dict[tuple[int, str, str], FactorRec]:
    out: dict[tuple[int, str, str], FactorRec] = {}
    with get_conn() as con:
        for (dataset_id, scope), ids in req.items():
            id_list = sorted({_clean(x) for x in ids if _clean(x)})
            if not id_list:
                continue
            if db_backend() == "postgres":
                df = con.execute(
                    """
                    SELECT original_id, db_id, level_1, level_2, level_3, level_4,
                           column_text, report_label, uom, ghg_unit, factor
                    FROM factor_lookup
                    WHERE dataset_id=%s AND scope=%s AND original_id = ANY(%s)
                    """,
                    [int(dataset_id), str(scope), id_list],
                ).df()
            else:
                ph = ",".join(["?"] * len(id_list))
                df = con.execute(
                    f"""
                    SELECT original_id, db_id, level_1, level_2, level_3, level_4,
                           column_text, report_label, uom, ghg_unit, factor
                    FROM factor_lookup
                    WHERE dataset_id=? AND scope=? AND original_id IN ({ph})
                    """,
                    [int(dataset_id), str(scope), *id_list],
                ).df()
            if df is None or df.empty:
                continue
            for _, r in df.iterrows():
                oid = _clean(r.get("original_id"))
                if not oid:
                    continue
                out[(int(dataset_id), str(scope), oid)] = FactorRec(
                    db_id=int(r.get("db_id")) if r.get("db_id") is not None and str(r.get("db_id")) != "nan" else None,
                    level_1=_clean(r.get("level_1")) or None,
                    level_2=_clean(r.get("level_2")) or None,
                    level_3=_clean(r.get("level_3")) or None,
                    level_4=_clean(r.get("level_4")) or None,
                    column_text=_clean(r.get("column_text")) or None,
                    report_label=_clean(r.get("report_label")) or None,
                    uom=_clean(r.get("uom")) or None,
                    ghg_unit=_clean(r.get("ghg_unit")) or None,
                    factor=float(r.get("factor")) if r.get("factor") is not None and str(r.get("factor")) != "nan" else None,
                )
    return out


def _to_tco2e(qty: float, factor: float, ghg_unit: str | None) -> float:
    emissions = float(qty) * float(factor)
    ghg = _clean(ghg_unit).replace(" ", "").lower()
    if ghg.startswith("kg"):
        return emissions / 1000.0
    return emissions


def parse_legacy_annual_workbook(raw_bytes: bytes) -> dict[str, Any]:
    wb = load_workbook(io.BytesIO(raw_bytes), data_only=True, read_only=True)
    lookup = _load_template_lookup()
    dataset_by_year = _dataset_by_year()

    parsed_rows: list[dict[str, Any]] = []
    parse_warnings: list[str] = []

    for ws in wb.worksheets:
        current_section = ""
        month_cols: list[tuple[int, date, str]] = []
        section_has_reporting_col = False
        max_col = ws.max_column or 0
        for rnum in range(1, (ws.max_row or 0) + 1):
            c0 = _clean(ws.cell(rnum, 1).value)
            c1 = _clean(ws.cell(rnum, 2).value)
            c2 = _clean(ws.cell(rnum, 3).value)
            c3 = _clean(ws.cell(rnum, 4).value)
            c4 = _clean(ws.cell(rnum, 5).value)
            c5 = _clean(ws.cell(rnum, 6).value)
            c6 = _clean(ws.cell(rnum, 7).value)
            c7 = _clean(ws.cell(rnum, 8).value)
            is_reporting = ws.cell(rnum, 10).value

            if c0.lower().startswith("section"):
                current_section = c1 or c0
                month_cols = []
                section_has_reporting_col = _clean(ws.cell(rnum, 10).value).lower() == "is reporting"
                for col in range(9, max_col + 1):
                    mv = ws.cell(rnum, col).value
                    md = _parse_month_header(mv)
                    if md is not None:
                        month_cols.append((col, md, _clean(mv)))
                continue

            if not current_section or not c1:
                continue
            if section_has_reporting_col and not _is_reporting_yes(is_reporting):
                continue
            if not month_cols:
                continue

            monthly_qty: dict[int, float] = {}
            has_non_zero = False
            for idx, (col, _d, _label) in enumerate(month_cols[:12], start=1):
                q = _safe_float(ws.cell(rnum, col).value)
                if q is None:
                    continue
                monthly_qty[idx] = float(q)
                if float(q) != 0:
                    has_non_zero = True
            if not has_non_zero:
                continue

            scope = _norm_scope(c4)
            row_key = _lookup_key(current_section, c1, c2, c3, c4, c5, c6, c7)
            original_id = c0 if ID_RE.match(c0) else lookup.get(row_key, "")
            match_source = "id_column" if ID_RE.match(c0) else ("template_lookup" if original_id else "unresolved")

            parsed_rows.append(
                {
                    "sheet_name": ws.title,
                    "row_number": int(rnum),
                    "section": current_section,
                    "activity": c1,
                    "scope": scope,
                    "original_id": original_id,
                    "match_source": match_source,
                    "lookup_key": row_key,
                    "col_2": c2,
                    "col_3": c3,
                    "col_4": c4,
                    "col_5": c5,
                    "col_6": c6,
                    "col_7": c7,
                    "month_headers": [
                        {"position": i + 1, "label": label, "year": int(md.year), "month": int(md.month)}
                        for i, (_col, md, label) in enumerate(month_cols[:12])
                    ],
                    "monthly_qty": monthly_qty,
                }
            )

    factor_req: dict[tuple[int, str], set[str]] = defaultdict(set)
    for row in parsed_rows:
        scope = row.get("scope")
        oid = _clean(row.get("original_id"))
        if not scope or not oid:
            continue
        for m in row.get("month_headers") or []:
            year = int(m.get("year"))
            dsid = dataset_by_year.get(year)
            if dsid is not None:
                factor_req[(int(dsid), str(scope))].add(oid)

    factors = _factor_lookup_batch(factor_req)

    staged_rows: list[dict[str, Any]] = []
    unresolved_rows: list[dict[str, Any]] = []
    collision_tracker: Counter[tuple[str, str]] = Counter()
    aggregate: dict[tuple[str, str], dict[str, Any]] = {}

    for row in parsed_rows:
        scope = row.get("scope")
        oid = _clean(row.get("original_id"))
        if not scope or not oid:
            unresolved_rows.append({**row, "reason": "missing scope or unresolved original_id"})
            continue

        month_emissions: dict[int, float] = {}
        month_datasets: dict[int, int] = {}
        month_missing: list[dict[str, Any]] = []
        factor_rec_primary: FactorRec | None = None

        for m in row.get("month_headers") or []:
            pos = int(m["position"])
            qty = _safe_float((row.get("monthly_qty") or {}).get(pos))
            if qty is None:
                continue
            year = int(m["year"])
            dsid = dataset_by_year.get(year)
            if dsid is None:
                month_missing.append({"position": pos, "reason": f"no dataset for year {year}"})
                continue
            rec = factors.get((int(dsid), str(scope), oid))
            if rec is None or rec.factor is None:
                month_missing.append({"position": pos, "reason": f"factor missing for dataset {dsid}"})
                continue
            if factor_rec_primary is None:
                factor_rec_primary = rec
            month_datasets[pos] = int(dsid)
            month_emissions[pos] = _to_tco2e(float(qty), float(rec.factor), rec.ghg_unit)

        if not month_emissions:
            unresolved_rows.append({**row, "reason": "no mappable monthly factor data", "month_errors": month_missing})
            continue

        dataset_counter = Counter(month_datasets.values())
        primary_dataset = int(dataset_counter.most_common(1)[0][0]) if dataset_counter else None
        total_emissions = float(sum(month_emissions.values()))
        key = (str(scope), oid)
        collision_tracker[key] += 1

        entry = aggregate.get(key)
        if entry is None:
            entry = {
                "scope": str(scope),
                "original_id": oid,
                "dataset_id": primary_dataset,
                "factor_db_id": (factor_rec_primary.db_id if factor_rec_primary else None),
                "level_1": (factor_rec_primary.level_1 if factor_rec_primary else None),
                "level_2": (factor_rec_primary.level_2 if factor_rec_primary else None),
                "level_3": (factor_rec_primary.level_3 if factor_rec_primary else None),
                "level_4": (factor_rec_primary.level_4 if factor_rec_primary else None),
                "column_text": (factor_rec_primary.column_text if factor_rec_primary else None),
                "report_label": (factor_rec_primary.report_label if factor_rec_primary else row.get("activity")),
                "category": (factor_rec_primary.level_2 if factor_rec_primary else row.get("activity")),
                "monthly_emissions": {i: 0.0 for i in range(1, 13)},
                "monthly_dataset_ids": {},
                "qty": 0.0,
                "source_rows": [],
                "month_errors": [],
            }
            aggregate[key] = entry

        for pos, val in month_emissions.items():
            entry["monthly_emissions"][int(pos)] = float(entry["monthly_emissions"][int(pos)]) + float(val)
            if pos in month_datasets:
                entry["monthly_dataset_ids"][int(pos)] = int(month_datasets[pos])
        entry["qty"] = float(entry["qty"]) + total_emissions
        entry["source_rows"].append({"sheet": row.get("sheet_name"), "row": row.get("row_number"), "activity": row.get("activity")})
        entry["month_errors"].extend(month_missing)

    for (_scope, _oid), entry in aggregate.items():
        staged_rows.append(
            {
                "scope": entry["scope"],
                "original_id": entry["original_id"],
                "dataset_id": entry["dataset_id"],
                "factor_db_id": entry["factor_db_id"],
                "level_1": entry["level_1"],
                "level_2": entry["level_2"],
                "level_3": entry["level_3"],
                "level_4": entry["level_4"],
                "column_text": entry["column_text"],
                "report_label": entry["report_label"],
                "category": entry["category"],
                "qty": float(entry["qty"]),
                "uom": "tCO2e",
                "ghg_unit": "tCO2e",
                "factor": 1.0,
                "calc_tco2e": float(entry["qty"]),
                "month_1": float(entry["monthly_emissions"].get(1, 0.0)),
                "month_2": float(entry["monthly_emissions"].get(2, 0.0)),
                "month_3": float(entry["monthly_emissions"].get(3, 0.0)),
                "month_4": float(entry["monthly_emissions"].get(4, 0.0)),
                "month_5": float(entry["monthly_emissions"].get(5, 0.0)),
                "month_6": float(entry["monthly_emissions"].get(6, 0.0)),
                "month_7": float(entry["monthly_emissions"].get(7, 0.0)),
                "month_8": float(entry["monthly_emissions"].get(8, 0.0)),
                "month_9": float(entry["monthly_emissions"].get(9, 0.0)),
                "month_10": float(entry["monthly_emissions"].get(10, 0.0)),
                "month_11": float(entry["monthly_emissions"].get(11, 0.0)),
                "month_12": float(entry["monthly_emissions"].get(12, 0.0)),
                "monthly_dataset_ids": entry["monthly_dataset_ids"],
                "month_errors": entry["month_errors"],
                "source_rows": entry["source_rows"],
                "collision_count": int(collision_tracker[(entry["scope"], entry["original_id"])]),
            }
        )

    collision_rows = [x for x in staged_rows if int(x.get("collision_count") or 1) > 1]
    if collision_rows:
        parse_warnings.append(f"{len(collision_rows)} mapped IDs were aggregated from multiple source rows (schema unique key).")

    parse_warnings.append(
        "Monthly values are committed as tCO2e emissions using year-specific factors (factor=1, ghg_unit=tCO2e)."
    )

    return {
        "ok": True,
        "summary": {
            "parsed_rows": len(parsed_rows),
            "resolved_rows": len(staged_rows),
            "unresolved_rows": len(unresolved_rows),
            "collision_rows": len(collision_rows),
            "dataset_years_available": sorted(dataset_by_year.keys()),
        },
        "warnings": parse_warnings,
        "rows_ready": staged_rows,
        "rows_unresolved": unresolved_rows[:500],
    }


def _resolve_site_id(job_id: int, site_id: int | None) -> int:
    with get_conn() as con:
        job = con.execute("SELECT client_db_id FROM jobs WHERE job_id=%s", [int(job_id)]).fetchone()
        if not job:
            raise ValueError("Job not found")
        client_db_id = int(job[0])
        if site_id is not None:
            ok = con.execute(
                "SELECT 1 FROM client_sites WHERE site_id=%s AND client_db_id=%s",
                [int(site_id), int(client_db_id)],
            ).fetchone()
            if not ok:
                raise ValueError("site_id does not belong to this job's client")
            return int(site_id)
        row = con.execute(
            """
            SELECT site_id
            FROM client_sites
            WHERE client_db_id=%s
            ORDER BY is_registered_office DESC, site_id ASC
            LIMIT 1
            """,
            [int(client_db_id)],
        ).fetchone()
        if not row:
            raise ValueError("No site found for this job/client")
        return int(row[0])


def commit_legacy_rows(job_id: int, site_id: int | None, rows: list[dict[str, Any]]) -> dict[str, Any]:
    effective_site_id = _resolve_site_id(int(job_id), int(site_id) if site_id is not None else None)
    inserted = 0
    updated = 0
    with get_conn() as con:
        for r in rows:
            scope = _clean(r.get("scope"))
            original_id = _clean(r.get("original_id"))
            if not scope or not original_id:
                continue

            existing = con.execute(
                """
                SELECT row_id
                FROM job_scope_rows
                WHERE job_id=%s AND site_id=%s AND scope=%s AND original_id=%s
                LIMIT 1
                """,
                [int(job_id), int(effective_site_id), scope, original_id],
            ).fetchone()

            params_common = [
                r.get("dataset_id"),
                r.get("factor_db_id"),
                float(r.get("qty") or 0),
                r.get("uom") or "tCO2e",
                float(r.get("factor") or 1.0),
                r.get("ghg_unit") or "tCO2e",
                float(r.get("calc_tco2e") or 0),
                r.get("level_1"),
                r.get("level_2"),
                r.get("level_3"),
                r.get("level_4"),
                r.get("column_text"),
                r.get("report_label"),
                r.get("category"),
                float(r.get("month_1") or 0),
                float(r.get("month_2") or 0),
                float(r.get("month_3") or 0),
                float(r.get("month_4") or 0),
                float(r.get("month_5") or 0),
                float(r.get("month_6") or 0),
                float(r.get("month_7") or 0),
                float(r.get("month_8") or 0),
                float(r.get("month_9") or 0),
                float(r.get("month_10") or 0),
                float(r.get("month_11") or 0),
                float(r.get("month_12") or 0),
            ]

            if existing:
                con.execute(
                    """
                    UPDATE job_scope_rows
                    SET enabled=TRUE,
                        dataset_id=%s,
                        factor_db_id=%s,
                        qty=%s,
                        uom=%s,
                        factor=%s,
                        ghg_unit=%s,
                        calc_tco2e=%s,
                        level_1=%s,
                        level_2=%s,
                        level_3=%s,
                        level_4=%s,
                        column_text=%s,
                        report_label=%s,
                        category=%s,
                        month_1=%s, month_2=%s, month_3=%s, month_4=%s, month_5=%s, month_6=%s,
                        month_7=%s, month_8=%s, month_9=%s, month_10=%s, month_11=%s, month_12=%s,
                        apply_pct=100,
                        data_source='Legacy Annual Upload',
                        data_confidence='M',
                        notes='Legacy annual import; monthly values stored as tCO2e using year-specific datasets',
                        updated_at=NOW()
                    WHERE row_id=%s
                    """,
                    [*params_common, int(existing[0])],
                )
                updated += 1
            else:
                con.execute(
                    """
                    INSERT INTO job_scope_rows (
                        job_id, site_id, scope, category, dataset_id, factor_db_id, original_id,
                        level_1, level_2, level_3, level_4, column_text, report_label, notes, enabled,
                        qty, uom, factor, ghg_unit, calc_tco2e, override_tco2e, override_reason,
                        month_1, month_2, month_3, month_4, month_5, month_6,
                        month_7, month_8, month_9, month_10, month_11, month_12,
                        apply_pct, data_source, data_confidence, is_custom_entry, created_at, updated_at
                    )
                    VALUES (
                        %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s, 'Legacy annual import; monthly values stored as tCO2e using year-specific datasets', TRUE,
                        %s, %s, %s, %s, %s, NULL, NULL,
                        %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s,
                        100, 'Legacy Annual Upload', 'M', FALSE, NOW(), NOW()
                    )
                    """,
                    [
                        int(job_id),
                        int(effective_site_id),
                        scope,
                        r.get("category"),
                        r.get("dataset_id"),
                        r.get("factor_db_id"),
                        original_id,
                        r.get("level_1"),
                        r.get("level_2"),
                        r.get("level_3"),
                        r.get("level_4"),
                        r.get("column_text"),
                        r.get("report_label"),
                        float(r.get("qty") or 0),
                        r.get("uom") or "tCO2e",
                        float(r.get("factor") or 1.0),
                        r.get("ghg_unit") or "tCO2e",
                        float(r.get("calc_tco2e") or 0),
                        float(r.get("month_1") or 0),
                        float(r.get("month_2") or 0),
                        float(r.get("month_3") or 0),
                        float(r.get("month_4") or 0),
                        float(r.get("month_5") or 0),
                        float(r.get("month_6") or 0),
                        float(r.get("month_7") or 0),
                        float(r.get("month_8") or 0),
                        float(r.get("month_9") or 0),
                        float(r.get("month_10") or 0),
                        float(r.get("month_11") or 0),
                        float(r.get("month_12") or 0),
                    ],
                )
                inserted += 1

    return {"ok": True, "job_id": int(job_id), "site_id": int(effective_site_id), "inserted": inserted, "updated": updated}


def resolve_unresolved_rows(
    rows_ready: list[dict[str, Any]],
    rows_unresolved: list[dict[str, Any]],
    manual_lookup: dict[str, str] | None = None,
) -> dict[str, Any]:
    manual_lookup = manual_lookup or {}
    dataset_by_year = _dataset_by_year()

    seed_rows: list[dict[str, Any]] = list(rows_ready or [])
    unresolved_rows: list[dict[str, Any]] = []
    to_process: list[dict[str, Any]] = []

    for row in rows_unresolved or []:
        r = dict(row)
        oid = _clean(r.get("original_id"))
        lk = _clean(r.get("lookup_key"))
        if not oid and lk and _clean(manual_lookup.get(lk)):
            oid = _clean(manual_lookup.get(lk))
            r["original_id"] = oid
            r["match_source"] = "manual_override"
        if not oid:
            r["reason"] = "missing original_id after manual override"
            unresolved_rows.append(r)
            continue
        if not _norm_scope(r.get("scope")) and not _clean(r.get("scope")):
            r["reason"] = "missing scope"
            unresolved_rows.append(r)
            continue
        to_process.append(r)

    factor_req: dict[tuple[int, str], set[str]] = defaultdict(set)
    for row in to_process:
        scope = _clean(row.get("scope"))
        oid = _clean(row.get("original_id"))
        for m in row.get("month_headers") or []:
            year = int(m.get("year"))
            dsid = dataset_by_year.get(year)
            if dsid is not None:
                factor_req[(int(dsid), scope)].add(oid)
    factors = _factor_lookup_batch(factor_req)

    aggregate: dict[tuple[str, str], dict[str, Any]] = {}
    for row in to_process:
        scope = _clean(row.get("scope"))
        oid = _clean(row.get("original_id"))
        month_emissions: dict[int, float] = {}
        month_datasets: dict[int, int] = {}
        month_errors: list[dict[str, Any]] = []
        factor_primary: FactorRec | None = None

        for m in row.get("month_headers") or []:
            pos = int(m.get("position"))
            qty = _safe_float((row.get("monthly_qty") or {}).get(pos))
            if qty is None:
                continue
            year = int(m.get("year"))
            dsid = dataset_by_year.get(year)
            if dsid is None:
                month_errors.append({"position": pos, "reason": f"no dataset for year {year}"})
                continue
            rec = factors.get((int(dsid), scope, oid))
            if rec is None or rec.factor is None:
                month_errors.append({"position": pos, "reason": f"factor missing for dataset {dsid}"})
                continue
            if factor_primary is None:
                factor_primary = rec
            month_datasets[pos] = int(dsid)
            month_emissions[pos] = _to_tco2e(float(qty), float(rec.factor), rec.ghg_unit)

        if not month_emissions:
            row["reason"] = "manual original_id did not resolve to monthly factor data"
            row["month_errors"] = month_errors
            unresolved_rows.append(row)
            continue

        key = (scope, oid)
        ds_counter = Counter(month_datasets.values())
        primary_dataset = int(ds_counter.most_common(1)[0][0]) if ds_counter else None
        total = float(sum(month_emissions.values()))
        if key not in aggregate:
            aggregate[key] = {
                "scope": scope,
                "original_id": oid,
                "dataset_id": primary_dataset,
                "factor_db_id": (factor_primary.db_id if factor_primary else None),
                "level_1": (factor_primary.level_1 if factor_primary else None),
                "level_2": (factor_primary.level_2 if factor_primary else None),
                "level_3": (factor_primary.level_3 if factor_primary else None),
                "level_4": (factor_primary.level_4 if factor_primary else None),
                "column_text": (factor_primary.column_text if factor_primary else None),
                "report_label": (factor_primary.report_label if factor_primary else row.get("activity")),
                "category": (factor_primary.level_2 if factor_primary else row.get("activity")),
                "monthly_emissions": {i: 0.0 for i in range(1, 13)},
                "monthly_dataset_ids": {},
                "qty": 0.0,
                "source_rows": [],
                "month_errors": [],
            }
        entry = aggregate[key]
        for pos, val in month_emissions.items():
            entry["monthly_emissions"][int(pos)] = float(entry["monthly_emissions"][int(pos)]) + float(val)
            if pos in month_datasets:
                entry["monthly_dataset_ids"][int(pos)] = int(month_datasets[pos])
        entry["qty"] = float(entry["qty"]) + total
        entry["source_rows"].append({"sheet": row.get("sheet_name"), "row": row.get("row_number"), "activity": row.get("activity")})
        entry["month_errors"].extend(month_errors)

    for _key, entry in aggregate.items():
        seed_rows.append(
            {
                "scope": entry["scope"],
                "original_id": entry["original_id"],
                "dataset_id": entry["dataset_id"],
                "factor_db_id": entry["factor_db_id"],
                "level_1": entry["level_1"],
                "level_2": entry["level_2"],
                "level_3": entry["level_3"],
                "level_4": entry["level_4"],
                "column_text": entry["column_text"],
                "report_label": entry["report_label"],
                "category": entry["category"],
                "qty": float(entry["qty"]),
                "uom": "tCO2e",
                "ghg_unit": "tCO2e",
                "factor": 1.0,
                "calc_tco2e": float(entry["qty"]),
                "month_1": float(entry["monthly_emissions"].get(1, 0.0)),
                "month_2": float(entry["monthly_emissions"].get(2, 0.0)),
                "month_3": float(entry["monthly_emissions"].get(3, 0.0)),
                "month_4": float(entry["monthly_emissions"].get(4, 0.0)),
                "month_5": float(entry["monthly_emissions"].get(5, 0.0)),
                "month_6": float(entry["monthly_emissions"].get(6, 0.0)),
                "month_7": float(entry["monthly_emissions"].get(7, 0.0)),
                "month_8": float(entry["monthly_emissions"].get(8, 0.0)),
                "month_9": float(entry["monthly_emissions"].get(9, 0.0)),
                "month_10": float(entry["monthly_emissions"].get(10, 0.0)),
                "month_11": float(entry["monthly_emissions"].get(11, 0.0)),
                "month_12": float(entry["monthly_emissions"].get(12, 0.0)),
                "monthly_dataset_ids": entry["monthly_dataset_ids"],
                "month_errors": entry["month_errors"],
                "source_rows": entry["source_rows"],
                "collision_count": 1,
            }
        )

    # Merge duplicates by scope+original_id across existing ready + newly resolved.
    merged: dict[tuple[str, str], dict[str, Any]] = {}
    for row in seed_rows:
        scope = _clean(row.get("scope"))
        oid = _clean(row.get("original_id"))
        if not scope or not oid:
            continue
        key = (scope, oid)
        if key not in merged:
            merged[key] = dict(row)
            continue
        cur = merged[key]
        for i in range(1, 13):
            cur[f"month_{i}"] = float(cur.get(f"month_{i}") or 0) + float(row.get(f"month_{i}") or 0)
        cur["qty"] = float(cur.get("qty") or 0) + float(row.get("qty") or 0)
        cur["calc_tco2e"] = float(cur.get("calc_tco2e") or 0) + float(row.get("calc_tco2e") or 0)
        cur["collision_count"] = int(cur.get("collision_count") or 1) + 1

    merged_rows = list(merged.values())
    return {
        "ok": True,
        "rows_ready": merged_rows,
        "rows_unresolved": unresolved_rows,
        "summary": {
            "resolved_rows": len(merged_rows),
            "unresolved_rows": len(unresolved_rows),
        },
    }
