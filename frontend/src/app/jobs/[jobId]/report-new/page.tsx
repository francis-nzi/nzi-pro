"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import JobReportNew from "@/components/JobReportNew";
import JobSectionShell from "@/components/job-workspace/JobSectionShell";

function apiBaseUrl(): string {
  return "/api/backend";
}

export default function JobReportNewPage() {
  const router = useRouter();
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);
  const [clientDbId, setClientDbId] = useState<number | null>(null);

  useEffect(() => {
    if (!Number.isFinite(jobId)) return;
    fetch(`${apiBaseUrl()}/jobs/${jobId}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.client_db_id) setClientDbId(Number(d.client_db_id)); })
      .catch(() => {});
  }, [jobId]);

  return (
    <JobSectionShell
      jobId={jobId}
      baseUrl={apiBaseUrl()}
      sectionLabel="Report Preparation"
      sectionHref={`/jobs/${jobId}/report-new`}
      activeGroup="report"
      activeSubtab="report-new"
    >
      <JobReportNew
        jobId={jobId}
        baseUrl={apiBaseUrl()}
        onOpenActions={() => { if (clientDbId) router.push(`/clients/${clientDbId}?section=actions`); }}
      />
    </JobSectionShell>
  );
}
