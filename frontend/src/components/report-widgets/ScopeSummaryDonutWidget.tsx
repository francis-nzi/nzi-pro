"use client";

import { useMemo, useRef } from "react";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";
import { REPORT_WIDGET_IDS } from "./registry";
import { buildPngFilename, downloadChartAsPng, findLargestSvg } from "./png-export";

export type ScopeDonutItem = {
  name: string;
  value: number;
};

type ScopeSummaryDonutWidgetProps = {
  title: string;
  subtitle?: string;
  data: ScopeDonutItem[];
  currentYear?: number | null;
  benchmarkYear?: number | null;
  benchmarkTotal?: number | null;
  currentTotal?: number | null;
  widgetKey?: string;
  showWidgetRef?: boolean;
  className?: string;
};

const SCOPE_COLORS = ["#0f766e", "#0891b2", "#38bdf8"];

function pctChange(current: number, benchmark: number): number | null {
  if (benchmark <= 0) return null;
  return ((current - benchmark) / benchmark) * 100;
}

export function ScopeSummaryDonutWidget({
  title,
  subtitle,
  data,
  currentYear,
  benchmarkYear,
  benchmarkTotal,
  currentTotal,
  widgetKey = REPORT_WIDGET_IDS.emissionsScopeDonut,
  showWidgetRef = true,
  className,
}: ScopeSummaryDonutWidgetProps) {
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const total = Number(currentTotal ?? data.reduce((sum, item) => sum + Number(item.value || 0), 0));
  const benchmarkChange = useMemo(() => {
    if (benchmarkYear == null || currentYear == null || benchmarkYear === currentYear || benchmarkTotal == null) return null;
    const pct = pctChange(total, Number(benchmarkTotal || 0));
    if (pct == null) return null;
    const direction = pct <= 0 ? "down" : "up";
    const absPct = Math.abs(pct);
    const label = `${direction === "down" ? "▼" : "▲"} ${absPct.toFixed(1)}% vs benchmark (${formatNumber(Number(benchmarkTotal || 0), 1)} tCO₂e)`;
    return { label, direction };
  }, [benchmarkYear, benchmarkTotal, currentTotal, currentYear, total]);

  const downloadPng = async () => {
    const svg = findLargestSvg(chartWrapRef.current);
    if (!svg) return;
    await downloadChartAsPng({
      svg,
      filename: buildPngFilename(title),
      title,
      subtitle,
      legendItems: data.map((item, index) => ({ label: item.name, color: SCOPE_COLORS[index % SCOPE_COLORS.length] })),
      callout: benchmarkChange
        ? {
            text: benchmarkChange.label,
            backgroundColor: benchmarkChange.direction === "down" ? "#dcfce7" : "#fee2e2",
            borderColor: benchmarkChange.direction === "down" ? "#bbf7d0" : "#fecaca",
            textColor: benchmarkChange.direction === "down" ? "#166534" : "#b91c1c",
          }
        : null,
    });
  };

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
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
          <div className="relative mx-auto aspect-square w-full max-w-[480px]" ref={chartWrapRef}>
            <ResponsiveContainer width="100%" aspect={1}>
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius="72%" outerRadius="94%" paddingAngle={2}>
                  {data.map((_, index) => (
                    <Cell key={index} fill={SCOPE_COLORS[index % SCOPE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: unknown) => [`${formatNumber(Number(value || 0), 1)} tCO₂e`, ""]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className="text-3xl font-semibold tabular-nums">{formatNumber(total, 1)}</div>
                <div className="text-xs text-muted-foreground">tCO₂e total</div>
                {currentYear ? <div className="mt-1 text-[10px] text-muted-foreground/70">{currentYear}</div> : null}
              </div>
            </div>
          </div>
          <div className="space-y-3">
            {data.map((scope, index) => (
              <div key={scope.name} className="flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SCOPE_COLORS[index % SCOPE_COLORS.length] }} />
                  <span>{scope.name}</span>
                </div>
                <div className="text-right">
                  <div className="font-medium">{formatNumber(Number(scope.value || 0), 1)}</div>
                  <div className="text-xs text-muted-foreground">{total > 0 ? `${((scope.value / total) * 100).toFixed(1)}%` : "0.0%"}</div>
                </div>
              </div>
            ))}
            <div className="mt-2 border-t pt-2">
              <div className="flex items-center justify-between gap-3 text-sm font-semibold">
                <span>Total</span>
                <div className="text-right">
                  <div>{formatNumber(total, 1)}</div>
                  <div className="text-xs text-muted-foreground">100.0%</div>
                </div>
              </div>
            </div>
            {benchmarkChange ? (
              <Badge className="w-fit rounded-full px-3 py-1 text-xs font-medium" variant="secondary">
                {benchmarkChange.label}
              </Badge>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
