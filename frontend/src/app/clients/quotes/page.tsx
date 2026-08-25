"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

function apiBaseUrl(): string {
  return "/api/backend";
}

type QuoteListItem = {
  quote_id: number;
  client_db_id: number;
  client_name: string;
  quote_number: string;
  quote_date: string | null;
  valid_to: string | null;
  currency_code: string;
  status: string;
  updated_at: string | null;
};

type ClientPickerItem = {
  client_db_id: number;
  client_name: string | null;
};

export default function QuotesPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const [items, setItems] = useState<QuoteListItem[]>([]);
  const [clients, setClients] = useState<ClientPickerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [error, setError] = useState("");
  const [clientsError, setClientsError] = useState("");
  const [q, setQ] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedClientName, setSelectedClientName] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const clientSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`${baseUrl}/quotes`, { credentials: "include" });
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          throw new Error(`Failed to load quotes (${res.status})${t ? `: ${t}` : ""}`);
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

  async function searchClients(query: string) {
    setClientsLoading(true);
    setClientsError("");
    try {
      const params = new URLSearchParams({ limit: "20" });
      if (query.trim()) params.set("q", query.trim());
      const res = await fetch(`${baseUrl}/clients?${params}`, { credentials: "include" });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to load clients (${res.status})${t ? `: ${t}` : ""}`);
      }
      const json = await res.json();
      setClients(Array.isArray(json.items) ? json.items : []);
    } catch (e) {
      setClientsError((e as Error).message);
    } finally {
      setClientsLoading(false);
    }
  }

  useEffect(() => {
    void searchClients("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl]);

  function pickClient(client: ClientPickerItem) {
    setSelectedClientId(String(client.client_db_id));
    setSelectedClientName(client.client_name || `Client ${client.client_db_id}`);
    setClientSearch(client.client_name || `Client ${client.client_db_id}`);
    setClientPickerOpen(false);
  }

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return items;
    return items.filter((i) =>
      [i.quote_number, i.client_name, i.status]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [items, q]);

  const addQuoteHref = selectedClientId ? `/clients/${selectedClientId}/quotes/new` : "";

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <PageHeader
          title="Quotes"
          subtitle={`${filtered.length} quotes`}
          breadcrumbs={[
            { label: "Clients", href: "/clients" },
            { label: "Quotes" },
          ]}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Input
                  className="h-10 w-64"
                  value={clientSearch}
                  onFocus={() => setClientPickerOpen(true)}
                  onBlur={() => {
                    window.setTimeout(() => setClientPickerOpen(false), 150);
                  }}
                  onChange={(e) => {
                    const value = e.target.value;
                    setClientSearch(value);
                    setClientPickerOpen(true);
                    if (selectedClientId && selectedClientName !== value) {
                      setSelectedClientId("");
                      setSelectedClientName("");
                    }
                    if (clientSearchTimer.current) clearTimeout(clientSearchTimer.current);
                    clientSearchTimer.current = setTimeout(() => { void searchClients(value); }, 250);
                  }}
                  placeholder="Search clients for new quote..."
                  autoComplete="off"
                />
                {clientPickerOpen && (
                  <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-md border bg-background shadow-lg">
                    <div className="max-h-64 overflow-y-auto py-1">
                      {clientsLoading ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">Searching…</div>
                      ) : clients.length > 0 ? (
                        clients.map((client) => (
                          <button
                            key={client.client_db_id}
                            type="button"
                            className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-slate-100 ${
                              client.client_db_id === Number(selectedClientId) ? "bg-slate-100 font-medium" : ""
                            }`}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              pickClient(client);
                            }}
                          >
                            <span className="truncate">{client.client_name || `Client ${client.client_db_id}`}</span>
                            <span className="ml-3 shrink-0 text-xs text-muted-foreground">#{client.client_db_id}</span>
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-2 text-sm text-muted-foreground">No matching clients.</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              {addQuoteHref ? (
                <Button asChild>
                  <Link href={addQuoteHref}>+ Add Quote</Link>
                </Button>
              ) : (
                <Button disabled>+ Add Quote</Button>
              )}
              <Button variant="outline" asChild>
                <Link href="/clients">Back to Clients</Link>
              </Button>
            </div>
          }
        />

        <div className="mb-4 rounded-md border bg-muted/30 px-4 py-3 text-sm">
          <div className="font-medium">Create a new quote</div>
          <div className="text-muted-foreground">
            Select a client, then use the add quote button to open the quote builder.
          </div>
        </div>

        {clientsError ? <div className="mb-4 text-sm text-destructive">{clientsError}</div> : null}

        <Card>
          <CardHeader>
            <CardTitle>All Client Quotes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              placeholder="Search by quote number, client, status..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {loading ? <div className="text-sm text-muted-foreground">Loading...</div> : null}
            {error ? <div className="text-sm text-destructive">{error}</div> : null}
            {!loading && !error && filtered.length === 0 ? (
              <div className="text-sm text-muted-foreground">No quotes found.</div>
            ) : null}
            {!loading && !error && filtered.length > 0 ? (
              <div className="rounded-md border">
                <div className="grid grid-cols-12 gap-2 border-b bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
                  <div className="col-span-2">Quote</div>
                  <div className="col-span-3">Client</div>
                  <div className="col-span-2">Date</div>
                  <div className="col-span-2">Valid To</div>
                  <div className="col-span-1">Status</div>
                  <div className="col-span-2"></div>
                </div>
                <div className="divide-y">
                  {filtered.map((row) => (
                    <div key={row.quote_id} className="grid grid-cols-12 gap-2 px-3 py-2 text-sm">
                      <div className="col-span-2 font-medium">{row.quote_number || `#${row.quote_id}`}</div>
                      <div className="col-span-3">
                        <Link className="hover:underline" href={`/clients/${row.client_db_id}`}>
                          {row.client_name || `Client ${row.client_db_id}`}
                        </Link>
                      </div>
                      <div className="col-span-2">{row.quote_date ? new Date(row.quote_date).toLocaleDateString("en-GB") : "-"}</div>
                      <div className="col-span-2">{row.valid_to ? new Date(row.valid_to).toLocaleDateString("en-GB") : "-"}</div>
                      <div className="col-span-1">{row.status || "-"}</div>
                      <div className="col-span-2 text-right">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/clients/${row.client_db_id}/quotes/new?quoteId=${row.quote_id}`}>Open</Link>
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
