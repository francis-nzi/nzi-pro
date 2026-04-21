"use client";

import { useParams } from "next/navigation";

import DataOutput from "@/components/DataOutput";
import JobSectionShell from "@/components/job-workspace/JobSectionShell";

function apiBaseUrl(): string {
  return "/api/backend";
}

export default function JobOutputsPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);

  return (
    <JobSectionShell
      jobId={jobId}
      baseUrl={apiBaseUrl()}
      sectionLabel="Data Output"
      sectionHref={`/jobs/${jobId}/outputs`}
      activeGroup="outputs"
      activeSubtab="data-output"
    >
      <DataOutput jobId={jobId} baseUrl={apiBaseUrl()} />
    </JobSectionShell>
  );
}
