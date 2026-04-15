"use client";

import { useParams } from "next/navigation";

import JobInsights from "@/components/JobInsights";
import JobSectionShell from "@/components/job-workspace/JobSectionShell";

function apiBaseUrl(): string {
  return "/api/backend";
}

export default function JobInsightsPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);

  return (
    <JobSectionShell
      jobId={jobId}
      baseUrl={apiBaseUrl()}
      sectionLabel="Insights"
      sectionHref={`/jobs/${jobId}/insights`}
      activeGroup="insights"
      activeSubtab="dashboard"
      renderContent={(job) => (
        <JobInsights
          jobId={job.job_id}
          clientId={job.client_db_id}
          baseUrl={apiBaseUrl()}
          jobNumber={job.job_number}
          clientName={job.client_name}
          reportingYear={job.reporting_year}
        />
      )}
    />
  );
}
