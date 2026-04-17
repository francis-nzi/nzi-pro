"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AIInsights from "@/components/AIInsights";
import { getAuthUserIdentifier, getToken } from "@/lib/auth-client";

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
      const userIdentifier = getAuthUserIdentifier();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      else if (userIdentifier) headers["X-User-Email"] = userIdentifier;

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

  const scopeData = useMemo(() => {
    if (!data) return [];
    return [
      { name: "Scope 1", value: Number(data.current_metrics.scope1 || 0) },
      { name: "Scope 2", value: Number(data.current_metrics.scope2 || 0) },
      { name: "Scope 3", value: Number(data.current_metrics.scope3 || 0) },
    ].filter((x) => x.value > 0);
  }, [data]);

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

  const topCategoryData = useMemo(() => {
    if (!data) return [];
    return [...(data.top_categories || [])]
      .sort((a, b) => b.emissions - a.emissions)
      .slice(0, 6)
      .map((row) => ({
        category: row.category,
        emissions: Number(row.emissions || 0),
        percentage: Number(row.percentage || 0),
      }));
  }, [data]);

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

  if (loading) return <div className="py-8 text-center">Loading dashboard...</div>;
  if (error) return <div className="py-8 text-center text-red-500">Error: {error}</div>;
  if (!data) return <div className="py-8 text-center">No data available</div>;

  const total = Number(data.current_metrics.total_emissions || 0);
  const displayYear = data.selected_year ?? data.current_metrics.year ?? "N/A";
  const benchmarkCaption = benchmarkPoint
    ? benchmarkPoint.source === "client"
      ? `${Number(benchmarkPoint.total || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} tCO2e (client baseline${benchmarkPoint.year ? `, ${benchmarkPoint.year}` : ""})`
      : `${Number(benchmarkPoint.total || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} tCO2e (${benchmarkPoint.year ?? "benchmark"})`
    : "No benchmark data available";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="text-sm text-muted-foreground">Reporting Year:</span>
        <Select
          value={selectedYear !== null ? selectedYear.toString() : ""}
          onValueChange={(value) => {
            const year = Number(value);
            setSelectedYear(year);
            void loadDashboard(year);
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Benchmark Emissions</div>
            <div className="text-3xl font-semibold">
              {benchmarkPoint ? Number(benchmarkPoint.total || 0).toLocaleString(undefined, { maximumFractionDigits: 1 }) : "-"}
            </div>
            <div className="text-xs text-muted-foreground">
              {benchmarkCaption}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Total Emissions</div>
            <div className="text-3xl font-semibold">{total.toLocaleString(undefined, { maximumFractionDigits: 1 })}</div>
            <div className="text-xs text-muted-foreground">tCO2e ({displayYear})</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Top Category</div>
            <div className="truncate text-lg font-semibold">{topCategoryData[0]?.category || "-"}</div>
            <div className="text-xs text-muted-foreground">
              {topCategoryData[0] ? `${topCategoryData[0].emissions.toLocaleString(undefined, { maximumFractionDigits: 1 })} tCO2e` : "No category data"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Net Zero Target</div>
            <div className="text-3xl font-semibold">{data.net_zero_progress?.net_zero_year ?? "-"}</div>
            <div className="text-xs text-muted-foreground">
              {data.net_zero_progress ? `${data.net_zero_progress.years_to_target} years to target` : "Target not set"}
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
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Emissions Summary by Scope</CardTitle>
              </CardHeader>
              <CardContent>
                {scopeData.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">No scope data available</div>
                ) : (
                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
                    <div className="relative mx-auto aspect-square w-full max-w-[520px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={scopeData} dataKey="value" nameKey="name" innerRadius="77%" outerRadius="96%" paddingAngle={2}>
                            {scopeData.map((_, idx) => (
                              <Cell key={idx} fill={SCOPE_COLORS[idx % SCOPE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(val: number | string | undefined) => `${Number(val ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} tCO2e`} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <div className="text-center leading-none">
                          <div className="whitespace-nowrap text-[clamp(1rem,3.2vw,2.2rem)] font-semibold">
                            {total.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                          </div>
                          <div className="mt-2 text-[11px] text-muted-foreground">tCO2e total</div>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-3 pt-2">
                      {scopeData.map((s, idx) => {
                        const pct = total > 0 ? (s.value / total) * 100 : 0;
                        return (
                          <div key={s.name} className="flex items-center justify-between gap-2 text-sm">
                            <div className="flex items-center gap-2">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SCOPE_COLORS[idx % SCOPE_COLORS.length] }} />
                              <span>{s.name}</span>
                            </div>
                            <span className="font-medium">{pct.toFixed(1)}%</span>
                          </div>
                        );
                      })}
                      <div className="mt-2 border-t pt-2">
                        <div className="flex items-center justify-between gap-2 text-sm font-semibold">
                          <span>Total</span>
                          <span>
                            {scopeData
                              .reduce((acc, s) => acc + (total > 0 ? (s.value / total) * 100 : 0), 0)
                              .toFixed(1)}
                            %
                          </span>
                        </div>
                      </div>

                      <div className="mt-4 border-t pt-3">
                        <div className="mb-2 text-xs font-semibold text-muted-foreground">tCO2e by Scope</div>
                        {scopeData.map((s, idx) => (
                          <div key={`${s.name}-tco2e`} className="flex items-center justify-between gap-2 text-sm">
                            <div className="flex items-center gap-2">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SCOPE_COLORS[idx % SCOPE_COLORS.length] }} />
                              <span>{s.name}</span>
                            </div>
                            <span className="font-medium">
                              {Number(s.value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                            </span>
                          </div>
                        ))}
                        <div className="mt-2 border-t pt-2">
                          <div className="flex items-center justify-between gap-2 text-sm font-semibold">
                            <span>Total</span>
                            <span>{scopeData.reduce((acc, s) => acc + Number(s.value || 0), 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
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
                <CardTitle>Top Emissions</CardTitle>
              </CardHeader>
              <CardContent>
                {topCategoryData.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">No category data available</div>
                ) : (
                  <div className="h-[320px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topCategoryData} layout="vertical" margin={{ top: 4, right: 10, left: 24, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" />
                        <YAxis type="category" dataKey="category" width={140} tick={{ fontSize: 12 }} />
                        <Tooltip formatter={(val: number | string | undefined) => `${Number(val ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} tCO2e`} />
                        <Bar dataKey="emissions" radius={[0, 4, 4, 0]} fill="#0ea5e9" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="trends" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Emissions Trend</CardTitle>
            </CardHeader>
            <CardContent>
              {trendData.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">No trend data available</div>
              ) : (
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData} margin={{ top: 5, right: 20, left: 6, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="year" />
                      <YAxis />
                      <Tooltip formatter={(val: number | string | undefined) => `${Number(val ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} tCO2e`} />
                      <Legend />
                      <Line type="monotone" dataKey="total" stroke="#0f766e" strokeWidth={3} dot={{ r: 4 }} name="Total" />
                      <Line type="monotone" dataKey="scope1" stroke="#0f766e" strokeOpacity={0.7} strokeWidth={1.5} dot={false} name="Scope 1" />
                      <Line type="monotone" dataKey="scope2" stroke="#0891b2" strokeWidth={1.5} dot={false} name="Scope 2" />
                      <Line type="monotone" dataKey="scope3" stroke="#38bdf8" strokeWidth={1.5} dot={false} name="Scope 3" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="insights" className="space-y-6">
          <AIInsights clientId={clientId} baseUrl={baseUrl} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
