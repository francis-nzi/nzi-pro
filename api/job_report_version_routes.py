from __future__ import annotations

from typing import Any
import logging
import hashlib
import json
import threading
import time as _time
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse

from api.auth import _current_user
from api.job_report_routes import (
    GenerateReportDraftPayload,
    ReportDraftSectionPayload,
    ReportVersionUpdatePayload,
    SaveReportDraftsPayload,
    _build_report_draft_context,
    _delete_report_drafts_for_missing_sections,
    _ensure_job_files_table,
    _ensure_report_drafts_schema,
    _ensure_report_template_schema,
    _ensure_report_versions_schema,
    _get_job_assigned_template_selection,
    _load_latest_final_report_version_snapshot,
    _load_report_drafts,
    _load_report_version_file_payload,
    _load_report_version_snapshot,
    _normalize_report_draft_section_key,
    _normalize_report_version_status,
    _render_report_snapshot_html,
    _serialize_report_version_row,
    _upsert_report_draft,
)
from api.report_template_routes import _ensure_report_template_schema
from services.report_drafting import _get_section_config, generate_report_section_draft
from core.database import get_conn
from services.audit_log import record_audit_event

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/jobs/{job_id}/report-versions")
def list_report_versions(
    job_id: int,
    _user: dict[str, str] = Depends(_current_user),
):
    import traceback as _tb
    try:
        # Run schema migrations on a separate connection so any DDL failure
        # cannot corrupt the read connection's state.
        try:
            with get_conn() as ddl_con:
                try:
                    _ensure_report_template_schema(ddl_con)
                except Exception:
                    pass
                try:
                    _ensure_job_files_table(ddl_con)
                except Exception:
                    pass
                try:
                    _ensure_report_versions_schema(ddl_con)
                except Exception:
                    pass
        except Exception:
            pass

        try:
            with get_conn() as con:
                job_exists = con.execute("SELECT 1 FROM jobs WHERE job_id = %s", [int(job_id)]).fetchone()
                if not job_exists:
                    raise HTTPException(status_code=404, detail="Job not found")
                rows = con.execute(
                    """
                    SELECT
                        jrv.report_version_id,
                        jrv.job_id,
                        jrv.client_db_id,
                        jrv.version_number,
                        jrv.version_label,
                        jrv.status,
                        jrv.report_format,
                        jrv.template_id,
                        jrv.version_id,
                        jrv.file_id,
                        jrv.file_name,
                        jrv.file_path,
                        jrv.storage_provider,
                        jrv.external_item_id,
                        jrv.external_web_url,
                        jrv.external_path,
                        jrv.data_hash,
                        jrv.notes,
                        jrv.generated_at,
                        jrv.generated_by,
                        jrv.reviewed_at,
                        jrv.reviewed_by,
                        jrv.finalized_at,
                        jrv.finalized_by,
                        jrv.superseded_at,
                        jrv.superseded_by
                    FROM job_report_versions jrv
                    WHERE jrv.job_id = %s
                    ORDER BY jrv.version_number DESC, jrv.generated_at DESC
                    """,
                    [int(job_id)],
                ).df()
            versions: list[dict[str, Any]] = []
            if rows is not None and not rows.empty:
                for row_dict in rows.where(rows.notna(), other=None).to_dict("records"):
                    versions.append(_serialize_report_version_row(row_dict))
        except HTTPException:
            raise
        except Exception as e:
            logger.warning("Failed to list report versions for job %s: %s", job_id, e, exc_info=True)
            return {
                "job_id": int(job_id),
                "versions": [],
                "warning": "Version history is temporarily unavailable.",
            }
        return {"job_id": int(job_id), "versions": versions}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Unhandled exception in list_report_versions for job %s: %s\n%s",
            job_id, e, _tb.format_exc(),
        )
        return {
            "job_id": int(job_id),
            "versions": [],
            "warning": f"Version history could not be loaded: {type(e).__name__}: {e}",
        }


@router.get("/jobs/{job_id}/report-draft-context")
def get_report_draft_context(
    job_id: int,
    template_key: str | None = None,
    _user: dict[str, str] = Depends(_current_user),
):
    try:
        context = _build_report_draft_context(int(job_id), template_key)
        return context
    except HTTPException:
        raise
    except Exception:
        return {
            "job_id": int(job_id),
            "template_key": template_key,
            "selected_template": {},
            "job_data": None,
            "previous_job_data": None,
            "scope_totals": {"Scope 1": 0.0, "Scope 2": 0.0, "Scope 3": 0.0, "Total": 0.0},
            "benchmark_totals": {"Scope 1": 0.0, "Scope 2": 0.0, "Scope 3": 0.0, "Total": 0.0},
            "categories": [],
            "previous_categories": [],
            "job_actions": {"items": [], "term_counts": {}},
            "context_summary": "Draft context is temporarily unavailable.",
            "top_category": None,
        }


@router.get("/jobs/{job_id}/report-drafts")
def list_report_drafts(
    job_id: int,
    template_key: str | None = None,
    _user: dict[str, str] = Depends(_current_user),
):
    try:
        selected_template = _get_job_assigned_template_selection(int(job_id)) or {}
        template_id = selected_template.get("template_id")
        version_id = selected_template.get("version_id")
        resolved_template_key = template_key or selected_template.get("template_key")
        if template_id is None or version_id is None:
            return {"job_id": int(job_id), "template_key": resolved_template_key, "items": []}
        with get_conn() as con:
            _ensure_report_drafts_schema(con)
            drafts = _load_report_drafts(con, int(job_id), int(template_id), int(version_id))
            return {
                "job_id": int(job_id),
                "template_key": resolved_template_key,
                "template_id": int(template_id),
                "version_id": int(version_id),
                "items": drafts,
            }
    except HTTPException:
        raise
    except Exception:
        return {"job_id": int(job_id), "template_key": template_key, "items": []}


@router.put("/jobs/{job_id}/report-drafts")
def save_report_drafts(
    job_id: int,
    payload: SaveReportDraftsPayload,
    _user: dict[str, str] = Depends(_current_user),
):
    actor = _user.get("email", "unknown")
    try:
        selected_template = _get_job_assigned_template_selection(int(job_id)) or {}
        template_id = selected_template.get("template_id")
        version_id = selected_template.get("version_id")
        template_key = payload.template_key or selected_template.get("template_key")
        if template_id is None or version_id is None:
            raise HTTPException(
                status_code=400,
                detail="No assigned report template/version is available for saving drafts.",
            )
        _ensure_draft_schemas_once()

        with get_conn(autocommit=False) as con:
            con.execute("SET LOCAL lock_timeout = '15s'")
            con.execute("SET LOCAL statement_timeout = '30s'")

            incoming_sections = [section for section in payload.sections if isinstance(section, ReportDraftSectionPayload)]
            keep_section_keys: set[str] = set()
            saved_items: list[dict[str, Any]] = []

            for section in incoming_sections:
                normalized_key = _normalize_report_draft_section_key(section.section_key)
                draft_text = str(section.draft_text or "").strip()
                if not draft_text:
                    continue

                draft_json = dict(section.draft_json or {})
                draft_json.setdefault("section_key", normalized_key)
                draft_json.setdefault("section_title", section.section_title or _get_section_config(normalized_key).get("title"))
                draft_json.setdefault("draft_text", draft_text)
                draft_json.setdefault("confidence", section.confidence or draft_json.get("confidence") or "medium")
                draft_json.setdefault("provider", section.provider or draft_json.get("provider"))
                draft_json.setdefault("model", section.model or draft_json.get("model"))
                draft_json.setdefault("origin", section.origin or draft_json.get("origin") or "local")

                evidence_hash = hashlib.sha256(
                    json.dumps(
                        {
                            "job_id": int(job_id),
                            "template_id": int(template_id),
                            "version_id": int(version_id),
                            "section_key": normalized_key,
                            "draft_text": draft_text,
                            "draft_json": draft_json,
                        },
                        ensure_ascii=False,
                        sort_keys=True,
                        default=str,
                    ).encode("utf-8")
                ).hexdigest()

                saved_row = _upsert_report_draft(
                    con=con,
                    job_id=int(job_id),
                    template_id=int(template_id),
                    version_id=int(version_id),
                    section_key=normalized_key,
                    section_title=section.section_title or _get_section_config(normalized_key).get("title"),
                    draft_text=draft_text,
                    draft_json=draft_json,
                    evidence_hash=evidence_hash,
                    provider=section.provider or str(draft_json.get("provider") or ""),
                    model=section.model or str(draft_json.get("model") or ""),
                    confidence=section.confidence or str(draft_json.get("confidence") or ""),
                    status="draft",
                    actor=actor,
                )
                keep_section_keys.add(normalized_key)
                saved_items.append(saved_row)

            _delete_report_drafts_for_missing_sections(
                con=con,
                job_id=int(job_id),
                template_id=int(template_id),
                version_id=int(version_id),
                keep_section_keys=keep_section_keys,
            )

        # Read outside the write transaction so the row lock is released before the SELECT.
        with get_conn() as read_con:
            loaded_items = _load_report_drafts(read_con, int(job_id), int(template_id), int(version_id))
        return {
            "ok": True,
            "job_id": int(job_id),
            "template_key": template_key,
            "template_id": int(template_id),
            "version_id": int(version_id),
            "items": loaded_items,
            "saved_count": len(saved_items),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save report drafts: {exc}")


# ---------------------------------------------------------------------------
# One-time schema initialisation — avoids opening an extra DB connection on
# every save/generate call (critical with Supabase pool_size=15 limit).
# ---------------------------------------------------------------------------
_draft_schema_initialized = False
_draft_schema_lock = threading.Lock()


def _ensure_draft_schemas_once() -> None:
    global _draft_schema_initialized
    if _draft_schema_initialized:
        return
    with _draft_schema_lock:
        if _draft_schema_initialized:
            return
        try:
            with get_conn() as con:
                _ensure_report_template_schema(con)
                _ensure_report_drafts_schema(con)
            _draft_schema_initialized = True
        except Exception as exc:
            logger.warning("Draft schema init failed (will retry next call): %s", exc)


# ---------------------------------------------------------------------------
# DB-backed async task store for AI draft generation
# (avoids 30-second Render proxy timeout; survives server restarts)
# ---------------------------------------------------------------------------
_generation_tasks: dict[str, dict[str, Any]] = {}  # in-memory fast-path cache
_generation_tasks_lock = threading.Lock()


def _ensure_draft_tasks_schema(con) -> None:
    con.execute("""
        CREATE TABLE IF NOT EXISTS report_draft_tasks (
            task_id TEXT PRIMARY KEY,
            job_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            result_json TEXT,
            error TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)


def _db_write_task(task_id: str, job_id: int, status: str, result: Any = None, error: str | None = None) -> None:
    try:
        result_json = json.dumps(result, default=str) if result is not None else None
        with get_conn(autocommit=False) as con:
            _ensure_draft_tasks_schema(con)
            con.execute("""
                INSERT INTO report_draft_tasks (task_id, job_id, status, result_json, error, updated_at)
                VALUES (%s, %s, %s, %s, %s, NOW())
                ON CONFLICT (task_id) DO UPDATE
                SET status = EXCLUDED.status,
                    result_json = EXCLUDED.result_json,
                    error = EXCLUDED.error,
                    updated_at = NOW()
            """, [task_id, job_id, status, result_json, error])
    except Exception as exc:
        logger.warning("Failed to write draft task %s to DB: %s", task_id, exc)


def _cleanup_generation_tasks() -> None:
    cutoff = _time.time() - 600  # drop memory cache older than 10 minutes
    with _generation_tasks_lock:
        stale = [k for k, v in _generation_tasks.items() if v.get("created_at", 0) < cutoff]
        for k in stale:
            del _generation_tasks[k]


def _run_generation(job_id: int, payload: GenerateReportDraftPayload, actor: str) -> dict[str, Any]:
    """Core draft-generation logic used by both the sync and async endpoints."""
    section_key = _normalize_report_draft_section_key(payload.section_key)
    context = _build_report_draft_context(int(job_id), payload.template_key)
    if payload.sibling_drafts:
        context["sibling_drafts"] = {k: str(v) for k, v in payload.sibling_drafts.items() if v}
    selected_template = context.get("selected_template") or {}
    template_id = selected_template.get("template_id")
    version_id = selected_template.get("version_id")
    if template_id is None or version_id is None:
        raise ValueError("No assigned report template/version is available for draft generation.")

    draft = generate_report_section_draft(
        context,
        section_key,
        provider=payload.provider or "anthropic",
        model=payload.model,
        template_id=payload.prompt_template_id,
    )
    draft_json = dict(draft)
    draft_json.setdefault("origin", "ai")
    evidence_hash = hashlib.sha256(
        json.dumps(
            {
                "job_id": int(job_id),
                "template_id": int(template_id),
                "version_id": int(version_id),
                "section_key": section_key,
                "draft_json": draft_json,
            },
            ensure_ascii=False,
            sort_keys=True,
            default=str,
        ).encode("utf-8")
    ).hexdigest()
    _ensure_draft_schemas_once()

    with get_conn(autocommit=False) as con:
        con.execute("SET LOCAL lock_timeout = '15s'")
        saved_row = _upsert_report_draft(
            con=con,
            job_id=int(job_id),
            template_id=int(template_id),
            version_id=int(version_id),
            section_key=section_key,
            section_title=draft.get("section_title") or _get_section_config(section_key).get("title"),
            draft_text=str(draft.get("draft_text") or "").strip(),
            draft_json=draft_json,
            evidence_hash=evidence_hash,
            provider=str(draft.get("provider") or payload.provider or "anthropic"),
            model=str(draft.get("model") or payload.model or ""),
            confidence=str(draft.get("confidence") or ""),
            status="draft",
            actor=actor,
        )
    # Read outside the write transaction so the row lock is released before the SELECT.
    with get_conn() as read_con:
        loaded_items = _load_report_drafts(read_con, int(job_id), int(template_id), int(version_id))
    return {
        "job_id": int(job_id),
        "section_key": section_key,
        "template_key": context.get("template_key"),
        "draft": draft,
        "saved_draft": saved_row,
        "items": loaded_items,
        "context_summary": context.get("context_summary"),
    }


@router.post("/jobs/{job_id}/report-drafts/generate")
def generate_report_draft(
    job_id: int,
    payload: GenerateReportDraftPayload,
    _user: dict[str, str] = Depends(_current_user),
):
    try:
        actor = _user.get("email", "unknown")
        return _run_generation(int(job_id), payload, actor)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to generate report draft: {exc}")


@router.post("/jobs/{job_id}/report-drafts/generate-async")
def generate_report_draft_async(
    job_id: int,
    payload: GenerateReportDraftPayload,
    _user: dict[str, str] = Depends(_current_user),
):
    """Start AI draft generation in a background thread.
    Returns 202 immediately with a task_id. Poll
    GET .../report-drafts/generate-task/{task_id} for completion."""
    task_id = str(uuid.uuid4())
    actor = _user.get("email", "unknown")
    with _generation_tasks_lock:
        _generation_tasks[task_id] = {
            "status": "pending",
            "result": None,
            "error": None,
            "created_at": _time.time(),
        }
    _cleanup_generation_tasks()
    _db_write_task(task_id, int(job_id), "pending")

    def _worker() -> None:
        try:
            result = _run_generation(int(job_id), payload, actor)
            _db_write_task(task_id, int(job_id), "done", result=result)
            with _generation_tasks_lock:
                if task_id in _generation_tasks:
                    _generation_tasks[task_id]["status"] = "done"
                    _generation_tasks[task_id]["result"] = result
        except Exception as exc:
            err_msg = str(exc)
            _db_write_task(task_id, int(job_id), "error", error=err_msg)
            with _generation_tasks_lock:
                if task_id in _generation_tasks:
                    _generation_tasks[task_id]["status"] = "error"
                    _generation_tasks[task_id]["error"] = err_msg

    threading.Thread(target=_worker, daemon=True).start()
    return JSONResponse(status_code=202, content={"task_id": task_id, "status": "pending"})


@router.get("/jobs/{job_id}/report-drafts/generate-task/{task_id}")
def get_generation_task(
    job_id: int,
    task_id: str,
    _user: dict[str, str] = Depends(_current_user),
):
    """Poll for async draft generation status. Falls back to DB if memory cache was lost."""
    # Fast path: in-memory cache
    with _generation_tasks_lock:
        task = _generation_tasks.get(task_id)
    if task:
        return {
            "task_id": task_id,
            "status": task["status"],
            "result": task.get("result"),
            "error": task.get("error"),
        }

    # Slow path: look up in DB (survives server restarts)
    try:
        with get_conn() as con:
            _ensure_draft_tasks_schema(con)
            row = con.execute(
                "SELECT status, result_json, error FROM report_draft_tasks WHERE task_id = %s AND job_id = %s",
                [task_id, int(job_id)],
            ).fetchone()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to check task status: {exc}")

    if not row:
        raise HTTPException(status_code=404, detail="Task not found or expired")

    db_status = str(row[0] or "pending")
    db_result = json.loads(row[1]) if row[1] else None
    db_error = str(row[2]) if row[2] else None
    return {
        "task_id": task_id,
        "status": db_status,
        "result": db_result,
        "error": db_error,
    }


@router.patch("/jobs/{job_id}/report-versions/{report_version_id}")
def update_report_version(
    request: Request,
    job_id: int,
    report_version_id: int,
    payload: ReportVersionUpdatePayload,
    _user: dict[str, str] = Depends(_current_user),
):
    try:
        with get_conn(autocommit=False) as con:
            _ensure_job_files_table(con)
            _ensure_report_versions_schema(con)
            current_df = con.execute(
                """
                SELECT *
                FROM job_report_versions
                WHERE report_version_id = %s AND job_id = %s
                """,
                [int(report_version_id), int(job_id)],
            ).df()
            if current_df is None or current_df.empty:
                raise HTTPException(status_code=404, detail="Report version not found")

            before = _serialize_report_version_row(current_df.iloc[0].to_dict())
            updates: list[str] = []
            params: list[Any] = []

            if payload.version_label is not None:
                updates.append("version_label = %s")
                params.append(str(payload.version_label).strip() or None)
            if payload.notes is not None:
                updates.append("notes = %s")
                params.append(str(payload.notes).strip() or None)
            if payload.status is not None:
                normalized_status = _normalize_report_version_status(payload.status)
                updates.append("status = %s")
                params.append(normalized_status)
                if normalized_status == "review":
                    updates.append("reviewed_at = NOW()")
                    updates.append("reviewed_by = %s")
                    params.append(_user.get("email", "unknown"))
                elif normalized_status == "final":
                    updates.append("finalized_at = NOW()")
                    updates.append("finalized_by = %s")
                    params.append(_user.get("email", "unknown"))
                elif normalized_status == "superseded":
                    updates.append("superseded_at = NOW()")
                    updates.append("superseded_by = %s")
                    params.append(_user.get("email", "unknown"))

            if not updates:
                return {"ok": True, "message": "No changes to update", "report_version_id": int(report_version_id)}

            params.extend([int(report_version_id), int(job_id)])
            con.execute(
                f"""
                UPDATE job_report_versions
                SET {', '.join(updates)}
                WHERE report_version_id = %s AND job_id = %s
                """,
                params,
            )
            after_df = con.execute(
                """
                SELECT *
                FROM job_report_versions
                WHERE report_version_id = %s AND job_id = %s
                """,
                [int(report_version_id), int(job_id)],
            ).df()
            if after_df is None or after_df.empty:
                raise HTTPException(status_code=404, detail="Report version not found after update")
            after = _serialize_report_version_row(after_df.iloc[0].to_dict())
            record_audit_event(
                con,
                request=request,
                actor=_user,
                action="update",
                entity_type="job_report_version",
                entity_id=int(report_version_id),
                job_id=int(job_id),
                before=before,
                after=after,
                metadata={
                    "updated_fields": sorted([field for field in ("version_label", "notes", "status") if getattr(payload, field) is not None]),
                },
            )

        return {"ok": True, "report_version_id": int(report_version_id), "version": after}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update report version: {e}")


@router.get("/jobs/{job_id}/report-versions/{report_version_id}/snapshot-html")
def get_report_version_snapshot_html(
    job_id: int,
    report_version_id: int,
    _user: dict[str, str] = Depends(_current_user),
):
    """Render a frozen HTML preview from the archived report snapshot."""
    try:
        with get_conn() as con:
            _ensure_job_files_table(con)
            _ensure_report_versions_schema(con)
            version_row, snapshot_payload = _load_report_version_snapshot(con, int(job_id), int(report_version_id))

        # Reuse the archived snapshot payload so the preview stays frozen even if live data changes later.
        html_content = _render_report_snapshot_html(snapshot_payload)
        label = version_row.get("version_label") or f"v{version_row.get('version_number') or report_version_id}"
        return HTMLResponse(
            content=html_content,
            headers={
                "X-Report-Version-Id": str(report_version_id),
                "X-Report-Version-Label": str(label),
                "X-Report-Version-Status": str(version_row.get("status") or ""),
                "Cache-Control": "no-store",
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to render report version snapshot: {e}")
