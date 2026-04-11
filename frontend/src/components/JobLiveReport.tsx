"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import JobWorkspaceHeader from "@/components/job-workspace/JobWorkspaceHeader";
import type { JobWorkspaceJob, WorkspaceBreadcrumb, WorkspaceEmissionsSummaryData } from "@/components/job-workspace/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type LiveJobData = {
  job_id: number;
  client_db_id: number;
  job_number: string | null;
  title: string | null;
  reporting_year: number | null;
  reporting_period_start: string | null;
  reporting_period_end: string | null;
  status: string | null;
  client_name: string | null;
  logo_url?: string | null;
  client_logo_url?: string | null;
  benchmark_year?: number | null;
};

type LiveReportData = {
  job_data: LiveJobData;
  scope_totals?: Record<string, number | null>;
  benchmark_totals?: Record<string, number | null>;
  categories?: Array<Record<string, unknown>>;
  activity_groups?: Record<string, Array<Record<string, unknown>>>;
  activity_totals?: Record<string, number | null>;
  activity_details?: Array<Record<string, unknown>>;
  activity_group_order?: string[];
  activity_group_colors?: Record<string, string>;
  job_actions?: {
    grouped?: Array<{
      term?: string;
      label?: string;
      hint?: string;
      count?: number;
      items?: Array<Record<string, unknown>>;
    }>;
    total_actions?: number;
    summary_sentence?: string | null;
  };
  intensity_metrics?: Record<string, { label?: string; value?: number | null; divider?: number | null }>;
  summary?: {
    current_total?: number | null;
    benchmark_total?: number | null;
    delta_total?: number | null;
    delta_pct?: number | null;
    top_category?: {
      category?: string | null;
      scope?: string | null;
      emissions?: number | null;
      report_label?: string | null;
      data_source?: string | null;
      reference_label?: string | null;
    } | null;
  };
};

type JobLiveReportProps = {
  jobId: number;
  baseUrl: string;
};
type LiveActionItem = Record<string, unknown>;

const SCOPE_COLORS = ["#0f766e", "#2563eb", "#8b5cf6"];

function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "0.0";
  return Number(value).toLocaleString("en-GB", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function toNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function safeText(value: unknown, fallback = "N/A"): string {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : fallback;
}

function liveActionItemLabel(item: LiveActionItem): string {
  const candidates = [item.action_name, item.action_term_label, item.description, item.action_term];
  for (const candidate of candidates) {
    const text = safeText(candidate, "").trim();
    if (text.length > 0) {
      return text;
    }
  }
  return "Action";
}

export default function JobLiveReport({ jobId, baseUrl }: JobLiveReportProps) {
  const [data, setData] = useState<LiveReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshIndex, setRefreshIndex] = useState(0);

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
        const res = await fetch(`${baseUrl}/jobs/${jobId}/live-report-data`, { credentials: "include" });
        if (!res.ok) {
          throw new Error(`Failed to load live report data (${res.status})`);
        }
        const json = (await res.json()) as LiveReportData;
        if (!cancelled) {
          setData(json);
        }
      } catch (e) {
        if (!cancelled) {
          setData(null);
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
  }, [baseUrl, jobId, refreshIndex]);

  const job = data?.job_data ?? null;
  const scopeTotals = useMemo(() => data?.scope_totals ?? {}, [data?.scope_totals]);
  const benchmarkTotals = useMemo(() => data?.benchmark_totals ?? {}, [data?.benchmark_totals]);
  const categories = useMemo(() => data?.categories ?? [], [data?.categories]);
  const intensityMetrics = data?.intensity_metrics ?? {};
  const jobActions = data?.job_actions?.grouped ?? [];

  const workspaceJob: JobWorkspaceJob | null = job
    ? {
        jobId: job.job_id,
        clientName: job.client_name ?? "Client",
        reportingPeriodLabel:
          job.reporting_period_start && job.reporting_period_end
            ? `${new Date(job.reporting_period_start).toLocaleDateString("en-GB")} - ${new Date(job.reporting_period_end).toLocaleDateString("en-GB")}`
            : job.reporting_year
              ? `Year ${job.reporting_year}`
              : "Reporting period not set",
        statusLabel: job.status ?? "Draft",
        ownerLabel: "Unassigned",
        crmLabel: undefined,
      }
    : null;

  const breadcrumbs: WorkspaceBreadcrumb[] = job
    ? [
        { label: "Clients", href: "/clients" },
        { label: job.client_name ?? "Client" },
        { label: "Jobs", href: "/jobs" },
        { label: job.job_number ?? `Job ${job.job_id}` },
        { label: "Live Report" },
      ]
    : [{ label: "Live Report" }];

  const scopeChartData = useMemo(
    () =>
      [
        { name: "Scope 1", value: toNumber(scopeTotals["Scope 1"] ?? scopeTotals.scope_1 ?? 0) },
        { name: "Scope 2", value: toNumber(scopeTotals["Scope 2"] ?? scopeTotals.scope_2 ?? 0) },
        { name: "Scope 3", value: toNumber(scopeTotals["Scope 3"] ?? scopeTotals.scope_3 ?? 0) },
      ].filter((item) => item.value > 0),
    [scopeTotals],
  );

  const benchmarkChartData = useMemo(
    () => [
      { name: "Current", value: toNumber(scopeTotals.Total ?? scopeTotals.total ?? data?.summary?.current_total ?? 0), fill: "#2563eb" },
      {
        name: "Benchmark",
        value: toNumber(benchmarkTotals.Total ?? benchmarkTotals.total ?? data?.summary?.benchmark_total ?? 0),
        fill: "#f97316",
      },
    ],
    [benchmarkTotals, data?.summary?.benchmark_total, data?.summary?.current_total, scopeTotals],
  );

  const activityChartData = useMemo(() => {
    const order = data?.activity_group_order ?? [];
    const totals = data?.activity_totals ?? {};
    return order.map((group) => ({
      name: group,
      value: toNumber(totals[group] ?? 0),
      fill: data?.activity_group_colors?.[group] ?? "#64748b",
    }));
  }, [data?.activity_group_colors, data?.activity_group_order, data?.activity_totals]);

  const topCategories = useMemo(() => {
    return [...categories]
      .map((item) => ({
        category: safeText(item.category, "Uncategorized"),
        scope: safeText(item.scope, ""),
        emissions: toNumber(item.emissions),
        report_label: safeText(item.report_label, ""),
      }))
      .sort((a, b) => b.emissions - a.emissions)
      .slice(0, 6);
  }, [categories]);

  const liveSummary = data?.summary ?? null;
  const currentTotal = liveSummary?.current_total ?? toNumber(scopeTotals.Total ?? scopeTotals.total ?? 0);
  const benchmarkTotal = liveSummary?.benchmark_total ?? toNumber(benchmarkTotals.Total ?? benchmarkTotals.total ?? 0);
  const deltaTotal = liveSummary?.delta_total ?? currentTotal - benchmarkTotal;
  const deltaPct = liveSummary?.delta_pct ?? (benchmarkTotal > 0 ? (deltaTotal / benchmarkTotal) * 100.0 : null);

  const emissionsSummary: WorkspaceEmissionsSummaryData | null = job
    ? {
        totalTco2e: currentTotal,
        scope1Tco2e: toNumber(scopeTotals["Scope 1"] ?? scopeTotals.scope_1 ?? 0),
        scope2Tco2e: toNumber(scopeTotals["Scope 2"] ?? scopeTotals.scope_2 ?? 0),
        scope3Tco2e: toNumber(scopeTotals["Scope 3"] ?? scopeTotals.scope_3 ?? 0),
        label: "Current live totals",
        note: benchmarkTotal > 0 ? `Benchmark: ${formatNumber(benchmarkTotal)} tCO2e` : undefined,
      }
    : null;

  const periodStart = job?.reporting_period_start ? new Date(job.reporting_period_start).toLocaleDateString("en-GB") : "";
  const periodEnd = job?.reporting_period_end ? new Date(job.reporting_period_end).toLocaleDateString("en-GB") : "";
  const reportYear = job?.reporting_year ?? new Date().getFullYear();

  return (
    <div className="live-report-root space-y-6 bg-white text-slate-950">
      <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white px-4 py-3 shadow-sm">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Live Report</div>
          <div className="text-sm text-slate-600">Browser-friendly report with print-safe SVG charts.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setRefreshIndex((prev) => prev + 1)} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </Button>
          <Button onClick={() => window.print()}>Print report</Button>
          <Button asChild variant="secondary">
            <Link href={`/jobs/${jobId}/report-new`}>Open report builder</Link>
          </Button>
        </div>
      </div>

      {loading ? <div className="text-sm text-muted-foreground">Loading live report...</div> : null}
      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}

      {job && workspaceJob ? (
        <div className="no-print">
          <JobWorkspaceHeader breadcrumbs={breadcrumbs} jobId={jobId} baseUrl={baseUrl} job={workspaceJob} emissionsSummary={emissionsSummary} />
        </div>
      ) : null}

      {job ? (
        <>
          <section className="live-report-section rounded-3xl border bg-slate-950 px-6 py-8 text-white shadow-sm print:break-after-page">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl">
                <div className="text-xs uppercase tracking-[0.28em] text-slate-400">Live emissions report</div>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight">{job.client_name ?? "Client"}</h1>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  {job.job_number ? `${job.job_number} - ` : ""}
                  {job.title ?? "Live report"} - {reportYear}
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-300">
                  {periodStart && periodEnd ? `${periodStart} to ${periodEnd}` : "Reporting period not set"}
                </p>
              </div>

              <div className="grid min-w-[280px] gap-2 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-slate-300">Current total</span>
                  <span className="text-2xl font-semibold tabular-nums">{formatNumber(currentTotal)}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-slate-300">Benchmark</span>
                  <span className="text-xl font-semibold tabular-nums">{formatNumber(benchmarkTotal)}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-slate-300">Change</span>
                  <span className={`font-semibold tabular-nums ${deltaTotal > 0 ? "text-rose-300" : "text-emerald-300"}`}>
                    {deltaTotal >= 0 ? "+" : ""}
                    {formatNumber(deltaTotal)}
                    {deltaPct !== null && Number.isFinite(deltaPct) ? ` (${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%)` : ""}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {[
                { label: "Total tCO2e", value: currentTotal },
                { label: "Scope 1", value: toNumber(scopeTotals["Scope 1"] ?? scopeTotals.scope_1 ?? 0) },
                { label: "Scope 2", value: toNumber(scopeTotals["Scope 2"] ?? scopeTotals.scope_2 ?? 0) },
                { label: "Scope 3", value: toNumber(scopeTotals["Scope 3"] ?? scopeTotals.scope_3 ?? 0) },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.24em] text-slate-400">{item.label}</div>
                  <div className="mt-2 text-3xl font-semibold tabular-nums">{formatNumber(item.value)}</div>
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card className="live-report-section print:break-inside-avoid">
              <CardHeader>
                <CardTitle>Scope breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[320px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Tooltip formatter={(value) => [`${formatNumber(Number(value))} tCO2e`, ""]} />
                      <Legend />
                      <Pie data={scopeChartData} dataKey="value" nameKey="name" outerRadius={110} innerRadius={60} paddingAngle={3}>
                        {scopeChartData.map((entry, index) => (
                          <Cell key={entry.name} fill={SCOPE_COLORS[index % SCOPE_COLORS.length]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="live-report-section print:break-inside-avoid">
              <CardHeader>
                <CardTitle>Current vs benchmark</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[320px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={benchmarkChartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip formatter={(value) => [`${formatNumber(Number(value))} tCO2e`, ""]} />
                      <Bar dataKey="value" radius={[10, 10, 0, 0]}>
                        {benchmarkChartData.map((entry) => (
                          <Cell key={entry.name} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)]">
            <Card className="live-report-section print:break-inside-avoid">
              <CardHeader>
                <CardTitle>Activity mix</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[360px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={activityChartData} layout="vertical" margin={{ top: 10, right: 20, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis type="category" dataKey="name" width={150} />
                      <Tooltip formatter={(value) => [`${formatNumber(Number(value))} tCO2e`, ""]} />
                      <Bar dataKey="value" radius={[0, 10, 10, 0]}>
                        {activityChartData.map((entry) => (
                          <Cell key={entry.name} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="live-report-section print:break-inside-avoid">
              <CardHeader>
                <CardTitle>Top categories</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {topCategories.length > 0 ? (
                    topCategories.map((item) => (
                      <div key={`${item.category}-${item.scope}`} className="rounded-2xl border bg-slate-50 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="font-medium text-slate-900">{item.category}</div>
                            <div className="text-xs text-slate-500">{item.scope || "Unscoped"}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-semibold tabular-nums">{formatNumber(item.emissions)}</div>
                            <div className="text-xs text-slate-500">tCO2e</div>
                          </div>
                        </div>
                        {item.report_label ? <div className="mt-2 text-xs text-slate-500">{item.report_label}</div> : null}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed bg-slate-50 p-4 text-sm text-slate-500">
                      No category breakdown available yet.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="live-report-section print:break-inside-avoid">
            <CardHeader>
              <CardTitle>Intensity metrics</CardTitle>
            </CardHeader>
            <CardContent>
              {Object.keys(intensityMetrics).length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {Object.entries(intensityMetrics).map(([key, metric]) => {
                    const label = safeText(metric?.label, key);
                    const value = toNumber(metric?.value);
                    const divider = toNumber(metric?.divider || 1) || 1;
                    const intensity = value > 0 ? currentTotal / value * divider : 0;

                    return (
                      <div key={key} className="rounded-2xl border bg-white p-4 shadow-sm">
                        <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</div>
                        <div className="mt-2 text-3xl font-semibold tabular-nums">{formatNumber(intensity)}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {formatNumber(value, 0)} units per {formatNumber(divider, 0)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed bg-slate-50 p-4 text-sm text-slate-500">
                  No intensity metrics saved for this job yet.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="live-report-section print:break-inside-avoid">
            <CardHeader>
              <CardTitle>Action plan</CardTitle>
            </CardHeader>
            <CardContent>
              {jobActions.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {jobActions.map((group) => (
                    <div key={group.term || group.label} className="rounded-2xl border bg-slate-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold text-slate-900">{group.label}</div>
                          <div className="text-xs text-slate-500">{group.hint}</div>
                        </div>
                        <Badge variant="outline" className="bg-white">
                          {group.count ?? 0}
                        </Badge>
                      </div>
                      <div className="mt-3 space-y-2">
                        {(group.items || []).slice(0, 4).map((item, index) => (
                          <div key={`${group.term || group.label}-${index}`} className="rounded-lg border bg-white px-3 py-2 text-sm text-slate-700">
                            {liveActionItemLabel(item as LiveActionItem)}
                          </div>
                        ))}
                        {(group.items || []).length === 0 ? (
                          <div className="rounded-lg border border-dashed bg-white px-3 py-2 text-sm text-slate-500">No actions in this group.</div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed bg-slate-50 p-4 text-sm text-slate-500">
                  No action plan items available.
                </div>
              )}
            </CardContent>
          </Card>

          <style jsx global>{`
            @media print {
              .no-print {
                display: none !important;
              }

              .live-report-root {
                color: #0f172a !important;
                background: white !important;
              }

              .live-report-section,
              .recharts-wrapper,
              .recharts-surface {
                break-inside: avoid;
                page-break-inside: avoid;
              }

              .live-report-section {
                margin-bottom: 1rem;
              }

              .live-report-root .rounded-3xl {
                box-shadow: none !important;
              }

              @page {
                margin: 12mm;
              }

              body {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
            }
          `}</style>
        </>
      ) : null}
    </div>
  );
}
