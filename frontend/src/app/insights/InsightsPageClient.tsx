"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

const REPORT_CHART_COLORS = ["#1c5026", "#f26624", "#0f766e", "#2563eb", "#f59e0b", "#7c3aed", "#db2777", "#475569"];

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
    breakdownMetricLabel: "tCO2e",
    topKey: "client_name",
    topLabel: "Client",
    topValueKey: "total_emissions",
    topMetricLabel: "tCO2e",
  },
};

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
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [jobsStatus, setJobsStatus] = useState<JobsMilestoneStatus>(EMPTY_JOBS_STATUS);
  const [financialData, setFinancialData] = useState<FinancialOverview>(EMPTY_FINANCIAL);
  const [operationsData, setOperationsData] = useState<OperationsOverview>(EMPTY_OPERATIONS);
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

  const loadInsights = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (selectedYear) params.set("year", String(selectedYear));
      if (selectedIndustry) params.set("industry", selectedIndustry);
      if (selectedCrm) params.set("crm_owner", selectedCrm);

      params.set("limit", "100");
      const requestTimeoutMs = 60000;

      const requestInit: RequestInit = {
        credentials: "include",
        cache: "no-store",
      };

      const [overviewRes, jobsStatusRes, financialRes, operationsRes, reportRes] = await Promise.allSettled([
        fetchJsonWithTimeout(`${baseUrl}/dashboard/overview${params.toString() ? `?${params.toString()}` : ""}`, requestInit, requestTimeoutMs, "Insights overview"),
        fetchJsonWithTimeout(`${baseUrl}/dashboard/jobs-by-milestone-status`, requestInit, requestTimeoutMs, "Jobs milestone status"),
        fetchJsonWithTimeout(`${baseUrl}/dashboard/financial-overview${params.toString() ? `?${params.toString()}` : ""}`, requestInit, requestTimeoutMs, "Financial overview"),
        fetchJsonWithTimeout(`${baseUrl}/dashboard/operations-overview${params.toString() ? `?${params.toString()}` : ""}`, requestInit, requestTimeoutMs, "Operations overview"),
        fetchJsonWithTimeout(`${baseUrl}/dashboard/report-view?view=${encodeURIComponent(reportView)}${params.toString() ? `&${params.toString()}` : ""}`, requestInit, requestTimeoutMs, "Report view"),
      ]);

      if (overviewRes.status !== "fulfilled") {
        throw new Error((overviewRes.reason as Error)?.message || "Insights overview failed");
      }

      if (!overviewRes.value.ok) {
        throw new Error(`Insights overview failed (${overviewRes.value.status})`);
      }

      const overviewJson = (await overviewRes.value.json()) as DashboardOverview;
      setData(overviewJson);
      if (!selectedYear && overviewJson.selected_year) {
        setSelectedYear(Number(overviewJson.selected_year));
      }

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

      if (reportRes.status === "fulfilled" && reportRes.value.ok) {
        const reportJson = (await reportRes.value.json()) as ReportViewData;
        setReportData(reportJson);
      } else {
        setReportData(EMPTY_REPORT);
      }
    } catch (e) {
      setError((e as Error).message);
      setData(null);
      setJobsStatus(EMPTY_JOBS_STATUS);
      setFinancialData(EMPTY_FINANCIAL);
      setOperationsData(EMPTY_OPERATIONS);
      setReportData(EMPTY_REPORT);
    } finally {
      setLoading(false);
    }
  }, [baseUrl, fetchJsonWithTimeout, reportView, selectedCrm, selectedIndustry, selectedYear]);

  useEffect(() => {
    void loadInsights();
  }, [loadInsights]);

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

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto w-full max-w-7xl px-6 py-10 text-sm text-muted-foreground">Loading insights...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <PageHeader
          title="Insights"
          subtitle={overviewSubtitle(data)}
          breadcrumbs={[{ label: "Insights" }]}
          actions={
            <>
              <Button variant="outline" onClick={() => void loadInsights()}>
                Refresh
              </Button>
              <Button variant="secondary" asChild>
                <Link href="/">Back to Hub</Link>
              </Button>
            </>
          }
        />

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Filters</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Reporting Year</div>
              <Select value={selectedYear ? String(selectedYear) : ALL_FILTER_VALUE} onValueChange={(value) => setSelectedYear(value === ALL_FILTER_VALUE ? null : Number(value))}>
                <SelectTrigger>
                  <SelectValue placeholder="All years" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>All years</SelectItem>
                  {(data?.available_years || []).map((year) => (
                    <SelectItem key={year} value={String(year)}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Industry</div>
              <Select value={selectedIndustry ?? ALL_FILTER_VALUE} onValueChange={(value) => setSelectedIndustry(value === ALL_FILTER_VALUE ? null : value)}>
                <SelectTrigger>
                  <SelectValue placeholder="All industries" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>All industries</SelectItem>
                  {(data?.available_industries || []).map((industry) => (
                    <SelectItem key={industry} value={industry}>
                      {industry}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Client Owner</div>
              <Select value={selectedCrm ?? ALL_FILTER_VALUE} onValueChange={(value) => setSelectedCrm(value === ALL_FILTER_VALUE ? null : value)}>
                <SelectTrigger>
                  <SelectValue placeholder="All client owners" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>All client owners</SelectItem>
                  {teamMembers.map((member) => (
                    <SelectItem key={member.email || member.full_name} value={member.full_name || member.email}>
                      {member.full_name || member.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {error ? (
          <Card className="mb-6 border-red-200">
            <CardContent className="pt-6 text-sm text-red-600">{error}</CardContent>
          </Card>
        ) : null}

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="flex h-auto flex-wrap justify-start">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="clients">Clients</TabsTrigger>
            <TabsTrigger value="jobs">Jobs</TabsTrigger>
            <TabsTrigger value="financial">Financial</TabsTrigger>
            <TabsTrigger value="operations">Operations</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Clients</div>
                  <div className="mt-2 text-3xl font-semibold">{data?.metrics.total_clients ?? 0}</div>
                  <div className="mt-1 text-xs text-muted-foreground">Portfolio in current filter</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">Emissions</div>
                    {data?.metrics.yoy_change !== null && data?.metrics.yoy_change !== undefined ? (
                      <div className={`text-xs font-medium ${Number(data.metrics.yoy_change) > 0 ? "text-red-600" : "text-emerald-600"}`}>
                        {Number(data.metrics.yoy_change) > 0 ? "+" : ""}
                        {Number(data.metrics.yoy_change).toFixed(1)}%
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-2 text-3xl font-semibold">{formatNumber(data?.metrics.total_emissions ?? 0)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">tCO2e in selected year</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Active Jobs</div>
                  <div className="mt-2 text-3xl font-semibold">{data?.metrics.active_jobs ?? 0}</div>
                  <div className="mt-1 text-xs text-muted-foreground">Live delivery workload</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Total Jobs</div>
                  <div className="mt-2 text-3xl font-semibold">{totalJobs}</div>
                  <div className="mt-1 text-xs text-muted-foreground">All statuses in view</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Delivery Risk</div>
                  <div className="mt-2 text-3xl font-semibold">{jobsStatus.red}</div>
                  <div className="mt-1 text-xs text-muted-foreground">Jobs with overdue milestones</div>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Emissions Trend</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(data?.year_trend || []).length > 0 ? (
                    (data?.year_trend || []).map((row) => (
                      <div key={`trend-${row.year ?? "na"}`} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span>{row.year ?? "Unknown"}</span>
                          <span className="font-medium">{formatNumber(row.total_emissions)} tCO2e</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted">
                          <div
                            className="h-2 rounded-full bg-[#1c5026]"
                            style={{
                              width: `${Math.max(
                                8,
                                ((Number(row.total_emissions || 0) / Math.max(...(data?.year_trend || []).map((item) => Number(item.total_emissions || 0)), 1)) * 100)
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-muted-foreground">No emissions trend data yet.</div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Milestone Health</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2">
                  <div className="rounded border p-4">
                    <div className="text-xs text-muted-foreground">Healthy</div>
                    <div className="mt-1 text-2xl font-semibold">{jobsStatus.green}</div>
                  </div>
                  <div className="rounded border p-4">
                    <div className="text-xs text-muted-foreground">Due Soon</div>
                    <div className="mt-1 text-2xl font-semibold">{jobsStatus.amber}</div>
                  </div>
                  <div className="rounded border p-4">
                    <div className="text-xs text-muted-foreground">Overdue</div>
                    <div className="mt-1 text-2xl font-semibold">{jobsStatus.red}</div>
                  </div>
                  <div className="rounded border p-4">
                    <div className="text-xs text-muted-foreground">No Milestones</div>
                    <div className="mt-1 text-2xl font-semibold">{jobsStatus.no_milestones}</div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="clients" className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Industry Mix</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(data?.industry_breakdown || []).length > 0 ? (
                    (data?.industry_breakdown || []).slice(0, 10).map((row) => (
                      <div key={`industry-${row.industry}`} className="flex items-center justify-between rounded border p-3 text-sm">
                        <span>{row.industry || "Unspecified"}</span>
                        <span className="font-medium">{row.client_count}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-muted-foreground">No client industry mix available yet.</div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Top Emitting Clients</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(data?.top_emitting_clients || []).length > 0 ? (
                    (data?.top_emitting_clients || []).map((row) => (
                      <Link
                        key={`client-${row.client_id}`}
                        href={`/clients/${row.client_id}`}
                        className="flex items-center justify-between rounded border p-3 text-sm transition-colors hover:bg-muted/40"
                      >
                        <span>{row.client_name || "Unknown client"}</span>
                        <span className="font-medium">{formatNumber(row.emissions)} tCO2e</span>
                      </Link>
                    ))
                  ) : (
                    <div className="text-sm text-muted-foreground">Top client emissions will appear as jobs and scope data build out.</div>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Client Intelligence Themes</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-3">
                <div className="rounded border p-4">
                  <div className="text-sm font-medium">Portfolio Mix</div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    Industry concentration, client ownership, benchmark coverage, and client growth patterns.
                  </div>
                </div>
                <div className="rounded border p-4">
                  <div className="text-sm font-medium">Retention & Renewals</div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    Upcoming renewals, dormant clients, repeat job patterns, and account risk indicators.
                  </div>
                </div>
                <div className="rounded border p-4">
                  <div className="text-sm font-medium">Client Drilldown</div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    From portfolio view to individual client records, reporting history, and emissions performance.
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="jobs" className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Job Status Breakdown</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(data?.job_status_breakdown || []).length > 0 ? (
                    (data?.job_status_breakdown || []).map((row) => (
                      <div key={`status-${row.status}`} className="flex items-center justify-between rounded border p-3 text-sm">
                        <span>{row.status || "Unknown"}</span>
                        <span className="font-medium">{row.count}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-muted-foreground">No job status data available yet.</div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Jobs By CRM</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(data?.jobs_per_crm || []).length > 0 ? (
                    (data?.jobs_per_crm || []).map((row) => (
                      <div key={`crm-${row.crm_name}`} className="rounded border p-3">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">{row.crm_name || "Unassigned"}</span>
                          <span>{row.total_jobs} jobs</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {Object.entries(row.statuses || {}).map(([status, count]) => (
                            <span key={`${row.crm_name}-${status}`} className={`rounded-full px-2 py-1 text-xs ${toneForStatus(status)}`}>
                              {status}: {count}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-muted-foreground">CRM workload will appear here as jobs are created.</div>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Recent Job Activity</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(data?.recent_activity || []).length > 0 ? (
                  (data?.recent_activity || []).map((row) => (
                    <Link
                      key={`job-${row.job_id}`}
                      href={`/jobs/${row.job_id}`}
                      className="grid gap-2 rounded border p-3 text-sm transition-colors hover:bg-muted/40 md:grid-cols-[1.2fr_1fr_0.7fr_0.8fr_0.8fr]"
                    >
                      <div>
                        <div className="font-medium">{row.title || `Job ${row.job_id}`}</div>
                        <div className="text-xs text-muted-foreground">{row.client_name || "Unknown client"}</div>
                      </div>
                      <div className="text-muted-foreground">{row.reporting_year || "-"}</div>
                      <div>
                        <span className={`rounded-full px-2 py-1 text-xs ${toneForStatus(row.status || "")}`}>
                          {row.status || "Unknown"}
                        </span>
                      </div>
                      <div className="text-muted-foreground">{formatDate(row.start_date)}</div>
                      <div className="text-muted-foreground">{row.milestone_status || "-"}</div>
                    </Link>
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground">Recent job activity will appear here as delivery work expands.</div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="financial" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Quote Value</div>
                  <div className="mt-2 text-3xl font-semibold">{formatMoney(financialData.metrics.quote_value_total)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{financialData.metrics.quote_count} quotes in view</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Approved Quotes</div>
                  <div className="mt-2 text-3xl font-semibold">{formatMoney(financialData.metrics.approved_quote_value)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">Approved or signed quote value</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Invoiced</div>
                  <div className="mt-2 text-3xl font-semibold">{formatMoney(financialData.metrics.invoice_total)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{financialData.metrics.invoice_count} invoices in view</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Paid</div>
                  <div className="mt-2 text-3xl font-semibold">{formatMoney(financialData.metrics.paid_total)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{financialData.metrics.cash_realisation_pct.toFixed(1)}% cash realisation</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Outstanding</div>
                  <div className="mt-2 text-3xl font-semibold">{formatMoney(financialData.metrics.outstanding_total)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{financialData.metrics.overdue_invoice_count} overdue invoices</div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Financial Context</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-[1.5fr_1fr_1fr]">
                <div className="rounded border p-4 text-sm text-muted-foreground">
                  {hasMixedFinancialCurrencies
                    ? `The current filters include multiple currencies (${financialCurrencies.join(", ")}), so totals are portfolio totals from stored values rather than FX-normalised reporting.`
                    : `Financial totals are currently shown in ${financialCurrencies[0] || "GBP"} for the selected portfolio filters.`}
                </div>
                <div className="rounded border p-4">
                  <div className="text-xs text-muted-foreground">Quote Conversion</div>
                  <div className="mt-1 text-2xl font-semibold">
                    {financialData.metrics.quote_value_total > 0
                      ? `${((financialData.metrics.invoice_total / financialData.metrics.quote_value_total) * 100).toFixed(1)}%`
                      : "0.0%"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">Invoiced as a share of quoted value</div>
                </div>
                <div className="rounded border p-4">
                  <div className="text-xs text-muted-foreground">Collections Risk</div>
                  <div className="mt-1 text-2xl font-semibold">{financialData.metrics.overdue_invoice_count}</div>
                  <div className="mt-1 text-xs text-muted-foreground">Invoices overdue and still unpaid</div>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Monthly Quotes</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {quoteMonths.length > 0 ? (
                    quoteMonths.map((row) => (
                      <div key={`quote-month-${row.month}`} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span>{row.month}</span>
                          <span className="font-medium">
                            {formatMoney(row.total_value)} · {row.count} quotes
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-muted">
                          <div
                            className="h-2 rounded-full bg-[#f26624]"
                            style={{ width: `${Math.max(8, (Number(row.total_value || 0) / maxQuoteMonthValue) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-muted-foreground">Quote activity will appear here once quotes are created.</div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Monthly Invoices</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {invoiceMonths.length > 0 ? (
                    invoiceMonths.map((row) => (
                      <div key={`invoice-month-${row.month}`} className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span>{row.month}</span>
                          <span className="font-medium">
                            {formatMoney(row.total_value)} invoiced · {formatMoney(row.paid_total)} paid
                          </span>
                        </div>
                        <div className="space-y-1">
                          <div className="h-2 rounded-full bg-muted">
                            <div
                              className="h-2 rounded-full bg-[#1c5026]"
                              style={{ width: `${Math.max(8, (Number(row.total_value || 0) / maxInvoiceMonthValue) * 100)}%` }}
                            />
                          </div>
                          <div className="h-2 rounded-full bg-muted">
                            <div
                              className="h-2 rounded-full bg-emerald-500"
                              style={{ width: `${Math.max(8, (Number(row.paid_total || 0) / maxInvoiceMonthValue) * 100)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-muted-foreground">Invoice activity will appear here once invoices are raised.</div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Quote Status Breakdown</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(financialData.quote_status_breakdown || []).length > 0 ? (
                    financialData.quote_status_breakdown.map((row) => (
                      <div key={`quote-status-${row.status}`} className="flex items-center justify-between rounded border p-3 text-sm">
                        <span>{row.status || "Unknown"}</span>
                        <span className="font-medium">
                          {row.count} · {formatMoney(row.total_value)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-muted-foreground">No quote breakdown is available yet.</div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Invoice Status Breakdown</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(financialData.invoice_status_breakdown || []).length > 0 ? (
                    financialData.invoice_status_breakdown.map((row) => (
                      <div key={`invoice-status-${row.status}`} className="flex items-center justify-between rounded border p-3 text-sm">
                        <span>{row.status || "Unknown"}</span>
                        <span className="font-medium">
                          {row.count} · {formatMoney(row.total_value)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-muted-foreground">No invoice breakdown is available yet.</div>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Top Clients By Invoiced Value</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(financialData.top_clients_by_invoiced_total || []).length > 0 ? (
                  financialData.top_clients_by_invoiced_total.map((row) =>
                    row.client_id ? (
                      <Link
                        key={`financial-client-${row.client_id}`}
                        href={`/clients/${row.client_id}`}
                        className="grid gap-2 rounded border p-3 text-sm transition-colors hover:bg-muted/40 md:grid-cols-[1.3fr_0.8fr_0.8fr_0.8fr]"
                      >
                        <div className="font-medium">{row.client_name || "Unknown client"}</div>
                        <div className="text-muted-foreground">Invoiced {formatMoney(row.invoice_total)}</div>
                        <div className="text-muted-foreground">Paid {formatMoney(row.paid_total)}</div>
                        <div className="text-muted-foreground">Outstanding {formatMoney(row.outstanding_total)}</div>
                      </Link>
                    ) : (
                      <div
                        key={`financial-client-${row.client_name}`}
                        className="grid gap-2 rounded border p-3 text-sm md:grid-cols-[1.3fr_0.8fr_0.8fr_0.8fr]"
                      >
                        <div className="font-medium">{row.client_name || "Unknown client"}</div>
                        <div className="text-muted-foreground">Invoiced {formatMoney(row.invoice_total)}</div>
                        <div className="text-muted-foreground">Paid {formatMoney(row.paid_total)}</div>
                        <div className="text-muted-foreground">Outstanding {formatMoney(row.outstanding_total)}</div>
                      </div>
                    )
                  )
                ) : (
                  <div className="text-sm text-muted-foreground">
                    Top clients by invoiced value will appear here as finance records are added.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="operations" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Active Jobs</div>
                  <div className="mt-2 text-3xl font-semibold">{operationsData.metrics.active_jobs}</div>
                  <div className="mt-1 text-xs text-muted-foreground">Delivery workload in scope</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Overdue Jobs</div>
                  <div className="mt-2 text-3xl font-semibold">{operationsData.metrics.overdue_jobs}</div>
                  <div className="mt-1 text-xs text-muted-foreground">Jobs with overdue milestones</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Due Soon</div>
                  <div className="mt-2 text-3xl font-semibold">{operationsData.metrics.due_soon_jobs}</div>
                  <div className="mt-1 text-xs text-muted-foreground">Jobs at amber milestone risk</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Hours Logged</div>
                  <div className="mt-2 text-3xl font-semibold">{formatNumber(operationsData.metrics.time_logged_hours, 1)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">Tracked delivery effort</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Utilisation</div>
                  <div className="mt-2 text-3xl font-semibold">{operationsData.metrics.utilisation_pct.toFixed(1)}%</div>
                  <div className="mt-1 text-xs text-muted-foreground">Logged hours vs estimate</div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Delivery Context</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
                <div className="rounded border p-4 text-sm text-muted-foreground">
                  This slice combines milestone plans and tracked time so we can see deadline pressure, effort burn, and where delivery management attention is needed most.
                </div>
                <div className="rounded border p-4">
                  <div className="text-xs text-muted-foreground">Healthy Jobs</div>
                  <div className="mt-1 text-2xl font-semibold">{operationsData.metrics.healthy_jobs}</div>
                  <div className="mt-1 text-xs text-muted-foreground">Jobs currently on track</div>
                </div>
                <div className="rounded border p-4">
                  <div className="text-xs text-muted-foreground">Upcoming Milestones</div>
                  <div className="mt-1 text-2xl font-semibold">{operationsData.metrics.upcoming_milestones_30d}</div>
                  <div className="mt-1 text-xs text-muted-foreground">Incomplete due within 30 days</div>
                </div>
                <div className="rounded border p-4">
                  <div className="text-xs text-muted-foreground">Over Estimate</div>
                  <div className="mt-1 text-2xl font-semibold">{operationsData.metrics.jobs_over_estimate}</div>
                  <div className="mt-1 text-xs text-muted-foreground">Jobs above estimated hours</div>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Milestone Health</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(operationsData.milestone_breakdown || []).length > 0 ? (
                    operationsData.milestone_breakdown.map((row) => (
                      <div key={`ops-milestone-${row.key}`} className="flex items-center justify-between rounded border p-3 text-sm">
                        <span className={`rounded-full px-2 py-1 text-xs ${toneForMilestoneStatus(row.key)}`}>{row.status}</span>
                        <span className="font-medium">{row.count}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-muted-foreground">Milestone health will appear here as delivery plans are assigned.</div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Time By Subject</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(operationsData.time_by_subject || []).length > 0 ? (
                    operationsData.time_by_subject.map((row) => (
                      <div key={`ops-subject-${row.subject}`} className="flex items-center justify-between rounded border p-3 text-sm">
                        <span>{row.subject || "Unspecified"}</span>
                        <span className="font-medium">{formatNumber(row.hours, 1)} hrs</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-muted-foreground">Tracked effort themes will appear here once time logs are added.</div>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>CRM Workload</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(operationsData.crm_workload || []).length > 0 ? (
                  operationsData.crm_workload.map((row) => (
                    <div key={`ops-crm-${row.crm_name}`} className="rounded border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="font-medium">{row.crm_name || "Unassigned"}</span>
                        <span>{row.total_jobs} active jobs</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className={`rounded-full px-2 py-1 text-xs ${toneForMilestoneStatus("red")}`}>Overdue: {row.red_jobs}</span>
                        <span className={`rounded-full px-2 py-1 text-xs ${toneForMilestoneStatus("amber")}`}>Due Soon: {row.amber_jobs}</span>
                        <span className={`rounded-full px-2 py-1 text-xs ${toneForMilestoneStatus("green")}`}>Healthy: {row.green_jobs}</span>
                        <span className={`rounded-full px-2 py-1 text-xs ${toneForMilestoneStatus("no_milestones")}`}>No Milestones: {row.no_milestone_jobs}</span>
                      </div>
                      <div className="mt-3 grid gap-3 text-sm text-muted-foreground md:grid-cols-3">
                        <div>Logged: {formatNumber(row.logged_hours, 1)} hrs</div>
                        <div>Estimate: {formatNumber(row.estimated_hours, 1)} hrs</div>
                        <div>Utilisation: {row.utilisation_pct !== null ? `${row.utilisation_pct.toFixed(1)}%` : "-"}</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground">CRM workload will appear here as jobs, milestones, and time logs build out.</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Jobs Needing Attention</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(operationsData.jobs_needing_attention || []).length > 0 ? (
                  operationsData.jobs_needing_attention.map((row) => (
                    <Link
                      key={`ops-job-${row.job_id}`}
                      href={`/jobs/${row.job_id}`}
                      className="grid gap-2 rounded border p-3 text-sm transition-colors hover:bg-muted/40 md:grid-cols-[1.4fr_0.7fr_0.8fr_0.8fr_0.9fr]"
                    >
                      <div>
                        <div className="font-medium">
                          {[row.job_number, row.title].filter(Boolean).join(" · ") || `Job ${row.job_id}`}
                        </div>
                        <div className="text-xs text-muted-foreground">{row.client_name || "Unknown client"}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{row.reason || "Attention required"}</div>
                      </div>
                      <div>
                        <span className={`rounded-full px-2 py-1 text-xs ${toneForMilestoneStatus(row.milestone_status)}`}>
                          {row.milestone_status || "No milestones"}
                        </span>
                      </div>
                      <div className="text-muted-foreground">
                        {row.next_due_name ? `${row.next_due_name}: ${formatDate(row.next_due_date)}` : "No next due date"}
                      </div>
                      <div className="text-muted-foreground">
                        {row.utilisation_pct !== null ? `${row.utilisation_pct.toFixed(1)}% of estimate` : `${formatNumber(row.logged_hours, 1)} hrs logged`}
                      </div>
                      <div className="text-muted-foreground">
                        {row.days_to_next_due !== null && row.days_to_next_due !== undefined
                          ? `${row.days_to_next_due} days`
                          : row.crm_name || "-"}
                      </div>
                    </Link>
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground">Priority jobs will appear here when risk or effort signals emerge.</div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="reports" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Saved Reports</CardTitle>
              </CardHeader>
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
              <CardHeader>
                <CardTitle>Starter Views</CardTitle>
              </CardHeader>
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
              <CardHeader>
                <CardTitle>Report Builder</CardTitle>
              </CardHeader>
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
              <CardHeader>
                <CardTitle>{reportData.title || "Report"}</CardTitle>
              </CardHeader>
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
    </div>
  );
}
