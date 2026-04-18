"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, Briefcase, CheckCircle2, ChevronRight,
  Clock, Flame, Layers, Shield, TrendingDown, TrendingUp, Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TaskCalendar from "@/components/TaskCalendar";
import StatusBadge from "@/components/StatusBadge";
import { milestoneDotClass } from "@/lib/status-utils";
import { MCKINSEY_ACTIVITY_COLORS, MCKINSEY_DATA_COLORS } from "@/lib/chart-colors";

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type OverviewData = {
  selected_year: number;
  available_years: number[];
  available_industries: string[];
  available_crm: string[];
  year_trend: Array<{ year: number | null; total_emissions: number }>;
  industry_breakdown: Array<{ industry: string; client_count: number }>;
  metrics: {
    total_clients: number;
    total_emissions: number;
    active_jobs: number;
    total_datasets: number;
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
};

type FinancialData = {
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

type OperationsData = {
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
    estimated_hours: number; utilisation_pct: number | null;
  }>;
  jobs_needing_attention: Array<{
    job_id: number; job_number: string; title: string; client_name: string;
    crm_name: string; status: string; milestone_status: string;
    next_due_date: string | null; next_due_name: string; days_to_next_due: number | null;
    logged_hours: number; estimated_hours: number; utilisation_pct: number | null; reason: string;
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
function n(v: unknown, dp = 1) { return Number(v || 0).toLocaleString("en-GB", { maximumFractionDigits: dp }); }
function gbp(v: number) {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `£${n(v / 1_000_000)}M`;
  if (a >= 1_000) return `£${Math.round(v / 1_000)}k`;
  return `£${Math.round(v).toLocaleString("en-GB")}`;
}
function hrs(h: number) { return `${n(h)}h`; }
function mon(s: string) {
  try { return new Date(s + "T00:00:00").toLocaleDateString("en-GB", { month: "short", year: "2-digit" }); }
  catch { return s.slice(0, 7); }
}
function dt(s: string | null) {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }
  catch { return s; }
}

// â”€â”€â”€ Main component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function MainDashboard({ baseUrl }: { baseUrl: string }) {
  const api = useMemo(() => norm(baseUrl), [baseUrl]);

  const [ov,  setOv]  = useState<OverviewData | null>(null);
  const [fin, setFin] = useState<FinancialData | null>(null);
  const [ops, setOps] = useState<OperationsData | null>(null);
  const [mil, setMil] = useState<MilestoneStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");

  const [year, setYear] = useState<number | null>(null);
  const [ind,  setInd]  = useState<string | null>(null);
  const [crm,  setCrm]  = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(true);

  const load = useCallback(async () => {
    if (!api) return;
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
        setYear(d.selected_year);
      } else setError("Could not load dashboard data.");
      if (r2.status === "fulfilled" && r2.value.ok) setFin((await r2.value.json()) as FinancialData);
      if (r3.status === "fulfilled" && r3.value.ok) setOps((await r3.value.json()) as OperationsData);
      if (r4.status === "fulfilled" && r4.value.ok) setMil((await r4.value.json()) as MilestoneStatus);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [api, year, ind, crm]);

  useEffect(() => { void load(); }, [load]);

  // â”€â”€â”€ Derived chart data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const monthlyData = useMemo(() => {
    if (!fin) return [];
    const map = new Map<string, { month: string; invoiced: number; paid: number; quotes: number }>();
    for (const x of fin.monthly_invoices ?? []) map.set(x.month_start, { month: mon(x.month_start), invoiced: +x.total_value || 0, paid: +x.paid_total || 0, quotes: 0 });
    for (const x of fin.monthly_quotes ?? []) { const e = map.get(x.month_start); if (e) e.quotes = +x.total_value || 0; else map.set(x.month_start, { month: mon(x.month_start), invoiced: 0, paid: 0, quotes: +x.total_value || 0 }); }
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

  const yearOpts = useMemo(() => (ov?.available_years ?? []).map(Number).filter(Number.isFinite).sort((a, b) => b - a), [ov]);
  const crmOpts  = useMemo(() => ov?.available_crm ?? [], [ov]);
  const indOpts  = useMemo(() => ov?.available_industries ?? [], [ov]);
  const isSuperuser = crm === null;

  if (!loading && error && !ov) return <div className="py-12 text-center text-red-500">{error}</div>;

  // â”€â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold" style={{ color: "#F26624" }}>Dashboard</h2>
          <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
            {isSuperuser ? <Shield className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
            <span>{isSuperuser ? "All CRMs — Superuser View" : `Viewing: ${crm}`}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {showFilters && (
            <>
              <FilterSelect label="Year"     value={year?.toString() ?? ""}    onValue={v => setYear(+v)}             options={yearOpts.map(y => ({ label: String(y), value: String(y) }))} placeholder="Year…"    w="w-28" />
              {indOpts.length > 0 && <FilterSelect label="Industry" value={ind ?? ALL} onValue={v => setInd(v === ALL ? null : v)} options={[{ label: "All", value: ALL }, ...indOpts.map(i => ({ label: i, value: i }))]} placeholder="All" w="w-40" />}
              {crmOpts.length > 0 && <FilterSelect label="CRM"      value={crm ?? ALL} onValue={v => setCrm(v === ALL ? null : v)} options={[{ label: "All CRMs", value: ALL }, ...crmOpts.map(c => ({ label: c, value: c }))]} placeholder="All CRMs" w="w-44" />}
            </>
          )}
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setShowFilters(v => !v)}>
            {showFilters ? "Hide filters" : "Filters"}
          </Button>
        </div>
      </div>

      {/* CRM quick-select strip */}
      {crmOpts.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">View:</span>
          <Pill active={isSuperuser} onClick={() => setCrm(null)}>All CRMs</Pill>
          {crmOpts.map(c => <Pill key={c} active={crm === c} onClick={() => setCrm(crm === c ? null : c)}>{c}</Pill>)}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !ov && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}><CardContent className="pt-6 pb-4"><div className="h-10 bg-muted animate-pulse rounded" /></CardContent></Card>
          ))}
        </div>
      )}

      {/* Tabs */}
      {(ov || !loading) && (
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="mb-1">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="financial">Financial</TabsTrigger>
            <TabsTrigger value="operations">Operations</TabsTrigger>
            <TabsTrigger value="emissions">Emissions</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
          </TabsList>

          {/* Overview */}
          <TabsContent value="overview" className="space-y-5 pt-3">

            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <Kpi label="Active Jobs"     value={ops?.metrics.active_jobs ?? ov?.metrics.active_jobs ?? "—"}              icon={<Briefcase className="h-4 w-4" />}    accent="blue"   />
              <Kpi label="Overdue Jobs"    value={ops?.metrics.overdue_jobs ?? mil?.red ?? "—"}                            icon={<Flame className="h-4 w-4" />}         accent="red"    sub="milestone overdue" />
              <Kpi label="Due Soon"        value={ops?.metrics.due_soon_jobs ?? mil?.amber ?? "—"}                         icon={<AlertTriangle className="h-4 w-4" />} accent="amber"  sub="within 7 days" />
              <Kpi label="Outstanding"     value={fin ? gbp(fin.metrics.outstanding_total) : "—"}                            icon={<Layers className="h-4 w-4" />}        accent="orange" sub={fin ? `${fin.metrics.overdue_invoice_count} overdue inv.` : undefined} />
              <Kpi label="Quote Pipeline"  value={fin ? gbp(fin.metrics.quote_value_total) : "—"}                            icon={<TrendingUp className="h-4 w-4" />}    accent="purple" sub={fin ? `${fin.metrics.quote_count} quotes` : undefined} />
              <Kpi label="YoY Emissions"   value={ov?.metrics.yoy_change != null ? `${ov.metrics.yoy_change > 0 ? "+" : ""}${n(ov.metrics.yoy_change)}%` : "—"} icon={ov?.metrics.yoy_change != null && ov.metrics.yoy_change < 0 ? <TrendingDown className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />} accent={ov?.metrics.yoy_change != null && ov.metrics.yoy_change < 0 ? "green" : "red"} sub="vs prior year" />
            </div>

            {/* CRM Workload */}
            {ops?.crm_workload && ops.crm_workload.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold">CRM Workload</CardTitle>
                    {crm && <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => setCrm(null)}>← All CRMs</Button>}
                  </div>
                </CardHeader>
                <CardContent className="pt-0 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="text-left pb-2 font-medium">CRM</th>
                        <th className="text-right pb-2 font-medium">Jobs</th>
                        <th className="pb-2 font-medium w-48 text-center">Health</th>
                        <th className="text-right pb-2 font-medium">Logged</th>
                        <th className="text-right pb-2 font-medium">Est.</th>
                        <th className="text-right pb-2 font-medium">Util.</th>
                        <th className="w-5" />
                      </tr>
                    </thead>
                    <tbody>
                      {ops.crm_workload.map(c => {
                        const t = c.total_jobs || 1;
                        const gp = (c.green_jobs / t) * 100;
                        const ap = (c.amber_jobs / t) * 100;
                        const rp = (c.red_jobs   / t) * 100;
                        const u  = c.utilisation_pct;
                        const isActive = crm === c.crm_name;
                        return (
                          <tr key={c.crm_name} className={`border-b last:border-0 cursor-pointer transition-colors ${isActive ? "bg-accent" : "hover:bg-accent/40"}`} onClick={() => setCrm(isActive ? null : c.crm_name)}>
                            <td className="py-2.5 font-medium">{c.crm_name}</td>
                            <td className="text-right py-2.5 text-muted-foreground">{c.total_jobs}</td>
                            <td className="py-2.5 px-3">
                              <div className="h-2 rounded-full overflow-hidden bg-muted flex">
                                {gp > 0 && <div style={{ width: `${gp}%`, backgroundColor: MS_COLORS.green }} />}
                                {ap > 0 && <div style={{ width: `${ap}%`, backgroundColor: MS_COLORS.amber }} />}
                                {rp > 0 && <div style={{ width: `${rp}%`, backgroundColor: MS_COLORS.red }} />}
                              </div>
                              <div className="flex justify-between mt-0.5 text-[10px]">
                                <span className="text-green-600">{c.green_jobs} ✓</span>
                                <span className="text-amber-600">{c.amber_jobs} ⚠</span>
                                <span className="text-red-600">{c.red_jobs} ✕</span>
                              </div>
                            </td>
                            <td className="text-right py-2.5 text-muted-foreground">{hrs(c.logged_hours)}</td>
                            <td className="text-right py-2.5 text-muted-foreground">{c.estimated_hours > 0 ? hrs(c.estimated_hours) : "—"}</td>
                            <td className={`text-right py-2.5 font-semibold ${u == null ? "text-muted-foreground" : u > 100 ? "text-red-600" : u > 85 ? "text-amber-600" : "text-green-600"}`}>{u != null ? `${n(u)}%` : "—"}</td>
                            <td className="py-2.5 pl-1"><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}

            {/* Jobs needing attention */}
            {ops?.jobs_needing_attention && ops.jobs_needing_attention.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    Jobs Needing Attention
                    <Badge variant="destructive" className="text-[10px] h-5 px-1.5 ml-0.5">{ops.jobs_needing_attention.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="text-left pb-2 font-medium w-3" />
                        <th className="text-left pb-2 font-medium">Job</th>
                        <th className="text-left pb-2 font-medium">Client</th>
                        <th className="text-left pb-2 font-medium">CRM</th>
                        <th className="text-left pb-2 font-medium">Next Due</th>
                        <th className="text-right pb-2 font-medium">Days</th>
                        <th className="text-left pb-2 font-medium pl-3">Flags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ops.jobs_needing_attention.map(job => (
                        <tr key={job.job_id} className="border-b last:border-0 hover:bg-accent/40 transition-colors">
                          <td className="py-2.5 pr-2"><div className={`w-2.5 h-2.5 rounded-full ${milestoneDotClass(job.milestone_status)}`} /></td>
                          <td className="py-2.5">
                            <Link href={`/jobs/${job.job_id}`} className="hover:underline flex items-center gap-1 group font-medium">
                              <span className="text-muted-foreground text-xs">{job.job_number}</span>
                              <span className="truncate max-w-[150px]">{job.title}</span>
                              <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-60 flex-shrink-0" />
                            </Link>
                          </td>
                          <td className="py-2.5 text-muted-foreground text-xs truncate max-w-[110px]">{job.client_name}</td>
                          <td className="py-2.5 text-muted-foreground text-xs">{job.crm_name}</td>
                          <td className="py-2.5 text-xs">
                            <div className="text-muted-foreground capitalize">{job.next_due_name?.replace(/_/g, " ")}</div>
                            <div className="font-medium">{dt(job.next_due_date)}</div>
                          </td>
                          <td className={`py-2.5 text-right font-semibold text-sm ${job.days_to_next_due == null ? "text-muted-foreground" : job.days_to_next_due < 0 ? "text-red-600" : job.days_to_next_due <= 7 ? "text-amber-600" : "text-foreground"}`}>
                            {job.days_to_next_due != null ? (job.days_to_next_due < 0 ? `${Math.abs(job.days_to_next_due)}d late` : `${job.days_to_next_due}d`) : "—"}
                          </td>
                          <td className="py-2.5 pl-3">
                            <div className="flex flex-wrap gap-1">
                              {job.reason.split(",").map(r => r.trim()).filter(Boolean).map(r => (
                                <span key={r} className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200 whitespace-nowrap">{r}</span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}

            {/* Recent jobs */}
            {ov?.recent_activity && ov.recent_activity.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold">Recent Jobs</CardTitle>
                    <Button variant="outline" size="sm" className="text-xs h-7" asChild><Link href="/jobs">View all</Link></Button>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {ov.recent_activity.map(job => (
                    <div key={job.job_id} className="flex items-center gap-3 py-2.5 border-b last:border-0 hover:bg-accent/30 rounded px-1 transition-colors">
                      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${milestoneDotClass(job.milestone_status)}`} />
                      <div className="flex-1 min-w-0">
                        <Link href={`/jobs/${job.job_id}`} className="font-medium text-sm hover:underline truncate block">{job.title || `Job #${job.job_id}`}</Link>
                        <div className="text-xs text-muted-foreground">{job.client_name} · {job.reporting_year ?? "N/A"}</div>
                      </div>
                      <StatusBadge status={job.status} />
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Financial */}
          <TabsContent value="financial" className="space-y-5 pt-3">
            {!fin ? <Loading /> : (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <Kpi label="Quote Pipeline"  value={gbp(fin.metrics.quote_value_total)} sub={`${fin.metrics.quote_count} quotes`}    accent="blue"   icon={<TrendingUp className="h-4 w-4" />} />
                  <Kpi label="Total Invoiced"  value={gbp(fin.metrics.invoice_total)}    sub={`${fin.metrics.invoice_count} invoices`} accent="purple" icon={<Layers className="h-4 w-4" />} />
                  <Kpi label="Paid"            value={gbp(fin.metrics.paid_total)}       sub={`${n(fin.metrics.cash_realisation_pct)}% realisation`} accent="green" icon={<CheckCircle2 className="h-4 w-4" />} />
                  <Kpi label="Outstanding"     value={gbp(fin.metrics.outstanding_total)} sub={`${fin.metrics.overdue_invoice_count} overdue`} accent={fin.metrics.overdue_invoice_count > 0 ? "red" : "orange"} icon={<Clock className="h-4 w-4" />} />
                </div>

                {/* Cash realisation */}
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Cash Realisation</CardTitle></CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex items-center gap-4 mb-2">
                      <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(fin.metrics.cash_realisation_pct, 100)}%`, backgroundColor: fin.metrics.cash_realisation_pct >= 80 ? "#16a34a" : fin.metrics.cash_realisation_pct >= 50 ? "#d97706" : "#dc2626" }} />
                      </div>
                      <span className="text-lg font-semibold w-14 text-right">{n(fin.metrics.cash_realisation_pct)}%</span>
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Paid: {gbp(fin.metrics.paid_total)}</span>
                      <span>Invoiced: {gbp(fin.metrics.invoice_total)}</span>
                    </div>
                  </CardContent>
                </Card>

                {/* Monthly revenue */}
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Monthly Revenue</CardTitle></CardHeader>
                  <CardContent className="pt-0">
                    {monthlyData.length === 0 ? <Empty /> : (
                      <div className="h-[240px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={monthlyData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                            <defs>
                              <linearGradient id="gI" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={MCKINSEY_DATA_COLORS[0]} stopOpacity={0.25} /><stop offset="95%" stopColor={MCKINSEY_DATA_COLORS[0]} stopOpacity={0} /></linearGradient>
                              <linearGradient id="gP" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#16a34a" stopOpacity={0.25} /><stop offset="95%" stopColor="#16a34a" stopOpacity={0} /></linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.35} />
                            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => gbp(+v)} width={64} />
                            <Tooltip formatter={(v: unknown) => [gbp(+Number(v || 0)), ""]} />
                            <Area type="monotone" dataKey="invoiced" name="Invoiced" stroke={MCKINSEY_DATA_COLORS[0]} fill="url(#gI)" strokeWidth={2} />
                            <Area type="monotone" dataKey="paid"     name="Paid"     stroke="#16a34a"                 fill="url(#gP)" strokeWidth={2} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  {/* Quote pipeline donut */}
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Quote Pipeline by Status</CardTitle></CardHeader>
                    <CardContent className="pt-0">
                      {quoteDonut.length === 0 ? <Empty /> : (
                        <div className="flex items-center gap-4">
                          <div className="h-[180px] w-[180px] flex-shrink-0">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie data={quoteDonut} dataKey="value" nameKey="name" innerRadius="60%" outerRadius="90%" paddingAngle={2}>
                                  {quoteDonut.map((d, i) => <Cell key={i} fill={d.color} />)}
                                </Pie>
                                <Tooltip formatter={(v: unknown) => [gbp(+Number(v || 0)), ""]} />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="space-y-2 flex-1">
                            {quoteDonut.map((d, i) => (
                              <div key={i} className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: d.color }} /><span className="text-muted-foreground">{d.name}</span></div>
                                <span className="font-medium">{gbp(d.value)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Top clients bar */}
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Top Clients by Revenue</CardTitle></CardHeader>
                    <CardContent className="pt-0">
                      {topClients.length === 0 ? <Empty /> : (
                        <div className="h-[200px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={topClients} layout="vertical" margin={{ top: 0, right: 8, left: 4, bottom: 0 }}>
                              <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => gbp(+v)} />
                              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                              <Tooltip formatter={(v: unknown) => [gbp(+Number(v || 0)), "Invoiced"]} />
                              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                                {topClients.map((_, i) => <Cell key={i} fill={MCKINSEY_DATA_COLORS[i % MCKINSEY_DATA_COLORS.length]} />)}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Invoice status */}
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Invoice Status Breakdown</CardTitle></CardHeader>
                  <CardContent className="pt-0 space-y-2.5">
                    {(fin.invoice_status_breakdown ?? []).map((row, i) => {
                      const total = fin.metrics.invoice_total || 1;
                      const pct = (+row.total_value / total) * 100;
                      const ov2 = row.status.toLowerCase().includes("overdue");
                      return (
                        <div key={i} className="space-y-0.5">
                          <div className="flex justify-between text-xs">
                            <span className={`font-medium ${ov2 ? "text-red-600" : ""}`}>{row.status}</span>
                            <span className="text-muted-foreground">{gbp(+row.total_value || 0)} · {row.count} inv.</span>
                          </div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: ov2 ? "#dc2626" : MCKINSEY_DATA_COLORS[i % MCKINSEY_DATA_COLORS.length] }} />
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* Operations */}
          <TabsContent value="operations" className="space-y-5 pt-3">
            {!ops ? <Loading /> : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                  <Kpi label="Active Jobs"    value={ops.metrics.active_jobs}                     icon={<Briefcase className="h-4 w-4" />}     accent="blue"   />
                  <Kpi label="On Track"       value={ops.metrics.healthy_jobs}                    icon={<CheckCircle2 className="h-4 w-4" />}   accent="green"  sub="green milestone" />
                  <Kpi label="Due Soon"       value={ops.metrics.due_soon_jobs}                   icon={<AlertTriangle className="h-4 w-4" />}  accent="amber"  sub="within 7 days" />
                  <Kpi label="Overdue"        value={ops.metrics.overdue_jobs}                    icon={<Flame className="h-4 w-4" />}          accent="red"    />
                  <Kpi label="Utilisation"    value={ops.metrics.utilisation_pct != null ? `${n(ops.metrics.utilisation_pct)}%` : "—"} icon={<TrendingUp className="h-4 w-4" />} accent="purple" sub={`${hrs(ops.metrics.time_logged_hours)} logged`} />
                  <Kpi label="Due in 30 days" value={ops.metrics.upcoming_milestones_30d}         icon={<Clock className="h-4 w-4" />}          accent="orange" sub="milestones" />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  {/* Milestone health donut */}
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Milestone Health</CardTitle></CardHeader>
                    <CardContent className="pt-0">
                      {milestoneDonut.length === 0 ? <Empty /> : (
                        <div className="flex items-center gap-4">
                          <div className="relative h-[180px] w-[180px] flex-shrink-0">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie data={milestoneDonut} dataKey="value" nameKey="name" innerRadius="65%" outerRadius="92%" paddingAngle={2}>
                                  {milestoneDonut.map((d, i) => <Cell key={i} fill={d.color} />)}
                                </Pie>
                                <Tooltip />
                              </PieChart>
                            </ResponsiveContainer>
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <div className="text-center"><div className="text-xl font-bold">{ops.metrics.active_jobs}</div><div className="text-[10px] text-muted-foreground">jobs</div></div>
                            </div>
                          </div>
                          <div className="space-y-2.5 flex-1">
                            {milestoneDonut.map((d, i) => (
                              <div key={i} className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color }} /><span>{d.name}</span></div>
                                <span className="font-semibold">{d.value}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Time by subject */}
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Time by Subject</CardTitle></CardHeader>
                    <CardContent className="pt-0">
                      {timeSubject.length === 0 ? <Empty /> : (
                        <div className="h-[200px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={timeSubject} layout="vertical" margin={{ top: 0, right: 8, left: 4, bottom: 0 }}>
                              <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`} />
                              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={130} />
                              <Tooltip formatter={(v: unknown) => [`${n(+Number(v || 0))}h`, "Hours"]} />
                              <Bar dataKey="hours" radius={[0, 4, 4, 0]}>
                                {timeSubject.map((_, i) => <Cell key={i} fill={MCKINSEY_ACTIVITY_COLORS[i % MCKINSEY_ACTIVITY_COLORS.length]} />)}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* CRM utilisation table */}
                {ops.crm_workload.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">CRM Utilisation</CardTitle></CardHeader>
                    <CardContent className="pt-0 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-xs text-muted-foreground">
                            <th className="text-left pb-2 font-medium">CRM</th>
                            <th className="text-right pb-2 font-medium">Jobs</th>
                            <th className="text-right pb-2 font-medium text-green-600">✓</th>
                            <th className="text-right pb-2 font-medium text-amber-600">⚠</th>
                            <th className="text-right pb-2 font-medium text-red-600">✕</th>
                            <th className="text-right pb-2 font-medium">Logged</th>
                            <th className="text-right pb-2 font-medium">Est.</th>
                            <th className="text-right pb-2 font-medium">Util.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ops.crm_workload.map(c => {
                            const u = c.utilisation_pct;
                            return (
                              <tr key={c.crm_name} className="border-b last:border-0 hover:bg-accent/30 transition-colors">
                                <td className="py-2 font-medium">{c.crm_name}</td>
                                <td className="text-right py-2 text-muted-foreground">{c.total_jobs}</td>
                                <td className="text-right py-2 font-medium text-green-600">{c.green_jobs}</td>
                                <td className="text-right py-2 font-medium text-amber-600">{c.amber_jobs}</td>
                                <td className="text-right py-2 font-medium text-red-600">{c.red_jobs}</td>
                                <td className="text-right py-2 text-muted-foreground">{hrs(c.logged_hours)}</td>
                                <td className="text-right py-2 text-muted-foreground">{c.estimated_hours > 0 ? hrs(c.estimated_hours) : "—"}</td>
                                <td className={`text-right py-2 font-semibold ${u == null ? "text-muted-foreground" : u > 100 ? "text-red-600" : u > 85 ? "text-amber-600" : "text-green-600"}`}>{u != null ? `${n(u)}%` : "—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>
                )}

                {/* Job status breakdown */}
                {ov?.job_status_breakdown && ov.job_status_breakdown.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Job Status Breakdown</CardTitle></CardHeader>
                    <CardContent className="pt-0 space-y-2">
                      {ov.job_status_breakdown.map((s, i) => {
                        const tot = ov.job_status_breakdown.reduce((a, x) => a + x.count, 0) || 1;
                        const pct = (s.count / tot) * 100;
                        return (
                          <div key={i} className="space-y-0.5">
                            <div className="flex justify-between text-xs"><span className="font-medium">{s.status || "Unknown"}</span><span className="text-muted-foreground">{s.count} ({pct.toFixed(0)}%)</span></div>
                            <div className="h-1.5 bg-muted rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: STATUS_COLORS[s.status] ?? MCKINSEY_DATA_COLORS[i % MCKINSEY_DATA_COLORS.length] }} /></div>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>

          {/* Emissions */}
          <TabsContent value="emissions" className="space-y-5 pt-3">
            {!ov ? <Loading /> : (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <Kpi label="Total Emissions" value={`${n(ov.metrics.total_emissions)} tCO₂e`} icon={<Flame className="h-4 w-4" />}    accent="orange" sub={`${ov.selected_year}`} />
                  <Kpi label="YoY Change"      value={ov.metrics.yoy_change != null ? `${ov.metrics.yoy_change > 0 ? "+" : ""}${n(ov.metrics.yoy_change)}%` : "—"} icon={ov.metrics.yoy_change != null && ov.metrics.yoy_change < 0 ? <TrendingDown className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />} accent={ov.metrics.yoy_change != null && ov.metrics.yoy_change < 0 ? "green" : "red"} />
                  <Kpi label="Clients"         value={ov.metrics.total_clients}               icon={<Users className="h-4 w-4" />}    accent="blue"   />
                  <Kpi label="Datasets"        value={ov.metrics.total_datasets}              icon={<Layers className="h-4 w-4" />}   accent="purple" sub="available" />
                </div>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Emissions Trend (tCO₂e)</CardTitle></CardHeader>
                  <CardContent className="pt-0">
                    {emissionsTrend.length === 0 ? <Empty /> : (
                      <div className="h-[220px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={emissionsTrend} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                            <defs><linearGradient id="gE" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={MCKINSEY_DATA_COLORS[0]} stopOpacity={0.25} /><stop offset="95%" stopColor={MCKINSEY_DATA_COLORS[0]} stopOpacity={0} /></linearGradient></defs>
                            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.35} />
                            <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${n(+v)} t`} width={64} />
                            <Tooltip formatter={(v: unknown) => [`${n(+Number(v || 0))} tCO₂e`, "Emissions"]} />
                            <Area type="monotone" dataKey="emissions" name="Emissions" stroke={MCKINSEY_DATA_COLORS[0]} fill="url(#gE)" strokeWidth={2.5} dot={{ r: 4, fill: MCKINSEY_DATA_COLORS[0] }} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Clients by Industry</CardTitle></CardHeader>
                    <CardContent className="pt-0">
                      {industryData.length === 0 ? <Empty /> : (
                        <div className="h-[220px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={industryData} layout="vertical" margin={{ top: 0, right: 8, left: 4, bottom: 0 }}>
                              <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={130} />
                              <Tooltip formatter={(v: unknown) => [`${v} clients`, ""]} />
                              <Bar dataKey="value" name="Clients" radius={[0, 4, 4, 0]}>
                                {industryData.map((_, i) => <Cell key={i} fill={MCKINSEY_DATA_COLORS[i % MCKINSEY_DATA_COLORS.length]} />)}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Top Emitting Clients</CardTitle></CardHeader>
                    <CardContent className="pt-0">
                      {ov.top_emitting_clients.length === 0 ? <div className="py-8 text-center text-sm text-muted-foreground">No emissions data for {ov.selected_year}</div> : (
                        <div className="h-[220px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={ov.top_emitting_clients.slice(0, 8).map(c => ({ name: c.client_name.length > 18 ? c.client_name.slice(0, 16) + "…" : c.client_name, emissions: +c.emissions || 0 }))} layout="vertical" margin={{ top: 0, right: 8, left: 4, bottom: 0 }}>
                              <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${n(+v)} t`} />
                              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                              <Tooltip formatter={(v: unknown) => [`${n(+Number(v || 0))} tCO₂e`, "Emissions"]} />
                              <Bar dataKey="emissions" radius={[0, 4, 4, 0]}>
                                {ov.top_emitting_clients.slice(0, 8).map((_, i) => <Cell key={i} fill={MCKINSEY_DATA_COLORS[i % MCKINSEY_DATA_COLORS.length]} />)}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </>
            )}
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

function Kpi({ label, value, sub, icon, accent = "blue" }: { label: string; value: string | number; sub?: string; icon?: React.ReactNode; accent?: string }) {
  const s = ACCENT[accent as keyof typeof ACCENT] ?? ACCENT.blue;
  return (
    <Card className={`border-l-4 ${s.border}`}>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-xs text-muted-foreground leading-tight mb-1">{label}</div>
            <div className="text-2xl font-semibold leading-tight truncate">{value}</div>
            {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
          </div>
          {icon && <div className={`flex-shrink-0 mt-1 ${s.icon} opacity-60`}>{icon}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`text-xs px-3 py-1 rounded-full border transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary hover:text-foreground"}`}>
      {children}
    </button>
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

function Loading() {
  return <div className="flex items-center justify-center py-16 gap-2 text-sm text-muted-foreground"><Clock className="h-4 w-4 animate-spin" />Loading…</div>;
}

function Empty() {
  return <div className="py-10 text-center text-sm text-muted-foreground">No data available</div>;
}
