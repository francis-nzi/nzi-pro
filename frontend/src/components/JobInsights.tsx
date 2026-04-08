"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type ScopeTotals = {
  scope_1: number;
  scope_2: number;
  scope_3: number;
  total: number;
};

type JobScopeRow = {
  scope?: string | null;
  site_name?: string | null;
  category?: string | null;
  report_label?: string | null;
  calc_tco2e?: number | null;
  month_1?: number | null;
  month_2?: number | null;
  month_3?: number | null;
  month_4?: number | null;
  month_5?: number | null;
  month_6?: number | null;
  month_7?: number | null;
  month_8?: number | null;
  month_9?: number | null;
  month_10?: number | null;
  month_11?: number | null;
  month_12?: number | null;
};

type ScopeDataResponse = {
  rows?: JobScopeRow[];
  total?: number;
};

type ClientInfo = {
  net_zero_year?: number | null;
  client_name?: string | null;
};

const SCOPE_COLORS = ["#0f766e", "#0891b2", "#38bdf8"];
const ACTIVITY_COLORS = ["#0ea5e9", "#14b8a6", "#f97316", "#8b5cf6", "#22c55e", "#ef4444", "#64748b", "#eab308"];

function formatTco2e(value: number): string {
  return value.toLocaleString("en-GB", { maximumFractionDigits: 1 });
}

function bucketKey(value?: string | null): string {
  const raw = String(value ?? "").trim();
  return raw.length > 0 ? raw : "Unknown";
}

export default function JobInsights({
  jobId,
  clientId,
  baseUrl = "/api/backend",
  jobNumber,
  clientName,
  reportingYear,
}: {
  jobId: number;
  clientId: number | null | undefined;
  baseUrl?: string;
  jobNumber?: string | null;
  clientName?: string | null;
  reportingYear?: number | null;
}) {
  const [scopeTotals, setScopeTotals] = useState<ScopeTotals | null>(null);
  const [rows, setRows] = useState<JobScopeRow[]>([]);
  const [targetYear, setTargetYear] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [whatIfScope1, setWhatIfScope1] = useState("0");
  const [whatIfScope2, setWhatIfScope2] = useState("0");
  const [whatIfScope3, setWhatIfScope3] = useState("0");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!Number.isFinite(jobId) || jobId <= 0) return;
      setLoading(true);
      setError("");

      try {
        const scopeTotalsRes = await fetch(`${baseUrl}/jobs/${jobId}/scope-totals`, { credentials: "include" });
        const scopeDataRes = await fetch(`${baseUrl}/jobs/${jobId}/scope-data?include_disabled=true`, {
          credentials: "include",
        });
        const clientRes =
          clientId != null && Number.isFinite(Number(clientId)) && Number(clientId) > 0
            ? await fetch(`${baseUrl}/clients/${clientId}`, { credentials: "include" })
            : null;

        if (!scopeTotalsRes.ok) {
          throw new Error(`Scope totals failed (${scopeTotalsRes.status})`);
        }
        if (!scopeDataRes.ok) {
          throw new Error(`Scope data failed (${scopeDataRes.status})`);
        }

        const totalsJson = (await scopeTotalsRes.json()) as ScopeTotals;
        const scopeDataJson = (await scopeDataRes.json()) as ScopeDataResponse;
        const clientJson = clientRes && clientRes.ok ? ((await clientRes.json()) as ClientInfo) : null;

        if (cancelled) return;
        setScopeTotals(totalsJson);
        setRows(Array.isArray(scopeDataJson.rows) ? scopeDataJson.rows : []);
        setTargetYear(Number.isFinite(Number(clientJson?.net_zero_year)) ? Number(clientJson?.net_zero_year) : 2050);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        setScopeTotals(null);
        setRows([]);
        setTargetYear(2050);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [baseUrl, clientId, jobId, refreshIndex]);

  const scopeCards = useMemo(() => {
    if (!scopeTotals) return [];
    return [
      { name: "Scope 1", value: scopeTotals.scope_1 },
      { name: "Scope 2", value: scopeTotals.scope_2 },
      { name: "Scope 3", value: scopeTotals.scope_3 },
    ].filter((entry) => entry.value > 0);
  }, [scopeTotals]);

  const activityData = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row) => {
      const label = bucketKey(row.report_label || row.category);
      map.set(label, (map.get(label) ?? 0) + Number(row.calc_tco2e || 0));
    });
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [rows]);

  const siteData = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row) => {
      const label = bucketKey(row.site_name);
      map.set(label, (map.get(label) ?? 0) + Number(row.calc_tco2e || 0));
    });
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [rows]);

  const monthlyTrend = useMemo(() => {
    const months = Array.from({ length: 12 }, (_, idx) => ({
      month: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][idx],
      actual: 0,
    }));
    rows.forEach((row) => {
      const values = [
        row.month_1,
        row.month_2,
        row.month_3,
        row.month_4,
        row.month_5,
        row.month_6,
        row.month_7,
        row.month_8,
        row.month_9,
        row.month_10,
        row.month_11,
        row.month_12,
      ];
      values.forEach((value, index) => {
        months[index].actual += Number(value || 0);
      });
    });
    return months;
  }, [rows]);

  const forecastTrend = useMemo(() => {
    const currentTotal = Number(scopeTotals?.total || 0);
    const currentYear = reportingYear ?? new Date().getFullYear();
    const endYear = targetYear && targetYear >= currentYear ? targetYear : Math.max(currentYear + 1, 2050);
    const years = Array.from({ length: Math.max(1, endYear - currentYear + 1) }, (_, index) => currentYear + index);
    return years.map((year, index) => {
      const progress = years.length > 1 ? index / (years.length - 1) : 1;
      return {
        year,
        actual: year === currentYear ? currentTotal : null,
        forecast: Math.max(currentTotal * (1 - progress), 0),
      };
    });
  }, [reportingYear, scopeTotals?.total, targetYear]);

  const whatIf = useMemo(() => {
    const current = Number(scopeTotals?.total || 0);
    const s1 = Number(scopeTotals?.scope_1 || 0) * (1 - Math.max(0, Math.min(100, Number(whatIfScope1) || 0)) / 100);
    const s2 = Number(scopeTotals?.scope_2 || 0) * (1 - Math.max(0, Math.min(100, Number(whatIfScope2) || 0)) / 100);
    const s3 = Number(scopeTotals?.scope_3 || 0) * (1 - Math.max(0, Math.min(100, Number(whatIfScope3) || 0)) / 100);
    const total = s1 + s2 + s3;
    return {
      current,
      total,
      reduction: Math.max(current - total, 0),
      reductionPct: current > 0 ? ((current - total) / current) * 100 : 0,
    };
  }, [scopeTotals, whatIfScope1, whatIfScope2, whatIfScope3]);

  const summaryCopy = useMemo(() => {
    if (!scopeTotals) return "Generate the dashboard to review the job's emissions pattern, hotspots, and target path.";
    const topActivity = activityData[0];
    const topSite = siteData[0];
    return [
      clientName ? `${clientName} job ${jobNumber ?? jobId} has ${formatTco2e(scopeTotals.total)} tCO2e in total.` : `Job ${jobNumber ?? jobId} has ${formatTco2e(scopeTotals.total)} tCO2e in total.`,
      topActivity ? `${topActivity.name} is the largest activity driver at ${formatTco2e(topActivity.value)} tCO2e.` : null,
      topSite ? `${topSite.name} is the largest site contributor at ${formatTco2e(topSite.value)} tCO2e.` : null,
      targetYear ? `A linear pathway to the client target year ${targetYear} is shown below.` : null,
    ]
      .filter(Boolean)
      .join(" ");
  }, [activityData, clientName, jobId, jobNumber, scopeTotals, siteData, targetYear]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Job Insights</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Loading insights dashboard...</CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Job Insights</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="text-destructive">Unable to load insights: {error}</div>
          <Button variant="outline" onClick={() => setRefreshIndex((value) => value + 1)}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Total tCO2e" value={scopeTotals?.total ?? 0} />
        <MetricCard label="Target Year" value={targetYear ?? 2050} />
        <MetricCard label="Top Activity" value={activityData[0] ? formatTco2e(activityData[0].value) : "0.0"} suffix="tCO2e" />
        <MetricCard label="Top Site" value={siteData[0] ? formatTco2e(siteData[0].value) : "0.0"} suffix="tCO2e" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>AI Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-700">{summaryCopy}</p>
          <div className="flex flex-wrap gap-2">
            {scopeCards.map((scope) => (
              <Badge key={scope.name} variant="secondary">
                {scope.name}: {formatTco2e(scope.value)} tCO2e
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Emissions Summary by Scope</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
              <div className="relative mx-auto aspect-square w-full max-w-[480px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={scopeCards} dataKey="value" nameKey="name" innerRadius="72%" outerRadius="94%" paddingAngle={2}>
                      {scopeCards.map((_, index) => (
                        <Cell key={index} fill={SCOPE_COLORS[index % SCOPE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number | string | undefined) => `${formatTco2e(Number(value ?? 0))} tCO2e`} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-3xl font-semibold tabular-nums">{formatTco2e(scopeTotals?.total ?? 0)}</div>
                    <div className="text-xs text-muted-foreground">tCO2e total</div>
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                {scopeCards.map((scope, index) => (
                  <div key={scope.name} className="flex items-center justify-between gap-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SCOPE_COLORS[index % SCOPE_COLORS.length] }} />
                      <span>{scope.name}</span>
                    </div>
                    <span className="font-medium">{formatTco2e(scope.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Emissions by Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {activityData.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">No activity data available</div>
            ) : (
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={activityData} layout="vertical" margin={{ top: 4, right: 12, left: 20, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(value: number | string | undefined) => `${formatTco2e(Number(value ?? 0))} tCO2e`} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} fill="#0ea5e9">
                      {activityData.map((_, index) => (
                        <Cell key={index} fill={ACTIVITY_COLORS[index % ACTIVITY_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Emissions by Site</CardTitle>
          </CardHeader>
          <CardContent>
            {siteData.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">No site data available</div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                <div className="relative mx-auto aspect-square w-full max-w-[420px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={siteData} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={2}>
                        {siteData.map((_, index) => (
                          <Cell key={index} fill={ACTIVITY_COLORS[index % ACTIVITY_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number | string | undefined) => `${formatTco2e(Number(value ?? 0))} tCO2e`} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-2">
                  {siteData.map((site, index) => (
                    <div key={site.name} className="flex items-center justify-between gap-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ACTIVITY_COLORS[index % ACTIVITY_COLORS.length] }} />
                        <span>{site.name}</span>
                      </div>
                      <span className="font-medium">{formatTco2e(site.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Emissions Trend to Target Year</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={forecastTrend} margin={{ top: 5, right: 20, left: 6, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="year" />
                  <YAxis />
                  <Tooltip formatter={(value: number | string | null | undefined) => `${formatTco2e(Number(value ?? 0))} tCO2e`} />
                  <Legend />
                  <Line type="monotone" dataKey="actual" stroke="#0f766e" strokeWidth={3} dot={{ r: 4 }} name="Actual" />
                  <Line type="monotone" dataKey="forecast" stroke="#38bdf8" strokeWidth={2} strokeDasharray="5 4" dot={false} name="Forecast" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Monthly Emissions Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyTrend} margin={{ top: 5, right: 20, left: 6, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(value: number | string | null | undefined) => `${formatTco2e(Number(value ?? 0))} tCO2e`} />
                <Line type="monotone" dataKey="actual" stroke="#0f766e" strokeWidth={3} dot={{ r: 3 }} name="Actual" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What If Scenarios</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <ScenarioInput label="Scope 1 reduction %" value={whatIfScope1} onChange={setWhatIfScope1} />
            <ScenarioInput label="Scope 2 reduction %" value={whatIfScope2} onChange={setWhatIfScope2} />
            <ScenarioInput label="Scope 3 reduction %" value={whatIfScope3} onChange={setWhatIfScope3} />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard label="Scenario total" value={whatIf.total} />
            <MetricCard label="Reduction" value={whatIf.reduction} suffix="tCO2e" />
            <MetricCard label="Reduction %" value={whatIf.reductionPct} suffix="%" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => { setWhatIfScope1("10"); setWhatIfScope2("10"); setWhatIfScope3("10"); }}>
              Moderate action
            </Button>
            <Button variant="outline" onClick={() => { setWhatIfScope1("25"); setWhatIfScope2("15"); setWhatIfScope3("20"); }}>
              Strong action
            </Button>
            <Button variant="outline" onClick={() => { setWhatIfScope1("0"); setWhatIfScope2("0"); setWhatIfScope3("0"); }}>
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Industry Trends and References</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-700">
          <p>Use this section to compare the job against sector norms, highlight reduction opportunities, and cite the source material used for assumptions.</p>
          <ul className="list-disc space-y-1 pl-5 text-slate-600">
            <li>GHG Protocol Corporate Standard</li>
            <li>Science Based Targets initiative guidance</li>
            <li>UK Government greenhouse gas conversion factors</li>
            <li>IEA Net Zero by 2050 roadmap</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number | string;
  suffix?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="text-3xl font-semibold tabular-nums">{value}{suffix ? ` ${suffix}` : ""}</div>
      </CardContent>
    </Card>
  );
}

function ScenarioInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{label}</div>
      <Input type="number" min="0" max="100" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
