"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function apiBaseUrl(): string {
  return "/api/backend";
}

type Organisation = {
  org_id: string;
  name: string;
  slug: string;
  plan?: string | null;
  plan_status?: string | null;
  max_users?: number | null;
  max_clients?: number | null;
  archived?: boolean | null;
  archived_at?: string | null;
  updated_at?: string | null;
  usage?: {
    max_users?: number | null;
    max_clients?: number | null;
    active_members?: number | null;
    pending_invites?: number | null;
    active_clients?: number | null;
    plan?: string | null;
    plan_status?: string | null;
    archived?: boolean | null;
  } | null;
  entitlement?: {
    subscription_status?: string | null;
    plan?: string | null;
    plan_status?: string | null;
  } | null;
};

type OrganisationsResponse = {
  items?: Organisation[];
  active_org_id?: string | null;
};

type BackgroundJobsStatus = {
  queue_name?: string;
  counts?: {
    queued?: number | null;
    failed?: number | null;
    started?: number | null;
    deferred?: number | null;
    finished?: number | null;
    canceled?: number | null;
  };
};

type FilterMode = "all" | "active" | "archived" | "over_limit" | "needs_attention";

function formatCount(value?: number | null): string {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString() : "0";
}

function formatUsage(used?: number | null, limit?: number | null): string {
  const usedValue = Number(used || 0);
  const limitValue = Number(limit || 0);
  if (!Number.isFinite(limitValue) || limitValue <= 0) return `${usedValue}`;
  return `${usedValue}/${limitValue}`;
}

function usagePercent(used?: number | null, limit?: number | null): number | null {
  const usedValue = Number(used || 0);
  const limitValue = Number(limit || 0);
  if (!Number.isFinite(limitValue) || limitValue <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((usedValue / limitValue) * 100)));
}

function meetsLimit(used?: number | null, limit?: number | null): boolean {
  const usedValue = Number(used || 0);
  const limitValue = Number(limit || 0);
  return Number.isFinite(limitValue) && limitValue > 0 && usedValue >= limitValue;
}

function isNearLimit(used?: number | null, limit?: number | null): boolean {
  const pct = usagePercent(used, limit);
  return pct != null && pct >= 80 && pct < 100;
}

export default function TenantUsagePage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<FilterMode>("all");
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<BackgroundJobsStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setLoading(true);
      setError("");
      try {
        const [orgRes, jobRes] = await Promise.all([
          fetch(`${baseUrl}/admin/organisations`, { credentials: "include" }),
          fetch(`${baseUrl}/admin/background-jobs/status`, { credentials: "include" }),
        ]);
        const orgPayload = (await orgRes.json().catch(() => ({}))) as OrganisationsResponse;
        const jobPayload = (await jobRes.json().catch(() => ({}))) as BackgroundJobsStatus;
        if (!orgRes.ok) {
          const detail = (orgPayload as { detail?: unknown }).detail;
          throw new Error(typeof detail === "string" ? detail : `Failed to load organisations (${orgRes.status})`);
        }
        if (!jobRes.ok) {
          const detail = (jobPayload as { detail?: unknown }).detail;
          throw new Error(typeof detail === "string" ? detail : `Failed to load background jobs (${jobRes.status})`);
        }
        if (cancelled) return;
        setOrganisations(Array.isArray(orgPayload.items) ? orgPayload.items : []);
        setActiveOrgId(orgPayload.active_org_id || null);
        setJobs(jobPayload);
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setOrganisations([]);
          setJobs(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadData();
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return organisations.filter((org) => {
      const usage = org.usage || {};
      const activeUsers = usage.active_members ?? 0;
      const activeClients = usage.active_clients ?? 0;
      const maxUsers = usage.max_users ?? org.max_users ?? 0;
      const maxClients = usage.max_clients ?? org.max_clients ?? 0;
      const archived = Boolean(usage.archived ?? org.archived);
      const overLimit = meetsLimit(activeUsers, maxUsers) || meetsLimit(activeClients, maxClients);
      const nearLimit = isNearLimit(activeUsers, maxUsers) || isNearLimit(activeClients, maxClients) || (usage.pending_invites ?? 0) > 0;
      if (mode === "active" && archived) return false;
      if (mode === "archived" && !archived) return false;
      if (mode === "over_limit" && !overLimit) return false;
      if (mode === "needs_attention" && !nearLimit && !overLimit) return false;
      if (!q) return true;
      const target = `${org.name} ${org.slug} ${org.plan} ${org.plan_status} ${org.entitlement?.subscription_status}`.toLowerCase();
      return target.includes(q);
    });
  }, [mode, organisations, query]);

  const metrics = useMemo(() => {
    const active = organisations.filter((org) => !Boolean(org.archived ?? org.usage?.archived));
    const archived = organisations.filter((org) => Boolean(org.archived ?? org.usage?.archived));
    const overLimit = organisations.filter((org) => {
      const usage = org.usage || {};
      return meetsLimit(usage.active_members, usage.max_users ?? org.max_users) || meetsLimit(usage.active_clients, usage.max_clients ?? org.max_clients);
    });
    const needsAttention = organisations.filter((org) => {
      const usage = org.usage || {};
      return (
        isNearLimit(usage.active_members, usage.max_users ?? org.max_users) ||
        isNearLimit(usage.active_clients, usage.max_clients ?? org.max_clients) ||
        (usage.pending_invites ?? 0) > 0
      );
    });
    const usersUsed = organisations.reduce((sum, org) => sum + Number(org.usage?.active_members || 0), 0);
    const usersLimit = organisations.reduce((sum, org) => sum + Number(org.usage?.max_users || org.max_users || 0), 0);
    const clientsUsed = organisations.reduce((sum, org) => sum + Number(org.usage?.active_clients || 0), 0);
    const clientsLimit = organisations.reduce((sum, org) => sum + Number(org.usage?.max_clients || org.max_clients || 0), 0);
    const pendingInvites = organisations.reduce((sum, org) => sum + Number(org.usage?.pending_invites || 0), 0);
    return {
      total: organisations.length,
      active: active.length,
      archived: archived.length,
      overLimit: overLimit.length,
      needsAttention: needsAttention.length,
      usersUsed,
      usersLimit,
      clientsUsed,
      clientsLimit,
      pendingInvites,
    };
  }, [organisations]);

  const queueCounts = jobs?.counts ?? {};

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10 space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold" style={{ color: "#F26624" }}>
                Tenant Usage Dashboard
              </h1>
              {activeOrgId ? <Badge variant="outline">Active: {activeOrgId}</Badge> : null}
            </div>
            <p className="text-muted-foreground">
              Operational overview of org capacity, archive state, and queue health.
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => window.location.reload()} disabled={loading}>
              {loading ? "Loading..." : "Refresh"}
            </Button>
            <Button variant="secondary" asChild>
              <Link href="/admin">{"<-"} Back to Admin</Link>
            </Button>
          </div>
        </div>

        {error ? <div className="rounded border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div> : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle>Total Orgs</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{formatCount(metrics.total)}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Near / Over Limit</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {formatCount(metrics.needsAttention)} / {formatCount(metrics.overLimit)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Users Capacity</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {formatUsage(metrics.usersUsed, metrics.usersLimit)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Clients Capacity</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {formatUsage(metrics.clientsUsed, metrics.clientsLimit)}
            </CardContent>
          </Card>
        </div>

        <Card className="border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle>Queue Health</CardTitle>
            <CardDescription>PDF generation worker and recent queue state.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
            <div className="rounded border bg-background p-3 text-sm">Queued: <strong>{formatCount(queueCounts.queued)}</strong></div>
            <div className="rounded border bg-background p-3 text-sm">Failed: <strong>{formatCount(queueCounts.failed)}</strong></div>
            <div className="rounded border bg-background p-3 text-sm">Started: <strong>{formatCount(queueCounts.started)}</strong></div>
            <div className="rounded border bg-background p-3 text-sm">Deferred: <strong>{formatCount(queueCounts.deferred)}</strong></div>
            <div className="rounded border bg-background p-3 text-sm">Finished: <strong>{formatCount(queueCounts.finished)}</strong></div>
            <div className="rounded border bg-background p-3 text-sm">Canceled: <strong>{formatCount(queueCounts.canceled)}</strong></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <CardTitle>Organisation Usage</CardTitle>
                <CardDescription>Scan capacity, archive state, and usage pressure at a glance.</CardDescription>
              </div>
              <div className="w-full md:w-[320px]">
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search org name or slug..." />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {([
                ["all", "All"],
                ["active", "Active"],
                ["archived", "Archived"],
                ["needs_attention", "Needs attention"],
                ["over_limit", "Over limit"],
              ] as const).map(([value, label]) => (
                <Button
                  key={value}
                  variant={mode === value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setMode(value)}
                >
                  {label}
                </Button>
              ))}
            </div>

            {loading ? (
              <div className="text-sm text-muted-foreground">Loading tenant usage snapshot...</div>
            ) : rows.length === 0 ? (
              <div className="text-sm text-muted-foreground">No organisations match the current filters.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organisation</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Users</TableHead>
                    <TableHead>Clients</TableHead>
                    <TableHead>Invites</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((org) => {
                    const usage = org.usage || {};
                    const activeUsers = usage.active_members ?? 0;
                    const maxUsers = usage.max_users ?? org.max_users ?? 0;
                    const activeClients = usage.active_clients ?? 0;
                    const maxClients = usage.max_clients ?? org.max_clients ?? 0;
                    const pendingInvites = usage.pending_invites ?? 0;
                    const archived = Boolean(usage.archived ?? org.archived);
                    const overUsers = meetsLimit(activeUsers, maxUsers);
                    const overClients = meetsLimit(activeClients, maxClients);
                    const nearUsers = isNearLimit(activeUsers, maxUsers);
                    const nearClients = isNearLimit(activeClients, maxClients);
                    const statusVariant = archived ? "outline" : overUsers || overClients ? "destructive" : nearUsers || nearClients ? "secondary" : "default";
                    return (
                      <TableRow key={org.org_id}>
                        <TableCell>
                          <div className="font-medium">{org.name}</div>
                          <div className="text-xs text-muted-foreground">{org.slug}</div>
                        </TableCell>
                        <TableCell>
                          <div>{org.entitlement?.plan || org.plan || "trial"}</div>
                          <div className="text-xs text-muted-foreground">
                            {org.entitlement?.subscription_status || org.plan_status || "active"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className={overUsers ? "font-semibold text-destructive" : nearUsers ? "font-semibold text-amber-600" : ""}>
                            {formatUsage(activeUsers, maxUsers)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className={overClients ? "font-semibold text-destructive" : nearClients ? "font-semibold text-amber-600" : ""}>
                            {formatUsage(activeClients, maxClients)}
                          </div>
                        </TableCell>
                        <TableCell>{formatCount(pendingInvites)}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant}>{archived ? "Archived" : overUsers || overClients ? "Over limit" : nearUsers || nearClients ? "Needs attention" : "Healthy"}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            <Button asChild size="sm" variant="outline">
                              <Link href="/admin/organisations">Manage</Link>
                            </Button>
                            <Button asChild size="sm" variant="outline">
                              <Link href="/admin/billing">Billing</Link>
                            </Button>
                            <Button asChild size="sm" variant="outline">
                              <Link href="/support">Support</Link>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>Active orgs: {formatCount(metrics.active)}</div>
              <div>Archived orgs: {formatCount(metrics.archived)}</div>
              <div>Org(s) needing attention: {formatCount(metrics.needsAttention)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Pending Invites</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{formatCount(metrics.pendingInvites)}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Queue Snapshot</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>Queue: {jobs?.queue_name || "-"}</div>
              <div>Failed jobs: {formatCount(queueCounts.failed)}</div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
