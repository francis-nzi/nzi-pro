"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/auth";

// ── Widget display config ────────────────────────────────────────────────────
// Defines the display order and human-readable titles for CRM widget IDs.
// Only widgets present in this list are shown; extras are ignored.

const WIDGET_DISPLAY: { id: string; title: string }[] = [
  { id: "EMISSIONS_SCOPE_DONUT",       title: "Emissions Summary by Scope" },
  { id: "EMISSIONS_SITE_DONUT",        title: "Emissions by Site" },
  { id: "EMISSIONS_BY_ACTIVITY",       title: "Emissions by Activity" },
  { id: "SCOPE_YEAR_ON_YEAR_BAR",      title: "Year-on-Year Comparison by Scope" },
  { id: "EMISSIONS_REDUCTION_PATHWAY", title: "Emissions Reduction Pathway" },
  { id: "INTENSITY_PATHWAY",           title: "Intensity Metrics Pathway" },
  { id: "HISTORICAL_EMISSIONS_TREND",  title: "Historical Emissions Trend" },
  { id: "MONTHLY_TREND",               title: "Monthly Emissions Trend" },
];

// ── Types ────────────────────────────────────────────────────────────────────

type WidgetPngsResponse = {
  ok: boolean;
  year: number | null;
  job_id: number | null;
  available_years: number[];
  pngs: Record<string, string>;
  captured_at: string | null;
};

type SubNavKey = "charts" | "industry" | "knowledge";

// ── Helpers ──────────────────────────────────────────────────────────────────

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

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
  const [data, setData] = useState<WidgetPngsResponse | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [yearLoading, setYearLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchCharts = useCallback(async (year?: number) => {
    const url = year
      ? `/portal/insights/widget-pngs?year=${year}`
      : "/portal/insights/widget-pngs";
    const r = await apiFetch(url);
    if (!r.ok) throw new Error(`${r.status}`);
    const d = (await r.json()) as WidgetPngsResponse;
    setData(d);
    if (d.year) setSelectedYear(d.year);
  }, []);

  useEffect(() => {
    fetchCharts()
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [fetchCharts]);

  const handleYearChange = useCallback(
    async (year: number) => {
      setYearLoading(true);
      try {
        await fetchCharts(year);
      } catch {
        // keep existing data on error
      } finally {
        setYearLoading(false);
      }
    },
    [fetchCharts],
  );

  const pngs = data?.pngs ?? {};
  const availableYears = data?.available_years ?? [];
  const visibleWidgets = WIDGET_DISPLAY.filter((w) => pngs[w.id]);

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
              Failed to load charts: {error}
            </div>
          )}

          {/* Year selector */}
          {availableYears.length > 0 && (
            <div className="flex items-center justify-end gap-2">
              <span className="text-sm text-gray-500">Reporting Year:</span>
              <select
                value={selectedYear ?? ""}
                disabled={yearLoading}
                onChange={(e) => void handleYearChange(Number(e.target.value))}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              >
                {availableYears.map((yr) => (
                  <option key={yr} value={yr}>{yr}</option>
                ))}
              </select>
            </div>
          )}

          {loading ? (
            <div className="rounded-xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-400 shadow-sm">
              Loading charts…
            </div>
          ) : visibleWidgets.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center">
              <p className="text-sm font-medium text-gray-500">
                No charts available{selectedYear ? ` for ${selectedYear}` : ""}
              </p>
              <p className="mt-1 text-xs text-gray-400">
                Charts are generated when your NZI consultant reviews the Insights section.
                Please contact them if you expect to see charts here.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {visibleWidgets.map(({ id, title }) => {
                const pngData = pngs[id];
                const safeTitle = title.toLowerCase().replace(/\s+/g, "-");
                const filename = `${safeTitle}${selectedYear ? `-${selectedYear}` : ""}.png`;
                return (
                  <div
                    key={id}
                    className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
                  >
                    <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
                      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
                      <button
                        onClick={() => downloadDataUrl(pngData, filename)}
                        className="rounded border border-gray-200 px-2.5 py-1 text-xs text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700"
                      >
                        ↓ PNG
                      </button>
                    </div>
                    <div className="p-4">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={pngData}
                        alt={title}
                        className="w-full rounded"
                        style={{ maxWidth: "100%", height: "auto" }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
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
