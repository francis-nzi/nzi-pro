from fastapi import APIRouter, Depends, Query, Request

from api.job_report_routes import (
    _current_user,
    generate_html_report as _generate_html_report_impl,
    generate_job_report as _generate_job_report_impl,
)

router = APIRouter(tags=["Job Reports"])


@router.post("/jobs/{job_id}/generate-report")
def generate_job_report(
    job_id: int,
    request: Request,
    payload=None,
    _user: dict[str, str] = Depends(_current_user),
):
    return _generate_job_report_impl(job_id, request=request, payload=payload, _user=_user)


@router.get("/jobs/{job_id}/generate-html-report")
def generate_html_report(
    job_id: int,
    template_id: int | None = Query(None),
    version_id: int | None = Query(None),
    _user: dict[str, str] = Depends(_current_user),
):
    return _generate_html_report_impl(
        job_id,
        template_id=template_id,
        version_id=version_id,
        _user=_user,
    )
