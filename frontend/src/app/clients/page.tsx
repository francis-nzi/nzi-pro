"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import SearchableStringSelect from "@/components/SearchableStringSelect";
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

type ClientListItem = {
  client_db_id: number;
  client_name: string | null;
  industry: string | null;
  status: string | null;
  crm_owner: string | null;
  milestone_status?: string | null;
};

type FacetOption = {
  value: string;
  count: number;
};

type ClientFacets = {
  industries: FacetOption[];
  statuses: FacetOption[];
  owners: FacetOption[];
  risks: FacetOption[];
  portfolios: FacetOption[];
  client_managers: FacetOption[];
};

type SortBy = "client" | "industry" | "status" | "owner" | "risk";

function ClientsContent() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const searchParams = useSearchParams();

  const [q, setQ] = useState("");
  const [items, setItems] = useState<ClientListItem[]>([]);
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [industryFilter, setIndustryFilter] = useState(() => searchParams.get("industry") ?? "");
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get("status") ?? "");
  const [ownerFilter, setOwnerFilter] = useState(() => searchParams.get("crm_owner") ?? "");
  const [riskFilter, setRiskFilter] = useState(() => searchParams.get("risk") ?? "");
  const [portfolioFilter, setPortfolioFilter] = useState(() => searchParams.get("portfolio") ?? "");
  const [clientManagerFilter, setClientManagerFilter] = useState(() => searchParams.get("client_manager") ?? "");
  const [facets, setFacets] = useState<ClientFacets>({
    industries: [],
    statuses: [],
    owners: [],
    risks: [],
    portfolios: [],
    client_managers: [],
  });
  const [sortBy, setSortBy] = useState<SortBy>("client");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (q.trim()) params.set("q", q.trim());
        if (industryFilter.trim()) params.set("industry", industryFilter.trim());
        if (statusFilter.trim()) params.set("status", statusFilter.trim());
        if (ownerFilter.trim()) params.set("crm_owner", ownerFilter.trim());
        if (riskFilter.trim()) params.set("risk", riskFilter.trim());
        if (portfolioFilter.trim()) params.set("portfolio", portfolioFilter.trim());
        if (clientManagerFilter.trim()) params.set("client_manager", clientManagerFilter.trim());
        params.set("limit", String(limit));
        params.set("offset", String(offset));
        params.set("sort_by", sortBy);
        params.set("sort_dir", sortDir);

        const res = await fetch(`${baseUrl}/clients?${params.toString()}`, {
          credentials: "include",
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Failed to load clients: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
        }

        const json = await res.json();
        if (cancelled) return;
        setItems(json.items ?? []);
        setTotal(Number(json.total ?? 0));
        setFacets(
          json.facets ?? {
            industries: [],
            statuses: [],
            owners: [],
            risks: [],
            portfolios: [],
            client_managers: [],
          }
        );
      } catch (e) {
        if (cancelled) return;
        setItems([]);
        setTotal(0);
        setFacets({
          industries: [],
          statuses: [],
          owners: [],
          risks: [],
          portfolios: [],
          client_managers: [],
        });
        setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [baseUrl, q, industryFilter, statusFilter, ownerFilter, riskFilter, portfolioFilter, clientManagerFilter, limit, offset, sortBy, sortDir]);

  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

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
    function valueFor(client: ClientListItem): string | number {
      if (sortBy === "client") return (client.client_name ?? "").toLowerCase();
      if (sortBy === "industry") return (client.industry ?? "").toLowerCase();
      if (sortBy === "status") return (client.status ?? "").toLowerCase();
      if (sortBy === "owner") return (client.crm_owner ?? "").toLowerCase();
      const risk = riskFromMilestone(client.milestone_status);
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
          title="Clients"
          subtitle={`${total} total`}
          breadcrumbs={[{ label: "Clients" }]}
          actions={
            <>
              <Button asChild>
                <Link href="/clients/new">+ Add Client</Link>
              </Button>
              <Button variant="secondary" asChild>
                <Link href="/clients/quotes">Quotes</Link>
              </Button>
              <Button variant="secondary" asChild>
                <Link href="/clients/invoices">Invoices</Link>
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
                <span className="font-medium">Risk legend:</span>
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-rose-800">Overdue</span>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">Due</span>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">Healthy</span>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
                <div className="space-y-2">
                  <Label htmlFor="industry-filter">Industry</Label>
                  <SearchableStringSelect
                    id="industry-filter"
                    value={industryFilter}
                    options={facets.industries.map((facet) => facet.value)}
                    optionBadges={Object.fromEntries(facets.industries.map((facet) => [facet.value, facet.count]))}
                    placeholder="All industries"
                    showClearButton
                    onValueChange={(value) => {
                      setIndustryFilter(value);
                      setOffset(0);
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="status-filter">Status</Label>
                  <SearchableStringSelect
                    id="status-filter"
                    value={statusFilter}
                    options={facets.statuses.map((facet) => facet.value)}
                    optionBadges={Object.fromEntries(facets.statuses.map((facet) => [facet.value, facet.count]))}
                    placeholder="All statuses"
                    showClearButton
                    onValueChange={(value) => {
                      setStatusFilter(value);
                      setOffset(0);
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="owner-filter">Owner</Label>
                  <SearchableStringSelect
                    id="owner-filter"
                    value={ownerFilter}
                    options={facets.owners.map((facet) => facet.value)}
                    optionBadges={Object.fromEntries(facets.owners.map((facet) => [facet.value, facet.count]))}
                    placeholder="All owners"
                    showClearButton
                    onValueChange={(value) => {
                      setOwnerFilter(value);
                      setOffset(0);
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="risk-filter">Risk</Label>
                  <SearchableStringSelect
                    id="risk-filter"
                    value={riskFilter}
                    options={facets.risks.map((facet) => facet.value)}
                    optionBadges={Object.fromEntries(facets.risks.map((facet) => [facet.value, facet.count]))}
                    placeholder="All risks"
                    showClearButton
                    onValueChange={(value) => {
                      setRiskFilter(value);
                      setOffset(0);
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="portfolio-filter">Portfolio</Label>
                  <SearchableStringSelect
                    id="portfolio-filter"
                    value={portfolioFilter}
                    options={facets.portfolios.map((facet) => facet.value)}
                    optionBadges={Object.fromEntries(facets.portfolios.map((facet) => [facet.value, facet.count]))}
                    placeholder="All portfolios"
                    showClearButton
                    onValueChange={(value) => {
                      setPortfolioFilter(value);
                      setOffset(0);
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="client-manager-filter">Client Manager</Label>
                  <SearchableStringSelect
                    id="client-manager-filter"
                    value={clientManagerFilter}
                    options={facets.client_managers.map((facet) => facet.value)}
                    optionBadges={Object.fromEntries(facets.client_managers.map((facet) => [facet.value, facet.count]))}
                    placeholder="All managers"
                    showClearButton
                    onValueChange={(value) => {
                      setClientManagerFilter(value);
                      setOffset(0);
                    }}
                  />
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
              <div className="grid grid-cols-12 gap-2 border-b bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
                <div className="col-span-1"></div>
                <button className="col-span-3 text-left hover:text-foreground" onClick={() => toggleSort("client")}>{sortLabel("Client", "client")}</button>
                <button className="col-span-2 text-left hover:text-foreground" onClick={() => toggleSort("industry")}>{sortLabel("Industry", "industry")}</button>
                <button className="col-span-2 text-left hover:text-foreground" onClick={() => toggleSort("status")}>{sortLabel("Status", "status")}</button>
                <button className="col-span-3 text-left hover:text-foreground" onClick={() => toggleSort("owner")}>{sortLabel("Owner", "owner")}</button>
                <button className="col-span-1 text-left hover:text-foreground" onClick={() => toggleSort("risk")}>{sortLabel("Risk", "risk")}</button>
              </div>
              {loading ? (
                <div className="px-3 py-3 text-sm text-muted-foreground">Loading...</div>
              ) : sortedItems.length === 0 ? (
                <div className="px-3 py-3 text-sm text-muted-foreground">No clients found.</div>
              ) : (
                <div className="divide-y">
                  {sortedItems.map((c) => {
                    const statusColor = milestoneDotClass(c.milestone_status);
                    const risk = riskFromMilestone(c.milestone_status);
                    return (
                      <Link
                        key={c.client_db_id}
                        href={`/clients/${c.client_db_id}`}
                        className="grid grid-cols-12 gap-2 px-3 py-2 text-sm hover:bg-muted"
                      >
                        <div className="col-span-1 flex items-center">
                          <div className={`h-3 w-3 rounded-full ${statusColor}`} title={`Milestone status: ${c.milestone_status || "none"}`} />
                        </div>
                        <div className="col-span-3 font-medium">{c.client_name ?? `Client ${c.client_db_id}`}</div>
                        <div className="col-span-2">{c.industry ?? ""}</div>
                        <div className="col-span-2">
                          <StatusBadge status={c.status} />
                        </div>
                        <div className="col-span-3">{c.crm_owner ?? ""}</div>
                        <div className="col-span-1">
                          <span className={`rounded-full px-2 py-0.5 text-xs ${riskBadgeClass(risk)}`}>{risk}</span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function ClientsPage() {
  return (
    <Suspense>
      <ClientsContent />
    </Suspense>
  );
}
