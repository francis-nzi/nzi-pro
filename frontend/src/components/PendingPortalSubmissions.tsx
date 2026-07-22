"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type PendingRow = {
  row_id: number;
  site_id: number | null;
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

export default function PendingPortalSubmissions({ jobId, baseUrl, onReviewed }: Props) {
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyRowId, setBusyRowId] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [rejectingRowId, setRejectingRowId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/scope-data/pending-review`, { credentials: "include" });
      if (res.ok) {
        const json = await res.json();
        setRows(Array.isArray(json?.rows) ? json.rows : []);
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
        setRejectingRowId(null);
        onReviewed?.();
      }
    } finally {
      setBusyRowId(null);
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
          rows.map((row) => (
            <div key={row.row_id} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{row.report_label || row.original_id}</div>
                  <div className="text-xs text-muted-foreground">
                    {row.scope} &middot; {row.category || "Uncategorized"} &middot; {row.qty ?? "-"} {row.uom || ""}
                  </div>
                  {row.review_status === "rejected" && (
                    <div className="mt-1 text-xs text-rose-700">
                      Previously rejected: {row.review_note || "no reason given"} (client can still edit and resubmit)
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={busyRowId === row.row_id}
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
          ))
        )}
      </CardContent>
    </Card>
  );
}
