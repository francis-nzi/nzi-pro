from __future__ import annotations

from typing import Any
import logging
import hashlib
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse

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
            for _, row in rows.iterrows():
                versions.append(_serialize_report_version_row(dict(row)))
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
        with get_conn() as con:
            _ensure_report_template_schema(con)
            _ensure_report_drafts_schema(con)
            context = _build_report_draft_context(int(job_id), template_key)
            selected_template = context.get("selected_template") or {}
            template_id = selected_template.get("template_id")
            version_id = selected_template.get("version_id")
            if template_id is None or version_id is None:
                return {"job_id": int(job_id), "template_key": context.get("template_key"), "items": []}

            drafts = _load_report_drafts(con, int(job_id), int(template_id), int(version_id))
            return {
                "job_id": int(job_id),
                "template_key": context.get("template_key"),
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
        with get_conn(autocommit=False) as con:
            _ensure_report_template_schema(con)
            _ensure_report_drafts_schema(con)
            context = _build_report_draft_context(int(job_id), payload.template_key)
            selected_template = context.get("selected_template") or {}
            template_id = selected_template.get("template_id")
            version_id = selected_template.get("version_id")
            if template_id is None or version_id is None:
                raise HTTPException(
                    status_code=400,
                    detail="No assigned report template/version is available for saving drafts.",
                )

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

            loaded_items = _load_report_drafts(con, int(job_id), int(template_id), int(version_id))
            return {
                "ok": True,
                "job_id": int(job_id),
                "template_key": context.get("template_key"),
                "template_id": int(template_id),
                "version_id": int(version_id),
                "items": loaded_items,
                "saved_count": len(saved_items),
            }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save report drafts: {exc}")


@router.post("/jobs/{job_id}/report-drafts/generate")
def generate_report_draft(
    job_id: int,
    payload: GenerateReportDraftPayload,
    _user: dict[str, str] = Depends(_current_user),
):
    section_key = _normalize_report_draft_section_key(payload.section_key)
    try:
        actor = _user.get("email", "unknown")
        context = _build_report_draft_context(int(job_id), payload.template_key)
        selected_template = context.get("selected_template") or {}
        template_id = selected_template.get("template_id")
        version_id = selected_template.get("version_id")
        if template_id is None or version_id is None:
            raise HTTPException(
                status_code=400,
                detail="No assigned report template/version is available for draft generation.",
            )

        draft = generate_report_section_draft(
            context,
            section_key,
            provider=payload.provider or "anthropic",
            model=payload.model,
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
        with get_conn(autocommit=False) as con:
            _ensure_report_template_schema(con)
            _ensure_report_drafts_schema(con)
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
            loaded_items = _load_report_drafts(con, int(job_id), int(template_id), int(version_id))
        return {
            "job_id": int(job_id),
            "section_key": section_key,
            "template_key": context.get("template_key"),
            "draft": draft,
            "saved_draft": saved_row,
            "items": loaded_items,
            "context_summary": context.get("context_summary"),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to generate report draft: {exc}")


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
