"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";

import JobSectionShell from "@/components/job-workspace/JobSectionShell";
import JobPortalManagement from "@/components/JobPortalManagement";

function apiBaseUrl(): string {
  return "/api/backend";
}

function PortalManagementInner() {
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);
  const baseUrl = apiBaseUrl();

  return (
    <JobSectionShell
      jobId={jobId}
      baseUrl={baseUrl}
      sectionLabel="Portal Management"
      sectionHref={`/jobs/${jobId}/portal-management`}
      activeGroup="report"
      activeSubtab="portal-management"
    >
      <JobPortalManagement jobId={jobId} baseUrl={baseUrl} />
    </JobSectionShell>
  );
}

export default function PortalManagementPage() {
  return (
    <Suspense>
      <PortalManagementInner />
    </Suspense>
  );
}
