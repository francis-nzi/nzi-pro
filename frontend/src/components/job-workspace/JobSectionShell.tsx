"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import JobWorkspaceHeader from "./JobWorkspaceHeader";
import JobWorkspaceTabs from "./JobWorkspaceTabs";
import JobWorkspaceSubtabs from "./JobWorkspaceSubtabs";
import type { JobWorkspaceJob, WorkspaceBreadcrumb, WorkspaceGroupKey, WorkspaceSubtab, WorkspaceTab } from "./types";
import { getAuthUserIdentifier, getToken } from "@/lib/auth-client";

type JobSectionShellProps = {
  jobId: number;
  baseUrl?: string;
  sectionLabel: string;
  sectionHref?: string;
  activeGroup?: WorkspaceGroupKey;
  activeSubtab?: string;
  children?: ReactNode;
  renderContent?: (job: Job) => ReactNode;
};

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

function apiBaseUrl(): string {
  return "/api/backend";
}

function authHeaders(): HeadersInit {
  const headers: Record<string, string> = {};
  const token = getToken();
  const userIdentifier = getAuthUserIdentifier();
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (userIdentifier) headers["X-User-Email"] = userIdentifier;
  return headers;
}

const GROUP_SUBTABS: Record<WorkspaceGroupKey, WorkspaceSubtab[]> = {
  setup: [
    { key: "setup-overview", label: "Setup Overview", href: "/jobs/__JOB_ID__/setup" },
    { key: "setup-custom-fields", label: "Custom Fields", href: "/jobs/__JOB_ID__/setup" },
    { key: "setup-report-variables", label: "Job Report Variables", href: "/jobs/__JOB_ID__/setup" },
  ],
  data: [
    { key: "data-entry", label: "Data Entry", href: "/jobs/__JOB_ID__/data-entry" },
    { key: "employee-commuting", label: "Employee Commuting", href: "/jobs/__JOB_ID__/data-entry/employee-commuting" },
    { key: "asset-register", label: "Asset Register", href: "/jobs/__JOB_ID__/data-entry/asset-register" },
    { key: "business-travel", label: "Business Travel", href: "/jobs/__JOB_ID__/data-entry/business-travel" },
    { key: "upload", label: "Data Upload", href: "/jobs/__JOB_ID__?tab=upload" },
    { key: "custom-dataset", label: "Custom Dataset", href: "/jobs/__JOB_ID__/data-entry/custom-dataset" },
    { key: "custom-factors", label: "Job-Only Factors", href: "/jobs/__JOB_ID__/data-entry/custom-factors" },
    { key: "spend-data", label: "Spend Data", href: "/jobs/__JOB_ID__/data-entry/spend-data" },
    { key: "notes", label: "Notes", href: "/jobs/__JOB_ID__/data-entry/notes" },
  ],
  outputs: [
    { key: "data-output", label: "Data Output", href: "/jobs/__JOB_ID__/outputs" },
    { key: "actions", label: "Actions", href: "/jobs/__JOB_ID__?tab=actions" },
  ],
  report: [{ key: "report-new", label: "Report (New)", href: "/jobs/__JOB_ID__/report-new" }],
  analysis: [{ key: "lca", label: "Life Cycle Analysis", href: "/jobs/__JOB_ID__/lca" }],
  insights: [],
  communications: [
    { key: "communications-timeline", label: "Timeline", href: "/jobs/__JOB_ID__/communications/timeline" },
    { key: "communications-inbox", label: "Inbox", href: "/jobs/__JOB_ID__/communications/inbox" },
    { key: "communications-notes", label: "Notes", href: "/jobs/__JOB_ID__/communications/notes" },
    { key: "communications-email", label: "Email", href: "/jobs/__JOB_ID__/communications/email" },
    { key: "communications-tasks", label: "Tasks", href: "/jobs/__JOB_ID__/communications/tasks" },
    { key: "communications-automation", label: "Automation", href: "/jobs/__JOB_ID__/communications/automation" },
    { key: "communications-crm", label: "CRM Timeline", href: "/jobs/__JOB_ID__/communications/crm" },
  ],
  financial: [
    { key: "financial-quotes", label: "Quotes", href: "/jobs/__JOB_ID__/financial/quotes" },
    { key: "financial-invoices", label: "Invoices", href: "/jobs/__JOB_ID__/financial/invoices" },
    { key: "financial-other-costs", label: "Other Costs", href: "/jobs/__JOB_ID__/financial/other-costs" },
    { key: "financial-profit-loss", label: "Profit & Loss", href: "/jobs/__JOB_ID__/financial/profit-loss" },
  ],
  admin: [
    { key: "files", label: "Files", href: "/jobs/__JOB_ID__/admin/files" },
    { key: "time", label: "Time Entries", href: "/jobs/__JOB_ID__/admin/time" },
  ],
};

export default function JobSectionShell({
  jobId,
  baseUrl = apiBaseUrl(),
  sectionLabel,
  sectionHref,
  activeGroup,
  activeSubtab,
  children,
  renderContent,
}: JobSectionShellProps) {
  const [job, setJob] = useState<Job | null>(null);
  const [clientOwnerLabel, setClientOwnerLabel] = useState<string>("");
  const [clientBenchmarkPeriodLabel, setClientBenchmarkPeriodLabel] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function formatDateLabel(value: string | null | undefined): string {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    return parsed.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

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
        const res = await fetch(`${baseUrl}/jobs/${jobId}`, {
          credentials: "include",
          headers: authHeaders(),
        });
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
  useEffect(() => {
    let cancelled = false;

    async function loadClientOwner() {
      if (!job?.client_db_id) {
        setClientOwnerLabel("");
        setClientBenchmarkPeriodLabel("");
        return;
      }

      try {
        const res = await fetch(`${baseUrl}/clients/${job.client_db_id}`, {
          credentials: "include",
          headers: authHeaders(),
        });
        if (!res.ok || cancelled) return;
        const clientJson = (await res.json()) as {
          crm_owner?: string | null;
          benchmark_period_start?: string | null;
          benchmark_period_end?: string | null;
        };
        setClientOwnerLabel((clientJson.crm_owner ?? "").trim());
        const benchmarkStart = formatDateLabel(clientJson.benchmark_period_start);
        const benchmarkEnd = formatDateLabel(clientJson.benchmark_period_end);
        setClientBenchmarkPeriodLabel(benchmarkStart && benchmarkEnd ? `${benchmarkStart} - ${benchmarkEnd}` : "");
      } catch {
        if (!cancelled) {
          setClientOwnerLabel("");
          setClientBenchmarkPeriodLabel("");
        }
      }
    }

    void loadClientOwner();

    return () => {
      cancelled = true;
    };
  }, [baseUrl, job?.client_db_id]);

  const workspaceJob: JobWorkspaceJob | null = job
    ? {
        jobId: job.job_id,
        jobNumber: job.job_number?.trim() ? `Job No: ${job.job_number.trim()}` : `Job ${job.job_id}`,
        jobTitle: job.title ?? sectionLabel,
        clientName: job.client_name ?? "Client",
        benchmarkPeriodLabel: clientBenchmarkPeriodLabel || undefined,
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
        {
          label: job.job_number?.trim() ? `Job No: ${job.job_number.trim()}` : `Job ${job.job_id}`,
          href: `/jobs/${job.job_id}`,
        },
        { label: sectionLabel, href: sectionHref ?? `/jobs/${job.job_id}` },
      ]
    : [{ label: sectionLabel, href: sectionHref ?? `/jobs/${jobId}` }];

  const activeWorkspaceGroup = activeGroup || "setup";
  const workspaceTabs: WorkspaceTab[] = [
    { key: "setup", label: "Setup", href: `/jobs/${jobId}/setup` },
    { key: "data", label: "Data", href: `/jobs/${jobId}/data-entry` },
    { key: "outputs", label: "Outputs", href: `/jobs/${jobId}/outputs` },
    { key: "report", label: "Report", href: `/jobs/${jobId}/report-new` },
    { key: "analysis", label: "Analysis", href: `/jobs/${jobId}/lca` },
    { key: "insights", label: "Insights", href: `/jobs/${jobId}/insights` },
    { key: "communications", label: "Communications", href: `/jobs/${jobId}/communications/timeline` },
    { key: "financial", label: "Financial", href: `/jobs/${jobId}/financial/quotes` },
    { key: "admin", label: "Admin", href: `/jobs/${jobId}/admin/files` },
  ];
  const activeWorkspaceSubtabs = (GROUP_SUBTABS[activeWorkspaceGroup] || []).map((subtab) => ({
    ...subtab,
    href: subtab.href?.replaceAll("__JOB_ID__", String(jobId)),
  }));
  const activeWorkspaceSubtab =
    activeSubtab ||
    activeWorkspaceSubtabs[0]?.key ||
    (activeWorkspaceGroup === "setup" ? "setup-overview" : "");

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        {workspaceJob ? (
          <JobWorkspaceHeader breadcrumbs={breadcrumbs} jobId={jobId} baseUrl={baseUrl} job={workspaceJob} />
        ) : null}
        <div className="mt-4">
          <JobWorkspaceTabs
            activeTab={activeWorkspaceGroup}
            tabs={workspaceTabs}
            onTabChange={() => undefined}
          />
        </div>
        {activeWorkspaceSubtabs.length > 0 ? (
          <div className="mt-4">
            <JobWorkspaceSubtabs
              activeSubtab={activeWorkspaceSubtab}
              subtabs={activeWorkspaceSubtabs}
              onSubtabChange={() => undefined}
            />
          </div>
        ) : null}
        {loading ? <div className="mt-4 text-sm text-muted-foreground">Loading {sectionLabel.toLowerCase()}...</div> : null}
        {error ? <div className="mt-4 text-sm text-destructive">{error}</div> : null}
        {job ? <div className="mt-6">{renderContent ? renderContent(job) : children}</div> : null}
      </div>
    </div>
  );
}
