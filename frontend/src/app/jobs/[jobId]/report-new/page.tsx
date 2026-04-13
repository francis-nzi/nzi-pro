"use client";

import { useParams } from "next/navigation";

import JobReportNew from "@/components/JobReportNew";
import JobSectionShell from "@/components/job-workspace/JobSectionShell";

function apiBaseUrl(): string {
  return "/api/backend";
}

export default function JobReportNewPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);

  return (
    <JobSectionShell
      jobId={jobId}
      baseUrl={apiBaseUrl()}
      sectionLabel="Report (New)"
      sectionHref={`/jobs/${jobId}/report-new`}
      activeGroup="report"
    >
      <JobReportNew jobId={jobId} baseUrl={apiBaseUrl()} onOpenActions={() => undefined} />
    </JobSectionShell>
  );
}
