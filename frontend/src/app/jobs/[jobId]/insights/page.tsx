"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import JobInsights from "@/components/JobInsights";
import JobWorkspaceHeader from "@/components/job-workspace/JobWorkspaceHeader";
import JobWorkspaceTabs from "@/components/job-workspace/JobWorkspaceTabs";
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
  crm_owner?: string | null;
  crm_name?: string | null;
};

const JOB_TABS = [
  { key: "setup", label: "Setup", href: "/jobs/__JOB_ID__/setup" },
  { key: "data", label: "Data", href: "/jobs/__JOB_ID__/data-entry" },
  { key: "outputs", label: "Outputs", href: "/jobs/__JOB_ID__/outputs" },
  { key: "report", label: "Report", href: "/jobs/__JOB_ID__/report-new" },
  { key: "analysis", label: "Analysis", href: "/jobs/__JOB_ID__/lca" },
  { key: "insights", label: "Insights", href: "/jobs/__JOB_ID__/insights" },
  { key: "communications", label: "Communications", href: "/jobs/__JOB_ID__/communications-timeline" },
  { key: "financial", label: "Financial", href: "/jobs/__JOB_ID__/financial-quotes" },
  { key: "admin", label: "Admin", href: "/jobs/__JOB_ID__" },
] as const;

export default function JobInsightsPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);

  const [job, setJob] = useState<Job | null>(null);
  const [clientOwnerLabel, setClientOwnerLabel] = useState("");
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
        if (!cancelled) {
          setJob(json);
          setClientOwnerLabel("");
        }
        if (json.client_db_id) {
          const clientRes = await fetch(`${baseUrl}/clients/${json.client_db_id}`, { credentials: "include" });
          if (clientRes.ok && !cancelled) {
            const clientJson = (await clientRes.json()) as { crm_owner?: string | null };
            setClientOwnerLabel((clientJson.crm_owner ?? "").trim());
          }
        }
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
        ownerLabel: clientOwnerLabel || job.crm_owner || "Unassigned",
        crmLabel: job.crm_name ?? undefined,
      }
    : null;

  const breadcrumbs: WorkspaceBreadcrumb[] = job
    ? [
        { label: "Clients", href: "/clients" },
        { label: job.client_name ?? "Client", href: `/clients/${job.client_db_id}?section=jobs` },
        { label: "Jobs", href: "/jobs" },
        { label: job.job_number ?? `Job ${job.job_id}`, href: `/jobs/${job.job_id}` },
        { label: "Insights", href: `/jobs/${job.job_id}/insights` },
      ]
    : [{ label: "Insights" }];

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        {workspaceJob ? (
          <JobWorkspaceHeader breadcrumbs={breadcrumbs} jobId={jobId} baseUrl={baseUrl} job={workspaceJob} />
        ) : null}
        <div className="mt-4">
          <JobWorkspaceTabs
            activeTab="insights"
            tabs={JOB_TABS.map((tab) => ({
              ...tab,
              href: tab.href.replaceAll("__JOB_ID__", String(jobId)),
            }))}
            onTabChange={() => undefined}
          />
        </div>
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
