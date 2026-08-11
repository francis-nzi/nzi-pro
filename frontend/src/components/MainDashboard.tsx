"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Briefcase, CheckCircle2, ChevronRight,
  Clock, Flame, Layers, Shield, TrendingDown, TrendingUp, Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ClientReviewNotifications from "@/components/ClientReviewNotifications";
import EmissionsTable from "@/components/EmissionsTable";
import IntelligenceDashboard from "@/components/IntelligenceDashboard";
import TaskCalendar from "@/components/TaskCalendar";
import StatusBadge from "@/components/StatusBadge";
import { MCKINSEY_DATA_COLORS } from "@/lib/chart-colors";
import { formatCurrency, formatDate, formatHours, formatMonth, formatNumber, formatPercent } from "@/lib/format";
import { milestoneDotClass } from "@/lib/status-utils";
const MainDashboardCharts = dynamic(() => import("@/components/report-widgets/MainDashboardCharts"), {
  ssr: false,
  loading: () => <div className="py-16 text-center text-sm text-muted-foreground">Loading charts...</div>,
});

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type OverviewData = {
  selected_year: number;
  available_years: number[];
  available_industries: string[];
  available_crm: string[];
  crm_options?: Array<{ value: string; label: string; meta?: string | null }>;
  year_trend: Array<{ year: number | null; total_emissions: number }>;
  industry_breakdown: Array<{ industry: string; client_count: number }>;
  metrics: {
    total_clients: number;
    total_emissions: number;
    active_jobs: number;
    total_datasets: number;
    reports_issued: number;
    yoy_change: number | null;
  };
  job_status_breakdown: Array<{ status: string; count: number }>;
  top_emitting_clients: Array<{ client_name: string; client_id: number; emissions: number }>;
  recent_activity: Array<{
    job_id: number; title: string; reporting_year: number | null;
    status: string; client_name: string; start_date: string | null;
    milestone_status?: string | null;
  }>;
  jobs_per_crm: Array<{ crm_name: string; total_jobs: number; statuses: Record<string, number> }>;
  current_jobs?: Array<{
    job_id: number;
    job_number: string;
    title: string;
    client_name: string;
    crm_name: string;
    status: string;
    milestone_status: string | null;
    final_report_due: string | null;
    final_report_completed_at: string | null;
    days_to_final_report_due: number | null;
  }>;
};

export type FinancialData = {
  metrics: {
    quote_count: number; quote_value_total: number; approved_quote_value: number;
    invoice_count: number; invoice_total: number; paid_total: number;
    outstanding_total: number; overdue_invoice_count: number; cash_realisation_pct: number;
  };
  quote_status_breakdown: Array<{ status: string; count: number; total_value: number }>;
  invoice_status_breakdown: Array<{ status: string; count: number; total_value: number }>;
  monthly_quotes: Array<{ month_start: string; currency_code: string; total_value: number }>;
  monthly_invoices: Array<{ month_start: string; currency_code: string; total_value: number; paid_total: number; outstanding_total: number }>;
  top_clients_by_invoiced_total: Array<{ client_id: number; client_name: string; total_invoiced: number }>;
};

export type OperationsData = {
  metrics: {
    active_jobs: number; healthy_jobs: number; due_soon_jobs: number;
    overdue_jobs: number; no_milestone_jobs: number; jobs_over_estimate: number;
    time_logged_hours: number; estimated_hours_total: number;
    utilisation_pct: number | null; completed_milestones: number; upcoming_milestones_30d: number;
  };
  milestone_breakdown: Array<{ status: string; key: string; count: number }>;
  time_by_subject: Array<{ subject: string; hours: number }>;
  crm_workload: Array<{
    crm_name: string; total_jobs: number; red_jobs: number; amber_jobs: number;
    green_jobs: number; no_milestone_jobs: number; logged_hours: number;
    estimated_hours: number; utilisation_pct: number | null; avg_health_score: number | null; last_contact_date: string | null;
  }>;
  jobs_needing_attention: Array<{
    job_id: number; job_number: string; title: string; client_name: string;
    crm_name: string; status: string; milestone_status: string;
    next_due_date: string | null; next_due_name: string; days_to_next_due: number | null;
    logged_hours: number; estimated_hours: number; utilisation_pct: number | null; reason: string;
  }>;
  current_jobs?: Array<{
    job_id: number;
    job_number: string;
    title: string;
    client_name: string;
    crm_name: string;
    status: string;
    milestone_status: string | null;
    final_report_due: string | null;
    final_report_completed_at: string | null;
    days_to_final_report_due: number | null;
  }>;
};

type MilestoneStatus = { green: number; amber: number; red: number; no_milestones: number; total: number };

// â”€â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const ALL = "__all__";
const STATUS_COLORS: Record<string, string> = {
  "Open": "#027AB1", "Data Gathering Phase": "#39BDF3", "Reporting Phase": "#F26624",
  "Review": "#8C5AC8", "Completed": "#16a34a", "Archived": "#94a3b8", "Cancelled": "#dc2626",
};
const MS_COLORS = { green: "#16a34a", amber: "#d97706", red: "#dc2626", no_milestones: "#94a3b8" };
const ACCENT: Record<string, { border: string; icon: string }> = {
  blue:   { border: "border-l-blue-500",   icon: "text-blue-500" },
  red:    { border: "border-l-red-500",    icon: "text-red-500" },
  amber:  { border: "border-l-amber-500",  icon: "text-amber-500" },
  green:  { border: "border-l-green-500",  icon: "text-green-500" },
  orange: { border: "border-l-orange-500", icon: "text-orange-500" },
  purple: { border: "border-l-purple-500", icon: "text-purple-500" },
};

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function norm(url: string) { return String(url || "").trim().replace(/\/+$/, ""); }

function normalizeSearchText(value: string): string {
  return String(value || "").trim().toLowerCase();
}

type DashboardTab = "today" | "portfolio" | "financial" | "delivery" | "emissions" | "tasks";

function normalizeDashboardTab(value: string | null | undefined): DashboardTab {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "overview" || raw === "insights" || raw === "") return "today";
  if (raw === "operations") return "delivery";
  if (raw === "today" || raw === "portfolio" || raw === "financial" || raw === "delivery" || raw === "emissions" || raw === "tasks") {
    return raw as DashboardTab;
  }
  return "today";
}

// â”€â”€â”€ Main component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function MainDashboard({ baseUrl }: { baseUrl: string }) {
  const api = useMemo(() => norm(baseUrl), [baseUrl]);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentYear = useMemo(() => new Date().getFullYear(), []);

  const [ov,  setOv]  = useState<OverviewData | null>(null);
  const [fin, setFin] = useState<FinancialData | null>(null);
  const [ops, setOps] = useState<OperationsData | null>(null);
  const [mil, setMil] = useState<MilestoneStatus | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");

  const [year, setYear] = useState<number | null>(currentYear);
  const [ind,  setInd]  = useState<string | null>(null);
  const [crm,  setCrm]  = useState<string | null>(null);
  const [currentUserLabel, setCurrentUserLabel] = useState<string>("");
  const [showFilters, setShowFilters] = useState(true);
  const tabFromUrl = useMemo(() => normalizeDashboardTab(searchParams.get("section")), [searchParams]);
  const [activeTab, setActiveTab] = useState<DashboardTab>(tabFromUrl);

  useEffect(() => {
    setActiveTab(tabFromUrl);
  }, [tabFromUrl]);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;

    async function loadCurrentUser() {
      try {
        const res = await fetch(`${api}/auth/me`, { cache: "no-store", credentials: "include" });
        if (!res.ok) return;
        const payload = await res.json().catch(() => ({})) as { user?: { full_name?: string | null; email?: string | null; user_id?: string | null } };
        const user = payload?.user || {};
        const defaultCrm = String(user.full_name || user.email || user.user_id || "").trim();
        if (!cancelled) {
          setCurrentUserLabel(defaultCrm);
        }
        if (!cancelled && defaultCrm) {
          setCrm((current) => current ?? defaultCrm);
        }
      } catch {
        // Keep the dashboard usable even if the identity lookup fails.
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    }

    void loadCurrentUser();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const updateActiveTab = useCallback((nextTab: DashboardTab) => {
    setActiveTab(nextTab);
    const params = new URLSearchParams(searchParams.toString());
    if (nextTab === "today") params.delete("section");
    else params.set("section", nextTab);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  const load = useCallback(async () => {
    if (!api || !authReady) return;
    setLoading(true); setError("");
    try {
      const p = new URLSearchParams();
      if (year !== null) p.set("year", String(year));
      if (ind)  p.set("industry", ind);
      if (crm)  p.set("crm_owner", crm);
      const qs = p.toString() ? `?${p}` : "";

      const [r1, r2, r3, r4] = await Promise.allSettled([
        fetch(`${api}/dashboard/overview${qs}`,             { cache: "no-store" }),
        fetch(`${api}/dashboard/financial-overview${qs}`,   { cache: "no-store" }),
        fetch(`${api}/dashboard/operations-overview${qs}`,  { cache: "no-store" }),
        fetch(`${api}/dashboard/jobs-by-milestone-status`,  { cache: "no-store" }),
      ]);
      if (r1.status === "fulfilled" && r1.value.ok) {
        const d = (await r1.value.json()) as OverviewData;
        setOv(d);
      } else {
        let detail = "Could not load dashboard data.";
        if (r1.status === "fulfilled") {
          try {
            const body = await r1.value.json() as { detail?: string };
            if (body.detail) detail = body.detail;
          } catch { /* ignore */ }
        }
        setError(detail);
      }
      if (r2.status === "fulfilled" && r2.value.ok) setFin((await r2.value.json()) as FinancialData);
      if (r3.status === "fulfilled" && r3.value.ok) setOps((await r3.value.json()) as OperationsData);
      if (r4.status === "fulfilled" && r4.value.ok) setMil((await r4.value.json()) as MilestoneStatus);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [api, authReady, year, ind, crm]);

  useEffect(() => { void load(); }, [load]);

  // â”€â”€â”€ Derived chart data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const monthlyData = useMemo(() => {
    if (!fin) return [];
    const map = new Map<string, { month: string; invoiced: number; paid: number; quotes: number }>();
    for (const x of fin.monthly_invoices ?? []) map.set(x.month_start, { month: formatMonth(x.month_start), invoiced: +x.total_value || 0, paid: +x.paid_total || 0, quotes: 0 });
    for (const x of fin.monthly_quotes ?? []) { const e = map.get(x.month_start); if (e) e.quotes = +x.total_value || 0; else map.set(x.month_start, { month: formatMonth(x.month_start), invoiced: 0, paid: 0, quotes: +x.total_value || 0 }); }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  }, [fin]);

  const emissionsTrend = useMemo(() =>
    (ov?.year_trend ?? []).filter(y => y.year !== null).sort((a, b) => +a.year! - +b.year!).map(y => ({ year: String(y.year), emissions: +y.total_emissions || 0 })),
  [ov]);

  const milestoneDonut = useMemo(() => {
    if (!ops) return [];
    const m = ops.metrics;
    return [
      { name: "On Track",      value: m.healthy_jobs,       color: MS_COLORS.green },
      { name: "Due Soon",      value: m.due_soon_jobs,      color: MS_COLORS.amber },
      { name: "Overdue",       value: m.overdue_jobs,       color: MS_COLORS.red },
      { name: "No Milestones", value: m.no_milestone_jobs,  color: MS_COLORS.no_milestones },
    ].filter(d => d.value > 0);
  }, [ops]);

  const quoteDonut = useMemo(() =>
    (fin?.quote_status_breakdown ?? []).map((q, i) => ({ name: q.status, value: +q.total_value || 0, color: MCKINSEY_DATA_COLORS[i % MCKINSEY_DATA_COLORS.length] })),
  [fin]);

  const topClients = useMemo(() =>
    (fin?.top_clients_by_invoiced_total ?? []).slice(0, 8).map(c => ({ name: c.client_name.length > 20 ? c.client_name.slice(0, 18) + "…" : c.client_name, value: +c.total_invoiced || 0, id: c.client_id })),
  [fin]);

  const industryData = useMemo(() =>
    (ov?.industry_breakdown ?? []).sort((a, b) => b.client_count - a.client_count).slice(0, 10).map(d => ({ name: d.industry, value: d.client_count })),
  [ov]);

  const timeSubject = useMemo(() =>
    (ops?.time_by_subject ?? []).slice(0, 8).map(d => ({ name: d.subject.length > 22 ? d.subject.slice(0, 20) + "…" : d.subject, hours: +d.hours || 0 })),
  [ops]);

  // â”€â”€â”€ Filter options â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const yearOpts = useMemo(() => {
    const years = (ov?.available_years ?? [])
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => b - a);
    if (!years.includes(currentYear)) years.unshift(currentYear);
    return years;
  }, [ov, currentYear]);
  const crmOpts = useMemo(() => ov?.crm_options ?? (ov?.available_crm ?? []).map((value) => ({ value, label: value, meta: null })), [ov]);
  const indOpts  = useMemo(() => ov?.available_industries ?? [], [ov]);
  const isSuperuser = crm === null;

  if (!loading && error && !ov) return <div className="py-12 text-center text-red-500">{error}</div>;

  // â”€â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  return (
    <div className="space-y-5">

      {/* Header */}
      <div>
        <h2 className="text-2xl font-semibold text-foreground">Dashboard</h2>
        <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
          {isSuperuser ? <Shield className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
          <span>{isSuperuser ? "All CRMs — Superuser View" : `Viewing: ${crm || currentUserLabel || "Selected CRM"}`}</span>
        </div>
      </div>

      {/* Loading skeleton */}
      {loading && !ov && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}><CardContent className="pt-6 pb-4"><div className="h-10 bg-muted animate-pulse rounded" /></CardContent></Card>
          ))}
        </div>
      )}

      {/* Client review notifications — shown whenever there are open client comments */}
      {(ov || !loading) && (
        <ClientReviewNotifications baseUrl={api} crmOwner={crm} />
      )}

      {/* Tabs */}
      {(ov || !loading) && (
        <Tabs value={activeTab} onValueChange={(value) => updateActiveTab(value as typeof activeTab)} className="w-full">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
            <TabsList>
              <TabsTrigger value="today">Today</TabsTrigger>
              <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
              <TabsTrigger value="financial">Financial</TabsTrigger>
              <TabsTrigger value="delivery">Delivery</TabsTrigger>
              <TabsTrigger value="emissions">Emissions</TabsTrigger>
              <TabsTrigger value="tasks">Tasks</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2 flex-wrap">
              {showFilters && (
                <>
                  <FilterSelect label="Year"     value={year?.toString() ?? ""}    onValue={v => setYear(+v)}             options={yearOpts.map(y => ({ label: String(y), value: String(y) }))} placeholder="Year…"    w="w-28" />
                  {indOpts.length > 0 && <FilterSelect label="Industry" value={ind ?? ALL} onValue={v => setInd(v === ALL ? null : v)} options={[{ label: "All", value: ALL }, ...indOpts.map(i => ({ label: i, value: i }))]} placeholder="All" w="w-40" />}
                  {crmOpts.length > 0 && <CrmSearchSelect label="CRM" value={crm ?? ALL} onValue={(v) => setCrm(v === ALL ? null : v)} options={crmOpts} placeholder="Search team members..." w="w-64" />}
                </>
              )}
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setShowFilters(v => !v)}>
                {showFilters ? "Hide filters" : "Filters"}
              </Button>
            </div>
          </div>

          {/* Today */}
          <TabsContent value="today" className="space-y-5 pt-3">
            <IntelligenceDashboard baseUrl={api} crmOwner={crm} />
          </TabsContent>

          {/* Portfolio */}
          <TabsContent value="portfolio" className="space-y-5 pt-3">
            <PortfolioSummaryTab overview={ov} />
          </TabsContent>

          {/* Financial */}
          <TabsContent value="financial" className="space-y-5 pt-3">
            <MainDashboardCharts section="financial" overview={ov} financial={fin} operations={ops} />
          </TabsContent>

          {/* Delivery */}
          <TabsContent value="delivery" className="space-y-5 pt-3">
            <MainDashboardCharts section="operations" overview={ov} financial={fin} operations={ops} />
          </TabsContent>

          {/* Emissions */}
          <TabsContent value="emissions" className="space-y-5 pt-3">
            <MainDashboardCharts section="emissions" overview={ov} financial={fin} operations={ops} />
            <EmissionsTable baseUrl={api} year={year} industry={ind} crmOwner={crm} />
          </TabsContent>

          {/* Tasks */}
          <TabsContent value="tasks" className="pt-3">
            <TaskCalendar baseUrl={api} crmOwner={crm} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

// â”€â”€â”€ Reusable sub-components â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function PortfolioSummaryTab({ overview }: { overview: OverviewData | null }) {
  if (!overview) {
    return <Loading />;
  }

  const totalJobs = overview.metrics.active_jobs;
  const totalClients = overview.metrics.total_clients;
  const totalEmissions = overview.metrics.total_emissions;
  const yoy = overview.metrics.yoy_change;
  const activeCrms = overview.jobs_per_crm.filter((crm) => crm.total_jobs > 0).length;
  const mostActiveCrm = [...overview.jobs_per_crm]
    .sort((a, b) => b.total_jobs - a.total_jobs)
    .at(0);

  return (
    <div className="space-y-5">
      <Card className="border-border/70 shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm font-semibold">Portfolio Snapshot</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">A compact view of the client portfolio, active work, and recent account activity.</p>
            </div>
            <Badge variant="outline" className="text-[10px] h-5 px-1.5">Scope: {overview.selected_year}</Badge>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MiniStat label="Total Clients" value={totalClients} />
          <MiniStat label="Active Jobs" value={totalJobs} />
          <MiniStat label="Active CRMs" value={activeCrms} />
          <MiniStat label="YoY Emissions" value={yoy != null ? `${yoy > 0 ? "+" : ""}${formatNumber(yoy)}%` : "—"} />
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="border-border/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Industry Mix</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {(overview.industry_breakdown ?? []).slice(0, 8).map((row) => {
              const total = overview.metrics.total_clients || 1;
              const pct = (row.client_count / total) * 100;
              return (
                <div key={row.industry} className="space-y-0.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{row.industry}</span>
                    <span className="text-muted-foreground">{row.client_count} clients</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.max(pct, 2)}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Top Emitting Clients</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {(overview.top_emitting_clients ?? []).slice(0, 8).map((client, index) => (
              <div key={client.client_id} className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{client.client_name}</div>
                  <div className="text-xs text-muted-foreground">Rank {index + 1}</div>
                </div>
                <div className="text-sm font-semibold text-muted-foreground">{formatNumber(client.emissions, 1)}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="border-border/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Jobs by CRM</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto pt-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="text-left pb-2 font-medium">CRM</th>
                  <th className="text-right pb-2 font-medium">Jobs</th>
                  <th className="text-right pb-2 font-medium">Open</th>
                  <th className="text-right pb-2 font-medium">Completed</th>
                </tr>
              </thead>
              <tbody>
                {(overview.jobs_per_crm ?? []).map((row) => {
                  const open = Object.entries(row.statuses ?? {}).reduce((sum, [status, count]) => {
                    const normalized = status.toLowerCase();
                    return sum + (normalized === "completed" || normalized === "archived" || normalized === "cancelled" ? 0 : count);
                  }, 0);
                  const completed = Object.entries(row.statuses ?? {}).reduce((sum, [status, count]) => {
                    const normalized = status.toLowerCase();
                    return sum + (normalized === "completed" ? count : 0);
                  }, 0);
                  return (
                    <tr key={row.crm_name} className="border-b last:border-0">
                      <td className="py-2.5 font-medium">{row.crm_name}</td>
                      <td className="py-2.5 text-right text-muted-foreground">{row.total_jobs}</td>
                      <td className="py-2.5 text-right text-muted-foreground">{open}</td>
                      <td className="py-2.5 text-right text-muted-foreground">{completed}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Recently Active Accounts</CardTitle>
              {mostActiveCrm ? <Badge variant="outline" className="text-[10px] h-5 px-1.5">{mostActiveCrm.crm_name}</Badge> : null}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {(overview.recent_activity ?? []).length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">No recent activity to show.</div>
            ) : (
              <div className="space-y-2">
                {overview.recent_activity.slice(0, 8).map((job) => (
                  <div key={job.job_id} className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{job.title || `Job #${job.job_id}`}</div>
                      <div className="text-xs text-muted-foreground">{job.client_name} · {job.reporting_year ?? "N/A"}</div>
                    </div>
                    <StatusBadge status={job.status} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FilterSelect({ label, value, onValue, options, placeholder, w }: { label: string; value: string; onValue: (v: string) => void; options: Array<{ label: string; value: string }>; placeholder: string; w: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onValue}>
        <SelectTrigger className={`h-8 ${w} text-xs`}><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>{options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function CrmSearchSelect({
  label,
  value,
  onValue,
  options,
  placeholder,
  w,
}: {
  label: string;
  value: string;
  onValue: (v: string) => void;
  options: Array<{ value: string; label: string; meta?: string | null }>;
  placeholder: string;
  w: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleMouseDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  const filtered = useMemo(() => {
    const q = normalizeSearchText(query);
    if (!q) return options;
    return options.filter((option) => {
      const haystack = `${option.label} ${option.meta || ""} ${option.value}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [options, query]);

  const selectedLabel = value === ALL
    ? "All CRMs"
    : options.find((option) => option.value === value)?.label || value;

  return (
    <div className="flex items-center gap-1.5" ref={containerRef}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className={`flex h-8 ${w} items-center justify-between rounded-md border bg-background px-3 text-left text-xs shadow-sm transition-colors hover:border-primary/40`}
        >
          <span className="truncate">{selectedLabel || placeholder}</span>
          <ChevronRight className={`h-3.5 w-3.5 flex-shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
        </button>
        {open && (
          <div className="absolute right-0 z-50 mt-1 w-full min-w-[18rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg">
            <div className="border-b p-2">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={placeholder}
                className="h-8 text-xs"
                autoFocus
              />
            </div>
            <div className="max-h-72 overflow-y-auto p-1">
              <button
                type="button"
                className={`flex w-full items-start gap-2 rounded-sm px-3 py-2 text-left text-xs hover:bg-accent ${value === ALL ? "bg-accent/60" : ""}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onValue(ALL);
                  setOpen(false);
                  setQuery("");
                }}
              >
                <span className="min-w-0">
                  <span className="block font-medium">All CRMs</span>
                  <span className="block text-[11px] text-muted-foreground">Show the full portfolio</span>
                </span>
              </button>
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">No team members found</div>
              ) : (
                filtered.map((option) => {
                  const active = value === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`flex w-full items-start gap-2 rounded-sm px-3 py-2 text-left text-xs hover:bg-accent ${active ? "bg-accent/60" : ""}`}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        onValue(option.value);
                        setOpen(false);
                        setQuery("");
                      }}
                    >
                      <span className="min-w-0">
                        <span className="block font-medium">{option.label}</span>
                        {option.meta ? <span className="block text-[11px] text-muted-foreground">{option.meta}</span> : null}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Loading() {
  return <div className="flex items-center justify-center py-16 gap-2 text-sm text-muted-foreground"><Clock className="h-4 w-4 animate-spin" />Loading…</div>;
}

function Empty() {
  return <div className="py-10 text-center text-sm text-muted-foreground">No data available</div>;
}
