"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyStatePanel, ErrorPanel, SkeletonLoader } from "@/components/shared/DataStates";

// ── Widget display config ────────────────────────────────────────────────────
// Defines the display order and human-readable titles for CRM widget IDs.
// Only widgets present in this list are shown; extras are ignored.

const WIDGET_DISPLAY: { id: string; title: string }[] = [
  { id: "emissions_scope_donut",       title: "Emissions Summary by Scope" },
  { id: "emissions_site_donut",        title: "Emissions by Site" },
  { id: "emissions_by_activity",       title: "Emissions by Activity" },
  { id: "scope_year_on_year_bar",      title: "Year-on-Year Comparison by Scope" },
  { id: "emissions_reduction_pathway", title: "Emissions Reduction Pathway" },
  { id: "intensity_pathway",           title: "Intensity Metrics Pathway" },
  { id: "historical_emissions_trend",  title: "Historical Emissions Trend" },
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
      <Tabs value={subNav} onValueChange={(v) => setSubNav(v as SubNavKey)}>
        <TabsList className="h-auto w-full justify-start rounded-none border-b border-border bg-transparent p-0">
          {subNavItems.map((item) => (
            <TabsTrigger
              key={item.key}
              value={item.key}
              className="rounded-none border-b-2 border-transparent px-5 py-2.5 data-[state=active]:border-brand data-[state=active]:bg-transparent data-[state=active]:text-brand data-[state=active]:shadow-none"
            >
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Charts & Graphs */}
      {subNav === "charts" && (
        <div className="space-y-6 pt-2">
          {error && <ErrorPanel description={`Failed to load charts: ${error}`} />}

          {/* Year selector */}
          {availableYears.length > 0 && (
            <div className="flex items-center justify-end gap-2">
              <span className="text-sm text-muted-foreground">Reporting Year:</span>
              <Select
                value={selectedYear != null ? String(selectedYear) : undefined}
                disabled={yearLoading}
                onValueChange={(v) => void handleYearChange(Number(v))}
              >
                <SelectTrigger className="h-8 w-auto min-w-[6rem] text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableYears.map((yr) => (
                    <SelectItem key={yr} value={String(yr)}>{yr}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {loading ? (
            <SkeletonLoader rows={5} />
          ) : visibleWidgets.length === 0 ? (
            <EmptyStatePanel
              title={`No charts available${selectedYear ? ` for ${selectedYear}` : ""}`}
              description="Charts are generated when your NZI consultant reviews the Insights section. Please contact them if you expect to see charts here."
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visibleWidgets.map(({ id, title }) => {
                const pngData = pngs[id];
                const safeTitle = title.toLowerCase().replace(/\s+/g, "-");
                const filename = `${safeTitle}${selectedYear ? `-${selectedYear}` : ""}.png`;
                return (
                  <Card key={id} className="overflow-hidden p-0">
                    <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-border px-5 py-3 pt-3">
                      <CardTitle className="text-sm">{title}</CardTitle>
                      <Button variant="outline" size="xs" onClick={() => downloadDataUrl(pngData, filename)}>
                        ↓ PNG
                      </Button>
                    </CardHeader>
                    <CardContent className="flex min-h-[18rem] items-center justify-center bg-muted/30 p-4">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={pngData}
                        alt={title}
                        className="h-full max-h-72 w-auto max-w-full rounded object-contain"
                        style={{ maxWidth: "100%" }}
                      />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Placeholder sub-sections */}
      {subNav === "industry" && (
        <div className="pt-2">
          <EmptyStatePanel title="Industry Benchmarking" description="This section is coming soon." />
        </div>
      )}
      {subNav === "knowledge" && (
        <div className="pt-2">
          <EmptyStatePanel title="Knowledge Base" description="This section is coming soon." />
        </div>
      )}
    </div>
  );
}
