"use client";

import { useParams } from "next/navigation";

import TasksTable from "@/components/TasksTable";
import JobSectionShell from "@/components/job-workspace/JobSectionShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function apiBaseUrl(): string {
  return "/api/backend";
}

export default function JobTasksPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);
  const baseUrl = apiBaseUrl();

  return (
    <JobSectionShell
      jobId={jobId}
      baseUrl={baseUrl}
      sectionLabel="Tasks"
      sectionHref={`/jobs/${jobId}/tasks`}
      renderContent={(job) =>
        job.client_db_id ? (
          <TasksTable
            clientId={job.client_db_id}
            jobId={jobId}
            baseUrl={baseUrl}
            title="Job Tasks"
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Tasks</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Tasks require a client to be linked to this job.
            </CardContent>
          </Card>
        )
      }
    />
  );
}
