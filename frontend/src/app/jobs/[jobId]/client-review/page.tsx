"use client";

import { useParams } from "next/navigation";

import ClientReview from "@/components/ClientReview";
import JobSectionShell from "@/components/job-workspace/JobSectionShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function apiBaseUrl(): string {
  return "/api/backend";
}

export default function JobClientReviewPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);
  const baseUrl = apiBaseUrl();

  return (
    <JobSectionShell
      jobId={jobId}
      baseUrl={baseUrl}
      sectionLabel="Client Review"
      sectionHref={`/jobs/${jobId}/client-review`}
      activeGroup="report"
      activeSubtab="client-review"
      renderContent={(job) =>
        job.client_db_id ? (
          <ClientReview jobId={jobId} clientDbId={job.client_db_id} baseUrl={baseUrl} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Client Review</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              No client is linked to this job. Assign a client in job setup first.
            </CardContent>
          </Card>
        )
      }
    />
  );
}
