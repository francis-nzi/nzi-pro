"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell,
  Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { apiFetch } from "@/lib/auth";
import { formatEmissions } from "@/lib/format";

// ── Types ────────────────────────────────────────────────────────────────────

type YearlyEmission = { year: number; scope1: number; scope2: number; scope3: number; total: number };
type TopCategory = { category: string; emissions: number; percentage: number };
type IntensityMetric = { key: string; label: string; value: number; divider: number; intensity: number };
type YearlyIntensityEntry = { year: number; metrics: IntensityMetric[] };

type InsightsMetrics = {
  selected_year: number | null;
  available_years: number[];
  current_metrics: {
    scope1: number;
    scope2: number;
    scope3: number;
    total_emissions: number;
    year: number | null;
  };
  yearly_emissions: YearlyEmission[];
  top_categories: TopCategory[];
  yearly_top_categories?: Array<{ year: number; categories: TopCategory[] }>;
  intensity_metrics: IntensityMetric[];
  yearly_intensity_metrics: YearlyIntensityEntry[];
  benchmark_metrics?: { benchmark_year: number | null; total: number | null } | null;
  net_zero_progress?: { net_zero_year: number; years_to_target: number } | null;
};

type SubNavKey = "charts" | "industry" | "knowledge";

// ── Colours ──────────────────────────────────────────────────────────────────

const SCOPE1_COLOR = "#15803d";
const SCOPE2_COLOR = "#22c55e";
const SCOPE3_COLOR = "#86efac";
const ORANGE = "#F26624";
const CAT_COLORS = ["#F26624", "#fb923c", "#fdba74", "#fbbf24", "#34d399", "#22d3ee", "#818cf8", "#c084fc", "#f472b6", "#94a3b8"];
const LINE_COLORS = [ORANGE, SCOPE1_COLOR, SCOPE2_COLOR, "#818cf8", "#c084fc"];

// ── PNG download ─────────────────────────────────────────────────────────────

async function downloadChartAsPng(
  containerRef: React.RefObject<HTMLDivElement>,
  filename: string,
): Promise<void> {
  const container = containerRef.current;
  if (!container) return;
  const svg = container.querySelector("svg");
  if (!svg) return;

  const rect = svg.getBoundingClientRect();
  const width = rect.width || 800;
  const height = rect.height || 400;

  const clone = svg.cloneNode(true) as SVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));

  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", "white");
  clone.insertBefore(bg, clone.firstChild);

  const svgStr = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  return new Promise<void>((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const scale = 2;
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext("2d")!;
      ctx.scale(scale, scale);
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob((pngBlob) => {
        if (!pngBlob) { resolve(); return; }
        const a = document.createElement("a");
        a.href = URL.createObjectURL(pngBlob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
        resolve();
      }, "image/png");
    };
    img.onerror = () => resolve();
    img.src = url;
  });
}

// ── Chart card wrapper ────────────────────────────────────────────────────────

function ChartCard({
  title,
  subtitle,
  chartRef,
  filename,
  children,
}: {
  title: string;
  subtitle?: string;
  chartRef: React.RefObject<HTMLDivElement>;
  filename: string;
  children: React.ReactNode;
}) {
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    setDownloading(true);
    await downloadChartAsPng(chartRef, filename);
    setDownloading(false);
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-gray-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>}
        </div>
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="shrink-0 rounded border border-gray-200 px-2.5 py-1 text-xs text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700 disabled:opacity-50"
        >
          {downloading ? "Saving…" : "↓ PNG"}
        </button>
      </div>
      <div ref={chartRef}>
        {children}
      </div>
    </div>
  );
}

// ── Scope donut ───────────────────────────────────────────────────────────────

function ScopeDonut({
  metrics,
  year,
}: {
  metrics: InsightsMetrics["current_metrics"];
  year: number | null;
}) {
  const data = [
    { name: "Scope 1", value: Number(metrics.scope1 || 0) },
    { name: "Scope 2", value: Number(metrics.scope2 || 0) },
    { name: "Scope 3", value: Number(metrics.scope3 || 0) },
  ].filter((d) => d.value > 0);

  const total = Number(metrics.total_emissions || 0);
  const scopeColors = [SCOPE1_COLOR, SCOPE2_COLOR, SCOPE3_COLOR];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CentreLabel = ({ viewBox }: any) => {
    const cx = viewBox?.cx ?? 0;
    const cy = viewBox?.cy ?? 0;
    return (
      <>
        <text x={cx} y={cy - 8} textAnchor="middle" style={{ fontSize: 18, fontWeight: 700, fill: "#111827" }}>
          {formatEmissions(total)}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" style={{ fontSize: 11, fill: "#6b7280" }}>
          tCO₂e{year ? ` (${year})` : ""}
        </text>
      </>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius="52%"
          outerRadius="76%"
          paddingAngle={2}
          dataKey="value"
          labelLine={false}
          label={<CentreLabel />}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={scopeColors[i % scopeColors.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(v: number) => [`${formatEmissions(v)} tCO₂e`, ""]}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(value: string, entry: any) => (
            <span style={{ fontSize: 12, color: "#4b5563" }}>
              {value}: {formatEmissions(entry.payload?.value ?? 0)} tCO₂e
            </span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ── Category bar (horizontal) ─────────────────────────────────────────────────

function CategoryBar({
  categories,
}: {
  categories: TopCategory[];
}) {
  const data = [...categories]
    .sort((a, b) => b.emissions - a.emissions)
    .slice(0, 10)
    .map((c) => ({ name: c.category, emissions: Number(c.emissions || 0) }));

  const chartHeight = Math.max(180, data.length * 38 + 40);

  return (
    <ResponsiveContainer width="100%" height={chartHeight}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 60, bottom: 0, left: 130 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={(v: number) => formatEmissions(v)}
          tick={{ fontSize: 11 }}
        />
        <YAxis type="category" dataKey="name" width={125} tick={{ fontSize: 11 }} />
        <Tooltip
          formatter={(v: number) => [`${formatEmissions(v)} tCO₂e`, "Emissions"]}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
        />
        <Bar dataKey="emissions" radius={[0, 4, 4, 0]} maxBarSize={26}>
          {data.map((_, i) => (
            <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Historical stacked bar ────────────────────────────────────────────────────

function HistoricalBar({ yearlyEmissions }: { yearlyEmissions: YearlyEmission[] }) {
  const data = [...yearlyEmissions]
    .filter((x) => x.year != null)
    .sort((a, b) => Number(a.year) - Number(b.year))
    .map((x) => ({
      year: String(x.year),
      "Scope 1": Number(x.scope1 || 0),
      "Scope 2": Number(x.scope2 || 0),
      "Scope 3": Number(x.scope3 || 0),
    }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 4, right: 20, bottom: 0, left: 20 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="year" tick={{ fontSize: 12 }} />
        <YAxis
          tickFormatter={(v: number) => formatEmissions(v)}
          tick={{ fontSize: 11 }}
        />
        <Tooltip
          formatter={(v: number, name: string) => [`${formatEmissions(v)} tCO₂e`, name]}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
        />
        <Legend iconType="circle" iconSize={8} />
        <Bar dataKey="Scope 1" stackId="a" fill={SCOPE1_COLOR} />
        <Bar dataKey="Scope 2" stackId="a" fill={SCOPE2_COLOR} />
        <Bar dataKey="Scope 3" stackId="a" fill={SCOPE3_COLOR} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Intensity line chart ──────────────────────────────────────────────────────

function IntensityLine({ yearlyIntensity }: { yearlyIntensity: YearlyIntensityEntry[] }) {
  const metricKeys = new Map<string, string>();
  for (const entry of yearlyIntensity) {
    for (const m of entry.metrics) {
      if (!metricKeys.has(m.key)) metricKeys.set(m.key, m.label || m.key);
    }
  }
  const keyList = Array.from(metricKeys.entries());
  if (keyList.length === 0) return null;

  const data = [...yearlyIntensity]
    .filter((x) => x.year != null)
    .sort((a, b) => Number(a.year) - Number(b.year))
    .map((entry) => {
      const row: Record<string, string | number> = { year: String(entry.year) };
      for (const [key] of keyList) {
        const m = entry.metrics.find((m) => m.key === key);
        if (m != null) row[key] = Number(m.intensity || 0);
      }
      return row;
    });

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 4, right: 20, bottom: 0, left: 20 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="year" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
        />
        <Legend iconType="circle" iconSize={8} />
        {keyList.map(([key, label], i) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            name={label}
            stroke={LINE_COLORS[i % LINE_COLORS.length]}
            strokeWidth={2}
            dot={{ r: 4 }}
            activeDot={{ r: 6 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Placeholder section ───────────────────────────────────────────────────────

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 p-16 text-center">
      <p className="text-sm font-medium text-gray-500">{title}</p>
      <p className="mt-1 text-xs text-gray-400">This section is coming soon.</p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PortalInsights() {
  const [subNav, setSubNav] = useState<SubNavKey>("charts");
  const [metrics, setMetrics] = useState<InsightsMetrics | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [yearLoading, setYearLoading] = useState(false);

  const scopeRef = useRef<HTMLDivElement>(null);
  const categoryRef = useRef<HTMLDivElement>(null);
  const historicalRef = useRef<HTMLDivElement>(null);
  const intensityRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiFetch("/portal/metrics")
      .then((r) => {
        if (!r.ok) return r.text().then((t) => Promise.reject(new Error(`${r.status}: ${t}`)));
        return r.json() as Promise<InsightsMetrics>;
      })
      .then((d) => {
        setMetrics(d);
        if (d.selected_year) setSelectedYear(d.selected_year);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const loadYear = useCallback(async (year: number) => {
    setYearLoading(true);
    try {
      const r = await apiFetch(`/portal/metrics?year=${year}`);
      if (!r.ok) throw new Error(`${r.status}`);
      const d = (await r.json()) as InsightsMetrics;
      setMetrics(d);
      setSelectedYear(year);
    } catch {
      // keep existing data on error
    } finally {
      setYearLoading(false);
    }
  }, []);

  const topCats = (() => {
    if (!metrics) return [] as TopCategory[];
    if (selectedYear && metrics.yearly_top_categories) {
      const yd = metrics.yearly_top_categories.find((y) => y.year === selectedYear);
      if (yd) return yd.categories;
    }
    return metrics.top_categories ?? [];
  })();

  const hasIntensityData = metrics?.yearly_intensity_metrics?.some((e) => e.metrics.length > 0) ?? false;
  const displayYear = selectedYear ?? metrics?.current_metrics?.year ?? null;

  const subNavItems: { key: SubNavKey; label: string }[] = [
    { key: "charts", label: "Charts & Graphs" },
    { key: "industry", label: "Industry" },
    { key: "knowledge", label: "Knowledge Base" },
  ];

  return (
    <div className="space-y-4">
      {/* Sub-nav */}
      <div className="flex border-b border-gray-200">
        {subNavItems.map((item) => (
          <button
            key={item.key}
            onClick={() => setSubNav(item.key)}
            className={`px-5 py-2.5 text-sm font-medium transition-colors ${
              subNav === item.key
                ? "border-b-2 border-orange-500 text-orange-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Charts & Graphs */}
      {subNav === "charts" && (
        <div className="space-y-6 pt-2">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Failed to load insights data: {error}
            </div>
          )}

          {/* Year selector */}
          {(metrics?.available_years?.length ?? 0) > 0 && (
            <div className="flex items-center justify-end gap-2">
              <span className="text-sm text-gray-500">Reporting Year:</span>
              <select
                value={selectedYear ?? ""}
                disabled={yearLoading}
                onChange={(e) => void loadYear(Number(e.target.value))}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              >
                {metrics!.available_years.map((yr) => (
                  <option key={yr} value={yr}>{yr}</option>
                ))}
              </select>
            </div>
          )}

          {loading ? (
            <div className="rounded-xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-400 shadow-sm">
              Loading charts…
            </div>
          ) : !metrics ? null : (
            <>
              {/* Row 1: Scope donut + Category bar */}
              <div className="grid gap-6 lg:grid-cols-2">
                <ChartCard
                  title="Scope Breakdown"
                  subtitle={displayYear ? `Emissions by scope — ${displayYear}` : "Emissions by scope"}
                  chartRef={scopeRef}
                  filename={`scope-breakdown${displayYear ? `-${displayYear}` : ""}.png`}
                >
                  <ScopeDonut metrics={metrics.current_metrics} year={displayYear} />
                </ChartCard>

                <ChartCard
                  title="Emissions by Category"
                  subtitle={displayYear ? `Top emissions sources — ${displayYear}` : "Top emissions sources"}
                  chartRef={categoryRef}
                  filename={`emissions-by-category${displayYear ? `-${displayYear}` : ""}.png`}
                >
                  {topCats.length > 0 ? (
                    <CategoryBar categories={topCats} />
                  ) : (
                    <div className="py-10 text-center text-sm text-gray-400">No category data available.</div>
                  )}
                </ChartCard>
              </div>

              {/* Row 2: Historical trend */}
              {(metrics.yearly_emissions?.length ?? 0) > 1 && (
                <ChartCard
                  title="Historical Emissions"
                  subtitle="Scope breakdown across all reporting years"
                  chartRef={historicalRef}
                  filename="historical-emissions.png"
                >
                  <HistoricalBar yearlyEmissions={metrics.yearly_emissions} />
                </ChartCard>
              )}

              {/* Row 3: Intensity metrics */}
              {hasIntensityData && (
                <ChartCard
                  title="Intensity Metrics Over Time"
                  subtitle="Emissions intensity normalised by key business drivers"
                  chartRef={intensityRef}
                  filename="intensity-metrics.png"
                >
                  <IntensityLine yearlyIntensity={metrics.yearly_intensity_metrics} />
                </ChartCard>
              )}
            </>
          )}
        </div>
      )}

      {/* Placeholder sub-sections */}
      {subNav === "industry" && (
        <div className="pt-2">
          <ComingSoon title="Industry Benchmarking" />
        </div>
      )}
      {subNav === "knowledge" && (
        <div className="pt-2">
          <ComingSoon title="Knowledge Base" />
        </div>
      )}
    </div>
  );
}
