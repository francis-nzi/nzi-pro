"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { CheckCircle2, Clock, FileText, MessageSquare } from "lucide-react";
import { apiFetch } from "@/lib/auth";
import { formatEmissions } from "@/lib/format";
import PortalShell from "@/components/PortalShell";

const PortalDashboardCharts = dynamic(() => import("@/components/PortalDashboardCharts"), {
  ssr: false,
  loading: () => <div className="py-12 text-center text-sm text-gray-400">Loading charts…</div>,
});

const PortalReporting = dynamic(() => import("@/components/PortalReporting"), {
  ssr: false,
  loading: () => <div className="py-12 text-center text-sm text-gray-400">Loading reporting data…</div>,
});

// ── Types ────────────────────────────────────────────────────────────────────

type Job = {
  job_id: number;
  job_number: string;
  title: string;
  reporting_year: number | null;
  status: string;
  review_status: string;
};

type DashboardMetrics = {
  client_name: string;
  selected_year: number | null;
  available_years: number[];
  current_metrics: {
    total_emissions: number;
    scope1: number;
    scope2: number;
    scope3: number;
    year: number | null;
  };
  yoy_change: number | null;
  yearly_emissions: Array<{ year: number; scope1: number; scope2: number; scope3: number; total: number }>;
  yearly_top_categories?: Array<{ year: number; categories: Array<{ category: string; emissions: number; percentage: number }> }>;
  top_categories: Array<{ category: string; emissions: number; percentage: number }>;
  intensity_metrics: Array<{ key: string; label: string; value: number; divider: number; intensity: number }>;
  benchmark_metrics?: { benchmark_year: number | null; total: number | null } | null;
  net_zero_progress?: { net_zero_year: number; years_to_target: number } | null;
};

// ── Review status helpers ────────────────────────────────────────────────────

const REVIEW_LABELS: Record<string, string> = {
  not_sent: "Not available yet",
  draft: "Not available yet",
  sent_for_review: "Ready to review",
  changes_requested: "Changes requested",
  approved: "Approved",
};

const REVIEW_COLOURS: Record<string, string> = {
  not_sent: "bg-gray-100 text-gray-500",
  draft: "bg-gray-100 text-gray-500",
  sent_for_review: "bg-blue-100 text-blue-700",
  changes_requested: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
};

function ReviewIcon({ status }: { status: string }) {
  if (status === "approved") return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (status === "sent_for_review") return <FileText className="h-4 w-4 text-blue-600" />;
  if (status === "changes_requested") return <MessageSquare className="h-4 w-4 text-amber-600" />;
  return <Clock className="h-4 w-4 text-gray-400" />;
}

// ── Chart sub-tabs (Overview / Trends) ──────────────────────────────────────

type ScopeDatum = { name: string; value: number };
type TrendDatum = { year: string; total: number; scope1: number; scope2: number; scope3: number };
type TopCatDatum = { category: string; emissions: number; percentage: number };

function ChartSection({ scopeData, total, trendData, topCategoryData, year }: {
  scopeData: ScopeDatum[];
  total: number;
  trendData: TrendDatum[];
  topCategoryData: TopCatDatum[];
  year: number | string | null;
}) {
  const [view, setView] = useState<"overview" | "trends">("overview");
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="flex border-b border-gray-200">
        {(["overview", "trends"] as const).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-5 py-2.5 text-sm font-medium transition-colors ${view === v ? "border-b-2 border-orange-500 text-orange-600" : "text-gray-500 hover:text-gray-700"}`}
          >
            {v === "overview" ? "Overview" : "Trends"}
          </button>
        ))}
      </div>
      <div className="p-5">
        <PortalDashboardCharts
          scopeData={scopeData}
          total={total}
          trendData={trendData}
          topCategoryData={topCategoryData}
          view={view}
          year={year}
        />
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

type TabKey = "dashboard" | "reporting" | "reports";

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");

  // Jobs (Reports tab)
  const [jobs, setJobs] = useState<Job[]>([]);
  const [clientName, setClientName] = useState("");
  const [jobsLoading, setJobsLoading] = useState(true);

  // Dashboard metrics
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  useEffect(() => {
    // Load jobs (for Reports tab + client name)
    apiFetch("/portal/dashboard")
      .then(r => r.json() as Promise<{ jobs: Job[]; client_name: string }>)
      .then(d => { setJobs(d.jobs ?? []); setClientName(d.client_name ?? ""); })
      .catch(() => {})
      .finally(() => setJobsLoading(false));

    // Load metrics (for Dashboard tab)
    apiFetch("/portal/metrics")
      .then(r => r.json() as Promise<DashboardMetrics>)
      .then(d => {
        setMetrics(d);
        if (d.selected_year) setSelectedYear(d.selected_year);
        if (!clientName && d.client_name) setClientName(d.client_name);
      })
      .catch(() => {})
      .finally(() => setMetricsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMetricsForYear = useCallback(async (year: number) => {
    setMetricsLoading(true);
    try {
      const res = await apiFetch(`/portal/metrics?year=${year}`);
      const d = await res.json() as DashboardMetrics;
      setMetrics(d);
      setSelectedYear(year);
    } catch {
      // non-fatal
    } finally {
      setMetricsLoading(false);
    }
  }, []);

  const yearOptions = useMemo(() => metrics?.available_years ?? [], [metrics]);

  const scopeData = useMemo((): ScopeDatum[] => {
    if (!metrics) return [];
    const cm = metrics.current_metrics;
    return [
      { name: "Scope 1", value: Number(cm.scope1 || 0) },
      { name: "Scope 2", value: Number(cm.scope2 || 0) },
      { name: "Scope 3", value: Number(cm.scope3 || 0) },
    ];
  }, [metrics]);

  const trendData = useMemo((): TrendDatum[] => {
    if (!metrics) return [];
    return [...metrics.yearly_emissions]
      .filter(x => x.year != null)
      .sort((a, b) => Number(a.year) - Number(b.year))
      .map(x => ({
        year: String(x.year),
        total: Number(x.total || 0),
        scope1: Number(x.scope1 || 0),
        scope2: Number(x.scope2 || 0),
        scope3: Number(x.scope3 || 0),
      }));
  }, [metrics]);

  const topCategoryData = useMemo((): TopCatDatum[] => {
    if (!metrics) return [];
    if (selectedYear && metrics.yearly_top_categories) {
      const yd = metrics.yearly_top_categories.find(y => y.year === selectedYear);
      if (yd) return yd.categories;
    }
    return metrics.top_categories ?? [];
  }, [metrics, selectedYear]);

  const intensityMetric = useMemo(() => {
    const m = metrics?.intensity_metrics ?? [];
    return m.find(x => String(x.label ?? x.key).toLowerCase().includes("employee")) ?? m[0] ?? null;
  }, [metrics]);

  const total = Number(metrics?.current_metrics?.total_emissions || 0);
  const displayYear = selectedYear ?? metrics?.current_metrics?.year ?? null;
  const displayName = clientName || "Your Dashboard";

  const tabs: { key: TabKey; label: string }[] = [
    { key: "dashboard", label: "Dashboard" },
    { key: "reporting", label: "Reporting" },
    { key: "reports", label: "Reports" },
  ];

  return (
    <PortalShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{displayName}</h1>
          <p className="mt-1 text-sm text-gray-500">Carbon emissions data and report history.</p>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-gray-200 -mb-2">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-5 py-2.5 text-sm font-medium transition-colors ${activeTab === tab.key ? "border-b-2 border-orange-500 text-orange-600" : "text-gray-500 hover:text-gray-700"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Dashboard tab ─────────────────────────────────────────────── */}
        {activeTab === "dashboard" && (
          <div className="space-y-6 pt-2">
            {/* Year selector */}
            {yearOptions.length > 0 && (
              <div className="flex items-center justify-end gap-2">
                <span className="text-sm text-gray-500">Reporting Year:</span>
                <select
                  value={selectedYear ?? ""}
                  disabled={metricsLoading}
                  onChange={e => void loadMetricsForYear(Number(e.target.value))}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                >
                  {yearOptions.map(yr => <option key={yr} value={yr}>{yr}</option>)}
                </select>
              </div>
            )}

            {/* KPI cards */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm text-right">
                <div className="text-xs text-gray-500 leading-tight">
                  Benchmark Emissions{metrics?.benchmark_metrics?.benchmark_year ? ` (${metrics.benchmark_metrics.benchmark_year})` : ""}
                </div>
                <div className="mt-2 text-2xl font-semibold tabular-nums leading-none">
                  {metrics?.benchmark_metrics?.total != null ? formatEmissions(metrics.benchmark_metrics.total) : "—"}
                </div>
                <div className="mt-1 text-xs text-gray-400">tCO₂e</div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm text-right">
                <div className="text-xs text-gray-500 leading-tight">
                  Current Year Emissions{displayYear ? ` (${displayYear})` : ""}
                </div>
                <div className="mt-2 text-2xl font-semibold tabular-nums leading-none">
                  {metricsLoading ? "…" : formatEmissions(total)}
                </div>
                <div className="mt-1 text-xs text-gray-400">tCO₂e</div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm text-right">
                <div className="text-xs text-gray-500 leading-tight">Intensity Metric</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums leading-none">
                  {intensityMetric ? Number(intensityMetric.intensity || 0).toFixed(1) : "—"}
                </div>
                <div className="mt-1 text-xs text-gray-400">{intensityMetric?.label ?? "Not available"}</div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm text-right">
                <div className="text-xs text-gray-500 leading-tight">Net Zero Target</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums leading-none">
                  {metrics?.net_zero_progress?.net_zero_year ?? "—"}
                </div>
                <div className="mt-1 text-xs text-gray-400">
                  {metrics?.net_zero_progress ? `${metrics.net_zero_progress.years_to_target} years to target` : "Target not set"}
                </div>
              </div>
            </div>

            {/* Charts */}
            {metricsLoading ? (
              <div className="rounded-xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-400 shadow-sm">
                Loading…
              </div>
            ) : (
              <ChartSection
                scopeData={scopeData}
                total={total}
                trendData={trendData}
                topCategoryData={topCategoryData}
                year={displayYear}
              />
            )}
          </div>
        )}

        {/* ── Reporting tab ─────────────────────────────────────────────── */}
        {activeTab === "reporting" && (
          <div className="pt-2">
            <PortalReporting />
          </div>
        )}

        {/* ── Reports tab ───────────────────────────────────────────────── */}
        {activeTab === "reports" && (
          <div className="pt-2">
            {jobsLoading ? (
              <div className="text-sm text-gray-400">Loading…</div>
            ) : jobs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-400">
                No reports available yet. Your NZI contact will send your report for review when it is ready.
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {jobs.map(job => {
                  const canReview = job.review_status === "sent_for_review" || job.review_status === "changes_requested" || job.review_status === "approved";
                  return (
                    <div key={job.job_id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs text-gray-400 font-medium uppercase tracking-wide">
                            {job.reporting_year ?? "—"}
                          </div>
                          <div className="mt-0.5 font-semibold text-gray-900 leading-tight">
                            {job.title || `Job ${job.job_id}`}
                          </div>
                          {job.job_number && (
                            <div className="mt-0.5 text-xs text-gray-400">{job.job_number}</div>
                          )}
                        </div>
                        <ReviewIcon status={job.review_status} />
                      </div>
                      <div className="mt-3">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${REVIEW_COLOURS[job.review_status] ?? "bg-gray-100 text-gray-500"}`}>
                          {REVIEW_LABELS[job.review_status] ?? job.review_status}
                        </span>
                      </div>
                      {canReview ? (
                        <Link
                          href={`/jobs/${job.job_id}/review`}
                          className="mt-4 block w-full rounded-lg py-2 text-center text-sm font-medium text-white transition-colors"
                          style={{ backgroundColor: "#F26624" }}
                        >
                          {job.review_status === "approved" ? "View Report" : "Review Report"}
                        </Link>
                      ) : (
                        <div className="mt-4 rounded-lg bg-gray-50 py-2 text-center text-sm text-gray-400">
                          Not yet available
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </PortalShell>
  );
}
