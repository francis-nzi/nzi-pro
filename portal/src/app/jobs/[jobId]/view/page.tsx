"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import Link from "next/link";
import { apiFetch } from "@/lib/auth";
import PortalShell from "@/components/PortalShell";
import PortalReportViewer from "@/components/PortalReportViewer";

type SnapshotMeta = {
  review_status: string;
  published_at: string | null;
  approved_at: string | null;
  approved_by_name: string | null;
  version_label: string | null;
  locked_by_crm_at: string | null;
};

function formatDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return iso;
  }
}

export default function ReportViewPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);
  const [meta, setMeta] = useState<SnapshotMeta | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    setMeta(null);
    apiFetch(`/portal/jobs/${jobId}/portal-snapshot-data`)
      .then(async (res) => {
        if (res.status === 404) {
          setMeta({ review_status: "not_sent", published_at: null, approved_at: null, approved_by_name: null, version_label: null, locked_by_crm_at: null });
          return;
        }
        if (!res.ok) return;
        const data = await res.json() as SnapshotMeta;
        setMeta(data);
      })
      .catch(() => setMeta({ review_status: "not_sent", published_at: null, approved_at: null, approved_by_name: null, version_label: null, locked_by_crm_at: null }));
  }, [jobId]);

  async function downloadPdf() {
    setDownloading(true);
    setDownloadError(null);
    try {
      const res = await apiFetch(`/portal/jobs/${jobId}/download-pdf`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { detail?: string };
        throw new Error(body.detail ?? `Download failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `carbon-report-job-${jobId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setDownloadError(String(e));
    } finally {
      setDownloading(false);
    }
  }

  const isPublished = !!meta?.published_at;
  const isApproved = meta?.review_status === "approved";
  const isLockedByCrm = !!meta?.locked_by_crm_at;
  const versionLabel = meta?.version_label?.trim() || "latest";

  // Finalised state — show download page instead of report
  if (isApproved && isPublished) {
    return (
      <PortalShell>
        <div className="space-y-4">
          <Link
            href="/dashboard?tab=reports"
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Reports
          </Link>

          <div className="rounded-xl border border-green-200 bg-green-50 px-8 py-10 text-center space-y-4">
            <div className="text-2xl font-bold text-green-800">Report Approved &amp; Finalised</div>
            <p className="text-sm text-green-700">
              This report was approved by {meta?.approved_by_name ?? "the client"} on {formatDate(meta?.approved_at ?? null)}.
            </p>
            <p className="text-sm text-gray-600">
              The finalised PDF is ready for download below.
            </p>
            <button
              onClick={() => void downloadPdf()}
              disabled={downloading}
              className="inline-flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-semibold text-white bg-green-700 hover:bg-green-800 disabled:opacity-60 transition"
            >
              <Download className="h-4 w-4" />
              {downloading ? "Downloading…" : "Download PDF Report"}
            </button>
            {downloadError && (
              <p className="text-sm text-red-600">{downloadError}</p>
            )}
          </div>
        </div>
      </PortalShell>
    );
  }

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
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-xs text-gray-400">
              {meta?.review_status ? `Version ${versionLabel} • ${meta.review_status.replace(/_/g, " ")}` : `Version ${versionLabel}`}
            </div>
            {isApproved && !isPublished && (
              <div className="text-xs text-amber-600 font-medium">
                Approved — PDF being prepared by your consultant
              </div>
            )}
            {isLockedByCrm && !isApproved && (
              <div className="text-xs text-amber-600 font-medium">
                Finalised by NZI — comments and approval are no longer available
              </div>
            )}
          </div>
        </div>

        <PortalReportViewer jobId={jobId} />
      </div>
    </PortalShell>
  );
}
