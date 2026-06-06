"""
Read-only debug endpoints for report manifests and stored widget PNG validation.

This module is intentionally separate from the current PDF generation flow.
It lets us inspect manifest completeness and PNG freshness without wiring the
new manifest system into rendering yet.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from api.auth import _current_user
from api.permissions import assert_job_access, assert_permission
from api.report_manifests import get_report_manifest
from api.report_manifest_validation import validate_job_report_manifest

router = APIRouter(tags=["report-manifests"])


@router.get("/jobs/{job_id}/report-manifest-validation")
def get_report_manifest_validation(
    job_id: int,
    template_key: str = Query(default="professional", description="Canonical report template key"),
    _user: dict[str, str] = Depends(_current_user),
):
    """
    Validate stored widget PNGs against the canonical report manifest.

    This is a read-only diagnostic endpoint. It does not trigger PNG capture
    and does not participate in PDF generation.
    """

    assert_permission(_user, "jobs.view")
    assert_job_access(_user, int(job_id))

    manifest = get_report_manifest(template_key)
    if manifest is None:
        raise HTTPException(status_code=404, detail=f"Unknown report manifest template_key='{template_key}'")

    validation = validate_job_report_manifest(int(job_id), manifest)
    return {
        "job_id": int(job_id),
        "template_key": manifest.template_key,
        "manifest": manifest.model_dump(),
        "validation": validation.model_dump(),
    }
