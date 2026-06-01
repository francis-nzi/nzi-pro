"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { apiFetch } from "@/lib/auth";
import PortalShell from "@/components/PortalShell";
import PortalReportViewer from "@/components/PortalReportViewer";

type ReportMeta = {
  version_label?: string | null;
  version_number?: number | null;
  status?: string | null;
  snapshot_at?: string | null;
  reviewed_at?: string | null;
  finalized_at?: string | null;
  generated_at?: string | null;
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

export default function ReportViewPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);
  const [meta, setMeta] = useState<ReportMeta | null>(null);

  const snapshotLabel = useMemo(
    () => meta?.version_label?.trim() || (meta?.version_number != null ? `v${meta.version_number}` : "latest"),
    [meta]
  );
  const snapshotTime = useMemo(
    () => formatTimestamp(meta?.snapshot_at || meta?.finalized_at || meta?.reviewed_at || meta?.generated_at),
    [meta]
  );

  useEffect(() => {
    setMeta(null);
    apiFetch(`/portal/jobs/${jobId}/report-meta`)
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json() as Promise<ReportMeta>;
      })
      .then((data) => setMeta(data))
      .catch(() => setMeta(null));
  }, [jobId]);

  return (
    <PortalShell>
      <div className="space-y-4">
        <div className="space-y-1">
          <Link
            href="/dashboard?tab=reports"
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Reports
          </Link>
          <div className="text-xs text-gray-500">
            {snapshotTime ? `Latest snapshot saved ${snapshotTime}` : "Snapshot timestamp unavailable"}
          </div>
          <div className="text-xs text-gray-400">
            {meta?.status ? `Version ${snapshotLabel} • ${meta.status}` : `Version ${snapshotLabel}`}
          </div>
        </div>

        <PortalReportViewer jobId={jobId} />
      </div>
    </PortalShell>
  );
}
