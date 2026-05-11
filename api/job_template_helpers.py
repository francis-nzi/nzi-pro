from __future__ import annotations

import io
import os
import re
from pathlib import Path

from fastapi import HTTPException

from core.database import get_conn
from services.audit_log import fetch_row_dict

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _job_template_assignment_audit_snapshot(con, job_id: int) -> dict | None:
    return fetch_row_dict(
        con,
        """
        SELECT
            j.job_id,
            j.job_template_id,
            jt.template_name,
            jt.template_key
        FROM jobs j
        LEFT JOIN job_templates jt ON jt.job_template_id = j.job_template_id
        WHERE j.job_id = ?
        """,
        [int(job_id)],
    )


def _seeded_job_template_fallbacks(template_key: str | None, template_type: str | None) -> list[Path]:
    key = str(template_key or "").strip().lower()
    ttype = str(template_type or "").strip().lower()
    fallbacks: list[Path] = []
    if "crp" in key or "carbon_reduction" in key or ttype == "crp":
        fallbacks.append(PROJECT_ROOT / "templates" / "DEMOCO Carbon Reduction Plan Dec 2025 - Second Year Onwards.docx")
    if "quote" in key or ttype == "quote":
        fallbacks.append(PROJECT_ROOT / "templates" / "NZI Standard Quote.docx")
    if ttype == "dataset" or "upload" in key:
        fallbacks.append(PROJECT_ROOT / "templates" / "NZI Data Upload Template - Standard UK.xlsx")
        fallbacks.append(PROJECT_ROOT / "templates" / "NZI Data Upload Template - Standard UK.csv")
        fallbacks.append(PROJECT_ROOT / "templates" / "NZI Data Colection Upload Template - Standard UK.csv")
        fallbacks.append(PROJECT_ROOT / "templates" / "NZI Data Upload Template - Basic UK.xlsx")
    return fallbacks


def _job_template_paths(job_id: int) -> dict[str, str | None]:
    default_excel = None
    default_crp = None
    excel_path = None
    crp_path = None
    try:
        with get_conn() as con:
            row = con.execute(
                """
                SELECT
                    jt.excel_template_path,
                    jt.crp_template_path
                FROM jobs j
                LEFT JOIN job_templates jt ON jt.job_template_id = j.job_template_id
                WHERE j.job_id = ?
                """,
                [int(job_id)],
            ).fetchone()
        if row:
            excel_path = row[0]
            crp_path = row[1]
    except Exception:
        pass
    return {
        "excel_template_path": excel_path or default_excel,
        "crp_template_path": crp_path or default_crp,
    }


def _resolve_job_template_file_path(raw_path: str | None) -> Path | None:
    path_text = str(raw_path or "").strip()
    if not path_text:
        return None

    candidate_paths: list[Path] = []
    raw_path_obj = Path(path_text)
    if raw_path_obj.is_absolute():
        candidate_paths.append(raw_path_obj)
    else:
        candidate_paths.extend(
            [
                PROJECT_ROOT / raw_path_obj,
                PROJECT_ROOT / "frontend" / raw_path_obj,
                PROJECT_ROOT / "frontend" / "public" / raw_path_obj,
                PROJECT_ROOT / "templates" / raw_path_obj.name,
                PROJECT_ROOT / "uploaded_templates" / raw_path_obj.name,
            ]
        )

    seen: set[str] = set()
    for candidate in candidate_paths:
        try:
            resolved = candidate.resolve()
        except Exception:
            resolved = candidate
        key = str(resolved)
        if key in seen:
            continue
        seen.add(key)
        if resolved.exists() and resolved.is_file():
            return resolved

    return None
