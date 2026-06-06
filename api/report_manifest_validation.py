"""
Validation helpers for report manifests and stored widget PNG assets.

This module is intentionally standalone in phase 1.
It inspects stored PNGs and manifest requirements, but it does not yet wire
validation into PDF generation or report rendering.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from core.database import get_conn
from api.report_manifests import ReportManifest


Severity = Literal["info", "warning", "error"]


class ManifestValidationIssue(BaseModel):
    severity: Severity
    code: str
    message: str
    widget_id: str | None = None
    section_id: str | None = None


class ManifestValidationResult(BaseModel):
    job_id: int
    template_key: str
    manifest_version: int
    job_updated_at: datetime | None = None
    stored_widget_count: int = 0
    missing_required_widgets: list[str] = Field(default_factory=list)
    stale_widgets: list[str] = Field(default_factory=list)
    issues: list[ManifestValidationIssue] = Field(default_factory=list)

    @property
    def is_valid(self) -> bool:
        return not any(issue.severity == "error" for issue in self.issues)


def _fetch_job_updated_at(job_id: int) -> datetime | None:
    try:
        with get_conn() as con:
            row = con.execute(
                "SELECT updated_at FROM jobs WHERE job_id = %s",
                [int(job_id)],
            ).fetchone()
            if not row:
                return None
            value = row[0]
            return value if isinstance(value, datetime) else None
    except Exception:
        return None


def _fetch_widget_png_rows(job_id: int) -> list[tuple[str, datetime | None]]:
    try:
        with get_conn() as con:
            rows = con.execute(
                "SELECT widget_id, captured_at FROM job_widget_pngs WHERE job_id = %s",
                [int(job_id)],
            ).fetchall()
            result: list[tuple[str, datetime | None]] = []
            for row in rows or []:
                widget_id = str(row[0] or "").strip()
                captured_at = row[1] if len(row) > 1 and isinstance(row[1], datetime) else None
                if widget_id:
                    result.append((widget_id, captured_at))
            return result
    except Exception:
        return []


def validate_job_report_manifest(job_id: int, manifest: ReportManifest) -> ManifestValidationResult:
    """Validate that required widget PNGs exist and are current enough for a manifest."""

    job_updated_at = _fetch_job_updated_at(int(job_id))
    stored_rows = _fetch_widget_png_rows(int(job_id))
    stored_map = {widget_id: captured_at for widget_id, captured_at in stored_rows}
    stored_count = len(stored_rows)

    issues: list[ManifestValidationIssue] = []
    missing_required: list[str] = []
    stale_widgets: list[str] = []

    for section in manifest.sections:
        for widget_id in section.required_widgets:
            captured_at = stored_map.get(widget_id)
            if captured_at is None:
                missing_required.append(widget_id)
                issues.append(
                    ManifestValidationIssue(
                        severity="error",
                        code="missing_required_widget",
                        message=f"Required widget PNG is missing for widget_id='{widget_id}'.",
                        widget_id=widget_id,
                        section_id=section.id,
                    )
                )
                continue

            if job_updated_at is not None and captured_at < job_updated_at:
                stale_widgets.append(widget_id)
                issues.append(
                    ManifestValidationIssue(
                        severity="error",
                        code="stale_widget_png",
                        message=(
                            f"Stored PNG for widget_id='{widget_id}' is stale "
                            f"(captured_at={captured_at.isoformat()}, job_updated_at={job_updated_at.isoformat()})."
                        ),
                        widget_id=widget_id,
                        section_id=section.id,
                    )
                )

    if job_updated_at is None:
        issues.append(
            ManifestValidationIssue(
                severity="warning",
                code="job_updated_at_unavailable",
                message="Could not read jobs.updated_at; freshness checks were limited to presence only.",
            )
        )

    return ManifestValidationResult(
        job_id=int(job_id),
        template_key=manifest.template_key,
        manifest_version=manifest.version,
        job_updated_at=job_updated_at,
        stored_widget_count=stored_count,
        missing_required_widgets=missing_required,
        stale_widgets=stale_widgets,
        issues=issues,
    )


def validate_job_report_manifest_ok(job_id: int, manifest: ReportManifest) -> bool:
    """Convenience wrapper for callers that only need a pass/fail signal."""

    return validate_job_report_manifest(job_id, manifest).is_valid
