from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException

from api.auth import _current_user
from api.permissions import assert_job_access, assert_permission
from core.database import get_conn

router = APIRouter(tags=["job-training"])


def _actor(user: dict[str, str]) -> str:
    return str(user.get("email") or user.get("user_id") or "system").strip() or "system"


def _ensure_tables(con) -> None:
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS job_training_details (
          job_id INTEGER PRIMARY KEY REFERENCES jobs(job_id) ON DELETE CASCADE,
          training_date DATE,
          delivery_format TEXT,
          topic TEXT,
          audience TEXT,
          attendee_count INTEGER,
          session_duration_hours NUMERIC(10,2),
          materials_link TEXT,
          location TEXT,
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
            "training_date": None,
            "delivery_format": None,
            "topic": None,
            "audience": None,
            "attendee_count": None,
            "session_duration_hours": None,
            "materials_link": None,
            "location": None,
            "notes": None,
        }
    return {
        "job_id": int(row[0]),
        "training_date": str(row[1]) if row[1] else None,
        "delivery_format": row[2],
        "topic": row[3],
        "audience": row[4],
        "attendee_count": int(row[5]) if row[5] is not None else None,
        "session_duration_hours": float(row[6]) if row[6] is not None else None,
        "materials_link": row[7],
        "location": row[8],
        "notes": row[9],
    }


@router.get("/jobs/{job_id}/training-details")
def get_training_details(job_id: int, _user: dict[str, str] = Depends(_current_user)):
    assert_permission(_user, "jobs.view")
    assert_job_access(_user, int(job_id))
    with get_conn() as con:
        _ensure_tables(con)
        row = con.execute(
            """
            SELECT job_id, training_date, delivery_format, topic, audience, attendee_count,
                   session_duration_hours, materials_link, location, notes
            FROM job_training_details
            WHERE job_id = ?
            """,
            [int(job_id)],
        ).fetchone()
        if not row:
            return {
                "job_id": int(job_id),
                "training_date": None,
                "delivery_format": None,
                "topic": None,
                "audience": None,
                "attendee_count": None,
                "session_duration_hours": None,
                "materials_link": None,
                "location": None,
                "notes": None,
            }
        return _row_to_payload(row)


@router.put("/jobs/{job_id}/training-details")
def save_training_details(
    job_id: int,
    body: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user),
):
    assert_permission(_user, "jobs.edit")
    assert_job_access(_user, int(job_id))
    actor = _actor(_user)
    with get_conn() as con:
        _ensure_tables(con)
        exists = con.execute("SELECT 1 FROM job_training_details WHERE job_id = ?", [int(job_id)]).fetchone()

        training_date = body.get("training_date") or None
        delivery_format = str(body.get("delivery_format") or "").strip() or None
        topic = str(body.get("topic") or "").strip() or None
        audience = str(body.get("audience") or "").strip() or None
        materials_link = str(body.get("materials_link") or "").strip() or None
        location = str(body.get("location") or "").strip() or None
        notes = str(body.get("notes") or "").strip() or None

        attendee_count = body.get("attendee_count")
        try:
            attendee_count = int(attendee_count) if attendee_count not in (None, "") else None
        except Exception:
            attendee_count = None

        session_duration_hours = body.get("session_duration_hours")
        try:
            session_duration_hours = float(session_duration_hours) if session_duration_hours not in (None, "") else None
        except Exception:
            session_duration_hours = None

        if exists:
            con.execute(
                """
                UPDATE job_training_details
                SET training_date = ?, delivery_format = ?, topic = ?, audience = ?, attendee_count = ?,
                    session_duration_hours = ?, materials_link = ?, location = ?, notes = ?,
                    updated_at = NOW(), updated_by = ?
                WHERE job_id = ?
                """,
                [
                    training_date,
                    delivery_format,
                    topic,
                    audience,
                    attendee_count,
                    session_duration_hours,
                    materials_link,
                    location,
                    notes,
                    actor,
                    int(job_id),
                ],
            )
        else:
            con.execute(
                """
                INSERT INTO job_training_details (
                  job_id, training_date, delivery_format, topic, audience, attendee_count,
                  session_duration_hours, materials_link, location, notes, created_by, updated_by
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    int(job_id),
                    training_date,
                    delivery_format,
                    topic,
                    audience,
                    attendee_count,
                    session_duration_hours,
                    materials_link,
                    location,
                    notes,
                    actor,
                    actor,
                ],
            )

        row = con.execute(
            """
            SELECT job_id, training_date, delivery_format, topic, audience, attendee_count,
                   session_duration_hours, materials_link, location, notes
            FROM job_training_details
            WHERE job_id = ?
            """,
            [int(job_id)],
        ).fetchone()
        return _row_to_payload(row)
