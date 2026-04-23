"""
Background tasks for PDF generation.
Run by RQ workers in separate processes.

PHASE 1 IMPLEMENTATION
File: services/pdf_generation_tasks.py
Integration: Copy to /services/ in main project
"""

import logging
import traceback
from typing import Optional

logger = logging.getLogger(__name__)


def _update_progress(job, progress: int, message: str):
    """Helper to update job progress metadata."""
    if job:
        # Ensure progress is 0-100
        progress = max(0, min(100, progress))
        
        if not hasattr(job, 'meta') or job.meta is None:
            job.meta = {}
        
        job.meta['progress'] = progress
        job.meta['message'] = message
        job.save_meta()
        
        logger.info(f"[Job {job.id}] Progress: {progress}% - {message}")


def generate_pdf_task(
    job_id: int,
    template_id: Optional[int] = None,
    user_id: Optional[str] = None,
    org_id: Optional[str] = None,
) -> dict:
    """
    Main PDF generation task (runs in RQ worker).
    
    Updates progress via job.meta for real-time feedback.
    Called by services.pdf_generation_queue.queue_pdf_generation()
    
    Args:
        job_id: Job to generate PDF for
        template_id: Optional template override
        user_id: User ID for audit trail
    
    Returns:
        Result dict with job_id, version_id, file_path, etc.
    
    Raises:
        Exception: On any generation failure (caught by RQ worker)
    """
    from rq import get_current_job
    
    job = get_current_job()
    org_label = str(org_id or "unknown").strip() or "unknown"
    
    try:
        # Import existing functions from job_report_routes
        # These are the SAME functions used by the report endpoints.
        from api.job_report_routes import (
            get_job_data as _fetch_job_data,
            generate_report_with_assets,
        )
        
        logger.info("Starting PDF generation for job %s org_id=%s", job_id, org_label)
        
        # ==========================================
        # Step 1: Fetch job data (10%)
        # ==========================================
        _update_progress(job, 10, 'Fetching job data...')
        
        job_data = _fetch_job_data(job_id, org_id=org_id)
        
        if not job_data:
            raise ValueError(f"Job {job_id} not found or inaccessible")
        
        logger.info("Fetched job data for job %s org_id=%s job_number=%s", job_id, org_label, job_data.get("job_number", "unknown"))
        
        # ==========================================
        # Step 2: Render and save report (90%)
        # ==========================================
        _update_progress(job, 60, 'Rendering and saving report...')

        report_response = generate_report_with_assets(
            job_id=job_id,
            request=None,
            skip_validation=False,
            save_version=True,
            _user={"email": user_id or "system", "org_id": org_id},
        )
        pdf_bytes = bytes(getattr(report_response, "body", b"") or b"")
        logger.info("Generated PDF for job %s org_id=%s bytes=%s", job_id, org_label, len(pdf_bytes))

        version_id = str(getattr(report_response, "headers", {}).get("X-Report-Version-Id") or "").strip() or None
        file_id = str(getattr(report_response, "headers", {}).get("X-Report-File-Id") or "").strip() or None

        # ==========================================
        # Step 3: Complete (100%)
        # ==========================================
        _update_progress(job, 100, 'Complete')
        
        result = {
            'status': 'success',
            'job_id': job_id,
            'version_id': int(version_id) if version_id and version_id.isdigit() else None,
            'file_id': int(file_id) if file_id and file_id.isdigit() else None,
            'download_url': f'/jobs/{job_id}/report-versions/{version_id}/download' if version_id else None,
        }
        
        logger.info("PDF generation completed successfully for job %s org_id=%s", job_id, org_label)
        return result
    
    except Exception as e:
        error_msg = str(e)
        error_trace = traceback.format_exc()
        
        logger.error("PDF generation FAILED for job %s org_id=%s: %s", job_id, org_label, error_msg)
        logger.error("PDF generation traceback job %s org_id=%s: %s", job_id, org_label, error_trace)
        
        # Update progress with error state
        _update_progress(job, -1, f'Error: {error_msg}')
        
        # Re-raise so RQ marks job as failed
        raise


def generate_pdf_task_sync(
    job_id: int,
    template_id: Optional[int] = None,
    org_id: Optional[str] = None,
) -> dict:
    """
    Synchronous version of PDF generation (for testing/debugging).
    
    Args:
        job_id: Job to generate PDF for
        template_id: Optional template override
    
    Returns:
        Result dict
    """
    # Mock RQ job for testing
    class MockJob:
        def __init__(self):
            self.meta = {}
            self.id = f"mock-{job_id}"
        
        def save_meta(self):
            pass
    
    import sys
    from unittest.mock import patch
    
    # Temporarily inject mock job
    mock_job = MockJob()
    
    with patch('services.pdf_generation_tasks.get_current_job', return_value=mock_job):
        return generate_pdf_task(job_id, template_id, user_id=None, org_id=org_id)
