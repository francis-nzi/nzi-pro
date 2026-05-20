import { useEffect, useMemo } from "react";

import { calculateDerivedEnergyEmissionFields, type EnergyEmissionFactorDetails } from "@/lib/report-metadata";
import {
  JOB_SETUP_METADATA_KEY_ORDER,
  JOB_SETUP_METADATA_KEYS,
  JOB_TAB_TO_GROUP,
  JOB_WORKSPACE_GROUPS,
  SCOPE_KEYS,
  formatDisplayDate,
  type ReportMetadataField,
  type ScopeKey,
} from "@/lib/job-workspace";

type JobLike = {
  job_number?: string | null;
  title?: string | null;
  client_name?: string | null;
  crm_owner?: string | null;
  crm_name?: string | null;
  reporting_year?: number | null;
  status?: string | null;
  reporting_period_start?: string | null;
  reporting_period_end?: string | null;
};

type TeamMember = {
  user_id?: string | null;
  full_name: string | null;
  status?: string | null;
  position?: string | null;
  role?: string | null;
};


type Dataset = {
  dataset_id: number | string;
  name?: string | null;
  country?: string | null;
  year?: number | string | null;
  analysis_type?: string | null;
};

type JobScopeAutoResolution = {
  unresolved_scopes?: string[] | null;
  uses_legacy_fallback?: boolean | null;
};

type DerivedDeps = {
  jobId: number;
  job: JobLike | null;
  jobTitle: string;
  jobStatus: string;
  clientOwnerLabel: string;
  crmName: string;
  clientBenchmarkPeriodLabel: string;
  reportingPeriodStart: string;
  reportingPeriodEnd: string;
  clientYearEndMonth: string;
  activeTab: string;
  activeSetupSubtab: string;
  reportMetadataFields: ReportMetadataField[];
  reportMetadataValues: Record<string, string>;
  setReportMetadataValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  reportMetadataEnergyFactors: unknown;
  teamMembers: TeamMember[];
  datasets: Dataset[];
  scopeEffectiveDatasetIds: Record<ScopeKey, string>;
  scopeDatasetIds: Record<ScopeKey, string>;
  additionalDatasetIds: string[];
  scopeAutoResolution: JobScopeAutoResolution | null;
  scopeConfigWarnings: string[];
  scopeConfigMode: string;
  selectedMilestoneTemplateId: string;
};

function parseClientYearEndMonthToNumber(value: string): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  const monthNames = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const idx = monthNames.findIndex((m) => m === trimmed.toLowerCase());
  if (idx >= 0) return idx + 1;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 1 && n <= 12 ? n : null;
}

function parseDateMonthToNumber(dateStr: string): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : d.getMonth() + 1;
}

function sortReportFields(fields: ReportMetadataField[]) {
  const filtered = fields.filter((field) =>
    JOB_SETUP_METADATA_KEY_ORDER.has(field.key as (typeof JOB_SETUP_METADATA_KEYS)[number])
  );

  return filtered.sort(
    (a, b) =>
      (JOB_SETUP_METADATA_KEY_ORDER.get(a.key as (typeof JOB_SETUP_METADATA_KEYS)[number]) ?? 999) -
      (JOB_SETUP_METADATA_KEY_ORDER.get(b.key as (typeof JOB_SETUP_METADATA_KEYS)[number]) ?? 999)
  );
}

function groupFieldsBySection(fields: ReportMetadataField[]) {
  const grouped: Record<string, ReportMetadataField[]> = {};
  fields.forEach((field) => {
    const section = field.section || "General";
    if (!grouped[section]) grouped[section] = [];
    grouped[section].push(field);
  });
  return grouped;
}

function summarizeDatasets(
  datasets: Dataset[],
  scopeIds: Record<ScopeKey, string>,
  prefix: string
) {
  return SCOPE_KEYS.map((scope) => {
    const dsId = scopeIds[scope];
    const dataset =
      dsId && dsId !== "__none__" ? datasets.find((entry) => String(entry.dataset_id) === dsId) : null;
    if (!dataset) return null;
    const detailBits = [
      dataset.country?.trim() || null,
      dataset.year ? String(dataset.year) : null,
      dataset.analysis_type?.trim() || null,
    ].filter(Boolean);
    return {
      key: `${prefix}-${scope}-${dataset.dataset_id}`,
      label: scope,
      title: dataset.name?.trim() || `Dataset ${dataset.dataset_id}`,
      detail: detailBits.join(" | "),
    };
  }).filter(Boolean) as Array<{
    key: string;
    label: ScopeKey;
    title: string;
    detail: string;
  }>;
}

export default function useJobWorkspaceDerivedState({
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
}: DerivedDeps) {
  const statusLabel = (jobStatus || job?.status || "Draft").trim() || "Draft";
  const ownerLabel = (clientOwnerLabel || job?.crm_owner || "Unassigned").trim() || "Unassigned";
  const jobNumberLabel = job?.job_number?.trim() ? `Job No: ${job.job_number.trim()}` : `Job ${jobId}`;
  const jobTitleLabel = (jobTitle || job?.title || "").trim();
  const clientLabel = (job?.client_name || "Client").trim() || "Client";
  const benchmarkPeriodLabel = clientBenchmarkPeriodLabel.trim();
  const periodStartLabel = reportingPeriodStart || job?.reporting_period_start || "";
  const periodEndLabel = reportingPeriodEnd || job?.reporting_period_end || "";
  const reportingPeriodLabel =
    periodStartLabel && periodEndLabel
      ? `Reporting Period: ${formatDisplayDate(periodStartLabel)} - ${formatDisplayDate(periodEndLabel)}`
      : periodEndLabel
        ? `Year ${new Date(periodEndLabel).getFullYear()}`
        : job?.reporting_year
          ? `Year ${job.reporting_year}`
          : "Reporting period not set";

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
        key: "milestones",
        label: "Milestones",
        complete: Boolean(selectedMilestoneTemplateId && selectedMilestoneTemplateId !== "__none__"),
      },
    ],
    [jobTitle, jobStatus, periodStartLabel, periodEndLabel, selectedMilestoneTemplateId]
  );

  const setupCompletedCount = setupSteps.filter((step) => step.complete).length;
  const setupTotalCount = setupSteps.length;
  const isSetupComplete = setupTotalCount > 0 && setupCompletedCount >= setupTotalCount;
  const setupCompletionLabel = `Setup ${setupCompletedCount}/${setupTotalCount} complete`;
  const setupCompletionBadgeClassName = isSetupComplete
    ? "border-green-200 bg-green-50 text-green-800"
    : "border-red-200 bg-red-50 text-red-800";

  const activeWorkspaceGroup = JOB_TAB_TO_GROUP[activeTab] ?? "setup";
  const activeWorkspaceGroupConfig =
    JOB_WORKSPACE_GROUPS.find((group) => group.key === activeWorkspaceGroup) ?? JOB_WORKSPACE_GROUPS[0];
  const activeWorkspaceSubtabs = activeWorkspaceGroupConfig.subtabs;
  const activeWorkspaceSubtab =
    activeWorkspaceGroup === "setup" ? activeSetupSubtab : String(activeTab);

  const clientYearEndMonthNumber = parseClientYearEndMonthToNumber(clientYearEndMonth);
  const reportingPeriodEndMonthNumber = parseDateMonthToNumber(reportingPeriodEnd);
  const periodEndMonthMismatch =
    clientYearEndMonthNumber != null &&
    reportingPeriodEndMonthNumber != null &&
    clientYearEndMonthNumber !== reportingPeriodEndMonthNumber;

  const reportMetadataFieldsForSetup = useMemo(() => sortReportFields(reportMetadataFields), [reportMetadataFields]);

  const reportMetadataFieldsBySection = useMemo(
    () => groupFieldsBySection(reportMetadataFieldsForSetup),
    [reportMetadataFieldsForSetup]
  );

  const activeTeamMembers = useMemo(
    () => teamMembers.filter((m) => String(m.status ?? "").toLowerCase() === "active"),
    [teamMembers]
  );

  const selectedConsultantName = (reportMetadataValues["consultant_name"] ?? "").trim();
  const matchedConsultant = useMemo(() => {
    if (!selectedConsultantName) return null;
    const nameLc = selectedConsultantName.toLowerCase();
    return activeTeamMembers.find((m) => (m.full_name ?? "").trim().toLowerCase() === nameLc) ?? null;
  }, [activeTeamMembers, selectedConsultantName]);

  const consultantOptions = useMemo(() => {
    const byName = new Map<string, TeamMember>();
    activeTeamMembers.forEach((member) => {
      const name = (member.full_name ?? "").trim();
      if (!name) return;
      if (!byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), member);
    });
    // Always include the currently saved consultant even if their role has changed.
    if (selectedConsultantName) {
      const nameLc = selectedConsultantName.toLowerCase();
      if (!byName.has(nameLc)) {
        const existing = activeTeamMembers.find((m) => (m.full_name ?? "").trim().toLowerCase() === nameLc);
        if (existing) byName.set(nameLc, existing);
      }
    }
    return Array.from(byName.values()).sort((a, b) => String(a.full_name ?? "").localeCompare(String(b.full_name ?? "")));
  }, [activeTeamMembers, selectedConsultantName]);

  const derivedEnergyMetadataValues = useMemo(
    () => calculateDerivedEnergyEmissionFields(reportMetadataValues, reportMetadataEnergyFactors as EnergyEmissionFactorDetails | null),
    [reportMetadataValues, reportMetadataEnergyFactors]
  );

  useEffect(() => {
    if (!matchedConsultant) return;
    const nextPosition = (matchedConsultant.position ?? "").trim();
    setReportMetadataValues((prev) => {
      if ((prev["consultant_position"] ?? "") === nextPosition) return prev;
      return { ...prev, consultant_position: nextPosition };
    });
  }, [matchedConsultant, setReportMetadataValues]);

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
  }, [derivedEnergyMetadataValues, setReportMetadataValues]);

  const unresolvedScopeCount = scopeAutoResolution?.unresolved_scopes?.length ?? 0;
  const selectedFallbackDatasetCount = useMemo(
    () =>
      SCOPE_KEYS.filter((scope) => {
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
        .join(" | ")
    : "Automatic dataset resolution is active. Additional job datasets are hidden unless needed.";

  const primaryScopeDatasets = useMemo(
    () => summarizeDatasets(datasets, scopeEffectiveDatasetIds, "primary"),
    [datasets, scopeEffectiveDatasetIds]
  );

  const additionalAllocatedDatasets = useMemo(
    () =>
      additionalDatasetIds
        .map((id) => datasets.find((entry) => String(entry.dataset_id) === id))
        .filter((dataset): dataset is Dataset => Boolean(dataset))
        .map((dataset) => {
          const detailBits = [
            dataset.country?.trim() || null,
            dataset.year ? String(dataset.year) : null,
            dataset.analysis_type?.trim() || null,
          ].filter(Boolean);
          return {
            key: `additional-${dataset.dataset_id}`,
            title: dataset.name?.trim() || `Dataset ${dataset.dataset_id}`,
            detail: detailBits.join(" | "),
          };
        })
        .sort((a, b) => a.title.localeCompare(b.title)),
    [additionalDatasetIds, datasets]
  );

  const manualFallbackDatasets = useMemo(
    () => summarizeDatasets(datasets, scopeDatasetIds, "fallback"),
    [datasets, scopeDatasetIds]
  );

  const effectiveScopeDatasets = useMemo(
    () =>
      SCOPE_KEYS.map((scope) => {
        const dsId = scopeEffectiveDatasetIds[scope];
        const dataset =
          dsId && dsId !== "__none__" ? datasets.find((entry) => String(entry.dataset_id) === dsId) : null;
        return {
          scope,
          datasetId: dsId,
          title: dataset?.name?.trim() || (dataset ? `Dataset ${dataset.dataset_id}` : "Not resolved"),
        };
      }),
    [datasets, scopeEffectiveDatasetIds]
  );

  return {
    activeWorkspaceGroup,
    activeWorkspaceGroupConfig,
    activeWorkspaceSubtabs,
    activeWorkspaceSubtab,
    statusLabel,
    ownerLabel,
    jobNumberLabel,
    jobTitleLabel,
    clientLabel,
    benchmarkPeriodLabel,
    periodStartLabel,
    periodEndLabel,
    reportingPeriodLabel,
    clientYearEndMonthNumber,
    reportingPeriodEndMonthNumber,
    periodEndMonthMismatch,
    reportMetadataFieldsForSetup,
    reportMetadataFieldsBySection,
    activeTeamMembers,
    matchedConsultant,
    consultantOptions,
    derivedEnergyMetadataValues,
    selectedFallbackDatasetCount,
    datasetOverridesNeedAttention,
    datasetOverrideSummary,
    primaryScopeDatasets,
    additionalAllocatedDatasets,
    manualFallbackDatasets,
    effectiveScopeDatasets,
    setupSteps,
    setupCompletedCount,
    setupTotalCount,
    isSetupComplete,
    setupCompletionLabel,
    setupCompletionBadgeClassName,
    workspaceJob: {
      jobId,
      jobNumber: jobNumberLabel,
      jobTitle: jobTitleLabel || "Job",
      clientName: clientLabel,
      benchmarkPeriodLabel: benchmarkPeriodLabel || undefined,
      reportingPeriodLabel,
      statusLabel,
      ownerLabel,
      crmLabel: crmName.trim() || job?.crm_name || undefined,
      setupCompletionLabel,
      setupCompletionClassName: setupCompletionBadgeClassName,
    },
  };
}
