"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import PageHeader from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import JobDataEntry from "@/components/JobDataEntry";
import IntensityMetrics from "@/components/IntensityMetrics";
import DataOutput from "@/components/DataOutput";
import JobCustomDataset from "@/components/JobCustomDataset";
import JobCustomFactors from "@/components/JobCustomFactors";
import JobSourceRegister from "@/components/JobSourceRegister";
import SpendDataCollection from "@/components/SpendDataCollection";
import EmployeeCommutingData from "@/components/EmployeeCommutingData";
import EmissionsSummary from "@/components/EmissionsSummary";
import JobActions from "@/components/JobActions";
import JobReportNew from "@/components/JobReportNew";
import JobReporting from "@/components/JobReporting";
import JobLca from "@/components/JobLca";
import JobTimeEntries from "@/components/JobTimeEntries";
import JobFiles from "@/components/JobFiles";
import JobFinancial from "@/components/JobFinancial";
import JobCommunications from "@/components/JobCommunications";
import ClientTimeline from "@/components/ClientTimeline";
import CustomFields from "@/components/CustomFields";
import UploadProgressBar from "@/components/UploadProgressBar";
import { milestoneDotClass } from "@/lib/status-utils";
import { withAuditHeaders } from "@/lib/auth-client";
import { uploadFormDataWithProgress } from "@/lib/upload-with-progress";
import {
  AUTO_REPORT_METADATA_KEYS,
  calculateDerivedEnergyEmissionFields,
  type EnergyEmissionFactorDetails,
} from "@/lib/report-metadata";

function apiBaseUrl(): string {
  return "/api/backend";
}

const MONTH_MAP: Record<string, number> = {
  January: 1, February: 2, March: 3, April: 4,
  May: 5, June: 6, July: 7, August: 8,
  September: 9, October: 10, November: 11, December: 12,
};

const MONTH_MAP_NORMALIZED: Record<string, number> = {
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

const SCOPE_KEYS = ["Scope 1", "Scope 2", "Scope 3"] as const;
type ScopeKey = (typeof SCOPE_KEYS)[number];

const EMPTY_SCOPE_MAP: Record<ScopeKey, string> = {
  "Scope 1": "__none__",
  "Scope 2": "__none__",
  "Scope 3": "__none__",
};

function calculateReportingPeriod(
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

function MilestoneRow({
  label,
  dueDate,
  status,
  completedAt,
  completedBy,
  onToggle,
  readOnly = false,
  helperText,
}: {
  label: string;
  dueDate: string;
  status: string;
  completedAt?: string | null;
  completedBy?: string | null;
  onToggle?: (completed: boolean) => Promise<void>;
  readOnly?: boolean;
  helperText?: string;
}) {
  const [isUpdating, setIsUpdating] = useState(false);
  const isCompleted = status === 'completed';

  const statusColor = milestoneDotClass(status);

  const handleToggle = async () => {
    if (!onToggle || readOnly) return;
    setIsUpdating(true);
    try {
      await onToggle(!isCompleted);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="flex items-center gap-4 p-3 border rounded-lg">
      <div className={`w-4 h-4 rounded-full ${statusColor}`} />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{label}</span>
          <span className="text-sm text-muted-foreground">
            {new Date(dueDate).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </span>
        </div>
        {completedAt && completedBy && (
          <div className="text-xs text-muted-foreground mt-1">
            Completed by {completedBy} on {new Date(completedAt).toLocaleDateString('en-GB')}
          </div>
        )}
      </div>
      {readOnly ? (
        <div className="flex items-center gap-2 rounded-full border border-dashed border-muted-foreground/30 px-3 py-1 text-xs text-muted-foreground">
          {helperText ?? "Template milestone"}
        </div>
      ) : (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isCompleted}
            onChange={handleToggle}
            disabled={isUpdating}
            className="w-5 h-5 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
          />
          <span className="text-sm">{isCompleted ? 'Complete' : 'Mark Complete'}</span>
        </label>
      )}
    </div>
  );
}

type Job = {
  job_id: number;
  job_number: string | null;
  title: string | null;
  reporting_year: number | null;
  reporting_period_start: string | null;
  reporting_period_end: string | null;
  is_benchmark: boolean | null;
  status: string | null;
  job_template_id?: number | null;
  milestone_template_id?: number | null;
  client_db_id: number;
  client_name: string | null;
  crm_name?: string | null;
  legacy_job_no?: string | null;
  start_date?: string | null;
  due_date?: string | null;
  data_collection_due?: string | null;
  data_collection_completed_at?: string | null;
  data_collection_completed_by?: string | null;
  data_collection_status?: string;
  first_draft_due?: string | null;
  first_draft_completed_at?: string | null;
  first_draft_completed_by?: string | null;
  first_draft_status?: string;
  final_report_due?: string | null;
  final_report_completed_at?: string | null;
  final_report_completed_by?: string | null;
  final_report_status?: string;
};

type JobTemplate = {
  job_template_id: number;
  template_key: string | null;
  template_name: string | null;
  excel_template_path: string | null;
  crp_template_path: string | null;
  is_active: boolean;
};

type JobTemplatesResponse = {
  items: JobTemplate[];
};

type Dataset = {
  dataset_id: number;
  name: string | null;
  source: string | null;
  analysis_type: string | null;
  country: string | null;
  region: string | null;
  currency: string | null;
  year: number | null;
  version: string | null;
  archived?: boolean;
  archived_at?: string | null;
  archived_by?: string | null;
};

type DatasetsResponse = {
  items: Dataset[];
};

type JobScopeConfigItem = {
  scope: string;
  include_scope: boolean;
  dataset_id: number | null;
  factor_method: string | null;
};

type ScopeSummary = {
  scope: string;
  primary_dataset_id: number | null;
  dataset_ids: number[];
  dataset_names: string[];
  legacy_dataset_id?: number | null;
};

type DatasetReference = {
  dataset_id: number;
  name: string | null;
  analysis_type?: string | null;
  country?: string | null;
  year?: number | null;
  month_coverage?: string | null;
};

type JobScopeAutoResolution = {
  country: string | null;
  reporting_period_start: string | null;
  reporting_period_end: string | null;
  uses_legacy_fallback: boolean;
  scope_summaries: ScopeSummary[];
  datasets_for_report: DatasetReference[];
  unresolved_scopes: string[];
};

type JobScopeConfigResponse = {
  job_id: number;
  mode?: string;
  items: JobScopeConfigItem[];
  legacy_items?: JobScopeConfigItem[];
  additional_dataset_ids?: number[];
  warnings?: string[];
  auto_resolution?: JobScopeAutoResolution | null;
};

function isScopeKey(value: string): value is ScopeKey {
  return (SCOPE_KEYS as readonly string[]).includes(value);
}

function scopeMapFromItems(items?: JobScopeConfigItem[] | null): Record<ScopeKey, string> {
  const out: Record<ScopeKey, string> = { ...EMPTY_SCOPE_MAP };
  if (!Array.isArray(items)) return out;

  for (const it of items) {
    const scope = String(it?.scope ?? "").trim();
    if (!isScopeKey(scope)) continue;
    out[scope] = it.dataset_id != null ? String(it.dataset_id) : "__none__";
  }

  return out;
}

type JobSitesResponse = {
  job_id: number;
  client_db_id: number;
  sites: Array<{
    site_id: number | null;
    site_name: string | null;
    location: string | null;
    is_registered_office: boolean;
  }>;
};

type MilestoneTemplateItem = {
  item_id: number;
  template_id?: number | null;
  milestone_name: string;
  days_offset: number;
  sort_order: number;
};

type MilestoneTemplateCompletion = {
  completion_id?: number | null;
  job_id: number;
  item_id: number;
  template_id?: number | null;
  milestone_name?: string | null;
  days_offset?: number | null;
  sort_order?: number | null;
  is_complete?: boolean;
  completed_at?: string | null;
  completed_by?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

type MilestoneTemplateOption = {
  template_id: number;
  template_name: string;
  is_default?: boolean;
  items?: MilestoneTemplateItem[];
};

type MilestoneTemplatesResponse = {
  templates: MilestoneTemplateOption[];
};

type MilestoneTemplateCompletionsResponse = {
  job_id: number;
  items: MilestoneTemplateCompletion[];
};

type UploadReadyRow = {
  scope?: string | null;
  original_id?: string | number | null;
  report_label?: string | null;
  qty?: number | string | null;
  calc_tco2e?: number | string | null;
  ghg_unit?: string | null;
};

type UploadValidationResult = {
  ok?: boolean;
  errors?: string[];
  warnings?: string[];
  details?: {
    parsed_row_count?: number;
    rows_ready_count?: number;
  };
  rows_ready?: UploadReadyRow[];
  raw?: string;
};

type ReportMetadataField = {
  key: string;
  label: string;
  field_type: string;
  section: string;
  aliases?: string[];
};

const AUTO_REPORT_METADATA_FIELDS = new Set<string>(AUTO_REPORT_METADATA_KEYS);

type TeamMember = {
  user_id: string;
  full_name: string;
  email?: string;
  role?: string;
  position?: string;
  status?: string;
};

const JOB_SETUP_METADATA_KEYS = [
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
] as const;

const JOB_SETUP_METADATA_KEY_ORDER = new Map(
  JOB_SETUP_METADATA_KEYS.map((key, index) => [key, index])
);

const JOB_SETUP_METADATA_FALLBACK_FIELDS: ReportMetadataField[] = [
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
    label: "Client Signee",
    field_type: "text",
    section: "Sign-off",
  },
  {
    key: "client_signee_position",
    label: "Client Signee Position",
    field_type: "text",
    section: "Sign-off",
  },
];

function normalizeMetadataBoolean(value: unknown): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return "true";
  if (["false", "0", "no", "n", "off"].includes(normalized)) return "false";
  return "";
}

function normalizeMetadataFormValue(fieldType: string, value: unknown): string {
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
    return raw;
  }
  return String(value);
}

function buildMetadataFieldValues(
  fields: ReportMetadataField[],
  metadata: Record<string, unknown>
): Record<string, string> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const values: Record<string, string> = {
    operational_control: "true",
    consultant_signature_date: todayIso,
  };
  fields.forEach((field) => {
    const normalizedValue = normalizeMetadataFormValue(field.field_type, metadata[field.key]);
    if (normalizedValue !== "") {
      values[field.key] = normalizedValue;
    }
  });
  return values;
}

function formatDisplayDate(dateValue?: string | null): string {
  if (!dateValue) return "";
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return String(dateValue);
  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function JobDetailPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);

  const [job, setJob] = useState<Job | null>(null);
  const [sites, setSites] = useState<JobSitesResponse["sites"]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>("All");
  const [includePrevYear, setIncludePrevYear] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [templates, setTemplates] = useState<JobTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [reportingPeriodStart, setReportingPeriodStart] = useState<string>("");
  const [reportingPeriodEnd, setReportingPeriodEnd] = useState<string>("");
  const [clientYearEndMonth, setClientYearEndMonth] = useState<string>("");
  const [clientCurrency, setClientCurrency] = useState<string>("GBP");
  const [totalEmissions, setTotalEmissions] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<string>("setup");

  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [scopeDatasetIds, setScopeDatasetIds] = useState<Record<ScopeKey, string>>({ ...EMPTY_SCOPE_MAP });
  const [scopeEffectiveDatasetIds, setScopeEffectiveDatasetIds] = useState<Record<ScopeKey, string>>({ ...EMPTY_SCOPE_MAP });
  const [additionalDatasetIds, setAdditionalDatasetIds] = useState<string[]>([]);
  const [scopeConfigMode, setScopeConfigMode] = useState<string>("legacy");
  const [scopeConfigWarnings, setScopeConfigWarnings] = useState<string[]>([]);
  const [scopeAutoResolution, setScopeAutoResolution] = useState<JobScopeAutoResolution | null>(null);
  const [showAdvancedDatasetConfig, setShowAdvancedDatasetConfig] = useState<boolean>(false);

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadResult, setUploadResult] = useState<UploadValidationResult | null>(null);

  // Job details editing state
  const [jobTitle, setJobTitle] = useState<string>("");
  const [jobStatus, setJobStatus] = useState<string>("");
  const [crmName, setCrmName] = useState<string>("");
  const [legacyJobNo, setLegacyJobNo] = useState<string>("");
  const [jobStartDate, setJobStartDate] = useState<string>("");
  const [jobEndDate, setJobEndDate] = useState<string>("");

  // Lookup data
  const [jobStatuses, setJobStatuses] = useState<Array<{status_id: number; name: string}>>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [milestoneTemplates, setMilestoneTemplates] = useState<MilestoneTemplateOption[]>([]);
  const [milestoneTemplateCompletions, setMilestoneTemplateCompletions] = useState<MilestoneTemplateCompletion[]>([]);
  const [selectedMilestoneTemplateId, setSelectedMilestoneTemplateId] = useState<string>("");
  const [reportMetadataFields, setReportMetadataFields] = useState<ReportMetadataField[]>([]);
  const [reportMetadataValues, setReportMetadataValues] = useState<Record<string, string>>({});
  const [savingReportMetadata, setSavingReportMetadata] = useState<boolean>(false);
  const [reportMetadataStatus, setReportMetadataStatus] = useState<string>("");
  const [reportMetadataApiUnavailable, setReportMetadataApiUnavailable] = useState<boolean>(false);
  const [reportMetadataEnergyFactors, setReportMetadataEnergyFactors] =
    useState<EnergyEmissionFactorDetails | null>(null);

  const statusLabel = (jobStatus || job?.status || "Draft").trim() || "Draft";
  const ownerLabel = (crmName || job?.crm_name || "Unassigned").trim() || "Unassigned";
  const jobNumberLabel =
    (job?.job_number ?? (Number.isFinite(jobId) ? `Job ${jobId}` : "Job")).trim() ||
    "Job";
  const jobTitleLabel = (jobTitle || job?.title || "").trim();
  const clientLabel = (job?.client_name || "Client").trim() || "Client";
  const periodStartLabel = reportingPeriodStart || job?.reporting_period_start || "";
  const periodEndLabel = reportingPeriodEnd || job?.reporting_period_end || "";
  const reportingPeriodLabel =
    periodStartLabel && periodEndLabel
      ? `${formatDisplayDate(periodStartLabel)} - ${formatDisplayDate(periodEndLabel)}`
      : job?.reporting_year
        ? `Year ${job.reporting_year}`
        : "Reporting period not set";

  function parseClientYearEndMonthToNumber(value: string): number | null {
    const raw = String(value || "").trim();
    if (!raw) return null;
    if (/^\d{1,2}$/.test(raw)) {
      const num = Number(raw);
      return num >= 1 && num <= 12 ? num : null;
    }
    const normalized = raw.toLowerCase();
    return MONTH_MAP_NORMALIZED[normalized] ?? null;
  }

  function parseDateMonthToNumber(value: string): number | null {
    const raw = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    const mm = Number(raw.slice(5, 7));
    return mm >= 1 && mm <= 12 ? mm : null;
  }

  const clientYearEndMonthNumber = parseClientYearEndMonthToNumber(clientYearEndMonth);
  const reportingPeriodEndMonthNumber = parseDateMonthToNumber(reportingPeriodEnd);
  const periodEndMonthMismatch =
    clientYearEndMonthNumber != null &&
    reportingPeriodEndMonthNumber != null &&
    clientYearEndMonthNumber !== reportingPeriodEndMonthNumber;

  const setupSteps = useMemo(
    () => [
      {
        key: "details",
        label: "Job details",
        complete: Boolean(jobTitle.trim()) && Boolean(jobStatus.trim()),
      },
      {
        key: "period",
        label: "Reporting period",
        complete: Boolean(periodStartLabel && periodEndLabel),
      },
      {
        key: "template",
        label: "Template",
        complete: Boolean(selectedTemplateId),
      },
      {
        key: "milestones",
        label: "Milestones",
        complete: Boolean(
          selectedMilestoneTemplateId && selectedMilestoneTemplateId !== "__none__"
        ),
      },
    ],
    [
      jobTitle,
      jobStatus,
      periodStartLabel,
      periodEndLabel,
      selectedTemplateId,
      selectedMilestoneTemplateId,
    ]
  );

  const setupCompletedCount = setupSteps.filter((step) => step.complete).length;
  const setupTotalCount = setupSteps.length;
  const isSetupComplete = setupTotalCount > 0 && setupCompletedCount >= setupTotalCount;
  const setupCompletionLabel = `Setup ${setupCompletedCount}/${setupTotalCount} complete`;
  const setupCompletionBadgeClassName = isSetupComplete
    ? "border-green-200 bg-green-50 text-green-800"
    : "border-red-200 bg-red-50 text-red-800";
  const primaryActionTab = setupCompletedCount < setupTotalCount ? "setup" : "data-entry";
  const primaryActionLabel =
    primaryActionTab === "setup" ? "Continue Setup" : "Go to Data Entry";
  const navTriggerClassName =
    "w-full justify-start rounded-md px-3 py-2 text-sm font-medium hover:bg-muted/60 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-none";

  function selectedSiteName(): string {
    if (selectedSiteId === "All") return "All";
    const sid = Number(selectedSiteId);
    const match = sites.find((s) => (s.site_id ?? -1) === sid);
    return (match?.site_name ?? "").trim() || "All";
  }

  function getMilestoneNames(): [string, string, string] {
    // Get milestone names from the job's template, or use defaults
    const templateId = job?.milestone_template_id;
    const defaults: [string, string, string] = ["Data Collection Due", "First Draft Due", "Final Report Due"];
    
    if (templateId) {
      const template = milestoneTemplates.find(t => t.template_id === templateId);
      if (template?.items && template.items.length > 0) {
        // Use template milestone names where available, fall back to defaults for missing items
        return [
          template.items[0]?.milestone_name || defaults[0],
          template.items[1]?.milestone_name || defaults[1],
          template.items[2]?.milestone_name || defaults[2]
        ];
      }
    }
    // Fallback to default names
    return defaults;
  }

  function parseDateValue(value?: string | null): Date | null {
    if (!value) return null;
    const [year, month, day] = String(value).split("-").map((part) => Number(part));
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
  }

  function addDays(baseDate: Date, daysOffset: number): Date {
    const next = new Date(baseDate);
    next.setDate(next.getDate() + daysOffset);
    return next;
  }

  function milestoneStatusFromDate(dueDate: Date): string {
    const today = new Date();
    const diffDays = Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < -1) return "red";
    if (diffDays <= 7) return "amber";
    return "green";
  }

  const selectedMilestoneTemplate = useMemo(() => {
    const templateId =
      job?.milestone_template_id ??
      (selectedMilestoneTemplateId && selectedMilestoneTemplateId !== "__none__"
        ? Number(selectedMilestoneTemplateId)
        : null);
    if (!templateId) return null;
    return milestoneTemplates.find((template) => template.template_id === templateId) ?? null;
  }, [job?.milestone_template_id, selectedMilestoneTemplateId, milestoneTemplates]);

  const milestoneTemplateCompletionMap = useMemo(() => {
    const map = new Map<number, MilestoneTemplateCompletion>();
    milestoneTemplateCompletions.forEach((item) => {
      if (Number.isFinite(Number(item.item_id))) {
        map.set(Number(item.item_id), item);
      }
    });
    return map;
  }, [milestoneTemplateCompletions]);

  const milestoneAnchorDate = useMemo(() => {
    return (
      parseDateValue(jobStartDate) ||
      parseDateValue(job?.start_date) ||
      parseDateValue(reportingPeriodStart) ||
      parseDateValue(job?.reporting_period_start)
    );
  }, [job?.reporting_period_start, job?.start_date, jobStartDate, reportingPeriodStart]);

  const additionalMilestonesEditable = Boolean(
    job?.milestone_template_id &&
    selectedMilestoneTemplate &&
    Number(job.milestone_template_id) === Number(selectedMilestoneTemplate.template_id)
  );
  const currentJobId = job?.job_id ?? null;

  const additionalMilestoneItems = useMemo(() => {
    const items = selectedMilestoneTemplate?.items ?? [];
    if (!milestoneAnchorDate || items.length <= 3) return [];

    return items.slice(3).map((item, index) => {
      const dueDate = addDays(milestoneAnchorDate, Number(item.days_offset) || 0);
      const completion = milestoneTemplateCompletionMap.get(Number(item.item_id));
      const isCompleted = Boolean(completion?.is_complete);
      return {
        itemId: Number(item.item_id),
        key: `${selectedMilestoneTemplate?.template_id ?? "template"}-${index + 4}`,
        label: item.milestone_name || `Milestone ${index + 4}`,
        dueDate: dueDate.toISOString(),
        status: isCompleted ? "completed" : milestoneStatusFromDate(dueDate),
        completedAt: completion?.completed_at ?? null,
        completedBy: completion?.completed_by ?? null,
      };
    });
  }, [milestoneAnchorDate, selectedMilestoneTemplate, milestoneTemplateCompletionMap]);

  const reportMetadataFieldsForSetup = useMemo(() => {
    const filtered = reportMetadataFields.filter((field) =>
      JOB_SETUP_METADATA_KEY_ORDER.has(field.key as (typeof JOB_SETUP_METADATA_KEYS)[number])
    );

    return filtered.sort(
      (a, b) =>
        (JOB_SETUP_METADATA_KEY_ORDER.get(a.key as (typeof JOB_SETUP_METADATA_KEYS)[number]) ?? 999) -
        (JOB_SETUP_METADATA_KEY_ORDER.get(b.key as (typeof JOB_SETUP_METADATA_KEYS)[number]) ?? 999)
    );
  }, [reportMetadataFields]);

  const reportMetadataFieldsBySection = useMemo(() => {
    const grouped: Record<string, ReportMetadataField[]> = {};
    reportMetadataFieldsForSetup.forEach((field) => {
      const section = field.section || "General";
      if (!grouped[section]) grouped[section] = [];
      grouped[section].push(field);
    });
    return grouped;
  }, [reportMetadataFieldsForSetup]);

  const activeTeamMembers = useMemo(
    () => teamMembers.filter((m) => String(m.status ?? "Active").toLowerCase() === "active"),
    [teamMembers]
  );

  const selectedConsultantName = (reportMetadataValues["consultant_name"] ?? "").trim();
  const matchedConsultant = useMemo(() => {
    if (!selectedConsultantName) return null;
    const nameLc = selectedConsultantName.toLowerCase();
    return (
      activeTeamMembers.find((m) => (m.full_name ?? "").trim().toLowerCase() === nameLc) ?? null
    );
  }, [activeTeamMembers, selectedConsultantName]);

  const consultantOptions = useMemo(() => {
    const byName = new Map<string, TeamMember>();
    activeTeamMembers.forEach((member) => {
      const name = (member.full_name ?? "").trim();
      if (!name) return;
      if (!byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), member);
    });
    return Array.from(byName.values()).sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [activeTeamMembers]);

  useEffect(() => {
    if (!matchedConsultant) return;
    const nextPosition = (matchedConsultant.position ?? "").trim();
    setReportMetadataValues((prev) => {
      if ((prev["consultant_position"] ?? "") === nextPosition) return prev;
      return { ...prev, consultant_position: nextPosition };
    });
  }, [matchedConsultant]);

  const derivedEnergyMetadataValues = useMemo(
    () =>
      calculateDerivedEnergyEmissionFields(reportMetadataValues, reportMetadataEnergyFactors),
    [
      reportMetadataValues["energy_consumption_uk_kwh"],
      reportMetadataValues["energy_consumption_non_uk_kwh"],
      reportMetadataValues["renewable_energy_kwh"],
      reportMetadataEnergyFactors,
    ]
  );

  useEffect(() => {
    setReportMetadataValues((prev) => {
      const nextLocation = derivedEnergyMetadataValues["energy_emissions_tco2e"] ?? "0";
      const nextMarket = derivedEnergyMetadataValues["energy_emissions_market_tco2e"] ?? "0";
      if (
        (prev["energy_emissions_tco2e"] ?? "") === nextLocation &&
        (prev["energy_emissions_market_tco2e"] ?? "") === nextMarket
      ) {
        return prev;
      }
      return {
        ...prev,
        energy_emissions_tco2e: nextLocation,
        energy_emissions_market_tco2e: nextMarket,
      };
    });
  }, [derivedEnergyMetadataValues]);

  const unresolvedScopeCount = scopeAutoResolution?.unresolved_scopes?.length ?? 0;
  const selectedFallbackDatasetCount = useMemo(
    () => SCOPE_KEYS.filter((scope) => {
      const fallback = scopeDatasetIds[scope];
      return Boolean(fallback && fallback !== "__none__");
    }).length,
    [scopeDatasetIds]
  );
  const datasetOverridesNeedAttention =
    scopeConfigMode !== "automatic" ||
    unresolvedScopeCount > 0 ||
    Boolean(scopeAutoResolution?.uses_legacy_fallback) ||
    scopeConfigWarnings.length > 0 ||
    additionalDatasetIds.length > 0 ||
    selectedFallbackDatasetCount > 0;
  const datasetOverrideSummary = datasetOverridesNeedAttention
    ? [
        unresolvedScopeCount > 0 ? `${unresolvedScopeCount} unresolved scope${unresolvedScopeCount === 1 ? "" : "s"}` : null,
        scopeAutoResolution?.uses_legacy_fallback ? "legacy fallback in use" : null,
        additionalDatasetIds.length > 0 ? `${additionalDatasetIds.length} additional dataset${additionalDatasetIds.length === 1 ? "" : "s"}` : null,
        selectedFallbackDatasetCount > 0 ? `${selectedFallbackDatasetCount} fallback dataset${selectedFallbackDatasetCount === 1 ? "" : "s"} selected` : null,
        scopeConfigWarnings.length > 0 ? `${scopeConfigWarnings.length} warning${scopeConfigWarnings.length === 1 ? "" : "s"}` : null,
        scopeConfigMode !== "automatic" ? "manual mapping mode" : null,
      ]
        .filter(Boolean)
        .join(" • ")
    : "Automatic dataset resolution is active. Advanced overrides are hidden unless needed.";

  function renderReportMetadataInput(field: ReportMetadataField, idPrefix: string) {
    const inputId = `${idPrefix}-${field.key}`;
    const value = reportMetadataValues[field.key] ?? "";
    const isAutoField = AUTO_REPORT_METADATA_FIELDS.has(field.key);
    const onTextChange = (nextValue: string) => {
      setReportMetadataValues((prev) => ({ ...prev, [field.key]: nextValue }));
    };

    if (field.key === "consultant_name") {
      const currentName = value.trim();
      const hasCurrentInList = consultantOptions.some(
        (m) => m.full_name.trim().toLowerCase() === currentName.toLowerCase()
      );

      return (
        <Select
          value={currentName || "__none__"}
          onValueChange={(nextValue) => {
            if (nextValue === "__none__") {
              setReportMetadataValues((prev) => ({
                ...prev,
                consultant_name: "",
                consultant_position: "",
              }));
              return;
            }
            const selected = consultantOptions.find(
              (m) => m.full_name.trim().toLowerCase() === nextValue.trim().toLowerCase()
            );
            const selectedPosition = (selected?.position ?? "").trim();
            setReportMetadataValues((prev) => ({
              ...prev,
              consultant_name: nextValue,
              consultant_position: selectedPosition,
            }));
          }}
        >
          <SelectTrigger id={inputId}>
            <SelectValue placeholder="Select consultant..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">None</SelectItem>
            {consultantOptions.map((member) => (
              <SelectItem key={`consultant-${member.user_id}-${member.full_name}`} value={member.full_name}>
                {member.full_name}
              </SelectItem>
            ))}
            {currentName && !hasCurrentInList ? (
              <SelectItem value={currentName}>{currentName}</SelectItem>
            ) : null}
          </SelectContent>
        </Select>
      );
    }

    if (field.key === "consultant_position") {
      return (
        <Input
          id={inputId}
          type="text"
          value={value}
          readOnly
          className="bg-muted"
        />
      );
    }

    if (field.field_type === "textarea") {
      return (
        <Textarea
          id={inputId}
          value={value}
          rows={3}
          className={`resize-y ${isAutoField ? "bg-muted" : ""}`}
          readOnly={isAutoField}
          onChange={(e) => onTextChange(e.target.value)}
        />
      );
    }

    if (field.field_type === "boolean") {
      return (
        <Select
          value={value}
          onValueChange={(nextValue) => onTextChange(normalizeMetadataBoolean(nextValue))}
        >
          <SelectTrigger id={inputId}>
            <SelectValue placeholder="Select..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">Yes</SelectItem>
            <SelectItem value="false">No</SelectItem>
          </SelectContent>
        </Select>
      );
    }

    if (field.field_type === "date") {
      return (
        <Input
          id={inputId}
          type="date"
          value={value}
          onChange={(e) => onTextChange(e.target.value)}
        />
      );
    }

    if (field.field_type === "number") {
      return (
        <Input
          id={inputId}
          type="number"
          value={value}
          readOnly={isAutoField}
          className={isAutoField ? "bg-muted" : undefined}
          onChange={(e) => onTextChange(e.target.value)}
        />
      );
    }

    return (
      <Input
        id={inputId}
        type="text"
        value={value}
        readOnly={isAutoField}
        className={isAutoField ? "bg-muted" : undefined}
        onChange={(e) => onTextChange(e.target.value)}
      />
    );
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!Number.isFinite(jobId) || jobId <= 0) {
        setError("Invalid job id");
        return;
      }

      setLoading(true);
      setError("");

      try {
        const [jRes, sRes, tRes, dRes, scRes, statusRes, teamRes, mtRes, mcRes] = await Promise.all([
          fetch(`${baseUrl}/jobs/${jobId}`),
          fetch(`${baseUrl}/jobs/${jobId}/sites`),
          fetch(`${baseUrl}/job-templates`),
          fetch(`${baseUrl}/datasets`),
          fetch(`${baseUrl}/jobs/${jobId}/scope-config`),
          fetch(`${baseUrl}/admin/lookups/job_statuses_lookup`),
          fetch(`${baseUrl}/admin/users`),
          fetch(`${baseUrl}/milestone-templates`),
          fetch(`${baseUrl}/jobs/${jobId}/milestone-template-completions`),
        ]);

        if (!jRes.ok) {
          const t = await jRes.text().catch(() => "");
          throw new Error(`Failed to load job: ${jRes.status} ${jRes.statusText}${t ? ` - ${t}` : ""}`);
        }

        const jJson = (await jRes.json()) as Job;
        const sJson = sRes.ok ? ((await sRes.json()) as JobSitesResponse) : null;
        const tJson = tRes.ok ? ((await tRes.json()) as JobTemplatesResponse) : null;
        const dJson = dRes.ok ? ((await dRes.json()) as DatasetsResponse) : null;
        const scJson = scRes.ok ? ((await scRes.json()) as JobScopeConfigResponse) : null;
        const statusJson = statusRes.ok ? await statusRes.json() : null;
        const teamJson = teamRes.ok ? await teamRes.json() : null;
        const mtJson = mtRes.ok ? ((await mtRes.json()) as MilestoneTemplatesResponse) : null;
        const mcJson = mcRes.ok ? ((await mcRes.json()) as MilestoneTemplateCompletionsResponse) : null;

        if (cancelled) return;

        setJob(jJson);
        
        // Initialize job details fields
        setJobTitle(jJson.title || "");
        setJobStatus(jJson.status || "Draft");
        setCrmName(jJson.crm_name || "");
        setLegacyJobNo(jJson.legacy_job_no || "");
        setJobStartDate(jJson.start_date || "");
        setJobEndDate(jJson.due_date || "");
        
        // Fetch client data for currency and reporting period calculation
        if (jJson.client_db_id) {
          const clientRes = await fetch(`${baseUrl}/clients/${jJson.client_db_id}`);
          if (clientRes.ok) {
            const clientJson = await clientRes.json();
            
            // Set currency for intensity metrics
            setClientCurrency(clientJson.currency || "GBP");
            setClientYearEndMonth(clientJson.year_end_month || "");
            
            // Auto-calculate reporting period if not set
            if (!jJson.reporting_period_start && clientJson.year_end_month && clientJson.benchmark_year && jJson.reporting_year) {
              const calculated = calculateReportingPeriod(
                clientJson.year_end_month,
                clientJson.benchmark_year,
                jJson.reporting_year
              );
              if (calculated) {
                setReportingPeriodStart(calculated.start);
                setReportingPeriodEnd(calculated.end);
              }
            }
          }
        }
        
        if (jJson.reporting_period_start) {
          setReportingPeriodStart(jJson.reporting_period_start);
          setReportingPeriodEnd(jJson.reporting_period_end || "");
        }
        
        // Fetch scope totals for intensity metrics
        const totalsRes = await fetch(`${baseUrl}/jobs/${jobId}/scope-totals`);
        if (totalsRes.ok) {
          const totalsData = await totalsRes.json();
          setTotalEmissions(totalsData.total || 0);
        }

        const tItems = tJson?.items ?? [];
        setTemplates(tItems);
        const jt = jJson.job_template_id;
        setSelectedTemplateId(jt != null ? String(jt) : "");

        const s = sJson?.sites ?? [];
        setSites(s);
        const firstId = s.find((x) => x.site_id != null)?.site_id;
        setSelectedSiteId(firstId != null ? String(firstId) : "All");

        // Set lookup data
        if (statusJson?.items) setJobStatuses(statusJson.items);
        if (teamJson?.items) setTeamMembers(teamJson.items);
        if (mtJson?.templates) setMilestoneTemplates(mtJson.templates);
        setMilestoneTemplateCompletions(Array.isArray(mcJson?.items) ? mcJson.items : []);
        
        // Set selected milestone template
        if (jJson.milestone_template_id) {
          setSelectedMilestoneTemplateId(String(jJson.milestone_template_id));
        } else if (mtJson?.templates) {
          // Default to the default template if job doesn't have one
          const defaultTemplate = mtJson.templates.find((t) => t.is_default);
          if (defaultTemplate) {
            setSelectedMilestoneTemplateId(String(defaultTemplate.template_id));
          }
        }

        setDatasets(dJson?.items ?? []);

        const effectiveItems = scJson?.items ?? [];
        const legacyItems = scJson?.legacy_items ?? effectiveItems;

        setScopeConfigMode(scJson?.mode || "legacy");
        setScopeConfigWarnings(
          Array.isArray(scJson?.warnings) ? scJson.warnings.map((w) => String(w)) : []
        );
        setScopeAutoResolution(scJson?.auto_resolution ?? null);
        setScopeEffectiveDatasetIds(scopeMapFromItems(effectiveItems));
        setScopeDatasetIds(scopeMapFromItems(legacyItems));
        setAdditionalDatasetIds(
          Array.isArray(scJson?.additional_dataset_ids)
            ? scJson.additional_dataset_ids.map((id) => String(id))
            : []
        );

      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        setJob(null);
        setSites([]);
        setDatasets([]);
        setScopeDatasetIds({ ...EMPTY_SCOPE_MAP });
        setScopeEffectiveDatasetIds({ ...EMPTY_SCOPE_MAP });
        setAdditionalDatasetIds([]);
        setScopeConfigMode("legacy");
        setScopeConfigWarnings([]);
        setScopeAutoResolution(null);
        setMilestoneTemplateCompletions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [baseUrl, jobId]);

  useEffect(() => {
    let cancelled = false;

    async function loadFallbackMetadataValuesFromReportData(): Promise<Record<string, unknown>> {
      try {
        const assignmentRes = await fetch(`${baseUrl}/jobs/${jobId}/report-template-assignment`);
        if (!assignmentRes.ok) return {};

        const assignmentPayload = await assignmentRes.json();
        const templateIdRaw =
          assignmentPayload?.assignment?.template_id ??
          assignmentPayload?.available_templates?.[0]?.template_id;
        const templateId = Number(templateIdRaw);
        if (!Number.isFinite(templateId) || templateId <= 0) return {};

        const versionIdRaw = assignmentPayload?.assignment?.version_id;
        const versionId = Number(versionIdRaw);
        const query =
          Number.isFinite(versionId) && versionId > 0
            ? `?version_id=${versionId}`
            : "";

        const reportDataRes = await fetch(
          `${baseUrl}/jobs/${jobId}/report-data/${templateId}${query}`
        );
        if (!reportDataRes.ok) return {};

        const reportDataPayload = await reportDataRes.json();
        if (
          reportDataPayload?.report_metadata &&
          typeof reportDataPayload.report_metadata === "object"
        ) {
          return reportDataPayload.report_metadata as Record<string, unknown>;
        }

        return {};
      } catch {
        return {};
      }
    }

    async function loadReportMetadata() {
      if (!Number.isFinite(jobId) || jobId <= 0) return;

      try {
        const res = await fetch(`${baseUrl}/jobs/${jobId}/report-metadata`);
        if (!res.ok) {
          if (res.status === 404) {
            const fallbackMetadata = await loadFallbackMetadataValuesFromReportData();
            if (cancelled) return;

            setReportMetadataApiUnavailable(true);
            setReportMetadataFields(JOB_SETUP_METADATA_FALLBACK_FIELDS);
            setReportMetadataValues(
              buildMetadataFieldValues(JOB_SETUP_METADATA_FALLBACK_FIELDS, fallbackMetadata)
            );
            setReportMetadataStatus(
              "Report metadata endpoint is unavailable on the running backend (404). Showing fallback fields only. Restart backend to enable saving."
            );
          }
          return;
        }

        const payload = await res.json();
        if (cancelled) return;

        const fields = Array.isArray(payload?.fields)
          ? (payload.fields as ReportMetadataField[])
          : [];
        const filteredFields = fields.filter((field) =>
          JOB_SETUP_METADATA_KEY_ORDER.has(field.key as (typeof JOB_SETUP_METADATA_KEYS)[number])
        );
        const effectiveFields =
          filteredFields.length > 0 ? filteredFields : JOB_SETUP_METADATA_FALLBACK_FIELDS;

        const metadata = (payload?.metadata || {}) as Record<string, unknown>;
        const energyFactors = (payload?.energy_emissions_factors || null) as
          | EnergyEmissionFactorDetails
          | null;
        setReportMetadataApiUnavailable(false);
        setReportMetadataFields(effectiveFields);
        setReportMetadataValues(buildMetadataFieldValues(effectiveFields, metadata));
        setReportMetadataEnergyFactors(energyFactors);
      } catch (e) {
        const fallbackMetadata = await loadFallbackMetadataValuesFromReportData();
        if (cancelled) return;

        setReportMetadataApiUnavailable(true);
        setReportMetadataFields(JOB_SETUP_METADATA_FALLBACK_FIELDS);
        setReportMetadataValues(
          buildMetadataFieldValues(JOB_SETUP_METADATA_FALLBACK_FIELDS, fallbackMetadata)
        );
        setReportMetadataEnergyFactors(null);
        setReportMetadataStatus(
          `Unable to load report metadata endpoint (${(e as Error).message}). Showing fallback fields only.`
        );
      }
    }

    loadReportMetadata();

    return () => {
      cancelled = true;
    };
  }, [baseUrl, jobId]);

  async function saveReportMetadata() {
    if (!Number.isFinite(jobId) || jobId <= 0) return;
    if (reportMetadataFieldsForSetup.length === 0) return;
    if (reportMetadataApiUnavailable) {
      setReportMetadataStatus(
        "Cannot save report variables because the running backend does not expose /jobs/{jobId}/report-metadata. Restart backend and refresh this page."
      );
      return;
    }

    setSavingReportMetadata(true);
    setReportMetadataStatus("Saving job setup report variables...");

    try {
      const metadataPayload: Record<string, string> = {};
      reportMetadataFieldsForSetup.forEach((field) => {
        if (AUTO_REPORT_METADATA_FIELDS.has(field.key)) return;
        metadataPayload[field.key] = reportMetadataValues[field.key] ?? "";
      });

      const res = await fetch(`${baseUrl}/jobs/${jobId}/report-metadata`, {
        method: "POST",
        headers: withAuditHeaders(
          {
            "Content-Type": "application/json",
          },
          { page: "Jobs", section: "Setup Overview", container: "Report Variables" }
        ),
        body: JSON.stringify({ metadata: metadataPayload }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        if (res.status === 404) {
          setReportMetadataApiUnavailable(true);
          setReportMetadataStatus(
            "Report metadata save endpoint returned 404. Restart backend and refresh this page."
          );
          return;
        }
        setReportMetadataStatus(`Report variable save failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
        return;
      }

      const payload = await res.json();
      const updatedMetadata = (payload?.metadata || {}) as Record<string, unknown>;
      const energyFactors = (payload?.energy_emissions_factors || null) as
        | EnergyEmissionFactorDetails
        | null;
      setReportMetadataValues(
        buildMetadataFieldValues(reportMetadataFieldsForSetup, updatedMetadata)
      );
      setReportMetadataEnergyFactors(energyFactors);

      setReportMetadataStatus("Job setup report variables saved successfully.");
      setTimeout(() => setReportMetadataStatus(""), 3000);
    } catch (e) {
      setReportMetadataStatus(`Report variable save error: ${(e as Error).message}`);
    } finally {
      setSavingReportMetadata(false);
    }
  }

  async function saveScopeDatasets() {
    if (!Number.isFinite(jobId) || jobId <= 0) return;

    setBusy(true);
    if (scopeConfigMode === "automatic") {
      setStatus("Saving manual fallback dataset mapping...");
    } else {
      setStatus("Saving scope datasets...");
    }
    try {
      const items = SCOPE_KEYS.map((scope) => {
        const v = scopeDatasetIds[scope] ?? "__none__";
        return { scope, dataset_id: v === "__none__" ? null : Number(v) };
      });

      const res = await fetch(`${baseUrl}/jobs/${jobId}/scope-config`, {
        method: "PUT",
        headers: withAuditHeaders(
          {
            "Content-Type": "application/json",
          },
          { page: "Jobs", section: "Setup Overview", container: "Dataset Configuration" }
        ),
        credentials: "include",
        body: JSON.stringify({
          items,
          additional_dataset_ids: additionalDatasetIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)),
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setStatus(`Save failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
        return;
      }

      const refreshRes = await fetch(`${baseUrl}/jobs/${jobId}/scope-config`);
      if (refreshRes.ok) {
        const refreshed = (await refreshRes.json()) as JobScopeConfigResponse;
        setScopeConfigMode(refreshed?.mode || "legacy");
        setScopeConfigWarnings(
          Array.isArray(refreshed?.warnings) ? refreshed.warnings.map((w) => String(w)) : []
        );
        setScopeAutoResolution(refreshed?.auto_resolution ?? null);
        setScopeEffectiveDatasetIds(scopeMapFromItems(refreshed?.items ?? []));
        setScopeDatasetIds(scopeMapFromItems(refreshed?.legacy_items ?? refreshed?.items ?? []));
        setAdditionalDatasetIds(
          Array.isArray(refreshed?.additional_dataset_ids)
            ? refreshed.additional_dataset_ids.map((id) => String(id))
            : []
        );
      }

      if (scopeConfigMode === "automatic") {
        setStatus("Manual fallback mapping saved. Automatic resolver remains active.");
      } else {
        setStatus("Scope datasets saved. Re-run validation.");
      }
    } catch (e) {
      setStatus(`Save error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate(jobTemplateId: string) {
    if (!Number.isFinite(jobId) || jobId <= 0) return;
    if (!jobTemplateId) {
      setStatus("Please select a template.");
      return;
    }

    setBusy(true);
    setStatus("Saving template...");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/job-template`, {
        method: "PUT",
        headers: withAuditHeaders(
          {
            "Content-Type": "application/json",
          },
          { page: "Jobs", section: "Setup Overview", container: "Job Template" }
        ),
        body: JSON.stringify({ job_template_id: Number(jobTemplateId) }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setStatus(`Save failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
        return;
      }

      setStatus("Template updated.");
      setJob((prev) => (prev ? { ...prev, job_template_id: Number(jobTemplateId) } : prev));
    } catch (e) {
      setStatus(`Save error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveJobDetails() {
    if (!Number.isFinite(jobId) || jobId <= 0) return;

    setBusy(true);
    setStatus("Saving job details...");
      try {
        const res = await fetch(`${baseUrl}/jobs/${jobId}`, {
          method: "PATCH",
          headers: withAuditHeaders(
            {
              "Content-Type": "application/json",
            },
            { page: "Jobs", section: "Setup Overview", container: "Job Details" }
          ),
          body: JSON.stringify({ 
            title: jobTitle,
            status: jobStatus,
          crm_name: crmName,
          legacy_job_no: legacyJobNo || null,
          start_date: jobStartDate || null,
          due_date: jobEndDate || null,
          milestone_template_id: selectedMilestoneTemplateId && selectedMilestoneTemplateId !== "__none__" ? Number(selectedMilestoneTemplateId) : null,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setStatus(`Save failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
        return;
      }

      setStatus("Job details saved successfully! Reloading milestones...");
      
      // Reload job data to get updated milestones
      const updatedJobRes = await fetch(`${baseUrl}/jobs/${jobId}`);
      if (updatedJobRes.ok) {
        const updatedJob = await updatedJobRes.json();
        setJob(updatedJob);
        setStatus("Job details and milestones updated successfully!");
      } else {
        setJob((prev) => (prev ? { 
          ...prev, 
          title: jobTitle, 
          status: jobStatus,
          crm_name: crmName,
          legacy_job_no: legacyJobNo || null,
          start_date: jobStartDate || null,
          due_date: jobEndDate || null,
        } : prev));
        setStatus("Job details saved (milestones reload failed)");
      }
      
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Save error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveReportingPeriod() {
    if (!Number.isFinite(jobId) || jobId <= 0) return;

    setBusy(true);
    setStatus("Saving reporting period...");
      try {
        const res = await fetch(`${baseUrl}/jobs/${jobId}`, {
          method: "PATCH",
          headers: withAuditHeaders(
            {
              "Content-Type": "application/json",
            },
            { page: "Jobs", section: "Setup Overview", container: "Reporting Period" }
          ),
          body: JSON.stringify({
            reporting_period_start: reportingPeriodStart || null,
            reporting_period_end: reportingPeriodEnd || null,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setStatus(`Save failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
        return;
      }

      setStatus("Reporting period updated. Datasets will be auto-selected based on this period.");
      setJob((prev) =>
        prev
          ? {
              ...prev,
              reporting_period_start: reportingPeriodStart || null,
              reporting_period_end: reportingPeriodEnd || null,
            }
          : prev
      );
    } catch (e) {
      setStatus(`Save error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function validateUpload() {
    if (!Number.isFinite(jobId) || jobId <= 0) return;
    if (!uploadFile) {
      setUploadStatus("Please choose an .xlsx file to upload.");
      return;
    }

    // Check if at least one scope has a dataset configured
    const hasDataset = SCOPE_KEYS.some(
      (scope) => {
        const effective = scopeEffectiveDatasetIds[scope];
        const fallback = scopeDatasetIds[scope];
        if (scopeConfigMode === "automatic") {
          return (
            (effective && effective !== "__none__") ||
            (fallback && fallback !== "__none__")
          );
        }
        return Boolean(fallback && fallback !== "__none__");
      }
    );
    if (!hasDataset) {
      if (scopeConfigMode === "automatic") {
        setUploadStatus(
          "No automatically resolved datasets were found for this reporting period/client. Save reporting period or set manual fallback datasets."
        );
      } else {
        setUploadStatus("Please configure at least one Scope Dataset before uploading.");
      }
      return;
    }

    setBusy(true);
    setUploadStatus("Uploading for validation...");
    setUploadResult(null);
    setUploadProgress(0);

    try {
      const form = new FormData();
      form.append("file", uploadFile);

      const res = await uploadFormDataWithProgress(`${baseUrl}/jobs/${jobId}/excel-upload`, {
        method: "POST",
        body: form,
        credentials: "include",
        headers: withAuditHeaders(),
        onProgress: ({ percent }) => {
          setUploadProgress(percent);
          setUploadStatus(percent >= 100 ? "Finalising upload..." : "Uploading for validation...");
        },
      });

      const text = await res.text();
      let json: UploadValidationResult | null = null;
      try {
        const parsed = JSON.parse(text) as unknown;
        if (parsed && typeof parsed === "object") {
          json = parsed as UploadValidationResult;
        } else {
          json = { raw: text };
        }
      } catch {
        json = { raw: text };
      }

      if (!res.ok) {
        setUploadStatus(`Upload failed: ${res.status} ${res.statusText}`);
        setUploadResult(json);
        return;
      }

      setUploadStatus(json?.ok ? "Validation OK" : "Validation found issues");
      setUploadResult(json);
    } catch (e) {
      setUploadStatus(`Upload failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      setUploadProgress(0);
    }
  }

  async function importValidatedRows() {
    if (!Number.isFinite(jobId) || jobId <= 0) return;

    if (selectedSiteId === "All") {
      setUploadStatus("Please select a specific site (not 'All') before importing.");
      return;
    }

    if (!Array.isArray(uploadResult?.rows_ready) || uploadResult.rows_ready.length === 0) {
      setUploadStatus("Nothing to import. Validate first.");
      return;
    }

    setBusy(true);
    setUploadStatus("Importing rows...");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/excel-import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ site_id: Number(selectedSiteId), rows_ready: uploadResult.rows_ready }),
      });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        setUploadStatus(`Import failed: ${res.status} ${res.statusText}${t ? ` - ${t}` : ""}`);
        return;
      }

      const json = await res.json().catch(() => null);
      setUploadStatus(`Import complete. Inserted ${json?.inserted ?? 0}, updated ${json?.updated ?? 0}.`);
    } catch (e) {
      setUploadStatus(`Import error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function downloadTemplate() {
    if (!Number.isFinite(jobId) || jobId <= 0) return;

    const siteName = selectedSiteName();
    if (!siteName.trim()) {
      setStatus("Please select a site.");
      return;
    }

    setBusy(true);
    setStatus("Downloading template...");
    try {
      const params = new URLSearchParams();
      params.set("site", siteName);
      params.set("include_prev_year", includePrevYear ? "true" : "false");
      params.set("template_format", "single");

      const res = await fetch(`${baseUrl}/jobs/${jobId}/excel-template?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setStatus(`Download failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
        return;
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get("content-disposition") ?? "";
      console.log("Content-Disposition:", contentDisposition);

      const safeNamePart = (value: string) =>
        (value || "")
          .trim()
          .replace(/[<>:"/\\|?*]+/g, "")
          .replace(/\s+/g, "-")
          .replace(/^-+|-+$/g, "") || "Unknown";
      const fallbackPeriod =
        periodStartLabel && periodEndLabel
          ? `${safeNamePart(periodStartLabel)}-to-${safeNamePart(periodEndLabel)}`
          : "reporting-period";
      
      // Extract filename from Content-Disposition header
      const filenameMatch = contentDisposition.match(/filename="([^"]+)"/i);
      const filename =
        filenameMatch?.[1] ??
        [
          safeNamePart(jobNumberLabel),
          safeNamePart(clientLabel),
          safeNamePart(siteName),
          fallbackPeriod,
          "data_upload.xlsx",
        ].join("_");
      console.log("Extracted filename:", filename);

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      setStatus(`Downloaded: ${filename}`);
    } catch (e) {
      setStatus(`Download error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <PageHeader
          title={jobNumberLabel}
          subtitle={jobTitleLabel || undefined}
          breadcrumbs={[
            { label: "Clients", href: "/clients" },
            job?.client_db_id
              ? { label: clientLabel, href: `/clients/${job.client_db_id}` }
              : { label: clientLabel },
            { label: "Jobs", href: "/jobs" },
            { label: jobNumberLabel },
          ]}
          titleSuffix={
            <>
              <StatusBadge status={statusLabel} label={statusLabel} />
              {job?.is_benchmark ? (
                <Badge className="border-blue-200 bg-blue-50 text-blue-700">
                  Benchmark
                </Badge>
              ) : null}
            </>
          }
          meta={
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span>{clientLabel}</span>
                <span>•</span>
                <span>{reportingPeriodLabel}</span>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge
                  variant="outline"
                  className="border-muted-foreground/20 text-muted-foreground"
                >
                  Owner: {ownerLabel}
                </Badge>
                <Badge
                  variant="outline"
                  className={setupCompletionBadgeClassName}
                >
                  {setupCompletionLabel}
                </Badge>
                {Number.isFinite(jobId) ? (
                  <Badge
                    variant="outline"
                    className="border-muted-foreground/20 text-muted-foreground"
                  >
                    Job ID: {jobId}
                  </Badge>
                ) : null}
              </div>
            </div>
          }
          actionsClassName="w-full lg:w-auto justify-start lg:justify-end"
          actions={
            <div className="flex flex-col gap-2 sm:items-end">
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setActiveTab(primaryActionTab)}>
                  {primaryActionLabel}
                </Button>
                {job?.client_db_id ? (
                  <Button variant="secondary" asChild>
                    <Link href={`/?clientId=${job.client_db_id}&jobId=${jobId}`}>
                      Open in Hub
                    </Link>
                  </Button>
                ) : (
                  <Button variant="secondary" asChild>
                    <Link href={`/?jobId=${jobId}`}>Open in Hub</Link>
                  </Button>
                )}
                <Button variant="outline" asChild>
                  <Link href="/jobs">Back to Jobs</Link>
                </Button>
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                {job?.client_db_id ? (
                  <Link
                    className="hover:text-foreground"
                    href={`/clients/${job.client_db_id}`}
                  >
                    Client
                  </Link>
                ) : null}
                <Link className="hover:text-foreground" href="/">
                  Hub
                </Link>
              </div>
            </div>
          }
        />

        {error ? <div className="mb-4 text-sm text-destructive">{error}</div> : null}
        {loading ? <div className="mb-4 text-sm text-muted-foreground">Loading...</div> : null}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="flex flex-col items-start gap-6 lg:flex-row">
            <TabsList className="h-auto w-full flex-col items-stretch gap-4 rounded-lg border bg-muted/40 p-4 lg:w-64">
              <div className="space-y-1">
                <div className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Setup
                </div>
                <TabsTrigger value="setup" className={navTriggerClassName}>
                  Setup Overview
                </TabsTrigger>
              </div>
              <div className="space-y-1 pt-3">
                <div className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Data
                </div>
                <TabsTrigger value="data-entry" className={navTriggerClassName}>
                  Data Entry
                </TabsTrigger>
                <TabsTrigger value="employee-commuting" className={navTriggerClassName}>
                  Employee Commuting
                </TabsTrigger>
                <TabsTrigger value="asset-register" className={navTriggerClassName}>
                  Asset Register
                </TabsTrigger>
                <TabsTrigger value="business-travel" className={navTriggerClassName}>
                  Business Travel
                </TabsTrigger>
                <TabsTrigger value="upload" className={navTriggerClassName}>
                  Data Upload
                </TabsTrigger>
                <TabsTrigger value="custom-dataset" className={navTriggerClassName}>
                  Custom Dataset
                </TabsTrigger>
                <TabsTrigger value="custom-factors" className={navTriggerClassName}>
                  Custom Factors
                </TabsTrigger>
                <TabsTrigger value="spend-data" className={navTriggerClassName}>
                  Spend Data
                </TabsTrigger>
              </div>
              <div className="space-y-1 pt-3">
                <div className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Outputs
                </div>
                <TabsTrigger value="data-output" className={navTriggerClassName}>
                  Data Output
                </TabsTrigger>
                <TabsTrigger value="actions" className={navTriggerClassName}>
                  Actions
                </TabsTrigger>
                <TabsTrigger value="report-new" className={navTriggerClassName}>
                  Report (New)
                </TabsTrigger>
                <TabsTrigger value="reporting" className={navTriggerClassName}>
                  Reporting (Legacy)
                </TabsTrigger>
              </div>
              <div className="space-y-1 pt-3">
                <div className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  LCA
                </div>
                <TabsTrigger value="lca" className={navTriggerClassName}>
                  Life Cycle Analysis
                </TabsTrigger>
              </div>
              <div className="space-y-1 pt-3">
                <div className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Communications
                </div>
                <TabsTrigger value="communications-timeline" className={navTriggerClassName}>
                  Timeline
                </TabsTrigger>
                <TabsTrigger value="communications-inbox" className={navTriggerClassName}>
                  Inbox
                </TabsTrigger>
                <TabsTrigger value="communications-notes" className={navTriggerClassName}>
                  Notes
                </TabsTrigger>
                <TabsTrigger value="communications-email" className={navTriggerClassName}>
                  Email
                </TabsTrigger>
                <TabsTrigger value="communications-tasks" className={navTriggerClassName}>
                  Tasks
                </TabsTrigger>
                <TabsTrigger value="communications-automation" className={navTriggerClassName}>
                  Automation
                </TabsTrigger>
                <TabsTrigger value="communications-crm" className={navTriggerClassName}>
                  CRM Timeline
                </TabsTrigger>
              </div>
              <div className="space-y-1 pt-3">
                <div className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Financial
                </div>
                <TabsTrigger value="financial-quotes" className={navTriggerClassName}>
                  Quotes
                </TabsTrigger>
                <TabsTrigger value="financial-invoices" className={navTriggerClassName}>
                  Invoices
                </TabsTrigger>
                <TabsTrigger value="financial-other-costs" className={navTriggerClassName}>
                  Other Costs
                </TabsTrigger>
                <TabsTrigger value="financial-profit-loss" className={navTriggerClassName}>
                  Profit & Loss
                </TabsTrigger>
              </div>
              <div className="space-y-1 pt-3">
                <div className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Admin
                </div>
                <TabsTrigger value="custom-fields" className={navTriggerClassName}>
                  Custom Fields
                </TabsTrigger>
                <TabsTrigger value="files" className={navTriggerClassName}>
                  Files
                </TabsTrigger>
                <TabsTrigger value="time" className={navTriggerClassName}>
                  Time Entries
                </TabsTrigger>
              </div>
            </TabsList>

            <div className="flex-1">
              <TabsContent value="setup" className="mt-0">
            <div className="space-y-6">
              <EmissionsSummary jobId={jobId} baseUrl={baseUrl} />
              
              <div className="grid gap-6 md:grid-cols-2">
                <Card>
            <CardHeader>
              <CardTitle>Job Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="jobTitle">Job Title / Description</Label>
                <Input
                  id="jobTitle"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  placeholder="Enter job title..."
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="jobStatus">Status</Label>
                <Select value={jobStatus} onValueChange={setJobStatus}>
                  <SelectTrigger id="jobStatus">
                    <SelectValue placeholder="Select status..." />
                  </SelectTrigger>
                  <SelectContent>
                    {jobStatuses.map((status) => (
                      <SelectItem key={status.status_id} value={status.name}>
                        {status.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="crmName">CRM Name</Label>
                <Select value={crmName || "__none__"} onValueChange={(v) => setCrmName(v === "__none__" ? "" : v)}>
                  <SelectTrigger id="crmName">
                    <SelectValue placeholder="Select team member..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {teamMembers.map((member) => (
                      <SelectItem key={member.user_id} value={member.full_name}>
                        {member.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="legacyJobNo">Legacy Job No</Label>
                <Input
                  id="legacyJobNo"
                  value={legacyJobNo}
                  onChange={(e) => setLegacyJobNo(e.target.value)}
                  placeholder="Reference from old system"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="milestoneTemplate">Milestone Template</Label>
                <Select value={selectedMilestoneTemplateId || "__none__"} onValueChange={setSelectedMilestoneTemplateId}>
                  <SelectTrigger id="milestoneTemplate">
                    <SelectValue placeholder="Select milestone template..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {milestoneTemplates.map((template) => (
                      <SelectItem key={template.template_id} value={String(template.template_id)}>
                        {template.template_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Changing the template will recalculate milestones from the later of Job Start Date and Reporting Period Start Date.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="jobStartDate">Start Date</Label>
                  <Input
                    id="jobStartDate"
                    type="date"
                    value={jobStartDate}
                    onChange={(e) => setJobStartDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="jobEndDate">End Date</Label>
                  <Input
                    id="jobEndDate"
                    type="date"
                    value={jobEndDate}
                    onChange={(e) => setJobEndDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm">
                  <span className="text-muted-foreground">Job ID:</span> {Number.isFinite(jobId) ? jobId : "-"}
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Reporting Period:</span>{" "}
                  {job?.reporting_period_start && job?.reporting_period_end ? (
                    <div className="inline">
                      <span>
                        {new Date(job.reporting_period_start).toLocaleDateString('en-GB', {day: '2-digit', month: '2-digit', year: 'numeric'})} - {new Date(job.reporting_period_end).toLocaleDateString('en-GB', {day: '2-digit', month: '2-digit', year: 'numeric'})}
                      </span>
                      {job?.is_benchmark && (
                        <span className="ml-2 inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                          📊 Benchmark Period
                        </span>
                      )}
                    </div>
                  ) : job?.reporting_year ? (
                    <span>Year {job.reporting_year}</span>
                  ) : (
                    "-"
                  )}
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={saveJobDetails} disabled={busy}>
                  Save Job Details
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Template</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="text-sm font-medium">Reporting Period</div>
                <div className="text-xs text-muted-foreground">
                  Datasets will be auto-selected based on this period. System supports multi-year periods (e.g., Aug 2024 - Jul 2025).
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="periodStart">Period Start</Label>
                    <Input
                      id="periodStart"
                      type="date"
                      value={reportingPeriodStart}
                      onChange={(e) => setReportingPeriodStart(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="periodEnd">Period End</Label>
                    <Input
                      id="periodEnd"
                      type="date"
                      value={reportingPeriodEnd}
                      onChange={(e) => setReportingPeriodEnd(e.target.value)}
                    />
                    {periodEndMonthMismatch && (
                      <p className="text-xs text-amber-700">
                        The chosen Period End month does not align with the client&apos;s Year End month, as defined in the client&apos;s file
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button onClick={saveReportingPeriod} disabled={busy}>
                    Save reporting period
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="jobTemplate">Job Template</Label>
                <Select
                  value={selectedTemplateId}
                  onValueChange={(v) => {
                    setSelectedTemplateId(v);
                    setStatus("");
                  }}
                >
                  <SelectTrigger id="jobTemplate" className="w-full">
                    <SelectValue placeholder="Select a template..." />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.filter(t => t.is_active).map((t) => (
                      <SelectItem key={t.job_template_id} value={String(t.job_template_id)}>
                        {(t.template_key ?? "template") + (t.template_name ? ` — ${t.template_name}` : "")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex justify-end">
                  <Button onClick={() => saveTemplate(selectedTemplateId)} disabled={busy || !selectedTemplateId}>
                    Save template
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="site">Site</Label>
                <Select value={selectedSiteId} onValueChange={(v) => setSelectedSiteId(v)}>
                  <SelectTrigger id="site" className="w-full">
                    <SelectValue placeholder="Select a site..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All</SelectItem>
                    {sites
                      .filter((s) => s.site_id != null && (s.site_name ?? "").trim().length > 0)
                      .map((s) => (
                        <SelectItem key={s.site_id ?? ""} value={String(s.site_id)}>
                          {s.site_name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2 md:flex-row">
                <Button onClick={downloadTemplate} disabled={busy}>
                  Download Excel template
                </Button>
                <Button
                  variant={includePrevYear ? "default" : "outline"}
                  onClick={() => setIncludePrevYear((v) => !v)}
                  disabled={busy}
                >
                  Include previous year: {includePrevYear ? "On" : "Off"}
                </Button>
              </div>

              {status ? <div className="text-sm text-muted-foreground">{status}</div> : null}
            </CardContent>
          </Card>
              </div>

              {/* Project Milestones */}
              {(job?.data_collection_due || job?.first_draft_due || job?.final_report_due || additionalMilestoneItems.length > 0) && (() => {
                const [milestone1Name, milestone2Name, milestone3Name] = getMilestoneNames();
                return (
                  <Card>
                    <CardHeader>
                      <CardTitle>Project Milestones</CardTitle>
                    </CardHeader>
                    <CardContent>
                <div className="space-y-4">
                  {job?.data_collection_due && (
                    <MilestoneRow
                      label={milestone1Name}
                      dueDate={job.data_collection_due}
                      status={job.data_collection_status || 'green'}
                      completedAt={job.data_collection_completed_at}
                      completedBy={job.data_collection_completed_by}
                      onToggle={async (completed) => {
                        await fetch(`${apiBaseUrl()}/jobs/${job.job_id}/milestones/data_collection/complete`, {
                          method: 'POST',
                          credentials: 'include',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ completed }),
                        });
                        window.location.reload();
                      }}
                    />
                  )}
                  {job?.first_draft_due && (
                    <MilestoneRow
                      label={milestone2Name}
                      dueDate={job.first_draft_due}
                      status={job.first_draft_status || 'green'}
                      completedAt={job.first_draft_completed_at}
                      completedBy={job.first_draft_completed_by}
                      onToggle={async (completed) => {
                        await fetch(`${apiBaseUrl()}/jobs/${job.job_id}/milestones/first_draft/complete`, {
                          method: 'POST',
                          credentials: 'include',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ completed }),
                        });
                        window.location.reload();
                      }}
                    />
                  )}
                  {job?.final_report_due && (
                    <MilestoneRow
                      label={milestone3Name}
                      dueDate={job.final_report_due}
                      status={job.final_report_status || 'green'}
                      completedAt={job.final_report_completed_at}
                      completedBy={job.final_report_completed_by}
                      onToggle={async (completed) => {
                        await fetch(`${apiBaseUrl()}/jobs/${job.job_id}/milestones/final_report/complete`, {
                          method: 'POST',
                          credentials: 'include',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ completed }),
                        });
                        window.location.reload();
                      }}
                    />
                  )}
                  {additionalMilestoneItems.length > 0 && (
                    <div className="space-y-2 pt-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Additional template milestones
                      </div>
                      <div className="space-y-3">
                        {additionalMilestoneItems.map((item) => (
                          <MilestoneRow
                            key={item.key}
                            label={item.label}
                            dueDate={item.dueDate}
                            status={item.status}
                            completedAt={item.completedAt}
                            completedBy={item.completedBy}
                            onToggle={(() => {
                              if (!additionalMilestonesEditable || currentJobId == null) return undefined;
                              return async (completed) => {
                                await fetch(
                                  `${apiBaseUrl()}/jobs/${currentJobId}/milestone-template-items/${item.itemId}/complete`,
                                  {
                                    method: "POST",
                                    credentials: "include",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ completed }),
                                  }
                                );
                                window.location.reload();
                              };
                            })()}
                            readOnly={!additionalMilestonesEditable}
                            helperText={
                              additionalMilestonesEditable
                                ? "Shown from the selected template"
                                : "Save the milestone template to complete these items"
                            }
                          />
                        ))}
                      </div>
                    </div>
                  )}
                    </div>
                    </CardContent>
                  </Card>
                );
              })()}

              {/* Job Report Variables */}
              <Card>
                <CardHeader>
                  <CardTitle>Job Report Variables</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                    These fields are <strong>global report metadata</strong> used by the report templates for methodology,
                    data quality, targets, and other one-to-one placeholders. Template-specific section commentary lives in
                    <strong> Report - Variables</strong>.
                  </div>
                  {reportMetadataFieldsForSetup.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                      No report metadata variables available for this job.
                    </div>
                  ) : (
                    Object.entries(reportMetadataFieldsBySection).map(([section, fields]) => (
                      <div key={section} className="space-y-4">
                        <h4 className="text-sm font-semibold">{section}</h4>
                        <div className="grid gap-4 md:grid-cols-2">
                          {fields.map((field) => (
                            <div
                              key={field.key}
                              className={field.field_type === "textarea" ? "space-y-2 md:col-span-2" : "space-y-2"}
                            >
                              <Label htmlFor={`setup-report-meta-${field.key}`} className="flex items-center gap-2">
                                {field.label}
                                {AUTO_REPORT_METADATA_FIELDS.has(field.key) ? (
                                  <span className="rounded bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                                    Auto-generated
                                  </span>
                                ) : null}
                              </Label>
                              {renderReportMetadataInput(field, "setup-report-meta")}
                              {field.key === "datasets_names" ? (
                                <div className="text-xs text-muted-foreground">
                                  Derived automatically from the job&apos;s active datasets and reporting period.
                                </div>
                              ) : field.key === "energy_consumption_uk_kwh" ? (
                                <div className="text-xs text-muted-foreground">
                                  Derived automatically from Scope 2 UK electricity rows in Data Entry and uploads.
                                </div>
                              ) : field.key === "energy_consumption_non_uk_kwh" ? (
                                <div className="text-xs text-muted-foreground">
                                  Derived automatically from Scope 2 non-UK electricity rows in Data Entry and uploads.
                                </div>
                              ) : field.key === "renewable_energy_kwh" ? (
                                <div className="text-xs text-muted-foreground">
                                  Derived automatically from renewable or green electricity rows in the job&apos;s data inputs.
                                </div>
                              ) : field.key === "energy_emissions_tco2e" ? (
                                <div className="text-xs text-muted-foreground">
                                  Auto-calculated from the data-derived kWh using the active electricity and T&amp;D factors.
                                </div>
                              ) : field.key === "energy_emissions_market_tco2e" ? (
                                <div className="text-xs text-muted-foreground">
                                  Auto-calculated from the data-derived kWh. Renewable kWh suppresses the location factor, while T&amp;D still applies to total grid electricity.
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}

                  <div className="flex justify-end">
                    <Button
                      onClick={saveReportMetadata}
                      disabled={
                        savingReportMetadata ||
                        reportMetadataFieldsForSetup.length === 0 ||
                        reportMetadataApiUnavailable
                      }
                    >
                      {reportMetadataApiUnavailable
                        ? "Save Unavailable"
                        : savingReportMetadata
                          ? "Saving..."
                          : "Save Report Variables"}
                    </Button>
                  </div>

                  {reportMetadataStatus ? (
                    <div className="text-sm text-muted-foreground">{reportMetadataStatus}</div>
                  ) : null}
                </CardContent>
              </Card>

              {/* Scope Dataset Configuration */}
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <CardTitle>Advanced Dataset Overrides</CardTitle>
                      <div className="text-sm text-muted-foreground">
                        {datasetOverrideSummary}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => setShowAdvancedDatasetConfig((prev) => !prev)}
                    >
                      {showAdvancedDatasetConfig ? "Hide Advanced Overrides" : "Show Advanced Overrides"}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!showAdvancedDatasetConfig ? (
                    <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
                      The job will use automatically resolved datasets by default. Open this section only if you need to review unresolved scopes, add extra datasets, or set manual fallback mappings.
                    </div>
                  ) : null}

                  {showAdvancedDatasetConfig ? (
                    <>
                  <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                    <div className="text-sm font-medium">
                      Mode: {scopeConfigMode === "automatic" ? "Automatic resolution" : "Manual mapping"}
                    </div>
                    {scopeConfigMode === "automatic" ? (
                      <div className="text-xs text-muted-foreground">
                        Effective datasets are resolved from client country + reporting period. Manual selections below are fallback values only.
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        Manual scope dataset mapping is active for factor lookup.
                      </div>
                    )}

                    {scopeAutoResolution ? (
                      <div className="text-xs text-muted-foreground space-y-1">
                        <div>
                          Resolution context: {(scopeAutoResolution.country || "Unspecified country")} • {scopeAutoResolution.reporting_period_start || "?"} to {scopeAutoResolution.reporting_period_end || "?"}
                        </div>
                        {scopeAutoResolution.uses_legacy_fallback ? (
                          <div>Automatic mode is currently using some legacy fallback datasets.</div>
                        ) : null}
                        {scopeAutoResolution.unresolved_scopes?.length ? (
                          <div>Unresolved scopes: {scopeAutoResolution.unresolved_scopes.join(", ")}</div>
                        ) : null}
                      </div>
                    ) : null}

                    {scopeConfigWarnings.length ? (
                      <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-1">
                        {scopeConfigWarnings.map((warning, idx) => (
                          <li key={`scope-warning-${idx}`}>{warning}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>

                  <div className="text-sm text-muted-foreground">
                    Configure the fallback dataset per scope. In automatic mode, effective datasets are shown below and used first.
                  </div>

                  {scopeConfigMode === "automatic" ? (
                    <div className="rounded-md border p-3 space-y-2">
                      <div className="text-sm font-medium">Effective datasets in use</div>
                      <div className="grid gap-2 md:grid-cols-3 text-xs">
                        {SCOPE_KEYS.map((scope) => {
                          const dsId = scopeEffectiveDatasetIds[scope];
                          const ds =
                            dsId && dsId !== "__none__"
                              ? datasets.find((d) => String(d.dataset_id) === dsId)
                              : null;
                          return (
                            <div key={`effective-${scope}`} className="rounded border p-2">
                              <div className="font-medium">{scope}</div>
                              <div className="text-muted-foreground">
                                {ds
                                  ? `${ds.name || `Dataset ${ds.dataset_id}`}${ds.year ? ` (${ds.year})` : ""}`
                                  : "Not resolved"}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  <div className="rounded-md border p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium">Additional Datasets For This Job</div>
                      <div className="text-xs text-muted-foreground">
                        {additionalDatasetIds.length} selected
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Select any extra datasets the client needs for this job in addition to the default scope datasets.
                    </div>
                    <div className="max-h-52 space-y-2 overflow-auto pr-1">
                      {datasets
                        .filter((ds) => !ds.archived)
                        .sort((a, b) => {
                          const ay = Number(a.year || 0);
                          const by = Number(b.year || 0);
                          if (ay !== by) return by - ay;
                          return String(a.name || "").localeCompare(String(b.name || ""));
                        })
                        .map((ds) => {
                          const id = String(ds.dataset_id);
                          const selected = additionalDatasetIds.includes(id);
                          return (
                            <label
                              key={`extra-dataset-${id}`}
                              className="flex cursor-pointer items-center justify-between rounded border px-2 py-1.5 text-xs hover:bg-muted/40"
                            >
                              <div className="pr-2">
                                <div className="font-medium">
                                  {ds.name || `Dataset ${id}`}
                                </div>
                                <div className="text-muted-foreground">
                                  {ds.country || "Unknown"} • {ds.year || "n/a"} • {ds.analysis_type || "n/a"}
                                </div>
                              </div>
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => {
                                  setAdditionalDatasetIds((prev) =>
                                    selected ? prev.filter((x) => x !== id) : [...prev, id]
                                  );
                                  setStatus("");
                                }}
                                className="h-4 w-4"
                              />
                            </label>
                          );
                        })}
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    {SCOPE_KEYS.map((scope) => (
                      <div key={scope} className="space-y-2">
                        <Label htmlFor={`dataset-${scope}`}>
                          {scope}
                          {scopeConfigMode === "automatic" ? " (fallback)" : ""}
                        </Label>
                        <Select
                          value={scopeDatasetIds[scope] ?? "__none__"}
                          onValueChange={(v) => {
                            setScopeDatasetIds({ ...scopeDatasetIds, [scope]: v });
                            setStatus("");
                          }}
                        >
                          <SelectTrigger id={`dataset-${scope}`} className="w-full">
                            <SelectValue placeholder="Select dataset..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">None</SelectItem>
                            {datasets.filter(ds => !ds.archived).map((ds) => (
                              <SelectItem key={ds.dataset_id} value={String(ds.dataset_id)}>
                                {ds.name} ({ds.year})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                  
                  <div className="flex justify-end">
                    <Button onClick={saveScopeDatasets} disabled={busy}>
                      {scopeConfigMode === "automatic"
                        ? "Save Fallback Scope Datasets"
                        : "Save Scope Datasets"}
                    </Button>
                  </div>
                    </>
                  ) : null}
                </CardContent>
              </Card>

              {/* Intensity Metrics */}
              <div>
                <IntensityMetrics 
                  jobId={jobId} 
                  baseUrl={baseUrl} 
                  totalEmissions={totalEmissions}
                  currency={clientCurrency}
                />
              </div>

              {/* Custom Fields - shown in Setup for easy access during job creation */}
              <Card>
                <CardHeader>
                  <CardTitle style={{ color: '#F26624' }}>Custom Fields</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">
                    These custom fields are configured in Admin → Custom Fields. Required fields must be completed before saving.
                  </p>
                  <CustomFields entityId={jobId} entityType="job" baseUrl={baseUrl} />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="data-entry" className="mt-0">
            <JobDataEntry jobId={jobId} />
          </TabsContent>

          <TabsContent value="employee-commuting" className="mt-0">
            <EmployeeCommutingData
              jobId={jobId}
              baseUrl={baseUrl}
              jobNumber={job?.job_number}
              clientName={job?.client_name}
              reportingPeriodStart={job?.reporting_period_start}
              reportingPeriodEnd={job?.reporting_period_end}
            />
          </TabsContent>

          <TabsContent value="asset-register" className="mt-0">
          <JobSourceRegister
            jobId={jobId}
            baseUrl={baseUrl}
            sourceType="asset"
            title="Asset Register"
            description="Capture individual vehicles, equipment, and other Scope 1 sources, then group them for roll-up and reporting."
            jobNumber={job?.job_number}
            clientName={job?.client_name}
            reportingYear={job?.reporting_year}
          />
          </TabsContent>

          <TabsContent value="business-travel" className="mt-0">
          <JobSourceRegister
            jobId={jobId}
            baseUrl={baseUrl}
            sourceType="business_travel"
            title="Business Travel Register"
            description="Capture employee travel sources individually, then group them for Scope 3 reporting and inspection."
            jobNumber={job?.job_number}
            clientName={job?.client_name}
            reportingYear={job?.reporting_year}
          />
          </TabsContent>

          <TabsContent value="upload" className="mt-0">
            <div className="space-y-6">
              <EmissionsSummary jobId={jobId} baseUrl={baseUrl} />
              
              <Card>
                <CardHeader>
                  <CardTitle>Excel Upload</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="text-sm text-muted-foreground">
                      Upload a completed Excel template to import data. The system will merge with existing entries without replacing custom data.
                    </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="site">Site</Label>
                    <Select value={selectedSiteId} onValueChange={(v) => setSelectedSiteId(v)}>
                      <SelectTrigger id="site" className="w-full">
                        <SelectValue placeholder="Select a site..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="All">All</SelectItem>
                        {sites
                          .filter((s) => s.site_id != null && (s.site_name ?? "").trim().length > 0)
                          .map((s) => (
                            <SelectItem key={s.site_id ?? ""} value={String(s.site_id)}>
                              {s.site_name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="upload">Excel file (.xlsx)</Label>
                      <Input
                        id="upload"
                        type="file"
                        accept=".xlsx"
                        onChange={(e) => {
                          const f = e.target.files?.[0] ?? null;
                          setUploadFile(f);
                          setUploadResult(null);
                          setUploadStatus("");
                        }}
                      />
                    </div>
                    <div className="flex items-end">
                      <Button onClick={validateUpload} disabled={busy || !uploadFile}>
                        Validate upload
                      </Button>
                    </div>
                  </div>
                  {busy && uploadProgress > 0 ? (
                    <UploadProgressBar value={uploadProgress} label={uploadStatus || "Uploading"} />
                  ) : null}

                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      onClick={importValidatedRows}
                      disabled={
                        busy ||
                        selectedSiteId === "All" ||
                        !Array.isArray(uploadResult?.rows_ready) ||
                        uploadResult.rows_ready.length === 0
                      }
                    >
                      Import validated rows
                    </Button>
                  </div>

                  {uploadStatus ? <div className="text-sm text-muted-foreground">{uploadStatus}</div> : null}

                  {uploadResult ? (
                    <div className="space-y-3">
                      {Array.isArray(uploadResult?.errors) && uploadResult.errors.length ? (
                        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                          <div className="mb-2 font-medium text-destructive">Errors</div>
                          <ul className="list-disc pl-5">
                            {uploadResult.errors.map((e: string, idx: number) => (
                              <li key={idx}>{e}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {Array.isArray(uploadResult?.warnings) && uploadResult.warnings.length ? (
                        <div className="rounded-md border bg-muted/40 p-3 text-sm">
                          <div className="mb-2 font-medium">Warnings</div>
                          <ul className="list-disc pl-5">
                            {uploadResult.warnings.map((w: string, idx: number) => (
                              <li key={idx}>{w}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {typeof uploadResult?.details?.parsed_row_count === "number" ||
                      typeof uploadResult?.details?.rows_ready_count === "number" ? (
                        <div className="rounded-md border p-3 text-sm">
                          <div className="grid gap-2 md:grid-cols-2">
                            <div>
                              <span className="text-muted-foreground">Rows parsed:</span>{" "}
                              {uploadResult?.details?.parsed_row_count ?? "-"}
                            </div>
                            <div>
                              <span className="text-muted-foreground">Rows ready:</span>{" "}
                              {uploadResult?.details?.rows_ready_count ?? "-"}
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {Array.isArray(uploadResult?.rows_ready) && uploadResult.rows_ready.length ? (
                        <div className="rounded-md border p-3">
                          <div className="mb-2 text-sm font-medium">Preview (first 10 rows)</div>
                          <div className="max-h-64 overflow-auto">
                            <table className="w-full text-xs">
                              <thead className="sticky top-0 bg-background">
                                <tr className="border-b">
                                  <th className="p-2 text-left">Scope</th>
                                  <th className="p-2 text-left">ID</th>
                                  <th className="p-2 text-left">Report Label</th>
                                  <th className="p-2 text-right">Qty</th>
                                  <th className="p-2 text-right">tCO2e</th>
                                  <th className="p-2 text-left">Unit</th>
                                </tr>
                              </thead>
                              <tbody>
                                {uploadResult.rows_ready.slice(0, 10).map((r: UploadReadyRow, idx: number) => (
                                  <tr key={idx} className="border-b">
                                    <td className="p-2">{r.scope}</td>
                                    <td className="p-2 font-mono">{r.original_id}</td>
                                    <td className="p-2">{r.report_label ?? ""}</td>
                                    <td className="p-2 text-right">
                                      {typeof r.qty === "number" ? r.qty.toLocaleString() : r.qty}
                                    </td>
                                    <td className="p-2 text-right">
                                      {typeof r.calc_tco2e === "number"
                                        ? r.calc_tco2e.toLocaleString(undefined, { maximumFractionDigits: 6 })
                                        : r.calc_tco2e}
                                    </td>
                                    <td className="p-2">{r.ghg_unit ?? ""}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>
            </div>
          </TabsContent>

          <TabsContent value="custom-dataset" className="mt-0">
            <JobCustomDataset jobId={jobId} baseUrl={baseUrl} />
          </TabsContent>

          <TabsContent value="custom-factors" className="mt-0">
            <JobCustomFactors
              jobId={jobId}
              baseUrl={baseUrl}
              jobNumber={job?.job_number}
              clientName={job?.client_name}
              reportingYear={job?.reporting_year}
            />
          </TabsContent>

          <TabsContent value="spend-data" className="mt-0">
            <div className="space-y-6">
              <EmissionsSummary jobId={jobId} baseUrl={baseUrl} />
              <SpendDataCollection jobId={jobId} baseUrl={baseUrl} />
            </div>
          </TabsContent>

          <TabsContent value="data-output" className="mt-0">
            <DataOutput jobId={jobId} baseUrl={baseUrl} />
          </TabsContent>

          <TabsContent value="actions" className="mt-0">
            <JobActions
              jobId={jobId}
              baseUrl={baseUrl}
              onOpenReportNew={() => setActiveTab("report-new")}
            />
          </TabsContent>

          <TabsContent value="report-new" className="mt-0">
            <JobReportNew
              jobId={jobId}
              baseUrl={baseUrl}
              onOpenActions={() => setActiveTab("actions")}
              onOpenLegacyReporting={() => setActiveTab("reporting")}
            />
          </TabsContent>

          <TabsContent value="reporting" className="mt-0">
            <div className="space-y-6">
              <JobReporting jobId={jobId} baseUrl={baseUrl} />
            </div>
          </TabsContent>

          <TabsContent value="lca" className="mt-0">
            <JobLca jobId={jobId} baseUrl={baseUrl} />
          </TabsContent>

          <TabsContent value="communications-timeline" className="mt-0">
            <JobCommunications jobId={jobId} baseUrl={baseUrl} mode="timeline" />
          </TabsContent>

          <TabsContent value="communications-inbox" className="mt-0">
            <JobCommunications jobId={jobId} baseUrl={baseUrl} mode="inbox" />
          </TabsContent>

          <TabsContent value="communications-notes" className="mt-0">
            <JobCommunications jobId={jobId} baseUrl={baseUrl} mode="notes" />
          </TabsContent>

          <TabsContent value="communications-email" className="mt-0">
            <JobCommunications jobId={jobId} baseUrl={baseUrl} mode="email" />
          </TabsContent>

          <TabsContent value="communications-tasks" className="mt-0">
            <JobCommunications jobId={jobId} baseUrl={baseUrl} mode="tasks" />
          </TabsContent>

          <TabsContent value="communications-automation" className="mt-0">
            <JobCommunications jobId={jobId} baseUrl={baseUrl} mode="automation" />
          </TabsContent>

          <TabsContent value="communications-crm" className="mt-0">
            {job?.client_db_id ? (
              <ClientTimeline clientId={job.client_db_id} baseUrl={baseUrl} jobId={jobId} />
            ) : (
              <Card>
                <CardHeader><CardTitle>CRM Timeline</CardTitle></CardHeader>
                <CardContent className="text-sm text-muted-foreground">No client linked to this job.</CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="financial-quotes" className="mt-0">
            <JobFinancial
              jobId={jobId}
              clientId={job?.client_db_id ?? null}
              jobNumber={job?.job_number ?? null}
              baseUrl={baseUrl}
              mode="quotes"
            />
          </TabsContent>

          <TabsContent value="financial-invoices" className="mt-0">
            <JobFinancial
              jobId={jobId}
              clientId={job?.client_db_id ?? null}
              jobNumber={job?.job_number ?? null}
              baseUrl={baseUrl}
              mode="invoices"
            />
          </TabsContent>

          <TabsContent value="financial-profit-loss" className="mt-0">
            <JobFinancial
              jobId={jobId}
              clientId={job?.client_db_id ?? null}
              jobNumber={job?.job_number ?? null}
              baseUrl={baseUrl}
              mode="profit-loss"
            />
          </TabsContent>

          <TabsContent value="financial-other-costs" className="mt-0">
            <JobFinancial
              jobId={jobId}
              clientId={job?.client_db_id ?? null}
              jobNumber={job?.job_number ?? null}
              baseUrl={baseUrl}
              mode="other-costs"
            />
          </TabsContent>

          <TabsContent value="custom-fields" className="mt-0">
            <CustomFields entityId={jobId} entityType="job" baseUrl={baseUrl} />
          </TabsContent>

          <TabsContent value="files" className="mt-0">
            <JobFiles jobId={jobId} baseUrl={baseUrl} />
          </TabsContent>

          <TabsContent value="time" className="mt-0">
            <JobTimeEntries jobId={jobId} baseUrl={baseUrl} />
          </TabsContent>
            </div>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
