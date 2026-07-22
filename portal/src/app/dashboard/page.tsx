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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/shared/KpiCard";
import { EmptyStatePanel, ErrorPanel, SkeletonLoader } from "@/components/shared/DataStates";

const PortalReporting = dynamic(() => import("@/components/PortalReporting"), {
  ssr: false,
  loading: () => <div className="py-12 text-center text-sm text-gray-400">Loading reporting data...</div>,
});

const PortalActions = dynamic(() => import("@/components/PortalActions"), {
  ssr: false,
  loading: () => <div className="py-12 text-center text-sm text-gray-400">Loading actions...</div>,
});

const PortalDataEntry = dynamic(() => import("@/components/PortalDataEntry"), {
  ssr: false,
  loading: () => <div className="py-12 text-center text-sm text-gray-400">Loading data entry...</div>,
});

const PortalInsights = dynamic(() => import("@/components/PortalInsights"), {
  ssr: false,
  loading: () => <div className="py-12 text-center text-sm text-gray-400">Loading insights...</div>,
});

const PortalFiles = dynamic(() => import("@/components/PortalFiles"), {
  ssr: false,
  loading: () => <div className="py-12 text-center text-sm text-gray-400">Loading files...</div>,
});

const PortalGovernance = dynamic(() => import("@/components/PortalGovernance"), {
  ssr: false,
  loading: () => <div className="py-12 text-center text-sm text-gray-400">Loading governance...</div>,
});

const PortalPortfolioDashboard = dynamic(() => import("@/components/PortalPortfolioDashboard"), {
  ssr: false,
  loading: () => <div className="py-12 text-center text-sm text-gray-400">Loading portfolio dashboard...</div>,
});

const PortalDashboardCharts = dynamic(() => import("@/components/PortalDashboardCharts"), {
  ssr: false,
  loading: () => <div className="py-12 text-center text-sm text-gray-400">Loading charts...</div>,
});

const PortalFacilityLeaderboard = dynamic(() => import("@/components/PortalFacilityLeaderboard"), {
  ssr: false,
  loading: () => <div className="py-12 text-center text-sm text-gray-400">Loading facility leaderboard...</div>,
});

const PortalGeoMap = dynamic(() => import("@/components/PortalGeoMap"), {
  ssr: false,
  loading: () => <div className="py-12 text-center text-sm text-gray-400">Loading facility locations...</div>,
});

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

const REVIEW_LABELS: Record<string, string> = {
  not_sent: "",
  draft: "",
  sent_for_review: "Ready to review",
  changes_requested: "Changes requested",
  approved: "Approved",
};

const REVIEW_BADGE_VARIANT: Record<string, "secondary" | "warning" | "success"> = {
  sent_for_review: "secondary",
  changes_requested: "warning",
  approved: "success",
};

function ReviewIcon({ status }: { status: string }) {
  if (status === "approved") return <CheckCircle2 className="h-4 w-4 text-status-success" />;
  if (status === "sent_for_review") return <FileText className="h-4 w-4 text-muted-foreground" />;
  if (status === "changes_requested") return <MessageSquare className="h-4 w-4 text-status-warning" />;
  return <Clock className="h-4 w-4 text-muted-foreground" />;
}

function formatTimestamp(raw: string | null | undefined): string {
  if (!raw) return "";
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return raw;
  return dt.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const REVIEW_STATUS_RANK: Record<string, number> = {
  approved: 4, sent_for_review: 3, changes_requested: 2, draft: 1, not_sent: 0,
};

function ReportYearCards({ jobs }: { jobs: Job[] }) {
  const byYear = new Map<number, Job>();
  for (const job of jobs) {
    const yr = job.reporting_year ?? 0;
    const existing = byYear.get(yr);
    const rank = REVIEW_STATUS_RANK[job.review_status] ?? 0;
    if (!existing || rank > (REVIEW_STATUS_RANK[existing.review_status] ?? 0)) byYear.set(yr, job);
  }
  const sorted = Array.from(byYear.entries()).sort((a, b) => b[0] - a[0]);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sorted.map(([year, job]) => {
        const label = REVIEW_LABELS[job.review_status] ?? "";
        return (
          <Card key={year} className="flex flex-col gap-4 p-6 transition-shadow hover:shadow-md">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-3xl font-bold tabular-nums text-foreground">{year || "—"}</div>
                <div className="mt-1 text-sm leading-tight text-muted-foreground">{job.title || "Carbon Report"}</div>
                <div className="mt-1 text-xs text-muted-foreground">Job No: {job.job_number || "—"}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {job.snapshot_at ? `Last refreshed ${formatTimestamp(job.snapshot_at)}` : "No refresh recorded yet"}
                </div>
              </div>
              <ReviewIcon status={job.review_status} />
            </div>
            {label && (
              <Badge variant={REVIEW_BADGE_VARIANT[job.review_status] ?? "outline"} className="self-start">
                {label}
              </Badge>
            )}
            <Button asChild style={{ backgroundColor: BRAND }} className="mt-auto hover:opacity-90">
              <Link href={`/jobs/${job.job_id}/view`}>
                <ExternalLink className="h-4 w-4" />
                View Report
              </Link>
            </Button>
            <div className="text-center text-xs text-muted-foreground">Opens the current report</div>
          </Card>
        );
      })}
    </div>
  );
}

type TabKey = "dashboard" | "portfolio" | "data" | "data_entry" | "reports" | "actions" | "insights" | "files" | "governance";
const VALID_TABS: TabKey[] = ["dashboard", "portfolio", "data", "data_entry", "reports", "actions", "insights", "files", "governance"];

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
  const resolvedTab = tabFromUrl === "reporting" ? "data" : tabFromUrl === "governance" ? "files" : (tabFromUrl as TabKey | null);
  const initialTab: TabKey = resolvedTab && VALID_TABS.includes(resolvedTab) ? resolvedTab : "dashboard";
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

  function handleTabChange(tab: string) {
    const t = (VALID_TABS.includes(tab as TabKey) ? tab : "dashboard") as TabKey;
    setActiveTab(t);
    router.replace(`/dashboard?tab=${t}`, { scroll: false });
  }

  useEffect(() => {
    let cancelled = false;
    apiFetch("/portal/auth/me")
      .then((res) => res.ok ? res.json() : null)
      .then((payload: { portal_mode?: string } | null) => {
        if (cancelled || !payload?.portal_mode) return;
        if (!tabFromUrl && payload.portal_mode === "portfolio_owner") {
          setActiveTab("portfolio");
        }
      })
      .catch(() => {
        if (!cancelled) {
          // Ignore auth discovery failures; the shell guard will handle redirects.
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tabFromUrl]);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [clientName, setClientName] = useState("");
  const [jobsLoading, setJobsLoading] = useState(true);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [metricsError, setMetricsError] = useState("");
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [chartView, setChartView] = useState<"overview" | "trends">("overview");

  useEffect(() => {
    apiFetch("/portal/dashboard")
      .then(r => r.json() as Promise<{ jobs: Job[]; client_name: string }>)
      .then(d => { setJobs(d.jobs ?? []); setClientName(d.client_name ?? ""); })
      .catch(() => {})
      .finally(() => setJobsLoading(false));

    apiFetch("/portal/metrics")
      .then(r => { if (!r.ok) return r.text().then(t => Promise.reject(new Error(`${r.status}: ${t}`))); return r.json() as Promise<DashboardMetrics>; })
      .then(d => { setMetrics(d); if (d.selected_year) setSelectedYear(d.selected_year); if (!clientName && d.client_name) setClientName(d.client_name); })
      .catch(e => setMetricsError((e as Error).message))
      .finally(() => setMetricsLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMetricsForYear = useCallback(async (year: number) => {
    setMetricsLoading(true);
    setMetricsError("");
    try {
      const res = await apiFetch(`/portal/metrics?year=${year}`);
      if (!res.ok) { const t = await res.text(); setMetricsError(`${res.status}: ${t}`); return; }
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
    return [{ name: "Scope 1", value: m.scope1 }, { name: "Scope 2", value: m.scope2 }, { name: "Scope 3", value: m.scope3 }].filter(s => s.value > 0);
  }, [metrics]);
  const trendData = useMemo(() => (metrics?.yearly_emissions ?? []).map(y => ({ year: String(y.year), total: y.total, scope1: y.scope1, scope2: y.scope2, scope3: y.scope3 })), [metrics]);
  const topCategoryData = useMemo(() => metrics?.top_categories ?? [], [metrics]);
  const intensityMetric = useMemo(() => { const m = metrics?.intensity_metrics ?? []; return m.find(x => String(x.label ?? x.key).toLowerCase().includes("employee")) ?? m[0] ?? null; }, [metrics]);

  const total = Number(metrics?.current_metrics?.total_emissions || 0);
  const displayYear = selectedYear ?? metrics?.current_metrics?.year ?? null;
  const displayName = clientName || "Your Dashboard";

  return (
    <PortalShell activeTab={activeTab} onTabChange={handleTabChange}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{displayName}</h1>
          <p className="mt-1 text-sm text-gray-500">Carbon emissions data and report history.</p>
        </div>

        {activeTab === "dashboard" && (
          <div className="space-y-6">
            {metricsError && <ErrorPanel description={`Failed to load dashboard data: ${metricsError}`} />}
            {yearOptions.length > 0 && (
              <div className="flex items-center justify-end gap-2">
                <span className="text-sm text-muted-foreground">Reporting Year:</span>
                <select
                  value={selectedYear ?? ""}
                  disabled={metricsLoading}
                  onChange={e => void loadMetricsForYear(Number(e.target.value))}
                  className="rounded-lg border border-input px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {yearOptions.map(yr => <option key={yr} value={yr}>{yr}</option>)}
                </select>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                label={`Benchmark Emissions${metrics?.benchmark_metrics?.benchmark_year ? ` (${metrics.benchmark_metrics.benchmark_year})` : ""}`}
                value={metrics?.benchmark_metrics?.total != null ? formatEmissions(metrics.benchmark_metrics.total) : "—"}
                unit="tCO2e"
              />
              <KpiCard
                label={`Current Year Emissions${displayYear ? ` (${displayYear})` : ""}`}
                value={metricsLoading ? "..." : formatEmissions(total)}
                unit="tCO2e"
                trend={metrics?.yoy_change ?? undefined}
              />
              <KpiCard
                label="Intensity Metric"
                value={intensityMetric ? Number(intensityMetric.intensity || 0).toFixed(1) : "—"}
                unit={intensityMetric?.label ?? "Not available"}
              />
              <KpiCard
                label="Net Zero Target"
                value={metrics?.net_zero_progress?.net_zero_year != null ? String(metrics.net_zero_progress.net_zero_year) : "—"}
                unit={metrics?.net_zero_progress ? `${metrics.net_zero_progress.years_to_target}y to go` : "Target not set"}
              />
            </div>

            {!metricsLoading && metrics && (
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-semibold">Emissions Overview</CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setChartView(v => v === "overview" ? "trends" : "overview")}
                  >
                    {chartView === "overview" ? "View Trends" : "View Overview"}
                  </Button>
                </CardHeader>
                <CardContent>
                  <PortalDashboardCharts scopeData={scopeData} total={total} trendData={trendData} topCategoryData={topCategoryData} view={chartView} year={displayYear} />
                </CardContent>
              </Card>
            )}

            <PortalGeoMap />

            <PortalFacilityLeaderboard />
          </div>
        )}

        {activeTab === "portfolio" && <div><PortalPortfolioDashboard /></div>}
        {activeTab === "data" && <div><PortalReporting /></div>}
        {activeTab === "data_entry" && <div><PortalDataEntry /></div>}
        {activeTab === "actions" && <div><PortalActions /></div>}
        {activeTab === "insights" && <div><PortalInsights /></div>}
        {activeTab === "files" && <div><PortalFiles /></div>}
        {activeTab === "governance" && <div><PortalGovernance /></div>}
        {activeTab === "reports" && (
          <div>
            {jobsLoading ? (
              <SkeletonLoader rows={4} />
            ) : jobs.length === 0 ? (
              <EmptyStatePanel
                title="No reports available yet"
                description="Your NZI contact will send your report for review when it is ready."
              />
            ) : (
              <ReportYearCards jobs={jobs} />
            )}
          </div>
        )}
      </div>
    </PortalShell>
  );
}
