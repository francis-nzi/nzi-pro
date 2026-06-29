"use client";

import { useEffect, useRef } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";

import { REPORT_WIDGET_IDS } from "./registry";
import { registerWidgetPngExporter } from "./export-registry";
import { buildPngFilename, downloadChartAsPng, findLargestSvg, renderChartAsPngDataUrl } from "./png-export";
import type { ActivityBarPoint } from "./types";

type EmissionsByActivityWidgetProps = {
  title: string;
  subtitle?: string;
  clientName?: string | null;
  data: ActivityBarPoint[];
  widgetKey?: string;
  showWidgetRef?: boolean;
  showHeader?: boolean;
  showPng?: boolean;
  presentation?: "card" | "image";
  storedPngUrl?: string | null;
  className?: string;
};

const FALLBACK_COLORS = ["#7e57c2", "#a3a3a3", "#4c7bd9", "#f07f2f", "#10b981", "#ef4444", "#64748b", "#eab308"];

function formatTooltipValue(value: unknown): [string, string] {
  const amount = Array.isArray(value) ? Number(value[0] ?? 0) : Number(value ?? 0);
  return [`${formatNumber(amount, 1)} tCO2e`, ""];
}

export function EmissionsByActivityWidget({
  title,
  subtitle,
  clientName,
  data,
  widgetKey = REPORT_WIDGET_IDS.emissionsByActivity,
  showWidgetRef = true,
  showHeader = true,
  showPng = true,
  presentation = "card",
  storedPngUrl,
  className,
}: EmissionsByActivityWidgetProps) {
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const chartHeight = Math.max(200, data.length * 52 + 40);

  const exportPngDataUrl = async () => {
    const svg = findLargestSvg(chartWrapRef.current);
    if (!svg) return "";
    return renderChartAsPngDataUrl({
      svg,
      title,
      subtitle,
      canvasWidth: 960,
    });
  };

  useEffect(() => {
    if (!widgetKey || storedPngUrl) return;
    return registerWidgetPngExporter(widgetKey, exportPngDataUrl);
  }, [exportPngDataUrl, widgetKey, storedPngUrl]);

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

  if (data.length === 0) {
    if (!showHeader) {
      return (
        <div className={className} data-widget-key={widgetKey}>
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-muted-foreground">
            No activity data available.
          </div>
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
            {showWidgetRef ? (
              <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground print:hidden">
                <span className="block text-right">Widget ref</span>
                <span className="block font-mono tracking-[0.18em] text-foreground">{widgetKey}</span>
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-muted-foreground">
            No activity data available.
          </div>
        </CardContent>
      </Card>
    );
  }

  const downloadPng = async () => {
    const svg = findLargestSvg(chartWrapRef.current);
    if (!svg) return;
    await downloadChartAsPng({
      svg,
      filename: buildPngFilename(title, clientName),
      title,
      subtitle,
      canvasWidth: 960,
    });
  };

  const chart = (
    <div className="w-full">
      <div className="h-full" style={{ height: chartHeight }}>
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart layout="vertical" data={data} margin={{ top: 4, right: 64, left: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#F0F0F0" />
            <XAxis
              type="number"
              tickFormatter={(v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              tick={{ fontSize: 10 }}
              label={{ value: "tCO₂e", position: "insideBottomRight", offset: 0, style: { fontSize: 10, fill: "#94a3b8" } }}
            />
            <YAxis type="category" dataKey="name" width={180} tick={{ fontSize: 9 }} />
            <Tooltip formatter={formatTooltipValue} />
            <Bar dataKey="value" name="tCO2e" radius={[0, 3, 3, 0]}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.fill || FALLBACK_COLORS[index % FALLBACK_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  if (!showHeader) {
    return (
      <div ref={chartWrapRef} className={className} data-widget-key={widgetKey}>
        {chart}
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
          <div className="flex items-center gap-2 print:hidden">
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
        <div ref={chartWrapRef}>{chart}</div>
      </CardContent>
    </Card>
  );
}


