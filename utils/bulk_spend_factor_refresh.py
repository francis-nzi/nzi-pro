"""One-time bulk operation: run every job affected by the DEFRA spend-factor
revision through the existing governed refresh-request + approval workflow
(api/spend_factor_refresh_routes.py) instead of clicking through the UI for
each one individually.

Reuses the real _preview_job_spend_factor_refresh function (fixed this
session: it was filtering job_scope_rows on jsr.original_id ILIKE
'SPEND-SIC-%%', but job_scope_rows.original_id is a different, per-client
spend-mapping reference scheme -- SPEND-F#####-S131 -- than
factor_lookup.original_id's SIC coding; the job_spend_entries half of the
same function already correctly filtered on fl.original_id. This silently
excluded most legitimately-affected job_scope_rows from every prior use of
this workflow, including the two test runs against job 275) and replicates
the exact request-row + approval-row + per-row UPDATE + audit_log sequence
from POST .../request and .../decide, so the resulting audit trail is
indistinguishable from a real SuperAdmin approval via the UI -- just
scripted across every affected job instead of one at a time.
"""
from __future__ import annotations

import argparse
import json

from core.database import get_conn
from services.audit_log import fetch_row_dict, record_audit_event
from api.spend_factor_refresh_routes import _ensure_spend_factor_refresh_schema, _preview_job_spend_factor_refresh

ACTOR_EMAIL = "francis@netzero.international"
ACTOR = {"email": ACTOR_EMAIL, "full_name": "Francis Doherty", "user_id": "bulk-script"}
REASON = "Bulk DEFRA spend-factor refresh (2026-08) -- factors revised in place 2026-07-30, per-job refresh workflow never run for real until now"


def find_affected_jobs(con) -> list[int]:
    rows = con.execute(
        """
        SELECT DISTINCT jsr.job_id
        FROM job_scope_rows jsr
        JOIN factor_lookup fl ON fl.db_id = jsr.factor_db_id
        WHERE jsr.factor_db_id IS NOT NULL AND jsr.factor IS NOT NULL AND fl.factor IS NOT NULL
          AND ABS(jsr.factor - fl.factor) > (0.0001 * GREATEST(ABS(fl.factor), 0.0001))
        UNION
        SELECT DISTINCT e.job_id
        FROM job_spend_entries e
        JOIN factor_lookup fl ON fl.db_id = e.factor_db_id
        WHERE e.factor_db_id IS NOT NULL AND COALESCE(e.is_deleted, FALSE) = FALSE
        """
    ).fetchall()
    return sorted({int(r[0]) for r in rows})


def refresh_job(job_id: int, dry_run: bool) -> dict:
    with get_conn(autocommit=False) as con:
        _ensure_spend_factor_refresh_schema(con)
        existing = con.execute(
            "SELECT request_id FROM spend_factor_refresh_requests WHERE job_id = %s AND status = 'pending'",
            [job_id],
        ).fetchone()
        if existing:
            return {"job_id": job_id, "skipped": "pending request already exists"}

        preview = _preview_job_spend_factor_refresh(con, job_id)
        if preview["rows_affected"] == 0:
            return {"job_id": job_id, "skipped": "no rows affected"}

        if dry_run:
            return {
                "job_id": job_id,
                "would_update_scope_rows": sum(1 for r in preview["rows"] if r["kind"] == "job_scope_row"),
                "would_update_spend_entries": sum(1 for r in preview["rows"] if r["kind"] == "job_spend_entry"),
                "current_total_tco2e": preview["current_total_tco2e"],
                "projected_total_tco2e": preview["projected_total_tco2e"],
                "delta_tco2e": preview["delta_tco2e"],
            }

        # 1. Request (mirrors POST /jobs/{job_id}/spend-factor-refresh/request)
        req_row = con.execute(
            """
            INSERT INTO spend_factor_refresh_requests (job_id, requested_by, reason, status, preview_summary)
            VALUES (%s, %s, %s, 'pending', %s)
            RETURNING request_id
            """,
            [job_id, ACTOR_EMAIL, REASON, json.dumps(preview, default=str)],
        ).fetchone()
        request_id = int(req_row[0])
        record_audit_event(
            con, request=None, actor=ACTOR, action="spend_factor_refresh_request",
            entity_type="job", entity_id=job_id, job_id=job_id,
            metadata={"reason": REASON, "rows_affected": preview["rows_affected"], "delta_tco2e": preview["delta_tco2e"]},
        )

        # 2. Approve (mirrors .../decide, decision="approve") -- re-run the
        # preview fresh rather than trust the snapshot just captured above,
        # exactly as the real endpoint does.
        preview = _preview_job_spend_factor_refresh(con, job_id)
        updated_scope_rows = 0
        updated_spend_entries = 0
        for row in preview["rows"]:
            if row["kind"] == "job_scope_row":
                before = fetch_row_dict(con, "SELECT * FROM job_scope_rows WHERE row_id = %s AND job_id = %s", [row["row_id"], job_id])
                if not before:
                    continue
                con.execute(
                    "UPDATE job_scope_rows SET factor = %s, ghg_unit = %s, calc_tco2e = %s, updated_at = NOW() WHERE row_id = %s AND job_id = %s",
                    [row["new_factor"], row["new_ghg_unit"], row["new_calc_tco2e"], row["row_id"], job_id],
                )
                after = fetch_row_dict(con, "SELECT * FROM job_scope_rows WHERE row_id = %s AND job_id = %s", [row["row_id"], job_id])
                record_audit_event(
                    con, request=None, actor=ACTOR, action="update", entity_type="job_scope_row",
                    entity_id=row["row_id"], job_id=job_id, before=before, after=after,
                    metadata={"operation": "spend_factor_refresh", "request_id": request_id},
                )
                updated_scope_rows += 1
            else:
                before = fetch_row_dict(con, "SELECT * FROM job_spend_entries WHERE entry_id = %s AND job_id = %s", [row["row_id"], job_id])
                if not before:
                    continue
                con.execute(
                    "UPDATE job_spend_entries SET estimated_emissions_tco2e = %s, updated_at = NOW() WHERE entry_id = %s AND job_id = %s",
                    [row["new_calc_tco2e"], row["row_id"], job_id],
                )
                after = fetch_row_dict(con, "SELECT * FROM job_spend_entries WHERE entry_id = %s AND job_id = %s", [row["row_id"], job_id])
                record_audit_event(
                    con, request=None, actor=ACTOR, action="update", entity_type="job_spend_entry",
                    entity_id=row["row_id"], job_id=job_id, before=before, after=after,
                    metadata={"operation": "spend_factor_refresh", "request_id": request_id},
                )
                updated_spend_entries += 1

        execution_summary = {
            "updated_scope_rows": updated_scope_rows,
            "updated_spend_entries": updated_spend_entries,
            "current_total_tco2e": preview["current_total_tco2e"],
            "projected_total_tco2e": preview["projected_total_tco2e"],
            "delta_tco2e": preview["delta_tco2e"],
        }
        con.execute(
            "UPDATE spend_factor_refresh_requests SET status='approved', decided_by=%s, decided_at=NOW(), decision_note=%s, execution_summary=%s WHERE request_id=%s",
            [ACTOR_EMAIL, "Bulk-approved: " + REASON, json.dumps(execution_summary, default=str), request_id],
        )
        record_audit_event(
            con, request=None, actor=ACTOR, action="spend_factor_refresh_approve", entity_type="job",
            entity_id=job_id, job_id=job_id, metadata={"request_id": request_id, **execution_summary},
        )

    # Outside the transaction, exactly as the real endpoint does: resync any
    # Spend Data-derived scope rows from the now-updated spend entries.
    sync_warning = None
    if updated_spend_entries:
        try:
            from api.spend_data_routes import sync_spend_to_scope_data
            sync_spend_to_scope_data(job_id, {}, ACTOR)
        except Exception as e:
            sync_warning = f"{e}"

    return {"job_id": job_id, "request_id": request_id, "sync_warning": sync_warning, **execution_summary}


def main() -> int:
    parser = argparse.ArgumentParser(description="Bulk-run the governed DEFRA spend-factor refresh across every affected job.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--job-id", type=int, default=None, help="Limit to a single job (for testing).")
    args = parser.parse_args()

    with get_conn() as con:
        job_ids = [args.job_id] if args.job_id else find_affected_jobs(con)

    print(f"{'Would refresh' if args.dry_run else 'Refreshing'} {len(job_ids)} job(s): {job_ids}")
    total_delta = 0.0
    results = []
    for job_id in job_ids:
        result = refresh_job(job_id, dry_run=args.dry_run)
        results.append(result)
        print(result)
        total_delta += float(result.get("delta_tco2e") or 0.0)

    print()
    print(f"Total delta across all jobs: {round(total_delta, 4)} tCO2e")
    skipped = [r for r in results if "skipped" in r]
    if skipped:
        print(f"Skipped {len(skipped)} job(s): {skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
