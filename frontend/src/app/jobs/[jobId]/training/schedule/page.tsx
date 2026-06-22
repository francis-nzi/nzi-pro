"use client";

import { useParams } from "next/navigation";

import JobSectionShell from "@/components/job-workspace/JobSectionShell";
import TrainingWorkspaceNav from "@/components/training/TrainingWorkspaceNav";
import ScheduleTab from "@/components/training/ScheduleTab";
import { useTrainingData } from "@/components/training/useTrainingData";

function apiBaseUrl() {
  return "/api/backend";
}

export default function TrainingSchedulePage() {
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);
  const baseUrl = apiBaseUrl();
  const { overview, loading, refresh } = useTrainingData(jobId, baseUrl);

  return (
    <JobSectionShell
      jobId={jobId}
      baseUrl={baseUrl}
      sectionLabel="Training — Schedule"
      sectionHref={`/jobs/${jobId}/training/schedule`}
    >
      <TrainingWorkspaceNav jobId={jobId} activeSection="schedule" />
      {loading && !overview ? (
        <div className="py-10 text-center text-sm text-slate-400">Loading training data…</div>
      ) : overview ? (
        <ScheduleTab
          jobId={jobId}
          runs={overview.course_runs}
          products={overview.products}
          sessions={overview.sessions}
          baseUrl={baseUrl}
          onRefresh={refresh}
        />
      ) : (
        <div className="py-10 text-center text-sm text-slate-400">No training data yet.</div>
      )}
    </JobSectionShell>
  );
}
