"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { apiFetch } from "@/lib/auth";
import PortalShell from "@/components/PortalShell";

export default function ReportViewPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);

  const [reportHtml, setReportHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    apiFetch(`/portal/jobs/${jobId}/report-html`)
      .then(async r => {
        if (!r.ok) {
          const body = await r.text();
          let msg = `${r.status}: ${r.statusText}`;
          try { msg = `${r.status}: ${(JSON.parse(body) as { detail?: string }).detail ?? body}`; } catch { msg = `${r.status}: ${body || r.statusText}`; }
          throw new Error(msg);
        }
        return r.text();
      })
      .then(html => setReportHtml(html))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [jobId]);

  useEffect(() => {
    if (!reportHtml || !iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(reportHtml);
    doc.close();
  }, [reportHtml]);

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

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error.startsWith("404:") ? error.replace(/^404:\s*/, "") : `Could not load report: ${error}`}
          </div>
        ) : loading ? (
          <div className="rounded-xl border border-gray-200 bg-white p-16 text-center text-sm text-gray-400 shadow-sm">
            Loading report…
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
            <iframe
              ref={iframeRef}
              title="Carbon Report"
              className="w-full"
              style={{ height: "calc(100vh - 140px)", border: "none", minHeight: "600px" }}
              sandbox="allow-same-origin"
            />
          </div>
        )}
      </div>
    </PortalShell>
  );
}
