"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import JobIntensityYearOverYear from "@/components/JobIntensityYearOverYear";

type ScopeCategoryData = {
  [scope: string]: {
    [category: string]: number;
  };
};

type ClientReportingData = {
  client_db_id: number;
  client_name: string;
  years: number[];
  year_jobs?: Array<{
    year: number;
    job_id: number;
    job_number: string | null;
    title?: string | null;
    reporting_year?: number | null;
  }>;
  by_scope: Array<{
    year: number;
    [key: string]: number | string;
  }>;
  by_scope_category: Array<{
    year: number;
    scopes: ScopeCategoryData;
  }>;
  by_activity: Array<{
    year: number;
    [key: string]: number | string;
  }>;
  by_site: Array<{
    year: number;
    [key: string]: number | string;
  }>;
};

type ClientReportingProps = {
  clientId: number;
  baseUrl: string;
};

const SCOPE_COLORS = ["#15803d", "#22c55e", "#4ade80", "#86efac", "#bbf7d0"];

export default function ClientReporting({ clientId, baseUrl }: ClientReportingProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<ClientReportingData | null>(null);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`${baseUrl}/clients/${clientId}/reporting`);
        if (!res.ok) throw new Error(`Failed to load reporting data: ${res.status}`);
        const json = (await res.json()) as ClientReportingData;
        setData(json);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }
    void loadData();
  }, [clientId, baseUrl]);

  function formatNumber(num: number): string {
    return num.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">Loading reporting data...</div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-destructive">{error}</div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.years.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">
            No reporting data available. Complete CRP jobs to see year-over-year comparisons.
          </div>
        </CardContent>
      </Card>
    );
  }

  const { years, by_scope, by_scope_category, by_activity, by_site } = data;
  const latestYear = years[years.length - 1];
  const benchmarkYear = years[0];
  const displayYears = Array.from(new Set([benchmarkYear, ...years.slice(-4)]));
  const prevYear = years.length >= 2 ? years[years.length - 2] : null;
  const showBenchmarkNote = years.length > 4;
  const yearJobsByYear = new Map(
    (data.year_jobs || [])
      .filter((job) => Number.isFinite(Number(job.year)) && Number.isFinite(Number(job.job_id)))
      .map((job) => [
        Number(job.year),
        {
          job_id: Number(job.job_id),
          job_number: job.job_number?.trim() || null,
          title: job.title?.trim() || null,
          reporting_year: job.reporting_year ?? null,
        },
      ])
  );

  // All unique scopes across all years
  const allScopes = new Set<string>();
  for (const yd of (by_scope_category ?? [])) {
    if (yd.scopes) {
      for (const s of Object.keys(yd.scopes)) allScopes.add(s);
    }
  }
  const sortedScopes = Array.from(allScopes).sort();

  function getCategoriesForScope(scopeName: string): string[] {
    const cats = new Set<string>();
    for (const yd of (by_scope_category ?? [])) {
      if (yd.scopes?.[scopeName]) {
        for (const c of Object.keys(yd.scopes[scopeName])) cats.add(c);
      }
    }
    return Array.from(cats).sort();
  }

  function getYoYChange(cur: number, prev: number): { value: number | null; color: string } {
    if (prev === 0 || isNaN(cur) || isNaN(prev)) return { value: null, color: "" };
    const pct = ((cur - prev) / prev) * 100;
    return { value: pct, color: pct > 0 ? "text-red-600" : pct < 0 ? "text-green-600" : "" };
  }

  function getValueForYear(
    arr: Array<{ [k: string]: number | string }>,
    year: number,
    key: string
  ): number {
    const row = arr.find((d) => d.year === year);
    if (!row) return 0;
    const v = row[key];
    return typeof v === "number" ? v : 0;
  }

  function getScopeCatValue(year: number, scope: string, cat: string): number {
    const yd = (by_scope_category ?? []).find((d) => d.year === year);
    if (!yd?.scopes?.[scope]) return 0;
    return yd.scopes[scope][cat] || 0;
  }

  function renderChange(cur: number, prev: number) {
    const { value, color } = getYoYChange(cur, prev);
    if (value === null) return <span className="text-slate-400">—</span>;
    return (
      <span className={color}>
        {value > 0 ? "+" : ""}
        {value.toFixed(1)}%
      </span>
    );
  }

  // Stacked bar chart data (all years)
  const chartData = years.map((year) => {
    const row: Record<string, number | string> = { year: String(year) };
    if (sortedScopes.length > 0) {
      for (const s of sortedScopes) row[s] = getValueForYear(by_scope, year, s);
    } else {
      row["Total"] = getValueForYear(by_scope, year, "total");
    }
    return row;
  });

  const chartBars =
    sortedScopes.length > 0
      ? sortedScopes.map((scope, i) => (
          <Bar
            key={scope}
            dataKey={scope}
            stackId="a"
            fill={SCOPE_COLORS[i % SCOPE_COLORS.length]}
          />
        ))
      : [<Bar key="total" dataKey="Total" fill={SCOPE_COLORS[0]} />];

  // Shared year header cells (benchmark + last 4 + Change)
  function yearHeaders() {
    return (
      <>
        {displayYears.map((year) => {
          const yearJob = yearJobsByYear.get(year);
          const yearJobLabel = yearJob?.job_number || (yearJob?.job_id ? `Job ${yearJob.job_id}` : "");
          return (
            <th
              key={year}
              className={`text-right p-2 border whitespace-nowrap ${
                year === benchmarkYear && showBenchmarkNote ? "text-slate-500" : ""
              }`}
            >
              {yearJob?.job_id ? (
                <Link
                  href={`/jobs/${yearJob.job_id}`}
                  className="inline-flex flex-col items-end leading-tight hover:text-foreground hover:underline"
                  aria-label={`Open ${yearJobLabel}`}
                >
                  {yearJobLabel ? (
                    <span className="text-[10px] font-medium uppercase tracking-wide text-primary">
                      {yearJobLabel}
                    </span>
                  ) : null}
                  {year === benchmarkYear ? (
                    <Badge className="h-4 rounded-full border-amber-400 bg-amber-400 px-1.5 py-0 text-[9px] font-bold leading-none text-white">
                      BM
                    </Badge>
                  ) : null}
                  <span className="text-sm font-normal">
                    {year}
                    {year === benchmarkYear && showBenchmarkNote ? " ★" : ""}
                  </span>
                </Link>
              ) : (
                <>
                  {year}
                  {year === benchmarkYear && showBenchmarkNote ? " ★" : ""}
                </>
              )}
            </th>
          );
        })}
        <th className="text-right p-2 border">Change</th>
      </>
    );
  }

  return (
    <>
      <div className="space-y-6">
        {/* KPI Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total Emissions ({latestYear})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatNumber(getValueForYear(by_scope, latestYear, "total"))} tCO₂e
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Year-over-Year Change</CardTitle>
            </CardHeader>
            <CardContent>
              {prevYear ? (
                (() => {
                  const { value, color } = getYoYChange(
                    getValueForYear(by_scope, latestYear, "total"),
                    getValueForYear(by_scope, prevYear, "total")
                  );
                  if (value === null) return <div className="text-2xl font-bold">—</div>;
                  return (
                    <div className={`text-2xl font-bold ${color}`}>
                      {value > 0 ? "+" : ""}
                      {value.toFixed(1)}%
                    </div>
                  );
                })()
              ) : (
                <div className="text-2xl font-bold">—</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Years of Data</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{years.length}</div>
              <div className="text-xs text-muted-foreground">
                {years[0]} – {latestYear}
              </div>
              <div className="mt-3 space-y-1">
                {displayYears.map((year) => {
                  const yearJob = yearJobsByYear.get(year);
                  if (!yearJob?.job_id) return null;
                  const yearJobLabel = yearJob.job_number || `Job ${yearJob.job_id}`;
                  return (
                    <Link
                      key={year}
                      href={`/jobs/${yearJob.job_id}`}
                      className="flex items-center gap-2 text-xs text-primary hover:underline"
                      aria-label={`Open ${yearJobLabel}`}
                    >
                      <span>{yearJobLabel}</span>
                      {year === benchmarkYear ? (
                        <Badge className="h-4 rounded-full border-amber-400 bg-amber-400 px-1.5 py-0 text-[9px] font-bold leading-none text-white">
                          BM
                        </Badge>
                      ) : null}
                      <span className="text-muted-foreground">({year})</span>
                    </Link>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Overview Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Total Emissions by Year</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="year" tick={{ fontSize: 12 }} />
                <YAxis
                  tick={{ fontSize: 12 }}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                  }
                />
                <Tooltip
                  formatter={(value: string | number | undefined) => [
                    `${formatNumber(Number(value ?? 0))} tCO₂e`,
                  ]}
                />
                <Legend />
                {chartBars}
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Detail Tabs */}
        <Tabs defaultValue="by-scope" className="w-full">
          <TabsList>
            <TabsTrigger value="by-scope">By Scope</TabsTrigger>
            <TabsTrigger value="by-activity">By Activity</TabsTrigger>
            <TabsTrigger value="by-site">By Site</TabsTrigger>
          </TabsList>

        {/* ── By Scope ── */}
        <TabsContent value="by-scope" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Emissions by Scope &amp; Category</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-muted">
                      <th className="text-left p-2 border">Scope</th>
                      <th className="text-left p-2 border">Category</th>
                      {yearHeaders()}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedScopes.map((scope) => {
                      const categories = getCategoriesForScope(scope);
                      return (
                        <>
                          {categories.map((cat) => (
                            <tr key={`${scope}-${cat}`} className="hover:bg-muted/50">
                              <td className="p-2 border text-slate-500 text-xs align-top">
                                {cat === categories[0] ? scope : ""}
                              </td>
                              <td className="p-2 border">{cat}</td>
                              {displayYears.map((year) => {
                                const value = getScopeCatValue(year, scope, cat);
                                return (
                                  <td key={year} className="text-right p-2 border">
                                    {value > 0 ? formatNumber(value) : "—"}
                                  </td>
                                );
                              })}
                              <td className="text-right p-2 border">
                                {prevYear
                                  ? renderChange(
                                      getScopeCatValue(latestYear, scope, cat),
                                      getScopeCatValue(prevYear, scope, cat)
                                    )
                                  : "—"}
                              </td>
                            </tr>
                          ))}
                          {/* Scope subtotal */}
                          <tr className="bg-slate-50 font-semibold text-slate-700">
                            <td className="p-2 border" />
                            <td className="p-2 border">{scope} Total</td>
                            {displayYears.map((year) => {
                              const value = getValueForYear(by_scope, year, scope);
                              return (
                                <td key={year} className="text-right p-2 border">
                                  {value > 0 ? formatNumber(value) : "—"}
                                </td>
                              );
                            })}
                            <td className="text-right p-2 border">
                              {prevYear
                                ? renderChange(
                                    getValueForYear(by_scope, latestYear, scope),
                                    getValueForYear(by_scope, prevYear, scope)
                                  )
                                : "—"}
                            </td>
                          </tr>
                        </>
                      );
                    })}
                    {/* Grand total */}
                    <tr className="bg-muted font-bold">
                      <td className="p-2 border" />
                      <td className="p-2 border">Total</td>
                      {displayYears.map((year) => {
                        const value = getValueForYear(by_scope, year, "total");
                        return (
                          <td key={year} className="text-right p-2 border">
                            {value > 0 ? formatNumber(value) : "—"}
                          </td>
                        );
                      })}
                      <td className="text-right p-2 border">
                        {prevYear
                          ? renderChange(
                              getValueForYear(by_scope, latestYear, "total"),
                              getValueForYear(by_scope, prevYear, "total")
                            )
                          : "—"}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {showBenchmarkNote && (
                <p className="mt-2 text-xs text-muted-foreground">★ Benchmark year</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── By Activity ── */}
        <TabsContent value="by-activity" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Emissions by Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-muted">
                      <th className="text-left p-2 border">Activity</th>
                      {yearHeaders()}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const allCats = new Set<string>();
                      for (const row of by_activity) {
                        for (const key of Object.keys(row)) {
                          if (key !== "year" && key !== "total") allCats.add(key);
                        }
                      }
                      const sorted = Array.from(allCats).sort();
                      const display = sorted.slice(0, 20);
                      return (
                        <>
                          {display.map((cat) => (
                            <tr key={cat} className="hover:bg-muted/50">
                              <td className="p-2 border font-medium">{cat}</td>
                              {displayYears.map((year) => {
                                const value = getValueForYear(by_activity, year, cat);
                                return (
                                  <td key={year} className="text-right p-2 border">
                                    {value > 0 ? formatNumber(value) : "—"}
                                  </td>
                                );
                              })}
                              <td className="text-right p-2 border">
                                {prevYear
                                  ? renderChange(
                                      getValueForYear(by_activity, latestYear, cat),
                                      getValueForYear(by_activity, prevYear, cat)
                                    )
                                  : "—"}
                              </td>
                            </tr>
                          ))}
                          {sorted.length > 20 && (
                            <tr>
                              <td
                                colSpan={displayYears.length + 2}
                                className="p-2 border text-center text-xs text-muted-foreground"
                              >
                                Showing 20 of {sorted.length} activities
                              </td>
                            </tr>
                          )}
                          <tr className="bg-muted font-semibold">
                            <td className="p-2 border">Total</td>
                            {displayYears.map((year) => {
                              const value = getValueForYear(by_activity, year, "total");
                              return (
                                <td key={year} className="text-right p-2 border">
                                  {value > 0 ? formatNumber(value) : "—"}
                                </td>
                              );
                            })}
                            <td className="text-right p-2 border">
                              {prevYear
                                ? renderChange(
                                    getValueForYear(by_activity, latestYear, "total"),
                                    getValueForYear(by_activity, prevYear, "total")
                                  )
                                : "—"}
                            </td>
                          </tr>
                        </>
                      );
                    })()}
                  </tbody>
                </table>
              </div>
              {showBenchmarkNote && (
                <p className="mt-2 text-xs text-muted-foreground">★ Benchmark year</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── By Site ── */}
        <TabsContent value="by-site" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Emissions by Site</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-muted">
                      <th className="text-left p-2 border">Site</th>
                      {yearHeaders()}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const allSites = new Set<string>();
                      for (const row of by_site) {
                        for (const key of Object.keys(row)) {
                          if (key !== "year" && key !== "total") allSites.add(key);
                        }
                      }
                      const sortedSites = Array.from(allSites).sort();
                      return (
                        <>
                          {sortedSites.map((site) => (
                            <tr key={site} className="hover:bg-muted/50">
                              <td className="p-2 border font-medium">{site}</td>
                              {displayYears.map((year) => {
                                const value = getValueForYear(by_site, year, site);
                                return (
                                  <td key={year} className="text-right p-2 border">
                                    {value > 0 ? formatNumber(value) : "—"}
                                  </td>
                                );
                              })}
                              <td className="text-right p-2 border">
                                {prevYear
                                  ? renderChange(
                                      getValueForYear(by_site, latestYear, site),
                                      getValueForYear(by_site, prevYear, site)
                                    )
                                  : "—"}
                              </td>
                            </tr>
                          ))}
                          <tr className="bg-muted font-semibold">
                            <td className="p-2 border">Total</td>
                            {displayYears.map((year) => {
                              const value = getValueForYear(by_site, year, "total");
                              return (
                                <td key={year} className="text-right p-2 border">
                                  {value > 0 ? formatNumber(value) : "—"}
                                </td>
                              );
                            })}
                            <td className="text-right p-2 border">
                              {prevYear
                                ? renderChange(
                                    getValueForYear(by_site, latestYear, "total"),
                                    getValueForYear(by_site, prevYear, "total")
                                  )
                                : "—"}
                            </td>
                          </tr>
                        </>
                      );
                    })()}
                  </tbody>
                </table>
              </div>
              {showBenchmarkNote && (
                <p className="mt-2 text-xs text-muted-foreground">★ Benchmark year</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        </Tabs>
      </div>

      <div className="pt-2">
        <JobIntensityYearOverYear clientId={clientId} baseUrl={baseUrl} />
      </div>
    </>
  );
}
