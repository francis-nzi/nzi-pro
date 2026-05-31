from __future__ import annotations

from fastapi import APIRouter, Body, Depends

from api.auth import _current_user
from api.permissions import assert_job_access, assert_permission
from core.database import get_conn

router = APIRouter(tags=["job-pcf"])


def _actor(user: dict[str, str]) -> str:
    return str(user.get("email") or user.get("user_id") or "system").strip() or "system"


def _ensure_tables(con) -> None:
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS job_pcf_details (
          job_id INTEGER PRIMARY KEY REFERENCES jobs(job_id) ON DELETE CASCADE,
          product_name TEXT,
          product_code TEXT,
          functional_unit_value NUMERIC(12,2),
          functional_unit_unit TEXT,
          system_boundary TEXT,
          methodology TEXT,
          reporting_standard TEXT,
          notes TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          created_by TEXT,
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_by TEXT
        )
        """
    )


def _row_to_payload(row):
    if not row:
        return {
            "job_id": None,
            "product_name": None,
            "product_code": None,
            "functional_unit_value": None,
            "functional_unit_unit": None,
            "system_boundary": None,
            "methodology": None,
            "reporting_standard": None,
            "notes": None,
        }
    return {
        "job_id": int(row[0]),
        "product_name": row[1],
        "product_code": row[2],
        "functional_unit_value": float(row[3]) if row[3] is not None else None,
        "functional_unit_unit": row[4],
        "system_boundary": row[5],
        "methodology": row[6],
        "reporting_standard": row[7],
        "notes": row[8],
    }


@router.get("/jobs/{job_id}/pcf-details")
def get_pcf_details(job_id: int, _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.view")
    assert_job_access(_user, int(job_id))
    with get_conn() as con:
        _ensure_tables(con)
        row = con.execute(
            """
            SELECT job_id, product_name, product_code, functional_unit_value, functional_unit_unit,
                   system_boundary, methodology, reporting_standard, notes
            FROM job_pcf_details
            WHERE job_id = ?
            """,
            [int(job_id)],
        ).fetchone()
        if not row:
            return _row_to_payload(None)
        return _row_to_payload(row)


@router.put("/jobs/{job_id}/pcf-details")
def save_pcf_details(
    job_id: int,
    body: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user),
):
    assert_permission(_user, "jobs.edit")
    assert_job_access(_user, int(job_id))
    actor = _actor(_user)
    with get_conn() as con:
        _ensure_tables(con)
        exists = con.execute("SELECT 1 FROM job_pcf_details WHERE job_id = ?", [int(job_id)]).fetchone()

        product_name = str(body.get("product_name") or "").strip() or None
        product_code = str(body.get("product_code") or "").strip() or None
        functional_unit_unit = str(body.get("functional_unit_unit") or "").strip() or None
        system_boundary = str(body.get("system_boundary") or "").strip() or None
        methodology = str(body.get("methodology") or "").strip() or None
        reporting_standard = str(body.get("reporting_standard") or "").strip() or None
        notes = str(body.get("notes") or "").strip() or None

        functional_unit_value = body.get("functional_unit_value")
        try:
            functional_unit_value = float(functional_unit_value) if functional_unit_value not in (None, "") else None
        except Exception:
            functional_unit_value = None

        if exists:
            con.execute(
                """
                UPDATE job_pcf_details
                SET product_name = ?, product_code = ?, functional_unit_value = ?, functional_unit_unit = ?,
                    system_boundary = ?, methodology = ?, reporting_standard = ?, notes = ?,
                    updated_at = NOW(), updated_by = ?
                WHERE job_id = ?
                """,
                [
                    product_name,
                    product_code,
                    functional_unit_value,
                    functional_unit_unit,
                    system_boundary,
                    methodology,
                    reporting_standard,
                    notes,
                    actor,
                    int(job_id),
                ],
            )
        else:
            con.execute(
                """
                INSERT INTO job_pcf_details (
                  job_id, product_name, product_code, functional_unit_value, functional_unit_unit,
                  system_boundary, methodology, reporting_standard, notes, created_by, updated_by
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    int(job_id),
                    product_name,
                    product_code,
                    functional_unit_value,
                    functional_unit_unit,
                    system_boundary,
                    methodology,
                    reporting_standard,
                    notes,
                    actor,
                    actor,
                ],
            )

        row = con.execute(
            """
            SELECT job_id, product_name, product_code, functional_unit_value, functional_unit_unit,
                   system_boundary, methodology, reporting_standard, notes
            FROM job_pcf_details
            WHERE job_id = ?
            """,
            [int(job_id)],
        ).fetchone()
        return _row_to_payload(row)
