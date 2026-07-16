"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import StatusBadge from "@/components/StatusBadge";
import { jobFamilyBadgeClassName } from "@/lib/job-family";

export type ClientJobRow = {
  job_id: number;
  job_number: string | null;
  title: string | null;
  reporting_year: number | null;
  reporting_period_end?: string | null;
  status: string | null;
  job_type?: string | null;
  job_family?: string | null;
  is_crp?: boolean;
  milestone_status?: string | null;
  total_emissions?: number | null;
};

const PAGE_SIZE = 10;
const ALL = "__all__";

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "—";
    return parsed.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
}

function riskFor(job: ClientJobRow): { label: string; className: string } {
  if (job.milestone_status === "Overdue") return { label: "Overdue", className: "bg-rose-100 text-rose-800" };
  if (job.milestone_status === "Due") return { label: "Due", className: "bg-amber-100 text-amber-800" };
  return { label: "Healthy", className: "bg-emerald-100 text-emerald-800" };
}

export default function ClientJobsTable({
  jobs,
  loading,
  error,
}: {
  jobs: ClientJobRow[];
  loading: boolean;
  error?: string | null;
}) {
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [jobTypeFilter, setJobTypeFilter] = useState<string>(ALL);
  const [yearFilter, setYearFilter] = useState<string>(ALL);
  const [page, setPage] = useState(1);

  const availableStatuses = useMemo(
    () => [...new Set(jobs.map((j) => j.status).filter((s): s is string => Boolean(s)))].sort(),
    [jobs],
  );
  const availableJobTypes = useMemo(
    () => [...new Set(jobs.map((j) => j.job_type).filter((s): s is string => Boolean(s)))].sort(),
    [jobs],
  );
  const availableYears = useMemo(
    () => [...new Set(jobs.map((j) => j.reporting_year).filter((y): y is number => y != null))].sort((a, b) => b - a),
    [jobs],
  );

  const filtered = useMemo(() => {
    return jobs.filter((j) => {
      if (statusFilter !== ALL && j.status !== statusFilter) return false;
      if (jobTypeFilter !== ALL && j.job_type !== jobTypeFilter) return false;
      if (yearFilter !== ALL && String(j.reporting_year ?? "") !== yearFilter) return false;
      return true;
    });
  }, [jobs, statusFilter, jobTypeFilter, yearFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function updateFilter(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
        <Select value={statusFilter} onValueChange={(v) => updateFilter(setStatusFilter, v)}>
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {availableStatuses.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={jobTypeFilter} onValueChange={(v) => updateFilter(setJobTypeFilter, v)}>
          <SelectTrigger className="h-8 w-48 text-xs">
            <SelectValue placeholder="Job type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All job types</SelectItem>
            {availableJobTypes.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={yearFilter} onValueChange={(v) => updateFilter(setYearFilter, v)}>
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue placeholder="Year" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All years</SelectItem>
            {availableYears.map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto text-xs text-slate-400">
          {loading ? "Loading…" : `${filtered.length} of ${jobs.length} jobs`}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 bg-slate-50/60">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Job</th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Reporting Period</th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Job End Date</th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Milestones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && jobs.length === 0 ? (
              <tr><td colSpan={5} className="py-8 text-center text-sm text-muted-foreground animate-pulse">Loading jobs...</td></tr>
            ) : error ? (
              <tr><td colSpan={5} className="py-8 text-center text-sm text-destructive">Error loading jobs: {error}</td></tr>
            ) : jobs.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  No active carbon reporting jobs found. Click &ldquo;+ Add Job&rdquo; above to get started!
                </td>
              </tr>
            ) : paginated.length === 0 ? (
              <tr><td colSpan={5} className="py-8 text-center text-sm text-muted-foreground">No jobs match the selected filters.</td></tr>
            ) : (
              paginated.map((job) => {
                const risk = riskFor(job);
                return (
                  <tr key={job.job_id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Link href={`/jobs/${job.job_id}`} className="font-medium text-slate-900 hover:underline">
                          {job.job_number ?? `Job #${job.job_id}`}
                        </Link>
                        {job.job_type && (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${jobFamilyBadgeClassName(job.job_family)}`}>
                            {job.job_type}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-slate-600">{job.reporting_year ?? "—"}</td>
                    <td className="px-4 py-2.5 text-sm text-slate-600">{fmtDate(job.reporting_period_end)}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={job.status} /></td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${risk.className}`}>{risk.label}</span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination footer */}
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-2">
          <span className="text-xs text-slate-400">
            Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setPage(1)} disabled={safePage === 1}>
              <ChevronsLeft className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setPage((p) => p - 1)} disabled={safePage === 1}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="min-w-[90px] text-center text-xs text-slate-600">
              Page {safePage} of {totalPages}
            </span>
            <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setPage((p) => p + 1)} disabled={safePage >= totalPages}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setPage(totalPages)} disabled={safePage >= totalPages}>
              <ChevronsRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
