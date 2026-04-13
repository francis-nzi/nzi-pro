"use client";

import { useParams } from "next/navigation";

import JobDataEntry from "@/components/JobDataEntry";
import JobSectionShell from "@/components/job-workspace/JobSectionShell";

function apiBaseUrl(): string {
  return "/api/backend";
}

export default function JobDataEntryPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);

  return (
    <JobSectionShell
      jobId={jobId}
      baseUrl={apiBaseUrl()}
      sectionLabel="Data Entry"
      sectionHref={`/jobs/${jobId}/data-entry`}
      activeGroup="data"
      activeSubtab="data-entry"
    >
      <JobDataEntry jobId={jobId} />
    </JobSectionShell>
  );
}
