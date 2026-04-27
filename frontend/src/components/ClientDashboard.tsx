"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getToken } from "@/lib/auth-client";
import { formatEmissions } from "@/lib/format";

type DashboardData = {
  client_db_id: number;
  selected_year: number | null;
  available_years: number[];
  current_metrics: {
    total_emissions: number;
    scope1: number;
    scope2: number;
    scope3: number;
    year: number | null;
  };
  yoy_change: number | null;
  yearly_emissions: Array<{
    year: number | null;
    scope1: number;
    scope2: number;
    scope3: number;
    total: number;
  }>;
  yearly_top_categories?: Array<{
    year: number | null;
    categories: Array<{
      category: string;
      emissions: number;
      percentage: number;
    }>;
  }>;
  yearly_intensity_metrics?: Array<{
    year: number | null;
    metrics: Array<{
      key: string;
      label: string;
      value: number;
      divider: number;
      intensity: number;
    }>;
  }>;
  benchmark_metrics?: {
    benchmark_year: number | null;
    scope1: number | null;
    scope2: number | null;
    scope3: number | null;
    total: number | null;
    source?: string | null;
  } | null;
  top_categories: Array<{
    category: string;
    emissions: number;
    percentage: number;
  }>;
  intensity_metrics: Array<{
    key: string;
    label: string;
    value: number;
    divider: number;
    intensity: number;
  }>;
  currency: string;
  industry_average_emissions?: number | null;
  net_zero_progress?: {
    current_year?: number;
    net_zero_year: number;
    years_to_target: number;
  } | null;
};

type ClientDashboardProps = {
  clientId: number;
  baseUrl: string;
};

const SCOPE_COLORS = ["#0f766e", "#0891b2", "#38bdf8"];
const ClientDashboardCharts = dynamic(() => import("@/components/ClientDashboardCharts"), {
  ssr: false,
  loading: () => <div className="py-12 text-center text-sm text-muted-foreground">Loading charts...</div>,
});
const AIInsights = dynamic(() => import("@/components/AIInsights"), {
  ssr: false,
  loading: () => <div className="py-12 text-center text-sm text-muted-foreground">Loading insights...</div>,
});

export default function ClientDashboard({ clientId, baseUrl }: ClientDashboardProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(async (year: number | null = null) => {
    try {
      setLoading(true);
      setError("");
      const params = year !== null ? `?year=${year}` : "";
      const token = getToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(`${baseUrl}/clients/${clientId}/dashboard${params}`, {
        cache: "no-store",
        credentials: "include",
        headers,
      });
      if (!res.ok) throw new Error("Failed to load dashboard data");
      const json = (await res.json()) as DashboardData;
      setData(json);
      const responseYear = json.selected_year ?? json.current_metrics?.year ?? null;
      if (responseYear !== null) setSelectedYear(Number(responseYear));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [baseUrl, clientId]);

  useEffect(() => {
    void loadDashboard(null);
  }, [loadDashboard]);

  const yearOptions = useMemo(() => {
    if (!data) return [];
    const apiYears = (data.available_years || [])
      .map((y) => Number(y))
      .filter((y) => Number.isFinite(y));
    if (apiYears.length > 0) {
      return [...new Set(apiYears)].sort((a, b) => b - a);
    }
    const derivedYears = (data.yearly_emissions || [])
      .map((x) => (x.year !== null ? Number(x.year) : null))
      .filter((y): y is number => y !== null && Number.isFinite(y));
    return [...new Set(derivedYears)].sort((a, b) => b - a);
  }, [data]);

  useEffect(() => {
    if (!data || loading) return;
    const responseYear = data.selected_year ?? data.current_metrics?.year ?? null;
    const latestYear = yearOptions[0] ?? null;
    const fallbackYear = responseYear ?? latestYear;
    if (selectedYear === null && fallbackYear !== null) {
      setSelectedYear(Number(fallbackYear));
      return;
    }
    if (selectedYear !== null && yearOptions.length > 0 && !yearOptions.includes(selectedYear)) {
      setSelectedYear(latestYear);
    }
  }, [data, loading, selectedYear, yearOptions]);

  const selectedYearData = useMemo(() => {
    if (!data) return null;
    const year = selectedYear ?? data.selected_year ?? data.current_metrics?.year ?? null;
    if (year == null) return null;
    return (data.yearly_emissions || []).find((x) => x.year !== null && Number(x.year) === Number(year)) || null;
  }, [data, selectedYear]);

  const selectedCategories = useMemo(() => {
    if (!data) return [];
    const year = selectedYear ?? data.selected_year ?? data.current_metrics?.year ?? null;
    if (year == null) return [];
    const yearly = (data.yearly_top_categories || []).find((x) => x.year !== null && Number(x.year) === Number(year));
    const categories = yearly?.categories ?? data.top_categories ?? [];
    return [...categories]
      .sort((a, b) => b.emissions - a.emissions)
      .slice(0, 6)
      .map((row) => ({
        category: row.category,
        emissions: Number(row.emissions || 0),
        percentage: Number(row.percentage || 0),
      }));
  }, [data, selectedYear]);

  const currentMetrics = selectedYearData
    ? {
        total_emissions: Number(selectedYearData.total || 0),
        scope1: Number(selectedYearData.scope1 || 0),
        scope2: Number(selectedYearData.scope2 || 0),
        scope3: Number(selectedYearData.scope3 || 0),
        year: selectedYearData.year,
      }
    : data?.current_metrics ?? null;

  const scopeData = useMemo(() => {
    if (!currentMetrics) return [];
    return [
      { name: "Scope 1", value: Number(currentMetrics.scope1 || 0) },
      { name: "Scope 2", value: Number(currentMetrics.scope2 || 0) },
      { name: "Scope 3", value: Number(currentMetrics.scope3 || 0) },
    ].filter((x) => x.value > 0);
  }, [currentMetrics]);

  const topCategoryData = useMemo(() => {
    return selectedCategories;
  }, [selectedCategories]);

  const trendData = useMemo(() => {
    if (!data) return [];
    return [...(data.yearly_emissions || [])]
      .filter((x) => x.year !== null)
      .sort((a, b) => Number(a.year) - Number(b.year))
      .map((x) => ({
        year: String(x.year),
        total: Number(x.total || 0),
        scope1: Number(x.scope1 || 0),
        scope2: Number(x.scope2 || 0),
        scope3: Number(x.scope3 || 0),
      }));
  }, [data]);

  const benchmarkPoint = useMemo(() => {
    if (data?.benchmark_metrics && (
      data.benchmark_metrics.scope1 != null ||
      data.benchmark_metrics.scope2 != null ||
      data.benchmark_metrics.scope3 != null ||
      data.benchmark_metrics.total != null
    )) {
      return {
        year: data.benchmark_metrics.benchmark_year,
        scope1: Number(data.benchmark_metrics.scope1 || 0),
        scope2: Number(data.benchmark_metrics.scope2 || 0),
        scope3: Number(data.benchmark_metrics.scope3 || 0),
        total: Number(data.benchmark_metrics.total || 0),
        source: data.benchmark_metrics.source || "client",
      };
    }
    if (!data?.yearly_emissions || data.yearly_emissions.length === 0) return null;
    const ordered = [...data.yearly_emissions]
      .filter((x) => x.year !== null)
      .sort((a, b) => Number(a.year) - Number(b.year));
    if (ordered.length === 0) return null;
    return { ...ordered[0], source: "job" };
  }, [data]);

  if (error) return <div className="py-8 text-center text-red-500">Error: {error}</div>;
  if (!data && loading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-sm text-muted-foreground">Reporting Year:</span>
          <div className="h-10 w-36 rounded-md border bg-muted/30 animate-pulse" />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <Card key={idx}>
              <CardContent className="space-y-3 pt-6 text-right">
                <div className="ml-auto h-4 w-24 rounded bg-muted/40 animate-pulse" />
                <div className="ml-auto h-10 w-20 rounded bg-muted/40 animate-pulse" />
                <div className="ml-auto h-3 w-28 rounded bg-muted/30 animate-pulse" />
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Emissions Summary by Scope</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
                <div className="mx-auto h-[420px] w-full max-w-[520px] rounded-full bg-muted/20 animate-pulse" />
                <div className="space-y-3 pt-2">
                  {Array.from({ length: 5 }).map((_, idx) => (
                    <div key={idx} className="flex items-center justify-between gap-2">
                      <div className="h-4 w-28 rounded bg-muted/30 animate-pulse" />
                      <div className="h-4 w-12 rounded bg-muted/30 animate-pulse" />
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Top Emissions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[320px] rounded-md bg-muted/20 animate-pulse" />
            </CardContent>
          </Card>
        </div>
      </div>
  );
  }
  if (!data) return <div className="py-8 text-center">No dashboard data available</div>;

  const total = Number(currentMetrics?.total_emissions || 0);
  const displayYear = selectedYear ?? currentMetrics?.year ?? data.selected_year ?? data.current_metrics.year ?? "N/A";
  const benchmarkCaption = benchmarkPoint
    ? benchmarkPoint.source === "client"
              ? `${formatEmissions(benchmarkPoint.total)} tCO₂e (client baseline${benchmarkPoint.year ? `, ${benchmarkPoint.year}` : ""})`
      : `${formatEmissions(benchmarkPoint.total)} tCO₂e (${benchmarkPoint.year ?? "benchmark"})`
    : "No benchmark data available";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="text-sm text-muted-foreground">Reporting Year:</span>
        <Select
          value={selectedYear !== null ? selectedYear.toString() : ""}
          disabled={loading}
          onValueChange={(value) => {
            setSelectedYear(Number(value));
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Select year..." />
          </SelectTrigger>
          <SelectContent>
            {yearOptions.map((year) => (
              <SelectItem key={year} value={year.toString()}>
                {year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="text-right text-xs text-muted-foreground">Year changes update this dashboard instantly.</div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6 text-right">
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">Benchmark Emissions</div>
              <div className="text-3xl font-semibold tabular-nums">
                {benchmarkPoint ? formatEmissions(benchmarkPoint.total) : "-"}
              </div>
              <div className="text-xs text-muted-foreground">
                {benchmarkCaption}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-right">
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">Total Emissions</div>
              <div className="text-3xl font-semibold tabular-nums">{formatEmissions(total)}</div>
              <div className="text-xs text-muted-foreground">tCO₂e ({displayYear})</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-right">
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">Highest Emissions</div>
              <div className="text-3xl font-semibold tabular-nums">
                {topCategoryData[0] ? formatEmissions(topCategoryData[0].emissions) : "-"}
              </div>
              <div className="truncate text-lg font-semibold">
                {topCategoryData[0]?.category || "No category data"}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-right">
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">Net Zero Target</div>
              <div className="text-3xl font-semibold tabular-nums">{data.net_zero_progress?.net_zero_year ?? "-"}</div>
              <div className="text-xs text-muted-foreground">
                {data.net_zero_progress ? `${data.net_zero_progress.years_to_target} years to target` : "Target not set"}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="insights">AI Insights</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <ClientDashboardCharts
            scopeData={scopeData}
            total={total}
            trendData={trendData}
            topCategoryData={topCategoryData}
            view="overview"
          />
        </TabsContent>

        <TabsContent value="trends" className="space-y-6">
          <ClientDashboardCharts
            scopeData={scopeData}
            total={total}
            trendData={trendData}
            topCategoryData={topCategoryData}
            view="trends"
          />
        </TabsContent>

        <TabsContent value="insights" className="space-y-6">
          <AIInsights clientId={clientId} baseUrl={baseUrl} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
