import { useEffect } from "react";

import { primeJobShellData } from "@/lib/job-shell-data";
import { withAuditHeaders } from "@/lib/auth-client";
import {
  JOB_SETUP_METADATA_FALLBACK_FIELDS,
  JOB_SETUP_METADATA_KEY_ORDER,
  JOB_SETUP_METADATA_KEYS,
  calculateReportingPeriod,
  buildMetadataFieldValues,
  formatDisplayDate,
  scopeMapFromItems,
  type JobScopeConfigItem,
  type ReportMetadataField,
} from "@/lib/job-workspace";

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

type WorkspaceJob = {
  job_id: number;
  job_number: string | null;
  title: string | null;
  reporting_year: number | null;
  reporting_period_start: string | null;
  reporting_period_end: string | null;
  status: string | null;
  job_template_id?: number | null;
  milestone_template_id?: number | null;
  client_db_id: number | null;
  client_name?: string | null;
  crm_owner?: string | null;
  crm_name?: string | null;
  job_type_id?: number | null;
  job_type?: string | null;
  original_portfolio?: string | null;
  start_date?: string | null;
  due_date?: string | null;
};

type JobTemplate = {
  template_id: number;
  is_default?: boolean | null;
  items?: Array<{
    milestone_name?: string | null;
    days_offset?: number | string | null;
    item_id?: number | string | null;
  }>;
};

type MilestoneTemplate = {
  template_id: number;
  is_default?: boolean | null;
  items?: Array<{
    milestone_name?: string | null;
    days_offset?: number | string | null;
    item_id?: number | string | null;
  }>;
};

type MilestoneTemplateCompletion = {
  item_id?: number | string | null;
  is_complete?: boolean | null;
  completed_at?: string | null;
  completed_by?: string | null;
};

type JobType = {
  job_type_id: number;
  name: string;
  is_active?: boolean | null;
};

type JobSitesResponse = {
  sites?: Array<{ site_id?: number | null; site_name?: string | null }>;
};

type JobTemplatesResponse = {
  items?: JobTemplate[];
};

type MilestoneTemplatesResponse = {
  templates?: MilestoneTemplate[];
};

type MilestoneTemplateCompletionsResponse = {
  items?: MilestoneTemplateCompletion[];
};

type DatasetsResponse = {
  items?: Array<Record<string, unknown>>;
};

type JobScopeConfigResponse = {
  mode?: string;
  warnings?: string[];
  auto_resolution?: { unresolved_scopes?: string[]; uses_legacy_fallback?: boolean } | null;
  items?: JobScopeConfigItem[];
  legacy_items?: JobScopeConfigItem[];
  additional_dataset_ids?: Array<string | number | null>;
};

type JobWorkspaceDataEffectArgs = {
  jobId: number;
  baseUrl: string;
  searchParams: { get(name: string): string | null };
  activeTab: string;
  activeSetupSubtab: string;
  activeWorkspaceSubtab: string;
  showAdvancedDatasetConfig: boolean;
  datasetsLength: number;
  scopeConfigMode: string;
  scopeConfigReloadToken: number;
  milestoneTemplatesLength: number;
  milestoneTemplateCompletionsLength: number;
  reportMetadataFieldsLength: number;
  selectedMilestoneTemplateId: string;
  job: WorkspaceJob | null;
  jobTypes: JobType[];
  jobType: string;
  setters: {
    setActiveTab: Setter<string>;
    setJob: Setter<WorkspaceJob | null>;
    setClientOwnerLabel: Setter<string>;
    setClientBenchmarkPeriodLabel: Setter<string>;
    setSites: Setter<JobSitesResponse["sites"]>;
    setSelectedSiteId: Setter<string>;
    setLoading: Setter<boolean>;
    setError: Setter<string>;
    setTemplates: Setter<JobTemplate[]>;
    setSelectedTemplateId: Setter<string>;
    setStatus: Setter<string>;
    setJobStatuses: Setter<Array<{ status_id: number; name: string }>>;
    setJobTypes: Setter<JobType[]>;
    setPortfolios: Setter<string[]>;
    setTeamMembers: Setter<Array<{ full_name?: string | null; position?: string | null; status?: string | null }>>;
    setReportingPeriodStart: Setter<string>;
    setReportingPeriodEnd: Setter<string>;
    setClientCurrency: Setter<string>;
    setClientYearEndMonth: Setter<string>;
    setJobTitle: Setter<string>;
    setJobStatus: Setter<string>;
    setJobType: Setter<string>;
    setOriginalPortfolio: Setter<string>;
    setCrmName: Setter<string>;
    setJobStartDate: Setter<string>;
    setJobEndDate: Setter<string>;
    setTotalEmissions: Setter<number>;
    setMilestoneTemplates: Setter<MilestoneTemplate[]>;
    setMilestoneTemplateCompletions: Setter<MilestoneTemplateCompletion[]>;
    setSelectedMilestoneTemplateId: Setter<string>;
    setScopeConfigMode: Setter<string>;
    setScopeConfigWarnings: Setter<string[]>;
    setScopeAutoResolution: Setter<JobScopeConfigResponse["auto_resolution"] | null>;
    setScopeEffectiveDatasetIds: Setter<Record<string, string>>;
    setScopeDatasetIds: Setter<Record<string, string>>;
    setAdditionalDatasetIds: Setter<string[]>;
    setDatasets: Setter<Array<Record<string, unknown>>>;
    setScopeCatalogCount: Setter<number | null>;
    setScopeCatalogStatus: Setter<string>;
    setLoadingSetupMilestones: Setter<boolean>;
    setLoadingScopeConfig: Setter<boolean>;
    setLoadingReportMetadata: Setter<boolean>;
    setReportMetadataApiUnavailable: Setter<boolean>;
    setReportMetadataFields: Setter<ReportMetadataField[]>;
    setReportMetadataValues: Setter<Record<string, string>>;
    setReportMetadataEnergyFactors: Setter<unknown>;
    setReportMetadataStatus: Setter<string>;
  };
};

function normalizeTeamMembers(
  items: Array<{ full_name?: string | null; position?: string | null; status?: string | null }>
) {
  return Array.isArray(items) ? items : [];
}

export default function useJobWorkspaceData({
  jobId,
  baseUrl,
  searchParams,
  activeTab,
  activeSetupSubtab,
  activeWorkspaceSubtab,
  showAdvancedDatasetConfig,
  datasetsLength,
  scopeConfigMode,
  scopeConfigReloadToken,
  milestoneTemplatesLength,
  milestoneTemplateCompletionsLength,
  reportMetadataFieldsLength,
  selectedMilestoneTemplateId,
  job,
  jobTypes,
  jobType,
  setters,
}: JobWorkspaceDataEffectArgs) {
  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (!tabParam) return;
    if (tabParam === activeTab) return;
    if (tabParam === "setup" || tabParam === "data-entry" || tabParam === "upload") {
      setters.setActiveTab(tabParam);
      return;
    }
    setters.setActiveTab(tabParam);
  }, [activeTab, searchParams, setters]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!Number.isFinite(jobId) || jobId <= 0) {
        setters.setError("Invalid job id");
        return;
      }

      setters.setLoading(true);
      setters.setError("");

      try {
        const [jRes, sRes, tRes, statusRes, teamRes] = await Promise.all([
          fetch(`${baseUrl}/jobs/${jobId}`),
          fetch(`${baseUrl}/jobs/${jobId}/sites`),
          fetch(`${baseUrl}/job-templates`),
          fetch(`${baseUrl}/admin/lookups/job_statuses_lookup`),
          fetch(`${baseUrl}/admin/users`),
        ]);

        if (!jRes.ok) {
          const t = await jRes.text().catch(() => "");
          throw new Error(`Failed to load job: ${jRes.status} ${jRes.statusText}${t ? ` - ${t}` : ""}`);
        }

        const jJson = (await jRes.json()) as WorkspaceJob;
        const sJson = sRes.ok ? ((await sRes.json()) as JobSitesResponse) : null;
        const tJson = tRes.ok ? ((await tRes.json()) as JobTemplatesResponse) : null;
        const statusJson = statusRes.ok ? await statusRes.json() : null;
        const teamJson = teamRes.ok ? await teamRes.json() : null;
        let nextClientOwnerLabel = "";
        let nextClientBenchmarkPeriodLabel = "";

        if (cancelled) return;

        setters.setJob(jJson);
        setters.setClientOwnerLabel("");
        setters.setClientBenchmarkPeriodLabel("");
        setters.setJobTitle(jJson.title || "");
        setters.setJobStatus(jJson.status || "Draft");
        setters.setJobType(jJson.job_type || "");
        setters.setOriginalPortfolio(jJson.original_portfolio || "NZI");
        setters.setCrmName(jJson.crm_name || "");
        setters.setJobStartDate(jJson.start_date || "");
        setters.setJobEndDate(jJson.due_date || "");

        if (jJson.client_db_id) {
          const clientRes = await fetch(`${baseUrl}/clients/${jJson.client_db_id}`);
          if (clientRes.ok) {
            const clientJson = await clientRes.json();

            if (clientJson.crm_owner) {
              nextClientOwnerLabel = String(clientJson.crm_owner).trim();
            }
            if (clientJson.benchmark_period_start && clientJson.benchmark_period_end) {
              const start = formatDisplayDate(clientJson.benchmark_period_start);
              const end = formatDisplayDate(clientJson.benchmark_period_end);
              if (start && end) {
                nextClientBenchmarkPeriodLabel = `${start} - ${end}`;
              }
            }
            setters.setClientOwnerLabel(nextClientOwnerLabel);
            setters.setClientBenchmarkPeriodLabel(nextClientBenchmarkPeriodLabel);
            setters.setClientCurrency(String(clientJson.currency || "GBP"));
            setters.setClientYearEndMonth(String(clientJson.year_end_month || ""));

            if (!jJson.reporting_period_start && clientJson.year_end_month && clientJson.benchmark_year && jJson.reporting_year) {
              const calculated = calculateReportingPeriod(
                clientJson.year_end_month,
                clientJson.benchmark_year,
                jJson.reporting_year
              );
              if (calculated) {
                setters.setReportingPeriodStart(calculated.start);
                setters.setReportingPeriodEnd(calculated.end);
              }
            }
          }
        }

        if (jJson.reporting_period_start) {
          setters.setReportingPeriodStart(jJson.reporting_period_start);
          setters.setReportingPeriodEnd(jJson.reporting_period_end || "");
        }

        primeJobShellData(baseUrl, jobId, {
          job: {
            job_id: jJson.job_id,
            job_number: jJson.job_number,
            title: jJson.title,
            reporting_year: jJson.reporting_year,
            reporting_period_start: jJson.reporting_period_start,
            reporting_period_end: jJson.reporting_period_end,
            status: jJson.status,
            job_template_id: jJson.job_template_id,
            milestone_template_id: jJson.milestone_template_id,
            client_db_id: jJson.client_db_id,
            client_name: jJson.client_name,
            crm_owner: jJson.crm_owner,
            crm_name: jJson.crm_name,
          },
          clientOwnerLabel: nextClientOwnerLabel,
          clientBenchmarkPeriodLabel: nextClientBenchmarkPeriodLabel,
        });

        const totalsRes = await fetch(`${baseUrl}/jobs/${jobId}/scope-totals`);
        if (totalsRes.ok) {
          const totalsData = await totalsRes.json();
          setters.setTotalEmissions(totalsData.total || 0);
        }

        const tItems = tJson?.items ?? [];
        setters.setTemplates(tItems);
        const jt = jJson.job_template_id;
        setters.setSelectedTemplateId(jt != null ? String(jt) : "");

        const s = sJson?.sites ?? [];
        setters.setSites(s);
        const firstId = s.find((x) => x.site_id != null)?.site_id;
        setters.setSelectedSiteId(firstId != null ? String(firstId) : "All");

        if (statusJson?.items) setters.setJobStatuses(statusJson.items);
        if (teamJson?.items) setters.setTeamMembers(normalizeTeamMembers(teamJson.items));

        if (jJson.milestone_template_id) {
          setters.setSelectedMilestoneTemplateId(String(jJson.milestone_template_id));
        }
      } catch (e) {
        if (cancelled) return;
        setters.setError((e as Error).message);
        setters.setJob(null);
        setters.setSites([]);
      } finally {
        if (!cancelled) setters.setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [baseUrl, jobId, setters, searchParams, activeTab]);

  useEffect(() => {
    let cancelled = false;

    async function loadJobTypes() {
      try {
        const res = await fetch(`${baseUrl}/admin/lookups/job_types`, {
          credentials: "include",
        });
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        setters.setJobTypes(
          Array.isArray(json.items) ? (json.items as JobType[]).filter((jt) => jt.is_active) : []
        );
      } catch {
        if (!cancelled) setters.setJobTypes([]);
      }
    }

    void loadJobTypes();

    return () => {
      cancelled = true;
    };
  }, [baseUrl, setters]);

  useEffect(() => {
    let cancelled = false;

    async function loadPortfolios() {
      try {
        const res = await fetch(`${baseUrl}/admin/lookups/portfolios_lookup`, {
          credentials: "include",
        });
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        const items = Array.isArray(json.items) ? (json.items as Array<{ name?: string | null }>) : [];
        const portfolioItems = items
          .map((item) => String(item.name || "").trim())
          .filter((item): item is string => Boolean(item));
        setters.setPortfolios(Array.from(new Set<string>(portfolioItems)).sort((a, b) => a.localeCompare(b)));
      } catch {
        if (!cancelled) setters.setPortfolios([]);
      }
    }

    void loadPortfolios();

    return () => {
      cancelled = true;
    };
  }, [baseUrl, setters]);

  useEffect(() => {
    if (jobType) return;
    if (!job?.job_type_id || jobTypes.length === 0) return;
    const matched = jobTypes.find((jt) => jt.job_type_id === job.job_type_id);
    if (matched?.name) {
      setters.setJobType(matched.name);
    }
  }, [job?.job_type_id, jobType, jobTypes, setters]);

  useEffect(() => {
    let cancelled = false;

    async function loadMilestoneResources() {
      if (activeWorkspaceSubtab !== "setup-overview" || !Number.isFinite(jobId) || jobId <= 0) return;
      if (milestoneTemplatesLength > 0 && milestoneTemplateCompletionsLength > 0) return;

      setters.setLoadingSetupMilestones(true);
      try {
        const [mtRes, mcRes] = await Promise.all([
          fetch(`${baseUrl}/milestone-templates`),
          fetch(`${baseUrl}/jobs/${jobId}/milestone-template-completions`),
        ]);
        if (cancelled) return;
        if (mtRes.ok) {
          const mtJson = (await mtRes.json()) as MilestoneTemplatesResponse;
          setters.setMilestoneTemplates(Array.isArray(mtJson.templates) ? mtJson.templates : []);
          if (!selectedMilestoneTemplateId) {
            if (job?.milestone_template_id) {
              setters.setSelectedMilestoneTemplateId(String(job.milestone_template_id));
            } else {
              const defaultTemplate = mtJson.templates?.find((t) => t.is_default);
              if (defaultTemplate) {
                setters.setSelectedMilestoneTemplateId(String(defaultTemplate.template_id));
              }
            }
          }
        }
        if (mcRes.ok) {
          const mcJson = (await mcRes.json()) as MilestoneTemplateCompletionsResponse;
          setters.setMilestoneTemplateCompletions(Array.isArray(mcJson.items) ? mcJson.items : []);
        }
      } finally {
        if (!cancelled) setters.setLoadingSetupMilestones(false);
      }
    }

    void loadMilestoneResources();

    return () => {
      cancelled = true;
    };
  }, [
    activeWorkspaceSubtab,
    baseUrl,
    job?.milestone_template_id,
    jobId,
    milestoneTemplatesLength,
    milestoneTemplateCompletionsLength,
    selectedMilestoneTemplateId,
    setters,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function loadScopeConfigResources() {
      if (activeWorkspaceSubtab !== "setup-overview" || !showAdvancedDatasetConfig) return;
      if (datasetsLength > 0 && scopeConfigMode !== "legacy") return;
      if (!Number.isFinite(jobId) || jobId <= 0) return;

      setters.setLoadingScopeConfig(true);
      setters.setScopeCatalogStatus("Loading dataset catalog...");
      try {
        const dRes = await fetch(`${baseUrl}/admin/datasets?include_archived=true`, {
          credentials: "include",
          headers: withAuditHeaders(),
        });
        if (cancelled) return;

        if (dRes.ok) {
          const dJson = (await dRes.json()) as DatasetsResponse;
          const catalog = dJson?.items ?? [];
          setters.setDatasets(catalog as Array<Record<string, unknown>>);
          setters.setScopeCatalogCount(catalog.length);
          setters.setScopeCatalogStatus(
            catalog.length > 0
              ? `Loaded ${catalog.length} datasets into the job catalog.`
              : "No datasets returned by the catalog endpoint."
          );
        } else {
          setters.setScopeCatalogStatus(`Dataset catalog request failed (${dRes.status}).`);
        }
      } finally {
        if (!cancelled) setters.setLoadingScopeConfig(false);
      }

      void (async () => {
        try {
          const scRes = await fetch(`${baseUrl}/jobs/${jobId}/scope-config`);
          if (cancelled) return;

          if (scRes.ok) {
            const scJson = (await scRes.json()) as JobScopeConfigResponse;
            const effectiveItems = scJson?.items ?? [];
            const legacyItems = scJson?.legacy_items ?? effectiveItems;

            setters.setScopeConfigMode(scJson?.mode || "legacy");
            setters.setScopeConfigWarnings(
              Array.isArray(scJson?.warnings) ? scJson.warnings.map((w) => String(w)) : []
            );
            setters.setScopeAutoResolution(scJson?.auto_resolution ?? null);
            setters.setScopeEffectiveDatasetIds(scopeMapFromItems(effectiveItems));
            setters.setScopeDatasetIds(scopeMapFromItems(legacyItems));
            setters.setAdditionalDatasetIds(
              Array.isArray(scJson?.additional_dataset_ids)
                ? scJson.additional_dataset_ids.map((id) => String(id))
                : []
            );
          } else {
            setters.setScopeCatalogStatus((prev) =>
              prev
                ? `${prev} Scope config request failed (${scRes.status}).`
                : `Scope config request failed (${scRes.status}).`
            );
          }
        } catch {
          if (!cancelled) {
            setters.setScopeCatalogStatus((prev) =>
              prev ? `${prev} Scope config request failed.` : "Scope config request failed."
            );
          }
        }
      })();
    }

    void loadScopeConfigResources();

    return () => {
      cancelled = true;
    };
  }, [
    activeWorkspaceSubtab,
    baseUrl,
    datasetsLength,
    jobId,
    scopeConfigMode,
    scopeConfigReloadToken,
    showAdvancedDatasetConfig,
    setters,
  ]);

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
      if (activeSetupSubtab !== "setup-report-variables") return;
      if (!Number.isFinite(jobId) || jobId <= 0) return;
      if (reportMetadataFieldsLength > 0) return;

      setters.setLoadingReportMetadata(true);
      try {
        const res = await fetch(`${baseUrl}/jobs/${jobId}/report-metadata`);
        if (!res.ok) {
          if (res.status === 404) {
            const fallbackMetadata = await loadFallbackMetadataValuesFromReportData();
            if (cancelled) return;

            setters.setReportMetadataApiUnavailable(true);
            setters.setReportMetadataFields(JOB_SETUP_METADATA_FALLBACK_FIELDS);
            setters.setReportMetadataValues(
              buildMetadataFieldValues(JOB_SETUP_METADATA_FALLBACK_FIELDS, fallbackMetadata)
            );
            setters.setReportMetadataStatus(
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
        setters.setReportMetadataApiUnavailable(false);
        setters.setReportMetadataFields(effectiveFields);
        setters.setReportMetadataValues(buildMetadataFieldValues(effectiveFields, metadata));
        setters.setReportMetadataEnergyFactors(
          (payload?.energy_emissions_factors || null) as unknown
        );
      } catch (e) {
        const fallbackMetadata = await loadFallbackMetadataValuesFromReportData();
        if (cancelled) return;

        setters.setReportMetadataApiUnavailable(true);
        setters.setReportMetadataFields(JOB_SETUP_METADATA_FALLBACK_FIELDS);
        setters.setReportMetadataValues(
          buildMetadataFieldValues(JOB_SETUP_METADATA_FALLBACK_FIELDS, fallbackMetadata)
        );
        setters.setReportMetadataEnergyFactors(null);
        setters.setReportMetadataStatus(
          `Unable to load report metadata endpoint (${(e as Error).message}). Showing fallback fields only.`
        );
      } finally {
        if (!cancelled) setters.setLoadingReportMetadata(false);
      }
    }

    void loadReportMetadata();

    return () => {
      cancelled = true;
    };
  }, [activeSetupSubtab, baseUrl, jobId, reportMetadataFieldsLength, setters]);
}
