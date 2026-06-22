"use client";

import { useParams } from "next/navigation";

import JobSectionShell from "@/components/job-workspace/JobSectionShell";
import TrainingWorkspaceNav from "@/components/training/TrainingWorkspaceNav";
import OverviewTab from "@/components/training/OverviewTab";
import { useTrainingData } from "@/components/training/useTrainingData";

function apiBaseUrl() {
  return "/api/backend";
}

export default function TrainingOverviewPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);
  const baseUrl = apiBaseUrl();
  const { overview, loading } = useTrainingData(jobId, baseUrl);

  return (
    <JobSectionShell
      jobId={jobId}
      baseUrl={baseUrl}
      sectionLabel="Training"
      sectionHref={`/jobs/${jobId}/training/overview`}
    >
      <TrainingWorkspaceNav jobId={jobId} activeSection="overview" />
      {loading && !overview ? (
        <div className="py-10 text-center text-sm text-slate-400">Loading training data…</div>
      ) : overview ? (
        <OverviewTab overview={overview} />
      ) : (
        <div className="py-10 text-center text-sm text-slate-400">No training data yet.</div>
      )}
    </JobSectionShell>
  );
}
