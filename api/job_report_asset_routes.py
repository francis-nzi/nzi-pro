from fastapi import APIRouter, Depends, Query, Request

from api.job_report_routes import (
    _current_user,
    generate_report_with_assets as _generate_report_with_assets_impl,
    get_emissions_by_activity as _get_emissions_by_activity_impl,
    get_report_assets as _get_report_assets_impl,
)

router = APIRouter(tags=["Job Reports"])


@router.get("/jobs/{job_id}/emissions-by-activity")
def get_emissions_by_activity(job_id: int, _user: dict[str, str] = Depends(_current_user)):
    return _get_emissions_by_activity_impl(job_id, _user=_user)


@router.get("/jobs/{job_id}/report-assets")
def get_report_assets(job_id: int, _user: dict[str, str] = Depends(_current_user)):
    return _get_report_assets_impl(job_id, _user=_user)


@router.post("/jobs/{job_id}/generate-report-with-assets")
def generate_report_with_assets(
    job_id: int,
    request: Request,
    skip_validation: bool = Query(False),
    save_version: bool = Query(False),
    report_version_status: str = Query("review"),
    report_version_label: str | None = Query(None),
    report_version_notes: str | None = Query(None),
    _user: dict[str, str] = Depends(_current_user),
):
    return _generate_report_with_assets_impl(
        job_id,
        request=request,
        skip_validation=skip_validation,
        save_version=save_version,
        report_version_status=report_version_status,
        report_version_label=report_version_label,
        report_version_notes=report_version_notes,
        _user=_user,
    )
