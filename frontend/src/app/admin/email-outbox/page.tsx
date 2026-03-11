"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type OutboxItem = {
  email_id: number;
  template_key: string;
  entity_type: string;
  entity_id: number | null;
  job_id: number | null;
  client_db_id: number | null;
  to_email: string;
  subject: string;
  status: string;
  error_text: string;
  created_by: string;
  created_at: string | null;
  sent_at: string | null;
  attachment_count: number;
  attachment_names: string;
};

function apiBaseUrl(): string {
  return "/api/backend";
}

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export default function AdminEmailOutboxPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const [statusFilter, setStatusFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("");
  const [jobFilter, setJobFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [recipientSearch, setRecipientSearch] = useState("");
  const [subjectSearch, setSubjectSearch] = useState("");
  const [limit, setLimit] = useState("200");

  async function loadOutbox() {
    setLoading(true);
    setError("");
    setStatus("Loading outbox...");
    try {
      const params = new URLSearchParams();
      const parsedLimit = Number(limit);
      params.set("limit", String(Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 500) : 200));
      if (entityFilter.trim()) params.set("entity_type", entityFilter.trim());
      if (jobFilter.trim()) params.set("job_id", jobFilter.trim());
      if (clientFilter.trim()) params.set("client_db_id", clientFilter.trim());
      const res = await fetch(`${baseUrl}/communications/outbound-email-log?${params.toString()}`, {
        credentials: "include",
      });
      const text = await res.text().catch(() => "");
      let json: any = {};
      if (text.trim()) {
        try {
          json = JSON.parse(text);
        } catch {
          json = {};
        }
      }
      if (!res.ok) {
        throw new Error(`Failed to load outbox (${res.status})${text ? `: ${text}` : ""}`);
      }
      const loaded: OutboxItem[] = Array.isArray(json?.items) ? json.items : [];
      setItems(loaded);
      setStatus(`Loaded ${loaded.length} emails.`);
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOutbox();
  }, []);

  const filtered = useMemo(() => {
    return items.filter((item) => {
      const s = (item.status || "").toLowerCase();
      if (statusFilter !== "all" && s !== statusFilter) return false;
      if (recipientSearch.trim() && !(item.to_email || "").toLowerCase().includes(recipientSearch.trim().toLowerCase())) return false;
      if (subjectSearch.trim() && !(item.subject || "").toLowerCase().includes(subjectSearch.trim().toLowerCase())) return false;
      return true;
    });
  }, [items, recipientSearch, statusFilter, subjectSearch]);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold" style={{ color: "#F26624" }}>Email Outbox</h1>
            <p className="text-muted-foreground">Track outbound emails for communications, quotes, invoices, and automations.</p>
          </div>
          <Button variant="secondary" asChild>
            <Link href="/admin">{"<-"} Back to Admin</Link>
          </Button>
        </div>

        {error ? <div className="mb-4 rounded border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div> : null}
        {status ? <div className="mb-4 rounded border bg-muted/30 p-3 text-sm">{status}</div> : null}

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Filters</CardTitle>
            <CardDescription>Use server filters for scope and client/job; use quick search for recipient/subject.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
            <div className="space-y-1">
              <Label>Status</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All</option>
                <option value="sent">Sent</option>
                <option value="failed">Failed</option>
                <option value="pending">Pending</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>Entity Type</Label>
              <Input value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)} placeholder="quote / invoice / job_communication" />
            </div>
            <div className="space-y-1">
              <Label>Job ID</Label>
              <Input value={jobFilter} onChange={(e) => setJobFilter(e.target.value)} placeholder="e.g. 12" />
            </div>
            <div className="space-y-1">
              <Label>Client ID</Label>
              <Input value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} placeholder="e.g. 4" />
            </div>
            <div className="space-y-1">
              <Label>Limit</Label>
              <Input value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="200" />
            </div>
            <div className="flex items-end">
              <Button className="w-full" onClick={() => void loadOutbox()} disabled={loading}>
                {loading ? "Loading..." : "Refresh"}
              </Button>
            </div>
            <div className="space-y-1 md:col-span-2 xl:col-span-3">
              <Label>Recipient Search</Label>
              <Input value={recipientSearch} onChange={(e) => setRecipientSearch(e.target.value)} placeholder="search recipient email..." />
            </div>
            <div className="space-y-1 md:col-span-2 xl:col-span-3">
              <Label>Subject Search</Label>
              <Input value={subjectSearch} onChange={(e) => setSubjectSearch(e.target.value)} placeholder="search subject..." />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Outbound Emails ({filtered.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((item) => (
                  <TableRow key={item.email_id}>
                    <TableCell>{item.email_id}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          item.status === "sent"
                            ? "default"
                            : item.status === "failed"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {item.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate">{item.to_email || "-"}</TableCell>
                    <TableCell className="max-w-[320px] truncate" title={item.subject || ""}>{item.subject || "-"}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {item.entity_type || "-"}
                      {item.entity_id ? ` #${item.entity_id}` : ""}
                      {item.job_id ? ` | Job ${item.job_id}` : ""}
                      {item.client_db_id ? ` | Client ${item.client_db_id}` : ""}
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate">{item.template_key || "-"}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmtDateTime(item.created_at)}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmtDateTime(item.sent_at)}</TableCell>
                    <TableCell className="max-w-[160px] truncate">{item.created_by || "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!filtered.length ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No outbound emails found for the selected filters.
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

