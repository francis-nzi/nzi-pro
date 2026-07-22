"use client";

import { useEffect, useState } from "react";
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

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/employee-commuting/pending-review`, { credentials: "include" });
      if (res.ok) {
        const json = await res.json();
        setRows(Array.isArray(json?.rows) ? json.rows : []);
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
        setRejectingSourceId(null);
        onReviewed?.();
      }
    } finally {
      setBusySourceId(null);
    }
  }

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
          rows.map((row) => (
            <div key={row.source_id} className="rounded-md border p-3 text-sm">
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
          ))
        )}
      </CardContent>
    </Card>
  );
}
