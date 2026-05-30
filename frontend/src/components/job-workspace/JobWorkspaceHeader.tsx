"use client";

import Link from "next/link";

import EmissionsSummary from "@/components/EmissionsSummary";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatJobFamilyLabel, jobFamilyBadgeClassName } from "@/lib/job-family";

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
  const benchmarkPeriodLabel = job.benchmarkPeriodLabel
    ? job.benchmarkPeriodLabel.replace(/^benchmark period:\s*/i, "").trim()
    : "";

  return (
    <section className="space-y-4 print:hidden">
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
            <div className="flex flex-wrap items-center gap-2 text-lg text-slate-700">
              <span className="font-medium text-slate-600">{job.clientName}</span>
              <span className="text-slate-300">•</span>
              <span>{job.jobTitle}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
              {benchmarkPeriodLabel ? <span>{`Benchmark Period: ${benchmarkPeriodLabel}`}</span> : null}
              {benchmarkPeriodLabel ? <span>•</span> : null}
              <span>{job.reportingPeriodLabel}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Pill label={`Owner: ${job.ownerLabel}`} />
              {job.crmLabel ? <Pill label={`CRM: ${job.crmLabel}`} /> : null}
              {job.jobFamily ? (
                <Pill
                  label={`Family: ${formatJobFamilyLabel(job.jobFamily)}`}
                  className={jobFamilyBadgeClassName(job.jobFamily)}
                />
              ) : null}
              {job.setupCompletionLabel ? (
                <Pill
                  label={job.setupCompletionLabel}
                  className={job.setupCompletionClassName}
                />
              ) : null}
            </div>
            {note ? <p className="max-w-2xl text-xs leading-5 text-slate-500">{note}</p> : null}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button asChild variant="outline" size="sm">
                <Link href={`/jobs/${jobId}/admin/certificate`}>Emissions certificate</Link>
              </Button>
            </div>
          </div>

          <div className="min-w-0">
            {emissionsSummary ? (
              <div className="rounded-[28px] border border-slate-200/70 bg-slate-50/55 p-3.5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3 px-1 pt-0.5">
                  <div>
                    <div className="text-[0.68rem] uppercase tracking-[0.36em] text-slate-500">Emissions Summary</div>
                    <div className="mt-1 text-xs text-slate-600">{emissionsSummary.label ?? "Current job totals"}</div>
                  </div>
                  {emissionsSummary.note ? <div className="text-xs text-slate-500">{emissionsSummary.note}</div> : null}
                </div>
                <div className="mt-3.5 grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
                  <SummaryCard label="Total tCO₂e" value={emissionsSummary.totalTco2e} tone="default" />
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
    <div className="rounded-2xl border border-slate-200/75 bg-white/90 px-4 py-3.5 text-right shadow-[0_1px_0_rgba(15,23,42,0.02)]">
      <div className={`text-[0.92rem] font-semibold leading-[0.95] tracking-tight tabular-nums sm:text-[1.02rem] xl:text-[1.14rem] ${toneClassName}`}>
        {typeof value === "number" ? value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
      </div>
      <div className="mt-1.5 text-[0.56rem] uppercase tracking-[0.3em] text-slate-500">{label}</div>
    </div>
  );
}
