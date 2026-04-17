"use client";

import React from "react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell,
  ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
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
import StatusBadge from "@/components/StatusBadge";
import { MCKINSEY_ACTIVITY_COLORS, MCKINSEY_DATA_COLORS, MCKINSEY_SCOPE_COLORS } from "@/lib/chart-colors";
import { milestoneDotClass } from "@/lib/status-utils";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api/backend";
}

type DashboardOverview = {
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
  job_status_breakdown: Array<{
    status: string;
    count: number;
  }>;
  top_emitting_clients: Array<{
    client_name: string;
    client_id: number;
    emissions: number;
  }>;
  recent_activity: Array<{
    job_id: number;
    title: string;
    reporting_year: number | null;
    status: string;
    client_name: string;
    start_date: string | null;
    milestone_status?: string | null;
  }>;
  jobs_per_crm: Array<{
    crm_name: string;
    total_jobs: number;
    statuses: { [key: string]: number };
  }>;
};

type JobsMilestoneStatus = {
  green: number;
  amber: number;
  red: number;
  no_milestones: number;
  total: number;
};

type FinancialOverview = {
  metrics: {
    quote_count: number;
    quote_value_total: number;
    approved_quote_value: number;
    invoice_count: number;
    invoice_total: number;
    paid_total: number;
    outstanding_total: number;
    overdue_invoice_count: number;
    cash_realisation_pct: number;
  };
  quote_status_breakdown: Array<{
    status: string;
    count: number;
    total_value: number;
  }>;
  invoice_status_breakdown: Array<{
    status: string;
    count: number;
    total_value: number;
  }>;
  monthly_quotes: Array<{
    month: string;
    count: number;
    total_value: number;
  }>;
  monthly_invoices: Array<{
    month: string;
    count: number;
    total_value: number;
    paid_total: number;
  }>;
  top_clients_by_invoiced_total: Array<{
    client_id: number | null;
    client_name: string;
    invoice_total: number;
    paid_total: number;
    outstanding_total: number;
  }>;
  quote_currencies: string[];
  invoice_currencies: string[];
};

type OperationsOverview = {
  metrics: {
    active_jobs: number;
    healthy_jobs: number;
    due_soon_jobs: number;
    overdue_jobs: number;
    no_milestone_jobs: number;
    jobs_over_estimate: number;
    time_logged_hours: number;
    estimated_hours_total: number;
    utilisation_pct: number;
    completed_milestones: number;
    upcoming_milestones_30d: number;
  };
  milestone_breakdown: Array<{
    status: string;
    key: string;
    count: number;
  }>;
  time_by_subject: Array<{
    subject: string;
    hours: number;
  }>;
  crm_workload: Array<{
    crm_name: string;
    total_jobs: number;
    red_jobs: number;
    amber_jobs: number;
    green_jobs: number;
    no_milestone_jobs: number;
    logged_hours: number;
    estimated_hours: number;
    utilisation_pct: number | null;
  }>;
  jobs_needing_attention: Array<{
    job_id: number;
    job_number: string | null;
    title: string | null;
    client_name: string | null;
    crm_name: string | null;
    status: string | null;
    milestone_status: string | null;
    next_due_date: string | null;
    next_due_name: string | null;
    days_to_next_due: number | null;
    logged_hours: number;
    estimated_hours: number;
    utilisation_pct: number | null;
    reason: string | null;
  }>;
};

type BiPortfolio = {
  portfolio: {
    total_clients: number;
    active_clients: number;
    new_clients_this_year: number;
    clients_with_targets: number;
    jobs_delivered: number;
    total_emissions_managed: number;
  };
  client_status_breakdown: Array<{ status: string; count: number }>;
  emissions_by_country: Array<{ country: string; emissions: number }>;
  emissions_by_scope: { scope_1: number; scope_2: number; scope_3: number; other: number };
  cumulative_by_year: Array<{ year: number; annual_emissions: number; cumulative: number }>;
  top_clients_detail: Array<{ client_id: number | null; client_name: string; emissions: number }>;
};

type ReportColumn = {
  key: string;
  label: string;
};

type ReportRow = Record<string, string | number | boolean | null>;

type ReportViewData = {
  view: string;
  title: string;
  description: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  row_count: number;
};

type SavedReport = {
  saved_report_id: number;
  name: string;
  view: string;
  year: number | null;
  industry: string | null;
  crm_owner: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type TeamUser = {
  email: string;
  full_name: string;
  status?: string | null;
};

type ReportDrillState = {
  key: string;
  label: string;
  value: string;
};

type ReportChartDatum = {
  label: string;
  value: number;
  drillValue: string;
};

type ReportChartConfig = {
  breakdownKey: string;
  breakdownLabel: string;
  breakdownValueKey?: string;
  breakdownMetricLabel: string;
  topKey: string;
  topLabel: string;
  topValueKey: string;
  topMetricLabel: string;
};

const ALL_FILTER_VALUE = "__all__";

const EMPTY_JOBS_STATUS: JobsMilestoneStatus = {
  green: 0,
  amber: 0,
  red: 0,
  no_milestones: 0,
  total: 0,
};

const EMPTY_FINANCIAL: FinancialOverview = {
  metrics: {
    quote_count: 0,
    quote_value_total: 0,
    approved_quote_value: 0,
    invoice_count: 0,
    invoice_total: 0,
    paid_total: 0,
    outstanding_total: 0,
    overdue_invoice_count: 0,
    cash_realisation_pct: 0,
  },
  quote_status_breakdown: [],
  invoice_status_breakdown: [],
  monthly_quotes: [],
  monthly_invoices: [],
  top_clients_by_invoiced_total: [],
  quote_currencies: [],
  invoice_currencies: [],
};

const EMPTY_OPERATIONS: OperationsOverview = {
  metrics: {
    active_jobs: 0,
    healthy_jobs: 0,
    due_soon_jobs: 0,
    overdue_jobs: 0,
    no_milestone_jobs: 0,
    jobs_over_estimate: 0,
    time_logged_hours: 0,
    estimated_hours_total: 0,
    utilisation_pct: 0,
    completed_milestones: 0,
    upcoming_milestones_30d: 0,
  },
  milestone_breakdown: [],
  time_by_subject: [],
  crm_workload: [],
  jobs_needing_attention: [],
};

const EMPTY_BI_PORTFOLIO: BiPortfolio = {
  portfolio: { total_clients: 0, active_clients: 0, new_clients_this_year: 0, clients_with_targets: 0, jobs_delivered: 0, total_emissions_managed: 0 },
  client_status_breakdown: [],
  emissions_by_country: [],
  emissions_by_scope: { scope_1: 0, scope_2: 0, scope_3: 0, other: 0 },
  cumulative_by_year: [],
  top_clients_detail: [],
};

const REPORT_PRESETS = [
  {
    key: "client_portfolio",
    label: "Client Portfolio",
    description: "Client mix, client ownership, and delivery volume.",
  },
  {
    key: "job_delivery",
    label: "Job Delivery",
    description: "Milestone health, due dates, and hours vs estimate.",
  },
  {
    key: "invoice_follow_up",
    label: "Invoice Follow-Up",
    description: "Cash collection visibility and overdue follow-up.",
  },
  {
    key: "quote_pipeline",
    label: "Quote Pipeline",
    description: "Quoted value by client, status, and approval stage.",
  },
  {
    key: "crm_workload",
    label: "CRM Workload",
    description: "Delivery pressure, workload, and hours by CRM owner.",
  },
  {
    key: "emissions_portfolio",
    label: "Emissions Portfolio",
    description: "Client-level emissions ranking for the current filters.",
  },
];

const EMPTY_REPORT: ReportViewData = {
  view: "client_portfolio",
  title: "Client Portfolio",
  description: "",
  columns: [],
  rows: [],
  row_count: 0,
};

const EMPTY_SAVED_REPORTS: SavedReport[] = [];

const REPORT_CHART_COLORS = MCKINSEY_DATA_COLORS;

const REPORT_CHART_CONFIG: Record<string, ReportChartConfig> = {
  client_portfolio: {
    breakdownKey: "industry",
    breakdownLabel: "Industry",
    breakdownMetricLabel: "Clients",
    topKey: "client_name",
    topLabel: "Client",
    topValueKey: "active_jobs",
    topMetricLabel: "Active Jobs",
  },
  job_delivery: {
    breakdownKey: "milestone_status",
    breakdownLabel: "Milestone",
    breakdownMetricLabel: "Jobs",
    topKey: "job_number",
    topLabel: "Job",
    topValueKey: "logged_hours",
    topMetricLabel: "Logged Hours",
  },
  invoice_follow_up: {
    breakdownKey: "status",
    breakdownLabel: "Invoice Status",
    breakdownValueKey: "outstanding",
    breakdownMetricLabel: "Outstanding",
    topKey: "invoice_number",
    topLabel: "Invoice",
    topValueKey: "outstanding",
    topMetricLabel: "Outstanding",
  },
  quote_pipeline: {
    breakdownKey: "status",
    breakdownLabel: "Quote Status",
    breakdownValueKey: "quote_value",
    breakdownMetricLabel: "Quoted Value",
    topKey: "quote_number",
    topLabel: "Quote",
    topValueKey: "quote_value",
    topMetricLabel: "Quote Value",
  },
  crm_workload: {
    breakdownKey: "crm_name",
    breakdownLabel: "CRM",
    breakdownValueKey: "active_jobs",
    breakdownMetricLabel: "Active Jobs",
    topKey: "crm_name",
    topLabel: "CRM",
    topValueKey: "overdue_jobs",
    topMetricLabel: "Overdue Jobs",
  },
  emissions_portfolio: {
    breakdownKey: "industry",
    breakdownLabel: "Industry",
    breakdownValueKey: "total_emissions",
    breakdownMetricLabel: "tCO₂e",
    topKey: "client_name",
    topLabel: "Client",
    topValueKey: "total_emissions",
    topMetricLabel: "tCO₂e",
  },
};

// â”€â”€â”€ Visual constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const ACCENT: Record<string, { border: string; icon: string }> = {
  blue:   { border: "border-l-blue-500",   icon: "text-blue-500" },
  red:    { border: "border-l-red-500",    icon: "text-red-500" },
  amber:  { border: "border-l-amber-500",  icon: "text-amber-500" },
  green:  { border: "border-l-green-500",  icon: "text-green-500" },
  orange: { border: "border-l-orange-500", icon: "text-orange-500" },
  purple: { border: "border-l-purple-500", icon: "text-purple-500" },
  teal:   { border: "border-l-teal-500",   icon: "text-teal-500" },
};
const MS_COLORS = { green: "#16a34a", amber: "#d97706", red: "#dc2626", no_milestones: "#94a3b8" };
const JOB_STATUS_COLORS: Record<string, string> = {
  "Open": "#027AB1", "Data Gathering Phase": "#39BDF3", "Reporting Phase": "#F26624",
  "Review": "#8C5AC8", "Completed": "#16a34a", "Archived": "#94a3b8", "Cancelled": "#dc2626",
};

// â”€â”€â”€ Display helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function tco2e(v: number): string {
  if (v >= 1_000_000) return `${n(v / 1_000_000)} Mt`;
  if (v >= 1_000) return `${n(v / 1_000)} kt`;
  return `${n(v)} t`;
}

function gbp(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `Â£${Number(v / 1_000_000).toLocaleString("en-GB", { maximumFractionDigits: 1 })}M`;
  if (a >= 1_000) return `Â£${Math.round(v / 1_000)}k`;
  return `Â£${Math.round(v).toLocaleString("en-GB")}`;
}
function n(v: unknown, dp = 1): string {
  return Number(v || 0).toLocaleString("en-GB", { maximumFractionDigits: dp });
}
function hrs(h: number): string { return `${n(h)}h`; }

function formatNumber(value: number, digits = 1): string {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function reportPresetLabel(view: string): string {
  return REPORT_PRESETS.find((preset) => preset.key === view)?.label ?? view;
}

function reportFilterSummary(filters: {
  view: string;
  year?: number | null;
  industry?: string | null;
  crm_owner?: string | null;
}): string {
  return [
    reportPresetLabel(filters.view),
    filters.year ? `Year ${filters.year}` : "All years",
    filters.industry || "All industries",
    filters.crm_owner || "All client owners",
  ].join(" | ");
}

function formatMetricValue(key: string, value: number): string {
  const normalizedKey = key.toLowerCase();
  if (normalizedKey === "__count") return formatNumber(value, 0);
  if (normalizedKey.includes("pct")) return `${Number(value).toFixed(1)}%`;
  if (
    normalizedKey === "total" ||
    normalizedKey.includes("outstanding") ||
    normalizedKey.includes("amount_paid") ||
    normalizedKey.includes("quote_value")
  ) {
    return formatMoney(Number(value));
  }
  if (normalizedKey.includes("hours")) return formatNumber(Number(value), 1);
  return formatNumber(Number(value), Number.isInteger(value) ? 0 : 1);
}

function normalizeDimensionValue(value: unknown, fallback: string): string {
  const text = value === null || value === undefined ? "" : String(value).trim();
  return text || fallback;
}

function reportDimensionValue(row: ReportRow, key: string): string {
  switch (key) {
    case "industry":
      return normalizeDimensionValue(row[key], "Unspecified");
    case "crm_owner":
    case "crm_name":
      return normalizeDimensionValue(row[key], "Unassigned");
    case "status":
      return normalizeDimensionValue(row[key], "Unknown");
    case "milestone_status":
      return normalizeDimensionValue(row[key], "No milestones");
    case "client_name":
      return normalizeDimensionValue(row[key], "Unknown client");
    case "job_number":
      return normalizeDimensionValue(row[key] ?? (row["job_id"] ? `Job ${row["job_id"]}` : null), "Unknown job");
    case "invoice_number":
      return normalizeDimensionValue(row[key] ?? (row["invoice_id"] ? `Invoice ${row["invoice_id"]}` : null), "Unknown invoice");
    case "quote_number":
      return normalizeDimensionValue(row[key] ?? (row["quote_id"] ? `Quote ${row["quote_id"]}` : null), "Unknown quote");
    default:
      return normalizeDimensionValue(row[key], "Unspecified");
  }
}

function reportNumericValue(row: ReportRow, key: string): number {
  const numericValue = Number(row[key] ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function buildReportBreakdownData(rows: ReportRow[], config: ReportChartConfig): ReportChartDatum[] {
  const bucket = new Map<string, number>();
  for (const row of rows) {
    const label = reportDimensionValue(row, config.breakdownKey);
    const nextValue = config.breakdownValueKey ? reportNumericValue(row, config.breakdownValueKey) : 1;
    bucket.set(label, (bucket.get(label) ?? 0) + nextValue);
  }
  return Array.from(bucket.entries())
    .map(([label, value]) => ({
      label,
      value,
      drillValue: label,
    }))
    .filter((item) => item.value > 0)
    .sort((left, right) => right.value - left.value)
    .slice(0, 6);
}

function buildReportTopData(rows: ReportRow[], config: ReportChartConfig): ReportChartDatum[] {
  const bucket = new Map<string, number>();
  for (const row of rows) {
    const label = reportDimensionValue(row, config.topKey);
    bucket.set(label, (bucket.get(label) ?? 0) + reportNumericValue(row, config.topValueKey));
  }
  return Array.from(bucket.entries())
    .map(([label, value]) => ({
      label,
      value,
      drillValue: label,
    }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 8);
}

function extractChartDrillValue(entry: { drillValue?: unknown; payload?: { drillValue?: unknown } } | null | undefined): string | null {
  const drillValue = entry?.payload?.drillValue ?? entry?.drillValue;
  if (drillValue === null || drillValue === undefined || String(drillValue).trim() === "") {
    return null;
  }
  return String(drillValue);
}

function toneForStatus(status: string): string {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "completed") return "bg-emerald-100 text-emerald-800";
  if (normalized === "open") return "bg-blue-100 text-blue-800";
  if (normalized.includes("await")) return "bg-amber-100 text-amber-800";
  if (normalized.includes("archive") || normalized.includes("cancel")) return "bg-slate-100 text-slate-700";
  return "bg-muted text-foreground";
}

function toneForMilestoneStatus(status: string | null | undefined): string {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "red" || normalized === "overdue") return "bg-red-100 text-red-700";
  if (normalized === "amber" || normalized === "due soon") return "bg-amber-100 text-amber-800";
  if (normalized === "green" || normalized === "healthy") return "bg-emerald-100 text-emerald-800";
  if (normalized === "completed") return "bg-blue-100 text-blue-800";
  if (normalized.includes("no")) return "bg-slate-100 text-slate-700";
  return "bg-muted text-foreground";
}

function overviewSubtitle(data: DashboardOverview | null): string {
  if (!data) return "Portfolio-wide business intelligence for clients, jobs, and delivery performance.";
  const year = data.selected_year || new Date().getFullYear();
  return `Portfolio-wide business intelligence for ${year}, with filters for industry and client owner.`;
}

export default function InsightsPageClient() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const [activeTab, setActiveTab] = useState("portfolio");
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [jobsStatus, setJobsStatus] = useState<JobsMilestoneStatus>(EMPTY_JOBS_STATUS);
  const [financialData, setFinancialData] = useState<FinancialOverview>(EMPTY_FINANCIAL);
  const [operationsData, setOperationsData] = useState<OperationsOverview>(EMPTY_OPERATIONS);
  const [biPortfolio, setBiPortfolio] = useState<BiPortfolio>(EMPTY_BI_PORTFOLIO);
  const [reportView, setReportView] = useState<string>("client_portfolio");
  const [reportData, setReportData] = useState<ReportViewData>(EMPTY_REPORT);
  const [savedReports, setSavedReports] = useState<SavedReport[]>(EMPTY_SAVED_REPORTS);
  const [savedReportsLoading, setSavedReportsLoading] = useState(true);
  const [savedReportsError, setSavedReportsError] = useState("");
  const [savedReportName, setSavedReportName] = useState("");
  const [selectedSavedReportId, setSelectedSavedReportId] = useState<number | null>(null);
  const [savingReport, setSavingReport] = useState(false);
  const [reportDrill, setReportDrill] = useState<ReportDrillState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
  const [selectedCrm, setSelectedCrm] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamUser[]>([]);

  const readApiError = useCallback(async (res: Response, fallback: string) => {
    const text = await res.text();
    if (!text) return fallback;
    try {
      const parsed = JSON.parse(text) as { detail?: string };
      return parsed.detail || fallback;
    } catch {
      return text;
    }
  }, []);

  const fetchJsonWithTimeout = useCallback(async (url: string, init: RequestInit, timeoutMs: number, label: string) => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
      }
      throw e;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }, []);

  const loadSavedReports = useCallback(async (nextSelectedId?: number | null) => {
    setSavedReportsLoading(true);
    setSavedReportsError("");
    try {
      const res = await fetch(`${baseUrl}/dashboard/saved-reports`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(await readApiError(res, `Saved reports failed (${res.status})`));
      }
      const json = (await res.json()) as { reports?: SavedReport[] };
      const reports = json.reports || [];
      setSavedReports(reports);
      setSelectedSavedReportId((current) => {
        if (nextSelectedId !== undefined) {
          return reports.some((report) => report.saved_report_id === nextSelectedId) ? nextSelectedId : null;
        }
        return current !== null && reports.some((report) => report.saved_report_id === current) ? current : null;
      });
    } catch (e) {
      setSavedReports(EMPTY_SAVED_REPORTS);
      setSavedReportsError((e as Error).message);
    } finally {
      setSavedReportsLoading(false);
    }
  }, [baseUrl, readApiError]);

  const loadReportView = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (selectedYear) params.set("year", String(selectedYear));
      if (selectedIndustry) params.set("industry", selectedIndustry);
      if (selectedCrm) params.set("crm_owner", selectedCrm);
      const requestInit: RequestInit = {
        credentials: "include",
        cache: "no-store",
      };
      const reportRes = await fetchJsonWithTimeout(
        `${baseUrl}/dashboard/report-view?view=${encodeURIComponent(reportView)}${params.toString() ? `&${params.toString()}` : ""}`,
        requestInit,
        15000,
        "Report view",
      );
      if (!reportRes.ok) {
        setReportData(EMPTY_REPORT);
        return;
      }
      const reportJson = (await reportRes.json()) as ReportViewData;
      setReportData(reportJson);
    } catch {
      setReportData(EMPTY_REPORT);
    }
  }, [baseUrl, fetchJsonWithTimeout, reportView, selectedCrm, selectedIndustry, selectedYear]);

  const loadInsights = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (selectedYear) params.set("year", String(selectedYear));
      if (selectedIndustry) params.set("industry", selectedIndustry);
      if (selectedCrm) params.set("crm_owner", selectedCrm);

      params.set("limit", "100");
      const requestTimeoutMs = 12000;

      const requestInit: RequestInit = {
        credentials: "include",
        cache: "no-store",
      };

      const overviewRes = await fetchJsonWithTimeout(
        `${baseUrl}/dashboard/overview${params.toString() ? `?${params.toString()}` : ""}`,
        requestInit,
        requestTimeoutMs,
        "Insights overview",
      );

      if (!overviewRes.ok) {
        throw new Error(`Insights overview failed (${overviewRes.status})`);
      }

      const overviewJson = (await overviewRes.json()) as DashboardOverview;
      setData(overviewJson);
      if (!selectedYear && overviewJson.selected_year) {
        setSelectedYear(Number(overviewJson.selected_year));
      }

      setLoading(false);

      void (async () => {
        const [jobsStatusRes, financialRes, operationsRes, biPortfolioRes] = await Promise.allSettled([
          fetchJsonWithTimeout(`${baseUrl}/dashboard/jobs-by-milestone-status`, requestInit, requestTimeoutMs, "Jobs milestone status"),
          fetchJsonWithTimeout(`${baseUrl}/dashboard/financial-overview${params.toString() ? `?${params.toString()}` : ""}`, requestInit, requestTimeoutMs, "Financial overview"),
          fetchJsonWithTimeout(`${baseUrl}/dashboard/operations-overview${params.toString() ? `?${params.toString()}` : ""}`, requestInit, requestTimeoutMs, "Operations overview"),
          fetchJsonWithTimeout(`${baseUrl}/dashboard/bi-portfolio${params.toString() ? `?${params.toString()}` : ""}`, requestInit, requestTimeoutMs, "BI portfolio"),
        ]);

        if (jobsStatusRes.status === "fulfilled" && jobsStatusRes.value.ok) {
          const jobsStatusJson = (await jobsStatusRes.value.json()) as JobsMilestoneStatus;
          setJobsStatus(jobsStatusJson);
        } else {
          setJobsStatus(EMPTY_JOBS_STATUS);
        }

        if (financialRes.status === "fulfilled" && financialRes.value.ok) {
          const financialJson = (await financialRes.value.json()) as FinancialOverview;
          setFinancialData(financialJson);
        } else {
          setFinancialData(EMPTY_FINANCIAL);
        }

        if (operationsRes.status === "fulfilled" && operationsRes.value.ok) {
          const operationsJson = (await operationsRes.value.json()) as OperationsOverview;
          setOperationsData(operationsJson);
        } else {
          setOperationsData(EMPTY_OPERATIONS);
        }

        if (biPortfolioRes.status === "fulfilled" && biPortfolioRes.value.ok) {
          const biJson = (await biPortfolioRes.value.json()) as BiPortfolio;
          setBiPortfolio(biJson);
        } else {
          setBiPortfolio(EMPTY_BI_PORTFOLIO);
        }
      })();
    } catch (e) {
      setError((e as Error).message);
      setData(null);
      setJobsStatus(EMPTY_JOBS_STATUS);
      setFinancialData(EMPTY_FINANCIAL);
      setOperationsData(EMPTY_OPERATIONS);
      setReportData(EMPTY_REPORT);
      setBiPortfolio(EMPTY_BI_PORTFOLIO);
      setLoading(false);
    }
  }, [baseUrl, fetchJsonWithTimeout, selectedCrm, selectedIndustry, selectedYear]);

  useEffect(() => {
    void loadInsights();
  }, [loadInsights]);

  useEffect(() => {
    if (activeTab !== "reports") return;
    void loadReportView();
  }, [activeTab, loadReportView]);

  useEffect(() => {
    void loadSavedReports();
  }, [loadSavedReports]);

  useEffect(() => {
    let cancelled = false;
    async function loadTeamMembers() {
      try {
        const res = await fetch(`${baseUrl}/admin/users`, {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        const activeMembers = ((json.items ?? []) as TeamUser[])
          .filter((member) => String(member.status ?? "Active").toLowerCase() === "active")
          .sort((a, b) => (a.full_name || a.email || "").localeCompare(b.full_name || b.email || ""));
        setTeamMembers(activeMembers);
      } catch {
        if (!cancelled) setTeamMembers([]);
      }
    }
    void loadTeamMembers();
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  useEffect(() => {
    setReportDrill(null);
  }, [reportView, selectedYear, selectedIndustry, selectedCrm]);

  const totalJobs = useMemo(
    () => (data?.job_status_breakdown || []).reduce((sum, item) => sum + Number(item.count || 0), 0),
    [data]
  );
  const financialCurrencies = useMemo(
    () => Array.from(new Set([...(financialData.quote_currencies || []), ...(financialData.invoice_currencies || [])])),
    [financialData]
  );
  const hasMixedFinancialCurrencies = financialCurrencies.length > 1;
  const quoteMonths = useMemo(() => (financialData.monthly_quotes || []).slice(-8), [financialData]);
  const invoiceMonths = useMemo(() => (financialData.monthly_invoices || []).slice(-8), [financialData]);
  const maxQuoteMonthValue = useMemo(
    () => Math.max(...quoteMonths.map((row) => Number(row.total_value || 0)), 1),
    [quoteMonths]
  );
  const maxInvoiceMonthValue = useMemo(
    () => Math.max(...invoiceMonths.map((row) => Math.max(Number(row.total_value || 0), Number(row.paid_total || 0))), 1),
    [invoiceMonths]
  );
  const reportChartConfig = useMemo(
    () => REPORT_CHART_CONFIG[reportView] ?? REPORT_CHART_CONFIG.client_portfolio,
    [reportView]
  );
  const visibleReportRows = useMemo(() => {
    if (!reportDrill) return reportData.rows;
    return reportData.rows.filter((row) => reportDimensionValue(row, reportDrill.key) === reportDrill.value);
  }, [reportData.rows, reportDrill]);
  const reportBreakdownData = useMemo(
    () => buildReportBreakdownData(visibleReportRows, reportChartConfig),
    [reportChartConfig, visibleReportRows]
  );
  const reportTopData = useMemo(
    () => buildReportTopData(visibleReportRows, reportChartConfig),
    [reportChartConfig, visibleReportRows]
  );
  const selectedSavedReport = useMemo(
    () => savedReports.find((report) => report.saved_report_id === selectedSavedReportId) ?? null,
    [savedReports, selectedSavedReportId]
  );
  const matchingSavedReportId = useMemo(
    () =>
      savedReports.find(
        (report) =>
          report.view === reportView &&
          (report.year ?? null) === (selectedYear ?? null) &&
          (report.industry ?? null) === (selectedIndustry ?? null) &&
          (report.crm_owner ?? null) === (selectedCrm ?? null)
      )?.saved_report_id ?? null,
    [reportView, savedReports, selectedCrm, selectedIndustry, selectedYear]
  );
  const currentReportSummary = useMemo(
    () =>
      reportFilterSummary({
        view: reportView,
        year: selectedYear,
        industry: selectedIndustry,
        crm_owner: selectedCrm,
      }),
    [reportView, selectedCrm, selectedIndustry, selectedYear]
  );

  // â”€â”€â”€ Chart data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const emissionsChartData = useMemo(() =>
    (data?.year_trend ?? []).filter(y => y.year !== null).sort((a, b) => +a.year! - +b.year!).map(y => ({ year: String(y.year), emissions: +y.total_emissions || 0 })),
  [data]);

  const milestoneDonutData = useMemo(() => [
    { name: "On Track",      value: jobsStatus.green,         color: MS_COLORS.green },
    { name: "Due Soon",      value: jobsStatus.amber,         color: MS_COLORS.amber },
    { name: "Overdue",       value: jobsStatus.red,           color: MS_COLORS.red },
    { name: "No Milestones", value: jobsStatus.no_milestones, color: MS_COLORS.no_milestones },
  ].filter(d => d.value > 0), [jobsStatus]);

  const opsMilestoneDonutData = useMemo(() => {
    const m = operationsData.metrics;
    return [
      { name: "On Track",      value: m.healthy_jobs,      color: MS_COLORS.green },
      { name: "Due Soon",      value: m.due_soon_jobs,     color: MS_COLORS.amber },
      { name: "Overdue",       value: m.overdue_jobs,      color: MS_COLORS.red },
      { name: "No Milestones", value: m.no_milestone_jobs, color: MS_COLORS.no_milestones },
    ].filter(d => d.value > 0);
  }, [operationsData]);

  const industryChartData = useMemo(() =>
    (data?.industry_breakdown ?? []).sort((a, b) => b.client_count - a.client_count).slice(0, 10).map(d => ({ name: d.industry || "Unspecified", value: d.client_count })),
  [data]);

  const topEmittersChartData = useMemo(() =>
    (data?.top_emitting_clients ?? []).slice(0, 8).map(c => ({ name: c.client_name.length > 18 ? c.client_name.slice(0, 16) + "â€¦" : c.client_name, emissions: +c.emissions || 0, id: c.client_id })),
  [data]);

  const jobStatusChartData = useMemo(() =>
    (data?.job_status_breakdown ?? []).map(s => ({ name: s.status || "Unknown", value: s.count })),
  [data]);

  const timeSubjectChartData = useMemo(() =>
    (operationsData.time_by_subject ?? []).slice(0, 8).map(d => ({ name: d.subject.length > 22 ? d.subject.slice(0, 20) + "â€¦" : d.subject, hours: +d.hours || 0 })),
  [operationsData]);

  const monthlyChartData = useMemo(() => {
    const map = new Map<string, { month: string; invoiced: number; paid: number; quotes: number }>();
    for (const x of financialData.monthly_invoices ?? []) map.set(x.month, { month: x.month, invoiced: +x.total_value || 0, paid: +x.paid_total || 0, quotes: 0 });
    for (const x of financialData.monthly_quotes ?? []) { const e = map.get(x.month); if (e) e.quotes = +x.total_value || 0; else map.set(x.month, { month: x.month, invoiced: 0, paid: 0, quotes: +x.total_value || 0 }); }
    return [...map.values()].slice(-12);
  }, [financialData]);

  const quoteDonutData = useMemo(() =>
    (financialData.quote_status_breakdown ?? []).map((q, i) => ({ name: q.status, value: +q.total_value || 0, color: MCKINSEY_DATA_COLORS[i % MCKINSEY_DATA_COLORS.length] })),
  [financialData]);

  const topClientsChartData = useMemo(() =>
    (financialData.top_clients_by_invoiced_total ?? []).slice(0, 8).map(c => ({ name: c.client_name.length > 20 ? c.client_name.slice(0, 18) + "â€¦" : c.client_name, value: +c.invoice_total || 0, id: c.client_id })),
  [financialData]);

  // â”€â”€â”€ BI Portfolio chart data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const cumulativeChartData = useMemo(() =>
    (biPortfolio.cumulative_by_year ?? []).map(d => ({ year: String(d.year), annual: +d.annual_emissions || 0, cumulative: +d.cumulative || 0 })),
  [biPortfolio]);

  const clientStatusDonutData = useMemo(() =>
    (biPortfolio.client_status_breakdown ?? []).map((d, i) => ({ name: d.status || "Unknown", value: d.count, color: MCKINSEY_DATA_COLORS[i % MCKINSEY_DATA_COLORS.length] })).filter(d => d.value > 0),
  [biPortfolio]);

  const scopeDonutData = useMemo(() => {
    const s = biPortfolio.emissions_by_scope;
    return [
      { name: "Scope 1", value: +s.scope_1 || 0, color: MCKINSEY_SCOPE_COLORS[0] },
      { name: "Scope 2", value: +s.scope_2 || 0, color: MCKINSEY_SCOPE_COLORS[1] },
      { name: "Scope 3", value: +s.scope_3 || 0, color: MCKINSEY_SCOPE_COLORS[2] },
      { name: "Other",   value: +s.other   || 0, color: "#94a3b8" },
    ].filter(d => d.value > 0);
  }, [biPortfolio]);

  const countryChartData = useMemo(() =>
    (biPortfolio.emissions_by_country ?? []).slice(0, 10).map(d => ({ name: d.country || "Unknown", value: +d.emissions || 0 })),
  [biPortfolio]);

  const topClientsEmissionsData = useMemo(() =>
    (biPortfolio.top_clients_detail ?? []).slice(0, 10).map(c => ({ name: c.client_name.length > 20 ? c.client_name.slice(0, 18) + "â€¦" : c.client_name, value: +c.emissions || 0, id: c.client_id })),
  [biPortfolio]);

  const crmOpts = useMemo(() => data?.available_crm ?? [], [data]);
  const isSuperuser = selectedCrm === null;

  function toggleReportDrill(key: string, label: string, value: string) {
    setReportDrill((current) => {
      if (current?.key === key && current.value === value) {
        return null;
      }
      return { key, label, value };
    });
  }

  function applySavedReport(report: SavedReport) {
    setSelectedSavedReportId(report.saved_report_id);
    setSavedReportName(report.name);
    setReportView(report.view);
    setSelectedYear(report.year ?? null);
    setSelectedIndustry(report.industry ?? null);
    setSelectedCrm(report.crm_owner ?? null);
  }

  async function saveCurrentReport() {
    const trimmedName = savedReportName.trim();
    if (!trimmedName) {
      setSavedReportsError("Enter a name for this saved report.");
      return;
    }
    setSavingReport(true);
    setSavedReportsError("");
    try {
      const res = await fetch(`${baseUrl}/dashboard/saved-reports`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          view: reportView,
          year: selectedYear,
          industry: selectedIndustry,
          crm_owner: selectedCrm,
        }),
      });
      if (!res.ok) {
        throw new Error(await readApiError(res, `Save report failed (${res.status})`));
      }
      const json = (await res.json()) as { report: SavedReport };
      setSavedReportName(json.report.name);
      setSelectedSavedReportId(json.report.saved_report_id);
      await loadSavedReports(json.report.saved_report_id);
    } catch (e) {
      setSavedReportsError((e as Error).message);
    } finally {
      setSavingReport(false);
    }
  }

  async function updateSelectedReport() {
    if (!selectedSavedReportId) {
      setSavedReportsError("Select a saved report to update.");
      return;
    }
    const trimmedName = savedReportName.trim() || selectedSavedReport?.name || "";
    if (!trimmedName) {
      setSavedReportsError("Enter a name for this saved report.");
      return;
    }
    setSavingReport(true);
    setSavedReportsError("");
    try {
      const res = await fetch(`${baseUrl}/dashboard/saved-reports/${selectedSavedReportId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          view: reportView,
          year: selectedYear,
          industry: selectedIndustry,
          crm_owner: selectedCrm,
        }),
      });
      if (!res.ok) {
        throw new Error(await readApiError(res, `Update report failed (${res.status})`));
      }
      const json = (await res.json()) as { report: SavedReport };
      setSavedReportName(json.report.name);
      await loadSavedReports(json.report.saved_report_id);
    } catch (e) {
      setSavedReportsError((e as Error).message);
    } finally {
      setSavingReport(false);
    }
  }

  async function deleteSavedReport(savedReport: SavedReport) {
    if (!window.confirm(`Delete saved report "${savedReport.name}"?`)) return;
    setSavingReport(true);
    setSavedReportsError("");
    try {
      const res = await fetch(`${baseUrl}/dashboard/saved-reports/${savedReport.saved_report_id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(await readApiError(res, `Delete report failed (${res.status})`));
      }
      if (selectedSavedReportId === savedReport.saved_report_id) {
        setSelectedSavedReportId(null);
        setSavedReportName("");
      }
      await loadSavedReports(selectedSavedReportId === savedReport.saved_report_id ? null : selectedSavedReportId);
    } catch (e) {
      setSavedReportsError((e as Error).message);
    } finally {
      setSavingReport(false);
    }
  }

  async function exportReportCsv() {
    try {
      const params = new URLSearchParams();
      params.set("view", reportView);
      params.set("limit", "500");
      if (selectedYear) params.set("year", String(selectedYear));
      if (selectedIndustry) params.set("industry", selectedIndustry);
      if (selectedCrm) params.set("crm_owner", selectedCrm);
      const res = await fetch(`${baseUrl}/dashboard/report-export?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Report export failed (${res.status})${text ? `: ${text}` : ""}`);
      }
      const blob = await res.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `insights-${reportView}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function formatReportValue(key: string, value: unknown): string {
    if (value === null || value === undefined || value === "") return "-";
    const normalizedKey = key.toLowerCase();
    if (normalizedKey.includes("date")) return formatDate(String(value));
    if (normalizedKey.includes("pct")) return `${Number(value).toFixed(1)}%`;
    if (
      normalizedKey === "total" ||
      normalizedKey.includes("outstanding") ||
      normalizedKey.includes("amount_paid") ||
      normalizedKey.includes("quote_value")
    ) {
      return formatMoney(Number(value));
    }
    if (normalizedKey.includes("hours")) return formatNumber(Number(value), 1);
    if (typeof value === "number") return formatNumber(value, Number.isInteger(value) ? 0 : 1);
    return String(value);
  }

  function reportRowHref(row: ReportRow): string | null {
    if (reportView === "client_portfolio" && row.client_id) return `/clients/${row.client_id}`;
    if (reportView === "job_delivery" && row.job_id) return `/jobs/${row.job_id}`;
    if (reportView === "invoice_follow_up" && row.client_id && row.invoice_id) return `/clients/${row.client_id}/invoices/${row.invoice_id}`;
    if (reportView === "quote_pipeline" && row.client_id) return `/clients/${row.client_id}/quotes`;
    if (reportView === "emissions_portfolio" && row.client_id) return `/clients/${row.client_id}`;
    return null;
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8 space-y-5">

      {/* â”€â”€ Header â”€â”€ */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold" style={{ color: "#F26624" }}>Insights</h2>
          <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
            {isSuperuser ? <Shield className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
            <span>{isSuperuser ? "All CRMs â€” Portfolio View" : `Viewing: ${selectedCrm}`}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Year</span>
            <Select value={selectedYear ? String(selectedYear) : ALL_FILTER_VALUE} onValueChange={v => setSelectedYear(v === ALL_FILTER_VALUE ? null : Number(v))}>
              <SelectTrigger className="h-8 w-28 text-xs"><SelectValue placeholder="All years" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_FILTER_VALUE}>All years</SelectItem>
                {(data?.available_years ?? []).map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {(data?.available_industries ?? []).length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Industry</span>
              <Select value={selectedIndustry ?? ALL_FILTER_VALUE} onValueChange={v => setSelectedIndustry(v === ALL_FILTER_VALUE ? null : v)}>
                <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="All industries" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>All</SelectItem>
                  {(data?.available_industries ?? []).map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {teamMembers.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">CRM</span>
              <Select value={selectedCrm ?? ALL_FILTER_VALUE} onValueChange={v => setSelectedCrm(v === ALL_FILTER_VALUE ? null : v)}>
                <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="All CRMs" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>All CRMs</SelectItem>
                  {teamMembers.map(m => <SelectItem key={m.email} value={m.full_name || m.email}>{m.full_name || m.email}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => void loadInsights()}>Refresh</Button>
        </div>
      </div>

      {/* â”€â”€ CRM pill strip â”€â”€ */}
      {crmOpts.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">View:</span>
          <InsightsPill active={isSuperuser} onClick={() => setSelectedCrm(null)}>All CRMs</InsightsPill>
          {crmOpts.map(c => <InsightsPill key={c} active={selectedCrm === c} onClick={() => setSelectedCrm(selectedCrm === c ? null : c)}>{c}</InsightsPill>)}
        </div>
      )}

      {error && <div className="text-sm text-red-500 py-1">{error}</div>}

      {/* â”€â”€ Loading skeleton â”€â”€ */}
      {loading && !data && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}><CardContent className="pt-6 pb-4"><div className="h-10 bg-muted animate-pulse rounded" /></CardContent></Card>
          ))}
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-1">
          <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
          <TabsTrigger value="emissions">Emissions</TabsTrigger>
          <TabsTrigger value="financial">Financial</TabsTrigger>
          <TabsTrigger value="operations">Operations</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>

          {/* â•â• PORTFOLIO â•â• */}
          <TabsContent value="portfolio" className="space-y-5 pt-3">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <InsightsKpi label="Total Clients"    value={biPortfolio.portfolio.total_clients}                                                                    icon={<Users className="h-4 w-4" />}         accent="blue"   sub="in portfolio" />
              <InsightsKpi label="Active Clients"   value={biPortfolio.portfolio.active_clients}                                                                   icon={<Users className="h-4 w-4" />}         accent="green"  sub="currently active" />
              <InsightsKpi label="New This Year"    value={biPortfolio.portfolio.new_clients_this_year}                                                            icon={<TrendingUp className="h-4 w-4" />}    accent="purple" sub="clients added" />
              <InsightsKpi label="With Targets"     value={biPortfolio.portfolio.clients_with_targets}                                                             icon={<CheckCircle2 className="h-4 w-4" />}  accent="teal"   sub="net zero targets" />
              <InsightsKpi label="Jobs Delivered"   value={biPortfolio.portfolio.jobs_delivered}                                                                   icon={<Briefcase className="h-4 w-4" />}     accent="blue"   sub="completed" />
              <InsightsKpi label="Emissions Managed" value={tco2e(biPortfolio.portfolio.total_emissions_managed)}                                                  icon={<Layers className="h-4 w-4" />}        accent="orange" sub="cumulative tCO₂e" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Cumulative Emissions Under Management */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Emissions Under Management (tCO₂e)</CardTitle></CardHeader>
                <CardContent className="pt-0">
                  {cumulativeChartData.length === 0 ? <InsightsEmpty /> : (
                    <div className="h-[240px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={cumulativeChartData} margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
                          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.35} />
                          <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                          <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={v => tco2e(+v)} width={64} />
                          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={v => tco2e(+v)} width={64} />
                          <Tooltip formatter={(v: unknown, name?: string) => [tco2e(+Number(v || 0)), name === "annual" ? "Annual" : "Cumulative"]} />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Bar yAxisId="left" dataKey="annual" name="Annual" fill={MCKINSEY_DATA_COLORS[1]} radius={[3, 3, 0, 0]} opacity={0.8} />
                          <Line yAxisId="right" type="monotone" dataKey="cumulative" name="Cumulative" stroke={MCKINSEY_DATA_COLORS[4]} strokeWidth={2.5} dot={{ r: 4, fill: MCKINSEY_DATA_COLORS[4] }} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Client Status donut */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Client Portfolio Status</CardTitle></CardHeader>
                <CardContent className="pt-0">
                  {clientStatusDonutData.length === 0 ? <InsightsEmpty /> : (
                    <div className="flex items-center gap-4">
                      <div className="relative h-[180px] w-[180px] flex-shrink-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={clientStatusDonutData} dataKey="value" nameKey="name" innerRadius="65%" outerRadius="92%" paddingAngle={2}>
                              {clientStatusDonutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                            </Pie>
                            <Tooltip />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="text-center"><div className="text-xl font-bold">{biPortfolio.portfolio.total_clients}</div><div className="text-[10px] text-muted-foreground">clients</div></div>
                        </div>
                      </div>
                      <div className="space-y-2.5 flex-1">
                        {clientStatusDonutData.map((d, i) => (
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
            </div>

            {/* Clients by Industry + Top 10 Clients list */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Clients by Industry</CardTitle></CardHeader>
                <CardContent className="pt-0">
                  {industryChartData.length === 0 ? <InsightsEmpty /> : (
                    <div className="h-[240px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={industryChartData} layout="vertical" margin={{ top: 0, right: 8, left: 4, bottom: 0 }}>
                          <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                          <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={130} />
                          <Tooltip formatter={(v: unknown) => [`${v} clients`, ""]} />
                          <Bar dataKey="value" name="Clients" radius={[0, 4, 4, 0]}>
                            {industryChartData.map((_, i) => <Cell key={i} fill={MCKINSEY_DATA_COLORS[i % MCKINSEY_DATA_COLORS.length]} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold">Top Clients â€” All Jobs</CardTitle>
                    <Button variant="outline" size="sm" className="text-xs h-7" asChild><Link href="/clients">View all</Link></Button>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {(data?.top_emitting_clients ?? []).length === 0 ? <InsightsEmpty /> : (
                    <div className="space-y-1">
                      {(data?.top_emitting_clients ?? []).slice(0, 10).map((c, i) => (
                        <Link key={c.client_id} href={`/clients/${c.client_id}`} className="flex items-center gap-2 text-xs py-1.5 px-1 rounded hover:bg-accent/40 transition-colors group">
                          <span className="w-5 text-right text-muted-foreground flex-shrink-0">{i + 1}.</span>
                          <span className="flex-1 truncate text-muted-foreground group-hover:text-foreground">{c.client_name}</span>
                          <span className="font-medium flex-shrink-0">{n(c.emissions)} tCO₂e</span>
                          <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-60 flex-shrink-0" />
                        </Link>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* â•â• EMISSIONS â•â• */}
          <TabsContent value="emissions" className="space-y-5 pt-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <InsightsKpi label="Total Emissions"  value={data ? tco2e(data.metrics.total_emissions) : "â€”"}                                              icon={<Flame className="h-4 w-4" />}        accent="orange" sub={data?.selected_year ? String(data.selected_year) : "all years"} />
              <InsightsKpi label="YoY Change"       value={data?.metrics.yoy_change != null ? `${data.metrics.yoy_change > 0 ? "+" : ""}${n(data.metrics.yoy_change)}%` : "â€”"} icon={data?.metrics.yoy_change != null && data.metrics.yoy_change < 0 ? <TrendingDown className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />} accent={data?.metrics.yoy_change != null && data.metrics.yoy_change < 0 ? "green" : "red"} sub="vs prior year" />
              <InsightsKpi label="Scope 1"          value={tco2e(biPortfolio.emissions_by_scope.scope_1)}                                                 icon={<Flame className="h-4 w-4" />}        accent="blue"   sub="direct" />
              <InsightsKpi label="Scope 2 + 3"      value={tco2e(biPortfolio.emissions_by_scope.scope_2 + biPortfolio.emissions_by_scope.scope_3)}         icon={<Layers className="h-4 w-4" />}       accent="purple" sub="indirect + value chain" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Emissions year trend */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Annual Emissions Trend (tCO₂e)</CardTitle></CardHeader>
                <CardContent className="pt-0">
                  {emissionsChartData.length === 0 ? <InsightsEmpty /> : (
                    <div className="h-[220px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={emissionsChartData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                          <defs><linearGradient id="gEm" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={MCKINSEY_DATA_COLORS[0]} stopOpacity={0.25} /><stop offset="95%" stopColor={MCKINSEY_DATA_COLORS[0]} stopOpacity={0} /></linearGradient></defs>
                          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.35} />
                          <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} tickFormatter={v => tco2e(+v)} width={68} />
                          <Tooltip formatter={(v: unknown) => [tco2e(+Number(v || 0)), "Emissions"]} />
                          <Area type="monotone" dataKey="emissions" stroke={MCKINSEY_DATA_COLORS[0]} fill="url(#gEm)" strokeWidth={2.5} dot={{ r: 4, fill: MCKINSEY_DATA_COLORS[0] }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Scope breakdown donut */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Emissions by Scope</CardTitle></CardHeader>
                <CardContent className="pt-0">
                  {scopeDonutData.length === 0 ? <InsightsEmpty /> : (
                    <div className="flex items-center gap-4">
                      <div className="relative h-[180px] w-[180px] flex-shrink-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={scopeDonutData} dataKey="value" nameKey="name" innerRadius="65%" outerRadius="92%" paddingAngle={2}>
                              {scopeDonutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                            </Pie>
                            <Tooltip formatter={(v: unknown) => [tco2e(+Number(v || 0)), ""]} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="space-y-2.5 flex-1">
                        {scopeDonutData.map((d, i) => (
                          <div key={i} className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color }} /><span>{d.name}</span></div>
                            <span className="font-semibold">{tco2e(d.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Top 10 emitting clients chart */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Top 10 Clients by Emissions</CardTitle></CardHeader>
                <CardContent className="pt-0">
                  {topClientsEmissionsData.length === 0 ? <InsightsEmpty /> : (
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={topClientsEmissionsData} layout="vertical" margin={{ top: 0, right: 8, left: 4, bottom: 0 }}>
                          <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => tco2e(+v)} />
                          <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                          <Tooltip formatter={(v: unknown) => [tco2e(+Number(v || 0)), "Emissions"]} />
                          <Bar dataKey="value" name="Emissions" radius={[0, 4, 4, 0]}>
                            {topClientsEmissionsData.map((_, i) => <Cell key={i} fill={MCKINSEY_DATA_COLORS[i % MCKINSEY_DATA_COLORS.length]} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  {(biPortfolio.top_clients_detail ?? []).length > 0 && (
                    <div className="mt-2 space-y-1">
                      {(biPortfolio.top_clients_detail ?? []).slice(0, 10).map((c, i) => (
                        c.client_id ? (
                          <Link key={c.client_id} href={`/clients/${c.client_id}`} className="flex items-center gap-2 text-xs py-1 px-1 rounded hover:bg-accent/40 transition-colors group">
                            <span className="w-5 text-right text-muted-foreground flex-shrink-0">{i + 1}.</span>
                            <span className="flex-1 truncate text-muted-foreground group-hover:text-foreground">{c.client_name}</span>
                            <span className="font-medium flex-shrink-0">{tco2e(c.emissions)}</span>
                            <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-60 flex-shrink-0" />
                          </Link>
                        ) : (
                          <div key={i} className="flex items-center gap-2 text-xs py-1 px-1">
                            <span className="w-5 text-right text-muted-foreground flex-shrink-0">{i + 1}.</span>
                            <span className="flex-1 truncate text-muted-foreground">{c.client_name}</span>
                            <span className="font-medium flex-shrink-0">{tco2e(c.emissions)}</span>
                          </div>
                        )
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Emissions by geography */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Emissions by Geography</CardTitle></CardHeader>
                <CardContent className="pt-0">
                  {countryChartData.length === 0 ? <InsightsEmpty /> : (
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={countryChartData} layout="vertical" margin={{ top: 0, right: 8, left: 4, bottom: 0 }}>
                          <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => tco2e(+v)} />
                          <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
                          <Tooltip formatter={(v: unknown) => [tco2e(+Number(v || 0)), "Emissions"]} />
                          <Bar dataKey="value" name="Emissions" radius={[0, 4, 4, 0]}>
                            {countryChartData.map((_, i) => <Cell key={i} fill={MCKINSEY_DATA_COLORS[i % MCKINSEY_DATA_COLORS.length]} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* â•â• FINANCIAL â•â• */}
          <TabsContent value="financial" className="space-y-5 pt-3">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <InsightsKpi label="Quote Pipeline"  value={gbp(financialData.metrics.quote_value_total)} sub={`${financialData.metrics.quote_count} quotes`}    accent="blue"   icon={<TrendingUp className="h-4 w-4" />} />
              <InsightsKpi label="Approved"        value={gbp(financialData.metrics.approved_quote_value)}                                                      accent="purple" icon={<CheckCircle2 className="h-4 w-4" />} sub="signed or approved" />
              <InsightsKpi label="Invoiced"        value={gbp(financialData.metrics.invoice_total)} sub={`${financialData.metrics.invoice_count} invoices`}     accent="blue"   icon={<Layers className="h-4 w-4" />} />
              <InsightsKpi label="Paid"            value={gbp(financialData.metrics.paid_total)} sub={`${n(financialData.metrics.cash_realisation_pct)}% realisation`} accent="green" icon={<CheckCircle2 className="h-4 w-4" />} />
              <InsightsKpi label="Outstanding"     value={gbp(financialData.metrics.outstanding_total)} sub={`${financialData.metrics.overdue_invoice_count} overdue`} accent={financialData.metrics.overdue_invoice_count > 0 ? "red" : "orange"} icon={<Clock className="h-4 w-4" />} />
            </div>

            {/* Cash realisation bar */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Cash Realisation</CardTitle></CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center gap-4 mb-2">
                  <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(financialData.metrics.cash_realisation_pct, 100)}%`, backgroundColor: financialData.metrics.cash_realisation_pct >= 80 ? "#16a34a" : financialData.metrics.cash_realisation_pct >= 50 ? "#d97706" : "#dc2626" }} />
                  </div>
                  <span className="text-lg font-semibold w-14 text-right">{n(financialData.metrics.cash_realisation_pct)}%</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Paid: {gbp(financialData.metrics.paid_total)}</span>
                  <span>{hasMixedFinancialCurrencies ? `Multi-currency (${financialCurrencies.join(", ")})` : `Currency: ${financialCurrencies[0] || "GBP"}`}</span>
                  <span>Invoiced: {gbp(financialData.metrics.invoice_total)}</span>
                </div>
              </CardContent>
            </Card>

            {/* Monthly revenue area chart */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Monthly Revenue</CardTitle></CardHeader>
              <CardContent className="pt-0">
                {monthlyChartData.length === 0 ? <InsightsEmpty /> : (
                  <div className="h-[240px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={monthlyChartData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                        <defs>
                          <linearGradient id="gFI" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={MCKINSEY_DATA_COLORS[0]} stopOpacity={0.25} /><stop offset="95%" stopColor={MCKINSEY_DATA_COLORS[0]} stopOpacity={0} /></linearGradient>
                          <linearGradient id="gFP" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#16a34a" stopOpacity={0.25} /><stop offset="95%" stopColor="#16a34a" stopOpacity={0} /></linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.35} />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={v => gbp(+v)} width={68} />
                        <Tooltip formatter={(v: unknown) => [gbp(+Number(v || 0)), ""]} />
                        <Area type="monotone" dataKey="invoiced" name="Invoiced" stroke={MCKINSEY_DATA_COLORS[0]} fill="url(#gFI)" strokeWidth={2} />
                        <Area type="monotone" dataKey="paid"     name="Paid"     stroke="#16a34a"                 fill="url(#gFP)" strokeWidth={2} />
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
                  {quoteDonutData.length === 0 ? <InsightsEmpty /> : (
                    <div className="flex items-center gap-4">
                      <div className="h-[180px] w-[180px] flex-shrink-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={quoteDonutData} dataKey="value" nameKey="name" innerRadius="60%" outerRadius="90%" paddingAngle={2}>
                              {quoteDonutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                            </Pie>
                            <Tooltip formatter={(v: unknown) => [gbp(+Number(v || 0)), ""]} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="space-y-2 flex-1">
                        {quoteDonutData.map((d, i) => (
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
                  {topClientsChartData.length === 0 ? <InsightsEmpty /> : (
                    <div className="h-[200px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={topClientsChartData} layout="vertical" margin={{ top: 0, right: 8, left: 4, bottom: 0 }}>
                          <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => gbp(+v)} />
                          <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                          <Tooltip formatter={(v: unknown) => [gbp(+Number(v || 0)), "Invoiced"]} />
                          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                            {topClientsChartData.map((_, i) => <Cell key={i} fill={MCKINSEY_DATA_COLORS[i % MCKINSEY_DATA_COLORS.length]} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Invoice status breakdown */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Invoice Status Breakdown</CardTitle></CardHeader>
              <CardContent className="pt-0 space-y-2.5">
                {(financialData.invoice_status_breakdown ?? []).length === 0 ? <InsightsEmpty /> :
                  financialData.invoice_status_breakdown.map((row, i) => {
                    const total = financialData.metrics.invoice_total || 1;
                    const pct = (+row.total_value / total) * 100;
                    const isOverdue = row.status.toLowerCase().includes("overdue");
                    return (
                      <div key={i} className="space-y-0.5">
                        <div className="flex justify-between text-xs">
                          <span className={`font-medium ${isOverdue ? "text-red-600" : ""}`}>{row.status}</span>
                          <span className="text-muted-foreground">{gbp(+row.total_value || 0)} Â· {row.count} inv.</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: isOverdue ? "#dc2626" : MCKINSEY_DATA_COLORS[i % MCKINSEY_DATA_COLORS.length] }} />
                        </div>
                      </div>
                    );
                  })}
              </CardContent>
            </Card>
          </TabsContent>

          {/* â•â• OPERATIONS â•â• */}
          <TabsContent value="operations" className="space-y-5 pt-3">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <InsightsKpi label="Active Jobs"    value={operationsData.metrics.active_jobs}                                                                               icon={<Briefcase className="h-4 w-4" />}     accent="blue"   />
              <InsightsKpi label="On Track"       value={operationsData.metrics.healthy_jobs}                                                                              icon={<CheckCircle2 className="h-4 w-4" />}  accent="green"  sub="green milestone" />
              <InsightsKpi label="Due Soon"       value={operationsData.metrics.due_soon_jobs}                                                                             icon={<AlertTriangle className="h-4 w-4" />} accent="amber"  sub="within 7 days" />
              <InsightsKpi label="Overdue"        value={operationsData.metrics.overdue_jobs}                                                                              icon={<Flame className="h-4 w-4" />}         accent="red"    />
              <InsightsKpi label="Utilisation"    value={operationsData.metrics.utilisation_pct != null ? `${n(operationsData.metrics.utilisation_pct)}%` : "â€”"}          icon={<TrendingUp className="h-4 w-4" />}    accent="purple" sub={`${hrs(operationsData.metrics.time_logged_hours)} logged`} />
              <InsightsKpi label="Due in 30 days" value={operationsData.metrics.upcoming_milestones_30d}                                                                   icon={<Clock className="h-4 w-4" />}         accent="orange" sub="milestones" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Milestone health donut */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Milestone Health</CardTitle></CardHeader>
                <CardContent className="pt-0">
                  {opsMilestoneDonutData.length === 0 ? <InsightsEmpty /> : (
                    <div className="flex items-center gap-4">
                      <div className="relative h-[180px] w-[180px] flex-shrink-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={opsMilestoneDonutData} dataKey="value" nameKey="name" innerRadius="65%" outerRadius="92%" paddingAngle={2}>
                              {opsMilestoneDonutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                            </Pie>
                            <Tooltip />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="text-center"><div className="text-xl font-bold">{operationsData.metrics.active_jobs}</div><div className="text-[10px] text-muted-foreground">jobs</div></div>
                        </div>
                      </div>
                      <div className="space-y-2.5 flex-1">
                        {opsMilestoneDonutData.map((d, i) => (
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

              {/* Time by subject bar */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Time by Subject</CardTitle></CardHeader>
                <CardContent className="pt-0">
                  {timeSubjectChartData.length === 0 ? <InsightsEmpty /> : (
                    <div className="h-[200px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={timeSubjectChartData} layout="vertical" margin={{ top: 0, right: 8, left: 4, bottom: 0 }}>
                          <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`} />
                          <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={130} />
                          <Tooltip formatter={(v: unknown) => [`${n(+Number(v || 0))}h`, "Hours"]} />
                          <Bar dataKey="hours" radius={[0, 4, 4, 0]}>
                            {timeSubjectChartData.map((_, i) => <Cell key={i} fill={MCKINSEY_ACTIVITY_COLORS[i % MCKINSEY_ACTIVITY_COLORS.length]} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* CRM workload table */}
            {operationsData.crm_workload.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">CRM Utilisation</CardTitle></CardHeader>
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
                      </tr>
                    </thead>
                    <tbody>
                      {operationsData.crm_workload.map(c => {
                        const t = c.total_jobs || 1;
                        const gp = (c.green_jobs / t) * 100;
                        const ap = (c.amber_jobs / t) * 100;
                        const rp = (c.red_jobs   / t) * 100;
                        const u  = c.utilisation_pct;
                        return (
                          <tr key={c.crm_name} className="border-b last:border-0">
                            <td className="py-2.5 font-medium">{c.crm_name || "Unassigned"}</td>
                            <td className="text-right py-2.5 text-muted-foreground">{c.total_jobs}</td>
                            <td className="py-2.5 px-3">
                              <div className="h-2 rounded-full overflow-hidden bg-muted flex">
                                {gp > 0 && <div style={{ width: `${gp}%`, backgroundColor: MS_COLORS.green }} />}
                                {ap > 0 && <div style={{ width: `${ap}%`, backgroundColor: MS_COLORS.amber }} />}
                                {rp > 0 && <div style={{ width: `${rp}%`, backgroundColor: MS_COLORS.red }} />}
                              </div>
                              <div className="flex justify-between mt-0.5 text-[10px]">
                                <span className="text-green-600">{c.green_jobs} âœ“</span>
                                <span className="text-amber-600">{c.amber_jobs} âš </span>
                                <span className="text-red-600">{c.red_jobs} âœ—</span>
                              </div>
                            </td>
                            <td className="text-right py-2.5 text-muted-foreground">{hrs(c.logged_hours)}</td>
                            <td className="text-right py-2.5 text-muted-foreground">{c.estimated_hours > 0 ? hrs(c.estimated_hours) : "â€”"}</td>
                            <td className={`text-right py-2.5 font-semibold ${u == null ? "text-muted-foreground" : u > 100 ? "text-red-600" : u > 85 ? "text-amber-600" : "text-green-600"}`}>{u != null ? `${n(u)}%` : "â€”"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}

            {/* Jobs needing attention */}
            {operationsData.jobs_needing_attention.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    Jobs Needing Attention
                    <Badge variant="destructive" className="text-[10px] h-5 px-1.5 ml-0.5">{operationsData.jobs_needing_attention.length}</Badge>
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
                      {operationsData.jobs_needing_attention.map(job => (
                        <tr key={job.job_id} className="border-b last:border-0 hover:bg-accent/40 transition-colors">
                          <td className="py-2.5 pr-2"><div className={`w-2.5 h-2.5 rounded-full ${milestoneDotClass(job.milestone_status)}`} /></td>
                          <td className="py-2.5">
                            <Link href={`/jobs/${job.job_id}`} className="hover:underline flex items-center gap-1 group font-medium">
                              <span className="text-muted-foreground text-xs">{job.job_number}</span>
                              <span className="truncate max-w-[150px]">{job.title ?? `Job ${job.job_id}`}</span>
                              <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-60 flex-shrink-0" />
                            </Link>
                          </td>
                          <td className="py-2.5 text-muted-foreground text-xs truncate max-w-[110px]">{job.client_name ?? "â€”"}</td>
                          <td className="py-2.5 text-muted-foreground text-xs">{job.crm_name ?? "â€”"}</td>
                          <td className="py-2.5 text-xs">
                            <div className="text-muted-foreground capitalize">{job.next_due_name?.replace(/_/g, " ") ?? "â€”"}</div>
                            <div className="font-medium">{job.next_due_date ? formatDate(job.next_due_date) : "â€”"}</div>
                          </td>
                          <td className={`py-2.5 text-right font-semibold text-sm ${job.days_to_next_due == null ? "text-muted-foreground" : job.days_to_next_due < 0 ? "text-red-600" : job.days_to_next_due <= 7 ? "text-amber-600" : "text-foreground"}`}>
                            {job.days_to_next_due != null ? (job.days_to_next_due < 0 ? `${Math.abs(job.days_to_next_due)}d late` : `${job.days_to_next_due}d`) : "â€”"}
                          </td>
                          <td className="py-2.5 pl-3">
                            <div className="flex flex-wrap gap-1">
                              {(job.reason ?? "").split(",").map(r => r.trim()).filter(Boolean).map(r => (
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
          </TabsContent>

          {/* â•â• REPORTS â•â• */}
          <TabsContent value="reports" className="space-y-5 pt-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Saved Reports</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-[1.4fr_auto_auto] md:items-end">
                  <div className="space-y-2">
                    <div className="text-sm text-muted-foreground">Saved report name</div>
                    <Input
                      value={savedReportName}
                      onChange={(event) => setSavedReportName(event.target.value)}
                      placeholder="e.g. Q2 Quote Pipeline - Chris"
                    />
                  </div>
                  <Button onClick={() => void saveCurrentReport()} disabled={savingReport}>
                    Save New
                  </Button>
                  <Button variant="outline" onClick={() => void updateSelectedReport()} disabled={!selectedSavedReportId || savingReport}>
                    Update Selected
                  </Button>
                </div>

                <div className="rounded border bg-muted/20 p-3 text-sm text-muted-foreground">
                  <div className="font-medium text-foreground">Current report</div>
                  <div className="mt-1">{currentReportSummary}</div>
                  {selectedSavedReport ? (
                    <div className="mt-2 text-xs">
                      Selected for update: <span className="font-medium text-foreground">{selectedSavedReport.name}</span>
                    </div>
                  ) : null}
                </div>

                {savedReportsError ? <div className="text-sm text-red-600">{savedReportsError}</div> : null}

                {savedReportsLoading ? (
                  <div className="text-sm text-muted-foreground">Loading saved reports...</div>
                ) : savedReports.length > 0 ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    {savedReports.map((report) => {
                      const isSelected = selectedSavedReportId === report.saved_report_id;
                      const isCurrent = matchingSavedReportId === report.saved_report_id;
                      return (
                        <div
                          key={report.saved_report_id}
                          className={`rounded border p-4 ${isSelected ? "border-[#f26624] bg-orange-50" : ""}`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <div className="text-sm font-medium">{report.name}</div>
                              <div className="mt-1 text-xs text-muted-foreground">{reportFilterSummary(report)}</div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {isSelected ? (
                                <span className="rounded-full bg-white px-2 py-1 text-xs font-medium text-[#f26624]">Selected</span>
                              ) : null}
                              {isCurrent ? (
                                <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">Current</span>
                              ) : null}
                            </div>
                          </div>
                          <div className="mt-3 text-xs text-muted-foreground">
                            Updated {formatDate(report.updated_at || report.created_at)}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => applySavedReport(report)}
                            >
                              Load
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setSelectedSavedReportId(report.saved_report_id);
                                setSavedReportName(report.name);
                              }}
                            >
                              Select
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-600 hover:text-red-700"
                              onClick={() => void deleteSavedReport(report)}
                              disabled={savingReport}
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    No saved reports yet. Save the current report and filters to reuse them later.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Starter Views</CardTitle></CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-3">
                {REPORT_PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => setReportView(preset.key)}
                    className={`rounded border p-4 text-left transition-colors ${reportView === preset.key ? "border-[#f26624] bg-orange-50" : "hover:bg-muted/40"}`}
                  >
                    <div className="text-sm font-medium">{preset.label}</div>
                    <div className="mt-2 text-sm text-muted-foreground">{preset.description}</div>
                  </button>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Report Builder</CardTitle></CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-[1fr_auto_auto] md:items-end">
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground">Report View</div>
                  <Select value={reportView} onValueChange={setReportView}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select report..." />
                    </SelectTrigger>
                    <SelectContent>
                      {REPORT_PRESETS.map((preset) => (
                        <SelectItem key={preset.key} value={preset.key}>
                          {preset.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="outline" onClick={() => void loadInsights()}>
                  Refresh Report
                </Button>
                <Button variant="secondary" onClick={() => void exportReportCsv()}>
                  Export CSV
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">{reportData.title || "Report"}</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
                  <span>{reportData.description || "Reusable filtered report view for export and drilldown."}</span>
                  <span>
                    Showing {visibleReportRows.length} of {reportData.row_count} rows
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>Click a slice or bar to drill the table below.</span>
                  {reportDrill ? (
                    <>
                      <span className="rounded-full bg-orange-50 px-3 py-1 font-medium text-[#f26624]">
                        Drill: {reportDrill.label} = {reportDrill.value}
                      </span>
                      <button
                        type="button"
                        onClick={() => setReportDrill(null)}
                        className="rounded border px-3 py-1 font-medium text-foreground transition-colors hover:bg-muted/40"
                      >
                        Clear drill
                      </button>
                    </>
                  ) : null}
                </div>
                {reportData.rows.length > 0 ? (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <Card className="border-dashed">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base">Breakdown by {reportChartConfig.breakdownLabel}</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {reportBreakdownData.length > 0 ? (
                          <>
                            <div className="h-[260px]">
                              <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                  <Pie
                                    data={reportBreakdownData}
                                    dataKey="value"
                                    nameKey="label"
                                    innerRadius={56}
                                    outerRadius={92}
                                    paddingAngle={2}
                                    onClick={(entry) => {
                                      const drillValue = extractChartDrillValue(entry);
                                      if (drillValue) {
                                        toggleReportDrill(reportChartConfig.breakdownKey, reportChartConfig.breakdownLabel, drillValue);
                                      }
                                    }}
                                  >
                                    {reportBreakdownData.map((entry, index) => {
                                      const isActive =
                                        !reportDrill ||
                                        reportDrill.key !== reportChartConfig.breakdownKey ||
                                        reportDrill.value === entry.drillValue;
                                      return (
                                        <Cell
                                          key={`report-breakdown-${entry.label}`}
                                          fill={REPORT_CHART_COLORS[index % REPORT_CHART_COLORS.length]}
                                          opacity={isActive ? 1 : 0.45}
                                          className="cursor-pointer"
                                        />
                                      );
                                    })}
                                  </Pie>
                                  <Tooltip
                                    formatter={(value) =>
                                      formatMetricValue(reportChartConfig.breakdownValueKey ?? "__count", Number(value || 0))
                                    }
                                  />
                                </PieChart>
                              </ResponsiveContainer>
                            </div>
                            <div className="space-y-2">
                              {reportBreakdownData.map((entry, index) => (
                                <button
                                  key={`report-breakdown-row-${entry.label}`}
                                  type="button"
                                  onClick={() =>
                                    toggleReportDrill(reportChartConfig.breakdownKey, reportChartConfig.breakdownLabel, entry.drillValue)
                                  }
                                  className="flex w-full items-center justify-between rounded border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/40"
                                >
                                  <span className="flex items-center gap-2">
                                    <span
                                      className="inline-block h-2.5 w-2.5 rounded-full"
                                      style={{ backgroundColor: REPORT_CHART_COLORS[index % REPORT_CHART_COLORS.length] }}
                                    />
                                    {entry.label}
                                  </span>
                                  <span className="font-medium">
                                    {formatMetricValue(reportChartConfig.breakdownValueKey ?? "__count", entry.value)}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </>
                        ) : (
                          <div className="text-sm text-muted-foreground">No breakdown data is available for the current report selection.</div>
                        )}
                      </CardContent>
                    </Card>

                    <Card className="border-dashed">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base">Top {reportChartConfig.topMetricLabel}</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {reportTopData.length > 0 ? (
                          <>
                            <div className="h-[260px]">
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={reportTopData} margin={{ top: 8, right: 12, bottom: 28, left: 12 }}>
                                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                                  <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} angle={-20} textAnchor="end" height={60} />
                                  <YAxis tickLine={false} axisLine={false} width={72} />
                                  <Tooltip formatter={(value) => formatMetricValue(reportChartConfig.topValueKey, Number(value || 0))} />
                                  <Bar
                                    dataKey="value"
                                    radius={[6, 6, 0, 0]}
                                    onClick={(entry) => {
                                      const drillValue = extractChartDrillValue(entry);
                                      if (drillValue) {
                                        toggleReportDrill(reportChartConfig.topKey, reportChartConfig.topLabel, drillValue);
                                      }
                                    }}
                                  >
                                    {reportTopData.map((entry, index) => {
                                      const isActive =
                                        !reportDrill ||
                                        reportDrill.key !== reportChartConfig.topKey ||
                                        reportDrill.value === entry.drillValue;
                                      return (
                                        <Cell
                                          key={`report-top-${entry.label}`}
                                          fill={REPORT_CHART_COLORS[index % REPORT_CHART_COLORS.length]}
                                          opacity={isActive ? 0.95 : 0.45}
                                          className="cursor-pointer"
                                        />
                                      );
                                    })}
                                  </Bar>
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                            <div className="space-y-2">
                              {reportTopData.map((entry) => (
                                <button
                                  key={`report-top-row-${entry.label}`}
                                  type="button"
                                  onClick={() => toggleReportDrill(reportChartConfig.topKey, reportChartConfig.topLabel, entry.drillValue)}
                                  className="flex w-full items-center justify-between rounded border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/40"
                                >
                                  <span>{entry.label}</span>
                                  <span className="font-medium">{formatMetricValue(reportChartConfig.topValueKey, entry.value)}</span>
                                </button>
                              ))}
                            </div>
                          </>
                        ) : (
                          <div className="text-sm text-muted-foreground">No ranking data is available for the current report selection.</div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                ) : null}
                {reportData.columns.length > 0 ? (
                  <div className="overflow-x-auto rounded border">
                    <table className="min-w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          {reportData.columns.map((column) => (
                            <th key={column.key} className="px-3 py-2 text-left font-medium">
                              {column.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleReportRows.length > 0 ? (
                          visibleReportRows.map((row, index) => {
                            const href = reportRowHref(row);
                            return (
                              <tr key={`report-row-${index}`} className="border-t align-top">
                                {reportData.columns.map((column) => {
                                  const value = formatReportValue(column.key, row[column.key]);
                                  return (
                                    <td key={`${index}-${column.key}`} className="px-3 py-2 text-muted-foreground">
                                      {href && column === reportData.columns[0] ? (
                                        <Link href={href} className="font-medium text-foreground hover:underline">
                                          {value}
                                        </Link>
                                      ) : (
                                        value
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={reportData.columns.length} className="px-3 py-6 text-center text-muted-foreground">
                              No rows match the current report filters.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">Report columns will appear here once the report loads.</div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
    </div>
  );
}

// â”€â”€â”€ Sub-components â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function InsightsKpi({ label, value, sub, icon, accent = "blue" }: { label: string; value: string | number; sub?: string; icon?: React.ReactNode; accent?: string }) {
  const s = ACCENT[accent] ?? ACCENT.blue;
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

function InsightsPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`text-xs px-3 py-1 rounded-full border transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary hover:text-foreground"}`}>
      {children}
    </button>
  );
}

function InsightsEmpty() {
  return <div className="py-10 text-center text-sm text-muted-foreground">No data available</div>;
}
