"use client";

import Link from "next/link";

import EmissionsSummary from "@/components/EmissionsSummary";
import { cn } from "@/lib/utils";

import type {
  JobWorkspaceJob,
  WorkspaceBreadcrumb,
  WorkspaceEmissionsSummaryData,
} from "./types";

type JobWorkspaceHeaderProps = {
  breadcrumbs: WorkspaceBreadcrumb[];
  jobId: number;
  baseUrl?: string;
  job: JobWorkspaceJob;
  emissionsSummary?: WorkspaceEmissionsSummaryData | null;
  isPrototype?: boolean;
  note?: string;
};

function Pill({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "rounded-full border bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm",
        className
      )}
    >
      {label}
    </span>
  );
}

export default function JobWorkspaceHeader({
  breadcrumbs,
  jobId,
  baseUrl,
  job,
  emissionsSummary,
  isPrototype,
  note,
}: JobWorkspaceHeaderProps) {
  return (
    <section className="space-y-4">
      <nav className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
        {breadcrumbs.map((crumb, index) => (
          <div key={`${crumb.label}-${index}`} className="flex items-center gap-2">
            {crumb.href ? (
              <Link href={crumb.href} className="hover:text-slate-900">
                {crumb.label}
              </Link>
            ) : (
              <span className="text-slate-900">{crumb.label}</span>
            )}
            {index < breadcrumbs.length - 1 ? <span>/</span> : null}
          </div>
        ))}
      </nav>

      <div className="rounded-3xl border bg-white px-6 py-5 shadow-sm">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,520px)] lg:items-start">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900">{job.jobNumber}</h1>
              {isPrototype ? <Pill label="Prototype" /> : null}
              <Pill label={job.statusLabel} />
            </div>
            <div className="text-lg text-slate-700">{job.jobTitle}</div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
              <span>{job.clientName}</span>
              <span>•</span>
              <span>{job.reportingPeriodLabel}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Pill label={`Owner: ${job.ownerLabel}`} />
              {job.crmLabel ? <Pill label={`CRM: ${job.crmLabel}`} /> : null}
              {job.setupCompletionLabel ? (
                <Pill
                  label={job.setupCompletionLabel}
                  className={job.setupCompletionClassName}
                />
              ) : null}
            </div>
            {note ? <p className="max-w-2xl text-xs leading-5 text-slate-500">{note}</p> : null}
          </div>

          <div className="min-w-0">
            {emissionsSummary ? (
              <div className="rounded-[28px] border border-slate-200/70 bg-slate-50/65 p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[0.72rem] uppercase tracking-[0.32em] text-slate-500">Emissions Summary</div>
                    <div className="mt-1 text-sm text-slate-600">{emissionsSummary.label ?? "Current job totals"}</div>
                  </div>
                  {emissionsSummary.note ? <div className="text-sm text-muted-foreground">{emissionsSummary.note}</div> : null}
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <SummaryCard label="Total tCO2e" value={emissionsSummary.totalTco2e} tone="default" />
                  <SummaryCard label="Scope 1" value={emissionsSummary.scope1Tco2e} tone="red" />
                  <SummaryCard label="Scope 2" value={emissionsSummary.scope2Tco2e} tone="orange" />
                  <SummaryCard label="Scope 3" value={emissionsSummary.scope3Tco2e} tone="blue" />
                </div>
              </div>
            ) : (
              <EmissionsSummary jobId={jobId} baseUrl={baseUrl} variant="compact" className="w-full" />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function SummaryCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number | null;
  tone?: "default" | "red" | "orange" | "blue";
}) {
  const toneClassName =
    tone === "red"
      ? "text-red-600"
      : tone === "orange"
        ? "text-orange-600"
        : tone === "blue"
          ? "text-blue-600"
          : "text-slate-950";

  return (
    <div className="rounded-2xl border border-slate-200/75 bg-white/90 px-3.5 py-3 text-center shadow-[0_1px_0_rgba(15,23,42,0.02)]">
      <div className={`text-[1.05rem] font-semibold leading-none tracking-tight tabular-nums sm:text-[1.15rem] xl:text-[1.3rem] ${toneClassName}`}>
        {typeof value === "number" ? value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
      </div>
      <div className="mt-1.5 text-[0.62rem] uppercase tracking-[0.26em] text-slate-500">{label}</div>
    </div>
  );
}
