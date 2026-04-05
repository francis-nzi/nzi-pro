"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import CustomFields from "@/components/CustomFields";
import DataOutput from "@/components/DataOutput";
import EmployeeCommutingData from "@/components/EmployeeCommutingData";
import JobActions from "@/components/JobActions";
import JobCustomDataset from "@/components/JobCustomDataset";
import JobDataEntry from "@/components/JobDataEntry";
import JobReportNew from "@/components/JobReportNew";
import JobSourceRegister from "@/components/JobSourceRegister";
import JobWorkspaceHeader from "@/components/job-workspace/JobWorkspaceHeader";
import JobWorkspaceSubtabs from "@/components/job-workspace/JobWorkspaceSubtabs";
import JobWorkspaceTabs from "@/components/job-workspace/JobWorkspaceTabs";
import { sampleEmissionsSummary, sampleJob, workspaceSubtabs, workspaceTabs } from "@/components/job-workspace/sample-data";
import type {
  JobWorkspaceJob,
  WorkspaceBreadcrumb,
  WorkspaceEmissionsSummaryData,
  WorkspaceTabKey,
} from "@/components/job-workspace/types";

type JobWorkspacePrototypeProps = {
  jobId: number;
  job?: JobWorkspaceJob | null;
  baseUrl?: string;
  emissionsSummary?: WorkspaceEmissionsSummaryData | null;
  prototypeNote?: string;
};

type JobApiRecord = {
  job_id: number;
  job_number: string | null;
  title: string | null;
  client_name: string | null;
  reporting_period_start: string | null;
  reporting_period_end: string | null;
  status: string | null;
  crm_name?: string | null;
};

type ScopeTotalsResponse = {
  total?: number | null;
  scope_1?: number | null;
  scope_2?: number | null;
  scope_3?: number | null;
};

function formatDateLabel(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function formatPeriodLabel(start: string | null | undefined, end: string | null | undefined): string {
  const startLabel = formatDateLabel(start);
  const endLabel = formatDateLabel(end);
  if (startLabel && endLabel) return `${startLabel} - ${endLabel}`;
  return startLabel || endLabel || "Reporting period not set";
}

function mapLiveJob(job: JobApiRecord): JobWorkspaceJob {
  const jobNumber = job.job_number?.trim() || `J${String(job.job_id).padStart(6, "0")}`;
  const title = job.title?.trim() || "Job";
  const clientName = job.client_name?.trim() || "Client";
  const statusLabel = job.status?.trim() || "Draft";
  const ownerLabel = job.crm_name?.trim() || "Unassigned";
  return {
    jobId: job.job_id,
    jobNumber,
    jobTitle: title,
    clientName,
    reportingPeriodLabel: formatPeriodLabel(job.reporting_period_start, job.reporting_period_end),
    statusLabel,
    ownerLabel,
    crmLabel: job.crm_name?.trim() || undefined,
  };
}

function mapScopeTotals(totals: ScopeTotalsResponse): WorkspaceEmissionsSummaryData {
  return {
    totalTco2e: typeof totals.total === "number" ? totals.total : null,
    scope1Tco2e: typeof totals.scope_1 === "number" ? totals.scope_1 : null,
    scope2Tco2e: typeof totals.scope_2 === "number" ? totals.scope_2 : null,
    scope3Tco2e: typeof totals.scope_3 === "number" ? totals.scope_3 : null,
    label: "Current job totals",
  };
}

export default function JobWorkspacePrototype({
  jobId,
  job,
  baseUrl = "/api/backend",
  emissionsSummary,
  prototypeNote,
}: JobWorkspacePrototypeProps) {
  const [liveJob, setLiveJob] = useState<JobWorkspaceJob | null>(null);
  const [liveSummary, setLiveSummary] = useState<WorkspaceEmissionsSummaryData | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "fallback">("loading");
  const [activeTab, setActiveTab] = useState<WorkspaceTabKey>("setup");
  const [activeSubtab, setActiveSubtab] = useState(workspaceSubtabs.setup[0]?.key ?? "");

  useEffect(() => {
    setActiveSubtab(workspaceSubtabs[activeTab][0]?.key ?? "");
  }, [activeTab]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function loadLiveJob() {
      setLoadState("loading");
      try {
        const [jobRes, totalsRes] = await Promise.all([
          fetch(`${baseUrl}/jobs/${jobId}`, {
            credentials: "include",
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch(`${baseUrl}/jobs/${jobId}/scope-totals`, {
            credentials: "include",
            cache: "no-store",
            signal: controller.signal,
          }),
        ]);

        if (!jobRes.ok) {
          throw new Error(`Job request failed (${jobRes.status})`);
        }

        const liveJobData = mapLiveJob(await jobRes.json());
        if (cancelled) return;
        setLiveJob(liveJobData);

        if (totalsRes.ok) {
          const liveSummaryData = mapScopeTotals(await totalsRes.json());
          if (!cancelled) setLiveSummary(liveSummaryData);
        } else if (!cancelled) {
          setLiveSummary(null);
        }

        if (!cancelled) setLoadState("ready");
      } catch (error) {
        if (cancelled) return;
        console.error("Prototype job load failed:", error);
        setLiveJob(null);
        setLiveSummary(null);
        setLoadState("fallback");
      }
    }

    void loadLiveJob();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [baseUrl, jobId]);

  const jobData = liveJob ?? job ?? sampleJob;
  const summaryData = liveSummary ?? emissionsSummary ?? sampleEmissionsSummary;

  const breadcrumbs: WorkspaceBreadcrumb[] = useMemo(
    () => [
      { label: "Clients", href: "/clients" },
      { label: jobData.clientName, href: "/clients" },
      { label: "Jobs", href: "/jobs" },
      { label: jobData.jobNumber },
    ],
    [jobData.clientName, jobData.jobNumber]
  );

  const subtabs = useMemo(() => workspaceSubtabs[activeTab] ?? [], [activeTab]);
  const showSubtabs = activeTab === "setup" || activeTab === "outputs" || activeTab === "report";
  const note =
    loadState === "fallback"
      ? "Live job data is unavailable right now, so this prototype is showing fallback preview data."
      : prototypeNote ?? "Prototype shell only. Use this route to review the top-nav layout.";
  return (
    <div className="space-y-4">
      <JobWorkspaceHeader
        breadcrumbs={breadcrumbs}
        job={jobData}
        emissionsSummary={summaryData}
        isPrototype
        note={note}
      />

      <JobWorkspaceTabs activeTab={activeTab} tabs={workspaceTabs} onTabChange={setActiveTab} />

      {showSubtabs ? <JobWorkspaceSubtabs activeSubtab={activeSubtab} subtabs={subtabs} onSubtabChange={setActiveSubtab} /> : null}

      <WorkspacePanels
        activeTab={activeTab}
        activeSubtab={activeSubtab}
        job={jobData}
        baseUrl={baseUrl}
        onTabChange={setActiveTab}
        onSubtabChange={setActiveSubtab}
      />
    </div>
  );
}

function WorkspacePanels({
  activeTab,
  activeSubtab,
  job,
  baseUrl,
  onTabChange,
  onSubtabChange,
}: {
  activeTab: WorkspaceTabKey;
  activeSubtab: string;
  job: JobWorkspaceJob;
  baseUrl: string;
  onTabChange: (tab: WorkspaceTabKey) => void;
  onSubtabChange: (subtab: string) => void;
}) {
  if (activeTab === "setup") {
    return (
      <div className="space-y-6">
        {activeSubtab === "job-details" ? <JobDetailsPanel job={job} /> : null}
        {activeSubtab === "custom-fields" ? (
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle style={{ color: "#F26624" }}>Custom Fields</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-sm text-muted-foreground">
                These custom fields are configured in Admin → Custom Fields. Required fields must be completed before
                saving.
              </p>
              <CustomFields entityId={job.jobId} entityType="job" baseUrl={baseUrl} />
            </CardContent>
          </Card>
        ) : null}
        {activeSubtab === "report-variables" ? (
          <PlaceholderCard
            title="Job Report Variables"
            text="This area will hold the report metadata and template placeholders used by the report builder."
            body="For the prototype, keep this area as a reminder that report metadata and custom fields are separate concerns."
          />
        ) : null}
      </div>
    );
  }

  if (activeTab === "data") {
    return (
      <div className="space-y-6">
        {activeSubtab === "data-entry" ? <JobDataEntry jobId={job.jobId} showEmissionsSummary={false} /> : null}
        {activeSubtab === "employee-commuting" ? (
          <EmployeeCommutingData
            jobId={job.jobId}
            baseUrl={baseUrl}
            jobNumber={job.jobNumber}
            clientName={job.clientName}
            reportingPeriodStart={null}
            reportingPeriodEnd={null}
            showEmissionsSummary={false}
          />
        ) : null}
        {activeSubtab === "asset-register" ? (
          <JobSourceRegister
            jobId={job.jobId}
            baseUrl={baseUrl}
            sourceType="asset"
            title="Asset Register"
            description="Manage assets that feed job-level emissions and source grouping."
            jobNumber={job.jobNumber}
            clientName={job.clientName}
            reportingYear={2026}
            showEmissionsSummary={false}
          />
        ) : null}
        {activeSubtab === "business-travel" ? (
          <JobSourceRegister
            jobId={job.jobId}
            baseUrl={baseUrl}
            sourceType="business_travel"
            title="Business Travel"
            description="Manage business travel sources and their associated job data."
            jobNumber={job.jobNumber}
            clientName={job.clientName}
            reportingYear={2026}
            showEmissionsSummary={false}
          />
        ) : null}
        {activeSubtab === "custom-dataset" ? <JobCustomDataset jobId={job.jobId} baseUrl={baseUrl} /> : null}
        {activeSubtab === "data-upload" ? (
          <PlaceholderCard
            title="Data Upload"
            text="Upload and staging tools can live here alongside the data-entry screens."
            body="This prototype focuses on the new top-nav shell first, so the upload workflow can be slotted in next."
          />
        ) : null}
        {activeSubtab === "job-only-factors" ? (
          <PlaceholderCard
            title="Job-Only Factors"
            text="Job-specific factor overrides and one-off factors can be previewed here."
            body="We can wire the existing custom factor picker into this slot after the shell is settled."
          />
        ) : null}
        {activeSubtab === "spend-data" ? (
          <PlaceholderCard
            title="Spend Data"
            text="Spend import and mapping workflows can be added here."
            body="This slot stays intentionally simple while we validate spacing and navigation flow."
          />
        ) : null}
      </div>
    );
  }

  if (activeTab === "outputs") {
    return (
      <div className="space-y-6">
        {activeSubtab === "data-output" ? <DataOutput jobId={job.jobId} baseUrl={baseUrl} showEmissionsSummary={false} /> : null}
        {activeSubtab === "actions" ? <JobActions jobId={job.jobId} baseUrl={baseUrl} /> : null}
        {activeSubtab === "report" ? (
          <PlaceholderCard
            title="Report handoff"
            text="The report builder lives in the dedicated Report tab in this prototype."
            body="This Outputs slot is here to keep the navigation path visible without duplicating the full drafting experience."
          />
        ) : null}
      </div>
    );
  }

  if (activeTab === "report") {
    return (
      <div className="space-y-6">
        <JobReportNew
          jobId={job.jobId}
          baseUrl={baseUrl}
          showEmissionsSummary={false}
          onOpenActions={() => {
            onTabChange("outputs");
            onSubtabChange("actions");
          }}
          onOpenLegacyReporting={() => {
            onTabChange("outputs");
            onSubtabChange("report");
          }}
        />
      </div>
    );
  }

  if (activeTab === "analysis") {
    return (
      <PlaceholderCard
        title="Life Cycle Analysis"
        text="LCA and other analytical views will sit here."
        body="For now, this section is a placeholder so we can test the shell and tab density before wiring more content."
      />
    );
  }

  if (activeTab === "communications") {
    return (
      <PlaceholderCard
        title="Communications"
        text="Timeline, inbox, notes, email, tasks, and automation stay together here."
        body="This can be expanded once the shell has been validated on desktop and tablet."
      />
    );
  }

  return (
    <PlaceholderCard
      title="Financial"
      text="Quotes, invoices, other costs, and P&L can live here."
      body="Keep this collapsed in the prototype until we’ve confirmed the top-nav pattern is comfortable."
    />
  );
}

function JobDetailsPanel({ job }: { job: JobWorkspaceJob }) {
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle>Job Details</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <Detail label="Job Number" value={job.jobNumber} />
        <Detail label="Client" value={job.clientName} />
        <Detail label="Status" value={job.statusLabel} />
        <Detail label="Owner" value={job.ownerLabel} />
        <Detail label="Reporting Period" value={job.reportingPeriodLabel} />
        <Detail label="CRM" value={job.crmLabel ?? "CRM"} />
      </CardContent>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-slate-50/60 p-4">
      <div className="text-xs uppercase tracking-[0.25em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-medium text-slate-900">{value}</div>
    </div>
  );
}

function PlaceholderCard({
  title,
  text,
  body,
}: {
  title: string;
  text: string;
  body: string;
}) {
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{text}</p>
      </CardHeader>
      <CardContent>
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-4 text-sm text-slate-600">
          {body}
        </div>
      </CardContent>
    </Card>
  );
}
