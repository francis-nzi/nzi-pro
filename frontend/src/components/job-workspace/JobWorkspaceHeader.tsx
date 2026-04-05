"use client";

import Link from "next/link";
import type { JobWorkspaceJob, WorkspaceBreadcrumb, WorkspaceEmissionsSummaryData } from "./types";

type JobWorkspaceHeaderProps = {
  breadcrumbs: WorkspaceBreadcrumb[];
  job: JobWorkspaceJob;
  emissionsSummary: WorkspaceEmissionsSummaryData;
  isPrototype?: boolean;
  isSampleContext?: boolean;
  note?: string;
};

function formatNumber(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return "No data";
  }
  return value.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function EmissionsStrip({ data }: { data: WorkspaceEmissionsSummaryData }) {
  return (
    <div className="rounded-2xl border bg-slate-50/80 px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-[0.32em] text-slate-500">Emissions summary</div>
        {data.label ? <div className="text-xs text-slate-500">{data.label}</div> : null}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Stat label="Total tCO2e" value={formatNumber(data.totalTco2e)} emphasis />
        <Stat label="Scope 1" value={formatNumber(data.scope1Tco2e)} tone="red" />
        <Stat label="Scope 2" value={formatNumber(data.scope2Tco2e)} tone="orange" />
        <Stat label="Scope 3" value={formatNumber(data.scope3Tco2e)} tone="blue" />
      </div>
      {data.note ? <p className="mt-3 text-xs text-slate-500">{data.note}</p> : null}
    </div>
  );
}

function Stat({
  label,
  value,
  emphasis = false,
  tone,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  tone?: "red" | "orange" | "blue";
}) {
  const toneClass =
    tone === "red"
      ? "text-red-600"
      : tone === "orange"
        ? "text-orange-600"
        : tone === "blue"
          ? "text-blue-600"
          : "text-slate-900";

  return (
    <div className="min-w-0 rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200">
      <div className={`text-[1.15rem] font-semibold leading-none sm:text-[1.35rem] ${emphasis ? "text-slate-900" : toneClass}`}>
        {value}
      </div>
      <div className="mt-1 text-[11px] uppercase tracking-[0.16em] text-slate-500">{label}</div>
    </div>
  );
}

export default function JobWorkspaceHeader({
  breadcrumbs,
  job,
  emissionsSummary,
  isPrototype,
  isSampleContext,
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
              <span className="rounded-full border px-3 py-1 text-xs font-medium text-slate-700">
                {isPrototype ? "Prototype" : "Workspace"}
              </span>
              {isSampleContext ? (
                <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                  Sample data
                </span>
              ) : null}
            </div>
            <div className="text-lg text-slate-700">{job.jobTitle}</div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
              <span>{job.clientName}</span>
              <span>·</span>
              <span>{job.reportingPeriodLabel}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Pill label={`Owner: ${job.ownerLabel}`} />
              <Pill label={`Status: ${job.statusLabel}`} />
            </div>
            {note ? <p className="max-w-2xl text-xs leading-5 text-slate-500">{note}</p> : null}
          </div>
          <div className="min-w-0">
            <EmissionsStrip data={emissionsSummary} />
          </div>
        </div>
      </div>
    </section>
  );
}

function Pill({ label }: { label: string }) {
  return (
    <span className="rounded-full border bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm">
      {label}
    </span>
  );
}
