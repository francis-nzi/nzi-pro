"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
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
import LoadingOrbit from "@/components/LoadingOrbit";
import { formatDate } from "@/lib/format";
import {
  EmissionsByActivityWidget,
  EmissionsReductionPathwayWidget,
  ScopeSummaryDonutWidget,
  ScopeYearOnYearBarWidget,
  buildEmissionsReductionPathwayData,
  buildScopeDonutItems,
  resolveScopeDonutBenchmarkTotal,
  resolveScopeDonutBenchmarkYear,
} from "@/components/report-widgets";

/** Convert a reporting period to a compact year label: "2025" or "2022Ã¢â‚¬â€œ2023". */
function toYearLabel(start: string | null | undefined, end: string | null | undefined): string {
  const sy = start ? new Date(start).getFullYear() : null;
  const ey = end   ? new Date(end).getFullYear()   : null;
  if (sy && ey && sy !== ey) return `${sy}-${ey}`;
  return String(ey ?? sy ?? "");
}

function toYearNumber(start: string | null | undefined, end: string | null | undefined): number | null {
  const sy = start ? new Date(start).getFullYear() : null;
  const ey = end ? new Date(end).getFullYear() : null;
  return ey ?? sy ?? null;
}

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
  crm_owner?: string | null;
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

type SiteOverallRow = {
  site_name?: string | null;
  total?: number | null;
  pct_total?: number | null;
};

type SiteScopeRow = {
  site_name?: string | null;
  scope_1?: number | null;
  scope_2?: number | null;
  scope_3?: number | null;
  total?: number | null;
};

type SiteActivityRow = {
  site_name?: string | null;
  energy?: number | null;
  business_travel?: number | null;
  employee_commuting?: number | null;
  pgs?: number | null;
  other?: number | null;
  total?: number | null;
};

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
  category?: string | null;
  report_label?: string | null;
  activity_group?: string | null;
  emissions?: number | null;
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
  benchmark_totals?: Record<string, number | null | undefined>;
  categories?: EmissionCategory[];
  benchmark_categories?: EmissionCategory[];
  previous_year_categories?: EmissionCategory[];
  previous_year_label?: string | null;
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
  nzi_logo_src?: string | null;
};

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Constants Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

const SCOPE_LABELS = ["Scope 1", "Scope 2", "Scope 3"] as const;

const SCOPE_COLORS: Record<string, string> = {
  "Scope 1": "#0f766e",
  "Scope 2": "#0891b2",
  "Scope 3": "#38bdf8",
};

const BRAND = "#1c3a2c";

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Helpers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

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
  if (kwh >= 1_000_000) return `${fmt(kwh / 1_000_000)} GWh`;
  if (kwh >= 1_000) return `${fmt(kwh / 1_000, 1)} MWh`;
  return `${fmt(kwh, 0)} kWh`;
}

function boolLabel(v: boolean | null | undefined): string {
  if (v == null) return "Ã¢â‚¬â€";
  return v ? "Yes" : "No";
}

function fmtSignatureDate(raw: string | null | undefined): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ WrapLegend Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Recharts' default legend renders in a single row and overflows at narrow
// print widths. This custom renderer allows items to wrap to multiple lines.

type LegendEntry = { color?: string; value?: string };
function WrapLegend({ payload }: { payload?: LegendEntry[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 10px", fontSize: 10, paddingTop: 4 }}>
      {(payload ?? []).map((entry, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center", gap: 3, whiteSpace: "nowrap" }}>
          <span style={{
            display: "inline-block", width: 8, height: 8, borderRadius: "50%",
            backgroundColor: entry.color ?? "#999", flexShrink: 0,
          }} />
          <span>{entry.value}</span>
        </span>
      ))}
    </div>
  );
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ NetZeroTrendChart Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

function NetZeroTrendChart({
  yearlyEmissions,
  baselineYear,
  endYear,
  interimYear,
  interimPct,
  targetPct,
  scope1Fallback,
  scope2Fallback,
  scope3Fallback,
}: {
  yearlyEmissions: YearlyEmission[];
  baselineYear: number;
  endYear: number;
  interimYear?: number | null;
  interimPct?: number;
  targetPct?: number;
  scope1Fallback: number;
  scope2Fallback: number;
  scope3Fallback: number;
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
    yearlyEmissions.forEach(r => { if (r.year <= endYear) yearSet.add(r.year); });
    const years = Array.from(yearSet).sort((a, b) => a - b);

    return years.map(year => {
      const actual = yearlyEmissions.find(r => r.year === year);
      return {
        year,
        actual_total: actual ? actual.total : null,
        actual_s1: actual ? actual.scope1 : null,
        actual_s2: actual ? actual.scope2 : null,
        actual_s3: actual ? actual.scope3 : null,
        target_total: forecastScope(benchS1, year) + forecastScope(benchS2, year) + forecastScope(benchS3, year),
        target_s1: forecastScope(benchS1, year),
        target_s2: benchS2 > 0 ? forecastScope(benchS2, year) : undefined,
        target_s3: forecastScope(benchS3, year),
      };
    });
  }, [yearlyEmissions, baselineYear, endYear, interimYear, interimPct, targetPct,
      scope1Fallback, scope2Fallback, scope3Fallback]);

  const hasScope2 = (chartData[0]?.target_s2 ?? 0) > 0;

  const tickYears = useMemo(() =>
    chartData
      .filter(d => d.year === chartData[0]?.year || d.year === endYear || d.year % 5 === 0)
      .map(d => d.year),
    [chartData, endYear],
  );

  return (
    <div className="h-[320px]">
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={chartData} margin={{ top: 5, right: 24, left: 8, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="year"
            ticks={tickYears}
            tickFormatter={(v: number) => String(v)}
            tick={{ fontSize: 10 }}
          />
          <YAxis
            tickFormatter={(v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            tick={{ fontSize: 10 }}
          />
          <Tooltip
            formatter={(value: unknown) => [value != null ? `${fmt(Number(value))} tCOÃ¢â€šâ€še` : "Ã¢â‚¬â€", ""]}
            labelFormatter={(label: unknown) => `Year: ${label}`}
          />
          <Legend content={(p) => <WrapLegend payload={(p.payload as LegendEntry[] | undefined)} />} />

          {interimYear && interimYear > baselineYear && interimYear < endYear && (
            <ReferenceLine x={interimYear} stroke="#f59e0b" strokeDasharray="3 3"
              label={{ value: "Interim", position: "top", fill: "#f59e0b", fontSize: 9 }} />
          )}
          <ReferenceLine x={endYear} stroke="#16a34a" strokeDasharray="3 3"
            label={{ value: "Net Zero", position: "top", fill: "#16a34a", fontSize: 9 }} />

          {/* Actual lines shown in legend; target lines hidden (dashed, same colour) */}
          <Line type="monotone" dataKey="actual_total" name="Total"
            stroke="#0f766e" strokeWidth={3} dot={{ r: 5 }} activeDot={{ r: 6 }} connectNulls={false} />
          <Line type="monotone" dataKey="actual_s1" name="Scope 1"
            stroke={SCOPE_COLORS["Scope 1"]} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
          {hasScope2 && (
            <Line type="monotone" dataKey="actual_s2" name="Scope 2"
              stroke={SCOPE_COLORS["Scope 2"]} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
          )}
          <Line type="monotone" dataKey="actual_s3" name="Scope 3"
            stroke={SCOPE_COLORS["Scope 3"]} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
          <Line type="monotone" dataKey="target_total" legendType="none"
            stroke="#0f766e" strokeWidth={2} strokeDasharray="5 4" dot={false} />
          <Line type="monotone" dataKey="target_s1" legendType="none"
            stroke={SCOPE_COLORS["Scope 1"]} strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
          {hasScope2 && (
            <Line type="monotone" dataKey="target_s2" legendType="none"
              stroke={SCOPE_COLORS["Scope 2"]} strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
          )}
          <Line type="monotone" dataKey="target_s3" legendType="none"
            stroke={SCOPE_COLORS["Scope 3"]} strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-1 text-[10px] text-gray-400 text-center">
        Solid lines = actual emissions &nbsp;Ã‚Â·&nbsp; Dashed lines = reduction target pathway
      </p>
    </div>
  );
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ IntensityPathwayChart Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

const INTENSITY_COLORS = ["#0ea5e9", "#14b8a6", "#f97316", "#8b5cf6"];

function IntensityPathwayChart({
  yearlyEmissions,
  baselineYear,
  endYear,
  interimYear,
  interimS1Pct,
  interimS2Pct,
  interimS3Pct,
  targetPct,
  scope1Fallback,
  scope2Fallback,
  scope3Fallback,
  intensityMetrics,
}: {
  yearlyEmissions: YearlyEmission[];
  baselineYear: number;
  endYear: number;
  interimYear?: number | null;
  interimS1Pct?: number;
  interimS2Pct?: number;
  interimS3Pct?: number;
  targetPct?: number;
  scope1Fallback: number;
  scope2Fallback: number;
  scope3Fallback: number;
  intensityMetrics: Record<string, { label?: string; value?: number | null; divider?: number | null }>;
}) {
  const metricEntries = useMemo(() =>
    Object.entries(intensityMetrics)
      .map(([key, m]) => {
        const value = toNum(m.value);
        const divider = toNum(m.divider) || 1;
        return { key, label: m.label?.trim() || key, value, divider };
      })
      .filter((e) => e.value > 0)
      .slice(0, 4),
    [intensityMetrics],
  );

  const chartData = useMemo(() => {
    if (metricEntries.length === 0) return [];

    const bYear = baselineYear > 1900 ? baselineYear : (yearlyEmissions[0]?.year ?? new Date().getFullYear() - 1);
    const benchmarkRow = yearlyEmissions.find((r) => r.year === bYear);
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

    const forecastTotal = (year: number): number =>
      forecastScope(bS1, interimS1Pct ?? 50, year) +
      forecastScope(bS2, interimS2Pct ?? 50, year) +
      forecastScope(bS3, interimS3Pct ?? 50, year);

    const yearSet = new Set<number>();
    for (let y = bYear; y <= endYear; y++) yearSet.add(y);
    yearlyEmissions.forEach((r) => { if (r.year <= endYear) yearSet.add(r.year); });
    const years = Array.from(yearSet).sort((a, b) => a - b);

    return years.map((year) => {
      const actual = yearlyEmissions.find((r) => r.year === year);
      const forecast = forecastTotal(year);
      const row: Record<string, number | string | null> = { year };
      metricEntries.forEach((entry) => {
        row[`${entry.label}_actual`] = actual
          ? parseFloat(((actual.total * entry.divider) / entry.value).toFixed(3))
          : null;
        row[`${entry.label}_target`] = parseFloat(((forecast * entry.divider) / entry.value).toFixed(3));
      });
      return row;
    });
  }, [metricEntries, yearlyEmissions, baselineYear, endYear, interimYear,
      interimS1Pct, interimS2Pct, interimS3Pct, targetPct,
      scope1Fallback, scope2Fallback, scope3Fallback]);

  const tickYears = useMemo(() =>
    chartData
      .filter((d) => d.year === chartData[0]?.year || d.year === endYear || Number(d.year) % 5 === 0)
      .map((d) => Number(d.year)),
    [chartData, endYear],
  );

  if (chartData.length === 0 || metricEntries.length === 0) return null;

  return (
    <div className="h-[320px]">
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={chartData} margin={{ top: 5, right: 24, left: 8, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="year"
            ticks={tickYears}
            tickFormatter={(v: number) => String(v)}
            tick={{ fontSize: 10 }}
          />
          <YAxis
            tickFormatter={(v: number) => v.toFixed(1)}
            tick={{ fontSize: 10 }}
          />
          <Tooltip
            formatter={(value: unknown) => [value != null ? `${Number(value).toFixed(3)} tCOÃ¢â€šâ€še` : "Ã¢â‚¬â€", ""]}
            labelFormatter={(label: unknown) => `Year: ${label}`}
          />
          <Legend content={(p) => <WrapLegend payload={(p.payload as LegendEntry[] | undefined)} />} />
          {interimYear && interimYear > baselineYear && interimYear < endYear && (
            <ReferenceLine x={interimYear} stroke="#f59e0b" strokeDasharray="3 3"
              label={{ value: "Interim", position: "top", fill: "#f59e0b", fontSize: 9 }} />
          )}
          <ReferenceLine x={endYear} stroke="#16a34a" strokeDasharray="3 3"
            label={{ value: "Net Zero", position: "top", fill: "#16a34a", fontSize: 9 }} />
          {metricEntries.flatMap((entry, index) => [
            <Line key={`${entry.key}_actual`} type="monotone" dataKey={`${entry.label}_actual`}
              name={entry.label}
              stroke={INTENSITY_COLORS[index % INTENSITY_COLORS.length]} strokeWidth={2.5}
              dot={{ r: 5 }} activeDot={{ r: 6 }} connectNulls={false} />,
            <Line key={`${entry.key}_target`} type="monotone" dataKey={`${entry.label}_target`}
              legendType="none"
              stroke={INTENSITY_COLORS[index % INTENSITY_COLORS.length]} strokeWidth={1.5}
              strokeDasharray="5 4" dot={false} />,
          ])}
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-1 text-[10px] text-gray-400 text-center">
        Solid lines = actual &nbsp;Ã‚Â·&nbsp; Dashed lines = target pathway
      </p>
    </div>
  );
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ CoverPage Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

function CoverPage({ data }: { data: LiveData }) {
  const { job_data, report_metadata, template_variables, nzi_logo_src } = data;

  const reportTitle = String(job_data.title || "Carbon Report").trim();

  const generatedDate = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

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
    ["Report Generated", generatedDate],
  ];

  return (
    <section className="live-report-section print:break-after-page flex flex-col items-center bg-white rounded-lg border border-gray-200 overflow-hidden mb-6 py-12 px-10 text-center">

      {/* NZI logo */}
      {nzi_logo_src ? (
        <img src={nzi_logo_src} alt="Net Zero International" className="h-20 w-auto object-contain" />
      ) : (
        <span className="text-sm font-bold uppercase tracking-widest" style={{ color: BRAND }}>
          Net Zero International
        </span>
      )}

      {/* Report title */}
      <h1 className="mt-8 text-2xl font-bold leading-snug" style={{ color: "#1e3a5f" }}>
        {reportTitle}
      </h1>

      {/* Client logo */}
      {job_data.logo_url && (
        <img
          src={job_data.logo_url}
          alt={job_data.client_name ?? "Client"}
          className="mt-5 max-h-16 max-w-[160px] w-auto object-contain"
        />
      )}

      {/* Parameters table */}
      <div className="mt-8 w-full max-w-md text-left border border-l-4 border-gray-200 rounded-md overflow-hidden"
           style={{ borderLeftColor: "#1e3a5f" }}>
        {params.map(([label, value]) => value ? (
          <div key={label} className="grid grid-cols-[44mm_1fr] border-b border-gray-100 last:border-b-0">
            <div className="px-3 py-2 text-xs font-semibold text-gray-500 bg-gray-50">{label}</div>
            <div className="px-3 py-2 text-xs text-gray-800">{value}</div>
          </div>
        ) : null)}
      </div>

      {/* Footer note */}
      <p className="mt-8 text-xs text-gray-400">
        Prepared by Net Zero International &mdash; Confidential. For authorised recipients only.
      </p>

    </section>
  );
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ SectionHeader helper Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

function SectionHeader({ title }: { title: string }) {
  return (
    <CardTitle className="text-base font-semibold" style={{ color: BRAND }}>
      {title}
    </CardTitle>
  );
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ MetaRow helper Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

function MetaRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value == null || String(value).trim() === "") return null;
  return (
    <div className="flex gap-3 py-1.5 border-b border-gray-50 last:border-0">
      <span className="w-44 shrink-0 text-xs text-gray-400">{label}</span>
      <span className="text-xs text-gray-700 font-medium">{String(value)}</span>
    </div>
  );
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Main component Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

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
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfFilename, setPdfFilename] = useState<string>("report.pdf");
  const [versions, setVersions] = useState<ReactReportVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [markingFinal, setMarkingFinal] = useState<number | null>(null);
  const [activeTemplate, setActiveTemplate] = useState<"crp" | "secr">("crp");
  const [sendingToPortal, setSendingToPortal] = useState(false);
  const [sendToPortalResult, setSendToPortalResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [storedWidgetPngs, setStoredWidgetPngs] = useState<Record<string, string>>({});

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
      .then(async r => {
        if (!r.ok) {
          let detail = `${r.status} ${r.statusText}`;
          try {
            const body = await r.json() as { detail?: string };
            if (body.detail) detail = `${r.status}: ${body.detail}`;
          } catch { /* ignore */ }
          throw new Error(detail);
        }
        return r.json() as Promise<LiveData>;
      })
      .then(d => setData(d))
      .catch(e => setFetchError(String(e)))
      .finally(() => setLoading(false));
  }, [jobId, baseUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // When Playwright renders for PDF (use_widget_pngs=1), fetch stored PNGs so
  // widgets can render them as <img> tags instead of live Recharts charts.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("use_widget_pngs") !== "1") return;
    void (async () => {
      try {
        const res = await fetch(`${baseUrl}/jobs/${jobId}/widget-pngs`, { credentials: "include" });
        if (!res.ok) return;
        const d = await res.json() as { pngs?: Record<string, string> };
        if (d.pngs && Object.keys(d.pngs).length > 0) setStoredWidgetPngs(d.pngs);
      } catch { /* silently ignore */ }
    })();
  }, [jobId, baseUrl]);

  async function downloadPdf() {
    setDownloading(true);
    setDownloadError(null);
    try {
      const res = await authFetch(`${baseUrl}/jobs/${jobId}/report-live-pdf`);
      if (!res.ok) {
        let detail = `PDF generation failed (${res.status})`;
        try {
          const body = await res.json() as { detail?: string };
          if (body.detail) detail = body.detail;
        } catch { /* ignore */ }
        throw new Error(detail);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const clientSlug = String(data?.job_data?.client_name ?? "report").replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").toLowerCase();
      const year = data?.job_data?.reporting_year ?? new Date().getFullYear();
      const filename = `${clientSlug}-crp-${year}.pdf`;
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
      setPdfFilename(filename);
      setPdfBlobUrl(url);
    } catch (e) {
      setDownloadError((e as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  function closePdfViewer() {
    if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    setPdfBlobUrl(null);
  }

  function savePdfToDisk() {
    if (!pdfBlobUrl) return;
    const a = document.createElement("a");
    a.href = pdfBlobUrl;
    a.download = pdfFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

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

  async function sendToPortal() {
    if (!confirm("Send this report to the client portal for review?\n\nThe client will be notified and will see the current version of the report.")) return;
    setSendingToPortal(true);
    setSendToPortalResult(null);
    try {
      const res = await authFetch(`${baseUrl}/jobs/${jobId}/review/send-to-portal`, { method: "POST" });
      const body = await res.json() as { ok?: boolean; sent_to_count?: number; detail?: string };
      if (!res.ok) throw new Error(body.detail ?? `Server returned ${res.status}`);
      const count = body.sent_to_count ?? 0;
      setSendToPortalResult({ ok: true, message: `Report sent to portal. ${count} client user${count === 1 ? "" : "s"} notified.` });
    } catch (e) {
      setSendToPortalResult({ ok: false, message: String(e) });
    } finally {
      setSendingToPortal(false);
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

  const scopeYearOnYearBar = useMemo(() => {
    if (effectiveYearlyEmissions.length === 0) return null;

    const currentYear =
      toYearNumber(data!.job_data.reporting_period_start, data!.job_data.reporting_period_end) ??
      toNum(data!.job_data.reporting_year) ??
      new Date().getFullYear();
    const firstHistoricalYear = effectiveYearlyEmissions.length > 0 ? effectiveYearlyEmissions[0]?.year ?? null : null;
    const benchmarkBarYear =
      toYearNumber(data!.job_data.benchmark_period_start, data!.job_data.benchmark_period_end) ??
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

    const changePct = (cur: number, bm: number) => (bm > 0 ? Math.round(((cur - bm) / bm) * 1000) / 10 : null);

    return {
      benchmarkLabel: `BM ${benchmarkRow.year}`,
      previousLabel: previousRow ? `Previous Year ${previousRow.year}` : "Previous Year",
      currentLabel: `Current Year ${currentRow.year}`,
      showBenchmarkBar: !isBenchmarkReportYear,
      showPreviousBar: !isBenchmarkReportYear,
      showComparisonPct: !isBenchmarkReportYear,
      data: [
        { scope: "Scope 1", benchmark: benchmarkRow.scope1, previous: previousRow?.scope1 ?? null, current: currentRow.scope1, pct: changePct(currentRow.scope1, benchmarkRow.scope1) },
        { scope: "Scope 2", benchmark: benchmarkRow.scope2, previous: previousRow?.scope2 ?? null, current: currentRow.scope2, pct: changePct(currentRow.scope2, benchmarkRow.scope2) },
        { scope: "Scope 3", benchmark: benchmarkRow.scope3, previous: previousRow?.scope3 ?? null, current: currentRow.scope3, pct: changePct(currentRow.scope3, benchmarkRow.scope3) },
        { scope: "Total", benchmark: benchmarkRow.total, previous: previousRow?.total ?? null, current: currentRow.total, pct: changePct(currentRow.total, benchmarkRow.total) },
      ],
    };
  }, [data, effectiveYearlyEmissions]);
  if (loading) {
    return (
      <LoadingOrbit className="h-64" label="Loading report dataÃ¢â‚¬Â¦" />
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

  // Ã¢â€â‚¬Ã¢â€â‚¬ Derived values Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  const {
    scope_totals,
    benchmark_totals,
    categories,
    benchmark_categories,
    previous_year_categories,
    previous_year_label,
    activity_totals,
    activity_group_order,
    activity_group_colors,
    intensity_metrics,
    job_actions,
    target_data,
    summary,
    report_metadata,
    template_variables,
    site_breakdowns,
    glossary_cards,
    yearly_emissions,
  } = data;

  const execSummaryText = String(template_variables?.executive_summary ?? "").trim();
  const footprintSummaryText = String(template_variables?.footprint_summary ?? "").trim();
  const actionsNarrativeText = String(template_variables?.reduction_projects ?? "").trim();

  const totalEmissions = toNum(summary?.current_total ?? scope_totals?.Total);
  const scope1 = toNum(scope_totals?.["Scope 1"]);
  const scope2 = toNum(scope_totals?.["Scope 2"]);
  const scope3 = toNum(scope_totals?.["Scope 3"]);
  const currentReportYear =
    toYearNumber(data.job_data.reporting_period_start, data.job_data.reporting_period_end) ??
    toNum(data.job_data.reporting_year) ??
    new Date().getFullYear();
  const firstHistoricalYear = Array.isArray(yearly_emissions) && yearly_emissions.length > 0 ? yearly_emissions[0]?.year ?? null : null;
  const donutBenchmarkYear = resolveScopeDonutBenchmarkYear(
    toYearNumber(data.job_data.benchmark_period_start, data.job_data.benchmark_period_end),
    firstHistoricalYear,
    currentReportYear,
  );
  const donutBenchmarkTotal = resolveScopeDonutBenchmarkTotal(yearly_emissions, donutBenchmarkYear);

  const baselineYear =
    toNum(target_data?.baseline_year) || new Date().getFullYear() - 1;
  const netZeroYear = toNum(target_data?.net_zero_target_year) || 2050;
  const interimYear =
    toNum(target_data?.interim_target_year ?? target_data?.interim_year) || null;
  const targetPct = toNum(target_data?.net_zero_target_reduction_pct ?? target_data?.target_pct) || 90;
  const interimS1Pct = toNum(target_data?.interim_s1_pct ?? target_data?.interim_pct) || 50;
  const interimS2Pct = toNum(target_data?.interim_s2_pct ?? target_data?.interim_pct) || 50;
  const interimS3Pct = toNum(target_data?.interim_s3_pct ?? target_data?.interim_pct) || 50;

  const scopeDonutData = buildScopeDonutItems(
    scope_totals?.["Scope 1"],
    scope_totals?.["Scope 2"],
    scope_totals?.["Scope 3"],
  );

  const activityOrder = activity_group_order ?? Object.keys(activity_totals ?? {});
  const activityBarData = activityOrder
    .filter(k => toNum(activity_totals?.[k]) > 0)
    .map(k => ({
      name: k.length > 26 ? k.slice(0, 24) + "Ã¢â‚¬Â¦" : k,
      fullName: k,
      value: toNum(activity_totals?.[k]),
      fill: activity_group_colors?.[k] ?? "#999",
    }))
    .sort((a, b) => b.value - a.value);

  const hasPathway = baselineYear > 2000 && netZeroYear > baselineYear;
  const emissionsReductionPathwayData = buildEmissionsReductionPathwayData({
    yearlyEmissions: effectiveYearlyEmissions,
    scope1Fallback: scope1,
    scope2Fallback: scope2,
    scope3Fallback: scope3,
    benchmarkYear: baselineYear,
    currentYear: currentReportYear,
    targetYear: netZeroYear,
    interimYear,
    targetReductionPct: targetPct,
    interimS1Pct,
    interimS2Pct,
    interimS3Pct,
  });

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

  // Ã¢â€â‚¬Ã¢â€â‚¬ Render Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  const printClientName = String(data.job_data?.client_name ?? "").replace(/['"\\]/g, "");
  const printPeriodStart = formatDate(data.job_data?.reporting_period_start ?? "");
  const printPeriodEnd = formatDate(data.job_data?.reporting_period_end ?? "");
  const printHeaderLine1 = printPeriodStart && printPeriodEnd
    ? `Carbon Reduction Plan  ${printPeriodStart} Ã¢â‚¬â€œ ${printPeriodEnd}`
    : "Carbon Reduction Plan";
  const printHeaderLine2 = printClientName;
  const printJobNumber = String(data.job_data?.job_number ?? "").replace(/['"\\]/g, "");

  return (
    <>
      {/* In-app PDF viewer overlay */}
      {pdfBlobUrl && (
        <div className="fixed inset-0 z-50 flex flex-col bg-gray-900">
          {/* Header bar */}
          <div className="flex shrink-0 items-center justify-between border-b border-gray-700 bg-gray-800 px-4 py-2.5">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-white">
                {data?.job_data?.client_name ?? "Report"} Ã¢â‚¬â€ Carbon Reduction Plan
              </span>
              <span className="rounded bg-gray-700 px-2 py-0.5 text-xs text-gray-300">
                {pdfFilename}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={savePdfToDisk}
                className="flex items-center gap-1.5 rounded border border-gray-500 bg-gray-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-600"
              >
                Ã¢Â¬â€¡ Save to disk
              </button>
              <button
                onClick={closePdfViewer}
                className="flex items-center gap-1.5 rounded border border-gray-500 bg-gray-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-600"
              >
                Ã¢Å“â€¢ Close
              </button>
            </div>
          </div>
          {/* PDF iframe */}
          <iframe
            src={pdfBlobUrl}
            className="min-h-0 flex-1 w-full border-0"
            title="Report PDF"
          />
        </div>
      )}

      {/* Print CSS */}
      <style jsx global>{`
        @page {
          size: A4;
          margin-top: 22mm;
          margin-right: 12mm;
          margin-bottom: 22mm;
          margin-left: 12mm;
        }
        @page {
          @top-left {
            content: "${printHeaderLine1}\\A ${printHeaderLine2}";
            white-space: pre;
            font-size: 8.5pt;
            font-weight: 600;
            color: #1c3a2c;
            font-family: Arial, sans-serif;
            vertical-align: middle;
          }
          @bottom-left {
            content: "Ã‚Â© Net Zero International";
            font-size: 8pt;
            color: #666;
            font-family: Arial, sans-serif;
            vertical-align: middle;
          }
          @bottom-center {
            content: "${printJobNumber}";
            font-size: 8pt;
            color: #666;
            font-family: Arial, sans-serif;
            vertical-align: middle;
          }
          @bottom-right {
            content: counter(page);
            font-size: 8pt;
            color: #666;
            font-family: Arial, sans-serif;
            vertical-align: middle;
          }
        }
        @page :first {
          @top-left {
            content: none;
          }
        }
        @media print {
          * {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .live-report-section,
          .live-report-section * {
            font-size: 10px !important;
          }
          .live-report-section p,
          .live-report-section li {
            line-height: 1.4 !important;
          }
          .live-report-section {
            overflow: visible !important;
            border: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
          }
          .live-report-section > div {
            border-radius: 0 !important;
          }
          /* CardHeader: tighten top/bottom padding, zero horizontal */
          div.live-report-section > div:first-child {
            padding: 6px 0 4px !important;
          }
          /* CardContent: zero all padding */
          div.live-report-section > div:first-child + div {
            padding: 0 !important;
          }
          /* Page break before Organisational Boundary */
          .org-boundary-section {
            break-before: page !important;
          }
          /* Emissions summary box figure: 3Ãƒâ€” the 10px base = 30px */
          .emissions-box-figure {
            font-size: 30px !important;
          }
          /* Donut center total: doubled from 14px */
          .donut-total {
            font-size: 28px !important;
          }
          .advanced-report-controls {
            display: none !important;
          }
          .live-report-section {
            break-inside: auto;
            page-break-inside: auto;
            width: 100% !important;
          }
          .live-report-section + .live-report-section {
            break-before: page;
            page-break-before: always;
          }
          .recharts-responsive-container {
            overflow: visible !important;
            width: 100% !important;
          }
          .recharts-wrapper {
            overflow: visible !important;
          }
          .recharts-surface {
            overflow: visible !important;
          }
        }
      `}</style>

      {/* Control bar */}
      <div className="advanced-report-controls mb-1 rounded-lg border border-gray-200 bg-white shadow-sm">
        {/* Template selector */}
        <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-2">
          <span className="text-xs font-medium text-gray-500 mr-1">Template:</span>
          {(["crp", "secr"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTemplate(t)}
              className={`rounded-full px-3 py-0.5 text-xs font-semibold transition-colors ${
                activeTemplate === t
                  ? "bg-green-700 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {t === "crp" ? "Carbon Reduction Plan" : "SECR"}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Report Printing</h2>
            <p className="mt-0.5 text-xs text-gray-400">
              React / Playwright renderer Ã‚Â· vector charts Ã‚Â· A4 print layout
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
              onClick={() => saveVersion("draft")}
              disabled={generating || downloading}
              className="text-xs"
            >
              Save Draft
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => saveVersion("review")}
              disabled={generating || downloading}
              className="text-xs"
            >
              {generating ? (
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 animate-spin rounded-full border border-gray-400 border-t-transparent" />
                  SavingÃ¢â‚¬Â¦
                </span>
              ) : (
                "Save for Review"
              )}
            </Button>
            <Button
              size="sm"
              onClick={() => void sendToPortal()}
              disabled={sendingToPortal || generating || downloading}
              className="bg-green-700 text-xs text-white hover:bg-green-800"
            >
              {sendingToPortal ? (
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 animate-spin rounded-full border border-white border-t-transparent" />
                  SendingÃ¢â‚¬Â¦
                </span>
              ) : (
                "Send to Portal"
              )}
            </Button>
            <Button
              size="sm"
              onClick={() => void downloadPdf()}
              disabled={downloading || generating}
              className="bg-gray-700 text-xs text-white hover:bg-gray-800"
            >
              {downloading ? (
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 animate-spin rounded-full border border-white border-t-transparent" />
                  Generating PDFÃ¢â‚¬Â¦
                </span>
              ) : (
                "View PDF"
              )}
            </Button>
          </div>
        </div>
        {downloadError && (
          <div className="border-t border-red-100 bg-red-50 px-5 py-2 text-xs text-red-700">
            <span className="font-medium">Download failed: </span>
            {downloadError}
            {downloadError.toLowerCase().includes("frontend_base_url") && (
              <span className="ml-1 text-red-500">
                Ã¢â‚¬â€ set the <code className="font-mono">FRONTEND_BASE_URL</code> environment variable on the API service in Render.
              </span>
            )}
          </div>
        )}
        {generateError && (
          <div className="border-t border-red-100 bg-red-50 px-5 py-2 text-xs text-red-700">
            <span className="font-medium">Save failed: </span>
            {generateError}
            {generateError.toLowerCase().includes("frontend_base_url") && (
              <span className="ml-1 text-red-500">
                Ã¢â‚¬â€ set the <code className="font-mono">FRONTEND_BASE_URL</code> environment variable on the API service in Render.
              </span>
            )}
          </div>
        )}
        {sendToPortalResult && (
          <div className={`border-t px-5 py-2 text-xs ${sendToPortalResult.ok ? "bg-green-50 text-green-700 border-green-100" : "bg-red-50 text-red-700 border-red-100"}`}>
            {sendToPortalResult.message}
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
            <span className="text-xs text-gray-400">LoadingÃ¢â‚¬Â¦</span>
          )}
        </div>
        {versions.length === 0 && !versionsLoading ? (
          <p className="px-5 py-4 text-xs text-gray-400">
            No saved versions yet Ã¢â‚¬â€ click &quot;Save for Review&quot; to create one.
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
                  : "Ã¢â‚¬â€";
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
                      {v.generated_by ?? "Ã¢â‚¬â€"}
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
                            {markingFinal === v.report_version_id ? "Ã¢â‚¬Â¦" : "Mark Final"}
                          </button>
                        )}
                        {isFinal && (
                          <span className="text-xs text-green-600 font-medium">Ã¢Å“â€œ Final</span>
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

        {activeTemplate === "crp" && <>

        {/* Ã¢â€â‚¬Ã¢â€â‚¬ 1. Cover page Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
        <CoverPage data={data} />

        {/* Ã¢â€â‚¬Ã¢â€â‚¬ 2. Executive Summary Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
        <Card className="live-report-section" data-section="Executive Summary">
          <CardHeader className="pb-3">
            <SectionHeader title="Executive Summary" />
          </CardHeader>
          <CardContent className="space-y-5">

            {/* AI narrative Ã¢â‚¬â€ rendered as distinct paragraphs */}
            {execSummaryText ? (
              <div className="space-y-3">
                {execSummaryText.split(/\n\n+/).map((para, i) => (
                  <p key={i} className="text-sm text-gray-700 leading-relaxed">{para.trim()}</p>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">
                Executive summary not yet drafted. Generate AI content in Reporting Ã¢â€ â€™ AI Drafts.
              </p>
            )}

            <div className="mt-6">
              <ScopeSummaryDonutWidget
                title={`${data.job_data.client_name ?? "Client"} Emissions Summary by Scope`}
                clientName={data.job_data.client_name}
                data={scopeDonutData}
                currentYear={currentReportYear}
                currentTotal={totalEmissions}
                benchmarkYear={donutBenchmarkYear}
                benchmarkTotal={donutBenchmarkTotal}
                showWidgetRef={false}
                storedPngUrl={storedWidgetPngs["emissions_scope_donut"] ?? null}
                presentation={storedWidgetPngs["emissions_scope_donut"] ? "image" : "card"}
              />
            </div>

          </CardContent>
        </Card>

        {/* Ã¢â€â‚¬Ã¢â€â‚¬ 3. Net Zero Commitment Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
        <Card className="live-report-section" data-section="Net Zero Commitment">
          <CardHeader className="pb-3">
            <SectionHeader title="Net Zero Commitment" />
          </CardHeader>
          <CardContent className="space-y-5">

            {/* Commitment statement */}
            {(() => {
              const stmt = String(template_variables?.commitment_statement ?? "").trim();
              const fallback = `${data.job_data.client_name ?? "This organisation"} is committed to achieving net zero greenhouse gas emissions by ${netZeroYear}. This commitment demonstrates our dedication to environmental sustainability.`;
              return (
                <p className="text-sm text-gray-700 leading-relaxed">{stmt || fallback}</p>
              );
            })()}

            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">We commit to the following:</p>
              <ul className="list-disc list-outside ml-5 space-y-1 text-sm text-gray-700">
                <li>To achieve target reductions in greenhouse gas emissions, as set out below.</li>
                <li>To set realistic short- and long-term targets designed to achieve our Net Zero commitments.</li>
                <li>To report total Greenhouse Gas emissions of our business, at a minimum, on an annual basis.</li>
              </ul>
            </div>

            {/* Reduction Targets table */}
            {(interimYear || netZeroYear) && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">Reduction Targets</p>
                <div className="overflow-hidden rounded-lg border border-gray-200">
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
            )}

            {/* Emissions Reduction Pathway chart */}
            {hasPathway && (
              <div className="break-inside-avoid">
                <EmissionsReductionPathwayWidget
                  title={`${data.job_data?.client_name ?? "Client"} Emissions Reduction Targets to ${netZeroYear}`}
                  clientName={data.job_data?.client_name}
                  data={emissionsReductionPathwayData}
                  benchmarkYear={baselineYear}
                  targetYear={netZeroYear}
                  interimYear={interimYear}
                  showScope2={scope2 > 0}
                  showWidgetRef={false}
                  storedPngUrl={storedWidgetPngs["emissions_reduction_pathway"] ?? null}
                  presentation={storedWidgetPngs["emissions_reduction_pathway"] ? "image" : "card"}
                  className="w-full"
                />
              </div>
            )}

            {report_metadata?.emissions_reduction_targets_commentary && (
              <p className="text-sm text-gray-600 leading-relaxed">
                {report_metadata.emissions_reduction_targets_commentary}
              </p>
            )}

          </CardContent>
        </Card>

        {/* Ã¢â€â‚¬Ã¢â€â‚¬ 4. Background & Organisation Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
        <Card className="live-report-section" data-section="Background & Organisation">
          <CardHeader className="pb-3">
            <SectionHeader title="Background & Organisation" />
          </CardHeader>
          <CardContent className="space-y-6">

            {/* Narrative description Ã¢â‚¬â€ split into paragraphs */}
            {data.job_data.description && (
              <div className="space-y-3">
                {data.job_data.description.split(/\r?\n\r?\n|\r?\n/).filter(p => p.trim()).map((para, i) => (
                  <p key={i} className="text-sm text-gray-700 leading-relaxed">{para.trim()}</p>
                ))}
              </div>
            )}

            {/* Organisation Details */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">Organisation Details</p>
              <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-2">
                <MetaRow label="Organisation" value={data.job_data.client_name} />
                <MetaRow label="Industry" value={data.job_data.industry} />
                <MetaRow label="Location" value={[data.job_data.city, data.job_data.country].filter(Boolean).join(", ")} />
                <MetaRow label="Company Number" value={report_metadata?.company_number} />
                <MetaRow label="Registered Address" value={report_metadata?.registered_address} />
              </div>
            </div>

            {/* Reporting Elements */}
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

            {/* Organisational Boundary */}
            <div className="org-boundary-section">
              <p className="text-sm font-semibold text-gray-700 mb-2">Organisational Boundary</p>
              <p className="text-sm text-gray-700 leading-relaxed mb-3">
                The organisational boundary defines the operations over which the organisation has control or financial responsibility for GHG emissions.
              </p>
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <div className="grid grid-cols-[160px_1fr_110px] px-3 py-2" style={{ backgroundColor: BRAND }}>
                  <span className="text-xs font-semibold uppercase tracking-wide text-white">Approach</span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-white">Description</span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-white">Approach Taken</span>
                </div>
                {([
                  {
                    label: "Operational Control",
                    desc: "The organisation has operational control over an operation if it or one of its subsidiaries has the full authority to introduce and implement its operating policies at the operation.",
                    value: report_metadata?.operational_control,
                  },
                  {
                    label: "Financial Control",
                    desc: "The organisation has financial control over the operation if it has the ability to direct the financial and operating policies of the organisation with a view to gaining economic benefits from its activities.",
                    value: report_metadata?.financial_control,
                  },
                  {
                    label: "Equity Share",
                    desc: "The organisation accounts for GHG emissions from operations according to its share of equity in the operation.",
                    value: report_metadata?.equity_share,
                  },
                ]).map((row, i) => (
                  <div key={row.label}
                    className={`grid grid-cols-[160px_1fr_110px] border-b border-gray-100 last:border-0 px-3 py-2 ${i % 2 === 0 ? "bg-white" : "bg-gray-50"}`}>
                    <span className="text-xs font-medium text-gray-700 pr-2">{row.label}</span>
                    <span className="text-xs text-gray-600 pr-4">{row.desc}</span>
                    <span className="text-xs font-medium text-gray-700">{boolLabel(row.value)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Benchmark Year */}
            {(data.job_data.benchmark_period_start || data.job_data.benchmark_period_end) && (
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-1">Benchmark Year</p>
                <p className="text-sm text-gray-700 leading-relaxed">
                  The organisation&apos;s benchmark year is from {formatDate(data.job_data.benchmark_period_start ?? "")} to {formatDate(data.job_data.benchmark_period_end ?? "")}.
                </p>
              </div>
            )}

            {/* Methodologies Used */}
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1">Methodologies Used</p>
              <p className="text-sm text-gray-700 leading-relaxed">
                {String(report_metadata?.methodologies_used ?? "").trim() ||
                  "Throughout this report all methodologies used are explained within the relevant sections."}
              </p>
            </div>

            {/* Commitment commentary */}
            {report_metadata?.commitment_commentary && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">Commitment</p>
                <p className="text-sm text-gray-700 leading-relaxed">{report_metadata.commitment_commentary}</p>
              </div>
            )}

          </CardContent>
        </Card>


        {/* Ã¢â€â‚¬Ã¢â€â‚¬ 4b. Carbon Emissions Overview Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
        <Card className="live-report-section" data-section="Carbon Emissions Overview">
          <CardHeader className="pb-3">
            <SectionHeader title="Carbon Emissions Overview" />
          </CardHeader>
          <CardContent className="space-y-6">

            {/* Reporting period + total box */}
            <div className="flex justify-center">
              <div className="rounded-xl border border-gray-200 bg-white px-8 py-6 text-center shadow-sm w-full max-w-sm">
                <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: BRAND }}>
                  Reporting Period
                </p>
                <p className="text-sm text-gray-700">
                  {formatDate(data.job_data.reporting_period_start ?? "")} to {formatDate(data.job_data.reporting_period_end ?? "")}
                </p>
                <hr className="my-4 border-gray-200" />
                <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: BRAND }}>
                  Total Carbon Emissions
                </p>
                <p className="emissions-box-figure text-5xl font-bold" style={{ color: BRAND }}>
                  {fmt(totalEmissions)}
                </p>
                <p className="mt-1 text-xs text-gray-500">tCOÃ¢â€šâ€še</p>
              </div>
            </div>

            {/* Disclaimer */}
            <p className="text-sm leading-relaxed text-gray-700">
              The calculated emissions are based on the most up to date emissions factors at the time
              of the publication of this report. It should be noted that emissions factors are updated
              regularly and will be retrospectively applied. As such, emissions values may change when
              calculated in future years.
            </p>

            {/* Emissions by Site (Overview) */}
            {(site_breakdowns?.overall?.length ?? 0) > 0 && (
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">Emissions by Site (Overview)</p>
                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <div className="grid grid-cols-[1fr_120px_120px] px-3 py-2" style={{ backgroundColor: BRAND }}>
                    <span className="text-xs font-semibold uppercase tracking-wide text-white">Site</span>
                    <span className="text-xs font-semibold text-white text-right" style={{ textTransform: 'none' }}>tCOÃ¢â€šâ€še</span>
                    <span className="text-xs font-semibold uppercase tracking-wide text-white text-right">% of Total</span>
                  </div>
                  {site_breakdowns?.overall?.map((row, i) => (
                    <div
                      key={i}
                      className={`grid grid-cols-[1fr_120px_120px] border-b border-gray-100 last:border-0 px-3 py-2 ${i % 2 === 0 ? "bg-white" : "bg-gray-50"}`}
                    >
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
                {footprintSummaryText && (
                  <p className="mt-4 text-sm leading-relaxed text-gray-700">{footprintSummaryText}</p>
                )}
              </div>
            )}

            {/* Footprint summary when no site breakdown is available */}
            {(site_breakdowns?.overall?.length ?? 0) === 0 && footprintSummaryText && (
              <p className="text-sm leading-relaxed text-gray-700">{footprintSummaryText}</p>
            )}

          </CardContent>
        </Card>


        {/* Ã¢â€â‚¬Ã¢â€â‚¬ 5. Analysis by Scope Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
        <Card className="live-report-section" data-section="Analysis by Scope">
          <CardHeader className="pb-3">
            <SectionHeader title="Analysis by Scope" />
          </CardHeader>
          <CardContent className="space-y-6">

            <div>
              <p className="text-sm font-semibold text-gray-700 mb-4">Emissions by Scope</p>
              <ScopeSummaryDonutWidget
                title={`${data.job_data.client_name ?? "Client"} Emissions Summary by Scope`}
                clientName={data.job_data.client_name}
                data={scopeDonutData}
                currentYear={currentReportYear}
                currentTotal={totalEmissions}
                benchmarkYear={donutBenchmarkYear}
                benchmarkTotal={donutBenchmarkTotal}
                showWidgetRef={false}
                storedPngUrl={storedWidgetPngs["emissions_scope_donut"] ?? null}
                presentation={storedWidgetPngs["emissions_scope_donut"] ? "image" : "card"}
              />
            </div>

            {scopeYearOnYearBar ? (
              <ScopeYearOnYearBarWidget
                title="Year-on-Year Comparison by Scope"
                clientName={data.job_data.client_name}
                data={scopeYearOnYearBar.data}
                benchmarkLabel={scopeYearOnYearBar.benchmarkLabel}
                previousLabel={scopeYearOnYearBar.previousLabel}
                currentLabel={scopeYearOnYearBar.currentLabel}
                showBenchmarkBar={scopeYearOnYearBar.showBenchmarkBar}
                showPreviousBar={scopeYearOnYearBar.showPreviousBar}
                showComparisonPct={scopeYearOnYearBar.showComparisonPct}
                showWidgetRef={false}
                storedPngUrl={storedWidgetPngs["scope_year_on_year_bar"] ?? null}
                presentation={storedWidgetPngs["scope_year_on_year_bar"] ? "image" : "card"}
                className="w-full"
              />
            ) : null}

            {/* Benchmark / Previous Year / Current Year Ã¢â‚¬â€ Scope Comparison */}
            {/* Scope Descriptions table */}
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Scope Descriptions</p>
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <div className="grid grid-cols-[52px_1fr_90px_58px] px-3 py-2" style={{ backgroundColor: BRAND }}>
                  <span className="text-xs font-semibold uppercase tracking-wide text-white">Scope</span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-white">Description</span>
                  <span className="text-xs font-semibold text-white text-right" style={{ textTransform: 'none' }}>tCOÃ¢â€šâ€še</span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-white text-right">%</span>
                </div>
                {([
                  {
                    scope: "1",
                    desc: "Scope 1 emissions includes fuels used at company premises and company vehicles.",
                    value: scope1,
                  },
                  {
                    scope: "2",
                    desc: "Emissions in scope 2 includes electricity used at the company's premises.",
                    value: scope2,
                  },
                  {
                    scope: "3",
                    desc: "Scope 3 emissions include Business Travel, Employee Commuting, Waste, Purchased Goods and Services and all other activities of a business",
                    value: scope3,
                  },
                ] as { scope: string; desc: string; value: number }[]).map((row, i) => {
                  const pct = totalEmissions > 0 ? (row.value / totalEmissions) * 100 : 0;
                  return (
                    <div
                      key={row.scope}
                      className={`grid grid-cols-[52px_1fr_90px_58px] border-b border-gray-100 last:border-0 px-3 py-2 ${i % 2 === 0 ? "bg-white" : "bg-gray-50"}`}
                    >
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

            {/* Site Breakdown by Scope */}
            {(site_breakdowns?.scope?.length ?? 0) > 0 && (
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">Site Breakdown by Scope</p>
                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <div className="grid grid-cols-[1fr_80px_80px_80px_80px] px-3 py-2" style={{ backgroundColor: BRAND }}>
                    <span className="text-xs font-semibold uppercase tracking-wide text-white">Site</span>
                    <span className="text-xs font-semibold uppercase tracking-wide text-white text-right">Scope 1</span>
                    <span className="text-xs font-semibold uppercase tracking-wide text-white text-right">Scope 2</span>
                    <span className="text-xs font-semibold uppercase tracking-wide text-white text-right">Scope 3</span>
                    <span className="text-xs font-semibold uppercase tracking-wide text-white text-right">Total</span>
                  </div>
                  {site_breakdowns?.scope?.map((row, i) => (
                    <div
                      key={i}
                      className={`grid grid-cols-[1fr_80px_80px_80px_80px] border-b border-gray-100 last:border-0 px-3 py-2 ${i % 2 === 0 ? "bg-white" : "bg-gray-50"}`}
                    >
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
            )}

            {/* Scope 3 note */}
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
              <p className="text-xs text-gray-600">
                Reported Scope 3 emissions may increase in future years as more detailed data and information become available.
              </p>
            </div>

          </CardContent>
        </Card>


        {/* Ã¢â€â‚¬Ã¢â€â‚¬ 6. Emissions by activity Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
        {activityBarData.length > 0 && (
          <Card className="live-report-section" data-section="Emissions by Activity">
            <CardHeader className="pb-3">
              <SectionHeader title="Emissions by Activity" />
            </CardHeader>
            <CardContent>
              <EmissionsByActivityWidget
                title={`${data.job_data.client_name ?? "Client"} Emissions by Activity`}
                clientName={data.job_data.client_name}
                data={activityBarData}
                showWidgetRef={false}
                showHeader={false}
                storedPngUrl={storedWidgetPngs["emissions_by_activity"] ?? null}
                presentation={storedWidgetPngs["emissions_by_activity"] ? "image" : "card"}
                className="w-full"
              />
              {report_metadata?.activity_commentary && (
                <p className="mt-4 text-sm text-gray-600 leading-relaxed">
                  {report_metadata.activity_commentary}
                </p>
              )}

              {/* Site Breakdown by Activity Group */}
              {(site_breakdowns?.activity?.length ?? 0) > 0 && (() => {
                const rows = site_breakdowns!.activity!;
                const totals = {
                  energy: rows.reduce((s, r) => s + toNum(r.energy), 0),
                  business_travel: rows.reduce((s, r) => s + toNum(r.business_travel), 0),
                  employee_commuting: rows.reduce((s, r) => s + toNum(r.employee_commuting), 0),
                  pgs: rows.reduce((s, r) => s + toNum(r.pgs), 0),
                  other: rows.reduce((s, r) => s + toNum(r.other), 0),
                  total: rows.reduce((s, r) => s + toNum(r.total), 0),
                };
                return (
                  <div className="mt-6">
                    <p className="text-sm font-semibold text-gray-700 mb-2">Site Breakdown by Activity Group</p>
                    <div className="overflow-x-auto">
                      <div className="overflow-hidden rounded-lg border border-gray-200 min-w-[640px]">
                        <div className="grid grid-cols-[1fr_80px_110px_140px_60px_60px_80px] px-3 py-2" style={{ backgroundColor: BRAND }}>
                          <span className="text-xs font-semibold uppercase tracking-wide text-white">Site</span>
                          <span className="text-xs font-semibold uppercase tracking-wide text-white text-right">Energy</span>
                          <span className="text-xs font-semibold uppercase tracking-wide text-white text-right">Business Travel</span>
                          <span className="text-xs font-semibold uppercase tracking-wide text-white text-right">Employee Commuting</span>
                          <span className="text-xs font-semibold uppercase tracking-wide text-white text-right">PG&amp;S</span>
                          <span className="text-xs font-semibold uppercase tracking-wide text-white text-right">Other</span>
                          <span className="text-xs font-semibold uppercase tracking-wide text-white text-right">Total</span>
                        </div>
                        {rows.map((row, i) => (
                          <div
                            key={i}
                            className={`grid grid-cols-[1fr_80px_110px_140px_60px_60px_80px] border-b border-gray-100 last:border-0 px-3 py-2 ${i % 2 === 0 ? "bg-white" : "bg-gray-50"}`}
                          >
                            <span className="text-xs text-gray-700">{row.site_name ?? "Unassigned"}</span>
                            <span className="text-xs text-gray-700 text-right">{fmt(toNum(row.energy))}</span>
                            <span className="text-xs text-gray-700 text-right">{fmt(toNum(row.business_travel))}</span>
                            <span className="text-xs text-gray-700 text-right">{fmt(toNum(row.employee_commuting))}</span>
                            <span className="text-xs text-gray-700 text-right">{fmt(toNum(row.pgs))}</span>
                            <span className="text-xs text-gray-700 text-right">{fmt(toNum(row.other))}</span>
                            <span className="text-xs text-gray-700 text-right">{fmt(toNum(row.total))}</span>
                          </div>
                        ))}
                        <div className="grid grid-cols-[1fr_80px_110px_140px_60px_60px_80px] border-t border-gray-200 px-3 py-2 bg-gray-50">
                          <span className="text-xs font-semibold text-gray-700">Total</span>
                          <span className="text-xs font-semibold text-gray-700 text-right">{fmt(totals.energy)}</span>
                          <span className="text-xs font-semibold text-gray-700 text-right">{fmt(totals.business_travel)}</span>
                          <span className="text-xs font-semibold text-gray-700 text-right">{fmt(totals.employee_commuting)}</span>
                          <span className="text-xs font-semibold text-gray-700 text-right">{fmt(totals.pgs)}</span>
                          <span className="text-xs font-semibold text-gray-700 text-right">{fmt(totals.other)}</span>
                          <span className="text-xs font-semibold text-gray-700 text-right">{fmt(totals.total)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Rounding note */}
              <div className="mt-4 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3">
                <p className="text-xs text-gray-700">
                  <span className="font-semibold">Note:</span> Emissions figures are rounded to the nearest 1 decimal place. As a consequence, small differences in totals may occur due to rounding.
                </p>
              </div>

            </CardContent>
          </Card>
        )}

        {/* Ã¢â€â‚¬Ã¢â€â‚¬ 7. Emissions by Scope and Category Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
        {(categories?.length ?? 0) > 0 && (() => {
          type CatRow = { scope: string; label: string; current: number; benchmark: number; prevYear: number };
          const aggMap = new Map<string, CatRow>();
          const addEmissions = (rows: EmissionCategory[] | undefined, field: keyof CatRow) => {
            for (const row of (rows ?? [])) {
              const scope = row.scope ?? "";
              const label = row.activity_group?.trim() || "Other Emissions";
              const key = `${scope}||${label}`;
              const existing = aggMap.get(key);
              if (existing) {
                (existing[field] as number) += toNum(row.emissions);
              } else {
                const entry: CatRow = { scope, label, current: 0, benchmark: 0, prevYear: 0 };
                (entry[field] as number) = toNum(row.emissions);
                aggMap.set(key, entry);
              }
            }
          };
          addEmissions(categories, "current");
          addEmissions(benchmark_categories, "benchmark");
          addEmissions(previous_year_categories, "prevYear");

          const scopeOrder = ["Scope 1", "Scope 2", "Scope 3"];
          const allRows = Array.from(aggMap.values()).sort((a, b) => {
            const si = scopeOrder.indexOf(a.scope) - scopeOrder.indexOf(b.scope);
            return si !== 0 ? si : a.label.localeCompare(b.label);
          });
          const grandCurrentTotal = totalEmissions;
          const grandBenchmarkTotal = toNum(benchmark_totals?.Total);
          const hasBenchmark = grandBenchmarkTotal > 0 || (benchmark_categories?.length ?? 0) > 0;
          const hasPrevYear = (previous_year_categories?.length ?? 0) > 0;

          // Column grid: Scope | Category | Benchmark | [PrevYear] | Current | % vs benchmark
          const cols = hasPrevYear
            ? "grid-cols-[72px_1fr_110px_110px_110px_60px]"
            : "grid-cols-[80px_1fr_120px_120px_60px]";
          const numCols = hasPrevYear ? 6 : 5;

          const bmYearLabel = toYearLabel(data.job_data.benchmark_period_start, data.job_data.benchmark_period_end) || "BM";
          const currentYearLabel = toYearLabel(data.job_data.reporting_period_start, data.job_data.reporting_period_end) || "Current";

          // Shared header cell style: label on line 1, tCOÃ¢â€šâ€še on line 2
          const colHdr = (label: string) => (
            <span className="text-xs font-semibold text-white text-right leading-snug" style={{ textTransform: 'none' }}>
              <span className="block">{label}</span>
              <span className="block opacity-80">tCOÃ¢â€šâ€še</span>
            </span>
          );

          const benchmarkColHeader = colHdr(`BM ${bmYearLabel}`);

          const tableRows: React.ReactElement[] = [];
          let rowIdx = 0;
          for (const scope of scopeOrder) {
            const scopeRows = allRows.filter(r => r.scope === scope);
            if (scopeRows.length === 0) continue;
            const scopeCurrent = scopeRows.reduce((s, r) => s + r.current, 0);
            const scopeBenchmark = scopeRows.reduce((s, r) => s + r.benchmark, 0);
            const scopePrevYear = scopeRows.reduce((s, r) => s + r.prevYear, 0);
            scopeRows.forEach(r => {
              const pct = grandBenchmarkTotal > 0 ? ((r.current - r.benchmark) / grandBenchmarkTotal) * 100 : (grandCurrentTotal > 0 ? (r.current / grandCurrentTotal) * 100 : 0);
              const bg = rowIdx % 2 === 0 ? "bg-white" : "bg-gray-50";
              tableRows.push(
                <div key={`${r.scope}-${r.label}`} className={`grid ${cols} border-b border-gray-100 px-3 py-2 ${bg}`}>
                  <span className="text-xs text-gray-500">{r.scope}</span>
                  <span className="text-xs text-gray-700 pr-2">{r.label}</span>
                  {hasBenchmark ? <span className="text-xs text-gray-600 text-right">{fmt(r.benchmark)}</span> : <span className="text-xs text-gray-400 text-right">Ã¢â‚¬â€</span>}
                  {hasPrevYear && <span className="text-xs text-gray-600 text-right">{r.prevYear > 0 ? fmt(r.prevYear) : "Ã¢â‚¬â€"}</span>}
                  <span className="text-xs text-gray-700 text-right">{fmt(r.current)}</span>
                  <span className="text-xs text-right" style={{ color: pct < 0 ? "#16a34a" : pct > 0 ? "#dc2626" : "#6b7280" }}>{pct >= 0 ? "+" : ""}{pct.toFixed(1)}%</span>
                </div>
              );
              rowIdx++;
            });
            const subPct = grandBenchmarkTotal > 0 ? ((scopeCurrent - scopeBenchmark) / grandBenchmarkTotal) * 100 : (grandCurrentTotal > 0 ? (scopeCurrent / grandCurrentTotal) * 100 : 0);
            tableRows.push(
              <div key={`subtotal-${scope}`} className={`grid ${cols} border-b border-gray-200 px-3 py-2`} style={{ backgroundColor: `${BRAND}12` }}>
                <span className="text-xs font-semibold text-gray-700">{scope}</span>
                <span className="text-xs font-semibold text-gray-700">Sub-total</span>
                {hasBenchmark ? <span className="text-xs font-semibold text-gray-700 text-right">{fmt(scopeBenchmark)}</span> : <span className="text-xs text-gray-400 text-right">Ã¢â‚¬â€</span>}
                {hasPrevYear && <span className="text-xs font-semibold text-gray-700 text-right">{scopePrevYear > 0 ? fmt(scopePrevYear) : "Ã¢â‚¬â€"}</span>}
                <span className="text-xs font-semibold text-gray-700 text-right">{fmt(scopeCurrent)}</span>
                <span className="text-xs font-semibold text-right" style={{ color: subPct < 0 ? "#16a34a" : subPct > 0 ? "#dc2626" : "#6b7280" }}>{subPct >= 0 ? "+" : ""}{subPct.toFixed(1)}%</span>
              </div>
            );
          }

          const grandPrevYearTotal = allRows.reduce((s, r) => s + r.prevYear, 0);
          const grandPct = grandBenchmarkTotal > 0 ? ((grandCurrentTotal - grandBenchmarkTotal) / grandBenchmarkTotal) * 100 : 0;

          return (
            <Card className="live-report-section" data-section="Emissions by Scope and Category">
              <CardHeader className="pb-3">
                <SectionHeader title="Emissions by Scope and Category" />
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <div className={`grid ${cols} px-3 py-2`} style={{ backgroundColor: BRAND }}>
                    <span className="text-xs font-semibold uppercase tracking-wide text-white">Scope</span>
                    <span className="text-xs font-semibold uppercase tracking-wide text-white">Category</span>
                    {benchmarkColHeader}
                    {hasPrevYear && colHdr(previous_year_label || "Prev")}
                    {colHdr(currentYearLabel)}
                    <span className="text-xs font-semibold text-white text-right leading-snug" style={{ textTransform: 'none' }}>
                      <span className="block">% vs</span>
                      <span className="block">BM</span>
                    </span>
                  </div>
                  {tableRows}
                  <div className={`grid ${cols} border-t-2 border-gray-300 px-3 py-2 bg-gray-50`}>
                    <span className={`text-xs font-bold text-gray-700 uppercase col-span-2`}>Total Emissions</span>
                    {hasBenchmark ? <span className="text-xs font-bold text-gray-700 text-right">{fmt(grandBenchmarkTotal)}</span> : <span className="text-xs text-gray-400 text-right">Ã¢â‚¬â€</span>}
                    {hasPrevYear && <span className="text-xs font-bold text-gray-700 text-right">{grandPrevYearTotal > 0 ? fmt(grandPrevYearTotal) : "Ã¢â‚¬â€"}</span>}
                    <span className="text-xs font-bold text-gray-700 text-right">{fmt(grandCurrentTotal)}</span>
                    <span className="text-xs font-bold text-right" style={{ color: grandPct < 0 ? "#16a34a" : grandPct > 0 ? "#dc2626" : "#6b7280" }}>{grandPct >= 0 ? "+" : ""}{grandPct.toFixed(1)}%</span>
                  </div>
                </div>
                <p className="text-xs text-gray-600">A detailed breakdown of emissions is set out in Appendix 1.</p>
                <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3">
                  <p className="text-xs text-gray-700">
                    <span className="font-semibold">Note:</span> Emissions figures are rounded to the nearest 1 decimal place. As a consequence, small differences in totals may occur due to rounding.
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* Ã¢â€â‚¬Ã¢â€â‚¬ 8. Intensity Metric Analysis Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
        {intensity_metrics && Object.keys(intensity_metrics).length > 0 && (() => {
          const currentPeriodLabel = (() => {
            const s = data.job_data.reporting_period_start;
            const e = data.job_data.reporting_period_end;
            if (!s && !e) return "Current Year";
            const sYear = s ? new Date(s).getFullYear() : null;
            const eYear = e ? new Date(e).getFullYear() : null;
            if (sYear && eYear && sYear !== eYear) return `${sYear}Ã¢â‚¬â€œ${eYear}`;
            return String(sYear ?? eYear ?? "Current Year");
          })();

          const benchmarkPeriodLabel = (() => {
            const s = data.job_data.benchmark_period_start;
            const e = data.job_data.benchmark_period_end;
            if (!s && !e) return "Benchmark Year";
            const sYear = s ? new Date(s).getFullYear() : null;
            const eYear = e ? new Date(e).getFullYear() : null;
            if (sYear && eYear && sYear !== eYear) return `${sYear}Ã¢â‚¬â€œ${eYear}`;
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
            if (p == null) return "Ã¢â‚¬â€";
            const sign = p > 0 ? "+" : "";
            return `${sign}${p.toFixed(1)}%`;
          };

          const pctColor = (p: number | null) =>
            p == null ? "text-gray-400" : p < 0 ? "text-green-600" : p > 0 ? "text-red-600" : "text-gray-600";

          const perLabel = (key: string, m: { label?: string | null; divider?: number | null }) => {
            const label = m.label?.trim() || key;
            const d = toNum(m.divider) || 1;
            return d === 1 ? `Per ${label}` : `Per ${d.toLocaleString()} ${label}`;
          };

          const currencySymbol = (() => {
            const country = String(data.job_data?.country ?? "").toLowerCase().trim();
            if (country.includes("united states") || country.includes("usa") || country === "us") return "$";
            if (country.includes("europe") || country.includes("germany") || country.includes("france") || country.includes("spain") || country.includes("italy") || country.includes("netherlands") || country.includes("belgium") || country.includes("austria") || country.includes("portugal") || country.includes("ireland")) return "Ã¢â€šÂ¬";
            if (country.includes("australia")) return "A$";
            if (country.includes("canada")) return "C$";
            if (country.includes("new zealand")) return "NZ$";
            if (country.includes("japan")) return "Ã‚Â¥";
            if (country.includes("switzerland")) return "CHF";
            if (country.includes("sweden") || country.includes("norway") || country.includes("denmark")) return "kr";
            return "Ã‚Â£";
          })();

          const MetricIcon = ({ metricKey, label }: { metricKey: string; label?: string | null }) => {
            if (metricKey === "employees") return (
              <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: BRAND }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
              </svg>
            );
            const lbl = String(label ?? metricKey ?? "").toLowerCase();
            if (lbl.includes("m2") || lbl.includes("mÃ‚Â²") || lbl.includes("sqm") || lbl.includes("floor") || lbl.includes("office") || lbl.includes("space") || lbl.includes("area") || lbl.includes("building")) return (
              <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: BRAND }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
              </svg>
            );
            return (
              <span className="text-2xl font-bold" style={{ color: BRAND }}>{currencySymbol}</span>
            );
          };

          const dedupedMetricEntries = (() => {
            const seen = new Set<string>();
            return [...Object.entries(intensity_metrics)]
              .sort(([a], [b]) => (a === "employees" ? -1 : b === "employees" ? 1 : 0))
              .filter(([key, m]) => {
                const lbl = perLabel(key, m);
                if (seen.has(lbl)) return false;
                seen.add(lbl);
                return true;
              });
          })();

          const summaryParts = dedupedMetricEntries.map(([key, m]) => {
            const intensity = calcIntensity(m, totalEmissions);
            if (intensity == null) return null;
            const label = m.label?.trim() || key;
            const d = toNum(m.divider) || 1;
            const perStr = d === 1 ? `per ${label.toLowerCase()}` : `per ${d.toLocaleString()} ${label.toLowerCase()}`;
            return `${fmt(intensity)} tCOÃ¢â€šâ€še ${perStr}`;
          }).filter(Boolean);

          const employeeCount = toNum(intensity_metrics.employees?.value);

          return (
            <Card className="live-report-section" data-section="Intensity Metric Analysis">
              <CardHeader className="pb-3">
                <SectionHeader title="Intensity Metric Analysis" />
              </CardHeader>
              <CardContent className="space-y-5">
                <p className="text-sm text-gray-700 leading-relaxed">
                  Intensity metrics help normalise emissions data, taking into account variations in
                  production levels or activity volumes. This allows for a more accurate assessment
                  of emission trends over time, regardless of changes in business operations. The
                  initial intensity metrics for the company are below and will be used for
                  comparative purposes in following years.
                </p>
                <div>
                  <p className="text-sm font-semibold text-center text-gray-700 mb-2">
                    Intensity Metrics (tonnes COÃ¢â€šâ€še)
                  </p>
                  <div className="overflow-hidden rounded-lg border border-gray-200">
                    {/* Header */}
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
                      const benchIntensity = calcIntensity(m, benchmarkTotal);
                      const currIntensity  = calcIntensity(m, totalEmissions);
                      const pct = pctChange(currIntensity, benchIntensity);
                      return (
                        <div key={key} className={`grid grid-cols-[56px_1fr_110px_110px_90px] items-center border-b border-gray-100 last:border-0 px-3 py-4 ${i % 2 === 0 ? "bg-white" : "bg-gray-50"}`}>
                          <div className="flex items-center justify-center"><MetricIcon metricKey={key} label={m.label} /></div>
                          <span className="text-sm font-medium text-gray-700">{perLabel(key, m)}</span>
                          <span className="text-right text-sm text-gray-600">{benchIntensity != null ? fmt(benchIntensity) : "Ã¢â‚¬â€"}</span>
                          <span className="text-right text-sm font-semibold text-gray-800">{currIntensity != null ? fmt(currIntensity) : "Ã¢â‚¬â€"}</span>
                          <span className={`text-right text-sm font-semibold ${pctColor(pct)}`}>{fmtPct(pct)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {summaryParts.length > 0 && (
                  <p className="text-sm text-gray-700 leading-relaxed">
                    The chosen intensity metrics shows a carbon emissions value of{" "}
                    {summaryParts.map((part, i) => (
                      <React.Fragment key={i}>{i > 0 && " and "}<strong>{part}</strong></React.Fragment>
                    ))}.
                    {employeeCount > 0 && (
                      <> The business headcount averaged {employeeCount} {employeeCount === 1 ? "person" : "people"} during the reporting period.</>
                    )}
                  </p>
                )}
                {hasPathway && effectiveYearlyEmissions.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-gray-700 mb-3">
                      Emissions Reduction Pathway to {netZeroYear} for Intensity Metrics
                    </p>
                    <IntensityPathwayChart
                      yearlyEmissions={effectiveYearlyEmissions}
                      baselineYear={baselineYear}
                      endYear={netZeroYear}
                      interimYear={interimYear}
                      interimS1Pct={interimS1Pct}
                      interimS2Pct={interimS2Pct}
                      interimS3Pct={interimS3Pct}
                      targetPct={targetPct}
                      scope1Fallback={scope1}
                      scope2Fallback={scope2}
                      scope3Fallback={scope3}
                      intensityMetrics={intensity_metrics}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })()}

        {/* Ã¢â€â‚¬Ã¢â€â‚¬ 9. Historical emissions trend Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
        {effectiveYearlyEmissions.length > 0 && (
          <Card className="live-report-section" data-section="Historical Emissions Trend">
            <CardHeader className="pb-3">
              <SectionHeader title="Historical Emissions Trend" />
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height={300}>
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
                      padding={{ left: 60, right: 60 }}
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
                      formatter={(v: number | undefined, name: string | undefined) => [v != null ? `${fmt(v)} tCOÃ¢â€šâ€še` : "Ã¢â‚¬â€", name ?? ""]}
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

        {/* Ã¢â€â‚¬Ã¢â€â‚¬ 10. Carbon reduction actions Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
        <Card className="live-report-section" data-section="Carbon Reduction Actions">
          <CardHeader className="pb-3">
            <SectionHeader title="Carbon Reduction Actions" />
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm text-gray-700 leading-relaxed">
              To achieve our net zero commitment, {data.job_data.client_name ?? "the organisation"} has
              identified the following key areas for emissions reduction. These actions will be implemented
              in phases over the coming years.
            </p>

            <div>
              <p className="text-sm font-bold text-gray-800 mb-3">Planned Initiatives</p>
              <div className="overflow-hidden rounded-lg border border-gray-200">
                {/* Table header */}
                <div
                  className="grid items-center px-3 py-2.5"
                  style={{
                    gridTemplateColumns: "140px 1fr 140px 2fr",
                    backgroundColor: "#8abb8a",
                  }}
                >
                  <span className="text-xs font-bold uppercase tracking-wider text-white">Term</span>
                  <span className="text-xs font-bold uppercase tracking-wider text-white">Action</span>
                  <span className="text-xs font-bold uppercase tracking-wider text-white">Category</span>
                  <span className="text-xs font-bold uppercase tracking-wider text-white">Description</span>
                </div>

                {/* Action rows */}
                {(job_actions?.total_actions ?? 0) > 0
                  ? (job_actions?.grouped ?? []).flatMap((group) =>
                      (group.items ?? []).map((item, ii) => (
                        <div
                          key={`${group.term}-${ii}`}
                          className="grid items-start border-t border-gray-100 px-3 py-3"
                          style={{ gridTemplateColumns: "140px 1fr 140px 2fr" }}
                        >
                          <div className="pt-0.5">
                            <span className="inline-flex items-center rounded-full border border-green-400 bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
                              {group.label ?? group.term}
                            </span>
                          </div>
                          <span className="pr-4 text-sm font-semibold text-gray-800">
                            {String(item.action_name ?? "")}
                          </span>
                          <span className="pr-4 text-sm text-gray-600">
                            {String(item.action_category ?? "")}
                          </span>
                          <span className="text-sm text-gray-600">
                            {String(item.description ?? "")}
                          </span>
                        </div>
                      ))
                    )
                  : (
                    <div
                      className="grid items-start border-t border-gray-100 px-3 py-3"
                      style={{ gridTemplateColumns: "140px 1fr 140px 2fr" }}
                    >
                      <div className="pt-0.5">
                        <span className="inline-flex items-center rounded-full border border-green-400 bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
                          Short term
                        </span>
                      </div>
                      <span className="pr-4 text-sm font-semibold text-gray-800">
                        Action plan in development
                      </span>
                      <span className="pr-4 text-sm text-gray-600">General</span>
                      <span className="text-sm text-gray-600">
                        Suggested and custom actions can be selected in the job Actions section before final issue.
                      </span>
                    </div>
                  )}
              </div>
            </div>

            {actionsNarrativeText && (
              <div className="space-y-2">
                {actionsNarrativeText.split(/\n\n+/).map((para, i) => (
                  <p key={i} className="text-sm text-gray-700 leading-relaxed">
                    {para.trim()}
                  </p>
                ))}
              </div>
            )}

            {/* Client sign-off */}
            <div className="pt-4 space-y-4 max-w-sm">
              <p className="text-sm font-semibold text-gray-800">Approved by:</p>
              <div className="space-y-5">
                <div>
                  <p className="text-sm text-gray-500 mb-1">Name:</p>
                  <div className="border-b border-gray-400 w-56" />
                </div>
                <div>
                  <p className="text-sm text-gray-500 mb-1">Position:</p>
                  <div className="border-b border-gray-400 w-56" />
                </div>
                <div>
                  <p className="text-sm text-gray-500 mb-1">Date:</p>
                  <div className="border-b border-gray-400 w-56" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Ã¢â€â‚¬Ã¢â€â‚¬ 12. Standards & Methodology Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
        <Card className="live-report-section" data-section="Standards & Methodology">
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
          </CardContent>
        </Card>

        {/* Ã¢â€â‚¬Ã¢â€â‚¬ 13. Declaration / Sign-off Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
        <Card className="live-report-section" data-section="Declaration and Sign Off">
          <CardHeader className="pb-3">
            <SectionHeader title="Declaration and Sign Off" />
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Independent Verification Statement box */}
            <div className="rounded-lg border-2 border-red-400 p-5 space-y-3">
              <p className="text-base font-bold" style={{ color: "#c0392b" }}>
                Independent Verification Statement
              </p>
              <p className="text-sm text-gray-700 leading-relaxed">
                This greenhouse gas emissions report has been prepared in accordance with the GHG
                Protocol Corporate Accounting and Reporting Standard. The data and calculations have
                been independently verified by Net Zero International.
              </p>
              {(data.job_data.reporting_period_start || data.job_data.reporting_period_end) && (
                <p className="text-sm text-gray-700">
                  <span className="font-semibold">Verification Scope:</span>{" "}
                  All Scope 1, 2, and 3 emissions for the reporting period{" "}
                  {data.job_data.reporting_period_start ? formatDate(data.job_data.reporting_period_start) : ""}
                  {data.job_data.reporting_period_start && data.job_data.reporting_period_end ? " to " : ""}
                  {data.job_data.reporting_period_end ? formatDate(data.job_data.reporting_period_end) : ""}
                  .
                </p>
              )}
              <p className="text-sm text-gray-700">
                <span className="font-semibold">Assurance Level:</span> Limited Assurance
              </p>

              {/* Consultant signature */}
              <div className="pt-3 space-y-1 max-w-xs">
                {report_metadata?.consultant_name && (
                  <p className="text-base italic" style={{ fontFamily: "Georgia, serif" }}>
                    {report_metadata.consultant_name}
                  </p>
                )}
                <div className="border-b border-gray-800 w-56 mb-3" />
                {report_metadata?.consultant_position && (
                  <p className="text-xs text-gray-500">{report_metadata.consultant_position}</p>
                )}
                {report_metadata?.consultant_name && (
                  <p className="text-sm text-gray-700">{report_metadata.consultant_name}</p>
                )}
                {report_metadata?.consultant_signature_date && (
                  <p className="text-sm text-gray-700">
                    {fmtSignatureDate(report_metadata.consultant_signature_date)}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Ã¢â€â‚¬Ã¢â€â‚¬ 14. Glossary Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
        {hasGlossary && (
          <Card className="live-report-section" data-section="Glossary">
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

        {/* Ã¢â€â‚¬Ã¢â€â‚¬ 15. Appendix 1 Ã¢â‚¬â€ Full Emissions Audit Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
        {hasAppendix && (
          <Card className="live-report-section" data-section="Appendix 1 Ã¢â‚¬â€ Full Emissions Audit">
            <CardHeader className="pb-3">
              <SectionHeader title="Appendix 1 Ã¢â‚¬â€ Full Emissions Audit" />
            </CardHeader>
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
                      <th className="py-2 text-right font-semibold text-gray-500">tCOÃ¢â€šâ€še</th>
                    </tr>
                  </thead>
                  <tbody>
                    {appendixRows.map((row, i) => (
                      <tr
                        key={i}
                        className="border-b border-gray-50 hover:bg-gray-50/60"
                      >
                        <td className="py-1.5 pr-3 text-gray-600">{row.site_name ?? "Ã¢â‚¬â€"}</td>
                        <td className="py-1.5 pr-3 text-gray-600">{row.scope ?? "Ã¢â‚¬â€"}</td>
                        <td className="py-1.5 pr-3 text-gray-600">{row.category ?? "Ã¢â‚¬â€"}</td>
                        <td className="py-1.5 pr-3 text-gray-600">{row.emission_type ?? "Ã¢â‚¬â€"}</td>
                        <td className="py-1.5 pr-3 text-right text-gray-700">
                          {row.qty != null ? fmt(toNum(row.qty)) : "Ã¢â‚¬â€"}
                        </td>
                        <td className="py-1.5 pr-3 text-gray-500">{row.uom ?? "Ã¢â‚¬â€"}</td>
                        <td className="py-1.5 text-right font-semibold text-gray-800">
                          {row.emissions != null ? fmt(toNum(row.emissions)) : "Ã¢â‚¬â€"}
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
                        {fmt(totalEmissions)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        </>}

        {activeTemplate === "secr" && <>

          {/* Ã¢â€â‚¬Ã¢â€â‚¬ SECR: Cover page Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
          <CoverPage data={data} />

          {/* Ã¢â€â‚¬Ã¢â€â‚¬ SECR: Executive Summary Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
          <Card className="live-report-section">
            <CardHeader className="pb-3">
              <SectionHeader title="Executive Summary" />
            </CardHeader>
            <CardContent className="space-y-4">
              {execSummaryText ? (
                <div className="space-y-3">
                  {execSummaryText.split(/\n\n+/).map((para, i) => (
                    <p key={i} className="text-sm text-gray-700 leading-relaxed">{para.trim()}</p>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic">
                  Executive summary not yet drafted. Generate AI content in Report Preparation Ã¢â€ â€™ AI Drafts.
                </p>
              )}
              <div className="grid grid-cols-3 gap-4 rounded-xl border border-gray-100 bg-gray-50 p-4">
                <div className="text-center">
                  <div className="text-2xl font-bold" style={{ color: BRAND }}>{fmt(totalEmissions)}</div>
                  <div className="mt-1 text-xs text-gray-500">Total tCOÃ¢â€šâ€še</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    {fmt(toNum(report_metadata?.energy_consumption_uk_kwh) + toNum(report_metadata?.energy_consumption_non_uk_kwh))}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">Total kWh energy</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">
                    {fmt(toNum(report_metadata?.renewable_energy_kwh))}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">Renewable kWh</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Ã¢â€â‚¬Ã¢â€â‚¬ SECR: Energy Consumption & Emissions Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
          <Card className="live-report-section">
            <CardHeader className="pb-3">
              <SectionHeader title="Energy Consumption and Emissions" />
            </CardHeader>
            <CardContent className="space-y-5">
              <p className="text-sm text-gray-600 leading-relaxed">
                The following table sets out {data.job_data?.client_name ?? "the organisation"}&apos;s energy consumption
                and associated greenhouse gas emissions for the reporting period in accordance with the Streamlined Energy
                and Carbon Reporting (SECR) requirements under the Companies Act 2006.
              </p>
              <div className="overflow-hidden rounded-xl border border-gray-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="py-2.5 pl-4 text-left text-xs font-semibold text-gray-500">Category</th>
                      <th className="py-2.5 pr-4 text-right text-xs font-semibold text-gray-500">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: "UK Energy Consumption (kWh)", value: fmt(toNum(report_metadata?.energy_consumption_uk_kwh)), unit: "kWh" },
                      { label: "Non-UK Energy Consumption (kWh)", value: fmt(toNum(report_metadata?.energy_consumption_non_uk_kwh)), unit: "kWh" },
                      { label: "Renewable Energy (kWh)", value: fmt(toNum(report_metadata?.renewable_energy_kwh)), unit: "kWh" },
                      { label: "Energy Emissions Ã¢â‚¬â€ Location-based (tCOÃ¢â€šâ€še)", value: fmt(toNum(report_metadata?.energy_emissions_tco2e)), unit: "tCOÃ¢â€šâ€še" },
                      { label: "Energy Emissions Ã¢â‚¬â€ Market-based (tCOÃ¢â€šâ€še)", value: fmt(toNum(report_metadata?.energy_emissions_market_tco2e)), unit: "tCOÃ¢â€šâ€še" },
                      { label: "Total Scope 1 & 2 Emissions (tCOÃ¢â€šâ€še)", value: fmt(toNum(scope_totals?.["Scope 1"]) + toNum(scope_totals?.["Scope 2"])), unit: "tCOÃ¢â€šâ€še" },
                      { label: "Total Greenhouse Gas Emissions (tCOÃ¢â€šâ€še)", value: fmt(totalEmissions), unit: "tCOÃ¢â€šâ€še" },
                    ].map((row, i) => (
                      <tr key={i} className="border-b border-gray-50 last:border-0">
                        <td className="py-2.5 pl-4 text-xs text-gray-700">{row.label}</td>
                        <td className="py-2.5 pr-4 text-right text-xs font-semibold text-gray-800 tabular-nums">
                          {row.value} <span className="font-normal text-gray-400">{row.unit}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(() => {
                const effectiveBasis = renewablePct >= 100
                  ? "Market-based"
                  : (report_metadata?.energy_reporting_basis || "Location-based");
                return (
                  <p className="text-xs text-gray-500 leading-relaxed">
                    <span className="font-semibold">Basis of energy reporting: </span>
                    {effectiveBasis}
                  </p>
                );
              })()}
            </CardContent>
          </Card>

          {/* Ã¢â€â‚¬Ã¢â€â‚¬ SECR: SECR Narrative Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
          <Card className="live-report-section">
            <CardHeader className="pb-3">
              <SectionHeader title="Energy Efficiency and Carbon Reduction Narrative" />
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-700 leading-relaxed">
                {data.job_data?.client_name ?? "The organisation"} has undertaken a review of its energy efficiency
                measures and carbon reduction activities during the reporting period. The following narrative provides
                a summary of the principal measures taken to improve energy efficiency.
              </p>
              {report_metadata?.emissions_reduction_targets_commentary ? (
                <div>
                  <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-gray-500">
                    Emissions Reduction Targets
                  </h4>
                  <p className="text-sm text-gray-700 leading-relaxed">
                    {report_metadata?.emissions_reduction_targets_commentary}
                  </p>
                </div>
              ) : null}
              {report_metadata?.methodologies_used ? (
                <div>
                  <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-gray-500">
                    Methodologies Used
                  </h4>
                  <p className="text-sm text-gray-700 leading-relaxed">
                    {report_metadata?.methodologies_used}
                  </p>
                </div>
              ) : null}
              {!report_metadata?.emissions_reduction_targets_commentary && !report_metadata?.methodologies_used && (
                <p className="text-sm text-gray-400 italic">
                  SECR narrative not yet completed. Fill in the report variables in Report Preparation.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Ã¢â€â‚¬Ã¢â€â‚¬ SECR: Carbon Reduction Actions Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
          <Card className="live-report-section">
            <CardHeader className="pb-3">
              <SectionHeader title="Carbon Reduction Actions" />
            </CardHeader>
            <CardContent>
              {(job_actions?.total_actions ?? 0) > 0 ? (
                <div className="space-y-3">
                  {(job_actions?.grouped ?? []).flatMap((group, gi) =>
                    (group.items ?? []).map((item, ii) => (
                      <div key={`${gi}-${ii}`} className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
                        <span className="mt-0.5 inline-flex flex-shrink-0 items-center rounded-full border border-green-400 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                          {group.label ?? group.term}
                        </span>
                        <div>
                          <div className="text-sm font-medium text-gray-800">{String(item.action_name ?? "")}</div>
                          {item.description ? (
                            <div className="mt-0.5 text-xs text-gray-500">{String(item.description)}</div>
                          ) : null}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic">
                  No carbon reduction actions recorded yet. Add actions in Data Ã¢â€ â€™ Actions.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Ã¢â€â‚¬Ã¢â€â‚¬ SECR: Methodology & Standards Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
          <Card className="live-report-section">
            <CardHeader className="pb-3">
              <SectionHeader title="Methodology and Standards" />
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-gray-700 leading-relaxed">
                Greenhouse gas emissions have been calculated in accordance with the GHG Protocol Corporate Standard
                and the UK Government&apos;s Environmental Reporting Guidelines (including Streamlined Energy and Carbon
                Reporting guidance). Emission factors are sourced from the UK Government&apos;s GHG Conversion Factors
                published by the Department for Energy Security and Net Zero (DESNZ).
              </p>
              {report_metadata?.datasets_names ? (
                <p className="text-sm text-gray-700 leading-relaxed">
                  <span className="font-semibold">Datasets: </span>
                  {report_metadata?.datasets_names}
                </p>
              ) : null}
              {report_metadata?.data_confidence_commentary ? (
                <p className="text-sm text-gray-700 leading-relaxed">
                  <span className="font-semibold">Data confidence: </span>
                  {report_metadata?.data_confidence_commentary}
                </p>
              ) : null}
            </CardContent>
          </Card>

          {/* Ã¢â€â‚¬Ã¢â€â‚¬ SECR: Declaration / Sign-off Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */}
          <Card className="live-report-section">
            <CardHeader className="pb-3">
              <SectionHeader title="Declaration" />
            </CardHeader>
            <CardContent className="space-y-6">
              <p className="text-sm text-gray-700 leading-relaxed">
                This report has been prepared in accordance with the requirements of the Streamlined Energy and Carbon
                Reporting (SECR) framework as set out in the Companies Act 2006 (Strategic Report and Directors&apos; Report)
                Regulations 2018.
              </p>
              <div className="grid gap-8 sm:grid-cols-2">
                <div className="space-y-1">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Prepared by</div>
                  <div className="text-sm font-medium text-gray-800">{report_metadata?.consultant_name ?? "Ã¢â‚¬â€"}</div>
                  <div className="text-xs text-gray-500">{report_metadata?.consultant_position ?? ""}</div>
                  <div className="mt-3 h-px w-40 border-t border-dashed border-gray-300" />
                  <div className="text-xs text-gray-400">Signature</div>
                  <div className="mt-1 text-xs text-gray-500">
                    Date: {report_metadata?.consultant_signature_date
                      ? formatDate(String(report_metadata?.consultant_signature_date))
                      : "Ã¢â‚¬â€"}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Authorised by</div>
                  <div className="text-sm font-medium text-gray-800">{report_metadata?.client_signee_name ?? "Ã¢â‚¬â€"}</div>
                  <div className="text-xs text-gray-500">{report_metadata?.client_signee_position ?? ""}</div>
                  <div className="mt-3 h-px w-40 border-t border-dashed border-gray-300" />
                  <div className="text-xs text-gray-400">Signature</div>
                  <div className="mt-1 text-xs text-gray-500">
                    Date: {report_metadata?.client_signature_date
                      ? formatDate(String(report_metadata?.client_signature_date))
                      : "Ã¢â‚¬â€"}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

        </>}

      </div>
    </>
  );
}
