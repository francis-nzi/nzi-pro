"use client";

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
import { getAuthUserIdentifier, getToken } from "@/lib/auth-client";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";

function apiBaseCandidates(baseUrl?: string): string[] {
  const out: string[] = ["/api/backend"];
  if (typeof window !== "undefined") {
    const host = window.location.hostname || "localhost";
    out.push(`http://${host}:8002`);
    out.push(`http://${host}:8000`);
  }
  if (baseUrl && String(baseUrl).trim()) out.push(String(baseUrl).trim());
  out.push("http://127.0.0.1:8002", "http://localhost:8000");
  return Array.from(new Set(out));
}

type Site = { site_id: number | null; site_name: string | null };
type RegisterGroup = {
  group_id: number;
  scope: string;
  category: string | null;
  group_type: string;
  group_name: string;
  site_id: number | null;
  rollup_method: string;
  notes: string | null;
  enabled: boolean;
  source_count?: number;
  source_total_qty?: number;
  source_total_tco2e?: number;
};
type RegisterSource = {
  source_id: number;
  group_id: number | null;
  group_name: string | null;
  scope: string;
  category: string | null;
  source_type: string;
  source_subtype: string | null;
  site_id: number | null;
  site_name: string | null;
  source_name: string;
  asset_identifier: string | null;
  employee_name: string | null;
  original_id: string | null;
  qty: number | null;
  uom: string | null;
  factor: number | null;
  ghg_unit: string | null;
  apply_pct: number;
  notes: string | null;
  data_source: string | null;
  data_confidence: string | null;
  calc_tco2e: number;
  enabled: boolean;
};
type FactorOption = {
  scope: string;
  category: string;
  report_label: string;
  original_id: string;
  uom: string | null;
  factor: number | null;
  ghg_unit: string | null;
  factor_db_id?: number | null;
};
type RegisterPayload = {
  job_id: number;
  source_type: string;
  summary: {
    group_count: number;
    source_count: number;
    enabled_source_count: number;
    disabled_source_count: number;
    ungrouped_source_count: number;
    total_tco2e: number;
  };
  groups: RegisterGroup[];
  sources: RegisterSource[];
};

function blankScope(sourceType: string): string {
  return sourceType === "business_travel" ? "Scope 3" : "Scope 1";
}

export default function JobSourceRegister({
  jobId,
  baseUrl,
  sourceType,
  title,
  description,
  identityLabel,
}: {
  jobId: number;
  baseUrl: string;
  sourceType: "asset" | "business_travel";
  title: string;
  description: string;
  identityLabel: string;
}) {
  const confirmAction = useConfirmDialog();
  const apiBases = useMemo(() => apiBaseCandidates(baseUrl), [baseUrl]);
  const [activeApiBase, setActiveApiBase] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [sites, setSites] = useState<Site[]>([]);
  const [groups, setGroups] = useState<RegisterGroup[]>([]);
  const [sources, setSources] = useState<RegisterSource[]>([]);
  const [summary, setSummary] = useState<RegisterPayload["summary"] | null>(null);

  const [selectedSiteId, setSelectedSiteId] = useState<string>("__none__");
  const [selectedGroupId, setSelectedGroupId] = useState<string>("__none__");
  const [selectedScope, setSelectedScope] = useState<string>(blankScope(sourceType));
  const [selectedCategory, setSelectedCategory] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [assetIdentifier, setAssetIdentifier] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [sourceSubtype, setSourceSubtype] = useState("");
  const [qty, setQty] = useState("1");
  const [uom, setUom] = useState("");
  const [applyPct, setApplyPct] = useState("100");
  const [notes, setNotes] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupScope, setGroupScope] = useState<string>(blankScope(sourceType));
  const [groupCategory, setGroupCategory] = useState("");
  const [groupRollupMethod, setGroupRollupMethod] = useState("sum");
  const [groupNotes, setGroupNotes] = useState("");
  const [groupSiteId, setGroupSiteId] = useState<string>("__none__");

  const [factorSearch, setFactorSearch] = useState("");
  const [factorScopeFilter, setFactorScopeFilter] = useState<string>(blankScope(sourceType));
  const [factorOptions, setFactorOptions] = useState<FactorOption[]>([]);
  const [selectedFactor, setSelectedFactor] = useState<FactorOption | null>(null);

  async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
    const token = getToken();
    const userIdentifier = getAuthUserIdentifier();
    const authHeaders: Record<string, string> = {};
    if (token) authHeaders.Authorization = `Bearer ${token}`;
    else if (userIdentifier) authHeaders["X-User-Email"] = userIdentifier;

    const orderedBases = activeApiBase
      ? [activeApiBase, ...apiBases.filter((b) => b !== activeApiBase)]
      : apiBases;

    let fallback: Response | null = null;
    let lastError: unknown = null;
    for (const base of orderedBases) {
      try {
        const res = await fetch(`${base}${path}`, {
          ...init,
          credentials: init?.credentials ?? "include",
          headers: {
            ...authHeaders,
            ...(init?.headers as Record<string, string> | undefined),
          },
        });
        if (res.ok) {
          if (activeApiBase !== base) setActiveApiBase(base);
          return res;
        }
        if (res.status === 401 || res.status === 403) {
          if (!fallback) fallback = res;
          continue;
        }
        if (!fallback) fallback = res;
        return res;
      } catch (e) {
        lastError = e;
      }
    }
    if (fallback) return fallback;
    if (lastError instanceof Error) throw lastError;
    throw new Error("Failed to fetch");
  }

  async function loadSites() {
    try {
      const res = await apiFetch(`/jobs/${jobId}/sites`);
      if (!res.ok) return;
      const data = await res.json();
      setSites(Array.isArray(data?.sites) ? data.sites : []);
    } catch {
      // non-fatal
    }
  }

  async function loadRegister() {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/jobs/${jobId}/emission-registers?source_type=${encodeURIComponent(sourceType)}`);
      if (!res.ok) throw new Error(`Failed to load register (${res.status})`);
      const data = (await res.json()) as RegisterPayload;
      setGroups(Array.isArray(data?.groups) ? data.groups : []);
      setSources(Array.isArray(data?.sources) ? data.sources : []);
      setSummary(data?.summary ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load register");
    } finally {
      setLoading(false);
    }
  }

  async function loadFactors() {
    try {
      const queryParts = new URLSearchParams();
      queryParts.set("limit", "50");
      queryParts.set("offset", "0");
      if (factorScopeFilter !== "All") queryParts.set("scope", factorScopeFilter);
      if (factorSearch.trim()) queryParts.set("search", factorSearch.trim());
      const res = await apiFetch(`/jobs/${jobId}/template-factors?${queryParts.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      const rows: FactorOption[] = Array.isArray(data?.factors) ? data.factors : [];
      setFactorOptions(rows);
    } catch {
      // non-fatal
    }
  }

  useEffect(() => {
    void loadSites();
    void loadRegister();
    void loadFactors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, sourceType, baseUrl, activeApiBase]);

  useEffect(() => {
    void loadFactors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factorScopeFilter, factorSearch]);

  function chooseFactor(factor: FactorOption) {
    setSelectedFactor(factor);
    setSelectedScope(factor.scope || blankScope(sourceType));
    setSelectedCategory(factor.category || "");
    setUom(factor.uom || "");
  }

  async function createGroup() {
    setLoading(true);
    setError("");
    try {
      const payload = {
        scope: groupScope,
        group_name: groupName.trim(),
        group_type: sourceType,
        category: groupCategory.trim() || null,
        site_id: groupSiteId !== "__none__" ? Number(groupSiteId) : null,
        rollup_method: groupRollupMethod,
        notes: groupNotes.trim() || null,
      };
      const res = await apiFetch(`/jobs/${jobId}/emission-registers/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Failed to create group (${res.status})`);
      }
      setGroupName("");
      setGroupCategory("");
      setGroupNotes("");
      setGroupSiteId("__none__");
      setStatus("Group created.");
      await loadRegister();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create group");
    } finally {
      setLoading(false);
    }
  }

  async function createSource() {
    setLoading(true);
    setError("");
    try {
      const payload = {
        scope: selectedScope,
        category: selectedCategory.trim() || selectedFactor?.category || null,
        source_type: sourceType,
        source_subtype: sourceSubtype.trim() || null,
        site_id: selectedSiteId !== "__none__" ? Number(selectedSiteId) : null,
        group_id: selectedGroupId !== "__none__" ? Number(selectedGroupId) : null,
        source_name: sourceName.trim(),
        asset_identifier: assetIdentifier.trim() || null,
        employee_name: employeeName.trim() || null,
        original_id: selectedFactor?.original_id || null,
        factor_db_id: selectedFactor?.factor_db_id ?? null,
        qty: qty.trim() ? Number(qty) : null,
        uom: uom.trim() || selectedFactor?.uom || null,
        factor: selectedFactor?.factor ?? null,
        ghg_unit: selectedFactor?.ghg_unit ?? null,
        apply_pct: applyPct.trim() ? Number(applyPct) : 100,
        data_source: sourceType === "business_travel" ? "Business Travel Register" : "Asset Register",
        data_confidence: "M",
        notes: notes.trim() || null,
        detail_json: {},
      };
      if (!payload.source_name) throw new Error("Source name is required.");
      if (!payload.original_id) throw new Error("Select a factor before adding the source.");
      const res = await apiFetch(`/jobs/${jobId}/emission-registers/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Failed to create source (${res.status})`);
      }
      setSourceName("");
      setAssetIdentifier("");
      setEmployeeName("");
      setSourceSubtype("");
      setQty("1");
      setApplyPct("100");
      setNotes("");
      setSelectedFactor(null);
      setStatus("Source added.");
      await loadRegister();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create source");
    } finally {
      setLoading(false);
    }
  }

  async function removeSource(sourceId: number, label: string) {
    const confirmed = await confirmAction({
      title: "Delete source",
      description: `Delete source "${label}"? It will be hidden from the active register but kept in history.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/jobs/${jobId}/emission-registers/sources/${sourceId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Delete failed (${res.status})`);
      }
      setStatus("Source archived.");
      await loadRegister();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete source");
    } finally {
      setLoading(false);
    }
  }

  async function removeGroup(groupId: number, label: string) {
    const confirmed = await confirmAction({
      title: "Delete group",
      description: `Delete group "${label}"? Sources will remain and the group will be hidden.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/jobs/${jobId}/emission-registers/groups/${groupId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Delete failed (${res.status})`);
      }
      setStatus("Group archived.");
      await loadRegister();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete group");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <p className="text-sm text-muted-foreground">{description}</p>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div><div className="text-xs text-muted-foreground">Sources</div><div className="text-2xl font-semibold">{summary?.source_count ?? 0}</div></div>
          <div><div className="text-xs text-muted-foreground">Groups</div><div className="text-2xl font-semibold">{summary?.group_count ?? 0}</div></div>
          <div><div className="text-xs text-muted-foreground">Ungrouped</div><div className="text-2xl font-semibold">{summary?.ungrouped_source_count ?? 0}</div></div>
          <div><div className="text-xs text-muted-foreground">tCO2e</div><div className="text-2xl font-semibold">{(summary?.total_tco2e ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}</div></div>
        </CardContent>
      </Card>

      {error ? <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div> : null}
      {status ? <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{status}</div> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Create Group</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Group name</Label>
                <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Fleet - Medium Diesel" />
              </div>
              <div className="space-y-2">
                <Label>Scope</Label>
                <Select value={groupScope} onValueChange={setGroupScope}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Scope 1">Scope 1</SelectItem>
                    <SelectItem value="Scope 2">Scope 2</SelectItem>
                    <SelectItem value="Scope 3">Scope 3</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Input value={groupCategory} onChange={(e) => setGroupCategory(e.target.value)} placeholder="Fleet / Travel / Equipment" />
              </div>
              <div className="space-y-2">
                <Label>Roll-up</Label>
                <Select value={groupRollupMethod} onValueChange={setGroupRollupMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sum">Sum</SelectItem>
                    <SelectItem value="weighted_sum">Weighted sum</SelectItem>
                    <SelectItem value="headcount_scaled">Headcount scaled</SelectItem>
                    <SelectItem value="average">Average</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Site</Label>
              <Select value={groupSiteId} onValueChange={setGroupSiteId}>
                <SelectTrigger><SelectValue placeholder="Optional site..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No site</SelectItem>
                  {sites.filter((s) => s.site_id != null).map((s) => (
                    <SelectItem key={String(s.site_id)} value={String(s.site_id)}>{s.site_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Input value={groupNotes} onChange={(e) => setGroupNotes(e.target.value)} placeholder="Optional roll-up notes" />
            </div>
            <div className="flex justify-end">
              <Button onClick={createGroup} disabled={loading || !groupName.trim()}>Create group</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Add Source</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Source name</Label>
                <Input value={sourceName} onChange={(e) => setSourceName(e.target.value)} placeholder={sourceType === "business_travel" ? "Employee travel pattern" : "Vehicle / Asset name"} />
              </div>
              <div className="space-y-2">
                <Label>{identityLabel}</Label>
                <Input value={assetIdentifier} onChange={(e) => setAssetIdentifier(e.target.value)} placeholder={sourceType === "business_travel" ? "Employee ref / trip ref" : "Registration / asset tag"} />
              </div>
              <div className="space-y-2">
                <Label>Employee name</Label>
                <Input value={employeeName} onChange={(e) => setEmployeeName(e.target.value)} placeholder="Optional" />
              </div>
              <div className="space-y-2">
                <Label>Source subtype</Label>
                <Input value={sourceSubtype} onChange={(e) => setSourceSubtype(e.target.value)} placeholder="Optional subtype" />
              </div>
              <div className="space-y-2">
                <Label>Scope</Label>
                <Select value={selectedScope} onValueChange={setSelectedScope}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Scope 1">Scope 1</SelectItem>
                    <SelectItem value="Scope 2">Scope 2</SelectItem>
                    <SelectItem value="Scope 3">Scope 3</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Input value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} placeholder="Optional if factor fills it" />
              </div>
              <div className="space-y-2">
                <Label>Site</Label>
                <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
                  <SelectTrigger><SelectValue placeholder="Optional site..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No site</SelectItem>
                    {sites.filter((s) => s.site_id != null).map((s) => (
                      <SelectItem key={String(s.site_id)} value={String(s.site_id)}>{s.site_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Group</Label>
                <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
                  <SelectTrigger><SelectValue placeholder="Optional group..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No group</SelectItem>
                    {groups.map((g) => (
                      <SelectItem key={g.group_id} value={String(g.group_id)}>{g.group_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Qty</Label>
                <Input type="number" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Apply %</Label>
                <Input type="number" step="any" value={applyPct} onChange={(e) => setApplyPct(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Unit</Label>
                <Input value={uom} onChange={(e) => setUom(e.target.value)} placeholder="e.g. km, miles, kWh" />
              </div>
              <div className="space-y-2">
                <Label>Factor search</Label>
                <Input value={factorSearch} onChange={(e) => setFactorSearch(e.target.value)} placeholder="Search factor IDs or labels" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Factor scope filter</Label>
              <Select value={factorScopeFilter} onValueChange={setFactorScopeFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All</SelectItem>
                  <SelectItem value="Scope 1">Scope 1</SelectItem>
                  <SelectItem value="Scope 2">Scope 2</SelectItem>
                  <SelectItem value="Scope 3">Scope 3</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="max-h-56 overflow-auto rounded-md border">
              <div className="grid grid-cols-[1fr_auto] gap-2 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
                <div>Factor</div>
                <div>Select</div>
              </div>
              {factorOptions.length ? factorOptions.map((factor) => (
                <div key={`${factor.original_id}-${factor.report_label}`} className="grid grid-cols-[1fr_auto] gap-2 border-b px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{factor.report_label}</div>
                    <div className="text-xs text-muted-foreground">{factor.scope} · {factor.category} · {factor.original_id}</div>
                  </div>
                  <Button variant={selectedFactor?.original_id === factor.original_id ? "secondary" : "outline"} size="sm" onClick={() => chooseFactor(factor)}>
                    {selectedFactor?.original_id === factor.original_id ? "Chosen" : "Use"}
                  </Button>
                </div>
              )) : (
                <div className="p-3 text-sm text-muted-foreground">Search to find a factor, then choose it to attach to the source.</div>
              )}
            </div>
            {selectedFactor ? (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="font-medium">Selected factor</div>
                <div className="text-muted-foreground">{selectedFactor.report_label} · {selectedFactor.original_id} · {selectedFactor.factor ?? "-"} {selectedFactor.ghg_unit ?? ""}</div>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label>Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />
            </div>
            <div className="flex justify-end">
              <Button onClick={createSource} disabled={loading || !sourceName.trim() || !selectedFactor}>Add source</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Groups</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-2">Name</th>
                <th className="p-2">Scope</th>
                <th className="p-2">Type</th>
                <th className="p-2">Sources</th>
                <th className="p-2 text-right">tCO2e</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {groups.length ? groups.map((g) => (
                <tr key={g.group_id} className="border-b">
                  <td className="p-2">{g.group_name}</td>
                  <td className="p-2">{g.scope}</td>
                  <td className="p-2">{g.group_type}</td>
                  <td className="p-2">{g.source_count ?? 0}</td>
                  <td className="p-2 text-right">{(g.source_total_tco2e ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                  <td className="p-2 text-right">
                    <Button variant="outline" size="sm" onClick={() => removeGroup(g.group_id, g.group_name)}>Delete</Button>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={6} className="p-4 text-muted-foreground">No groups yet.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sources</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-2">Name</th>
                <th className="p-2">Identity</th>
                <th className="p-2">Scope</th>
                <th className="p-2">Group</th>
                <th className="p-2 text-right">Qty</th>
                <th className="p-2 text-right">tCO2e</th>
                <th className="p-2">Status</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {sources.length ? sources.map((s) => (
                <tr key={s.source_id} className="border-b">
                  <td className="p-2">{s.source_name}</td>
                  <td className="p-2">{s.asset_identifier || s.employee_name || "-"}</td>
                  <td className="p-2">{s.scope}</td>
                  <td className="p-2">{s.group_name || "-"}</td>
                  <td className="p-2 text-right">{typeof s.qty === "number" ? s.qty.toLocaleString() : "-"}</td>
                  <td className="p-2 text-right">{(s.calc_tco2e ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                  <td className="p-2">{s.enabled ? "Active" : "Hidden"}</td>
                  <td className="p-2 text-right">
                    <Button variant="outline" size="sm" onClick={() => removeSource(s.source_id, s.source_name)}>Delete</Button>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={8} className="p-4 text-muted-foreground">No sources yet.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
