"use client";

import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import PortalShell from "@/components/PortalShell";
import PortalReportViewer from "@/components/PortalReportViewer";

export default function ReportViewPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);

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

        <PortalReportViewer jobId={jobId} />
      </div>
    </PortalShell>
  );
}
