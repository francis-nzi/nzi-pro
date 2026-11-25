"""Read-only figures for the console's import checks (contract v7-import-figures/1).

    GET /api/console-import/v1/jobs/{job_id}/scope-totals
    GET /api/console-import/v1/jobs/{job_id}/row-figures

Access: one dedicated service token, ``NZI_CONSOLE_IMPORT_TOKEN``, sent as
``Authorization: Bearer <token>``. It is checked only by this router; no other
route reads it, and this router accepts nothing else (not a person's login).
Unset or short, the endpoints refuse every request (503) -- they never fall open.

Bounds on V7's side: each computation runs under a statement timeout, in a
read-only transaction, and one job is computed once at a time (a second request
for it is refused with 503, not queued).

What crosses is in services/console_import_figures.py and the contract: ids,
codes, numbers, dates and booleans. No label, note, site or client field.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
from typing import Any, Callable

from fastapi import APIRouter, Depends, Header, HTTPException, Response

from core.database import get_conn
from services.console_import_figures import (
    FiguresError,
    JobOutOfScope,
    compute_row_figures,
    compute_scope_totals,
    one_computation_per_job,
)

logger = logging.getLogger(__name__)

PREFIX = "/api/console-import/v1"
TOKEN_ENV = "NZI_CONSOLE_IMPORT_TOKEN"
TIMEOUT_ENV = "NZI_CONSOLE_IMPORT_STATEMENT_TIMEOUT_MS"

_MIN_TOKEN_LENGTH = 32
_DEFAULT_TIMEOUT_MS = 20_000  # under the console's 30 s per-reply limit
_MAX_TIMEOUT_MS = 25_000


def require_console_import_token(authorization: str | None = Header(default=None)) -> None:
    expected = str(os.getenv(TOKEN_ENV) or "").strip()
    if len(expected) < _MIN_TOKEN_LENGTH:
        # Not configured (or too weak to be a credential): closed, and said plainly.
        raise HTTPException(status_code=503, detail={"code": "NOT_CONFIGURED", "message": "Console import access is not configured"})

    parts = (authorization or "").split()
    presented = parts[1] if len(parts) == 2 and parts[0].lower() == "bearer" else ""
    # Compare digests so the comparison is constant-time whatever the lengths.
    digest = lambda value: hashlib.sha256(value.encode("utf-8")).digest()  # noqa: E731
    if not presented or not hmac.compare_digest(digest(presented), digest(expected)):
        raise HTTPException(
            status_code=401,
            detail={"code": "UNAUTHORIZED", "message": "Invalid or missing service token"},
            headers={"WWW-Authenticate": "Bearer"},
        )


router = APIRouter(prefix=PREFIX, tags=["console-import"], dependencies=[Depends(require_console_import_token)])


def _statement_timeout_ms() -> int:
    try:
        value = int(str(os.getenv(TIMEOUT_ENV) or "").strip() or _DEFAULT_TIMEOUT_MS)
    except ValueError:
        value = _DEFAULT_TIMEOUT_MS
    return max(1_000, min(value, _MAX_TIMEOUT_MS))


def _is_timeout_or_unavailable(exc: BaseException) -> bool:
    name = type(exc).__name__
    text = str(exc).lower()
    return (
        name in {"QueryCanceled", "PoolTimeout", "OperationalError", "AdminShutdown"}
        or "statement timeout" in text
        or "canceling statement" in text
        or "database_url is not set" in text
    )


def _error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def _run(job_id: str, response: Response, compute: Callable[[Any, int], dict[str, Any]]) -> dict[str, Any]:
    response.headers["Cache-Control"] = "no-store"
    job = int(job_id) if job_id.isascii() and job_id.isdigit() and len(job_id) <= 9 else 0
    if job < 1:
        raise _error(404, JobOutOfScope.code, "Job not found")

    try:
        with one_computation_per_job(job):
            with get_conn(autocommit=False, statement_timeout_ms=_statement_timeout_ms()) as con:
                # Never writes, whatever the code underneath does: the database refuses.
                con.execute("SET TRANSACTION READ ONLY")
                return compute(con, job)
    except FiguresError as exc:
        raise _error(exc.status, exc.code, exc.detail) from None
    except HTTPException:
        raise
    except Exception as exc:
        if _is_timeout_or_unavailable(exc):
            logger.warning("console-import figures: job %s unavailable (%s)", job, type(exc).__name__)
            raise _error(503, "BUSY", "V7 could not answer in time") from None
        # The message of a database error can carry values; log it, never return it.
        logger.exception("console-import figures: job %s failed", job)
        raise _error(500, "INTERNAL", "V7 failed while computing the job") from None


@router.get("/jobs/{job_id}/scope-totals")
def get_scope_totals(job_id: str, response: Response):
    return _run(job_id, response, compute_scope_totals)


@router.get("/jobs/{job_id}/row-figures")
def get_row_figures(job_id: str, response: Response):
    return _run(job_id, response, compute_row_figures)


__all__ = ["router", "require_console_import_token", "PREFIX", "TOKEN_ENV"]
