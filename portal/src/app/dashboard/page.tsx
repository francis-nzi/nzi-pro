"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Clock, ExternalLink, FileText, MessageSquare } from "lucide-react";
import { apiFetch } from "@/lib/auth";
import { formatEmissions } from "@/lib/format";
import PortalShell from "@/components/PortalShell";
import { BRAND } from "@/lib/brand";

const PortalReporting = dynamic(() => import("@/components/PortalReporting"), {
  ssr: false,
  loading: () => <div className="py-12 text-center text-sm text-gray-400">Loading reporting data…</div>,
});

const PortalActions = dynamic(() => import("@/components/PortalActions"), {
  ssr: false,
  loading: () => <div className="py-12 text-center text-sm text-gray-400">Loading actions…</div>,
});

const PortalInsights = dynamic(() => import("@/components/PortalInsights"), {
  ssr: false,
  loading: () => <div className="py-12 text-center text-sm text-gray-400">Loading insights…</div>,
});

const PortalFiles = dynamic(() => import("@/components/PortalFiles"), {
  ssr: false,
  loading: () => <div className="py-12 text-center text-sm text-gray-400">Loading files…</div>,
});

const PortalGovernance = dynamic(() => import("@/components/PortalGovernance"), {
  ssr: false,
  loading: () => <div className="py-12 text-center text-sm text-gray-400">Loading governance…</div>,
});

const PortalDashboardCharts = dynamic(() => import("@/components/PortalDashboardCharts"), {
  ssr: false,
  loading: () => <div className="py-12 text-center text-sm text-gray-400">Loading charts…</div>,
});

// ── Types ────────────────────────────────────────────────────────────────────

type Job = {
  job_id: number;
  job_number: string;
  title: string;
  reporting_year: number | null;
  status: string;
  review_status: string;
  snapshot_version_label?: string | null;
  snapshot_version_number?: number | null;
  snapshot_at?: string | null;
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
  not_sent: "",
  draft: "",
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

function formatTimestamp(raw: string | null | undefined): string {
  if (!raw) return "";
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return raw;
  return dt.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Year-based report cards ───────────────────────────────────────────────────

const REVIEW_STATUS_RANK: Record<string, number> = {
  approved: 4, sent_for_review: 3, changes_requested: 2, draft: 1, not_sent: 0,
};

function ReportYearCards({ jobs }: { jobs: Job[] }) {
  const byYear = new Map<number, Job>();
  for (const job of jobs) {
    const yr = job.reporting_year ?? 0;
    const existing = byYear.get(yr);
    const rank = REVIEW_STATUS_RANK[job.review_status] ?? 0;
    if (!existing || rank > (REVIEW_STATUS_RANK[existing.review_status] ?? 0)) {
      byYear.set(yr, job);
    }
  }
  const sorted = Array.from(byYear.entries()).sort((a, b) => b[0] - a[0]);
  const statusLabel = (s: string) => REVIEW_LABELS[s] ?? "";

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sorted.map(([year, job]) => {
        const label = statusLabel(job.review_status);
        const snapshotTime = job.snapshot_at ? formatTimestamp(job.snapshot_at) : "";
        return (
          <div key={year} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-3xl font-bold text-gray-900 tabular-nums">{year || "—"}</div>
                <div className="mt-1 text-sm text-gray-500 leading-tight">{job.title || "Carbon Report"}</div>
                <div className="mt-1 text-xs text-gray-400">Job No: {job.job_number || "—"}</div>
                <div className="mt-1 text-xs text-gray-400" title={snapshotTime ? `Last refreshed ${snapshotTime}` : undefined}>
                  {job.snapshot_at ? `Last refreshed ${formatTimestamp(job.snapshot_at)}` : "No refresh recorded yet"}
                </div>
              </div>
              <ReviewIcon status={job.review_status} />
            </div>
            {label && (
              <span className={`self-start inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${REVIEW_COLOURS[job.review_status] ?? "bg-gray-100 text-gray-500"}`}>
                {label}
              </span>
            )}
            <Link
              href={`/jobs/${job.job_id}/view`}
              className="mt-auto flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-white transition-colors"
              style={{ backgroundColor: BRAND }}
            >
              <ExternalLink className="h-4 w-4" />
              View Report
            </Link>
            <div className="text-center text-xs text-gray-400">
              Opens the current report
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

type TabKey = "dashboard" | "data" | "reports" | "actions" | "insights" | "files" | "governance";

const VALID_TABS: TabKey[] = ["dashboard", "data", "reports", "actions", "insights", "files", "governance"];

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <DashboardPageInner />
    </Suspense>
  );
}

function DashboardPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const tabFromUrl = searchParams.get("tab");
  const resolvedTab = tabFromUrl === "reporting" ? "data"
    : tabFromUrl === "governance" ? "files"
    : (tabFromUrl as TabKey | null);
  const initialTab: TabKey = resolvedTab && VALID_TABS.includes(resolvedTab) ? resolvedTab : "dashboard";
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

  function handleTabChange(tab: TabKey) {
    setActiveTab(tab);
    router.replace(`/dashboard?tab=${tab}`, { scroll: false });
  }

  // Jobs (Reports tab)
  const [jobs, setJobs] = useState<Job[]>([]);
  const [clientName, setClientName] = useState("");
  const [jobsLoading, setJobsLoading] = useState(true);

  // Dashboard metrics
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [metricsError, setMetricsError] = useState("");
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [chartView, setChartView] = useState<"overview" | "trends">("overview");

  useEffect(() => {
    // Load jobs (for Reports tab + client name)
    apiFetch("/portal/dashboard")
      .then(r => r.json() as Promise<{ jobs: Job[]; client_name: string }>)
      .then(d => { setJobs(d.jobs ?? []); setClientName(d.client_name ?? ""); })
      .catch(() => {})
      .finally(() => setJobsLoading(false));

    // Load metrics (for Dashboard KPI cards)
    apiFetch("/portal/metrics")
      .then(r => {
        if (!r.ok) return r.text().then(t => Promise.reject(new Error(`${r.status}: ${t}`)));
        return r.json() as Promise<DashboardMetrics>;
      })
      .then(d => {
        setMetrics(d);
        if (d.selected_year) setSelectedYear(d.selected_year);
        if (!clientName && d.client_name) setClientName(d.client_name);
      })
      .catch(e => setMetricsError((e as Error).message))
      .finally(() => setMetricsLoading(false));

  }, []);

  const loadMetricsForYear = useCallback(async (year: number) => {
    setMetricsLoading(true);
    setMetricsError("");
    try {
      const res = await apiFetch(`/portal/metrics?year=${year}`);
      if (!res.ok) {
        const t = await res.text();
        setMetricsError(`${res.status}: ${t}`);
        return;
      }
      const d = await res.json() as DashboardMetrics;
      setMetrics(d);
      setSelectedYear(year);
    } catch (e) {
      setMetricsError((e as Error).message);
    } finally {
      setMetricsLoading(false);
    }
  }, []);

  const yearOptions = useMemo(() => metrics?.available_years ?? [], [metrics]);

  const scopeData = useMemo(() => {
    const m = metrics?.current_metrics;
    if (!m) return [];
    return [
      { name: "Scope 1", value: m.scope1 },
      { name: "Scope 2", value: m.scope2 },
      { name: "Scope 3", value: m.scope3 },
    ].filter(s => s.value > 0);
  }, [metrics]);

  const trendData = useMemo(() =>
    (metrics?.yearly_emissions ?? []).map(y => ({
      year: String(y.year),
      total: y.total,
      scope1: y.scope1,
      scope2: y.scope2,
      scope3: y.scope3,
    })),
  [metrics]);

  const topCategoryData = useMemo(() => metrics?.top_categories ?? [], [metrics]);

  const intensityMetric = useMemo(() => {
    const m = metrics?.intensity_metrics ?? [];
    return m.find(x => String(x.label ?? x.key).toLowerCase().includes("employee")) ?? m[0] ?? null;
  }, [metrics]);

  const total = Number(metrics?.current_metrics?.total_emissions || 0);
  const displayYear = selectedYear ?? metrics?.current_metrics?.year ?? null;
  const displayName = clientName || "Your Dashboard";

  const tabs: { key: TabKey; label: string }[] = [
    { key: "dashboard", label: "Dashboard" },
    { key: "data", label: "Data" },
    { key: "reports", label: "Reports" },
    { key: "actions", label: "Actions" },
    { key: "insights", label: "Insights" },
    { key: "files", label: "Files" },
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
              onClick={() => handleTabChange(tab.key)}
              className={`px-5 py-2.5 text-sm font-medium transition-colors ${activeTab === tab.key ? "border-b-2 border-orange-500 text-orange-600" : "text-gray-500 hover:text-gray-700"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Dashboard tab ─────────────────────────────────────────────── */}
        {activeTab === "dashboard" && (
          <div className="space-y-6 pt-2">
            {metricsError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                Failed to load dashboard data: {metricsError}
              </div>
            )}
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
            {!metricsLoading && metrics && (
              <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-gray-700">Emissions Overview</h3>
                  <button
                    onClick={() => setChartView(v => v === "overview" ? "trends" : "overview")}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    {chartView === "overview" ? "View Trends" : "View Overview"}
                  </button>
                </div>
                <PortalDashboardCharts
                  scopeData={scopeData}
                  total={total}
                  trendData={trendData}
                  topCategoryData={topCategoryData}
                  view={chartView}
                  year={displayYear}
                />
              </div>
            )}
          </div>
        )}

        {/* ── Data tab ──────────────────────────────────────────────────── */}
        {activeTab === "data" && (
          <div className="pt-2">
            <PortalReporting />
          </div>
        )}

        {/* ── Actions tab ───────────────────────────────────────────────── */}
        {activeTab === "actions" && (
          <div className="pt-2">
            <PortalActions />
          </div>
        )}

        {/* ── Insights tab ──────────────────────────────────────────────── */}
        {activeTab === "insights" && (
          <div className="pt-2">
            <PortalInsights />
          </div>
        )}

        {/* ── Files tab ─────────────────────────────────────────────────── */}
        {activeTab === "files" && (
          <div className="pt-2">
            <PortalFiles />
          </div>
        )}

        {/* ── Governance tab ────────────────────────────────────────────── */}
        {activeTab === "governance" && (
          <div className="pt-2">
            <PortalGovernance />
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
              <ReportYearCards jobs={jobs} />
            )}
          </div>
        )}
      </div>
    </PortalShell>
  );
}
