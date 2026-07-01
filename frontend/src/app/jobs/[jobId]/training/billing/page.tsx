"use client";

import { useParams } from "next/navigation";

import JobSectionShell from "@/components/job-workspace/JobSectionShell";
import TrainingWorkspaceNav from "@/components/training/TrainingWorkspaceNav";
import BillingTab from "@/components/training/BillingTab";
import { useTrainingData } from "@/components/training/useTrainingData";

function apiBaseUrl() {
  return "/api/backend";
}

export default function TrainingBillingPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);
  const baseUrl = apiBaseUrl();
  const { overview, loading, refresh } = useTrainingData(jobId, baseUrl);

  return (
    <JobSectionShell
      jobId={jobId}
      baseUrl={baseUrl}
      sectionLabel="Training - Billing"
      sectionHref={`/jobs/${jobId}/training/billing`}
      renderContent={(job) => (
        <>
          <TrainingWorkspaceNav jobId={jobId} activeSection="billing" />
          {loading && !overview ? (
            <div className="py-10 text-center text-sm text-slate-400">Loading training data...</div>
          ) : overview ? (
            <BillingTab
              jobId={jobId}
              clientId={job.client_db_id}
              jobTitle={job.title}
              jobNumber={job.job_number}
              runs={overview.course_runs}
              baseUrl={baseUrl}
              onRefresh={refresh}
            />
          ) : (
            <div className="py-10 text-center text-sm text-slate-400">No training data yet.</div>
          )}
        </>
      )}
    />
  );
}
