from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

WORKBOOK_DEFAULT = Path(__file__).parent / "Sample Data Sheet With IDs for Mapping.xlsx"
SHEET_DEFAULT = "Master datasheet"
OUT_DIR_DEFAULT = Path(__file__).parent / "analysis"
OUT_JSON_DEFAULT = OUT_DIR_DEFAULT / "wfm_template_id_mapping.json"
OUT_LOOKUP_DEFAULT = OUT_DIR_DEFAULT / "wfm_template_id_lookup.json"

ID_PATTERN = re.compile(r"^\d+_\d+_\d+_\d+_\d+$")


def _clean(v: Any) -> str:
    if v is None:
        return ""
    s = str(v).strip()
    if s.lower() == "nan":
        return ""
    return s


def build_mapping(workbook: Path, sheet_name: str) -> dict[str, Any]:
    df = pd.read_excel(workbook, sheet_name=sheet_name, dtype=str).fillna("")
    columns = [_clean(c) for c in df.columns.tolist()]

    section = ""
    records: list[dict[str, Any]] = []

    for _, row in df.iterrows():
        values = [_clean(v) for v in row.tolist()]
        c0 = values[0] if len(values) > 0 else ""
        c1 = values[1] if len(values) > 1 else ""
        c2 = values[2] if len(values) > 2 else ""
        c3 = values[3] if len(values) > 3 else ""
        c4 = values[4] if len(values) > 4 else ""
        c5 = values[5] if len(values) > 5 else ""
        c6 = values[6] if len(values) > 6 else ""
        c7 = values[7] if len(values) > 7 else ""

        if c0.lower().startswith("section"):
            section = c1 or c0
            continue

        if not ID_PATTERN.match(c0):
            continue

        records.append(
            {
                "factor_original_id": c0,
                "section": section,
                "activity": c1,
                # Keep these generic because each section reuses columns differently.
                "col_2": c2,
                "col_3": c3,
                "col_4": c4,
                "col_5": c5,
                "col_6": c6,
                "col_7": c7,
                "key": {
                    "section": section.lower(),
                    "activity": c1.lower(),
                    "col_2": c2.lower(),
                    "col_3": c3.lower(),
                    "col_4": c4.lower(),
                    "col_5": c5.lower(),
                    "col_6": c6.lower(),
                    "col_7": c7.lower(),
                },
            }
        )

    by_section: dict[str, int] = {}
    for rec in records:
        sec = str(rec.get("section") or "Unspecified")
        by_section[sec] = by_section.get(sec, 0) + 1

    return {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "source_workbook": str(workbook),
        "source_sheet": sheet_name,
        "row_count": len(records),
        "by_section": by_section,
        "records": records,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build WFM template ID mapping from sample workbook.")
    parser.add_argument("--workbook", default=str(WORKBOOK_DEFAULT))
    parser.add_argument("--sheet", default=SHEET_DEFAULT)
    parser.add_argument("--out", default=str(OUT_JSON_DEFAULT))
    parser.add_argument("--out-lookup", default=str(OUT_LOOKUP_DEFAULT))
    args = parser.parse_args()

    workbook = Path(args.workbook).resolve()
    out_file = Path(args.out).resolve()
    out_lookup_file = Path(args.out_lookup).resolve()
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_lookup_file.parent.mkdir(parents=True, exist_ok=True)

    mapping = build_mapping(workbook, args.sheet)
    out_file.write_text(json.dumps(mapping, indent=2), encoding="utf-8")

    lookup: dict[str, list[str]] = {}
    preferred_lookup: dict[str, str] = {}
    for rec in mapping.get("records", []):
        key = rec.get("key") or {}
        key_str = "|".join(
            [
                str(key.get("section") or ""),
                str(key.get("activity") or ""),
                str(key.get("col_2") or ""),
                str(key.get("col_3") or ""),
                str(key.get("col_4") or ""),
                str(key.get("col_5") or ""),
                str(key.get("col_6") or ""),
                str(key.get("col_7") or ""),
            ]
        )
        lookup.setdefault(key_str, [])
        factor_id = str(rec.get("factor_original_id") or "")
        if factor_id and factor_id not in lookup[key_str]:
            lookup[key_str].append(factor_id)
        if factor_id:
            preferred_lookup[key_str] = factor_id
    out_lookup_file.write_text(
        json.dumps(
            {
                "generated_at_utc": mapping.get("generated_at_utc"),
                "source_workbook": mapping.get("source_workbook"),
                "source_sheet": mapping.get("source_sheet"),
                "row_count": len(mapping.get("records", [])),
                "unique_key_count": len(lookup),
                "lookup_key_format": "section|activity|col_2|col_3|col_4|col_5|col_6|col_7",
                "preferred_selection_rule": "last factor_original_id encountered in workbook order",
                "preferred_items": preferred_lookup,
                "items": lookup,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"Wrote mapping: {out_file}")
    print(f"Wrote lookup : {out_lookup_file}")
    print(f"Rows mapped: {mapping['row_count']}")
    print(f"Sections: {mapping['by_section']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
