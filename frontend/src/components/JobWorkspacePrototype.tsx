"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import EmissionsSummary from "@/components/EmissionsSummary";
import PageHeader from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import JobActions from "@/components/JobActions";
import JobCustomDataset from "@/components/JobCustomDataset";
import JobCustomFactors from "@/components/JobCustomFactors";
import JobDataEntry from "@/components/JobDataEntry";
import SpendDataCollection from "@/components/SpendDataCollection";

type JobSummary = {
  job_number?: string | null;
  title?: string | null;
  client_name?: string | null;
  status?: string | null;
  reporting_period_start?: string | null;
  reporting_period_end?: string | null;
  reporting_year?: number | null;
  crm_name?: string | null;
  client_db_id?: number | null;
};

type WorkspaceSection = {
  value: string;
  label: string;
  description: string;
};

type WorkspaceGroup = {
  value: string;
  label: string;
  sections: WorkspaceSection[];
};

const WORKSPACE_GROUPS: WorkspaceGroup[] = [
  {
    value: "setup",
    label: "Setup",
    sections: [
      {
        value: "setup-overview",
        label: "Setup Overview",
        description: "Prototype shell only. This is the place for job metadata, templates, and readiness checks.",
      },
    ],
  },
  {
    value: "data",
    label: "Data",
    sections: [
      {
        value: "data-entry",
        label: "Data Entry",
        description: "The wide entry area that needs the most horizontal space.",
      },
      {
        value: "custom-dataset",
        label: "Custom Dataset",
        description: "Prototype for custom scope mapping and overrides.",
      },
      {
        value: "custom-factors",
        label: "Job-Only Factors",
        description: "Job-specific factors stay visible without stealing the whole screen.",
      },
      {
        value: "spend-data",
        label: "Spend Data",
        description: "Spend-led capture and mapping work can live alongside other data tabs.",
      },
    ],
  },
  {
    value: "outputs",
    label: "Outputs",
    sections: [
      {
        value: "actions",
        label: "Actions",
        description: "Action planning stays visible while the report story is being built.",
      },
      {
        value: "report-new",
        label: "Report (New)",
        description: "The report writer can slot into the same workspace shell when ready.",
      },
    ],
  },
];

function formatDisplayDate(dateValue?: string | null): string {
  if (!dateValue) return "";
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return String(dateValue);
  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function JobWorkspacePrototype({
  jobId,
  baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/backend",
}: {
  jobId: number;
  baseUrl?: string;
}) {
  const [job, setJob] = useState<JobSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeGroup, setActiveGroup] = useState<WorkspaceGroup["value"]>("setup");
  const [sectionByGroup, setSectionByGroup] = useState<Record<string, string>>({
    setup: "setup-overview",
    data: "data-entry",
    outputs: "actions",
  });

  useEffect(() => {
    let cancelled = false;
    const loadJob = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`${baseUrl}/jobs/${jobId}`, { credentials: "include" });
        if (!res.ok) {
          throw new Error(`Failed to load job (${res.status})`);
        }
        const payload = await res.json();
        if (!cancelled) {
          setJob(payload?.job || payload || null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load prototype workspace");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadJob();

    return () => {
      cancelled = true;
    };
  }, [baseUrl, jobId]);

  const activeGroupConfig = useMemo(
    () => WORKSPACE_GROUPS.find((group) => group.value === activeGroup) || WORKSPACE_GROUPS[0],
    [activeGroup]
  );

  const activeSection =
    activeGroupConfig.sections.find((section) => section.value === sectionByGroup[activeGroup]) ||
    activeGroupConfig.sections[0];

  const jobNumberLabel =
    (job?.job_number ?? (Number.isFinite(jobId) ? `Job ${jobId}` : "Job")).trim() || "Job";
  const jobTitleLabel = (job?.title || "").trim();
  const clientLabel = (job?.client_name || "Client").trim() || "Client";
  const ownerLabel = (job?.crm_name || "Unassigned").trim() || "Unassigned";
  const reportingPeriodLabel =
    job?.reporting_period_start && job?.reporting_period_end
      ? `${formatDisplayDate(job.reporting_period_start)} - ${formatDisplayDate(job.reporting_period_end)}`
      : job?.reporting_year
        ? `Year ${job.reporting_year}`
        : "Reporting period not set";

  const openStableJob = `/jobs/${jobId}`;

  function setSection(value: string) {
    setSectionByGroup((current) => ({ ...current, [activeGroup]: value }));
  }

  function renderWorkspace() {
    switch (activeGroup) {
      case "setup":
        return (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Setup Overview</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>
                  This prototype keeps the job header, summary, and workspace navigation at the top so the
                  work area gets the full width.
                </p>
                <p>
                  The sections below are representative only. We can expand this shell gradually without
                  touching the stable Jobs page again.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Badge variant="outline">{jobNumberLabel}</Badge>
                  <Badge variant="outline">{clientLabel}</Badge>
                  <Badge variant="outline">{ownerLabel}</Badge>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Prototype Notes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>Try this route on desktop and tablet to check whether the top-nav pattern feels wider and calmer.</p>
                <p>Keep the current Jobs page stable while we validate the shell here first.</p>
              </CardContent>
            </Card>
          </div>
        );
      case "data":
        switch (activeSection.value) {
          case "data-entry":
            return <JobDataEntry jobId={jobId} />;
          case "custom-dataset":
            return <JobCustomDataset jobId={jobId} baseUrl={baseUrl} />;
          case "custom-factors":
            return <JobCustomFactors jobId={jobId} baseUrl={baseUrl} />;
          case "spend-data":
            return <SpendDataCollection jobId={jobId} baseUrl={baseUrl} />;
          default:
            return null;
        }
      case "outputs":
        switch (activeSection.value) {
          case "actions":
            return (
              <JobActions
                jobId={jobId}
                baseUrl={baseUrl}
                onOpenReportNew={() => {
                  setActiveGroup("outputs");
                  setSectionByGroup((current) => ({ ...current, outputs: "report-new" }));
                }}
              />
            );
          case "report-new":
            return (
              <Card>
                <CardHeader>
                  <CardTitle>Report (New) placeholder</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <p>
                    This prototype keeps the report shell out of the main page while we test the top-nav
                    pattern.
                  </p>
                  <p>
                    Use the stable job page to open the live report editor while we iterate on the new shell.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild>
                      <Link href={openStableJob}>Open stable job page</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          default:
            return null;
        }
      default:
        return null;
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <PageHeader
          title={jobNumberLabel}
          subtitle={jobTitleLabel || undefined}
          breadcrumbs={[
            { label: "Clients", href: "/clients" },
            job?.client_db_id ? { label: clientLabel, href: `/clients/${job.client_db_id}` } : { label: clientLabel },
            { label: "Jobs", href: "/jobs" },
            { label: jobNumberLabel },
          ]}
          titleSuffix={<Badge className="border-slate-200 bg-slate-50 text-slate-700">Prototype</Badge>}
          meta={
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span>{clientLabel}</span>
                <span>•</span>
                <span>{reportingPeriodLabel}</span>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="border-muted-foreground/20 text-muted-foreground">
                  Owner: {ownerLabel}
                </Badge>
                {Number.isFinite(jobId) ? (
                  <Badge variant="outline" className="border-muted-foreground/20 text-muted-foreground">
                    Job ID: {jobId}
                  </Badge>
                ) : null}
              </div>
            </div>
          }
          actionsClassName="w-full lg:w-auto justify-start lg:justify-end"
          actions={
            <div className="flex flex-col gap-2 sm:items-end">
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <Link href={openStableJob}>Open stable job page</Link>
                </Button>
                {job?.client_db_id ? (
                  <Button variant="secondary" asChild>
                    <Link href={`/?clientId=${job.client_db_id}&jobId=${jobId}`}>Open in Hub</Link>
                  </Button>
                ) : (
                  <Button variant="secondary" asChild>
                    <Link href={`/?jobId=${jobId}`}>Open in Hub</Link>
                  </Button>
                )}
                <Button variant="outline" asChild>
                  <Link href="/jobs">Back to Jobs</Link>
                </Button>
              </div>
            </div>
          }
        />

        {error ? <div className="mb-4 text-sm text-destructive">{error}</div> : null}
        {loading ? <div className="mb-4 text-sm text-muted-foreground">Loading prototype...</div> : null}

        <div className="space-y-6">
          <EmissionsSummary jobId={jobId} baseUrl={baseUrl} variant="compact" />

          <div className="rounded-2xl border bg-slate-50 p-4">
            <div className="flex flex-wrap gap-2">
              {WORKSPACE_GROUPS.map((group) => (
                <Button
                  key={group.value}
                  type="button"
                  variant={activeGroup === group.value ? "default" : "outline"}
                  className="h-9 rounded-full px-4"
                  onClick={() => setActiveGroup(group.value)}
                >
                  {group.label}
                </Button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {activeGroupConfig.sections.map((section) => {
                const isActive = activeSection.value === section.value;
                return (
                  <Button
                    key={section.value}
                    type="button"
                    variant={isActive ? "default" : "outline"}
                    className="h-9 rounded-full px-4"
                    onClick={() => setSection(section.value)}
                  >
                    {section.label}
                  </Button>
                );
              })}
            </div>
          </div>

          <Card>
            <CardHeader className="space-y-2">
              <CardTitle>{activeSection.label}</CardTitle>
              <div className="text-sm text-muted-foreground">{activeSection.description}</div>
            </CardHeader>
            <CardContent>{renderWorkspace()}</CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
