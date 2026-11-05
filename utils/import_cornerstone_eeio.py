"""Import Cornerstone (CEDA) EEIO spend-based emission factors.

Loads the purchaser-price sheets ({YEAR}PUR) of the Cornerstone workbook as
one dataset per country per year, priced in that country's own currency, so
the dataset selector picks them like any other country dataset. Factors are
published in kgCO2e per USD of the same year; each is divided by the
workbook's own exchange rate for that year (local currency per USD).

Countries already covered by their own national datasets (UK and UAE) are
skipped. The earliest year's datasets also cover earlier reporting periods
and the latest year's cover later ones (nearest year, no inflation
adjustment).

Re-running with a newer workbook (e.g. the final release after the release
candidate) updates the same datasets and factor rows in place, so factor
db_ids stay stable and the spend-factor refresh flow can show the changes.

The run also archives the previous "CEDA 2025 (Watershed)" import and moves
job_additional_datasets links from it to the matching new 2025 dataset.

Everything runs in one transaction, followed by a reconciliation of every
stored factor against the workbook and a before/after comparison of the
datasets every open job resolves to. It is a dry run (rolled back) unless
--commit is given, and it never commits if the reconciliation fails.

Usage:
    python utils/import_cornerstone_eeio.py <workbook.xlsx> [--commit] [--skip GBR,ARE]
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

SOURCE = "Cornerstone EEIO"
OLD_SOURCE = "CEDA 2025 (Watershed)"
LICENSE = "CC BY 4.0"
DEFAULT_SKIP = ("GBR", "ARE")
OPEN_START = date(1990, 1, 1)
OPEN_END = date(2099, 12, 31)
ACTOR = "cornerstone-eeio-import"
RECONCILE_REL_TOL = 1e-9

BUSINESS_TRAVEL = {"481000", "482000", "485000", "721000"}
UPSTREAM_TRANSPORT = {"483000", "484000", "486000", "48A000", "491000", "492000", "493000"}
WASTE = {"562111", "562HAZ", "562212", "562213", "562920", "562OTH"}


def ghg_category(code: str) -> str:
    """GHG Protocol Scope 3 category for a Cornerstone sector, matching the
    categories DEFRA spend factors use. Remediation services (562910) stay in
    purchased goods and services."""
    if code in BUSINESS_TRAVEL:
        return "Business Travel"
    if code in UPSTREAM_TRANSPORT:
        return "Upstream Transportation and Distribution"
    if code in WASTE:
        return "Waste Generated in Operations"
    return "Purchased Goods and Services"


def original_id(iso: str, code: str) -> str:
    # Country in the id so lines priced in different countries never merge
    # when pushed to scope data; no year so the identity rolls forward.
    return f"CEDA-{iso}-{code}"


@dataclass
class WorkbookData:
    version: str
    doi: str
    file_name: str
    years: list[int]
    sectors: dict[str, str]
    locations: dict[str, dict[str, str]]
    # iso -> year -> (currency, local currency per USD). A country can change
    # currency between years (Bulgaria: BGN to EUR in 2026).
    fx: dict[str, dict[int, tuple[str, float]]]
    factors: dict[int, dict[tuple[str, str], float]]
    duplicates: list[str] = field(default_factory=list)

    def country_years(self, iso: str) -> list[int]:
        """Years with both factors and an exchange rate for this country."""
        return [yr for yr in self.years if yr in self.fx.get(iso, {})]


def load_workbook_data(path: Path) -> WorkbookData:
    import openpyxl

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)

    cover: dict[str, Any] = {}
    for row in wb["Cover"].iter_rows(values_only=True):
        cells = [c for c in row if c not in (None, "")]
        if len(cells) >= 2:
            cover[str(cells[0]).strip()] = cells[1]
    version = str(cover.get("Version") or "").split()[0]

    sectors = {
        str(r[0]).strip(): str(r[1]).strip()
        for r in wb["Sector Descriptions"].iter_rows(min_row=2, values_only=True)
        if r[0]
    }
    locations = {
        str(r[0]).strip(): {"name": str(r[1]).strip(), "region": str(r[3] or "").strip(), "has_efs": str(r[4]).strip()}
        for r in wb["Locations"].iter_rows(min_row=2, values_only=True)
        if r[0]
    }

    fx_rows = wb["Exchange Rates"].iter_rows(values_only=True)
    header = [str(h).strip() if h is not None else "" for h in next(fx_rows)]
    year_cols = {int(h): i for i, h in enumerate(header) if re.fullmatch(r"\d{4}", h)}
    fx: dict[str, dict[int, tuple[str, float]]] = defaultdict(dict)
    for r in fx_rows:
        if not r[0]:
            continue
        currency = str(r[2] or "").strip()
        for yr, idx in year_cols.items():
            try:
                rate = float(r[idx])
            except (TypeError, ValueError):
                continue
            if currency and rate > 0:
                fx[str(r[0]).strip()][yr] = (currency, rate)

    years = sorted(int(m.group(1)) for name in wb.sheetnames if (m := re.fullmatch(r"(\d{4})PUR", name)))
    factors: dict[int, dict[tuple[str, str], float]] = {}
    duplicates: list[str] = []
    for yr in years:
        values: dict[tuple[str, str], float] = {}
        for r in wb[f"{yr}PUR"].iter_rows(min_row=2, values_only=True):
            if not r[0]:
                continue
            key = (str(r[2]).strip(), str(r[0]).strip())
            if key in values:
                duplicates.append(f"{yr}PUR {key[0]} {key[1]}")
            values[key] = float(r[4]) if r[4] not in (None, "") else float("nan")
        factors[yr] = values

    return WorkbookData(
        version=version,
        doi=str(cover.get("DOI") or ""),
        file_name=path.name,
        years=years,
        sectors=sectors,
        locations=locations,
        fx=dict(fx),
        factors=factors,
        duplicates=duplicates,
    )


def countries_to_import(data: WorkbookData, skip: set[str]) -> list[str]:
    return sorted(iso for iso, loc in data.locations.items() if loc["has_efs"] == "Yes" and iso not in skip)


def validate(data: WorkbookData, countries: list[str]) -> list[str]:
    errors: list[str] = []
    if not data.version:
        errors.append("Cover sheet has no Version")
    if not data.years:
        errors.append("No {YEAR}PUR sheets found")
    errors.extend(f"Duplicate row {d}" for d in data.duplicates[:20])
    codes = set(data.sectors)
    for yr in data.years:
        by_loc: dict[str, set[str]] = defaultdict(set)
        for (loc, code), value in data.factors[yr].items():
            by_loc[loc].add(code)
            if value != value or value < 0:
                errors.append(f"{yr}PUR {loc} {code}: factor {value!r} is not a non-negative number")
        for iso in countries:
            got = by_loc.get(iso, set())
            if got != codes:
                errors.append(
                    f"{yr}PUR {iso}: {len(got)} sectors, expected {len(codes)} "
                    f"(missing {sorted(codes - got)[:5]}, unexpected {sorted(got - codes)[:5]})"
                )
    for iso in countries:
        if not data.country_years(iso):
            errors.append(f"{iso}: no exchange rate for any year")
    return errors


def missing_years(data: WorkbookData, countries: list[str]) -> dict[str, list[int]]:
    """Countries left without a dataset for some years for lack of an
    exchange rate; their nearest available year covers those periods."""
    return {
        iso: [yr for yr in data.years if yr not in data.country_years(iso)]
        for iso in countries
        if len(data.country_years(iso)) < len(data.years)
    }


def dataset_window(year: int, years: list[int]) -> tuple[date, date]:
    start = OPEN_START if year == min(years) else date(year, 1, 1)
    end = OPEN_END if year == max(years) else date(year, 12, 31)
    return start, end


def dataset_meta(data: WorkbookData, iso: str, year: int) -> dict[str, Any]:
    loc = data.locations[iso]
    currency, rate = data.fx[iso][year]
    years = data.country_years(iso)
    valid_from, valid_to = dataset_window(year, years)
    coverage = ""
    if year == min(years):
        coverage = f" Also applies to reporting periods before {year} (nearest available year, no inflation adjustment)."
    if year == max(years):
        coverage += f" Also applies to reporting periods after {year} (nearest available year, no inflation adjustment)."
    return {
        "name": f"CEDA {data.version} - {loc['name']} {year} ({currency})",
        "source": SOURCE,
        "analysis_type": "Spend",
        "country": loc["name"],
        "country_code": iso,
        "region": loc["region"],
        "currency": currency,
        "year": year,
        "version": data.version,
        "license": LICENSE,
        "valid_from": valid_from,
        "valid_to": valid_to,
        "notes": (
            f"Cornerstone EEIO spend-based GHG emission factors, version {data.version} ({data.doi}). "
            f"Purchaser price, cradle-to-gate, IPCC AR6 GWP100. Published in kgCO2e per USD of {year}; "
            f"converted to kgCO2e per {currency} using the workbook's {year} exchange rate of {rate} {currency}/USD."
            f"{coverage} Imported from '{data.file_name}'."
        ),
    }


def factor_rows(data: WorkbookData, iso: str, year: int, dataset_id: int) -> list[list[Any]]:
    """Rows in the factor_lookup column order used by ingest_conversion_factors."""
    meta = dataset_meta(data, iso, year)
    rate = data.fx[iso][year][1]
    rows = []
    for code, sector in sorted(data.sectors.items()):
        usd_factor = data.factors[year][(iso, code)]
        column_text = f"{sector} - {meta['country']}"
        if usd_factor == 0:
            column_text += " (zero in source data)"
        rows.append([
            dataset_id,                  # dataset_id
            data.file_name,              # file_name
            year,                        # year
            original_id(iso, code),      # original_id
            "Scope 3",                   # scope
            ghg_category(code),          # category
            sector,                      # level_1
            meta["country"],             # level_2
            code,                        # level_3
            "",                          # level_4
            column_text,                 # column_text
            meta["currency"],            # uom
            "kgCO2e",                    # ghg_unit
            usd_factor / rate,           # factor (kgCO2e per local currency unit)
            f"{SOURCE} {data.version}",  # source
            meta["country"],             # region
            meta["currency"],            # currency
            "Spend",                     # method
            meta["valid_from"],          # valid_from
            meta["valid_to"],            # valid_to
            sector,                      # report_label
        ])
    return rows


FACTOR_COLUMNS = (
    "dataset_id, file_name, year, original_id, scope, category, level_1, level_2, level_3, level_4, "
    "column_text, uom, ghg_unit, factor, source, region, currency, method, valid_from, valid_to, report_label"
)


def upsert_dataset(cur, meta: dict[str, Any], org_id: Any) -> int:
    cur.execute(
        """
        SELECT dataset_id FROM datasets
        WHERE source = %s AND country_code = %s AND year = %s AND NOT COALESCE(archived, FALSE)
        ORDER BY dataset_id
        """,
        [SOURCE, meta["country_code"], meta["year"]],
    )
    found = cur.fetchall()
    if len(found) > 1:
        raise RuntimeError(f"More than one {SOURCE} dataset for {meta['country_code']} {meta['year']}: {found}")
    cols = ["name", "analysis_type", "country", "region", "currency", "version", "license", "notes", "valid_from", "valid_to"]
    if found:
        dataset_id = int(found[0][0])
        cur.execute(
            f"UPDATE datasets SET {', '.join(f'{c} = %s' for c in cols)} WHERE dataset_id = %s",
            [meta[c] for c in cols] + [dataset_id],
        )
        return dataset_id
    all_cols = cols + ["source", "country_code", "year", "org_id"]
    cur.execute(
        f"INSERT INTO datasets ({', '.join(all_cols)}) VALUES ({', '.join(['%s'] * len(all_cols))}) RETURNING dataset_id",
        [meta[c] for c in cols] + [SOURCE, meta["country_code"], meta["year"], org_id],
    )
    return int(cur.fetchone()[0])


def write_factor_rows(cur, rows: list[list[Any]], dataset_ids: list[int]) -> dict[str, int]:
    cur.execute(
        """
        CREATE TEMP TABLE tmp_eeio_import (
            dataset_id INTEGER, file_name VARCHAR, year INTEGER, original_id VARCHAR, scope VARCHAR,
            category VARCHAR, level_1 VARCHAR, level_2 VARCHAR, level_3 VARCHAR, level_4 VARCHAR,
            column_text VARCHAR, uom VARCHAR, ghg_unit VARCHAR, factor NUMERIC, source VARCHAR,
            region VARCHAR, currency VARCHAR, method VARCHAR, valid_from DATE, valid_to DATE,
            report_label VARCHAR
        ) ON COMMIT DROP
        """
    )
    with cur.copy(f"COPY tmp_eeio_import ({FACTOR_COLUMNS}) FROM STDIN") as copy:
        for row in rows:
            copy.write_row(row)

    # Rows a newer workbook no longer has: delete unless something uses them.
    cur.execute(
        """
        SELECT f.db_id FROM factor_lookup f
        WHERE f.dataset_id = ANY(%s)
          AND NOT EXISTS (
              SELECT 1 FROM tmp_eeio_import t
              WHERE t.dataset_id = f.dataset_id AND t.year = f.year
                AND t.scope = f.scope AND t.original_id = f.original_id)
        """,
        [dataset_ids],
    )
    stale = [int(r[0]) for r in cur.fetchall()]
    kept = 0
    if stale:
        cur.execute(
            """
            SELECT DISTINCT factor_db_id FROM job_scope_rows WHERE factor_db_id = ANY(%s)
            UNION SELECT DISTINCT factor_db_id FROM job_spend_entries WHERE factor_db_id = ANY(%s)
            UNION SELECT DISTINCT factor_db_id FROM client_spend_mappings WHERE factor_db_id = ANY(%s)
            """,
            [stale, stale, stale],
        )
        used = {int(r[0]) for r in cur.fetchall() if r[0] is not None}
        kept = len(used)
        delete_ids = [i for i in stale if i not in used]
        if delete_ids:
            cur.execute("DELETE FROM emission_factor_year_values WHERE factor_id = ANY(%s)", [delete_ids])
            cur.execute("DELETE FROM emission_factor_aliases WHERE factor_id = ANY(%s)", [delete_ids])
            cur.execute("DELETE FROM emission_factor_definitions WHERE factor_id = ANY(%s)", [delete_ids])
            cur.execute("DELETE FROM factor_lookup WHERE db_id = ANY(%s)", [delete_ids])

    cur.execute(
        """
        UPDATE factor_lookup AS f
        SET file_name = t.file_name, category = t.category, level_1 = t.level_1, level_2 = t.level_2,
            level_3 = t.level_3, level_4 = t.level_4, column_text = t.column_text, uom = t.uom,
            ghg_unit = t.ghg_unit, factor = t.factor, source = t.source, region = t.region,
            currency = t.currency, method = t.method, valid_from = t.valid_from, valid_to = t.valid_to,
            report_label = t.report_label
        FROM tmp_eeio_import AS t
        WHERE f.dataset_id = t.dataset_id AND f.year = t.year AND f.scope = t.scope AND f.original_id = t.original_id
        """
    )
    updated = cur.rowcount
    cur.execute(
        f"""
        INSERT INTO factor_lookup ({FACTOR_COLUMNS})
        SELECT {', '.join('t.' + c.strip() for c in FACTOR_COLUMNS.split(','))}
        FROM tmp_eeio_import AS t
        WHERE NOT EXISTS (
            SELECT 1 FROM factor_lookup f
            WHERE f.dataset_id = t.dataset_id AND f.year = t.year AND f.scope = t.scope AND f.original_id = t.original_id)
        """
    )
    return {"inserted": cur.rowcount, "updated": updated, "deleted": len(stale) - kept, "stale_kept": kept}


def retire_old_import(cur, new_2025: dict[str, int]) -> dict[str, Any]:
    """Archive the previous CEDA 2025 import and move job_additional_datasets
    links to the new 2025 dataset for the same country (the old file names
    start with the ISO3 code, e.g. 'ESP_Spain.csv')."""
    cur.execute(
        """
        SELECT d.dataset_id, MIN(f.file_name)
        FROM datasets d LEFT JOIN factor_lookup f ON f.dataset_id = d.dataset_id
        WHERE d.source = %s AND NOT COALESCE(d.archived, FALSE)
        GROUP BY d.dataset_id
        """,
        [OLD_SOURCE],
    )
    old = {int(dsid): str(fname or "")[:3].upper() for dsid, fname in cur.fetchall()}
    moved, left = [], []
    if old:
        cur.execute(
            "SELECT job_id, dataset_id FROM job_additional_datasets WHERE dataset_id = ANY(%s) ORDER BY job_id, dataset_id",
            [list(old)],
        )
        for job_id, dsid in cur.fetchall():
            target = new_2025.get(old[int(dsid)])
            if target is None:
                left.append((int(job_id), int(dsid), old[int(dsid)]))
                continue
            cur.execute(
                """
                INSERT INTO job_additional_datasets (job_id, dataset_id)
                SELECT %s, %s WHERE NOT EXISTS (
                    SELECT 1 FROM job_additional_datasets WHERE job_id = %s AND dataset_id = %s)
                """,
                [job_id, target, job_id, target],
            )
            cur.execute("DELETE FROM job_additional_datasets WHERE job_id = %s AND dataset_id = %s", [job_id, dsid])
            moved.append((int(job_id), int(dsid), target))
        cur.execute(
            "UPDATE datasets SET archived = TRUE, archived_at = %s, archived_by = %s WHERE dataset_id = ANY(%s)",
            [datetime.now(timezone.utc).replace(tzinfo=None), ACTOR, list(old)],
        )
    return {"archived": len(old), "links_moved": moved, "links_left": left}


def reconcile(cur, data: WorkbookData, plan: dict[tuple[str, int], int]) -> list[str]:
    """Check every stored factor, via both factor_lookup and v_factor_lookup,
    against the workbook value converted at that year's exchange rate."""
    problems: list[str] = []
    cur.execute(
        """
        SELECT d.dataset_id, d.country_code, d.year, d.currency, d.country, d.valid_from, d.valid_to,
               COUNT(f.db_id), COUNT(DISTINCT f.uom), MIN(f.uom), COUNT(DISTINCT f.currency), MIN(f.currency)
        FROM datasets d LEFT JOIN factor_lookup f ON f.dataset_id = d.dataset_id
        WHERE d.dataset_id = ANY(%s)
        GROUP BY d.dataset_id
        """,
        [list(plan.values())],
    )
    expected_rows = len(data.sectors)
    for dsid, iso, yr, cur_code, country, vf, vt, n, n_uom, uom, n_ccy, ccy in cur.fetchall():
        meta = dataset_meta(data, iso, yr)
        if plan.get((iso, yr)) != dsid:
            problems.append(f"dataset {dsid}: ({iso}, {yr}) is not the planned dataset")
        if n != expected_rows:
            problems.append(f"dataset {dsid} {iso} {yr}: {n} factor rows, expected {expected_rows}")
        if (cur_code, country, vf, vt) != (meta["currency"], meta["country"], meta["valid_from"], meta["valid_to"]):
            problems.append(f"dataset {dsid} {iso} {yr}: metadata {(cur_code, country, vf, vt)} differs from workbook")
        if (n_uom, uom, n_ccy, ccy) != (1, meta["currency"], 1, meta["currency"]):
            problems.append(f"dataset {dsid} {iso} {yr}: factor units/currencies {(n_uom, uom, n_ccy, ccy)}")

    by_dataset = {dsid: key for key, dsid in plan.items()}
    for table in ("factor_lookup", "v_factor_lookup"):
        cur.execute(
            f"SELECT dataset_id, original_id, factor, currency FROM {table} WHERE dataset_id = ANY(%s)",
            [list(plan.values())],
        )
        checked = 0
        for dsid, oid, factor, ccy in cur.fetchall():
            iso, yr = by_dataset[int(dsid)]
            code = str(oid).split("-", 2)[2]
            currency, rate = data.fx[iso][yr]
            expected = data.factors[yr][(iso, code)]
            got_usd = float(factor) * rate
            if abs(got_usd - expected) > RECONCILE_REL_TOL * max(abs(expected), 1e-12):
                problems.append(f"{table} {iso} {yr} {code}: stored {factor} x {rate} = {got_usd}, workbook {expected}")
            if ccy != currency:
                problems.append(f"{table} {iso} {yr} {code}: currency {ccy!r}")
            checked += 1
        if checked != len(plan) * len(data.sectors):
            problems.append(f"{table}: checked {checked} rows, expected {len(plan) * len(data.sectors)}")

    cur.execute(
        """
        SELECT COUNT(*) FROM factor_lookup f
        WHERE f.dataset_id = ANY(%s)
          AND NOT EXISTS (SELECT 1 FROM emission_factor_aliases a WHERE a.dataset_id = f.dataset_id AND a.original_id = f.original_id)
        """,
        [list(plan.values())],
    )
    unsynced = cur.fetchone()[0]
    if unsynced:
        problems.append(f"{unsynced} factor rows have no emission_factor_aliases entry")
    return problems


def job_resolutions(con, job_ids: list[int]) -> dict[int, dict[str, tuple]]:
    from services import dataset_selector

    dataset_selector._datasets_cache = None
    dataset_selector._scope_map_cache.clear()
    out: dict[int, dict[str, tuple]] = {}
    for job_id in job_ids:
        try:
            res = dataset_selector.resolve_dataset_resolution(job_id, con=con)
            out[job_id] = {s["scope"]: tuple(s["dataset_names"]) for s in res.get("scope_summaries", [])}
        except Exception as exc:  # report, don't stop the run
            out[job_id] = {"error": (str(exc).splitlines()[0],)}
    return out


def job_emissions(con, job_ids: list[int]) -> dict[int, dict[str, float]]:
    """tCO2e by scope over each job's enabled scope rows, priced by the same
    month-aware resolver the reports use."""
    from services import dataset_selector
    from services.monthly_emissions import JobMonthlyEmissionsResolver

    dataset_selector._datasets_cache = None
    dataset_selector._scope_map_cache.clear()
    out: dict[int, dict[str, float]] = {}
    for job_id in job_ids:
        res = con.execute("SELECT * FROM job_scope_rows WHERE job_id = %s AND COALESCE(enabled, TRUE)", [job_id])
        cols = [d.name for d in res.cursor.description]
        rows = [dict(zip(cols, r)) for r in res.fetchall()]
        totals: dict[str, float] = defaultdict(float)
        try:
            resolver = JobMonthlyEmissionsResolver(con, job_id)
            for row in rows:
                totals[str(row.get("scope") or "")] += float(resolver.row_metrics(row).get("calc_tco2e") or 0.0)
        except Exception as exc:
            totals = {"error": str(exc).splitlines()[0]}  # type: ignore[dict-item]
        out[job_id] = {k: (round(v, 3) if isinstance(v, float) else v) for k, v in totals.items()}
    return out


class DryRun(Exception):
    pass


def run(path: Path, *, commit: bool, skip: set[str]) -> int:
    from core.database import get_conn
    from ingest_conversion_factors import _sync_normalised_tables_pg

    print(f"Reading {path.name} ...")
    data = load_workbook_data(path)
    countries = countries_to_import(data, skip)
    print(f"Version {data.version}, years {data.years}, {len(data.sectors)} sectors, {len(countries)} countries (skipping {sorted(skip)})")
    errors = validate(data, countries)
    if errors:
        print("Workbook validation failed:")
        for e in errors[:50]:
            print("  -", e)
        return 1
    for iso, yrs in missing_years(data, countries).items():
        print(f"  {iso} ({data.locations[iso]['name']}): no exchange rate for {yrs}; "
              f"its {data.country_years(iso)} dataset(s) cover those periods")

    # Schema change in its own short transaction, so the long import never
    # holds a table lock on datasets.
    with get_conn() as con:
        con.execute("ALTER TABLE datasets ADD COLUMN IF NOT EXISTS country_code VARCHAR(8)")

    report: dict[str, Any] = {}
    try:
        with get_conn(autocommit=False) as con:
            raw = con._conn  # type: ignore[attr-defined]
            with raw.cursor() as cur:
                # Loading ~180k rows outlasts the server's default statement
                # timeout; SET LOCAL ends with this transaction.
                cur.execute("SET LOCAL statement_timeout = '30min'")
                cur.execute(
                    """
                    SELECT j.job_id FROM jobs j
                    WHERE NOT COALESCE(j.archived, FALSE) AND j.reporting_period_start > DATE '1900-01-01'
                    ORDER BY j.job_id
                    """
                )
                job_ids = [int(r[0]) for r in cur.fetchall()]
                print(f"Resolving datasets for {len(job_ids)} jobs before the import ...")
                before = job_resolutions(con, job_ids)

                # Jobs the import can reach: non-UK clients, and jobs now
                # resolving to the old CEDA import.
                cur.execute(
                    """
                    SELECT j.job_id FROM jobs j JOIN clients c ON c.db_id = j.client_db_id
                    WHERE j.job_id = ANY(%s) AND COALESCE(c.addr_country, '') <> 'United Kingdom'
                    """,
                    [job_ids],
                )
                watch = {int(r[0]) for r in cur.fetchall()}
                watch |= {j for j, scopes in before.items() if any("CEDA" in n for names in scopes.values() for n in names)}
                watch_ids = sorted(watch)
                print(f"Pricing {len(watch_ids)} jobs before the import ...")
                emissions_before = job_emissions(con, watch_ids)

                cur.execute("SELECT org_id FROM datasets WHERE org_id IS NOT NULL GROUP BY org_id ORDER BY COUNT(*) DESC LIMIT 1")
                org_row = cur.fetchone()
                org_id = org_row[0] if org_row else None

                plan: dict[tuple[str, int], int] = {}
                rows: list[list[Any]] = []
                for iso in countries:
                    for yr in data.country_years(iso):
                        dsid = upsert_dataset(cur, dataset_meta(data, iso, yr), org_id)
                        plan[(iso, yr)] = dsid
                        rows.extend(factor_rows(data, iso, yr, dsid))
                print(f"Writing {len(rows)} factor rows into {len(plan)} datasets ...")
                report["factors"] = write_factor_rows(cur, rows, list(plan.values()))
                _sync_normalised_tables_pg(cur, rows)

                new_2025 = {iso: dsid for (iso, yr), dsid in plan.items() if yr == 2025}
                report["old_import"] = retire_old_import(cur, new_2025)

                print("Reconciling against the workbook ...")
                problems = reconcile(cur, data, plan)

                print("Resolving datasets for the same jobs after the import ...")
                after = job_resolutions(con, job_ids)
                print(f"Pricing the same {len(watch_ids)} jobs after the import ...")
                emissions_after = job_emissions(con, watch_ids)

            changed = {j: (before[j], after[j]) for j in job_ids if before[j] != after[j]}
            report["emissions"] = {
                j: (emissions_before[j], emissions_after[j])
                for j in watch_ids
                if emissions_before[j] != emissions_after[j]
            }
            report["unwatched_changes"] = sorted(set(changed) - watch)
            _print_report(data, plan, report, problems, changed)
            report["failed"] = bool(problems)
            if problems:
                print("\nReconciliation FAILED - nothing committed.")
                raise DryRun()
            if not commit:
                print("\nDry run - rolled back. Re-run with --commit to apply.")
                raise DryRun()
    except DryRun:
        return 1 if report.get("failed") else 0
    print("\nCommitted.")
    return 0


def _print_report(data, plan, report, problems, changed) -> None:
    f = report["factors"]
    print(f"\nDatasets: {len(plan)} ({len({k[0] for k in plan})} countries x {data.years})")
    print(f"Factor rows: inserted {f['inserted']}, updated {f['updated']}, deleted {f['deleted']}, stale but in use (kept) {f['stale_kept']}")
    old = report["old_import"]
    print(f"Old '{OLD_SOURCE}' datasets archived: {old['archived']}")
    for job_id, old_ds, new_ds in old["links_moved"]:
        print(f"  job {job_id}: extra dataset {old_ds} -> {new_ds}")
    for job_id, old_ds, iso in old["links_left"]:
        print(f"  job {job_id}: extra dataset {old_ds} ({iso}) has no new equivalent; link left on the archived dataset")
    print(f"Reconciliation problems: {len(problems)}")
    for p in problems[:30]:
        print("  -", p)
    print(f"Jobs whose resolved datasets change: {len(changed)}")
    for job_id, (b, a) in sorted(changed.items()):
        for scope in sorted(set(b) | set(a)):
            if b.get(scope) != a.get(scope):
                print(f"  job {job_id} {scope}: {list(b.get(scope, ()))} -> {list(a.get(scope, ()))}")
    if report["unwatched_changes"]:
        print(f"  (not priced, outside the watched set: jobs {report['unwatched_changes']})")
    print(f"Jobs whose calculated tCO2e changes: {len(report['emissions'])}")
    for job_id, (b, a) in sorted(report["emissions"].items()):
        print(f"  job {job_id}: {b} -> {a}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--commit", action="store_true", help="apply the import (default is a dry run)")
    parser.add_argument("--skip", default=",".join(DEFAULT_SKIP), help="ISO3 codes to leave out (default GBR,ARE)")
    args = parser.parse_args(argv)
    skip = {s.strip().upper() for s in args.skip.split(",") if s.strip()}
    return run(args.workbook, commit=args.commit, skip=skip)


if __name__ == "__main__":
    raise SystemExit(main())
