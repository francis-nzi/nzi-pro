"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { milestoneDotClass, toneForMilestone } from "@/lib/status-utils";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api/backend";
}

type JobListItem = {
  job_id: number;
  job_number: string | null;
  title: string | null;
  reporting_year: number | null;
  reporting_period_start: string | null;
  reporting_period_end: string | null;
  is_benchmark: boolean | null;
  status: string | null;
  client_db_id: number;
  client_name: string | null;
  crm_name: string | null;
  due_date: string | null;
  milestone_status?: string | null;
};

type TeamUser = {
  full_name: string;
  status: string;
};

type SortBy = "job" | "client" | "title" | "crm" | "due" | "status" | "risk";

export default function JobsPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);

  const [q, setQ] = useState("");
  const [crmFilter, setCrmFilter] = useState("");
  const [items, setItems] = useState<JobListItem[]>([]);
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [crmList, setCrmList] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortBy>("due");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    async function loadTeamMembers() {
      try {
        const res = await fetch(`${baseUrl}/admin/users`, {
          credentials: "include",
        });
        if (res.ok) {
          const json = await res.json();
          const activeUsers = ((json.items ?? []) as TeamUser[])
            .filter((user) => user.status === "Active")
            .map((user) => user.full_name)
            .sort();
          setCrmList(activeUsers);
        }
      } catch {
        setCrmList([]);
      }
    }
    loadTeamMembers();
  }, [baseUrl]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (q.trim()) params.set("q", q.trim());
        if (crmFilter.trim()) params.set("crm", crmFilter.trim());
        params.set("limit", String(limit));
        params.set("offset", String(offset));

        const res = await fetch(`${baseUrl}/jobs?${params.toString()}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const json = await res.json();
        if (cancelled) return;
        setItems(json.items ?? []);
        setTotal(Number(json.total ?? 0));
      } catch (e) {
        if (cancelled) return;
        setItems([]);
        setTotal(0);
        setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    const t = setTimeout(load, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [baseUrl, q, crmFilter, limit, offset]);

  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "-";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }

  function riskFromMilestone(milestoneStatus: string | null | undefined): "Overdue" | "Due" | "Healthy" {
    const tone = toneForMilestone(milestoneStatus);
    if (tone === "danger") return "Overdue";
    if (tone === "warning") return "Due";
    return "Healthy";
  }

  function riskBadgeClass(risk: "Overdue" | "Due" | "Healthy"): string {
    if (risk === "Overdue") return "bg-rose-100 text-rose-800";
    if (risk === "Due") return "bg-amber-100 text-amber-800";
    return "bg-emerald-100 text-emerald-800";
  }

  const sortedItems = useMemo(() => {
    function valueFor(job: JobListItem): string | number {
      if (sortBy === "job") return (job.job_number ?? `job-${job.job_id}`).toLowerCase();
      if (sortBy === "client") return (job.client_name ?? "").toLowerCase();
      if (sortBy === "title") return (job.title ?? "").toLowerCase();
      if (sortBy === "crm") return (job.crm_name ?? "").toLowerCase();
      if (sortBy === "status") return (job.status ?? "").toLowerCase();
      if (sortBy === "due") return job.due_date ? new Date(job.due_date).getTime() : Number.MAX_SAFE_INTEGER;
      const risk = riskFromMilestone(job.milestone_status);
      return risk === "Overdue" ? 0 : risk === "Due" ? 1 : 2;
    }

    return [...items].sort((a, b) => {
      const av = valueFor(a);
      const bv = valueFor(b);
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [items, sortBy, sortDir]);

  function toggleSort(next: SortBy) {
    if (sortBy === next) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(next);
    setSortDir("asc");
  }

  function sortLabel(label: string, key: SortBy): string {
    if (sortBy !== key) return label;
    return `${label} ${sortDir === "asc" ? "^" : "v"}`;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <PageHeader
          title="Jobs"
          subtitle={`${total} total`}
          breadcrumbs={[{ label: "Jobs" }]}
          actions={
            <>
              <Button asChild>
                <Link href="/jobs/new">+ Add Job</Link>
              </Button>
              <Button variant="secondary" asChild>
                <Link href="/">Back to Hub</Link>
              </Button>
            </>
          }
        />

        <Card>
          <CardHeader>
            <CardTitle>Search</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="sticky top-16 z-20 rounded-md border bg-background/95 p-4 backdrop-blur">
              <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="font-medium">Traffic-light legend:</span>
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-rose-800">Overdue</span>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">Due</span>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">Healthy</span>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="q">Search</Label>
                  <Input
                    id="q"
                    placeholder="Job number, client, or title..."
                    value={q}
                    onChange={(e) => {
                      setQ(e.target.value);
                      setOffset(0);
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="crmFilter">CRM Filter</Label>
                  <Select
                    value={crmFilter || "__all__"}
                    onValueChange={(v) => {
                      setCrmFilter(v === "__all__" ? "" : v);
                      setOffset(0);
                    }}
                  >
                    <SelectTrigger id="crmFilter" className="w-full">
                      <SelectValue placeholder="All CRMs" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All CRMs</SelectItem>
                      {crmList.map((crm) => (
                        <SelectItem key={crm} value={crm}>
                          {crm}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="limit">Page size</Label>
                  <Select
                    value={String(limit)}
                    onValueChange={(v) => {
                      setLimit(Number(v));
                      setOffset(0);
                    }}
                  >
                    <SelectTrigger id="limit" className="w-full">
                      <SelectValue placeholder="Page size" />
                    </SelectTrigger>
                    <SelectContent>
                      {[25, 50, 100, 200].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={loading || offset <= 0}
                  onClick={() => setOffset((v) => Math.max(0, v - limit))}
                >
                  Prev
                </Button>
                <Button
                  variant="outline"
                  disabled={loading || offset + limit >= total}
                  onClick={() => setOffset((v) => v + limit)}
                >
                  Next
                </Button>
              </div>
            </div>

            {error ? <div className="text-sm text-destructive">{error}</div> : null}

            <div className="rounded-md border">
              <div className="grid grid-cols-13 gap-2 border-b bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
                <div className="col-span-1"></div>
                <button className="col-span-2 text-left hover:text-foreground" onClick={() => toggleSort("job")}>{sortLabel("Job", "job")}</button>
                <button className="col-span-2 text-left hover:text-foreground" onClick={() => toggleSort("client")}>{sortLabel("Client", "client")}</button>
                <div className="col-span-2">Reporting Period</div>
                <button className="col-span-2 text-left hover:text-foreground" onClick={() => toggleSort("title")}>{sortLabel("Title", "title")}</button>
                <button className="col-span-1 text-left hover:text-foreground" onClick={() => toggleSort("crm")}>{sortLabel("CRM", "crm")}</button>
                <button className="col-span-1 text-left hover:text-foreground" onClick={() => toggleSort("due")}>{sortLabel("End Date", "due")}</button>
                <button className="col-span-1 text-left hover:text-foreground" onClick={() => toggleSort("status")}>{sortLabel("Status", "status")}</button>
                <button className="col-span-1 text-left hover:text-foreground" onClick={() => toggleSort("risk")}>{sortLabel("Risk", "risk")}</button>
              </div>
              {loading ? (
                <div className="px-3 py-3 text-sm text-muted-foreground">Loading...</div>
              ) : sortedItems.length === 0 ? (
                <div className="px-3 py-3 text-sm text-muted-foreground">No jobs found.</div>
              ) : (
                <div className="divide-y">
                  {sortedItems.map((j) => {
                    const statusColor = milestoneDotClass(j.milestone_status);
                    const risk = riskFromMilestone(j.milestone_status);
                    return (
                      <Link
                        key={j.job_id}
                        href={`/jobs/${j.job_id}`}
                        className="grid grid-cols-13 gap-2 px-3 py-2 text-sm hover:bg-muted"
                      >
                        <div className="col-span-1 flex items-center">
                          <div className={`h-3 w-3 rounded-full ${statusColor}`} title={`Milestone status: ${j.milestone_status || "none"}`} />
                        </div>
                        <div className="col-span-2 font-medium">{j.job_number ?? `Job ${j.job_id}`}</div>
                        <div className="col-span-2">{j.client_name ?? ""}</div>
                        <div className="col-span-2">
                          {j.reporting_period_start && j.reporting_period_end ? (
                            <div className="text-xs">
                              {new Date(j.reporting_period_start).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })} -{" "}
                              {new Date(j.reporting_period_end).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">{j.reporting_year || "-"}</span>
                          )}
                        </div>
                        <div className="col-span-2">{j.title ?? ""}</div>
                        <div className="col-span-1 text-muted-foreground">{j.crm_name ?? "-"}</div>
                        <div className="col-span-1">
                          {formatDate(j.due_date)}
                        </div>
                        <div className="col-span-1">
                          <StatusBadge status={j.status} />
                        </div>
                        <div className="col-span-1">
                          <span className={`rounded-full px-2 py-0.5 text-xs ${riskBadgeClass(risk)}`}>{risk}</span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
