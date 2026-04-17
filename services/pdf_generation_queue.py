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
        logger.error("Redis client required. Install: pip install redis rq")
        return None
    except Exception as e:
        logger.error(f"Failed to connect to Redis: {e}")
        return None


def get_pdf_queue():
    """Get or create PDF generation queue."""
    try:
        from rq import Queue
        redis_conn = get_redis_connection()
        if not redis_conn:
            return None
        return Queue('pdf_generation', connection=redis_conn)
    except ImportError:
        logger.error("RQ required. Install: pip install rq")
        return None


def queue_pdf_generation(
    job_id: int,
    template_id: Optional[int] = None,
    user_id: Optional[str] = None,
) -> Optional[str]:
    """
    Queue a PDF generation job.
    
    Args:
        job_id: Job ID to generate PDF for
        template_id: Optional template override
        user_id: User ID (for audit)
    
    Returns:
        job_token: Unique token for tracking job status, or None if Redis unavailable
    
    Raises:
        RuntimeError: If Redis/RQ not available
    """
    try:
        from rq import Queue
        
        redis_conn = get_redis_connection()
        if not redis_conn:
            logger.error("Redis connection failed - cannot queue PDF")
            return None
        
        queue = Queue('pdf_generation', connection=redis_conn)
        
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
    
    except ImportError as e:
        logger.error(f"RQ/Redis not available: {e}")
        return None
    except Exception as e:
        logger.error(f"Failed to queue PDF generation: {e}")
        return None


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
        from rq import Queue
        
        redis_conn = get_redis_connection()
        if not redis_conn:
            return {'status': 'error', 'message': 'Redis unavailable', 'job_token': job_token}
        
        queue = Queue('pdf_generation', connection=redis_conn)
        rq_job = queue.fetch_job(job_token)
    except ImportError:
        return {'status': 'error', 'message': 'RQ not available', 'job_token': job_token}
    except Exception as e:
        logger.error(f"Failed to fetch job {job_token}: {e}")
        return {'status': 'not_found', 'message': 'Job not found', 'job_token': job_token}
    
    if not rq_job:
        return {'status': 'not_found', 'message': 'Job has expired', 'job_token': job_token}
    
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
        from rq import Queue
        
        redis_conn = get_redis_connection()
        if not redis_conn:
            logger.error("Redis unavailable - cannot cancel job")
            return False
        
        queue = Queue('pdf_generation', connection=redis_conn)
        rq_job = queue.fetch_job(job_token)
        if rq_job:
            rq_job.cancel()
            logger.info(f"Canceled PDF gen job {job_token}")
            return True
    except ImportError:
        logger.error("RQ not available - cannot cancel job")
        return False
    except Exception as e:
        logger.error(f"Failed to cancel job {job_token}: {e}")
    return False


def get_queue_stats() -> dict:
    """Get current queue statistics for monitoring."""
    try:
        from rq import Queue
        
        redis_conn = get_redis_connection()
        if not redis_conn:
            return {'error': 'Redis unavailable', 'queued_count': 0}
        
        queue = Queue('pdf_generation', connection=redis_conn)
        return {
            'queued_count': len(queue),
            'queue_name': queue.name,
            'status': 'operational',
        }
    except ImportError:
        return {'error': 'RQ not available', 'queued_count': 0}
    except Exception as e:
        logger.error(f"Failed to get queue stats: {e}")
        return {'error': str(e), 'queued_count': 0}


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
