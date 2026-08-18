"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import BulkSelectionBar from "@/components/BulkSelectionBar";
import { useBulkSelection } from "@/hooks/useBulkSelection";

type PendingSourceRow = {
  source_id: number;
  site_id: number | null;
  source_name: string | null;
  asset_identifier: string | null;
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
  sourceType: "asset" | "business_travel";
  title: string;
  onReviewed?: () => void;
};

// Client-portal-submitted Company Vehicles / Business Travel rows awaiting
// CRM approval on the Asset Register / Business Travel Register pages --
// same bulk-select/approve/reject mechanics as
// PendingPortalCommutingSubmissions.tsx, generalized over sourceType since
// both hit the same generic job_emission_sources register endpoints (see
// api/job_emission_register_routes.py list_pending_review_register_rows /
// review_register_row / bulk_review_register_rows).
export default function PendingPortalSourceSubmissions({ jobId, baseUrl, sourceType, title, onReviewed }: Props) {
  const [rows, setRows] = useState<PendingSourceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busySourceId, setBusySourceId] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [rejectingSourceId, setRejectingSourceId] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState("");

  const bulk = useBulkSelection(rows.map((r) => r.source_id));

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/emission-registers/${sourceType}/pending-review`, {
        credentials: "include",
      });
      if (res.ok) {
        const json = await res.json();
        const nextRows: PendingSourceRow[] = Array.isArray(json?.rows) ? json.rows : [];
        setRows(nextRows);
        bulk.pruneTo(nextRows.map((r) => r.source_id));
      }
    } catch {
      // best-effort; the register table itself remains the source of truth
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, sourceType]);

  async function review(sourceId: number, decision: "approve" | "reject") {
    setBusySourceId(sourceId);
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/emission-registers/${sourceType}/${sourceId}/review`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: notes[sourceId] || null }),
      });
      if (res.ok) {
        setRows((prev) => prev.filter((r) => r.source_id !== sourceId));
        bulk.removeMany([sourceId]);
        setRejectingSourceId(null);
        onReviewed?.();
      }
    } finally {
      setBusySourceId(null);
    }
  }

  async function bulkReview(decision: "approve" | "reject", note: string | null) {
    if (bulk.selectedCount === 0) return;
    setBulkBusy(true);
    setBulkError("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/emission-registers/${sourceType}/bulk-review`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_ids: Array.from(bulk.selected), decision, note }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to ${decision} selected rows (${res.status})${t ? `: ${t}` : ""}`);
      }
      const json = await res.json();
      const reviewedIds: number[] = Array.isArray(json?.reviewed) ? json.reviewed : [];
      setRows((prev) => prev.filter((r) => !reviewedIds.includes(r.source_id)));
      bulk.removeMany(reviewedIds);
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

  if (!loading && rows.length === 0) return null;

  return (
    <Card className="border-amber-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {title}
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
              <div key={row.source_id} className="flex gap-3 rounded-md border p-3 text-sm">
                <input
                  type="checkbox"
                  checked={bulk.selected.has(row.source_id)}
                  onChange={() => bulk.toggleOne(row.source_id)}
                  className="mt-1 size-4 flex-shrink-0"
                />
                <div className="flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">
                        {row.source_name || "Unnamed"}
                        {row.asset_identifier ? ` — ${row.asset_identifier}` : ""}
                      </div>
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
