"use client";

import { useParams } from "next/navigation";

import JobLca from "@/components/JobLca";
import JobSectionShell from "@/components/job-workspace/JobSectionShell";

function apiBaseUrl(): string {
  return "/api/backend";
}

export default function JobLcaPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);

  return (
    <JobSectionShell
      jobId={jobId}
      baseUrl={apiBaseUrl()}
      sectionLabel="Life Cycle Analysis"
      sectionHref={`/jobs/${jobId}/lca`}
      activeGroup="analysis"
    >
      <JobLca jobId={jobId} baseUrl={apiBaseUrl()} />
    </JobSectionShell>
  );
}
