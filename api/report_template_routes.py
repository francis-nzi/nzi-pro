"""
API endpoints for report template management, versioning, job assignment,
and report variable handling.
"""

import csv
from datetime import date, datetime
from decimal import Decimal
from functools import lru_cache
import logging
import math
from pathlib import Path
import re
from fastapi import APIRouter, Depends, HTTPException, Body, Request
from pydantic import BaseModel
from typing import Optional, List, Any

from core.database import get_conn
from api.auth import _current_user
from services.audit_log import record_audit_event
from services.dataset_selector import (
    get_datasets_names_for_report,
    get_scope_primary_datasets,
    resolve_dataset_resolution,
)
from services.report_actions import get_job_report_actions_payload

logger = logging.getLogger(__name__)

# Guards so DDL migrations run only once per process, not on every request.
_report_template_schema_seeded: bool = False
_report_metadata_table_seeded: bool = False

router = APIRouter()


_REPORT_TEMPLATE_SCHEMA_READY = False


def _get_table_columns(con, table_name: str) -> set[str]:
    try:
        rows = con.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = %s
            """,
            [str(table_name)],
        ).fetchall()
    except Exception:
        logger.debug("Failed to read report template table columns; returning empty set", exc_info=True)
        return set()
    return {str(r[0]).strip().lower() for r in (rows or []) if r and r[0]}


_DEFAULT_ANNUAL_REPORT_VARIABLES: list[tuple[str, str, str, str | None, str | None, str | None, bool, int, str]] = [
    ("report_title", "Report Title", "text", "Annual Carbon Footprint Report", None, "Title of the report", True, 10, "Cover Page"),
    ("introduction", "Introduction", "textarea", None, "Introduce the purpose and scope of this report...", "Introduction to the carbon footprint report", True, 20, "Introduction"),
    ("methodology", "Methodology", "textarea", None, "Describe the methodology used for carbon accounting...", "Explanation of calculation methodology and standards used", True, 30, "Methodology"),
    ("key_findings", "Key Findings", "textarea", None, "Summarize the key findings from this reporting period...", "Main findings and insights from the carbon footprint", True, 40, "Results"),
    ("recommendations", "Recommendations", "textarea", None, "Provide recommendations for reducing emissions...", "Suggested actions for emissions reduction", False, 50, "Recommendations"),
    ("conclusion", "Conclusion", "textarea", None, "Conclude the report...", "Final summary and next steps", False, 60, "Conclusion"),
    ("activity_narrative_intro", "Activity Analysis Introduction", "textarea", None, "Summarise the key activity drivers for this reporting period...", "Introductory narrative shown above the activity chart", False, 70, "Emissions by Activity"),
    ("activity_energy_commentary", "Energy Commentary", "textarea", None, "Commentary for Energy emissions...", "Narrative shown alongside the Energy activity group", False, 71, "Emissions by Activity"),
    ("activity_business_travel_commentary", "Business Travel Commentary", "textarea", None, "Commentary for Business Travel emissions...", "Narrative shown alongside the Business Travel activity group", False, 72, "Emissions by Activity"),
    ("activity_employee_commuting_commentary", "Employee Commuting Commentary", "textarea", None, "Commentary for Employee Commuting emissions...", "Narrative shown alongside the Employee Commuting activity group", False, 73, "Emissions by Activity"),
    ("activity_pgs_commentary", "Purchased Goods & Services (PG&S) Commentary", "textarea", None, "Commentary for Purchased Goods & Services emissions...", "Narrative shown alongside the PG&S activity group", False, 74, "Emissions by Activity"),
    ("activity_other_commentary", "Other Emissions Commentary", "textarea", None, "Commentary for other emissions activities...", "Narrative shown alongside the Other Emissions activity group", False, 75, "Emissions by Activity"),
    ("activity_show_group_breakdown", "Show Activity Group Breakdown Table", "boolean", "true", None, "Set to false to hide the summary activity-group table", False, 76, "Emissions by Activity"),
    ("activity_show_detail_table", "Show Detailed Activity Table", "boolean", "true", None, "Set to false to hide the detailed emissions-by-activity table", False, 77, "Emissions by Activity"),
]


_DEFAULT_CRP_STANDARD_VARIABLES: list[tuple[str, str, str, str | None, str | None, str | None, bool, int, str]] = [
    ("executive_summary", "Executive Summary", "textarea", None, "Provide a brief overview of your carbon reduction commitment...", "Summary of your organization's commitment to achieving Net Zero", True, 10, "Executive Summary"),
    ("commitment_statement", "Commitment to Net Zero", "textarea", None, "[Organization] is committed to achieving Net Zero emissions by [year]...", "Your organization's formal commitment statement", True, 20, "Commitment"),
    ("baseline_year", "Baseline Year", "number", "2023", None, "The baseline year for your carbon footprint", True, 21, "Commitment"),
    ("target_year", "Net Zero Target Year", "number", "2050", None, "Target year for achieving Net Zero", True, 22, "Commitment"),
    ("footprint_summary", "Emissions Overview Summary", "textarea", None, "Describe your current emissions overview...", "Overview of your organization's carbon footprint", False, 30, "Emissions Overview"),
    ("scope1_description", "Scope 1 Emissions Description", "textarea", None, "Describe your Scope 1 emissions sources...", "Direct emissions from owned or controlled sources", False, 31, "Emissions Overview"),
    ("scope2_description", "Scope 2 Emissions Description", "textarea", None, "Describe your Scope 2 emissions sources...", "Indirect emissions from purchased electricity, heat, and cooling", False, 32, "Emissions Overview"),
    ("scope3_description", "Scope 3 Emissions Description", "textarea", None, "Describe your Scope 3 emissions sources...", "All other indirect emissions in your value chain", False, 33, "Emissions Overview"),
    ("reduction_targets", "Carbon Reduction Targets", "textarea", None, "Outline your specific reduction targets and milestones...", "Specific targets and timelines for emissions reduction", False, 40, "Reduction Targets"),
    ("interim_target_year", "Interim Target Year", "number", "2030", None, "Interim milestone year (e.g., 2030)", False, 41, "Reduction Targets"),
    ("interim_reduction_pct", "Interim Reduction Target (%)", "number", "50", None, "Percentage reduction target for interim year", False, 42, "Reduction Targets"),
    ("reduction_projects", "Carbon Reduction Projects", "textarea", None, "List and describe your carbon reduction initiatives...", "Specific projects and initiatives to reduce emissions", False, 50, "Reduction Projects"),
    ("completed_projects", "Completed Projects", "textarea", None, "List projects completed to date...", "Carbon reduction projects already completed", False, 51, "Reduction Projects"),
    ("planned_projects", "Planned Projects", "textarea", None, "List projects planned for the future...", "Future carbon reduction projects", False, 52, "Reduction Projects"),
    ("declaration_statement", "Declaration Statement", "textarea", "This Carbon Reduction Plan has been completed in accordance with PPN 06/21 and associated guidance and reporting standard for Carbon Reduction Plans.", None, "Formal declaration statement", True, 60, "Declaration"),
    ("signatory_name", "Signatory Name", "text", None, "Full name of authorized signatory", "Name of person signing the declaration", True, 61, "Declaration"),
    ("signatory_position", "Signatory Position", "text", None, "e.g., Managing Director", "Job title of signatory", True, 62, "Declaration"),
    ("signature_date", "Signature Date", "date", None, None, "Date of signature", True, 63, "Declaration"),
]


_DEFAULT_REPORT_TEMPLATES: tuple[dict[str, Any], ...] = (
    {
        "template_key": "annual_carbon_report",
        "template_name": "Annual Carbon Report",
        "template_type": "carbon_report",
        "report_type": "annual_report",
        "description": "Comprehensive annual carbon footprint report",
        "variables": _DEFAULT_ANNUAL_REPORT_VARIABLES,
    },
    {
        "template_key": "crp_standard",
        "template_name": "Carbon Reduction Plan - Standard",
        "template_type": "carbon_reduction_plan",
        "report_type": "annual_report",
        "description": "Standard Carbon Reduction Plan template for UK government contracts",
        "variables": _DEFAULT_CRP_STANDARD_VARIABLES,
    },
)


def _seed_default_report_templates(con) -> None:
    """Ensure built-in report templates, variables, and a default published version exist."""
    for template in _DEFAULT_REPORT_TEMPLATES:
        template_row = con.execute(
            """
            INSERT INTO report_templates
              (template_key, template_name, template_type, report_type, description,
               is_active, is_global, client_db_id, archived, archived_at, archived_by)
            VALUES
              (%s, %s, %s, %s, %s, TRUE, TRUE, NULL, FALSE, NULL, NULL)
            ON CONFLICT (template_key) DO UPDATE SET
              template_name = EXCLUDED.template_name,
              template_type = EXCLUDED.template_type,
              report_type = EXCLUDED.report_type,
              description = EXCLUDED.description,
              is_active = TRUE,
              is_global = TRUE,
              client_db_id = NULL,
              archived = FALSE,
              archived_at = NULL,
              archived_by = NULL,
              updated_at = NOW()
            RETURNING template_id
            """,
            [
                template["template_key"],
                template["template_name"],
                template["template_type"],
                template["report_type"],
                template["description"],
            ],
        ).fetchone()

        if not template_row:
            template_row = con.execute(
                "SELECT template_id FROM report_templates WHERE template_key = %s",
                [template["template_key"]],
            ).fetchone()
        if not template_row:
            continue

        template_id = int(template_row[0])
        for (
            variable_key,
            variable_label,
            variable_type,
            default_value,
            placeholder,
            help_text,
            is_required,
            display_order,
            section,
        ) in template["variables"]:
            con.execute(
                """
                INSERT INTO report_template_variables
                  (template_id, variable_key, variable_label, variable_type,
                   default_value, placeholder, help_text, is_required, display_order, section)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (template_id, variable_key)
                DO UPDATE SET
                  variable_label = EXCLUDED.variable_label,
                  variable_type = EXCLUDED.variable_type,
                  default_value = EXCLUDED.default_value,
                  placeholder = EXCLUDED.placeholder,
                  help_text = EXCLUDED.help_text,
                  is_required = EXCLUDED.is_required,
                  display_order = EXCLUDED.display_order,
                  section = EXCLUDED.section
                """,
                [
                    template_id,
                    variable_key,
                    variable_label,
                    variable_type,
                    default_value,
                    placeholder,
                    help_text,
                    bool(is_required),
                    int(display_order),
                    section,
                ],
            )

    con.execute(
        """
        INSERT INTO report_template_versions (template_id, version_number, version_label, status, created_by)
        SELECT rt.template_id, 1, 'v1', 'published', 'system'
        FROM report_templates rt
        WHERE NOT EXISTS (
          SELECT 1 FROM report_template_versions rv WHERE rv.template_id = rt.template_id
        )
        """
    )


def _ensure_report_template_schema(con) -> None:
    """
    Ensure only the schema required by the report generator/template-assignment
    flow. This is intentionally narrower than full app migrations so a request
    path doesn't depend on unrelated legacy migration steps succeeding.
    """
    global _REPORT_TEMPLATE_SCHEMA_READY
    if _REPORT_TEMPLATE_SCHEMA_READY:
        return

    # Jobs columns referenced by reporting/template auto-assignment
    for _stmt in [
        "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS reporting_period_end DATE",
        "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_crp BOOLEAN DEFAULT FALSE",
        "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS intensity_metrics JSONB",
        "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_benchmark BOOLEAN DEFAULT FALSE",
    ]:
        try:
            con.execute(_stmt)
        except Exception:
            logger.debug("Ignoring jobs column migration: %s", _stmt, exc_info=True)

    # Core report template tables/columns
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS report_templates (
          template_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          template_key VARCHAR UNIQUE NOT NULL,
          template_name VARCHAR NOT NULL,
          template_type VARCHAR DEFAULT 'carbon_report',
          description TEXT,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
        """
    )
    con.execute("ALTER TABLE report_templates ADD COLUMN IF NOT EXISTS template_key VARCHAR")
    con.execute("ALTER TABLE report_templates ADD COLUMN IF NOT EXISTS template_name VARCHAR")
    con.execute("ALTER TABLE report_templates ADD COLUMN IF NOT EXISTS template_type VARCHAR DEFAULT 'carbon_report'")
    con.execute("ALTER TABLE report_templates ADD COLUMN IF NOT EXISTS description TEXT")
    con.execute("ALTER TABLE report_templates ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE")
    con.execute("ALTER TABLE report_templates ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()")
    con.execute("ALTER TABLE report_templates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()")
    con.execute("ALTER TABLE report_templates ADD COLUMN IF NOT EXISTS report_type VARCHAR DEFAULT 'annual_report'")
    con.execute("ALTER TABLE report_templates ADD COLUMN IF NOT EXISTS is_global BOOLEAN DEFAULT TRUE")
    con.execute("ALTER TABLE report_templates ADD COLUMN IF NOT EXISTS client_db_id INTEGER REFERENCES clients(db_id)")
    con.execute("ALTER TABLE report_templates ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE")
    con.execute("ALTER TABLE report_templates ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP")
    con.execute("ALTER TABLE report_templates ADD COLUMN IF NOT EXISTS archived_by VARCHAR")

    con.execute(
        """
        CREATE TABLE IF NOT EXISTS report_template_versions (
          version_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          template_id INTEGER NOT NULL REFERENCES report_templates(template_id) ON DELETE CASCADE,
          version_number INTEGER NOT NULL,
          version_label VARCHAR,
          status VARCHAR DEFAULT 'published',
          template_content TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          created_by VARCHAR,
          UNIQUE(template_id, version_number)
        )
        """
    )
    con.execute("ALTER TABLE report_template_versions ADD COLUMN IF NOT EXISTS template_id INTEGER")
    con.execute("ALTER TABLE report_template_versions ADD COLUMN IF NOT EXISTS version_number INTEGER")
    con.execute("ALTER TABLE report_template_versions ADD COLUMN IF NOT EXISTS version_label VARCHAR")
    con.execute("ALTER TABLE report_template_versions ADD COLUMN IF NOT EXISTS status VARCHAR DEFAULT 'published'")
    con.execute("ALTER TABLE report_template_versions ADD COLUMN IF NOT EXISTS template_content TEXT")
    con.execute("ALTER TABLE report_template_versions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()")
    con.execute("ALTER TABLE report_template_versions ADD COLUMN IF NOT EXISTS created_by VARCHAR")
    con.execute(
        """
        CREATE INDEX IF NOT EXISTS report_template_versions_template_idx
        ON report_template_versions (template_id, version_number)
        """
    )

    con.execute(
        """
        CREATE TABLE IF NOT EXISTS report_template_variables (
          variable_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          template_id INTEGER NOT NULL REFERENCES report_templates(template_id) ON DELETE CASCADE,
          variable_key VARCHAR NOT NULL,
          variable_label VARCHAR NOT NULL,
          variable_type VARCHAR DEFAULT 'text',
          default_value TEXT,
          placeholder TEXT,
          help_text TEXT,
          is_required BOOLEAN DEFAULT FALSE,
          display_order INTEGER DEFAULT 0,
          section VARCHAR,
          created_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(template_id, variable_key)
        )
        """
    )
    con.execute("ALTER TABLE report_template_variables ADD COLUMN IF NOT EXISTS template_id INTEGER")
    con.execute("ALTER TABLE report_template_variables ADD COLUMN IF NOT EXISTS variable_key VARCHAR")
    con.execute("ALTER TABLE report_template_variables ADD COLUMN IF NOT EXISTS variable_label VARCHAR")
    con.execute("ALTER TABLE report_template_variables ADD COLUMN IF NOT EXISTS variable_type VARCHAR DEFAULT 'text'")
    con.execute("ALTER TABLE report_template_variables ADD COLUMN IF NOT EXISTS default_value TEXT")
    con.execute("ALTER TABLE report_template_variables ADD COLUMN IF NOT EXISTS placeholder TEXT")
    con.execute("ALTER TABLE report_template_variables ADD COLUMN IF NOT EXISTS help_text TEXT")
    con.execute("ALTER TABLE report_template_variables ADD COLUMN IF NOT EXISTS is_required BOOLEAN DEFAULT FALSE")
    con.execute("ALTER TABLE report_template_variables ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0")
    con.execute("ALTER TABLE report_template_variables ADD COLUMN IF NOT EXISTS section VARCHAR")
    con.execute("ALTER TABLE report_template_variables ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()")

    con.execute(
        """
        CREATE TABLE IF NOT EXISTS job_report_variable_values (
          org_id TEXT,
          job_id INTEGER NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
          template_id INTEGER NOT NULL REFERENCES report_templates(template_id) ON DELETE CASCADE,
          version_id INTEGER REFERENCES report_template_versions(version_id) ON DELETE CASCADE,
          variable_key VARCHAR NOT NULL,
          variable_value TEXT,
          updated_at TIMESTAMP DEFAULT NOW(),
          updated_by VARCHAR,
          PRIMARY KEY (job_id, template_id, version_id, variable_key)
        )
        """
    )
    con.execute(
        """
        CREATE INDEX IF NOT EXISTS job_report_variable_values_lookup_idx
        ON job_report_variable_values (org_id, job_id, template_id, version_id)
        """
    )
    con.execute("ALTER TABLE job_report_variable_values ADD COLUMN IF NOT EXISTS org_id TEXT")
    con.execute("ALTER TABLE job_report_variable_values ADD COLUMN IF NOT EXISTS template_id INTEGER")
    con.execute("ALTER TABLE job_report_variable_values ADD COLUMN IF NOT EXISTS version_id INTEGER")
    con.execute("ALTER TABLE job_report_variable_values ADD COLUMN IF NOT EXISTS variable_key VARCHAR")
    con.execute("ALTER TABLE job_report_variable_values ADD COLUMN IF NOT EXISTS variable_value TEXT")
    con.execute("ALTER TABLE job_report_variable_values ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()")
    con.execute("ALTER TABLE job_report_variable_values ADD COLUMN IF NOT EXISTS updated_by VARCHAR")
    try:
        con.execute(
            """
            UPDATE job_report_variable_values jrv
            SET org_id = COALESCE(jrv.org_id, c.org_id)
            FROM jobs j
            JOIN clients c ON c.db_id = j.client_db_id
            WHERE j.job_id = jrv.job_id
              AND jrv.org_id IS NULL
            """
        )
    except Exception:
        logger.debug("Ignoring job_report_variable_values org backfill failure", exc_info=True)

    con.execute(
        """
        CREATE TABLE IF NOT EXISTS job_report_template_assignments (
          org_id TEXT,
          job_id INTEGER PRIMARY KEY REFERENCES jobs(job_id) ON DELETE CASCADE,
          template_id INTEGER NOT NULL REFERENCES report_templates(template_id) ON DELETE RESTRICT,
          version_id INTEGER REFERENCES report_template_versions(version_id) ON DELETE SET NULL,
          assigned_at TIMESTAMP DEFAULT NOW(),
          assigned_by VARCHAR
        )
        """
    )
    con.execute("ALTER TABLE job_report_template_assignments ADD COLUMN IF NOT EXISTS org_id TEXT")
    con.execute("ALTER TABLE job_report_template_assignments ADD COLUMN IF NOT EXISTS template_id INTEGER")
    con.execute("ALTER TABLE job_report_template_assignments ADD COLUMN IF NOT EXISTS version_id INTEGER")
    con.execute("ALTER TABLE job_report_template_assignments ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP DEFAULT NOW()")
    con.execute("ALTER TABLE job_report_template_assignments ADD COLUMN IF NOT EXISTS assigned_by VARCHAR")
    try:
        con.execute(
            """
            UPDATE job_report_template_assignments jra
            SET org_id = COALESCE(jra.org_id, c.org_id)
            FROM jobs j
            JOIN clients c ON c.db_id = j.client_db_id
            WHERE j.job_id = jra.job_id
              AND jra.org_id IS NULL
            """
        )
    except Exception:
        logger.debug("Ignoring job_report_template_assignments org backfill failure", exc_info=True)

    con.execute(
        """
        CREATE INDEX IF NOT EXISTS report_templates_scope_idx
        ON report_templates (is_global, client_db_id)
        """
    )

    _seed_default_report_templates(con)

    _REPORT_TEMPLATE_SCHEMA_READY = True


class JobVariableValue(BaseModel):
    variable_key: str
    variable_value: Optional[str] = None


class SaveJobVariablesPayload(BaseModel):
    variables: List[JobVariableValue]


class AssignTemplatePayload(BaseModel):
    template_id: int | None = None
    template_key: str | None = None
    version_id: Optional[int] = None


class SaveReportMetadataPayload(BaseModel):
    metadata: dict[str, Any]


REPORT_METADATA_COLUMNS = [
    "report_title",
    "benchmark_period_label",
    "current_reporting_period_label",
    "company_number",
    "registered_address",
    "employee_number",
    "premises_owned",
    "premises_leased",
    "vehicles_owned",
    "vehicles_leased",
    "operational_control",
    "financial_control",
    "equity_share",
    "commitment_commentary",
    "activity_commentary",
    "intensity_commentary",
    "emissions_reduction_targets_commentary",
    "data_confidence_commentary",
    "methodologies_used",
    "datasets_names",
    "energy_consumption_uk_kwh",
    "energy_consumption_non_uk_kwh",
    "energy_reporting_basis",
    "renewable_energy_kwh",
    "renewable_energy_pct",
    "energy_emissions_tco2e",
    "energy_emissions_market_tco2e",
    "carbon_offsets_tco2e",
    "consultant_name",
    "consultant_position",
    "consultant_signature_date",
    "client_signee_name",
    "client_signee_position",
    "client_signature_date",
]

REPORT_METADATA_BOOLEAN_FIELDS = {
    "operational_control",
    "financial_control",
    "equity_share",
}

REPORT_METADATA_INTEGER_FIELDS = {
    "employee_number",
    "premises_owned",
    "premises_leased",
    "vehicles_owned",
    "vehicles_leased",
}

REPORT_METADATA_FLOAT_FIELDS = {
    "energy_consumption_uk_kwh",
    "energy_consumption_non_uk_kwh",
    "renewable_energy_kwh",
    "renewable_energy_pct",
    "energy_emissions_tco2e",
    "energy_emissions_market_tco2e",
    "carbon_offsets_tco2e",
}

REPORT_METADATA_DATE_FIELDS = {
    "consultant_signature_date",
    "client_signature_date",
}

REPORT_METADATA_DEFAULTS: dict[str, Any] = {
    "report_title": "Annual Carbon Emissions Report",
    "operational_control": True,
    "financial_control": False,
    "equity_share": False,
    "methodologies_used": "GHG Protocol Corporate Standard",
    "datasets_names": "DESNZ Greenhouse Gas Conversion Factors",
    "energy_reporting_basis": "Location-based",
    "renewable_energy_kwh": 0.0,
    "renewable_energy_pct": 0.0,
    "energy_emissions_tco2e": 0.0,
    "energy_emissions_market_tco2e": 0.0,
    "carbon_offsets_tco2e": 0.0,
}

REPORT_METADATA_AUTO_SYNC_FIELDS = {
    "datasets_names",
    "energy_consumption_uk_kwh",
    "energy_consumption_non_uk_kwh",
    "renewable_energy_kwh",
    "renewable_energy_pct",
    "energy_emissions_tco2e",
    "energy_emissions_market_tco2e",
}

REPORT_METADATA_LABELS: dict[str, str] = {
    "report_title": "Report Title",
    "benchmark_period_label": "Benchmark Period",
    "current_reporting_period_label": "Reporting Period",
    "company_number": "Company Number",
    "registered_address": "Registered Address",
    "employee_number": "Employee Number",
    "premises_owned": "Premises Owned",
    "premises_leased": "Premises Leased",
    "vehicles_owned": "Vehicles Owned",
    "vehicles_leased": "Vehicles Leased",
    "operational_control": "Operational Control",
    "financial_control": "Financial Control",
    "equity_share": "Equity Share",
    "commitment_commentary": "Commitment Commentary",
    "activity_commentary": "Activity Commentary",
    "intensity_commentary": "Intensity Commentary",
    "emissions_reduction_targets_commentary": "Emissions Reduction Targets Commentary",
    "data_confidence_commentary": "Data Confidence Commentary",
    "methodologies_used": "Methodologies Used",
    "datasets_names": "Datasets Names",
    "energy_consumption_uk_kwh": "UK Energy kWh",
    "energy_consumption_non_uk_kwh": "Non-UK Energy kWh",
    "energy_reporting_basis": "Basis of Energy Reporting",
    "renewable_energy_kwh": "Renewable Energy kWh",
    "renewable_energy_pct": "Renewables % (Legacy)",
    "energy_emissions_tco2e": "Energy Emissions (Location-based)",
    "energy_emissions_market_tco2e": "Energy Emissions (Market-based)",
    "carbon_offsets_tco2e": "Carbon Offsets",
    "consultant_name": "Consultant Name",
    "consultant_position": "Consultant Position",
    "consultant_signature_date": "Consultant Signature Date",
    "client_signee_name": "Client Signee",
    "client_signee_position": "Client Signee Position",
    "client_signature_date": "Client Signature Date",
}

REPORT_METADATA_TEXTAREA_FIELDS = {
    "registered_address",
    "commitment_commentary",
    "activity_commentary",
    "intensity_commentary",
    "emissions_reduction_targets_commentary",
    "data_confidence_commentary",
    "methodologies_used",
    "datasets_names",
}

REPORT_METADATA_EXTRA_ALIASES: dict[str, list[str]] = {
    "report_title": ["{Report Title}"],
    "benchmark_period_label": ["{Benchmark Period}"],
    "current_reporting_period_label": ["Current Reporting Period", "{Reporting Period}"],
    "company_number": ["{Company Number}"],
    "registered_address": ["{Registered Address}"],
    "employee_number": ["{Employee Number}"],
    "premises_owned": ["{Premises Owned}"],
    "premises_leased": ["{Premises Leased}"],
    "vehicles_owned": ["{Vehicles Owned}"],
    "vehicles_leased": ["{Vehicles Leased}"],
    "operational_control": ["{Operational Control}"],
    "financial_control": ["{Financial Control}"],
    "equity_share": ["{Equity Share}"],
    "commitment_commentary": ["{Commitment Commentary}"],
    "activity_commentary": ["{Activity Commentary}"],
    "intensity_commentary": ["{Intensity Commentary}"],
    "emissions_reduction_targets_commentary": [
        "{Emissions Reduction Targets Commentary}",
        "Emissions Reductions Targets Commentary",
        "{Emissions Reductions Targets Commentary}",
    ],
    "data_confidence_commentary": ["Data Confidence", "{Data Confidence Commentary}"],
    "methodologies_used": ["Methodology", "{Methodologies Used}"],
    "datasets_names": ["Datasets", "{Datasets Names}"],
    "energy_consumption_uk_kwh": ["total kWh", "{total kWh}", "{UK Energy kWh}"],
    "energy_consumption_non_uk_kwh": ["{Non-UK Energy kWh}"],
    "energy_reporting_basis": ["{Basis of Energy Reporting}"],
    "renewable_energy_kwh": ["Renewable Energy (kWh)", "{Renewable Energy kWh}", "{Renewable Energy (kWh)}"],
    "renewable_energy_pct": ["Renewable Energy %", "{Renewables %}"],
    "energy_emissions_tco2e": ["{Energy Emissions}", "Energy Emissions (Location-based)", "{Energy Emissions (Location-based)}"],
    "energy_emissions_market_tco2e": [
        "Energy Emissions (Market-based)",
        "{Energy Emissions (Market-based)}",
        "Energy Emissions Market",
        "{Energy Emissions Market}",
    ],
    "carbon_offsets_tco2e": ["carbon offsets", "{carbon offsets}", "{Carbon Offsets}"],
    "consultant_name": ["{Consultant Name}"],
    "consultant_position": ["{Consultant Position}"],
    "consultant_signature_date": ["Current Date", "{Current Date}", "{Consultant Signature Date}"],
    "client_signee_name": ["Client Signatory", "{Client Signee}"],
    "client_signee_position": ["{Client Signee Position}"],
    "client_signature_date": ["{Client Signature Date}"],
}

REPORT_JOB_PLACEHOLDER_ALIASES: dict[str, str] = {
    "Client Name": "client_name",
    "Job Number": "job_number",
    "Reporting Year": "reporting_year",
    "Reporting Period Start": "period_start",
    "Reporting Period End": "period_end",
}

# Optional template-specific final-issue variable overrides.
# When present, only these keys are treated as final-issue fields for that template.
_TEMPLATE_REQUIRED_KEY_OVERRIDES: dict[str, set[str]] = {
    "crp_standard": {
        "commitment_statement",
        "baseline_year",
        "target_year",
        "declaration_statement",
        "signatory_name",
        "signatory_position",
        "signature_date",
        "executive_summary",
    },
}


def _get_template_required_key_override(con, template_id: int) -> set[str] | None:
    try:
        template_row = con.execute(
            "SELECT template_key FROM report_templates WHERE template_id = %s",
            [int(template_id)],
        ).fetchone()
        template_key = str(template_row[0] or "").strip().lower() if template_row else ""
    except Exception:
        logger.debug("Failed to resolve template required-key override; continuing without override", exc_info=True)
        template_key = ""
    return _TEMPLATE_REQUIRED_KEY_OVERRIDES.get(template_key)

REPORT_SCOPE_PLACEHOLDER_ALIASES: dict[str, str] = {
    "Scope 1 Emissions": "Scope 1",
    "Scope 2 Emissions": "Scope 2",
    "Scope 3 Emissions": "Scope 3",
    "Total Emissions": "Total",
}


def _normalize_placeholder_key(raw_key: str) -> str:
    token = str(raw_key or "").strip()
    if token.startswith("{") and token.endswith("}"):
        token = token[1:-1]
    token = token.replace("&", " and ")
    token = token.replace("%", " pct ")
    token = token.replace("CO₂", "CO2").replace("co₂", "co2")
    token = token.lower()
    token = re.sub(r"[^a-z0-9]+", "_", token).strip("_")
    return token


REPORT_METADATA_NORMALIZED_KEY_MAP: dict[str, str] = {
    _normalize_placeholder_key(k): k for k in REPORT_METADATA_COLUMNS
}

REPORT_METADATA_ALIAS_TO_KEY: dict[str, str] = {}
for _meta_key in REPORT_METADATA_COLUMNS:
    _aliases = {
        _meta_key,
        REPORT_METADATA_LABELS.get(_meta_key, _meta_key),
        f"{{{REPORT_METADATA_LABELS.get(_meta_key, _meta_key)}}}",
    }
    _aliases.update(REPORT_METADATA_EXTRA_ALIASES.get(_meta_key, []))
    for _alias in _aliases:
        _normalized = _normalize_placeholder_key(_alias)
        if _normalized:
            REPORT_METADATA_ALIAS_TO_KEY[_normalized] = _meta_key


def _report_meta_label(key: str) -> str:
    return REPORT_METADATA_LABELS.get(key, key.replace("_", " ").title())


def _report_meta_field_type(key: str) -> str:
    if key in REPORT_METADATA_BOOLEAN_FIELDS:
        return "boolean"
    if key in REPORT_METADATA_INTEGER_FIELDS or key in REPORT_METADATA_FLOAT_FIELDS:
        return "number"
    if key in REPORT_METADATA_DATE_FIELDS:
        return "date"
    if key in REPORT_METADATA_TEXTAREA_FIELDS:
        return "textarea"
    return "text"


def _report_meta_section(key: str) -> str:
    if key in {
        "report_title",
        "benchmark_period_label",
        "current_reporting_period_label",
    }:
        return "Report Details"
    if key in {
        "company_number",
        "registered_address",
        "employee_number",
        "premises_owned",
        "premises_leased",
        "vehicles_owned",
        "vehicles_leased",
    }:
        return "Organisation Details"
    if key in {"operational_control", "financial_control", "equity_share"}:
        return "Boundary Controls"
    if key in {
        "commitment_commentary",
        "activity_commentary",
        "intensity_commentary",
        "emissions_reduction_targets_commentary",
        "data_confidence_commentary",
        "methodologies_used",
        "datasets_names",
    }:
        return "Narrative"
    if key in {
        "energy_consumption_uk_kwh",
        "energy_consumption_non_uk_kwh",
        "energy_reporting_basis",
        "renewable_energy_kwh",
        "renewable_energy_pct",
        "energy_emissions_tco2e",
        "energy_emissions_market_tco2e",
        "carbon_offsets_tco2e",
    }:
        return "Energy & Emissions"
    return "Sign-off"


def _get_report_metadata_fields() -> list[dict[str, Any]]:
    fields: list[dict[str, Any]] = []
    for key in REPORT_METADATA_COLUMNS:
        fields.append(
            {
                "key": key,
                "label": _report_meta_label(key),
                "field_type": _report_meta_field_type(key),
                "section": _report_meta_section(key),
                "aliases": REPORT_METADATA_EXTRA_ALIASES.get(key, []),
            }
        )
    return fields


def _resolve_report_meta_key(raw_key: str) -> str | None:
    raw = str(raw_key or "").strip()
    if raw in REPORT_METADATA_COLUMNS:
        return raw

    normalized = _normalize_placeholder_key(raw)
    if not normalized:
        return None

    direct = REPORT_METADATA_NORMALIZED_KEY_MAP.get(normalized)
    if direct:
        return direct
    return REPORT_METADATA_ALIAS_TO_KEY.get(normalized)


def _set_render_alias(render_values: dict[str, Any], alias: str, value: Any) -> None:
    alias_text = str(alias or "").strip()
    if not alias_text:
        return

    render_values[alias_text] = value
    if alias_text.startswith("{") and alias_text.endswith("}"):
        bare = alias_text[1:-1].strip()
        if bare:
            render_values[bare] = value
    else:
        render_values[f"{{{alias_text}}}"] = value


def _build_report_render_values(
    *,
    job_data: dict[str, Any] | None = None,
    scope_totals: dict[str, Any] | None = None,
    template_variables: dict[str, Any] | None = None,
    report_metadata: dict[str, Any] | None = None,
    generation_date: str | None = None,
) -> dict[str, Any]:
    """
    Build a merged render dictionary that supports canonical keys and
    one-to-one placeholder aliases (e.g. {Report Title}).
    """
    render_values: dict[str, Any] = {}

    metadata_values = {
        k: _serialize_meta_value(v) for k, v in (report_metadata or {}).items()
    }
    for key, value in metadata_values.items():
        if value is not None:
            render_values[key] = value

    template_values = {
        k: _serialize_meta_value(v) for k, v in (template_variables or {}).items()
    }
    for key, value in template_values.items():
        if value is not None and str(value).strip() != "":
            render_values[key] = value

    for key, value in (job_data or {}).items():
        serialized = _serialize_meta_value(value)
        render_values[f"job_data.{key}"] = serialized
        render_values.setdefault(str(key), serialized)

    for scope, value in (scope_totals or {}).items():
        serialized = _serialize_meta_value(value)
        safe_scope = str(scope).strip().replace(" ", "_").lower()
        render_values[f"scope_totals.{scope}"] = serialized
        render_values[f"scope_totals_{safe_scope}"] = serialized

    for key in REPORT_METADATA_COLUMNS:
        if key not in render_values:
            continue
        value = render_values.get(key)
        _set_render_alias(render_values, _report_meta_label(key), value)
        for alias in REPORT_METADATA_EXTRA_ALIASES.get(key, []):
            _set_render_alias(render_values, alias, value)

    for placeholder, source_key in REPORT_JOB_PLACEHOLDER_ALIASES.items():
        value = render_values.get(source_key)
        if value is None and job_data is not None:
            value = _serialize_meta_value(job_data.get(source_key))
        if value is None or str(value).strip() == "":
            continue
        _set_render_alias(render_values, placeholder, value)

    for placeholder, scope_name in REPORT_SCOPE_PLACEHOLDER_ALIASES.items():
        value = None
        if scope_totals is not None:
            value = _serialize_meta_value(scope_totals.get(scope_name))
        if value is None:
            continue
        _set_render_alias(render_values, placeholder, value)

    if generation_date:
        _set_render_alias(render_values, "Current Date", generation_date)
        render_values["generation_date"] = generation_date

    return render_values


def _serialize_meta_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def _serialize_report_meta(meta: dict[str, Any]) -> dict[str, Any]:
    return {k: _serialize_meta_value(meta.get(k)) for k in REPORT_METADATA_COLUMNS}


def _format_period_label(start_value: Any, end_value: Any) -> str | None:
    def _to_date(v: Any) -> date | None:
        if v is None:
            return None
        if isinstance(v, datetime):
            return v.date()
        if isinstance(v, date):
            return v
        try:
            return datetime.fromisoformat(str(v)).date()
        except Exception:
            logger.debug("Failed to parse period date value; returning None", exc_info=True)
            return None

    start_dt = _to_date(start_value)
    end_dt = _to_date(end_value)
    if start_dt and end_dt:
        return f"{start_dt.strftime('%d %B %Y')} – {end_dt.strftime('%d %B %Y')}"
    if start_dt:
        return start_dt.strftime('%d %B %Y')
    if end_dt:
        return end_dt.strftime('%d %B %Y')
    return None


def _build_registered_address(parts: list[Any]) -> str | None:
    cleaned = [str(p).strip().rstrip(",").strip() for p in parts if p is not None and str(p).strip()]
    return ", ".join(cleaned) if cleaned else None


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        logger.debug("Failed to coerce float value; returning None", exc_info=True)
        return None


def _safe_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
            return default
        return bool(value)
    text = str(value).strip().lower()
    if text in {"", "nan", "nat", "none", "null"}:
        return default
    if text in {"true", "t", "yes", "y", "1"}:
        return True
    if text in {"false", "f", "no", "n", "0"}:
        return False
    return bool(text)


def _json_safe_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    text = str(value).strip()
    if text.lower() in {"nan", "nat", "none", "null"}:
        return None
    return value


DEFAULT_LOCATION_BASED_ELECTRICITY_FACTOR_KG_PER_KWH = 0.177
DEFAULT_TD_ELECTRICITY_FACTOR_KG_PER_KWH = 0.01853
UK_COUNTRY_TOKENS = {
    "uk",
    "united kingdom",
    "great britain",
    "gb",
    "england",
    "scotland",
    "wales",
    "northern ireland",
}
GLOBAL_COUNTRY_TOKENS = {
    "",
    "global",
    "international",
    "all",
    "all countries",
    "multi-country",
    "n/a",
    "na",
}
ENERGY_ROW_EXCLUSION_MARKERS = (
    "for ev",
    "evs",
    "battery electric vehicle",
    "plug-in hybrid",
    "managed assets",
    "district heat",
    "steam",
    "wfh",
    "homeworking",
)
ENERGY_INPUT_TD_MARKERS = (
    "transmission and distribution",
    "t&d",
    "td-",
)
RENEWABLE_ELECTRICITY_INPUT_MARKERS = (
    "green electricity",
    "renewable electricity",
    "renewable tariff",
    "renewable power",
    "renewable energy",
)


def _normalize_energy_factor_text(value: Any) -> str:
    return str(value or "").strip().lower()


def _normalize_country_token(value: Any) -> str:
    return str(value or "").strip().lower()


def _table_columns(con, table_name: str) -> set[str]:
    try:
        df = con.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = %s
            """,
            [str(table_name)],
        ).df()
        if df is None or df.empty:
            return set()
        return {str(v).strip().lower() for v in df["column_name"].tolist()}
    except Exception:
        logger.debug("Failed to read selector columns; returning empty set", exc_info=True)
        return set()


def _is_uk_country(country_norm: str) -> bool:
    return country_norm in UK_COUNTRY_TOKENS


def _is_global_country(country_norm: str) -> bool:
    return country_norm in GLOBAL_COUNTRY_TOKENS


def _build_factor_text_blob(*parts: Any) -> str:
    return " | ".join(_normalize_energy_factor_text(part) for part in parts if part is not None)


def _is_kwh_factor_row(uom: str, level_4: str, text_blob: str) -> bool:
    return uom == "kwh" or level_4 == "kwh" or " kwh" in text_blob or text_blob.endswith("kwh")


def _job_scope_rows_select_parts(con) -> dict[str, str]:
    cols = _table_columns(con, "job_scope_rows")
    has = lambda c: c in cols
    parts: dict[str, str] = {
        "enabled_predicate": "COALESCE(jsr.enabled, TRUE) = TRUE" if has("enabled") else "TRUE",
        "level_4_expr": "jsr.level_4" if has("level_4") else "NULL::text AS level_4",
        "report_label_expr": "jsr.report_label" if has("report_label") else "NULL::text AS report_label",
        "apply_pct_expr": "jsr.apply_pct" if has("apply_pct") else "100::numeric AS apply_pct",
    }
    for month_idx in range(1, 13):
        col = f"month_{month_idx}"
        parts[f"{col}_expr"] = f"jsr.{col}" if has(col) else f"NULL::numeric AS {col}"
    return parts


def _is_scope_2_electricity_input_row(
    *,
    scope: str,
    uom: str,
    level_1: str,
    level_2: str,
    level_3: str,
    level_4: str,
    column_text: str,
    report_label: str,
) -> bool:
    text_blob = _build_factor_text_blob(level_1, level_2, level_3, level_4, column_text, report_label)
    if scope != "scope 2" or not _is_kwh_factor_row(uom, level_4, text_blob):
        return False
    if "electricity" not in text_blob:
        return False
    if any(marker in text_blob for marker in ENERGY_ROW_EXCLUSION_MARKERS):
        return False
    if any(marker in text_blob for marker in ENERGY_INPUT_TD_MARKERS):
        return False
    return True


def _is_renewable_electricity_input_row(
    *,
    scope: str,
    uom: str,
    level_1: str,
    level_2: str,
    level_3: str,
    level_4: str,
    column_text: str,
    report_label: str,
) -> bool:
    if not _is_scope_2_electricity_input_row(
        scope=scope,
        uom=uom,
        level_1=level_1,
        level_2=level_2,
        level_3=level_3,
        level_4=level_4,
        column_text=column_text,
        report_label=report_label,
    ):
        return False
    text_blob = _build_factor_text_blob(level_1, level_2, level_3, level_4, column_text, report_label)
    return any(marker in text_blob for marker in RENEWABLE_ELECTRICITY_INPUT_MARKERS)


def _get_job_primary_scope_country(con, job_id: int, scope_name: str) -> str:
    try:
        scope_map = get_scope_primary_datasets(int(job_id))
        raw_dataset_id = scope_map.get(str(scope_name))
        dataset_id = int(raw_dataset_id) if raw_dataset_id is not None else None
        if dataset_id is None:
            return ""
        row = con.execute(
            "SELECT country FROM datasets WHERE dataset_id = %s",
            [int(dataset_id)],
        ).fetchone()
        if not row:
            return ""
        return _normalize_country_token(row[0])
    except Exception:
        logger.debug("Failed to resolve dataset country; returning empty string", exc_info=True)
        return ""


def _job_scope_row_effective_quantity(row: dict[str, Any]) -> float:
    monthly_total = 0.0
    for month_idx in range(1, 13):
        monthly_total += _safe_float(row.get(f"month_{month_idx}")) or 0.0

    qty = _safe_float(row.get("qty"))
    base_qty = qty if qty is not None and qty > 0 else monthly_total
    apply_pct = max(0.0, _safe_float(row.get("apply_pct")) or 100.0)
    return max(0.0, base_qty * (apply_pct / 100.0))


def _score_location_based_electricity_row(
    *,
    scope: str,
    uom: str,
    level_1: str,
    level_2: str,
    level_3: str,
    level_4: str,
    column_text: str,
    report_label: str,
    dataset_country: str,
) -> int | None:
    text_blob = _build_factor_text_blob(level_1, level_2, level_3, level_4, column_text, report_label)
    if scope != "scope 2" or not _is_kwh_factor_row(uom, level_4, text_blob):
        return None
    if "electricity" not in text_blob:
        return None
    if any(marker in text_blob for marker in ENERGY_ROW_EXCLUSION_MARKERS):
        return None

    score = 10
    if "electricity generated" in text_blob:
        score += 120
    if "purchased electricity" in text_blob:
        score += 90
    if "uk electricity" in text_blob:
        score += 40
    if dataset_country and not _is_global_country(dataset_country) and dataset_country in text_blob:
        score += 35
    if "electricity:" in text_blob:
        score += 15
    if level_1 == "uk electricity" and level_2 == "electricity generated":
        score += 25
    return score


def _score_td_electricity_row(
    *,
    scope: str,
    uom: str,
    level_1: str,
    level_2: str,
    level_3: str,
    level_4: str,
    column_text: str,
    report_label: str,
    dataset_country: str,
) -> int | None:
    text_blob = _build_factor_text_blob(level_1, level_2, level_3, level_4, column_text, report_label)
    if scope != "scope 3" or not _is_kwh_factor_row(uom, level_4, text_blob):
        return None
    if "electricity" not in text_blob:
        return None
    if "transmission and distribution" not in text_blob and "t&d" not in text_blob:
        return None
    if "district heat" in text_blob or "steam" in text_blob:
        return None

    score = 10
    if "transmission and distribution" in text_blob:
        score += 100
    if "t&d" in text_blob:
        score += 60
    if "uk electricity" in text_blob:
        score += 40
    if dataset_country and not _is_global_country(dataset_country) and dataset_country in text_blob:
        score += 35
    return score


def _format_factor_asset_path(year: int) -> Path:
    return Path(__file__).resolve().parent.parent / "assets" / "conversion_factors" / f"{int(year)}-DESNZ-Conversion-Factors-Activity.csv"


@lru_cache(maxsize=8)
def _load_energy_factors_from_asset(year: int) -> tuple[float | None, float | None]:
    candidate_years: list[int] = []
    try:
        candidate_years.append(int(year))
    except Exception:
        logger.debug("Ignoring invalid template year input while building candidate years", exc_info=True)
    if 2025 not in candidate_years:
        candidate_years.append(2025)

    for candidate_year in candidate_years:
        csv_path = _format_factor_asset_path(candidate_year)
        if not csv_path.exists():
            continue

        factor_column = f"GHG Conversion Factor {candidate_year}"
        try:
            with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
                reader = csv.DictReader(handle)
                location_factor: float | None = None
                td_factor: float | None = None
                for row in reader:
                    scope = _normalize_energy_factor_text(row.get("Scope"))
                    uom = _normalize_energy_factor_text(row.get("UOM"))
                    level_1 = _normalize_energy_factor_text(row.get("Category "))
                    level_2 = _normalize_energy_factor_text(row.get("Level 2"))
                    level_3 = _normalize_energy_factor_text(row.get("Level 3"))
                    factor = _safe_float(row.get(factor_column))
                    if factor is None:
                        continue

                    if (
                        location_factor is None
                        and scope == "scope 2"
                        and uom == "kwh"
                        and level_1 == "uk electricity"
                        and level_2 == "electricity generated"
                        and level_3 == "electricity: uk"
                    ):
                        location_factor = factor
                        continue

                    if (
                        td_factor is None
                        and scope == "scope 3"
                        and uom == "kwh"
                        and level_1 == "transmission and distribution"
                        and level_2 == "t&d- uk electricity"
                        and level_3 == "electricity: uk"
                    ):
                        td_factor = factor

                if location_factor is not None or td_factor is not None:
                    return (location_factor, td_factor)
        except Exception:
            logger.debug("Legacy energy-factor schema lookup failed; continuing to next candidate", exc_info=True)
            continue

    return (None, None)


def _lookup_energy_factors_from_dataset(con, dataset_id: int) -> tuple[float | None, float | None]:
    dataset_country = ""
    try:
        dataset_row = con.execute(
            "SELECT country FROM datasets WHERE dataset_id = %s",
            [int(dataset_id)],
        ).fetchone()
        dataset_country = _normalize_country_token(dataset_row[0] if dataset_row else "")
    except Exception:
        logger.debug("Failed to resolve dataset country for energy-factor lookup; continuing without country context", exc_info=True)
        dataset_country = ""

    try:
        rows = con.execute(
            """
            SELECT scope,
                   level_1,
                   level_2,
                   level_3,
                   level_4,
                   column_text,
                   report_label,
                   uom,
                   factor
            FROM v_factor_lookup
            WHERE dataset_id = %s
              AND scope IN ('Scope 2', 'Scope 3')
            """,
            [int(dataset_id)],
        ).fetchall()
    except Exception:
        logger.debug("Legacy energy-factor schema lookup failed; continuing to fallback schema", exc_info=True)
        try:
            # Backward compatibility for older factor_lookup schemas without level_4/report_label.
            rows = con.execute(
                """
                SELECT scope,
                       level_1,
                       level_2,
                       level_3,
                       NULL AS level_4,
                       column_text,
                       NULL AS report_label,
                       uom,
                       factor
                FROM v_factor_lookup
                WHERE dataset_id = %s
                  AND scope IN ('Scope 2', 'Scope 3')
                """,
                [int(dataset_id)],
            ).fetchall()
        except Exception:
            logger.debug("Failed to load factor_lookup rows for energy factor resolution; returning no rows", exc_info=True)
            rows = []

    best_location_factor: tuple[int, float] | None = None
    best_td_factor: tuple[int, float] | None = None

    for row in rows:
        scope = _normalize_energy_factor_text(row[0])
        level_1 = _normalize_energy_factor_text(row[1])
        level_2 = _normalize_energy_factor_text(row[2])
        level_3 = _normalize_energy_factor_text(row[3])
        level_4 = _normalize_energy_factor_text(row[4])
        column_text = _normalize_energy_factor_text(row[5])
        report_label = _normalize_energy_factor_text(row[6])
        uom = _normalize_energy_factor_text(row[7])
        factor = _safe_float(row[8])
        if factor is None:
            continue

        location_score = _score_location_based_electricity_row(
            scope=scope,
            uom=uom,
            level_1=level_1,
            level_2=level_2,
            level_3=level_3,
            level_4=level_4,
            column_text=column_text,
            report_label=report_label,
            dataset_country=dataset_country,
        )
        if location_score is not None and (
            best_location_factor is None or location_score > best_location_factor[0]
        ):
            best_location_factor = (location_score, factor)

        td_score = _score_td_electricity_row(
            scope=scope,
            uom=uom,
            level_1=level_1,
            level_2=level_2,
            level_3=level_3,
            level_4=level_4,
            column_text=column_text,
            report_label=report_label,
            dataset_country=dataset_country,
        )
        if td_score is not None and (
            best_td_factor is None or td_score > best_td_factor[0]
        ):
            best_td_factor = (td_score, factor)

    return (
        best_location_factor[1] if best_location_factor else None,
        best_td_factor[1] if best_td_factor else None,
    )


def _get_job_energy_factor_year(con, job_id: int, dataset_id: int | None) -> int:
    if dataset_id is not None:
        try:
            row = con.execute(
                "SELECT year FROM datasets WHERE dataset_id = %s",
                [int(dataset_id)],
            ).fetchone()
            if row and row[0] is not None:
                return int(row[0])
        except Exception:
            logger.debug("Ignoring energy-factor year lookup failure", exc_info=True)

    try:
        row = con.execute(
            """
            SELECT reporting_period_end,
                   reporting_period_start,
                   reporting_year
            FROM jobs
            WHERE job_id = %s
            """,
            [int(job_id)],
        ).fetchone()
        if row:
            for value in (row[0], row[1]):
                if isinstance(value, datetime):
                    return value.year
                if isinstance(value, date):
                    return value.year
                text = str(value or "").strip()
                if len(text) >= 4 and text[:4].isdigit():
                    return int(text[:4])
            if row[2] is not None:
                return int(row[2])
    except Exception:
        logger.debug("Ignoring job reporting-year lookup failure", exc_info=True)

    return datetime.now().year


def _get_energy_emissions_factor_pair(con, job_id: int) -> tuple[float, float]:
    dataset_id: int | None = None
    try:
        scope_map = get_scope_primary_datasets(int(job_id))
        raw_scope_dataset = scope_map.get("Scope 2")
        dataset_id = int(raw_scope_dataset) if raw_scope_dataset is not None else None
    except Exception:
        logger.debug("Failed to resolve scope 2 dataset for energy-factor lookup; continuing without dataset context", exc_info=True)
        dataset_id = None

    factor_year = _get_job_energy_factor_year(con, int(job_id), dataset_id)
    asset_location_factor, asset_td_factor = _load_energy_factors_from_asset(int(factor_year))

    location_samples: list[float] = []
    td_samples: list[float] = []

    try:
        resolution = resolve_dataset_resolution(int(job_id), scopes=("Scope 2", "Scope 3"))
    except Exception:
        logger.debug("Failed to resolve dataset resolution for energy factor pair; defaulting to empty resolution", exc_info=True)
        resolution = {}

    dataset_catalog = {
        int(ds.get("dataset_id")): ds
        for ds in (resolution.get("dataset_catalog") or [])
        if ds.get("dataset_id") is not None
    }
    factor_cache: dict[int, tuple[float | None, float | None]] = {}

    for month_record in resolution.get("months") or []:
        scope_month_map = month_record.get("scope_datasets") or {}

        raw_scope_2_dataset = scope_month_map.get("Scope 2")
        scope_2_dataset = int(raw_scope_2_dataset) if raw_scope_2_dataset is not None else None
        if scope_2_dataset is not None:
            ds_meta = dataset_catalog.get(scope_2_dataset) or {}
            ds_country = _normalize_country_token(ds_meta.get("country"))
            if _is_uk_country(ds_country) or _is_global_country(ds_country):
                factor_cache.setdefault(
                    scope_2_dataset,
                    _lookup_energy_factors_from_dataset(con, scope_2_dataset),
                )
                loc_factor, _ = factor_cache[scope_2_dataset]
                if loc_factor is not None:
                    location_samples.append(float(loc_factor))

        raw_scope_3_dataset = scope_month_map.get("Scope 3")
        scope_3_dataset = int(raw_scope_3_dataset) if raw_scope_3_dataset is not None else None
        if scope_3_dataset is not None:
            ds_meta = dataset_catalog.get(scope_3_dataset) or {}
            ds_country = _normalize_country_token(ds_meta.get("country"))
            if _is_uk_country(ds_country) or _is_global_country(ds_country):
                factor_cache.setdefault(
                    scope_3_dataset,
                    _lookup_energy_factors_from_dataset(con, scope_3_dataset),
                )
                _, td_factor = factor_cache[scope_3_dataset]
                if td_factor is not None:
                    td_samples.append(float(td_factor))

    location_factor = (
        (sum(location_samples) / len(location_samples))
        if location_samples
        else asset_location_factor
    )
    td_factor = (
        (sum(td_samples) / len(td_samples))
        if td_samples
        else asset_td_factor
    )

    return (
        float(location_factor if location_factor is not None else DEFAULT_LOCATION_BASED_ELECTRICITY_FACTOR_KG_PER_KWH),
        float(td_factor if td_factor is not None else DEFAULT_TD_ELECTRICITY_FACTOR_KG_PER_KWH),
    )


def _get_energy_emissions_factor_details(con, job_id: int) -> dict[str, float]:
    uk_location_factor, uk_td_factor = _get_energy_emissions_factor_pair(con, int(job_id))
    non_uk_location_factor = uk_location_factor
    non_uk_td_factor = uk_td_factor
    non_uk_factor_found = False

    try:
        resolution = resolve_dataset_resolution(int(job_id), scopes=("Scope 2", "Scope 3"))
    except Exception:
        logger.debug("Failed to resolve dataset resolution for report template sync; defaulting to empty resolution", exc_info=True)
        resolution = {}

    dataset_catalog = {
        int(ds.get("dataset_id")): ds
        for ds in (resolution.get("dataset_catalog") or [])
        if ds.get("dataset_id") is not None
    }
    factor_cache: dict[int, tuple[float | None, float | None]] = {}
    non_uk_location_samples: list[float] = []
    non_uk_td_samples: list[float] = []

    for month_record in resolution.get("months") or []:
        scope_map = month_record.get("scope_datasets") or {}

        raw_scope_2_dataset = scope_map.get("Scope 2")
        scope_2_dataset = int(raw_scope_2_dataset) if raw_scope_2_dataset is not None else None
        if scope_2_dataset is not None:
            ds_meta = dataset_catalog.get(scope_2_dataset) or {}
            ds_country = _normalize_country_token(ds_meta.get("country"))
            if ds_country and not _is_uk_country(ds_country) and not _is_global_country(ds_country):
                factor_cache.setdefault(
                    scope_2_dataset,
                    _lookup_energy_factors_from_dataset(con, scope_2_dataset),
                )
                loc_factor, _ = factor_cache[scope_2_dataset]
                if loc_factor is not None:
                    non_uk_location_samples.append(float(loc_factor))
                    non_uk_factor_found = True

        raw_scope_3_dataset = scope_map.get("Scope 3")
        scope_3_dataset = int(raw_scope_3_dataset) if raw_scope_3_dataset is not None else None
        if scope_3_dataset is not None:
            ds_meta = dataset_catalog.get(scope_3_dataset) or {}
            ds_country = _normalize_country_token(ds_meta.get("country"))
            if ds_country and not _is_uk_country(ds_country) and not _is_global_country(ds_country):
                factor_cache.setdefault(
                    scope_3_dataset,
                    _lookup_energy_factors_from_dataset(con, scope_3_dataset),
                )
                _, td_factor = factor_cache[scope_3_dataset]
                if td_factor is not None:
                    non_uk_td_samples.append(float(td_factor))
                    non_uk_factor_found = True

    if non_uk_location_samples:
        non_uk_location_factor = sum(non_uk_location_samples) / len(non_uk_location_samples)
    if non_uk_td_samples:
        non_uk_td_factor = sum(non_uk_td_samples) / len(non_uk_td_samples)

    return {
        "uk_location_based_kg_per_kwh": round(float(uk_location_factor), 8),
        "uk_transmission_distribution_kg_per_kwh": round(float(uk_td_factor), 8),
        "uk_combined_kg_per_kwh": round(float(uk_location_factor) + float(uk_td_factor), 8),
        "non_uk_location_based_kg_per_kwh": round(float(non_uk_location_factor), 8),
        "non_uk_transmission_distribution_kg_per_kwh": round(float(non_uk_td_factor), 8),
        "non_uk_combined_kg_per_kwh": round(
            float(non_uk_location_factor) + float(non_uk_td_factor),
            8,
        ),
        "renewable_allocation_method": "proportional",
        "non_uk_factor_derived_from_active_dataset": bool(non_uk_factor_found),
    }


def _derive_energy_kwh_from_scope_rows(con, job_id: int) -> dict[str, float]:
    parts = _job_scope_rows_select_parts(con)
    default_scope_2_country = _get_job_primary_scope_country(con, int(job_id), "Scope 2")
    rows = con.execute(
        f"""
        SELECT
            jsr.scope,
            jsr.dataset_id,
            d.country AS dataset_country,
            jsr.level_1,
            jsr.level_2,
            jsr.level_3,
            {parts['level_4_expr']},
            jsr.column_text,
            {parts['report_label_expr']},
            jsr.qty,
            jsr.uom,
            {parts['apply_pct_expr']},
            {parts['month_1_expr']},
            {parts['month_2_expr']},
            {parts['month_3_expr']},
            {parts['month_4_expr']},
            {parts['month_5_expr']},
            {parts['month_6_expr']},
            {parts['month_7_expr']},
            {parts['month_8_expr']},
            {parts['month_9_expr']},
            {parts['month_10_expr']},
            {parts['month_11_expr']},
            {parts['month_12_expr']}
        FROM job_scope_rows jsr
        LEFT JOIN datasets d ON d.dataset_id = jsr.dataset_id
        WHERE jsr.job_id = %s
          AND {parts['enabled_predicate']}
        """,
        [int(job_id)],
    ).df()

    if rows is None or rows.empty:
        return {
            "uk_kwh": 0.0,
            "non_uk_kwh": 0.0,
            "renewable_kwh": 0.0,
            "total_kwh": 0.0,
            "grid_kwh": 0.0,
        }

    uk_kwh = 0.0
    non_uk_kwh = 0.0
    renewable_kwh = 0.0

    rows = rows.where(rows.notna(), None)
    for _, source_row in rows.iterrows():
        row = source_row.to_dict()
        scope = _normalize_energy_factor_text(row.get("scope"))
        uom = _normalize_energy_factor_text(row.get("uom"))
        level_1 = _normalize_energy_factor_text(row.get("level_1"))
        level_2 = _normalize_energy_factor_text(row.get("level_2"))
        level_3 = _normalize_energy_factor_text(row.get("level_3"))
        level_4 = _normalize_energy_factor_text(row.get("level_4"))
        column_text = _normalize_energy_factor_text(row.get("column_text"))
        report_label = _normalize_energy_factor_text(row.get("report_label"))

        if not _is_scope_2_electricity_input_row(
            scope=scope,
            uom=uom,
            level_1=level_1,
            level_2=level_2,
            level_3=level_3,
            level_4=level_4,
            column_text=column_text,
            report_label=report_label,
        ):
            continue

        effective_qty = _job_scope_row_effective_quantity(row)
        if effective_qty <= 0:
            continue

        dataset_country = _normalize_country_token(row.get("dataset_country") or default_scope_2_country)
        if dataset_country and not _is_uk_country(dataset_country) and not _is_global_country(dataset_country):
            non_uk_kwh += effective_qty
        else:
            uk_kwh += effective_qty

        if _is_renewable_electricity_input_row(
            scope=scope,
            uom=uom,
            level_1=level_1,
            level_2=level_2,
            level_3=level_3,
            level_4=level_4,
            column_text=column_text,
            report_label=report_label,
        ):
            renewable_kwh += effective_qty

    # Also scan job_emission_sources (Asset Register) for electricity rows so
    # energy kWh figures match the Outputs / scope-totals path.
    try:
        src_rows = con.execute(
            """
            SELECT
                js.scope,
                COALESCE(g.uom, js.uom) AS uom,
                COALESCE(
                    NULLIF(TRIM(CAST(fl.category AS VARCHAR)), ''),
                    NULLIF(TRIM(CAST(js.category AS VARCHAR)), ''),
                    ''
                ) AS level_1,
                COALESCE(js.source_name, g.group_name, js.category) AS column_text,
                js.qty,
                js.apply_pct,
                d.country AS dataset_country
            FROM job_emission_sources js
            LEFT JOIN job_emission_groups g ON g.group_id = js.group_id
            LEFT JOIN datasets d ON d.dataset_id = COALESCE(g.dataset_id, js.dataset_id)
            LEFT JOIN LATERAL (
                SELECT
                    COALESCE(NULLIF(TRIM(_efd.category),''), NULLIF(TRIM(_fl.category),'')) AS category
                FROM factor_lookup _fl
                LEFT JOIN emission_factor_aliases _efa ON _efa.dataset_id = _fl.dataset_id AND _efa.original_id = _fl.original_id
                LEFT JOIN emission_factor_definitions _efd ON _efd.factor_id = _efa.factor_id
                WHERE _fl.db_id = COALESCE(g.factor_db_id, js.factor_db_id)
                LIMIT 1
            ) fl ON TRUE
            WHERE js.job_id = %s
              AND COALESCE(js.enabled, TRUE) = TRUE
            """,
            [int(job_id)],
        ).df()
    except Exception:
        src_rows = None

    if src_rows is not None and not src_rows.empty:
        src_rows = src_rows.where(src_rows.notna(), None)
        for _, source_row in src_rows.iterrows():
            row = source_row.to_dict()
            scope = _normalize_energy_factor_text(row.get("scope"))
            uom = _normalize_energy_factor_text(row.get("uom"))
            level_1 = _normalize_energy_factor_text(row.get("level_1"))
            column_text = _normalize_energy_factor_text(row.get("column_text"))

            if not _is_scope_2_electricity_input_row(
                scope=scope,
                uom=uom,
                level_1=level_1,
                level_2="",
                level_3="",
                level_4="",
                column_text=column_text,
                report_label=column_text,
            ):
                continue

            qty = _safe_float(row.get("qty"))
            if qty is None or qty <= 0:
                continue
            apply_pct = max(0.0, _safe_float(row.get("apply_pct")) or 100.0)
            effective_qty = qty * (apply_pct / 100.0)
            if effective_qty <= 0:
                continue

            dataset_country = _normalize_country_token(row.get("dataset_country") or default_scope_2_country)
            if dataset_country and not _is_uk_country(dataset_country) and not _is_global_country(dataset_country):
                non_uk_kwh += effective_qty
            else:
                uk_kwh += effective_qty

            if _is_renewable_electricity_input_row(
                scope=scope,
                uom=uom,
                level_1=level_1,
                level_2="",
                level_3="",
                level_4="",
                column_text=column_text,
                report_label=column_text,
            ):
                renewable_kwh += effective_qty

    total_kwh = uk_kwh + non_uk_kwh
    renewable_kwh = min(renewable_kwh, total_kwh)

    return {
        "uk_kwh": round(uk_kwh, 4),
        "non_uk_kwh": round(non_uk_kwh, 4),
        "renewable_kwh": round(renewable_kwh, 4),
        "total_kwh": round(total_kwh, 4),
        "grid_kwh": round(max(0.0, total_kwh - renewable_kwh), 4),
    }


def _sync_energy_inputs_from_scope_rows(con, job_id: int, meta: dict[str, Any]) -> bool:
    derived = _derive_energy_kwh_from_scope_rows(con, int(job_id))
    changed = False
    for meta_key, derived_key in (
        ("energy_consumption_uk_kwh", "uk_kwh"),
        ("energy_consumption_non_uk_kwh", "non_uk_kwh"),
        ("renewable_energy_kwh", "renewable_kwh"),
    ):
        next_value = round(float(derived.get(derived_key) or 0.0), 4)
        current_value = _safe_float(meta.get(meta_key))
        if current_value is None or round(float(current_value), 4) != next_value:
            meta[meta_key] = next_value
            changed = True
    return changed


def _sync_renewables_pct_from_kwh(meta: dict[str, Any]) -> bool:
    """
    Keep legacy renewables % in sync from renewable kWh so legacy templates
    continue to render correctly while UI inputs remain kWh-based.
    """
    renewable_kwh = _safe_float(meta.get("renewable_energy_kwh"))
    uk_kwh = _safe_float(meta.get("energy_consumption_uk_kwh")) or 0.0
    non_uk_kwh = _safe_float(meta.get("energy_consumption_non_uk_kwh")) or 0.0
    total_kwh = uk_kwh + non_uk_kwh

    if renewable_kwh is None:
        return False

    next_pct = 0.0 if total_kwh <= 0 else max(0.0, min(100.0, (renewable_kwh / total_kwh) * 100.0))
    next_pct = round(next_pct, 2)

    current_pct = _safe_float(meta.get("renewable_energy_pct"))
    if current_pct is None or round(current_pct, 2) != next_pct:
        meta["renewable_energy_pct"] = next_pct
        return True

    return False


def _sync_energy_emissions_from_kwh(con, job_id: int, meta: dict[str, Any]) -> bool:
    """
    Keep report metadata energy emissions aligned with the derived kWh inputs.

    Assumption:
    - UK and Non-UK energy can use different electricity factors.
    - Renewable kWh is allocated proportionally across UK and Non-UK energy when
      deriving the market-based location-based portion because the input is stored
      as a single total.
    - Transmission and distribution applies across all purchased grid electricity.
    """
    uk_kwh = max(0.0, _safe_float(meta.get("energy_consumption_uk_kwh")) or 0.0)
    non_uk_kwh = max(0.0, _safe_float(meta.get("energy_consumption_non_uk_kwh")) or 0.0)
    renewable_kwh = max(0.0, _safe_float(meta.get("renewable_energy_kwh")) or 0.0)
    total_kwh = uk_kwh + non_uk_kwh
    renewable_kwh = min(renewable_kwh, total_kwh)

    factor_details = _get_energy_emissions_factor_details(con, int(job_id))
    uk_location_factor = max(
        0.0,
        _safe_float(factor_details.get("uk_location_based_kg_per_kwh"))
        or DEFAULT_LOCATION_BASED_ELECTRICITY_FACTOR_KG_PER_KWH,
    )
    uk_td_factor = max(
        0.0,
        _safe_float(factor_details.get("uk_transmission_distribution_kg_per_kwh"))
        or DEFAULT_TD_ELECTRICITY_FACTOR_KG_PER_KWH,
    )
    non_uk_location_factor = max(
        0.0,
        _safe_float(factor_details.get("non_uk_location_based_kg_per_kwh")) or uk_location_factor,
    )
    non_uk_td_factor = max(
        0.0,
        _safe_float(factor_details.get("non_uk_transmission_distribution_kg_per_kwh")) or uk_td_factor,
    )

    renewable_ratio = 0.0 if total_kwh <= 0 else renewable_kwh / total_kwh
    uk_market_location_kwh = uk_kwh * (1.0 - renewable_ratio)
    non_uk_market_location_kwh = non_uk_kwh * (1.0 - renewable_ratio)

    next_location_tco2e = round(
        (
            (uk_kwh * uk_location_factor)
            + (uk_kwh * uk_td_factor)
            + (non_uk_kwh * non_uk_location_factor)
            + (non_uk_kwh * non_uk_td_factor)
        )
        / 1000.0,
        4,
    )
    next_market_tco2e = round(
        (
            (uk_market_location_kwh * uk_location_factor)
            + (uk_kwh * uk_td_factor)
            + (non_uk_market_location_kwh * non_uk_location_factor)
            + (non_uk_kwh * non_uk_td_factor)
        )
        / 1000.0,
        4,
    )

    current_location_tco2e = _safe_float(meta.get("energy_emissions_tco2e"))
    current_market_tco2e = _safe_float(meta.get("energy_emissions_market_tco2e"))

    changed = False
    if current_location_tco2e is None or round(current_location_tco2e, 4) != next_location_tco2e:
        meta["energy_emissions_tco2e"] = next_location_tco2e
        changed = True
    if current_market_tco2e is None or round(current_market_tco2e, 4) != next_market_tco2e:
        meta["energy_emissions_market_tco2e"] = next_market_tco2e
        changed = True

    return changed


def _sync_datasets_names_from_resolver(job_id: int, meta: dict[str, Any]) -> bool:
    """Keep datasets_names aligned with automatic dataset resolution output."""
    try:
        resolved_names = str(get_datasets_names_for_report(int(job_id)) or "").strip()
    except Exception:
        logger.debug("Failed to resolve datasets names for report sync", exc_info=True)
        return False

    if not resolved_names:
        return False

    current = str(meta.get("datasets_names") or "").strip()
    if current != resolved_names:
        meta["datasets_names"] = resolved_names
        return True

    return False


def _sync_employee_number_from_intensity_metrics(con, job_id: int, meta: dict[str, Any]) -> bool:
    """
    Sync employee_number from intensity_metrics.employees.value to report metadata.
    This ensures the Employee Number in reports reflects the value set in Intensity Metrics.
    """
    try:
        row = con.execute(
            "SELECT intensity_metrics FROM jobs WHERE job_id = %s",
            [int(job_id)]
        ).fetchone()
        
        if not row or not row[0]:
            return False
            
        intensity_metrics = row[0]
        if not isinstance(intensity_metrics, dict):
            return False
            
        employees_metric = intensity_metrics.get("employees", {})
        if employees_metric and isinstance(employees_metric, dict):
            employees_value = employees_metric.get("value")
            if employees_value is not None:
                try:
                    new_employee_number = int(employees_value)
                    current_employee_number = meta.get("employee_number")
                    # Sync if: current is None/0 OR intensity metrics value is different
                    if current_employee_number is None or current_employee_number == 0:
                        meta["employee_number"] = new_employee_number
                        return True
                    elif current_employee_number != new_employee_number:
                        # Only update if user hasn't manually set a different value
                        # For now, always sync to intensity metrics as the source of truth
                        meta["employee_number"] = new_employee_number
                        return True
                except (ValueError, TypeError):
                    logger.debug("Ignoring malformed employee_number value while syncing intensity metrics", exc_info=True)

        return False
    except Exception:
        logger.debug("Failed to sync employee number from intensity metrics", exc_info=True)
        return False


def _sync_reporting_elements_from_intensity_metrics(con, job_id: int, meta: dict[str, Any]) -> bool:
    """
    Sync reporting elements (premises and vehicles) from intensity_metrics to report metadata.
    This ensures these values in reports reflect what's set in Intensity Metrics.
    
    Intensity Metrics JSONB structure expected:
    {
        "employees": {"value": 100, "label": "Employee", "divider": 1},
        "premises_owned": {"value": 5, "label": "Premises Owned", "divider": 1},
        "premises_leased": {"value": 3, "label": "Premises Leased", "divider": 1},
        "vehicles_owned": {"value": 10, "label": "Vehicles Owned", "divider": 1},
        "vehicles_leased": {"value": 5, "label": "Vehicles Leased", "divider": 1},
        ...
    }
    """
    try:
        row = con.execute(
            "SELECT intensity_metrics FROM jobs WHERE job_id = %s",
            [int(job_id)]
        ).fetchone()
        
        if not row or not row[0]:
            return False
            
        intensity_metrics = row[0]
        if not isinstance(intensity_metrics, dict):
            return False
        
        changed = False
        
        # Map intensity_metrics keys to report_metadata keys
        reporting_element_keys = {
            "premises_owned": "premises_owned",
            "premises_leased": "premises_leased",
            "vehicles_owned": "vehicles_owned",
            "vehicles_leased": "vehicles_leased",
        }
        
        for im_key, meta_key in reporting_element_keys.items():
            metric = intensity_metrics.get(im_key, {})
            if metric and isinstance(metric, dict):
                value = metric.get("value")
                if value is not None:
                    try:
                        new_value = int(value)
                        current_value = meta.get(meta_key)
                        
                        # Sync if: current is None/0 OR intensity metrics value is different
                        if current_value is None or current_value == 0:
                            meta[meta_key] = new_value
                            changed = True
                        elif current_value != new_value:
                            # Always sync to intensity metrics as the source of truth
                            meta[meta_key] = new_value
                            changed = True
                    except (ValueError, TypeError):
                        logger.debug("Ignoring malformed intensity metric value while syncing report metadata", exc_info=True)
        
        return changed
    except Exception:
        logger.debug("Failed to sync reporting elements from intensity metrics", exc_info=True)
        return False


def _current_actor_identifier(user: dict[str, Any] | None) -> str:
    if not isinstance(user, dict):
        return "unknown"
    candidate = user.get("email") or user.get("user") or user.get("name")
    normalized = str(candidate or "").strip()
    return normalized if normalized else "unknown"


def _ensure_report_metadata_table(con) -> None:
    global _report_metadata_table_seeded
    if _report_metadata_table_seeded:
        return
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS job_report_metadata (
          job_id INTEGER PRIMARY KEY REFERENCES jobs(job_id) ON DELETE CASCADE,
          report_title VARCHAR,
          benchmark_period_label VARCHAR,
          current_reporting_period_label VARCHAR,
          company_number VARCHAR,
          registered_address TEXT,
          employee_number INTEGER,
          premises_owned INTEGER,
          premises_leased INTEGER,
          vehicles_owned INTEGER,
          vehicles_leased INTEGER,
          operational_control BOOLEAN DEFAULT TRUE,
          financial_control BOOLEAN DEFAULT FALSE,
          equity_share BOOLEAN DEFAULT FALSE,
          commitment_commentary TEXT,
          activity_commentary TEXT,
          intensity_commentary TEXT,
          emissions_reduction_targets_commentary TEXT,
          data_confidence_commentary TEXT,
          methodologies_used TEXT,
          datasets_names TEXT,
          energy_consumption_uk_kwh NUMERIC,
          energy_consumption_non_uk_kwh NUMERIC,
          energy_reporting_basis VARCHAR,
          renewable_energy_kwh NUMERIC,
          renewable_energy_pct NUMERIC,
          energy_emissions_tco2e NUMERIC,
          energy_emissions_market_tco2e NUMERIC,
          carbon_offsets_tco2e NUMERIC,
          consultant_name VARCHAR,
          consultant_position VARCHAR,
          consultant_signature_date DATE,
          client_signee_name VARCHAR,
          client_signee_position VARCHAR,
          client_signature_date DATE,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_by VARCHAR
        )
        """
    )

    con.execute(
        """
        ALTER TABLE job_report_metadata
        ADD COLUMN IF NOT EXISTS renewable_energy_kwh NUMERIC
        """
    )
    con.execute(
        """
        ALTER TABLE job_report_metadata
        ADD COLUMN IF NOT EXISTS energy_emissions_market_tco2e NUMERIC
        """
    )
    con.execute(
        """
        ALTER TABLE job_report_metadata
        ADD COLUMN IF NOT EXISTS premises_owned INTEGER
        """
    )
    con.execute(
        """
        ALTER TABLE job_report_metadata
        ADD COLUMN IF NOT EXISTS premises_leased INTEGER
        """
    )
    con.execute(
        """
        ALTER TABLE job_report_metadata
        ADD COLUMN IF NOT EXISTS vehicles_owned INTEGER
        """
    )
    con.execute(
        """
        ALTER TABLE job_report_metadata
        ADD COLUMN IF NOT EXISTS vehicles_leased INTEGER
        """
    )
    _report_metadata_table_seeded = True


def _build_default_report_meta(con, job_id: int) -> dict[str, Any]:
    row = con.execute(
        """
        SELECT
            j.reporting_period_start,
            j.reporting_period_end,
            j.reporting_year,
            c.company_reg,
            c.addr_line1,
            c.addr_line2,
            c.addr_city,
            c.addr_region,
            c.addr_postcode,
            c.addr_country,
            c.benchmark_period_start,
            c.benchmark_period_end,
            c.benchmark_year,
            d.num_employees,
            d.premises_owned,
            d.premises_leased,
            d.vehicles_owned,
            d.vehicles_leased,
            d.report_signee_name,
            d.report_signee_position,
            j.intensity_metrics
        FROM jobs j
        JOIN clients c ON c.db_id = j.client_db_id
        LEFT JOIN crp_job_details d ON d.job_id = j.job_id
        WHERE j.job_id = %s
        """,
        [int(job_id)],
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")

    current_period_label = _format_period_label(row[0], row[1])
    benchmark_label = _format_period_label(row[10], row[11])
    if not benchmark_label and row[12] is not None:
        benchmark_label = f"Benchmark reporting year: {int(row[12])}"
    if not benchmark_label:
        benchmark_label = current_period_label

    # Get employee number from intensity_metrics first (employees.value), then fall back to crp_job_details
    employee_number_from_details = row[13]  # d.num_employees
    intensity_metrics = row[20]  # j.intensity_metrics
    employee_number = employee_number_from_details
    
    # Try to get employee count from intensity_metrics.employees.value
    if intensity_metrics and isinstance(intensity_metrics, dict):
        employees_metric = intensity_metrics.get("employees", {})
        if employees_metric and isinstance(employees_metric, dict):
            employees_value = employees_metric.get("value")
            if employees_value is not None:
                try:
                    employee_number = int(employees_value)
                except (ValueError, TypeError):
                    # Keep the fallback value if conversion fails
                    logger.debug("Ignoring malformed employees.value while deriving employee number", exc_info=True)

    defaults = dict(REPORT_METADATA_DEFAULTS)
    defaults.update(
        {
            "current_reporting_period_label": current_period_label,
            "benchmark_period_label": benchmark_label,
            "company_number": row[3],
            "registered_address": _build_registered_address(
                [row[4], row[5], row[6], row[7], row[8], row[9]]
            ),
            "employee_number": employee_number,
            "premises_owned": row[14],
            "premises_leased": row[15],
            "vehicles_owned": row[16],
            "vehicles_leased": row[17],
            "client_signee_name": row[18],
            "client_signee_position": row[19],
        }
    )
    return defaults


def _fetch_report_meta_row(con, job_id: int) -> dict[str, Any] | None:
    row = con.execute(
        f"SELECT {', '.join(REPORT_METADATA_COLUMNS)} FROM job_report_metadata WHERE job_id = %s",
        [int(job_id)],
    ).fetchone()
    if not row:
        return None
    return {k: row[idx] for idx, k in enumerate(REPORT_METADATA_COLUMNS)}


def _upsert_report_meta(con, job_id: int, meta: dict[str, Any], updated_by: str) -> None:
    columns_sql = ", ".join(REPORT_METADATA_COLUMNS)
    placeholders_sql = ", ".join(["%s"] * len(REPORT_METADATA_COLUMNS))
    update_sql = ",\n                      ".join(
        [f"{col} = EXCLUDED.{col}" for col in REPORT_METADATA_COLUMNS]
    )
    values = [meta.get(col) for col in REPORT_METADATA_COLUMNS]

    con.execute(
        f"""
        INSERT INTO job_report_metadata
          (job_id, {columns_sql}, updated_by, updated_at)
        VALUES (%s, {placeholders_sql}, %s, CURRENT_TIMESTAMP)
        ON CONFLICT (job_id)
        DO UPDATE SET
          {update_sql},
          updated_by = EXCLUDED.updated_by,
          updated_at = CURRENT_TIMESTAMP
        """,
        [int(job_id), *values, updated_by],
    )


def _ensure_job_report_meta(con, job_id: int, updated_by: str = "system") -> dict[str, Any]:
    _ensure_report_metadata_table(con)
    defaults = _build_default_report_meta(con, int(job_id))
    existing = _fetch_report_meta_row(con, int(job_id))

    merged: dict[str, Any] = {}
    changed = existing is None
    for key in REPORT_METADATA_COLUMNS:
        stored_value = existing.get(key) if existing else None
        default_value = defaults.get(key)
        if stored_value is None and default_value is not None:
            merged[key] = default_value
            if existing is not None:
                changed = True
        else:
            merged[key] = stored_value

    if _sync_energy_inputs_from_scope_rows(con, int(job_id), merged):
        changed = True

    if _sync_renewables_pct_from_kwh(merged):
        changed = True

    if _sync_energy_emissions_from_kwh(con, int(job_id), merged):
        changed = True

    if _sync_datasets_names_from_resolver(int(job_id), merged):
        changed = True

    # Sync employee_number from intensity_metrics (employees.value) whenever metadata is accessed
    if _sync_employee_number_from_intensity_metrics(con, int(job_id), merged):
        changed = True

    # Sync premises and vehicles from intensity_metrics whenever metadata is accessed
    if _sync_reporting_elements_from_intensity_metrics(con, int(job_id), merged):
        changed = True

    if changed:
        _upsert_report_meta(con, int(job_id), merged, updated_by)

    return merged


def _coerce_report_meta_value(key: str, value: Any) -> Any:
    if value is None:
        return None

    if key in REPORT_METADATA_BOOLEAN_FIELDS:
        if isinstance(value, bool):
            return value
        normalized = str(value).strip().lower()
        if normalized in {"true", "1", "yes", "y", "on"}:
            return True
        if normalized in {"false", "0", "no", "n", "off"}:
            return False
        raise HTTPException(status_code=400, detail=f"Invalid boolean value for '{key}'")

    if key in REPORT_METADATA_INTEGER_FIELDS:
        txt = str(value).strip()
        if txt == "":
            return None
        try:
            return int(float(txt))
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid integer value for '{key}'") from exc

    if key in REPORT_METADATA_FLOAT_FIELDS:
        txt = str(value).strip()
        if txt == "":
            return None
        try:
            return float(txt)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid numeric value for '{key}'") from exc

    if key in REPORT_METADATA_DATE_FIELDS:
        if isinstance(value, datetime):
            return value.date()
        if isinstance(value, date):
            return value
        txt = str(value).strip()
        if txt == "":
            return None
        # Accept dd/mm/yyyy (UK locale date input format) in addition to ISO
        m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{4})$', txt)
        if m:
            txt = f"{m.group(3)}-{m.group(2).zfill(2)}-{m.group(1).zfill(2)}"
        try:
            return datetime.fromisoformat(txt).date()
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid date value for '{key}' (expected YYYY-MM-DD or DD/MM/YYYY)") from exc

    txt = str(value).strip()
    return txt if txt != "" else None


def _get_job_report_metadata(job_id: int, updated_by: str = "system") -> dict[str, Any]:
    with get_conn() as con:
        _get_job_client_id(con, int(job_id))
        meta = _ensure_job_report_meta(con, int(job_id), updated_by=updated_by)
    return _serialize_report_meta(meta)


@router.get("/jobs/{job_id}/report-metadata")
def get_job_report_metadata(job_id: int, _user: dict = Depends(_current_user)):
    actor_identifier = _current_actor_identifier(_user)
    with get_conn() as con:
        _get_job_client_id(con, int(job_id))
        meta = _ensure_job_report_meta(
            con,
            int(job_id),
            updated_by=actor_identifier,
        )
        metadata = _serialize_report_meta(meta)
        factor_details = _get_energy_emissions_factor_details(con, int(job_id))
    return {
        "job_id": int(job_id),
        "metadata": metadata,
        "fields": _get_report_metadata_fields(),
        "placeholder_key_map": dict(REPORT_METADATA_LABELS),
        "energy_emissions_factors": factor_details,
    }


@router.post("/jobs/{job_id}/report-metadata")
def save_job_report_metadata(
    request: Request,
    job_id: int,
    payload: SaveReportMetadataPayload = Body(...),
    _user: dict = Depends(_current_user),
):
    actor_identifier = _current_actor_identifier(_user)
    updates = payload.metadata or {}
    unknown_keys: list[str] = []
    resolved_updates: dict[str, Any] = {}

    for raw_key, value in updates.items():
        resolved_key = _resolve_report_meta_key(str(raw_key))
        if not resolved_key:
            unknown_keys.append(str(raw_key))
            continue
        if resolved_key in REPORT_METADATA_AUTO_SYNC_FIELDS:
            continue
        resolved_updates[resolved_key] = _coerce_report_meta_value(resolved_key, value)

    if unknown_keys:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Unknown report metadata keys",
                "unknown_keys": unknown_keys,
                "supported_keys": REPORT_METADATA_COLUMNS,
            },
        )

    with get_conn() as con:
        _get_job_client_id(con, int(job_id))
        before = _serialize_report_meta(_fetch_report_meta_row(con, int(job_id)) or {})
        merged = _ensure_job_report_meta(
            con,
            int(job_id),
            updated_by=actor_identifier,
        )
        merged.update(resolved_updates)
        _sync_energy_inputs_from_scope_rows(con, int(job_id), merged)
        _sync_renewables_pct_from_kwh(merged)
        _sync_energy_emissions_from_kwh(con, int(job_id), merged)
        _sync_datasets_names_from_resolver(int(job_id), merged)
        _upsert_report_meta(
            con,
            int(job_id),
            merged,
            updated_by=actor_identifier,
        )

        refreshed = _fetch_report_meta_row(con, int(job_id)) or merged
        factor_details = _get_energy_emissions_factor_details(con, int(job_id))
        after = _serialize_report_meta(refreshed)
        record_audit_event(
            con,
            request=request,
            actor=_user,
            action="update",
            entity_type="job_report_metadata",
            entity_id=int(job_id),
            job_id=int(job_id),
            before=before,
            after=after,
            metadata={
                "updated_keys": sorted(list(resolved_updates.keys())),
            },
        )

    return {
        "job_id": int(job_id),
        "metadata": _serialize_report_meta(refreshed),
        "updated_keys": sorted(list(resolved_updates.keys())),
        "energy_emissions_factors": factor_details,
    }


def _get_job_client_id(con, job_id: int) -> int:
    row = con.execute(
        "SELECT client_db_id FROM jobs WHERE job_id = %s",
        [int(job_id)],
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    return int(row[0])


def _get_job_org_id(con, job_id: int) -> str:
    row = con.execute(
        """
        SELECT c.org_id
        FROM jobs j
        JOIN clients c ON c.db_id = j.client_db_id
        WHERE j.job_id = %s
        """,
        [int(job_id)],
    ).fetchone()
    if not row or not row[0]:
        raise HTTPException(status_code=404, detail="Job not found")
    return str(row[0])


def _get_job_reporting_context(con, job_id: int) -> dict[str, Any]:
    row = con.execute(
        """
        SELECT job_id, client_db_id, COALESCE(is_benchmark, FALSE) AS is_benchmark,
               reporting_year, reporting_period_end, COALESCE(is_crp, FALSE) AS is_crp
        FROM jobs
        WHERE job_id = %s
        """,
        [int(job_id)],
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "job_id": int(row[0]),
        "client_db_id": int(row[1]),
        "is_benchmark": bool(row[2]),
        "reporting_year": int(row[3]) if row[3] is not None else None,
        "reporting_period_end": row[4],
        "is_crp": bool(row[5]),
    }


def _ensure_crp_yoy_template(con) -> int | None:
    """Ensure a global CRP YoY template exists by cloning the standard CRP template."""
    existing = con.execute(
        """
        SELECT template_id, is_active, COALESCE(archived, FALSE) AS archived
        FROM report_templates
        WHERE LOWER(template_key) = 'crp_yoy_benchmark'
        LIMIT 1
        """
    ).fetchone()
    if existing and existing[0] is not None:
        template_id = int(existing[0])
        if not bool(existing[1]) or bool(existing[2]):
            con.execute(
                """
                UPDATE report_templates
                SET is_active = TRUE, archived = FALSE, updated_at = NOW()
                WHERE template_id = %s
                """,
                [template_id],
            )
        return template_id

    source = con.execute(
        """
        SELECT template_id, template_name, template_type, report_type, description
        FROM report_templates
        WHERE (
            LOWER(template_key) = 'crp_standard'
            OR LOWER(template_name) LIKE %s
        )
          AND is_active = TRUE
        ORDER BY template_id
        LIMIT 1
        """,
        ["%carbon reduction plan%standard%"],
    ).fetchone()
    if not source:
        return None

    source_template_id = int(source[0])
    source_name = str(source[1] or "Carbon Reduction Plan - Standard")
    template_type = source[2] or "carbon_reduction_plan"
    report_type = source[3] or "annual_report"
    source_description = source[4]

    source_version = con.execute(
        """
        SELECT version_id, version_number, version_label, status, template_content
        FROM report_template_versions
        WHERE template_id = %s
        ORDER BY version_number DESC
        LIMIT 1
        """,
        [source_template_id],
    ).fetchone()
    if not source_version:
        return None

    new_description = (
        str(source_description or "").strip()
        or f"YoY vs benchmark variant cloned from {source_name}"
    )
    if "YoY" not in new_description:
        new_description = f"{new_description} (YoY vs Benchmark)"

    new_template = con.execute(
        """
        INSERT INTO report_templates
            (template_key, template_name, template_type, report_type, description, is_active, is_global, client_db_id)
        VALUES
            (%s, %s, %s, %s, %s, TRUE, TRUE, NULL)
        RETURNING template_id
        """,
        [
            "crp_yoy_benchmark",
            "Carbon Reduction Plan - YoY vs Benchmark",
            template_type,
            report_type,
            new_description,
        ],
    ).fetchone()
    new_template_id = int(new_template[0])

    con.execute(
        """
        INSERT INTO report_template_versions
            (template_id, version_number, version_label, status, template_content, created_by)
        VALUES
            (%s, %s, %s, %s, %s, %s)
        """,
        [
            new_template_id,
            int(source_version[1] or 1),
            (source_version[2] or "Initial"),
            (source_version[3] or "published"),
            source_version[4],
            "system",
        ],
    )

    con.execute(
        """
        INSERT INTO report_template_variables
            (template_id, variable_key, variable_label, variable_type, default_value, placeholder, help_text, is_required, display_order, section)
        SELECT %s, variable_key, variable_label, variable_type, default_value, placeholder, help_text, is_required, display_order, section
        FROM report_template_variables
        WHERE template_id = %s
        """,
        [new_template_id, source_template_id],
    )

    return new_template_id


def _auto_assign_default_crp_template(con, job_id: int, actor_email: str) -> tuple[int, int] | None:
    """
    Auto-assign default CRP template if no assignment exists.
    - Benchmark jobs: use `crp_standard`.
    - Non-benchmark jobs: use `crp_yoy_benchmark` (auto-created from standard if missing).
    """
    already = con.execute(
        "SELECT template_id, version_id FROM job_report_template_assignments WHERE job_id = %s",
        [int(job_id)],
    ).fetchone()
    if already and already[0] is not None and already[1] is not None:
        return int(already[0]), int(already[1])

    ctx = _get_job_reporting_context(con, int(job_id))
    if not ctx.get("is_crp"):
        return None

    current_period_end = ctx.get("reporting_period_end")
    current_year = ctx.get("reporting_year")
    current_sort_key = (
        str(current_period_end) if current_period_end is not None else "",
        int(current_year) if current_year is not None else -1,
        int(job_id),
    )

    peer_rows = con.execute(
        """
        SELECT job_id, reporting_period_end, reporting_year
        FROM jobs
        WHERE client_db_id = %s
          AND COALESCE(is_crp, FALSE) = TRUE
          AND job_id <> %s
        """,
        [int(ctx["client_db_id"]), int(job_id)],
    ).fetchall()

    has_prior_reporting_job = False
    for prow in peer_rows or []:
        peer_key = (
            str(prow[1]) if prow[1] is not None else "",
            int(prow[2]) if prow[2] is not None else -1,
            int(prow[0]),
        )
        if peer_key < current_sort_key:
            has_prior_reporting_job = True
            break

    use_standard = bool(ctx["is_benchmark"]) or (not has_prior_reporting_job)
    preferred_key = "crp_standard" if use_standard else "crp_yoy_benchmark"

    if preferred_key == "crp_yoy_benchmark":
        _ensure_crp_yoy_template(con)

    tpl = con.execute(
        """
        SELECT template_id
        FROM report_templates
        WHERE LOWER(template_key) = %s
          AND is_active = TRUE
          AND COALESCE(archived, FALSE) = FALSE
          AND COALESCE(is_global, TRUE) = TRUE
        ORDER BY template_id
        LIMIT 1
        """,
        [preferred_key],
    ).fetchone()

    if not tpl and preferred_key == "crp_yoy_benchmark":
        tpl = con.execute(
            """
            SELECT template_id
            FROM report_templates
            WHERE LOWER(template_key) = 'crp_standard'
              AND is_active = TRUE
              AND COALESCE(archived, FALSE) = FALSE
              AND COALESCE(is_global, TRUE) = TRUE
            ORDER BY template_id
            LIMIT 1
            """
        ).fetchone()

    if not tpl:
        return None

    template_id = int(tpl[0])
    vrow = con.execute(
        """
        SELECT version_id
        FROM report_template_versions
        WHERE template_id = %s
        ORDER BY version_number DESC
        LIMIT 1
        """,
        [template_id],
    ).fetchone()
    if not vrow or vrow[0] is None:
        return None

    version_id = int(vrow[0])
    org_id = _get_job_org_id(con, int(job_id))
    con.execute(
        """
        INSERT INTO job_report_template_assignments
          (org_id, job_id, template_id, version_id, assigned_at, assigned_by)
        VALUES (%s, %s, %s, %s, NOW(), %s)
        ON CONFLICT (job_id)
        DO UPDATE SET
          org_id = EXCLUDED.org_id,
          template_id = EXCLUDED.template_id,
          version_id = EXCLUDED.version_id,
          assigned_at = NOW(),
          assigned_by = EXCLUDED.assigned_by
        """,
        [org_id, int(job_id), template_id, version_id, actor_email or "system:auto-template"],
    )
    return template_id, version_id


def _resolve_effective_version_id(con, job_id: int, template_id: int, version_id: int | None) -> int | None:
    """Resolve version by explicit value or job assignment fallback."""
    effective = int(version_id) if version_id is not None else None
    if effective is not None:
        return effective

    assignment = con.execute(
        """
        SELECT version_id
        FROM job_report_template_assignments
        WHERE job_id = %s AND template_id = %s
        """,
        [int(job_id), int(template_id)],
    ).fetchone()
    if assignment and assignment[0] is not None:
        return int(assignment[0])
    return None


def _validate_template_version(con, template_id: int, version_id: int | None) -> None:
    if version_id is None:
        return
    version_cols = _get_table_columns(con, "report_template_versions")
    if "template_id" not in version_cols or "version_id" not in version_cols:
        return
    vex = con.execute(
        """
        SELECT 1 FROM report_template_versions
        WHERE template_id = %s AND version_id = %s
        """,
        [int(template_id), int(version_id)],
    ).fetchone()
    if not vex:
        raise HTTPException(status_code=404, detail="Template version not found")


def _is_blank(value: object) -> bool:
    if value is None:
        return True
    return str(value).strip() == ""


def _safe_int(value: Any, default: int = 0) -> int:
    if value is None:
        return default
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return default
    text = str(value).strip()
    if text == "" or text.lower() in {"nan", "none", "null"}:
        return default
    try:
        return int(float(text))
    except Exception:
        logger.debug("Failed to coerce integer value for template helper; returning default", exc_info=True)
        return default


def _validate_required_template_variables(
    con,
    job_id: int,
    template_id: int,
    version_id: int,
    incoming_values: dict[str, Optional[str]] | None = None,
) -> None:
    """Validate required template variables using incoming + stored + default precedence."""
    required_rows = con.execute(
        """
        SELECT variable_key, variable_label, default_value
        FROM report_template_variables
        WHERE template_id = %s AND COALESCE(is_required, FALSE) = TRUE
        ORDER BY display_order, variable_key
        """,
        [int(template_id)],
    ).fetchall()

    # Apply template-specific required-key override when configured.
    override_keys = _get_template_required_key_override(con, int(template_id))
    if override_keys is not None:
        required_rows = [
            row for row in (required_rows or [])
            if str(row[0] or "").strip() in override_keys
        ]

    if not required_rows:
        return

    stored_rows = con.execute(
        """
        SELECT variable_key, variable_value
        FROM job_report_variable_values
        WHERE job_id = %s AND template_id = %s AND version_id = %s
        """,
        [int(job_id), int(template_id), int(version_id)],
    ).fetchall()

    stored_map = {str(r[0]): r[1] for r in (stored_rows or [])}
    incoming_map = incoming_values or {}

    missing_labels: list[str] = []
    missing_keys: list[str] = []

    for key_raw, label_raw, default_value in required_rows:
        key = str(key_raw)
        label = str(label_raw) if label_raw else key

        if key in incoming_map:
            candidate = incoming_map.get(key)
        elif key in stored_map:
            candidate = stored_map.get(key)
        else:
            candidate = default_value

        if _is_blank(candidate):
            missing_labels.append(label)
            missing_keys.append(key)

    if missing_keys:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Missing required report template variables",
                "missing_fields": missing_labels,
                "missing_keys": missing_keys,
            },
        )


@router.get("/report-templates")
def list_report_templates(
    client_db_id: int | None = None,
    include_archived: bool = False,
    _user: dict = Depends(_current_user),
):
    """List report templates with version metadata and optional client filter."""
    where = ["1=1"]
    params: list[object] = []

    if not include_archived:
        where.append("COALESCE(rt.archived, FALSE) = FALSE")
    if client_db_id is not None:
        where.append("(COALESCE(rt.is_global, TRUE) = TRUE OR rt.client_db_id = %s)")
        params.append(int(client_db_id))

    with get_conn() as con:
        _ensure_report_template_schema(con)
        df = con.execute(
            f"""
            SELECT
              rt.template_id,
              rt.template_key,
              rt.template_name,
              rt.template_type,
              rt.report_type,
              rt.description,
              rt.is_active,
              COALESCE(rt.is_global, TRUE) AS is_global,
              rt.client_db_id,
              COALESCE(rt.archived, FALSE) AS archived,
              rt.created_at,
              rt.updated_at,
              (
                SELECT COUNT(*)
                FROM report_template_versions rv
                WHERE rv.template_id = rt.template_id
              ) AS version_count,
              (
                SELECT MAX(rv.version_number)
                FROM report_template_versions rv
                WHERE rv.template_id = rt.template_id
              ) AS latest_version_number
            FROM report_templates rt
            WHERE {' AND '.join(where)}
            ORDER BY rt.template_name
            """,
            params,
        ).df()

    if df is None or df.empty:
        return {"items": []}

    items = []
    for _, row in df.iterrows():
        items.append(
            {
                "template_id": int(row["template_id"]),
                "template_key": row["template_key"],
                "template_name": row["template_name"],
                "template_type": row["template_type"],
                "report_type": row.get("report_type"),
                "description": row.get("description"),
                "is_active": bool(row.get("is_active")),
                "is_global": bool(row.get("is_global")),
                "client_db_id": (
                    int(row["client_db_id"])
                    if row.get("client_db_id") is not None and str(row.get("client_db_id")) != "nan"
                    else None
                ),
                "archived": bool(row.get("archived")),
                "version_count": int(row.get("version_count") or 0),
                "latest_version_number": (
                    int(row["latest_version_number"])
                    if row.get("latest_version_number") is not None and str(row.get("latest_version_number")) != "nan"
                    else None
                ),
                "created_at": str(row["created_at"]) if row.get("created_at") else None,
                "updated_at": str(row["updated_at"]) if row.get("updated_at") else None,
            }
        )

    return {"items": items}


@router.get("/report-templates/{template_id}/versions")
def list_template_versions(template_id: int, _user: dict = Depends(_current_user)):
    with get_conn() as con:
        _ensure_report_template_schema(con)
        exists = con.execute(
            "SELECT 1 FROM report_templates WHERE template_id = %s",
            [int(template_id)],
        ).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Template not found")

        df = con.execute(
            """
            SELECT version_id, template_id, version_number, version_label, status,
                   created_at, created_by
            FROM report_template_versions
            WHERE template_id = %s
            ORDER BY version_number DESC
            """,
            [int(template_id)],
        ).df()

    if df is None or df.empty:
        return {"items": []}

    items = []
    for _, row in df.iterrows():
        items.append(
            {
                "version_id": int(row["version_id"]),
                "template_id": int(row["template_id"]),
                "version_number": int(row["version_number"]),
                "version_label": row.get("version_label"),
                "status": row.get("status"),
                "created_at": str(row["created_at"]) if row.get("created_at") else None,
                "created_by": row.get("created_by"),
            }
        )
    return {"items": items}


@router.get("/report-templates/{template_id}/variables")
def get_template_variables(
    template_id: int,
    version_id: int | None = None,
    _user: dict = Depends(_current_user),
):
    """Get variable schema for a template. Version is accepted for forward compatibility."""
    effective_required_keys: set[str] | None = None
    with get_conn() as con:
        _ensure_report_template_schema(con)
        exists = con.execute(
            "SELECT 1 FROM report_templates WHERE template_id = %s",
            [int(template_id)],
        ).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Template not found")

        version_cols = _get_table_columns(con, "report_template_versions")
        if version_id is not None:
            if "template_id" in version_cols and "version_id" in version_cols:
                vexists = con.execute(
                    """
                    SELECT 1 FROM report_template_versions
                    WHERE template_id = %s AND version_id = %s
                    """,
                    [int(template_id), int(version_id)],
                ).fetchone()
                if not vexists:
                    raise HTTPException(status_code=404, detail="Template version not found")

        variable_cols = _get_table_columns(con, "report_template_variables")
        variable_id_expr = "variable_id" if "variable_id" in variable_cols else "0"
        variable_label_expr = "variable_label" if "variable_label" in variable_cols else "variable_key"
        variable_type_expr = "variable_type" if "variable_type" in variable_cols else "'text'"
        default_value_expr = "default_value" if "default_value" in variable_cols else "NULL"
        placeholder_expr = "placeholder" if "placeholder" in variable_cols else "NULL"
        help_text_expr = "help_text" if "help_text" in variable_cols else "NULL"
        is_required_expr = "COALESCE(is_required, FALSE)" if "is_required" in variable_cols else "FALSE"
        display_order_expr = "display_order" if "display_order" in variable_cols else "0"
        section_expr = "section" if "section" in variable_cols else "NULL"
        order_by_expr = "display_order, variable_key" if "display_order" in variable_cols else "variable_key"
        df = con.execute(
            f"""
            SELECT
                   {variable_id_expr} AS variable_id,
                   template_id,
                   variable_key,
                   {variable_label_expr} AS variable_label,
                   {variable_type_expr} AS variable_type,
                   {default_value_expr} AS default_value,
                   {placeholder_expr} AS placeholder,
                   {help_text_expr} AS help_text,
                   {is_required_expr} AS is_required,
                   {display_order_expr} AS display_order,
                   {section_expr} AS section
            FROM report_template_variables
            WHERE template_id = %s
            ORDER BY {order_by_expr}
            """,
            [int(template_id)],
        ).df()
        effective_required_keys = _get_template_required_key_override(con, int(template_id))

    if df is None or df.empty:
        return {"items": []}

    items = []
    for _, row in df.iterrows():
        variable_key = str(_json_safe_value(row.get("variable_key")) or "")
        is_required = _safe_bool(row.get("is_required"))
        if effective_required_keys is not None:
            is_required = variable_key in effective_required_keys
        items.append(
            {
                "variable_id": int(row["variable_id"]),
                "template_id": int(row["template_id"]),
                "version_id": int(version_id) if version_id is not None else None,
                "variable_key": variable_key,
                "variable_label": str(_json_safe_value(row.get("variable_label")) or ""),
                "variable_type": str(_json_safe_value(row.get("variable_type")) or "text"),
                "default_value": _json_safe_value(row.get("default_value")),
                "placeholder": _json_safe_value(row.get("placeholder")),
                "help_text": _json_safe_value(row.get("help_text")),
                "is_required": is_required,
                "display_order": int(row.get("display_order") or 0),
                "section": _json_safe_value(row.get("section")),
            }
        )
    return {"items": items}


@router.get("/jobs/{job_id}/report-template-assignment")
def get_job_report_template_assignment(job_id: int, _user: dict = Depends(_current_user)):
    try:
        with get_conn() as con:
            _ensure_report_template_schema(con)
            client_db_id = _get_job_client_id(con, int(job_id))

            try:
                _auto_assign_default_crp_template(
                    con,
                    int(job_id),
                    _user.get("email", "system:auto-template"),
                )
            except Exception:
                logger.debug("Ignoring default template auto-assignment failure", exc_info=True)

            assignment_cols = _get_table_columns(con, "job_report_template_assignments")
            template_cols = _get_table_columns(con, "report_templates")
            version_cols = _get_table_columns(con, "report_template_versions")

            assigned_at_expr = "a.assigned_at" if "assigned_at" in assignment_cols else "NULL::TIMESTAMP"
            assigned_by_expr = "a.assigned_by" if "assigned_by" in assignment_cols else "NULL::VARCHAR"
            template_key_expr = "rt.template_key" if "template_key" in template_cols else "NULL::VARCHAR"
            template_type_expr = "rt.template_type" if "template_type" in template_cols else "NULL::VARCHAR"
            is_global_expr = "COALESCE(rt.is_global, TRUE)" if "is_global" in template_cols else "TRUE"
            client_db_id_expr = "rt.client_db_id" if "client_db_id" in template_cols else "NULL::INTEGER"
            version_number_expr = "rv.version_number" if "version_number" in version_cols else "NULL::INTEGER"
            version_label_expr = "rv.version_label" if "version_label" in version_cols else "NULL::VARCHAR"
            version_status_expr = "rv.status" if "status" in version_cols else "NULL::VARCHAR"

            row = None
            try:
                row = con.execute(
                    f"""
                    SELECT a.job_id, a.template_id, a.version_id, {assigned_at_expr}, {assigned_by_expr},
                           {template_key_expr}, rt.template_name, {template_type_expr},
                           {is_global_expr} AS is_global, {client_db_id_expr} AS client_db_id,
                           {version_number_expr} AS version_number,
                           {version_label_expr} AS version_label,
                           {version_status_expr} AS version_status
                    FROM job_report_template_assignments a
                    JOIN report_templates rt ON rt.template_id = a.template_id
                    LEFT JOIN report_template_versions rv ON rv.version_id = a.version_id
                    WHERE a.job_id = %s
                    """,
                    [int(job_id)],
                ).fetchone()
            except Exception:
                logger.debug("Failed to load selected report template assignment; returning empty row", exc_info=True)
                row = None

            active_filter = "COALESCE(rt.is_active, TRUE) = TRUE" if "is_active" in template_cols else "TRUE"
            archived_filter = "COALESCE(rt.archived, FALSE) = FALSE" if "archived" in template_cols else "TRUE"
            if "is_global" in template_cols and "client_db_id" in template_cols:
                scope_filter = "(COALESCE(rt.is_global, TRUE) = TRUE OR rt.client_db_id = %s)"
            else:
                scope_filter = "TRUE"

            latest_version_number_expr = (
                """
                (
                  SELECT MAX(rv.version_number)
                  FROM report_template_versions rv
                  WHERE rv.template_id = rt.template_id
                )
                """
                if "version_number" in version_cols
                else "NULL::INTEGER"
            )
            latest_version_order_expr = "rv.version_number DESC" if "version_number" in version_cols else "rv.version_id DESC"
            latest_version_id_expr = (
                f"""
                (
                  SELECT rv.version_id
                  FROM report_template_versions rv
                  WHERE rv.template_id = rt.template_id
                  ORDER BY {latest_version_order_expr}
                  LIMIT 1
                )
                """
                if "version_id" in version_cols
                else "NULL::INTEGER"
            )

            available_df = None
            try:
                available_df = con.execute(
                    f"""
                    SELECT rt.template_id,
                           {template_key_expr} AS template_key,
                           rt.template_name,
                           {template_type_expr} AS template_type,
                           {is_global_expr} AS is_global,
                           {client_db_id_expr} AS client_db_id,
                           {latest_version_number_expr} AS latest_version_number,
                           {latest_version_id_expr} AS latest_version_id
                    FROM report_templates rt
                    WHERE {active_filter}
                      AND {archived_filter}
                      AND {scope_filter}
                    ORDER BY {is_global_expr} ASC, rt.template_name
                    """,
                    [int(client_db_id)] if "%s" in scope_filter else [],
                ).df()
            except Exception:
                logger.debug("Failed to load available report templates; returning empty list", exc_info=True)
                available_df = None

            available: list[dict[str, Any]] = []
            if available_df is not None and not available_df.empty:
                for _, r in available_df.iterrows():
                    available.append(
                        {
                            "template_id": int(r["template_id"]),
                            "template_key": r["template_key"],
                            "template_name": r["template_name"],
                            "template_type": r["template_type"],
                            "is_global": bool(r["is_global"]),
                            "client_db_id": (
                                int(r["client_db_id"])
                                if r.get("client_db_id") is not None and str(r.get("client_db_id")) != "nan"
                                else None
                            ),
                            "latest_version_number": (
                                int(r["latest_version_number"])
                                if r.get("latest_version_number") is not None and str(r.get("latest_version_number")) != "nan"
                                else None
                            ),
                            "latest_version_id": (
                                int(r["latest_version_id"])
                                if r.get("latest_version_id") is not None and str(r.get("latest_version_id")) != "nan"
                                else None
                            ),
                        }
                    )

            assignment = None
            if row:
                assignment = {
                    "job_id": int(row[0]),
                    "template_id": int(row[1]),
                    "version_id": int(row[2]) if row[2] is not None else None,
                    "assigned_at": str(row[3]) if row[3] else None,
                    "assigned_by": row[4],
                    "template_key": row[5],
                    "template_name": row[6],
                    "template_type": row[7],
                    "is_global": bool(row[8]),
                    "client_db_id": int(row[9]) if row[9] is not None else None,
                    "version_number": int(row[10]) if row[10] is not None else None,
                    "version_label": row[11],
                    "version_status": row[12],
                }

            return {"job_id": int(job_id), "assignment": assignment, "available_templates": available}
    except Exception:
        logger.debug("Failed to load report template assignment; returning empty payload", exc_info=True)
        return {"job_id": int(job_id), "assignment": None, "available_templates": []}


@router.put("/jobs/{job_id}/report-template-assignment")
def upsert_job_report_template_assignment(
    job_id: int,
    payload: AssignTemplatePayload,
    _user: dict = Depends(_current_user),
):
    with get_conn() as con:
        _ensure_report_template_schema(con)
        client_db_id = _get_job_client_id(con, int(job_id))
        org_id = _get_job_org_id(con, int(job_id))

        template = None
        if payload.template_id is not None:
            template = con.execute(
                """
                SELECT template_id, is_active, COALESCE(is_global, TRUE) AS is_global,
                       client_db_id
                FROM report_templates
                WHERE template_id = %s
                """,
                [int(payload.template_id)],
            ).fetchone()

        template_key = str(payload.template_key or "").strip().lower()
        if not template and template_key:
            template = con.execute(
                """
                SELECT template_id, is_active, COALESCE(is_global, TRUE) AS is_global,
                       client_db_id
                FROM report_templates
                WHERE LOWER(template_key) = %s
                """,
                [template_key],
            ).fetchone()

        if not template and template_key in {"crp_standard", "annual_carbon_report"}:
            _seed_default_report_templates(con)
            template = con.execute(
                """
                SELECT template_id, is_active, COALESCE(is_global, TRUE) AS is_global,
                       client_db_id
                FROM report_templates
                WHERE LOWER(template_key) = %s
                """,
                [template_key],
            ).fetchone()

        if not template:
            missing_ref = template_key or (str(payload.template_id) if payload.template_id is not None else "")
            raise HTTPException(status_code=404, detail=f"Template not found: {missing_ref or 'unknown'}")
        if not bool(template[1]):
            raise HTTPException(status_code=400, detail="Template is inactive")

        is_global = bool(template[2])
        tpl_client_db_id = int(template[3]) if template[3] is not None else None
        if not is_global and tpl_client_db_id != int(client_db_id):
            raise HTTPException(status_code=400, detail="Template is not available for this client")

        version_id = payload.version_id
        if version_id is None:
            vrow = con.execute(
                """
                SELECT version_id
                FROM report_template_versions
                WHERE template_id = %s
                ORDER BY version_number DESC
                LIMIT 1
                """,
                [int(payload.template_id)],
            ).fetchone()
            if not vrow:
                raise HTTPException(status_code=400, detail="Template has no versions")
            version_id = int(vrow[0])
        else:
            vrow = con.execute(
                """
                SELECT 1 FROM report_template_versions
                WHERE template_id = %s AND version_id = %s
                """,
                [int(payload.template_id), int(version_id)],
            ).fetchone()
            if not vrow:
                raise HTTPException(status_code=404, detail="Template version not found")

        con.execute(
            """
            INSERT INTO job_report_template_assignments
              (org_id, job_id, template_id, version_id, assigned_at, assigned_by)
            VALUES (%s, %s, %s, %s, NOW(), %s)
            ON CONFLICT (job_id)
            DO UPDATE SET
              org_id = EXCLUDED.org_id,
              template_id = EXCLUDED.template_id,
              version_id = EXCLUDED.version_id,
              assigned_at = NOW(),
              assigned_by = EXCLUDED.assigned_by
            """,
            [
                org_id,
                int(job_id),
                int(payload.template_id),
                int(version_id),
                _user.get("email", "unknown"),
            ],
        )

    return {
        "ok": True,
        "job_id": int(job_id),
        "template_id": int(payload.template_id),
        "version_id": int(version_id),
    }


@router.get("/jobs/{job_id}/report-variables/{template_id}")
def get_job_report_variables(
    job_id: int,
    template_id: int,
    version_id: int | None = None,
    _user: dict = Depends(_current_user),
):
    """Get report variable values for a specific job/template (optionally version-bound)."""
    effective_required_keys: set[str] | None = None
    try:
        with get_conn() as con:
            _ensure_report_template_schema(con)
            _get_job_client_id(con, int(job_id))
            org_id = _get_job_org_id(con, int(job_id))

            version_id = _resolve_effective_version_id(con, int(job_id), int(template_id), version_id)
            _validate_template_version(con, int(template_id), version_id)

            variable_cols = _get_table_columns(con, "report_template_variables")
            value_cols = _get_table_columns(con, "job_report_variable_values")
            variable_id_expr = "rtv.variable_id" if "variable_id" in variable_cols else "0"
            variable_label_expr = "rtv.variable_label" if "variable_label" in variable_cols else "rtv.variable_key"
            variable_type_expr = "rtv.variable_type" if "variable_type" in variable_cols else "'text'"
            default_value_expr = "rtv.default_value" if "default_value" in variable_cols else "NULL"
            placeholder_expr = "rtv.placeholder" if "placeholder" in variable_cols else "NULL"
            help_text_expr = "rtv.help_text" if "help_text" in variable_cols else "NULL"
            is_required_expr = "COALESCE(rtv.is_required, FALSE)" if "is_required" in variable_cols else "FALSE"
            display_order_expr = "rtv.display_order" if "display_order" in variable_cols else "0"
            section_expr = "rtv.section" if "section" in variable_cols else "NULL"

            variable_rows = con.execute(
                f"""
                SELECT
                    {variable_id_expr} AS variable_id,
                    rtv.variable_key,
                    {variable_label_expr} AS variable_label,
                    {variable_type_expr} AS variable_type,
                    {default_value_expr} AS default_value,
                    {placeholder_expr} AS placeholder,
                    {help_text_expr} AS help_text,
                    {is_required_expr} AS is_required,
                    {display_order_expr} AS display_order,
                    {section_expr} AS section
                FROM report_template_variables rtv
                WHERE rtv.template_id = %s
                ORDER BY {"rtv.display_order, rtv.variable_key" if "display_order" in variable_cols else "rtv.variable_key"}
                """,
                [int(template_id)],
            ).fetchall()
            effective_required_keys = _get_template_required_key_override(con, int(template_id))

            latest_values: dict[str, dict[str, Any]] = {}
            can_lookup_values = {"job_id", "template_id", "variable_key", "variable_value"}.issubset(value_cols)
            if can_lookup_values:
                updated_value_expr = "updated_at" if "updated_at" in value_cols else "NULL AS updated_at"
                value_order_expr = "updated_at DESC" if "updated_at" in value_cols else "variable_key DESC"
                if "version_id" in value_cols and version_id is not None:
                    saved_value_rows = con.execute(
                        f"""
                        SELECT variable_key, variable_value, {updated_value_expr}
                        FROM job_report_variable_values
                        WHERE job_id = %s AND template_id = %s
                        ORDER BY
                          variable_key,
                          CASE WHEN version_id = %s THEN 0 ELSE 1 END,
                          {value_order_expr}
                        """,
                        [int(job_id), int(template_id), int(version_id)],
                    ).fetchall()
                else:
                    saved_value_rows = con.execute(
                        f"""
                        SELECT variable_key, variable_value, {updated_value_expr}
                        FROM job_report_variable_values
                        WHERE job_id = %s AND template_id = %s
                        ORDER BY variable_key, {value_order_expr}
                        """,
                        [int(job_id), int(template_id)],
                    ).fetchall()

                for saved_row in saved_value_rows:
                    variable_key = str(_json_safe_value(saved_row[0]) or "")
                    if not variable_key or variable_key in latest_values:
                        continue
                    latest_values[variable_key] = {
                        "variable_value": _json_safe_value(saved_row[1]) if len(saved_row) > 1 else None,
                        "value_updated_at": _json_safe_value(saved_row[2]) if len(saved_row) > 2 else None,
                    }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to load report variables for job %s template %s version %s",
            job_id,
            template_id,
            version_id,
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail=f"Failed to load variables: {type(e).__name__}: {e}")

    if not variable_rows:
        return {"items": [], "version_id": version_id}

    items = []
    for row in variable_rows:
        variable_key = str(_json_safe_value(row[1]) or "")
        saved = latest_values.get(variable_key, {})
        variable_id = _safe_int(row[0], 0)
        display_order = _safe_int(row[8], 0)
        is_required = _safe_bool(row[7])
        if effective_required_keys is not None:
            is_required = variable_key in effective_required_keys
        items.append(
            {
                "variable_id": variable_id,
                "variable_key": variable_key,
                "variable_label": str(_json_safe_value(row[2]) or ""),
                "variable_type": str(_json_safe_value(row[3]) or "text"),
                "default_value": _json_safe_value(row[4]),
                "placeholder": _json_safe_value(row[5]),
                "help_text": _json_safe_value(row[6]),
                "is_required": is_required,
                "display_order": display_order,
                "section": _json_safe_value(row[9]),
                "variable_value": saved.get("variable_value"),
                "value_updated_at": saved.get("value_updated_at"),
            }
        )

    return {"items": items, "version_id": version_id}


@router.post("/jobs/{job_id}/report-variables/{template_id}")
def save_job_report_variables(
    job_id: int,
    template_id: int,
    variables: List[JobVariableValue] | SaveJobVariablesPayload,
    version_id: int | None = None,
    _user: dict = Depends(_current_user),
):
    """Save report variable values for a job/template (and optional version)."""
    try:
        normalized_variables = (
            variables.variables if isinstance(variables, SaveJobVariablesPayload) else variables
        )

        with get_conn() as con:
            _ensure_report_template_schema(con)
            _get_job_client_id(con, int(job_id))
            org_id = _get_job_org_id(con, int(job_id))

            version_id = _resolve_effective_version_id(con, int(job_id), int(template_id), version_id)
            _validate_template_version(con, int(template_id), version_id)

            if version_id is None:
                raise HTTPException(
                    status_code=400,
                    detail="A template version is required. Assign a template version to the job first.",
                )

            for var in normalized_variables:
                con.execute(
                    """
                    INSERT INTO job_report_variable_values
                        (org_id, job_id, template_id, version_id, variable_key, variable_value, updated_by)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (job_id, template_id, version_id, variable_key)
                    DO UPDATE SET
                        org_id = EXCLUDED.org_id,
                        variable_value = EXCLUDED.variable_value,
                        updated_at = CURRENT_TIMESTAMP,
                        updated_by = EXCLUDED.updated_by
                    """,
                    [
                        org_id,
                        int(job_id),
                        int(template_id),
                        int(version_id),
                        var.variable_key,
                        var.variable_value,
                        _user.get("email", "unknown"),
                    ],
                )

        return {
            "message": "Variables saved successfully",
            "job_id": int(job_id),
            "template_id": int(template_id),
            "version_id": version_id,
            "saved_count": len(normalized_variables),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save variables: {str(e)}")


@router.get("/jobs/{job_id}/report-data/{template_id}")
def get_job_report_data(
    job_id: int,
    template_id: int,
    version_id: int | None = None,
    _user: dict = Depends(_current_user),
):
    """
    Get complete report data for a job including emissions data and template variables.
    """
    try:
        with get_conn() as con:
            _ensure_report_template_schema(con)
            version_id = _resolve_effective_version_id(con, int(job_id), int(template_id), version_id)
            _validate_template_version(con, int(template_id), version_id)

            # Get job and client data
            job_row = con.execute(
                """
                SELECT j.job_id, j.job_number, j.title, j.reporting_year, j.status,
                       j.reporting_period_start, j.reporting_period_end,
                       c.client_name, c.industry, c.logo_url, c.description_long,
                       c.net_zero_year, c.interim_year, c.benchmark_year,
                       c.interim_s1_pct, c.interim_s2_pct, c.interim_s3_pct,
                       c.target_s1_year, c.target_s2_year, c.target_s3_year,
                       c.target_s1_pct, c.target_s2_pct, c.target_s3_pct,
                       c.addr_city, c.addr_country
                FROM jobs j
                JOIN clients c ON c.db_id = j.client_db_id
                WHERE j.job_id = %s
                """,
                [int(job_id)],
            ).fetchone()

            if not job_row:
                raise HTTPException(status_code=404, detail="Job not found")

            scope_df = con.execute(
                """
                SELECT scope, SUM(calc_tco2e) as total
                FROM job_scope_rows
                WHERE job_id = %s AND enabled = TRUE
                GROUP BY scope
                """,
                [int(job_id)],
            ).df()

            # Use raw totals first, round only at the end to ensure Scope 1 + Scope 2 + Scope 3 = Total
            raw_totals = {"Scope 1": 0.0, "Scope 2": 0.0, "Scope 3": 0.0}
            if scope_df is not None and not scope_df.empty:
                for _, row in scope_df.iterrows():
                    scope = row["scope"]
                    total = float(row["total"]) if row["total"] else 0.0
                    if scope in raw_totals:
                        raw_totals[scope] += total
            
            # Calculate Total from raw scope values (before rounding) to ensure mathematical accuracy
            raw_total = raw_totals["Scope 1"] + raw_totals["Scope 2"] + raw_totals["Scope 3"]
            
            # Round only at the end for display consistency
            scope_totals = {
                "Scope 1": round(raw_totals["Scope 1"], 1),
                "Scope 2": round(raw_totals["Scope 2"], 1),
                "Scope 3": round(raw_totals["Scope 3"], 1),
                "Total": round(raw_total, 1)
            }

            variable_cols = _get_table_columns(con, "report_template_variables")
            value_cols = _get_table_columns(con, "job_report_variable_values")
            variable_label_expr = "rtv.variable_label" if "variable_label" in variable_cols else "rtv.variable_key"
            variable_type_expr = "rtv.variable_type" if "variable_type" in variable_cols else "'text'"
            section_expr = "rtv.section" if "section" in variable_cols else "NULL"
            default_value_expr = "rtv.default_value" if "default_value" in variable_cols else "NULL"

            lateral_where = [
                "jrv.job_id = %s",
                "jrv.template_id = rtv.template_id",
                "jrv.variable_key = rtv.variable_key",
            ]
            lateral_params: list[object] = [int(job_id)]
            if "version_id" in value_cols:
                lateral_where.append("(%s::INT IS NULL OR jrv.version_id = %s::INT)")
                lateral_params.extend([version_id, version_id])
                version_priority_order = """
                      CASE
                        WHEN %s::INT IS NOT NULL AND jrv.version_id = %s::INT THEN 0
                        ELSE 1
                      END,
                """
                lateral_params.extend([version_id, version_id])
            else:
                version_priority_order = ""

            updated_order_expr = "jrv.updated_at" if "updated_at" in value_cols else "jrv.variable_key"

            variables_df = con.execute(
                f"""
                SELECT
                    rtv.variable_key,
                    {variable_label_expr} AS variable_label,
                    {variable_type_expr} AS variable_type,
                    {section_expr} AS section,
                    COALESCE(jrv.variable_value, {default_value_expr}) AS value
                FROM report_template_variables rtv
                LEFT JOIN LATERAL (
                    SELECT jrv.variable_value
                    FROM job_report_variable_values jrv
                    WHERE {" AND ".join(lateral_where)}
                    ORDER BY
                      {version_priority_order}
                      {updated_order_expr} DESC
                    LIMIT 1
                ) jrv ON TRUE
                WHERE rtv.template_id = %s
                ORDER BY {"rtv.display_order" if "display_order" in variable_cols else "rtv.variable_key"}
                """,
                lateral_params + [int(template_id)],
            ).df()

            template_variables = {}
            if variables_df is not None and not variables_df.empty:
                for _, row in variables_df.iterrows():
                    template_variables[row["variable_key"]] = row["value"]

            report_metadata = _serialize_report_meta(
                _ensure_job_report_meta(
                    con,
                    int(job_id),
                    updated_by=_current_actor_identifier(_user),
                )
            )
            job_actions = get_job_report_actions_payload(int(job_id), con=con)

            job_payload = {
                "job_id": job_row[0],
                "job_number": job_row[1],
                "title": job_row[2],
                "reporting_year": job_row[3],
                "period_start": str(job_row[5]) if job_row[5] else None,
                "period_end": str(job_row[6]) if job_row[6] else None,
                "client_name": job_row[7],
                "industry": job_row[8],
                "net_zero_year": job_row[11],
                "benchmark_year": job_row[13],
                "city": job_row[23],
                "country": job_row[24],
            }

            render_values = _build_report_render_values(
                job_data=job_payload,
                scope_totals=scope_totals,
                template_variables=template_variables,
                report_metadata=report_metadata,
                generation_date=datetime.now().strftime('%d %B %Y'),
            )

            return {
                "job_data": job_payload,
                "scope_totals": scope_totals,
                "template_variables": template_variables,
                "report_metadata": report_metadata,
                "job_actions": job_actions,
                "render_values": render_values,
                "version_id": version_id,
            }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get report data: {str(e)}")
