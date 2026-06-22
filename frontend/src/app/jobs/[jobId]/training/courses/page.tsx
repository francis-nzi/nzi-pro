"use client";

import { useParams } from "next/navigation";

import JobSectionShell from "@/components/job-workspace/JobSectionShell";
import TrainingWorkspaceNav from "@/components/training/TrainingWorkspaceNav";
import CourseTab from "@/components/training/CourseTab";
import { useTrainingData } from "@/components/training/useTrainingData";

function apiBaseUrl() {
  return "/api/backend";
}

export default function TrainingCoursesPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);
  const baseUrl = apiBaseUrl();
  const { overview, loading, refresh } = useTrainingData(jobId, baseUrl);

  return (
    <JobSectionShell
      jobId={jobId}
      baseUrl={baseUrl}
      sectionLabel="Training — Courses"
      sectionHref={`/jobs/${jobId}/training/courses`}
    >
      <TrainingWorkspaceNav jobId={jobId} activeSection="courses" />
      {loading && !overview ? (
        <div className="py-10 text-center text-sm text-slate-400">Loading training data…</div>
      ) : overview ? (
        <CourseTab products={overview.products} baseUrl={baseUrl} onRefresh={refresh} />
      ) : (
        <div className="py-10 text-center text-sm text-slate-400">No training data yet.</div>
      )}
    </JobSectionShell>
  );
}
