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

type Job = { job_id: number; job_number: string | null; title: string | null };

const STATUS_OPTIONS = ["Draft", "Sent", "Applied", "Void"];

/** Bare credit-note creation shell -- see invoices/new/page.tsx for the
 * same pattern. Line-item editing happens on the credit note's own editor
 * page, not here. Issuing a credit note against a specific invoice still
 * happens via that invoice's own "Create Credit Note" action; this page is
 * for standalone credit notes. */
export default function NewCreditNotePageContent() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const router = useRouter();
  const params = useParams<{ clientId: string }>();
  const clientId = Number(params?.clientId);

  const [clientName, setClientName] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const [jobId, setJobId] = useState("");
  const [status, setStatus] = useState("Draft");
  const [creditNoteDate, setCreditNoteDate] = useState(new Date().toISOString().slice(0, 10));

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
        const [lookupsRes, jobsRes] = await Promise.all([
          fetch(`${baseUrl}/clients/${clientId}/quotes/lookups`, { credentials: "include" }),
          fetch(`${baseUrl}/clients/${clientId}/jobs?limit=200&offset=0`, { credentials: "include" }),
        ]);
        if (!lookupsRes.ok) throw new Error(`Failed to load client (${lookupsRes.status})`);
        const lookups = await lookupsRes.json();
        if (cancelled) return;
        setClientName(String(lookups.client?.client_name || ""));

        if (jobsRes.ok) {
          const jobsJson = await jobsRes.json();
          if (!cancelled) setJobs(Array.isArray(jobsJson.items) ? jobsJson.items : []);
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

  async function createCreditNote() {
    if (!jobId) {
      setError("Select a job first.");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/credit-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ job_id: Number(jobId), credit_note_date: creditNoteDate, status, lines: [] }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to create credit note (${res.status})${t ? `: ${t}` : ""}`);
      }
      const created = await res.json();
      router.push(`/clients/${clientId}/credit-notes/${created.credit_note_id}`);
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <PageHeader
          title="Add Credit Note"
          subtitle={clientName || `Client ID: ${clientId}`}
          breadcrumbs={[
            { label: "Clients", href: "/clients" },
            { label: clientName || `Client ${clientId}`, href: `/clients/${clientId}` },
            { label: "Credit Notes", href: `/clients/${clientId}/credit-notes` },
            { label: "Add Credit Note" },
          ]}
        />

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>New Credit Note</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {jobs.length === 0 ? (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  This client has no jobs yet. Create a job first before adding a credit note.
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
                <div className="space-y-2">
                  <Label>Credit Note Date</Label>
                  <Input type="date" value={creditNoteDate} onChange={(e) => setCreditNoteDate(e.target.value)} />
                </div>
              </div>

              {error ? <div className="text-sm text-destructive">{error}</div> : null}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => router.push(`/clients/${clientId}/credit-notes`)} disabled={creating}>
                  Cancel
                </Button>
                <Button onClick={() => void createCreditNote()} disabled={creating || !jobId}>
                  {creating ? "Creating..." : "Create Credit Note"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
