"""
API endpoints for async PDF generation.

PHASE 1 IMPLEMENTATION
File: api/pdf_generation_routes.py
Integration: Add to FastAPI app in api/main.py after setup
"""

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
import asyncio
import json
import logging
from typing import Optional

from core.database import get_conn
from api.auth import _current_user
from services.tenancy import require_org

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["pdf_generation"])


# ============================================================================
# ENDPOINT 1: Queue PDF Generation
# ============================================================================

@router.post("/jobs/{job_id}/queue-pdf")
async def api_queue_pdf_generation(
    job_id: int,
    template_id: Optional[int] = Query(None),
    current_user = Depends(_current_user),
):
    """
    Queue PDF generation for a job (non-blocking).
    
    Returns immediately with a job token for tracking progress.
    
    Args:
        job_id: Job to generate PDF for
        template_id: Optional template ID to override default
    
    Returns:
        {
            'status': 'queued',
            'job_token': 'ccf9e7ba-9f2e-4c51-85a3-7ae8cc9f2d3e',
            'message': '...',
            'status_url': '/api/pdf-progress/{job_token}',
            'ws_url': 'ws://host/api/ws/pdf-progress/{job_token}',
        }
    
    Raises:
        400: Job not found
        500: Queue unavailable
    """
    try:
        org_id = require_org(current_user)

        # Verify job exists and belongs to the caller's org before enqueueing.
        with get_conn() as con:
            job = con.execute(
                """
                SELECT j.job_id, j.job_number
                FROM jobs j
                JOIN clients c ON c.db_id = j.client_db_id
                WHERE j.job_id = %s AND c.org_id = %s
                """,
                (job_id, org_id)
            ).fetchone()
            if not job:
                raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
        
        # Queue PDF generation
        from services.pdf_generation_queue import queue_pdf_generation
        job_token = queue_pdf_generation(
            job_id=job_id,
            template_id=template_id,
            user_id=str(current_user.get('email') or current_user.get('user_id') or current_user.get('id') or "system"),
            org_id=org_id,
        )
        
        logger.info(f"Queued PDF for job {job_id}, token: {job_token}")
        
        return {
            'status': 'queued',
            'job_token': job_token,
            'message': 'PDF generation queued. Connect to WebSocket for real-time progress.',
            'status_url': f'/api/pdf-progress/{job_token}',
            'ws_url': f'ws://localhost:8000/api/ws/pdf-progress/{job_token}',
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to queue PDF: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to queue PDF: {e}")


# ============================================================================
# ENDPOINT 2: Check PDF Progress (Polling)
# ============================================================================

@router.get("/pdf-progress/{job_token}")
async def api_check_pdf_progress(job_token: str):
    """
    Check status of a queued PDF generation job (polling endpoint).
    
    Args:
        job_token: Token from /queue-pdf response
    
    Returns:
        {
            'status': 'queued'|'generating'|'completed'|'failed'|'not_found',
            'job_token': str,
            'progress': 0-100,
            'message': str,
            'result': {...},  # If completed
            'error': str,     # If failed
        }
    """
    try:
        from services.pdf_generation_queue import get_pdf_job_status
        status = get_pdf_job_status(job_token)
        return status
    except Exception as e:
        logger.error(f"Failed to check status: {e}")
        return {'status': 'error', 'message': str(e)}


# ============================================================================
# ENDPOINT 3: WebSocket Real-Time Progress Streaming
# ============================================================================

@router.websocket("/ws/pdf-progress/{job_token}")
async def websocket_pdf_progress(websocket: WebSocket, job_token: str):
    """
    WebSocket endpoint for real-time PDF generation progress.
    
    Streams status updates every 500ms until job completes.
    
    Message flow:
        Client connects
        ↓
        Server: {'status': 'queued', 'progress': 0, 'message': 'Fetching job data...'}
        ↓
        Server: {'status': 'generating', 'progress': 30, 'message': 'Generating charts...'}
        ↓
        Server: {'status': 'generating', 'progress': 85, 'message': 'Converting to PDF...'}
        ↓
        Server: {'status': 'completed', 'progress': 100, 'result': {...}}
        Server closes connection
    
    Error handling:
        If job fails: {'status': 'failed', 'error': 'error message'}
        If WebSocket disconnects: Graceful close (client reconnect supported)
    """
    await websocket.accept()
    
    try:
        from services.pdf_generation_queue import get_pdf_job_status
        
        poll_count = 0
        while True:
            try:
                # Get current job status
                status = get_pdf_job_status(job_token)
                
                # Send to client
                await websocket.send_json(status)
                
                poll_count += 1
                logger.debug(f"WS poll #{poll_count} for {job_token}: {status['status']}")
                
                # If job finished or failed, close connection
                if status['status'] in ['completed', 'failed', 'canceled', 'not_found']:
                    logger.info(f"WS closing for {job_token}: {status['status']}")
                    await websocket.close()
                    break
                
                # Poll every 500ms
                await asyncio.sleep(0.5)
            
            except Exception as e:
                logger.error(f"Error in WS loop: {e}")
                await websocket.send_json({
                    'status': 'error',
                    'message': str(e)
                })
                await asyncio.sleep(1)  # Back off before retry
    
    except WebSocketDisconnect:
        logger.debug(f"Client disconnected from WS: {job_token}")
    except Exception as e:
        logger.error(f"WebSocket error for {job_token}: {e}")
        try:
            await websocket.close(code=1011, reason="Internal server error")
        except:
            pass


# ============================================================================
# ENDPOINT 4: Cancel PDF Generation
# ============================================================================

@router.delete("/pdf/{job_token}/cancel")
async def api_cancel_pdf_generation(
    job_token: str,
    current_user = Depends(_current_user),
):
    """
    Cancel a queued or running PDF generation job.
    
    Args:
        job_token: Token to cancel
    
    Returns:
        {'status': 'canceled', 'message': '...'}
    
    Raises:
        404: Job token not found
    """
    try:
        from services.pdf_generation_queue import cancel_pdf_job
        
        if cancel_pdf_job(job_token):
            logger.info(f"Canceled PDF generation: {job_token}")
            return {'status': 'canceled', 'message': 'PDF generation canceled'}
        else:
            raise HTTPException(status_code=404, detail="Job token not found")
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to cancel PDF: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# ENDPOINT 5: Get Queue Statistics (for monitoring)
# ============================================================================

@router.get("/queue/stats")
async def api_get_queue_stats(current_user = Depends(_current_user)):
    """
    Get PDF generation queue statistics.
    
    Returns:
        {
            'queued_count': int,
            'queue_name': str,
            'connection': dict,
        }
    
    Admin use only for monitoring.
    """
    try:
        from services.pdf_generation_queue import get_queue_stats
        stats = get_queue_stats()
        return stats
    except Exception as e:
        logger.error(f"Failed to get queue stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# BACKWARD COMPATIBILITY: Synchronous endpoint (for existing clients)
# ============================================================================

@router.post("/jobs/{job_id}/generate-report-v2-async")
async def api_generate_report_async_v2(
    job_id: int,
    template_id: Optional[int] = Query(None),
    save_version: bool = Query(True),
    current_user = Depends(_current_user),
):
    """
    Backward-compatible async PDF generation endpoint.
    
    Returns immediately with job token instead of blocking.
    
    This is the NEW recommended approach to replace the old
    synchronous /generate-report endpoint.
    
    Before (sync, slow):
        POST /jobs/{job_id}/generate-report
        → Wait 15-60 seconds
        → Response: PDF bytes
    
    After (async, fast):
        POST /jobs/{job_id}/generate-report-v2-async
        → Response immediately with job token (0.5s)
        → Poll or connect WebSocket for progress
        → Download when complete
    """
    return await api_queue_pdf_generation(job_id, template_id, current_user)
