"""
Live report data routes for job dashboards.

This router composes the existing report helpers into a single payload that the
browser report page can render directly, including print-friendly charts.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from api.auth import _current_user
from api.job_intensity_routes import _load_job_intensity_metrics
from api.job_report_routes import (
    ACTIVITY_GROUP_COLORS,
    ACTIVITY_GROUP_ORDER,
    _build_activity_grouping,
    _get_job_assigned_template_selection,
    get_benchmark_emissions,
    get_emissions_by_category,
    get_job_data,
    get_job_target_data,
    _get_template_variable_values_for_render,
    get_scope_totals,
)
from api.report_template_routes import _get_job_report_metadata
from services.report_actions import get_job_report_actions_payload

router = APIRouter()


def _coerce_float(value: Any) -> float:
    try:
        if value is None:
            return 0.0
        return float(value)
    except Exception:
        return 0.0


def _summarize_category(categories: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not categories:
        return None
    top = max(categories, key=lambda item: _coerce_float(item.get("emissions")))
    return {
        "category": str(top.get("category") or "Uncategorized"),
        "scope": str(top.get("scope") or ""),
        "emissions": _coerce_float(top.get("emissions")),
        "report_label": str(top.get("report_label") or ""),
        "data_source": str(top.get("data_source") or ""),
        "reference_label": str(top.get("reference_label") or ""),
    }


@router.get("/jobs/{job_id}/live-report-data")
def get_job_live_report_data(job_id: int, _user: dict[str, str] = Depends(_current_user)) -> dict[str, Any]:
    """Return the live report payload for the browser report page."""
    job_data = get_job_data(int(job_id))
    if not job_data:
        raise HTTPException(status_code=404, detail="Job not found")

    scope_totals = get_scope_totals(int(job_id))
    categories = get_emissions_by_category(int(job_id))
    benchmark_totals = get_benchmark_emissions(int(job_id), job_data.get("benchmark_year"))
    activity_groups, activity_totals, activity_details = _build_activity_grouping(categories)
    intensity_metrics = _load_job_intensity_metrics(int(job_id))
    job_actions = get_job_report_actions_payload(int(job_id))
    target_data = get_job_target_data(int(job_id))
    report_metadata = _get_job_report_metadata(int(job_id))
    template_selection = _get_job_assigned_template_selection(int(job_id))
    template_variables: dict[str, Any] = {}
    if template_selection and template_selection.get("template_id") is not None:
        try:
            template_variables = _get_template_variable_values_for_render(
                int(job_id),
                int(template_selection["template_id"]),
                int(template_selection["version_id"]) if template_selection.get("version_id") is not None else None,
            )
        except Exception:
            template_variables = {}

    current_total = _coerce_float(scope_totals.get("Total"))
    benchmark_total = _coerce_float(benchmark_totals.get("Total"))
    delta_total = current_total - benchmark_total
    delta_pct = None
    if benchmark_total > 0:
        delta_pct = (delta_total / benchmark_total) * 100.0

    return {
        "job_data": job_data,
        "scope_totals": scope_totals,
        "benchmark_totals": benchmark_totals,
        "categories": categories,
        "activity_groups": activity_groups,
        "activity_totals": activity_totals,
        "activity_details": activity_details,
        "activity_group_order": ACTIVITY_GROUP_ORDER,
        "activity_group_colors": ACTIVITY_GROUP_COLORS,
        "job_actions": job_actions,
        "intensity_metrics": intensity_metrics,
        "target_data": target_data,
        "report_metadata": report_metadata,
        "template_variables": template_variables,
        "summary": {
            "current_total": current_total,
            "benchmark_total": benchmark_total,
            "delta_total": delta_total,
            "delta_pct": delta_pct,
            "top_category": _summarize_category(categories),
        },
    }
