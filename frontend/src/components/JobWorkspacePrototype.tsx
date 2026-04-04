"use client";

import { useEffect, useMemo, useState } from "react";
import JobWorkspaceHeader from "@/components/job-workspace/JobWorkspaceHeader";
import JobWorkspaceSubtabs from "@/components/job-workspace/JobWorkspaceSubtabs";
import JobWorkspaceTabs from "@/components/job-workspace/JobWorkspaceTabs";
import { sampleEmissionsSummary, sampleJob, workspaceSubtabs, workspaceTabs } from "@/components/job-workspace/sample-data";
import type {
  JobWorkspaceJob,
  WorkspaceEmissionsSummaryData,
  WorkspaceTabKey,
} from "@/components/job-workspace/types";

type JobWorkspacePrototypeProps = {
  job?: JobWorkspaceJob | null;
  emissionsSummary?: WorkspaceEmissionsSummaryData | null;
  isSampleContext?: boolean;
  prototypeNote?: string;
  onOpenStableJob?: () => void;
};

const tabCopy: Record<WorkspaceTabKey, { title: string; description: string }> = {
  setup: {
    title: "Setup",
    description: "Keep job details, custom fields, and report metadata in one place before the working tabs.",
  },
  data: {
    title: "Data",
    description: "Group data-entry screens, uploads, and reusable factor tools into one broad workspace.",
  },
  outputs: {
    title: "Outputs",
    description: "Focus the output story around data output, actions, and reporting handoff.",
  },
  report: {
    title: "Report",
    description: "Reserve this area for the report drafting and preview flow.",
  },
  analysis: {
    title: "Analysis",
    description: "Place life cycle analysis and other supporting analysis views here.",
  },
  communications: {
    title: "Communications",
    description: "Keep timeline, inbox, notes, and task workflow together.",
  },
  financial: {
    title: "Financial",
    description: "Surface quotes, invoices, and other financial work in one group.",
  },
};

export default function JobWorkspacePrototype({
  job,
  emissionsSummary,
  isSampleContext = true,
  prototypeNote,
  onOpenStableJob,
}: JobWorkspacePrototypeProps) {
  const jobData = job ?? sampleJob;
  const summaryData = emissionsSummary ?? sampleEmissionsSummary;
  const [activeTab, setActiveTab] = useState<WorkspaceTabKey>("setup");
  const [activeSubtab, setActiveSubtab] = useState(workspaceSubtabs.setup[0]?.key ?? "");

  useEffect(() => {
    setActiveSubtab(workspaceSubtabs[activeTab][0]?.key ?? "");
  }, [activeTab]);

  const subtabs = useMemo(() => workspaceSubtabs[activeTab] ?? [], [activeTab]);
  const activeCopy = tabCopy[activeTab];

  return (
    <div className="space-y-6">
      <JobWorkspaceHeader
        breadcrumbs={[
          { label: "Clients", href: "/clients" },
          { label: jobData.clientName, href: `/clients` },
          { label: "Jobs", href: "/jobs" },
          { label: jobData.jobNumber },
        ]}
        job={jobData}
        emissionsSummary={summaryData}
        isPrototype
        isSampleContext={isSampleContext}
        note={prototypeNote ?? "Prototype shell only. This is the place to test the new top-nav workspace layout."}
        primaryActions={[
          {
            label: "Open stable job page",
            href: `/jobs/${jobData.jobId}`,
            variant: "primary",
          },
          {
            label: "Open in Hub",
            href: "#",
            variant: "secondary",
          },
          {
            label: "Back to Jobs",
            href: "/jobs",
            variant: "outline",
          },
        ]}
      />

      <JobWorkspaceTabs activeTab={activeTab} tabs={workspaceTabs} onTabChange={setActiveTab} />

      <div className="space-y-3">
        <JobWorkspaceSubtabs activeSubtab={activeSubtab} subtabs={subtabs} onSubtabChange={setActiveSubtab} />
        <div className="rounded-3xl border bg-white px-6 py-5 shadow-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-slate-900">{activeCopy.title}</h2>
              <p className="mt-1 max-w-3xl text-sm text-slate-500">{activeCopy.description}</p>
            </div>
            <div className="rounded-full border bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
              Prototype shell
            </div>
          </div>
        </div>
      </div>

      <WorkspacePanels activeTab={activeTab} activeSubtab={activeSubtab} />
    </div>
  );
}

function WorkspacePanels({ activeTab, activeSubtab }: { activeTab: WorkspaceTabKey; activeSubtab: string }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {activeTab === "setup" ? (
        <>
          <Panel title="Job Details" text="Primary job metadata and status live here." />
          <Panel title="Custom Fields" text="Job-level custom fields sit between job details and report variables." />
          <Panel title="Job Report Variables" text="Global report metadata and template placeholders." />
        </>
      ) : null}

      {activeTab === "data" ? (
        <>
          <Panel title="Data Entry" text="Working data entry screens for job-level inputs." />
          <Panel title="Employee Commuting" text="Preview the commuting flow, upload, and factor application." />
          <Panel title="Custom Dataset" text="Factor browsing and job-specific dataset management." />
        </>
      ) : null}

      {activeTab === "outputs" ? (
        <>
          <Panel title="Data Output" text="Export-ready data output and validation." />
          <Panel title="Actions" text="Action planning and prioritisation." />
          <Panel title="Report" text="Drafting, preview, and export handoff." />
        </>
      ) : null}

      {activeTab === "report" ? (
        <>
          <Panel title={`Report Draft - ${activeSubtab || "Draft"}`} text="Section-by-section drafting and review." />
          <Panel title="Preview and Export" text="Render the current report draft for review and output." />
        </>
      ) : null}

      {activeTab === "analysis" ? <Panel title="Life Cycle Analysis" text="LCA and supporting analysis views." /> : null}
      {activeTab === "communications" ? <Panel title="Communications" text="Timeline, inbox, notes, email, and tasks." /> : null}
      {activeTab === "financial" ? <Panel title="Financial" text="Quotes, invoices, and financial control views." /> : null}
    </div>
  );
}

function Panel({ title, text }: { title: string; text: string }) {
  return (
    <section className="rounded-2xl border bg-slate-50/60 p-5 shadow-sm">
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm text-slate-600">{text}</p>
      <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
        Placeholder content for the prototype shell.
      </div>
    </section>
  );
}

