"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiUrl } from "@/lib/auth-client";

type AuditLogItem = {
  audit_id: number;
  created_at: string;
  org_id: string | null;
  org_name: string | null;
  actor_user_id: number | null;
  actor_email: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | number | null;
  client_id: number | null;
  client_name: string | null;
  job_id: number | null;
  job_number: string | null;
  page: string | null;
  section: string | null;
  container: string | null;
  route: string | null;
  method: string | null;
  before_json: unknown;
  after_json: unknown;
  diff_json: unknown;
  metadata_json: unknown;
  ip_address: string | null;
  user_agent: string | null;
};

type AuditLogResponse = {
  items: AuditLogItem[];
  total: number;
  limit: number;
  offset: number;
};

type FilterState = {
  orgId: string;
  eventGroup: string;
  q: string;
  actorEmail: string;
  entityType: string;
  action: string;
  clientId: string;
  jobId: string;
};

const DEFAULT_FILTERS: FilterState = {
  orgId: "",
  eventGroup: "",
  q: "",
  actorEmail: "",
  entityType: "",
  action: "",
  clientId: "",
  jobId: "",
};

function fmtDate(value: string): string {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString("en-GB");
}

function stringifyJson(value: unknown): string {
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function PaginationControls({
  total,
  pageStart,
  pageEnd,
  offset,
  limit,
  loading,
  onPrevious,
  onNext,
}: {
  total: number;
  pageStart: number;
  pageEnd: number;
  offset: number;
  limit: number;
  loading: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  if (total === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm text-muted-foreground">Showing {pageStart}-{pageEnd} of {total}</div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={offset <= 0 || loading}
          onClick={onPrevious}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          disabled={loading || offset + limit >= total}
          onClick={onNext}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

export default function AuditLogPage() {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [data, setData] = useState<AuditLogResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [offset, setOffset] = useState<number>(0);
  const [exporting, setExporting] = useState<boolean>(false);
  const limit = 50;

  const baseQueryString = useMemo(() => {
    const params = new URLSearchParams();
    if (appliedFilters.orgId.trim()) params.set("org_id", appliedFilters.orgId.trim());
    if (appliedFilters.eventGroup.trim()) params.set("event_group", appliedFilters.eventGroup.trim());
    if (appliedFilters.q.trim()) params.set("q", appliedFilters.q.trim());
    if (appliedFilters.actorEmail.trim()) params.set("actor_email", appliedFilters.actorEmail.trim());
    if (appliedFilters.entityType.trim()) params.set("entity_type", appliedFilters.entityType.trim());
    if (appliedFilters.action.trim()) params.set("action", appliedFilters.action.trim());
    if (appliedFilters.clientId.trim()) params.set("client_id", appliedFilters.clientId.trim());
    if (appliedFilters.jobId.trim()) params.set("job_id", appliedFilters.jobId.trim());
    return params.toString();
  }, [appliedFilters]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams(baseQueryString);
    params.set("limit", String(limit));
    params.set("offset", String(offset));
    return params.toString();
  }, [baseQueryString, offset]);

  useEffect(() => {
    let cancelled = false;

    async function loadAuditLog() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`${apiUrl("/admin/audit-log")}?${queryString}`, {
          credentials: "include",
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Failed to load audit log (${res.status})${text ? ` - ${text}` : ""}`);
        }
        const json = (await res.json()) as AuditLogResponse;
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load audit log");
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAuditLog();
    return () => {
      cancelled = true;
    };
  }, [queryString]);

  async function exportAuditLog() {
    setExporting(true);
    setError("");
    try {
      const res = await fetch(`${apiUrl("/admin/audit-log/export")}?${baseQueryString}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed to export audit log (${res.status})${text ? ` - ${text}` : ""}`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "audit_log.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export audit log");
    } finally {
      setExporting(false);
    }
  }

  const total = data?.total ?? 0;
  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = total === 0 ? 0 : Math.min(offset + limit, total);

  function applyFilters() {
    setOffset(0);
    setAppliedFilters(filters);
  }

  function clearFilters() {
    setFilters(DEFAULT_FILTERS);
    setOffset(0);
    setAppliedFilters(DEFAULT_FILTERS);
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-bold" style={{ color: "#F26624" }}>
              Audit Log
            </h1>
            <p className="text-muted-foreground">
              Append-only activity history for key changes across clients, jobs, sites, and job data.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" asChild>
              <Link href="/admin">{"<-"} Back to Admin</Link>
            </Button>
          </div>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Filters</CardTitle>
            <CardDescription>Filter by actor, entity, action, client, job, or free-text match.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 rounded-md border bg-muted/30 p-4">
              <div className="text-sm font-medium">Auth Events</div>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: "All events", value: "" },
                  { label: "Auth only", value: "auth" },
                ].map((item) => (
                  <Button
                    key={item.label}
                    type="button"
                    variant={filters.eventGroup === item.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setFilters((prev) => ({ ...prev, eventGroup: item.value }))}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Narrow the audit log to login, MFA, and logout activity.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Input
                placeholder="Organisation ID"
                value={filters.orgId}
                onChange={(e) => setFilters((prev) => ({ ...prev, orgId: e.target.value }))}
              />
              <Input
                placeholder="Search text..."
                value={filters.q}
                onChange={(e) => setFilters((prev) => ({ ...prev, q: e.target.value }))}
              />
              <Input
                placeholder="Actor email"
                value={filters.actorEmail}
                onChange={(e) => setFilters((prev) => ({ ...prev, actorEmail: e.target.value }))}
              />
              <Input
                placeholder="Entity type"
                value={filters.entityType}
                onChange={(e) => setFilters((prev) => ({ ...prev, entityType: e.target.value }))}
              />
              <Input
                placeholder="Action"
                value={filters.action}
                onChange={(e) => setFilters((prev) => ({ ...prev, action: e.target.value }))}
              />
              <Input
                placeholder="Client ID"
                value={filters.clientId}
                onChange={(e) => setFilters((prev) => ({ ...prev, clientId: e.target.value }))}
              />
              <Input
                placeholder="Job ID"
                value={filters.jobId}
                onChange={(e) => setFilters((prev) => ({ ...prev, jobId: e.target.value }))}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={applyFilters}>Apply Filters</Button>
              <Button variant="outline" onClick={clearFilters}>
                Clear
              </Button>
              <Button variant="secondary" onClick={() => void exportAuditLog()} disabled={exporting || loading}>
                {exporting ? "Exporting..." : "Export CSV"}
              </Button>
              <Badge variant="outline">
                {loading ? "Loading..." : `${total} events`}
              </Badge>
              {!loading && total > 0 ? (
                <Badge variant="outline">
                  Showing {pageStart}-{pageEnd}
                </Badge>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Events</CardTitle>
            <CardDescription>Newest first. Expand an event to inspect before/after snapshots and diff data.</CardDescription>
          </CardHeader>
          <CardContent>
            {error ? <div className="mb-4 text-sm text-red-600">{error}</div> : null}
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading audit events...</div>
            ) : data?.items?.length ? (
              <>
                <div className="mb-4">
                  <PaginationControls
                    total={total}
                    pageStart={pageStart}
                    pageEnd={pageEnd}
                    offset={offset}
                    limit={limit}
                    loading={loading}
                    onPrevious={() => setOffset((prev) => Math.max(prev - limit, 0))}
                    onNext={() => setOffset((prev) => prev + limit)}
                  />
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Organisation</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Entity</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Job Number</TableHead>
                      <TableHead>UI Context</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((item) => (
                      <TableRow key={item.audit_id}>
                        <TableCell className="align-top">{fmtDate(item.created_at)}</TableCell>
                        <TableCell className="align-top">
                          <div className="font-medium">{item.org_name || "-"}</div>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="font-medium">{item.actor_name || item.actor_email || "Unknown"}</div>
                          {item.actor_email ? (
                            <div className="text-xs text-muted-foreground">{item.actor_email}</div>
                          ) : null}
                        </TableCell>
                        <TableCell className="align-top">
                          <Badge variant="outline">{item.action}</Badge>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="font-medium">{item.entity_type}</div>
                          <div className="text-xs text-muted-foreground">{String(item.entity_id ?? "-")}</div>
                        </TableCell>
                        <TableCell className="align-top">{item.client_name || "-"}</TableCell>
                        <TableCell className="align-top">{item.job_number || "-"}</TableCell>
                        <TableCell className="align-top">
                          <div className="text-sm">{item.page || "-"}</div>
                          <div className="text-xs text-muted-foreground">
                            {[item.section, item.container].filter(Boolean).join(" / ") || "No UI context"}
                          </div>
                          <details className="mt-2 text-xs">
                            <summary className="cursor-pointer text-primary">Details</summary>
                            <div className="mt-2 space-y-3 rounded-md border bg-muted/30 p-3">
                              <div>
                                <div className="mb-1 font-medium">Route</div>
                                <div className="break-all text-muted-foreground">
                                  {item.method || "-"} {item.route || "-"}
                                </div>
                              </div>
                              {item.metadata_json ? (
                                <div>
                                  <div className="mb-1 font-medium">Metadata</div>
                                  <pre className="overflow-auto rounded bg-background p-2 text-[11px]">
                                    {stringifyJson(item.metadata_json)}
                                  </pre>
                                </div>
                              ) : null}
                              {item.diff_json ? (
                                <div>
                                  <div className="mb-1 font-medium">Diff</div>
                                  <pre className="overflow-auto rounded bg-background p-2 text-[11px]">
                                    {stringifyJson(item.diff_json)}
                                  </pre>
                                </div>
                              ) : null}
                              {item.before_json ? (
                                <div>
                                  <div className="mb-1 font-medium">Before</div>
                                  <pre className="overflow-auto rounded bg-background p-2 text-[11px]">
                                    {stringifyJson(item.before_json)}
                                  </pre>
                                </div>
                              ) : null}
                              {item.after_json ? (
                                <div>
                                  <div className="mb-1 font-medium">After</div>
                                  <pre className="overflow-auto rounded bg-background p-2 text-[11px]">
                                    {stringifyJson(item.after_json)}
                                  </pre>
                                </div>
                              ) : null}
                            </div>
                          </details>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <div className="mt-4">
                  <PaginationControls
                    total={total}
                    pageStart={pageStart}
                    pageEnd={pageEnd}
                    offset={offset}
                    limit={limit}
                    loading={loading}
                    onPrevious={() => setOffset((prev) => Math.max(prev - limit, 0))}
                    onNext={() => setOffset((prev) => prev + limit)}
                  />
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">No audit events found for the selected filters.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
