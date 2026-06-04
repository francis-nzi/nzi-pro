"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import LoadingOrbit from "@/components/LoadingOrbit";
import { Input } from "@/components/ui/input";
import {
  EmissionsByActivityWidget,
  EmissionsReductionPathwayWidget,
  IntensityPathwayWidget,
  SiteSummaryDonutWidget,
  ScopeYearOnYearBarWidget,
  ScopeSummaryDonutWidget,
  captureSvgToPngDataUrl,
  findLargestSvg,
  type IntensityPathwayPoint,
} from "@/components/report-widgets";

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
  const [capturing, setCapturing] = useState(false);
  const [captureStatus, setCaptureStatus] = useState<{ count: number; at: string } | null>(null);

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
    ];
  }, [scopeTotals]);

  const benchmarkScopeTotal = useMemo(() => {
    const firstHistoricalYear = yearlyEmissions.length > 0 ? yearlyEmissions[0].year : null;
    const benchmarkRow = yearlyEmissions.find((row) => row.year === (benchmarkYear ?? firstHistoricalYear ?? null));
    return benchmarkRow ? Number(benchmarkRow.total || 0) : null;
  }, [benchmarkYear, yearlyEmissions]);

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

  const activityBarData = useMemo(
    () =>
      normalizedActivityData.map((activity, index) => ({
        name: activity.name,
        fullName: activity.name,
        value: activity.value,
        fill: ACTIVITY_COLORS[index % ACTIVITY_COLORS.length],
      })),
    [normalizedActivityData]
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
  const firstHistoricalYear = yearlyEmissions.length > 0 ? yearlyEmissions[0].year : null;
  const currentReportingLabel = `Reporting year ${currentYear}`;
  const pathwayReportingLabel = `Reporting years ${firstHistoricalYear ?? benchmarkYear ?? currentYear} to ${targetYear ?? 2050}`;

  const scopeYearOnYearBar = useMemo(() => {
    if (!scopeTotals || yearlyEmissions.length === 0) return null;

    const benchmarkBarYear = benchmarkYear ?? firstHistoricalYear ?? currentYear;
    const currentRow = yearlyEmissions.find((row) => row.year === currentYear) ?? yearlyEmissions[yearlyEmissions.length - 1] ?? null;
    const benchmarkRow =
      yearlyEmissions.find((row) => row.year === benchmarkBarYear) ??
      yearlyEmissions.find((row) => row.year === firstHistoricalYear) ??
      yearlyEmissions[0] ??
      null;
    const isBenchmarkReportYear = benchmarkBarYear === currentYear;

    if (!currentRow || !benchmarkRow) return null;

    const previousRow =
      yearlyEmissions
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
    }, [benchmarkYear, currentYear, firstHistoricalYear, scopeTotals, yearlyEmissions]);

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

  const intensityPathwaySeries = useMemo(
    () =>
      Object.entries(intensityMetrics)
        .map(([key, metric], index) => ({
          key,
          label: metric?.label?.trim() || key,
          color: ACTIVITY_COLORS[index % ACTIVITY_COLORS.length],
          value: Number(metric?.value ?? 0),
        }))
        .filter((entry) => entry.value > 0)
        .slice(0, 4),
    [intensityMetrics]
  );

  const intensityPathwayData = useMemo(() => {
    if (!scopeTotals || intensityPathwaySeries.length === 0) return [];

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
      const row: IntensityPathwayPoint = { year };
      intensityPathwaySeries.forEach((entry) => {
        const metric = intensityMetrics[entry.key];
        const value = Number(metric?.value ?? 0) || 1;
        const divider = Number(metric?.divider ?? 1) || 1;
        row[`${entry.label}_actual`] = actual
          ? Number(((actual.total * divider) / value).toFixed(3))
          : null;
        row[`${entry.label}_target`] = Number(((forecast * divider) / value).toFixed(3));
      });
      return row;
    });
  }, [benchmarkYear, currentYear, intensityMetrics, intensityPathwaySeries, interimTargets.scope_1, interimTargets.scope_2, interimTargets.scope_3, interimYear, scopeTotals, targetReductionPct, targetYear, yearlyEmissions]);

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

  async function captureAllWidgetPngs() {
    setCapturing(true);
    setCaptureStatus(null);
    const pngs: Record<string, string> = {};
    const containers = document.querySelectorAll("[data-widget-key]");
    for (const el of Array.from(containers)) {
      const widgetId = el.getAttribute("data-widget-key");
      if (!widgetId) continue;
      const svg = findLargestSvg(el as HTMLElement);
      if (!svg) continue;
      try {
        pngs[widgetId] = await captureSvgToPngDataUrl(svg);
      } catch {
        // skip widgets that fail to render
      }
    }
    if (Object.keys(pngs).length > 0) {
      try {
        await fetch(`${baseUrl}/jobs/${jobId}/widget-pngs`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pngs }),
        });
        setCaptureStatus({ count: Object.keys(pngs).length, at: new Date().toLocaleTimeString() });
      } catch {
        setCaptureStatus(null);
      }
    }
    setCapturing(false);
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Job Insights</CardTitle>
        </CardHeader>
        <CardContent>
          <LoadingOrbit className="py-10" label="Loading insights dashboard..." />
        </CardContent>
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
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          {captureStatus
            ? `${captureStatus.count} charts captured for PDF at ${captureStatus.at}`
            : "Capture all charts as PNG to embed them in the generated PDF report."}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={capturing || loading}
          onClick={() => void captureAllWidgetPngs()}
        >
          {capturing ? "Capturing…" : "Capture Charts for PDF"}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Total tCO₂e" subtitle={currentReportingLabel} value={formatTco2e(Number(scopeTotals?.total || 0))} />
        <MetricCard label="Target Year" subtitle={currentReportingLabel} value={targetYear ?? 2050} />
        <LinkMetricCard
          label="Top Dataset Category"
          subtitle={currentReportingLabel}
          value={normalizedActivityData[0] ? formatTco2e(normalizedActivityData[0].value) : "0.0"}
          suffix="tCO₂e"
          name={normalizedActivityData[0]?.name ?? "No dataset category data"}
          href={`/jobs/${jobId}/data-entry`}
        />
        <LinkMetricCard
          label="Top Site"
          subtitle={currentReportingLabel}
          value={normalizedSiteData[0] ? formatTco2e(normalizedSiteData[0].value) : "0.0"}
          suffix="tCO₂e"
          name={normalizedSiteData[0]?.name ?? "No site data"}
          href={`/jobs/${jobId}/data-entry`}
        />
      </div>

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle>Summary</CardTitle>
          <div className="text-xs uppercase tracking-[0.28em] text-muted-foreground">{currentReportingLabel}</div>
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

      <div className="space-y-6">
        <ScopeSummaryDonutWidget
          title={`${clientName ?? "Client"} Emissions Summary by Scope`}
          subtitle={currentReportingLabel}
          clientName={clientName}
          data={scopeCards}
          currentYear={currentYear}
          currentTotal={scopeTotals?.total ?? 0}
          benchmarkYear={benchmarkYear ?? firstHistoricalYear ?? currentYear}
          benchmarkTotal={benchmarkScopeTotal}
          className="w-full"
        />

        <SiteSummaryDonutWidget
          title={`${clientName ?? "Client"} Emissions by Site`}
          subtitle={currentReportingLabel}
          clientName={clientName}
          data={normalizedSiteData}
          currentYear={currentYear}
          currentTotal={scopeTotals?.total ?? 0}
          benchmarkYear={benchmarkYear ?? firstHistoricalYear ?? currentYear}
          benchmarkTotal={benchmarkScopeTotal}
          className="w-full"
        />
      </div>

      <div className="w-full">
        <EmissionsByActivityWidget
          title={`${clientName ?? "Client"} Emissions by Activity`}
          subtitle={currentReportingLabel}
          clientName={clientName}
          data={activityBarData}
          showWidgetRef={true}
        />
      </div>

        {scopeYearOnYearBar ? (
          <ScopeYearOnYearBarWidget
              title="Year-on-Year Comparison by Scope"
              clientName={clientName}
              data={scopeYearOnYearBar.data}
              benchmarkLabel={scopeYearOnYearBar.benchmarkLabel}
              previousLabel={scopeYearOnYearBar.previousLabel}
              currentLabel={scopeYearOnYearBar.currentLabel}
            showBenchmarkBar={scopeYearOnYearBar.showBenchmarkBar}
            showPreviousBar={scopeYearOnYearBar.showPreviousBar}
          showComparisonPct={scopeYearOnYearBar.showComparisonPct}
          showWidgetRef={true}
        />
      ) : null}

      {scopePathwayData.length > 0 && (
        <EmissionsReductionPathwayWidget
          title={`${clientName ?? "Client"} Emissions Reduction Targets to ${targetYear ?? 2050}`}
          clientName={clientName}
          data={scopePathwayData}
          benchmarkYear={benchmarkYear}
          targetYear={targetYear}
          interimYear={interimYear}
          showScope2={Number(scopeTotals?.scope_2 || 0) > 0}
          showWidgetRef={true}
        />
      )}

      {intensityPathwayData.length > 0 && (
        <IntensityPathwayWidget
          title={`${clientName ?? "Client"} Intensity Metrics Targets to ${targetYear ?? 2050}`}
          clientName={clientName}
          data={intensityPathwayData}
          series={intensityPathwaySeries}
          benchmarkYear={benchmarkYear}
          targetYear={targetYear}
          interimYear={interimYear}
          showWidgetRef={true}
        />
      )}

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle>Monthly Emissions Trend</CardTitle>
          <div className="text-xs uppercase tracking-[0.28em] text-muted-foreground">{currentReportingLabel}</div>
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
        <CardHeader className="space-y-1">
          <CardTitle>What If Scenarios</CardTitle>
          <div className="text-xs uppercase tracking-[0.28em] text-muted-foreground">{currentReportingLabel}</div>
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
        <CardHeader className="space-y-1">
          <CardTitle>Industry Trends and References</CardTitle>
          <div className="text-xs uppercase tracking-[0.28em] text-muted-foreground">{currentReportingLabel}</div>
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
  subtitle,
  value,
  suffix,
}: {
  label: string;
  subtitle?: string;
  value: number | string;
  suffix?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-1">
          <div className="text-sm text-muted-foreground">{label}</div>
          {subtitle ? <div className="text-[0.62rem] uppercase tracking-[0.28em] text-muted-foreground">{subtitle}</div> : null}
        </div>
        <div className="text-3xl font-semibold tabular-nums">{value}{suffix ? ` ${suffix}` : ""}</div>
      </CardContent>
    </Card>
  );
}

function LinkMetricCard({
  label,
  subtitle,
  value,
  suffix,
  name,
  href,
}: {
  label: string;
  subtitle?: string;
  value: number | string;
  suffix?: string;
  name: string;
  href: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-1">
          <div className="text-sm text-muted-foreground">{label}</div>
          {subtitle ? <div className="text-[0.62rem] uppercase tracking-[0.28em] text-muted-foreground">{subtitle}</div> : null}
        </div>
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
