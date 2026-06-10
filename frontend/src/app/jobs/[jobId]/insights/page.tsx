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
  const baseUrl = apiBaseUrl();

  return (
    <JobSectionShell
      jobId={jobId}
      baseUrl={baseUrl}
      sectionLabel="Insights"
      sectionHref={`/jobs/${jobId}/insights`}
      activeGroup="insights"
      activeSubtab="insights"
      renderContent={(job) => (
        <JobInsights
          jobId={job.job_id}
          clientId={job.client_db_id}
          baseUrl={baseUrl}
          jobNumber={job.job_number}
          clientName={job.client_name}
          reportingYear={
            job.reporting_period_end
              ? new Date(job.reporting_period_end).getFullYear()
              : job.reporting_year != null
                ? Number(job.reporting_year)
                : null
          }
        />
      )}
    />
  );
}
