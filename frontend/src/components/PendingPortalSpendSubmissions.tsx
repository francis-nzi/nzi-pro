"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import BulkSelectionBar from "@/components/BulkSelectionBar";
import { useBulkSelection } from "@/hooks/useBulkSelection";

type PendingSpendRow = {
  entry_id: number;
  reference_code: string | null;
  spend_description: string | null;
  amount_net: number | null;
  amount_gross: number | null;
  vat_pct: number | null;
  currency: string | null;
  mapped_category: string | null;
  mapped_report_label: string | null;
  review_status: "pending_review" | "rejected" | null;
  review_note: string | null;
};

type Props = {
  jobId: number;
  baseUrl: string;
  onReviewed?: () => void;
};

export default function PendingPortalSpendSubmissions({ jobId, baseUrl, onReviewed }: Props) {
  const [rows, setRows] = useState<PendingSpendRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyEntryId, setBusyEntryId] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [rejectingEntryId, setRejectingEntryId] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState("");

  const bulk = useBulkSelection(rows.map((r) => r.entry_id));

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/spend-data/pending-review`, { credentials: "include" });
      if (res.ok) {
        const json = await res.json();
        const nextRows: PendingSpendRow[] = Array.isArray(json?.rows) ? json.rows : [];
        setRows(nextRows);
        bulk.pruneTo(nextRows.map((r) => r.entry_id));
      }
    } catch {
      // best-effort; the CRM spend collection table itself remains the source of truth
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  async function review(entryId: number, decision: "approve" | "reject") {
    setBusyEntryId(entryId);
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/spend-data/${entryId}/review`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: notes[entryId] || null }),
      });
      if (res.ok) {
        setRows((prev) => prev.filter((r) => r.entry_id !== entryId));
        bulk.removeMany([entryId]);
        setRejectingEntryId(null);
        onReviewed?.();
      }
    } finally {
      setBusyEntryId(null);
    }
  }

  async function bulkReview(decision: "approve" | "reject", note: string | null) {
    if (bulk.selectedCount === 0) return;
    setBulkBusy(true);
    setBulkError("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/spend-data/bulk-review`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry_ids: Array.from(bulk.selected), decision, note }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to ${decision} selected rows (${res.status})${t ? `: ${t}` : ""}`);
      }
      const json = await res.json();
      const reviewedIds: number[] = Array.isArray(json?.reviewed) ? json.reviewed : [];
      setRows((prev) => prev.filter((r) => !reviewedIds.includes(r.entry_id)));
      bulk.removeMany(reviewedIds);
      if (Array.isArray(json?.failed) && json.failed.length > 0) {
        setBulkError(
          `${json.failed.length} row(s) couldn't be ${decision === "approve" ? "approved" : "rejected"}: ` +
            json.failed.map((f: { entry_id: number; reason: string }) => `#${f.entry_id} (${f.reason})`).join(", ")
        );
      }
      onReviewed?.();
    } catch (e) {
      setBulkError((e as Error).message);
    } finally {
      setBulkBusy(false);
    }
  }

  if (!loading && rows.length === 0) return null;

  return (
    <Card className="border-amber-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Pending Portal Spend Submissions
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
            <BulkSelectionBar
              allSelected={bulk.allSelected}
              someSelected={bulk.someSelected}
              selectedCount={bulk.selectedCount}
              busy={bulkBusy}
              error={bulkError}
              onToggleSelectAll={bulk.toggleSelectAll}
              onApprove={() => void bulkReview("approve", null)}
              onReject={(note) => void bulkReview("reject", note)}
            />
            {rows.map((row) => (
              <div key={row.entry_id} className="flex gap-3 rounded-md border p-3 text-sm">
                <input
                  type="checkbox"
                  checked={bulk.selected.has(row.entry_id)}
                  onChange={() => bulk.toggleOne(row.entry_id)}
                  className="mt-1 size-4 flex-shrink-0"
                />
                <div className="flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{row.spend_description}</div>
                      <div className="text-xs text-muted-foreground">
                        Code: {row.reference_code || "-"} &middot; {row.mapped_report_label || row.mapped_category || "No category"} &middot;{" "}
                        Net {row.amount_net?.toFixed(2) ?? "-"} {row.currency} &middot; VAT {row.vat_pct ?? 0}%
                      </div>
                      {row.review_status === null && (
                        <div className="mt-1 text-xs text-amber-700">
                          Categorised by suggestion — the client hasn&apos;t confirmed it. Approve if the category is right.
                        </div>
                      )}
                      {row.review_status === "rejected" && (
                        <div className="mt-1 text-xs text-rose-700">
                          Previously rejected: {row.review_note || "no reason given"} (client can still re-pick a category)
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={busyEntryId === row.entry_id}
                        onClick={() => void review(row.entry_id, "approve")}
                      >
                        {busyEntryId === row.entry_id ? "Approving..." : "Approve"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyEntryId === row.entry_id}
                        onClick={() => setRejectingEntryId(rejectingEntryId === row.entry_id ? null : row.entry_id)}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                  {rejectingEntryId === row.entry_id && (
                    <div className="mt-2 flex flex-col gap-2">
                      <Textarea
                        placeholder="Reason for rejection (shown to the client)"
                        value={notes[row.entry_id] || ""}
                        onChange={(e) => setNotes((prev) => ({ ...prev, [row.entry_id]: e.target.value }))}
                        className="text-sm"
                      />
                      <div>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={busyEntryId === row.entry_id}
                          onClick={() => void review(row.entry_id, "reject")}
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
