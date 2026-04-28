"use client";

import { useEffect, useMemo, useState } from "react";
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
  estimated_emissions_kgco2e?: number | null;
  estimated_emissions_tco2e?: number | null;
};

type FactorItem = {
  db_id: number;
  report_label: string | null;
  scope: string | null;
  category: string | null;
  factor: number;
  dataset_name: string | null;
};

type JobSitesResponse = {
  sites: Array<{
    site_id: number | null;
    site_name: string | null;
  }>;
};

export default function SpendDataCollection({ jobId, baseUrl }: { jobId: number; baseUrl: string }) {
  const confirmAction = useConfirmDialog();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [entries, setEntries] = useState<SpendEntry[]>([]);
  const [summary, setSummary] = useState<{ count: number; mapped: number; unmapped: number; total_spend_net?: number; total_spend_gross: number; total_estimated_kgco2e?: number; total_estimated_tco2e: number } | null>(null);

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
  } | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);

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
    uploadFile,
    editDialogOpen,
    mappingDialogOpen,
    referenceCode,
    description,
    currency,
    amountNet,
    vatPct,
    notes,
    editReferenceCode,
    editDescription,
    editCurrency,
    editAmountNet,
    editVatPct,
    editNotes,
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

  const stepState = useMemo(() => {
    const setupDone = selectedSiteId !== "__none__";
    const ingestDone = hasRows;
    const mappingDone = hasRows && unmappedCount === 0;
    return { setupDone, ingestDone, mappingDone };
  }, [selectedSiteId, hasRows, unmappedCount]);

  const recommendedAction = useMemo(() => {
    if (currentStep === 1) {
      if (selectedSiteId === "__none__") return "Select a default site to start spend capture.";
      return "Setup complete. Continue to ingest spend data.";
    }
    if (currentStep === 2) {
      if (!hasRows) return "Load spend data using roll-forward, manual rows, or upload template.";
      if (unmappedCount > 0) return `Data loaded. Proceed to mapping (${unmappedCount} unmapped rows).`;
      return "All rows already mapped. Continue to review and push.";
    }
    if (currentStep === 3) {
      if (!hasRows) return "No rows available yet. Go to Ingest Data first.";
      if (unmappedCount > 0) return `Map remaining rows before push (${unmappedCount} unmapped).`;
      return "Mapping complete. Continue to review and push to emissions.";
    }
    if (currentStep === 4) {
      if (!hasRows) return "No rows to push yet. Go back to ingest data.";
      if (unmappedCount > 0) return `Cannot push yet: ${unmappedCount} unmapped rows remain.`;
      return "Ready: push mapped spend rows to emissions data.";
    }
    return "";
  }, [currentStep, selectedSiteId, hasRows, unmappedCount]);

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
        const rows = Array.isArray(data?.sites) ? data.sites : [];
        setSites(rows);
      } catch {
        // non-fatal
      }
    }
    loadSites();
  }, [baseUrl, jobId]);

  async function addManualRow() {
    if (!description.trim()) {
      setError("Spend description is required");
      return;
    }
    if (selectedSiteId === "__none__") {
      setError("Please choose a site");
      return;
    }
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
      setReferenceCode("");
      setDescription("");
      setAmountNet("");
      setVatPct("20");
      setNotes("");
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
    if (!uploadFile) {
      setUploadError("Please choose a CSV/XLSX file first");
      return;
    }
    if (selectedSiteId === "__none__") {
      setUploadError("Please choose a site for this upload");
      return;
    }
    setUploadError("");
    setLoading(true);
    setError("");
    setUploadProgress(0);
    setUploadPhase("Previewing upload...");
    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      const res = await uploadFormDataWithProgress(
        `${baseUrl}/jobs/${jobId}/spend-data/upload-preview?code_type=${encodeURIComponent(codeType)}&site_id=${encodeURIComponent(selectedSiteId)}`,
        {
          method: "POST",
          body: fd,
          onProgress: ({ percent }) => setUploadProgress(percent),
        }
      );
      if (!res.ok) throw new Error(`Preview failed (${res.status})`);
      const data = await res.json();
      setPreviewRows(Array.isArray(data?.items) ? data.items : []);
      setPreviewSummary(data?.summary ?? null);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Upload preview failed";
      setUploadError(message);
      setError(message);
    } finally {
      setLoading(false);
      setUploadProgress(0);
      setUploadPhase("");
    }
  }

  async function commitUpload() {
    if (!uploadFile) {
      setUploadError("Please choose a CSV/XLSX file first");
      return;
    }
    if (selectedSiteId === "__none__") {
      setUploadError("Please choose a site for this upload");
      return;
    }
    setUploadError("");
    setLoading(true);
    setError("");
    setStatus("");
    setUploadProgress(0);
    setUploadPhase("Importing upload...");
    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      const res = await uploadFormDataWithProgress(
        `${baseUrl}/jobs/${jobId}/spend-data/upload-commit?code_type=${encodeURIComponent(codeType)}&replace_existing=${replaceExisting ? "true" : "false"}&site_id=${encodeURIComponent(selectedSiteId)}`,
        {
          method: "POST",
          body: fd,
          onProgress: ({ percent }) => setUploadProgress(percent),
        }
      );
      if (!res.ok) throw new Error(`Upload commit failed (${res.status})`);
      const data = await res.json();
      setStatus(`Upload committed. Inserted ${data?.inserted ?? 0}; auto-mapped ${data?.auto_mapped ?? 0}.`);
      setPreviewRows([]);
      setPreviewSummary(null);
      await loadData();
      setCurrentStep(3);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Upload commit failed";
      setUploadError(message);
      setError(message);
    } finally {
      setLoading(false);
      setUploadProgress(0);
      setUploadPhase("");
    }
  }

  async function searchFactors(queryOverride?: string) {
    const queryToUse = (queryOverride ?? factorQuery).trim();
    setLoading(true);
    setError("");
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
      setError("Choose an entry and a factor first");
      return;
    }
    setLoading(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/spend-data/${selectedEntryId}/map`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factor_db_id: Number(selectedFactorId), confidence: "High", lock_mapping: true }),
      });
      if (!res.ok) throw new Error(`Mapping failed (${res.status})`);
      setStatus("Mapping saved and reusable for future years.");
      await loadData();
      if ((summary?.unmapped ?? 1) <= 1) {
        setCurrentStep(4);
      }
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
    if (!editDescription.trim()) {
      setError("Spend description is required");
      return;
    }
    if (editSiteId === "__none__") {
      setError("Please choose a site");
      return;
    }
    setLoading(true);
    setError("");
    setStatus("");
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
    setLoading(true);
    setError("");
    setStatus("");
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

  async function downloadTemplate() {
    if (selectedSiteId === "__none__") {
      setError("Please choose a site before downloading the template");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `${baseUrl}/jobs/${jobId}/spend-data/template?site_id=${encodeURIComponent(selectedSiteId)}`
      );
      if (!res.ok) throw new Error(`Template download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const disposition = res.headers.get("content-disposition") || "";
      const match = disposition.match(/filename="?([^"]+)"?/i);
      link.download = match?.[1] || `job-${jobId}-spend-template.xlsx`;
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
    setLoading(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/spend-data/sync-to-scope`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deactivate_missing: true }),
      });
      if (!res.ok) throw new Error(`Sync failed (${res.status})`);
      const data = await res.json();
      setStatus(
        `Spend sync complete. Created ${data?.created ?? 0}, updated ${data?.updated ?? 0}, deactivated ${data?.deactivated ?? 0}.`
      );
      dispatchJobScopeRefresh("spend-data");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setLoading(false);
    }
  }

  async function runRollforward(copyAmounts: boolean) {
    setRollforwardLoading(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/spend-data/rollforward`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ copy_amounts: copyAmounts, overwrite_existing: false }),
      });
      if (!res.ok) throw new Error(`Roll-forward failed (${res.status})`);
      const data = await res.json();
      setStatus(
        `Roll-forward complete from job ${data?.source_job_id ?? "-"}. Added ${data?.inserted ?? 0}, skipped ${data?.skipped ?? 0}.`
      );
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Roll-forward failed");
    } finally {
      setRollforwardLoading(false);
    }
  }

  async function approveAllSuggested() {
    setRollforwardLoading(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/spend-data/approve-suggested`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`Approve suggested failed (${res.status})`);
      const data = await res.json();
      setStatus(
        `Approved ${data?.approved ?? 0} suggested rows and locked ${data?.locked_mappings ?? 0} client mappings.`
      );
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Spend Data Collection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div>Capture spend rows from client accounts and keep mapping stable year-on-year via client-level reusable mappings.</div>
          {summary ? (
            <div className="grid gap-2 md:grid-cols-7">
              <div>Rows: <strong>{summary.count}</strong></div>
              <div>Mapped: <strong>{summary.mapped}</strong></div>
              <div>Unmapped: <strong>{summary.unmapped}</strong></div>
              <div>Total Spend (Net): <strong>{(summary.total_spend_net ?? 0).toLocaleString()}</strong></div>
              <div>Total Spend (Gross): <strong>{summary.total_spend_gross.toLocaleString()}</strong></div>
              <div>Estimated kgCO2e: <strong>{(summary.total_estimated_kgco2e ?? summary.total_estimated_tco2e * 1000).toLocaleString()}</strong></div>
              <div>Estimated tCO₂e: <strong>{summary.total_estimated_tco2e.toLocaleString()}</strong></div>
            </div>
          ) : null}
          {error ? <div className="text-destructive">{error}</div> : null}
          {status ? <div>{status}</div> : null}
          <div>
            <Button disabled={loading} onClick={syncToEmissionsData}>
              Push Mapped Spend Rows to Emissions Data
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Step-by-Step Process</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
            <strong>Recommended next action:</strong> {recommendedAction}
          </div>
          <div className="grid gap-2 md:grid-cols-4">
            <Button variant={currentStep === 1 ? "default" : "outline"} onClick={() => setCurrentStep(1)}>
              1. Setup
            </Button>
            <Button variant={currentStep === 2 ? "default" : "outline"} onClick={() => setCurrentStep(2)}>
              2. Ingest Data
            </Button>
            <Button variant={currentStep === 3 ? "default" : "outline"} onClick={() => setCurrentStep(3)}>
              3. Map Rows
            </Button>
            <Button variant={currentStep === 4 ? "default" : "outline"} onClick={() => setCurrentStep(4)}>
              4. Review & Push
            </Button>
          </div>
          <div className="grid gap-2 md:grid-cols-4 text-xs text-muted-foreground">
            <div>Setup: {stepState.setupDone ? "Done" : "Pending"}</div>
            <div>Rows: {totalCount > 0 ? `${totalCount} loaded` : "No rows yet"}</div>
            <div>Mapping: {mappedCount} mapped / {unmappedCount} unmapped</div>
            <div>Emissions Push: run when mapping is complete</div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" disabled={currentStep <= 1} onClick={() => setCurrentStep((s) => Math.max(1, s - 1))}>Back</Button>
            <Button
              disabled={
                (currentStep === 1 && !stepState.setupDone) ||
                (currentStep === 2 && !stepState.ingestDone) ||
                (currentStep === 3 && !stepState.mappingDone) ||
                currentStep >= 4
              }
              onClick={() => setCurrentStep((s) => Math.min(4, s + 1))}
            >
              Next
            </Button>
          </div>
        </CardContent>
      </Card>

      {currentStep === 1 ? (
      <Card>
        <CardHeader><CardTitle>Step 1: Setup</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <Label>Default Site *</Label>
            <Select value={selectedSiteId} onValueChange={(value) => { setSelectedSiteId(value); setUploadError(""); }}>
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
          <div className="flex items-end">
            <Button disabled={selectedSiteId === "__none__"} onClick={() => setCurrentStep(2)}>Continue to Ingest</Button>
          </div>
        </CardContent>
      </Card>
      ) : null}

      {currentStep === 2 ? (
      <Card>
        <CardHeader>
          <CardTitle>Step 2: Ingest Data</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div>Fast workflow: roll forward prior-year structure, upload current net spend, then auto-approve suggested mappings.</div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={rollforwardLoading || loading} onClick={() => runRollforward(false)}>
              1. Roll Forward Structure (Zero Amounts)
            </Button>
            <Button type="button" variant="outline" disabled={rollforwardLoading || loading} onClick={() => runRollforward(true)}>
              2. Roll Forward with Prior Amounts
            </Button>
            <Button type="button" disabled={rollforwardLoading || loading} onClick={approveAllSuggested}>
              3. Approve All Suggested Mappings
            </Button>
          </div>
        </CardContent>
      </Card>
      ) : null}

      {currentStep === 2 ? (
      <Card>
        <CardHeader><CardTitle>Manual Input</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-6">
          <div className="space-y-1">
            <Label>Site *</Label>
            <Select value={selectedSiteId} onValueChange={(value) => { setSelectedSiteId(value); setUploadError(""); }}>
              <SelectTrigger><SelectValue placeholder="Select site" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Select site</SelectItem>
                {sites
                  .filter((s) => s.site_id !== null && (s.site_name ?? "").trim().length > 0)
                  .map((s) => (
                    <SelectItem key={`manual-site-${s.site_id}`} value={String(s.site_id)}>
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
          <div className="space-y-1"><Label>Reference Code</Label><Input value={referenceCode} onChange={(e) => setReferenceCode(e.target.value)} /></div>
          <div className="space-y-1 md:col-span-2"><Label>Spend Description *</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="space-y-1"><Label>Currency</Label><Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></div>
          <div className="space-y-1"><Label>Spend Amount (Net Ex VAT)</Label><Input type="number" value={amountNet} onChange={(e) => setAmountNet(e.target.value)} /></div>
          <div className="space-y-1"><Label>VAT %</Label><Input type="number" value={vatPct} onChange={(e) => setVatPct(e.target.value)} /></div>
          <div className="space-y-1 md:col-span-3"><Label>Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <div className="md:col-span-2 flex items-end"><Button disabled={loading} onClick={addManualRow}>Add Spend Row</Button></div>
        </CardContent>
      </Card>
      ) : null}

      {currentStep === 2 ? (
      <Card>
        <CardHeader><CardTitle>Offline Upload (CSV/XLSX)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Site (required)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Select site</SelectItem>
                {sites
                  .filter((s) => s.site_id !== null && (s.site_name ?? "").trim().length > 0)
                  .map((s) => (
                    <SelectItem key={`site-${s.site_id ?? s.site_name}`} value={String(s.site_id)}>
                      {s.site_name}
                    </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" disabled={loading || selectedSiteId === "__none__"} onClick={downloadTemplate}>
              Download Template
            </Button>
            <Input
              type="file"
              accept=".csv,.xlsx"
              onChange={(e) => {
                setUploadFile(e.target.files?.[0] ?? null);
                setUploadError("");
              }}
              className="max-w-md"
            />
            <Button variant="outline" disabled={loading} onClick={previewUpload}>Preview Upload</Button>
            <Button disabled={loading} onClick={commitUpload}>Commit Upload</Button>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={replaceExisting} onChange={(e) => setReplaceExisting(e.target.checked)} />
              Replace existing spend rows
            </label>
            {uploadError ? <span className="self-center text-sm text-destructive">{uploadError}</span> : null}
          </div>
          {loading && uploadPhase ? (
            <UploadProgressBar value={uploadProgress} label={`${uploadPhase} ${uploadProgress > 0 ? `(${uploadProgress}%)` : ""}`} />
          ) : null}
          {previewSummary ? (
            <div className="text-sm">
              Preview: {previewSummary.count} rows, {previewSummary.mapped} auto-mapped, {previewSummary.unmapped} unmapped.
              {" "}Total Spend (Net): {(previewSummary.total_spend_net ?? 0).toLocaleString()}.
              {" "}Mapped Spend (Net): {(previewSummary.mapped_spend_net ?? 0).toLocaleString()}.
              {" "}Unmapped Spend (Net): {(previewSummary.unmapped_spend_net ?? 0).toLocaleString()}.
              {previewSummary.warning_count ? ` ${previewSummary.warning_count} factor warning(s).` : ""}
            </div>
          ) : null}
          {previewRows.length > 0 ? (
            <div className="max-h-72 overflow-auto rounded border">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr><th className="p-2 text-left">Site</th><th className="p-2 text-left">Code</th><th className="p-2 text-left">Description</th><th className="p-2 text-left">Net</th><th className="p-2 text-left">Gross</th><th className="p-2 text-left">Suggested Mapping</th><th className="p-2 text-left">Est tCO₂e</th><th className="p-2 text-left">Check</th></tr>
                </thead>
                <tbody>
                  {previewRows.slice(0, 100).map((r, idx) => (
                    <tr key={`pr-${idx}`} className="border-t">
                      <td className="p-2">{selectedSiteName}</td>
                      <td className="p-2">{r.reference_code || "-"}</td>
                      <td className="p-2">{r.spend_description}</td>
                      <td className="p-2">{r.currency} {(r.amount_net || 0).toLocaleString()}</td>
                      <td className="p-2">{r.currency} {r.amount_gross.toLocaleString()}</td>
                      <td className="p-2">{r.mapped_scope ? `${r.mapped_scope} - ${r.mapped_report_label || ""}` : "Unmapped"}</td>
                      <td className="p-2">{(r.estimated_emissions_tco2e || 0).toLocaleString()}</td>
                      <td className="p-2">
                        {r.unit_warning ? (
                          <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900" title={r.unit_warning}>
                            Unit warning
                          </span>
                        ) : (
                          <span className="text-muted-foreground">OK</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>
      ) : null}

      {currentStep === 3 ? (
      <Card>
        <CardHeader><CardTitle>Manual Mapping (Year-on-Year Reuse)</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <Label>Spend Row</Label>
            <Select value={selectedEntryId} onValueChange={setSelectedEntryId}>
              <SelectTrigger><SelectValue placeholder="Select spend row" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Select spend row</SelectItem>
                {entryOptions.map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Find Factor</Label>
            <div className="flex gap-2">
              <Input value={factorQuery} onChange={(e) => setFactorQuery(e.target.value)} placeholder="Search factor by label/category/id" />
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
                    {f.report_label || f.category || `Factor ${f.db_id}`} ({f.scope || "-"}) [{f.db_id}]
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-3">
            <Button disabled={loading} onClick={applyMapping}>Apply Mapping and Save for Future Years</Button>
          </div>
        </CardContent>
      </Card>
      ) : null}

      <Dialog open={mappingDialogOpen} onOpenChange={setMappingDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Allocate Spend Row</DialogTitle>
            <DialogDescription>
              Map the new spend row to a conversion factor so it can be pushed into emissions.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded border p-3 text-sm">
              <div><strong>Row:</strong> {selectedEntry ? `${selectedEntry.reference_code || "(no code)"} - ${selectedEntry.spend_description}` : "Not found"}</div>
              <div><strong>Site:</strong> {selectedEntry?.site_name || "-"}</div>
              <div><strong>Net:</strong> {selectedEntry?.currency || "GBP"} {(selectedEntry?.amount_net || 0).toLocaleString()}</div>
            </div>
            <div className="space-y-1">
              <Label>Find Factor</Label>
              <div className="flex gap-2">
                <Input value={factorQuery} onChange={(e) => setFactorQuery(e.target.value)} placeholder="Search factor by label/category/id" />
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
                      {f.report_label || f.category || `Factor ${f.db_id}`} ({f.scope || "-"}) [{f.db_id}]
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

      {(currentStep === 3 || currentStep === 4) ? (
      <Card>
        <CardHeader><CardTitle>Spend Rows</CardTitle></CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <div className="text-sm text-muted-foreground">No spend rows yet.</div>
          ) : (
            <div className="max-h-[520px] overflow-auto rounded border">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="p-2 text-left">Code</th>
                    <th className="p-2 text-left">Site</th>
                    <th className="p-2 text-left">Description</th>
                    <th className="p-2 text-left">Amount (Net)</th>
                    <th className="p-2 text-left">Amount (Gross)</th>
                    <th className="p-2 text-left">VAT %</th>
                    <th className="p-2 text-left">Mapping</th>
                    <th className="p-2 text-left">Est tCO₂e</th>
                    <th className="p-2 text-left">Check</th>
                    <th className="p-2 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((r) => (
                    <tr key={r.entry_id} className="border-t">
                      <td className="p-2">{r.reference_code || "-"}</td>
                      <td className="p-2">{r.site_name || "-"}</td>
                      <td className="p-2">{r.spend_description}</td>
                      <td className="p-2">{r.currency} {(r.amount_net || 0).toLocaleString()}</td>
                      <td className="p-2">{r.currency} {r.amount_gross.toLocaleString()}</td>
                      <td className="p-2">{r.vat_pct}</td>
                      <td className="p-2">{r.mapped_scope ? `${r.mapped_scope} - ${r.mapped_report_label || ""}` : "Unmapped"}</td>
                      <td className="p-2">{(r.estimated_emissions_tco2e || 0).toLocaleString()}</td>
                      <td className="p-2">
                        {r.unit_warning ? (
                          <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900" title={r.unit_warning}>
                            Unit warning
                          </span>
                        ) : (
                          <span className="text-muted-foreground">OK</span>
                        )}
                      </td>
                      <td className="p-2">
                        <div className="flex gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => openEditDialog(r)}>Edit</Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => deleteRow(r.entry_id)}>Delete</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      ) : null}

      {currentStep === 4 ? (
      <Card>
        <CardHeader><CardTitle>Step 4: Review & Push</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="text-muted-foreground">
            Review totals and confirm all rows are mapped before pushing to emissions.
          </div>
          <div className="grid gap-2 md:grid-cols-4">
            <div>Total rows: <strong>{totalCount}</strong></div>
            <div>Mapped rows: <strong>{mappedCount}</strong></div>
            <div>Unmapped rows: <strong>{unmappedCount}</strong></div>
            <div>Estimated tCO₂e: <strong>{(summary?.total_estimated_tco2e ?? 0).toLocaleString()}</strong></div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setCurrentStep(3)}>Back to Mapping</Button>
            <Button disabled={loading || unmappedCount > 0 || !hasRows} onClick={syncToEmissionsData}>
              Push Mapped Spend Rows to Emissions Data
            </Button>
          </div>
        </CardContent>
      </Card>
      ) : null}

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Spend Row</DialogTitle>
            <DialogDescription>Update spend values and mapping inputs for this row.</DialogDescription>
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
