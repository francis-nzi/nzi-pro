"use client";

import { useParams } from "next/navigation";

import JobAdvancedReports from "@/components/JobAdvancedReports";
import JobSectionShell from "@/components/job-workspace/JobSectionShell";

function apiBaseUrl(): string {
  return "/api/backend";
}

export default function AdvancedReportsPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);

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
