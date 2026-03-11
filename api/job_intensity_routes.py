"""
Job Intensity Metrics API Routes
Manages intensity metrics for jobs (employees, turnover, etc.)
"""

import json
from fastapi import APIRouter, HTTPException, Depends, Body
from psycopg.types.json import Jsonb
from core.database import get_conn
from api.auth import _current_user

router = APIRouter()


@router.get("/jobs/{job_id}/intensity-metrics")
def get_job_intensity_metrics(job_id: int, _user: dict[str, str] = Depends(_current_user)):
    """Get intensity metrics for a job"""
    try:
        with get_conn() as con:
            result = con.execute(
                "SELECT intensity_metrics FROM jobs WHERE job_id = %s",
                [int(job_id)]
            ).fetchone()
            
            if not result:
                raise HTTPException(status_code=404, detail="Job not found")
            
            metrics = result[0] if result[0] else {}
            
            return {
                "job_id": int(job_id),
                "metrics": metrics
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
                
                metrics = body.get("metrics", {})
                
                # Convert to JSON string and use CAST for JSONB column
                metrics_json = json.dumps(metrics)
                cur.execute(
                    "UPDATE jobs SET intensity_metrics = CAST(%s AS JSONB) WHERE job_id = %s",
                    [metrics_json, int(job_id)]
                )
                conn.commit()
            
            return {"ok": True, "message": "Intensity metrics updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update intensity metrics: {e}")
