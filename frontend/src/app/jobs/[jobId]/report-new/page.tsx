"use client";

import { useParams, useRouter } from "next/navigation";

import JobReportNew from "@/components/JobReportNew";
import JobSectionShell from "@/components/job-workspace/JobSectionShell";

function apiBaseUrl(): string {
  return "/api/backend";
}

export default function JobReportNewPage() {
  const router = useRouter();
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);

  return (
    <JobSectionShell
      jobId={jobId}
      baseUrl={apiBaseUrl()}
      sectionLabel="Report (New)"
      sectionHref={`/jobs/${jobId}/report-new`}
      activeGroup="report"
      activeSubtab="report-new"
    >
      <JobReportNew
        jobId={jobId}
        baseUrl={apiBaseUrl()}
        onOpenActions={() => router.push(`/jobs/${jobId}?tab=actions`)}
      />
    </JobSectionShell>
  );
}
