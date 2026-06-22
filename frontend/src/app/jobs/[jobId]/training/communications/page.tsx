"use client";

import { useParams } from "next/navigation";

import JobSectionShell from "@/components/job-workspace/JobSectionShell";
import TrainingWorkspaceNav from "@/components/training/TrainingWorkspaceNav";
import AutomationTab from "@/components/training/AutomationTab";
import { useTrainingData } from "@/components/training/useTrainingData";

function apiBaseUrl() {
  return "/api/backend";
}

export default function TrainingCommunicationsPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);
  const baseUrl = apiBaseUrl();
  const { overview, automationLog, loading, refresh } = useTrainingData(jobId, baseUrl);

  return (
    <JobSectionShell
      jobId={jobId}
      baseUrl={baseUrl}
      sectionLabel="Training — Communications"
      sectionHref={`/jobs/${jobId}/training/communications`}
    >
      <TrainingWorkspaceNav jobId={jobId} activeSection="communications" />
      {loading && !overview ? (
        <div className="py-10 text-center text-sm text-slate-400">Loading training data…</div>
      ) : overview ? (
        <AutomationTab
          jobId={jobId}
          runs={overview.course_runs}
          automationLog={automationLog}
          baseUrl={baseUrl}
          onRefresh={refresh}
        />
      ) : (
        <div className="py-10 text-center text-sm text-slate-400">No training data yet.</div>
      )}
    </JobSectionShell>
  );
}
