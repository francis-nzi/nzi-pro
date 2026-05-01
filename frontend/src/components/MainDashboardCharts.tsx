"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, AreaChart, Area } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MCKINSEY_ACTIVITY_COLORS, MCKINSEY_DATA_COLORS } from "@/lib/chart-colors";
import EmptyChart from "@/components/EmptyChart";
import type { FinancialData, OperationsData, OverviewData } from "@/components/MainDashboard";

type ChartSection = "financial" | "operations" | "emissions";

type Props = {
  section: ChartSection;
  overview: OverviewData | null;
  financial: FinancialData | null;
  operations: OperationsData | null;
};

const MS_COLORS = { green: "#16a34a", amber: "#d97706", red: "#dc2626", no_milestones: "#94a3b8" };

function n(v: unknown, dp = 1) {
  return Number(v || 0).toLocaleString("en-GB", { maximumFractionDigits: dp });
}

function gbp(v: number) {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `£${n(v / 1_000_000)}M`;
  if (a >= 1_000) return `£${Math.round(v / 1_000)}k`;
  return `£${Math.round(v).toLocaleString("en-GB")}`;
}

function hrs(h: number) {
  return `${n(h)}h`;
}

function mon(s: string) {
  try {
    return new Date(`${s}T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
  } catch {
    return s.slice(0, 7);
  }
}

function Loading() {
  return <div className="flex items-center justify-center py-16 gap-2 text-sm text-muted-foreground">Loading…</div>;
}

export default function MainDashboardCharts({ section, overview, financial, operations }: Props) {
  if (section === "financial") {
    if (!financial) return <Loading />;

    const monthlyData = (() => {
      const map = new Map<string, { month: string; invoiced: number; paid: number; quotes: number }>();
      for (const x of financial.monthly_invoices ?? []) {
        map.set(x.month_start, { month: mon(x.month_start), invoiced: +x.total_value || 0, paid: +x.paid_total || 0, quotes: 0 });
      }
      for (const x of financial.monthly_quotes ?? []) {
        const entry = map.get(x.month_start);
        if (entry) entry.quotes = +x.total_value || 0;
        else map.set(x.month_start, { month: mon(x.month_start), invoiced: 0, paid: 0, quotes: +x.total_value || 0 });
      }
      return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
    })();

    const quoteDonut = (financial.quote_status_breakdown ?? []).map((row, i) => ({
      name: row.status,
      value: +row.total_value || 0,
      color: MCKINSEY_DATA_COLORS[i % MCKINSEY_DATA_COLORS.length],
    }));

    const topClients = (financial.top_clients_by_invoiced_total ?? [])
      .slice(0, 8)
      .map((client) => ({
        name: client.client_name.length > 20 ? `${client.client_name.slice(0, 18)}…` : client.client_name,
        value: +client.total_invoiced || 0,
        id: client.client_id,
      }));

    return (
      <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="border-l-4 border-l-blue-500">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-muted-foreground leading-tight mb-1">Quote Pipeline</div>
                  <div className="text-2xl font-semibold leading-tight truncate">{gbp(financial.metrics.quote_value_total)}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{financial.metrics.quote_count} quotes</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-purple-500">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-muted-foreground leading-tight mb-1">Total Invoiced</div>
                  <div className="text-2xl font-semibold leading-tight truncate">{gbp(financial.metrics.invoice_total)}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{financial.metrics.invoice_count} invoices</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-green-500">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-muted-foreground leading-tight mb-1">Paid</div>
                  <div className="text-2xl font-semibold leading-tight truncate">{gbp(financial.metrics.paid_total)}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{n(financial.metrics.cash_realisation_pct)}% realisation</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className={`border-l-4 ${financial.metrics.overdue_invoice_count > 0 ? "border-l-red-500" : "border-l-orange-500"}`}>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-muted-foreground leading-tight mb-1">Outstanding</div>
                  <div className="text-2xl font-semibold leading-tight truncate">{gbp(financial.metrics.outstanding_total)}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{financial.metrics.overdue_invoice_count} overdue</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Cash Realisation</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-center gap-4 mb-2">
              <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(financial.metrics.cash_realisation_pct, 100)}%`,
                    backgroundColor: financial.metrics.cash_realisation_pct >= 80 ? "#16a34a" : financial.metrics.cash_realisation_pct >= 50 ? "#d97706" : "#dc2626",
                  }}
                />
              </div>
              <span className="text-lg font-semibold w-14 text-right">{n(financial.metrics.cash_realisation_pct)}%</span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Paid: {gbp(financial.metrics.paid_total)}</span>
              <span>Invoiced: {gbp(financial.metrics.invoice_total)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Monthly Revenue</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {monthlyData.length === 0 ? (
              <EmptyChart title="No monthly revenue data" description="There are no invoice or quote values available for the selected view." minHeight="min-h-[240px]" />
            ) : (
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={monthlyData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                    <defs>
                      <linearGradient id="gI" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={MCKINSEY_DATA_COLORS[0]} stopOpacity={0.25} />
                        <stop offset="95%" stopColor={MCKINSEY_DATA_COLORS[0]} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gP" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#16a34a" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.35} />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => gbp(+v)} width={64} />
                    <Tooltip formatter={(v: unknown) => [gbp(+Number(v || 0)), ""]} />
                    <Area type="monotone" dataKey="invoiced" name="Invoiced" stroke={MCKINSEY_DATA_COLORS[0]} fill="url(#gI)" strokeWidth={2} />
                    <Area type="monotone" dataKey="paid" name="Paid" stroke="#16a34a" fill="url(#gP)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Quote Pipeline by Status</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {quoteDonut.length === 0 ? (
                <EmptyChart title="No quote pipeline data" description="There are no quote statuses to display for this view." minHeight="min-h-[180px]" />
              ) : (
                <div className="flex items-center gap-4">
                  <div className="h-[180px] w-[180px] flex-shrink-0">
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie data={quoteDonut} dataKey="value" nameKey="name" innerRadius="60%" outerRadius="90%" paddingAngle={2}>
                          {quoteDonut.map((d, i) => (
                            <Cell key={i} fill={d.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: unknown) => [gbp(+Number(v || 0)), ""]} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-2 flex-1">
                    {quoteDonut.map((d, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: d.color }} />
                          <span className="text-muted-foreground">{d.name}</span>
                        </div>
                        <span className="font-medium">{gbp(d.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Top Clients by Revenue</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {topClients.length === 0 ? (
                <EmptyChart title="No top client data" description="Invoices have not been recorded for any clients yet." minHeight="min-h-[200px]" />
              ) : (
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={topClients} layout="vertical" margin={{ top: 0, right: 8, left: 4, bottom: 0 }}>
                      <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => gbp(+v)} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                      <Tooltip formatter={(v: unknown) => [gbp(+Number(v || 0)), "Invoiced"]} />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                        {topClients.map((_, i) => (
                          <Cell key={i} fill={MCKINSEY_DATA_COLORS[i % MCKINSEY_DATA_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Invoice Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2.5">
            {(financial.invoice_status_breakdown ?? []).map((row, i) => {
              const total = financial.metrics.invoice_total || 1;
              const pct = (+row.total_value / total) * 100;
              const overdue = row.status.toLowerCase().includes("overdue");
              return (
                <div key={i} className="space-y-0.5">
                  <div className="flex justify-between text-xs">
                    <span className={`font-medium ${overdue ? "text-red-600" : ""}`}>{row.status}</span>
                    <span className="text-muted-foreground">
                      {gbp(+row.total_value || 0)} · {row.count} inv.
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: overdue ? "#dc2626" : MCKINSEY_DATA_COLORS[i % MCKINSEY_DATA_COLORS.length],
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </>
    );
  }

  if (section === "operations") {
    if (!operations) return <Loading />;

    const milestoneDonut = [
      { name: "On Track", value: operations.metrics.healthy_jobs, color: MS_COLORS.green },
      { name: "Due Soon", value: operations.metrics.due_soon_jobs, color: MS_COLORS.amber },
      { name: "Overdue", value: operations.metrics.overdue_jobs, color: MS_COLORS.red },
      { name: "No Milestones", value: operations.metrics.no_milestone_jobs, color: MS_COLORS.no_milestones },
    ].filter((d) => d.value > 0);

    const timeSubject = (operations.time_by_subject ?? [])
      .slice(0, 8)
      .map((d) => ({ name: d.subject.length > 22 ? `${d.subject.slice(0, 20)}…` : d.subject, hours: +d.hours || 0 }));

    return (
      <>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card className="border-l-4 border-l-blue-500"><CardContent className="pt-4 pb-3"><div className="flex items-start justify-between gap-2"><div className="flex-1 min-w-0"><div className="text-xs text-muted-foreground leading-tight mb-1">Active Jobs</div><div className="text-2xl font-semibold leading-tight truncate">{operations.metrics.active_jobs}</div></div></div></CardContent></Card>
          <Card className="border-l-4 border-l-green-500"><CardContent className="pt-4 pb-3"><div className="flex items-start justify-between gap-2"><div className="flex-1 min-w-0"><div className="text-xs text-muted-foreground leading-tight mb-1">On Track</div><div className="text-2xl font-semibold leading-tight truncate">{operations.metrics.healthy_jobs}</div></div></div></CardContent></Card>
          <Card className="border-l-4 border-l-amber-500"><CardContent className="pt-4 pb-3"><div className="flex items-start justify-between gap-2"><div className="flex-1 min-w-0"><div className="text-xs text-muted-foreground leading-tight mb-1">Due Soon</div><div className="text-2xl font-semibold leading-tight truncate">{operations.metrics.due_soon_jobs}</div></div></div></CardContent></Card>
          <Card className="border-l-4 border-l-red-500"><CardContent className="pt-4 pb-3"><div className="flex items-start justify-between gap-2"><div className="flex-1 min-w-0"><div className="text-xs text-muted-foreground leading-tight mb-1">Overdue</div><div className="text-2xl font-semibold leading-tight truncate">{operations.metrics.overdue_jobs}</div></div></div></CardContent></Card>
          <Card className="border-l-4 border-l-purple-500"><CardContent className="pt-4 pb-3"><div className="flex items-start justify-between gap-2"><div className="flex-1 min-w-0"><div className="text-xs text-muted-foreground leading-tight mb-1">Utilisation</div><div className="text-2xl font-semibold leading-tight truncate">{operations.metrics.utilisation_pct != null ? `${n(operations.metrics.utilisation_pct)}%` : "—"}</div><div className="text-[10px] text-muted-foreground mt-0.5">{hrs(operations.metrics.time_logged_hours)} logged</div></div></div></CardContent></Card>
          <Card className="border-l-4 border-l-orange-500"><CardContent className="pt-4 pb-3"><div className="flex items-start justify-between gap-2"><div className="flex-1 min-w-0"><div className="text-xs text-muted-foreground leading-tight mb-1">Due in 30 days</div><div className="text-2xl font-semibold leading-tight truncate">{operations.metrics.upcoming_milestones_30d}</div></div></div></CardContent></Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Milestone Health</CardTitle></CardHeader>
            <CardContent className="pt-0">
              {milestoneDonut.length === 0 ? (
                <EmptyChart title="No milestone health data" description="There are no milestone statuses to display for this selection." minHeight="min-h-[180px]" />
              ) : (
                <div className="flex items-center gap-4">
                  <div className="relative h-[180px] w-[180px] flex-shrink-0">
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie data={milestoneDonut} dataKey="value" nameKey="name" innerRadius="65%" outerRadius="92%" paddingAngle={2}>
                          {milestoneDonut.map((d, i) => (
                            <Cell key={i} fill={d.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="text-center">
                        <div className="text-xl font-bold">{operations.metrics.active_jobs}</div>
                        <div className="text-[10px] text-muted-foreground">jobs</div>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2.5 flex-1">
                    {milestoneDonut.map((d, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                          <span>{d.name}</span>
                        </div>
                        <span className="font-semibold">{d.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Time by Subject</CardTitle></CardHeader>
            <CardContent className="pt-0">
              {timeSubject.length === 0 ? (
                <EmptyChart title="No time-by-subject data" description="No logged hours are available for the selected CRM/view." minHeight="min-h-[200px]" />
              ) : (
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={timeSubject} layout="vertical" margin={{ top: 0, right: 8, left: 4, bottom: 0 }}>
                      <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}h`} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={130} />
                      <Tooltip formatter={(v: unknown) => [`${n(+Number(v || 0))}h`, "Hours"]} />
                      <Bar dataKey="hours" radius={[0, 4, 4, 0]}>
                        {timeSubject.map((_, i) => (
                          <Cell key={i} fill={MCKINSEY_ACTIVITY_COLORS[i % MCKINSEY_ACTIVITY_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {operations.crm_workload.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">CRM Utilisation</CardTitle></CardHeader>
            <CardContent className="pt-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left pb-2 font-medium">CRM</th>
                    <th className="text-right pb-2 font-medium">Jobs</th>
                    <th className="text-right pb-2 font-medium text-green-600">✓</th>
                    <th className="text-right pb-2 font-medium text-amber-600">⚠</th>
                    <th className="text-right pb-2 font-medium text-red-600">✕</th>
                    <th className="text-right pb-2 font-medium">Logged</th>
                    <th className="text-right pb-2 font-medium">Est.</th>
                    <th className="text-right pb-2 font-medium">Util.</th>
                  </tr>
                </thead>
                <tbody>
                  {operations.crm_workload.map((c) => {
                    const u = c.utilisation_pct;
                    return (
                      <tr key={c.crm_name} className="border-b last:border-0 hover:bg-accent/30 transition-colors">
                        <td className="py-2 font-medium">{c.crm_name}</td>
                        <td className="text-right py-2 text-muted-foreground">{c.total_jobs}</td>
                        <td className="text-right py-2 font-medium text-green-600">{c.green_jobs}</td>
                        <td className="text-right py-2 font-medium text-amber-600">{c.amber_jobs}</td>
                        <td className="text-right py-2 font-medium text-red-600">{c.red_jobs}</td>
                        <td className="text-right py-2 text-muted-foreground">{hrs(c.logged_hours)}</td>
                        <td className="text-right py-2 text-muted-foreground">{c.estimated_hours > 0 ? hrs(c.estimated_hours) : "—"}</td>
                        <td className={`text-right py-2 font-semibold ${u == null ? "text-muted-foreground" : u > 100 ? "text-red-600" : u > 85 ? "text-amber-600" : "text-green-600"}`}>{u != null ? `${n(u)}%` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </>
    );
  }

  if (!overview) return <Loading />;

  const emissionsTrend = (overview.year_trend ?? [])
    .filter((y) => y.year !== null)
    .sort((a, b) => +a.year! - +b.year!)
    .map((y) => ({ year: String(y.year), emissions: +y.total_emissions || 0 }));

  const industryData = (overview.industry_breakdown ?? [])
    .sort((a, b) => b.client_count - a.client_count)
    .slice(0, 10)
    .map((d) => ({ name: d.industry, value: d.client_count }));

  const topEmittingClients = (overview.top_emitting_clients ?? []).slice(0, 8).map((client) => ({
    name: client.client_name.length > 18 ? `${client.client_name.slice(0, 16)}…` : client.client_name,
    emissions: +client.emissions || 0,
  }));

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-orange-500"><CardContent className="pt-4 pb-3"><div className="flex items-start justify-between gap-2"><div className="flex-1 min-w-0"><div className="text-xs text-muted-foreground leading-tight mb-1">Total Emissions</div><div className="text-2xl font-semibold leading-tight truncate">{n(overview.metrics.total_emissions)} tCO₂e</div><div className="text-[10px] text-muted-foreground mt-0.5">{overview.selected_year}</div></div></div></CardContent></Card>
        <Card className="border-l-4 border-l-red-500"><CardContent className="pt-4 pb-3"><div className="flex items-start justify-between gap-2"><div className="flex-1 min-w-0"><div className="text-xs text-muted-foreground leading-tight mb-1">YoY Change</div><div className="text-2xl font-semibold leading-tight truncate">{overview.metrics.yoy_change != null ? `${overview.metrics.yoy_change > 0 ? "+" : ""}${n(overview.metrics.yoy_change)}%` : "—"}</div></div></div></CardContent></Card>
        <Card className="border-l-4 border-l-blue-500"><CardContent className="pt-4 pb-3"><div className="flex items-start justify-between gap-2"><div className="flex-1 min-w-0"><div className="text-xs text-muted-foreground leading-tight mb-1">Clients</div><div className="text-2xl font-semibold leading-tight truncate">{overview.metrics.total_clients}</div></div></div></CardContent></Card>
        <Card className="border-l-4 border-l-purple-500"><CardContent className="pt-4 pb-3"><div className="flex items-start justify-between gap-2"><div className="flex-1 min-w-0"><div className="text-xs text-muted-foreground leading-tight mb-1">Datasets</div><div className="text-2xl font-semibold leading-tight truncate">{overview.metrics.total_datasets}</div><div className="text-[10px] text-muted-foreground mt-0.5">available</div></div></div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Emissions Trend (tCO₂e)</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {emissionsTrend.length === 0 ? (
            <EmptyChart title="No emissions trend data" description="This dashboard does not have any year-over-year emissions points yet." minHeight="min-h-[220px]" />
          ) : (
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={emissionsTrend} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                  <defs>
                    <linearGradient id="gE" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={MCKINSEY_DATA_COLORS[0]} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={MCKINSEY_DATA_COLORS[0]} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.35} />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${n(+v)} t`} width={64} />
                  <Tooltip formatter={(v: unknown) => [`${n(+Number(v || 0))} tCO₂e`, "Emissions"]} />
                  <Area type="monotone" dataKey="emissions" name="Emissions" stroke={MCKINSEY_DATA_COLORS[0]} fill="url(#gE)" strokeWidth={2.5} dot={{ r: 4, fill: MCKINSEY_DATA_COLORS[0] }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Clients by Industry</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {industryData.length === 0 ? (
              <EmptyChart title="No industry data" description="Client industries are not available for this selection." minHeight="min-h-[220px]" />
            ) : (
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={industryData} layout="vertical" margin={{ top: 0, right: 8, left: 4, bottom: 0 }}>
                    <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={130} />
                    <Tooltip formatter={(v: unknown) => [`${v} clients`, ""]} />
                    <Bar dataKey="value" name="Clients" radius={[0, 4, 4, 0]}>
                      {industryData.map((_, i) => (
                        <Cell key={i} fill={MCKINSEY_DATA_COLORS[i % MCKINSEY_DATA_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Top Emitting Clients</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {topEmittingClients.length === 0 ? (
              <EmptyChart title={`No emissions data for ${overview.selected_year}`} description="There are no emitting clients to chart for this year." minHeight="min-h-[220px]" />
            ) : (
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={topEmittingClients} layout="vertical" margin={{ top: 0, right: 8, left: 4, bottom: 0 }}>
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${n(+v)} t`} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                    <Tooltip formatter={(v: unknown) => [`${n(+Number(v || 0))} tCO₂e`, "Emissions"]} />
                    <Bar dataKey="emissions" radius={[0, 4, 4, 0]}>
                      {topEmittingClients.map((_, i) => (
                        <Cell key={i} fill={MCKINSEY_DATA_COLORS[i % MCKINSEY_DATA_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
