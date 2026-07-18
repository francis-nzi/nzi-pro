from __future__ import annotations

import os
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from fastapi.responses import HTMLResponse, Response
from jinja2 import Environment, FileSystemLoader

from api.job_report_routes import _render_html_to_pdf_bytes, get_job_data
from api.lca_routes import _build_lca_report_payload
from core.database import get_conn

__all__ = ["generate_lca_pdf_report", "generate_lca_html_report"]


def _list_job_assessment_ids(con, job_id: int) -> list[int]:
    df = con.execute(
        "SELECT assessment_id FROM lca_assessments WHERE job_id = %s ORDER BY assessment_id",
        [int(job_id)],
    ).df()
    if df is None or df.empty:
        return []
    return [int(v) for v in df["assessment_id"].tolist()]


def _module_labels(con) -> dict[str, str]:
    df = con.execute("SELECT module_code, label FROM lca_modules_lookup").df()
    if df is None or df.empty:
        return {}
    return {str(r["module_code"]): str(r["label"]) for _, r in df.iterrows()}


def _category_labels(con) -> dict[int, str]:
    df = con.execute("SELECT category_id, name FROM lca_material_categories_lookup").df()
    if df is None or df.empty:
        return {}
    return {int(r["category_id"]): str(r["name"]) for _, r in df.iterrows()}


def _render_lca_report_html(job_id: int, user: dict[str, str]) -> str:
    job_data = get_job_data(job_id)
    if not job_data:
        raise HTTPException(status_code=404, detail="Job not found")

    with get_conn(autocommit=False) as con:
        assessment_ids = _list_job_assessment_ids(con, int(job_id))
        assessments: list[dict[str, Any]] = []
        for assessment_id in assessment_ids:
            payload = _build_lca_report_payload(con, int(job_id), assessment_id, user)
            if payload:
                assessments.append(payload)
        module_labels = _module_labels(con)
        category_labels = _category_labels(con)

    if not assessments:
        raise HTTPException(status_code=404, detail="This job has no LCA/PCF assessments yet")

    template_dir = os.path.join(os.path.dirname(__file__), "templates")
    env = Environment(loader=FileSystemLoader(template_dir))
    env.filters["lca_module_label"] = lambda code: module_labels.get(str(code), str(code))
    env.filters["lca_category_label"] = lambda cid: category_labels.get(int(cid), "Uncategorized") if cid is not None else "Uncategorized"
    template = env.get_template("lca_report.html")
    return template.render(
        job_data=job_data,
        assessments=assessments,
        generation_date=datetime.now().strftime("%d %B %Y"),
    )


def generate_lca_pdf_report(job_id: int, user: dict[str, str]) -> Response:
    html_content = _render_lca_report_html(job_id, user)
    pdf_bytes = _render_html_to_pdf_bytes(html_content)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename=job-{job_id}-lca-report.pdf"},
    )


def generate_lca_html_report(job_id: int, user: dict[str, str]) -> HTMLResponse:
    html_content = _render_lca_report_html(job_id, user)
    return HTMLResponse(content=html_content, headers={"Cache-Control": "no-store"})
