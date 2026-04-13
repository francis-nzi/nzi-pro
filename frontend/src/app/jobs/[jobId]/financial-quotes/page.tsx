"use client";

import { useParams } from "next/navigation";

import JobFinancial from "@/components/JobFinancial";
import JobSectionShell from "@/components/job-workspace/JobSectionShell";

function apiBaseUrl(): string {
  return "/api/backend";
}

export default function JobFinancialQuotesPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);

  return (
    <JobSectionShell
      jobId={jobId}
      baseUrl={apiBaseUrl()}
      sectionLabel="Financials"
      sectionHref={`/jobs/${jobId}/financial-quotes`}
      activeGroup="financial"
      activeSubtab="financial-quotes"
      renderContent={(job) => (
        <JobFinancial jobId={jobId} clientId={job.client_db_id} jobNumber={job.job_number} baseUrl={apiBaseUrl()} mode="quotes" />
      )}
    />
  );
}
