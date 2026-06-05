"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Download } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { REPORT_WIDGET_IDS } from "./registry";
import { registerWidgetPngExporter } from "./export-registry";
import { buildPngFilename, downloadChartAsPng, findLargestSvg, renderChartAsPngDataUrl } from "./png-export";

export type IntensityPathwayPoint = {
  year: number;
  [key: string]: number | string | null | undefined;
};

export type IntensityPathwaySeries = {
  key: string;
  label: string;
  color: string;
};

function formatIntensityLabel(label: string): string {
  const normalized = label.trim().replace(/\s+/g, " ");
  if (/^employee$/i.test(normalized)) return "Employee";
  if (/^gbp\s+/i.test(normalized)) return `${normalized.replace(/^gbp\s+/i, "").trim()} GBP`;
  if (/^m2\s+/i.test(normalized)) return `${normalized.replace(/^m2\s+/i, "").trim()} m2`;
  return normalized;
}

type IntensityPathwayWidgetProps = {
  title: string;
  subtitle?: string;
  clientName?: string | null;
  data: IntensityPathwayPoint[];
  series: IntensityPathwaySeries[];
  benchmarkYear?: number | null;
  targetYear?: number | null;
  interimYear?: number | null;
  widgetKey?: string;
  showWidgetRef?: boolean;
  presentation?: "card" | "image";
  storedPngUrl?: string | null;
  className?: string;
  valueFormatter?: (value: number | null | undefined) => ReactNode;
};

export function IntensityPathwayWidget({
  title,
  subtitle,
  clientName,
  data,
  series,
  benchmarkYear,
  targetYear,
  interimYear,
  widgetKey = REPORT_WIDGET_IDS.intensityPathway,
  showWidgetRef = false,
  presentation = "card",
  storedPngUrl,
  className,
  valueFormatter = (value) => `${formatNumber(Number(value || 0), 3)} tCO₂e`,
}: IntensityPathwayWidgetProps) {
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const yearLookup = new Map<number, IntensityPathwayPoint>(data.map((point) => [Number(point.year), point]));

  const exportPngDataUrl = async () => {
    const svg = findLargestSvg(chartWrapRef.current);
    if (!svg) return "";
    return renderChartAsPngDataUrl({
      svg,
      title,
      subtitle,
      legendItems: series.map((entry) => ({
        label: formatIntensityLabel(entry.label),
        color: entry.color,
      })),
    });
  };

  useEffect(() => {
    if (!widgetKey) return;
    return registerWidgetPngExporter(widgetKey, exportPngDataUrl);
  }, [exportPngDataUrl, widgetKey]);

  const renderTooltip = (props: any) => {
    if (!props.active) return null;
    const year = Number(props.label);
    const point = yearLookup.get(year);
    if (!point) return null;

    return (
      <div className="rounded-md border bg-background px-3 py-2 shadow-sm">
        <div className="text-sm font-medium">Year: {year}</div>
        <div className="mt-2 space-y-1">
          {series.map((item) => {
            const actual = point[`${item.label}_actual`];
            const target = point[`${item.label}_target`];
            const value = typeof actual === "number" ? actual : typeof target === "number" ? target : null;
            const displayLabel = formatIntensityLabel(item.label);
            return (
              <div key={item.key} className="flex items-center justify-between gap-4 text-sm">
                <span>{displayLabel}</span>
                <span className="font-medium">{valueFormatter(value)}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const downloadPng = async () => {
    const svg = findLargestSvg(chartWrapRef.current);
    if (!svg) return;
    await downloadChartAsPng({
      svg,
      filename: buildPngFilename(title, clientName),
      title,
      legendItems: series.map((entry) => ({
        label: formatIntensityLabel(entry.label),
        color: entry.color,
      })),
    });
  };

  if (!data.length || !series.length) {
    return (
      <Card className={className}>
        <CardHeader className="space-y-1">
          <CardTitle>{title}</CardTitle>
          {subtitle ? <div className="text-xs uppercase tracking-[0.28em] text-muted-foreground">{subtitle}</div> : null}
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">No pathway data available.</div>
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
            <Button variant="outline" size="sm" onClick={() => void downloadPng()}>
              <Download className="mr-2 h-4 w-4" />
              PNG
            </Button>
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
        <div ref={chartWrapRef} className="h-[360px]">
          <ResponsiveContainer width="100%" height={360}>
            <LineChart data={data} margin={{ top: 5, right: 24, left: 6, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(2)} />
              <Tooltip content={renderTooltip} />
              <Legend iconType="circle" />
              {interimYear && interimYear > (benchmarkYear ?? 0) && (
                <ReferenceLine
                  x={interimYear}
                  stroke="#f59e0b"
                  strokeDasharray="3 3"
                  label={{ value: "Interim", position: "top", fill: "#f59e0b", fontSize: 10 }}
                />
              )}
              {targetYear && (
                <ReferenceLine
                  x={targetYear}
                  stroke="#16a34a"
                  strokeDasharray="3 3"
                  label={{ value: "Net Zero", position: "top", fill: "#16a34a", fontSize: 10 }}
                />
              )}
              {series.flatMap((entry) => [
                <Line
                  key={`${entry.key}_actual`}
                  type="monotone"
                  dataKey={`${entry.label}_actual`}
                  name={formatIntensityLabel(entry.label)}
                  stroke={entry.color}
                  strokeWidth={2.5}
                  dot={{ r: 4 }}
                  connectNulls={false}
                />,
                <Line
                  key={`${entry.key}_target`}
                  type="monotone"
                  dataKey={`${entry.label}_target`}
                  name={`${formatIntensityLabel(entry.label)} target`}
                  stroke={entry.color}
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                  dot={false}
                  legendType="none"
                />,
              ])}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
