"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type BackgroundJob = {
  job_token: string;
  queue_name?: string;
  status?: string;
  rq_status?: string;
  func_name?: string;
  description?: string;
  org_id?: string | null;
  user_id?: string | null;
  job_id?: number | null;
  template_id?: number | null;
  progress?: number | null;
  message?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  error?: string | null;
  result?: unknown;
  can_replay?: boolean;
  replayed_from?: string | null;
  replayed_at_utc?: string | null;
  replayed_by?: string | null;
};

type BackgroundJobsStatus = {
  ok?: boolean;
  queue_name?: string;
  counts?: {
    queued?: number | null;
    failed?: number | null;
    started?: number | null;
    deferred?: number | null;
    finished?: number | null;
    canceled?: number | null;
  };
  jobs?: BackgroundJob[];
  connection?: Record<string, unknown> | null;
};

function apiBaseUrl(): string {
  return "/api/backend";
}

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function fmtCount(value: number | null | undefined): string {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString() : "0";
}

export default function AdminBackgroundJobsPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const [loading, setLoading] = useState(true);
  const [busyToken, setBusyToken] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [data, setData] = useState<BackgroundJobsStatus | null>(null);

  async function loadStatus() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${baseUrl}/admin/background-jobs/status`, { credentials: "include" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = (payload as { detail?: unknown }).detail;
        throw new Error(typeof detail === "string" ? detail : `Failed to load background job status (${res.status})`);
      }
      setData(payload as BackgroundJobsStatus);
    } catch (e) {
      setError((e as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  async function replayJob(jobToken: string) {
    setBusyToken(jobToken);
    setError("");
    setStatus(`Replaying ${jobToken}...`);
    try {
      const res = await fetch(`${baseUrl}/admin/background-jobs/replay`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_token: jobToken }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = (payload as { detail?: unknown }).detail;
        throw new Error(typeof detail === "string" ? detail : `Replay failed (${res.status})`);
      }
      setStatus(`Queued replay ${String((payload as { replayed_job_token?: string }).replayed_job_token || jobToken)}.`);
      await loadStatus();
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setBusyToken("");
    }
  }

  const jobs = data?.jobs ?? [];
  const counts = data?.counts ?? {};

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10 space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-bold" style={{ color: "#F26624" }}>Background Jobs</h1>
            <p className="text-muted-foreground">
              Monitor the PDF generation queue, inspect failed jobs, and replay safe jobs when needed.
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => void loadStatus()} disabled={loading}>
              {loading ? "Loading..." : "Refresh"}
            </Button>
            <Button variant="secondary" asChild>
              <Link href="/admin">{"<-"} Back to Admin</Link>
            </Button>
          </div>
        </div>

        {error ? <div className="rounded border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div> : null}
        {status ? <div className="rounded border bg-muted/30 p-3 text-sm">{status}</div> : null}

        <Card className="border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle>Queue Overview</CardTitle>
            <CardDescription>Live queue and registry counts for the PDF generation worker system.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
              <div className="rounded border bg-background p-3 text-sm">Queued: <strong>{fmtCount(counts.queued)}</strong></div>
              <div className="rounded border bg-background p-3 text-sm">Failed: <strong>{fmtCount(counts.failed)}</strong></div>
              <div className="rounded border bg-background p-3 text-sm">Started: <strong>{fmtCount(counts.started)}</strong></div>
              <div className="rounded border bg-background p-3 text-sm">Deferred: <strong>{fmtCount(counts.deferred)}</strong></div>
              <div className="rounded border bg-background p-3 text-sm">Finished: <strong>{fmtCount(counts.finished)}</strong></div>
              <div className="rounded border bg-background p-3 text-sm">Canceled: <strong>{fmtCount(counts.canceled)}</strong></div>
            </div>
            <div className="rounded border bg-background p-4 text-sm">
              <div><span className="font-medium">Queue:</span> {data?.queue_name || "-"}</div>
              <div><span className="font-medium">Redis:</span> {data?.connection ? JSON.stringify(data.connection) : "-"}</div>
            </div>
            {loading ? <p className="text-xs text-muted-foreground">Loading background job snapshot...</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Jobs ({jobs.length})</CardTitle>
            <CardDescription>Failed or active jobs appear here with replay controls for safe recovery.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Token</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Org</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Message / Error</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.job_token}>
                    <TableCell className="max-w-[220px] truncate font-mono text-xs">{job.job_token}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          job.status === "failed"
                            ? "destructive"
                            : job.status === "completed"
                              ? "default"
                              : "secondary"
                        }
                      >
                        {job.status || "-"}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{job.org_id || "-"}</TableCell>
                    <TableCell className="whitespace-nowrap">{job.job_id ?? "-"}</TableCell>
                    <TableCell className="whitespace-nowrap">{job.template_id ?? "-"}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmtDateTime(job.created_at)}</TableCell>
                    <TableCell className="max-w-[340px]">
                      <div className="truncate" title={String(job.message || "")}>{job.message || "-"}</div>
                      {job.error ? (
                        <div className="mt-1 truncate text-xs text-destructive" title={String(job.error)}>
                          {String(job.error)}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!job.can_replay || busyToken === job.job_token}
                        onClick={() => void replayJob(job.job_token)}
                      >
                        {busyToken === job.job_token ? "Replaying..." : "Replay"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!jobs.length ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No background jobs were found for the current snapshot.
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
