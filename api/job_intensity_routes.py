"""
Job Intensity Metrics API Routes
Manages intensity metrics for jobs (employees, turnover, etc.)
"""

import json
import logging
from typing import Any
from fastapi import APIRouter, HTTPException, Depends, Body
from psycopg.types.json import Jsonb
from core.database import get_conn
from api.auth import _current_user

router = APIRouter()
logger = logging.getLogger(__name__)

EMPLOYEE_METRIC_KEY = "employees"
EMPLOYEE_METRIC_LABEL = "Employee"


def _safe_int(value: Any, default: int | None = None) -> int | None:
    try:
        if value is None:
            return default
        text = str(value).strip()
        if text == "":
            return default
        return int(float(text))
    except Exception:
        return default


def _load_employee_fallback(con, job_id: int) -> int:
    row = con.execute(
        """
        SELECT
            COALESCE(rm.employee_number, d.num_employees, 0)
        FROM jobs j
        LEFT JOIN job_report_metadata rm ON rm.job_id = j.job_id
        LEFT JOIN crp_job_details d ON d.job_id = j.job_id
        WHERE j.job_id = %s
        """,
        [int(job_id)],
    ).fetchone()
    return int(row[0] or 0) if row else 0


def _normalize_intensity_metrics(con, job_id: int, metrics: dict[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    raw_metrics = metrics if isinstance(metrics, dict) else {}
    employee_entry = raw_metrics.get(EMPLOYEE_METRIC_KEY) if isinstance(raw_metrics, dict) else None

    employee_value = None
    employee_divider = 1
    if isinstance(employee_entry, dict):
        employee_value = _safe_int(employee_entry.get("value"))
        employee_divider = _safe_int(employee_entry.get("divider"), 1) or 1

    if employee_value is None or employee_value <= 0:
        employee_value = _load_employee_fallback(con, job_id)

    normalized[EMPLOYEE_METRIC_KEY] = {
        "label": EMPLOYEE_METRIC_LABEL,
        "value": int(employee_value or 0),
        "divider": int(employee_divider or 1),
    }

    for key, value in raw_metrics.items():
        if key == EMPLOYEE_METRIC_KEY:
            continue
        normalized[key] = value

    return normalized


def _load_job_intensity_metrics(job_id: int, *, con=None) -> dict:
    """Load the JSONB intensity_metrics payload for a job."""
    if con is None:
        with get_conn() as managed:
            return _load_job_intensity_metrics(int(job_id), con=managed)

    result = con.execute(
        "SELECT intensity_metrics FROM jobs WHERE job_id = %s",
        [int(job_id)]
    ).fetchone()
    if not result or result[0] is None:
        return {}

    metrics = result[0]
    if isinstance(metrics, dict):
        return metrics
    if isinstance(metrics, str):
        try:
            parsed = json.loads(metrics)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return {}
    return {}


def _load_global_intensity_metric_defaults(con) -> dict[str, dict[str, Any]]:
    """Load reusable metric defaults from system settings."""
    row = con.execute(
        "SELECT setting_value FROM system_settings WHERE setting_key = %s",
        ["intensity_metric_defaults"],
    ).fetchone()
    if not row or row[0] is None:
        return {}
    raw = row[0]
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return {}
    return {}


@router.get("/jobs/{job_id}/intensity-metrics")
def get_job_intensity_metrics(job_id: int, _user: dict[str, str] = Depends(_current_user)):
    """Get intensity metrics for a job"""
    try:
        with get_conn() as con:
            result = con.execute(
                "SELECT 1 FROM jobs WHERE job_id = %s",
                [int(job_id)]
            ).fetchone()
            if not result:
                raise HTTPException(status_code=404, detail="Job not found")
            metrics = _normalize_intensity_metrics(
                con,
                int(job_id),
                _load_job_intensity_metrics(int(job_id), con=con),
            )
            defaults = _load_global_intensity_metric_defaults(con)
            defaults = _normalize_intensity_metrics(con, int(job_id), defaults)
            return {
                "job_id": int(job_id),
                "metrics": metrics,
                "defaults": defaults,
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch intensity metrics: {e}")


@router.patch("/jobs/{job_id}/intensity-metrics")
def update_job_intensity_metrics(
    job_id: int,
    body: dict = Body(...),
    _user: dict[str, str] = Depends(_current_user)
):
    """
    Update intensity metrics for a job.
    Expected body format:
    {
        "metrics": {
            "employees": {"label": "Employees", "value": 100, "divider": 1},
            "turnover": {"label": "Turnover", "value": 1000000, "divider": 1000},
            ...
        }
    }
    """
    try:
        # Use psycopg directly to avoid database wrapper issues with dict parameters
        import psycopg
        import os
        from dotenv import load_dotenv
        load_dotenv()
        
        url = os.getenv("DATABASE_URL")
        if not url:
            raise HTTPException(status_code=500, detail="Database configuration error [NEW_CODE_v2]")
        
        # Ensure SSL mode
        if "sslmode=" not in url:
            url = f"{url}{'&' if '?' in url else '?'}sslmode=require"
        
        with psycopg.connect(url) as conn:
            with conn.cursor() as cur:
                # Verify job exists
                cur.execute("SELECT 1 FROM jobs WHERE job_id = %s", [int(job_id)])
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="Job not found")
                
                metrics = _normalize_intensity_metrics(conn, int(job_id), body.get("metrics", {}))
                
                # Convert to JSON string and use CAST for JSONB column
                metrics_json = json.dumps(metrics)
                cur.execute(
                    "UPDATE jobs SET intensity_metrics = CAST(%s AS JSONB) WHERE job_id = %s",
                    [metrics_json, int(job_id)]
                )
                try:
                    employee_value = _safe_int(metrics.get(EMPLOYEE_METRIC_KEY, {}).get("value"), 0) or 0
                    cur.execute(
                        """
                        INSERT INTO job_report_metadata (job_id, employee_number)
                        VALUES (%s, %s)
                        ON CONFLICT (job_id)
                        DO UPDATE SET employee_number = EXCLUDED.employee_number
                        """,
                        [int(job_id), int(employee_value)],
                    )
                except Exception as sync_exc:
                    logger.warning(
                        "Intensity metrics saved but report metadata sync failed for job %s: %s",
                        job_id,
                        sync_exc,
                        exc_info=True,
                    )
                conn.commit()
            
            return {"ok": True, "message": "Intensity metrics updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update intensity metrics: {e}")
