"use client";

import React, { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { apiFetch } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KpiCard } from "@/components/shared/KpiCard";
import { TrendChip } from "@/components/shared/TrendChip";
import { EmptyStatePanel, ErrorPanel, SkeletonLoader } from "@/components/shared/DataStates";

type ScopeCategoryData = { [scope: string]: { [category: string]: number } };

type ActivityDetail = {
  year: number;
  scope: string;
  category: string;
  activity: string;
  emissions: number;
};

type ReportingData = {
  years: number[];
  by_scope: Array<{ year: number; [key: string]: number | string }>;
  by_scope_category: Array<{ year: number; scopes: ScopeCategoryData }>;
  by_activity: Array<{ year: number; [key: string]: number | string }>;
  by_site: Array<{ year: number; [key: string]: number | string }>;
  by_activity_detail?: ActivityDetail[];
};

// Canonical Scope 1/2/3 palette (confirmed 2026-07-20): teal / cyan / sky —
// matches api/chart_generation.py, PortalDashboardCharts.tsx and
// PortalReportViewer.tsx. This was previously a standalone green ramp; see
// CLIENT_PORTAL_PHASE_0_DESIGN_SYSTEM_SCOPE.md §2.3.
const SCOPE_COLORS = ["#0f766e", "#0891b2", "#38bdf8"];

function fmt(n: number): string {
  return n.toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function getVal(arr: Array<{ [k: string]: number | string }>, year: number, key: string): number {
  const row = arr.find(r => r.year === year);
  if (!row) return 0;
  const v = row[key];
  return typeof v === "number" ? v : 0;
}

function yoyPct(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}

function ChangeCell({ cur, prev }: { cur: number; prev: number }) {
  const pct = yoyPct(cur, prev);
  if (pct === null) return <span className="text-muted-foreground">—</span>;
  return <TrendChip value={pct} />;
}

type TabKey = "by-scope" | "by-activity" | "by-site";

export default function PortalReporting() {
  const [data, setData] = useState<ReportingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("by-scope");

  useEffect(() => {
    apiFetch("/portal/reporting-data")
      .then(r => r.json() as Promise<ReportingData>)
      .then(d => setData(d))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <SkeletonLoader rows={4} />;
  if (error) return <ErrorPanel description={`Failed to load reporting data: ${error}`} />;
  if (!data || data.years.length === 0) {
    return (
      <EmptyStatePanel
        title="No reporting data available yet"
        description="Emissions data will appear here once your first year of data has been reported."
      />
    );
  }

  const { years, by_scope, by_scope_category, by_activity, by_site, by_activity_detail } = data;
  const latestYear = years[years.length - 1];
  const benchmarkYear = years[0];
  const displayYears = Array.from(new Set([benchmarkYear, ...years.slice(-4)]));
  const hasComparison = years.length > 1;
  const showBenchmarkNote = years.length > 4;

  const allScopes = new Set<string>();
  for (const yd of by_scope_category) {
    if (yd.scopes) for (const s of Object.keys(yd.scopes)) allScopes.add(s);
  }
  const sortedScopes = Array.from(allScopes).sort();

  const chartData = years.map(yr => {
    const row: Record<string, number | string> = { year: String(yr) };
    for (const s of sortedScopes) row[s] = getVal(by_scope, yr, s);
    return row;
  });

  function getCategoriesForScope(scope: string): string[] {
    const cats = new Set<string>();
    for (const yd of by_scope_category) {
      if (yd.scopes?.[scope]) for (const c of Object.keys(yd.scopes[scope])) cats.add(c);
    }
    return Array.from(cats).sort();
  }

  function getScopeCatVal(year: number, scope: string, cat: string): number {
    const yd = by_scope_category.find(d => d.year === year);
    if (!yd?.scopes?.[scope]) return 0;
    return yd.scopes[scope][cat] || 0;
  }

  function YearHeaders() {
    return (
      <>
        {displayYears.map(yr => (
          <th key={yr} className={`text-right p-2 border whitespace-nowrap text-xs font-medium ${yr === benchmarkYear && showBenchmarkNote ? "text-gray-400" : "text-gray-600"}`}>
            {yr}{yr === benchmarkYear && showBenchmarkNote ? " ★" : ""}
          </th>
        ))}
        <th className="text-right p-2 border text-xs font-medium text-gray-600">Change vs Benchmark</th>
      </>
    );
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: "by-scope", label: "By Scope" },
    { key: "by-activity", label: "By Activity" },
    { key: "by-site", label: "By Site" },
  ];

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label={`Total Emissions (${latestYear})`} value={fmt(getVal(by_scope, latestYear, "total"))} unit="tCO2e" />
        <KpiCard
          label={`Change vs Benchmark (${benchmarkYear})`}
          value={(() => {
            if (!hasComparison) return "—";
            const pct = yoyPct(getVal(by_scope, latestYear, "total"), getVal(by_scope, benchmarkYear, "total"));
            return pct === null ? "—" : `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
          })()}
        />
        <KpiCard label="Years of Data" value={String(years.length)} unit={`${years[0]} – ${latestYear}`} />
      </div>

      {/* Overview chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Total Emissions by Year (tCO2e)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="year" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
              <Tooltip formatter={(v) => `${fmt(Number(v ?? 0))} tCO₂e`} />
              <Legend />
              {sortedScopes.map((s, i) => (
                <Bar key={s} dataKey={s} stackId="a" fill={SCOPE_COLORS[i % SCOPE_COLORS.length]} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Detail tables */}
      <Card className="overflow-hidden p-0">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
          <TabsList className="h-auto w-full justify-start rounded-none border-b border-border bg-transparent p-0">
            {tabs.map(tab => (
              <TabsTrigger
                key={tab.key}
                value={tab.key}
                className="rounded-none border-b-2 border-transparent px-5 py-2.5 data-[state=active]:border-brand data-[state=active]:bg-transparent data-[state=active]:text-brand data-[state=active]:shadow-none"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="overflow-x-auto p-1">
          {activeTab === "by-scope" && (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left p-2 border text-xs font-medium text-gray-600">Scope</th>
                  <th className="text-left p-2 border text-xs font-medium text-gray-600">Category</th>
                  <YearHeaders />
                </tr>
              </thead>
              <tbody>
                {sortedScopes.map(scope => {
                  const cats = getCategoriesForScope(scope);
                  return (
                    <>
                      {cats.map((cat, ci) => (
                        <tr key={`${scope}-${cat}`} className="hover:bg-gray-50">
                          <td className="p-2 border text-gray-400 text-xs align-top">{ci === 0 ? scope : ""}</td>
                          <td className="p-2 border text-xs">{cat}</td>
                          {displayYears.map(yr => {
                            const v = getScopeCatVal(yr, scope, cat);
                            return <td key={yr} className="text-right p-2 border text-xs tabular-nums">{v > 0 ? fmt(v) : "—"}</td>;
                          })}
                          <td className="text-right p-2 border text-xs">
                            {hasComparison ? <ChangeCell cur={getScopeCatVal(latestYear, scope, cat)} prev={getScopeCatVal(benchmarkYear, scope, cat)} /> : "—"}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50 font-semibold">
                        <td className="p-2 border text-xs" />
                        <td className="p-2 border text-xs">{scope} Total</td>
                        {displayYears.map(yr => {
                          const v = getVal(by_scope, yr, scope);
                          return <td key={yr} className="text-right p-2 border text-xs tabular-nums">{v > 0 ? fmt(v) : "—"}</td>;
                        })}
                        <td className="text-right p-2 border text-xs">
                          {hasComparison ? <ChangeCell cur={getVal(by_scope, latestYear, scope)} prev={getVal(by_scope, benchmarkYear, scope)} /> : "—"}
                        </td>
                      </tr>
                    </>
                  );
                })}
                <tr className="bg-gray-100 font-bold">
                  <td className="p-2 border text-xs" />
                  <td className="p-2 border text-xs">Total</td>
                  {displayYears.map(yr => {
                    const v = getVal(by_scope, yr, "total");
                    return <td key={yr} className="text-right p-2 border text-xs tabular-nums">{v > 0 ? fmt(v) : "—"}</td>;
                  })}
                  <td className="text-right p-2 border text-xs">
                    {hasComparison ? <ChangeCell cur={getVal(by_scope, latestYear, "total")} prev={getVal(by_scope, benchmarkYear, "total")} /> : "—"}
                  </td>
                </tr>
              </tbody>
            </table>
          )}

          {activeTab === "by-activity" && (() => {
            const allCats = new Set<string>();
            for (const r of by_activity) for (const k of Object.keys(r)) if (k !== "year" && k !== "total") allCats.add(k);
            const sorted = Array.from(allCats).sort().slice(0, 20);
            return (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left p-2 border text-xs font-medium text-gray-600">Activity</th>
                    <YearHeaders />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(cat => (
                    <tr key={cat} className="hover:bg-gray-50">
                      <td className="p-2 border text-xs font-medium">{cat}</td>
                      {displayYears.map(yr => {
                        const v = getVal(by_activity, yr, cat);
                        return <td key={yr} className="text-right p-2 border text-xs tabular-nums">{v > 0 ? fmt(v) : "—"}</td>;
                      })}
                      <td className="text-right p-2 border text-xs">
                        {hasComparison ? <ChangeCell cur={getVal(by_activity, latestYear, cat)} prev={getVal(by_activity, benchmarkYear, cat)} /> : "—"}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-100 font-bold">
                    <td className="p-2 border text-xs">Total</td>
                    {displayYears.map(yr => {
                      const v = getVal(by_activity, yr, "total");
                      return <td key={yr} className="text-right p-2 border text-xs tabular-nums">{v > 0 ? fmt(v) : "—"}</td>;
                    })}
                    <td className="text-right p-2 border text-xs">
                      {hasComparison ? <ChangeCell cur={getVal(by_activity, latestYear, "total")} prev={getVal(by_activity, benchmarkYear, "total")} /> : "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
            );
          })()}

          {activeTab === "by-site" && (() => {
            const allSites = new Set<string>();
            for (const r of by_site) for (const k of Object.keys(r)) if (k !== "year" && k !== "total") allSites.add(k);
            const sorted = Array.from(allSites).sort();
            return (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left p-2 border text-xs font-medium text-gray-600">Site</th>
                    <YearHeaders />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(site => (
                    <tr key={site} className="hover:bg-gray-50">
                      <td className="p-2 border text-xs font-medium">{site}</td>
                      {displayYears.map(yr => {
                        const v = getVal(by_site, yr, site);
                        return <td key={yr} className="text-right p-2 border text-xs tabular-nums">{v > 0 ? fmt(v) : "—"}</td>;
                      })}
                      <td className="text-right p-2 border text-xs">
                        {hasComparison ? <ChangeCell cur={getVal(by_site, latestYear, site)} prev={getVal(by_site, benchmarkYear, site)} /> : "—"}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-100 font-bold">
                    <td className="p-2 border text-xs">Total</td>
                    {displayYears.map(yr => {
                      const v = getVal(by_site, yr, "total");
                      return <td key={yr} className="text-right p-2 border text-xs tabular-nums">{v > 0 ? fmt(v) : "—"}</td>;
                    })}
                    <td className="text-right p-2 border text-xs">
                      {hasComparison ? <ChangeCell cur={getVal(by_site, latestYear, "total")} prev={getVal(by_site, benchmarkYear, "total")} /> : "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
            );
          })()}
        </div>

        {showBenchmarkNote && <p className="px-4 pb-3 text-xs text-muted-foreground">★ Benchmark year</p>}
      </Card>

      {/* ── Year-over-Year Detailed Activity Breakdown ── */}
      {by_activity_detail && by_activity_detail.length > 0 && (() => {
        // Build scope → category → activities hierarchy
        const dMap = new Map<string, number>();
        const hierarchy = new Map<string, Map<string, Set<string>>>();
        for (const d of by_activity_detail) {
          const k = `${d.scope}|||${d.category}|||${d.activity}|||${d.year}`;
          dMap.set(k, (dMap.get(k) ?? 0) + d.emissions);
          if (!hierarchy.has(d.scope)) hierarchy.set(d.scope, new Map());
          const cm = hierarchy.get(d.scope)!;
          if (!cm.has(d.category)) cm.set(d.category, new Set());
          cm.get(d.category)!.add(d.activity);
        }
        const dScopes = Array.from(hierarchy.keys()).sort();

        function dVal(scope: string, category: string, activity: string, year: number): number {
          return dMap.get(`${scope}|||${category}|||${activity}|||${year}`) ?? 0;
        }
        function catTotal(scope: string, category: string, year: number): number {
          const acts = hierarchy.get(scope)?.get(category);
          if (!acts) return 0;
          return Array.from(acts).reduce((s, a) => s + dVal(scope, category, a, year), 0);
        }
        function scopeTotal(scope: string, year: number): number {
          const cats = hierarchy.get(scope);
          if (!cats) return 0;
          return Array.from(cats.keys()).reduce((s, c) => s + catTotal(scope, c, year), 0);
        }
        function grandTotal(year: number): number {
          return dScopes.reduce((s, sc) => s + scopeTotal(sc, year), 0);
        }

        return (
          <Card className="overflow-hidden p-0">
            <div className="border-b border-border px-5 py-3">
              <h3 className="text-sm font-semibold text-foreground">Year-over-Year Detailed Activity Breakdown</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left p-2 border text-xs font-medium text-gray-600 whitespace-nowrap">Scope</th>
                    <th className="text-left p-2 border text-xs font-medium text-gray-600 whitespace-nowrap">Category</th>
                    <th className="text-left p-2 border text-xs font-medium text-gray-600">Activity</th>
                    {displayYears.map(yr => (
                      <th key={yr} className={`text-right p-2 border text-xs font-medium whitespace-nowrap ${yr === benchmarkYear && showBenchmarkNote ? "text-gray-400" : "text-gray-600"}`}>
                        {yr}{yr === benchmarkYear && showBenchmarkNote ? " ★" : ""}
                      </th>
                    ))}
                    <th className="text-right p-2 border text-xs font-medium text-gray-600">Change vs Benchmark</th>
                  </tr>
                </thead>
                <tbody>
                  {dScopes.map(scope => {
                    const catMap = hierarchy.get(scope)!;
                    const cats = Array.from(catMap.keys()).sort();
                    const rows: React.ReactNode[] = [];
                    let scopeLabelShown = false;

                    cats.forEach(cat => {
                      const acts = Array.from(catMap.get(cat)!).sort();
                      let catLabelShown = false;

                      acts.forEach(act => {
                        rows.push(
                          <tr key={`${scope}|${cat}|${act}`} className="hover:bg-gray-50">
                            <td className="p-2 border text-gray-400 text-xs align-top whitespace-nowrap">
                              {!scopeLabelShown ? (scopeLabelShown = true, scope) : ""}
                            </td>
                            <td className="p-2 border text-gray-400 text-xs align-top whitespace-nowrap">
                              {!catLabelShown ? (catLabelShown = true, cat) : ""}
                            </td>
                            <td className="p-2 border text-xs">{act}</td>
                            {displayYears.map(yr => {
                              const v = dVal(scope, cat, act, yr);
                              return <td key={yr} className="text-right p-2 border text-xs tabular-nums">{v > 0 ? fmt(v) : "—"}</td>;
                            })}
                            <td className="text-right p-2 border text-xs">
                              {hasComparison ? <ChangeCell cur={dVal(scope, cat, act, latestYear)} prev={dVal(scope, cat, act, benchmarkYear)} /> : "—"}
                            </td>
                          </tr>
                        );
                      });

                      // Category subtotal (only when >1 activity)
                      if (acts.length > 1) {
                        rows.push(
                          <tr key={`${scope}|${cat}|__sub`} className="bg-gray-50">
                            <td className="p-2 border text-xs" />
                            <td className="p-2 border text-xs font-semibold italic text-gray-500" colSpan={2}>{cat} — Subtotal</td>
                            {displayYears.map(yr => {
                              const v = catTotal(scope, cat, yr);
                              return <td key={yr} className="text-right p-2 border text-xs tabular-nums font-semibold">{v > 0 ? fmt(v) : "—"}</td>;
                            })}
                            <td className="text-right p-2 border text-xs font-semibold">
                              {hasComparison ? <ChangeCell cur={catTotal(scope, cat, latestYear)} prev={catTotal(scope, cat, benchmarkYear)} /> : "—"}
                            </td>
                          </tr>
                        );
                      }
                    });

                    // Scope subtotal
                    rows.push(
                      <tr key={`${scope}|__scopesub`} className="bg-gray-100">
                        <td className="p-2 border text-xs font-bold" colSpan={3}>{scope} Subtotal</td>
                        {displayYears.map(yr => {
                          const v = scopeTotal(scope, yr);
                          return <td key={yr} className="text-right p-2 border text-xs tabular-nums font-bold">{v > 0 ? fmt(v) : "—"}</td>;
                        })}
                        <td className="text-right p-2 border text-xs font-bold">
                          {hasComparison ? <ChangeCell cur={scopeTotal(scope, latestYear)} prev={scopeTotal(scope, benchmarkYear)} /> : "—"}
                        </td>
                      </tr>
                    );

                    return rows;
                  })}

                  {/* Grand total */}
                  <tr className="bg-gray-200">
                    <td className="p-2 border text-xs font-bold" colSpan={3}>Total</td>
                    {displayYears.map(yr => {
                      const v = grandTotal(yr);
                      return <td key={yr} className="text-right p-2 border text-xs tabular-nums font-bold">{v > 0 ? fmt(v) : "—"}</td>;
                    })}
                    <td className="text-right p-2 border text-xs font-bold">
                      {hasComparison ? <ChangeCell cur={grandTotal(latestYear)} prev={grandTotal(benchmarkYear)} /> : "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            {showBenchmarkNote && <p className="px-4 pb-3 text-xs text-muted-foreground">★ Benchmark year</p>}
          </Card>
        );
      })()}
    </div>
  );
}
