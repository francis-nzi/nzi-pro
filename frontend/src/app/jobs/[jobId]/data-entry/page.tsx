"use client";

import { useParams } from "next/navigation";

import ActivityHistoryModal from "@/components/ActivityHistoryModal";
import JobDataEntry from "@/components/JobDataEntry";
import JobSectionShell from "@/components/job-workspace/JobSectionShell";

function apiBaseUrl(): string {
  return "/api/backend";
}

export default function JobDataEntryPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);
  const baseUrl = apiBaseUrl();

  return (
    <JobSectionShell
      jobId={jobId}
      baseUrl={baseUrl}
      sectionLabel="Data Entry"
      sectionHref={`/jobs/${jobId}/data-entry`}
      activeGroup="data"
      activeSubtab="data-entry"
      headerSlot={
        <ActivityHistoryModal
          jobId={jobId}
          baseUrl={baseUrl}
          entityType="job_scope_row"
          label="Activity History"
        />
      }
    >
      <JobDataEntry jobId={jobId} />
    </JobSectionShell>
  );
}
