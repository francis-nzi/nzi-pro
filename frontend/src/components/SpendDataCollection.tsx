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
  mapped_scope: string | null;
  mapped_report_label: string | null;
  factor_ghg_unit?: string | null;
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

type FactorItem = {
  db_id: number;
  report_label: string | null;
  scope: string | null;
  category: string | null;
  factor: number;
  ghg_unit?: string | null;
  unit_warning?: string | null;
  dataset_name: string | null;
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
  const [syncResult, setSyncResult] = useState<{ created: number; updated: number; deactivated: number } | null>(null);

  const [factorQuery, setFactorQuery] = useState("");
  const [factorResults, setFactorResults] = useState<FactorItem[]>([]);
  const [selectedEntryId, setSelectedEntryId] = useState<string>("__none__");
  const [selectedFactorId, setSelectedFactorId] = useState<string>("__none__");
  const [mappingDialogOpen, setMappingDialogOpen] = useState(false);
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
        mappingDialogOpen ||
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
    uploadFile, editDialogOpen, mappingDialogOpen, referenceCode, description,
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
      const spendDescription = description.trim();
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
      if (data?.entry_id) {
        setSelectedEntryId(String(data.entry_id));
        setSelectedFactorId("__none__");
      }
      if (spendDescription.length > 0) {
        setFactorQuery(spendDescription);
        await searchFactors(spendDescription);
      } else {
        setFactorResults([]);
      }
      setMappingDialogOpen(true);
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

  async function searchFactors(queryOverride?: string) {
    const queryToUse = (queryOverride ?? factorQuery).trim();
    setLoading(true); setError("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/spend-data/factors/search?q=${encodeURIComponent(queryToUse)}&limit=30`);
      if (!res.ok) throw new Error(`Factor search failed (${res.status})`);
      const data = await res.json();
      setFactorResults(Array.isArray(data?.items) ? data.items : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Factor search failed");
    } finally {
      setLoading(false);
    }
  }

  async function applyMapping() {
    if (selectedEntryId === "__none__" || selectedFactorId === "__none__") {
      setError("Choose an entry and a factor first"); return;
    }
    setLoading(true); setError(""); setStatus("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/spend-data/${selectedEntryId}/map`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factor_db_id: Number(selectedFactorId), confidence: "High", lock_mapping: true }),
      });
      if (!res.ok) throw new Error(`Mapping failed (${res.status})`);
      setStatus("Mapping saved and reusable for future years.");
      await loadData();
      if ((summary?.unmapped ?? 1) <= 1) setCurrentStep(4);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Mapping failed");
    } finally {
      setLoading(false);
    }
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
          remap: true,
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
        body: JSON.stringify({ deactivate_missing: true }),
      });
      if (!res.ok) throw new Error(`Sync failed (${res.status})`);
      const data = await res.json();
      setSyncResult({ created: data?.created ?? 0, updated: data?.updated ?? 0, deactivated: data?.deactivated ?? 0 });
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

  const entryOptions = useMemo(
    () => entries.map((e) => ({ value: String(e.entry_id), label: `${e.reference_code || "(no code)"} - ${e.spend_description}` })),
    [entries]
  );
  const selectedEntry = useMemo(
    () => entries.find((e) => String(e.entry_id) === selectedEntryId) ?? null,
    [entries, selectedEntryId]
  );

  const stages = [
    { num: 1, label: "Setup", done: stepState.setupDone },
    { num: 2, label: "Upload Data", done: stepState.ingestDone },
    { num: 3, label: "Map Rows", done: stepState.mappingDone },
    { num: 4, label: "Push", done: Boolean(syncResult) },
  ];

  return (
    <div className="space-y-6">

      <PendingPortalSpendSubmissions jobId={jobId} baseUrl={baseUrl} onReviewed={loadData} />

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
                Click an unmapped row below or use the mapping panel.
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
                        <td className="p-2">
                          {r.mapped_scope ? (
                            <span className="text-emerald-700">{r.mapped_scope} – {r.mapped_report_label || ""}</span>
                          ) : (
                            <button
                              type="button"
                              className="text-amber-700 underline underline-offset-2 hover:text-amber-900 text-left"
                              onClick={() => {
                                setSelectedEntryId(String(r.entry_id));
                                setSelectedFactorId("__none__");
                                setFactorResults([]);
                                setMappingDialogOpen(true);
                              }}
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

            {/* Manual mapping panel */}
            {unmappedCount > 0 ? (
              <div className="rounded-md border p-4 space-y-3">
                <h3 className="text-sm font-semibold">Map a Spend Row</h3>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1">
                    <Label>Spend Row</Label>
                    <Select value={selectedEntryId} onValueChange={setSelectedEntryId}>
                      <SelectTrigger><SelectValue placeholder="Select spend row" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Select spend row</SelectItem>
                        {entryOptions.map((x) => (
                          <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Search Factor</Label>
                    <div className="flex gap-2">
                      <Input
                        value={factorQuery}
                        onChange={(e) => setFactorQuery(e.target.value)}
                        placeholder="Label, category, or ID"
                        onKeyDown={(e) => { if (e.key === "Enter") searchFactors(); }}
                      />
                      <Button variant="outline" size="sm" onClick={() => searchFactors()}>Search</Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Factor</Label>
                    <Select value={selectedFactorId} onValueChange={setSelectedFactorId}>
                      <SelectTrigger><SelectValue placeholder="Select factor" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Select factor</SelectItem>
                        {factorResults.map((f) => (
                          <SelectItem key={f.db_id} value={String(f.db_id)}>
                            {f.report_label || f.category || `Factor ${f.db_id}`} ({f.scope || "-"}) [{f.db_id}]
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button
                  disabled={loading || selectedEntryId === "__none__" || selectedFactorId === "__none__"}
                  onClick={applyMapping}
                >
                  Apply Mapping
                </Button>
              </div>
            ) : null}

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

            {syncResult ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                <strong>✓ Emissions data updated.</strong> Created {syncResult.created}, updated {syncResult.updated},
                deactivated {syncResult.deactivated} rows.
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setCurrentStep(3)}>← Back to Map Rows</Button>
              <Button disabled={loading || unmappedCount > 0 || !hasRows} onClick={syncToEmissionsData}>
                {loading ? "Pushing…" : syncResult ? "Re-Push to Emissions" : "Push Spend Rows to Emissions Data"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Mapping dialog */}
      <Dialog open={mappingDialogOpen} onOpenChange={setMappingDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Map Spend Row</DialogTitle>
            <DialogDescription>
              Assign a conversion factor. The mapping will be reused automatically for future years.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded border p-3 text-sm">
              <div><strong>Row:</strong> {selectedEntry ? `${selectedEntry.reference_code || "(no code)"} – ${selectedEntry.spend_description}` : "Not found"}</div>
              <div><strong>Site:</strong> {selectedEntry?.site_name || "-"}</div>
              <div><strong>Net:</strong> {selectedEntry?.currency || "GBP"} {(selectedEntry?.amount_net || 0).toLocaleString()}</div>
            </div>
            <div className="space-y-1">
              <Label>Search Factor</Label>
              <div className="flex gap-2">
                <Input
                  value={factorQuery}
                  onChange={(e) => setFactorQuery(e.target.value)}
                  placeholder="Search by label, category, or ID"
                  onKeyDown={(e) => { if (e.key === "Enter") searchFactors(); }}
                />
                <Button variant="outline" onClick={() => searchFactors()}>Search</Button>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Factor</Label>
              <Select value={selectedFactorId} onValueChange={setSelectedFactorId}>
                <SelectTrigger><SelectValue placeholder="Select factor" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select factor</SelectItem>
                  {factorResults.map((f) => (
                    <SelectItem key={f.db_id} value={String(f.db_id)}>
                      <span className="min-w-0 truncate">
                        {f.report_label || f.category || `Factor ${f.db_id}`} ({f.scope || "-"}) [{f.db_id}]
                      </span>
                      {(f.ghg_unit || f.unit_warning) ? (
                        <span
                          className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${factorUnitBadgeClass(f.ghg_unit, f.unit_warning)}`}
                          title={f.unit_warning || undefined}
                        >
                          {f.ghg_unit ? `Unit: ${f.ghg_unit}` : "Unit missing"}
                        </span>
                      ) : null}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMappingDialogOpen(false)}>Skip for now</Button>
            <Button
              disabled={loading || selectedEntryId === "__none__" || selectedFactorId === "__none__"}
              onClick={async () => {
                await applyMapping();
                setMappingDialogOpen(false);
              }}
            >
              Save Mapping
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
            <Button type="button" disabled={loading} onClick={saveEditRow}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
