"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import EmissionsSummary from "@/components/EmissionsSummary";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { withAuditHeaders } from "@/lib/auth-client";
import UploadProgressBar from "@/components/UploadProgressBar";
import { uploadFormDataWithProgress } from "@/lib/upload-with-progress";
import { dispatchJobScopeRefresh } from "@/lib/job-scope-refresh";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatDate, formatNumber } from "@/lib/format";
import { useUnsavedChangesGuard } from "@/lib/useUnsavedChangesGuard";
import PendingPortalCommutingSubmissions from "@/components/PendingPortalCommutingSubmissions";

type SiteOption = {
  site_id: number | null;
  site_name: string | null;
};

type CommutingSummary = {
  job_id: number;
  row_count: number;
  total_tco2e: number;
  site_count: number;
  employee_headcount?: number | null;
  data_source: string;
};

type PreviewRow = {
  row_number: number;
  row_type: string;
  employee_name: string;
  original_id: string;
  report_label: string | null;
  qty: number;
  uom: string | null;
  calc_tco2e: number;
};

type UnresolvedRow = {
  sheet: string;
  row_number: number;
  employee_name: string;
  reason: string;
  original_id?: string | null;
};

type PreviewPayload = {
  job_id: number;
  site_id: number | null;
  site_label: string;
  template_version: string;
  parsed_count: number;
  ready_count: number;
  unresolved_count: number;
  total_tco2e: number;
  employee_headcount?: number | null;
  job_employee_headcount?: number | null;
  commuting_response_count?: number | null;
  commuting_scale_factor?: number | null;
  unit_fallback_count?: number | null;
  ready_rows: PreviewRow[];
  unresolved_rows: UnresolvedRow[];
};

type DirectEntryDraft = {
  row_id: number;
  row_type: "commuting" | "wfh";
  employee_name: string;
  mode_value: string;
  service_value: string;
  unit_value: string;
  one_way_distance: string;
  office_days: string;
  weeks_per_year: string;
  annual_distance: string;
  annual_days: string;
  hours_per_day: string;
  notes: string;
};

type DirectEntryRow = {
  source_id: number;
  source_name: string;
  source_subtype: string | null;
  employee_name: string | null;
  original_id: string | null;
  qty: number | null;
  uom: string | null;
  calc_tco2e: number;
  site_id: number | null;
  site_name: string | null;
  notes: string | null;
  detail_json: Record<string, unknown> | null;
  enabled: boolean;
  data_source: string | null;
  updated_at: string | null;
};

type ImportedScopeRow = {
  row_id: number;
  site_id: number | null;
  site_name: string | null;
  employee_name: string | null;
  original_id: string | null;
  report_label: string | null;
  qty: number | null;
  uom: string | null;
  calc_tco2e: number;
  data_source: string | null;
  notes: string | null;
  unit_warning?: string | null;
  uses_emissions_fallback?: boolean;
};

export default function EmployeeCommutingData({
  jobId,
  baseUrl,
  jobNumber,
  clientName,
  reportingPeriodStart,
  reportingPeriodEnd,
  showEmissionsSummary = false,
}: {
  jobId: number;
  baseUrl: string;
  jobNumber?: string | null;
  clientName?: string | null;
  reportingPeriodStart?: string | null;
  reportingPeriodEnd?: string | null;
  showEmissionsSummary?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<{ sourceId: number; label: string } | null>(null);
  const [status, setStatus] = useState("");
  const [summary, setSummary] = useState<CommutingSummary | null>(null);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>("__none__");
  const [employeeCount, setEmployeeCount] = useState<string>("");
  const [disableScaling, setDisableScaling] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPhase, setUploadPhase] = useState("");
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [manualEntries, setManualEntries] = useState<DirectEntryDraft[]>([]);
  const [directEntries, setDirectEntries] = useState<DirectEntryRow[]>([]);
  const [importedRows, setImportedRows] = useState<ImportedScopeRow[]>([]);
  const [manualRowType, setManualRowType] = useState<"commuting" | "wfh">("commuting");
  const [manualEmployeeName, setManualEmployeeName] = useState("");
  const [manualModeValue, setManualModeValue] = useState("Car - Petrol");
  const [manualServiceValue, setManualServiceValue] = useState("Average");
  const [manualUnitValue, setManualUnitValue] = useState("miles");
  const [manualOneWayDistance, setManualOneWayDistance] = useState("");
  const [manualOfficeDays, setManualOfficeDays] = useState("");
  const [manualWeeksPerYear, setManualWeeksPerYear] = useState("");
  const [manualAnnualDistance, setManualAnnualDistance] = useState("");
  const [manualAnnualDays, setManualAnnualDays] = useState("");
  const [manualHoursPerDay, setManualHoursPerDay] = useState("");
  const [manualNotes, setManualNotes] = useState("");
  const [manualReplaceExisting, setManualReplaceExisting] = useState(false);
  const [editingDirectSourceId, setEditingDirectSourceId] = useState<number | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [currentStep, setCurrentStep] = useState<number>(1);
  const initialStepSet = useRef(false);

  useUnsavedChangesGuard(hasUnsavedChanges);

  // Auto-advance to Job Data on load if this job already has commuting data,
  // so a returning user sees their existing rows instead of the Setup stage.
  useEffect(() => {
    if (initialStepSet.current) return;
    if (!summary) return;
    initialStepSet.current = true;
    const hasData = (summary.row_count ?? 0) > 0 || directEntries.length > 0 || importedRows.length > 0;
    if (hasData) {
      setCurrentStep(3);
    }
  }, [summary, directEntries.length, importedRows.length]);

  useEffect(() => {
    const dirty =
      editingDirectSourceId !== null ||
      Boolean(uploadFile) ||
      manualEntries.length > 0 ||
      Boolean(
        manualEmployeeName.trim() ||
          manualModeValue.trim() ||
          manualServiceValue.trim() ||
          manualUnitValue.trim() ||
          manualOneWayDistance.trim() ||
          manualOfficeDays.trim() ||
          manualWeeksPerYear.trim() ||
          manualAnnualDistance.trim() ||
          manualAnnualDays.trim() ||
          manualHoursPerDay.trim() ||
          manualNotes.trim()
      );
    setHasUnsavedChanges(dirty);
  }, [
    editingDirectSourceId,
    uploadFile,
    manualEntries.length,
    manualEmployeeName,
    manualModeValue,
    manualServiceValue,
    manualUnitValue,
    manualOneWayDistance,
    manualOfficeDays,
    manualWeeksPerYear,
    manualAnnualDistance,
    manualAnnualDays,
    manualHoursPerDay,
    manualNotes,
  ]);

  useEffect(() => {
    if (employeeCount.trim()) return;
    if (summary?.employee_headcount && summary.employee_headcount > 0) {
      setEmployeeCount(String(summary.employee_headcount));
    }
  }, [employeeCount, summary?.employee_headcount]);

  const selectedSiteLabel = useMemo(() => {
    if (selectedSiteId === "__none__") return "All_Staff";
    const siteId = Number(selectedSiteId);
    return sites.find((site) => site.site_id === siteId)?.site_name || "All_Staff";
  }, [selectedSiteId, sites]);

  function safeNamePart(value: string | null | undefined) {
    const text = String(value || "").trim();
    const cleaned = text.replace(/[<>:"/\\|?*]+/g, "").replace(/\s+/g, "_").replace(/^_+|_+$/g, "");
    return cleaned || "Unknown";
  }

  function formatPeriodPart(value: string | null | undefined) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const datePart = raw.includes("T") ? raw.split("T")[0] : raw.slice(0, 10);
    const formatted = formatDate(datePart, { day: "2-digit", month: "short", year: "numeric" });
    return formatted === "—" ? raw : formatted.replace(/\s+/g, "-");
  }

  function fallbackTemplateFilename() {
    const periodStart = formatPeriodPart(reportingPeriodStart);
    const periodEnd = formatPeriodPart(reportingPeriodEnd);
    const periodPart = periodStart && periodEnd ? `${periodStart}-to-${periodEnd}` : "Reporting_Period";
    return [
      safeNamePart(jobNumber || `Job-${jobId}`),
      safeNamePart(clientName || "Client"),
      safeNamePart(selectedSiteLabel),
      safeNamePart(periodPart),
      "employee_commuting",
    ].join("_") + ".xlsx";
  }

  function buildManualEntryPayload() {
    return {
      row_type: manualRowType,
      employee_name: manualEmployeeName.trim(),
      mode_value: manualModeValue.trim(),
      service_value: manualServiceValue.trim(),
      unit_value: manualUnitValue.trim(),
      one_way_distance: manualOneWayDistance.trim(),
      office_days: manualOfficeDays.trim(),
      weeks_per_year: manualWeeksPerYear.trim(),
      annual_distance: manualAnnualDistance.trim(),
      annual_days: manualAnnualDays.trim(),
      hours_per_day: manualHoursPerDay.trim(),
      notes: manualNotes.trim(),
    };
  }

  function clearManualForm() {
    setManualRowType("commuting");
    setManualEmployeeName("");
    setManualModeValue("Car - Petrol");
    setManualServiceValue("Average");
    setManualUnitValue("miles");
    setManualOneWayDistance("");
    setManualOfficeDays("");
    setManualWeeksPerYear("");
    setManualAnnualDistance("");
    setManualAnnualDays("");
    setManualHoursPerDay("");
    setManualNotes("");
    setHasUnsavedChanges(false);
  }

  function startEditDirectEntry(row: DirectEntryRow) {
    const detail = row.detail_json && typeof row.detail_json === "object" ? row.detail_json : null;
    const rowType = row.source_subtype === "wfh" ? "wfh" : "commuting";

    setEditingDirectSourceId(row.source_id);
    setManualRowType(rowType);
    setManualEmployeeName(row.employee_name || row.source_name || "");
    setManualModeValue(String(detail?.["mode_value"] || "Car - Petrol"));
    setManualServiceValue(String(detail?.["service_value"] || "Average"));
    setManualUnitValue(String(detail?.["unit_value"] || row.uom || "miles"));
    setManualOneWayDistance(String(detail?.["one_way_distance"] ?? ""));
    setManualOfficeDays(String(detail?.["office_days"] ?? ""));
    setManualWeeksPerYear(String(detail?.["weeks_per_year"] ?? ""));
    setManualAnnualDistance(String(detail?.["annual_distance"] ?? row.qty ?? ""));
    setManualAnnualDays(String(detail?.["annual_days"] ?? ""));
    setManualHoursPerDay(String(detail?.["hours_per_day"] ?? ""));
    setManualNotes(row.notes || "");
    setSelectedSiteId(row.site_id == null ? "__none__" : String(row.site_id));
    setError("");
    setStatus(`Editing saved entry for ${row.employee_name || row.source_name}.`);
    setHasUnsavedChanges(true);
    setCurrentStep(2);
  }

  function cancelEditDirectEntry() {
    setEditingDirectSourceId(null);
    clearManualForm();
    setStatus("Edit cancelled.");
    setHasUnsavedChanges(false);
  }

  useEffect(() => {
    void loadSummary();
    void loadSites();
    void loadImportedRows();
    void loadDirectEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, baseUrl]);

  async function loadSummary() {
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/employee-commuting/summary`);
      if (!res.ok) {
        throw new Error(`Failed to load employee commuting summary (${res.status})`);
      }
      const data = (await res.json()) as CommutingSummary;
      setSummary(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load employee commuting summary");
    }
  }

  async function loadSites() {
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/sites`);
      if (!res.ok) return;
      const data = await res.json();
      setSites(Array.isArray(data?.sites) ? data.sites : []);
    } catch {
      // non-fatal
    }
  }

  async function loadDirectEntries() {
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/emission-registers?source_type=employee_commuting`);
      if (!res.ok) {
        const apiError = await readError(res);
        setError(apiError.message);
        setDirectEntries([]);
        return;
      }
      const data = await res.json();
      const rows = Array.isArray(data?.sources) ? data.sources : [];
      setDirectEntries(
        rows.map((row: Record<string, unknown>) => ({
          source_id: Number(row.source_id ?? 0),
          source_name: String(row.source_name ?? ""),
          source_subtype: row.source_subtype ? String(row.source_subtype) : null,
          employee_name: row.employee_name ? String(row.employee_name) : null,
          original_id: row.original_id ? String(row.original_id) : null,
          qty: row.qty === null || row.qty === undefined ? null : Number(row.qty),
          uom: row.uom ? String(row.uom) : null,
          calc_tco2e: Number(row.calc_tco2e ?? 0),
          site_id: row.site_id === null || row.site_id === undefined ? null : Number(row.site_id),
          site_name: row.site_name ? String(row.site_name) : null,
          notes: row.notes ? String(row.notes) : null,
          detail_json: row.detail_json && typeof row.detail_json === "object" ? (row.detail_json as Record<string, unknown>) : null,
          enabled: Boolean(row.enabled),
          data_source: row.data_source ? String(row.data_source) : null,
          updated_at: row.updated_at ? String(row.updated_at) : null,
        }))
      );
    } catch {
      // non-fatal
    }
  }

  async function loadImportedRows() {
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/scope-data?scope=Scope 3&include_disabled=false`);
      if (!res.ok) return;
      const data = await res.json();
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      const filtered = rows.filter((row: Record<string, unknown>) => {
        const dataSource = String(row.data_source || "").toLowerCase();
        const reportLabel = String(row.report_label || "").toLowerCase();
        const originalId = String(row.original_id || "").toLowerCase();
        const category = String(row.category || "").toLowerCase();
        return (
          dataSource.includes("employee commuting") ||
          reportLabel.includes("employee commuting") ||
          originalId.includes("employee commuting") ||
          category.includes("employee commuting")
        );
      });
      setImportedRows(
        filtered.map((row: Record<string, unknown>) => ({
          row_id: Number(row.row_id ?? 0),
          site_id: row.site_id === null || row.site_id === undefined ? null : Number(row.site_id),
          site_name: row.site_name ? String(row.site_name) : null,
          employee_name: row.employee_name ? String(row.employee_name) : null,
          original_id: row.original_id ? String(row.original_id) : null,
          report_label: row.report_label ? String(row.report_label) : null,
          qty: row.qty === null || row.qty === undefined ? null : Number(row.qty),
          uom: row.uom ? String(row.uom) : null,
          calc_tco2e: Number(row.calc_tco2e ?? 0),
          data_source: row.data_source ? String(row.data_source) : null,
          notes: row.notes ? String(row.notes) : null,
          unit_warning: row.unit_warning ? String(row.unit_warning) : null,
          uses_emissions_fallback: Boolean(row.uses_emissions_fallback),
        }))
      );
    } catch {
      // non-fatal
    }
  }

  function siteQuery() {
    if (selectedSiteId === "__none__") return "";
    return `?site_id=${encodeURIComponent(selectedSiteId)}`;
  }

  function buildEmployeeCommuteQuery() {
    const params = new URLSearchParams();
    if (selectedSiteId !== "__none__") {
      params.set("site_id", selectedSiteId);
    }
    const parsedEmployeeCount = Number(employeeCount);
    if (Number.isFinite(parsedEmployeeCount) && parsedEmployeeCount > 0) {
      params.set("employee_count", String(Math.floor(parsedEmployeeCount)));
    }
    if (disableScaling) {
      params.set("disable_scaling", "true");
    }
    return params.toString() ? `?${params.toString()}` : "";
  }

  async function downloadTemplate() {
    setLoading(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/employee-commuting/template${siteQuery()}`);
      if (!res.ok) {
        throw new Error(`Template download failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const xFilename = res.headers.get("x-filename");
      const disposition = res.headers.get("content-disposition") || "";
      const cdMatch = disposition.match(/filename="?([^"]+)"?/i);
      const filename = xFilename || cdMatch?.[1] || fallbackTemplateFilename();
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setStatus(`Template downloaded for ${selectedSiteLabel.replaceAll("_", " ")} as ${filename}.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Template download failed");
    } finally {
      setLoading(false);
    }
  }

  async function readError(
    res: { status: number; statusText: string; text: () => Promise<string>; json: () => Promise<unknown> }
  ): Promise<{ message: string; preview?: PreviewPayload | null }> {
    try {
      const data = (await res.json()) as Record<string, unknown>;
      const detail = data.detail;
      if (typeof detail === "string") {
        return { message: detail };
      }
      if (detail && typeof detail === "object") {
        const detailObj = detail as Record<string, unknown>;
        return {
          message: String(detailObj.message || `Request failed (${res.status})`),
          preview: (detailObj.preview as PreviewPayload | null | undefined) ?? null,
        };
      }
      return { message: String(data.message || `Request failed (${res.status})`) };
    } catch {
      const text = await res.text().catch(() => "");
      return { message: text || `Request failed (${res.status})` };
    }
  }

  async function previewUpload() {
    if (!uploadFile) {
      setError("Please choose a completed employee commuting workbook first.");
      return;
    }
    setLoading(true);
    setError("");
    setStatus("");
    setUploadProgress(0);
      setUploadPhase("Uploading workbook for preview...");
    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      const res = await uploadFormDataWithProgress(`${baseUrl}/jobs/${jobId}/employee-commuting/upload-preview${buildEmployeeCommuteQuery()}`, {
        method: "POST",
        body: fd,
        onProgress: ({ percent }) => setUploadProgress(percent),
      });
      if (!res.ok) {
        const apiError = await readError(res);
        throw new Error(apiError.message);
      }
      const data = (await res.json()) as PreviewPayload;
      setPreview(data);
      const scalingNote = disableScaling
        ? data.commuting_response_count
          ? ` Scaling disabled — using raw workbook data (${data.commuting_response_count} distinct employees).`
          : ""
        : data.employee_headcount && data.commuting_response_count && data.commuting_scale_factor
          ? ` Scaled to ${data.employee_headcount} employees from ${data.commuting_response_count} distinct employees (${data.commuting_scale_factor.toFixed(2)}x).`
          : "";
      setStatus(
        `Preview complete: ${data.ready_count} ready, ${data.unresolved_count} unresolved, ${data.total_tco2e.toFixed(4)} tCO₂e.${scalingNote}`
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setLoading(false);
      setUploadProgress(0);
      setUploadPhase("");
    }
  }

  async function commitUpload() {
    if (!uploadFile) {
      setError("Please choose a completed employee commuting workbook first.");
      return;
    }
    setLoading(true);
    setError("");
    setStatus("");
    setUploadProgress(0);
    setUploadPhase("Importing workbook...");
    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
        const queryString = buildEmployeeCommuteQuery().replace(/^\?/, "");
        const res = await uploadFormDataWithProgress(
          `${baseUrl}/jobs/${jobId}/employee-commuting/upload-commit?${queryString}${queryString ? "&" : ""}replace_existing=${
            replaceExisting ? "true" : "false"
          }`,
          {
            method: "POST",
            headers: withAuditHeaders(undefined, {
              page: "Jobs",
              section: "Employee Commuting",
              container: "Import to Job Data",
            }),
            body: fd,
            onProgress: ({ percent }) => setUploadProgress(percent),
          }
        );
      if (!res.ok) {
        const apiError = await readError(res);
        if (apiError.preview) {
          setPreview(apiError.preview);
        }
        throw new Error(apiError.message);
      }
      const data = await res.json();
      setStatus(
        `Employee commuting import completed. Inserted ${data?.inserted ?? 0} grouped row(s) from ${data?.source_row_count ?? data?.inserted ?? 0} workbook row(s)${
          replaceExisting ? `, replaced ${data?.disabled ?? 0}` : ""
        }.`
      );
      setPreview(null);
      await loadSummary();
      await loadImportedRows();
      dispatchJobScopeRefresh("employee-commuting");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setLoading(false);
      setUploadProgress(0);
      setUploadPhase("");
    }
  }

  function addManualEntryDraft() {
    const employeeName = manualEmployeeName.trim();
    if (!employeeName) {
      setError("Employee / team name is required for a direct entry.");
      return;
    }

    const payload = buildManualEntryPayload();
    setManualEntries((current) => [
      ...current,
      {
        row_id: Date.now() + Math.floor(Math.random() * 1000),
        ...payload,
        employee_name: employeeName,
      },
    ]);

    clearManualForm();
    setError("");
    setStatus("Draft direct entry added.");
  }

  async function saveEditedDirectEntry() {
    if (editingDirectSourceId == null) return;
    const employeeName = manualEmployeeName.trim();
    if (!employeeName) {
      setError("Employee / team name is required for a direct entry.");
      return;
    }

    setLoading(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(
        `${baseUrl}/jobs/${jobId}/employee-commuting/direct-entry/${editingDirectSourceId}?${selectedSiteId === "__none__" ? "" : `site_id=${encodeURIComponent(selectedSiteId)}&`}`,
        {
          method: "PATCH",
          headers: withAuditHeaders(
            {
              "Content-Type": "application/json",
            },
            {
              page: "Jobs",
              section: "Employee Commuting",
              container: "Direct Entry",
            }
          ),
          body: JSON.stringify({ entry: buildManualEntryPayload() }),
        }
      );
      if (!res.ok) {
        const apiError = await readError(res);
        if (apiError.preview) {
          setPreview(apiError.preview);
        }
        throw new Error(apiError.message);
      }
      const data = await res.json();
      setStatus(`Updated direct commuting row${data?.site_label ? ` for ${data.site_label}` : ""}.`);
      setEditingDirectSourceId(null);
      clearManualForm();
      await loadSummary();
      await loadImportedRows();
      await loadDirectEntries();
      dispatchJobScopeRefresh("employee-commuting");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Updating direct entry failed");
    } finally {
      setLoading(false);
    }
  }

  async function saveManualEntries() {
    if (!manualEntries.length) {
      setError("Add at least one direct entry before saving.");
      return;
    }
    setLoading(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(
        `${baseUrl}/jobs/${jobId}/employee-commuting/direct-entry-commit?${selectedSiteId === "__none__" ? "" : `site_id=${encodeURIComponent(selectedSiteId)}&`}replace_existing=${manualReplaceExisting ? "true" : "false"}`,
        {
          method: "POST",
          headers: withAuditHeaders(
            {
              "Content-Type": "application/json",
            },
            {
              page: "Jobs",
              section: "Employee Commuting",
              container: "Direct Entry",
            }
          ),
          body: JSON.stringify({ entries: manualEntries }),
        }
      );
      if (!res.ok) {
        const apiError = await readError(res);
        if (apiError.preview) {
          setPreview(apiError.preview);
        }
        throw new Error(apiError.message);
      }
      const data = await res.json();
      setStatus(
        `Saved ${data?.inserted ?? 0} direct commuting rows${
          manualReplaceExisting ? `, replaced ${data?.disabled ?? 0}` : ""
        }.`
      );
      setManualEntries([]);
      await loadSummary();
      await loadImportedRows();
      await loadDirectEntries();
      dispatchJobScopeRefresh("employee-commuting");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Saving direct entries failed");
    } finally {
      setLoading(false);
    }
  }

  function removeDirectEntry(sourceId: number, label: string) {
    setPendingDelete({ sourceId, label });
  }

  async function doRemoveDirectEntry() {
    const pending = pendingDelete;
    setPendingDelete(null);
    if (!pending) return;
    const { sourceId } = pending;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/emission-registers/sources/${sourceId}`, {
        method: "DELETE",
        headers: withAuditHeaders(undefined, {
          page: "Jobs",
          section: "Employee Commuting",
          container: "Direct Entry",
        }),
      });
      if (!res.ok) {
        const apiError = await readError(res);
        throw new Error(apiError.message);
      }
      if (editingDirectSourceId === sourceId) {
        cancelEditDirectEntry();
      }
      setStatus("Direct entry archived.");
      await loadSummary();
      await loadImportedRows();
      await loadDirectEntries();
      dispatchJobScopeRefresh("employee-commuting");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete direct entry");
    } finally {
      setLoading(false);
    }
  }

  const stages = [
    { num: 1, label: "Setup", done: Boolean(summary) },
    { num: 2, label: "Add Data", done: (summary?.row_count ?? 0) > 0 || directEntries.length > 0 },
    { num: 3, label: "Job Data", done: false },
  ];

  return (
    <div className="space-y-5">
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title="Delete entry"
        description={pendingDelete ? `Delete direct entry "${pendingDelete.label}"? It will be hidden from the active register.` : ""}
        confirmLabel="Delete"
        destructive
        onConfirm={() => void doRemoveDirectEntry()}
      />
      {/* Prototype shells can hide this duplicate summary so the header stays compact. */}
      {showEmissionsSummary ? <EmissionsSummary jobId={jobId} baseUrl={baseUrl} /> : null}

      <PendingPortalCommutingSubmissions
        jobId={jobId}
        baseUrl={baseUrl}
        onReviewed={() => { void loadSummary(); void loadDirectEntries(); }}
      />

      <Card>
        <CardHeader>
          <CardTitle>Commuting Import Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-md border p-3">
              <div className="text-xs uppercase text-muted-foreground">Imported Rows</div>
              <div className="mt-1 text-2xl font-semibold">{summary?.row_count ?? 0}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs uppercase text-muted-foreground">Imported tCO₂e</div>
              <div className="mt-1 text-2xl font-semibold">
                {formatNumber(summary?.total_tco2e ?? 0, 4)}
              </div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs uppercase text-muted-foreground">Sites Covered</div>
              <div className="mt-1 text-2xl font-semibold">{summary?.site_count ?? 0}</div>
            </div>
          </div>
          {error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          {status ? (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">{status}</div>
          ) : null}
        </CardContent>
      </Card>

      {/* Stage progress indicator */}
      <div className="flex items-start px-2">
        {stages.map((stage, i) => (
          <Fragment key={stage.num}>
            <div className="flex flex-col items-center gap-1.5 shrink-0">
              <button
                type="button"
                disabled={!stage.done && stage.num > currentStep}
                onClick={() => { if (stage.done || stage.num <= currentStep) setCurrentStep(stage.num); }}
                className={[
                  "flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors",
                  currentStep === stage.num
                    ? "border-primary bg-primary text-primary-foreground"
                    : stage.done
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700 cursor-pointer"
                    : stage.num < currentStep
                    ? "border-primary/50 bg-primary/10 text-primary cursor-pointer"
                    : "border-muted-foreground/30 bg-background text-muted-foreground cursor-default",
                ].join(" ")}
              >
                {stage.done ? "✓" : stage.num}
              </button>
              <span className={[
                "text-xs font-medium text-center whitespace-nowrap",
                currentStep === stage.num ? "text-primary" : stage.done ? "text-emerald-700" : "text-muted-foreground",
              ].join(" ")}>
                {stage.label}
              </span>
            </div>
            {i < stages.length - 1 && (
              <div className={[
                "flex-1 h-0.5 mt-[18px] mx-2",
                stage.done || currentStep > stage.num ? "bg-emerald-300" : "bg-muted",
              ].join(" ")} />
            )}
          </Fragment>
        ))}
      </div>

      {/* Stage 1: Setup */}
      {currentStep === 1 && (
        <Card>
          <CardHeader><CardTitle>Stage 1: Setup</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-[1fr_auto]">
              <div className="space-y-2">
                <Label htmlFor="employee-commuting-site">Site</Label>
                <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
                  <SelectTrigger id="employee-commuting-site">
                    <SelectValue placeholder="Organisation-wide / no site" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Organisation-wide / No site</SelectItem>
                    {sites
                      .filter((site) => site.site_id != null && (site.site_name ?? "").trim().length > 0)
                      .map((site) => (
                        <SelectItem key={site.site_id ?? ""} value={String(site.site_id)}>
                          {site.site_name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <div className="text-xs text-muted-foreground">
                  The selected site is used in the downloaded file name and applied to imported rows.
                </div>
              </div>
              <div className="flex items-end">
                <Button variant="outline" onClick={downloadTemplate} disabled={loading}>
                  Download Template
                </Button>
              </div>
            </div>

            <div className="space-y-2 rounded-md border p-4">
              <div className="font-medium">Scaling Basis</div>
              <Label htmlFor="employee-count">Employees to scale to</Label>
              <Input
                id="employee-count"
                type="number"
                min="1"
                step="1"
                value={employeeCount}
                onChange={(e) => setEmployeeCount(e.target.value)}
                placeholder="Enter employee count"
                disabled={disableScaling}
              />
              <p className="text-xs text-muted-foreground">
                This is the full workforce count used for pro-rata scaling. Each person is counted once even if they have multiple commute rows or commute by more than one mode.
                {summary?.employee_headcount ? ` Job Setup employee count: ${summary.employee_headcount}.` : ""}
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={disableScaling}
                  onChange={(e) => setDisableScaling(e.target.checked)}
                />
                Do not scale (use raw workbook data)
              </label>
            </div>

            <div className="flex justify-end">
              <Button onClick={() => setCurrentStep(2)}>Continue to Add Data →</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stage 2: Add Data */}
      {currentStep === 2 && (
        <Card>
          <CardHeader><CardTitle>Stage 2: Add Data</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="text-sm text-muted-foreground">
              Upload a completed commuting workbook, or add employee rows directly below when a survey workbook is not available.
              Imported rows are written into Job Data with the appropriate employee commuting source.
            </div>

            <div className="grid gap-4 md:grid-cols-[1fr_auto_auto]">
              <div className="space-y-2">
                <Label htmlFor="employee-commuting-upload">Completed Workbook (.xlsx)</Label>
                <Input
                  id="employee-commuting-upload"
                  type="file"
                  accept=".xlsx"
                  onChange={(e) => {
                    setUploadFile(e.target.files?.[0] ?? null);
                    setPreview(null);
                    setError("");
                    setStatus("");
                  }}
                />
              </div>
              <div className="flex items-end">
                <Button variant="outline" onClick={previewUpload} disabled={loading || !uploadFile}>
                  Preview Upload
                </Button>
              </div>
              <div className="flex items-end">
                <Button
                  onClick={commitUpload}
                  disabled={
                    loading ||
                    !uploadFile ||
                    !preview ||
                    preview.ready_count === 0 ||
                    preview.unresolved_count > 0
                  }
                >
                  Import to Job Data
                </Button>
              </div>
            </div>

            {loading && uploadPhase ? (
              <UploadProgressBar value={uploadProgress} label={`${uploadPhase} ${uploadProgress > 0 ? `(${uploadProgress}%)` : ""}`} />
            ) : null}

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={replaceExisting}
                onChange={(e) => setReplaceExisting(e.target.checked)}
              />
              Replace previous commuting import for this site selection
            </label>

            {preview ? (
              <div className="space-y-4 rounded-md border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">Preview Summary</div>
                    <div className="text-sm text-muted-foreground">
                      {preview.site_label.replaceAll("_", " ")} â€¢ {preview.template_version}
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Ready rows: {preview.ready_count} | Unresolved rows: {preview.unresolved_count}
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-5">
                  <div className="rounded-md border p-3">
                    <div className="text-xs uppercase text-muted-foreground">Parsed Rows</div>
                    <div className="mt-1 text-xl font-semibold">{preview.parsed_count}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs uppercase text-muted-foreground">Ready Rows</div>
                    <div className="mt-1 text-xl font-semibold">{preview.ready_count}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs uppercase text-muted-foreground">Unresolved Rows</div>
                    <div className="mt-1 text-xl font-semibold">{preview.unresolved_count}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs uppercase text-muted-foreground">Distinct Employees</div>
                    <div className="mt-1 text-xl font-semibold">{preview.commuting_response_count ?? "—"}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs uppercase text-muted-foreground">Preview tCO₂e</div>
                    <div className="mt-1 text-xl font-semibold">
                      {formatNumber(preview.total_tco2e, 4)}
                    </div>
                  </div>
                </div>

                {disableScaling ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    Scaling disabled — using raw workbook data as entered ({preview.commuting_response_count ?? 0} distinct employees).
                  </div>
                ) : preview.employee_headcount && preview.commuting_response_count && preview.commuting_scale_factor && preview.commuting_scale_factor > 1 ? (
                  <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                    Scaled to {preview.employee_headcount} employees from {preview.commuting_response_count} distinct employees.
                    Applied factor: {preview.commuting_scale_factor.toFixed(2)}x.
                  </div>
                ) : null}

                {preview.unit_fallback_count && preview.unit_fallback_count > 0 ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    Unit fallback applied to {preview.unit_fallback_count} row{preview.unit_fallback_count === 1 ? "" : "s"}.
                    This usually means the workbook unit and the factor lookup unit differed, so the alternate distance unit was used.
                  </div>
                ) : null}

                {preview.unresolved_rows.length > 0 ? (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                    <div className="mb-2 font-medium text-destructive">Unresolved Rows</div>
                    <div className="space-y-2 text-sm">
                      {preview.unresolved_rows.map((row, idx) => (
                        <div key={`${row.sheet}-${row.row_number}-${idx}`} className="rounded border bg-background p-2">
                          <div className="font-medium">
                            {row.sheet} row {row.row_number}
                            {row.employee_name ? ` â€¢ ${row.employee_name}` : ""}
                          </div>
                          <div className="text-muted-foreground">{row.reason}</div>
                          {row.original_id ? <div className="font-mono text-xs">{row.original_id}</div> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {preview.ready_rows.length > 0 ? (
                  <div className="rounded-md border">
                    <div className="border-b px-3 py-2 text-sm font-medium">
                      Ready Rows
                      {preview.ready_rows.length > 60 ? (
                        <span className="font-normal text-muted-foreground"> (showing first 60 of {preview.ready_rows.length})</span>
                      ) : null}
                    </div>
                    <div className="max-h-72 overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-background">
                          <tr className="border-b text-left">
                            <th className="px-3 py-2">Row</th>
                            <th className="px-3 py-2">Type</th>
                            <th className="px-3 py-2">Employee / Team</th>
                            <th className="px-3 py-2">Original ID</th>
                            <th className="px-3 py-2">Report Label</th>
                            <th className="px-3 py-2 text-right">Qty</th>
                            <th className="px-3 py-2">Unit</th>
                            <th className="px-3 py-2 text-right">tCO₂e</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.ready_rows.slice(0, 60).map((row) => (
                            <tr key={`${row.row_type}-${row.row_number}-${row.original_id}`} className="border-b">
                              <td className="px-3 py-2">{row.row_number}</td>
                              <td className="px-3 py-2 capitalize">{row.row_type}</td>
                              <td className="px-3 py-2">{row.employee_name || "Unspecified"}</td>
                              <td className="px-3 py-2 font-mono">{row.original_id}</td>
                              <td className="px-3 py-2">{row.report_label || ""}</td>
                              <td className="px-3 py-2 text-right">
                                {formatNumber(row.qty, 4)}
                              </td>
                              <td className="px-3 py-2">{row.uom || ""}</td>
                              <td className="px-3 py-2 text-right">
                                {formatNumber(row.calc_tco2e, 6)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <details className="rounded-md border p-4">
              <summary className="cursor-pointer font-medium">Direct Employee Data Entry</summary>
              <div className="mt-4 space-y-4">
                <div className="text-sm text-muted-foreground">
                  Add commuting or working-from-home rows directly here when a survey workbook is not available.
                  Saved entries flow into reporting alongside the workbook import.
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="manual-row-type">Row type</Label>
                    <Select value={manualRowType} onValueChange={(value) => setManualRowType(value as "commuting" | "wfh")}>
                      <SelectTrigger id="manual-row-type">
                        <SelectValue placeholder="Choose row type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="commuting">Commuting</SelectItem>
                        <SelectItem value="wfh">Working from home</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="manual-employee">Initials or Staff Number</Label>
                    <Input
                      id="manual-employee"
                      value={manualEmployeeName}
                      onChange={(e) => setManualEmployeeName(e.target.value)}
                      placeholder="e.g. JD or EMP-4471 — avoid full names"
                    />
                  </div>
                </div>

                {manualRowType === "commuting" ? (
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="manual-mode">Commute Mode</Label>
                      <Select value={manualModeValue} onValueChange={setManualModeValue}>
                        <SelectTrigger id="manual-mode">
                          <SelectValue placeholder="Select mode" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Car - Petrol">Car - Petrol</SelectItem>
                          <SelectItem value="Car - Diesel">Car - Diesel</SelectItem>
                          <SelectItem value="Car - Hybrid">Car - Hybrid</SelectItem>
                          <SelectItem value="Car - Electric">Car - Electric</SelectItem>
                          <SelectItem value="Motorbike">Motorbike</SelectItem>
                          <SelectItem value="Taxi">Taxi</SelectItem>
                          <SelectItem value="Bus">Bus</SelectItem>
                          <SelectItem value="Rail">Rail</SelectItem>
                          <SelectItem value="Ferry">Ferry</SelectItem>
                          <SelectItem value="Walking">Walking</SelectItem>
                          <SelectItem value="Cycling">Cycling</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="manual-service">Vehicle / Service Type</Label>
                      <Input
                        id="manual-service"
                        value={manualServiceValue}
                        onChange={(e) => setManualServiceValue(e.target.value)}
                        placeholder="Average, Small, Regular, etc"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="manual-unit">Distance Unit</Label>
                      <Select value={manualUnitValue} onValueChange={setManualUnitValue}>
                        <SelectTrigger id="manual-unit">
                          <SelectValue placeholder="Select unit" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="miles">miles</SelectItem>
                          <SelectItem value="km">km</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="manual-annual-days">Annual WFH Days</Label>
                      <Input
                        id="manual-annual-days"
                        type="number"
                        min="0"
                        step="0.1"
                        value={manualAnnualDays}
                        onChange={(e) => setManualAnnualDays(e.target.value)}
                        placeholder="e.g. 120"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="manual-hours-per-day">Hours Per Day</Label>
                      <Input
                        id="manual-hours-per-day"
                        type="number"
                        min="0"
                        step="0.1"
                        value={manualHoursPerDay}
                        onChange={(e) => setManualHoursPerDay(e.target.value)}
                        placeholder="e.g. 7.5"
                      />
                    </div>
                  </div>
                )}

                {manualRowType === "commuting" ? (
                  <div className="grid gap-4 md:grid-cols-4">
                    <div className="space-y-2">
                      <Label htmlFor="manual-one-way-distance">One-Way Distance</Label>
                      <Input
                        id="manual-one-way-distance"
                        type="number"
                        min="0"
                        step="0.1"
                        value={manualOneWayDistance}
                        onChange={(e) => setManualOneWayDistance(e.target.value)}
                        placeholder="e.g. 18"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="manual-office-days">Office Days / Week</Label>
                      <Input
                        id="manual-office-days"
                        type="number"
                        min="0"
                        step="0.1"
                        value={manualOfficeDays}
                        onChange={(e) => setManualOfficeDays(e.target.value)}
                        placeholder="e.g. 3"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="manual-weeks-per-year">Weeks / Year</Label>
                      <Input
                        id="manual-weeks-per-year"
                        type="number"
                        min="0"
                        step="0.1"
                        value={manualWeeksPerYear}
                        onChange={(e) => setManualWeeksPerYear(e.target.value)}
                        placeholder="e.g. 46"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="manual-annual-distance">Annual Distance</Label>
                      <Input
                        id="manual-annual-distance"
                        type="number"
                        min="0"
                        step="0.1"
                        value={manualAnnualDistance}
                        onChange={(e) => setManualAnnualDistance(e.target.value)}
                        placeholder="Optional override"
                      />
                    </div>
                  </div>
                ) : null}

                {editingDirectSourceId !== null ? (
                  <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                    Editing saved direct entry #{editingDirectSourceId}. Update the fields below, then save the changes back into the register.
                  </div>
                ) : null}

                <div className="grid gap-4 md:grid-cols-[1fr_auto_auto]">
                  <div className="space-y-2">
                    <Label htmlFor="manual-notes">Notes</Label>
                    <Input
                      id="manual-notes"
                      value={manualNotes}
                      onChange={(e) => setManualNotes(e.target.value)}
                      placeholder="Optional context for the audit trail"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      variant="outline"
                      onClick={editingDirectSourceId !== null ? cancelEditDirectEntry : addManualEntryDraft}
                      disabled={loading}
                    >
                      {editingDirectSourceId !== null ? "Cancel Edit" : "Add Draft Row"}
                    </Button>
                  </div>
                  <div className="flex items-end">
                    <Button
                      onClick={editingDirectSourceId !== null ? saveEditedDirectEntry : saveManualEntries}
                      disabled={loading || (!editingDirectSourceId && manualEntries.length === 0)}
                    >
                      {editingDirectSourceId !== null ? "Update Saved Entry" : "Save Direct Entries"}
                    </Button>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={manualReplaceExisting}
                    onChange={(e) => setManualReplaceExisting(e.target.checked)}
                  />
                  Replace previous direct commuting entries for this site selection
                </label>

                {manualEntries.length > 0 ? (
                  <div className="rounded-md border">
                    <div className="border-b px-3 py-2 text-sm font-medium">Draft Direct Rows ({manualEntries.length})</div>
                    <div className="max-h-64 overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-background">
                          <tr className="border-b text-left">
                            <th className="px-3 py-2">Type</th>
                            <th className="px-3 py-2">Employee / Team</th>
                            <th className="px-3 py-2">Details</th>
                            <th className="px-3 py-2 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {manualEntries.map((row) => (
                            <tr key={row.row_id} className="border-b">
                              <td className="px-3 py-2 capitalize">{row.row_type}</td>
                              <td className="px-3 py-2">{row.employee_name}</td>
                              <td className="px-3 py-2 text-muted-foreground">
                                {row.row_type === "commuting"
                                  ? `${row.mode_value || "Commute"}${row.service_value ? ` â€¢ ${row.service_value}` : ""}${row.unit_value ? ` â€¢ ${row.unit_value}` : ""}`
                                  : `WFH ${row.annual_days || "?"} days, ${row.hours_per_day || "?"} hrs/day`}
                              </td>
                              <td className="px-3 py-2 text-right">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setManualEntries((current) => current.filter((item) => item.row_id !== row.row_id))}
                                >
                                  Remove
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </div>
            </details>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setCurrentStep(1)}>← Back to Setup</Button>
              <Button onClick={() => setCurrentStep(3)}>Continue to Job Data →</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stage 3: Job Data */}
      {currentStep === 3 && (
        <Card>
          <CardHeader><CardTitle>Stage 3: Job Data</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <div className="font-medium">Imported Workbook Rows</div>
              {importedRows.length > 0 ? (
                <div className="rounded-md border">
                  <div className="max-h-64 overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-background">
                        <tr className="border-b text-left">
                          <th className="px-3 py-2">Employee / Team</th>
                          <th className="px-3 py-2">Site</th>
                          <th className="px-3 py-2">Factor ID</th>
                          <th className="px-3 py-2">Report Label</th>
                          <th className="px-3 py-2 text-right">Qty</th>
                          <th className="px-3 py-2">Unit</th>
                          <th className="px-3 py-2 text-right">tCO₂e</th>
                          <th className="px-3 py-2">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importedRows.map((row) => (
                          <tr key={row.row_id} className="border-b align-top">
                            <td className="px-3 py-2">{row.employee_name || "-"}</td>
                            <td className="px-3 py-2">{row.site_name || "Organisation-wide / No site"}</td>
                            <td className="px-3 py-2 font-mono text-xs">{row.original_id || "-"}</td>
                            <td className="px-3 py-2">{row.report_label || "-"}</td>
                            <td className="px-3 py-2 text-right">{row.qty != null ? formatNumber(row.qty, 4) : "-"}</td>
                            <td className="px-3 py-2">{row.uom || "-"}</td>
                            <td className="px-3 py-2 text-right">{formatNumber(row.calc_tco2e, 4)}</td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">
                              {row.data_source ? <div>{row.data_source}</div> : null}
                              {row.unit_warning ? <div className="text-amber-700">{row.unit_warning}</div> : null}
                              {row.uses_emissions_fallback ? <div className="text-blue-700">Emissions fallback used</div> : null}
                              {row.notes ? <div>{row.notes}</div> : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No imported workbook rows found yet.</div>
              )}
            </div>

            <div className="space-y-2">
              <div className="font-medium">Saved Direct Entries</div>
              {directEntries.length > 0 ? (
                <div className="rounded-md border">
                  <div className="max-h-64 overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-background">
                        <tr className="border-b text-left">
                          <th className="px-3 py-2">Employee / Team</th>
                          <th className="px-3 py-2">Site</th>
                          <th className="px-3 py-2">Source</th>
                          <th className="px-3 py-2">Factor ID</th>
                          <th className="px-3 py-2 text-right">Qty</th>
                          <th className="px-3 py-2">Unit</th>
                          <th className="px-3 py-2 text-right">tCO₂e</th>
                          <th className="px-3 py-2 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {directEntries.map((row) => (
                          <tr key={row.source_id} className="border-b">
                            <td className="px-3 py-2">{row.employee_name || row.source_name}</td>
                            <td className="px-3 py-2">{row.site_name || "Organisation-wide / No site"}</td>
                            <td className="px-3 py-2">
                              <div className="font-medium">{row.source_subtype || "direct"}</div>
                              <div className="text-xs text-muted-foreground">{row.source_name}</div>
                            </td>
                            <td className="px-3 py-2">
                              <div className="font-mono text-xs">{row.original_id || "-"}</div>
                            </td>
                            <td className="px-3 py-2 text-right">{row.qty != null ? formatNumber(row.qty, 4) : "-"}</td>
                            <td className="px-3 py-2">{row.uom || ""}</td>
                            <td className="px-3 py-2 text-right">{formatNumber(row.calc_tco2e, 4)}</td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex justify-end gap-2">
                                <Button variant="outline" size="sm" onClick={() => startEditDirectEntry(row)}>
                                  Edit
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => removeDirectEntry(row.source_id, row.employee_name || row.source_name)}>
                                  Delete
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No direct entries saved yet.</div>
              )}
            </div>

            <div className="flex justify-start">
              <Button variant="outline" onClick={() => setCurrentStep(2)}>← Back to Add Data</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
