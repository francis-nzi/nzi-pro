"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/auth";

type ReportMeta = {
  report_version_id?: number | null;
  version_label?: string | null;
  version_number?: number | null;
  status?: string | null;
  generated_at?: string | null;
  reviewed_at?: string | null;
  finalized_at?: string | null;
  snapshot_at?: string | null;
};

function formatTimestamp(raw: string | null | undefined): string {
  if (!raw) return "";
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return raw;
  return dt.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PortalReportViewer({ jobId }: { jobId: number }) {
  const [loaded, setLoaded] = useState(false);
  const [meta, setMeta] = useState<ReportMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);

  const reportUrl = useMemo(() => `/api/backend/portal/jobs/${jobId}/report-html`, [jobId]);

  useEffect(() => {
    setLoaded(false);
    setMetaLoading(true);
    setMeta(null);
    apiFetch(`/portal/jobs/${jobId}/report-meta`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load report metadata (${res.status})`);
        }
        return res.json() as Promise<ReportMeta>;
      })
      .then((data) => setMeta(data))
      .catch(() => setMeta(null))
      .finally(() => setMetaLoading(false));
  }, [jobId]);

  const snapshotLabel = meta?.version_label?.trim()
    || (meta?.version_number != null ? `v${meta.version_number}` : "latest");
  const snapshotTime = formatTimestamp(meta?.snapshot_at || meta?.finalized_at || meta?.reviewed_at || meta?.generated_at);

  return (
    <Card className="overflow-hidden border-gray-200 shadow-sm">
      <CardHeader className="border-b border-gray-100 bg-white py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">Client Report</CardTitle>
            <p className="text-sm text-gray-500">
              Showing the latest saved review snapshot from the app.
            </p>
          </div>
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <div className="inline-flex rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
              Latest snapshot
            </div>
            <div className="text-xs text-gray-500">
              {metaLoading ? "Loading timestamp…" : snapshotTime ? `Saved ${snapshotTime}` : "Saved timestamp unavailable"}
            </div>
            <div className="text-xs text-gray-400">
              {meta?.status ? `Version ${snapshotLabel} • ${meta.status}` : `Version ${snapshotLabel}`}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {!loaded ? (
          <div className="flex h-64 items-center justify-center text-sm text-gray-400">
            Loading report…
          </div>
        ) : null}
        <iframe
          title={`Client report for job ${jobId}`}
          src={reportUrl}
          onLoad={() => setLoaded(true)}
          className={`w-full border-0 ${loaded ? "block" : "h-0 opacity-0"}`}
          style={{ minHeight: "80vh" }}
        />
      </CardContent>
    </Card>
  );
}
