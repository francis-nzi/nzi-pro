from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SectionDefinition:
    key: str
    label: str
    description: str


@dataclass(frozen=True)
class ReportFamilyDefinition:
    key: str
    label: str
    sections: tuple[str, ...]


SECTION_REGISTRY: dict[str, SectionDefinition] = {
    "executive_summary": SectionDefinition(
        key="executive_summary",
        label="Executive Summary",
        description="Opening narrative for the report or insight output.",
    ),
    "emissions_overview": SectionDefinition(
        key="emissions_overview",
        label="Emissions Overview",
        description="Summary of emissions footprint, drivers, and change.",
    ),
    "actions": SectionDefinition(
        key="actions",
        label="Actions",
        description="Practical actions and delivery priorities.",
    ),
    "declaration": SectionDefinition(
        key="declaration",
        label="Declaration",
        description="Formal declaration or sign-off wording.",
    ),
}


REPORT_FAMILY_REGISTRY: dict[str, ReportFamilyDefinition] = {
    "client_insights": ReportFamilyDefinition(
        key="client_insights",
        label="Client Insights",
        sections=("executive_summary",),
    ),
    "crp": ReportFamilyDefinition(
        key="crp",
        label="Carbon Reduction Plan",
        sections=("executive_summary", "emissions_overview", "actions", "declaration"),
    ),
    "secr": ReportFamilyDefinition(
        key="secr",
        label="SECR",
        sections=("executive_summary", "emissions_overview", "actions", "declaration"),
    ),
    "annual_carbon_report": ReportFamilyDefinition(
        key="annual_carbon_report",
        label="Annual Carbon Report",
        sections=("executive_summary", "emissions_overview", "actions", "declaration"),
    ),
}


SECTION_ALIASES: dict[str, str] = {
    "executive summary": "executive_summary",
    "emissions overview": "emissions_overview",
    "carbon emissions overview": "emissions_overview",
    "actions": "actions",
    "declaration": "declaration",
    "sign-off": "declaration",
    "sign off": "declaration",
    "declaration and sign off": "declaration",
}


def normalize_section_key(value: str | None) -> str:
    normalized = str(value or "").strip().lower().replace("_", " ")
    if not normalized:
        return ""
    if normalized in SECTION_ALIASES:
        return SECTION_ALIASES[normalized]
    compact = normalized.replace("-", " ")
    if compact in SECTION_ALIASES:
        return SECTION_ALIASES[compact]
    return compact.replace(" ", "_")


def normalize_report_family_key(value: str | None) -> str:
    normalized = str(value or "").strip().lower().replace(" ", "_")
    return normalized


def get_section_definition(section_key: str | None) -> SectionDefinition | None:
    key = normalize_section_key(section_key)
    return SECTION_REGISTRY.get(key) if key else None


def get_report_family_definition(report_family_key: str | None) -> ReportFamilyDefinition | None:
    key = normalize_report_family_key(report_family_key)
    return REPORT_FAMILY_REGISTRY.get(key) if key else None


def is_supported_section(section_key: str | None, report_family_key: str | None = None) -> bool:
    section = normalize_section_key(section_key)
    if not section or section not in SECTION_REGISTRY:
        return False
    if report_family_key:
        family = get_report_family_definition(report_family_key)
        return bool(family and section in family.sections)
    return True
