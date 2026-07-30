"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuthSession } from "@/components/AuthContext";

type PreviewSummary = {
  rows_affected: number;
  rows_no_match: number;
  current_total_tco2e: number;
  projected_total_tco2e: number;
  delta_tco2e: number;
};

type RefreshRequest = {
  request_id: number;
  job_id: number;
  job_number: string | null;
  job_title: string | null;
  job_status: string | null;
  client_name: string | null;
  requested_by: string | null;
  requested_at: string | null;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  preview_summary: PreviewSummary | null;
};

function fmtDate(value: string | null): string {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default function SpendFactorRefreshRequestsPage() {
  const authSession = useAuthSession();
  const user = (authSession?.payload?.user || {}) as Record<string, unknown>;
  const isSuperAdmin = Boolean(user.is_super_admin);

  const [items, setItems] = useState<RefreshRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ msg: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/backend/admin/spend-factor-refresh-requests?status=${encodeURIComponent(statusFilter)}`, {
        credentials: "include",
      });
      if (res.ok) {
        const json = await res.json();
        setItems(Array.isArray(json?.items) ? json.items : []);
      }
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(requestId: number, decision: "approve" | "reject") {
    setBusyId(requestId);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/backend/admin/spend-factor-refresh-requests/${requestId}/decide`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: notes[requestId] || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.detail || `Failed (${res.status})`);
      }
      setRejectingId(null);
      setStatusMsg({
        msg:
          decision === "approve"
            ? `Refresh applied${body.sync_warning ? ` -- warning: ${body.sync_warning}` : ""}`
            : "Request rejected",
        ok: !body.sync_warning,
      });
      await load();
    } catch (e) {
      setStatusMsg({ msg: (e as Error).message, ok: false });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">DEFRA Spend Factor Refresh Requests</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              A job&apos;s DEFRA spend-based factors can only move onto a revised dataset after a request here is
              approved by a SuperAdmin -- this can change an already-delivered client figure, so every use is
              reviewed individually.
            </p>
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {!isSuperAdmin ? (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            You can view this queue, but only a SuperAdmin can approve or reject a request.
          </div>
        ) : null}

        {statusMsg ? (
          <div className={`mb-4 rounded-md px-4 py-2 text-sm ${statusMsg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
            {statusMsg.msg}
          </div>
        ) : null}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {loading ? "Loading..." : `${items.length} request(s)`}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {items.length === 0 && !loading ? (
              <div className="text-sm text-muted-foreground">Nothing here.</div>
            ) : (
              items.map((item) => (
                <div key={item.request_id} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">
                        {item.client_name || "Unknown client"} -- Job {item.job_number || item.job_id}: {item.job_title || ""}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Job status: {item.job_status || "-"} &middot; Requested by {item.requested_by || "-"} on{" "}
                        {fmtDate(item.requested_at)}
                      </div>
                      {item.reason ? <div className="mt-1 text-xs">Reason: {item.reason}</div> : null}
                      {item.preview_summary ? (
                        <div className="mt-1 text-xs">
                          {item.preview_summary.rows_affected} row(s) affected -- current{" "}
                          {item.preview_summary.current_total_tco2e.toFixed(2)} tCO2e &rarr; revised{" "}
                          {item.preview_summary.projected_total_tco2e.toFixed(2)} tCO2e (
                          {item.preview_summary.delta_tco2e >= 0 ? "+" : ""}
                          {item.preview_summary.delta_tco2e.toFixed(2)})
                          {item.preview_summary.rows_no_match > 0
                            ? `, ${item.preview_summary.rows_no_match} row(s) with no revised match`
                            : ""}
                        </div>
                      ) : null}
                      {item.status !== "pending" ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {item.status === "approved" ? "Approved" : "Rejected"} by {item.decided_by || "-"} on{" "}
                          {fmtDate(item.decided_at)}
                          {item.decision_note ? `: ${item.decision_note}` : ""}
                        </div>
                      ) : null}
                    </div>
                    {item.status === "pending" ? (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={!isSuperAdmin || busyId === item.request_id}
                          title={!isSuperAdmin ? "Only a SuperAdmin can approve this" : undefined}
                          onClick={() => void decide(item.request_id, "approve")}
                        >
                          {busyId === item.request_id ? "Approving..." : "Approve"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!isSuperAdmin || busyId === item.request_id}
                          title={!isSuperAdmin ? "Only a SuperAdmin can reject this" : undefined}
                          onClick={() => setRejectingId(rejectingId === item.request_id ? null : item.request_id)}
                        >
                          Reject
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  {rejectingId === item.request_id ? (
                    <div className="mt-2 flex flex-col gap-2">
                      <Textarea
                        placeholder="Reason for rejection"
                        value={notes[item.request_id] || ""}
                        onChange={(e) => setNotes((prev) => ({ ...prev, [item.request_id]: e.target.value }))}
                        className="text-sm"
                      />
                      <div>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={busyId === item.request_id}
                          onClick={() => void decide(item.request_id, "reject")}
                        >
                          Confirm Rejection
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
