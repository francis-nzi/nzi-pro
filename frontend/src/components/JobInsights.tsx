"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type ScopeTotals = {
  scope_1: number;
  scope_2: number;
  scope_3: number;
  total: number;
};

type JobScopeRow = {
  scope?: string | null;
  site_name?: string | null;
  category?: string | null;
  dataset_category?: string | null;
  lookup_category?: string | null;
  report_label?: string | null;
  calc_tco2e?: number | null;
  month_1?: number | null;
  month_2?: number | null;
  month_3?: number | null;
  month_4?: number | null;
  month_5?: number | null;
  month_6?: number | null;
  month_7?: number | null;
  month_8?: number | null;
  month_9?: number | null;
  month_10?: number | null;
  month_11?: number | null;
  month_12?: number | null;
};

type ScopeDataResponse = {
  rows?: JobScopeRow[];
  total?: number;
};

type ClientInfo = {
  net_zero_year?: number | null;
  interim_year?: number | null;
  interim_s1_pct?: number | null;
  interim_s2_pct?: number | null;
  interim_s3_pct?: number | null;
  client_name?: string | null;
  benchmark_year?: number | null;
  net_zero_target_reduction_pct?: number | null;
};

type YearlyEmission = {
  year: number;
  scope1: number;
  scope2: number;
  scope3: number;
  total: number;
};

type IntensityMetric = {
  label?: string;
  value?: number | null;
  divider?: number | null;
};

type IntensityMetricsResponse = {
  metrics?: Record<string, IntensityMetric>;
};

const SCOPE_COLORS = ["#0f766e", "#0891b2", "#38bdf8"];
const ACTIVITY_COLORS = ["#0ea5e9", "#14b8a6", "#f97316", "#8b5cf6", "#22c55e", "#ef4444", "#64748b", "#eab308"];

function formatTco2e(value: number): string {
  return value.toLocaleString("en-GB", { maximumFractionDigits: 1 });
}

function bucketKey(value?: string | null): string {
  const raw = String(value ?? "").trim();
  return raw.length > 0 ? raw : "Unknown";
}

function formatTooltipValue(value: unknown): [string, string] {
  const amount = Array.isArray(value) ? Number(value[0] ?? 0) : Number(value ?? 0);
  return [`${formatTco2e(amount)} tCO₂e`, ""];
}

function formatMetricTooltip(value: unknown): [string, string] {
  const amount = Array.isArray(value) ? Number(value[0] ?? 0) : Number(value ?? 0);
  return [amount.toFixed(2), ""];
}

function normalizeSeries<T extends { value: number }>(rows: T[], targetTotal: number): T[] {
  const rawTotal = rows.reduce((acc, row) => acc + Number(row.value || 0), 0);
  if (rawTotal <= 0 || targetTotal <= 0) return rows;
  const scale = Math.abs(rawTotal - targetTotal) > 0.05 ? targetTotal / rawTotal : 1;
  return rows.map((row) => ({ ...row, value: Number(row.value || 0) * scale }));
}

function pct(value: number, total: number): string {
  return total > 0 ? `${((value / total) * 100).toFixed(1)}%` : "0.0%";
}

export default function JobInsights({
  jobId,
  clientId,
  baseUrl = "/api/backend",
  jobNumber,
  clientName,
  reportingYear,
}: {
  jobId: number;
  clientId: number | null | undefined;
  baseUrl?: string;
  jobNumber?: string | null;
  clientName?: string | null;
  reportingYear?: number | null;
}) {
  const [scopeTotals, setScopeTotals] = useState<ScopeTotals | null>(null);
  const [rows, setRows] = useState<JobScopeRow[]>([]);
  const [targetYear, setTargetYear] = useState<number | null>(null);
  const [interimYear, setInterimYear] = useState<number | null>(null);
  const [interimTargets, setInterimTargets] = useState<{ scope_1: number | null; scope_2: number | null; scope_3: number | null }>({
    scope_1: null,
    scope_2: null,
    scope_3: null,
  });
  const [intensityMetrics, setIntensityMetrics] = useState<Record<string, IntensityMetric>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [benchmarkYear, setBenchmarkYear] = useState<number | null>(null);
  const [yearlyEmissions, setYearlyEmissions] = useState<YearlyEmission[]>([]);
  const [targetReductionPct, setTargetReductionPct] = useState<number>(90);
  const [whatIfScope1, setWhatIfScope1] = useState("0");
  const [whatIfScope2, setWhatIfScope2] = useState("0");
  const [whatIfScope3, setWhatIfScope3] = useState("0");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!Number.isFinite(jobId) || jobId <= 0) return;
      setLoading(true);
      setError("");

      try {
        const scopeTotalsRes = await fetch(`${baseUrl}/jobs/${jobId}/scope-totals`, { credentials: "include" });
        const scopeDataRes = await fetch(`${baseUrl}/jobs/${jobId}/scope-data?include_disabled=true`, {
          credentials: "include",
        });
        const intensityRes = await fetch(`${baseUrl}/jobs/${jobId}/intensity-metrics`, { credentials: "include" });
        const yearlyEmissionsRes = await fetch(`${baseUrl}/jobs/${jobId}/yearly-emissions`, { credentials: "include" });
        const clientRes =
          clientId != null && Number.isFinite(Number(clientId)) && Number(clientId) > 0
            ? await fetch(`${baseUrl}/clients/${clientId}`, { credentials: "include" })
            : null;

        if (!scopeTotalsRes.ok) {
          throw new Error(`Scope totals failed (${scopeTotalsRes.status})`);
        }
        if (!scopeDataRes.ok) {
          throw new Error(`Scope data failed (${scopeDataRes.status})`);
        }
        const totalsJson = (await scopeTotalsRes.json()) as ScopeTotals;
        const scopeDataJson = (await scopeDataRes.json()) as ScopeDataResponse;
        const intensityJson = intensityRes.ok ? ((await intensityRes.json()) as IntensityMetricsResponse) : { metrics: {} };
        const clientJson = clientRes && clientRes.ok ? ((await clientRes.json()) as ClientInfo) : null;
        const yearlyEmissionsJson = yearlyEmissionsRes.ok ? ((await yearlyEmissionsRes.json()) as YearlyEmission[]) : [];

        if (cancelled) return;
        setScopeTotals(totalsJson);
        setRows(Array.isArray(scopeDataJson.rows) ? scopeDataJson.rows : []);
        setTargetYear(Number.isFinite(Number(clientJson?.net_zero_year)) ? Number(clientJson?.net_zero_year) : 2050);
        setInterimYear(Number.isFinite(Number(clientJson?.interim_year)) ? Number(clientJson?.interim_year) : null);
        setInterimTargets({
          scope_1: Number.isFinite(Number(clientJson?.interim_s1_pct)) ? Number(clientJson?.interim_s1_pct) : null,
          scope_2: Number.isFinite(Number(clientJson?.interim_s2_pct)) ? Number(clientJson?.interim_s2_pct) : null,
          scope_3: Number.isFinite(Number(clientJson?.interim_s3_pct)) ? Number(clientJson?.interim_s3_pct) : null,
        });
        const by = Number(clientJson?.benchmark_year);
        setBenchmarkYear(Number.isFinite(by) && by > 1900 ? by : null);
        const trp = Number(clientJson?.net_zero_target_reduction_pct);
        setTargetReductionPct(Number.isFinite(trp) && trp > 0 ? trp : 90);
        setYearlyEmissions(Array.isArray(yearlyEmissionsJson) ? yearlyEmissionsJson : []);
        setIntensityMetrics(
          intensityJson && intensityJson.metrics && typeof intensityJson.metrics === "object" ? intensityJson.metrics : {},
        );
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        setScopeTotals(null);
        setRows([]);
        setTargetYear(2050);
        setInterimYear(null);
        setInterimTargets({ scope_1: null, scope_2: null, scope_3: null });
        setBenchmarkYear(null);
        setYearlyEmissions([]);
        setTargetReductionPct(90);
        setIntensityMetrics({});
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [baseUrl, clientId, jobId, refreshIndex]);

  const scopeCards = useMemo(() => {
    if (!scopeTotals) return [];
    return [
      { name: "Scope 1", value: scopeTotals.scope_1 },
      { name: "Scope 2", value: scopeTotals.scope_2 },
      { name: "Scope 3", value: scopeTotals.scope_3 },
    ].filter((entry) => entry.value > 0);
  }, [scopeTotals]);

  const activityData = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row) => {
      const label = bucketKey(row.dataset_category || row.lookup_category || row.category || row.report_label);
      map.set(label, (map.get(label) ?? 0) + Number(row.calc_tco2e || 0));
    });
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [rows]);

  const siteData = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row) => {
      const label = bucketKey(row.site_name);
      map.set(label, (map.get(label) ?? 0) + Number(row.calc_tco2e || 0));
    });
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [rows]);

  const normalizedActivityData = useMemo(
    () => normalizeSeries(activityData, Number(scopeTotals?.total || 0)),
    [activityData, scopeTotals?.total]
  );

  const normalizedSiteData = useMemo(
    () => normalizeSeries(siteData, Number(scopeTotals?.total || 0)),
    [scopeTotals?.total, siteData]
  );

  const monthlyTrend = useMemo(() => {
    const months = Array.from({ length: 12 }, (_, idx) => ({
      month: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][idx],
      actual: 0,
    }));
    rows.forEach((row) => {
      const values = [
        row.month_1,
        row.month_2,
        row.month_3,
        row.month_4,
        row.month_5,
        row.month_6,
        row.month_7,
        row.month_8,
        row.month_9,
        row.month_10,
        row.month_11,
        row.month_12,
      ];
      values.forEach((value, index) => {
        months[index].actual += Number(value || 0);
      });
    });
    const rawTotal = months.reduce((acc, month) => acc + month.actual, 0);
    const targetTotal = Number(scopeTotals?.total || 0);
    const scale = rawTotal > 0 && targetTotal > 0 && Math.abs(rawTotal - targetTotal) > 0.05 ? targetTotal / rawTotal : 1;
    return months.map((month) => ({ ...month, actual: month.actual * scale }));
  }, [rows, scopeTotals?.total]);

  const currentYear = reportingYear ?? new Date().getFullYear();

  const targetPath = useMemo(() => {
    const currentTotal = Number(scopeTotals?.total || 0);
    const startYear = benchmarkYear ?? currentYear;
    const endYear = targetYear && targetYear > startYear ? targetYear : Math.max(startYear + 1, 2050);
    const years = Array.from({ length: Math.max(1, endYear - startYear + 1) }, (_, index) => startYear + index);
    const interimPoint = interimYear && interimYear > startYear && interimYear < endYear ? interimYear : null;
    const interimTotal =
      currentTotal > 0
        ? Number(scopeTotals?.scope_1 || 0) * (1 - Math.max(0, Number(interimTargets.scope_1 ?? 0)) / 100) +
          Number(scopeTotals?.scope_2 || 0) * (1 - Math.max(0, Number(interimTargets.scope_2 ?? 0)) / 100) +
          Number(scopeTotals?.scope_3 || 0) * (1 - Math.max(0, Number(interimTargets.scope_3 ?? 0)) / 100)
        : 0;

    const valueForYear = (year: number): number => {
      if (year <= currentYear) return currentTotal;
      if (interimPoint != null && year <= interimPoint) {
        const span = interimPoint - currentYear;
        const t = span > 0 ? (year - currentYear) / span : 1;
        return currentTotal + (interimTotal - currentTotal) * t;
      }
      const startYear = interimPoint ?? currentYear;
      const startValue = interimPoint ? interimTotal : currentTotal;
      const span = endYear - startYear;
      const t = span > 0 ? (year - startYear) / span : 1;
      return Math.max(startValue * (1 - t), 0);
    };

    return years.map((year) => ({
      year,
      actual: year === currentYear ? currentTotal : null,
      forecast: valueForYear(year),
      target: valueForYear(year),
    }));
  }, [benchmarkYear, currentYear, interimTargets.scope_1, interimTargets.scope_2, interimTargets.scope_3, interimYear, scopeTotals?.scope_1, scopeTotals?.scope_2, scopeTotals?.scope_3, scopeTotals?.total, targetYear]);

  const scopePathwayData = useMemo(() => {
    if (!scopeTotals) return [];

    // Use benchmark year setting, earliest historical year, or current year as fallback
    const firstHistoricalYear = yearlyEmissions.length > 0 ? yearlyEmissions[0].year : null;
    const baselineYear = benchmarkYear ?? firstHistoricalYear ?? currentYear;
    const endYear = targetYear && targetYear > baselineYear ? targetYear : Math.max(baselineYear + 1, 2050);

    // Benchmark emissions: from the baseline year row if available, else current job totals
    const benchmarkRow = yearlyEmissions.find((r) => r.year === baselineYear);
    const benchS1 = benchmarkRow ? benchmarkRow.scope1 : Number(scopeTotals.scope_1 || 0);
    const benchS2 = benchmarkRow ? benchmarkRow.scope2 : Number(scopeTotals.scope_2 || 0);
    const benchS3 = benchmarkRow ? benchmarkRow.scope3 : Number(scopeTotals.scope_3 || 0);

    const finalFactor = (100 - targetReductionPct) / 100;
    const iYear = interimYear && interimYear > baselineYear && interimYear < endYear ? interimYear : null;

    const forecastScope = (bench: number, interimPct: number | null, year: number): number => {
      if (year <= baselineYear) return bench;
      const finalTarget = bench * finalFactor;
      const iTarget = iYear != null && interimPct != null ? bench * (1 - interimPct / 100) : null;
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

    // Include all historical years (no lower-bound filter) + full forecast range
    const yearSet = new Set<number>();
    for (let y = baselineYear; y <= endYear; y++) yearSet.add(y);
    yearlyEmissions.forEach((r) => { if (r.year <= endYear) yearSet.add(r.year); });
    const years = Array.from(yearSet).sort((a, b) => a - b);

    return years.map((year) => {
      const actual = yearlyEmissions.find((r) => r.year === year);
      return {
        year,
        actual_total: actual ? actual.total : null,
        actual_s1: actual ? actual.scope1 : null,
        actual_s2: actual ? actual.scope2 : null,
        actual_s3: actual ? actual.scope3 : null,
        target_total: forecastScope(benchS1, interimTargets.scope_1, year) +
                      forecastScope(benchS2, interimTargets.scope_2, year) +
                      forecastScope(benchS3, interimTargets.scope_3, year),
        target_s1: forecastScope(benchS1, interimTargets.scope_1, year),
        target_s2: benchS2 > 0 ? forecastScope(benchS2, interimTargets.scope_2, year) : undefined,
        target_s3: forecastScope(benchS3, interimTargets.scope_3, year),
      };
    });
  }, [scopeTotals, benchmarkYear, currentYear, targetYear, yearlyEmissions, targetReductionPct,
      interimYear, interimTargets.scope_1, interimTargets.scope_2, interimTargets.scope_3]);

  const intensityTrend = useMemo(() => {
    const metricEntries = Object.entries(intensityMetrics)
      .map(([key, metric]) => {
        const value = Number(metric?.value ?? 0);
        const divider = Number(metric?.divider ?? 1);
        const baseIntensity = value > 0 ? (Number(scopeTotals?.total || 0) / value) * divider : 0;
        return {
          key,
          label: metric?.label?.trim() || key,
          baseIntensity,
        };
      })
      .filter((entry) => entry.baseIntensity > 0)
      .slice(0, 4);

    if (metricEntries.length === 0) return [];

    const targetYearValue = targetYear && targetYear >= currentYear ? targetYear : Math.max(currentYear + 1, 2050);
    const years = Array.from({ length: Math.max(1, targetYearValue - currentYear + 1) }, (_, index) => currentYear + index);
    const targetPathTotal = targetPath.find((point) => point.year === targetYearValue)?.forecast ?? 0;
    const currentTotal = Number(scopeTotals?.total || 0);

    return years.map((year) => {
      const emissionRatio = currentTotal > 0 ? (targetPath.find((point) => point.year === year)?.forecast ?? currentTotal) / currentTotal : 0;
      const row: Record<string, number | string> = { year };
      metricEntries.forEach((entry) => {
        row[entry.label] = Number((entry.baseIntensity * emissionRatio).toFixed(2));
      });
      if (year === targetYearValue) {
        row["Target total"] = Number(targetPathTotal.toFixed(2));
      }
      return row;
    });
  }, [currentYear, intensityMetrics, scopeTotals?.total, targetPath, targetYear]);

  const intensityPathwayData = useMemo(() => {
    if (!scopeTotals || Object.keys(intensityMetrics).length === 0) return [];

    const metricEntries = Object.entries(intensityMetrics)
      .map(([key, metric]) => {
        const value = Number(metric?.value ?? 0);
        const divider = Number(metric?.divider ?? 1) || 1;
        return { key, label: metric?.label?.trim() || key, value, divider };
      })
      .filter((e) => e.value > 0)
      .slice(0, 4);

    if (metricEntries.length === 0) return [];

    const firstHistoricalYear = yearlyEmissions.length > 0 ? yearlyEmissions[0].year : null;
    const baselineYear = benchmarkYear ?? firstHistoricalYear ?? currentYear;
    const endYear = targetYear && targetYear > baselineYear ? targetYear : Math.max(baselineYear + 1, 2050);

    const benchmarkRow = yearlyEmissions.find((r) => r.year === baselineYear);
    const benchS1 = benchmarkRow ? benchmarkRow.scope1 : Number(scopeTotals.scope_1 || 0);
    const benchS2 = benchmarkRow ? benchmarkRow.scope2 : Number(scopeTotals.scope_2 || 0);
    const benchS3 = benchmarkRow ? benchmarkRow.scope3 : Number(scopeTotals.scope_3 || 0);

    const finalFactor = (100 - targetReductionPct) / 100;
    const iYear = interimYear && interimYear > baselineYear && interimYear < endYear ? interimYear : null;

    const forecastScope = (bench: number, iPct: number | null, year: number): number => {
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

    const forecastTotal = (year: number): number =>
      forecastScope(benchS1, interimTargets.scope_1, year) +
      forecastScope(benchS2, interimTargets.scope_2, year) +
      forecastScope(benchS3, interimTargets.scope_3, year);

    const yearSet = new Set<number>();
    for (let y = baselineYear; y <= endYear; y++) yearSet.add(y);
    yearlyEmissions.forEach((r) => { if (r.year <= endYear) yearSet.add(r.year); });
    const years = Array.from(yearSet).sort((a, b) => a - b);

    return years.map((year) => {
      const actual = yearlyEmissions.find((r) => r.year === year);
      const forecast = forecastTotal(year);
      const row: Record<string, number | string | null> = { year };
      metricEntries.forEach((entry) => {
        row[`${entry.label}_actual`] = actual
          ? Number(((actual.total * entry.divider) / entry.value).toFixed(3))
          : null;
        row[`${entry.label}_target`] = Number(((forecast * entry.divider) / entry.value).toFixed(3));
      });
      return row;
    });
  }, [scopeTotals, benchmarkYear, currentYear, targetYear, yearlyEmissions, targetReductionPct,
      interimYear, interimTargets.scope_1, interimTargets.scope_2, interimTargets.scope_3, intensityMetrics]);

  const whatIf = useMemo(() => {
    const current = Number(scopeTotals?.total || 0);
    const s1 = Number(scopeTotals?.scope_1 || 0) * (1 - Math.max(0, Math.min(100, Number(whatIfScope1) || 0)) / 100);
    const s2 = Number(scopeTotals?.scope_2 || 0) * (1 - Math.max(0, Math.min(100, Number(whatIfScope2) || 0)) / 100);
    const s3 = Number(scopeTotals?.scope_3 || 0) * (1 - Math.max(0, Math.min(100, Number(whatIfScope3) || 0)) / 100);
    const total = s1 + s2 + s3;
    return {
      current,
      total,
      reduction: Math.max(current - total, 0),
      reductionPct: current > 0 ? ((current - total) / current) * 100 : 0,
    };
  }, [scopeTotals, whatIfScope1, whatIfScope2, whatIfScope3]);

  const summaryData = useMemo(() => {
    if (!scopeTotals) return "Generate the dashboard to review the job's emissions pattern, hotspots, and target path.";
    const topDatasetCategory = normalizedActivityData[0];
    const topSite = normalizedSiteData[0];
    const scopeRows = scopeCards
      .map((scope) => ({ ...scope, share: scopeTotals.total > 0 ? (scope.value / scopeTotals.total) * 100 : 0 }))
      .sort((a, b) => b.value - a.value);
    const dominantScope = scopeRows[0];
    const topDriverShare = topDatasetCategory && scopeTotals.total > 0 ? (topDatasetCategory.value / scopeTotals.total) * 100 : 0;
    return [
      clientName ? `${clientName} job ${jobNumber ?? jobId} is tracking at ${formatTco2e(scopeTotals.total)} tCO₂e.` : `Job ${jobNumber ?? jobId} is tracking at ${formatTco2e(scopeTotals.total)} tCO₂e.`,
      dominantScope ? `${dominantScope.name} is the dominant scope at ${formatTco2e(dominantScope.value)} tCO₂e (${pct(dominantScope.value, scopeTotals.total)} of total).` : null,
      topDatasetCategory ? `${topDatasetCategory.name} is the largest dataset category driver at ${formatTco2e(topDatasetCategory.value)} tCO₂e (${pct(topDatasetCategory.value, scopeTotals.total)} of total).` : null,
      topSite ? `${topSite.name} is the largest site contributor at ${formatTco2e(topSite.value)} tCO₂e (${pct(topSite.value, scopeTotals.total)} of total).` : null,
      topDriverShare > 0 ? `Your largest dataset category is responsible for ${topDriverShare.toFixed(1)}% of total emissions, so that is the most direct reduction lever.` : null,
      interimYear ? `Interim targets are plotted at ${interimYear} to show the job's midpoint pathway.` : null,
      targetYear ? `The target line extends to ${targetYear} with a piecewise path that honours any interim reduction target.` : null,
    ]
      .filter(Boolean)
      .join(" ");
  }, [clientName, jobId, jobNumber, normalizedActivityData, normalizedSiteData, scopeCards, scopeTotals, targetYear, interimYear]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Job Insights</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Loading insights dashboard...</CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Job Insights</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="text-destructive">Unable to load insights: {error}</div>
          <Button variant="outline" onClick={() => setRefreshIndex((value) => value + 1)}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Total tCO₂e" value={formatTco2e(Number(scopeTotals?.total || 0))} />
        <MetricCard label="Target Year" value={targetYear ?? 2050} />
        <LinkMetricCard
          label="Top Dataset Category"
          value={normalizedActivityData[0] ? formatTco2e(normalizedActivityData[0].value) : "0.0"}
          suffix="tCO₂e"
          name={normalizedActivityData[0]?.name ?? "No dataset category data"}
          href={`/jobs/${jobId}/data-entry`}
        />
        <LinkMetricCard
          label="Top Site"
          value={normalizedSiteData[0] ? formatTco2e(normalizedSiteData[0].value) : "0.0"}
          suffix="tCO₂e"
          name={normalizedSiteData[0]?.name ?? "No site data"}
          href={`/jobs/${jobId}/data-entry`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-700">{summaryData}</p>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border bg-white/70 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Top dataset category</div>
              <div className="mt-1 text-sm font-medium">{normalizedActivityData[0]?.name ?? "No dataset category data"}</div>
              <div className="text-sm text-muted-foreground">
                {normalizedActivityData[0] ? `${formatTco2e(normalizedActivityData[0].value)} tCO₂e` : "No dataset category data"}
              </div>
            </div>
            <div className="rounded-lg border bg-white/70 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Largest site</div>
              <div className="mt-1 text-sm font-medium">{normalizedSiteData[0]?.name ?? "No site data"}</div>
              <div className="text-sm text-muted-foreground">
                {normalizedSiteData[0] ? `${formatTco2e(normalizedSiteData[0].value)} tCO₂e` : "No site data"}
              </div>
            </div>
            <div className="rounded-lg border bg-white/70 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Target signal</div>
              <div className="mt-1 text-sm font-medium">{targetYear ?? 2050}</div>
              <div className="text-sm text-muted-foreground">{interimYear ? `Interim checkpoint ${interimYear}` : "No interim checkpoint set"}</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {scopeCards.map((scope) => {
              const share = scopeTotals && scopeTotals.total > 0 ? (scope.value / scopeTotals.total) * 100 : 0;
              return (
                <Badge key={scope.name} variant="secondary">
                  {scope.name}: {formatTco2e(scope.value)} tCO₂e ({share.toFixed(1)}%)
                </Badge>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Emissions Summary by Scope</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
              <div className="relative mx-auto aspect-square w-full max-w-[480px]">
                <ResponsiveContainer width="100%" aspect={1}>
                  <PieChart>
                    <Pie data={scopeCards} dataKey="value" nameKey="name" innerRadius="72%" outerRadius="94%" paddingAngle={2}>
                      {scopeCards.map((_, index) => (
                        <Cell key={index} fill={SCOPE_COLORS[index % SCOPE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={formatTooltipValue} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-3xl font-semibold tabular-nums">{formatTco2e(scopeTotals?.total ?? 0)}</div>
                    <div className="text-xs text-muted-foreground">tCO₂e total</div>
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                {scopeCards.map((scope, index) => (
                  <div key={scope.name} className="flex items-center justify-between gap-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SCOPE_COLORS[index % SCOPE_COLORS.length] }} />
                      <span>{scope.name}</span>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">{formatTco2e(scope.value)}</div>
                      <div className="text-xs text-muted-foreground">{pct(scope.value, Number(scopeTotals?.total || 0))}</div>
                    </div>
                  </div>
                ))}
                <div className="mt-2 border-t pt-2">
                  <div className="flex items-center justify-between gap-3 text-sm font-semibold">
                    <span>Total</span>
                    <div className="text-right">
                      <div>{formatTco2e(Number(scopeTotals?.total || 0))}</div>
                      <div className="text-xs text-muted-foreground">100.0%</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Emissions by Dataset Category</CardTitle>
          </CardHeader>
          <CardContent>
            {normalizedActivityData.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">No dataset category data available</div>
            ) : (
              <div className="space-y-3">
                {normalizedActivityData.map((activity, index) => {
                  const share = scopeTotals && scopeTotals.total > 0 ? (activity.value / scopeTotals.total) * 100 : 0;
                  return (
                    <div key={activity.name} className="rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: ACTIVITY_COLORS[index % ACTIVITY_COLORS.length] }}
                            />
                            <Link href={`/jobs/${jobId}/data-entry`} className="truncate font-medium text-slate-900 underline decoration-slate-300 underline-offset-2">
                              {activity.name}
                            </Link>
                          </div>
                          <div className="mt-2 h-2 rounded-full bg-slate-100">
                            <div
                              className="h-2 rounded-full"
                              style={{
                                width: `${Math.max(2, Math.min(100, share))}%`,
                                backgroundColor: ACTIVITY_COLORS[index % ACTIVITY_COLORS.length],
                              }}
                            />
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold tabular-nums">{formatTco2e(activity.value)}</div>
                          <div className="text-xs text-muted-foreground">{share.toFixed(1)}%</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Emissions by Site</CardTitle>
          </CardHeader>
          <CardContent>
            {normalizedSiteData.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">No site data available</div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                <div className="relative mx-auto aspect-square w-full max-w-[420px]">
                  <ResponsiveContainer width="100%" aspect={1}>
                    <PieChart>
                      <Pie data={normalizedSiteData} dataKey="value" nameKey="name" innerRadius="72%" outerRadius="94%" paddingAngle={2}>
                        {normalizedSiteData.map((_, index) => (
                          <Cell key={index} fill={ACTIVITY_COLORS[index % ACTIVITY_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={formatTooltipValue} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                      <div className="text-3xl font-semibold tabular-nums">{formatTco2e(Number(scopeTotals?.total || 0))}</div>
                      <div className="text-xs text-muted-foreground">tCO₂e total</div>
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  {normalizedSiteData.map((site, index) => (
                    <div key={site.name} className="flex items-center justify-between gap-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ACTIVITY_COLORS[index % ACTIVITY_COLORS.length] }} />
                        <Link href={`/jobs/${jobId}/data-entry`} className="truncate underline decoration-slate-300 underline-offset-2">
                          {site.name}
                        </Link>
                      </div>
                      <div className="text-right">
                        <div className="font-medium">{formatTco2e(site.value)}</div>
                        <div className="text-xs text-muted-foreground">{pct(site.value, Number(scopeTotals?.total || 0))}</div>
                      </div>
                    </div>
                  ))}
                  <div className="mt-2 border-t pt-2">
                    <div className="flex items-center justify-between gap-3 text-sm font-semibold">
                      <span>Total</span>
                      <div className="text-right">
                        <div>{formatTco2e(Number(scopeTotals?.total || 0))}</div>
                        <div className="text-xs text-muted-foreground">100.0%</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Emissions Trend to Target Year</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={targetPath} margin={{ top: 5, right: 20, left: 6, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="year" />
                  <YAxis />
                  <Tooltip formatter={formatMetricTooltip} />
                  <Legend />
                  <Line type="monotone" dataKey="actual" stroke="#0f766e" strokeWidth={3} dot={{ r: 4 }} name="Actual" />
                  <Line type="monotone" dataKey="forecast" stroke="#38bdf8" strokeWidth={2} strokeDasharray="5 4" dot={false} name="Target path" />
                  {interimYear ? (
                    <ReferenceLine x={interimYear} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: "Interim", position: "top", fill: "#f59e0b" }} />
                  ) : null}
                  {targetYear ? (
                    <ReferenceLine x={targetYear} stroke="#16a34a" strokeDasharray="3 3" label={{ value: "Net zero", position: "top", fill: "#16a34a" }} />
                  ) : null}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

      </div>

      {scopePathwayData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Emissions Reduction Pathway to {targetYear ?? 2050}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[360px]">
              <ResponsiveContainer width="100%" height={360}>
                <LineChart data={scopePathwayData} margin={{ top: 5, right: 24, left: 6, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toLocaleString("en-GB", { maximumFractionDigits: 0 })} />
                  <Tooltip formatter={(v: unknown) => [`${formatTco2e(Number(v || 0))} tCO₂e`, ""]} labelFormatter={(v) => `Year: ${v}`} />
                  <Legend iconType="circle" />
                  {interimYear && interimYear > (benchmarkYear ?? currentYear) && (
                    <ReferenceLine x={interimYear} stroke="#f59e0b" strokeDasharray="3 3"
                      label={{ value: "Interim", position: "top", fill: "#f59e0b", fontSize: 10 }} />
                  )}
                  {targetYear && (
                    <ReferenceLine x={targetYear} stroke="#16a34a" strokeDasharray="3 3"
                      label={{ value: "Net Zero", position: "top", fill: "#16a34a", fontSize: 10 }} />
                  )}
                  <Line type="monotone" dataKey="actual_total" name="Total (actual)"
                    stroke="#0f766e" strokeWidth={3} dot={{ r: 5 }} activeDot={{ r: 6 }} connectNulls={false} />
                  <Line type="monotone" dataKey="actual_s1" name="Scope 1 (actual)"
                    stroke={SCOPE_COLORS[0]} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                  {Number(scopeTotals?.scope_2 || 0) > 0 && (
                    <Line type="monotone" dataKey="actual_s2" name="Scope 2 (actual)"
                      stroke={SCOPE_COLORS[1]} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                  )}
                  <Line type="monotone" dataKey="actual_s3" name="Scope 3 (actual)"
                    stroke={SCOPE_COLORS[2]} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                  <Line type="monotone" dataKey="target_total" name="Total (target)"
                    stroke="#0f766e" strokeWidth={2} strokeDasharray="5 4" dot={false} />
                  <Line type="monotone" dataKey="target_s1" name="Scope 1 (target)"
                    stroke={SCOPE_COLORS[0]} strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
                  {Number(scopeTotals?.scope_2 || 0) > 0 && (
                    <Line type="monotone" dataKey="target_s2" name="Scope 2 (target)"
                      stroke={SCOPE_COLORS[1]} strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
                  )}
                  <Line type="monotone" dataKey="target_s3" name="Scope 3 (target)"
                    stroke={SCOPE_COLORS[2]} strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {intensityPathwayData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Emissions Reduction Pathway to {targetYear ?? 2050} for Intensity Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[360px]">
              <ResponsiveContainer width="100%" height={360}>
                <LineChart data={intensityPathwayData} margin={{ top: 5, right: 24, left: 6, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(2)} />
                  <Tooltip
                    formatter={(v: unknown) => [`${Number(v || 0).toFixed(3)} tCO₂e`, ""]}
                    labelFormatter={(v) => `Year: ${v}`}
                  />
                  <Legend iconType="circle" />
                  {interimYear && interimYear > (benchmarkYear ?? currentYear) && (
                    <ReferenceLine x={interimYear} stroke="#f59e0b" strokeDasharray="3 3"
                      label={{ value: "Interim", position: "top", fill: "#f59e0b", fontSize: 10 }} />
                  )}
                  {targetYear && (
                    <ReferenceLine x={targetYear} stroke="#16a34a" strokeDasharray="3 3"
                      label={{ value: "Net Zero", position: "top", fill: "#16a34a", fontSize: 10 }} />
                  )}
                  {Object.entries(intensityMetrics)
                    .map(([key, metric]) => ({ key, label: metric?.label?.trim() || key, value: Number(metric?.value ?? 0) }))
                    .filter((e) => e.value > 0)
                    .slice(0, 4)
                    .flatMap((entry, index) => [
                      <Line key={`${entry.key}_actual`} type="monotone" dataKey={`${entry.label}_actual`}
                        name={`${entry.label} (actual)`}
                        stroke={ACTIVITY_COLORS[index % ACTIVITY_COLORS.length]} strokeWidth={2.5}
                        dot={{ r: 4 }} connectNulls={false} />,
                      <Line key={`${entry.key}_target`} type="monotone" dataKey={`${entry.label}_target`}
                        name={`${entry.label} (target)`}
                        stroke={ACTIVITY_COLORS[index % ACTIVITY_COLORS.length]} strokeWidth={1.5}
                        strokeDasharray="5 4" dot={false} />,
                    ])}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {intensityTrend.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Intensity Actuals vs Forecast</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={intensityTrend} margin={{ top: 5, right: 20, left: 6, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="year" />
                  <YAxis />
                  <Tooltip formatter={formatTooltipValue} />
                  <Legend />
                  {Object.entries(intensityMetrics)
                    .map(([key, metric]) => ({ key, label: metric?.label?.trim() || key }))
                    .slice(0, 4)
                    .map((entry, index) => (
                      <Line
                        key={entry.key}
                        type="monotone"
                        dataKey={entry.label}
                        stroke={ACTIVITY_COLORS[index % ACTIVITY_COLORS.length]}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        name={entry.label}
                      />
                    ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Monthly Emissions Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={monthlyTrend} margin={{ top: 5, right: 20, left: 6, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={formatTooltipValue} />
                <Line type="monotone" dataKey="actual" stroke="#0f766e" strokeWidth={3} dot={{ r: 3 }} name="Actual" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What If Scenarios</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <ScenarioInput label="Scope 1 reduction %" value={whatIfScope1} onChange={setWhatIfScope1} />
            <ScenarioInput label="Scope 2 reduction %" value={whatIfScope2} onChange={setWhatIfScope2} />
            <ScenarioInput label="Scope 3 reduction %" value={whatIfScope3} onChange={setWhatIfScope3} />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard label="Scenario total" value={formatTco2e(whatIf.total)} />
            <MetricCard label="Reduction" value={formatTco2e(whatIf.reduction)} suffix="tCO₂e" />
            <MetricCard label="Reduction %" value={whatIf.reductionPct.toFixed(1)} suffix="%" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => { setWhatIfScope1("10"); setWhatIfScope2("10"); setWhatIfScope3("10"); }}>
              Moderate action
            </Button>
            <Button variant="outline" onClick={() => { setWhatIfScope1("25"); setWhatIfScope2("15"); setWhatIfScope3("20"); }}>
              Strong action
            </Button>
            <Button variant="outline" onClick={() => { setWhatIfScope1("0"); setWhatIfScope2("0"); setWhatIfScope3("0"); }}>
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Industry Trends and References</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-700">
          <p>Use this section to compare the job against sector norms, highlight reduction opportunities, and cite the source material used for assumptions.</p>
          <ul className="list-disc space-y-1 pl-5 text-slate-600">
            <li>GHG Protocol Corporate Standard</li>
            <li>Science Based Targets initiative guidance</li>
            <li>UK Government greenhouse gas conversion factors</li>
            <li>IEA Net Zero by 2050 roadmap</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number | string;
  suffix?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="text-3xl font-semibold tabular-nums">{value}{suffix ? ` ${suffix}` : ""}</div>
      </CardContent>
    </Card>
  );
}

function LinkMetricCard({
  label,
  value,
  suffix,
  name,
  href,
}: {
  label: string;
  value: number | string;
  suffix?: string;
  name: string;
  href: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="text-3xl font-semibold tabular-nums">{value}{suffix ? ` ${suffix}` : ""}</div>
        <Link href={href} className="mt-2 inline-block max-w-full truncate text-sm font-medium text-slate-900 underline decoration-slate-300 underline-offset-2">
          {name}
        </Link>
      </CardContent>
    </Card>
  );
}

function ScenarioInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{label}</div>
      <Input type="number" min="0" max="100" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
