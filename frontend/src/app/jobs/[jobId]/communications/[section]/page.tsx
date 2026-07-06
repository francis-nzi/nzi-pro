"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

import ClientTimeline from "@/components/ClientTimeline";
import JobCommunications from "@/components/JobCommunications";
import JobSectionShell from "@/components/job-workspace/JobSectionShell";
import type { WorkspaceGroupKey } from "@/components/job-workspace/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function apiBaseUrl(): string {
  return "/api/backend";
}

const COMMUNICATIONS_SECTIONS = {
  timeline: { key: "communications-timeline", label: "Timeline", mode: "timeline" as const },
  inbox: { key: "communications-inbox", label: "Inbox", mode: "inbox" as const },
  notes: { key: "communications-notes", label: "Notes", mode: "notes" as const },
  email: { key: "communications-email", label: "Email", mode: "email" as const },
  automation: { key: "communications-automation", label: "Automation", mode: "automation" as const },
  crm: { key: "communications-crm", label: "CRM Timeline", mode: "crm" as const },
} as const;

type CommunicationsSectionKey = keyof typeof COMMUNICATIONS_SECTIONS;

export default function JobCommunicationsSectionPage() {
  const params = useParams<{ jobId: string; section: string }>();
  const router = useRouter();
  const jobId = Number(params?.jobId);
  const sectionSegment = String(params?.section || "timeline").toLowerCase();
  const baseUrl = apiBaseUrl();

  // Tasks moved to top-level nav — redirect old URL
  useEffect(() => {
    if (sectionSegment === "tasks") {
      router.replace(`/jobs/${jobId}/tasks`);
    }
  }, [sectionSegment, jobId, router]);

  if (sectionSegment === "tasks") return null;

  const section = COMMUNICATIONS_SECTIONS[sectionSegment as CommunicationsSectionKey] ?? COMMUNICATIONS_SECTIONS.timeline;

  const activeGroup: WorkspaceGroupKey = "communications";

  return (
    <JobSectionShell
      jobId={jobId}
      baseUrl={baseUrl}
      sectionLabel={section.label}
      sectionHref={`/jobs/${jobId}/communications/${sectionSegment}`}
      activeGroup={activeGroup}
      activeSubtab={section.key}
      renderContent={(job) =>
        section.mode === "crm" ? (
          job.client_db_id ? (
            <ClientTimeline clientId={job.client_db_id} baseUrl={baseUrl} jobId={jobId} />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>CRM Timeline</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">No client linked to this job.</CardContent>
            </Card>
          )
        ) : (
          <JobCommunications jobId={jobId} baseUrl={baseUrl} mode={section.mode} />
        )
      }
    />
  );
}
