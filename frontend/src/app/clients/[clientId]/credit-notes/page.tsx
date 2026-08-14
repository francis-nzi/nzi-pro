"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function apiBaseUrl(): string {
  return "/api/backend";
}

type CreditNoteListItem = {
  credit_note_id: number;
  credit_note_number: string;
  job_number: string | null;
  credit_note_date: string | null;
  currency_code: string;
  status: string;
  total: number;
};

export default function ClientCreditNotesPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const params = useParams<{ clientId: string }>();
  const clientId = Number(params?.clientId);

  const [items, setItems] = useState<CreditNoteListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
        const res = await fetch(`${baseUrl}/clients/${clientId}/credit-notes`, { credentials: "include" });
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
  }, [baseUrl, clientId]);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <PageHeader
          title="Client Credit Notes"
          subtitle={`Client ID: ${Number.isFinite(clientId) ? clientId : "-"}`}
          breadcrumbs={[
            { label: "Clients", href: "/clients" },
            { label: `Client ${clientId}`, href: `/clients/${clientId}` },
            { label: "Credit Notes" },
          ]}
          actions={
            <>
              <Button asChild>
                <Link href={`/clients/${clientId}/credit-notes/new`}>+ Add Credit Note</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href={`/clients/${clientId}`}>Back to Client</Link>
              </Button>
            </>
          }
        />

        <Card>
          <CardHeader>
            <CardTitle>Credit Notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? <div className="text-sm text-muted-foreground">Loading...</div> : null}
            {error ? <div className="text-sm text-destructive">{error}</div> : null}
            {!loading && !error && items.length === 0 ? (
              <div className="text-sm text-muted-foreground">No credit notes created yet.</div>
            ) : null}
            {!loading && !error && items.length > 0 ? (
              <div className="rounded-md border">
                <div className="grid grid-cols-12 gap-2 border-b bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
                  <div className="col-span-2">Credit Note</div>
                  <div className="col-span-2">Job</div>
                  <div className="col-span-2">Date</div>
                  <div className="col-span-2">Status</div>
                  <div className="col-span-2">Total</div>
                  <div className="col-span-2"></div>
                </div>
                <div className="divide-y">
                  {items.map((row) => (
                    <div key={row.credit_note_id} className="grid grid-cols-12 gap-2 px-3 py-2 text-sm">
                      <div className="col-span-2 font-medium">{row.credit_note_number || `#${row.credit_note_id}`}</div>
                      <div className="col-span-2">{row.job_number || "-"}</div>
                      <div className="col-span-2">{row.credit_note_date ? new Date(row.credit_note_date).toLocaleDateString("en-GB") : "-"}</div>
                      <div className="col-span-2">{row.status || "-"}</div>
                      <div className="col-span-2">
                        {new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
                          Number(row.total || 0)
                        )}{" "}
                        {row.currency_code || ""}
                      </div>
                      <div className="col-span-2 text-right">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/clients/${clientId}/credit-notes/${row.credit_note_id}`}>Open</Link>
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
