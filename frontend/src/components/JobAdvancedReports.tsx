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
  report_metadata?: Record<string, unknown>;
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
};

// ─── Constants ────────────────────────────────────────────────────────────────

const SCOPE_LABELS = ["Scope 1", "Scope 2", "Scope 3"] as const;

const SCOPE_COLORS: Record<string, string> = {
  "Scope 1": "#4472C4",
  "Scope 2": "#ED7D31",
  "Scope 3": "#70AD47",
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

// ─── Main component ───────────────────────────────────────────────────────────

export default function JobAdvancedReports({
  jobId,
  baseUrl,
}: {
  jobId: number;
  baseUrl: string;
}) {
  const [data, setData] = useState<LiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    setLoading(true);
    setFetchError(null);
    fetch(`${baseUrl}/jobs/${jobId}/live-report-data`, { credentials: "include" })
      .then(r => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json() as Promise<LiveData>;
      })
      .then(d => setData(d))
      .catch(e => setFetchError(String(e)))
      .finally(() => setLoading(false));
  }, [jobId, baseUrl]);

  async function downloadPDF() {
    setGenerating(true);
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/report-live-pdf`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `report-${jobId}-advanced.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`PDF generation failed: ${String(e)}`);
    } finally {
      setGenerating(false);
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
      <div className="advanced-report-controls mb-6 flex items-center justify-between rounded-lg border border-gray-200 bg-white px-5 py-3 shadow-sm">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">Advanced Reports</h2>
          <p className="mt-0.5 text-xs text-gray-400">
            React / Playwright renderer · vector charts · A4 print layout
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge
            variant="outline"
            className="border-amber-300 bg-amber-50 text-xs text-amber-600"
          >
            Beta
          </Badge>
          <Button
            size="sm"
            onClick={downloadPDF}
            disabled={generating}
            className="bg-green-700 text-xs text-white hover:bg-green-800"
          >
            {generating ? (
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 animate-spin rounded-full border border-white border-t-transparent" />
                Generating…
              </span>
            ) : (
              "⬇ Generate PDF"
            )}
          </Button>
        </div>
      </div>

      {/* Report preview */}
      <div className="advanced-report-preview space-y-6">

        {/* ── 1. Cover page ──────────────────────────────────────────────── */}
        <CoverPage data={data} />

        {/* ── 2. Executive summary ───────────────────────────────────────── */}
        <Card className="live-report-section">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold" style={{ color: BRAND }}>
              Executive Summary
            </CardTitle>
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
            </div>
          </CardContent>
        </Card>

        {/* ── 3. Scope breakdown donut ───────────────────────────────────── */}
        {scopeDonutData.length > 0 && (
          <Card className="live-report-section">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold" style={{ color: BRAND }}>
                Emissions by Scope
              </CardTitle>
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

        {/* ── 4. Emissions Reduction Pathway to net-zero ─────────────────── */}
        {hasPathway && (
          <Card className="live-report-section">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold" style={{ color: BRAND }}>
                Emissions Reduction Pathway to {netZeroYear}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <PathwayChart
                points={pathway2050}
                baselineYear={baselineYear}
                endYear={netZeroYear}
                interimYear={interimYear}
              />
            </CardContent>
          </Card>
        )}

        {/* ── 5. Pathway to interim target ───────────────────────────────── */}
        {pathwayInterim && interimYear && (
          <Card className="live-report-section">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold" style={{ color: BRAND }}>
                Pathway to Interim Target ({interimYear})
              </CardTitle>
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

        {/* ── 6. Emissions by activity ───────────────────────────────────── */}
        {activityBarData.length > 0 && (
          <Card className="live-report-section">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold" style={{ color: BRAND }}>
                Emissions by Activity
              </CardTitle>
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
            </CardContent>
          </Card>
        )}

        {/* ── 7. Carbon intensity metrics ────────────────────────────────── */}
        {intensity_metrics && Object.keys(intensity_metrics).length > 0 && (
          <Card className="live-report-section">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold" style={{ color: BRAND }}>
                Carbon Intensity Metrics
              </CardTitle>
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
            </CardContent>
          </Card>
        )}

        {/* ── 8. Carbon reduction actions ────────────────────────────────── */}
        {(job_actions?.grouped?.length ?? 0) > 0 && (
          <Card className="live-report-section">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold" style={{ color: BRAND }}>
                Carbon Reduction Actions
              </CardTitle>
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
            </CardContent>
          </Card>
        )}

        {/* Coming soon — placeholder for Phase 2 sections */}
        <Card className="live-report-section border-dashed border-gray-200 bg-gray-50/60">
          <CardContent className="py-6 text-center">
            <p className="text-sm font-medium text-gray-500">
              More sections in progress
            </p>
            <p className="mt-1 text-xs text-gray-400">
              Background & Methodology · SECR Table · Full Glossary · Appendix · Declaration
            </p>
          </CardContent>
        </Card>

      </div>
    </>
  );
}
