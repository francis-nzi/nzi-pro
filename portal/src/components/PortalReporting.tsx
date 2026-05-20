"use client";

import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { apiFetch } from "@/lib/auth";

type ScopeCategoryData = { [scope: string]: { [category: string]: number } };

type ReportingData = {
  years: number[];
  by_scope: Array<{ year: number; [key: string]: number | string }>;
  by_scope_category: Array<{ year: number; scopes: ScopeCategoryData }>;
  by_activity: Array<{ year: number; [key: string]: number | string }>;
  by_site: Array<{ year: number; [key: string]: number | string }>;
};

const SCOPE_COLORS = ["#15803d", "#22c55e", "#4ade80", "#86efac", "#bbf7d0"];

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
  if (pct === null) return <span className="text-gray-400">—</span>;
  const color = pct > 0 ? "text-red-600" : pct < 0 ? "text-green-600" : "text-gray-600";
  return <span className={color}>{pct > 0 ? "+" : ""}{pct.toFixed(1)}%</span>;
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

  if (loading) return <div className="py-12 text-center text-sm text-gray-400">Loading reporting data…</div>;
  if (error) return <div className="py-8 text-center text-sm text-red-600">{error}</div>;
  if (!data || data.years.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-400">
        No reporting data available yet.
      </div>
    );
  }

  const { years, by_scope, by_scope_category, by_activity, by_site } = data;
  const latestYear = years[years.length - 1];
  const benchmarkYear = years[0];
  const displayYears = Array.from(new Set([benchmarkYear, ...years.slice(-4)]));
  const prevYear = years.length >= 2 ? years[years.length - 2] : null;
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
        <th className="text-right p-2 border text-xs font-medium text-gray-600">Change</th>
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
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="text-xs text-gray-500 uppercase tracking-wide font-medium">Total Emissions ({latestYear})</div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{fmt(getVal(by_scope, latestYear, "total"))} tCO₂e</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="text-xs text-gray-500 uppercase tracking-wide font-medium">Year-over-Year Change</div>
          <div className="mt-2 text-2xl font-bold">
            {prevYear ? (() => {
              const pct = yoyPct(getVal(by_scope, latestYear, "total"), getVal(by_scope, prevYear, "total"));
              if (pct === null) return <span>—</span>;
              return <span className={pct > 0 ? "text-red-600" : "text-green-600"}>{pct > 0 ? "+" : ""}{pct.toFixed(1)}%</span>;
            })() : <span>—</span>}
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="text-xs text-gray-500 uppercase tracking-wide font-medium">Years of Data</div>
          <div className="mt-2 text-2xl font-bold">{years.length}</div>
          <div className="mt-0.5 text-xs text-gray-400">{years[0]} – {latestYear}</div>
        </div>
      </div>

      {/* Overview chart */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="text-sm font-semibold text-gray-700 mb-4">Total Emissions by Year (tCO₂e)</div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="year" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
            <Tooltip formatter={(v: string | number | undefined) => [`${fmt(Number(v ?? 0))} tCO₂e`]} />
            <Legend />
            {sortedScopes.map((s, i) => (
              <Bar key={s} dataKey={s} stackId="a" fill={SCOPE_COLORS[i % SCOPE_COLORS.length]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Detail tables */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-200">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-5 py-2.5 text-sm font-medium transition-colors ${activeTab === tab.key ? "border-b-2 border-orange-500 text-orange-600" : "text-gray-500 hover:text-gray-700"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

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
                            {prevYear ? <ChangeCell cur={getScopeCatVal(latestYear, scope, cat)} prev={getScopeCatVal(prevYear, scope, cat)} /> : "—"}
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
                          {prevYear ? <ChangeCell cur={getVal(by_scope, latestYear, scope)} prev={getVal(by_scope, prevYear, scope)} /> : "—"}
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
                    {prevYear ? <ChangeCell cur={getVal(by_scope, latestYear, "total")} prev={getVal(by_scope, prevYear, "total")} /> : "—"}
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
                        {prevYear ? <ChangeCell cur={getVal(by_activity, latestYear, cat)} prev={getVal(by_activity, prevYear, cat)} /> : "—"}
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
                      {prevYear ? <ChangeCell cur={getVal(by_activity, latestYear, "total")} prev={getVal(by_activity, prevYear, "total")} /> : "—"}
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
                        {prevYear ? <ChangeCell cur={getVal(by_site, latestYear, site)} prev={getVal(by_site, prevYear, site)} /> : "—"}
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
                      {prevYear ? <ChangeCell cur={getVal(by_site, latestYear, "total")} prev={getVal(by_site, prevYear, "total")} /> : "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
            );
          })()}
        </div>

        {showBenchmarkNote && <p className="px-4 pb-3 text-xs text-gray-400">★ Benchmark year</p>}
      </div>
    </div>
  );
}
