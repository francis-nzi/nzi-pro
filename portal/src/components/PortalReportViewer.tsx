"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  LabelList,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/auth";
import { formatDate } from "@/lib/format";

/** Single-letter badge + colour for the Planned Initiatives table only - the term picker and
 * Outputs -> Actions editor keep the fuller "Short term"/"Medium term"/"Long term" wording.
 * Colours match termBadgeVariant() in JobActions.tsx for consistency across the app. */
const PLANNED_INITIATIVES_TERM_META: Record<string, { label: string; className: string }> = {
  short: { label: "S", className: "border-green-400 bg-green-50 text-green-700" },
  medium: { label: "M", className: "border-amber-400 bg-amber-50 text-amber-700" },
  long: { label: "L", className: "border-sky-400 bg-sky-50 text-sky-700" },
};

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportJob = {
  job_id: number;
  client_db_id: number;
  job_number?: string | null;
  title?: string | null;
  reporting_period_start?: string | null;
  reporting_period_end?: string | null;
  reporting_year?: number | string | null;
  status?: string | null;
  client_name?: string | null;
  logo_url?: string | null;
  description?: string | null;
  industry?: string | null;
  no_of_staff?: number | null;
  city?: string | null;
  country?: string | null;
  benchmark_period_start?: string | null;
  benchmark_period_end?: string | null;
};

type ReportMetadata = {
  report_title?: string | null;
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
  methodologies_used?: string | null;
  datasets_names?: string | null;
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

type SiteOverallRow = { site_name?: string | null; total?: number | null; pct_total?: number | null };
type SiteScopeRow = { site_name?: string | null; scope_1?: number | null; scope_2?: number | null; scope_3?: number | null; total?: number | null };
type SiteActivityRow = { site_name?: string | null; energy?: number | null; business_travel?: number | null; employee_commuting?: number | null; pgs?: number | null; other?: number | null; total?: number | null };

type SiteBreakdowns = {
  show_site_tables?: boolean;
  show_appendix?: boolean;
  site_count?: number;
  overall?: SiteOverallRow[];
  scope?: SiteScopeRow[];
  activity?: SiteActivityRow[];
  appendix_rows?: AppendixRow[];
};

type EmissionCategory = {
  scope?: string | null;
  dataset_category?: string | null;
  lookup_category?: string | null;
  category?: string | null;
  report_label?: string | null;
  activity_group?: string | null;
  emissions?: number | null;
  calc_tco2e?: number | null;
};

type GlossaryCard = { term: string; definition: string };

type YearlyEmission = { year: number; scope1: number; scope2: number; scope3: number; total: number; intensity_by_metric?: Record<string, number> };

type LiveData = {
  job_data: ReportJob;
  scope_totals?: Record<string, number | null | undefined>;
  benchmark_totals?: Record<string, number | null | undefined>;
  categories?: EmissionCategory[];
  benchmark_categories?: EmissionCategory[];
  activity_totals?: Record<string, number | null>;
  activity_group_order?: string[];
  activity_group_colors?: Record<string, string>;
  intensity_metrics?: Record<string, { label?: string; value?: number | null; divider?: number | null }>;
  benchmark_intensity_metrics?: Record<string, { label?: string; value?: number | null; divider?: number | null }>;
  job_actions?: {
    items?: Array<Record<string, unknown>>;
    grouped?: Array<{ term?: string; label?: string; count?: number; items?: Array<Record<string, unknown>> }>;
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
    top_category?: { category?: string | null; scope?: string | null; emissions?: number | null; report_label?: string | null } | null;
  };
  site_breakdowns?: SiteBreakdowns;
  glossary_cards?: GlossaryCard[];
  yearly_emissions?: YearlyEmission[];
  nzi_logo_src?: string | null;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const SCOPE_LABELS = ["Scope 1", "Scope 2", "Scope 3"] as const;
const SCOPE_COLORS: Record<string, string> = { "Scope 1": "#0f766e", "Scope 2": "#0891b2", "Scope 3": "#38bdf8" };
const BRAND = "#1c3a2c";
const INTENSITY_COLORS = ["#0ea5e9", "#14b8a6", "#f97316", "#8b5cf6"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toNum(v: unknown): number {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function toYearNumber(start: string | null | undefined, end: string | null | undefined): number | null {
  const sy = start ? new Date(start).getFullYear() : null;
  const ey = end ? new Date(end).getFullYear() : null;
  return ey ?? sy ?? null;
}

// Client logos stored as a relative /uploads/... path only resolve against
// whichever domain is actually serving the Python API's static files -- not
// against the portal's own domain. Route them through the portal's own
// /api/backend proxy (next.config.js rewrites this to the real API base),
// matching the equivalent resolveLogoPreviewSrc helper in the CRM app.
function resolveLogoPreviewSrc(raw: string | null | undefined): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:")) {
    return value;
  }
  if (value.startsWith("/uploads/")) {
    return `/api/backend${value}`;
  }
  return value;
}

const ACTIVITY_COLORS = ["#0ea5e9", "#14b8a6", "#f97316", "#8b5cf6", "#22c55e", "#ef4444", "#64748b", "#eab308"];

// Same grouping + scaling as the CRM's buildActivityBarData
// (frontend/src/components/report-widgets/activity-data.ts) -- groups by the
// granular category field (falling back through dataset/lookup/report_label/
// activity_group) rather than the coarser activity_totals bucket, which only
// has ~5 broad groups and mislabels categories like Capital Goods as "Other".
function buildActivityBarData(rows: EmissionCategory[], targetTotal = 0, limit = 8) {
  const map = new Map<string, number>();
  rows.forEach((row) => {
    const raw = String(row.dataset_category || row.lookup_category || row.category || row.report_label || row.activity_group || "").trim();
    const label = raw.length > 0 ? raw : "Unknown";
    map.set(label, (map.get(label) ?? 0) + toNum(row.calc_tco2e ?? row.emissions ?? 0));
  });

  const rawEntries = Array.from(map.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);

  const rawTotal = rawEntries.reduce((acc, row) => acc + row.value, 0);
  const scale = rawTotal > 0 && targetTotal > 0 && Math.abs(rawTotal - targetTotal) > 0.05 ? targetTotal / rawTotal : 1;

  return rawEntries.map((row, index) => ({
    name: row.name.length > 26 ? row.name.slice(0, 24) + "…" : row.name,
    fullName: row.name,
    value: row.value * scale,
    fill: ACTIVITY_COLORS[index % ACTIVITY_COLORS.length],
  }));
}

function fmt(v: number, dp = 1): string {
  return v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function fmtSignatureDate(raw: string | null | undefined): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function boolLabel(v: boolean | null | undefined): string {
  if (v == null) return "—";
  return v ? "Yes" : "No";
}

function formatTooltipValue(value: unknown, label: unknown = ""): [string, string] {
  return [value != null ? `${fmt(Number(value))} tCO₂e` : "—", String(label ?? "")];
}

function formatTooltipValueWithName(value: unknown, name: unknown, fullName?: string): [string, string] {
  return [value != null ? `${fmt(Number(value))} tCO₂e` : "—", fullName ?? String(name ?? "")];
}

// ─── WrapLegend ──────────────────────────────────────────────────────────────

type LegendEntry = { color?: string; value?: string; type?: string };
function WrapLegend({ payload, center }: { payload?: LegendEntry[]; center?: boolean }) {
  // Recharts hands a custom `content` renderer the full payload regardless of
  // each series' `legendType` -- only the *default* built-in legend renderer
  // respects `legendType="none"`, and (confirmed against this repo's two
  // Recharts majors: portal on 2.12.7, CRM's frontend app on 3.7.0) even that
  // default behaviour isn't consistent across versions. Filter explicitly
  // here instead of relying on either.
  const visible = (payload ?? []).filter((entry) => entry.type !== "none");
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: center ? "center" : "flex-start", gap: "3px 10px", fontSize: 10, paddingTop: 4 }}>
      {visible.map((entry, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center", gap: 3, whiteSpace: "nowrap" }}>
          <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", backgroundColor: entry.color ?? "#999", flexShrink: 0 }} />
          <span>{entry.value}</span>
        </span>
      ))}
    </div>
  );
}

// ─── NetZeroTrendChart ────────────────────────────────────────────────────────

function NetZeroTrendChart({
  yearlyEmissions, baselineYear, endYear, interimYear, interimPct, targetPct,
  scope1Fallback, scope2Fallback, scope3Fallback,
}: {
  yearlyEmissions: YearlyEmission[]; baselineYear: number; endYear: number;
  interimYear?: number | null; interimPct?: number; targetPct?: number;
  scope1Fallback: number; scope2Fallback: number; scope3Fallback: number;
}) {
  const chartData = useMemo(() => {
    const firstHistoricalYear = yearlyEmissions.length > 0 ? yearlyEmissions[0].year : null;
    const bYear = baselineYear > 1900 ? baselineYear : (firstHistoricalYear ?? new Date().getFullYear() - 1);
    const benchmarkRow = yearlyEmissions.find(r => r.year === bYear);
    const benchS1 = benchmarkRow ? benchmarkRow.scope1 : scope1Fallback;
    const benchS2 = benchmarkRow ? benchmarkRow.scope2 : scope2Fallback;
    const benchS3 = benchmarkRow ? benchmarkRow.scope3 : scope3Fallback;
    const finalFactor = (100 - (targetPct ?? 100)) / 100;
    const iYear = interimYear && interimYear > bYear && interimYear < endYear ? interimYear : null;
    const iPct = interimPct ?? 50;

    const forecastScope = (bench: number, year: number): number => {
      if (year <= bYear) return bench;
      const finalTarget = bench * finalFactor;
      const iTarget = iYear != null ? bench * (1 - iPct / 100) : null;
      if (iYear != null && iTarget != null && year <= iYear) {
        const span = iYear - bYear;
        const t = span > 0 ? (year - bYear) / span : 1;
        return bench + (iTarget - bench) * t;
      }
      const segStart = iYear ?? bYear;
      const segVal = iTarget ?? bench;
      const span = endYear - segStart;
      const t = span > 0 ? (year - segStart) / span : 1;
      return Math.max(segVal + (finalTarget - segVal) * t, 0);
    };

    const yearSet = new Set<number>();
    for (let y = bYear; y <= endYear; y++) yearSet.add(y);
    yearlyEmissions.forEach(r => { if (r.year >= bYear && r.year <= endYear) yearSet.add(r.year); });
    const years = Array.from(yearSet).sort((a, b) => a - b);

    return years.map(year => {
      const actual = yearlyEmissions.find(r => r.year === year);
      const showTarget = year >= bYear;
      return {
        year,
        actual_total: actual ? actual.total : null,
        actual_s1: actual ? actual.scope1 : null,
        actual_s2: actual ? actual.scope2 : null,
        actual_s3: actual ? actual.scope3 : null,
        target_total: showTarget ? forecastScope(benchS1, year) + forecastScope(benchS2, year) + forecastScope(benchS3, year) : null,
        target_s1: showTarget ? forecastScope(benchS1, year) : null,
        target_s2: showTarget && benchS2 > 0 ? forecastScope(benchS2, year) : undefined,
        target_s3: showTarget ? forecastScope(benchS3, year) : null,
      };
    });
  }, [yearlyEmissions, baselineYear, endYear, interimYear, interimPct, targetPct,
      scope1Fallback, scope2Fallback, scope3Fallback]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasScope2 = (chartData[0]?.target_s2 ?? 0) > 0;
  const tickYears = useMemo(() =>
    chartData.filter(d => d.year === chartData[0]?.year || d.year === endYear || d.year % 5 === 0).map(d => d.year),
    [chartData, endYear],
  );

  return (
    <div className="h-[320px]">
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={chartData} margin={{ top: 5, right: 24, left: 8, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="year" ticks={tickYears} tickFormatter={(v: number) => String(v)} tick={{ fontSize: 10 }} />
          <YAxis tickFormatter={(v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 })} tick={{ fontSize: 10 }} />
          <Tooltip
            content={({ active, label, payload }: any) => {
              if (!active || !payload?.length) return null;
              const pt = (payload as Array<{ dataKey: string; value: unknown }>).find(p => p.dataKey === "actual_total");
              const hasActual = pt?.value != null;
              const rows = [
                { label: "Total", actual: "actual_total", target: "target_total" },
                { label: "Scope 1", actual: "actual_s1", target: "target_s1" },
                ...(hasScope2 ? [{ label: "Scope 2", actual: "actual_s2", target: "target_s2" }] : []),
                { label: "Scope 3", actual: "actual_s3", target: "target_s3" },
              ];
              return (
                <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 6, padding: "8px 12px", fontSize: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Year: {label}</div>
                  {rows.map(r => {
                    const entry = (payload as Array<{ dataKey: string; value: unknown }>).find(p => p.dataKey === (hasActual ? r.actual : r.target));
                    const val = entry?.value;
                    if (val == null) return null;
                    return (
                      <div key={r.label} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                        <span>{r.label}</span>
                        <span style={{ fontWeight: 500 }}>{fmt(Number(val))} tCO₂e</span>
                      </div>
                    );
                  })}
                </div>
              );
            }}
          />
          <Legend content={(p) => <WrapLegend payload={(p.payload as LegendEntry[] | undefined)} />} />
          {interimYear && interimYear > baselineYear && interimYear < endYear && (
            <ReferenceLine x={interimYear} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: "Interim", position: "top", fill: "#f59e0b", fontSize: 9 }} />
          )}
          <ReferenceLine x={endYear} stroke="#16a34a" strokeDasharray="3 3" label={{ value: "Net Zero", position: "top", fill: "#16a34a", fontSize: 9 }} />
          <Line type="monotone" dataKey="actual_total" name="Total" stroke="#0f766e" strokeWidth={3} dot={{ r: 5 }} activeDot={{ r: 6 }} connectNulls={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="actual_s1" name="Scope 1" stroke={SCOPE_COLORS["Scope 1"]} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
          {hasScope2 && <Line type="monotone" dataKey="actual_s2" name="Scope 2" stroke={SCOPE_COLORS["Scope 2"]} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />}
          <Line type="monotone" dataKey="actual_s3" name="Scope 3" stroke={SCOPE_COLORS["Scope 3"]} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="target_total" name="Total (target)" stroke="#0f766e" strokeWidth={2} strokeDasharray="5 4" dot={false} legendType="none" isAnimationActive={false} />
          <Line type="monotone" dataKey="target_s1" name="Scope 1 (target)" stroke={SCOPE_COLORS["Scope 1"]} strokeWidth={1.5} strokeDasharray="5 4" dot={false} legendType="none" isAnimationActive={false} />
          {hasScope2 && <Line type="monotone" dataKey="target_s2" name="Scope 2 (target)" stroke={SCOPE_COLORS["Scope 2"]} strokeWidth={1.5} strokeDasharray="5 4" dot={false} legendType="none" isAnimationActive={false} />}
          <Line type="monotone" dataKey="target_s3" name="Scope 3 (target)" stroke={SCOPE_COLORS["Scope 3"]} strokeWidth={1.5} strokeDasharray="5 4" dot={false} legendType="none" isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── IntensityPathwayChart ────────────────────────────────────────────────────

function IntensityPathwayChart({
  yearlyEmissions, baselineYear, endYear, interimYear, interimS1Pct, interimS2Pct, interimS3Pct,
  targetPct, scope1Fallback, scope2Fallback, scope3Fallback, intensityMetrics,
}: {
  yearlyEmissions: YearlyEmission[]; baselineYear: number; endYear: number;
  interimYear?: number | null; interimS1Pct?: number; interimS2Pct?: number; interimS3Pct?: number;
  targetPct?: number; scope1Fallback: number; scope2Fallback: number; scope3Fallback: number;
  intensityMetrics: Record<string, { label?: string; value?: number | null; divider?: number | null }>;
}) {
  const metricEntries = useMemo(() =>
    Object.entries(intensityMetrics)
      .map(([key, m]) => ({ key, label: m.label?.trim() || key, value: toNum(m.value), divider: toNum(m.divider) || 1 }))
      .filter(e => e.value > 0).slice(0, 4),
    [intensityMetrics],
  );

  const chartData = useMemo(() => {
    if (metricEntries.length === 0) return [];
    const bYear = baselineYear > 1900 ? baselineYear : (yearlyEmissions[0]?.year ?? new Date().getFullYear() - 1);
    const benchmarkRow = yearlyEmissions.find(r => r.year === bYear);
    const bS1 = benchmarkRow ? benchmarkRow.scope1 : scope1Fallback;
    const bS2 = benchmarkRow ? benchmarkRow.scope2 : scope2Fallback;
    const bS3 = benchmarkRow ? benchmarkRow.scope3 : scope3Fallback;
    const finalFactor = (100 - (targetPct ?? 100)) / 100;
    const iYear = interimYear && interimYear > bYear && interimYear < endYear ? interimYear : null;

    const forecastScope = (bench: number, iPct: number, year: number): number => {
      if (year <= bYear) return bench;
      const finalTarget = bench * finalFactor;
      const iTarget = iYear != null ? bench * (1 - iPct / 100) : null;
      if (iYear != null && iTarget != null && year <= iYear) {
        const span = iYear - bYear;
        const t = span > 0 ? (year - bYear) / span : 1;
        return bench + (iTarget - bench) * t;
      }
      const segStart = iYear ?? bYear;
      const segVal = iTarget ?? bench;
      const span = endYear - segStart;
      const t = span > 0 ? (year - segStart) / span : 1;
      return Math.max(segVal + (finalTarget - segVal) * t, 0);
    };

    const forecastTotal = (year: number) =>
      forecastScope(bS1, interimS1Pct ?? 50, year) +
      forecastScope(bS2, interimS2Pct ?? 50, year) +
      forecastScope(bS3, interimS3Pct ?? 50, year);

    const yearSet = new Set<number>();
    for (let y = bYear; y <= endYear; y++) yearSet.add(y);
    yearlyEmissions.forEach(r => { if (r.year >= bYear && r.year <= endYear) yearSet.add(r.year); });
    const years = Array.from(yearSet).sort((a, b) => a - b);

    const benchTotal = bS1 + bS2 + bS3 || 1;

    return years.map(year => {
      const actual = yearlyEmissions.find(r => r.year === year);
      const forecast = forecastTotal(year);
      const forecastFraction = forecast / benchTotal;
      const row: Record<string, number | string | null> = { year };
      metricEntries.forEach(entry => {
        if (actual) {
          const perYear = actual.intensity_by_metric?.[entry.key];
          row[`${entry.label}_actual`] = perYear != null
            ? perYear
            : parseFloat(((actual.total * entry.divider) / entry.value).toFixed(3));
        } else {
          row[`${entry.label}_actual`] = null;
        }
        if (year >= bYear) {
          const benchIntensity = benchmarkRow?.intensity_by_metric?.[entry.key]
            ?? parseFloat(((benchTotal * entry.divider) / entry.value).toFixed(3));
          row[`${entry.label}_target`] = parseFloat((benchIntensity * forecastFraction).toFixed(3));
        } else {
          row[`${entry.label}_target`] = null;
        }
      });
      return row;
    });
  }, [metricEntries, yearlyEmissions, baselineYear, endYear, interimYear,
      interimS1Pct, interimS2Pct, interimS3Pct, targetPct,
      scope1Fallback, scope2Fallback, scope3Fallback]); // eslint-disable-line react-hooks/exhaustive-deps

  const tickYears = useMemo(() =>
    chartData.filter(d => d.year === chartData[0]?.year || d.year === endYear || Number(d.year) % 5 === 0).map(d => Number(d.year)),
    [chartData, endYear],
  );

  if (chartData.length === 0 || metricEntries.length === 0) return null;

  return (
    <div className="h-[320px]">
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={chartData} margin={{ top: 5, right: 24, left: 8, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="year" ticks={tickYears} tickFormatter={(v: number) => String(v)} tick={{ fontSize: 10 }} />
          <YAxis tickFormatter={(v: number) => v.toFixed(1)} tick={{ fontSize: 10 }} />
          <Tooltip formatter={((value: unknown, label: unknown) => [value != null ? `${Number(value).toFixed(3)} tCO₂e` : "—", String(label ?? "")]) as any} labelFormatter={(label: unknown) => `Year: ${label}`} />
          <Legend content={(p) => <WrapLegend payload={p.payload as LegendEntry[] | undefined} center />} />
          {interimYear && interimYear > baselineYear && interimYear < endYear && (
            <ReferenceLine x={interimYear} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: "Interim", position: "top", fill: "#f59e0b", fontSize: 9 }} />
          )}
          <ReferenceLine x={endYear} stroke="#16a34a" strokeDasharray="3 3" label={{ value: "Net Zero", position: "top", fill: "#16a34a", fontSize: 9 }} />
          {metricEntries.flatMap((entry, index) => [
            <Line key={`${entry.key}_actual`} type="monotone" dataKey={`${entry.label}_actual`} name={entry.label}
              stroke={INTENSITY_COLORS[index % INTENSITY_COLORS.length]} strokeWidth={2.5} dot={{ r: 5 }} activeDot={{ r: 6 }} connectNulls={false} isAnimationActive={false} />,
            <Line key={`${entry.key}_target`} type="monotone" dataKey={`${entry.label}_target`} name={`${entry.label} target`} legendType="none"
              stroke={INTENSITY_COLORS[index % INTENSITY_COLORS.length]} strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />,
          ])}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── CoverPage ────────────────────────────────────────────────────────────────

function CoverPage({ data }: { data: LiveData }) {
  const { job_data, nzi_logo_src } = data;
  const reportTitle = String(job_data.title || "Carbon Report").trim();
  const generatedDate = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
  const reportingPeriod = (() => {
    if (job_data.reporting_period_start && job_data.reporting_period_end) {
      return `${formatDate(job_data.reporting_period_start)} - ${formatDate(job_data.reporting_period_end)}`;
    }
    return job_data.reporting_year != null ? String(job_data.reporting_year) : null;
  })();
  const params: [string, string | null | undefined][] = [
    ["Client", job_data.client_name],
    ["Report Title", reportTitle],
    ["Reporting Period", reportingPeriod],
    ["Job Number", job_data.job_number],
    ["Report Generated", generatedDate],
  ];
  return (
    <section className="flex flex-col items-center bg-white rounded-lg border border-gray-200 overflow-hidden mb-6 py-12 px-10 text-center">
      {nzi_logo_src ? (
        <img src={nzi_logo_src} alt="Net Zero International" className="h-20 w-auto object-contain" />
      ) : (
        <span className="text-sm font-bold uppercase tracking-widest" style={{ color: BRAND }}>Net Zero International</span>
      )}
      <h1 className="mt-8 text-2xl font-bold leading-snug" style={{ color: "#1e3a5f" }}>{reportTitle}</h1>
      {job_data.logo_url && (
        <img src={resolveLogoPreviewSrc(job_data.logo_url)} alt={job_data.client_name ?? "Client"} className="mt-5 max-h-16 max-w-[160px] w-auto object-contain" />
      )}
      <div className="mt-8 w-full max-w-md text-left border border-l-4 border-gray-200 rounded-md overflow-hidden" style={{ borderLeftColor: "#1e3a5f" }}>
        {params.map(([label, value]) => value ? (
          <div key={label} className="grid grid-cols-[44mm_1fr] border-b border-gray-100 last:border-b-0">
            <div className="px-3 py-2 text-xs font-semibold text-gray-500 bg-gray-50">{label}</div>
            <div className="px-3 py-2 text-xs text-gray-800">{value}</div>
          </div>
        ) : null)}
      </div>
      <p className="mt-8 text-xs text-gray-400">Prepared by Net Zero International &mdash; Confidential. For authorised recipients only.</p>
    </section>
  );
}

// ─── Section helpers ──────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return <CardTitle className="text-base font-semibold" style={{ color: BRAND }}>{title}</CardTitle>;
}

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

type Comment = {
  comment_id: number;
  comment_text: string;
  section_reference: string | null;
  status: string;
  author_name: string;
  created_at: string | null;
};

export default function PortalReportViewer({ jobId }: { jobId: number }) {
  const [data, setData] = useState<LiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [reviewStatus, setReviewStatus] = useState<string>("not_sent");

  // Review Notes panel state
  const [notesOpen, setNotesOpen] = useState(false);
  const [currentSection, setCurrentSection] = useState<string>("General");
  const [noteText, setNoteText] = useState("");
  const [submittingNote, setSubmittingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [noteSuccess, setNoteSuccess] = useState(false);
  const [existingComments, setExistingComments] = useState<Comment[]>([]);

  // Refs to track scroll position without triggering re-renders on every scroll event.
  // Calling setCurrentSection from IntersectionObserver would re-render this entire
  // component (and all its Recharts instances) on every section boundary — causing
  // the scroll freeze reported in the UX review.
  const observerRef = useRef<IntersectionObserver | null>(null);
  const currentSectionRef = useRef<string>("General");
  const notesOpenRef = useRef<boolean>(false);
  const notesTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const notesTriggerRef = useRef<HTMLButtonElement | null>(null);

  const setupObserver = useCallback(() => {
    if (observerRef.current) observerRef.current.disconnect();
    const sections = document.querySelectorAll<HTMLElement>("[data-section]");
    if (!sections.length) return;
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter(e => e.isIntersecting);
        if (visible.length > 0) {
          const section = (visible[0].target as HTMLElement).dataset.section;
          if (section) {
            currentSectionRef.current = section;
            // Only commit to state (re-render) when the notes panel is open.
            if (notesOpenRef.current) setCurrentSection(section);
          }
        }
      },
      { threshold: 0.2 }
    );
    sections.forEach(el => observerRef.current!.observe(el));
  }, []);

  const loadComments = useCallback(() => {
    apiFetch(`/portal/jobs/${jobId}/comments`)
      .then(async r => r.ok ? r.json() as Promise<{ comments: Comment[] }> : { comments: [] })
      .then(d => setExistingComments(d.comments ?? []))
      .catch(() => { /* non-fatal */ });
  }, [jobId]);

  useEffect(() => {
    setLoading(true);
    setFetchError(null);
    apiFetch(`/portal/jobs/${jobId}/portal-snapshot-data`)
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({})) as { detail?: string };
          if (r.status === 404) {
            setReviewStatus("not_sent");
            return null;
          }
          throw new Error(body.detail ?? `${r.status} ${r.statusText}`);
        }
        return r.json() as Promise<{ snapshot: LiveData; review_status: string }>;
      })
      .then(d => {
        if (!d) return;
        setData(d.snapshot);
        setReviewStatus(d.review_status ?? "sent_for_review");
      })
      .catch(e => setFetchError(String(e)))
      .finally(() => setLoading(false));
  }, [jobId]);

  useEffect(() => {
    if (data) {
      // Give React time to render sections before observing
      const t = setTimeout(setupObserver, 300);
      return () => clearTimeout(t);
    }
  }, [data, setupObserver]);

  useEffect(() => {
    if (notesOpen) {
      loadComments();
      // Auto-focus textarea when panel opens
      setTimeout(() => notesTextareaRef.current?.focus(), 50);
    } else {
      // Return focus to trigger on close
      notesTriggerRef.current?.focus();
    }
  }, [notesOpen, loadComments]);

  // Close notes panel on Escape
  useEffect(() => {
    if (!notesOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        notesOpenRef.current = false;
        setNotesOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [notesOpen]);

  // Must be declared before early returns (Rules of Hooks)
  const effectiveYearlyEmissions: YearlyEmission[] = useMemo(() => {
    const ye = data?.yearly_emissions;
    if ((ye?.length ?? 0) > 0) return ye!;
    const te = toNum(data?.summary?.current_total ?? data?.scope_totals?.Total);
    if (te <= 0) return [];
    const by = toNum(data?.target_data?.baseline_year) || new Date().getFullYear() - 1;
    return [{ year: by, scope1: toNum(data?.scope_totals?.["Scope 1"]), scope2: toNum(data?.scope_totals?.["Scope 2"]), scope3: toNum(data?.scope_totals?.["Scope 3"]), total: te }];
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Same computation as the CRM's Report Printing view (JobAdvancedReports.tsx) --
  // matches the current/benchmark/previous rows from the yearly emissions series
  // rather than the narrower benchmark_totals field, which is often empty.
  const scopeYearOnYearBar = useMemo(() => {
    if (!data || effectiveYearlyEmissions.length === 0) return null;

    const currentYear =
      toYearNumber(data.job_data.reporting_period_start, data.job_data.reporting_period_end) ??
      toNum(data.job_data?.reporting_year) ??
      new Date().getFullYear();
    const firstHistoricalYear = effectiveYearlyEmissions.length > 0 ? effectiveYearlyEmissions[0]?.year ?? null : null;
    const benchmarkBarYear =
      toYearNumber(data.job_data.benchmark_period_start, data.job_data.benchmark_period_end) ??
      firstHistoricalYear ??
      currentYear;
    const currentRow = effectiveYearlyEmissions.find((row) => row.year === currentYear) ?? effectiveYearlyEmissions[effectiveYearlyEmissions.length - 1] ?? null;
    const benchmarkRow =
      effectiveYearlyEmissions.find((row) => row.year === benchmarkBarYear) ??
      effectiveYearlyEmissions.find((row) => row.year === firstHistoricalYear) ??
      effectiveYearlyEmissions[0] ??
      null;
    const isBenchmarkReportYear = benchmarkBarYear === currentYear;

    if (!currentRow || !benchmarkRow) return null;

    const previousRow =
      effectiveYearlyEmissions
        .filter((row) => row.year < currentRow.year)
        .sort((a, b) => b.year - a.year)[0] ?? null;

    const isPreviousBenchmark = previousRow?.year === benchmarkBarYear;
    const changePct = (cur: number, bm: number) => (bm > 0 ? Math.round(((cur - bm) / bm) * 1000) / 10 : null);

    return {
      benchmarkLabel: `BM ${benchmarkRow.year}`,
      previousLabel: previousRow ? `Previous Year ${previousRow.year}` : "Previous Year",
      currentLabel: `Current Year ${currentRow.year}`,
      showBenchmarkBar: !isBenchmarkReportYear,
      showPreviousBar: !isBenchmarkReportYear && !isPreviousBenchmark,
      showComparisonPct: !isBenchmarkReportYear,
      data: [
        { scope: "Scope 1", benchmark: benchmarkRow.scope1, previous: previousRow?.scope1 ?? null, current: currentRow.scope1, pct: changePct(currentRow.scope1, benchmarkRow.scope1) },
        { scope: "Scope 2", benchmark: benchmarkRow.scope2, previous: previousRow?.scope2 ?? null, current: currentRow.scope2, pct: changePct(currentRow.scope2, benchmarkRow.scope2) },
        { scope: "Scope 3", benchmark: benchmarkRow.scope3, previous: previousRow?.scope3 ?? null, current: currentRow.scope3, pct: changePct(currentRow.scope3, benchmarkRow.scope3) },
        { scope: "Total", benchmark: benchmarkRow.total, previous: previousRow?.total ?? null, current: currentRow.total, pct: changePct(currentRow.total, benchmarkRow.total) },
      ],
    };
  }, [data, effectiveYearlyEmissions]);

  async function submitNote() {
    if (!noteText.trim()) return;
    setSubmittingNote(true);
    setNoteError(null);
    setNoteSuccess(false);
    try {
      const res = await apiFetch(`/portal/jobs/${jobId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment_text: noteText.trim(), section_reference: currentSection }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { detail?: string };
        throw new Error(body.detail ?? `Failed to submit note (${res.status})`);
      }
      setNoteText("");
      setNoteSuccess(true);
      loadComments();
      setTimeout(() => setNoteSuccess(false), 3000);
    } catch (e) {
      setNoteError(String(e));
    } finally {
      setSubmittingNote(false);
    }
  }

  const canAddNotes = reviewStatus === "sent_for_review" || reviewStatus === "changes_requested";

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center text-sm text-gray-400">Loading report…</div>
      </div>
    );
  }

  if (reviewStatus === "not_sent" || (!data && !fetchError)) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center space-y-2">
          <div className="text-sm font-medium text-gray-600">Report being prepared</div>
          <div className="text-xs text-gray-400">Your consultant will notify you when the report is ready for review.</div>
        </div>
      </div>
    );
  }

  if (fetchError || !data) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Could not load report: {fetchError ?? "No data returned"}
      </div>
    );
  }

  // ── Derived values ──────────────────────────────────────────────────────────

  const {
    scope_totals, benchmark_totals, categories, benchmark_categories,
    intensity_metrics, job_actions, target_data, summary,
    report_metadata, template_variables, site_breakdowns, glossary_cards,
  } = data;

  const execSummaryText = String(template_variables?.executive_summary ?? "").trim();
  const actionsNarrativeText = String(template_variables?.reduction_projects ?? "").trim();

  const totalEmissions = toNum(summary?.current_total ?? scope_totals?.Total);
  const scope1 = toNum(scope_totals?.["Scope 1"]);
  const scope2 = toNum(scope_totals?.["Scope 2"]);
  const scope3 = toNum(scope_totals?.["Scope 3"]);

  const firstHistoricalYear = effectiveYearlyEmissions.length > 0 ? effectiveYearlyEmissions[0].year : null;
  const baselineYear = toNum(target_data?.baseline_year) || toNum(data.job_data?.benchmark_period_end ? new Date(String(data.job_data.benchmark_period_end)).getFullYear() : 0) || firstHistoricalYear || new Date().getFullYear() - 1;
  const netZeroYear = toNum(target_data?.net_zero_target_year) || 2050;
  const interimYear = toNum(target_data?.interim_target_year ?? target_data?.interim_year) || null;
  const targetPct = toNum(target_data?.net_zero_target_reduction_pct ?? target_data?.target_pct) || 90;
  const interimS1Pct = toNum(target_data?.interim_s1_pct ?? target_data?.interim_pct) || 50;
  const interimS2Pct = toNum(target_data?.interim_s2_pct ?? target_data?.interim_pct) || 50;
  const interimS3Pct = toNum(target_data?.interim_s3_pct ?? target_data?.interim_pct) || 50;
  const interimPct = interimS1Pct;

  const scopeDonutData = SCOPE_LABELS.filter(s => toNum(scope_totals?.[s]) > 0).map(s => ({ name: s, value: toNum(scope_totals?.[s]) }));

  const activityBarData = buildActivityBarData(categories ?? [], totalEmissions);

  const activityChartHeight = Math.max(200, activityBarData.length * 52 + 40);
  const hasPathway = baselineYear > 2000 && netZeroYear > baselineYear;
  const appendixRows = site_breakdowns?.appendix_rows ?? [];
  const hasAppendix = appendixRows.length > 0;
  const hasGlossary = (glossary_cards?.length ?? 0) > 0;

  const printPeriodStart = formatDate(data.job_data?.reporting_period_start ?? "");
  const printPeriodEnd = formatDate(data.job_data?.reporting_period_end ?? "");

  return (
    <div className="space-y-6">

      {/* ── 1. Cover page ──────────────────────────────────────────────── */}
      <CoverPage data={data} />

      {/* ── 2. Executive Summary ───────────────────────────────────────── */}
      <Card data-section="Executive Summary">
        <CardHeader className="pb-3">
          <SectionHeader title="Executive Summary" />
        </CardHeader>
        <CardContent className="space-y-5">
          {execSummaryText ? (
            <div className="space-y-3">
              {execSummaryText.split(/\n\n+/).map((para, i) => (
                <p key={i} className="text-sm text-gray-700 leading-relaxed">{para.trim()}</p>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 italic">Executive summary not yet available.</p>
          )}

          <div className="mx-auto grid grid-cols-1 gap-6 items-center sm:w-fit sm:grid-cols-[280px_minmax(0,1fr)]">
            <div className="relative aspect-square w-full max-w-[280px] mx-auto flex-shrink-0 sm:w-[280px]">
              <ResponsiveContainer width="100%" aspect={1}>
                <PieChart>
                  <Pie data={scopeDonutData} dataKey="value" nameKey="name" innerRadius="72%" outerRadius="94%" paddingAngle={2} isAnimationActive={false}>
                    {scopeDonutData.map(entry => <Cell key={entry.name} fill={SCOPE_COLORS[entry.name] ?? "#999"} />)}
                  </Pie>
                  <Tooltip formatter={((v: unknown, n: unknown) => formatTooltipValue(v, n)) as any} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  {(() => { const s = fmt(totalEmissions); return <div className="font-semibold text-gray-800 whitespace-nowrap" style={{ fontSize: s.length > 8 ? 12 : s.length > 6 ? 14 : 16 }}>{s}</div>; })()}
                  <div className="text-xs text-gray-400">tCO₂e total</div>
                  {(printPeriodStart || printPeriodEnd) ? (
                    <div className="mt-1 text-[10px] text-gray-400">{printPeriodStart && printPeriodEnd ? `${printPeriodStart} – ${printPeriodEnd}` : printPeriodStart || printPeriodEnd}</div>
                  ) : data.job_data?.reporting_year != null ? (
                    <div className="mt-1 text-[10px] text-gray-400">{data.job_data.reporting_year}</div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <div className="grid grid-cols-[1fr_90px_52px] items-center gap-2 border-b border-gray-200 bg-gray-100 px-3 py-1.5">
                  <span className="text-xs font-semibold text-gray-500">Scope</span>
                  <div className="text-right text-xs font-semibold text-gray-500">tCO₂e</div>
                  <div className="text-right text-xs font-semibold text-gray-500">%</div>
                </div>
                {SCOPE_LABELS.map(s => {
                  const v = toNum(scope_totals?.[s]);
                  const pct = totalEmissions > 0 ? (v / totalEmissions) * 100 : 0;
                  return (
                    <div key={s} className="grid grid-cols-[1fr_90px_52px] items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2 last:border-b-0">
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: SCOPE_COLORS[s] }} />
                        <span className="text-xs text-gray-500 whitespace-nowrap">{s}</span>
                      </div>
                      <div className="text-right text-xs font-semibold text-gray-800 tabular-nums whitespace-nowrap">{fmt(v)}</div>
                      <div className="text-right text-xs text-gray-500 tabular-nums whitespace-nowrap">{pct.toFixed(1)}%</div>
                    </div>
                  );
                })}
                <div className="grid grid-cols-[1fr_90px_52px] items-center gap-2 px-3 py-2" style={{ backgroundColor: `${BRAND}0d` }}>
                  <span className="text-xs font-semibold text-gray-600">Total</span>
                  <div className="text-right text-xs font-bold tabular-nums whitespace-nowrap" style={{ color: BRAND }}>{fmt(totalEmissions)}</div>
                  <div className="text-right text-xs text-gray-500 whitespace-nowrap">100.0%</div>
                </div>
              </div>
              {(() => {
                const bTotal = toNum(summary?.benchmark_total);
                const delta = toNum(summary?.delta_total);
                if (bTotal <= 0) return null;
                const pct = Math.abs((delta / bTotal) * 100);
                const down = delta < 0;
                return (
                  <div className={`rounded-full px-3 py-1 text-xs font-semibold text-center ${down ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                    {down ? "▼" : "▲"} {fmt(pct, 1)}% vs benchmark ({fmt(bTotal)} tCO₂e)
                  </div>
                );
              })()}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── 3. Net Zero Commitment ─────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <SectionHeader title="Net Zero Commitment" />
        </CardHeader>
        <CardContent className="space-y-5">
          {(() => {
            const stmt = String(template_variables?.commitment_statement ?? "").trim();
            const fallback = `${data.job_data.client_name ?? "This organisation"} is committed to achieving net zero greenhouse gas emissions by ${netZeroYear}. This commitment demonstrates our dedication to environmental sustainability.`;
            return <p className="text-sm text-gray-700 leading-relaxed">{stmt || fallback}</p>;
          })()}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">We commit to the following:</p>
            <ul className="list-disc list-outside ml-5 space-y-1 text-sm text-gray-700">
              <li>To achieve target reductions in greenhouse gas emissions, as set out below.</li>
              <li>To set realistic short- and long-term targets designed to achieve our Net Zero commitments.</li>
              <li>To report total Greenhouse Gas emissions of our business, at a minimum, on an annual basis.</li>
            </ul>
          </div>
          {(interimYear || netZeroYear) && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">Reduction Targets</p>
              <div className="overflow-x-auto">
              <div className="overflow-hidden rounded-lg border border-gray-200 min-w-[380px]">
                <div className="grid grid-cols-[1fr_80px_100px_120px] border-b border-gray-200 bg-gray-100 px-3 py-1.5">
                  <span className="text-xs font-semibold text-gray-500">Target Type</span>
                  <span className="text-center text-xs font-semibold text-gray-500">Year</span>
                  <span className="text-center text-xs font-semibold text-gray-500">Reduction</span>
                  <span className="text-xs font-semibold text-gray-500">Scope</span>
                </div>
                {interimYear && (
                  <>
                    <div className="grid grid-cols-[1fr_80px_100px_120px] border-b border-gray-100 bg-gray-50 px-3 py-2">
                      <span className="text-xs text-gray-700">Interim Target</span>
                      <span className="text-center text-xs text-gray-700">{interimYear}</span>
                      <span className="text-center text-xs text-gray-700">{interimS1Pct}%</span>
                      <span className="text-xs text-gray-700">Scope 1</span>
                    </div>
                    <div className="grid grid-cols-[1fr_80px_100px_120px] border-b border-gray-100 bg-gray-50 px-3 py-2">
                      <span className="text-xs text-gray-700">Interim Target</span>
                      <span className="text-center text-xs text-gray-700">{interimYear}</span>
                      <span className="text-center text-xs text-gray-700">{interimS2Pct}%</span>
                      <span className="text-xs text-gray-700">Scope 2</span>
                    </div>
                    <div className="grid grid-cols-[1fr_80px_100px_120px] border-b border-gray-100 bg-gray-50 px-3 py-2">
                      <span className="text-xs text-gray-700">Interim Target</span>
                      <span className="text-center text-xs text-gray-700">{interimYear}</span>
                      <span className="text-center text-xs text-gray-700">{interimS3Pct}%</span>
                      <span className="text-xs text-gray-700">Scope 3</span>
                    </div>
                  </>
                )}
                <div className="grid grid-cols-[1fr_80px_100px_120px] bg-gray-50 px-3 py-2">
                  <span className="text-xs font-semibold text-gray-700">Net Zero Target</span>
                  <span className="text-center text-xs font-semibold text-gray-700">{netZeroYear}</span>
                  <span className="text-center text-xs font-semibold text-gray-700">{targetPct}%</span>
                  <span className="text-xs font-semibold text-gray-700">Scope 1, 2 &amp; 3</span>
                </div>
              </div>
              </div>
            </div>
          )}
          {hasPathway && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">Emissions Reduction Pathway to {netZeroYear}</p>
              <NetZeroTrendChart
                yearlyEmissions={effectiveYearlyEmissions} baselineYear={baselineYear} endYear={netZeroYear}
                interimYear={interimYear} interimPct={interimPct} targetPct={targetPct}
                scope1Fallback={scope1} scope2Fallback={scope2} scope3Fallback={scope3}
              />
            </div>
          )}
          {report_metadata?.emissions_reduction_targets_commentary && (
            <p className="text-sm text-gray-600 leading-relaxed">{report_metadata.emissions_reduction_targets_commentary}</p>
          )}
        </CardContent>
      </Card>

      {/* ── 4. Background & Organisation ───────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <SectionHeader title="Background & Organisation" />
        </CardHeader>
        <CardContent className="space-y-6">
          {data.job_data.description && (
            <div className="space-y-3">
              {data.job_data.description.split(/\r?\n\r?\n|\r?\n/).filter(p => p.trim()).map((para, i) => (
                <p key={i} className="text-sm text-gray-700 leading-relaxed">{para.trim()}</p>
              ))}
            </div>
          )}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">Organisation Details</p>
            <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-2">
              <MetaRow label="Organisation" value={data.job_data.client_name} />
              <MetaRow label="Industry" value={data.job_data.industry} />
              <MetaRow label="Location" value={[data.job_data.city, data.job_data.country].filter(Boolean).join(", ")} />
              <MetaRow label="Company Number" value={report_metadata?.company_number} />
              <MetaRow label="Registered Address" value={report_metadata?.registered_address?.replace(/,\s*,+/g, ",").replace(/,\s*$/g, "").trim()} />
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">Reporting Elements</p>
            <div className="overflow-hidden rounded-lg border border-gray-200">
              {([
                ["No. of Staff", report_metadata?.employee_number ?? data.job_data.no_of_staff],
                ["No. of Premises Owned", report_metadata?.premises_owned],
                ["No. of Premises Leased", report_metadata?.premises_leased],
                ["No. of Vehicles Owned", report_metadata?.vehicles_owned],
                ["No. of Vehicles Leased", report_metadata?.vehicles_leased],
              ] as [string, number | null | undefined][]).map(([label, value]) => (
                <div key={label} className="grid grid-cols-[200px_1fr] border-b border-gray-100 last:border-0">
                  <div className="px-3 py-2 text-xs text-gray-500 bg-gray-50">{label}</div>
                  <div className="px-3 py-2 text-xs text-gray-700">{value != null ? String(value) : "N/A"}</div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">Organisational Boundary</p>
            <p className="text-sm text-gray-700 leading-relaxed mb-3">
              The organisational boundary defines the operations over which the organisation has control or financial responsibility for GHG emissions.
            </p>
            <div className="overflow-x-auto">
            <div className="overflow-hidden rounded-lg border border-gray-200 min-w-[420px]">
              <div className="grid grid-cols-[160px_1fr_110px] px-3 py-2" style={{ backgroundColor: BRAND }}>
                <span className="text-xs font-semibold uppercase tracking-wide text-white">Approach</span>
                <span className="text-xs font-semibold uppercase tracking-wide text-white">Description</span>
                <span className="text-xs font-semibold uppercase tracking-wide text-white">Approach Taken</span>
              </div>
              {([
                { label: "Operational Control", desc: "The organisation has operational control over an operation if it or one of its subsidiaries has the full authority to introduce and implement its operating policies at the operation.", value: report_metadata?.operational_control },
                { label: "Financial Control", desc: "The organisation has financial control over the operation if it has the ability to direct the financial and operating policies of the organisation with a view to gaining economic benefits from its activities.", value: report_metadata?.financial_control },
                { label: "Equity Share", desc: "The organisation accounts for GHG emissions from operations according to its share of equity in the operation.", value: report_metadata?.equity_share },
              ]).map((row, i) => (
                <div key={row.label} className={`grid grid-cols-[160px_1fr_110px] border-b border-gray-100 last:border-0 px-3 py-2 ${i % 2 === 0 ? "bg-white" : "bg-gray-50"}`}>
                  <span className="text-xs font-medium text-gray-700 pr-2">{row.label}</span>
                  <span className="text-xs text-gray-600 pr-4">{row.desc}</span>
                  <span className="text-xs font-medium text-gray-700">{boolLabel(row.value)}</span>
                </div>
              ))}
            </div>
            </div>
          </div>
          {(data.job_data.benchmark_period_start || data.job_data.benchmark_period_end) && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1">Benchmark Year</p>
              <p className="text-sm text-gray-700 leading-relaxed">
                The organisation&apos;s benchmark year is from {formatDate(data.job_data.benchmark_period_start ?? "")} to {formatDate(data.job_data.benchmark_period_end ?? "")}.
              </p>
            </div>
          )}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-1">Methodologies Used</p>
            <p className="text-sm text-gray-700 leading-relaxed">
              {String(report_metadata?.methodologies_used ?? "").trim() || "Throughout this report all methodologies used are explained within the relevant sections."}
            </p>
          </div>
          {report_metadata?.commitment_commentary && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">Commitment</p>
              <p className="text-sm text-gray-700 leading-relaxed">{report_metadata.commitment_commentary}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── 4b. Carbon Emissions Overview ──────────────────────────────── */}
      <Card data-section="Carbon Emissions Overview">
        <CardHeader className="pb-3">
          <SectionHeader title="Carbon Emissions Overview" />
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex justify-center">
            <div className="rounded-xl border border-gray-200 bg-white px-8 py-6 text-center shadow-sm w-full max-w-sm">
              <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: BRAND }}>Reporting Period</p>
              <p className="text-sm text-gray-700">{formatDate(data.job_data.reporting_period_start ?? "")} to {formatDate(data.job_data.reporting_period_end ?? "")}</p>
              <hr className="my-4 border-gray-200" />
              <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: BRAND }}>Total Carbon Emissions</p>
              <p className="text-5xl font-bold" style={{ color: BRAND }}>{fmt(totalEmissions)}</p>
              <p className="mt-1 text-xs text-gray-500">tCO₂e</p>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-gray-700">
            The calculated emissions are based on the most up to date emissions factors at the time of the publication of this report. It should be noted that emissions factors are updated regularly and will be retrospectively applied. As such, emissions values may change when calculated in future years.
          </p>
          {(site_breakdowns?.overall?.length ?? 0) > 0 && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Emissions by Site (Overview)</p>
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <div className="grid grid-cols-[1fr_120px_120px] px-3 py-2" style={{ backgroundColor: BRAND }}>
                  <span className="text-xs font-semibold uppercase tracking-wide text-white">Site</span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-white text-right">tCO₂e</span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-white text-right">% of Total</span>
                </div>
                {site_breakdowns?.overall?.map((row, i) => (
                  <div key={i} className={`grid grid-cols-[1fr_120px_120px] border-b border-gray-100 last:border-0 px-3 py-2 ${i % 2 === 0 ? "bg-white" : "bg-gray-50"}`}>
                    <span className="text-xs text-gray-700">{row.site_name ?? "Unassigned"}</span>
                    <span className="text-xs text-gray-700 text-right">{fmt(toNum(row.total))}</span>
                    <span className="text-xs text-gray-700 text-right">{toNum(row.pct_total).toFixed(1)}%</span>
                  </div>
                ))}
                <div className="grid grid-cols-[1fr_120px_120px] border-t border-gray-200 px-3 py-2 bg-gray-50">
                  <span className="text-xs font-semibold text-gray-700">Total</span>
                  <span className="text-xs font-semibold text-gray-700 text-right">{fmt(totalEmissions)}</span>
                  <span className="text-xs font-semibold text-gray-700 text-right">100.0%</span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── 4b. Intensity Metric Analysis ──────────────────────────────── */}
      {intensity_metrics && Object.keys(intensity_metrics).length > 0 && (() => {
        const currentPeriodLabel = (() => {
          const s = data.job_data.reporting_period_start;
          const e = data.job_data.reporting_period_end;
          if (!s && !e) return "Current Year";
          const sYear = s ? new Date(s).getFullYear() : null;
          const eYear = e ? new Date(e).getFullYear() : null;
          if (sYear && eYear && sYear !== eYear) return `${sYear}–${eYear}`;
          return String(sYear ?? eYear ?? "Current Year");
        })();

        const benchmarkPeriodLabel = (() => {
          const s = data.job_data.benchmark_period_start;
          const e = data.job_data.benchmark_period_end;
          if (!s && !e) return "Benchmark Year";
          const sYear = s ? new Date(s).getFullYear() : null;
          const eYear = e ? new Date(e).getFullYear() : null;
          if (sYear && eYear && sYear !== eYear) return `${sYear}–${eYear}`;
          return String(sYear ?? eYear ?? "Benchmark Year");
        })();

        const benchmarkTotal = toNum(benchmark_totals?.Total) ||
          (toNum(benchmark_totals?.["Scope 1"]) + toNum(benchmark_totals?.["Scope 2"]) + toNum(benchmark_totals?.["Scope 3"]));

        const calcIntensity = (m: { value?: number | null; divider?: number | null }, emissions: number) => {
          const v = toNum(m.value);
          const d = toNum(m.divider) || 1;
          return v > 0 && emissions > 0 ? (emissions * d) / v : null;
        };

        const pctChange = (curr: number | null, bench: number | null): number | null => {
          if (curr == null || bench == null || bench === 0) return null;
          return ((curr - bench) / Math.abs(bench)) * 100;
        };
        const fmtPct = (p: number | null) => {
          if (p == null) return "—";
          return `${p > 0 ? "+" : ""}${p.toFixed(1)}%`;
        };
        const pctColor = (p: number | null) =>
          p == null ? "text-gray-400" : p < 0 ? "text-green-600" : p > 0 ? "text-red-600" : "text-gray-600";

        const perLabel = (key: string, m: { label?: string | null; divider?: number | null }) => {
          const label = m.label?.trim() || key;
          const d = toNum(m.divider) || 1;
          return d === 1 ? `Per ${label}` : `Per ${d.toLocaleString()} ${label}`;
        };

        const MetricIcon = ({ metricKey }: { metricKey: string }) => {
          if (metricKey === "employees") return (
            <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: BRAND }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
            </svg>
          );
          return <span className="text-2xl font-bold" style={{ color: BRAND }}>£</span>;
        };

        const seen = new Set<string>();
        const dedupedMetricEntries = [...Object.entries(intensity_metrics)]
          .sort(([a], [b]) => (a === "employees" ? -1 : b === "employees" ? 1 : 0))
          .filter(([key, m]) => {
            const lbl = perLabel(key, m);
            if (seen.has(lbl)) return false;
            seen.add(lbl);
            return true;
          });

        const summaryParts = dedupedMetricEntries.map(([key, m]) => {
          const intensity = calcIntensity(m, totalEmissions);
          if (intensity == null) return null;
          const label = m.label?.trim() || key;
          const d = toNum(m.divider) || 1;
          const perStr = d === 1 ? `per ${label.toLowerCase()}` : `per ${d.toLocaleString()} ${label.toLowerCase()}`;
          return `${fmt(intensity)} tCO₂e ${perStr}`;
        }).filter(Boolean);

        const employeeCount = toNum(intensity_metrics.employees?.value);

        return (
          <Card data-section="Intensity Metric Analysis">
            <CardHeader className="pb-3"><SectionHeader title="Intensity Metric Analysis" /></CardHeader>
            <CardContent className="space-y-5">
              <p className="text-sm text-gray-700 leading-relaxed">
                Intensity metrics help normalise emissions data, taking into account variations in production levels or activity volumes. This allows for a more accurate assessment of emission trends over time, regardless of changes in business operations. The initial intensity metrics for the company are below and will be used for comparative purposes in following years.
              </p>
              <div>
                <p className="text-sm font-semibold text-center text-gray-700 mb-2">Intensity Metrics (tonnes CO₂e)</p>
                <div className="overflow-x-auto">
                <div className="overflow-hidden rounded-lg border border-gray-200 min-w-[480px]">
                  <div className="grid grid-cols-[56px_1fr_110px_110px_90px] border-b border-gray-200 bg-gray-50 px-3 py-1.5">
                    <span /><span />
                    <div className="text-right">
                      <p className="text-xs font-semibold text-gray-600">Benchmark</p>
                      <p className="text-xs text-gray-500">{benchmarkPeriodLabel}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold text-gray-600">Current</p>
                      <p className="text-xs text-gray-500">{currentPeriodLabel}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold text-gray-600">Change</p>
                    </div>
                  </div>
                  {dedupedMetricEntries.map(([key, m], i) => {
                    const bmM = data.benchmark_intensity_metrics?.[key] ?? m;
                    const benchIntensity = calcIntensity(bmM, benchmarkTotal);
                    const currIntensity  = calcIntensity(m, totalEmissions);
                    const pct = pctChange(currIntensity, benchIntensity);
                    return (
                      <div key={key} className={`grid grid-cols-[56px_1fr_110px_110px_90px] items-center border-b border-gray-100 last:border-0 px-3 py-4 ${i % 2 === 0 ? "bg-white" : "bg-gray-50"}`}>
                        <div className="flex items-center justify-center"><MetricIcon metricKey={key} /></div>
                        <span className="text-sm font-medium text-gray-700">{perLabel(key, m)}</span>
                        <span className="text-right text-sm text-gray-600">{benchIntensity != null ? fmt(benchIntensity) : "—"}</span>
                        <span className="text-right text-sm font-semibold text-gray-800">{currIntensity != null ? fmt(currIntensity) : "—"}</span>
                        <span className={`text-right text-sm font-semibold ${pctColor(pct)}`}>{fmtPct(pct)}</span>
                      </div>
                    );
                  })}
                </div>
                </div>
              </div>
              {summaryParts.length > 0 && (
                <p className="text-sm text-gray-700 leading-relaxed">
                  The chosen intensity metrics shows a carbon emissions value of{" "}
                  {summaryParts.map((part, i) => (
                    <React.Fragment key={i}>{i > 0 && " and "}<strong>{part}</strong></React.Fragment>
                  ))}.
                  {employeeCount > 0 && <> The business headcount averaged {employeeCount} {employeeCount === 1 ? "person" : "people"} during the benchmark period.</>}
                </p>
              )}
              {hasPathway && effectiveYearlyEmissions.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-3">Emissions Reduction Pathway to {netZeroYear} for Intensity Metrics</p>
                  <IntensityPathwayChart
                    yearlyEmissions={effectiveYearlyEmissions} baselineYear={baselineYear} endYear={netZeroYear}
                    interimYear={interimYear} interimS1Pct={interimS1Pct} interimS2Pct={interimS2Pct} interimS3Pct={interimS3Pct}
                    targetPct={targetPct} scope1Fallback={scope1} scope2Fallback={scope2} scope3Fallback={scope3}
                    intensityMetrics={intensity_metrics}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* ── 5. Analysis by Scope ───────────────────────────────────────── */}
      <Card data-section="Analysis by Scope">
        <CardHeader className="pb-3">
          <SectionHeader title="Analysis by Scope" />
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-4">Emissions by Scope</p>
            <div className="mx-auto grid w-fit grid-cols-[280px_minmax(0,1fr)] gap-6 items-center">
              <div className="relative aspect-square w-[280px] flex-shrink-0">
                <ResponsiveContainer width="100%" aspect={1}>
                  <PieChart>
                    <Pie data={scopeDonutData} dataKey="value" nameKey="name" innerRadius="72%" outerRadius="94%" paddingAngle={2} isAnimationActive={false}>
                      {scopeDonutData.map(entry => <Cell key={entry.name} fill={SCOPE_COLORS[entry.name] ?? "#999"} />)}
                    </Pie>
                    <Tooltip formatter={((v: unknown, n: unknown) => formatTooltipValue(v, n)) as any} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    {(() => { const s = fmt(totalEmissions); return <div className="font-semibold text-gray-800 whitespace-nowrap" style={{ fontSize: s.length > 8 ? 12 : s.length > 6 ? 14 : 16 }}>{s}</div>; })()}
                    <div className="text-xs text-gray-400">tCO₂e total</div>
                    {(printPeriodStart || printPeriodEnd) ? (
                      <div className="mt-1 text-[10px] text-gray-400">{printPeriodStart && printPeriodEnd ? `${printPeriodStart} – ${printPeriodEnd}` : printPeriodStart || printPeriodEnd}</div>
                    ) : data.job_data?.reporting_year != null ? (
                      <div className="mt-1 text-[10px] text-gray-400">{data.job_data.reporting_year}</div>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <div className="grid grid-cols-[1fr_90px_52px] items-center gap-2 border-b border-gray-200 bg-gray-100 px-3 py-1.5">
                    <span className="text-xs font-semibold text-gray-500">Scope</span>
                    <div className="text-right text-xs font-semibold text-gray-500">tCO₂e</div>
                    <div className="text-right text-xs font-semibold text-gray-500">%</div>
                  </div>
                  {SCOPE_LABELS.map(s => {
                    const v = toNum(scope_totals?.[s]);
                    const pct = totalEmissions > 0 ? (v / totalEmissions) * 100 : 0;
                    return (
                      <div key={s} className="grid grid-cols-[1fr_90px_52px] items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2 last:border-b-0">
                        <div className="flex items-center gap-2">
                          <div className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: SCOPE_COLORS[s] }} />
                          <span className="text-xs text-gray-500 whitespace-nowrap">{s}</span>
                        </div>
                        <div className="text-right text-xs font-semibold text-gray-800 tabular-nums whitespace-nowrap">{fmt(v)}</div>
                        <div className="text-right text-xs text-gray-500 tabular-nums whitespace-nowrap">{pct.toFixed(1)}%</div>
                      </div>
                    );
                  })}
                  <div className="grid grid-cols-[1fr_90px_52px] items-center gap-2 px-3 py-2" style={{ backgroundColor: `${BRAND}0d` }}>
                    <span className="text-xs font-semibold text-gray-600">Total</span>
                    <div className="text-right text-xs font-bold tabular-nums whitespace-nowrap" style={{ color: BRAND }}>{fmt(totalEmissions)}</div>
                    <div className="text-right text-xs text-gray-500 whitespace-nowrap">100.0%</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Year-on-Year Comparison by Scope */}
          {scopeYearOnYearBar && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-3">Year-on-Year Comparison by Scope</p>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={scopeYearOnYearBar.data} margin={{ top: 20, right: 24, left: 8, bottom: 32 }} barCategoryGap="30%" barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F0F0F0" />
                  <XAxis
                    dataKey="scope"
                    axisLine={false} tickLine={false} interval={0}
                    tick={(tickProps: any) => {
                      const { x, y, payload } = tickProps as { x: number; y: number; payload: { value: string } };
                      const row = scopeYearOnYearBar.data.find(d => d.scope === payload?.value);
                      const pct = scopeYearOnYearBar.showComparisonPct ? row?.pct ?? null : null;
                      return (
                        <g transform={`translate(${x},${y})`}>
                          <text textAnchor="middle" fontSize={11} fill="#334155" y={14}>{payload?.value}</text>
                          {pct != null && (
                            <text textAnchor="middle" fontSize={10} fill={pct < 0 ? "#16a34a" : "#dc2626"} y={28}>
                              {pct < 0 ? "" : "+"}{pct.toFixed(1)}%
                            </text>
                          )}
                        </g>
                      );
                    }}
                  />
                  <YAxis tickFormatter={(v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 })} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} label={{ value: "tCO₂e", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 10, fill: "#94a3b8" } }} />
                  <Tooltip formatter={(v: unknown, name: unknown) => [typeof v === "number" ? `${fmt(v)} tCO₂e` : "—", String(name ?? "")]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} verticalAlign="top" />
                  {scopeYearOnYearBar.showBenchmarkBar && (
                    <Bar dataKey="benchmark" name={scopeYearOnYearBar.benchmarkLabel} fill="#94a3b8" radius={[3,3,0,0]} isAnimationActive={false}>
                      <LabelList dataKey="benchmark" position="top" formatter={(v: unknown) => typeof v === "number" && v > 0 ? fmt(v, 1) : ""} style={{ fontSize: 9, fill: "#64748b" }} />
                    </Bar>
                  )}
                  {scopeYearOnYearBar.showPreviousBar && (
                    <Bar dataKey="previous" name={scopeYearOnYearBar.previousLabel} fill="#64748b" radius={[3,3,0,0]} isAnimationActive={false}>
                      <LabelList dataKey="previous" position="top" formatter={(v: unknown) => typeof v === "number" && v > 0 ? fmt(v, 1) : ""} style={{ fontSize: 9, fill: "#475569" }} />
                    </Bar>
                  )}
                  <Bar dataKey="current" name={scopeYearOnYearBar.currentLabel} fill={BRAND} radius={[3,3,0,0]} isAnimationActive={false}>
                    <LabelList dataKey="current" position="top" formatter={(v: unknown) => typeof v === "number" && v > 0 ? fmt(v, 1) : ""} style={{ fontSize: 9, fill: BRAND }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Scope Descriptions */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">Scope Descriptions</p>
            <div className="overflow-x-auto">
            <div className="overflow-hidden rounded-lg border border-gray-200 min-w-[360px]">
              <div className="grid grid-cols-[52px_1fr_90px_58px] px-3 py-2" style={{ backgroundColor: BRAND }}>
                <span className="text-xs font-semibold uppercase tracking-wide text-white">Scope</span>
                <span className="text-xs font-semibold uppercase tracking-wide text-white">Description</span>
                <span className="text-xs font-semibold uppercase tracking-wide text-white text-right">tCO₂e</span>
                <span className="text-xs font-semibold uppercase tracking-wide text-white text-right">%</span>
              </div>
              {([
                { scope: "1", desc: "Scope 1 emissions includes fuels used at company premises and company vehicles.", value: scope1 },
                { scope: "2", desc: "Emissions in scope 2 includes electricity used at the company's premises.", value: scope2 },
                { scope: "3", desc: "Scope 3 emissions include Business Travel, Employee Commuting, Waste, Purchased Goods and Services and all other activities of a business", value: scope3 },
              ] as { scope: string; desc: string; value: number }[]).map((row, i) => {
                const pct = totalEmissions > 0 ? (row.value / totalEmissions) * 100 : 0;
                return (
                  <div key={row.scope} className={`grid grid-cols-[52px_1fr_90px_58px] border-b border-gray-100 last:border-0 px-3 py-2 ${i % 2 === 0 ? "bg-white" : "bg-gray-50"}`}>
                    <span className="text-xs font-medium text-gray-700">{row.scope}</span>
                    <span className="text-xs text-gray-700 pr-4">{row.desc}</span>
                    <span className="text-xs text-gray-700 text-right">{fmt(row.value)}</span>
                    <span className="text-xs text-gray-700 text-right">{pct.toFixed(1)}%</span>
                  </div>
                );
              })}
              <div className="grid grid-cols-[52px_1fr_90px_58px] border-t border-gray-200 px-3 py-2 bg-gray-50">
                <span className="text-xs font-semibold uppercase text-gray-700">Total</span>
                <span />
                <span className="text-xs font-semibold text-gray-700 text-right">{fmt(totalEmissions)}</span>
                <span className="text-xs font-semibold text-gray-700 text-right">100.0%</span>
              </div>
            </div>
            </div>
          </div>

          {/* Site Breakdown by Scope */}
          {(site_breakdowns?.scope?.length ?? 0) > 0 && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Site Breakdown by Scope</p>
              <div className="overflow-x-auto">
              <div className="overflow-hidden rounded-lg border border-gray-200 min-w-[420px]">
                <div className="grid grid-cols-[1fr_80px_80px_80px_80px] px-3 py-2" style={{ backgroundColor: BRAND }}>
                  <span className="text-xs font-semibold uppercase tracking-wide text-white">Site</span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-white text-right">Scope 1</span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-white text-right">Scope 2</span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-white text-right">Scope 3</span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-white text-right">Total</span>
                </div>
                {site_breakdowns?.scope?.map((row, i) => (
                  <div key={i} className={`grid grid-cols-[1fr_80px_80px_80px_80px] border-b border-gray-100 last:border-0 px-3 py-2 ${i % 2 === 0 ? "bg-white" : "bg-gray-50"}`}>
                    <span className="text-xs text-gray-700">{row.site_name ?? "Unassigned"}</span>
                    <span className="text-xs text-gray-700 text-right">{fmt(toNum(row.scope_1))}</span>
                    <span className="text-xs text-gray-700 text-right">{fmt(toNum(row.scope_2))}</span>
                    <span className="text-xs text-gray-700 text-right">{fmt(toNum(row.scope_3))}</span>
                    <span className="text-xs text-gray-700 text-right">{fmt(toNum(row.total))}</span>
                  </div>
                ))}
                <div className="grid grid-cols-[1fr_80px_80px_80px_80px] border-t border-gray-200 px-3 py-2 bg-gray-50">
                  <span className="text-xs font-semibold text-gray-700">Total</span>
                  <span className="text-xs font-semibold text-gray-700 text-right">{fmt(scope1)}</span>
                  <span className="text-xs font-semibold text-gray-700 text-right">{fmt(scope2)}</span>
                  <span className="text-xs font-semibold text-gray-700 text-right">{fmt(scope3)}</span>
                  <span className="text-xs font-semibold text-gray-700 text-right">{fmt(totalEmissions)}</span>
                </div>
              </div>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
            <p className="text-xs text-gray-600">Reported Scope 3 emissions may increase in future years as more detailed data and information become available.</p>
          </div>
        </CardContent>
      </Card>

      {/* ── 6. Emissions by Activity ───────────────────────────────────── */}
      {activityBarData.length > 0 && (
        <Card data-section="Emissions by Activity">
          <CardHeader className="pb-3">
            <SectionHeader title="Emissions by Activity" />
          </CardHeader>
          <CardContent>
            <div style={{ height: activityChartHeight }}>
              <ResponsiveContainer width="100%" height={activityChartHeight}>
                <BarChart layout="vertical" data={activityBarData} margin={{ top: 4, right: 64, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#F0F0F0" />
                  <XAxis type="number" tickFormatter={(v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 })} tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={180} tick={{ fontSize: 9 }} />
                  <Tooltip formatter={((v: unknown, n: unknown, props: { payload?: { fullName?: string } }) => formatTooltipValueWithName(v, n, props?.payload?.fullName)) as any} />
                  <Bar dataKey="value" name="tCO₂e" radius={[0, 3, 3, 0]} isAnimationActive={false}>
                    {activityBarData.map((entry, i) => <Cell key={`cell-${i}`} fill={entry.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            {report_metadata?.activity_commentary && (
              <p className="mt-4 text-sm text-gray-600 leading-relaxed">{report_metadata.activity_commentary}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── 7. Emissions by Scope and Category ─────────────────────────── */}
      {(categories?.length ?? 0) > 0 && (() => {
        // Same grouping + "% vs BM" trend calc as the CRM's Report Printing
        // view -- category label prioritizes the granular `category` field
        // (falling back to activity_group), and the % column compares each
        // row's own current-vs-benchmark change, not composition-of-total.
        const aggMap = new Map<string, { scope: string; label: string; current: number; benchmark: number }>();
        for (const row of (categories ?? [])) {
          const scope = row.scope ?? "";
          const label = row.category?.trim() || row.activity_group?.trim() || "Other Emissions";
          const key = `${scope}||${label}`;
          const existing = aggMap.get(key);
          if (existing) { existing.current += toNum(row.emissions); }
          else { aggMap.set(key, { scope, label, current: toNum(row.emissions), benchmark: 0 }); }
        }
        for (const row of (benchmark_categories ?? [])) {
          const scope = row.scope ?? "";
          const label = row.category?.trim() || row.activity_group?.trim() || "Other Emissions";
          const key = `${scope}||${label}`;
          const existing = aggMap.get(key);
          if (existing) { existing.benchmark += toNum(row.emissions); }
          else { aggMap.set(key, { scope, label, current: 0, benchmark: toNum(row.emissions) }); }
        }
        const scopeOrder = ["Scope 1", "Scope 2", "Scope 3"];
        const allRows = Array.from(aggMap.values()).sort((a, b) => {
          const si = scopeOrder.indexOf(a.scope) - scopeOrder.indexOf(b.scope);
          return si !== 0 ? si : a.label.localeCompare(b.label);
        });
        const grandCurrentTotal = totalEmissions;
        const grandBenchmarkTotal = toNum(benchmark_totals?.Total);
        const hasBenchmark = grandBenchmarkTotal > 0 || (benchmark_categories?.length ?? 0) > 0;
        const grandPct = grandBenchmarkTotal > 0 ? ((grandCurrentTotal - grandBenchmarkTotal) / grandBenchmarkTotal) * 100 : 0;

        const tableRows: React.ReactElement[] = [];
        let rowIdx = 0;
        for (const scope of scopeOrder) {
          const scopeRows = allRows.filter(r => r.scope === scope);
          if (scopeRows.length === 0) continue;
          const scopeCurrent = scopeRows.reduce((s, r) => s + r.current, 0);
          const scopeBenchmark = hasBenchmark ? scopeRows.reduce((s, r) => s + r.benchmark, 0) : null;
          scopeRows.forEach(r => {
            const pct = r.benchmark !== 0 ? ((r.current - r.benchmark) / r.benchmark) * 100 : null;
            const bg = rowIdx % 2 === 0 ? "bg-white" : "bg-gray-50";
            tableRows.push(
              <div key={`${r.scope}-${r.label}`} className={`grid grid-cols-[80px_1fr_120px_120px_70px] border-b border-gray-100 px-3 py-2 ${bg}`}>
                <span className="text-xs text-gray-500">{r.scope}</span>
                <span className="text-xs text-gray-700 pr-2">{r.label}</span>
                {hasBenchmark ? <span className="text-xs text-gray-700 text-right">{fmt(r.benchmark)}</span> : <span className="text-xs text-gray-400 text-right">—</span>}
                <span className="text-xs text-gray-700 text-right">{fmt(r.current)}</span>
                {hasBenchmark ? (
                  pct === null
                    ? <span className="text-xs text-right text-gray-400">-</span>
                    : <span className="text-xs text-right" style={{ color: pct < 0 ? "#16a34a" : pct > 0 ? "#dc2626" : "#6b7280" }}>{pct >= 0 ? "+" : ""}{fmt(pct, 1)}%</span>
                ) : <span className="text-xs text-gray-400 text-right">—</span>}
              </div>
            );
            rowIdx++;
          });
          const subPct = scopeBenchmark && scopeBenchmark !== 0 ? ((scopeCurrent - scopeBenchmark) / scopeBenchmark) * 100 : null;
          tableRows.push(
            <div key={`subtotal-${scope}`} className="grid grid-cols-[80px_1fr_120px_120px_70px] border-b border-gray-200 px-3 py-2" style={{ backgroundColor: `${BRAND}12` }}>
              <span className="text-xs font-semibold text-gray-700">{scope}</span>
              <span className="text-xs font-semibold text-gray-700">Sub-total</span>
              {hasBenchmark ? <span className="text-xs font-semibold text-gray-700 text-right">{fmt(scopeBenchmark ?? 0)}</span> : <span className="text-xs text-gray-400 text-right">—</span>}
              <span className="text-xs font-semibold text-gray-700 text-right">{fmt(scopeCurrent)}</span>
              {hasBenchmark ? (
                subPct === null
                  ? <span className="text-xs font-semibold text-right text-gray-400">-</span>
                  : <span className="text-xs font-semibold text-right" style={{ color: subPct < 0 ? "#16a34a" : subPct > 0 ? "#dc2626" : "#6b7280" }}>{subPct >= 0 ? "+" : ""}{fmt(subPct, 1)}%</span>
              ) : <span className="text-xs text-gray-400 text-right">—</span>}
            </div>
          );
        }
        return (
          <Card data-section="Emissions by Scope and Category">
            <CardHeader className="pb-3"><SectionHeader title="Emissions by Scope and Category" /></CardHeader>
            <CardContent className="space-y-4">
              <div className="overflow-x-auto">
              <div className="overflow-hidden rounded-lg border border-gray-200 min-w-[480px]">
                <div className="grid grid-cols-[80px_1fr_120px_120px_70px] px-3 py-2" style={{ backgroundColor: BRAND }}>
                  <span className="text-xs font-semibold uppercase tracking-wide text-white">Scope</span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-white">Category</span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-white text-right">
                    {hasBenchmark ? `${data.job_data.benchmark_period_start ? formatDate(data.job_data.benchmark_period_start) : "Benchmark"} tCO₂e` : "Benchmark tCO₂e"}
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-white text-right">Current Year tCO₂e</span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-white text-right">% vs BM</span>
                </div>
                {tableRows}
                <div className="grid grid-cols-[80px_1fr_120px_120px_70px] border-t-2 border-gray-300 px-3 py-2 bg-gray-50">
                  <span className="text-xs font-bold text-gray-700 uppercase col-span-2">Total Emissions</span>
                  {hasBenchmark ? <span className="text-xs font-bold text-gray-700 text-right">{fmt(grandBenchmarkTotal)}</span> : <span className="text-xs text-gray-400 text-right">—</span>}
                  <span className="text-xs font-bold text-gray-700 text-right">{fmt(grandCurrentTotal)}</span>
                  {hasBenchmark ? <span className="text-xs font-bold text-right" style={{ color: grandPct < 0 ? "#16a34a" : grandPct > 0 ? "#dc2626" : "#6b7280" }}>{grandPct >= 0 ? "+" : ""}{fmt(grandPct, 1)}%</span> : <span className="text-xs text-gray-400 text-right">—</span>}
                </div>
              </div>
              </div>
              {(() => {
                const txt = String(data.template_variables?.footprint_summary ?? "").trim();
                if (!txt) return null;
                return (
                  <div className="space-y-3">
                    {txt.split(/\n\n+/).map((para, i) => (
                      <p key={i} className="text-sm leading-relaxed text-gray-700">{para.trim()}</p>
                    ))}
                  </div>
                );
              })()}
              <p className="text-xs text-gray-600">A detailed breakdown of emissions is set out in Appendix 1.</p>
            </CardContent>
          </Card>
        );
      })()}

      {/* ── 9. Historical Emissions Trend ──────────────────────────────── */}
      {effectiveYearlyEmissions.length > 0 && (
        <Card data-section="Historical Emissions Trend">
          <CardHeader className="pb-3"><SectionHeader title="Historical Emissions Trend" /></CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={effectiveYearlyEmissions.filter((r) => r.year >= baselineYear)} margin={{ top: 8, right: 24, left: 8, bottom: 8 }} barCategoryGap="35%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" vertical={false} />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} padding={{ left: 60, right: 60 }} />
                  <YAxis tickFormatter={(v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 })} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={52} />
                  <Tooltip formatter={((v: unknown, name: unknown) => formatTooltipValue(v, name)) as any} labelFormatter={(l: unknown) => `Year: ${l}`} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="scope1" name="Scope 1" stackId="a" fill={SCOPE_COLORS["Scope 1"]} isAnimationActive={false} />
                  <Bar dataKey="scope2" name="Scope 2" stackId="a" fill={SCOPE_COLORS["Scope 2"]} isAnimationActive={false} />
                  <Bar dataKey="scope3" name="Scope 3" stackId="a" fill={SCOPE_COLORS["Scope 3"]} radius={[3, 3, 0, 0]} isAnimationActive={false}>
                    <LabelList dataKey="total" position="top" formatter={(v: unknown) => typeof v === "number" ? fmt(v, 0) : ""} style={{ fontSize: 9, fill: "#6b7280" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── 10. Carbon Reduction Actions ───────────────────────────────── */}
      <Card data-section="Carbon Reduction Actions">
        <CardHeader className="pb-3"><SectionHeader title="Carbon Reduction Actions" /></CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-gray-700 leading-relaxed">
            {data.job_data.client_name ?? "The organisation"} has identified the following key areas for emissions reduction. These actions will support the company strategy to meet the reduction targets.
          </p>
          <div>
            <p className="text-sm font-bold text-gray-800 mb-3">Planned Initiatives</p>
            <table className="w-full border-collapse border border-gray-200 text-sm" style={{ tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "7%" }} />
                <col style={{ width: "20%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "59%" }} />
              </colgroup>
              <thead>
                <tr style={{ backgroundColor: "#8abb8a" }}>
                  <th className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-white">Term</th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-white">Action</th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-white">Category</th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-white">Description</th>
                </tr>
              </thead>
              <tbody>
                {(job_actions?.total_actions ?? 0) > 0
                  ? (job_actions?.items ?? []).map((item, ii) => {
                      const termCode = String(item.action_term ?? "medium");
                      const termMeta = PLANNED_INITIATIVES_TERM_META[termCode];
                      return (
                        <tr
                          key={ii}
                          className={ii % 2 === 1 ? "bg-gray-50" : "bg-white"}
                          style={{ breakInside: "avoid", pageBreakInside: "avoid" }}
                        >
                          <td className="px-3 py-3 align-top">
                            <span className={`inline-flex items-center justify-center rounded-full border w-6 h-6 text-xs font-medium ${termMeta?.className ?? "border-amber-400 bg-amber-50 text-amber-700"}`}>
                              {termMeta?.label ?? String(item.action_term_label ?? termCode).charAt(0).toUpperCase()}
                            </span>
                          </td>
                          <td className="px-3 py-3 align-top font-semibold text-gray-800">{String(item.action_name ?? "")}</td>
                          <td className="px-3 py-3 align-top text-gray-600">{String(item.action_category ?? "")}</td>
                          <td className="px-3 py-3 align-top text-gray-600">{String(item.description ?? "")}</td>
                        </tr>
                      );
                    })
                  : (
                    <tr style={{ breakInside: "avoid", pageBreakInside: "avoid" }}>
                      <td className="px-3 py-3 align-top">
                        <span className="inline-flex items-center justify-center rounded-full border w-6 h-6 text-xs font-medium border-green-400 bg-green-50 text-green-700">S</span>
                      </td>
                      <td className="px-3 py-3 align-top font-semibold text-gray-800">Action plan in development</td>
                      <td className="px-3 py-3 align-top text-gray-600">General</td>
                      <td className="px-3 py-3 align-top text-gray-600">Actions will be added by the NZI team prior to final issue.</td>
                    </tr>
                  )}
              </tbody>
            </table>
          </div>
          {actionsNarrativeText && (
            <div className="space-y-2">
              {actionsNarrativeText.split(/\n\n+/).map((para, i) => (
                <p key={i} className="text-sm text-gray-700 leading-relaxed">{para.trim()}</p>
              ))}
            </div>
          )}
          <div className="pt-4 space-y-4 max-w-sm" style={{ breakInside: "avoid", pageBreakInside: "avoid" }}>
            <p className="text-sm font-semibold text-gray-800">Approved by:</p>
            <div className="space-y-5">
              <div>
                <p className="text-sm text-gray-500 mb-1">Name:</p>
                {report_metadata?.client_signee_name && (
                  <p className="text-sm text-gray-800">{report_metadata.client_signee_name}</p>
                )}
                <div className="border-b border-gray-400 w-56" />
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">Position:</p>
                {report_metadata?.client_signee_position && (
                  <p className="text-sm text-gray-800">{report_metadata.client_signee_position}</p>
                )}
                <div className="border-b border-gray-400 w-56" />
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">Date:</p>
                {report_metadata?.client_signature_date && (
                  <p className="text-sm text-gray-800">{fmtSignatureDate(report_metadata.client_signature_date)}</p>
                )}
                <div className="border-b border-gray-400 w-56" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── 12. Standards & Methodology ────────────────────────────────── */}
      <Card data-section="Standards & Methodology">
        <CardHeader className="pb-3"><SectionHeader title="Standards & Methodology" /></CardHeader>
        <CardContent className="space-y-4 text-sm text-gray-700">
          <table className="w-full border-collapse text-xs">
            <tbody>
              <tr className="border-b border-gray-100">
                <td className="py-2 pr-4 text-gray-500 w-1/3 align-top">Framework</td>
                <td className="py-2 font-medium">{report_metadata?.methodologies_used ?? "GHG Protocol Corporate Standard"}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2 pr-4 text-gray-500 align-top">Emission Factors</td>
                <td className="py-2 font-medium">{report_metadata?.datasets_names ?? "DESNZ Greenhouse Gas Conversion Factors"}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2 pr-4 text-gray-500 align-top">Reporting Standard</td>
                <td className="py-2 font-medium">GHG Protocol</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2 pr-4 text-gray-500 align-top">Scope Coverage</td>
                <td className="py-2 font-medium">Scope 1, 2 and 3 (material categories)</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 text-gray-500 align-top">Prepared by</td>
                <td className="py-2 font-medium">Net Zero International Limited</td>
              </tr>
            </tbody>
          </table>
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3">
            <p className="text-xs text-gray-700"><span className="font-semibold">Note:</span> Emissions figures are rounded to the nearest 1 decimal place. As a consequence, small differences in totals may occur due to rounding.</p>
          </div>
        </CardContent>
      </Card>

      {/* ── 13. Declaration / Sign-off ──────────────────────────────────── */}
      <Card data-section="Declaration and Sign Off">
        <CardHeader className="pb-3"><SectionHeader title="Declaration and Sign Off" /></CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-lg border-2 border-red-400 p-5 space-y-3">
            <p className="text-base font-bold" style={{ color: "#c0392b" }}>Independent Verification Statement</p>
            <p className="text-sm text-gray-700 leading-relaxed">
              This greenhouse gas emissions report has been prepared in accordance with the GHG Protocol Corporate Accounting and Reporting Standard. The data and calculations have been independently verified by Net Zero International.
            </p>
            {(data.job_data.reporting_period_start || data.job_data.reporting_period_end) && (
              <p className="text-sm text-gray-700">
                <span className="font-semibold">Verification Scope:</span>{" "}
                All Scope 1, 2, and 3 emissions for the reporting period{" "}
                {data.job_data.reporting_period_start ? formatDate(data.job_data.reporting_period_start) : ""}
                {data.job_data.reporting_period_start && data.job_data.reporting_period_end ? " to " : ""}
                {data.job_data.reporting_period_end ? formatDate(data.job_data.reporting_period_end) : ""}.
              </p>
            )}
            <p className="text-sm text-gray-700"><span className="font-semibold">Assurance Level:</span> Limited Assurance</p>
            <div className="pt-3 space-y-1 max-w-xs">
              {report_metadata?.consultant_name && (
                <p className="text-base italic" style={{ fontFamily: "Georgia, serif" }}>{report_metadata.consultant_name}</p>
              )}
              <div className="border-b border-gray-800 w-56 mb-3" />
              {report_metadata?.consultant_position && <p className="text-xs text-gray-500">{report_metadata.consultant_position}</p>}
              {report_metadata?.consultant_name && <p className="text-sm text-gray-700">{report_metadata.consultant_name}</p>}
              {report_metadata?.consultant_signature_date && <p className="text-sm text-gray-700">{fmtSignatureDate(report_metadata.consultant_signature_date)}</p>}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── 14. Glossary ───────────────────────────────────────────────── */}
      {hasGlossary && (
        <Card data-section="Glossary">
          <CardHeader className="pb-3"><SectionHeader title="Glossary" /></CardHeader>
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
                    <td className="py-2.5 pr-4 text-xs font-semibold text-gray-700 align-top">{card.term}</td>
                    <td className="py-2.5 text-xs text-gray-600 leading-relaxed">{card.definition}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* ── 15. Appendix — Full Emissions Audit ────────────────────────── */}
      {hasAppendix && (
        <Card data-section="Appendix 1 — Full Emissions Audit">
          <CardHeader className="pb-3"><SectionHeader title="Appendix — Full Emissions Audit" /></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b-2 border-gray-200">
                    <th className="py-2 pr-3 text-left font-semibold text-gray-500">Site</th>
                    <th className="py-2 pr-3 text-left font-semibold text-gray-500">Scope</th>
                    <th className="py-2 pr-3 text-left font-semibold text-gray-500">Category</th>
                    <th className="py-2 pr-3 text-left font-semibold text-gray-500">Details</th>
                    <th className="py-2 pr-3 text-right font-semibold text-gray-500">Qty</th>
                    <th className="py-2 pr-3 text-left font-semibold text-gray-500">Unit</th>
                    <th className="py-2 text-right font-semibold text-gray-500">tCO₂e</th>
                  </tr>
                </thead>
                <tbody>
                  {appendixRows.map((row, i) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/60">
                      <td className="py-1.5 pr-3 text-gray-600">{row.site_name ?? "—"}</td>
                      <td className="py-1.5 pr-3 text-gray-600">{row.scope ?? "—"}</td>
                      <td className="py-1.5 pr-3 text-gray-600">{row.category ?? "—"}</td>
                      <td className="py-1.5 pr-3 text-gray-600">{row.emission_type ?? "—"}</td>
                      <td className="py-1.5 pr-3 text-right text-gray-700">{row.qty != null ? fmt(toNum(row.qty)) : "—"}</td>
                      <td className="py-1.5 pr-3 text-gray-500">{row.uom ?? "—"}</td>
                      <td className="py-1.5 text-right font-semibold text-gray-800">{row.emissions != null ? fmt(toNum(row.emissions)) : "—"}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-gray-300" style={{ breakInside: "avoid", pageBreakInside: "avoid" }}>
                    <td colSpan={6} className="py-2 pr-3 text-xs font-bold text-gray-700">Total</td>
                    <td className="py-2 text-right text-xs font-bold text-gray-800">{fmt(totalEmissions)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Appendix 2 — Emissions by Site, Scope and Category ─────────── */}
      {hasAppendix && (() => {
        const SCOPE_ORDER = ["Scope 1", "Scope 2", "Scope 3"];
        type SiteScopeCat = Map<string, Map<string, Map<string, number>>>;
        const tree: SiteScopeCat = new Map();
        const siteTotals = new Map<string, number>();
        for (const row of appendixRows) {
          const site = row.site_name ?? "Unassigned";
          const scope = row.scope ?? "Other";
          const cat = row.category ?? "Uncategorized";
          const em = toNum(row.emissions);
          if (!tree.has(site)) tree.set(site, new Map());
          const siteMap = tree.get(site)!;
          if (!siteMap.has(scope)) siteMap.set(scope, new Map());
          const scopeMap = siteMap.get(scope)!;
          scopeMap.set(cat, (scopeMap.get(cat) ?? 0) + em);
          siteTotals.set(site, (siteTotals.get(site) ?? 0) + em);
        }
        const sites = Array.from(tree.keys()).sort((a, b) => (siteTotals.get(b) ?? 0) - (siteTotals.get(a) ?? 0));
        return (
          <Card data-section="Appendix 2 — Emissions by Site, Scope and Category">
            <CardHeader className="pb-3"><SectionHeader title="Appendix 2 — Emissions by Site, Scope and Category" /></CardHeader>
            <CardContent>
              <div className="space-y-6">
                {sites.map(site => {
                  const scopeMap = tree.get(site)!;
                  const siteTotal = siteTotals.get(site) ?? 0;
                  const orderedScopes = SCOPE_ORDER.filter(s => scopeMap.has(s)).concat(
                    Array.from(scopeMap.keys()).filter(s => !SCOPE_ORDER.includes(s))
                  );
                  return (
                    <div key={site} className="rounded-lg border border-gray-200 overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-2.5" style={{ backgroundColor: BRAND }}>
                        <span className="text-sm font-semibold text-white">{site}</span>
                        <span className="text-sm font-semibold text-white">{fmt(siteTotal)} tCO₂e</span>
                      </div>
                      {orderedScopes.map((scope, si) => {
                        const catMap = scopeMap.get(scope)!;
                        const scopeTotal = Array.from(catMap.values()).reduce((s, v) => s + v, 0);
                        const cats = Array.from(catMap.entries()).sort((a, b) => b[1] - a[1]);
                        return (
                          <div key={scope} className={si > 0 ? "border-t border-gray-200" : ""}>
                            <div className="flex items-center justify-between bg-gray-100 px-4 py-2">
                              <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">{scope}</span>
                              <span className="text-xs font-semibold text-gray-700">{fmt(scopeTotal)} tCO₂e</span>
                            </div>
                            {cats.map(([cat, em], ci) => (
                              <div key={cat} className={`flex items-center justify-between px-4 py-2 border-b border-gray-50 last:border-0 ${ci % 2 === 0 ? "bg-white" : "bg-gray-50/50"}`}>
                                <span className="text-xs text-gray-700 pl-4">{cat}</span>
                                <span className="text-xs text-gray-800 font-medium">{fmt(em)}</span>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* ── Review Commentary button (bottom of report) ────────────────── */}
      {canAddNotes && (
        <div className="flex justify-center py-8">
          <button
            ref={notesTriggerRef}
            onClick={() => {
              window.scrollTo({ top: 0, behavior: "smooth" });
              setTimeout(() => {
                setCurrentSection(currentSectionRef.current);
                notesOpenRef.current = true;
                setNotesOpen(true);
              }, 400);
            }}
            className="rounded-lg px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:opacity-90"
            style={{ backgroundColor: BRAND }}
          >
            Review Commentary &amp; Edits
          </button>
        </div>
      )}

      {/* ── Floating Review Notes panel ────────────────────────────────── */}
      {notesOpen && canAddNotes && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Review Notes"
          className="fixed top-20 right-4 z-50 flex w-80 flex-col rounded-xl border border-gray-200 bg-white shadow-2xl"
          style={{ maxHeight: "calc(100vh - 100px)" }}
        >
          <div className="flex items-center justify-between rounded-t-xl px-4 py-3 text-white" style={{ backgroundColor: BRAND }}>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide opacity-80">Review Notes</div>
              <div className="text-xs opacity-70 truncate">Section: {currentSection}</div>
            </div>
            <button onClick={() => { notesOpenRef.current = false; setNotesOpen(false); }} className="ml-2 rounded p-1 hover:bg-white/20 text-white" aria-label="Close review notes">✕</button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2" style={{ maxHeight: 260 }}>
            {existingComments.filter((c: any) => c.author_type === "client").length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">No notes yet. Add your first note below.</p>
            ) : (
              existingComments
                .filter((c: any) => c.author_type === "client")
                .map(c => (
                  <div key={c.comment_id} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs">
                    {c.section_reference && (
                      <div className="text-gray-400 font-medium mb-0.5">{c.section_reference}</div>
                    )}
                    <div className="text-gray-700">{c.comment_text}</div>
                    <div className={`mt-1 text-gray-400 ${c.status === "addressed" ? "line-through" : ""}`}>
                      {c.status === "addressed" ? "Addressed" : "Open"}
                    </div>
                  </div>
                ))
            )}
          </div>

          <div className="border-t border-gray-100 px-3 py-3 space-y-2">
            <div className="text-xs text-gray-500">Adding note for: <span className="font-medium text-gray-700">{currentSection}</span></div>
            <textarea
              ref={notesTextareaRef}
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
              rows={3}
              placeholder="Add a note or change request…"
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
            />
            {noteError && <div className="text-xs text-red-600">{noteError}</div>}
            {noteSuccess && <div className="text-xs text-green-600">Note submitted.</div>}
            <button
              onClick={() => void submitNote()}
              disabled={submittingNote || !noteText.trim()}
              className="w-full rounded-md py-2 text-xs font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: BRAND }}
            >
              {submittingNote ? "Submitting…" : "Submit Note"}
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
