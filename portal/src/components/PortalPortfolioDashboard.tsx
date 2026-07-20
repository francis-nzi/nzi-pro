"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Briefcase, MessageSquare, TrendingUp, Users } from "lucide-react";
import { apiFetch } from "@/lib/auth";
import { formatEmissions } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyStatePanel, ErrorPanel } from "@/components/shared/DataStates";

type PortfolioOverview = {
  ok: boolean;
  portfolio_key: string;
  owner: {
    client_db_id: number;
    client_name: string;
    industry?: string | null;
    description_long?: string | null;
    website?: string | null;
    year_end_month?: string | null;
    company_reg?: string | null;
    sic_code?: string | null;
    headquarters?: string | null;
    addr_line1?: string | null;
    addr_line2?: string | null;
    addr_city?: string | null;
    addr_region?: string | null;
    addr_postcode?: string | null;
    addr_country?: string | null;
    logo_url?: string | null;
    crm_owner?: string | null;
    client_manager?: string | null;
    status?: string | null;
    portfolio?: string | null;
    net_zero_year?: number | null;
    benchmark_year?: number | null;
    benchmark_total_tco2e?: number;
    created_at?: string | null;
    updated_at?: string | null;
  };
  summary: {
    total_clients: number;
    active_clients: number;
    portfolio_owner_clients: number;
    total_contacts: number;
    total_jobs: number;
    open_jobs: number;
    overdue_jobs: number;
    total_emissions: number;
    recent_notes: number;
  };
  risk: {
    critical_clients: number;
    watch_clients: number;
    stale_clients: number;
    no_contact_clients: number;
    no_recent_activity_clients: number;
    overdue_jobs: number;
    due_soon_jobs: number;
    upcoming_jobs: number;
  };
  client_status_breakdown: Array<{ status: string; count: number }>;
  annual_emissions: Array<{ year: number; total_emissions: number }>;
  risk_clients: Array<{
    client_db_id: number;
    client_name: string;
    status?: string | null;
    industry?: string | null;
    job_count: number;
    open_jobs: number;
    overdue_jobs: number;
    total_emissions: number;
    recent_notes: number;
    contact_count: number;
    latest_job_at?: string | null;
    days_since_last_job?: number | null;
    risk_score: number;
    risk_level: "critical" | "watch" | "stable";
    risk_factors: string[];
  }>;
  attention_jobs: Array<{
    job_id: number;
    client_db_id: number;
    client_name: string;
    job_number?: string | null;
    title?: string | null;
    status: string;
    reporting_year?: number | null;
    created_at?: string | null;
    updated_at?: string | null;
    data_collection_due?: string | null;
    first_draft_due?: string | null;
    final_report_due?: string | null;
    total_emissions: number;
    milestone_status: string;
    next_due_at?: string | null;
    next_due_label?: string | null;
    days_until_next_due?: number | null;
    attention_status: string;
  }>;
  clients: Array<{
    client_db_id: number;
    client_name: string;
    status?: string | null;
    industry?: string | null;
    website?: string | null;
    addr_city?: string | null;
    addr_country?: string | null;
    job_count: number;
    open_jobs: number;
    overdue_jobs: number;
    total_emissions: number;
    recent_notes: number;
    contact_count: number;
    latest_job_at?: string | null;
  }>;
  jobs: Array<{
    job_id: number;
    client_db_id: number;
    client_name: string;
    job_number?: string | null;
    title?: string | null;
    status: string;
    reporting_year?: number | null;
    created_at?: string | null;
    updated_at?: string | null;
    data_collection_due?: string | null;
    first_draft_due?: string | null;
    final_report_due?: string | null;
    total_emissions: number;
    milestone_status: string;
  }>;
  recent_notes: Array<{
    note_id: number;
    client_db_id: number;
    job_id?: number | null;
    subject?: string | null;
    note_text: string;
    author?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
    client_name: string;
    job_number?: string | null;
    job_title?: string | null;
    source_type: string;
  }>;
  contacts: Array<{
    contact_id: number;
    client_db_id: number;
    full_name?: string | null;
    job_title?: string | null;
    email?: string | null;
    phone?: string | null;
    is_primary: boolean;
  }>;
};

const CHART_COLORS = ["#0f766e", "#0891b2", "#38bdf8", "#8b5cf6", "#f97316", "#ef4444", "#14b8a6", "#64748b"];

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function tco2e(value: number): string {
  return formatEmissions(value);
}

function riskStyles(level: "critical" | "watch" | "stable"): string {
  if (level === "critical") return "border-rose-200 bg-rose-50 text-rose-700";
  if (level === "watch") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function metricCard({ icon, label, value, sub }: { icon: ReactNode; label: string; value: string | number; sub: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
        <span className="text-muted-foreground">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="mt-3 text-3xl font-semibold text-slate-900 tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{sub}</div>
    </div>
  );
}

export default function PortalPortfolioDashboard({
  endpoint = "/portal/portfolio-dashboard",
  request,
}: {
  endpoint?: string;
  request?: (path: string) => Promise<Response>;
}) {
  const [data, setData] = useState<PortfolioOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (request ?? apiFetch)(endpoint)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.detail || `Failed to load portfolio dashboard (${res.status})`);
        }
        return res.json() as Promise<PortfolioOverview>;
      })
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message || "Failed to load portfolio dashboard");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const statusData = useMemo(() => {
    return (data?.client_status_breakdown ?? []).map((item, idx) => ({
      name: item.status || "Unknown",
      value: item.count,
      color: CHART_COLORS[idx % CHART_COLORS.length],
    }));
  }, [data]);

  const clientEmissionsData = useMemo(() => {
    return (data?.clients ?? []).slice(0, 10).map((client, idx) => ({
      name: client.client_name,
      value: client.total_emissions,
      color: CHART_COLORS[idx % CHART_COLORS.length],
    }));
  }, [data]);

  const annualEmissionsData = useMemo(() => {
    return (data?.annual_emissions ?? []).map((row) => ({
      year: String(row.year),
      total: row.total_emissions,
    }));
  }, [data]);

  const riskClients = data?.risk_clients ?? [];
  const attentionJobs = data?.attention_jobs ?? [];

  const owner = data?.owner;

  if (loading && !data) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">Loading portfolio dashboard...</div>;
  }

  if (error && !data) {
    return <ErrorPanel title="Failed to load portfolio dashboard" description={error} />;
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-6 sm:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-4xl space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-800">Portfolio Portal</Badge>
                <Badge className="border-slate-200 bg-white text-slate-600">
                  {data.summary.total_clients} clients
                </Badge>
                <Badge className="border-slate-200 bg-white text-slate-600">
                  {data.summary.total_jobs} jobs
                </Badge>
              </div>
              <div>
                <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                  {owner?.client_name || data.portfolio_key}
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                  A single view of the portfolio, client delivery status, emissions under management, and the latest notes and jobs that need attention.
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {metricCard({ icon: <Users className="h-4 w-4" />, label: "Clients", value: data.summary.total_clients, sub: `${data.summary.active_clients} active` })}
              {metricCard({ icon: <Briefcase className="h-4 w-4" />, label: "Open Jobs", value: data.summary.open_jobs, sub: `${data.summary.overdue_jobs} overdue milestones` })}
              {metricCard({ icon: <TrendingUp className="h-4 w-4" />, label: "Emissions", value: tco2e(data.summary.total_emissions), sub: "total under management" })}
              {metricCard({ icon: <MessageSquare className="h-4 w-4" />, label: "Notes", value: data.summary.recent_notes, sub: "recent client and job notes" })}
            </div>
          </div>
        </div>

        <div className="space-y-6 px-6 py-6 sm:px-8">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-slate-900">Client Status Mix</CardTitle>
              </CardHeader>
              <CardContent>
                {statusData.length === 0 ? (
                  <EmptyStatePanel title="No client status data yet." />
                ) : (
                  <div className="flex items-center gap-4">
                    <div className="h-[230px] w-[230px] shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={statusData} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="90%" paddingAngle={2}>
                            {statusData.map((entry) => (
                              <Cell key={entry.name} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex-1 space-y-2">
                      {statusData.map((item) => (
                        <div key={item.name} className="flex items-center justify-between gap-3 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                            <span>{item.name}</span>
                          </div>
                          <span className="font-semibold tabular-nums">{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-slate-900">Annual Emissions</CardTitle>
              </CardHeader>
              <CardContent>
                {annualEmissionsData.length === 0 ? (
                  <EmptyStatePanel title="No year-on-year emissions data yet." />
                ) : (
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={annualEmissionsData} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => formatEmissions(Number(value))} />
                        <Tooltip formatter={(value: unknown) => [tco2e(Number(value || 0)), "tCO2e"]} />
                        <Line type="monotone" dataKey="total" stroke="#0f766e" strokeWidth={3} dot={{ r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-slate-900">Top Clients by Emissions</CardTitle>
            </CardHeader>
            <CardContent>
              {clientEmissionsData.length === 0 ? (
                <EmptyStatePanel title="No emissions data available for the portfolio yet." />
              ) : (
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={clientEmissionsData} layout="vertical" margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={150} />
                      <Tooltip formatter={(value: unknown) => [tco2e(Number(value || 0)), "tCO2e"]} />
                      <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                        {clientEmissionsData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50/80 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">SLA and risk</div>
                <h3 className="text-xl font-semibold text-slate-900">What needs attention first</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge className="border border-rose-200 bg-rose-50 text-rose-700">{data.risk.critical_clients} critical clients</Badge>
                <Badge className="border border-amber-200 bg-amber-50 text-amber-700">{data.risk.watch_clients} watchlist clients</Badge>
                <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-700">{data.risk.due_soon_jobs} jobs due in 7 days</Badge>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {metricCard({ icon: <Users className="h-4 w-4" />, label: "Critical clients", value: data.risk.critical_clients, sub: "highest urgency" })}
              {metricCard({ icon: <Briefcase className="h-4 w-4" />, label: "Overdue jobs", value: data.risk.overdue_jobs, sub: "missed SLA milestones" })}
              {metricCard({ icon: <TrendingUp className="h-4 w-4" />, label: "Stale clients", value: data.risk.stale_clients, sub: "no recent job activity" })}
              {metricCard({ icon: <MessageSquare className="h-4 w-4" />, label: "No contacts", value: data.risk.no_contact_clients, sub: "missing relationship owners" })}
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-slate-900">High-risk clients</CardTitle>
                </CardHeader>
                <CardContent>
                  {riskClients.length === 0 ? (
                    <EmptyStatePanel title="No portfolio risks are currently flagged." />
                  ) : (
                    <div className="max-h-[380px] overflow-auto rounded-xl border border-slate-200 bg-white">
                      <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                          <tr>
                            <th className="px-4 py-3">Client</th>
                            <th className="px-4 py-3">Risk</th>
                            <th className="px-4 py-3 text-right">Score</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {riskClients.map((client) => (
                            <tr key={client.client_db_id} className="align-top hover:bg-slate-50/80">
                              <td className="px-4 py-3">
                                <div className="font-medium text-slate-900">{client.client_name}</div>
                                <div className="mt-1 text-xs text-slate-500">
                                  {client.overdue_jobs} overdue, {client.open_jobs} open, {client.contact_count} contacts
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {client.risk_factors.map((factor) => (
                                    <span key={factor} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
                                      {factor}
                                    </span>
                                  ))}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <Badge className={riskStyles(client.risk_level)}>{client.risk_level}</Badge>
                                <div className="mt-2 text-xs text-slate-500">
                                  {client.days_since_last_job == null ? "No recent job activity" : `${client.days_since_last_job} days since last job`}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">{client.risk_score}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-slate-900">Jobs approaching SLA</CardTitle>
                </CardHeader>
                <CardContent>
                  {attentionJobs.length === 0 ? (
                    <EmptyStatePanel title="No jobs are currently near an SLA deadline." />
                  ) : (
                    <div className="max-h-[380px] overflow-auto rounded-xl border border-slate-200 bg-white">
                      <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                          <tr>
                            <th className="px-4 py-3">Job</th>
                            <th className="px-4 py-3">Deadline</th>
                            <th className="px-4 py-3 text-right">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {attentionJobs.map((job) => (
                            <tr key={job.job_id} className="align-top hover:bg-slate-50/80">
                              <td className="px-4 py-3">
                                <div className="font-medium text-slate-900">{job.title || `Job ${job.job_id}`}</div>
                                <div className="mt-1 text-xs text-slate-500">{job.client_name}</div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="text-sm text-slate-700">{job.next_due_label || "Milestone"}</div>
                                <div className="text-xs text-slate-500">{job.next_due_at ? fmtDate(job.next_due_at) : "Unscheduled"}</div>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <Badge
                                  className={
                                    job.attention_status === "overdue"
                                      ? "border-rose-200 bg-rose-50 text-rose-700"
                                      : job.attention_status === "due soon"
                                        ? "border-amber-200 bg-amber-50 text-amber-700"
                                        : "border-slate-200 bg-slate-50 text-slate-600"
                                  }
                                >
                                  {job.attention_status}
                                </Badge>
                                <div className="mt-2 text-xs text-slate-500">
                                  {job.days_until_next_due == null ? "No deadline" : `${job.days_until_next_due} days`}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-slate-900">Portfolio Clients</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <div className="max-h-[420px] overflow-auto">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        <tr>
                          <th className="px-4 py-3">Client</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3 text-right">Jobs</th>
                          <th className="px-4 py-3 text-right">Emissions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.clients.map((client) => (
                          <tr key={client.client_db_id} className="hover:bg-slate-50/80">
                            <td className="px-4 py-3">
                              <div className="font-medium text-slate-900">{client.client_name}</div>
                              <div className="text-xs text-slate-500">
                                {[client.addr_city, client.addr_country].filter(Boolean).join(", ") || client.industry || "No location"}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-slate-600">{client.status || "Active"}</td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {client.job_count}
                              <div className="text-xs text-slate-500">{client.overdue_jobs} overdue</div>
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">{tco2e(client.total_emissions)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-slate-900">Recent Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 max-h-[420px] overflow-auto pr-1">
                  {data.recent_notes.length === 0 ? (
                    <EmptyStatePanel title="No notes have been captured for this portfolio yet." />
                  ) : data.recent_notes.map((note) => (
                    <div key={`${note.source_type}-${note.note_id}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-medium text-slate-900">{note.subject || (note.job_title ? note.job_title : "Portfolio note")}</div>
                        <Badge className="border-slate-200 bg-white text-slate-600">{fmtDate(note.updated_at || note.created_at)}</Badge>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {note.client_name}
                        {note.job_number ? ` · Job ${note.job_number}` : ""}
                        {note.author ? ` · ${note.author}` : ""}
                      </div>
                      <div className="mt-2 text-sm leading-6 text-slate-700 line-clamp-3">{note.note_text}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-slate-900">Open Jobs</CardTitle>
            </CardHeader>
            <CardContent>
              {data.jobs.length === 0 ? (
                <EmptyStatePanel title="No jobs found for this portfolio." />
              ) : (
                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <div className="max-h-[420px] overflow-auto">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        <tr>
                          <th className="px-4 py-3">Job</th>
                          <th className="px-4 py-3">Client</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3 text-right">Emissions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.jobs.map((job) => (
                          <tr key={job.job_id} className="hover:bg-slate-50/80">
                            <td className="px-4 py-3">
                              <div className="font-medium text-slate-900">{job.title || `Job ${job.job_id}`}</div>
                              <div className="text-xs text-slate-500">
                                {job.job_number ? `Job ${job.job_number}` : "No job number"}
                                {job.reporting_year ? ` · ${job.reporting_year}` : ""}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-slate-600">{job.client_name}</td>
                            <td className="px-4 py-3 text-slate-600">
                              <div>{job.status}</div>
                              <div className="text-xs text-slate-500">{job.milestone_status}</div>
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">{tco2e(job.total_emissions)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
