"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Building2, Layers, Plus, Search, Sparkles, Trash2, Users, X, type LucideIcon } from "lucide-react";
import PortalPortfolioDashboard from "@/components/PortalPortfolioDashboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";

const BASE_URL = "/api/backend";

type PortfolioOwnerRef = {
  client_db_id: number;
  client_name: string;
  status?: string | null;
};

type Portfolio = {
  portfolio_id: number;
  name: string;
  is_active: boolean;
  owner: PortfolioOwnerRef | null;
  member_count: number;
};

type UnlinkedOwner = {
  client_db_id: number;
  client_name: string;
};

type PortfolioMember = {
  client_db_id: number;
  client_name: string;
  status: string | null;
  industry: string | null;
  crm_owner: string | null;
};

type ClientOption = {
  client_db_id: number;
  client_name: string;
  status?: string | null;
};

export default function PortfoliosAdminPage() {
  const confirmAction = useConfirmDialog();

  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [unlinkedOwners, setUnlinkedOwners] = useState<UnlinkedOwner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<number | null>(null);

  const [members, setMembers] = useState<PortfolioMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  const [addPortfolioOpen, setAddPortfolioOpen] = useState(false);
  const [addPortfolioName, setAddPortfolioName] = useState("");
  const [addPortfolioOwnerId, setAddPortfolioOwnerId] = useState("");
  const [ownerCandidates, setOwnerCandidates] = useState<ClientOption[]>([]);
  const [addPortfolioSaving, setAddPortfolioSaving] = useState(false);
  const [addPortfolioStatus, setAddPortfolioStatus] = useState("");

  const [addMembersOpen, setAddMembersOpen] = useState(false);
  const [memberCandidates, setMemberCandidates] = useState<ClientOption[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<number>>(new Set());
  const [addMembersSaving, setAddMembersSaving] = useState(false);

  const loadPortfolios = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${BASE_URL}/admin/portfolios`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load portfolios (${res.status})`);
      const json = await res.json() as { portfolios?: Portfolio[]; unlinked_owners?: UnlinkedOwner[] };
      setPortfolios(json.portfolios ?? []);
      setUnlinkedOwners(json.unlinked_owners ?? []);
      setSelectedPortfolioId((current) => current ?? json.portfolios?.[0]?.portfolio_id ?? null);
    } catch (err) {
      setError((err as Error).message || "Failed to load portfolios");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadPortfolios(); }, [loadPortfolios]);

  const loadMembers = useCallback(async (portfolioId: number) => {
    setMembersLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/admin/portfolios/${portfolioId}/members`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load members (${res.status})`);
      const json = await res.json() as { members?: PortfolioMember[] };
      setMembers(json.members ?? []);
    } catch {
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedPortfolioId != null) void loadMembers(selectedPortfolioId);
  }, [selectedPortfolioId, loadMembers]);

  const filteredPortfolios = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return portfolios;
    return portfolios.filter((p) => {
      return [p.name, p.owner?.client_name].filter(Boolean).some((value) => String(value).toLowerCase().includes(q));
    });
  }, [portfolios, query]);

  const selectedPortfolio = filteredPortfolios.find((p) => p.portfolio_id === selectedPortfolioId)
    ?? portfolios.find((p) => p.portfolio_id === selectedPortfolioId)
    ?? null;
  const detailEndpoint = selectedPortfolio?.owner ? `/admin/portfolio-owners/${selectedPortfolio.owner.client_db_id}` : null;
  const adminRequest = useCallback((path: string) => fetch(`${BASE_URL}${path}`, { credentials: "include" }), []);

  async function loadOwnerCandidates() {
    try {
      const res = await fetch(`${BASE_URL}/clients?limit=200&include_archived=false`, { credentials: "include" });
      if (!res.ok) return;
      const json = await res.json() as { items?: ClientOption[] };
      setOwnerCandidates((json.items ?? []).filter((c) => (c.status ?? "").trim().toLowerCase() !== "portfolio owner"));
    } catch {
      setOwnerCandidates([]);
    }
  }

  function openAddPortfolio(prefillOwnerId?: number) {
    setAddPortfolioName("");
    setAddPortfolioOwnerId(prefillOwnerId ? String(prefillOwnerId) : "");
    setAddPortfolioStatus("");
    setAddPortfolioOpen(true);
    void loadOwnerCandidates();
  }

  async function submitAddPortfolio() {
    const name = addPortfolioName.trim();
    if (!name) {
      setAddPortfolioStatus("Portfolio name is required");
      return;
    }
    setAddPortfolioSaving(true);
    setAddPortfolioStatus("");
    try {
      const res = await fetch(`${BASE_URL}/admin/lookups/portfolios_lookup`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          portfolio_owner_client_db_id: addPortfolioOwnerId ? Number(addPortfolioOwnerId) : null,
          is_active: true,
        }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null) as { detail?: string } | null;
        throw new Error(detail?.detail || `Failed to create portfolio (${res.status})`);
      }
      setAddPortfolioOpen(false);
      await loadPortfolios();
    } catch (err) {
      setAddPortfolioStatus((err as Error).message || "Failed to create portfolio");
    } finally {
      setAddPortfolioSaving(false);
    }
  }

  async function openAddMembers() {
    setMemberSearch("");
    setSelectedCandidateIds(new Set());
    setAddMembersOpen(true);
    try {
      const res = await fetch(`${BASE_URL}/clients?limit=200&include_archived=false`, { credentials: "include" });
      if (!res.ok) return;
      const json = await res.json() as { items?: ClientOption[] };
      setMemberCandidates(json.items ?? []);
    } catch {
      setMemberCandidates([]);
    }
  }

  const filteredCandidates = useMemo(() => {
    if (!selectedPortfolio) return [];
    const memberIds = new Set(members.map((m) => m.client_db_id));
    const ownerId = selectedPortfolio.owner?.client_db_id;
    const q = memberSearch.trim().toLowerCase();
    return memberCandidates.filter((c) => {
      if (c.client_db_id === ownerId) return false;
      if (memberIds.has(c.client_db_id)) return false;
      if (!q) return true;
      return c.client_name.toLowerCase().includes(q);
    });
  }, [memberCandidates, members, memberSearch, selectedPortfolio]);

  function toggleCandidate(clientId: number) {
    setSelectedCandidateIds((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  }

  async function submitAddMembers() {
    if (!selectedPortfolio || selectedCandidateIds.size === 0) return;
    setAddMembersSaving(true);
    try {
      await fetch(`${BASE_URL}/admin/portfolios/${selectedPortfolio.portfolio_id}/members`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_ids: Array.from(selectedCandidateIds) }),
      });
      setAddMembersOpen(false);
      await Promise.all([loadMembers(selectedPortfolio.portfolio_id), loadPortfolios()]);
    } finally {
      setAddMembersSaving(false);
    }
  }

  async function removeMember(member: PortfolioMember) {
    if (!selectedPortfolio) return;
    const confirmed = await confirmAction({
      title: "Remove from portfolio?",
      description: `Remove "${member.client_name}" from ${selectedPortfolio.name}? They will no longer appear in this portfolio's dashboard.`,
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!confirmed) return;
    await fetch(`${BASE_URL}/admin/portfolios/${selectedPortfolio.portfolio_id}/members`, {
      method: "DELETE",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_ids: [member.client_db_id] }),
    });
    await Promise.all([loadMembers(selectedPortfolio.portfolio_id), loadPortfolios()]);
  }

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
                    {portfolios.length} portfolios
                  </Badge>
                </div>
                <div>
                  <h1 className="text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">Portfolio owners and their client networks</h1>
                  <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600 sm:text-lg">
                    Create a portfolio, link it to an owner, and manage which clients belong to it -- all from here.
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-3 lg:min-w-[360px]">
                <div className="flex flex-wrap justify-start gap-3 lg:justify-end">
                  <Button className="rounded-full bg-[#1c5026] text-white hover:bg-[#153f1e]" onClick={() => openAddPortfolio()}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Portfolio Owner
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <StatPill label="Portfolios" value={portfolios.length.toString()} icon={Layers} />
                  <StatPill label="Owners linked" value={portfolios.filter((p) => p.owner).length.toString()} icon={Building2} />
                  <StatPill label="Unlinked" value={unlinkedOwners.length.toString()} icon={Sparkles} />
                </div>
              </div>
            </div>

            {unlinkedOwners.length > 0 && (
              <div className="relative mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <div className="text-sm font-semibold text-amber-900">
                  {unlinkedOwners.length} client{unlinkedOwners.length === 1 ? "" : "s"} marked as Portfolio Owner but not linked to a portfolio
                </div>
                <p className="mt-1 text-xs text-amber-800">
                  Their portal login won&apos;t show any client network until linked to a portfolio below.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {unlinkedOwners.map((owner) => (
                    <Button
                      key={owner.client_db_id}
                      variant="outline"
                      size="sm"
                      className="rounded-full border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                      onClick={() => openAddPortfolio(owner.client_db_id)}
                    >
                      Link {owner.client_name}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-0 xl:grid-cols-[400px_minmax(0,1fr)]">
            <aside className="border-b border-slate-200/70 xl:border-b-0 xl:border-r xl:border-slate-200/70">
              <div className="border-b border-slate-200/70 p-5">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search portfolios..."
                    className="h-11 rounded-2xl border-slate-200 bg-white pl-9 shadow-sm"
                  />
                </div>
              </div>

              <div className="max-h-[calc(100vh-260px)] overflow-auto">
                {loading && !portfolios.length ? (
                  <div className="p-4 text-sm text-slate-500">Loading portfolios...</div>
                ) : error ? (
                  <div className="m-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
                ) : filteredPortfolios.length === 0 ? (
                  <div className="m-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
                    No portfolios match your search.
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50 text-left text-xs font-medium text-gray-500">
                        <th className="px-4 py-2.5">Portfolio</th>
                        <th className="px-4 py-2.5">Owner</th>
                        <th className="px-4 py-2.5 text-right">Members</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredPortfolios.map((p) => {
                        const selected = p.portfolio_id === selectedPortfolio?.portfolio_id;
                        return (
                          <tr
                            key={p.portfolio_id}
                            onClick={() => setSelectedPortfolioId(p.portfolio_id)}
                            className={`cursor-pointer transition-colors ${selected ? "bg-[#1c5026]/8" : "hover:bg-slate-50"}`}
                          >
                            <td className="px-4 py-3">
                              <div className="font-semibold text-slate-900">{p.name}</div>
                              {!p.is_active && <Badge variant="outline" className="mt-1 border-slate-300 text-slate-500">Inactive</Badge>}
                            </td>
                            <td className="px-4 py-3 text-slate-600">
                              {p.owner ? p.owner.client_name : <span className="text-amber-700">Unlinked</span>}
                            </td>
                            <td className="px-4 py-3 text-right font-medium text-slate-700">{p.member_count}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </aside>

            <main className="min-w-0">
              {!selectedPortfolio ? (
                <div className="m-6 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center text-slate-500">
                  Choose a portfolio on the left, or add a new one.
                </div>
              ) : (
                <>
                  <div className="border-b border-slate-200/70 px-6 py-4 sm:px-8">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Portfolio</div>
                        <h2 className="text-2xl font-semibold text-slate-900">{selectedPortfolio.name}</h2>
                        <div className="mt-1 text-sm text-slate-500">
                          Owner: {selectedPortfolio.owner ? selectedPortfolio.owner.client_name : "Not linked yet"}
                        </div>
                      </div>
                      {selectedPortfolio.owner ? (
                        <Button asChild variant="outline" className="rounded-full">
                          <Link href={`/clients/${selectedPortfolio.owner.client_db_id}/edit`}>
                            Open client record
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </Link>
                        </Button>
                      ) : (
                        <Button className="rounded-full bg-[#1c5026] text-white hover:bg-[#153f1e]" onClick={() => openAddPortfolio()}>
                          Link an owner
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-6 px-6 py-6 sm:px-8">
                    <div className="rounded-2xl border border-slate-200 bg-white">
                      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                          <Users className="h-4 w-4 text-[#1c5026]" />
                          Members
                          {!membersLoading && <span className="text-xs font-normal text-slate-500">({members.length})</span>}
                        </div>
                        <Button size="sm" className="rounded-full bg-[#1c5026] text-white hover:bg-[#153f1e]" onClick={() => void openAddMembers()}>
                          <Plus className="mr-1.5 h-3.5 w-3.5" />
                          Add Clients
                        </Button>
                      </div>
                      {membersLoading ? (
                        <div className="p-6 text-center text-sm text-slate-500">Loading members...</div>
                      ) : members.length === 0 ? (
                        <div className="p-6 text-center text-sm text-slate-500">
                          No clients in this portfolio yet.
                        </div>
                      ) : (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b bg-gray-50 text-left text-xs font-medium text-gray-500">
                              <th className="px-4 py-2.5">Client</th>
                              <th className="px-4 py-2.5">Status</th>
                              <th className="px-4 py-2.5">Industry</th>
                              <th className="px-4 py-2.5">CRM Owner</th>
                              <th className="px-4 py-2.5 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {members.map((m) => (
                              <tr key={m.client_db_id} className="hover:bg-gray-50/50">
                                <td className="px-4 py-2.5 font-medium text-slate-900">{m.client_name}</td>
                                <td className="px-4 py-2.5">
                                  <Badge variant="outline" className="text-xs">{m.status ?? "—"}</Badge>
                                </td>
                                <td className="px-4 py-2.5 text-slate-500">{m.industry ?? "—"}</td>
                                <td className="px-4 py-2.5 text-slate-500">{m.crm_owner ?? "—"}</td>
                                <td className="px-4 py-2.5 text-right">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                                    onClick={() => void removeMember(m)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>

                    {detailEndpoint ? (
                      <PortalPortfolioDashboard endpoint={detailEndpoint} request={adminRequest} />
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center text-sm text-slate-500">
                        Link a portfolio owner to see the portfolio dashboard.
                      </div>
                    )}
                  </div>
                </>
              )}
            </main>
          </div>
        </div>
      </div>

      {/* Add Portfolio Owner modal */}
      <Dialog open={addPortfolioOpen} onOpenChange={setAddPortfolioOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Portfolio Owner</DialogTitle>
            <DialogDescription>
              Name the portfolio and pick the client who owns it. The selected client will be promoted to Portfolio Owner status.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="portfolioName">Portfolio Name</Label>
              <Input
                id="portfolioName"
                value={addPortfolioName}
                onChange={(e) => setAddPortfolioName(e.target.value)}
                placeholder="Acme Group"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="portfolioOwner">Portfolio Owner</Label>
              <Select value={addPortfolioOwnerId || "__none__"} onValueChange={setAddPortfolioOwnerId}>
                <SelectTrigger id="portfolioOwner">
                  <SelectValue placeholder="No owner linked" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No owner linked</SelectItem>
                  {ownerCandidates.map((c) => (
                    <SelectItem key={c.client_db_id} value={String(c.client_db_id)}>
                      {c.client_name}{c.status ? ` (${c.status})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {addPortfolioStatus && <p className="text-sm text-rose-600">{addPortfolioStatus}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddPortfolioOpen(false)}>Cancel</Button>
            <Button onClick={() => void submitAddPortfolio()} disabled={addPortfolioSaving} className="bg-[#1c5026] text-white hover:bg-[#153f1e]">
              {addPortfolioSaving ? "Saving…" : "Create Portfolio"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Clients modal */}
      <Dialog open={addMembersOpen} onOpenChange={setAddMembersOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add clients to {selectedPortfolio?.name}</DialogTitle>
            <DialogDescription>Select the clients that should belong to this portfolio.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Search clients..."
                className="pl-9"
              />
            </div>
            <div className="max-h-80 overflow-auto rounded-md border">
              {filteredCandidates.length === 0 ? (
                <div className="p-4 text-center text-sm text-slate-500">No matching clients.</div>
              ) : (
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-gray-100">
                    {filteredCandidates.map((c) => (
                      <tr
                        key={c.client_db_id}
                        className="cursor-pointer hover:bg-gray-50/70"
                        onClick={() => toggleCandidate(c.client_db_id)}
                      >
                        <td className="w-8 px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={selectedCandidateIds.has(c.client_db_id)}
                            onChange={() => toggleCandidate(c.client_db_id)}
                            onClick={(e) => e.stopPropagation()}
                            className="h-4 w-4 rounded border-gray-300 text-green-600 cursor-pointer"
                          />
                        </td>
                        <td className="px-3 py-2 font-medium text-slate-900">{c.client_name}</td>
                        <td className="px-3 py-2 text-xs text-slate-500">{c.status ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {selectedCandidateIds.size > 0 && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>{selectedCandidateIds.size} selected</span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-600"
                  onClick={() => setSelectedCandidateIds(new Set())}
                >
                  <X className="h-3 w-3" /> clear
                </button>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddMembersOpen(false)}>Cancel</Button>
            <Button
              onClick={() => void submitAddMembers()}
              disabled={addMembersSaving || selectedCandidateIds.size === 0}
              className="bg-[#1c5026] text-white hover:bg-[#153f1e]"
            >
              {addMembersSaving ? "Adding…" : `Add ${selectedCandidateIds.size || ""} Client${selectedCandidateIds.size === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
