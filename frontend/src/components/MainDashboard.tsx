"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import StatusBadge from "@/components/StatusBadge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { milestoneDotClass } from "@/lib/status-utils";

type DashboardOverview = {
  selected_year: number;
  available_years: number[];
  available_industries: string[];
  available_crm: string[];
  year_trend: Array<{ year: number | null; total_emissions: number }>;
  industry_breakdown: Array<{ industry: string; client_count: number }>;
  metrics: {
    total_clients: number;
    total_emissions: number;
    active_jobs: number;
    total_datasets: number;
    yoy_change: number | null;
  };
  job_status_breakdown: Array<{
    status: string;
    count: number;
  }>;
  top_emitting_clients: Array<{
    client_name: string;
    client_id: number;
    emissions: number;
  }>;
  recent_activity: Array<{
    job_id: number;
    title: string;
    reporting_year: number | null;
    status: string;
    client_name: string;
    start_date: string | null;
    milestone_status?: string | null;
  }>;
  jobs_per_crm: Array<{
    crm_name: string;
    total_jobs: number;
    statuses: { [key: string]: number };
  }>;
};

type MainDashboardProps = {
  baseUrl: string;
};

type JobsMilestoneStatus = {
  green: number;
  amber: number;
  red: number;
  no_milestones: number;
  total: number;
};

const ALL_FILTER_VALUE = "__all__";

const EMPTY_JOBS_STATUS: JobsMilestoneStatus = {
  green: 0,
  amber: 0,
  red: 0,
  no_milestones: 0,
  total: 0,
};

function normalizeBaseUrl(url: string): string {
  const trimmed = String(url || "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/\/+$/, "");
}

export default function MainDashboard({ baseUrl }: MainDashboardProps) {
  const apiBaseUrl = useMemo(() => normalizeBaseUrl(baseUrl), [baseUrl]);
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [jobsStatus, setJobsStatus] = useState<JobsMilestoneStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
  const [selectedCrm, setSelectedCrm] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(true);

  const fetchJsonWithTimeout = useCallback(async (url: string, init: RequestInit, timeoutMs: number, label: string) => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
      }
      throw e;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }, []);

  const loadDashboard = useCallback(async (year: number | null) => {
    try {
      if (!apiBaseUrl) {
        throw new Error("API base URL is not configured");
      }
      setLoading(true);
      let url = `${apiBaseUrl}/dashboard/overview`;
      const params: string[] = [];
      if (year) params.push(`year=${year}`);
      if (selectedIndustry) params.push(`industry=${encodeURIComponent(selectedIndustry)}`);
      if (selectedCrm) params.push(`crm_owner=${encodeURIComponent(selectedCrm)}`);
      if (params.length) url += `?${params.join("&")}`;
      
      const res = await fetchJsonWithTimeout(url, { cache: "no-store" }, 60000, "Dashboard overview");
      if (!res.ok) throw new Error("Failed to load dashboard data");
      const json = await res.json();
      setData(json);
      setError("");
      
      // Set selected year from response if not already set
      if (year === null) {
        setSelectedYear(json.selected_year);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, fetchJsonWithTimeout, selectedIndustry, selectedCrm]);

  const loadJobsStatus = useCallback(async () => {
    try {
      if (!apiBaseUrl) {
        setJobsStatus(EMPTY_JOBS_STATUS);
        return;
      }

      const res = await fetchJsonWithTimeout(`${apiBaseUrl}/dashboard/jobs-by-milestone-status`, {
        cache: "no-store",
      }, 15000, "Jobs milestone status");

      if (!res.ok) {
        setJobsStatus(EMPTY_JOBS_STATUS);
        return;
      }

      const json = await res.json();
      setJobsStatus(json);
    } catch {
      // Keep dashboard usable even if milestone summary endpoint is unavailable
      setJobsStatus(EMPTY_JOBS_STATUS);
    }
  }, [apiBaseUrl, fetchJsonWithTimeout]);

  useEffect(() => {
    void loadDashboard(selectedYear);
    void loadJobsStatus();
  }, [selectedYear, selectedIndustry, selectedCrm, loadDashboard, loadJobsStatus]);

  if (loading) {
    return <div className="text-center py-8">Loading dashboard...</div>;
  }

  if (error) {
    return <div className="text-center py-8 text-red-500">Error: {error}</div>;
  }

  if (!data) {
    return <div className="text-center py-8">No data available</div>;
  }

  const formatNumber = (num: number) => {
    return num.toLocaleString(undefined, { maximumFractionDigits: 1 });
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "N/A";
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-GB');
  };

  return (
    <div className="space-y-6">
      {/* Header + filter toggle */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold" style={{ color: '#F26624' }}>Dashboard Overview</h2>
        <Button size="sm" variant="outline" onClick={() => setShowFilters(!showFilters)}>
          {showFilters ? 'Hide filters' : 'Show filters'}
        </Button>
      </div>

      {/* Filters (collapsible) */}
      {showFilters && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Reporting Year:</span>
            <Select 
              value={selectedYear?.toString() || ""} 
              onValueChange={(v) => setSelectedYear(Number(v))}
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Select year..." />
              </SelectTrigger>
              <SelectContent>
                {data.available_years.map((year) => (
                  <SelectItem key={year} value={year.toString()}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {data.available_industries && data.available_industries.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Industry:</span>
              <Select
                value={selectedIndustry ?? ALL_FILTER_VALUE}
                onValueChange={(v) => setSelectedIndustry(v === ALL_FILTER_VALUE ? null : v)}
              >
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>All</SelectItem>
                  {data.available_industries.map((ind) => (
                    <SelectItem key={ind} value={ind}>
                      {ind}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {data.available_crm && data.available_crm.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">CRM:</span>
              <Select
                value={selectedCrm ?? ALL_FILTER_VALUE}
                onValueChange={(v) => setSelectedCrm(v === ALL_FILTER_VALUE ? null : v)}
              >
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>All</SelectItem>
                  {data.available_crm.map((crm) => (
                    <SelectItem key={crm} value={crm}>
                      {crm}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}

      {/* Key Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Total Clients</div>
              <div className="text-3xl font-bold">{data.metrics.total_clients}</div>
              <div className="text-xs text-muted-foreground">Active clients</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">Total Emissions</div>
                {data.metrics.yoy_change !== null && (
                  <div className={`text-xs font-medium ${data.metrics.yoy_change > 0 ? 'text-red-500' : 'text-green-500'}`}>
                    {data.metrics.yoy_change > 0 ? '+' : ''}{data.metrics.yoy_change.toFixed(1)}%
                  </div>
                )}
              </div>
              <div className="text-3xl font-bold">{formatNumber(data.metrics.total_emissions)}</div>
              <div className="text-xs text-muted-foreground">tCO2e ({data.selected_year})</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Active Jobs</div>
              <div className="text-3xl font-bold">{data.metrics.active_jobs}</div>
              <div className="text-xs text-muted-foreground">In progress</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Datasets</div>
              <div className="text-3xl font-bold">{data.metrics.total_datasets}</div>
              <div className="text-xs text-muted-foreground">Available</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Total Jobs</div>
              <div className="text-3xl font-bold">
                {data.job_status_breakdown.reduce((sum, s) => sum + s.count, 0)}
              </div>
              <div className="text-xs text-muted-foreground">All statuses</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Emissions trend chart + industry breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {data.year_trend && data.year_trend.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Emissions Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end h-40 gap-2">
              {data.year_trend.map((y, i) => {
                const height = y.total_emissions || 0;
                const max = Math.max(...data.year_trend.map(t => t.total_emissions), 1);
                const pct = (height / max) * 100;
                return (
                  <div key={i} className="flex flex-col items-center">
                    <div
                      className="w-6 bg-teal-500 rounded-t transition-all"
                      style={{ height: `${pct}%` }}
                      title={`${y.year}: ${height.toLocaleString(undefined,{maximumFractionDigits:1})} tCO2e`}
                    />
                    <div className="text-xs mt-1">{y.year}</div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

        {/* Industry breakdown */}
        {data.industry_breakdown && data.industry_breakdown.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Clients by Industry</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data.industry_breakdown.map((ind, idx) => (
                  <div key={idx} className="flex justify-between text-sm">
                    <span>{ind.industry}</span>
                    <span className="text-muted-foreground">{ind.client_count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Jobs by Milestone Status */}
      {jobsStatus && (
        <Card>
          <CardHeader>
            <CardTitle>Jobs by Milestone Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="flex items-center gap-3 p-3 border rounded-lg">
                <div className={`w-4 h-4 rounded-full ${milestoneDotClass("green")}`} />
                <div>
                  <div className="text-2xl font-bold">{jobsStatus.green}</div>
                  <div className="text-xs text-muted-foreground">Green - On Track</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 border rounded-lg">
                <div className={`w-4 h-4 rounded-full ${milestoneDotClass("amber")}`} />
                <div>
                  <div className="text-2xl font-bold">{jobsStatus.amber}</div>
                  <div className="text-xs text-muted-foreground">Amber - Due Soon</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 border rounded-lg">
                <div className={`w-4 h-4 rounded-full ${milestoneDotClass("red")}`} />
                <div>
                  <div className="text-2xl font-bold">{jobsStatus.red}</div>
                  <div className="text-xs text-muted-foreground">Red - Overdue</div>
                </div>
              </div>
            </div>
            {jobsStatus.no_milestones > 0 && (
              <div className="mt-3 text-sm text-muted-foreground text-center">
                {jobsStatus.no_milestones} job(s) without milestones
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Job Status Breakdown and Top Clients */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Job Status Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>Job Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.job_status_breakdown.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-4">
                  No jobs found
                </div>
              ) : (
                data.job_status_breakdown.map((status, idx) => {
                  const total = data.job_status_breakdown.reduce((sum, s) => sum + s.count, 0);
                  const percentage = total > 0 ? (status.count / total) * 100 : 0;
                  
                  return (
                    <div key={idx} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{status.status || 'Unknown'}</span>
                        <span className="text-muted-foreground">{status.count} ({percentage.toFixed(0)}%)</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-teal-600 rounded-full transition-all"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        {/* Top Emitting Clients */}
        <Card>
          <CardHeader>
            <CardTitle>Top Emitting Clients ({data.selected_year})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.top_emitting_clients.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-4">
                  No emissions data for {data.selected_year}
                </div>
              ) : (
                data.top_emitting_clients.map((client, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <Link 
                      href={`/clients/${client.client_id}`}
                      className="text-sm font-medium hover:underline flex-1"
                    >
                      {idx + 1}. {client.client_name}
                    </Link>
                    <span className="text-sm text-muted-foreground">
                      {formatNumber(client.emissions)} tCO2e
                    </span>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Jobs per CRM by Status */}
      <Card>
        <CardHeader>
          <CardTitle>Jobs per CRM by Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {data.jobs_per_crm.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                No CRM assignments found
              </div>
            ) : (
              data.jobs_per_crm.map((crm, idx) => {
                const statuses = Object.entries(crm.statuses);
                const statusColors: { [key: string]: string } = {
                  'Open': 'bg-blue-500',
                  'Data Gathering Phase': 'bg-yellow-500',
                  'Reporting Phase': 'bg-orange-500',
                  'Review': 'bg-purple-500',
                  'Completed': 'bg-green-500',
                  'Archived': 'bg-gray-400',
                  'Cancelled': 'bg-red-500',
                  'Unknown': 'bg-gray-300'
                };

                return (
                  <div key={idx} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{crm.crm_name}</span>
                      <span className="text-sm text-muted-foreground">{crm.total_jobs} jobs</span>
                    </div>
                    
                    {/* Stacked bar chart */}
                    <div className="h-8 flex rounded-md overflow-hidden">
                      {statuses.map(([status, count], sIdx) => {
                        const percentage = (count / crm.total_jobs) * 100;
                        const color = statusColors[status] || 'bg-gray-300';
                        
                        return (
                          <div
                            key={sIdx}
                            className={`${color} hover:opacity-80 cursor-pointer transition-opacity`}
                            style={{ width: `${percentage}%` }}
                            title={`${status}: ${count} (${percentage.toFixed(0)}%)`}
                          />
                        );
                      })}
                    </div>
                    
                    {/* Status legend for this CRM */}
                    <div className="flex flex-wrap gap-2 text-xs">
                      {statuses.map(([status, count], sIdx) => {
                        const color = statusColors[status] || 'bg-gray-300';
                        return (
                          <div key={sIdx} className="flex items-center gap-1">
                            <div className={`w-3 h-3 rounded ${color}`}></div>
                            <span className="text-muted-foreground">{status}: {count}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Recent Jobs</CardTitle>
            <Button variant="outline" size="sm" asChild>
              <Link href="/jobs">View All</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {data.recent_activity.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                No recent jobs
              </div>
            ) : (
              data.recent_activity.map((job) => {
                const statusColor = milestoneDotClass(job.milestone_status);
                
                return (
                  <div key={job.job_id} className="flex items-center gap-3 border-b pb-3 last:border-0">
                    <div className="flex-shrink-0">
                      <div 
                        className={`w-3 h-3 rounded-full ${statusColor}`} 
                        title={`Milestone status: ${job.milestone_status || 'none'}`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <Link 
                        href={`/jobs/${job.job_id}`}
                        className="font-medium hover:underline block truncate"
                      >
                        {job.title || `Job #${job.job_id}`}
                      </Link>
                      <div className="text-sm text-muted-foreground">
                        {job.client_name} • {job.reporting_year || 'N/A'}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 text-right flex-shrink-0">
                      <StatusBadge status={job.status} />
                      <div className="text-xs text-muted-foreground">
                        {formatDate(job.start_date)}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
