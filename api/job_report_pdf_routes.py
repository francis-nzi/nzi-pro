from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request

from api.auth import _current_user
from api.job_report_routes import _generate_professional_pdf_impl

router = APIRouter()


@router.post("/jobs/{job_id}/generate-professional-pdf")
def generate_professional_pdf(
    job_id: int,
    request: Request,
    save_version: bool = Query(False),
    report_version_status: str = Query("review"),
    report_version_label: str | None = Query(None),
    report_version_notes: str | None = Query(None),
    _user: dict[str, str] = Depends(_current_user),
):
    return _generate_professional_pdf_impl(
        job_id=job_id,
        request=request,
        save_version=save_version,
        report_version_status=report_version_status,
        report_version_label=report_version_label,
        report_version_notes=report_version_notes,
        _user=_user,
    )
