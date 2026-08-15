"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  yearJobs?: Array<{
    year: number;
    job_id: number;
    job_number: string | null;
    title?: string | null;
    reporting_year?: number | null;
  }>;
};

export default function JobIntensityYearOverYear({ clientId, baseUrl, yearJobs = [] }: JobIntensityYearOverYearProps) {
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
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${baseUrl}/clients/${clientId}/dashboard`, {
        cache: "no-store",
        credentials: "include",
        headers,
      });
      if (!res.ok) throw new Error(`Failed to load intensity data: ${res.status}`);
      setDashboard((await res.json()) as ClientDashboardResponse);
    } catch (e) {
      setDashboard(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [baseUrl, clientId]);

  useEffect(() => { void loadDashboard(); }, [loadDashboard, refreshIndex]);

  // Years sorted ascending (oldest → latest), matching other YoY tables
  const sortedYears = useMemo(() => {
    return [...(dashboard?.yearly_intensity_metrics || [])]
      .filter((r) => r.year !== null)
      .sort((a, b) => Number(a.year) - Number(b.year))
      .map((r) => ({
        year: Number(r.year),
        byKey: new Map((r.metrics || []).map((m) => [m.key, m])),
      }));
  }, [dashboard]);

  // Ordered list of unique metric keys, preserving first-seen order
  const metricKeys = useMemo(() => {
    const seen = new Map<string, { label: string; divider: number }>();
    for (const row of sortedYears) {
      for (const [key, m] of row.byKey) {
        if (!seen.has(key)) seen.set(key, { label: m.label || key, divider: m.divider || 1 });
      }
    }
    return [...seen.entries()].map(([key, meta]) => ({ key, ...meta }));
  }, [sortedYears]);

  const latestYear = sortedYears[sortedYears.length - 1]?.year ?? null;
  const benchmarkYear = sortedYears[0]?.year ?? null;
  const yearJobsByYear = useMemo(
    () =>
      new Map(
        yearJobs
          .filter((job) => Number.isFinite(Number(job.year)) && Number.isFinite(Number(job.job_id)))
          .map((job) => [
            Number(job.year),
            {
              job_id: Number(job.job_id),
              job_number: job.job_number?.trim() || null,
              title: job.title?.trim() || null,
              reporting_year: job.reporting_year ?? null,
            },
          ])
      ),
    [yearJobs]
  );

  if (clientId == null || loading) {
    return <div className="text-sm text-muted-foreground">Loading intensity metrics...</div>;
  }

  if (error) {
    return (
      <Card>
        <CardHeader><CardTitle>Intensity Metrics</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm text-destructive">{error}</div>
          <Button variant="outline" size="sm" onClick={() => setRefreshIndex((v) => v + 1)}>
            <RefreshCw className="mr-2 h-4 w-4" />Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!dashboard || sortedYears.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Intensity Metrics</CardTitle></CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            No intensity metrics available yet. Add the intensity inputs in Job Setup to generate this view.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Intensity Metrics - Year on Year</CardTitle>
          <p className="text-sm text-muted-foreground">Edit input metrics in Job Setup.</p>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted">
                <th className="text-left p-2 border">Metric</th>
                <th className="text-left p-2 border">Unit</th>
                {sortedYears.map(({ year }) => {
                  const yearJob = yearJobsByYear.get(year);
                  const yearJobLabel = yearJob?.job_number || (yearJob?.job_id ? `Job ${yearJob.job_id}` : "");
                  return (
                    <th
                      key={year}
                      className={`text-right p-2 border font-semibold ${year === latestYear ? "bg-slate-800 text-white" : ""}`}
                    >
                      {yearJob?.job_id ? (
                        <Link
                          href={`/jobs/${yearJob.job_id}`}
                          className="inline-flex flex-col items-end leading-tight hover:text-foreground hover:underline"
                          aria-label={`Open ${yearJobLabel}`}
                        >
                          {yearJobLabel ? (
                            <span className="text-[10px] font-medium uppercase tracking-wide text-primary">
                              {yearJobLabel}
                            </span>
                          ) : null}
                          {year === benchmarkYear ? (
                            <Badge className="h-4 rounded-full border-amber-400 bg-amber-400 px-1.5 py-0 text-[9px] font-bold leading-none text-white">
                              BL
                            </Badge>
                          ) : null}
                          <span className="text-sm font-normal">{year}</span>
                        </Link>
                      ) : (
                        <span className="inline-flex flex-col items-end leading-tight">
                          {year === benchmarkYear ? (
                            <Badge className="h-4 rounded-full border-amber-400 bg-amber-400 px-1.5 py-0 text-[9px] font-bold leading-none text-white">
                              BL
                            </Badge>
                          ) : null}
                          <span className="text-sm font-normal">{year}</span>
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {metricKeys.map(({ key, label, divider }) => (
                <tr key={key} className="border-t hover:bg-muted/30">
                  <td className="p-2 border font-medium">{label}</td>
                  <td className="p-2 border text-muted-foreground text-xs">
                    tCO₂e per {formatNumber(divider, 0)} units
                  </td>
                  {sortedYears.map(({ year, byKey }, idx) => {
                    const metric = byKey.get(key);
                    const intensity = metric ? Number(metric.intensity || 0) : null;
                    const prevYear = sortedYears[idx - 1];
                    const prevIntensity = prevYear?.byKey.get(key)
                      ? Number(prevYear.byKey.get(key)!.intensity || 0)
                      : null;
                    const changePct =
                      intensity != null && prevIntensity != null && prevIntensity > 0
                        ? ((intensity - prevIntensity) / prevIntensity) * 100
                        : null;
                    return (
                      <td key={year} className="p-2 border text-right">
                        {intensity != null ? (
                          <div>
                            <div className="font-medium">{formatNumber(intensity, 2)}</div>
                            {changePct != null && (
                              <div className={`text-xs ${changePct > 0 ? "text-rose-600" : "text-emerald-700"}`}>
                                {changePct > 0 ? "+" : ""}{formatNumber(changePct, 1)}%
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {/* Basis row per metric */}
              {metricKeys.map(({ key, label, divider }) => (
                <tr key={`basis-${key}`} className="border-t bg-muted/20 text-xs text-muted-foreground">
                  <td className="p-2 border pl-4 italic">{label} – basis</td>
                  <td className="p-2 border">units</td>
                  {sortedYears.map(({ year, byKey }) => {
                    const metric = byKey.get(key);
                    return (
                      <td key={year} className="p-2 border text-right">
                        {metric ? formatNumber(metric.value || 0, 0) : "-"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
