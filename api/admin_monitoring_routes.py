"""
Admin monitoring, disaster recovery, and audit-log routes.
"""

import csv
import hashlib
import io
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from api.auth import _current_user
from api.org_admin_helpers import _actor_identifier
from core.database import get_conn
from services.audit_log import ensure_audit_log_table, parse_json_text
from services.pdf_generation_queue import get_pdf_queue
from services.permissions import ADMIN_ACCESS_PERMISSION
from api.permissions import require_permission

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_permission(ADMIN_ACCESS_PERMISSION))],
)


def _optional_int_param(value: object | None) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except Exception:
        return None


def _dr_setting_value(con, key: str) -> str | None:
    try:
        row = con.execute(
            "SELECT setting_value FROM system_settings WHERE setting_key = %s LIMIT 1",
            [str(key).strip()],
        ).fetchone()
        return str(row[0]).strip() if row and row[0] is not None else None
    except Exception:
        return None


def _dr_upsert_setting(con, *, key: str, value: str, updated_by: str, description: str | None = None) -> None:
    try:
        existing = con.execute(
            "SELECT setting_id FROM system_settings WHERE setting_key = %s LIMIT 1",
            [key],
        ).fetchone()
        if existing:
            con.execute(
                """
                UPDATE system_settings
                SET setting_value = %s,
                    setting_type = %s,
                    description = %s,
                    updated_at = CURRENT_TIMESTAMP,
                    updated_by = %s
                WHERE setting_key = %s
                """,
                [value, "json", description, updated_by, key],
            )
            return
        con.execute(
            """
            INSERT INTO system_settings (setting_key, setting_value, setting_type, description, updated_by)
            VALUES (%s, %s, %s, %s, %s)
            """,
            [key, value, "json", description, updated_by],
        )
    except Exception:
        raise


def _dr_inventory_snapshot(con) -> dict[str, object]:
    tables = [
        "organisations",
        "organisation_memberships",
        "organisation_invitations",
        "users",
        "clients",
        "client_contacts",
        "client_sites",
        "jobs",
        "quotes",
        "invoices",
        "datasets",
        "factor_lookup",
        "report_templates",
        "audit_log",
    ]
    inventory: dict[str, object] = {}
    for table_name in tables:
        try:
            row = con.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()
            inventory[table_name] = int(row[0] or 0) if row else 0
        except Exception as exc:
            inventory[table_name] = {"error": str(exc)}

    return {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "inventory": inventory,
        "database": {
            "backend": "postgres" if os.getenv("DATABASE_URL") else "unknown",
        },
    }


def _dr_snapshot_keys() -> dict[str, str]:
    return {
        "backup": "dr_last_backup_snapshot_json",
        "backup_at": "dr_last_backup_at",
        "backup_by": "dr_last_backup_by",
        "backup_sha": "dr_last_backup_sha256",
        "restore": "dr_last_restore_check_json",
        "restore_at": "dr_last_restore_check_at",
        "restore_by": "dr_last_restore_check_by",
    }


def _bg_dt(value: object | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value.strip() or None
    try:
        return value.isoformat()
    except Exception:
        return str(value)


def _bg_job_payload(rq_job, *, queue_name: str) -> dict[str, object]:
    meta = dict(getattr(rq_job, "meta", {}) or {})
    status = "unknown"
    try:
        status = str(rq_job.get_status() or "unknown")
    except Exception:
        status = str(getattr(rq_job, "status", "unknown") or "unknown")

    payload = {
        "job_token": str(getattr(rq_job, "id", "") or ""),
        "queue_name": queue_name,
        "status": status,
        "rq_status": status,
        "func_name": str(getattr(rq_job, "func_name", "") or ""),
        "description": str(getattr(rq_job, "description", "") or ""),
        "org_id": str(meta.get("org_id") or "").strip() or None,
        "user_id": str(meta.get("user_id") or "").strip() or None,
        "job_id": meta.get("job_id"),
        "template_id": meta.get("template_id"),
        "progress": meta.get("progress", 0),
        "message": meta.get("message", ""),
        "created_at": _bg_dt(getattr(rq_job, "created_at", None)),
        "started_at": _bg_dt(getattr(rq_job, "started_at", None)),
        "ended_at": _bg_dt(getattr(rq_job, "ended_at", None)),
        "replayed_from": str(meta.get("replayed_from") or "").strip() or None,
        "replayed_at_utc": str(meta.get("replayed_at_utc") or "").strip() or None,
        "replayed_by": str(meta.get("replayed_by") or "").strip() or None,
        "can_replay": status in {"failed", "canceled"},
    }
    if getattr(rq_job, "is_failed", False):
        payload["error"] = getattr(rq_job, "exc_info", None) or "Unknown error"
    if getattr(rq_job, "is_finished", False):
        payload["result"] = getattr(rq_job, "result", None)
    return payload


def _bg_queue_registry_counts(queue) -> dict[str, int | None]:
    try:
        from rq.registry import CanceledJobRegistry, DeferredJobRegistry, FailedJobRegistry, FinishedJobRegistry, StartedJobRegistry
    except Exception:
        return {
            "queued": None,
            "failed": None,
            "started": None,
            "deferred": None,
            "finished": None,
            "canceled": None,
        }

    registry_map = {
        "queued": None,
        "failed": FailedJobRegistry,
        "started": StartedJobRegistry,
        "deferred": DeferredJobRegistry,
        "finished": FinishedJobRegistry,
        "canceled": CanceledJobRegistry,
    }
    counts: dict[str, int | None] = {}
    try:
        counts["queued"] = len(queue)
    except Exception:
        counts["queued"] = None
    for key, registry_cls in registry_map.items():
        if key == "queued":
            continue
        try:
            counts[key] = len(registry_cls(queue=queue))
        except Exception:
            counts[key] = None
    return counts


def _bg_queue_jobs(queue, limit: int = 20) -> list[dict[str, object]]:
    try:
        from rq.registry import CanceledJobRegistry, DeferredJobRegistry, FailedJobRegistry, FinishedJobRegistry, StartedJobRegistry
    except Exception:
        registry_classes = []
    else:
        registry_classes = [
            FailedJobRegistry,
            StartedJobRegistry,
            DeferredJobRegistry,
            FinishedJobRegistry,
            CanceledJobRegistry,
        ]

    job_ids: list[str] = []
    try:
        job_ids.extend([str(job_id) for job_id in list(getattr(queue, "job_ids", []) or []) if str(job_id).strip()])
    except Exception:
        pass

    for registry_cls in registry_classes:
        try:
            registry = registry_cls(queue=queue)
            job_ids.extend([str(job_id) for job_id in registry.get_job_ids() if str(job_id).strip()])
        except Exception:
            continue

    unique_ids: list[str] = []
    seen: set[str] = set()
    for job_id in job_ids:
        if job_id in seen:
            continue
        seen.add(job_id)
        unique_ids.append(job_id)

    jobs: list[dict[str, object]] = []
    for job_id in unique_ids:
        try:
            rq_job = queue.fetch_job(job_id)
        except Exception:
            rq_job = None
        if not rq_job:
            continue
        jobs.append(_bg_job_payload(rq_job, queue_name=getattr(queue, "name", "pdf_generation")))

    jobs.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
    return jobs[: max(int(limit or 20), 1)]


def _bg_monitor_snapshot() -> dict[str, object]:
    queue = get_pdf_queue()
    counts = _bg_queue_registry_counts(queue)
    jobs = _bg_queue_jobs(queue, limit=25)
    return {
        "queue_name": getattr(queue, "name", "pdf_generation"),
        "counts": counts,
        "jobs": jobs,
        "connection": getattr(getattr(queue, "connection", None), "connection_pool", None).connection_kwargs
        if getattr(getattr(queue, "connection", None), "connection_pool", None)
        else None,
    }


def _bg_find_job(queue, job_token: str):
    try:
        return queue.fetch_job(job_token)
    except Exception:
        return None


@router.get("/disaster-recovery/status")
def disaster_recovery_status(_user: dict = Depends(_current_user)):
    """Summarise the current backup snapshot and restore readiness."""
    try:
        with get_conn() as con:
            keys = _dr_snapshot_keys()
            backup_raw = _dr_setting_value(con, keys["backup"])
            restore_raw = _dr_setting_value(con, keys["restore"])
            backup = json.loads(backup_raw) if backup_raw else None
            restore = json.loads(restore_raw) if restore_raw else None
            inventory = _dr_inventory_snapshot(con)
            backup_at = _dr_setting_value(con, keys["backup_at"])
            backup_by = _dr_setting_value(con, keys["backup_by"])
            restore_at = _dr_setting_value(con, keys["restore_at"])
            restore_by = _dr_setting_value(con, keys["restore_by"])
        return {
            "ok": True,
            "backup": backup,
            "restore_check": restore,
            "live_inventory": inventory,
            "backup_at": backup_at,
            "backup_by": backup_by,
            "restore_check_at": restore_at,
            "restore_check_by": restore_by,
            "backup_available": bool(backup),
            "restore_check_available": bool(restore),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load disaster recovery status: {e}")


@router.post("/disaster-recovery/backup")
def create_disaster_recovery_backup(_user: dict = Depends(_current_user)):
    """Create and persist a lightweight recovery snapshot for critical tables."""
    try:
        actor = str(_user.get("email") or _user.get("user_id") or "admin").strip() or "admin"
        with get_conn() as con:
            snapshot = _dr_inventory_snapshot(con)
            snapshot["snapshot_type"] = "backup"
            snapshot["actor"] = actor
            payload = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, default=str)
            snapshot_sha = hashlib.sha256(payload.encode("utf-8")).hexdigest()
            keys = _dr_snapshot_keys()
            _dr_upsert_setting(
                con,
                key=keys["backup"],
                value=payload,
                updated_by=actor,
                description="Latest disaster recovery backup snapshot",
            )
            _dr_upsert_setting(
                con,
                key=keys["backup_at"],
                value=snapshot["generated_at_utc"],
                updated_by=actor,
                description="Timestamp of latest disaster recovery backup snapshot",
            )
            _dr_upsert_setting(
                con,
                key=keys["backup_by"],
                value=actor,
                updated_by=actor,
                description="Actor who created latest disaster recovery backup snapshot",
            )
            _dr_upsert_setting(
                con,
                key=keys["backup_sha"],
                value=snapshot_sha,
                updated_by=actor,
                description="SHA256 of latest disaster recovery backup snapshot",
            )
        return {
            "ok": True,
            "snapshot": snapshot,
            "snapshot_sha256": snapshot_sha,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create disaster recovery backup: {e}")


@router.post("/disaster-recovery/restore-check")
def run_disaster_recovery_restore_check(_user: dict = Depends(_current_user)):
    """Compare the current database inventory against the latest backup snapshot."""
    try:
        actor = str(_user.get("email") or _user.get("user_id") or "admin").strip() or "admin"
        with get_conn() as con:
            keys = _dr_snapshot_keys()
            backup_raw = _dr_setting_value(con, keys["backup"])
            if not backup_raw:
                raise HTTPException(status_code=404, detail="No disaster recovery backup snapshot is available")
            backup = json.loads(backup_raw)
            live = _dr_inventory_snapshot(con)

            backup_inventory = dict(backup.get("inventory") or {})
            live_inventory = dict(live.get("inventory") or {})
            mismatches: list[dict[str, object]] = []
            for table_name in sorted(set(backup_inventory) | set(live_inventory)):
                backup_value = backup_inventory.get(table_name)
                live_value = live_inventory.get(table_name)
                if backup_value != live_value:
                    mismatches.append(
                        {
                            "table": table_name,
                            "backup": backup_value,
                            "live": live_value,
                        }
                    )

            status = "pass" if not mismatches else "warn"
            payload = {
                "checked_at_utc": datetime.now(timezone.utc).isoformat(),
                "checked_by": actor,
                "status": status,
                "backup_snapshot_at": backup.get("generated_at_utc"),
                "mismatches": mismatches,
                "backup_inventory": backup_inventory,
                "live_inventory": live_inventory,
            }
            payload_json = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
            _dr_upsert_setting(
                con,
                key=keys["restore"],
                value=payload_json,
                updated_by=actor,
                description="Latest disaster recovery restore check result",
            )
            _dr_upsert_setting(
                con,
                key=keys["restore_at"],
                value=payload["checked_at_utc"],
                updated_by=actor,
                description="Timestamp of latest disaster recovery restore check",
            )
            _dr_upsert_setting(
                con,
                key=keys["restore_by"],
                value=actor,
                updated_by=actor,
                description="Actor who ran latest disaster recovery restore check",
            )
        return {"ok": True, **payload}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to run disaster recovery restore check: {e}")


@router.get("/background-jobs/status")
def background_jobs_status(_user: dict = Depends(_current_user)):
    """Summarise the state of the background PDF generation queue."""
    try:
        return {"ok": True, **_bg_monitor_snapshot()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load background job status: {e}")


@router.post("/background-jobs/replay")
def replay_background_job(body: dict = Body(...), _user: dict = Depends(_current_user)):
    """Replay a previously failed or canceled background job."""
    try:
        job_token = str((body or {}).get("job_token") or "").strip()
        if not job_token:
            raise HTTPException(status_code=400, detail="job_token is required")

        actor = _actor_identifier(_user)
        queue = get_pdf_queue()
        rq_job = _bg_find_job(queue, job_token)
        if not rq_job:
            raise HTTPException(status_code=404, detail="Job token not found")

        meta = dict(getattr(rq_job, "meta", {}) or {})
        org_id = str(meta.get("org_id") or "").strip()
        if not org_id:
            raise HTTPException(status_code=400, detail="Job is missing org metadata and cannot be replayed safely")

        current_status = "unknown"
        try:
            current_status = str(rq_job.get_status() or "unknown")
        except Exception:
            current_status = str(getattr(rq_job, "status", "unknown") or "unknown")

        if current_status not in {"failed", "canceled"}:
            raise HTTPException(
                status_code=409,
                detail=f"Job {job_token} is {current_status} and cannot be replayed",
            )

        func_name = str(getattr(rq_job, "func_name", "") or "").strip()
        if not func_name:
            raise HTTPException(status_code=500, detail="Original job function is unavailable")

        args = tuple(getattr(rq_job, "args", ()) or ())
        kwargs = dict(getattr(rq_job, "kwargs", {}) or {})
        timeout = int(getattr(rq_job, "timeout", 300) or 300)
        result_ttl = int(getattr(rq_job, "result_ttl", 3600) or 3600)

        replayed_job = queue.enqueue(
            func_name,
            *args,
            **kwargs,
            job_timeout=timeout,
            result_ttl=result_ttl,
        )
        replay_meta = dict(meta)
        replay_meta.update(
            {
                "replayed_from": job_token,
                "replayed_at_utc": datetime.now(timezone.utc).isoformat(),
                "replayed_by": actor,
            }
        )
        try:
            replayed_job.meta = replay_meta
            replayed_job.save_meta()
        except Exception:
            pass

        return {
            "ok": True,
            "original_job_token": job_token,
            "replayed_job_token": str(getattr(replayed_job, "id", "") or ""),
            "queue_name": getattr(queue, "name", "pdf_generation"),
            "status": "queued",
            "message": "Background job replayed.",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to replay background job: {e}")

