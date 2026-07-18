"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Briefcase, MessageSquare, TrendingUp, Users } from "lucide-react";
import { formatEmissions } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
    reports_issued: number;
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
  if (!value) return "-";
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
        <span className="text-[#1c5026]">{icon}</span>
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
    const fetcher = request ?? ((path: string) => fetch(path));

    fetcher(endpoint)
      .then(async (res: Response) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.detail || `Failed to load portfolio dashboard (${res.status})`);
        }
        return res.json() as Promise<PortfolioOverview>;
      })
      .then((payload: PortfolioOverview) => {
        if (!cancelled) setData(payload);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError((err as Error).message || "Failed to load portfolio dashboard");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [endpoint, request]);

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

  const statusTotal = useMemo(() => statusData.reduce((sum, item) => sum + item.value, 0), [statusData]);
  const maxAnnual = useMemo(() => Math.max(1, ...annualEmissionsData.map((row) => row.total)), [annualEmissionsData]);
  const maxClient = useMemo(() => Math.max(1, ...clientEmissionsData.map((row) => row.value)), [clientEmissionsData]);

  const owner = data?.owner;

  if (loading && !data) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">Loading portfolio dashboard...</div>;
  }

  if (error && !data) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        Failed to load portfolio dashboard: {error}
      </div>
    );
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
                <Badge variant="outline" className="border-slate-200 text-slate-600">
                  {data.summary.total_clients} clients
                </Badge>
                <Badge variant="outline" className="border-slate-200 text-slate-600">
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
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {metricCard({ icon: <Users className="h-4 w-4" />, label: "Clients", value: data.summary.total_clients, sub: `${data.summary.active_clients} active` })}
              {metricCard({ icon: <Briefcase className="h-4 w-4" />, label: "Open Jobs", value: data.summary.open_jobs, sub: `${data.summary.overdue_jobs} overdue milestones` })}
              {metricCard({ icon: <TrendingUp className="h-4 w-4" />, label: "Emissions", value: tco2e(data.summary.total_emissions), sub: "total under management" })}
              {metricCard({ icon: <Briefcase className="h-4 w-4" />, label: "Reports Issued", value: data.summary.reports_issued, sub: "final versions" })}
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
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">No client status data yet.</div>
                ) : (
                  <div className="flex items-center gap-4">
                    <div className="relative flex h-[230px] w-[230px] shrink-0 items-center justify-center">
                      <div
                        className="absolute inset-0 rounded-full"
                        style={{
                          background: `conic-gradient(${statusData
                            .map((item, idx) => {
                              const start = statusData.slice(0, idx).reduce((sum, entry) => sum + entry.value, 0);
                              const from = statusTotal > 0 ? (start / statusTotal) * 100 : 0;
                              const to = statusTotal > 0 ? ((start + item.value) / statusTotal) * 100 : 0;
                              return `${item.color} ${from}% ${to}%`;
                            })
                            .join(", ")})`,
                        }}
                      />
                      <div className="absolute inset-[18%] rounded-full bg-white shadow-inner" />
                      <div className="relative text-center">
                        <div className="text-2xl font-semibold text-slate-900 tabular-nums">{statusTotal}</div>
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">clients</div>
                      </div>
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
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">No year-on-year emissions data yet.</div>
                ) : (
                  <div className="flex h-[260px] items-end gap-3 rounded-xl bg-slate-50 p-4">
                    {annualEmissionsData.map((row) => {
                      const height = Math.max(16, Math.round((row.total / maxAnnual) * 180));
                      return (
                        <div key={row.year} className="flex flex-1 flex-col items-center justify-end gap-2">
                          <div className="text-[11px] font-medium text-slate-500">{tco2e(row.total)}</div>
                          <div className="w-full max-w-[64px] rounded-t-2xl bg-[#1c5026] shadow-sm" style={{ height }} />
                          <div className="text-xs text-slate-500">{row.year}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

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
                    <div className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">No portfolio risks are currently flagged.</div>
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
                              <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-900">{client.risk_score}</td>
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
                    <div className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">No jobs are currently near an SLA deadline.</div>
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

          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-slate-900">Top Clients by Emissions</CardTitle>
            </CardHeader>
            <CardContent>
              {clientEmissionsData.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">No emissions data available for the portfolio yet.</div>
              ) : (
                <div className="space-y-3 rounded-xl bg-slate-50 p-4">
                  {clientEmissionsData.map((client) => {
                    const width = Math.max(8, Math.round((client.value / maxClient) * 100));
                    return (
                      <div key={client.name} className="space-y-1">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="truncate font-medium text-slate-800">{client.name}</span>
                          <span className="shrink-0 tabular-nums text-slate-600">{tco2e(client.value)}</span>
                        </div>
                        <div className="h-3 rounded-full bg-slate-200">
                          <div className="h-3 rounded-full" style={{ width: `${width}%`, backgroundColor: client.color }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

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
                <div className="max-h-[420px] space-y-3 overflow-auto pr-1">
                  {data.recent_notes.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">No notes have been captured for this portfolio yet.</div>
                  ) : (
                    data.recent_notes.map((note) => (
                      <div key={`${note.source_type}-${note.note_id}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-medium text-slate-900">{note.subject || (note.job_title ? note.job_title : "Portfolio note")}</div>
                          <Badge variant="outline" className="border-slate-200 text-slate-600">
                            {fmtDate(note.updated_at || note.created_at)}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {note.client_name}
                          {note.job_number ? ` - Job ${note.job_number}` : ""}
                          {note.author ? ` - ${note.author}` : ""}
                        </div>
                        <div className="mt-2 line-clamp-3 text-sm leading-6 text-slate-700">{note.note_text}</div>
                      </div>
                    ))
                  )}
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
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">No jobs found for this portfolio.</div>
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
                                {job.reporting_year ? ` - ${job.reporting_year}` : ""}
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
