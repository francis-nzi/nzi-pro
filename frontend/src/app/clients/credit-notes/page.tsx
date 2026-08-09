"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

function apiBaseUrl(): string {
  return "/api/backend";
}

type CreditNoteListItem = {
  credit_note_id: number;
  client_db_id: number;
  client_name: string;
  job_id: number | null;
  job_number: string;
  invoice_id: number | null;
  invoice_number: string;
  credit_note_number: string;
  credit_note_date: string | null;
  currency_code: string;
  subtotal: number;
  vat: number;
  total: number;
  status: string;
  xero_sync_status: string;
  updated_at: string | null;
};

export default function CreditNotesPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const [items, setItems] = useState<CreditNoteListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`${baseUrl}/credit-notes`, { credentials: "include" });
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          throw new Error(`Failed to load credit notes (${res.status})${t ? `: ${t}` : ""}`);
        }
        const json = await res.json();
        if (cancelled) return;
        setItems(Array.isArray(json.items) ? json.items : []);
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
  }, [baseUrl]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return items;
    return items.filter((i) =>
      [i.credit_note_number, i.client_name, i.job_number, i.invoice_number, i.status]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [items, q]);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <PageHeader
          title="Credit Notes"
          subtitle={`${filtered.length} credit notes`}
          breadcrumbs={[
            { label: "Clients", href: "/clients" },
            { label: "Credit Notes" },
          ]}
          actions={
            <Button variant="outline" asChild>
              <Link href="/clients">Back to Clients</Link>
            </Button>
          }
        />

        <div className="mb-4 rounded-md border bg-muted/30 px-4 py-3 text-sm">
          <div className="font-medium">Create a new credit note</div>
          <div className="text-muted-foreground">
            Credit notes are created from a client&apos;s Financial &gt; Invoices tab, or from an
            existing invoice&apos;s &quot;Create Credit Note&quot; button.
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>All Client Credit Notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              placeholder="Search by credit note number, client, job, invoice, status..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {loading ? <div className="text-sm text-muted-foreground">Loading...</div> : null}
            {error ? <div className="text-sm text-destructive">{error}</div> : null}
            {!loading && !error && filtered.length === 0 ? (
              <div className="text-sm text-muted-foreground">No credit notes found.</div>
            ) : null}
            {!loading && !error && filtered.length > 0 ? (
              <div className="rounded-md border">
                <div className="grid grid-cols-12 gap-2 border-b bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
                  <div className="col-span-2">Credit Note</div>
                  <div className="col-span-2">Client</div>
                  <div className="col-span-2">Job</div>
                  <div className="col-span-1">Invoice</div>
                  <div className="col-span-1">Date</div>
                  <div className="col-span-1">Total</div>
                  <div className="col-span-1">Status</div>
                  <div className="col-span-2"></div>
                </div>
                <div className="divide-y">
                  {filtered.map((row) => (
                    <div key={row.credit_note_id} className="grid grid-cols-12 gap-2 px-3 py-2 text-sm">
                      <div className="col-span-2 font-medium">{row.credit_note_number || `#${row.credit_note_id}`}</div>
                      <div className="col-span-2">
                        <Link className="hover:underline" href={`/clients/${row.client_db_id}`}>
                          {row.client_name || `Client ${row.client_db_id}`}
                        </Link>
                      </div>
                      <div className="col-span-2">
                        {row.job_id ? (
                          <Link className="hover:underline" href={`/jobs/${row.job_id}/financial/invoices`}>
                            {row.job_number || `Job ${row.job_id}`}
                          </Link>
                        ) : (
                          "-"
                        )}
                      </div>
                      <div className="col-span-1">
                        {row.invoice_id ? (
                          <Link className="hover:underline" href={`/clients/${row.client_db_id}/invoices/${row.invoice_id}`}>
                            {row.invoice_number || `#${row.invoice_id}`}
                          </Link>
                        ) : (
                          "-"
                        )}
                      </div>
                      <div className="col-span-1">
                        {row.credit_note_date ? new Date(row.credit_note_date).toLocaleDateString("en-GB") : "-"}
                      </div>
                      <div className="col-span-1">
                        {row.currency_code} {row.total.toLocaleString()}
                      </div>
                      <div className="col-span-1">{row.status || "-"}</div>
                      <div className="col-span-2 text-right">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/clients/${row.client_db_id}/credit-notes/${row.credit_note_id}`}>Open</Link>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
