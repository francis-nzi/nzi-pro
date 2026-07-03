"use client";

import dynamic from "next/dynamic";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import ActivityHistoryModal from "@/components/ActivityHistoryModal";
import JobWorkspaceHeader from "@/components/job-workspace/JobWorkspaceHeader";
import JobReviewNotificationBar from "@/components/job-workspace/JobReviewNotificationBar";
import JobSetupOverviewSection from "@/components/job-workspace/JobSetupOverviewSection";
import JobScopeDatasetSection from "@/components/job-workspace/JobScopeDatasetSection";
import JobFinancialTabs from "@/components/job-workspace/JobFinancialTabs";
import JobCommunicationsTabs from "@/components/job-workspace/JobCommunicationsTabs";
import JobUploadSection from "@/components/job-workspace/JobUploadSection";
import JobProjectMilestonesSection from "@/components/job-workspace/JobProjectMilestonesSection";
import JobScopeCard, { type JobScopeCardHandle } from "@/components/job-workspace/JobScopeCard";
import useJobWorkspaceData from "@/components/job-workspace/useJobWorkspaceData";
import useJobWorkspaceActions from "@/components/job-workspace/useJobWorkspaceActions";
import useJobWorkspaceDerivedState from "@/components/job-workspace/useJobWorkspaceDerivedState";
import type { WorkspaceBreadcrumb } from "@/components/job-workspace/types";
import { formatJobFamilyLabel, getJobFamilyDescription, jobFamilyBadgeClassName } from "@/lib/job-family";
import {
  JOB_WORKSPACE_GROUPS,
  EMPTY_SCOPE_MAP,
  type ReportMetadataField,
  type ScopeKey,
} from "@/lib/job-workspace";
import type { EnergyEmissionFactorDetails } from "@/lib/report-metadata";

function apiBaseUrl(): string {
  return "/api/backend";
}

function LazyTabPanel({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-6 text-sm text-muted-foreground">
          <div className="font-medium text-slate-700">Loading section</div>
          <div className="mt-1">{description}</div>
        </div>
      </CardContent>
    </Card>
  );
}

const JobDataEntry = dynamic(() => import("@/components/JobDataEntry"), {
  loading: () => <LazyTabPanel title="Data Entry" description="Loading the data entry workspace..." />,
});
const IntensityMetrics = dynamic(() => import("@/components/IntensityMetrics"), {
  loading: () => <LazyTabPanel title="Intensity Metrics" description="Loading intensity metrics..." />,
});
const DataOutput = dynamic(() => import("@/components/DataOutput"), {
  loading: () => <LazyTabPanel title="Data Output" description="Loading output summaries..." />,
});
const JobCustomDataset = dynamic(() => import("@/components/JobCustomDataset"), {
  loading: () => <LazyTabPanel title="Custom Dataset" description="Loading custom dataset tools..." />,
});
const JobCustomFactors = dynamic(() => import("@/components/JobCustomFactors"), {
  loading: () => <LazyTabPanel title="Job-Only Factors" description="Loading job-only factors..." />,
});
const JobSourceRegister = dynamic(() => import("@/components/JobSourceRegister"), {
  loading: () => <LazyTabPanel title="Source Register" description="Loading register data..." />,
});
const SpendDataCollection = dynamic(() => import("@/components/SpendDataCollection"), {
  loading: () => <LazyTabPanel title="Spend Data" description="Loading spend data collection..." />,
});
const JobNotesSummary = dynamic(() => import("@/components/JobNotesSummary"), {
  loading: () => <LazyTabPanel title="Job Notes" description="Loading job notes..." />,
});
const EmployeeCommutingData = dynamic(() => import("@/components/EmployeeCommutingData"), {
  loading: () => <LazyTabPanel title="Employee Commuting" description="Loading commuting data..." />,
});
const JobActions = dynamic(() => import("@/components/JobActions"), {
  loading: () => <LazyTabPanel title="Actions" description="Loading action recommendations..." />,
});
const JobReportNew = dynamic(() => import("@/components/JobReportNew"), {
  loading: () => <LazyTabPanel title="Report (New)" description="Loading report editor..." />,
});
const JobLca = dynamic(() => import("@/components/JobLca"), {
  loading: () => <LazyTabPanel title="Life Cycle Analysis" description="Loading life cycle analysis..." />,
});
const JobTraining = dynamic(() => import("@/components/JobTraining"), {
  loading: () => <LazyTabPanel title="Training Details" description="Loading training details..." />,
});
const JobConsultancy = dynamic(() => import("@/components/JobConsultancy"), {
  loading: () => <LazyTabPanel title="Consultancy Details" description="Loading consultancy details..." />,
});
const JobPcf = dynamic(() => import("@/components/JobPcf"), {
  loading: () => <LazyTabPanel title="PCF Details" description="Loading product carbon footprinting details..." />,
});
const JobTimeEntries = dynamic(() => import("@/components/JobTimeEntries"), {
  loading: () => <LazyTabPanel title="Time Entries" description="Loading time entries..." />,
});
const JobFiles = dynamic(() => import("@/components/JobFiles"), {
  loading: () => <LazyTabPanel title="Files" description="Loading job files..." />,
});
const CustomFields = dynamic(() => import("@/components/CustomFields"), {
  loading: () => <LazyTabPanel title="Custom Fields" description="Loading custom fields..." />,
});
const TasksTable = dynamic(() => import("@/components/TasksTable"), {
  loading: () => <LazyTabPanel title="Tasks" description="Loading tasks..." />,
});

type Job = {
  job_id: number;
  job_number: string | null;
  title: string | null;
  original_portfolio?: string | null;
  reporting_year: number | null;
  reporting_period_start: string | null;
  reporting_period_end: string | null;
  is_benchmark?: boolean | null;
  status: string | null;
  job_type?: string | null;
  job_family?: string | null;
  job_type_id?: number | null;
  job_template_id?: number | null;
  milestone_template_id?: number | null;
  client_db_id: number | null;
  client_name: string | null;
  crm_owner?: string | null;
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
  detail?: string;
};

type ImportConflict = {
  scope: string;
  original_id: string;
  report_label: string;
  existing_qty: number;
  upload_qty: number | null;
};

type TeamMember = {
  user_id: string;
  full_name: string;
  email?: string;
  role?: string;
  position?: string;
  status?: string;
};

type JobType = {
  job_type_id: number;
  name: string;
  is_active: boolean;
  is_crp?: boolean;
};

export default function JobDetailPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const params = useParams<{ jobId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const jobId = Number(params?.jobId);

  const [job, setJob] = useState<Job | null>(null);
  const [clientOwnerLabel, setClientOwnerLabel] = useState<string>("");
  const [clientBenchmarkPeriodLabel, setClientBenchmarkPeriodLabel] = useState<string>("");
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
  const [activeSetupSubtab, setActiveSetupSubtab] = useState<string>("setup-overview");

  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [scopeDatasetIds, setScopeDatasetIds] = useState<Record<ScopeKey, string>>({ ...EMPTY_SCOPE_MAP });
  const [scopeEffectiveDatasetIds, setScopeEffectiveDatasetIds] = useState<Record<ScopeKey, string>>({ ...EMPTY_SCOPE_MAP });
  const [additionalDatasetIds, setAdditionalDatasetIds] = useState<string[]>([]);
  const [scopeConfigMode, setScopeConfigMode] = useState<string>("legacy");
  const [scopeConfigWarnings, setScopeConfigWarnings] = useState<string[]>([]);
  const [scopeAutoResolution, setScopeAutoResolution] = useState<JobScopeAutoResolution | null>(null);
  const [showAdvancedDatasetConfig, setShowAdvancedDatasetConfig] = useState<boolean>(false);
  const [scopeConfigReloadToken, setScopeConfigReloadToken] = useState<number>(0);
  const [scopeCatalogCount, setScopeCatalogCount] = useState<number | null>(null);
  const [scopeCatalogStatus, setScopeCatalogStatus] = useState<string>("");

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadResult, setUploadResult] = useState<UploadValidationResult | null>(null);
  const [importConflicts, setImportConflicts] = useState<ImportConflict[]>([]);
  const [importConflictAcknowledged, setImportConflictAcknowledged] = useState(false);

  // Job details editing state
  const [jobTitle, setJobTitle] = useState<string>("");
  const [jobStatus, setJobStatus] = useState<string>("");
  const [jobType, setJobType] = useState<string>("");
  const [originalPortfolio, setOriginalPortfolio] = useState<string>("NZI");
  const [crmName, setCrmName] = useState<string>("");
  const [jobStartDate, setJobStartDate] = useState<string>("");
  const [jobEndDate, setJobEndDate] = useState<string>("");

  // Lookup data
  const [jobStatuses, setJobStatuses] = useState<Array<{status_id: number; name: string}>>([]);
  const [jobTypes, setJobTypes] = useState<JobType[]>([]);
  const [portfolios, setPortfolios] = useState<string[]>([]);
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
  const [loadingSetupMilestones, setLoadingSetupMilestones] = useState<boolean>(false);
  const scopeCardRef = useRef<JobScopeCardHandle>(null);
  const [loadingScopeConfig, setLoadingScopeConfig] = useState<boolean>(false);
  const [loadingReportMetadata, setLoadingReportMetadata] = useState<boolean>(false);

  // Training jobs have their own workspace — redirect immediately on load.
  useEffect(() => {
    if (job?.job_family === "training") {
      router.replace(`/jobs/${jobId}/training/overview`);
    }
  }, [job?.job_family, jobId, router]);

  const familyCustomFieldNames = useMemo(() => {
    switch (String(job?.job_family || "").toLowerCase()) {
      case "training":
        return ["training_course_name", "training_delivery_mode"];
      case "consultancy":
        return ["consultancy_service_focus"];
      case "lca":
        return ["lca_product_system_name"];
      case "pcf":
        return ["pcf_product_name"];
      default:
        return [];
    }
  }, [job?.job_family]);
  const familyLabel = formatJobFamilyLabel(job?.job_family);
  const familyDescription = getJobFamilyDescription(job?.job_family);
  const showFamilyDetails = familyCustomFieldNames.length > 0;

  const workspaceDataSetters = useMemo(
    () => ({
      setActiveTab,
      setJob,
      setClientOwnerLabel,
      setClientBenchmarkPeriodLabel,
      setSites,
      setSelectedSiteId,
      setLoading,
      setError,
      setTemplates,
      setSelectedTemplateId,
      setStatus,
      setJobStatuses,
      setJobTypes,
      setPortfolios,
      setTeamMembers,
      setReportingPeriodStart,
      setReportingPeriodEnd,
      setClientCurrency,
      setClientYearEndMonth,
      setJobTitle,
      setJobStatus,
      setJobType,
      setOriginalPortfolio,
      setCrmName,
      setJobStartDate,
      setJobEndDate,
      setTotalEmissions,
      setMilestoneTemplates,
      setMilestoneTemplateCompletions,
      setSelectedMilestoneTemplateId,
      setScopeConfigMode,
      setScopeConfigWarnings,
      setScopeAutoResolution: setScopeAutoResolution as unknown as React.Dispatch<React.SetStateAction<{ unresolved_scopes?: string[] | null; uses_legacy_fallback?: boolean | null; [key: string]: unknown } | null>>,
      setScopeEffectiveDatasetIds,
      setScopeDatasetIds,
      setAdditionalDatasetIds,
      setDatasets,
      setScopeCatalogCount,
      setScopeCatalogStatus,
      setLoadingSetupMilestones,
      setLoadingScopeConfig,
      setLoadingReportMetadata,
      setReportMetadataApiUnavailable,
      setReportMetadataFields,
      setReportMetadataValues,
      setReportMetadataEnergyFactors,
      setReportMetadataStatus,
    }),
    [
      setActiveTab,
      setJob,
      setClientOwnerLabel,
      setClientBenchmarkPeriodLabel,
      setSites,
      setSelectedSiteId,
      setLoading,
      setError,
      setTemplates,
      setSelectedTemplateId,
      setStatus,
      setJobStatuses,
      setJobTypes,
      setPortfolios,
      setTeamMembers,
      setReportingPeriodStart,
      setReportingPeriodEnd,
      setClientCurrency,
      setClientYearEndMonth,
      setJobTitle,
      setJobStatus,
      setJobType,
      setOriginalPortfolio,
      setCrmName,
      setJobStartDate,
      setJobEndDate,
      setTotalEmissions,
      setMilestoneTemplates,
      setMilestoneTemplateCompletions,
      setSelectedMilestoneTemplateId,
      setScopeConfigMode,
      setScopeConfigWarnings,
      setScopeAutoResolution,
      setScopeEffectiveDatasetIds,
      setScopeDatasetIds,
      setAdditionalDatasetIds,
      setDatasets,
      setScopeCatalogCount,
      setScopeCatalogStatus,
      setLoadingSetupMilestones,
      setLoadingScopeConfig,
      setLoadingReportMetadata,
      setReportMetadataApiUnavailable,
      setReportMetadataFields,
      setReportMetadataValues,
      setReportMetadataEnergyFactors,
      setReportMetadataStatus,
    ]
  );

  const {
    activeWorkspaceSubtab,
    benchmarkPeriodLabel,
    periodStartLabel,
    periodEndLabel,
    reportingPeriodLabel,
    periodEndMonthMismatch,
    workspaceJob,
    reportMetadataFieldsForSetup,
    reportMetadataFieldsBySection,
    consultantOptions,
    datasetOverrideSummary,
    primaryScopeDatasets,
    additionalAllocatedDatasets,
    manualFallbackDatasets,
    effectiveScopeDatasets,
  } = useJobWorkspaceDerivedState({
    jobId,
    job,
    jobTitle,
    jobStatus,
    clientOwnerLabel,
    crmName,
    clientBenchmarkPeriodLabel,
    reportingPeriodStart,
    reportingPeriodEnd,
    clientYearEndMonth,
    activeTab,
    activeSetupSubtab,
    reportMetadataFields,
    reportMetadataValues,
    setReportMetadataValues,
    reportMetadataEnergyFactors,
    teamMembers,
    datasets,
    scopeEffectiveDatasetIds,
    scopeDatasetIds,
    additionalDatasetIds,
    scopeAutoResolution,
    scopeConfigWarnings,
    scopeConfigMode,
    selectedMilestoneTemplateId,
  });

  useJobWorkspaceData({
    jobId,
    baseUrl,
    searchParams,
    activeTab,
    activeSetupSubtab,
    activeWorkspaceSubtab,
    showAdvancedDatasetConfig,
    datasetsLength: datasets.length,
    scopeConfigMode,
    scopeConfigReloadToken,
    milestoneTemplatesLength: milestoneTemplates.length,
    milestoneTemplateCompletionsLength: milestoneTemplateCompletions.length,
    reportMetadataFieldsLength: reportMetadataFields.length,
    selectedMilestoneTemplateId,
    job,
    jobTypes,
    jobType,
    setters: workspaceDataSetters,
  });
  const workspaceBreadcrumbs: WorkspaceBreadcrumb[] = [
    { label: "Clients", href: "/clients" },
    {
      label: workspaceJob.clientName,
      href: job?.client_db_id ? `/clients/${job.client_db_id}?section=jobs` : "/clients",
    },
    { label: "Jobs", href: "/jobs" },
    { label: workspaceJob.jobNumber, href: `/jobs/${jobId}` },
  ];

  function selectedSiteName(): string {
    if (selectedSiteId === "All") return "All";
    const sid = Number(selectedSiteId);
    const match = sites.find((s) => (s.site_id ?? -1) === sid);
    return (match?.site_name ?? "").trim() || "All";
  }

  function getMilestoneNames(): [string, string, string] {
    const templateId = job?.milestone_template_id;
    const defaults: [string, string, string] = ["Data Collection Due", "First Draft Due", "Final Report Due"];

    if (templateId) {
      const template = milestoneTemplates.find((t) => t.template_id === templateId);
      if (template?.items && template.items.length > 0) {
        return [
          template.items[0]?.milestone_name || defaults[0],
          template.items[1]?.milestone_name || defaults[1],
          template.items[2]?.milestone_name || defaults[2],
        ];
      }
    }

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
        key: `${selectedMilestoneTemplate?.template_id != null ? "template" : "manual"}-${index + 4}`,
        label: item.milestone_name || `Milestone ${index + 4}`,
        dueDate: dueDate.toISOString(),
        status: isCompleted ? "completed" : milestoneStatusFromDate(dueDate),
        completedAt: completion?.completed_at ?? null,
        completedBy: completion?.completed_by ?? null,
      };
    });
  }, [milestoneAnchorDate, selectedMilestoneTemplate, milestoneTemplateCompletionMap]);

  const workspaceActions = useJobWorkspaceActions({
    jobId,
    baseUrl,
    job,
    clientOwnerLabel,
    clientBenchmarkPeriodLabel,
    setJob,
    setBusy,
    setStatus,
    setUploadStatus,
    setUploadResult: setUploadResult as React.Dispatch<React.SetStateAction<unknown>>,
    setUploadProgress,
    setImportConflicts: setImportConflicts as unknown as React.Dispatch<React.SetStateAction<{ [key: string]: unknown }[]>>,
    setImportConflictAcknowledged,
    setReportMetadataStatus,
    setSavingReportMetadata,
    setReportMetadataApiUnavailable,
    setReportMetadataValues,
    setReportMetadataEnergyFactors: setReportMetadataEnergyFactors as React.Dispatch<React.SetStateAction<unknown>>,
    setScopeConfigMode,
    setScopeConfigWarnings,
    setScopeAutoResolution: setScopeAutoResolution as React.Dispatch<React.SetStateAction<unknown>>,
    setScopeEffectiveDatasetIds,
    setScopeDatasetIds,
    setAdditionalDatasetIds,
    setMilestoneTemplateCompletions,
    setSelectedTemplateId,
    jobTitle,
    jobStatus,
    jobType,
    originalPortfolio,
    crmName,
    jobStartDate,
    jobEndDate,
    reportMetadataFieldsForSetup,
    reportMetadataApiUnavailable,
    reportMetadataValues,
    scopeConfigMode,
    scopeDatasetIds,
    additionalDatasetIds,
    selectedSiteId,
    uploadFile,
    uploadResult,
    importConflictAcknowledged,
    reportingPeriodStart,
    reportingPeriodEnd,
    selectedMilestoneTemplateId,
  });

  const handleJobTemplateChange = useCallback(
    (value: string) => {
      setSelectedTemplateId(value);
      void workspaceActions.saveTemplate(value);
    },
    [workspaceActions, setSelectedTemplateId],
  );
  const templateSaveState: "saved" | "saving" | "unsaved" = (() => {
    if (!selectedTemplateId || Number(selectedTemplateId) <= 0) return "unsaved";
    if (busy && status.startsWith("Saving template")) return "saving";
    if (job?.job_template_id != null && Number(job.job_template_id) === Number(selectedTemplateId)) return "saved";
    return "unsaved";
  })();

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <JobWorkspaceHeader
          breadcrumbs={workspaceBreadcrumbs}
          jobId={jobId}
          baseUrl={baseUrl}
          job={workspaceJob}
        />

        {error ? <div className="mb-4 text-sm text-destructive">{error}</div> : null}
        {loading ? <div className="mb-4 text-sm text-muted-foreground">Loading...</div> : null}

        <JobReviewNotificationBar jobId={jobId} baseUrl={baseUrl} />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="mt-6">

          <TabsContent value="setup" className="mt-0">
            <div className="space-y-6">
              <div className="flex justify-end gap-2">
                <ActivityHistoryModal
                  jobId={jobId}
                  baseUrl={baseUrl}
                  entityType="job"
                  label="Job Setup History"
                />
                <ActivityHistoryModal
                  jobId={jobId}
                  baseUrl={baseUrl}
                  entityType="job_template_milestone_completion"
                  label="Milestone History"
                />
              </div>
              {loadingScopeConfig || loadingReportMetadata ? (
                <div className="text-sm text-muted-foreground">
                  Loading setup resources for the active section...
                </div>
              ) : null}
              <JobSetupOverviewSection
                hidden={false}
                baseUrl={baseUrl}
                jobId={jobId}
                busy={busy}
                status={status}
                selectedMilestoneTemplateId={selectedMilestoneTemplateId}
                jobTitle={jobTitle}
                jobStatus={jobStatus}
                jobType={jobType}
                jobFamily={job?.job_family ?? null}
                originalPortfolio={originalPortfolio}
                crmName={crmName}
                jobStartDate={jobStartDate}
                jobEndDate={jobEndDate}
                reportingPeriodStart={reportingPeriodStart}
                reportingPeriodEnd={reportingPeriodEnd}
                reportingPeriodDisplay={reportingPeriodLabel}
                benchmarkPeriodLabel={benchmarkPeriodLabel || undefined}
                periodEndMonthMismatch={periodEndMonthMismatch}
                milestoneTemplates={milestoneTemplates}
                jobStatuses={jobStatuses}
                jobTypes={jobTypes}
                portfolios={portfolios}
                teamMembers={teamMembers}
                onJobTitleChange={setJobTitle}
                onJobStatusChange={setJobStatus}
                onJobTypeChange={setJobType}
                onOriginalPortfolioChange={setOriginalPortfolio}
                onCrmNameChange={setCrmName}
                onMilestoneTemplateChange={setSelectedMilestoneTemplateId}
                onJobStartDateChange={setJobStartDate}
                onJobEndDateChange={setJobEndDate}
                onReportingPeriodStartChange={setReportingPeriodStart}
                onReportingPeriodEndChange={setReportingPeriodEnd}
                onSaveJobDetails={workspaceActions.saveJobDetails}
                onSaveReportingPeriod={workspaceActions.saveReportingPeriod}
                onApplyTemplate={() => scopeCardRef.current?.applyTemplate()}
              />

              {job?.job_family === "training" ? (
                <JobTraining
                  jobId={jobId}
                  clientId={job?.client_db_id ?? null}
                  baseUrl={baseUrl}
                  jobFamily={job?.job_family ?? null}
                />
              ) : job?.job_family === "consultancy" ? (
                <JobConsultancy jobId={jobId} baseUrl={baseUrl} jobFamily={job?.job_family ?? null} />
              ) : job?.job_family === "pcf" ? (
                <JobPcf jobId={jobId} baseUrl={baseUrl} jobFamily={job?.job_family ?? null} />
              ) : job?.job_family === "lca" ? (
                <JobLca jobId={jobId} baseUrl={baseUrl} jobFamily={job?.job_family ?? null} />
              ) : (
                <JobScopeCard
                  ref={scopeCardRef}
                  jobId={jobId}
                  jobTypeId={job?.job_type_id ?? null}
                  jobTypeName={job?.job_type ?? undefined}
                  jobFamily={job?.job_family ?? null}
                />
              )}

              {/* Project Milestones */}
              <JobProjectMilestonesSection
                hidden={!(job?.data_collection_due || job?.first_draft_due || job?.final_report_due || additionalMilestoneItems.length > 0)}
                loading={loadingSetupMilestones}
                milestoneNames={getMilestoneNames()}
                baseMilestones={{
                  dataCollection: job?.data_collection_due
                    ? {
                        dueDate: job.data_collection_due,
                        status: job.data_collection_status,
                        completedAt: job.data_collection_completed_at,
                        completedBy: job.data_collection_completed_by,
                      }
                    : undefined,
                  firstDraft: job?.first_draft_due
                    ? {
                        dueDate: job.first_draft_due,
                        status: job.first_draft_status,
                        completedAt: job.first_draft_completed_at,
                        completedBy: job.first_draft_completed_by,
                      }
                    : undefined,
                  finalReport: job?.final_report_due
                    ? {
                        dueDate: job.final_report_due,
                        status: job.final_report_status,
                        completedAt: job.final_report_completed_at,
                        completedBy: job.final_report_completed_by,
                      }
                    : undefined,
                }}
                additionalMilestoneItems={additionalMilestoneItems}
                additionalMilestonesEditable={additionalMilestonesEditable}
                currentJobId={currentJobId}
                onToggleBaseMilestone={workspaceActions.toggleMilestone}
                onToggleAdditionalMilestone={workspaceActions.toggleAdditionalMilestone}
              />




              {showFamilyDetails && (
                <Card id="family-details-section">
                  <CardHeader>
                    <CardTitle style={{ color: '#F26624' }}>Group Details</CardTitle>
                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${jobFamilyBadgeClassName(job?.job_family)}`}>
                        {familyLabel}
                      </span>
                      <span>{familyDescription}</span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-4">
                      These group-specific fields were captured at create time and can be edited here.
                    </p>
                    <CustomFields
                      entityId={jobId}
                      entityType="job"
                      baseUrl={baseUrl}
                      embedded
                      fieldNames={familyCustomFieldNames}
                      hideEmptyState
                    />
                  </CardContent>
                </Card>
              )}

              <Card id="custom-fields-section">
                <CardHeader>
                  <CardTitle style={{ color: '#F26624' }}>Custom Fields</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">
                    These custom fields are configured in Admin → Custom Fields. Required fields must be completed before
                    saving.
                  </p>
                  <CustomFields
                    entityId={jobId}
                    entityType="job"
                    baseUrl={baseUrl}
                    embedded
                    excludeFieldNames={familyCustomFieldNames}
                  />
                </CardContent>
              </Card>

              {/* Scope Dataset Configuration */}
              <JobScopeDatasetSection
                hidden={false}
                busy={busy}
                loadingScopeConfig={loadingScopeConfig}
                datasetOverrideSummary={datasetOverrideSummary}
                showAdvancedDatasetConfig={showAdvancedDatasetConfig}
                onToggleAdvanced={() => setShowAdvancedDatasetConfig((prev) => !prev)}
                scopeConfigMode={scopeConfigMode}
                scopeAutoResolution={scopeAutoResolution}
                scopeConfigWarnings={scopeConfigWarnings}
                primaryScopeDatasets={primaryScopeDatasets}
                additionalAllocatedDatasets={additionalAllocatedDatasets}
                manualFallbackDatasets={manualFallbackDatasets}
                effectiveScopeDatasets={effectiveScopeDatasets}
                scopeCatalogStatus={scopeCatalogStatus}
                scopeCatalogCount={scopeCatalogCount}
                datasets={datasets}
                additionalDatasetIds={additionalDatasetIds}
                scopeDatasetIds={scopeDatasetIds}
                onToggleAdditionalDataset={(datasetId) => {
                  setAdditionalDatasetIds((prev) =>
                    prev.includes(datasetId) ? prev.filter((x) => x !== datasetId) : [...prev, datasetId]
                  );
                  setStatus("");
                }}
                onRemoveAdditionalDataset={(datasetId) => {
                  setAdditionalDatasetIds((prev) => prev.filter((x) => x !== datasetId));
                  setStatus("");
                }}
                onScopeDatasetChange={(scope, datasetId) => {
                  setScopeDatasetIds((prev) => ({ ...prev, [scope]: datasetId }));
                  setStatus("");
                }}
                onReloadCatalog={() => setScopeConfigReloadToken((prev) => prev + 1)}
                onSaveScopeDatasets={workspaceActions.saveScopeDatasets}
              />

              {/* Intensity Metrics */}
              <div>
                <IntensityMetrics
                  jobId={jobId}
                  baseUrl={baseUrl}
                  totalEmissions={totalEmissions}
                  currency={clientCurrency}
                />
              </div>


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
            title="Business Travel Data Upload"
            description="Download the business travel workbook, compare prior-year factors, and import completed rows into Data Entry."
            jobNumber={job?.job_number}
            clientName={job?.client_name}
            reportingYear={job?.reporting_year}
          />
          </TabsContent>

          <TabsContent value="upload" className="mt-0">
            <JobUploadSection
              hidden={false}
              busy={busy}
              selectedSiteId={selectedSiteId}
              selectedSiteName={selectedSiteName()}
              sites={sites}
              templates={templates}
              selectedTemplateId={selectedTemplateId}
              includePrevYear={includePrevYear}
              templateStatus={status}
              templateSaveState={templateSaveState}
              onJobTemplateChange={handleJobTemplateChange}
              onSaveTemplate={workspaceActions.saveTemplate}
              onDownloadTemplate={() =>
                void workspaceActions.downloadTemplate(
                  selectedTemplateId,
                  selectedSiteName(),
                  includePrevYear,
                  periodStartLabel,
                  periodEndLabel,
                  workspaceJob.jobNumber,
                  workspaceJob.clientName
                )
              }
              onIncludePrevYearChange={setIncludePrevYear}
              uploadFile={uploadFile}
              uploadStatus={uploadStatus}
              uploadProgress={uploadProgress}
              uploadResult={uploadResult}
              importConflicts={importConflicts}
              selectedRowsCount={uploadResult?.rows_ready?.length ?? 0}
              canImport={selectedSiteId !== "All"}
              onSelectedSiteChange={setSelectedSiteId}
              onUploadFileChange={(file) => {
                setUploadFile(file);
                setUploadResult(null);
                setUploadStatus("");
                setImportConflicts([]);
                setImportConflictAcknowledged(false);
              }}
              onValidateUpload={workspaceActions.validateUpload}
              onClearConflicts={() => setImportConflicts([])}
              onOverwriteAndImport={() => {
                setImportConflictAcknowledged(true);
                setImportConflicts([]);
                void workspaceActions.importValidatedRows(true);
              }}
              onImportValidatedRows={() => void workspaceActions.importValidatedRows()}
            />
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
              <SpendDataCollection jobId={jobId} baseUrl={baseUrl} />
            </div>
          </TabsContent>

          <TabsContent value="notes" className="mt-0">
            <JobNotesSummary jobId={jobId} baseUrl={baseUrl} />
          </TabsContent>

          <TabsContent value="job-tasks" className="mt-0">
            {job?.client_db_id ? (
              <TasksTable clientId={job.client_db_id} jobId={jobId} baseUrl={baseUrl} title="Job Tasks" />
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                Tasks require a client to be linked to this job.
              </div>
            )}
          </TabsContent>

          <TabsContent value="data-output" className="mt-0">
            <DataOutput jobId={jobId} baseUrl={baseUrl} />
          </TabsContent>

          <TabsContent value="actions" className="mt-0">
            <JobActions
              jobId={jobId}
              baseUrl={baseUrl}
              onOpenReportNew={() => setActiveTab("report-new")}
              isActive={activeTab === "actions"}
            />
          </TabsContent>

          <TabsContent value="report-new" className="mt-0">
            <JobReportNew
              jobId={jobId}
              baseUrl={baseUrl}
              onOpenActions={() => setActiveTab("actions")}
              isActive={activeTab === "report-new"}
            />
          </TabsContent>

          <TabsContent value="lca" className="mt-0">
            <JobLca jobId={jobId} baseUrl={baseUrl} jobFamily={job?.job_family ?? null} />
          </TabsContent>

          <JobCommunicationsTabs
            jobId={jobId}
            baseUrl={baseUrl}
            clientDbId={job?.client_db_id ?? null}
          />

          <JobFinancialTabs
            jobId={jobId}
            clientId={job?.client_db_id ?? null}
            jobNumber={job?.job_number ?? null}
            baseUrl={baseUrl}
          />

          <TabsContent value="files" className="mt-0">
            <JobFiles jobId={jobId} baseUrl={baseUrl} />
          </TabsContent>

          <TabsContent value="time" className="mt-0">
            <JobTimeEntries jobId={jobId} baseUrl={baseUrl} />
          </TabsContent>

          </div>
        </Tabs>
      </div>
    </div>
  );
}
