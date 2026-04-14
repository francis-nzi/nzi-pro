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
    
    try:
        # Import existing functions from job_report_routes
        # These are the SAME functions used by the old /generate-report endpoint
        from api.job_report_routes import (
            _fetch_job_data,
            _generate_report_assets,
            _build_report_render_values,
            render_html_from_template,
            _render_html_to_pdf_bytes,
            _save_job_report_version,
        )
        
        logger.info(f"Starting PDF generation for job {job_id}")
        
        # ==========================================
        # Step 1: Fetch job data (10%)
        # ==========================================
        _update_progress(job, 10, 'Fetching job data...')
        
        job_data = _fetch_job_data(job_id)
        
        if not job_data:
            raise ValueError(f"Job {job_id} not found or inaccessible")
        
        logger.info(f"Fetched job data: {job_data.get('job_number', 'unknown')}")
        
        # ==========================================
        # Step 2: Generate chart assets (30%)
        # ==========================================
        _update_progress(job, 30, 'Generating charts...')
        
        try:
            assets = _generate_report_assets(job_id, job_data)
            logger.info(f"Generated {len(assets)} chart assets")
        except Exception as e:
            logger.warning(f"Chart generation failed, continuing without charts: {e}")
            assets = {}
        
        # ==========================================
        # Step 3: Build template render context (60%)
        # ==========================================
        _update_progress(job, 60, 'Building report...')
        
        render_values = _build_report_render_values(job_data, assets, template_id)
        logger.info(f"Built render context with {len(render_values)} variables")
        
        # ==========================================
        # Step 4: Render HTML from template (70%)
        # ==========================================
        _update_progress(job, 70, 'Rendering HTML...')
        
        html_content = render_html_from_template(render_values, template_id)
        logger.info(f"Rendered HTML ({len(html_content)} bytes)")
        
        # ==========================================
        # Step 5: Convert HTML to PDF (85%)
        # ==========================================
        _update_progress(job, 85, 'Converting to PDF...')
        
        pdf_bytes = _render_html_to_pdf_bytes(html_content)
        logger.info(f"Generated PDF ({len(pdf_bytes)} bytes)")
        
        # ==========================================
        # Step 6: Save version to database (95%)
        # ==========================================
        _update_progress(job, 95, 'Saving report...')
        
        version_data = _save_job_report_version(
            job_id=job_id,
            pdf_bytes=pdf_bytes,
            render_values=render_values,
            user_id=user_id,
            template_id=template_id,
        )
        
        logger.info(f"Saved report version {version_data.get('version_id')}")
        
        # ==========================================
        # Step 7: Complete (100%)
        # ==========================================
        _update_progress(job, 100, 'Complete')
        
        result = {
            'status': 'success',
            'job_id': job_id,
            'version_id': version_data.get('version_id'),
            'file_path': version_data.get('file_path'),
            'download_url': f'/jobs/{job_id}/report-versions/{version_data.get("version_id")}/download',
        }
        
        logger.info(f"PDF generation completed successfully for job {job_id}")
        return result
    
    except Exception as e:
        error_msg = str(e)
        error_trace = traceback.format_exc()
        
        logger.error(f"PDF generation FAILED for job {job_id}: {error_msg}")
        logger.error(f"Traceback: {error_trace}")
        
        # Update progress with error state
        _update_progress(job, -1, f'Error: {error_msg}')
        
        # Re-raise so RQ marks job as failed
        raise


def generate_pdf_task_sync(
    job_id: int,
    template_id: Optional[int] = None,
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
        return generate_pdf_task(job_id, template_id, user_id=None)
