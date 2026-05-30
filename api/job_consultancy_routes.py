from __future__ import annotations

from fastapi import APIRouter, Body, Depends

from api.auth import _current_user
from api.permissions import assert_job_access, assert_permission
from core.database import get_conn

router = APIRouter(tags=["job-consultancy"])


def _actor(user: dict[str, str]) -> str:
    return str(user.get("email") or user.get("user_id") or "system").strip() or "system"


def _ensure_tables(con) -> None:
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS job_consultancy_details (
          job_id INTEGER PRIMARY KEY REFERENCES jobs(job_id) ON DELETE CASCADE,
          engagement_type TEXT,
          deliverables TEXT,
          workshop_count INTEGER,
          hours_budget NUMERIC(10,2),
          hours_used NUMERIC(10,2),
          next_review_date DATE,
          summary_notes TEXT,
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
            "engagement_type": None,
            "deliverables": None,
            "workshop_count": None,
            "hours_budget": None,
            "hours_used": None,
            "next_review_date": None,
            "summary_notes": None,
        }
    return {
        "job_id": int(row[0]),
        "engagement_type": row[1],
        "deliverables": row[2],
        "workshop_count": int(row[3]) if row[3] is not None else None,
        "hours_budget": float(row[4]) if row[4] is not None else None,
        "hours_used": float(row[5]) if row[5] is not None else None,
        "next_review_date": str(row[6]) if row[6] else None,
        "summary_notes": row[7],
    }


@router.get("/jobs/{job_id}/consultancy-details")
def get_consultancy_details(job_id: int, _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.view")
    assert_job_access(_user, int(job_id))
    with get_conn() as con:
        _ensure_tables(con)
        row = con.execute(
            """
            SELECT job_id, engagement_type, deliverables, workshop_count, hours_budget, hours_used,
                   next_review_date, summary_notes
            FROM job_consultancy_details
            WHERE job_id = ?
            """,
            [int(job_id)],
        ).fetchone()
        if not row:
            return _row_to_payload(None)
        return _row_to_payload(row)


@router.put("/jobs/{job_id}/consultancy-details")
def save_consultancy_details(
    job_id: int,
    body: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user),
):
    assert_permission(_user, "jobs.edit")
    assert_job_access(_user, int(job_id))
    actor = _actor(_user)
    with get_conn() as con:
        _ensure_tables(con)
        exists = con.execute("SELECT 1 FROM job_consultancy_details WHERE job_id = ?", [int(job_id)]).fetchone()

        engagement_type = str(body.get("engagement_type") or "").strip() or None
        deliverables = str(body.get("deliverables") or "").strip() or None
        summary_notes = str(body.get("summary_notes") or "").strip() or None
        next_review_date = body.get("next_review_date") or None

        workshop_count = body.get("workshop_count")
        try:
            workshop_count = int(workshop_count) if workshop_count not in (None, "") else None
        except Exception:
            workshop_count = None

        hours_budget = body.get("hours_budget")
        try:
            hours_budget = float(hours_budget) if hours_budget not in (None, "") else None
        except Exception:
            hours_budget = None

        hours_used = body.get("hours_used")
        try:
            hours_used = float(hours_used) if hours_used not in (None, "") else None
        except Exception:
            hours_used = None

        if exists:
            con.execute(
                """
                UPDATE job_consultancy_details
                SET engagement_type = ?, deliverables = ?, workshop_count = ?, hours_budget = ?,
                    hours_used = ?, next_review_date = ?, summary_notes = ?,
                    updated_at = NOW(), updated_by = ?
                WHERE job_id = ?
                """,
                [
                    engagement_type,
                    deliverables,
                    workshop_count,
                    hours_budget,
                    hours_used,
                    next_review_date,
                    summary_notes,
                    actor,
                    int(job_id),
                ],
            )
        else:
            con.execute(
                """
                INSERT INTO job_consultancy_details (
                  job_id, engagement_type, deliverables, workshop_count, hours_budget,
                  hours_used, next_review_date, summary_notes, created_by, updated_by
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    int(job_id),
                    engagement_type,
                    deliverables,
                    workshop_count,
                    hours_budget,
                    hours_used,
                    next_review_date,
                    summary_notes,
                    actor,
                    actor,
                ],
            )

        row = con.execute(
            """
            SELECT job_id, engagement_type, deliverables, workshop_count, hours_budget, hours_used,
                   next_review_date, summary_notes
            FROM job_consultancy_details
            WHERE job_id = ?
            """,
            [int(job_id)],
        ).fetchone()
        return _row_to_payload(row)
