"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { EmptyStatePanel, ErrorPanel, SkeletonLoader } from "@/components/shared/DataStates";

type SpendCategory = {
  db_id: number;
  original_id: string | null;
  scope: string | null;
  category: string | null;
  report_label: string | null;
};

type TopSpendCategory = {
  db_id: number;
  scope: string | null;
  category: string | null;
  report_label: string | null;
  use_count: number;
};

type SuggestedSpendLine = {
  spend_line_id: number;
  label: string;
  factor_db_id: number | null;
  scope: string | null;
  category: string | null;
  report_label: string | null;
  score: number;
};

type SpendRow = {
  entry_id: number;
  reference_code: string | null;
  spend_description: string | null;
  currency: string | null;
  amount_net: number | null;
  amount_gross: number | null;
  vat_pct: number | null;
  mapped_category: string | null;
  mapped_report_label: string | null;
  mapping_status: string | null;
  review_status: "pending_review" | "approved" | "rejected" | null;
  review_note: string | null;
  month_1: number | null; month_2: number | null; month_3: number | null; month_4: number | null;
  month_5: number | null; month_6: number | null; month_7: number | null; month_8: number | null;
  month_9: number | null; month_10: number | null; month_11: number | null; month_12: number | null;
};

const MONTH_LABELS = ["Month 1", "Month 2", "Month 3", "Month 4", "Month 5", "Month 6", "Month 7", "Month 8", "Month 9", "Month 10", "Month 11", "Month 12"];
const MONTH_FIELDS = ["month_1", "month_2", "month_3", "month_4", "month_5", "month_6", "month_7", "month_8", "month_9", "month_10", "month_11", "month_12"] as const;

const MAX_GL_CODE_LENGTH = 15;
const MAX_VAT_PCT = 100;
const MAX_NET_VALUE = 999_999_999;

function isValidRefCode(v: string): boolean {
  return v.trim().length <= MAX_GL_CODE_LENGTH;
}
function isValidNetValue(v: string): boolean {
  if (!v.trim()) return false;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= MAX_NET_VALUE;
}
function isValidVatPct(v: string): boolean {
  if (!v.trim()) return true;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= MAX_VAT_PCT;
}

const REVIEW_LABEL: Record<string, { label: string; className: string }> = {
  pending_review: { label: "Awaiting review", className: "bg-amber-100 text-amber-800" },
  approved: { label: "Approved", className: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "Rejected — please review", className: "bg-rose-100 text-rose-800" },
};

export default function PortalSpendTab() {
  const [rows, setRows] = useState<SpendRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [noJobMessage, setNoJobMessage] = useState("");
  const [dataEntryExpired, setDataEntryExpired] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [refCode, setRefCode] = useState("");
  const [description, setDescription] = useState("");
  const [netValue, setNetValue] = useState("");
  const [vatPct, setVatPct] = useState("20");
  const [saving, setSaving] = useState(false);

  const [categorizingEntryId, setCategorizingEntryId] = useState<number | null>(null);
  const [categorySearch, setCategorySearch] = useState("");
  const [categoryOptions, setCategoryOptions] = useState<SpendCategory[]>([]);
  const [searchingCategories, setSearchingCategories] = useState(false);
  const [topCategories, setTopCategories] = useState<TopSpendCategory[]>([]);
  const [suggestedSpendLines, setSuggestedSpendLines] = useState<SuggestedSpendLine[]>([]);
  const [suggesting, setSuggesting] = useState(false);

  const [jobNumber, setJobNumber] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<number | null>(null);
  const [editRefCode, setEditRefCode] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editNetValue, setEditNetValue] = useState("");
  const [editVatPct, setEditVatPct] = useState("");
  const [rowActionSaving, setRowActionSaving] = useState(false);

  const [monthlyEntryId, setMonthlyEntryId] = useState<number | null>(null);
  const [monthlyValues, setMonthlyValues] = useState<string[]>(Array(12).fill(""));
  const [monthlySaving, setMonthlySaving] = useState(false);

  const [bulkSuggesting, setBulkSuggesting] = useState(false);
  const [bulkSuggestStatus, setBulkSuggestStatus] = useState("");

  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<Record<string, unknown>[]>([]);
  const [uploadPreviewCount, setUploadPreviewCount] = useState(0);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadResult, setUploadResult] = useState<{ inserted: number; skipped: { row: number; spend_description: string; reason: string }[] } | null>(null);

  useEffect(() => {
    void loadRows();
  }, []);

  async function loadRows() {
    setLoading(true);
    setError("");
    setNoJobMessage("");
    setDataEntryExpired(false);
    try {
      const res = await apiFetch("/portal/spend/rows");
      if (res.ok) {
        const d = await res.json();
        setRows(d.rows || []);
        setJobNumber(d.job_number || null);
        setDataEntryExpired(Boolean(d.portal_data_entry_expired));
      } else if (res.status === 404) {
        const d = await res.json().catch(() => ({}));
        setNoJobMessage(d?.detail || "No open job found for this account yet — contact your NZI consultant.");
      } else {
        setError("Failed to load your submitted spend data.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function runBulkSuggest() {
    setBulkSuggesting(true);
    setBulkSuggestStatus("");
    setError("");
    try {
      const res = await apiFetch("/portal/spend/suggest-categories-bulk", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d?.detail || "Failed to suggest categories.");
        return;
      }
      setBulkSuggestStatus(
        d.applied > 0
          ? `Categorised ${d.applied} of ${d.total} line(s). ${d.skipped > 0 ? `${d.skipped} need manual review.` : ""}`
          : "No confident matches found — pick categories manually below."
      );
      void loadRows();
    } finally {
      setBulkSuggesting(false);
    }
  }

  async function addRow() {
    if (!description.trim() || !netValue.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch("/portal/spend/rows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference_code: refCode.trim(),
          spend_description: description.trim(),
          amount_net: Number(netValue),
          vat_pct: Number(vatPct || 0),
        }),
      });
      if (res.ok) {
        setShowAdd(false);
        setRefCode("");
        setDescription("");
        setNetValue("");
        setVatPct("20");
        void loadRows();
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d?.detail || "Failed to submit this spend line.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function downloadTemplate() {
    try {
      const res = await apiFetch("/portal/spend/template");
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "spend-data-template.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Failed to download template.");
    }
  }

  async function previewBulkUpload() {
    if (!uploadFile) return;
    setUploadBusy(true);
    setUploadError("");
    setUploadResult(null);
    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      const res = await apiFetch("/portal/spend/upload-preview", { method: "POST", body: fd });
      if (res.ok) {
        const d = await res.json();
        setUploadPreview(d.preview || []);
        setUploadPreviewCount(d.count || 0);
      } else {
        const d = await res.json().catch(() => ({}));
        setUploadError(d?.detail || "Couldn't read that file — check it matches the template.");
      }
    } finally {
      setUploadBusy(false);
    }
  }

  async function commitBulkUpload() {
    if (!uploadFile) return;
    setUploadBusy(true);
    setUploadError("");
    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      const res = await apiFetch("/portal/spend/upload-commit", { method: "POST", body: fd });
      if (res.ok) {
        const d = await res.json();
        setUploadResult({ inserted: d.inserted || 0, skipped: d.skipped || [] });
        setUploadPreview([]);
        setUploadPreviewCount(0);
        setUploadFile(null);
        void loadRows();
      } else {
        const d = await res.json().catch(() => ({}));
        setUploadError(d?.detail || "Failed to import this file.");
      }
    } finally {
      setUploadBusy(false);
    }
  }

  async function loadTopCategories() {
    try {
      const res = await apiFetch("/portal/spend/categories/top");
      setTopCategories(res.ok ? (await res.json()).items || [] : []);
    } catch {
      setTopCategories([]);
    }
  }

  async function suggestSpendLine(entryId: number) {
    setSuggesting(true);
    try {
      const res = await apiFetch(`/portal/spend/rows/${entryId}/suggest-category`);
      setSuggestedSpendLines(res.ok ? (await res.json()).items || [] : []);
    } catch {
      setSuggestedSpendLines([]);
    } finally {
      setSuggesting(false);
    }
  }

  function openCategoryPicker(entryId: number) {
    setCategorizingEntryId(entryId);
    setCategorySearch("");
    setSuggestedSpendLines([]);
    void searchCategories("");
    void loadTopCategories();
    void suggestSpendLine(entryId);
  }

  async function searchCategories(text: string) {
    setSearchingCategories(true);
    try {
      const res = await apiFetch(`/portal/spend/categories/search?q=${encodeURIComponent(text)}`);
      if (res.ok) {
        const d = await res.json();
        setCategoryOptions(d.items || []);
      }
    } finally {
      setSearchingCategories(false);
    }
  }

  async function confirmCategory(entryId: number, category: { db_id: number }) {
    const res = await apiFetch(`/portal/spend/rows/${entryId}/confirm-category`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ factor_db_id: category.db_id }),
    });
    if (res.ok) {
      setCategorizingEntryId(null);
      setCategorySearch("");
      setCategoryOptions([]);
      setSuggestedSpendLines([]);
      void loadRows();
    }
  }

  function startEdit(row: SpendRow) {
    setEditingEntryId(row.entry_id);
    setEditRefCode(row.reference_code || "");
    setEditDescription(row.spend_description || "");
    setEditNetValue(row.amount_net !== null && row.amount_net !== undefined ? String(row.amount_net) : "");
    setEditVatPct(row.vat_pct !== null && row.vat_pct !== undefined ? String(row.vat_pct) : "0");
  }

  async function saveEdit(entryId: number) {
    if (!editDescription.trim() || !editNetValue.trim()) return;
    setRowActionSaving(true);
    setError("");
    try {
      const res = await apiFetch(`/portal/spend/rows/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference_code: editRefCode.trim(),
          spend_description: editDescription.trim(),
          amount_net: Number(editNetValue),
          vat_pct: Number(editVatPct || 0),
        }),
      });
      if (res.ok) {
        setEditingEntryId(null);
        void loadRows();
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d?.detail || "Failed to update this spend line.");
      }
    } finally {
      setRowActionSaving(false);
    }
  }

  async function deleteRow(entryId: number) {
    if (!window.confirm("Delete this spend line? This can't be undone.")) return;
    setRowActionSaving(true);
    setError("");
    try {
      const res = await apiFetch(`/portal/spend/rows/${entryId}`, { method: "DELETE" });
      if (res.ok) {
        void loadRows();
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d?.detail || "Failed to delete this spend line.");
      }
    } finally {
      setRowActionSaving(false);
    }
  }

  function openMonthlyModal(row: SpendRow) {
    setMonthlyEntryId(row.entry_id);
    setMonthlyValues(MONTH_FIELDS.map((f) => (row[f] !== null && row[f] !== undefined ? String(row[f]) : "")));
  }

  function copyFirstMonthToAll() {
    if (!monthlyValues[0]) return;
    setMonthlyValues(Array(12).fill(monthlyValues[0]));
  }

  const monthlyTotal = monthlyValues.reduce((sum, v) => sum + (Number(v) || 0), 0);

  async function saveMonthlyBreakdown() {
    if (monthlyEntryId === null) return;
    setMonthlySaving(true);
    setError("");
    try {
      const payload: Record<string, unknown> = { amount_net: monthlyTotal };
      MONTH_FIELDS.forEach((field, idx) => {
        payload[field] = monthlyValues[idx].trim() === "" ? null : Number(monthlyValues[idx]);
      });
      const res = await apiFetch(`/portal/spend/rows/${monthlyEntryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setMonthlyEntryId(null);
        void loadRows();
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d?.detail || "Failed to save the monthly breakdown.");
      }
    } finally {
      setMonthlySaving(false);
    }
  }

  const uncategorizedCount = rows.filter((r) => r.mapping_status !== "mapped").length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Add spend lines from your nominal/general ledger — GL code, description, net value and VAT% only. Pick a
        category for each line; your NZI consultant reviews and approves before it counts toward your reported
        emissions.
      </p>
      {jobNumber && <p className="-mt-2 text-xs text-muted-foreground">Job: {jobNumber}</p>}

      {error && <ErrorPanel description={error} />}
      {noJobMessage && <EmptyStatePanel title="Not available yet for this account" description={noJobMessage} />}

      {!noJobMessage && dataEntryExpired && (
        <EmptyStatePanel
          title="Data entry is closed for this period"
          description="The data collection deadline has passed. Contact your NZI consultant if you still need to submit or edit data here."
        />
      )}

      {!noJobMessage && (
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {rows.length} spend line(s) submitted
          {uncategorizedCount > 0 && ` · ${uncategorizedCount} not yet categorised`}
        </div>
        {!dataEntryExpired && (
          <div className="flex gap-2">
            {uncategorizedCount > 0 && (
              <Button variant="outline" onClick={() => void runBulkSuggest()} disabled={bulkSuggesting}>
                {bulkSuggesting ? "Suggesting…" : `Suggest Categories (${uncategorizedCount})`}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                setShowBulkUpload((v) => !v);
                setUploadError("");
                setUploadResult(null);
                setUploadPreview([]);
                setUploadPreviewCount(0);
                setUploadFile(null);
              }}
            >
              {showBulkUpload ? "Cancel" : "Bulk Upload (CSV/XLSX)"}
            </Button>
            <Button onClick={() => setShowAdd((v) => !v)}>{showAdd ? "Cancel" : "+ Add Spend Line"}</Button>
          </div>
        )}
      </div>
      )}
      {bulkSuggestStatus && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {bulkSuggestStatus}
        </div>
      )}

      {!noJobMessage && !dataEntryExpired && showBulkUpload && (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void downloadTemplate()}>
                Download Template
              </Button>
              <Input
                type="file"
                accept=".csv,.xlsx"
                className="w-auto"
                onChange={(e) => {
                  setUploadFile(e.target.files?.[0] || null);
                  setUploadPreview([]);
                  setUploadPreviewCount(0);
                  setUploadResult(null);
                  setUploadError("");
                }}
              />
              <Button size="sm" disabled={!uploadFile || uploadBusy} onClick={() => void previewBulkUpload()}>
                {uploadBusy ? "Working..." : "Preview"}
              </Button>
            </div>
            {uploadError && <div className="text-xs text-rose-700">{uploadError}</div>}
            {uploadPreviewCount > 0 && (
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">
                  Found {uploadPreviewCount} row(s). Showing first {uploadPreview.length}:
                </div>
                <div className="max-h-48 overflow-y-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="p-1.5 text-left">GL Code</th>
                        <th className="p-1.5 text-left">Description</th>
                        <th className="p-1.5 text-right">Net</th>
                        <th className="p-1.5 text-right">VAT%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {uploadPreview.map((r, idx) => (
                        <tr key={idx} className="border-b last:border-0">
                          <td className="p-1.5">{String(r.reference_code ?? "-")}</td>
                          <td className="p-1.5">{String(r.spend_description ?? "-")}</td>
                          <td className="p-1.5 text-right font-mono">{String(r.amount_net ?? "-")}</td>
                          <td className="p-1.5 text-right font-mono">{String(r.vat_pct ?? "-")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Button size="sm" disabled={uploadBusy} onClick={() => void commitBulkUpload()}>
                  {uploadBusy ? "Importing..." : `Confirm & Import ${uploadPreviewCount} Row(s)`}
                </Button>
              </div>
            )}
            {uploadResult && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
                Imported {uploadResult.inserted} row(s).
                {uploadResult.skipped.length > 0 && (
                  <div className="mt-1 text-rose-700">
                    {uploadResult.skipped.length} row(s) skipped:
                    <ul className="list-disc pl-4">
                      {uploadResult.skipped.map((s, idx) => (
                        <li key={idx}>
                          Row {s.row} ({s.spend_description || "no description"}): {s.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!noJobMessage && !dataEntryExpired && showAdd && (
        <Card>
          <CardContent className="space-y-2 pt-4">
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-28">
                <label className="text-xs text-muted-foreground">GL / Nominal Code</label>
                <Input
                  value={refCode}
                  maxLength={MAX_GL_CODE_LENGTH}
                  onChange={(e) => setRefCode(e.target.value)}
                  placeholder="optional"
                />
              </div>
              <div className="min-w-[12rem] flex-1">
                <label className="text-xs text-muted-foreground">Description</label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div className="w-32">
                <label className="text-xs text-muted-foreground">Net Value (excl. VAT)</label>
                <Input type="number" min={0} max={MAX_NET_VALUE} value={netValue} onChange={(e) => setNetValue(e.target.value)} />
              </div>
              <div className="w-20">
                <label className="text-xs text-muted-foreground">VAT %</label>
                <Input type="number" min={0} max={MAX_VAT_PCT} value={vatPct} onChange={(e) => setVatPct(e.target.value)} />
              </div>
              <Button
                disabled={saving || !description.trim() || !isValidNetValue(netValue) || !isValidVatPct(vatPct) || !isValidRefCode(refCode)}
                onClick={() => void addRow()}
              >
                {saving ? "Submitting..." : "Submit Spend Line"}
              </Button>
            </div>
            {!isValidRefCode(refCode) && (
              <div className="text-xs text-rose-700">GL / Nominal Code must be {MAX_GL_CODE_LENGTH} characters or fewer.</div>
            )}
            {netValue.trim() !== "" && !isValidNetValue(netValue) && (
              <div className="text-xs text-rose-700">Net Value must be between 0 and {MAX_NET_VALUE.toLocaleString()}.</div>
            )}
            {vatPct.trim() !== "" && !isValidVatPct(vatPct) && (
              <div className="text-xs text-rose-700">VAT % must be between 0 and {MAX_VAT_PCT}.</div>
            )}
          </CardContent>
        </Card>
      )}

      {!noJobMessage && (loading ? (
        <SkeletonLoader />
      ) : rows.length === 0 ? (
        <EmptyStatePanel title="No spend data submitted yet." />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-2 text-left">Code</th>
                <th className="p-2 text-left">Description</th>
                <th className="p-2 text-right">Net</th>
                <th className="p-2 text-right">VAT%</th>
                <th className="p-2 text-left">Category</th>
                <th className="p-2 text-left">Status</th>
                <th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const review = row.review_status ? REVIEW_LABEL[row.review_status] : null;
                const isApproved = row.review_status === "approved";
                const isEditing = editingEntryId === row.entry_id;
                return (
                  <>
                    <tr key={row.entry_id} className="border-b last:border-0">
                      <td className="p-2">
                        {isEditing ? (
                          <Input
                            value={editRefCode}
                            maxLength={MAX_GL_CODE_LENGTH}
                            onChange={(e) => setEditRefCode(e.target.value)}
                            className="h-7 w-24"
                          />
                        ) : (
                          row.reference_code || "-"
                        )}
                      </td>
                      <td className="p-2">
                        {isEditing ? <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} className="h-7" /> : row.spend_description}
                      </td>
                      <td className="p-2 text-right font-mono">
                        {isEditing ? (
                          <Input
                            type="number"
                            min={0}
                            max={MAX_NET_VALUE}
                            value={editNetValue}
                            onChange={(e) => setEditNetValue(e.target.value)}
                            className="ml-auto h-7 w-24 text-right"
                          />
                        ) : (
                          row.amount_net?.toFixed(2) ?? "-"
                        )}
                      </td>
                      <td className="p-2 text-right font-mono">
                        {isEditing ? (
                          <Input
                            type="number"
                            min={0}
                            max={MAX_VAT_PCT}
                            value={editVatPct}
                            onChange={(e) => setEditVatPct(e.target.value)}
                            className="ml-auto h-7 w-16 text-right"
                          />
                        ) : (
                          row.vat_pct ?? 0
                        )}
                      </td>
                      <td className="p-2">
                        {row.mapped_report_label || row.mapped_category || (
                          <button className="text-primary underline" onClick={() => openCategoryPicker(row.entry_id)}>
                            Pick a category
                          </button>
                        )}
                        {row.mapping_status === "mapped" && row.review_status !== "approved" && (
                          <button className="ml-2 text-xs text-primary underline" onClick={() => openCategoryPicker(row.entry_id)}>
                            change
                          </button>
                        )}
                      </td>
                      <td className="p-2">
                        {review ? (
                          <>
                            <span className={`rounded-full px-2 py-0.5 text-xs ${review.className}`}>{review.label}</span>
                            {row.review_status === "rejected" && row.review_note && (
                              <div className="mt-1 text-xs text-muted-foreground">{row.review_note}</div>
                            )}
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">Not yet categorised</span>
                        )}
                      </td>
                      <td className="p-2 text-right">
                        {isApproved || dataEntryExpired ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : isEditing ? (
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                rowActionSaving ||
                                !editDescription.trim() ||
                                !isValidNetValue(editNetValue) ||
                                !isValidVatPct(editVatPct) ||
                                !isValidRefCode(editRefCode)
                              }
                              onClick={() => void saveEdit(row.entry_id)}
                            >
                              Save
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingEntryId(null)}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-3 text-xs">
                            <button className="text-primary hover:underline" onClick={() => startEdit(row)}>Edit</button>
                            <button className="text-primary hover:underline" onClick={() => openMonthlyModal(row)}>Monthly</button>
                            <button className="text-rose-700 hover:underline disabled:opacity-50" disabled={rowActionSaving} onClick={() => void deleteRow(row.entry_id)}>
                              Delete
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                    {categorizingEntryId === row.entry_id && (
                      <tr>
                        <td colSpan={7} className="border-b bg-muted/30 p-3">
                          {suggesting && (
                            <div className="mb-2 text-xs text-muted-foreground">Suggesting a Spend Line from this row&apos;s description...</div>
                          )}
                          {!categorySearch.trim() && suggestedSpendLines.length > 0 && (
                            <div className="mb-2 space-y-1.5">
                              <label className="text-xs font-medium text-muted-foreground">Suggested from this line&apos;s description</label>
                              <div className="flex flex-wrap gap-1.5">
                                {suggestedSpendLines.map((sl) => (
                                  <button
                                    key={sl.spend_line_id}
                                    className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs text-emerald-800 hover:bg-emerald-100"
                                    disabled={!sl.factor_db_id}
                                    onClick={() => sl.factor_db_id && void confirmCategory(row.entry_id, { db_id: sl.factor_db_id })}
                                  >
                                    {sl.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          {!categorySearch.trim() && topCategories.length > 0 && (
                            <div className="mb-2 space-y-1.5">
                              <label className="text-xs font-medium text-muted-foreground">Frequently used</label>
                              <div className="flex flex-wrap gap-1.5">
                                {topCategories.map((cat) => (
                                  <button
                                    key={cat.db_id}
                                    className="rounded-full border bg-background px-3 py-1 text-xs hover:bg-muted"
                                    onClick={() => void confirmCategory(row.entry_id, cat)}
                                  >
                                    {cat.report_label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          <Input
                            placeholder="Search spend categories..."
                            value={categorySearch}
                            onChange={(e) => {
                              setCategorySearch(e.target.value);
                              void searchCategories(e.target.value);
                            }}
                            className="mb-2"
                          />
                          {searchingCategories ? (
                            <div className="text-sm text-muted-foreground">Searching...</div>
                          ) : (
                            <div className="max-h-48 overflow-y-auto rounded-md border bg-background">
                              {categoryOptions.length === 0 ? (
                                <div className="p-2 text-sm text-muted-foreground">No matches.</div>
                              ) : (
                                categoryOptions.slice(0, 30).map((cat) => (
                                  <button
                                    key={cat.db_id}
                                    className="block w-full border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-muted"
                                    onClick={() => void confirmCategory(row.entry_id, cat)}
                                  >
                                    {cat.report_label}
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2"
                            onClick={() => {
                              setCategorizingEntryId(null);
                              setSuggestedSpendLines([]);
                            }}
                          >
                            Cancel
                          </Button>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      <Dialog open={monthlyEntryId !== null} onOpenChange={(open) => !open && setMonthlyEntryId(null)}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Monthly Breakdown</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">
              Split this line&apos;s Net Value across the months it covers -- useful if your reporting year spans two
              calendar years. Saving here replaces the Net Value with the sum of these months.
            </p>
            <Button size="sm" variant="outline" onClick={copyFirstMonthToAll} disabled={!monthlyValues[0]}>
              Copy First Month to All
            </Button>
            <div className="grid grid-cols-3 gap-2">
              {MONTH_LABELS.map((label, idx) => (
                <div key={label}>
                  <label className="text-xs text-muted-foreground">{label}</label>
                  <Input
                    type="number"
                    min={0}
                    value={monthlyValues[idx]}
                    onChange={(e) =>
                      setMonthlyValues((prev) => prev.map((v, i) => (i === idx ? e.target.value : v)))
                    }
                  />
                </div>
              ))}
            </div>
            <div className="rounded-md border bg-muted/30 p-2 text-xs">
              Monthly Total: <span className="font-mono">{monthlyTotal.toLocaleString()}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMonthlyEntryId(null)}>
              Cancel
            </Button>
            <Button onClick={() => void saveMonthlyBreakdown()} disabled={monthlySaving}>
              {monthlySaving ? "Saving..." : "Save Monthly Breakdown"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
