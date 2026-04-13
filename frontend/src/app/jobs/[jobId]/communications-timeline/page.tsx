"use client";

import { useParams } from "next/navigation";

import JobCommunications from "@/components/JobCommunications";
import JobSectionShell from "@/components/job-workspace/JobSectionShell";

function apiBaseUrl(): string {
  return "/api/backend";
}

export default function JobCommunicationsTimelinePage() {
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);

  return (
    <JobSectionShell
      jobId={jobId}
      baseUrl={apiBaseUrl()}
      sectionLabel="Communications"
      sectionHref={`/jobs/${jobId}/communications-timeline`}
      activeGroup="communications"
    >
      <JobCommunications jobId={jobId} baseUrl={apiBaseUrl()} mode="timeline" />
    </JobSectionShell>
  );
}
