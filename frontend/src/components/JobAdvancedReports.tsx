"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  LabelList,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportJob = {
  job_id: number;
  client_db_id: number;
  job_number?: string | null;
  title?: string | null;
  reporting_period_start?: string | null;
  reporting_period_end?: string | null;
  status?: string | null;
  client_name?: string | null;
  crm_owner?: string | null;
  logo_url?: string | null;
  description?: string | null;
  industry?: string | null;
  no_of_staff?: number | null;
  city?: string | null;
  country?: string | null;
};

type ReportMetadata = {
  report_title?: string | null;
  benchmark_period_label?: string | null;
  current_reporting_period_label?: string | null;
  company_number?: string | null;
  registered_address?: string | null;
  employee_number?: number | null;
  premises_owned?: number | null;
  premises_leased?: number | null;
  vehicles_owned?: number | null;
  vehicles_leased?: number | null;
  operational_control?: boolean | null;
  financial_control?: boolean | null;
  equity_share?: boolean | null;
  commitment_commentary?: string | null;
  activity_commentary?: string | null;
  intensity_commentary?: string | null;
  emissions_reduction_targets_commentary?: string | null;
  data_confidence_commentary?: string | null;
  methodologies_used?: string | null;
  datasets_names?: string | null;
  energy_consumption_uk_kwh?: number | null;
  energy_consumption_non_uk_kwh?: number | null;
  energy_reporting_basis?: string | null;
  renewable_energy_kwh?: number | null;
  renewable_energy_pct?: number | null;
  energy_emissions_tco2e?: number | null;
  energy_emissions_market_tco2e?: number | null;
  carbon_offsets_tco2e?: number | null;
  consultant_name?: string | null;
  consultant_position?: string | null;
  consultant_signature_date?: string | null;
  client_signee_name?: string | null;
  client_signee_position?: string | null;
  client_signature_date?: string | null;
};

type AppendixRow = {
  site_name?: string | null;
  scope?: string | null;
  activity_group?: string | null;
  emission_type?: string | null;
  category?: string | null;
  data_source?: string | null;
  data_confidence?: string | null;
  qty?: number | null;
  uom?: string | null;
  emissions?: number | null;
};

type SiteBreakdowns = {
  show_site_tables?: boolean;
  show_appendix?: boolean;
  site_count?: number;
  appendix_rows?: AppendixRow[];
};

type GlossaryCard = {
  term: string;
  definition: string;
};

type YearlyEmission = {
  year: number;
  scope1: number;
  scope2: number;
  scope3: number;
  total: number;
};

type ReactReportVersion = {
  report_version_id: number;
  version_number: number;
  version_label?: string | null;
  status?: string | null;
  report_format?: string | null;
  generated_at?: string | null;
  generated_by?: string | null;
  file_id?: number | null;
  download_url?: string | null;
  data_hash?: string | null;
  notes?: string | null;
};

type LiveData = {
  job_data: ReportJob;
  scope_totals?: Record<string, number | null | undefined>;
  activity_totals?: Record<string, number | null>;
  activity_group_order?: string[];
  activity_group_colors?: Record<string, string>;
  intensity_metrics?: Record<string, { label?: string; value?: number | null; divider?: number | null }>;
  job_actions?: {
    grouped?: Array<{
      term?: string;
      label?: string;
      count?: number;
      items?: Array<Record<string, unknown>>;
    }>;
    total_actions?: number;
    summary_sentence?: string | null;
  };
  target_data?: Record<string, unknown>;
  report_metadata?: ReportMetadata;
  template_variables?: Record<string, unknown>;
  summary?: {
    current_total?: number | null;
    benchmark_total?: number | null;
    delta_total?: number | null;
    top_category?: {
      category?: string | null;
      scope?: string | null;
      emissions?: number | null;
      report_label?: string | null;
    } | null;
  };
  site_breakdowns?: SiteBreakdowns;
  glossary_cards?: GlossaryCard[];
  yearly_emissions?: YearlyEmission[];
};

// ─── Constants ────────────────────────────────────────────────────────────────

const SCOPE_LABELS = ["Scope 1", "Scope 2", "Scope 3"] as const;

const SCOPE_COLORS: Record<string, string> = {
  "Scope 1": "#0f766e",
  "Scope 2": "#0891b2",
  "Scope 3": "#38bdf8",
};

const BRAND = "#1c3a2c";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toNum(v: unknown): number {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function fmt(v: number, dp = 1): string {
  return v.toLocaleString(undefined, {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

function fmtEnergy(kwh: number): string {
  if (kwh >= 1_000_000) return `${fmt(kwh / 1_000_000, 2)} GWh`;
  if (kwh >= 1_000) return `${fmt(kwh / 1_000, 1)} MWh`;
  return `${fmt(kwh, 0)} kWh`;
}

function boolLabel(v: boolean | null | undefined): string {
  if (v == null) return "—";
  return v ? "Yes" : "No";
}

function buildPathwayPoints(
  baselineYear: number,
  netZeroYear: number,
  scope1: number,
  scope2: number,
  scope3: number,
  targetPct: number,
) {
  const span = netZeroYear - baselineYear;
  return Array.from({ length: span + 1 }, (_, i) => {
    const year = baselineYear + i;
    const factor = span > 0 ? (i / span) * (targetPct / 100) : 0;
    return {
      year,
      s1: Math.max(0, scope1 * (1 - factor)),
      s2: Math.max(0, scope2 * (1 - factor)),
      s3: Math.max(0, scope3 * (1 - factor)),
    };
  });
}

// ─── PathwayChart ─────────────────────────────────────────────────────────────

type PathwayPoint = { year: number; s1: number; s2: number; s3: number };

function PathwayChart({
  points,
  baselineYear,
  endYear,
  interimYear,
}: {
  points: PathwayPoint[];
  baselineYear: number;
  endYear: number;
  interimYear?: number | null;
}) {
  const tickYears = useMemo(
    () =>
      points
        .filter(d => d.year === baselineYear || d.year === endYear || d.year % 5 === 0)
        .map(d => d.year),
    [points, baselineYear, endYear],
  );

  const dot = { r: 3, strokeWidth: 1.5, stroke: "white" };
  const activeDot = { r: 5 };

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 48, left: 16, bottom: 36 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" />
          <XAxis
            dataKey="year"
            ticks={tickYears}
            tickFormatter={(v: number) => String(v)}
            tick={{ fontSize: 10 }}
            angle={-45}
            textAnchor="end"
            height={48}
          />
          <YAxis
            tickFormatter={(v: number) =>
              v.toLocaleString(undefined, { maximumFractionDigits: 0 })
            }
            tick={{ fontSize: 10 }}
            label={{
              value: "Emissions (tCO₂e)",
              angle: -90,
              position: "insideLeft",
              offset: 12,
              style: { fontSize: 10, fill: "#666" },
            }}
          />
          <Tooltip
            formatter={(value: number | undefined, name: string | undefined) => [
              value != null ? `${fmt(value)} tCO₂e` : "—",
              name ?? "",
            ]}
            labelFormatter={(label: unknown) => `Year ${label}`}
          />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />

          <ReferenceLine
            x={baselineYear}
            stroke="#555"
            strokeDasharray="5 3"
            strokeWidth={1.5}
            label={{
              value: `Baseline ${baselineYear}`,
              position: "insideTopLeft",
              fontSize: 9,
              fill: "#555",
            }}
          />
          {interimYear && interimYear > baselineYear && interimYear < endYear && (
            <ReferenceLine
              x={interimYear}
              stroke="#888"
              strokeDasharray="5 3"
              strokeWidth={1.5}
              label={{
                value: `Interim ${interimYear}`,
                position: "insideTop",
                fontSize: 9,
                fill: "#888",
              }}
            />
          )}
          <ReferenceLine
            x={endYear}
            stroke="#70AD47"
            strokeDasharray="5 3"
            strokeWidth={1.5}
            label={{
              value: `Net Zero ${endYear}`,
              position: "insideBottomRight",
              fontSize: 9,
              fill: "#2d7a2d",
            }}
          />

          <Line
            type="monotone"
            dataKey="s1"
            name="Scope 1"
            stroke="#4472C4"
            strokeWidth={2.5}
            dot={dot}
            activeDot={activeDot}
          />
          <Line
            type="monotone"
            dataKey="s2"
            name="Scope 2"
            stroke="#ED7D31"
            strokeWidth={2.5}
            dot={dot}
            activeDot={activeDot}
          />
          <Line
            type="monotone"
            dataKey="s3"
            name="Scope 3"
            stroke="#70AD47"
            strokeWidth={2.5}
            dot={dot}
            activeDot={activeDot}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── CoverPage ────────────────────────────────────────────────────────────────

function CoverPage({ data }: { data: LiveData }) {
  const { job_data, scope_totals, report_metadata, template_variables, summary } = data;
  const total = toNum(summary?.current_total ?? scope_totals?.Total);

  const consultantName = String(
    template_variables?.consultant_name ??
      report_metadata?.consultant_name ??
      job_data.crm_owner ??
      "Net Zero International",
  ).trim() || "Net Zero International";

  const reportTitle = String(job_data.title || "Carbon Report").trim();
  const generatedMonth = new Date().toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });

  return (
    <section className="live-report-section print:break-after-page flex flex-col bg-white rounded-lg border border-gray-200 overflow-hidden mb-6 min-h-[200px]">
      {/* Dark header */}
      <div
        className="px-8 py-5 flex items-center justify-between"
        style={{ backgroundColor: BRAND }}
      >
        {job_data.logo_url ? (
          <img
            src={job_data.logo_url}
            alt="Logo"
            className="h-9 object-contain brightness-0 invert"
          />
        ) : (
          <span className="text-white font-bold text-base tracking-wide">
            Net Zero International
          </span>
        )}
        <span className="text-green-200 text-xs font-semibold uppercase tracking-widest">
          Advanced Report · Beta
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 px-10 py-8 flex flex-col gap-5">
        <div>
          <p
            className="text-xs font-semibold uppercase tracking-widest mb-1"
            style={{ color: BRAND }}
          >
            Carbon Reduction Plan
          </p>
          <h1 className="text-3xl font-bold text-gray-900 leading-snug">{reportTitle}</h1>
          {job_data.reporting_period_start && job_data.reporting_period_end && (
            <p className="text-base text-gray-500 mt-1">
              {formatDate(job_data.reporting_period_start)}
              {" – "}
              {formatDate(job_data.reporting_period_end)}
            </p>
          )}
        </div>

        <div className="border-t border-gray-100 pt-5">
          <h2 className="text-xl font-semibold text-gray-800">{job_data.client_name}</h2>
          <p className="text-xs text-gray-400 mt-0.5">Client Organisation</p>
        </div>

        {total > 0 && (
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-5">
            <p className="text-xs font-medium uppercase tracking-widest text-gray-400 mb-2">
              Total Emissions
            </p>
            <div className="flex items-baseline gap-2 mb-3">
              <span className="text-4xl font-bold" style={{ color: BRAND }}>
                {fmt(total)}
              </span>
              <span className="text-base text-gray-400">tCO₂e</span>
            </div>
            <div className="flex gap-5">
              {SCOPE_LABELS.map(s => {
                const v = toNum(scope_totals?.[s]);
                return v > 0 ? (
                  <div key={s}>
                    <p className="text-xs text-gray-400">{s}</p>
                    <p
                      className="text-sm font-semibold"
                      style={{ color: SCOPE_COLORS[s] }}
                    >
                      {fmt(v)} tCO₂e
                    </p>
                  </div>
                ) : null;
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-10 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
        <span>Prepared by {consultantName}</span>
        <span>Generated {generatedMonth}</span>
      </div>
    </section>
  );
}

// ─── SectionHeader helper ─────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <CardTitle className="text-base font-semibold" style={{ color: BRAND }}>
      {title}
    </CardTitle>
  );
}

// ─── MetaRow helper ───────────────────────────────────────────────────────────

function MetaRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value == null || String(value).trim() === "") return null;
  return (
    <div className="flex gap-3 py-1.5 border-b border-gray-50 last:border-0">
      <span className="w-44 shrink-0 text-xs text-gray-400">{label}</span>
      <span className="text-xs text-gray-700 font-medium">{String(value)}</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function JobAdvancedReports({
  jobId,
  baseUrl,
  pdfToken,
}: {
  jobId: number;
  baseUrl: string;
  pdfToken?: string;
}) {
  const [data, setData] = useState<LiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [versions, setVersions] = useState<ReactReportVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [markingFinal, setMarkingFinal] = useState<number | null>(null);

  function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string> ?? {}),
      ...(pdfToken ? { authorization: `Bearer ${pdfToken}` } : {}),
    };
    return fetch(url, { credentials: "include", ...init, headers });
  }

  useEffect(() => {
    setLoading(true);
    setFetchError(null);
    authFetch(`${baseUrl}/jobs/${jobId}/live-report-data`)
      .then(r => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json() as Promise<LiveData>;
      })
      .then(d => setData(d))
      .catch(e => setFetchError(String(e)))
      .finally(() => setLoading(false));
  }, [jobId, baseUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  function loadVersions() {
    setVersionsLoading(true);
    authFetch(`${baseUrl}/jobs/${jobId}/react-report-versions`)
      .then(r => r.ok ? r.json() as Promise<{ versions: ReactReportVersion[] }> : Promise.resolve({ versions: [] }))
      .then(d => setVersions(d.versions ?? []))
      .catch(() => setVersions([]))
      .finally(() => setVersionsLoading(false));
  }

  useEffect(() => { loadVersions(); }, [jobId, baseUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Must be declared here (before early returns) to satisfy Rules of Hooks.
  // Synthesises a single-year row when the API returns no yearly_emissions.
  const effectiveYearlyEmissions: YearlyEmission[] = useMemo(() => {
    const ye = data?.yearly_emissions;
    if ((ye?.length ?? 0) > 0) return ye!;
    const te = toNum(data?.summary?.current_total ?? data?.scope_totals?.Total);
    if (te <= 0) return [];
    const by = toNum(data?.target_data?.baseline_year) || new Date().getFullYear() - 1;
    return [{
      year: by,
      scope1: toNum(data?.scope_totals?.["Scope 1"]),
      scope2: toNum(data?.scope_totals?.["Scope 2"]),
      scope3: toNum(data?.scope_totals?.["Scope 3"]),
      total: te,
    }];
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveVersion(status: "draft" | "review") {
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await authFetch(
        `${baseUrl}/jobs/${jobId}/generate-report-react?save_version=true&report_version_status=${status}`,
        { method: "POST" },
      );
      if (!res.ok) {
        let detail = `Server returned ${res.status}`;
        try {
          const body = await res.json() as { detail?: string };
          if (body.detail) detail = body.detail;
        } catch { /* ignore */ }
        throw new Error(detail);
      }
      const blob = await res.blob();
      const vNum = res.headers.get("X-Report-Version-Number") ?? "";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `report-${jobId}-advanced${vNum ? `-v${vNum}` : ""}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      loadVersions();
    } catch (e) {
      setGenerateError(String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function downloadVersion(version: ReactReportVersion) {
    if (!version.download_url) return;
    try {
      const res = await authFetch(`${baseUrl}${version.download_url}`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `report-${jobId}-advanced-v${version.version_number}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`Download failed: ${String(e)}`);
    }
  }

  async function markFinal(version: ReactReportVersion) {
    setMarkingFinal(version.report_version_id);
    try {
      const res = await authFetch(
        `${baseUrl}/jobs/${jobId}/report-versions/${version.report_version_id}`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "final" }) },
      );
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      loadVersions();
    } catch (e) {
      alert(`Failed to mark final: ${String(e)}`);
    } finally {
      setMarkingFinal(null);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-gray-400">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-green-600 border-t-transparent" />
          <p className="text-sm">Loading report data…</p>
        </div>
      </div>
    );
  }

  if (fetchError || !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <p className="font-medium text-red-600">Could not load report data</p>
          <p className="mt-1 text-sm text-gray-500">{fetchError}</p>
        </div>
      </div>
    );
  }

  // ── Derived values ──────────────────────────────────────────────────────────

  const {
    scope_totals,
    activity_totals,
    activity_group_order,
    activity_group_colors,
    intensity_metrics,
    job_actions,
    target_data,
    summary,
    report_metadata,
    site_breakdowns,
    glossary_cards,
    yearly_emissions,
  } = data;

  const totalEmissions = toNum(summary?.current_total ?? scope_totals?.Total);
  const scope1 = toNum(scope_totals?.["Scope 1"]);
  const scope2 = toNum(scope_totals?.["Scope 2"]);
  const scope3 = toNum(scope_totals?.["Scope 3"]);

  const baselineYear =
    toNum(target_data?.baseline_year) || new Date().getFullYear() - 1;
  const netZeroYear = toNum(target_data?.net_zero_target_year) || 2050;
  const interimYear =
    toNum(target_data?.interim_target_year ?? target_data?.interim_year) || null;
  const targetPct = toNum(target_data?.target_pct) || 100;
  const interimPct = toNum(target_data?.interim_pct) || 50;

  const pathway2050 = buildPathwayPoints(
    baselineYear, netZeroYear, scope1, scope2, scope3, targetPct,
  );
  const pathwayInterim =
    interimYear && interimYear > baselineYear
      ? buildPathwayPoints(baselineYear, interimYear, scope1, scope2, scope3, interimPct)
      : null;

  const scopeDonutData = SCOPE_LABELS.filter(s => toNum(scope_totals?.[s]) > 0).map(s => ({
    name: s,
    value: toNum(scope_totals?.[s]),
  }));

  const activityOrder = activity_group_order ?? Object.keys(activity_totals ?? {});
  const activityBarData = activityOrder
    .filter(k => toNum(activity_totals?.[k]) > 0)
    .map(k => ({
      name: k.length > 26 ? k.slice(0, 24) + "…" : k,
      fullName: k,
      value: toNum(activity_totals?.[k]),
      fill: activity_group_colors?.[k] ?? "#999",
    }))
    .sort((a, b) => b.value - a.value);

  const activityChartHeight = Math.max(200, activityBarData.length * 52 + 40);

  const hasPathway = baselineYear > 2000 && netZeroYear > baselineYear;

  const appendixRows = site_breakdowns?.appendix_rows ?? [];
  const hasAppendix = appendixRows.length > 0;
  const hasGlossary = (glossary_cards?.length ?? 0) > 0;

  // SECR energy fields
  const energyUkKwh = toNum(report_metadata?.energy_consumption_uk_kwh);
  const energyNonUkKwh = toNum(report_metadata?.energy_consumption_non_uk_kwh);
  const energyEmissionsTco2e = toNum(report_metadata?.energy_emissions_tco2e);
  const renewableKwh = toNum(report_metadata?.renewable_energy_kwh);
  const renewablePct = toNum(report_metadata?.renewable_energy_pct);
  const hasSecrEnergy = energyUkKwh > 0 || energyNonUkKwh > 0;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Print CSS */}
      <style jsx global>{`
        @media print {
          @page {
            size: A4;
            margin: 20mm;
          }
          .advanced-report-controls {
            display: none !important;
          }
          .live-report-section {
            break-inside: avoid;
            page-break-inside: avoid;
            width: 100% !important;
          }
          .recharts-responsive-container,
          .recharts-wrapper,
          .recharts-surface,
          svg {
            width: 100% !important;
            overflow: visible !important;
          }
        }
      `}</style>

      {/* Control bar */}
      <div className="advanced-report-controls mb-1 rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Advanced Reports</h2>
            <p className="mt-0.5 text-xs text-gray-400">
              React / Playwright renderer · vector charts · A4 print layout
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="border-amber-300 bg-amber-50 text-xs text-amber-600"
            >
              Beta
            </Badge>
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.print()}
              className="text-xs"
            >
              Print
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => saveVersion("draft")}
              disabled={generating}
              className="text-xs"
            >
              Save Draft
            </Button>
            <Button
              size="sm"
              onClick={() => saveVersion("review")}
              disabled={generating}
              className="bg-green-700 text-xs text-white hover:bg-green-800"
            >
              {generating ? (
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 animate-spin rounded-full border border-white border-t-transparent" />
                  Generating…
                </span>
              ) : (
                "⬇ Save for Review"
              )}
            </Button>
          </div>
        </div>
        {generateError && (
          <div className="border-t border-red-100 bg-red-50 px-5 py-2 text-xs text-red-700">
            <span className="font-medium">PDF generation failed: </span>
            {generateError}
            {generateError.toLowerCase().includes("frontend_base_url") && (
              <span className="ml-1 text-red-500">
                — set the <code className="font-mono">FRONTEND_BASE_URL</code> environment variable on the API service in Render.
              </span>
            )}
          </div>
        )}
      </div>
      <div className="advanced-report-controls mb-4" />

      {/* Version history */}
      <div className="advanced-report-controls mb-6 rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-widest">
            Saved Versions
          </span>
          {versionsLoading && (
            <span className="text-xs text-gray-400">Loading…</span>
          )}
        </div>
        {versions.length === 0 && !versionsLoading ? (
          <p className="px-5 py-4 text-xs text-gray-400">
            No saved versions yet — click "Save for Review" to create one.
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="py-2 pl-5 text-left font-medium text-gray-500">Version</th>
                <th className="py-2 text-left font-medium text-gray-500">Status</th>
                <th className="py-2 text-left font-medium text-gray-500">Saved</th>
                <th className="py-2 text-left font-medium text-gray-500">By</th>
                <th className="py-2 pr-5 text-right font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {versions.map(v => {
                const isFinal = v.status?.toLowerCase() === "final";
                const savedAt = v.generated_at
                  ? new Date(v.generated_at).toLocaleDateString("en-GB", {
                      day: "2-digit", month: "short", year: "numeric",
                    })
                  : "—";
                return (
                  <tr key={v.report_version_id} className="border-b border-gray-50 last:border-0">
                    <td className="py-2.5 pl-5 font-semibold text-gray-700">
                      {v.version_label ?? `v${v.version_number}`}
                    </td>
                    <td className="py-2.5">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          isFinal
                            ? "bg-green-100 text-green-700"
                            : v.status === "draft"
                              ? "bg-gray-100 text-gray-600"
                              : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {v.status ?? "review"}
                      </span>
                    </td>
                    <td className="py-2.5 text-gray-500">{savedAt}</td>
                    <td className="py-2.5 text-gray-500 max-w-[120px] truncate">
                      {v.generated_by ?? "—"}
                    </td>
                    <td className="py-2.5 pr-5">
                      <div className="flex items-center justify-end gap-2">
                        {v.download_url && (
                          <button
                            onClick={() => downloadVersion(v)}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            Download
                          </button>
                        )}
                        {!isFinal && (
                          <button
                            onClick={() => markFinal(v)}
                            disabled={markingFinal === v.report_version_id}
                            className="text-xs text-green-700 hover:underline disabled:opacity-50"
                          >
                            {markingFinal === v.report_version_id ? "…" : "Mark Final"}
                          </button>
                        )}
                        {isFinal && (
                          <span className="text-xs text-green-600 font-medium">✓ Final</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Report preview */}
      <div className="advanced-report-preview space-y-6">

        {/* ── 1. Cover page ──────────────────────────────────────────────── */}
        <CoverPage data={data} />

        {/* ── 2. Executive summary ───────────────────────────────────────── */}
        <Card className="live-report-section print:break-after-page">
          <CardHeader className="pb-3">
            <SectionHeader title="Executive Summary" />
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid grid-cols-3 gap-3">
              {SCOPE_LABELS.map(s => {
                const v = toNum(scope_totals?.[s]);
                const pct = totalEmissions > 0 ? (v / totalEmissions) * 100 : 0;
                return (
                  <div
                    key={s}
                    className="rounded-lg border border-gray-100 bg-gray-50 p-4"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <div
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: SCOPE_COLORS[s] }}
                      />
                      <span className="text-xs font-medium text-gray-500">{s}</span>
                    </div>
                    <p className="text-2xl font-bold text-gray-800">{fmt(v)}</p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      tCO₂e · {pct.toFixed(1)}%
                    </p>
                  </div>
                );
              })}
            </div>
            <div
              className="rounded-lg border p-4"
              style={{
                backgroundColor: `${BRAND}0d`,
                borderColor: `${BRAND}20`,
              }}
            >
              <p
                className="mb-1 text-xs font-semibold uppercase tracking-widest"
                style={{ color: BRAND }}
              >
                Total Footprint
              </p>
              <p className="text-3xl font-bold" style={{ color: BRAND }}>
                {fmt(totalEmissions)}{" "}
                <span className="text-base font-normal text-gray-500">tCO₂e</span>
              </p>
              {(() => {
                const bTotal = toNum(summary?.benchmark_total);
                const delta = toNum(summary?.delta_total);
                if (bTotal <= 0) return null;
                const pct = Math.abs((delta / bTotal) * 100);
                const down = delta < 0;
                return (
                  <div className="mt-3 flex items-center gap-3 pt-3 border-t border-gray-200/50">
                    <div>
                      <p className="text-xs text-gray-400">Benchmark year</p>
                      <p className="text-sm font-semibold text-gray-600">{fmt(bTotal)} tCO₂e</p>
                    </div>
                    <div
                      className={`ml-auto rounded-full px-3 py-1 text-xs font-semibold ${
                        down ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                      }`}
                    >
                      {down ? "▼" : "▲"} {fmt(pct, 1)}% vs benchmark
                    </div>
                  </div>
                );
              })()}
            </div>
          </CardContent>
        </Card>

        {/* ── 3. Background & Organisation ───────────────────────────────── */}
        <Card className="live-report-section">
          <CardHeader className="pb-3">
            <SectionHeader title="Background & Organisation" />
          </CardHeader>
          <CardContent className="space-y-5">

            {/* Narrative description */}
            {data.job_data.description && (
              <p className="text-sm text-gray-700 leading-relaxed">
                {data.job_data.description}
              </p>
            )}

            {/* Organisation details */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">
                Organisation Details
              </p>
              <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-2">
                <MetaRow label="Organisation" value={data.job_data.client_name} />
                <MetaRow label="Industry" value={data.job_data.industry} />
                <MetaRow label="Location" value={[data.job_data.city, data.job_data.country].filter(Boolean).join(", ")} />
                <MetaRow label="Employees (job)" value={data.job_data.no_of_staff} />
                <MetaRow label="Company Number" value={report_metadata?.company_number} />
                <MetaRow label="Registered Address" value={report_metadata?.registered_address} />
                <MetaRow label="Employees (reported)" value={report_metadata?.employee_number} />
                <MetaRow label="Premises Owned" value={report_metadata?.premises_owned} />
                <MetaRow label="Premises Leased" value={report_metadata?.premises_leased} />
                <MetaRow label="Vehicles Owned" value={report_metadata?.vehicles_owned} />
                <MetaRow label="Vehicles Leased" value={report_metadata?.vehicles_leased} />
              </div>
            </div>

            {/* Organisational boundary */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">
                Organisational Boundary
              </p>
              <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-2">
                <MetaRow label="Operational Control" value={boolLabel(report_metadata?.operational_control)} />
                <MetaRow label="Financial Control" value={boolLabel(report_metadata?.financial_control)} />
                <MetaRow label="Equity Share" value={boolLabel(report_metadata?.equity_share)} />
              </div>
            </div>

            {/* Commitment commentary */}
            {report_metadata?.commitment_commentary && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">
                  Commitment
                </p>
                <p className="text-sm text-gray-700 leading-relaxed">
                  {report_metadata.commitment_commentary}
                </p>
              </div>
            )}

          </CardContent>
        </Card>

        {/* ── 4. Emissions by Scope donut ────────────────────────────────── */}
        {scopeDonutData.length > 0 && (
          <Card className="live-report-section">
            <CardHeader className="pb-3">
              <SectionHeader title="Emissions by Scope" />
            </CardHeader>
            <CardContent>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={scopeDonutData}
                      cx="50%"
                      cy="50%"
                      innerRadius="62%"
                      outerRadius="82%"
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {scopeDonutData.map(entry => (
                        <Cell
                          key={entry.name}
                          fill={SCOPE_COLORS[entry.name] ?? "#999"}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number | undefined, n: string | undefined) => [v != null ? `${fmt(v)} tCO₂e` : "—", n ?? ""]}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── 5. Emissions Reduction Pathway to net-zero ─────────────────── */}
        {hasPathway && (
          <Card className="live-report-section">
            <CardHeader className="pb-3">
              <SectionHeader title={`Emissions Reduction Pathway to ${netZeroYear}`} />
            </CardHeader>
            <CardContent>
              <PathwayChart
                points={pathway2050}
                baselineYear={baselineYear}
                endYear={netZeroYear}
                interimYear={interimYear}
              />
              {report_metadata?.emissions_reduction_targets_commentary && (
                <p className="mt-4 text-sm text-gray-600 leading-relaxed">
                  {report_metadata.emissions_reduction_targets_commentary}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── 6. Pathway to interim target ───────────────────────────────── */}
        {pathwayInterim && interimYear && (
          <Card className="live-report-section">
            <CardHeader className="pb-3">
              <SectionHeader title={`Pathway to Interim Target (${interimYear})`} />
            </CardHeader>
            <CardContent>
              <PathwayChart
                points={pathwayInterim}
                baselineYear={baselineYear}
                endYear={interimYear}
              />
            </CardContent>
          </Card>
        )}

        {/* ── 7. Emissions by activity ───────────────────────────────────── */}
        {activityBarData.length > 0 && (
          <Card className="live-report-section">
            <CardHeader className="pb-3">
              <SectionHeader title="Emissions by Activity" />
            </CardHeader>
            <CardContent>
              <div style={{ height: activityChartHeight }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    layout="vertical"
                    data={activityBarData}
                    margin={{ top: 4, right: 64, left: 8, bottom: 4 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      horizontal={false}
                      stroke="#F0F0F0"
                    />
                    <XAxis
                      type="number"
                      tickFormatter={(v: number) =>
                        v.toLocaleString(undefined, { maximumFractionDigits: 0 })
                      }
                      tick={{ fontSize: 10 }}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={180}
                      tick={{ fontSize: 9 }}
                    />
                    <Tooltip
                      formatter={(v: number | undefined, _: string | undefined, props: { payload?: { fullName?: string } }) => [
                        v != null ? `${fmt(v)} tCO₂e` : "—",
                        props.payload?.fullName ?? "",
                      ]}
                    />
                    <Bar dataKey="value" name="tCO₂e" radius={[0, 3, 3, 0]}>
                      {activityBarData.map((entry, i) => (
                        <Cell key={`cell-${i}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {report_metadata?.activity_commentary && (
                <p className="mt-4 text-sm text-gray-600 leading-relaxed">
                  {report_metadata.activity_commentary}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── 8. Historical emissions trend ──────────────────────────────── */}
        {effectiveYearlyEmissions.length > 0 && (
          <Card className="live-report-section">
            <CardHeader className="pb-3">
              <SectionHeader title="Historical Emissions Trend" />
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={effectiveYearlyEmissions}
                    margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                    barCategoryGap="35%"
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" vertical={false} />
                    <XAxis
                      dataKey="year"
                      tick={{ fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tickFormatter={(v: number) =>
                        v.toLocaleString(undefined, { maximumFractionDigits: 0 })
                      }
                      tick={{ fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      width={52}
                    />
                    <Tooltip
                      formatter={(v: number | undefined, name: string | undefined) => [v != null ? `${fmt(v)} tCO₂e` : "—", name ?? ""]}
                      labelFormatter={(l: unknown) => `Year: ${l}`}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="scope1" name="Scope 1" stackId="a" fill={SCOPE_COLORS["Scope 1"]} />
                    <Bar dataKey="scope2" name="Scope 2" stackId="a" fill={SCOPE_COLORS["Scope 2"]} />
                    <Bar dataKey="scope3" name="Scope 3" stackId="a" fill={SCOPE_COLORS["Scope 3"]} radius={[3, 3, 0, 0]}>
                      <LabelList
                        dataKey="total"
                        position="top"
                        formatter={(v: unknown) => typeof v === "number" ? fmt(v, 0) : ""}
                        style={{ fontSize: 9, fill: "#6b7280" }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── 9. SECR Summary ────────────────────────────────────────────── */}
        <Card className="live-report-section">
          <CardHeader className="pb-3">
            <SectionHeader title="SECR Summary" />
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Scope totals table */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">
                GHG Emissions
              </p>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="py-2 pr-4 text-left text-xs font-semibold text-gray-500 w-1/2">Scope</th>
                    <th className="py-2 text-right text-xs font-semibold text-gray-500">tCO₂e</th>
                    <th className="py-2 pl-4 text-right text-xs font-semibold text-gray-500">% of Total</th>
                  </tr>
                </thead>
                <tbody>
                  {SCOPE_LABELS.map(s => {
                    const v = toNum(scope_totals?.[s]);
                    const pct = totalEmissions > 0 ? (v / totalEmissions) * 100 : 0;
                    return (
                      <tr key={s} className="border-b border-gray-50">
                        <td className="py-2 pr-4 text-xs text-gray-700 flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: SCOPE_COLORS[s] }}
                          />
                          {s}
                        </td>
                        <td className="py-2 text-right text-xs font-semibold text-gray-800">
                          {fmt(v)}
                        </td>
                        <td className="py-2 pl-4 text-right text-xs text-gray-500">
                          {pct.toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="border-t-2 border-gray-200">
                    <td className="py-2 pr-4 text-xs font-bold text-gray-800">Total</td>
                    <td className="py-2 text-right text-xs font-bold text-gray-800">
                      {fmt(totalEmissions)}
                    </td>
                    <td className="py-2 pl-4 text-right text-xs font-bold text-gray-800">100%</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Energy consumption (shown only if data is populated) */}
            {hasSecrEnergy && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">
                  Energy Consumption
                </p>
                <table className="w-full text-sm border-collapse">
                  <tbody>
                    {energyUkKwh > 0 && (
                      <tr className="border-b border-gray-50">
                        <td className="py-2 pr-4 text-xs text-gray-600 w-2/3">UK Energy Consumption</td>
                        <td className="py-2 text-right text-xs font-semibold text-gray-800">{fmtEnergy(energyUkKwh)}</td>
                      </tr>
                    )}
                    {energyNonUkKwh > 0 && (
                      <tr className="border-b border-gray-50">
                        <td className="py-2 pr-4 text-xs text-gray-600">Non-UK Energy Consumption</td>
                        <td className="py-2 text-right text-xs font-semibold text-gray-800">{fmtEnergy(energyNonUkKwh)}</td>
                      </tr>
                    )}
                    {renewableKwh > 0 && (
                      <tr className="border-b border-gray-50">
                        <td className="py-2 pr-4 text-xs text-gray-600">Renewable Energy</td>
                        <td className="py-2 text-right text-xs font-semibold text-gray-800">
                          {fmtEnergy(renewableKwh)}{renewablePct > 0 ? ` (${fmt(renewablePct, 1)}%)` : ""}
                        </td>
                      </tr>
                    )}
                    {energyEmissionsTco2e > 0 && (
                      <tr className="border-b border-gray-50">
                        <td className="py-2 pr-4 text-xs text-gray-600">Energy-related Emissions</td>
                        <td className="py-2 text-right text-xs font-semibold text-gray-800">{fmt(energyEmissionsTco2e)} tCO₂e</td>
                      </tr>
                    )}
                    {report_metadata?.energy_reporting_basis && (
                      <tr className="border-b border-gray-50">
                        <td className="py-2 pr-4 text-xs text-gray-600">Reporting Basis</td>
                        <td className="py-2 text-right text-xs text-gray-700">{report_metadata.energy_reporting_basis}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── 10. Carbon intensity metrics ───────────────────────────────── */}
        {intensity_metrics && Object.keys(intensity_metrics).length > 0 && (
          <Card className="live-report-section">
            <CardHeader className="pb-3">
              <SectionHeader title="Carbon Intensity Metrics" />
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(intensity_metrics).map(([key, m]) => {
                  const v = toNum(m.value);
                  const d = toNum(m.divider);
                  const intensity = d > 0 ? v / d : null;
                  return (
                    <div
                      key={key}
                      className="rounded-lg border border-gray-100 bg-gray-50 p-4"
                    >
                      <p className="mb-1 text-xs text-gray-500">{m.label ?? key}</p>
                      <p className="text-xl font-bold text-gray-800">
                        {intensity != null ? fmt(intensity, 3) : "—"}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-400">tCO₂e per unit</p>
                    </div>
                  );
                })}
              </div>
              {report_metadata?.intensity_commentary && (
                <p className="mt-4 text-sm text-gray-600 leading-relaxed">
                  {report_metadata.intensity_commentary}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── 11. Carbon reduction actions ───────────────────────────────── */}
        {(job_actions?.grouped?.length ?? 0) > 0 && (
          <Card className="live-report-section">
            <CardHeader className="pb-3">
              <SectionHeader title="Carbon Reduction Actions" />
            </CardHeader>
            <CardContent className="space-y-5">
              {job_actions?.grouped?.map((group, gi) => (
                <div key={gi}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                      {group.label ?? group.term}
                    </span>
                    {group.count != null && (
                      <Badge variant="secondary" className="text-xs">
                        {group.count}
                      </Badge>
                    )}
                  </div>
                  <ul className="space-y-1 pl-3">
                    {(group.items ?? []).slice(0, 6).map((item, ii) => (
                      <li
                        key={ii}
                        className="flex items-start gap-2 text-sm text-gray-700"
                      >
                        <span className="mt-0.5 text-green-600">•</span>
                        <span>{String(item.title ?? item.action ?? "")}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {report_metadata?.data_confidence_commentary && (
                <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">
                    Data Confidence
                  </p>
                  <p className="text-sm text-gray-700 leading-relaxed">
                    {report_metadata.data_confidence_commentary}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── 12. Standards & Methodology ────────────────────────────────── */}
        <Card className="live-report-section">
          <CardHeader className="pb-3">
            <SectionHeader title="Standards & Methodology" />
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-gray-700">
            <table className="w-full border-collapse text-xs">
              <tbody>
                <tr className="border-b border-gray-100">
                  <td className="py-2 pr-4 text-gray-500 w-1/3 align-top">Framework</td>
                  <td className="py-2 font-medium">
                    {report_metadata?.methodologies_used ?? "GHG Protocol Corporate Standard"}
                  </td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-2 pr-4 text-gray-500 align-top">Emission Factors</td>
                  <td className="py-2 font-medium">
                    {report_metadata?.datasets_names ?? "DESNZ Greenhouse Gas Conversion Factors"}
                  </td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-2 pr-4 text-gray-500 align-top">Reporting Standard</td>
                  <td className="py-2 font-medium">ISO 14064-1 / GHG Protocol</td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-2 pr-4 text-gray-500 align-top">Scope Coverage</td>
                  <td className="py-2 font-medium">Scope 1, 2 and 3 (material categories)</td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-2 pr-4 text-gray-500 align-top">Net-Zero Standard</td>
                  <td className="py-2 font-medium">SBTi Net-Zero Standard / Science Based Targets</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-gray-500 align-top">Prepared by</td>
                  <td className="py-2 font-medium">Net Zero International Limited</td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* ── 13. Declaration / Sign-off ──────────────────────────────────── */}
        {(report_metadata?.consultant_name || report_metadata?.client_signee_name) && (
          <Card className="live-report-section">
            <CardHeader className="pb-3">
              <SectionHeader title="Declaration" />
            </CardHeader>
            <CardContent className="space-y-5">
              <p className="text-sm text-gray-600 leading-relaxed">
                We confirm that the information contained in this report is accurate and prepared
                in accordance with the GHG Protocol Corporate Standard and the relevant emission
                factor datasets. This report has been reviewed and approved by the signatories below.
              </p>
              <div className="grid grid-cols-2 gap-6">
                {/* Consultant sign-off */}
                {report_metadata?.consultant_name && (
                  <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">
                      Prepared by
                    </p>
                    <p className="text-sm font-semibold text-gray-800">
                      {report_metadata.consultant_name}
                    </p>
                    {report_metadata.consultant_position && (
                      <p className="text-xs text-gray-500">{report_metadata.consultant_position}</p>
                    )}
                    {report_metadata.consultant_signature_date && (
                      <p className="mt-2 text-xs text-gray-400">
                        Date: {String(report_metadata.consultant_signature_date)}
                      </p>
                    )}
                    <div className="mt-4 h-10 border-b border-dashed border-gray-300" />
                  </div>
                )}

                {/* Client sign-off */}
                {report_metadata?.client_signee_name && (
                  <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">
                      Approved by
                    </p>
                    <p className="text-sm font-semibold text-gray-800">
                      {report_metadata.client_signee_name}
                    </p>
                    {report_metadata.client_signee_position && (
                      <p className="text-xs text-gray-500">{report_metadata.client_signee_position}</p>
                    )}
                    {report_metadata.client_signature_date && (
                      <p className="mt-2 text-xs text-gray-400">
                        Date: {String(report_metadata.client_signature_date)}
                      </p>
                    )}
                    <div className="mt-4 h-10 border-b border-dashed border-gray-300" />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── 14. Glossary ───────────────────────────────────────────────── */}
        {hasGlossary && (
          <Card className="live-report-section">
            <CardHeader className="pb-3">
              <SectionHeader title="Glossary" />
            </CardHeader>
            <CardContent>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="py-2 pr-4 text-left text-xs font-semibold text-gray-500 w-1/4">Term</th>
                    <th className="py-2 text-left text-xs font-semibold text-gray-500">Definition</th>
                  </tr>
                </thead>
                <tbody>
                  {(glossary_cards ?? []).map((card, i) => (
                    <tr key={i} className="border-b border-gray-50 align-top">
                      <td className="py-2.5 pr-4 text-xs font-semibold text-gray-700 align-top">
                        {card.term}
                      </td>
                      <td className="py-2.5 text-xs text-gray-600 leading-relaxed">
                        {card.definition}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {/* ── 15. Appendix — Full Emissions Audit ────────────────────────── */}
        {hasAppendix && (
          <Card className="live-report-section">
            <CardHeader className="pb-3">
              <SectionHeader title="Appendix — Full Emissions Audit" />
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b-2 border-gray-200">
                      <th className="py-2 pr-3 text-left font-semibold text-gray-500">Site</th>
                      <th className="py-2 pr-3 text-left font-semibold text-gray-500">Scope</th>
                      <th className="py-2 pr-3 text-left font-semibold text-gray-500">Activity Group</th>
                      <th className="py-2 pr-3 text-left font-semibold text-gray-500">Category</th>
                      <th className="py-2 pr-3 text-right font-semibold text-gray-500">Qty</th>
                      <th className="py-2 pr-3 text-left font-semibold text-gray-500">Unit</th>
                      <th className="py-2 text-right font-semibold text-gray-500">tCO₂e</th>
                    </tr>
                  </thead>
                  <tbody>
                    {appendixRows.map((row, i) => (
                      <tr
                        key={i}
                        className="border-b border-gray-50 hover:bg-gray-50/60"
                      >
                        <td className="py-1.5 pr-3 text-gray-600">{row.site_name ?? "—"}</td>
                        <td className="py-1.5 pr-3 text-gray-600">{row.scope ?? "—"}</td>
                        <td className="py-1.5 pr-3 text-gray-600">{row.activity_group ?? "—"}</td>
                        <td className="py-1.5 pr-3 text-gray-600 max-w-[180px] truncate">
                          {row.category ?? row.emission_type ?? "—"}
                        </td>
                        <td className="py-1.5 pr-3 text-right text-gray-700">
                          {row.qty != null ? fmt(toNum(row.qty), 2) : "—"}
                        </td>
                        <td className="py-1.5 pr-3 text-gray-500">{row.uom ?? "—"}</td>
                        <td className="py-1.5 text-right font-semibold text-gray-800">
                          {row.emissions != null ? fmt(toNum(row.emissions)) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-300">
                      <td colSpan={6} className="py-2 pr-3 text-xs font-bold text-gray-700">
                        Total
                      </td>
                      <td className="py-2 text-right text-xs font-bold text-gray-800">
                        {fmt(appendixRows.reduce((s, r) => s + toNum(r.emissions), 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

      </div>
    </>
  );
}
