from fastapi import APIRouter, Depends

from api.job_report_routes import (
    _current_user,
    generate_job_report_docx as _generate_job_report_docx_impl,
)
from api.job_report_routes import GenerateReportPayload

router = APIRouter(tags=["Job Reports"])


@router.post("/jobs/{job_id}/generate-report-docx")
def generate_job_report_docx(
    job_id: int,
    payload: GenerateReportPayload | None = None,
    _user: dict[str, str] = Depends(_current_user),
):
    return _generate_job_report_docx_impl(job_id, payload=payload, _user=_user)
