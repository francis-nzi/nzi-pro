"""
PDF generation queue management using RQ and Redis.
Handles queuing, status tracking, and job lifecycle.

PHASE 1 IMPLEMENTATION
File: services/pdf_generation_queue.py
Integration: Copy to /services/ in main project after Redis setup
"""

import os
import logging
from typing import Optional
from functools import lru_cache

logger = logging.getLogger(__name__)


def get_redis_connection():
    """
    Get or create Redis connection.
    
    Requires: REDIS_URL env var
    Example: REDIS_URL=redis://localhost:6379
    """
    try:
        from redis import Redis
        redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379')
        conn = Redis.from_url(redis_url, decode_responses=False)
        # Test connection
        conn.ping()
        logger.info(f"Connected to Redis: {redis_url}")
        return conn
    except ImportError:
        raise RuntimeError(
            "Redis client required. Install: pip install redis rq"
        )
    except Exception as e:
        raise RuntimeError(f"Failed to connect to Redis: {e}")


def get_pdf_queue():
    """Get or create PDF generation queue."""
    try:
        from rq import Queue
        redis_conn = get_redis_connection()
        return Queue('pdf_generation', connection=redis_conn)
    except ImportError:
        raise RuntimeError("RQ required. Install: pip install rq")


def queue_pdf_generation(
    job_id: int,
    template_id: Optional[int] = None,
    user_id: Optional[str] = None,
) -> str:
    """
    Queue a PDF generation job.
    
    Args:
        job_id: Job ID to generate PDF for
        template_id: Optional template override
        user_id: User ID (for audit)
    
    Returns:
        job_token: Unique token for tracking job status
    
    Raises:
        RuntimeError: If Redis/RQ not available
    """
    try:
        queue = get_pdf_queue()
        
        # Enqueue background task
        rq_job = queue.enqueue(
            'services.pdf_generation_tasks.generate_pdf_task',
            job_id=job_id,
            template_id=template_id,
            user_id=user_id,
            job_timeout=300,  # 5 minute timeout
            result_ttl=3600,  # Keep result for 1 hour
        )
        
        job_token = str(rq_job.id)
        logger.info(f"Queued PDF gen for job {job_id}, token: {job_token}")
        return job_token
    
    except Exception as e:
        logger.error(f"Failed to queue PDF generation: {e}")
        raise


def get_pdf_job_status(job_token: str) -> dict:
    """
    Get current status of a queued PDF generation job.
    
    Args:
        job_token: Job token from queue_pdf_generation
    
    Returns:
        dict with format:
        {
            'status': 'queued'|'generating'|'completed'|'failed'|'not_found',
            'job_token': str,
            'progress': 0-100,
            'message': str,
            'result': dict|None,
            'error': str|None,
        }
    """
    try:
        queue = get_pdf_queue()
        rq_job = queue.fetch_job(job_token)
    except Exception as e:
        logger.error(f"Failed to fetch job {job_token}: {e}")
        return {'status': 'not_found', 'message': 'Job not found'}
    
    if not rq_job:
        return {'status': 'not_found', 'message': 'Job has expired'}
    
    # Map RQ status to our status
    status_map = {
        'queued': 'queued',
        'started': 'generating',
        'finished': 'completed',
        'failed': 'failed',
        'deferred': 'deferred',
        'canceled': 'canceled',
    }
    
    job_status = state = rq_job.get_status()
    job_status = status_map.get(job_status, job_status)
    
    response = {
        'status': job_status,
        'job_token': job_token,
        'rq_status': state,  # Raw RQ status for debugging
    }
    
    # Add metadata if available
    if hasattr(rq_job, 'meta') and rq_job.meta:
        response['progress'] = rq_job.meta.get('progress', 0)
        response['message'] = rq_job.meta.get('message', '')
    else:
        response['progress'] = 0
        response['message'] = ''
    
    # Add result if completed
    if rq_job.is_finished:
        response['result'] = rq_job.result
    
    # Add error if failed
    if rq_job.is_failed:
        response['error'] = rq_job.exc_info or 'Unknown error'
    
    return response


def cancel_pdf_job(job_token: str) -> bool:
    """
    Cancel a queued or running PDF generation job.
    
    Args:
        job_token: Job token to cancel
    
    Returns:
        True if canceled, False if not found or error
    """
    try:
        queue = get_pdf_queue()
        rq_job = queue.fetch_job(job_token)
        if rq_job:
            rq_job.cancel()
            logger.info(f"Canceled PDF gen job {job_token}")
            return True
    except Exception as e:
        logger.error(f"Failed to cancel job {job_token}: {e}")
    return False


def get_queue_stats() -> dict:
    """Get current queue statistics for monitoring."""
    try:
        queue = get_pdf_queue()
        return {
            'queued_count': len(queue),
            'queue_name': queue.name,
            'connection': queue.connection.connection_pool.connection_kwargs,
        }
    except Exception as e:
        logger.error(f"Failed to get queue stats: {e}")
        return {'error': str(e)}


def start_pdf_worker(num_workers: int = 1, log_level: str = 'INFO'):
    """
    Start RQ worker process(es) for PDF generation.
    
    This is typically called in a separate process/container.
    
    Usage:
        # Terminal 1: Start workers
        python -c "from services.pdf_generation_queue import start_pdf_worker; start_pdf_worker(2)"
        
        # Or use command line:
        rq worker pdf_generation -w 2 --log-level INFO
    
    Args:
        num_workers: Number of parallel workers
        log_level: Logging level (DEBUG, INFO, WARNING, ERROR)
    """
    try:
        from rq import Worker
        
        logging.basicConfig(level=getattr(logging, log_level.upper()))
        
        redis_conn = get_redis_connection()
        queue = get_pdf_queue()
        
        logger.info(f"Starting {num_workers} PDF generation worker(s)...")
        
        # For multiple workers, use: rq worker pdf_generation -w 2
        # For single worker, we can use this directly:
        with Worker([queue], connection=redis_conn, log_level=log_level) as worker:
            worker.work()
    
    except ImportError:
        raise RuntimeError("RQ required. Install: pip install rq")
    except Exception as e:
        logger.error(f"Worker startup failed: {e}")
        raise
