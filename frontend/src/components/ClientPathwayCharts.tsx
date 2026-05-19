"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import LoadingOrbit from "@/components/LoadingOrbit";
import { getToken } from "@/lib/auth-client";

type YearlyEmission = {
  year: number | null;
  scope1: number;
  scope2: number;
  scope3: number;
  total: number;
};

type IntensityMetricItem = {
  key: string;
  label: string;
  value: number;
  divider: number;
  intensity: number;
};

type BenchmarkMetrics = {
  benchmark_year: number | null;
  scope1?: number | null;
  scope2?: number | null;
  scope3?: number | null;
  total?: number | null;
} | null;

type CurrentMetrics = {
  total_emissions: number;
  scope1: number;
  scope2: number;
  scope3: number;
  year: number | null;
};

type ClientRecord = {
  net_zero_year?: number | null;
  interim_year?: number | null;
  interim_s1_pct?: number | null;
  interim_s2_pct?: number | null;
  interim_s3_pct?: number | null;
  net_zero_target_reduction_pct?: number | null;
  benchmark_year?: number | null;
};

export type ClientPathwayChartsProps = {
  clientId: number;
  baseUrl: string;
  yearlyEmissions: YearlyEmission[];
  intensityMetrics: IntensityMetricItem[];
  benchmarkMetrics: BenchmarkMetrics;
  currentMetrics: CurrentMetrics | null;
};

const SCOPE_COLORS = ["#0f766e", "#0891b2", "#38bdf8"];
const ACTIVITY_COLORS = ["#0ea5e9", "#14b8a6", "#f97316", "#8b5cf6", "#22c55e", "#ef4444", "#64748b", "#eab308"];

function fmt(v: number) {
  return v.toLocaleString("en-GB", { maximumFractionDigits: 1 });
}

export default function ClientPathwayCharts({
  clientId,
  baseUrl,
  yearlyEmissions,
  intensityMetrics,
  benchmarkMetrics,
  currentMetrics,
}: ClientPathwayChartsProps) {
  const [clientRecord, setClientRecord] = useState<ClientRecord | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const token = getToken();
        const headers: Record<string, string> = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(`${baseUrl}/clients/${clientId}`, { credentials: "include", headers });
        if (res.ok && !cancelled) setClientRecord(await res.json());
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [baseUrl, clientId]);

  const targetYear = clientRecord?.net_zero_year ?? 2050;
  const targetReductionPct = clientRecord?.net_zero_target_reduction_pct ?? 90;
  const interimYear = clientRecord?.interim_year ?? null;
  const interimTargets = {
    scope_1: clientRecord?.interim_s1_pct ?? null,
    scope_2: clientRecord?.interim_s2_pct ?? null,
    scope_3: clientRecord?.interim_s3_pct ?? null,
  };
  const benchmarkYear = clientRecord?.benchmark_year ?? benchmarkMetrics?.benchmark_year ?? null;

  const normalEmissions = useMemo(
    () => yearlyEmissions
      .filter((x): x is YearlyEmission & { year: number } => x.year !== null)
      .map(x => ({ ...x, year: Number(x.year) }))
      .sort((a, b) => a.year - b.year),
    [yearlyEmissions],
  );

  const scopeTotals = currentMetrics
    ? { scope_1: currentMetrics.scope1, scope_2: currentMetrics.scope2, scope_3: currentMetrics.scope3, total: currentMetrics.total_emissions }
    : null;

  const currentYear = currentMetrics?.year ?? new Date().getFullYear();

  const intensityRecord = useMemo(() => {
    const rec: Record<string, { label: string; value: number; divider: number }> = {};
    intensityMetrics.forEach(m => { rec[m.key] = { label: m.label, value: m.value, divider: m.divider }; });
    return rec;
  }, [intensityMetrics]);

  const pathwayLabel = `Reporting years ${benchmarkYear ?? currentYear} to ${targetYear}`;

  // ─── shared forecastScope helper ─────────────────────────────────────────
  function makeForecastScope(baselineYear: number, endYear: number) {
    const iYear = interimYear && interimYear > baselineYear && interimYear < endYear ? interimYear : null;
    const finalFactor = (100 - targetReductionPct) / 100;
    return (bench: number, iPct: number | null, year: number): number => {
      if (year <= baselineYear) return bench;
      const finalTarget = bench * finalFactor;
      const iTarget = iYear != null && iPct != null ? bench * (1 - iPct / 100) : null;
      if (iYear != null && iTarget != null && year <= iYear) {
        const span = iYear - baselineYear;
        const t = span > 0 ? (year - baselineYear) / span : 1;
        return bench + (iTarget - bench) * t;
      }
      const segStart = iYear ?? baselineYear;
      const segVal = iTarget ?? bench;
      const span = endYear - segStart;
      const t = span > 0 ? (year - segStart) / span : 1;
      return Math.max(segVal + (finalTarget - segVal) * t, 0);
    };
  }

  // ─── scopePathwayData ────────────────────────────────────────────────────
  const scopePathwayData = useMemo(() => {
    if (!scopeTotals) return [];
    const firstHist = normalEmissions.length > 0 ? normalEmissions[0].year : null;
    const baselineYear = benchmarkYear ?? firstHist ?? currentYear;
    const endYear = targetYear > baselineYear ? targetYear : Math.max(baselineYear + 1, 2050);

    const benchRow = normalEmissions.find(r => r.year === baselineYear);
    const benchS1 = benchRow ? benchRow.scope1 : scopeTotals.scope_1;
    const benchS2 = benchRow ? benchRow.scope2 : scopeTotals.scope_2;
    const benchS3 = benchRow ? benchRow.scope3 : scopeTotals.scope_3;

    const fs = makeForecastScope(baselineYear, endYear);

    const yearSet = new Set<number>();
    for (let y = baselineYear; y <= endYear; y++) yearSet.add(y);
    normalEmissions.forEach(r => { if (r.year <= endYear) yearSet.add(r.year); });

    return Array.from(yearSet).sort((a, b) => a - b).map(year => {
      const actual = normalEmissions.find(r => r.year === year);
      return {
        year,
        actual_total: actual ? actual.total : null,
        actual_s1: actual ? actual.scope1 : null,
        actual_s2: actual ? actual.scope2 : null,
        actual_s3: actual ? actual.scope3 : null,
        target_total: fs(benchS1, interimTargets.scope_1, year) + fs(benchS2, interimTargets.scope_2, year) + fs(benchS3, interimTargets.scope_3, year),
        target_s1: fs(benchS1, interimTargets.scope_1, year),
        target_s2: benchS2 > 0 ? fs(benchS2, interimTargets.scope_2, year) : undefined,
        target_s3: fs(benchS3, interimTargets.scope_3, year),
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeTotals, benchmarkYear, currentYear, targetYear, normalEmissions, targetReductionPct, interimYear, interimTargets.scope_1, interimTargets.scope_2, interimTargets.scope_3]);

  // ─── intensityPathwayData ────────────────────────────────────────────────
  const intensityPathwayData = useMemo(() => {
    if (!scopeTotals || Object.keys(intensityRecord).length === 0) return [];
    const metricEntries = Object.entries(intensityRecord)
      .map(([key, m]) => ({ key, label: m.label, value: Number(m.value ?? 0), divider: Number(m.divider ?? 1) || 1 }))
      .filter(e => e.value > 0).slice(0, 4);
    if (metricEntries.length === 0) return [];

    const firstHist = normalEmissions.length > 0 ? normalEmissions[0].year : null;
    const baselineYear = benchmarkYear ?? firstHist ?? currentYear;
    const endYear = targetYear > baselineYear ? targetYear : Math.max(baselineYear + 1, 2050);

    const benchRow = normalEmissions.find(r => r.year === baselineYear);
    const benchS1 = benchRow ? benchRow.scope1 : scopeTotals.scope_1;
    const benchS2 = benchRow ? benchRow.scope2 : scopeTotals.scope_2;
    const benchS3 = benchRow ? benchRow.scope3 : scopeTotals.scope_3;

    const fs = makeForecastScope(baselineYear, endYear);
    const forecastTotal = (year: number) => fs(benchS1, interimTargets.scope_1, year) + fs(benchS2, interimTargets.scope_2, year) + fs(benchS3, interimTargets.scope_3, year);

    const yearSet = new Set<number>();
    for (let y = baselineYear; y <= endYear; y++) yearSet.add(y);
    normalEmissions.forEach(r => { if (r.year <= endYear) yearSet.add(r.year); });

    return Array.from(yearSet).sort((a, b) => a - b).map(year => {
      const actual = normalEmissions.find(r => r.year === year);
      const forecast = forecastTotal(year);
      const row: Record<string, number | string | null> = { year };
      metricEntries.forEach(e => {
        row[`${e.label}_actual`] = actual ? Number(((actual.total * e.divider) / e.value).toFixed(3)) : null;
        row[`${e.label}_target`] = Number(((forecast * e.divider) / e.value).toFixed(3));
      });
      return row;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeTotals, benchmarkYear, currentYear, targetYear, normalEmissions, targetReductionPct, interimYear, interimTargets.scope_1, interimTargets.scope_2, interimTargets.scope_3, intensityRecord]);

  // ─── targetPath (for intensityTrend) ────────────────────────────────────
  const targetPath = useMemo(() => {
    if (!scopeTotals) return [];
    const startYear = benchmarkYear ?? currentYear;
    const endYear = targetYear > startYear ? targetYear : Math.max(startYear + 1, 2050);
    const currentTotal = scopeTotals.total;
    const interimTotal = currentTotal > 0
      ? scopeTotals.scope_1 * (1 - Math.max(0, Number(interimTargets.scope_1 ?? 0)) / 100)
        + scopeTotals.scope_2 * (1 - Math.max(0, Number(interimTargets.scope_2 ?? 0)) / 100)
        + scopeTotals.scope_3 * (1 - Math.max(0, Number(interimTargets.scope_3 ?? 0)) / 100)
      : 0;
    const iYear = interimYear && interimYear > startYear && interimYear < endYear ? interimYear : null;

    const valueForYear = (year: number): number => {
      if (year <= startYear) return currentTotal;
      if (iYear != null && year <= iYear) {
        const span = iYear - startYear;
        const t = span > 0 ? (year - startYear) / span : 1;
        return currentTotal + (interimTotal - currentTotal) * t;
      }
      const segStart = iYear ?? startYear;
      const segVal = iYear ? interimTotal : currentTotal;
      const span = endYear - segStart;
      const t = span > 0 ? (year - segStart) / span : 1;
      return Math.max(segVal * (1 - t), 0);
    };

    return Array.from({ length: Math.max(1, endYear - startYear + 1) }, (_, i) => startYear + i)
      .map(year => ({ year, forecast: valueForYear(year) }));
  }, [benchmarkYear, currentYear, targetYear, scopeTotals, interimYear, interimTargets.scope_1, interimTargets.scope_2, interimTargets.scope_3]);

  // ─── intensityTrend ──────────────────────────────────────────────────────
  const intensityTrend = useMemo(() => {
    if (!scopeTotals || Object.keys(intensityRecord).length === 0) return [];
    const metricEntries = Object.entries(intensityRecord)
      .map(([key, m]) => ({
        key,
        label: m.label,
        baseIntensity: Number(m.value ?? 0) > 0 ? (scopeTotals.total / Number(m.value)) * Number(m.divider ?? 1) : 0,
      }))
      .filter(e => e.baseIntensity > 0).slice(0, 4);
    if (metricEntries.length === 0) return [];

    const endYear = targetYear >= currentYear ? targetYear : Math.max(currentYear + 1, 2050);
    const currentTotal = scopeTotals.total;

    return Array.from({ length: Math.max(1, endYear - currentYear + 1) }, (_, i) => currentYear + i)
      .map(year => {
        const emissionRatio = currentTotal > 0
          ? (targetPath.find(p => p.year === year)?.forecast ?? currentTotal) / currentTotal
          : 0;
        const row: Record<string, number | string> = { year };
        metricEntries.forEach(e => { row[e.label] = Number((e.baseIntensity * emissionRatio).toFixed(2)); });
        return row;
      });
  }, [currentYear, intensityRecord, scopeTotals, targetPath, targetYear]);

  if (loading) {
    return <LoadingOrbit className="py-12" label="Loading pathway data..." />;
  }

  const hasScope2 = (scopeTotals?.scope_2 ?? 0) > 0;
  const intensityEntries = Object.entries(intensityRecord)
    .map(([key, m]) => ({ key, label: m.label, value: Number(m.value ?? 0) }))
    .filter(e => e.value > 0).slice(0, 4);
  const iYear = interimYear && interimYear > (benchmarkYear ?? currentYear) ? interimYear : null;

  const isEmpty = scopePathwayData.length === 0 && intensityPathwayData.length === 0 && intensityTrend.length === 0;

  if (isEmpty) {
    return (
      <div className="rounded-lg border bg-muted/30 px-6 py-10 text-center text-sm text-muted-foreground">
        No pathway data available. Ensure the client has emissions data and net zero targets configured.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {scopePathwayData.length > 0 && (
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle>Emissions Reduction Pathway to {targetYear}</CardTitle>
            <div className="text-xs uppercase tracking-[0.28em] text-muted-foreground">{pathwayLabel}</div>
          </CardHeader>
          <CardContent>
            <div className="h-[360px]">
              <ResponsiveContainer width="100%" height={360}>
                <LineChart data={scopePathwayData} margin={{ top: 5, right: 24, left: 6, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toLocaleString("en-GB", { maximumFractionDigits: 0 })} />
                  <Tooltip formatter={(v: unknown) => [`${fmt(Number(v || 0))} tCO₂e`, ""]} labelFormatter={v => `Year: ${v}`} />
                  <Legend iconType="circle" />
                  {iYear && <ReferenceLine x={iYear} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: "Interim", position: "top", fill: "#f59e0b", fontSize: 10 }} />}
                  <ReferenceLine x={targetYear} stroke="#16a34a" strokeDasharray="3 3" label={{ value: "Net Zero", position: "top", fill: "#16a34a", fontSize: 10 }} />
                  <Line type="monotone" dataKey="actual_total" name="Total (actual)" stroke="#0f766e" strokeWidth={3} dot={{ r: 5 }} connectNulls={false} />
                  <Line type="monotone" dataKey="actual_s1" name="Scope 1 (actual)" stroke={SCOPE_COLORS[0]} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                  {hasScope2 && <Line type="monotone" dataKey="actual_s2" name="Scope 2 (actual)" stroke={SCOPE_COLORS[1]} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />}
                  <Line type="monotone" dataKey="actual_s3" name="Scope 3 (actual)" stroke={SCOPE_COLORS[2]} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                  <Line type="monotone" dataKey="target_total" name="Total (target)" stroke="#0f766e" strokeWidth={2} strokeDasharray="5 4" dot={false} />
                  <Line type="monotone" dataKey="target_s1" name="Scope 1 (target)" stroke={SCOPE_COLORS[0]} strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
                  {hasScope2 && <Line type="monotone" dataKey="target_s2" name="Scope 2 (target)" stroke={SCOPE_COLORS[1]} strokeWidth={1.5} strokeDasharray="5 4" dot={false} />}
                  <Line type="monotone" dataKey="target_s3" name="Scope 3 (target)" stroke={SCOPE_COLORS[2]} strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {intensityPathwayData.length > 0 && (
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle>Emissions Reduction Pathway to {targetYear} for Intensity Metrics</CardTitle>
            <div className="text-xs uppercase tracking-[0.28em] text-muted-foreground">{pathwayLabel}</div>
          </CardHeader>
          <CardContent>
            <div className="h-[360px]">
              <ResponsiveContainer width="100%" height={360}>
                <LineChart data={intensityPathwayData} margin={{ top: 5, right: 24, left: 6, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(2)} />
                  <Tooltip formatter={(v: unknown) => [`${Number(v || 0).toFixed(3)}`, ""]} labelFormatter={v => `Year: ${v}`} />
                  <Legend iconType="circle" />
                  {iYear && <ReferenceLine x={iYear} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: "Interim", position: "top", fill: "#f59e0b", fontSize: 10 }} />}
                  <ReferenceLine x={targetYear} stroke="#16a34a" strokeDasharray="3 3" label={{ value: "Net Zero", position: "top", fill: "#16a34a", fontSize: 10 }} />
                  {intensityEntries.flatMap((e, idx) => [
                    <Line key={`${e.key}_actual`} type="monotone" dataKey={`${e.label}_actual`} name={`${e.label} (actual)`} stroke={ACTIVITY_COLORS[idx % ACTIVITY_COLORS.length]} strokeWidth={2.5} dot={{ r: 4 }} connectNulls={false} />,
                    <Line key={`${e.key}_target`} type="monotone" dataKey={`${e.label}_target`} name={`${e.label} (target)`} stroke={ACTIVITY_COLORS[idx % ACTIVITY_COLORS.length]} strokeWidth={1.5} strokeDasharray="5 4" dot={false} />,
                  ])}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {intensityTrend.length > 0 && (
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle>Intensity Actuals vs Forecast</CardTitle>
            <div className="text-xs uppercase tracking-[0.28em] text-muted-foreground">Reporting year {currentYear}</div>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={intensityTrend} margin={{ top: 5, right: 20, left: 6, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="year" />
                  <YAxis />
                  <Tooltip formatter={(v: unknown) => [`${Number(v || 0).toFixed(2)}`, ""]} />
                  <Legend />
                  {intensityEntries.map((e, idx) => (
                    <Line key={e.key} type="monotone" dataKey={e.label} stroke={ACTIVITY_COLORS[idx % ACTIVITY_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} name={e.label} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
