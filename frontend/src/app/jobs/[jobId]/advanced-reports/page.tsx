"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";

import JobSectionShell from "@/components/job-workspace/JobSectionShell";

const JobAdvancedReports = dynamic(() => import("@/components/JobAdvancedReports"), {
  ssr: false,
  loading: () => <div className="py-12 text-center text-sm text-muted-foreground">Loading report…</div>,
});

function apiBaseUrl(): string {
  return "/api/backend";
}

function AdvancedReportsInner() {
  const params = useParams<{ jobId: string }>();
  const searchParams = useSearchParams();
  const jobId = Number(params?.jobId);
  const pdfToken = searchParams.get("pdf_token") ?? undefined;
  const printMode = searchParams.get("print") === "1";

  // When rendered by Playwright for PDF generation, skip the shell entirely
  // so that only report sections appear in the output.
  if (printMode && pdfToken) {
    return (
      <div className="bg-white p-6">
        <JobAdvancedReports jobId={jobId} baseUrl={apiBaseUrl()} pdfToken={pdfToken} />
      </div>
    );
  }

  return (
    <JobSectionShell
      jobId={jobId}
      baseUrl={apiBaseUrl()}
      sectionLabel="Advanced Reports"
      sectionHref={`/jobs/${jobId}/advanced-reports`}
      activeGroup="report"
      activeSubtab="advanced-reports"
    >
      <JobAdvancedReports jobId={jobId} baseUrl={apiBaseUrl()} />
    </JobSectionShell>
  );
}

export default function AdvancedReportsPage() {
  return (
    <Suspense>
      <AdvancedReportsInner />
    </Suspense>
  );
}
