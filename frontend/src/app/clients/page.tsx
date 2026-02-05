"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
}

type ClientListItem = {
  client_db_id: number;
  client_name: string | null;
  industry: string | null;
  status: string | null;
  crm_owner: string | null;
};

type ClientsResponse = {
  items: ClientListItem[];
  limit: number;
  offset: number;
  total: number;
};

export default function ClientsPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);

  const [q, setQ] = useState<string>("");
  const [items, setItems] = useState<ClientListItem[]>([]);
  const [limit, setLimit] = useState<number>(50);
  const [offset, setOffset] = useState<number>(0);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (q.trim()) params.set("q", q.trim());
        params.set("limit", String(limit));
        params.set("offset", String(offset));

        const res = await fetch(`${baseUrl}/clients?${params.toString()}`);
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Failed to load clients: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
        }

        const json = (await res.json()) as ClientsResponse;
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
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [baseUrl, q, limit, offset]);

  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Clients</h1>
            <div className="text-sm text-muted-foreground">{total} total</div>
          </div>
          <div className="flex gap-2">
            <Button asChild>
              <Link href="/clients/new">+ Add Client</Link>
            </Button>
            <Button variant="secondary" asChild>
              <Link href="/">Back to Hub</Link>
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Search</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="q">Search</Label>
                <Input
                  id="q"
                  placeholder="Client name or industry..."
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setOffset(0);
                  }}
                />
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
              <div className="grid grid-cols-12 gap-2 border-b bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
                <div className="col-span-4">Client</div>
                <div className="col-span-3">Industry</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-3">Owner</div>
              </div>
              {loading ? (
                <div className="px-3 py-3 text-sm text-muted-foreground">Loading...</div>
              ) : items.length === 0 ? (
                <div className="px-3 py-3 text-sm text-muted-foreground">No clients found.</div>
              ) : (
                <div className="divide-y">
                  {items.map((c) => (
                    <Link
                      key={c.client_db_id}
                      href={`/clients/${c.client_db_id}`}
                      className="grid grid-cols-12 gap-2 px-3 py-2 text-sm hover:bg-muted"
                    >
                      <div className="col-span-4 font-medium">{c.client_name ?? `Client ${c.client_db_id}`}</div>
                      <div className="col-span-3">{c.industry ?? ""}</div>
                      <div className="col-span-2">{c.status ?? ""}</div>
                      <div className="col-span-3">{c.crm_owner ?? ""}</div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
