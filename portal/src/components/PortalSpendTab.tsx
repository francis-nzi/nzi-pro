"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
};

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

  const [jobNumber, setJobNumber] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<number | null>(null);
  const [editRefCode, setEditRefCode] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editNetValue, setEditNetValue] = useState("");
  const [editVatPct, setEditVatPct] = useState("");
  const [rowActionSaving, setRowActionSaving] = useState(false);

  useEffect(() => {
    void loadRows();
  }, []);

  async function loadRows() {
    setLoading(true);
    setError("");
    setNoJobMessage("");
    try {
      const res = await apiFetch("/portal/spend/rows");
      if (res.ok) {
        const d = await res.json();
        setRows(d.rows || []);
        setJobNumber(d.job_number || null);
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

  async function loadTopCategories() {
    try {
      const res = await apiFetch("/portal/spend/categories/top");
      setTopCategories(res.ok ? (await res.json()).items || [] : []);
    } catch {
      setTopCategories([]);
    }
  }

  function openCategoryPicker(entryId: number) {
    setCategorizingEntryId(entryId);
    setCategorySearch("");
    void searchCategories("");
    void loadTopCategories();
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

      {!noJobMessage && (
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">{rows.length} spend line(s) submitted</div>
        <Button onClick={() => setShowAdd((v) => !v)}>{showAdd ? "Cancel" : "+ Add Spend Line"}</Button>
      </div>
      )}

      {!noJobMessage && showAdd && (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="text-xs text-muted-foreground">GL / Nominal Code (optional)</label>
                <Input value={refCode} onChange={(e) => setRefCode(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Description</label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Net Value (excl. VAT)</label>
                <Input type="number" value={netValue} onChange={(e) => setNetValue(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">VAT %</label>
                <Input type="number" value={vatPct} onChange={(e) => setVatPct(e.target.value)} />
              </div>
            </div>
            <Button disabled={saving || !description.trim() || !netValue.trim()} onClick={() => void addRow()}>
              {saving ? "Submitting..." : "Submit Spend Line"}
            </Button>
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
                        {isEditing ? <Input value={editRefCode} onChange={(e) => setEditRefCode(e.target.value)} className="h-7 w-24" /> : row.reference_code || "-"}
                      </td>
                      <td className="p-2">
                        {isEditing ? <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} className="h-7" /> : row.spend_description}
                      </td>
                      <td className="p-2 text-right font-mono">
                        {isEditing ? (
                          <Input type="number" value={editNetValue} onChange={(e) => setEditNetValue(e.target.value)} className="ml-auto h-7 w-24 text-right" />
                        ) : (
                          row.amount_net?.toFixed(2) ?? "-"
                        )}
                      </td>
                      <td className="p-2 text-right font-mono">
                        {isEditing ? (
                          <Input type="number" value={editVatPct} onChange={(e) => setEditVatPct(e.target.value)} className="ml-auto h-7 w-16 text-right" />
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
                        {isApproved ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : isEditing ? (
                          <div className="flex items-center justify-end gap-2">
                            <Button size="sm" variant="outline" disabled={rowActionSaving || !editDescription.trim() || !editNetValue.trim()} onClick={() => void saveEdit(row.entry_id)}>
                              Save
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingEntryId(null)}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-3 text-xs">
                            <button className="text-primary hover:underline" onClick={() => startEdit(row)}>Edit</button>
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
                          <Button size="sm" variant="outline" className="mt-2" onClick={() => setCategorizingEntryId(null)}>
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
    </div>
  );
}
