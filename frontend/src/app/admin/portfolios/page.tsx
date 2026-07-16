"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Building2, Search, Sparkles, Users, type LucideIcon } from "lucide-react";
import PortalPortfolioDashboard from "@/components/PortalPortfolioDashboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type PortfolioOwner = {
  client_db_id: number;
  client_name: string;
  status?: string | null;
  portfolio?: string | null;
  industry?: string | null;
  crm_owner?: string | null;
  client_manager?: string | null;
  milestone_status?: string | null;
};

export default function PortfoliosAdminPage() {
  const [owners, setOwners] = useState<PortfolioOwner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedOwnerId, setSelectedOwnerId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/backend/clients?status=Portfolio%20Owner&include_archived=true&limit=200", { credentials: "include" });
        if (!res.ok) {
          throw new Error(`Failed to load portfolio owners (${res.status})`);
        }
        const json = await res.json() as { items?: PortfolioOwner[] };
        const list = json.items ?? [];
        if (!cancelled) {
          setOwners(list);
          setSelectedOwnerId((current) => current ?? list[0]?.client_db_id ?? null);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message || "Failed to load portfolio owners");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredOwners = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return owners;
    return owners.filter((owner) => {
      return [owner.client_name, owner.portfolio, owner.industry, owner.crm_owner, owner.client_manager]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [owners, query]);

  const selectedOwner = filteredOwners.find((owner) => owner.client_db_id === selectedOwnerId) ?? filteredOwners[0] ?? null;
  const detailEndpoint = selectedOwner ? `/admin/portfolio-owners/${selectedOwner.client_db_id}` : null;
  const adminRequest = useCallback((path: string) => fetch(`/api/backend${path}`, { credentials: "include" }), []);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(242,102,36,0.10),_transparent_28%),linear-gradient(180deg,_#fdfbf8_0%,_#ffffff_28%)]">
      <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="overflow-hidden rounded-[2rem] border border-orange-100/70 bg-white/90 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="relative border-b border-slate-200/70 px-6 py-8 sm:px-8">
            <div className="absolute inset-0 bg-gradient-to-r from-[#1c5026]/8 via-transparent to-[#f26624]/8" />
            <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-800">Portfolio Administration</Badge>
                  <Badge variant="outline" className="border-orange-200 text-orange-700">
                    {owners.length} portfolio owners
                  </Badge>
                </div>
                <div>
                  <h1 className="text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">Portfolio owners and their client networks</h1>
                  <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600 sm:text-lg">
                    Manage the company that represents each portfolio, then drill into the portfolio-level dashboard to see client status, emissions, job progress, and notes.
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-3 lg:min-w-[360px]">
                <div className="flex flex-wrap justify-start gap-3 lg:justify-end">
                  <Button asChild className="rounded-full bg-[#1c5026] text-white hover:bg-[#153f1e]">
                    <Link href="/clients/new?status=Portfolio%20Owner">
                      Add Portfolio Owner
                    </Link>
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <StatPill label="Owners" value={owners.length.toString()} icon={Building2} />
                  <StatPill label="Visible" value={filteredOwners.length.toString()} icon={Users} />
                  <StatPill label="Selected" value={selectedOwner ? "1" : "0"} icon={Sparkles} />
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-0 xl:grid-cols-[340px_minmax(0,1fr)]">
            <aside className="border-b border-slate-200/70 xl:border-b-0 xl:border-r xl:border-slate-200/70">
              <div className="border-b border-slate-200/70 p-5">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search owners..."
                    className="h-11 rounded-2xl border-slate-200 bg-white pl-9 shadow-sm"
                  />
                </div>
              </div>

              <div className="max-h-[calc(100vh-220px)] overflow-auto p-3">
                {loading && !owners.length ? (
                  <div className="p-4 text-sm text-slate-500">Loading portfolio owners...</div>
                ) : error ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
                ) : filteredOwners.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
                    No portfolio owners match your search.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredOwners.map((owner) => {
                      const selected = owner.client_db_id === selectedOwner?.client_db_id;
                      return (
                        <button
                          key={owner.client_db_id}
                          type="button"
                          onClick={() => setSelectedOwnerId(owner.client_db_id)}
                          className={`w-full rounded-2xl border p-4 text-left transition-all ${
                            selected
                              ? "border-[#1c5026]/30 bg-[#1c5026]/8 shadow-sm"
                              : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-semibold text-slate-900">{owner.client_name}</div>
                              <div className="mt-1 text-xs text-slate-500">{owner.portfolio || "No portfolio label"}</div>
                            </div>
                            {selected ? <Badge className="bg-[#1c5026] text-white">Selected</Badge> : null}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2 text-xs">
                            <Badge variant="outline" className="border-slate-200 text-slate-600">{owner.industry || "No industry"}</Badge>
                            <Badge variant="outline" className="border-slate-200 text-slate-600">{owner.crm_owner || "No CRM owner"}</Badge>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </aside>

            <main className="min-w-0">
              <div className="border-b border-slate-200/70 px-6 py-4 sm:px-8">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Portfolio detail</div>
                    <h2 className="text-2xl font-semibold text-slate-900">
                      {selectedOwner ? selectedOwner.client_name : "Select a portfolio owner"}
                    </h2>
                  </div>
                  {selectedOwner ? (
                    <Button asChild className="rounded-full bg-[#1c5026] text-white hover:bg-[#153f1e]">
                      <Link href={`/clients/${selectedOwner.client_db_id}/edit`}>
                        Open client record
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="space-y-6 px-6 py-6 sm:px-8">
                {selectedOwner && detailEndpoint ? (
                  <PortalPortfolioDashboard
                    endpoint={detailEndpoint}
                    request={adminRequest}
                  />
                ) : (
                  <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center text-slate-500">
                    Choose a portfolio owner on the left to see the portfolio dashboard.
                  </div>
                )}
              </div>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatPill({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Icon className="h-4 w-4 text-[#1c5026]" />
        <span>{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}
