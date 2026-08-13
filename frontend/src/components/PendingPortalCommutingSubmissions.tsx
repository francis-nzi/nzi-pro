"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type PendingCommutingRow = {
  source_id: number;
  employee_name: string | null;
  source_subtype: string | null;
  qty: number | null;
  uom: string | null;
  factor: number | null;
  calc_tco2e: number | null;
  notes: string | null;
  review_status: "pending_review" | "rejected" | null;
  review_note: string | null;
};

type Props = {
  jobId: number;
  baseUrl: string;
  onReviewed?: () => void;
};

export default function PendingPortalCommutingSubmissions({ jobId, baseUrl, onReviewed }: Props) {
  const [rows, setRows] = useState<PendingCommutingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busySourceId, setBusySourceId] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [rejectingSourceId, setRejectingSourceId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkRejecting, setBulkRejecting] = useState(false);
  const [bulkNote, setBulkNote] = useState("");
  const [bulkError, setBulkError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/employee-commuting/pending-review`, { credentials: "include" });
      if (res.ok) {
        const json = await res.json();
        const nextRows: PendingCommutingRow[] = Array.isArray(json?.rows) ? json.rows : [];
        setRows(nextRows);
        const validIds = new Set(nextRows.map((r) => r.source_id));
        setSelected((prev) => new Set([...prev].filter((id) => validIds.has(id))));
      }
    } catch {
      // best-effort; the CRM commuting table itself remains the source of truth
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const someSelected = selected.size > 0 && !allSelected;

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.source_id)));
  }

  function toggleRow(sourceId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  }

  async function review(sourceId: number, decision: "approve" | "reject") {
    setBusySourceId(sourceId);
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/employee-commuting/${sourceId}/review`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: notes[sourceId] || null }),
      });
      if (res.ok) {
        setRows((prev) => prev.filter((r) => r.source_id !== sourceId));
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(sourceId);
          return next;
        });
        setRejectingSourceId(null);
        onReviewed?.();
      }
    } finally {
      setBusySourceId(null);
    }
  }

  async function bulkReview(decision: "approve" | "reject") {
    if (selected.size === 0) return;
    setBulkBusy(true);
    setBulkError("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/employee-commuting/bulk-review`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_ids: Array.from(selected), decision, note: bulkNote || null }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to ${decision} selected rows (${res.status})${t ? `: ${t}` : ""}`);
      }
      const json = await res.json();
      const reviewedIds = new Set<number>(json?.reviewed || []);
      setRows((prev) => prev.filter((r) => !reviewedIds.has(r.source_id)));
      setSelected((prev) => new Set([...prev].filter((id) => !reviewedIds.has(id))));
      setBulkRejecting(false);
      setBulkNote("");
      if (Array.isArray(json?.failed) && json.failed.length > 0) {
        setBulkError(
          `${json.failed.length} row(s) couldn't be ${decision === "approve" ? "approved" : "rejected"}: ` +
            json.failed.map((f: { source_id: number; reason: string }) => `#${f.source_id} (${f.reason})`).join(", ")
        );
      }
      onReviewed?.();
    } catch (e) {
      setBulkError((e as Error).message);
    } finally {
      setBulkBusy(false);
    }
  }

  const selectedCount = useMemo(() => selected.size, [selected]);

  if (!loading && rows.length === 0) return null;

  return (
    <Card className="border-amber-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Pending Portal Commuting Submissions
          {rows.length > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
              {rows.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 border-b pb-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={toggleSelectAll}
                  className="size-4"
                />
                Select all
              </label>
              {selectedCount > 0 && (
                <>
                  <span className="text-xs text-muted-foreground">{selectedCount} selected</span>
                  <div className="ml-auto flex gap-2">
                    <Button size="sm" disabled={bulkBusy} onClick={() => void bulkReview("approve")}>
                      {bulkBusy ? "Approving..." : `Approve ${selectedCount}`}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={bulkBusy}
                      onClick={() => setBulkRejecting((v) => !v)}
                    >
                      {`Reject ${selectedCount}`}
                    </Button>
                  </div>
                </>
              )}
            </div>

            {bulkRejecting && selectedCount > 0 && (
              <div className="flex flex-col gap-2 rounded-md border border-rose-200 bg-rose-50 p-3">
                <Textarea
                  placeholder="Reason for rejection, applied to all selected rows (shown to the client)"
                  value={bulkNote}
                  onChange={(e) => setBulkNote(e.target.value)}
                  className="text-sm"
                />
                <div>
                  <Button size="sm" variant="destructive" disabled={bulkBusy} onClick={() => void bulkReview("reject")}>
                    {bulkBusy ? "Rejecting..." : `Confirm Rejection of ${selectedCount}`}
                  </Button>
                </div>
              </div>
            )}

            {bulkError && <div className="text-xs text-rose-700">{bulkError}</div>}

            {rows.map((row) => (
              <div key={row.source_id} className="flex gap-3 rounded-md border p-3 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(row.source_id)}
                  onChange={() => toggleRow(row.source_id)}
                  className="mt-1 size-4 flex-shrink-0"
                />
                <div className="flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{row.employee_name || "Unnamed"} — {row.source_subtype || "commuting"}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.qty ?? "-"} {row.uom || ""} &middot; {row.calc_tco2e?.toFixed(4) ?? "-"} tCO&#8322;e
                      </div>
                      {row.review_status === "rejected" && (
                        <div className="mt-1 text-xs text-rose-700">
                          Previously rejected: {row.review_note || "no reason given"}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={busySourceId === row.source_id}
                        onClick={() => void review(row.source_id, "approve")}
                      >
                        {busySourceId === row.source_id ? "Approving..." : "Approve"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busySourceId === row.source_id}
                        onClick={() => setRejectingSourceId(rejectingSourceId === row.source_id ? null : row.source_id)}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                  {rejectingSourceId === row.source_id && (
                    <div className="mt-2 flex flex-col gap-2">
                      <Textarea
                        placeholder="Reason for rejection (shown to the client)"
                        value={notes[row.source_id] || ""}
                        onChange={(e) => setNotes((prev) => ({ ...prev, [row.source_id]: e.target.value }))}
                        className="text-sm"
                      />
                      <div>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={busySourceId === row.source_id}
                          onClick={() => void review(row.source_id, "reject")}
                        >
                          Confirm Rejection
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}
