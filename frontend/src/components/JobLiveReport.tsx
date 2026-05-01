"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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

import JobWorkspaceHeader from "@/components/job-workspace/JobWorkspaceHeader";
import type { JobWorkspaceJob, WorkspaceBreadcrumb, WorkspaceEmissionsSummaryData } from "@/components/job-workspace/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatNumber } from "@/lib/format";

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
  crm_owner?: string | null;
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
  yearly_emissions?: Array<{
    year?: number | null;
    scope1?: number | null;
    scope2?: number | null;
    scope3?: number | null;
    total?: number | null;
  }>;
  template_variables?: Record<string, unknown>;
  summary?: {
    current_total?: number | null;
    benchmark_total?: number | null;
    delta_total?: number | null;
    delta_pct?: number | null;
    top_category?: {
      category?: string | null;
      dataset_category?: string | null;
      scope?: string | null;
      emissions?: number | null;
      report_label?: string | null;
      data_source?: string | null;
      reference_label?: string | null;
      } | null;
  };
  target_data?: Record<string, unknown>;
  report_metadata?: Record<string, unknown>;
};

type JobLiveReportProps = {
  jobId: number;
  baseUrl: string;
  printMode?: boolean;
};
type LiveActionItem = Record<string, unknown>;

const SCOPE_COLORS = ["#0f766e", "#2563eb", "#8b5cf6"];

function toNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function safeText(value: unknown, fallback = "N/A"): string {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : fallback;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = safeText(value, "").trim();
    if (text.length > 0 && text !== "N/A") {
      return text;
    }
  }
  return "";
}

function splitCommaList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => safeText(item, "")).filter(Boolean);
  }
  const raw = safeText(value, "").trim();
  if (!raw) return [];
  return raw
    .split(/[,\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getDisplayValue(value: unknown, fallback = "N/A"): string {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === "string") {
    const text = value.trim();
    return text.length > 0 ? text : fallback;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => safeText(item, "")).filter(Boolean).join(", ") || fallback;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return fallback;
    return entries
      .map(([key, item]) => `${key}: ${safeText(item, "")}`)
      .filter((line) => !line.endsWith(": "))
      .join(" | ") || fallback;
  }
  return fallback;
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

function formatDateDisplay(value: unknown): string {
  const raw = safeText(value, "");
  if (!raw) return "N/A";
  const formatted = formatDate(raw, { day: "numeric", month: "short", year: "numeric" });
  return formatted === "—" ? raw : formatted;
}

export default function JobLiveReport({ jobId, baseUrl, printMode = false }: JobLiveReportProps) {
  const [data, setData] = useState<LiveReportData | null>(null);
  const [clientOwnerLabel, setClientOwnerLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloadingPdf, setDownloadingPdf] = useState(false);

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
  }, [baseUrl, jobId]);
  useEffect(() => {
    let cancelled = false;

    async function loadClientOwner() {
      const clientId = data?.job_data?.client_db_id;
      if (!clientId) {
        setClientOwnerLabel("");
        return;
      }

      try {
        const res = await fetch(`${baseUrl}/clients/${clientId}`, { credentials: "include" });
        if (!res.ok || cancelled) return;
        const clientJson = (await res.json()) as { crm_owner?: string | null };
        setClientOwnerLabel((clientJson.crm_owner ?? "").trim());
      } catch {
        if (!cancelled) setClientOwnerLabel("");
      }
    }

    void loadClientOwner();

    return () => {
      cancelled = true;
    };
  }, [baseUrl, data?.job_data?.client_db_id]);

  const job = data?.job_data ?? null;
  const scopeTotals = useMemo(() => data?.scope_totals ?? {}, [data?.scope_totals]);
  const benchmarkTotals = useMemo(() => data?.benchmark_totals ?? {}, [data?.benchmark_totals]);
  const intensityMetrics = data?.intensity_metrics ?? {};
  const jobActions = data?.job_actions?.grouped ?? [];
  const templateVariables = data?.template_variables ?? {};
  const reportMetadata = data?.report_metadata ?? {};
  const targetData = data?.target_data ?? {};

  const reportTitle = firstText(templateVariables.report_title, reportMetadata.report_title, job?.title, "Carbon Reduction Plan");
  const executiveSummaryText = firstText(
    templateVariables.executive_summary,
    reportMetadata.commitment_commentary,
    `This report presents the greenhouse gas emissions for ${job?.client_name ?? "the client"} for the reporting period.`,
  );
  const commitmentStatement = firstText(
    templateVariables.commitment_statement,
    reportMetadata.commitment_commentary,
    `${job?.client_name ?? "The organisation"} is committed to achieving Net Zero emissions by ${targetData.net_zero_target_year ?? 2050}.`,
  );
  const activityNarrativeIntro = firstText(templateVariables.activity_narrative_intro, reportMetadata.activity_commentary);
  const reductionTargetsNarrative = firstText(templateVariables.reduction_targets, reportMetadata.emissions_reduction_targets_commentary);
  const reductionProjectsNarrative = firstText(templateVariables.reduction_projects);
  const dataConfidenceNarrative = firstText(reportMetadata.data_confidence_commentary);
  const intensityNarrative = firstText(reportMetadata.intensity_commentary);
  const methodologiesUsed = splitCommaList(reportMetadata.methodologies_used);
  const datasetsUsed = splitCommaList(reportMetadata.datasets_names);
  const glossaryTerms = splitCommaList(targetData.glossary_terms);
  const consultantName = firstText(reportMetadata.consultant_name, templateVariables.signatory_name);
  const consultantPosition = firstText(reportMetadata.consultant_position);
  const consultantSignatureDate = firstText(reportMetadata.consultant_signature_date);
  const clientSigneeName = firstText(reportMetadata.client_signee_name);
  const clientSigneePosition = firstText(reportMetadata.client_signee_position);
  const clientSignatureDate = firstText(reportMetadata.client_signature_date);

  const workspaceJob: JobWorkspaceJob | null = job
    ? {
        jobId: job.job_id,
        jobNumber: job.job_number ?? `J${String(job.job_id).padStart(6, "0")}`,
        jobTitle: job.title ?? "Job",
        clientName: job.client_name ?? "Client",
        reportingPeriodLabel:
          job.reporting_period_start && job.reporting_period_end
            ? `${formatDate(job.reporting_period_start, { day: "numeric", month: "short", year: "numeric" })} - ${formatDate(job.reporting_period_end, { day: "numeric", month: "short", year: "numeric" })}`
            : job.reporting_period_end
              ? `Year ${new Date(job.reporting_period_end).getFullYear()}`
              : job.reporting_year
                ? `Year ${job.reporting_year}`
              : "Reporting period not set",
        statusLabel: job.status ?? "Draft",
        ownerLabel: clientOwnerLabel || job.crm_owner || "Unassigned",
        crmLabel: undefined,
      }
    : null;

  const breadcrumbs: WorkspaceBreadcrumb[] = job
    ? [
        { label: "Clients", href: "/clients" },
        { label: job.client_name ?? "Client", href: `/clients/${job.client_db_id}?section=jobs` },
        { label: "Jobs", href: "/jobs" },
        { label: job.job_number ?? `Job ${job.job_id}`, href: `/jobs/${job.job_id}` },
        { label: "Live Report", href: `/jobs/${job.job_id}/report-live` },
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

  const topCategoryData = useMemo(() => {
    return [...(data?.categories ?? [])]
      .map((row) => ({
        category: safeText(
          (row as Record<string, unknown>).dataset_category ??
            (row as Record<string, unknown>).category ??
            (row as Record<string, unknown>).report_label,
          "Uncategorized",
        ),
        emissions: toNumber((row as Record<string, unknown>).emissions),
        scope: safeText((row as Record<string, unknown>).scope, ""),
      }))
      .filter((row) => row.emissions > 0)
      .sort((a, b) => b.emissions - a.emissions)
      .slice(0, 6);
  }, [data?.categories]);

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
        note: benchmarkTotal > 0 ? `Benchmark: ${formatNumber(benchmarkTotal)} tCO₂e` : undefined,
      }
    : null;

  const periodStart = job?.reporting_period_start ? formatDate(job.reporting_period_start, { day: "numeric", month: "short", year: "numeric" }) : "";
  const periodEnd = job?.reporting_period_end ? formatDate(job.reporting_period_end, { day: "numeric", month: "short", year: "numeric" }) : "";
  const reportYear = job?.reporting_year ?? new Date().getFullYear();
  const htmlReportUrl = `${baseUrl}/jobs/${jobId}/generate-html-report`;
  const selectedDatasets = splitCommaList(reportMetadata.datasets_names);
  const downloadLiveReportPdf = async () => {
    try {
      setDownloadingPdf(true);
      const res = await fetch(`${baseUrl}/jobs/${jobId}/report-live-pdf`, {
        credentials: "include",
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `Failed to download PDF (${res.status})`);
      }

      const blob = await res.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `${(job?.job_number || `job-${jobId}`).replace(/[\\/:*?"<>|]+/g, "-")}-live-report.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloadingPdf(false);
    }
  };
  const reportSections = [
    { id: "executive-summary", label: "1. Executive Summary" },
    { id: "net-zero-commitment", label: "2. Net Zero Commitment" },
    { id: "background-information", label: "3. Background Information" },
    { id: "carbon-emissions-overview", label: "4. Carbon Emissions Overview" },
    { id: "analysis-by-scope", label: "5. Analysis by Scope" },
    { id: "emissions-by-activity", label: "6. Top Emissions" },
    { id: "intensity-analysis", label: "7. Intensity Metric Analysis" },
    { id: "emissions-reduction-targets", label: "8. Emissions Reduction Targets" },
    { id: "carbon-reduction-actions", label: "9. Carbon Reduction Actions" },
    { id: "secr-data", label: "10. SECR Emissions Data" },
    { id: "standards-methodology", label: "11. Standards and Methodology Used" },
    { id: "data-quality", label: "12. Data Quality / Confidence" },
    { id: "declaration-signoff", label: "13. Declaration and Sign Off" },
    { id: "glossary", label: "14. Glossary" },
  ];
  const scopeRows = [
    {
      label: "Scope 1",
      current: toNumber(scopeTotals["Scope 1"] ?? scopeTotals.scope_1 ?? 0),
      benchmark: toNumber(benchmarkTotals["Scope 1"] ?? benchmarkTotals.scope_1 ?? 0),
    },
    {
      label: "Scope 2",
      current: toNumber(scopeTotals["Scope 2"] ?? scopeTotals.scope_2 ?? 0),
      benchmark: toNumber(benchmarkTotals["Scope 2"] ?? benchmarkTotals.scope_2 ?? 0),
    },
    {
      label: "Scope 3",
      current: toNumber(scopeTotals["Scope 3"] ?? scopeTotals.scope_3 ?? 0),
      benchmark: toNumber(benchmarkTotals["Scope 3"] ?? benchmarkTotals.scope_3 ?? 0),
    },
  ].map((row) => ({
    ...row,
    delta: row.current - row.benchmark,
    deltaPct: row.benchmark > 0 ? ((row.current - row.benchmark) / row.benchmark) * 100.0 : null,
  }));
  const targetMilestones = [
    {
      label: "Baseline year",
      value: getDisplayValue(targetData.baseline_year, String(job?.reporting_year ?? "N/A")),
      hint: "Reference year used for the target pathway.",
    },
    {
      label: "Interim target year",
      value: getDisplayValue(targetData.interim_target_year, "2030"),
      hint: "Shorter-term reduction milestone.",
    },
    {
      label: "Interim reduction",
      value: `${getDisplayValue(targetData.interim_pct, "50")}%`,
      hint: "Reduction expected by the interim milestone.",
    },
    {
      label: "Net zero target year",
      value: getDisplayValue(targetData.net_zero_target_year, "2050"),
      hint: "Target year for net zero delivery.",
    },
    {
      label: "Net zero reduction",
      value: `${getDisplayValue(targetData.target_pct, "90")}%`,
      hint: "Overall reduction expected by net zero.",
    },
  ];
  const reportMetadataRows = [
    { label: "Company number", value: reportMetadata.company_number },
    { label: "Registered address", value: reportMetadata.registered_address },
    { label: "Employee number", value: reportMetadata.employee_number },
    { label: "Premises owned", value: reportMetadata.premises_owned },
    { label: "Premises leased", value: reportMetadata.premises_leased },
    { label: "Vehicles owned", value: reportMetadata.vehicles_owned },
    { label: "Vehicles leased", value: reportMetadata.vehicles_leased },
    { label: "Operational control", value: reportMetadata.operational_control },
    { label: "Financial control", value: reportMetadata.financial_control },
    { label: "Equity share", value: reportMetadata.equity_share },
  ].filter((item) => safeText(item.value, "").length > 0);

  return (
    <div className="live-report-root space-y-6 bg-white text-slate-950">
      {!printMode ? (
        <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white px-4 py-3 shadow-sm">
          <div>
            <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Live Report</div>
            <div className="text-sm text-slate-600">Browser-friendly report with print-safe SVG charts.</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href={`/jobs/${jobId}/report-new`}>Back to Report Builder</Link>
            </Button>
            <Button variant="outline" onClick={() => window.print()} disabled={loading}>
              Print / Save PDF
            </Button>
            <Button variant="secondary" onClick={downloadLiveReportPdf} disabled={loading || downloadingPdf}>
              {downloadingPdf ? "Preparing PDF..." : "Download PDF"}
            </Button>
          </div>
        </div>
      ) : null}

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
                { label: "Total tCO₂e", value: currentTotal },
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

          <Card className="live-report-section print:break-inside-avoid">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle>Detailed report structure</CardTitle>
                <p className="text-sm text-slate-500">
                  This page mirrors the HTML report sections so the live browser view reads like the final client deliverable.
                </p>
              </div>
              <Button asChild variant="outline" className="no-print">
                <Link href={htmlReportUrl} target="_blank" rel="noreferrer">
                  Open HTML report
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {reportSections.map((section) => (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    className="rounded-xl border bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                  >
                    {section.label}
                  </a>
                ))}
              </div>

              <div id="report-structure" className="grid gap-6 xl:grid-cols-2">
                <div className="rounded-2xl border bg-slate-50 p-4">
                  <div className="text-xs uppercase tracking-[0.22em] text-slate-500">1. Executive Summary</div>
                  <p className="mt-3 text-sm leading-6 text-slate-700">{executiveSummaryText}</p>
                  <table className="mt-4 w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b text-left text-slate-500">
                        <th className="py-2 pr-3">Scope</th>
                        <th className="py-2 pr-3 text-right">Current</th>
                        <th className="py-2 pr-3 text-right">Benchmark</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scopeRows.map((row) => (
                        <tr key={`exec-${row.label}`} className="border-b last:border-b-0">
                          <td className="py-2 pr-3 font-medium text-slate-900">{row.label}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(row.current)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(row.benchmark)}</td>
                        </tr>
                      ))}
                      <tr className="border-t font-semibold text-slate-900">
                        <td className="py-2 pr-3">Total</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(currentTotal)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(benchmarkTotal)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="rounded-2xl border bg-slate-50 p-4">
                  <div className="text-xs uppercase tracking-[0.22em] text-slate-500">2. Net Zero Commitment</div>
                  <p className="mt-3 text-sm leading-6 text-slate-700">{commitmentStatement}</p>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {targetMilestones.slice(0, 4).map((item) => (
                      <div key={`commit-${item.label}`} className="rounded-xl border bg-white p-3">
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{item.label}</div>
                        <div className="mt-1 font-semibold text-slate-900">{item.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-2xl border bg-slate-50 p-4">
                  <div className="text-xs uppercase tracking-[0.22em] text-slate-500">3. Background Information</div>
                  <div className="mt-3 space-y-2 text-sm text-slate-700">
                    <div><strong>Report title:</strong> {reportTitle}</div>
                    <div><strong>Reporting period:</strong> {periodStart && periodEnd ? `${periodStart} to ${periodEnd}` : "Reporting period not set"}</div>
                    <div><strong>Selected datasets:</strong> {selectedDatasets.length > 0 ? `${selectedDatasets.length} selected` : "None selected"}</div>
                    <div><strong>Job status:</strong> {job.status ?? "Draft"}</div>
                  </div>
                </div>
                <div className="rounded-2xl border bg-slate-50 p-4">
                  <div className="text-xs uppercase tracking-[0.22em] text-slate-500">11. Standards and Methodology Used</div>
                  <div className="mt-3 space-y-3">
                    {methodologiesUsed.length > 0 ? (
                      <div>
                        <div className="text-sm font-semibold text-slate-900">Methodologies used</div>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                          {methodologiesUsed.slice(0, 6).map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {datasetsUsed.length > 0 ? (
                      <div>
                        <div className="text-sm font-semibold text-slate-900">Datasets used</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {datasetsUsed.slice(0, 8).map((item) => (
                            <Badge key={item} variant="secondary" className="bg-white">
                              {item}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 xl:grid-cols-2 print:grid-cols-1">
            <Card className="live-report-section print:break-inside-avoid" id="carbon-emissions-overview">
              <CardHeader>
                <CardTitle>4. Carbon Emissions Overview</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm leading-6 text-slate-700">
                  {executiveSummaryText} The current reporting cycle uses the selected live datasets and the latest available
                  activity data to present a current-year view alongside the benchmark period for comparison.
                </p>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Current total</div>
                    <div className="mt-2 text-3xl font-semibold tabular-nums">{formatNumber(currentTotal)}</div>
                    <div className="text-xs text-slate-500">tCO₂e for the reporting year</div>
                  </div>
                  <div className="rounded-2xl border bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Benchmark</div>
                    <div className="mt-2 text-3xl font-semibold tabular-nums">{formatNumber(benchmarkTotal)}</div>
                    <div className="text-xs text-slate-500">tCO₂e benchmark comparison</div>
                  </div>
                </div>
                <div className="rounded-2xl border bg-white p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Reporting period</div>
                      <div className="mt-1 font-medium text-slate-900">
                        {periodStart && periodEnd ? `${periodStart} to ${periodEnd}` : "Reporting period not set"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Selected datasets</div>
                      <div className="mt-1 font-medium text-slate-900">
                        {selectedDatasets.length > 0 ? `${selectedDatasets.length} datasets selected` : "No additional datasets selected"}
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="live-report-section print:break-inside-avoid" id="analysis-by-scope">
              <CardHeader>
                <CardTitle>5. Analysis by Scope</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-6 text-slate-700">
                  The total calculated emissions are broken down by scope below. This mirrors the HTML report logic and is intended
                  to give a clear view of which scope is carrying the largest burden in the reporting period.
                </p>
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
                  <div className="relative mx-auto aspect-square w-full max-w-[480px]">
                    <ResponsiveContainer width="100%" aspect={1}>
                      <PieChart>
                        <Pie data={scopeChartData} dataKey="value" nameKey="name" innerRadius="77%" outerRadius="96%" paddingAngle={2}>
                          {scopeChartData.map((_, index) => (
                            <Cell key={index} fill={SCOPE_COLORS[index % SCOPE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(val: number | string | undefined) => `${formatNumber(Number(val ?? 0))} tCO₂e`} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <div className="text-center leading-none">
                        <div className="whitespace-nowrap text-[clamp(1rem,3.2vw,2.2rem)] font-semibold">
                          {formatNumber(currentTotal)}
                        </div>
                        <div className="mt-2 text-[11px] text-muted-foreground">tCO₂e total</div>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3 pt-2">
                    {scopeChartData.map((scope, index) => {
                      const pct = currentTotal > 0 ? (scope.value / currentTotal) * 100 : 0;
                      return (
                        <div key={scope.name} className="flex items-center justify-between gap-2 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SCOPE_COLORS[index % SCOPE_COLORS.length] }} />
                            <span>{scope.name}</span>
                          </div>
                          <span className="font-medium">{pct.toFixed(1)}%</span>
                        </div>
                      );
                    })}
                    <div className="mt-2 border-t pt-2">
                      <div className="flex items-center justify-between gap-2 text-sm font-semibold">
                        <span>Total</span>
                        <span>
                          {scopeChartData.reduce((acc, scope) => acc + (currentTotal > 0 ? (scope.value / currentTotal) * 100 : 0), 0).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <div className="mt-4 border-t pt-3">
                      <div className="mb-2 text-xs font-semibold text-muted-foreground">tCO₂e by Scope</div>
                      {scopeChartData.map((scope, index) => (
                        <div key={`${scope.name}-tco2e`} className="flex items-center justify-between gap-2 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SCOPE_COLORS[index % SCOPE_COLORS.length] }} />
                            <span>{scope.name}</span>
                          </div>
                          <span className="font-medium">{formatNumber(scope.value)}</span>
                        </div>
                      ))}
                      <div className="mt-2 border-t pt-2">
                        <div className="flex items-center justify-between gap-2 text-sm font-semibold">
                          <span>Total</span>
                          <span>{formatNumber(currentTotal)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  Reported Scope 3 values may shift as further source data becomes available in future years.
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)] print:grid-cols-1">
            <Card className="live-report-section print:break-inside-avoid" id="emissions-by-activity">
              <CardHeader>
                <CardTitle>6. Top Emissions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm leading-6 text-slate-700">
                  {activityNarrativeIntro || "The chart below shows which operational categories are driving emissions across the reporting period."}
                </p>
                <div className="h-[320px] w-full">
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={topCategoryData} layout="vertical" margin={{ top: 4, right: 20, left: 24, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis type="category" dataKey="category" width={140} tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(value) => [`${formatNumber(Number(value))} tCO₂e`, ""]} />
                      <Bar dataKey="emissions" radius={[0, 4, 4, 0]} fill="#0ea5e9" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {topCategoryData.map((entry) => (
                    <div key={entry.category} className="rounded-xl border bg-slate-50 p-3">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{entry.category}</div>
                      <div className="mt-1 text-lg font-semibold tabular-nums">{formatNumber(entry.emissions)}</div>
                      <div className="text-xs text-slate-500">{entry.scope || "Category emissions"}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="live-report-section print:break-inside-avoid" id="intensity-analysis">
              <CardHeader>
                <CardTitle>7. Intensity Metric Analysis</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm leading-6 text-slate-700">
                  {intensityNarrative || "Intensity metrics help normalise emissions to business activity and make comparisons more meaningful over time."}
                </p>
                {Object.keys(intensityMetrics).length > 0 ? (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                    {Object.entries(intensityMetrics).map(([key, metric]) => {
                      const label = safeText(metric?.label, key);
                      const value = toNumber(metric?.value);
                      const divider = toNumber(metric?.divider || 1) || 1;
                      const intensity = value > 0 ? (currentTotal / value) * divider : 0;
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
          </div>

          <div className="grid gap-6 xl:grid-cols-2 print:grid-cols-1">
            <Card className="live-report-section print:break-inside-avoid" id="emissions-reduction-targets">
              <CardHeader>
                <CardTitle>8. Emissions Reduction Targets</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm leading-6 text-slate-700">
                  {reductionTargetsNarrative || "The target pathway is structured around an interim reduction milestone and a longer-term net zero year."}
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                  {targetMilestones.map((item) => (
                    <div key={item.label} className="rounded-2xl border bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{item.label}</div>
                      <div className="mt-1 text-xl font-semibold text-slate-900">{item.value}</div>
                      <div className="mt-1 text-xs text-slate-500">{item.hint}</div>
                    </div>
                  ))}
                </div>
                {reductionProjectsNarrative ? <p className="rounded-2xl border bg-white p-4 text-sm leading-6 text-slate-700">{reductionProjectsNarrative}</p> : null}
              </CardContent>
            </Card>

            <Card className="live-report-section print:break-inside-avoid" id="carbon-reduction-actions">
              <CardHeader>
                <CardTitle>9. Carbon Reduction Actions</CardTitle>
              </CardHeader>
              <CardContent>
                {jobActions.length > 0 ? (
                  <div className="grid gap-4">
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
          </div>

          <div className="grid gap-6 xl:grid-cols-2 print:grid-cols-1">
            <Card className="live-report-section print:break-inside-avoid" id="secr-data">
              <CardHeader>
                <CardTitle>10. SECR Emissions Data</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm leading-6 text-slate-700">
                  The following fields summarise the organisation details used to support SECR-style disclosures and the reporting boundary.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {reportMetadataRows.length > 0 ? (
                    reportMetadataRows.map((row) => (
                      <div key={row.label} className="rounded-xl border bg-slate-50 p-3">
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{row.label}</div>
                        <div className="mt-1 text-sm font-medium text-slate-900">{getDisplayValue(row.value)}</div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed bg-slate-50 p-4 text-sm text-slate-500">
                      No SECR metadata has been saved for this job yet.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="live-report-section print:break-inside-avoid" id="data-quality">
              <CardHeader>
                <CardTitle>12. Data Quality / Confidence</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm leading-6 text-slate-700">
                  {dataConfidenceNarrative || "Data quality notes are used to explain the sources, assumptions, and confidence level behind the reported values."}
                </p>
                <div className="rounded-2xl border bg-slate-50 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Datasets referenced</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {datasetsUsed.length > 0 ? (
                      datasetsUsed.slice(0, 10).map((item) => (
                        <Badge key={item} variant="secondary" className="bg-white">
                          {item}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm text-slate-500">No datasets referenced yet.</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-2 print:grid-cols-1">
            <Card className="live-report-section print:break-inside-avoid" id="declaration-signoff">
              <CardHeader>
                <CardTitle>13. Declaration and Sign Off</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border bg-slate-50 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Consultant</div>
                  <div className="mt-2 text-base font-semibold text-slate-900">{consultantName || "N/A"}</div>
                  <div className="text-sm text-slate-600">{consultantPosition || "Consultant position not set"}</div>
                  <div className="mt-3 text-xs text-slate-500">
                    Signature date: {consultantSignatureDate ? formatDateDisplay(consultantSignatureDate) : "Not set"}
                  </div>
                </div>
                <div className="rounded-2xl border bg-slate-50 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Client signee</div>
                  <div className="mt-2 text-base font-semibold text-slate-900">{clientSigneeName || "N/A"}</div>
                  <div className="text-sm text-slate-600">{clientSigneePosition || "Client position not set"}</div>
                  <div className="mt-3 text-xs text-slate-500">
                    Signature date: {clientSignatureDate ? formatDateDisplay(clientSignatureDate) : "Not set"}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="live-report-section print:break-inside-avoid" id="glossary">
              <CardHeader>
                <CardTitle>14. Glossary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {glossaryTerms.length > 0 ? (
                    glossaryTerms.slice(0, 16).map((term) => (
                      <Badge key={term} variant="outline" className="bg-white">
                        {term}
                      </Badge>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed bg-slate-50 p-4 text-sm text-slate-500">
                      No glossary terms have been saved for this report.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="live-report-section print:break-inside-avoid" id="appendix">
            <CardHeader>
              <CardTitle>15. Appendix</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm leading-6 text-slate-700">
                The appendix contains the supporting datasets and references used in this reporting cycle. It is intended to provide
                traceability back to the source data and any selected job-level additions.
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {datasetsUsed.length > 0 ? (
                  datasetsUsed.slice(0, 12).map((item) => (
                    <div key={`appendix-${item}`} className="rounded-xl border bg-slate-50 p-3 text-sm text-slate-700">
                      {item}
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed bg-slate-50 p-4 text-sm text-slate-500">
                    No appendix datasets were selected.
                  </div>
                )}
              </div>
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
                max-width: none !important;
              }

              .live-report-section,
              .recharts-wrapper,
              .recharts-surface {
                break-inside: avoid;
                page-break-inside: avoid;
              }

              .live-report-section {
                margin-bottom: 1rem;
                width: 100% !important;
                max-width: 100% !important;
              }

              .live-report-section .recharts-responsive-container,
              .live-report-section .recharts-wrapper,
              .live-report-section .recharts-surface,
              .live-report-section svg {
                width: 100% !important;
                max-width: 100% !important;
                overflow: visible !important;
              }

              .live-report-section .recharts-legend-wrapper {
                position: static !important;
                width: 100% !important;
                margin-top: 0.5rem !important;
              }

              .live-report-section .recharts-cartesian-axis-tick-value,
              .live-report-section .recharts-polar-angle-axis-tick-value {
                font-size: 10px !important;
              }

              .live-report-root .rounded-3xl {
                box-shadow: none !important;
              }

              @page {
                margin: 10mm;
              }

              body {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
                background: white !important;
              }
            }
          `}</style>
        </>
      ) : null}
    </div>
  );
}
