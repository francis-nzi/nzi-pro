"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getToken } from "@/lib/auth-client";
import { formatNumber } from "@/lib/format";

type DashboardIntensityMetric = {
  key: string;
  label: string;
  value: number;
  divider: number;
  intensity: number;
};

type DashboardYearIntensity = {
  year: number | null;
  metrics: DashboardIntensityMetric[];
};

type ClientDashboardResponse = {
  selected_year?: number | null;
  yearly_intensity_metrics?: DashboardYearIntensity[];
};

type JobIntensityYearOverYearProps = {
  clientId: number | null;
  baseUrl: string;
};

export default function JobIntensityYearOverYear({ clientId, baseUrl }: JobIntensityYearOverYearProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dashboard, setDashboard] = useState<ClientDashboardResponse | null>(null);
  const [refreshIndex, setRefreshIndex] = useState(0);

  const loadDashboard = useCallback(async () => {
    if (!clientId || clientId <= 0) {
      setDashboard(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const token = getToken();
      const headers: Record<string, string> = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const res = await fetch(`${baseUrl}/clients/${clientId}/dashboard`, {
        cache: "no-store",
        credentials: "include",
        headers,
      });

      if (!res.ok) {
        throw new Error(`Failed to load year-on-year intensity data: ${res.status}`);
      }

      const json = (await res.json()) as ClientDashboardResponse;
      setDashboard(json);
    } catch (e) {
      setDashboard(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [baseUrl, clientId]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard, refreshIndex]);

  const yearRows = useMemo(() => {
    const rows = [...(dashboard?.yearly_intensity_metrics || [])]
      .filter((row) => row?.year !== null)
      .sort((a, b) => Number(b.year) - Number(a.year));

    return rows.map((row) => {
      const metricsByKey = new Map<string, DashboardIntensityMetric>();
      for (const metric of row.metrics || []) {
        metricsByKey.set(metric.key, metric);
      }
      return {
        year: Number(row.year),
        metrics: [...metricsByKey.values()].sort((a, b) => a.label.localeCompare(b.label)),
        metricsByKey,
      };
    });
  }, [dashboard]);

  const latestYear = yearRows[0]?.year ?? null;

  const previousIntensityMap = useMemo(() => {
    const map = new Map<number, Map<string, number>>();
    for (let index = 0; index < yearRows.length; index += 1) {
      const currentYear = yearRows[index]?.year;
      const previousYear = yearRows[index + 1]?.year;
      if (currentYear == null || previousYear == null) continue;
      const prevMetrics = new Map<string, number>();
      for (const metric of yearRows[index + 1].metrics) {
        prevMetrics.set(metric.key, Number(metric.intensity || 0));
      }
      map.set(currentYear, prevMetrics);
    }
    return map;
  }, [yearRows]);

  if (clientId == null || loading) {
    return <div className="text-sm text-muted-foreground">Loading year-on-year intensity metrics...</div>;
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Intensity Metrics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm text-destructive">{error}</div>
          <Button variant="outline" size="sm" onClick={() => setRefreshIndex((value) => value + 1)}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!dashboard || yearRows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Intensity Metrics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm text-muted-foreground">
            No year-on-year intensity metrics available yet. Add the intensity inputs in Job Setup to generate this view.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>Intensity Metrics - Year on Year</CardTitle>
              <p className="text-sm leading-6 text-slate-600">
                This read-only view compares the saved intensity metrics across reporting years. Edit the input metrics in Job Setup.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-white">
                {yearRows.length} year{yearRows.length === 1 ? "" : "s"}
              </Badge>
              {latestYear !== null ? (
                <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50">Latest {latestYear}</Badge>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {yearRows.map((row) => {
            const yearLabel = row.year;
            const prevMetrics = previousIntensityMap.get(row.year) ?? new Map<string, number>();

            return (
              <div key={row.year} className="rounded-2xl border bg-slate-50 p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Reporting Year</div>
                    <div className="text-xl font-semibold text-slate-900">{yearLabel}</div>
                  </div>
                  {latestYear === row.year ? (
                    <Badge className="bg-slate-900 text-white hover:bg-slate-900">Latest year</Badge>
                  ) : null}
                </div>

                {row.metrics.length > 0 ? (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {row.metrics.map((metric) => {
                      const previous = prevMetrics.get(metric.key);
                      const intensity = Number(metric.intensity || 0);
                      const changePct =
                        previous != null && previous > 0 ? ((intensity - previous) / previous) * 100 : null;
                      const changeLabel =
                        changePct == null
                          ? "No prior year comparison"
                          : `${changePct > 0 ? "+" : ""}${formatNumber(changePct, 1)}% vs prior year`;
                      const ChangeIcon = changePct == null ? null : changePct > 0 ? ArrowUpRight : ArrowDownRight;

                      return (
                        <div key={`${row.year}-${metric.key}`} className="rounded-2xl border bg-white p-4 shadow-sm">
                          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{metric.label || metric.key}</div>
                          <div className="mt-2 text-3xl font-semibold tabular-nums text-slate-900">
                            {formatNumber(intensity, 2)}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            tCO₂e per {formatNumber(metric.divider || 1, 0)} units
                          </div>
                          <div className="mt-3 space-y-1 text-sm">
                            <div className="text-slate-600">
                              Basis: {formatNumber(metric.value || 0, 0)} units
                            </div>
                            <div className={`flex items-center gap-1 ${changePct == null ? "text-slate-500" : changePct > 0 ? "text-rose-600" : "text-emerald-700"}`}>
                              {ChangeIcon ? <ChangeIcon className="h-4 w-4" /> : null}
                              <span>{changeLabel}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed bg-white p-4 text-sm text-slate-500">
                    No intensity metrics were saved for this year.
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
