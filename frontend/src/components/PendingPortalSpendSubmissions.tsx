"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

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

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/spend-data/pending-review`, { credentials: "include" });
      if (res.ok) {
        const json = await res.json();
        setRows(Array.isArray(json?.rows) ? json.rows : []);
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
        setRejectingEntryId(null);
        onReviewed?.();
      }
    } finally {
      setBusyEntryId(null);
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
          rows.map((row) => (
            <div key={row.entry_id} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{row.spend_description}</div>
                  <div className="text-xs text-muted-foreground">
                    Code: {row.reference_code || "-"} &middot; {row.mapped_report_label || row.mapped_category || "No category"} &middot;{" "}
                    Net {row.amount_net?.toFixed(2) ?? "-"} {row.currency} &middot; VAT {row.vat_pct ?? 0}%
                  </div>
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
          ))
        )}
      </CardContent>
    </Card>
  );
}
