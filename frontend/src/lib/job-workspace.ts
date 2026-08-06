import type { WorkspaceSubtab, WorkspaceTab } from "@/components/job-workspace/types";

export type JobWorkspaceGroup = {
  key: WorkspaceTab["key"];
  label: string;
  defaultTab: string;
  subtabs: WorkspaceSubtab[];
  href?: string;
};

export type ReportMetadataField = {
  key: string;
  label: string;
  field_type: string;
  section: string;
  aliases?: string[];
};

export type JobScopeConfigItem = {
  scope: string;
  include_scope: boolean;
  dataset_id: number | null;
  factor_method: string | null;
};

export const MONTH_MAP: Record<string, number> = {
  January: 1,
  February: 2,
  March: 3,
  April: 4,
  May: 5,
  June: 6,
  July: 7,
  August: 8,
  September: 9,
  October: 10,
  November: 11,
  December: 12,
};

export const MONTH_MAP_NORMALIZED: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

export const SCOPE_KEYS = ["Scope 1", "Scope 2", "Scope 3"] as const;
export type ScopeKey = (typeof SCOPE_KEYS)[number];

export const EMPTY_SCOPE_MAP: Record<ScopeKey, string> = {
  "Scope 1": "__none__",
  "Scope 2": "__none__",
  "Scope 3": "__none__",
};

export const JOB_WORKSPACE_GROUPS: JobWorkspaceGroup[] = [
  {
    key: "setup",
    label: "Setup",
    defaultTab: "setup",
    subtabs: [
      { key: "setup-overview", label: "Setup Overview" },
      { key: "setup-custom-fields", label: "Custom Fields" },
    ],
  },
  {
    key: "data",
    label: "Data",
    defaultTab: "data-entry",
    subtabs: [
      { key: "data-entry", label: "Data Entry" },
      { key: "employee-commuting", label: "Employee Commuting" },
      { key: "asset-register", label: "Asset Register" },
      { key: "business-travel", label: "Business Travel" },
      { key: "upload", label: "Data Upload" },
      { key: "custom-dataset", label: "Custom Dataset" },
      { key: "custom-factors", label: "Client Factors" },
      { key: "spend-data", label: "Spend Data" },
      { key: "notes", label: "Notes" },
    ],
  },
  {
    key: "outputs",
    label: "Outputs",
    defaultTab: "data-output",
    subtabs: [
      { key: "data-output", label: "Data Output" },
      { key: "lca", label: "Life Cycle Analysis" },
    ],
  },
  {
    key: "report",
    label: "Report",
    defaultTab: "report-new",
    subtabs: [
      { key: "report-new", label: "Report Preparation" },
      { key: "advanced-reports", label: "Report Printing" },
    ],
  },
  {
    key: "insights",
    label: "Insights",
    defaultTab: "insights",
    subtabs: [],
  },
  {
    key: "job-tasks",
    label: "Tasks",
    defaultTab: "job-tasks",
    subtabs: [],
  },
  {
    key: "communications",
    label: "Communications",
    defaultTab: "communications-timeline",
    subtabs: [
      { key: "communications-timeline", label: "Timeline" },
      { key: "communications-inbox", label: "Inbox" },
      { key: "communications-email", label: "Email" },
      { key: "communications-automation", label: "Automation" },
      { key: "communications-crm", label: "CRM Timeline" },
      { key: "communications-notes", label: "Notes" },
    ],
  },
  {
    key: "financial",
    label: "Financial",
    defaultTab: "financial-quotes",
    subtabs: [
      { key: "financial-quotes", label: "Quotes" },
      { key: "financial-invoices", label: "Invoices" },
      { key: "financial-other-costs", label: "Other Costs" },
      { key: "financial-profit-loss", label: "Profit & Loss" },
    ],
  },
  {
    key: "admin",
    label: "Admin",
    defaultTab: "files",
    subtabs: [
      { key: "files", label: "Files" },
      { key: "time", label: "Time Entries" },
    ],
  },
];

export const JOB_TAB_TO_GROUP: Record<string, WorkspaceTab["key"]> = {
  setup: "setup",
  "data-entry": "data",
  "employee-commuting": "data",
  "asset-register": "data",
  "business-travel": "data",
  upload: "data",
  "custom-dataset": "data",
  "custom-factors": "data",
  "spend-data": "data",
  notes: "data",
  "data-output": "outputs",
  actions: "outputs",
  "report-new": "report",
  "advanced-reports": "report",
  reporting: "report",
  lca: "outputs",
  insights: "insights",
  "communications-timeline": "communications",
  "communications-inbox": "communications",
  "communications-notes": "communications",
  "communications-email": "communications",
  "job-tasks": "job-tasks",
  "communications-automation": "communications",
  "communications-crm": "communications",
  "financial-quotes": "financial",
  "financial-invoices": "financial",
  "financial-other-costs": "financial",
  "financial-profit-loss": "financial",
  files: "admin",
  time: "admin",
};

export const AUTO_REPORT_METADATA_FIELDS = new Set<string>([
  "premises_owned",
  "premises_leased",
  "vehicles_owned",
  "vehicles_leased",
  "operational_control",
  "financial_control",
  "equity_share",
  "emissions_reduction_targets_commentary",
  "data_confidence_commentary",
  "methodologies_used",
  "datasets_names",
  "energy_consumption_uk_kwh",
  "energy_consumption_non_uk_kwh",
  "energy_reporting_basis",
  "renewable_energy_kwh",
  "energy_emissions_tco2e",
  "energy_emissions_market_tco2e",
  "carbon_offsets_tco2e",
]);

export const JOB_SETUP_METADATA_KEYS = [
  "premises_owned",
  "premises_leased",
  "vehicles_owned",
  "vehicles_leased",
  "operational_control",
  "financial_control",
  "equity_share",
  "emissions_reduction_targets_commentary",
  "data_confidence_commentary",
  "methodologies_used",
  "datasets_names",
  "energy_consumption_uk_kwh",
  "energy_consumption_non_uk_kwh",
  "energy_reporting_basis",
  "renewable_energy_kwh",
  "energy_emissions_tco2e",
  "energy_emissions_market_tco2e",
  "carbon_offsets_tco2e",
  "consultant_name",
  "consultant_position",
  "consultant_signature_date",
  "client_signee_name",
  "client_signee_position",
  "client_signature_date",
] as const;

export const JOB_SETUP_METADATA_KEY_ORDER = new Map(
  JOB_SETUP_METADATA_KEYS.map((key, index) => [key, index])
);

export const JOB_SETUP_METADATA_FALLBACK_FIELDS: ReportMetadataField[] = [
  {
    key: "premises_owned",
    label: "Premises Owned",
    field_type: "number",
    section: "Organisation Details",
  },
  {
    key: "premises_leased",
    label: "Premises Leased",
    field_type: "number",
    section: "Organisation Details",
  },
  {
    key: "vehicles_owned",
    label: "Vehicles Owned",
    field_type: "number",
    section: "Organisation Details",
  },
  {
    key: "vehicles_leased",
    label: "Vehicles Leased",
    field_type: "number",
    section: "Organisation Details",
  },
  {
    key: "operational_control",
    label: "Operational Control",
    field_type: "boolean",
    section: "Boundary Controls",
  },
  {
    key: "financial_control",
    label: "Financial Control",
    field_type: "boolean",
    section: "Boundary Controls",
  },
  {
    key: "equity_share",
    label: "Equity Share",
    field_type: "boolean",
    section: "Boundary Controls",
  },
  {
    key: "emissions_reduction_targets_commentary",
    label: "Emissions Reduction Targets Commentary",
    field_type: "textarea",
    section: "Global Report Narrative",
  },
  {
    key: "data_confidence_commentary",
    label: "Data Confidence Commentary",
    field_type: "textarea",
    section: "Global Report Narrative",
  },
  {
    key: "methodologies_used",
    label: "Methodologies Used",
    field_type: "textarea",
    section: "Global Report Narrative",
  },
  {
    key: "datasets_names",
    label: "Datasets Names",
    field_type: "textarea",
    section: "Global Report Narrative",
  },
  {
    key: "energy_consumption_uk_kwh",
    label: "UK Energy kWh",
    field_type: "number",
    section: "Energy & Emissions",
  },
  {
    key: "energy_consumption_non_uk_kwh",
    label: "Non-UK Energy kWh",
    field_type: "number",
    section: "Energy & Emissions",
  },
  {
    key: "energy_reporting_basis",
    label: "Basis of Energy Reporting",
    field_type: "text",
    section: "Energy & Emissions",
  },
  {
    key: "renewable_energy_kwh",
    label: "Renewable Energy kWh",
    field_type: "number",
    section: "Energy & Emissions",
  },
  {
    key: "energy_emissions_tco2e",
    label: "Energy Emissions (Location-based)",
    field_type: "number",
    section: "Energy & Emissions",
  },
  {
    key: "energy_emissions_market_tco2e",
    label: "Energy Emissions (Market-based)",
    field_type: "number",
    section: "Energy & Emissions",
  },
  {
    key: "carbon_offsets_tco2e",
    label: "Carbon Offsets",
    field_type: "number",
    section: "Energy & Emissions",
  },
  {
    key: "consultant_name",
    label: "Consultant Name",
    field_type: "text",
    section: "Sign-off",
  },
  {
    key: "consultant_position",
    label: "Consultant Position",
    field_type: "text",
    section: "Sign-off",
  },
  {
    key: "consultant_signature_date",
    label: "Consultant Signature Date",
    field_type: "date",
    section: "Sign-off",
  },
  {
    key: "client_signee_name",
    label: "Client Signee Name",
    field_type: "text",
    section: "Sign-off",
  },
  {
    key: "client_signee_position",
    label: "Client Signee Position",
    field_type: "text",
    section: "Sign-off",
  },
  {
    key: "client_signature_date",
    label: "Client Signature Date",
    field_type: "date",
    section: "Sign-off",
  },
];

export function calculateReportingPeriod(
  yearEndMonth: string,
  benchmarkYear: number,
  reportingYearNumber: number
): { start: string; end: string } | null {
  const monthNum = MONTH_MAP[yearEndMonth];
  if (!monthNum || !benchmarkYear || !reportingYearNumber) return null;

  const yearsOffset = reportingYearNumber - 1;
  const periodEndYear = benchmarkYear + yearsOffset;
  const periodStartYear = periodEndYear - 1;

  let startMonth: number;
  let startYear: number;
  let endMonth: number;
  let endYear: number;
  let endDay: number;

  if (monthNum === 12) {
    startMonth = 1;
    startYear = periodStartYear + 1;
    endMonth = 12;
    endYear = periodEndYear;
    endDay = 31;
  } else {
    startMonth = monthNum + 1;
    startYear = periodStartYear;
    endMonth = monthNum;
    endYear = periodEndYear;

    if ([1, 3, 5, 7, 8, 10, 12].includes(endMonth)) {
      endDay = 31;
    } else if ([4, 6, 9, 11].includes(endMonth)) {
      endDay = 30;
    } else {
      endDay = endYear % 4 === 0 && (endYear % 100 !== 0 || endYear % 400 === 0) ? 29 : 28;
    }
  }

  const startDate = `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
  const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;

  return { start: startDate, end: endDate };
}

export function isScopeKey(value: string): value is ScopeKey {
  return (SCOPE_KEYS as readonly string[]).includes(value);
}

export function scopeMapFromItems(items?: JobScopeConfigItem[] | null): Record<ScopeKey, string> {
  const out: Record<ScopeKey, string> = { ...EMPTY_SCOPE_MAP };

  if (!Array.isArray(items)) return out;

  for (const it of items) {
    const scope = String(it?.scope ?? "").trim();
    if (!isScopeKey(scope)) continue;
    out[scope] = it.dataset_id != null ? String(it.dataset_id) : "__none__";
  }

  return out;
}

export function normalizeMetadataBoolean(value: unknown): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return "true";
  if (["false", "0", "no", "n", "off"].includes(normalized)) return "false";
  return "";
}

export function normalizeMetadataFormValue(fieldType: string, value: unknown): string {
  if (value == null) return "";
  if (fieldType === "boolean") {
    return normalizeMetadataBoolean(value);
  }
  if (fieldType === "date") {
    const raw = String(value).trim();
    if (!raw) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    if (raw.includes("T")) {
      const [datePart] = raw.split("T");
      if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
    }
    // Accept UK locale format dd/mm/yyyy → convert to ISO yyyy-mm-dd
    const ddmmyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
    if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, "0")}-${ddmmyyyy[1].padStart(2, "0")}`;
    return raw;
  }
  return String(value);
}

export function buildMetadataFieldValues(
  fields: ReportMetadataField[],
  metadata: Record<string, unknown>
): Record<string, string> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const values: Record<string, string> = {
    operational_control: "true",
    consultant_signature_date: todayIso,
  };

  fields.forEach((field) => {
    const raw = metadata[field.key];
    // Always write the field if it exists in the metadata (even as ""), so clearing a field
    // is reflected in state. Skip only when the key is genuinely absent (undefined/null).
    if (raw === undefined || raw === null) return;
    values[field.key] = normalizeMetadataFormValue(field.field_type, raw);
  });

  return values;
}

export function formatDisplayDate(dateValue?: string | null): string {
  if (!dateValue) return "";
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return String(dateValue);
  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
