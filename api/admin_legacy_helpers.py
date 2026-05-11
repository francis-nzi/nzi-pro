"""
Shared legacy job-reference helpers.
"""

from fastapi import HTTPException


def _resolve_job_reference(con, raw_value: object) -> tuple[int, str | None]:
    token = str(raw_value or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="job_id is required")

    row = con.execute(
        """
        SELECT job_id, job_number
        FROM jobs
        WHERE LOWER(COALESCE(job_number, '')) = LOWER(%s)
        LIMIT 1
        """,
        [token],
    ).fetchone()
    if row:
        return int(row[0]), str(row[1] or "").strip() or None

    digits_only = "".join(ch for ch in token if ch.isdigit())
    if digits_only:
        normalized_job_number = f"J{digits_only.zfill(6)}"
        normalized_row = con.execute(
            """
            SELECT job_id, job_number
            FROM jobs
            WHERE LOWER(COALESCE(job_number, '')) = LOWER(%s)
            LIMIT 1
            """,
            [normalized_job_number],
        ).fetchone()
        direct_id_row = None
        if token.isdigit():
            try:
                direct_id_row = con.execute(
                    "SELECT job_id, job_number FROM jobs WHERE job_id = %s LIMIT 1",
                    [int(token)],
                ).fetchone()
            except Exception:
                direct_id_row = None

        if normalized_row and direct_id_row and int(normalized_row[0]) != int(direct_id_row[0]):
            normalized_label = str(normalized_row[1] or "").strip() or normalized_job_number
            direct_label = str(direct_id_row[1] or "").strip() or f"job_id {int(direct_id_row[0])}"
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Ambiguous job reference '{token}'. It matches internal Job ID {int(direct_id_row[0])} "
                    f"({direct_label}) and Job Number {normalized_label}. Please enter the full job number "
                    f"(e.g. {normalized_label}) or use the internal Job ID shown on the job page."
                ),
            )

        if normalized_row:
            return int(normalized_row[0]), str(normalized_row[1] or "").strip() or normalized_job_number

        if direct_id_row:
            return int(direct_id_row[0]), str(direct_id_row[1] or "").strip() or None

    try:
        row = con.execute(
            "SELECT job_id, job_number FROM jobs WHERE job_id = %s LIMIT 1",
            [int(token)],
        ).fetchone()
        if row:
            return int(row[0]), str(row[1] or "").strip() or None
    except Exception:
        pass

    raise HTTPException(status_code=404, detail=f"Job not found for reference '{token}'")
