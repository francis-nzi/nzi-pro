"use client";

import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend,
} from "recharts";
import { formatEmissions } from "@/lib/format";

const SCOPE_COLORS = ["#0f766e", "#0891b2", "#38bdf8", "#7dd3fc", "#bae6fd"];

type ScopeDatum = { name: string; value: number };
type TrendDatum = { year: string; total: number; scope1: number; scope2: number; scope3: number };
type TopCategoryDatum = { category: string; emissions: number; percentage: number };

type Props = {
  scopeData: ScopeDatum[];
  total: number;
  trendData: TrendDatum[];
  topCategoryData: TopCategoryDatum[];
  view: "overview" | "trends";
  year?: string | number | null;
};

export default function PortalDashboardCharts({ scopeData, total, trendData, topCategoryData, view, year }: Props) {
  if (view === "overview") {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
          <div className="relative mx-auto w-full max-w-[480px]">
            <ResponsiveContainer width="100%" aspect={1}>
              <PieChart>
                <Pie data={scopeData} dataKey="value" nameKey="name" innerRadius="77%" outerRadius="96%" paddingAngle={2}>
                  {scopeData.map((_, idx) => (
                    <Cell key={idx} fill={SCOPE_COLORS[idx % SCOPE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(val: number | string | undefined) => [`${formatEmissions(val)} tCO₂e`]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="text-center leading-none">
                <div className="whitespace-nowrap text-2xl font-semibold">{formatEmissions(total)}</div>
                <div className="mt-1 text-xs text-gray-500">tCO₂e total</div>
                {year != null && <div className="mt-1 text-xs text-gray-400">{year}</div>}
              </div>
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <div className="text-xs font-semibold text-gray-500 mb-3">% Share by Scope</div>
            {scopeData.map((s, idx) => {
              const pct = total > 0 ? (s.value / total) * 100 : 0;
              return (
                <div key={s.name} className="flex items-center justify-between gap-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: SCOPE_COLORS[idx % SCOPE_COLORS.length] }} />
                    <span>{s.name}</span>
                  </div>
                  <span className="font-medium tabular-nums">{pct.toFixed(1)}%</span>
                </div>
              );
            })}
            <div className="mt-4 border-t pt-3">
              <div className="text-xs font-semibold text-gray-500 mb-2">tCO₂e by Scope</div>
              {scopeData.map((s, idx) => (
                <div key={`${s.name}-t`} className="flex items-center justify-between gap-2 text-sm mt-1">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: SCOPE_COLORS[idx % SCOPE_COLORS.length] }} />
                    <span>{s.name}</span>
                  </div>
                  <span className="font-medium tabular-nums">{formatEmissions(s.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {topCategoryData.length > 0 ? (
          <div>
            <div className="text-xs font-semibold text-gray-500 mb-3">Top Emission Sources</div>
            <ResponsiveContainer width="100%" height={Math.max(200, topCategoryData.length * 36)}>
              <BarChart data={topCategoryData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="category" width={150} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(val: number | string | undefined) => [`${formatEmissions(val)} tCO₂e`]} />
                <Bar dataKey="emissions" radius={[0, 4, 4, 0]} fill="#0ea5e9" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="rounded-lg bg-gray-50 p-8 text-center text-sm text-gray-400">
            No category breakdown available for this year.
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {trendData.length === 0 ? (
        <div className="rounded-lg bg-gray-50 p-8 text-center text-sm text-gray-400">
          No trend data available yet. Multiple years of data are needed.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={trendData} margin={{ top: 5, right: 20, left: 6, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="year" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip formatter={(val: number | string | undefined) => [`${formatEmissions(val)} tCO₂e`]} />
            <Legend />
            <Line type="monotone" dataKey="total" stroke="#0f766e" strokeWidth={3} dot={{ r: 4 }} name="Total" />
            <Line type="monotone" dataKey="scope1" stroke="#0f766e" strokeOpacity={0.6} strokeWidth={1.5} dot={false} name="Scope 1" />
            <Line type="monotone" dataKey="scope2" stroke="#0891b2" strokeWidth={1.5} dot={false} name="Scope 2" />
            <Line type="monotone" dataKey="scope3" stroke="#38bdf8" strokeWidth={1.5} dot={false} name="Scope 3" />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
