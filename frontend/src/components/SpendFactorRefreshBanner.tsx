"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type PreviewSummary = {
  rows_affected: number;
  rows_no_match: number;
  current_total_tco2e: number;
  projected_total_tco2e: number;
  delta_tco2e: number;
};

type LatestRequest = {
  request_id: number;
  requested_by: string | null;
  requested_at: string | null;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
};

type StatusResponse = {
  job_status: string | null;
  preview: PreviewSummary;
  latest_request: LatestRequest | null;
};

type Props = {
  jobId: number;
  baseUrl: string;
};

const CLOSED_STATUSES = new Set(["completed", "closed", "job closed - all reports, invoices and support completed"]);

function fmtDate(value: string | null): string {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return value;
  }
}

export default function SpendFactorRefreshBanner({ jobId, baseUrl }: Props) {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/spend-factor-refresh/status`, { credentials: "include" });
      if (res.ok) {
        setData(await res.json());
      }
    } catch {
      // best-effort -- this is an informational banner, not the source of truth
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  async function submitRequest() {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/spend-factor-refresh/request`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.detail || `Request failed (${res.status})`);
      }
      setReason("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !data) return null;
  if (!data) return null;

  const { preview, latest_request: latestRequest, job_status: jobStatus } = data;
  const isPending = latestRequest?.status === "pending";
  const isClosed = CLOSED_STATUSES.has(String(jobStatus || "").trim().toLowerCase());

  if (!isPending && preview.rows_affected === 0) return null;

  return (
    <Card className="border-amber-300">
      <CardHeader>
        <CardTitle className="text-base">DEFRA Spend Factor Refresh</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {isPending ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
            Refresh requested by {latestRequest?.requested_by || "someone"} on {fmtDate(latestRequest?.requested_at ?? null)} --
            awaiting SuperAdmin approval.
            {latestRequest?.reason ? <div className="mt-1 text-xs">Reason: {latestRequest.reason}</div> : null}
          </div>
        ) : (
          <>
            {latestRequest?.status === "rejected" ? (
              <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-rose-900">
                Previous refresh request rejected on {fmtDate(latestRequest.decided_at)}
                {latestRequest.decision_note ? `: ${latestRequest.decision_note}` : "."}
              </div>
            ) : null}
            <div>
              {preview.rows_affected} row(s) on this job reference DEFRA spend factors that were superseded by a
              revised dataset. Current total: <span className="font-medium">{preview.current_total_tco2e.toFixed(2)} tCO2e</span> --{" "}
              revised total would be <span className="font-medium">{preview.projected_total_tco2e.toFixed(2)} tCO2e</span> (
              {preview.delta_tco2e >= 0 ? "+" : ""}
              {preview.delta_tco2e.toFixed(2)} tCO2e).
              {preview.rows_no_match > 0 ? (
                <span className="text-muted-foreground"> {preview.rows_no_match} row(s) have no revised match and would be left unchanged.</span>
              ) : null}
            </div>
            {isClosed ? (
              <div className="rounded-md border border-rose-300 bg-rose-50 p-2 text-xs text-rose-900">
                This job is {jobStatus} -- requesting a refresh here would change an already-delivered figure. Only proceed for a
                genuine, considered reason.
              </div>
            ) : null}
            <Textarea
              placeholder="Reason for requesting this refresh (shown to the approver)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="text-sm"
            />
            {error ? <div className="text-xs text-rose-700">{error}</div> : null}
            <Button size="sm" disabled={submitting} onClick={() => void submitRequest()}>
              {submitting ? "Requesting..." : "Request Refresh"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
