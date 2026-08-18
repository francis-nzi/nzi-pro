"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import BulkSelectionBar from "@/components/BulkSelectionBar";
import { useBulkSelection } from "@/hooks/useBulkSelection";

type PendingRow = {
  row_id: number;
  site_id: number | null;
  site_name: string | null;
  scope: string | null;
  category: string | null;
  report_label: string | null;
  original_id: string | null;
  uom: string | null;
  qty: number | null;
  factor: number | null;
  review_status: "pending_review" | "rejected" | null;
  review_note: string | null;
  created_at: string | null;
};

type Props = {
  jobId: number;
  baseUrl: string;
  onReviewed?: () => void;
};

// Rows submitted for the same site+scope+factor combo can only ever
// produce one *approved* job_scope_rows entry (job_scope_rows_job_site_scope_active_uidx),
// so pending duplicates need to be summed into one before any of them can
// be approved. This key identifies that group.
function groupKey(row: PendingRow): string {
  return `${row.site_id ?? "none"}|${row.scope ?? ""}|${row.original_id ?? ""}`;
}

export default function PendingPortalSubmissions({ jobId, baseUrl, onReviewed }: Props) {
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyRowId, setBusyRowId] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [rejectingRowId, setRejectingRowId] = useState<number | null>(null);
  const [consolidatingKey, setConsolidatingKey] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/scope-data/pending-review`, { credentials: "include" });
      if (res.ok) {
        const json = await res.json();
        const nextRows: PendingRow[] = Array.isArray(json?.rows) ? json.rows : [];
        setRows(nextRows);
        bulk.pruneTo(nextRows.map((r) => r.row_id));
      }
    } catch {
      // best-effort; the CRM data-entry table itself remains the source of truth
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  async function review(rowId: number, decision: "approve" | "reject") {
    setBusyRowId(rowId);
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/scope-data/${rowId}/review`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: notes[rowId] || null }),
      });
      if (res.ok) {
        setRows((prev) => prev.filter((r) => r.row_id !== rowId));
        bulk.removeMany([rowId]);
        setRejectingRowId(null);
        onReviewed?.();
      }
    } finally {
      setBusyRowId(null);
    }
  }

  async function consolidate(key: string, rowIds: number[]) {
    setConsolidatingKey(key);
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/scope-data/consolidate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ row_ids: rowIds }),
      });
      if (res.ok) {
        await load();
      }
    } finally {
      setConsolidatingKey(null);
    }
  }

  const pendingGroups = new Map<string, PendingRow[]>();
  for (const row of rows) {
    if (row.review_status !== "pending_review") continue;
    const key = groupKey(row);
    const existing = pendingGroups.get(key);
    if (existing) existing.push(row);
    else pendingGroups.set(key, [row]);
  }

  // Grouped duplicates can't be approved individually (see groupKey above),
  // so they're excluded from bulk-select the same way their single-row
  // Approve button is disabled below.
  const selectableRowIds = rows
    .filter((row) => (pendingGroups.get(groupKey(row))?.length ?? 1) <= 1)
    .map((row) => row.row_id);
  const bulk = useBulkSelection(selectableRowIds);

  async function bulkReview(decision: "approve" | "reject", note: string | null) {
    if (bulk.selectedCount === 0) return;
    setBulkBusy(true);
    setBulkError("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/scope-data/bulk-review`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ row_ids: Array.from(bulk.selected), decision, note }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to ${decision} selected rows (${res.status})${t ? `: ${t}` : ""}`);
      }
      const json = await res.json();
      const reviewedIds: number[] = Array.isArray(json?.reviewed) ? json.reviewed : [];
      setRows((prev) => prev.filter((r) => !reviewedIds.includes(r.row_id)));
      bulk.removeMany(reviewedIds);
      if (Array.isArray(json?.failed) && json.failed.length > 0) {
        setBulkError(
          `${json.failed.length} row(s) couldn't be ${decision === "approve" ? "approved" : "rejected"}: ` +
            json.failed.map((f: { row_id: number; reason: string }) => `#${f.row_id} (${f.reason})`).join(", ")
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
          Pending Portal Submissions
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
            {selectableRowIds.length > 0 && (
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
            )}
            {rows.map((row) => {
              const key = groupKey(row);
              const group = row.review_status === "pending_review" ? pendingGroups.get(key) ?? [row] : [row];
              const isGrouped = group.length > 1;
              // The backend keeps the lowest (earliest-created) row_id as the
              // survivor when consolidating -- anchor the action on that same
              // row so the button's position matches which row actually stays.
              const isFirstInGroup = isGrouped && row.row_id === Math.min(...group.map((r) => r.row_id));
              const groupTotalQty = group.reduce((sum, r) => sum + (r.qty ?? 0), 0);
              return (
                <div key={row.row_id} className={`flex gap-3 rounded-md border p-3 text-sm ${isGrouped ? "border-blue-200 bg-blue-50/40" : ""}`}>
                  <input
                    type="checkbox"
                    checked={bulk.selected.has(row.row_id)}
                    disabled={isGrouped}
                    title={isGrouped ? "Consolidate this group into one row before approving" : undefined}
                    onChange={() => bulk.toggleOne(row.row_id)}
                    className="mt-1 size-4 flex-shrink-0"
                  />
                  <div className="flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="font-medium">{row.report_label || row.original_id}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.site_name || "No site"} &middot; {row.scope} &middot; {row.category || "Uncategorized"} &middot; {row.qty ?? "-"} {row.uom || ""}
                        </div>
                        {isGrouped && (
                          <div className="mt-1 flex items-center gap-2 text-xs text-blue-700">
                            <span className="rounded-full bg-blue-100 px-2 py-0.5 font-medium">
                              {group.length} submissions for this site &middot; {groupTotalQty} {row.uom || ""} total
                            </span>
                            {isFirstInGroup && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-xs"
                                disabled={consolidatingKey === key}
                                onClick={() => void consolidate(key, group.map((r) => r.row_id))}
                              >
                                {consolidatingKey === key ? "Consolidating..." : "Consolidate into one row"}
                              </Button>
                            )}
                          </div>
                        )}
                        {row.review_status === "rejected" && (
                          <div className="mt-1 text-xs text-rose-700">
                            Previously rejected: {row.review_note || "no reason given"} (client can still edit and resubmit)
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={busyRowId === row.row_id || isGrouped}
                          title={isGrouped ? "Consolidate this group into one row before approving" : undefined}
                          onClick={() => void review(row.row_id, "approve")}
                        >
                          {busyRowId === row.row_id ? "Approving..." : "Approve"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyRowId === row.row_id}
                          onClick={() => setRejectingRowId(rejectingRowId === row.row_id ? null : row.row_id)}
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                    {rejectingRowId === row.row_id && (
                      <div className="mt-2 flex flex-col gap-2">
                        <Textarea
                          placeholder="Reason for rejection (shown to the client)"
                          value={notes[row.row_id] || ""}
                          onChange={(e) => setNotes((prev) => ({ ...prev, [row.row_id]: e.target.value }))}
                          className="text-sm"
                        />
                        <div>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={busyRowId === row.row_id}
                            onClick={() => void review(row.row_id, "reject")}
                          >
                            Confirm Rejection
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </CardContent>
    </Card>
  );
}
