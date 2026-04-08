"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import JobInsights from "@/components/JobInsights";
import JobWorkspaceHeader from "@/components/job-workspace/JobWorkspaceHeader";
import type { JobWorkspaceJob, WorkspaceBreadcrumb } from "@/components/job-workspace/types";

function apiBaseUrl(): string {
  return "/api/backend";
}

type Job = {
  job_id: number;
  job_number: string | null;
  title: string | null;
  reporting_year: number | null;
  reporting_period_start: string | null;
  reporting_period_end: string | null;
  status: string | null;
  client_db_id: number;
  client_name: string | null;
  crm_name?: string | null;
};

export default function JobInsightsPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);

  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!Number.isFinite(jobId) || jobId <= 0) {
        setError("Invalid job id");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");
      try {
        const res = await fetch(`${baseUrl}/jobs/${jobId}`, { credentials: "include" });
        if (!res.ok) {
          throw new Error(`Failed to load job (${res.status})`);
        }
        const json = (await res.json()) as Job;
        if (!cancelled) setJob(json);
      } catch (e) {
        if (!cancelled) {
          setJob(null);
          setError((e as Error).message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [baseUrl, jobId]);

  const workspaceJob: JobWorkspaceJob | null = job
    ? {
        jobId: job.job_id,
        jobNumber: job.job_number ?? `Job ${job.job_id}`,
        jobTitle: job.title ?? "Job Insights",
        clientName: job.client_name ?? "Client",
        reportingPeriodLabel:
          job.reporting_period_start && job.reporting_period_end
            ? `${new Date(job.reporting_period_start).toLocaleDateString("en-GB")} - ${new Date(job.reporting_period_end).toLocaleDateString("en-GB")}`
            : job.reporting_year
              ? `Year ${job.reporting_year}`
              : "Reporting period not set",
        statusLabel: job.status ?? "Draft",
        ownerLabel: job.crm_name ?? "Unassigned",
        crmLabel: job.crm_name ?? undefined,
      }
    : null;

  const breadcrumbs: WorkspaceBreadcrumb[] = job
    ? [
        { label: "Clients", href: "/clients" },
        { label: job.client_name ?? "Client" },
        { label: "Jobs", href: "/jobs" },
        { label: job.job_number ?? `Job ${job.job_id}` },
        { label: "Insights" },
      ]
    : [{ label: "Insights" }];

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        {workspaceJob ? (
          <JobWorkspaceHeader breadcrumbs={breadcrumbs} jobId={jobId} baseUrl={baseUrl} job={workspaceJob} />
        ) : null}
        {loading ? <div className="mt-4 text-sm text-muted-foreground">Loading insights...</div> : null}
        {error ? <div className="mt-4 text-sm text-destructive">{error}</div> : null}
        {job ? (
          <div className="mt-6">
            <JobInsights
              jobId={job.job_id}
              clientId={job.client_db_id}
              baseUrl={baseUrl}
              jobNumber={job.job_number}
              clientName={job.client_name}
              reportingYear={job.reporting_year}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
