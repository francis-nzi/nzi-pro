"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function apiBaseUrl(): string {
  return "/api/backend";
}

function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

type Job = { job_id: number; job_number: string | null; title: string | null };
type Quote = { quote_id: number; quote_number: string | null; status: string | null };

const STATUS_OPTIONS = ["Draft", "Sent", "Part Paid", "Paid", "Overdue", "Void"];

/** Bare invoice creation shell -- picks a job (and optionally a quote to
 * convert), creates the invoice, then hands off to the full invoice editor
 * for lines/status/sync. Same "bare record, then edit" pattern used for
 * New Job. Line-item editing intentionally lives only on the editor page,
 * not duplicated here. */
export default function NewInvoicePageContent() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const router = useRouter();
  const params = useParams<{ clientId: string }>();
  const clientId = Number(params?.clientId);

  const [clientName, setClientName] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const [jobId, setJobId] = useState("");
  const [quoteId, setQuoteId] = useState("");
  const [status, setStatus] = useState("Draft");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(addDaysIso(7));

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!Number.isFinite(clientId) || clientId <= 0) {
        setError("Invalid client id");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const [lookupsRes, jobsRes, quotesRes] = await Promise.all([
          fetch(`${baseUrl}/clients/${clientId}/quotes/lookups`, { credentials: "include" }),
          fetch(`${baseUrl}/clients/${clientId}/jobs?limit=200&offset=0`, { credentials: "include" }),
          fetch(`${baseUrl}/clients/${clientId}/quotes`, { credentials: "include" }),
        ]);
        if (!lookupsRes.ok) throw new Error(`Failed to load client (${lookupsRes.status})`);
        const lookups = await lookupsRes.json();
        if (cancelled) return;
        setClientName(String(lookups.client?.client_name || ""));

        if (jobsRes.ok) {
          const jobsJson = await jobsRes.json();
          if (!cancelled) setJobs(Array.isArray(jobsJson.items) ? jobsJson.items : []);
        }
        if (quotesRes.ok) {
          const quotesJson = await quotesRes.json();
          if (!cancelled) setQuotes(Array.isArray(quotesJson.items) ? quotesJson.items : []);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, clientId]);

  async function createInvoice() {
    if (!jobId) {
      setError("Select a job first.");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const url = quoteId
        ? `${baseUrl}/quotes/${quoteId}/convert-to-invoice`
        : `${baseUrl}/clients/${clientId}/invoices`;
      const body = quoteId
        ? { job_id: Number(jobId), invoice_date: invoiceDate, due_date: dueDate, status }
        : { job_id: Number(jobId), invoice_date: invoiceDate, due_date: dueDate, status, lines: [] };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to create invoice (${res.status})${t ? `: ${t}` : ""}`);
      }
      const created = await res.json();
      router.push(`/clients/${clientId}/invoices/${created.invoice_id}`);
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <PageHeader
          title="Add Invoice"
          subtitle={clientName || `Client ID: ${clientId}`}
          breadcrumbs={[
            { label: "Clients", href: "/clients" },
            { label: clientName || `Client ${clientId}`, href: `/clients/${clientId}` },
            { label: "Invoices", href: `/clients/${clientId}/invoices` },
            { label: "Add Invoice" },
          ]}
        />

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>New Invoice</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {jobs.length === 0 ? (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  This client has no jobs yet. Create a job first before adding an invoice.
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Job *</Label>
                  <Select value={jobId} onValueChange={setJobId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a job..." />
                    </SelectTrigger>
                    <SelectContent>
                      {jobs.map((j) => (
                        <SelectItem key={j.job_id} value={String(j.job_id)}>
                          {j.job_number || `#${j.job_id}`}
                          {j.title ? ` — ${j.title}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Quote (optional, converts its lines)</Label>
                  <Select value={quoteId || "__none__"} onValueChange={(v) => setQuoteId(v === "__none__" ? "" : v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="No quote linked" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No quote linked</SelectItem>
                      {quotes.map((q) => (
                        <SelectItem key={q.quote_id} value={String(q.quote_id)}>
                          {q.quote_number || `#${q.quote_id}`} ({q.status || "-"})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div />
                <div className="space-y-2">
                  <Label>Invoice Date</Label>
                  <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Due Date</Label>
                  <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
              </div>

              {error ? <div className="text-sm text-destructive">{error}</div> : null}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => router.push(`/clients/${clientId}/invoices`)} disabled={creating}>
                  Cancel
                </Button>
                <Button onClick={() => void createInvoice()} disabled={creating || !jobId}>
                  {creating ? "Creating..." : quoteId ? "Convert Quote to Invoice" : "Create Invoice"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
