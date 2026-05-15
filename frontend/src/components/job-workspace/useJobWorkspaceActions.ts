import { withAuditHeaders } from "@/lib/auth-client";
import { uploadFormDataWithProgress } from "@/lib/upload-with-progress";
import { primeJobShellData, type JobShellJob } from "@/lib/job-shell-data";
import { AUTO_REPORT_METADATA_FIELDS, SCOPE_KEYS, buildMetadataFieldValues, scopeMapFromItems, type JobScopeConfigItem, type ReportMetadataField } from "@/lib/job-workspace";

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
  client_name: string | null;
  crm_owner?: string | null;
  crm_name?: string | null;
  start_date?: string | null;
  due_date?: string | null;
  job_type?: string | null;
  original_portfolio?: string | null;
};

type UploadValidationResult = {
  ok?: boolean;
  rows_ready?: unknown[];
  raw?: string;
};

type ImportConflict = {
  [key: string]: unknown;
};

type JobScopeConfigResponse = {
  mode?: string;
  warnings?: string[];
  auto_resolution?: unknown;
  items?: JobScopeConfigItem[];
  legacy_items?: JobScopeConfigItem[];
  additional_dataset_ids?: Array<string | number | null>;
};

type ActionDeps = {
  jobId: number;
  baseUrl: string;
  job: WorkspaceJob | null;
  clientOwnerLabel: string;
  clientBenchmarkPeriodLabel: string;
  setJob: React.Dispatch<React.SetStateAction<WorkspaceJob | null>>;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setStatus: React.Dispatch<React.SetStateAction<string>>;
  setUploadStatus: React.Dispatch<React.SetStateAction<string>>;
  setUploadResult: React.Dispatch<React.SetStateAction<UploadValidationResult | null>>;
  setUploadProgress: React.Dispatch<React.SetStateAction<number>>;
  setImportConflicts: React.Dispatch<React.SetStateAction<ImportConflict[]>>;
  setImportConflictAcknowledged: React.Dispatch<React.SetStateAction<boolean>>;
  setReportMetadataStatus: React.Dispatch<React.SetStateAction<string>>;
  setSavingReportMetadata: React.Dispatch<React.SetStateAction<boolean>>;
  setReportMetadataApiUnavailable: React.Dispatch<React.SetStateAction<boolean>>;
  setReportMetadataValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setReportMetadataEnergyFactors: React.Dispatch<React.SetStateAction<unknown>>;
  setScopeConfigMode: React.Dispatch<React.SetStateAction<string>>;
  setScopeConfigWarnings: React.Dispatch<React.SetStateAction<string[]>>;
  setScopeAutoResolution: React.Dispatch<React.SetStateAction<unknown>>;
  setScopeEffectiveDatasetIds: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setScopeDatasetIds: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setAdditionalDatasetIds: React.Dispatch<React.SetStateAction<string[]>>;
  setSelectedTemplateId: React.Dispatch<React.SetStateAction<string>>;
  selectedMilestoneTemplateId: string;
  jobTitle: string;
  jobStatus: string;
  jobType: string;
  originalPortfolio: string;
  crmName: string;
  jobStartDate: string;
  jobEndDate: string;
  reportMetadataFieldsForSetup: ReportMetadataField[];
  reportMetadataApiUnavailable: boolean;
  reportMetadataValues: Record<string, string>;
  scopeConfigMode: string;
  scopeDatasetIds: Record<string, string>;
  additionalDatasetIds: string[];
  reportingPeriodStart: string;
  reportingPeriodEnd: string;
  selectedSiteId: string;
  uploadFile: File | null;
  uploadResult: UploadValidationResult | null;
  importConflictAcknowledged: boolean;
};

export default function useJobWorkspaceActions(deps: ActionDeps) {
  const {
    jobId,
    baseUrl,
    job,
    clientOwnerLabel,
    clientBenchmarkPeriodLabel,
    setJob,
    setBusy,
    setStatus,
    setUploadStatus,
    setUploadResult,
    setUploadProgress,
    setImportConflicts,
    setImportConflictAcknowledged,
    setReportMetadataStatus,
    setSavingReportMetadata,
    setReportMetadataApiUnavailable,
    setReportMetadataValues,
    setReportMetadataEnergyFactors,
    setScopeConfigMode,
    setScopeConfigWarnings,
    setScopeAutoResolution,
    setScopeEffectiveDatasetIds,
    setScopeDatasetIds,
    setAdditionalDatasetIds,
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
    reportingPeriodStart,
    reportingPeriodEnd,
    selectedSiteId,
    uploadFile,
    uploadResult,
    importConflictAcknowledged,
    selectedMilestoneTemplateId,
  } = deps;

  function isValidTemplateSelection(value: string): boolean {
    const templateId = Number(value);
    return Number.isFinite(templateId) && templateId > 0;
  }

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
      setReportMetadataValues(
        buildMetadataFieldValues(reportMetadataFieldsForSetup, updatedMetadata)
      );
      setReportMetadataEnergyFactors((payload?.energy_emissions_factors || null) as unknown);

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
    setStatus(scopeConfigMode === "automatic" ? "Saving manual fallback dataset mapping..." : "Saving scope datasets...");
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
        setScopeConfigWarnings(Array.isArray(refreshed?.warnings) ? refreshed.warnings.map((w) => String(w)) : []);
        setScopeAutoResolution(refreshed?.auto_resolution ?? null);
        setScopeEffectiveDatasetIds(scopeMapFromItems(refreshed?.items ?? []));
        setScopeDatasetIds(scopeMapFromItems(refreshed?.legacy_items ?? refreshed?.items ?? []));
        setAdditionalDatasetIds(
          Array.isArray(refreshed?.additional_dataset_ids)
            ? refreshed.additional_dataset_ids.map((id) => String(id))
            : []
        );
      }

      setStatus(scopeConfigMode === "automatic" ? "Manual fallback mapping saved. Automatic resolver remains active." : "Scope datasets saved. Re-run validation.");
    } catch (e) {
      setStatus(`Save error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate(jobTemplateId: string) {
    if (!Number.isFinite(jobId) || jobId <= 0) return;
    if (!isValidTemplateSelection(jobTemplateId)) {
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
      setSelectedTemplateId(jobTemplateId);
      if (job) {
        primeJobShellData(baseUrl, jobId, { job: { ...job, job_template_id: Number(jobTemplateId), client_db_id: job.client_db_id ?? 0 } as JobShellJob, clientOwnerLabel, clientBenchmarkPeriodLabel });
      }
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
          job_type: jobType,
          original_portfolio: originalPortfolio || "NZI",
          crm_name: crmName,
          start_date: jobStartDate || null,
          due_date: jobEndDate || null,
          milestone_template_id:
            selectedMilestoneTemplateId && selectedMilestoneTemplateId !== "__none__"
              ? Number(selectedMilestoneTemplateId)
              : null,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setStatus(`Save failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
        return;
      }
      setStatus("Job details saved successfully! Reloading milestones...");
      const updatedJobRes = await fetch(`${baseUrl}/jobs/${jobId}`);
      if (updatedJobRes.ok) {
        const updatedJob = await updatedJobRes.json();
        setJob(updatedJob);
        primeJobShellData(baseUrl, jobId, {
          job: {
            job_id: updatedJob.job_id,
            job_number: updatedJob.job_number,
            title: updatedJob.title,
            reporting_year: updatedJob.reporting_year,
            reporting_period_start: updatedJob.reporting_period_start,
            reporting_period_end: updatedJob.reporting_period_end,
            status: updatedJob.status,
            job_template_id: updatedJob.job_template_id,
            milestone_template_id: updatedJob.milestone_template_id,
            client_db_id: updatedJob.client_db_id,
            client_name: updatedJob.client_name,
            crm_owner: updatedJob.crm_owner,
            crm_name: updatedJob.crm_name,
          },
          clientOwnerLabel,
          clientBenchmarkPeriodLabel,
        });
      }
      setStatus("Job details and milestones updated successfully!");
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
      if (job) {
        primeJobShellData(baseUrl, jobId, {
          job: { ...job, reporting_period_start: reportingPeriodStart || null, reporting_period_end: reportingPeriodEnd || null, client_db_id: job.client_db_id ?? 0 } as JobShellJob,
          clientOwnerLabel,
          clientBenchmarkPeriodLabel,
        });
      }
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

    if (scopeConfigMode !== "legacy") {
      const hasDataset = Object.values(scopeDatasetIds).some((value) => Boolean(value && value !== "__none__"));
      if (!hasDataset) {
        setUploadStatus(
          scopeConfigMode === "automatic"
            ? "No automatically resolved datasets were found for this reporting period/client. Save reporting period or set manual fallback datasets."
            : "Please configure at least one Scope Dataset before uploading."
        );
        return;
      }
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
        json = parsed && typeof parsed === "object" ? (parsed as UploadValidationResult) : { raw: text };
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

  async function importValidatedRows(skipConflictCheck = false) {
    if (!Number.isFinite(jobId) || jobId <= 0) return;
    if (selectedSiteId === "All") {
      setUploadStatus("Please select a specific site (not 'All') before importing.");
      return;
    }
    if (!Array.isArray(uploadResult?.rows_ready) || uploadResult.rows_ready.length === 0) {
      setUploadStatus("Nothing to import. Validate first.");
      return;
    }

    if (!skipConflictCheck && !importConflictAcknowledged) {
      setBusy(true);
      setUploadStatus("Checking for conflicts...");
      try {
        const preflightRes = await fetch(`${baseUrl}/jobs/${jobId}/excel-import-preflight`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ site_id: Number(selectedSiteId), rows_ready: uploadResult.rows_ready }),
        });
        if (preflightRes.ok) {
          const preflightJson = await preflightRes.json().catch(() => null);
          const conflicts: ImportConflict[] = preflightJson?.conflicts ?? [];
          if (conflicts.length > 0) {
            setImportConflicts(conflicts);
            setUploadStatus("");
            setBusy(false);
            return;
          }
        }
      } catch {
        // proceed anyway
      } finally {
        setBusy(false);
      }
    }

    setImportConflicts([]);
    setImportConflictAcknowledged(false);
    setBusy(true);
    setUploadStatus("Importing rows...");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/excel-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
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

  async function downloadTemplate(
    selectedTemplateId: string,
    selectedSiteName: string,
    includePrevYear: boolean,
    periodStartLabel: string,
    periodEndLabel: string,
    jobNumberLabel: string,
    clientLabel: string
  ) {
    if (!Number.isFinite(jobId) || jobId <= 0) return;
    if (!isValidTemplateSelection(selectedTemplateId)) {
      setStatus("Please select a Job Template before downloading.");
      return;
    }
    if (!selectedSiteName.trim()) {
      setStatus("Please select a site.");
      return;
    }
    setBusy(true);
    setStatus("Downloading template...");
    try {
      const params = new URLSearchParams();
      params.set("site", selectedSiteName);
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
      const safeNamePart = (value: string) =>
        (value || "").trim().replace(/[<>:"/\\|?*]+/g, "").replace(/\s+/g, "-").replace(/^-+|-+$/g, "") || "Unknown";
      const fallbackPeriod =
        periodStartLabel && periodEndLabel
          ? `${safeNamePart(periodStartLabel)}-to-${safeNamePart(periodEndLabel)}`
          : "reporting-period";
      const filenameMatch = contentDisposition.match(/filename="([^"]+)"/i);
      const filename =
        filenameMatch?.[1] ||
        [safeNamePart(jobNumberLabel), safeNamePart(clientLabel), safeNamePart(selectedSiteName), fallbackPeriod, "data_upload.xlsx"].join("_");
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

  async function toggleMilestone(kind: string, completed: boolean) {
    await fetch(`${baseUrl}/jobs/${jobId}/milestones/${kind}/complete`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed }),
    });
  }

  async function toggleAdditionalMilestone(itemId: number, completed: boolean) {
    await fetch(`${baseUrl}/jobs/${jobId}/milestone-template-items/${itemId}/complete`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed }),
    });
  }

  return {
    saveReportMetadata,
    saveScopeDatasets,
    saveTemplate,
    saveJobDetails,
    saveReportingPeriod,
    validateUpload,
    importValidatedRows,
    downloadTemplate,
    toggleMilestone,
    toggleAdditionalMilestone,
  };
}
