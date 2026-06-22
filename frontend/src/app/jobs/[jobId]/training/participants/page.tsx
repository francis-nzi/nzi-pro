"use client";

import { useParams } from "next/navigation";

import JobSectionShell from "@/components/job-workspace/JobSectionShell";
import TrainingWorkspaceNav from "@/components/training/TrainingWorkspaceNav";
import AttendeesTab from "@/components/training/AttendeesTab";
import { useTrainingData } from "@/components/training/useTrainingData";

function apiBaseUrl() {
  return "/api/backend";
}

export default function TrainingParticipantsPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);
  const baseUrl = apiBaseUrl();
  const { overview, loading, refresh } = useTrainingData(jobId, baseUrl);

  return (
    <JobSectionShell
      jobId={jobId}
      baseUrl={baseUrl}
      sectionLabel="Training — Participants"
      sectionHref={`/jobs/${jobId}/training/participants`}
    >
      <TrainingWorkspaceNav jobId={jobId} activeSection="participants" />
      {loading && !overview ? (
        <div className="py-10 text-center text-sm text-slate-400">Loading training data…</div>
      ) : overview ? (
        <AttendeesTab
          runs={overview.course_runs}
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
