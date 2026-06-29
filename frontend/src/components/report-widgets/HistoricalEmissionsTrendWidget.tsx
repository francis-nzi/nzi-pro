"use client";

import { useEffect, useRef } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";

import { REPORT_WIDGET_IDS } from "./registry";
import { registerWidgetPngExporter } from "./export-registry";
import { buildPngFilename, downloadChartAsPng, findLargestSvg, renderChartAsPngDataUrl } from "./png-export";
import type { HistoricalEmissionsPoint } from "./types";

type HistoricalEmissionsTrendWidgetProps = {
  title: string;
  subtitle?: string;
  clientName?: string | null;
  data: HistoricalEmissionsPoint[];
  widgetKey?: string;
  showWidgetRef?: boolean;
  showPng?: boolean;
  presentation?: "card" | "image";
  storedPngUrl?: string | null;
  className?: string;
};

const SCOPE_COLORS = {
  "Scope 1": "#0f766e",
  "Scope 2": "#0891b2",
  "Scope 3": "#38bdf8",
} as const;

export function HistoricalEmissionsTrendWidget({
  title,
  subtitle,
  clientName,
  data,
  widgetKey = REPORT_WIDGET_IDS.historicalEmissionsTrend,
  showWidgetRef = true,
  showPng = true,
  presentation = "card",
  storedPngUrl,
  className,
}: HistoricalEmissionsTrendWidgetProps) {
  const chartWrapRef = useRef<HTMLDivElement | null>(null);

  const exportPngDataUrl = async () => {
    const svg = findLargestSvg(chartWrapRef.current);
    if (!svg) return "";
    return renderChartAsPngDataUrl({
      svg,
      title,
      subtitle,
      legendItems: [
        { label: "Scope 1", color: SCOPE_COLORS["Scope 1"] },
        { label: "Scope 2", color: SCOPE_COLORS["Scope 2"] },
        { label: "Scope 3", color: SCOPE_COLORS["Scope 3"] },
      ],
      canvasWidth: 960,
    });
  };

  useEffect(() => {
    if (!widgetKey || storedPngUrl) return;
    return registerWidgetPngExporter(widgetKey, exportPngDataUrl);
  }, [exportPngDataUrl, widgetKey, storedPngUrl]);

  const downloadPng = async () => {
    const svg = findLargestSvg(chartWrapRef.current);
    if (!svg) return;
    await downloadChartAsPng({
      svg,
      filename: buildPngFilename(title, clientName),
      title,
      subtitle,
      legendItems: [
        { label: "Scope 1", color: SCOPE_COLORS["Scope 1"] },
        { label: "Scope 2", color: SCOPE_COLORS["Scope 2"] },
        { label: "Scope 3", color: SCOPE_COLORS["Scope 3"] },
      ],
      canvasWidth: 960,
    });
  };

  if (data.length === 0) {
    return (
      <Card className={className} data-widget-key={widgetKey}>
        <CardHeader className="space-y-1">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle>{title}</CardTitle>
              {subtitle ? <div className="text-xs uppercase tracking-[0.28em] text-muted-foreground">{subtitle}</div> : null}
            </div>
            <div className="flex items-center gap-2 print:hidden">
              {showPng ? (
                <Button variant="outline" size="sm" onClick={() => void downloadPng()} disabled>
                  <Download className="mr-2 h-4 w-4" />
                  PNG
                </Button>
              ) : null}
              {showWidgetRef ? (
                <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
                  <span className="block text-right">Widget ref</span>
                  <span className="block font-mono tracking-[0.18em] text-foreground">{widgetKey}</span>
                </div>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-muted-foreground">
            No historical emissions data available.
          </div>
        </CardContent>
      </Card>
    );
  }

  if (presentation === "image" && storedPngUrl) {
    return (
      <div className={className} data-widget-key={widgetKey}>
        <img
          src={storedPngUrl}
          alt={title}
          className="mx-auto block max-w-full h-auto object-contain"
          style={{ width: "100%" }}
        />
      </div>
    );
  }

  return (
    <Card className={className} data-widget-key={widgetKey}>
      <CardHeader className="space-y-1">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>{title}</CardTitle>
            {subtitle ? <div className="text-xs uppercase tracking-[0.28em] text-muted-foreground">{subtitle}</div> : null}
          </div>
          <div className="flex items-center gap-2">
            {showPng ? (
              <Button variant="outline" size="sm" onClick={() => void downloadPng()}>
                <Download className="mr-2 h-4 w-4" />
                PNG
              </Button>
            ) : null}
            {showWidgetRef ? (
              <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
                <span className="block text-right">Widget ref</span>
                <span className="block font-mono tracking-[0.18em] text-foreground">{widgetKey}</span>
              </div>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]" ref={chartWrapRef}>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data} margin={{ top: 22, right: 24, left: 8, bottom: 8 }} barCategoryGap="35%">
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" vertical={false} />
              <XAxis
                dataKey="year"
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                padding={{ left: 60, right: 60 }}
              />
              <YAxis
                tickFormatter={(v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                tick={{ fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={52}
                label={{ value: "tCO₂e", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 10, fill: "#94a3b8", textAnchor: "middle" } }}
              />
              <Tooltip
                formatter={(v: number | undefined, name: string | undefined) => [
                  v != null ? `${formatNumber(v, 0)} tCO₂e` : "—",
                  name ?? "",
                ]}
                labelFormatter={(label: unknown) => `Year: ${label}`}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="scope1" name="Scope 1" stackId="a" fill={SCOPE_COLORS["Scope 1"]} />
              <Bar dataKey="scope2" name="Scope 2" stackId="a" fill={SCOPE_COLORS["Scope 2"]} />
              <Bar dataKey="scope3" name="Scope 3" stackId="a" fill={SCOPE_COLORS["Scope 3"]} radius={[3, 3, 0, 0]}>
                <LabelList
                  dataKey="total"
                  position="top"
                  formatter={(v: unknown) => (typeof v === "number" ? formatNumber(v, 0) : "")}
                  style={{ fontSize: 11, fill: "#6b7280" }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
