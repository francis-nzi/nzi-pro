from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

import pandas as pd

from core.database import db_backend, get_conn


def _norm_col(c: str) -> str:
    s = c.lower().strip().replace("_", " ")
    s = "".join(ch if (ch.isalnum() or ch.isspace()) else " " for ch in s)
    return " ".join(s.split())


def _pick(cols: dict[str, str], *names: str) -> str | None:
    for n in names:
        k = _norm_col(n)
        if k in cols:
            return cols[k]
        # allow year-suffixed variants like 'ghg conversion factor 2025'
        for ck, orig in cols.items():
            if ck.startswith(k):
                return orig
    return None


def _norm_scope(v: Any) -> str | None:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    s = str(v).strip()
    if not s or s.lower() == "nan":
        return None
    sl = s.replace(" ", "").replace("_", "").lower()
    if sl.startswith("scope1") or sl == "s1" or "scope1" in sl:
        return "Scope 1"
    if sl.startswith("scope2") or sl == "s2" or "scope2" in sl:
        return "Scope 2"
    if sl.startswith("scope3") or sl == "s3" or "scope3" in sl:
        return "Scope 3"
    if "scope 1" in s.lower():
        return "Scope 1"
    if "scope 2" in s.lower():
        return "Scope 2"
    if "scope 3" in s.lower():
        return "Scope 3"
    return s


def _norm_original_id(v: Any) -> str | None:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    if isinstance(v, float) and float(v).is_integer():
        return str(int(v))
    s = str(v).strip()
    if not s or s.lower() == "nan":
        return None
    if s.endswith(".0"):
        head = s[:-2]
        if head.isdigit():
            return head
    return s


def _norm_ghg_unit(v: Any) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return "kgCO2e"
    s = str(v).strip()
    if not s or s.lower() == "nan":
        return "kgCO2e"
    s = s.replace(" ", "")
    if s.lower() in ("kgco2e", "kgco₂e"):
        return "kgCO2e"
    return s


def _synth_column_text(r: pd.Series, c_text: str | None, c_l1: str | None, c_l2: str | None, c_l3: str | None, c_l4: str | None) -> str:
    if c_text is not None:
        v = r.get(c_text)
        if v is not None and not (isinstance(v, float) and pd.isna(v)):
            s = str(v).strip()
            if s and s.lower() != "nan":
                return s
    parts: list[str] = []
    for c in (c_l1, c_l2, c_l3, c_l4):
        if c is None:
            continue
        v = r.get(c)
        if v is None or (isinstance(v, float) and pd.isna(v)):
            continue
        s = str(v).strip()
        if s and s.lower() != "nan":
            parts.append(s)
    return " - ".join(parts) if parts else ""


def _dataset_meta_from_filename(path: Path) -> tuple[str, str, str, int, str]:
    name = path.stem
    lower = name.lower()
    analysis_type = "Activity" if "activity" in lower else ("Spend" if "spend" in lower else "")
    year = 0
    try:
        year = int(name.split("-")[0])
    except Exception:
        year = 0
    # Keep source simple; you can edit in DB later
    source = "DESNZ" if "desnz" in lower else ("DEFRA" if "defra" in lower else "")
    country = "UK"
    version = str(year) if year else ""
    return name, source, analysis_type, year, country


def _ensure_dataset(*, name: str, source: str, analysis_type: str, country: str, year: int) -> int:
    with get_conn() as con:
        row = con.execute(
            """
            SELECT dataset_id
            FROM datasets
            WHERE coalesce(name,'')=? AND coalesce(source,'')=? AND coalesce(analysis_type,'')=? AND coalesce(country,'')=? AND year=?
            ORDER BY dataset_id DESC
            LIMIT 1
            """,
            [name, source, analysis_type, country, int(year)],
        ).fetchone()
        if row:
            return int(row[0])

        if db_backend() == "postgres":
            new_row = con.execute(
                """
                INSERT INTO datasets (name, source, analysis_type, country, region, currency, year, version, license, notes)
                VALUES (%s,%s,%s,%s,NULL,NULL,%s,%s,NULL,%s)
                RETURNING dataset_id
                """,
                [name, source, analysis_type, country, int(year), str(year), f"Ingested from {name}"],
            ).fetchone()
            return int(new_row[0])

        # DuckDB fallback
        con.execute(
            """
            INSERT INTO datasets (dataset_id, name, source, analysis_type, country, region, currency, year, version, license, notes)
            VALUES ((SELECT COALESCE(MAX(dataset_id),0)+1 FROM datasets), ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, ?)
            """,
            [name, source, analysis_type, country, int(year), str(year), f"Ingested from {name}"],
        )
        row2 = con.execute(
            """
            SELECT dataset_id FROM datasets
            WHERE coalesce(name,'')=? AND coalesce(source,'')=? AND year=?
            ORDER BY dataset_id DESC
            LIMIT 1
            """,
            [name, source, int(year)],
        ).fetchone()
        return int(row2[0])


def _delete_dataset_factors(dataset_id: int) -> None:
    with get_conn() as con:
        if db_backend() == "postgres":
            con.execute("DELETE FROM factor_lookup WHERE dataset_id=%s", [int(dataset_id)])
        else:
            con.execute("DELETE FROM factor_lookup WHERE dataset_id=?", [int(dataset_id)])


def ingest_csv(path: Path, *, replace: bool) -> tuple[int, int]:
    df = pd.read_csv(path)
    cols = {_norm_col(c): c for c in df.columns}

    c_year = _pick(cols, "Year")
    c_id = _pick(cols, "ID", "Code")
    c_scope = _pick(cols, "Scope")
    c_l1 = _pick(cols, "Level 1", "Category")
    c_l2 = _pick(cols, "Level 2", "Subcategory")
    c_l3 = _pick(cols, "Level 3", "Detail")
    c_l4 = _pick(cols, "Level 4")
    c_text = _pick(cols, "Column Text", "Description", "Name", "Activity")
    c_uom = _pick(cols, "UOM", "Unit", "Units")
    c_ghg = _pick(cols, "GHG Unit", "GHGUnit", "GHG/Unit", "GHG Unit per")
    c_fac = _pick(cols, "Factor", "GHG Conversion Factor", "GHG Conversion Factor 2025", "kgCO2e per unit", "kgCO2e per gbp")
    c_method = _pick(cols, "Method")
    c_valid_from = _pick(cols, "Valid From", "ValidFrom")
    c_valid_to = _pick(cols, "Valid To", "ValidTo")

    if c_fac is None or c_id is None or c_scope is None:
        raise RuntimeError(f"{path.name}: missing required columns (need Scope, ID, Factor). Found: {list(df.columns)}")

    name, source, analysis_type, year_guess, country = _dataset_meta_from_filename(path)
    # prefer the first row's year if present
    year = year_guess
    if c_year and not df.empty:
        try:
            year = int(df.iloc[0][c_year])
        except Exception:
            pass

    dataset_id = _ensure_dataset(name=name, source=source, analysis_type=analysis_type, country=country, year=int(year or 0))
    if replace:
        _delete_dataset_factors(dataset_id)

    # build rows
    rows: list[list[Any]] = []
    for _, r in df.iterrows():
        try:
            factor = float(r[c_fac])
        except Exception:
            continue

        oid = _norm_original_id(r[c_id])
        scope = _norm_scope(r[c_scope])
        if oid is None or scope is None:
            continue

        yr = int(year or 0)
        if c_year and r.get(c_year) is not None and not (isinstance(r.get(c_year), float) and pd.isna(r.get(c_year))):
            try:
                yr = int(r.get(c_year))
            except Exception:
                pass

        col_text = _synth_column_text(r, c_text, c_l1, c_l2, c_l3, c_l4)
        uom = r.get(c_uom) if c_uom else None
        ghg_unit = _norm_ghg_unit(r.get(c_ghg) if c_ghg else None)

        method = None
        if c_method:
            mv = r.get(c_method)
            if mv is not None and not (isinstance(mv, float) and pd.isna(mv)):
                ms = str(mv).strip()
                if ms and ms.lower() != "nan":
                    method = ms

        valid_from = None
        if c_valid_from:
            vf = r.get(c_valid_from)
            if vf is not None and not (isinstance(vf, float) and pd.isna(vf)):
                try:
                    dt = pd.to_datetime(vf, dayfirst=True, errors="coerce")
                    valid_from = None if pd.isna(dt) else dt.date()
                except Exception:
                    valid_from = None

        valid_to = None
        if c_valid_to:
            vt = r.get(c_valid_to)
            if vt is not None and not (isinstance(vt, float) and pd.isna(vt)):
                try:
                    dt = pd.to_datetime(vt, dayfirst=True, errors="coerce")
                    valid_to = None if pd.isna(dt) else dt.date()
                except Exception:
                    valid_to = None

        # Synthesize report_label from level_1, level_2, level_3
        l1 = str(r.get(c_l1)).strip() if c_l1 and r.get(c_l1) is not None else None
        l2 = str(r.get(c_l2)).strip() if c_l2 and r.get(c_l2) is not None else None
        l3 = str(r.get(c_l3)).strip() if c_l3 and r.get(c_l3) is not None else None
        
        report_label_parts = []
        if l1 and l1.lower() != "nan":
            report_label_parts.append(l1)
        if l2 and l2.lower() != "nan" and l2 != l1:
            report_label_parts.append(l2)
        if l3 and l3.lower() != "nan" and l3 != l2:
            report_label_parts.append(l3)
        
        report_label = " ".join(report_label_parts) if report_label_parts else None

        rows.append(
            [
                int(dataset_id),
                path.name,
                int(yr),
                oid,
                scope,
                l1,
                l2,
                l3,
                (str(r.get(c_l4)).strip() if c_l4 and r.get(c_l4) is not None else None),
                col_text,
                (str(uom).strip() if uom is not None else None),
                ghg_unit,
                float(factor),
                source,
                "",
                "",
                method,
                valid_from,
                valid_to,
                report_label,
            ]
        )

    if not rows:
        return dataset_id, 0

    insert_sql = """
        INSERT INTO factor_lookup
        (dataset_id, file_name, year, original_id, scope,
         level_1, level_2, level_3, level_4, column_text,
         uom, ghg_unit, factor, source, region, currency,
         method, valid_from, valid_to, report_label)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """

    with get_conn() as con:
        for params in rows:
            con.execute(insert_sql, params)

    return dataset_id, len(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest conversion factor CSVs from assets/conversion_factors into datasets + factor_lookup")
    parser.add_argument("--folder", default=str(Path(__file__).parent / "assets" / "conversion_factors"))
    parser.add_argument("--replace", action="store_true", help="Delete existing factor_lookup rows for matched datasets before inserting")
    args = parser.parse_args()

    folder = Path(args.folder)
    if not folder.exists():
        raise SystemExit(f"Folder not found: {folder}")

    files = sorted([p for p in folder.iterdir() if p.is_file() and p.suffix.lower() == ".csv"] )
    if not files:
        raise SystemExit(f"No .csv files found in: {folder}")

    print(f"DB backend: {db_backend()}")
    total = 0
    for p in files:
        ds_id, n = ingest_csv(p, replace=bool(args.replace))
        total += n
        print(f"{p.name}: dataset_id={ds_id}, inserted={n}")

    print(f"Done. Inserted {total} factor rows.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
