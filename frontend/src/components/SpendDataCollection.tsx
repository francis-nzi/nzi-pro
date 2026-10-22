"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";
import UploadProgressBar from "@/components/UploadProgressBar";
import { uploadFormDataWithProgress } from "@/lib/upload-with-progress";
import { dispatchJobScopeRefresh } from "@/lib/job-scope-refresh";
import { useUnsavedChangesGuard } from "@/lib/useUnsavedChangesGuard";
import PendingPortalSpendSubmissions from "@/components/PendingPortalSpendSubmissions";
import SpendFactorRefreshBanner from "@/components/SpendFactorRefreshBanner";
import SpendFactorPicker, { type SpendFactor, type TopSpendFactor } from "@/components/SpendFactorPicker";

type SpendEntry = {
  entry_id: number;
  site_id?: number | null;
  site_name?: string | null;
  source_type: string;
  code_type: string;
  reference_code: string | null;
  spend_description: string;
  currency: string;
  amount_net: number;
  amount_gross: number;
  vat_pct: number;
  mapping_status: string;
  mapping_confidence: string | null;
  factor_db_id: number | null;
  factor_original_id: string | null;
  mapped_scope: string | null;
  mapped_category: string | null;
  mapped_report_label: string | null;
  factor_ghg_unit?: string | null;
  factor_value?: number | null;
  factor_uom?: string | null;
  unit_warning?: string | null;
  estimated_emissions_kgco2e: number;
  estimated_emissions_tco2e: number;
  notes?: string | null;
};

type SpendPreviewRow = {
  site_id?: number | null;
  amount_net?: number | null;
  reference_code: string;
  spend_description: string;
  currency: string;
  amount_gross: number;
  vat_pct: number;
  mapping_status: string;
  mapped_scope: string | null;
  mapped_report_label: string | null;
  factor_ghg_unit?: string | null;
  unit_warning?: string | null;
  id_mismatch_warning?: string | null;
  estimated_emissions_kgco2e?: number | null;
  estimated_emissions_tco2e?: number | null;
};

function isKgBasedUnit(unit?: string | null) {
  return Boolean(unit && unit.replace(/\s+/g, "").toLowerCase().includes("kg"));
}

function factorUnitBadgeClass(unit?: string | null, unitWarning?: string | null) {
  if (!unit) return "bg-slate-100 text-slate-800";
  if (isKgBasedUnit(unit) && !unitWarning) return "bg-emerald-100 text-emerald-900";
  return "bg-amber-100 text-amber-900";
}

type JobSitesResponse = {
  sites: Array<{ site_id: number | null; site_name: string | null }>;
};

export default function SpendDataCollection({ jobId, baseUrl }: { jobId: number; baseUrl: string }) {
  const confirmAction = useConfirmDialog();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [entries, setEntries] = useState<SpendEntry[]>([]);
  const [summary, setSummary] = useState<{
    count: number;
    mapped: number;
    unmapped: number;
    total_spend_net?: number;
    total_spend_gross: number;
    total_estimated_kgco2e?: number;
    total_estimated_tco2e: number;
  } | null>(null);

  const [codeType, setCodeType] = useState("nominal_code");
  const [referenceCode, setReferenceCode] = useState("");
  const [description, setDescription] = useState("");
  const [currency, setCurrency] = useState("GBP");
  const [amountNet, setAmountNet] = useState("");
  const [vatPct, setVatPct] = useState("20");
  const [notes, setNotes] = useState("");

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPhase, setUploadPhase] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [previewRows, setPreviewRows] = useState<SpendPreviewRow[]>([]);
  const [previewSummary, setPreviewSummary] = useState<{
    count: number;
    mapped: number;
    unmapped: number;
    total_spend_net?: number;
    mapped_spend_net?: number;
    unmapped_spend_net?: number;
    warning_count?: number;
    id_mismatch_count?: number;
  } | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [commitResult, setCommitResult] = useState<{ inserted: number; auto_mapped: number } | null>(null);
  type SyncConflict = {
    row_id: number;
    original_id: string;
    report_label?: string | null;
    site_id?: number | null;
    site_name?: string | null;
    existing_data_source?: string | null;
    existing_report_label?: string | null;
    existing_qty?: number | null;
    existing_uom?: string | null;
    existing_tco2e?: number | null;
    existing_notes?: string | null;
    other_matching_rows?: number | null;
    spend_amount?: number | null;
    spend_currency?: string | null;
    spend_lines?: number | null;
    spend_tco2e?: number | null;
    reason?: string | null;
  };
  type HeldBucket = { rows: number; amount_net: number };
  type HeldForReview = {
    rows: number;
    amount_net: number;
    amount_gross: number;
    unconfirmed?: HeldBucket;
    pending_review?: HeldBucket;
    rejected?: HeldBucket;
  };
  const [syncResult, setSyncResult] = useState<{
    created: number;
    updated: number;
    deactivated: number;
    conflicts: SyncConflict[];
    heldForReview: HeldForReview | null;
  } | null>(null);

  // The row whose mapping picker is open. The job's spend factors (a few
  // hundred at most) load once on first open and are filtered client-side.
  const [mappingEntryId, setMappingEntryId] = useState<number | null>(null);
  const [spendFactors, setSpendFactors] = useState<SpendFactor[]>([]);
  const [spendFactorsLoading, setSpendFactorsLoading] = useState(false);
  const [spendFactorsError, setSpendFactorsError] = useState("");
  const [topFactors, setTopFactors] = useState<TopSpendFactor[]>([]);
  const [rollforwardLoading, setRollforwardLoading] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<number | null>(null);
  const [editSiteId, setEditSiteId] = useState<string>("__none__");
  const [editReferenceCode, setEditReferenceCode] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCurrency, setEditCurrency] = useState("GBP");
  const [editAmountNet, setEditAmountNet] = useState("");
  const [editVatPct, setEditVatPct] = useState("20");
  const [editNotes, setEditNotes] = useState("");
  const [sites, setSites] = useState<Array<{ site_id: number | null; site_name: string | null }>>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>("__none__");
  const [currentStep, setCurrentStep] = useState<number>(1);

  const initialStepSet = useRef(false);

  const hasUnsavedChanges = useMemo(() => {
    return Boolean(
      uploadFile ||
        editDialogOpen ||
        mappingEntryId !== null ||
        referenceCode.trim() ||
        description.trim() ||
        currency.trim() ||
        amountNet.trim() ||
        vatPct.trim() ||
        notes.trim() ||
        editReferenceCode.trim() ||
        editDescription.trim() ||
        editCurrency.trim() ||
        editAmountNet.trim() ||
        editVatPct.trim() ||
        editNotes.trim()
    );
  }, [
    uploadFile, editDialogOpen, mappingEntryId, referenceCode, description,
    currency, amountNet, vatPct, notes, editReferenceCode, editDescription,
    editCurrency, editAmountNet, editVatPct, editNotes,
  ]);

  useUnsavedChangesGuard(hasUnsavedChanges);

  const selectedSiteName = useMemo(() => {
    if (selectedSiteId === "__none__") return "No Site Selected";
    const id = Number(selectedSiteId);
    const match = sites.find((s) => s.site_id === id);
    return match?.site_name || "No Site Selected";
  }, [selectedSiteId, sites]);

  const hasRows = (summary?.count ?? 0) > 0;

  // Sites that have spend lines, for choosing which ones a push covers. A
  // job's spend often arrives one site at a time; pushing every site each
  // time re-pushed (and clashed with) sites that were already settled.
  const pushSiteOptions = useMemo(() => {
    const seen = new Map<string, { key: string; site_id: number | null; label: string; lines: number }>();
    for (const e of entries) {
      const key = e.site_id == null ? "none" : String(e.site_id);
      const existing = seen.get(key);
      if (existing) existing.lines += 1;
      else seen.set(key, { key, site_id: e.site_id ?? null, label: e.site_name || (e.site_id == null ? "No site" : `Site ${e.site_id}`), lines: 1 });
    }
    return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [entries]);
  // Keys of sites left OUT of the push; empty = every site.
  const [pushExcludedSites, setPushExcludedSites] = useState<Set<string>>(new Set());
  const pushSiteCount = pushSiteOptions.filter((o) => !pushExcludedSites.has(o.key)).length;
  const unmappedCount = summary?.unmapped ?? 0;
  const mappedCount = summary?.mapped ?? 0;
  const totalCount = summary?.count ?? 0;

  const stepState = useMemo(() => ({
    setupDone: selectedSiteId !== "__none__",
    ingestDone: hasRows,
    mappingDone: hasRows && unmappedCount === 0,
  }), [selectedSiteId, hasRows, unmappedCount]);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/spend-data`);
      if (!res.ok) throw new Error(`Failed to load spend rows (${res.status})`);
      const data = await res.json();
      setEntries(Array.isArray(data?.items) ? data.items : []);
      setSummary(data?.summary ?? null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load spend rows");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, baseUrl]);

  useEffect(() => {
    async function loadSites() {
      try {
        const res = await fetch(`${baseUrl}/jobs/${jobId}/sites`);
        if (!res.ok) return;
        const data = (await res.json()) as JobSitesResponse;
        setSites(Array.isArray(data?.sites) ? data.sites : []);
      } catch {
        // non-fatal
      }
    }
    loadSites();
  }, [baseUrl, jobId]);

  // Auto-advance to the right step when data first loads
  useEffect(() => {
    if (!summary || initialStepSet.current) return;
    initialStepSet.current = true;
    const ingestDone = (summary?.count ?? 0) > 0;
    const mappingDone = ingestDone && (summary?.unmapped ?? 0) === 0;
    if (mappingDone) {
      setCurrentStep(4);
    } else if (ingestDone) {
      setCurrentStep(3);
    }
  }, [summary]);

  async function addManualRow() {
    if (!description.trim()) { setError("Spend description is required"); return; }
    if (selectedSiteId === "__none__") { setError("Please choose a site"); return; }
    setLoading(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/spend-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code_type: codeType,
          reference_code: referenceCode,
          spend_description: description,
          currency,
          site_id: Number(selectedSiteId),
          amount_net: Number(amountNet || 0),
          vat_pct: Number(vatPct || 0),
          notes: notes || null,
        }),
      });
      if (!res.ok) throw new Error(`Failed to save spend row (${res.status})`);
      const data = await res.json();
      setReferenceCode(""); setDescription(""); setAmountNet(""); setVatPct("20"); setNotes("");
      setStatus("Spend row added. Please complete mapping.");
      await loadData();
      setCurrentStep(3);
      if (data?.entry_id) openMappingPicker(Number(data.entry_id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save spend row");
    } finally {
      setLoading(false);
    }
  }

  async function previewUpload() {
    if (!uploadFile) { setUploadError("Please choose a CSV/XLSX file first"); return; }
    if (selectedSiteId === "__none__") { setUploadError("Please choose a site for this upload"); return; }
    setUploadError(""); setLoading(true); setError(""); setUploadProgress(0); setUploadPhase("Previewing upload...");
    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      const res = await uploadFormDataWithProgress(
        `${baseUrl}/jobs/${jobId}/spend-data/upload-preview?code_type=${encodeURIComponent(codeType)}&site_id=${encodeURIComponent(selectedSiteId)}`,
        { method: "POST", body: fd, onProgress: ({ percent }) => setUploadProgress(percent) }
      );
      if (!res.ok) throw new Error(`Preview failed (${res.status})`);
      const data = await res.json();
      setPreviewRows(Array.isArray(data?.items) ? data.items : []);
      setPreviewSummary(data?.summary ?? null);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Upload preview failed";
      setUploadError(message); setError(message);
    } finally {
      setLoading(false); setUploadProgress(0); setUploadPhase("");
    }
  }

  async function commitUpload() {
    if (!uploadFile) { setUploadError("Please choose a CSV/XLSX file first"); return; }
    if (selectedSiteId === "__none__") { setUploadError("Please choose a site for this upload"); return; }
    setUploadError(""); setLoading(true); setError(""); setStatus("");
    setUploadProgress(0); setUploadPhase("Importing upload...");
    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      const res = await uploadFormDataWithProgress(
        `${baseUrl}/jobs/${jobId}/spend-data/upload-commit?code_type=${encodeURIComponent(codeType)}&replace_existing=${replaceExisting ? "true" : "false"}&site_id=${encodeURIComponent(selectedSiteId)}`,
        { method: "POST", body: fd, onProgress: ({ percent }) => setUploadProgress(percent) }
      );
      if (!res.ok) throw new Error(`Upload commit failed (${res.status})`);
      const data = await res.json();
      setCommitResult({ inserted: data?.inserted ?? 0, auto_mapped: data?.auto_mapped ?? 0 });
      setPreviewRows([]);
      setPreviewSummary(null);
      await loadData();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Upload commit failed";
      setUploadError(message); setError(message);
    } finally {
      setLoading(false); setUploadProgress(0); setUploadPhase("");
    }
  }

  function openMappingPicker(entryId: number) {
    setMappingEntryId(entryId);
    if (spendFactors.length === 0) void loadSpendFactors();
    void loadTopFactors();
  }

  async function loadSpendFactors() {
    setSpendFactorsLoading(true);
    setSpendFactorsError("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/spend-data/factors/search?limit=1000`);
      if (!res.ok) throw new Error(`Couldn't load spend factors (${res.status}) — close this and try again.`);
      const data = await res.json();
      setSpendFactors(Array.isArray(data?.items) ? data.items : []);
    } catch (e: unknown) {
      setSpendFactorsError(e instanceof Error ? e.message : "Couldn't load spend factors — close this and try again.");
    } finally {
      setSpendFactorsLoading(false);
    }
  }

  async function loadTopFactors() {
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/spend-data/factors/top`);
      const data = res.ok ? await res.json() : null;
      setTopFactors(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setTopFactors([]);
    }
  }

  // Resolves to an error message, or null once saved.
  async function applyMapping(entryId: number, factorDbId: number): Promise<string | null> {
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/spend-data/${entryId}/map`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factor_db_id: factorDbId, confidence: "High", lock_mapping: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        return data?.detail || `Mapping failed (${res.status})`;
      }
    } catch (e: unknown) {
      return e instanceof Error ? e.message : "Mapping failed";
    }
    const wasUnmapped = entries.find((e) => e.entry_id === entryId)?.mapping_status === "unmapped";
    setMappingEntryId(null);
    setError("");
    setStatus("Mapping saved and reusable for future years. Push to emissions again to update reported figures.");
    await loadData();
    if (wasUnmapped && unmappedCount <= 1) setCurrentStep(4);
    return null;
  }

  function openEditDialog(row: SpendEntry) {
    setEditingEntryId(row.entry_id);
    setEditSiteId(row.site_id != null ? String(row.site_id) : "__none__");
    setEditReferenceCode(row.reference_code || "");
    setEditDescription(row.spend_description || "");
    setEditCurrency((row.currency || "GBP").toUpperCase());
    setEditAmountNet(String(row.amount_net ?? 0));
    setEditVatPct(String(row.vat_pct ?? 0));
    setEditNotes(row.notes || "");
    setEditDialogOpen(true);
  }

  // Read live from `entries` so a mapping changed from inside the Edit
  // dialog shows straight away.
  const editingEntry = entries.find((e) => e.entry_id === editingEntryId) ?? null;

  async function saveEditRow() {
    if (!editingEntryId) return;
    if (!editDescription.trim()) { setError("Spend description is required"); return; }
    if (editSiteId === "__none__") { setError("Please choose a site"); return; }
    setLoading(true); setError(""); setStatus("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/spend-data/${editingEntryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site_id: Number(editSiteId),
          reference_code: editReferenceCode,
          spend_description: editDescription,
          currency: editCurrency,
          amount_net: Number(editAmountNet || 0),
          vat_pct: Number(editVatPct || 0),
          notes: editNotes || null,
          // Only auto-map rows nobody has mapped by hand -- otherwise saving
          // an amount change could swap the chosen factor for a guess.
          remap: editingEntry?.mapping_status !== "mapped",
        }),
      });
      if (!res.ok) throw new Error(`Failed to update spend row (${res.status})`);
      setStatus("Spend row updated.");
      setEditDialogOpen(false);
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update spend row");
    } finally {
      setLoading(false);
    }
  }

  async function deleteRow(entryId: number) {
    const confirmed = await confirmAction({
      title: "Delete spend row?",
      description: "This spend row will be removed from the collection.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    setLoading(true); setError(""); setStatus("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/spend-data/${entryId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Failed to delete spend row (${res.status})`);
      setStatus("Spend row deleted.");
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete spend row");
    } finally {
      setLoading(false);
    }
  }

  async function deleteAllRows() {
    const confirmed = await confirmAction({
      title: "Delete all spend data?",
      description: `This will permanently delete all ${totalCount} spend row(s) for this job and remove any emissions data generated from them. This cannot be undone.`,
      confirmLabel: "Delete All",
      destructive: true,
    });
    if (!confirmed) return;
    setLoading(true); setError(""); setStatus("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/spend-data`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Failed to delete all spend data (${res.status})`);
      const data = await res.json();
      setStatus(`Deleted ${data?.deleted ?? 0} spend row(s) and reconciled emissions data.`);
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete all spend data");
    } finally {
      setLoading(false);
    }
  }

  async function downloadTemplate() {
    if (selectedSiteId === "__none__") { setError("Please choose a site before downloading the template"); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/spend-data/template?site_id=${encodeURIComponent(selectedSiteId)}`);
      if (!res.ok) throw new Error(`Template download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const xFilename = res.headers.get("x-filename");
      const disposition = res.headers.get("content-disposition") || "";
      const cdMatch = disposition.match(/filename="?([^"]+)"?/i);
      link.download = xFilename || cdMatch?.[1] || `job-${jobId}-spend-template.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Template download failed");
    } finally {
      setLoading(false);
    }
  }

  async function syncToEmissionsData() {
    setLoading(true); setError(""); setStatus("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/spend-data/sync-to-scope`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deactivate_missing: true,
          // Omitted when every site is ticked, so the push covers the whole job.
          ...(pushExcludedSites.size > 0
            ? { site_ids: pushSiteOptions.filter((o) => !pushExcludedSites.has(o.key)).map((o) => o.site_id) }
            : {}),
        }),
      });
      if (!res.ok) throw new Error(`Sync failed (${res.status})`);
      const data = await res.json();
      setSyncResult({
        created: data?.created ?? 0,
        updated: data?.updated ?? 0,
        deactivated: data?.deactivated ?? 0,
        conflicts: Array.isArray(data?.conflicts) ? (data.conflicts as SyncConflict[]) : [],
        heldForReview: (data?.held_for_review as HeldForReview | undefined) ?? null,
      });
      dispatchJobScopeRefresh("spend-data");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setLoading(false);
    }
  }

  async function runRollforward(copyAmounts: boolean) {
    setRollforwardLoading(true); setError(""); setStatus("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/spend-data/rollforward`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ copy_amounts: copyAmounts, overwrite_existing: false }),
      });
      if (!res.ok) throw new Error(`Roll-forward failed (${res.status})`);
      const data = await res.json();
      setStatus(`Roll-forward complete from job ${data?.source_job_id ?? "-"}. Added ${data?.inserted ?? 0}, skipped ${data?.skipped ?? 0}.`);
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Roll-forward failed");
    } finally {
      setRollforwardLoading(false);
    }
  }

  async function approveAllSuggested() {
    setRollforwardLoading(true); setError(""); setStatus("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/spend-data/approve-suggested`, { method: "POST" });
      if (!res.ok) throw new Error(`Approve suggested failed (${res.status})`);
      const data = await res.json();
      setStatus(`Approved ${data?.approved ?? 0} suggested rows and locked ${data?.locked_mappings ?? 0} client mappings.`);
      await loadData();
      setCurrentStep(4);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Approve suggested failed");
    } finally {
      setRollforwardLoading(false);
    }
  }

  const mappingEntry = entries.find((e) => e.entry_id === mappingEntryId) ?? null;

  const stages = [
    { num: 1, label: "Setup", done: stepState.setupDone },
    { num: 2, label: "Upload Data", done: stepState.ingestDone },
    { num: 3, label: "Map Rows", done: stepState.mappingDone },
    { num: 4, label: "Push", done: Boolean(syncResult) },
  ];

  return (
    <div className="space-y-6">

      <PendingPortalSpendSubmissions jobId={jobId} baseUrl={baseUrl} onReviewed={loadData} />

      <SpendFactorRefreshBanner jobId={jobId} baseUrl={baseUrl} />

      {/* Header: summary + feedback */}
      <Card>
        <CardHeader>
          <CardTitle>Spend Data Collection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {summary ? (
            <div className="grid gap-2 md:grid-cols-4">
              <div>Rows: <strong>{summary.count}</strong></div>
              <div>Mapped: <strong>{summary.mapped}</strong></div>
              <div>Unmapped: <strong>{summary.unmapped}</strong></div>
              <div>Est. tCO₂e: <strong>{(summary.total_estimated_tco2e ?? 0).toLocaleString()}</strong></div>
            </div>
          ) : null}
          {error ? (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          ) : null}
          {status ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{status}</div>
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

      {/* ── Stage 1: Setup ── */}
      {currentStep === 1 && (
        <Card>
          <CardHeader><CardTitle>Stage 1: Setup</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Select the default site and code type for this spend data collection.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Default Site *</Label>
                <Select
                  value={selectedSiteId}
                  onValueChange={(v) => { setSelectedSiteId(v); setUploadError(""); }}
                >
                  <SelectTrigger><SelectValue placeholder="Select site" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select site</SelectItem>
                    {sites
                      .filter((s) => s.site_id !== null && (s.site_name ?? "").trim().length > 0)
                      .map((s) => (
                        <SelectItem key={`setup-site-${s.site_id}`} value={String(s.site_id)}>
                          {s.site_name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Code Type</Label>
                <Select value={codeType} onValueChange={setCodeType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nominal_code">Nominal Code</SelectItem>
                    <SelectItem value="gl_code">GL Code</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button disabled={selectedSiteId === "__none__"} onClick={() => setCurrentStep(2)}>
              Continue to Upload Data →
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Stage 2: Upload Spend Data ── */}
      {currentStep === 2 && (
        <Card>
          <CardHeader><CardTitle>Stage 2: Upload Spend Data</CardTitle></CardHeader>
          <CardContent className="space-y-5">

            {/* PRIMARY: Template download + upload */}
            <div className="rounded-md border border-primary/20 bg-primary/5 p-4 space-y-4">
              <div>
                <h3 className="text-sm font-semibold">Download &amp; Upload Spend Template</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Download the Excel template, complete it with spend data, then upload it here.
                  {hasRows ? ` (${totalCount} rows currently loaded)` : ""}
                </p>
              </div>

              <Button variant="outline" disabled={loading || selectedSiteId === "__none__"} onClick={downloadTemplate}>
                Download Template
              </Button>

              <div className="space-y-2">
                <Label>Upload completed template</Label>
                <Input
                  type="file"
                  accept=".csv,.xlsx"
                  className="max-w-md"
                  onChange={(e) => {
                    setUploadFile(e.target.files?.[0] ?? null);
                    setUploadError("");
                    setCommitResult(null);
                  }}
                />
                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={replaceExisting}
                    onChange={(e) => setReplaceExisting(e.target.checked)}
                  />
                  Replace existing spend rows
                </label>
              </div>

              {loading && uploadPhase ? (
                <UploadProgressBar
                  value={uploadProgress}
                  label={`${uploadPhase}${uploadProgress > 0 ? ` (${uploadProgress}%)` : ""}`}
                />
              ) : null}

              {uploadError ? <div className="text-sm text-destructive">{uploadError}</div> : null}

              {previewSummary ? (
                <div className="rounded-md border bg-muted/50 px-3 py-2 text-sm">
                  Preview: <strong>{previewSummary.count}</strong> rows — <strong>{previewSummary.mapped}</strong> auto-mapped,{" "}
                  <strong>{previewSummary.unmapped}</strong> unmapped. Total net: {(previewSummary.total_spend_net ?? 0).toLocaleString()}.
                  {previewSummary.warning_count ? ` ${previewSummary.warning_count} factor warning(s).` : ""}
                  {previewSummary.id_mismatch_count ? ` ${previewSummary.id_mismatch_count} row(s) auto-corrected from a Spend Conversion id/text mismatch (likely Excel drag-fill) -- check source file.` : ""}
                </div>
              ) : null}

              {previewRows.length > 0 ? (
                <div className="max-h-64 overflow-auto rounded border text-sm">
                  <table className="w-full">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        <th className="p-2 text-left">Code</th>
                        <th className="p-2 text-left">Description</th>
                        <th className="p-2 text-left">Net</th>
                        <th className="p-2 text-left">Suggested Mapping</th>
                        <th className="p-2 text-left">Est tCO₂e</th>
                        <th className="p-2 text-left">Unit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.slice(0, 100).map((r, idx) => (
                        <tr key={`pr-${idx}`} className="border-t">
                          <td className="p-2">{r.reference_code || "-"}</td>
                          <td className="p-2">{r.spend_description}</td>
                          <td className="p-2">{r.currency} {(r.amount_net || 0).toLocaleString()}</td>
                          <td className="p-2">
                            {r.mapped_scope ? `${r.mapped_scope} – ${r.mapped_report_label || ""}` : "Unmapped"}
                            {r.id_mismatch_warning ? (
                              <span
                                className="ml-1.5 inline-flex rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
                                title={r.id_mismatch_warning}
                              >
                                auto-corrected
                              </span>
                            ) : null}
                          </td>
                          <td className="p-2">{(r.estimated_emissions_tco2e || 0).toLocaleString()}</td>
                          <td className="p-2">
                            {r.factor_ghg_unit ? (
                              <span
                                className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${factorUnitBadgeClass(r.factor_ghg_unit, r.unit_warning)}`}
                                title={r.unit_warning || `Factor unit: ${r.factor_ghg_unit}`}
                              >
                                {r.factor_ghg_unit}
                              </span>
                            ) : (
                              <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-800">missing</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {commitResult ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 font-medium">
                  ✓ Upload successful — {commitResult.inserted} rows imported, {commitResult.auto_mapped} auto-mapped.
                  Click &quot;Continue to Map Rows&quot; below to review and fix any unmapped rows.
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={!uploadFile || loading} onClick={previewUpload}>
                  Preview
                </Button>
                <Button disabled={!uploadFile || loading} onClick={commitUpload}>
                  Commit Upload
                </Button>
              </div>
            </div>

            {/* SECONDARY: Roll Forward */}
            <details className="rounded-md border group">
              <summary className="cursor-pointer select-none flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50 list-none">
                <span>Alternative: Roll Forward from Prior Year</span>
                <span className="text-muted-foreground text-xs">▼</span>
              </summary>
              <div className="border-t px-4 py-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Copy prior year spend structure to this job, then update amounts as needed.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={rollforwardLoading || loading} onClick={() => runRollforward(false)}>
                    Roll Forward Structure (Zero Amounts)
                  </Button>
                  <Button type="button" variant="outline" size="sm" disabled={rollforwardLoading || loading} onClick={() => runRollforward(true)}>
                    Roll Forward with Prior Amounts
                  </Button>
                  <Button type="button" size="sm" disabled={rollforwardLoading || loading} onClick={approveAllSuggested}>
                    Approve All Suggested Mappings
                  </Button>
                </div>
              </div>
            </details>

            {/* SECONDARY: Manual Entry */}
            <details className="rounded-md border">
              <summary className="cursor-pointer select-none flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50 list-none">
                <span>Alternative: Manual Entry</span>
                <span className="text-muted-foreground text-xs">▼</span>
              </summary>
              <div className="border-t px-4 py-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1">
                    <Label>Reference Code</Label>
                    <Input value={referenceCode} onChange={(e) => setReferenceCode(e.target.value)} />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <Label>Spend Description *</Label>
                    <Input value={description} onChange={(e) => setDescription(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label>Currency</Label>
                    <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
                  </div>
                  <div className="space-y-1">
                    <Label>Spend Amount (Net Ex VAT)</Label>
                    <Input type="number" value={amountNet} onChange={(e) => setAmountNet(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label>VAT %</Label>
                    <Input type="number" value={vatPct} onChange={(e) => setVatPct(e.target.value)} />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <Label>Notes</Label>
                    <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </div>
                  <div className="flex items-end">
                    <Button disabled={loading} onClick={addManualRow}>Add Spend Row</Button>
                  </div>
                </div>
              </div>
            </details>

            <div className="flex gap-2 border-t pt-4">
              <Button variant="outline" onClick={() => setCurrentStep(1)}>← Back</Button>
              <Button disabled={!stepState.ingestDone} onClick={() => setCurrentStep(3)}>
                Continue to Map Rows →
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Stage 3: Map Rows ── */}
      {currentStep === 3 && (
        <Card>
          <CardHeader><CardTitle>Stage 3: Map Rows</CardTitle></CardHeader>
          <CardContent className="space-y-4">

            {unmappedCount > 0 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <strong>{unmappedCount} row(s)</strong> need mapping before you can push to emissions.
                Click &ldquo;Unmapped — click to map&rdquo; on a row below.
              </div>
            ) : hasRows ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                ✓ All {mappedCount} rows are mapped and ready to push.
              </div>
            ) : null}

            {hasRows ? (
              <div className="flex justify-end">
                <Button variant="destructive" size="sm" onClick={() => void deleteAllRows()} disabled={loading}>
                  Delete All Spend Data ({totalCount})
                </Button>
              </div>
            ) : null}

            {/* Spend rows table */}
            {entries.length > 0 ? (
              <div className="max-h-[520px] overflow-auto rounded border">
                <table className="w-full text-sm">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="p-2 text-left">Code</th>
                      <th className="p-2 text-left">Site</th>
                      <th className="p-2 text-left">Description</th>
                      <th className="p-2 text-left">Amount (Net)</th>
                      <th className="p-2 text-left">VAT %</th>
                      <th className="p-2 text-left">Mapping</th>
                      <th className="p-2 text-left">Est tCO₂e</th>
                      <th className="p-2 text-left">Unit</th>
                      <th className="p-2 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((r) => (
                      <tr key={r.entry_id} className={["border-t", !r.mapped_scope ? "bg-amber-50/50" : ""].join(" ")}>
                        <td className="p-2">{r.reference_code || "-"}</td>
                        <td className="p-2">{r.site_name || "-"}</td>
                        <td className="p-2">{r.spend_description}</td>
                        <td className="p-2">{r.currency} {(r.amount_net || 0).toLocaleString()}</td>
                        <td className="p-2">{r.vat_pct}</td>
                        <td className="p-2 min-w-[16rem]">
                          {r.mapped_scope ? (
                            <div className="space-y-0.5">
                              <div className="text-emerald-800">
                                {r.mapped_report_label || "-"}
                                {r.mapping_status === "suggested" ? (
                                  <span
                                    className="ml-1.5 inline-flex rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
                                    title="Auto-suggested from this client's earlier mappings -- not confirmed by hand yet"
                                  >
                                    suggested
                                  </span>
                                ) : null}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {[r.mapped_scope, r.mapped_category].filter(Boolean).join(" · ")}
                              </div>
                              <div className="font-mono text-[11px] text-muted-foreground">
                                DB {r.factor_db_id ?? "-"}
                                {r.factor_original_id ? ` · ${r.factor_original_id}` : ""}
                              </div>
                              <button
                                type="button"
                                className="text-xs text-primary underline underline-offset-2 hover:text-primary/80"
                                onClick={() => openMappingPicker(r.entry_id)}
                              >
                                Change mapping
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="text-amber-700 underline underline-offset-2 hover:text-amber-900 text-left"
                              onClick={() => openMappingPicker(r.entry_id)}
                            >
                              Unmapped — click to map
                            </button>
                          )}
                        </td>
                        <td className="p-2">{(r.estimated_emissions_tco2e || 0).toLocaleString()}</td>
                        <td className="p-2">
                          {r.factor_ghg_unit ? (
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${factorUnitBadgeClass(r.factor_ghg_unit, r.unit_warning)}`}
                              title={r.unit_warning || `Factor unit: ${r.factor_ghg_unit}`}
                            >
                              {r.factor_ghg_unit}
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-800">missing</span>
                          )}
                        </td>
                        <td className="p-2">
                          <div className="flex gap-1">
                            <Button type="button" variant="outline" size="sm" onClick={() => openEditDialog(r)}>Edit</Button>
                            <Button type="button" variant="outline" size="sm" onClick={() => deleteRow(r.entry_id)}>Delete</Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No spend rows yet. Go back to Upload Data.</div>
            )}

            <div className="flex gap-2 border-t pt-4">
              <Button variant="outline" onClick={() => setCurrentStep(2)}>← Back</Button>
              <Button disabled={unmappedCount > 0 || !hasRows} onClick={() => setCurrentStep(4)}>
                Continue to Push →
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Stage 4: Push to Emissions ── */}
      {currentStep === 4 && (
        <Card>
          <CardHeader><CardTitle>Stage 4: Push to Emissions Data</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Review your spend summary, then push mapped rows into the emissions dataset.
            </p>

            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-md border p-3 text-center">
                <div className="text-2xl font-bold">{totalCount}</div>
                <div className="text-xs text-muted-foreground mt-1">Total Rows</div>
              </div>
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-center">
                <div className="text-2xl font-bold text-emerald-700">{mappedCount}</div>
                <div className="text-xs text-muted-foreground mt-1">Mapped</div>
              </div>
              <div className={["rounded-md border p-3 text-center", unmappedCount > 0 ? "border-amber-200 bg-amber-50" : ""].join(" ")}>
                <div className={["text-2xl font-bold", unmappedCount > 0 ? "text-amber-700" : ""].join(" ")}>{unmappedCount}</div>
                <div className="text-xs text-muted-foreground mt-1">Unmapped</div>
              </div>
              <div className="rounded-md border p-3 text-center">
                <div className="text-2xl font-bold">{(summary?.total_estimated_tco2e ?? 0).toLocaleString()}</div>
                <div className="text-xs text-muted-foreground mt-1">Est. tCO₂e</div>
              </div>
            </div>

            {unmappedCount > 0 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {unmappedCount} row(s) are still unmapped.{" "}
                <button type="button" className="underline underline-offset-2 font-medium" onClick={() => setCurrentStep(3)}>
                  Go back to Map Rows.
                </button>
              </div>
            ) : null}

            {pushSiteOptions.length > 1 ? (
              <div className="rounded-md border px-4 py-3 text-sm">
                <div className="font-medium">Sites to push</div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Only the ticked sites are pushed. Spend rows, manual rows and earlier pushes for unticked sites are
                  left exactly as they are in Data Entry.
                </p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {pushSiteOptions.map((o) => (
                    <label key={o.key} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={!pushExcludedSites.has(o.key)}
                        onChange={() =>
                          setPushExcludedSites((prev) => {
                            const next = new Set(prev);
                            if (next.has(o.key)) next.delete(o.key);
                            else next.add(o.key);
                            return next;
                          })
                        }
                      />
                      {o.label} <span className="text-xs text-muted-foreground">({o.lines})</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {syncResult ? (
              <div className="space-y-3">
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  <strong>✓ Spend pushed to Data Entry.</strong>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    <li>
                      <strong>{syncResult.created}</strong> new emission row(s) added
                    </li>
                    <li>
                      <strong>{syncResult.updated}</strong> existing row(s) had their spend figure refreshed
                    </li>
                    <li>
                      <strong>{syncResult.deactivated}</strong> spend row(s) switched off by this push — they came from an
                      earlier push and no longer match any approved, mapped spend line (for example the line was
                      remapped, deleted or sent back for review), so they no longer count
                    </li>
                  </ul>
                  <p className="mt-2 text-xs text-emerald-900/80">
                    Spend lines are combined into one emission row per factor per site, so these counts are emission
                    rows, not spend lines.
                  </p>
                </div>

                {syncResult.heldForReview && syncResult.heldForReview.rows > 0 ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    <strong>
                      {syncResult.heldForReview.rows} client portal spend line(s) were not pushed —{" "}
                      {`GBP ${(syncResult.heldForReview.amount_net ?? 0).toLocaleString()}`} net.
                    </strong>
                    <p className="mt-1">
                      Lines the client enters in the portal only count once they are approved here. They are still
                      included in the Mapped and Est. tCO₂e totals above, so those totals are higher than what reached
                      Data Entry.
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {(syncResult.heldForReview.unconfirmed?.rows ?? 0) > 0 ? (
                        <li>
                          <strong>{syncResult.heldForReview.unconfirmed?.rows}</strong> categorised by suggestion but not
                          yet confirmed by anyone ({`GBP ${(syncResult.heldForReview.unconfirmed?.amount_net ?? 0).toLocaleString()}`}).
                          These show as &ldquo;Not yet categorised&rdquo; in the portal. Approve them in{" "}
                          <em>Pending Portal Spend Submissions</em> at the top of this page if the category is right,
                          or ask the client to confirm or change it.
                        </li>
                      ) : null}
                      {(syncResult.heldForReview.pending_review?.rows ?? 0) > 0 ? (
                        <li>
                          <strong>{syncResult.heldForReview.pending_review?.rows}</strong> submitted by the client and
                          waiting for your review ({`GBP ${(syncResult.heldForReview.pending_review?.amount_net ?? 0).toLocaleString()}`}).
                          Approve them in <em>Pending Portal Spend Submissions</em> at the top of this page.
                        </li>
                      ) : null}
                      {(syncResult.heldForReview.rejected?.rows ?? 0) > 0 ? (
                        <li>
                          <strong>{syncResult.heldForReview.rejected?.rows}</strong> rejected and sent back to the client
                          ({`GBP ${(syncResult.heldForReview.rejected?.amount_net ?? 0).toLocaleString()}`}). They stay out
                          until the client re-picks a category and you approve it.
                        </li>
                      ) : null}
                    </ul>
                    <p className="mt-2">Re-push after approving to bring them into Data Entry.</p>
                  </div>
                ) : null}

                {syncResult.conflicts.length > 0 ? (
                  <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                    <strong>
                      {syncResult.conflicts.length} spend total(s) were not pushed because Data Entry already has a
                      row for the same factor and site.
                    </strong>
                    <p className="mt-1">
                      Someone has entered (or uploaded) a row in Data Entry using the same emission factor, for the same
                      site, as these spend lines. Pushing as well would count that spend twice, so nothing was
                      overwritten and no duplicate was added. For each one below, compare the two figures and decide
                      which to report:
                    </p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">
                      <li>
                        <strong>Use the spend figure:</strong> in Data Entry, delete or switch off the existing row, then
                        Re-Push.
                      </li>
                      <li>
                        <strong>Keep the existing row:</strong> do nothing. The spend lines stay out of the report and
                        this notice will show again on each push.
                      </li>
                    </ul>
                    <div className="mt-3 space-y-2">
                      {syncResult.conflicts.map((c) => (
                        <div key={`${c.original_id}-${c.row_id}`} className="rounded border border-red-200 bg-white/70 p-2">
                          <div>
                            <span className="font-medium">{c.report_label || c.original_id}</span>{" "}
                            <span className="font-mono text-xs">({c.original_id})</span>
                            {c.site_name ? <> · {c.site_name}</> : c.site_id == null ? <> · no site</> : null}
                          </div>
                          <div className="mt-1 grid gap-1 text-xs sm:grid-cols-2">
                            <div>
                              <div className="font-semibold">Existing Data Entry row #{c.row_id}</div>
                              <div>
                                Source: {c.existing_data_source || "Company Data"}
                                {c.existing_report_label && c.existing_report_label !== c.report_label
                                  ? ` · ${c.existing_report_label}`
                                  : ""}
                              </div>
                              {typeof c.existing_qty === "number" ? (
                                <div>
                                  {c.existing_qty.toLocaleString()} {c.existing_uom || ""}
                                  {typeof c.existing_tco2e === "number" ? ` → ${c.existing_tco2e.toLocaleString()} tCO₂e` : ""}
                                </div>
                              ) : null}
                              {c.existing_notes ? <div className="italic">Note: {c.existing_notes}</div> : null}
                              {c.other_matching_rows ? (
                                <div>Plus {c.other_matching_rows} more row(s) with the same factor and site.</div>
                              ) : null}
                            </div>
                            <div>
                              <div className="font-semibold">Spend not pushed</div>
                              {typeof c.spend_amount === "number" ? (
                                <div>
                                  {c.spend_currency || "GBP"} {c.spend_amount.toLocaleString()} gross
                                  {c.spend_lines ? ` from ${c.spend_lines} spend line(s)` : ""}
                                  {typeof c.spend_tco2e === "number" ? ` → ${c.spend_tco2e.toLocaleString()} tCO₂e` : ""}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setCurrentStep(3)}>← Back to Map Rows</Button>
              <Button disabled={loading || unmappedCount > 0 || !hasRows || pushSiteCount === 0} onClick={syncToEmissionsData}>
                {loading
                  ? "Pushing…"
                  : `${syncResult ? "Re-Push" : "Push"}${pushExcludedSites.size > 0 ? ` ${pushSiteCount} site(s)` : ""} to Emissions`}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Edit dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Spend Row</DialogTitle>
            <DialogDescription>Update spend values for this row.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Site *</Label>
              <Select value={editSiteId} onValueChange={setEditSiteId}>
                <SelectTrigger><SelectValue placeholder="Select site" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select site</SelectItem>
                  {sites
                    .filter((s) => s.site_id !== null && (s.site_name ?? "").trim().length > 0)
                    .map((s) => (
                      <SelectItem key={`edit-site-${s.site_id}`} value={String(s.site_id)}>
                        {s.site_name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Reference Code</Label>
              <Input value={editReferenceCode} onChange={(e) => setEditReferenceCode(e.target.value)} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Spend Description *</Label>
              <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Currency</Label>
              <Input value={editCurrency} onChange={(e) => setEditCurrency(e.target.value.toUpperCase())} />
            </div>
            <div className="space-y-1">
              <Label>Spend Amount (Net Ex VAT)</Label>
              <Input type="number" value={editAmountNet} onChange={(e) => setEditAmountNet(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>VAT %</Label>
              <Input type="number" value={editVatPct} onChange={(e) => setEditVatPct(e.target.value)} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Notes</Label>
              <Input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
            </div>
          </div>

          {editingEntry ? (
            <div className="mt-4 rounded-md border bg-muted/30 p-3 text-sm">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="font-semibold">Mapping</span>
                <Button type="button" variant="outline" size="sm" onClick={() => openMappingPicker(editingEntry.entry_id)}>
                  {editingEntry.factor_db_id ? "Change mapping" : "Map this row"}
                </Button>
              </div>
              {editingEntry.factor_db_id ? (
                <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground">Factor</dt>
                  <dd>
                    {editingEntry.mapped_report_label || "-"}
                    {editingEntry.mapping_status === "suggested" ? (
                      <span className="ml-1.5 inline-flex rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                        suggested
                      </span>
                    ) : null}
                  </dd>
                  <dt className="text-muted-foreground">Scope</dt>
                  <dd>{editingEntry.mapped_scope || "-"}</dd>
                  <dt className="text-muted-foreground">Category</dt>
                  <dd>{editingEntry.mapped_category || "-"}</dd>
                  <dt className="text-muted-foreground">DB ID</dt>
                  <dd className="font-mono">{editingEntry.factor_db_id}</dd>
                  <dt className="text-muted-foreground">Original ID</dt>
                  <dd className="font-mono">{editingEntry.factor_original_id || "-"}</dd>
                  <dt className="text-muted-foreground">Factor value</dt>
                  <dd className="font-mono">
                    {editingEntry.factor_value != null
                      ? `${editingEntry.factor_value.toLocaleString("en-GB", { maximumSignificantDigits: 4 })} ${[editingEntry.factor_ghg_unit, editingEntry.factor_uom].filter(Boolean).join("/")}`
                      : "-"}
                  </dd>
                  <dt className="text-muted-foreground">Est. tCO₂e</dt>
                  <dd className="font-mono">{(editingEntry.estimated_emissions_tco2e || 0).toLocaleString()}</dd>
                </dl>
              ) : (
                <p className="text-muted-foreground">Not mapped yet.</p>
              )}
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
            <Button type="button" disabled={loading} onClick={saveEditRow}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* After the Edit dialog so it stacks on top when opened from there. */}
      <Dialog open={mappingEntry !== null} onOpenChange={(open) => { if (!open) setMappingEntryId(null); }}>
        {mappingEntry ? (
          <SpendFactorPicker
            row={mappingEntry}
            factors={spendFactors}
            loading={spendFactorsLoading}
            loadError={spendFactorsError}
            frequentlyUsed={topFactors}
            onPick={(factor) => applyMapping(mappingEntry.entry_id, factor.db_id)}
            onClose={() => setMappingEntryId(null)}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
