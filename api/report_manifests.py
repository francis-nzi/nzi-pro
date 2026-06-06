"""
Canonical report manifest definitions.

This module is intentionally standalone for the first phase of the refactor.
It defines the report contract, but it does not wire any PDF or portal paths
over to the new manifest-driven renderer yet.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ReportSection(BaseModel):
    """One logical section in a report template."""

    id: str
    title: str
    required_widgets: list[str] = Field(default_factory=list)
    optional_widgets: list[str] = Field(default_factory=list)
    page_break_before: bool = False
    keep_together: bool = True
    layout: Literal["standard", "wide", "compact", "donut", "table"] = "standard"


class ReportManifest(BaseModel):
    """Canonical manifest for a report family/template."""

    template_key: str
    template_name: str
    report_family: str
    version: int = 1
    sections: list[ReportSection] = Field(default_factory=list)

    def section_ids(self) -> list[str]:
        return [section.id for section in self.sections]


PROFESSIONAL_REPORT_MANIFEST = ReportManifest(
    template_key="professional",
    template_name="Professional Report",
    report_family="carbon_reduction_plan",
    sections=[
        ReportSection(
            id="executive_summary",
            title="Executive Summary",
            required_widgets=["emissions_scope_donut"],
            layout="donut",
        ),
        ReportSection(
            id="net_zero_commitment",
            title="Net Zero Commitment",
            page_break_before=True,
            keep_together=True,
            layout="standard",
        ),
        ReportSection(
            id="analysis_by_scope",
            title="Analysis by Scope",
            required_widgets=["emissions_scope_donut"],
            optional_widgets=["emissions_site_donut", "scope_year_on_year_bar"],
            page_break_before=True,
            keep_together=True,
            layout="wide",
        ),
        ReportSection(
            id="emissions_by_activity",
            title="Emissions by Activity",
            required_widgets=["emissions_by_activity"],
            page_break_before=True,
            keep_together=True,
            layout="wide",
        ),
        ReportSection(
            id="intensity_metrics",
            title="Intensity Metric Analysis",
            required_widgets=["intensity_pathway"],
            page_break_before=True,
            keep_together=True,
            layout="wide",
        ),
        ReportSection(
            id="emissions_reduction_targets",
            title="Emissions Reduction Targets",
            required_widgets=["emissions_reduction_pathway"],
            page_break_before=True,
            keep_together=True,
            layout="wide",
        ),
    ],
)


REPORT_MANIFESTS: dict[str, ReportManifest] = {
    PROFESSIONAL_REPORT_MANIFEST.template_key: PROFESSIONAL_REPORT_MANIFEST,
}


def get_report_manifest(template_key: str) -> ReportManifest | None:
    """Return the canonical manifest for a template key, if one exists."""

    return REPORT_MANIFESTS.get(str(template_key).strip().lower())
