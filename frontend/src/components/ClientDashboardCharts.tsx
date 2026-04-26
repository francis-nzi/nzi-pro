"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";

const SCOPE_COLORS = ["#0f766e", "#0891b2", "#38bdf8"];

type ScopeDatum = {
  name: string;
  value: number;
};

type TrendDatum = {
  year: string;
  total: number;
  scope1: number;
  scope2: number;
  scope3: number;
};

type TopCategoryDatum = {
  category: string;
  emissions: number;
  percentage: number;
};

type ClientDashboardChartsProps = {
  scopeData: ScopeDatum[];
  total: number;
  trendData: TrendDatum[];
  topCategoryData: TopCategoryDatum[];
  view: "overview" | "trends";
};

function formatTco2e(value: number | string | undefined): string {
  return `${Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} tCO₂e`;
}

export default function ClientDashboardCharts({
  scopeData,
  total,
  trendData,
  topCategoryData,
  view,
}: ClientDashboardChartsProps) {
  return (
    <div className="space-y-6">
      {view === "overview" ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
            <div className="relative mx-auto w-full max-w-[520px]">
              <ResponsiveContainer width="100%" aspect={1}>
                <PieChart>
                  <Pie data={scopeData} dataKey="value" nameKey="name" innerRadius="77%" outerRadius="96%" paddingAngle={2}>
                    {scopeData.map((_, idx) => (
                      <Cell key={idx} fill={SCOPE_COLORS[idx % SCOPE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(val: number | string | undefined) => formatTco2e(val)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="text-center leading-none">
                  <div className="whitespace-nowrap text-[clamp(1rem,3.2vw,2.2rem)] font-semibold">
                    {total.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                  </div>
                  <div className="mt-2 text-[11px] text-muted-foreground">tCO₂e total</div>
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
                    {scopeData.reduce((acc, s) => acc + (total > 0 ? (s.value / total) * 100 : 0), 0).toFixed(1)}
                    %
                  </span>
                </div>
              </div>

              <div className="mt-4 border-t pt-3">
                <div className="mb-2 text-xs font-semibold text-muted-foreground">tCO₂e by Scope</div>
                {scopeData.map((s, idx) => (
                  <div key={`${s.name}-tco2e`} className="flex items-center justify-between gap-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SCOPE_COLORS[idx % SCOPE_COLORS.length] }} />
                      <span>{s.name}</span>
                    </div>
                    <span className="font-medium">{Number(s.value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
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

          <div className="h-[320px]">
            {topCategoryData.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">No category data available</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topCategoryData} layout="vertical" margin={{ top: 4, right: 10, left: 24, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="category" width={140} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(val: number | string | undefined) => formatTco2e(val)} />
                  <Bar dataKey="emissions" radius={[0, 4, 4, 0]} fill="#0ea5e9" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      ) : (
        <div className="h-[320px]">
          {trendData.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No trend data available</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 5, right: 20, left: 6, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis />
                <Tooltip formatter={(val: number | string | undefined) => formatTco2e(val)} />
                <Legend />
                <Line type="monotone" dataKey="total" stroke="#0f766e" strokeWidth={3} dot={{ r: 4 }} name="Total" />
                <Line type="monotone" dataKey="scope1" stroke="#0f766e" strokeOpacity={0.7} strokeWidth={1.5} dot={false} name="Scope 1" />
                <Line type="monotone" dataKey="scope2" stroke="#0891b2" strokeWidth={1.5} dot={false} name="Scope 2" />
                <Line type="monotone" dataKey="scope3" stroke="#38bdf8" strokeWidth={1.5} dot={false} name="Scope 3" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </div>
  );
}
