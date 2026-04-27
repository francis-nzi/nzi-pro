"use client";

import { useParams } from "next/navigation";

import JobFiles from "@/components/JobFiles";
import JobEmissionsCertificate from "@/components/JobEmissionsCertificate";
import JobSectionShell from "@/components/job-workspace/JobSectionShell";
import JobTimeEntries from "@/components/JobTimeEntries";

function apiBaseUrl(): string {
  return "/api/backend";
}

const ADMIN_SECTIONS = {
  files: { key: "files", label: "Files", kind: "files" as const },
  time: { key: "time", label: "Time Entries", kind: "time" as const },
  certificate: { key: "certificate", label: "Certificate", kind: "certificate" as const },
} as const;

type AdminSectionKey = keyof typeof ADMIN_SECTIONS;

export default function JobAdminSectionPage() {
  const params = useParams<{ jobId: string; section: string }>();
  const jobId = Number(params?.jobId);
  const sectionSegment = String(params?.section || "files").toLowerCase();
  const section = ADMIN_SECTIONS[sectionSegment as AdminSectionKey] ?? ADMIN_SECTIONS.files;
  const baseUrl = apiBaseUrl();

  return (
    <JobSectionShell
      jobId={jobId}
      baseUrl={baseUrl}
      sectionLabel={section.label}
      sectionHref={`/jobs/${jobId}/admin/${sectionSegment}`}
      activeGroup="admin"
      activeSubtab={section.key}
      renderContent={() =>
        section.kind === "time" ? (
          <JobTimeEntries jobId={jobId} baseUrl={baseUrl} />
        ) : section.kind === "certificate" ? (
          <JobEmissionsCertificate jobId={jobId} baseUrl={baseUrl} />
        ) : (
          <JobFiles jobId={jobId} baseUrl={baseUrl} />
        )
      }
    />
  );
}
