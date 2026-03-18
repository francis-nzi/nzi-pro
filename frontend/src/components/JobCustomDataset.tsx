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
  const out: string[] = [];
  out.push("/api/backend");

  if (typeof window !== "undefined") {
    const host = window.location.hostname || "localhost";
    out.push(`http://${host}:8002`);
    out.push(`http://${host}:8000`);
  }

  if (baseUrl && String(baseUrl).trim()) out.push(String(baseUrl).trim());
  out.push("http://127.0.0.1:8002");
  out.push("http://localhost:8000");

  return Array.from(new Set(out));
}

type TemplateFactor = {
  scope: string;
  category: string;
  report_label: string;
  original_id: string;
  uom: string | null;
  factor: number | null;
  ghg_unit: string | null;
  is_custom?: boolean;
  source?: string | null;
};

type ScopeDataRow = {
  row_id: number;
  scope: string;
  site_id: number | null;
  category: string | null;
  report_label: string | null;
  original_id: string;
  uom: string | null;
  qty: number | null;
  factor: number | null;
  ghg_unit: string | null;
  apply_pct: number;
  notes: string | null;
  is_custom_entry: boolean;
};
type JobSitesResponse = {
  job_id: number;
  client_db_id: number;
  sites: Array<{
    site_id: number | null;
    site_name: string | null;
    location: string | null;
    is_registered_office: boolean;
  }>;
};

export default function JobCustomDataset({
  jobId,
  baseUrl,
}: {
  jobId: number;
  baseUrl: string;
}) {
  const confirmAction = useConfirmDialog();
  function errorMessage(err: unknown, fallback: string): string {
    if (err instanceof Error && err.message) return err.message;
    return fallback;
  }

  const [loading, setLoading] = useState(false);
  const [factors, setFactors] = useState<TemplateFactor[]>([]);
  const [sites, setSites] = useState<JobSitesResponse["sites"]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>("__none__");
  const [rows, setRows] = useState<ScopeDataRow[]>([]);
  const [error, setError] = useState("");

  const [scope, setScope] = useState<string>("All");
  const [search, setSearch] = useState<string>("");
  const [activeApiBase, setActiveApiBase] = useState<string | null>(null);

  const apiBases = useMemo(() => apiBaseCandidates(baseUrl), [baseUrl]);

  async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
    const token = getToken();
    const userIdentifier = getAuthUserIdentifier();
    const authHeaders: Record<string, string> = {};
    if (token) authHeaders.Authorization = `Bearer ${token}`;
    else if (userIdentifier) authHeaders["X-User-Email"] = userIdentifier;

    const orderedBases = activeApiBase
      ? [activeApiBase, ...apiBases.filter((b) => b !== activeApiBase)]
      : apiBases;

    let lastError: unknown = null;
    let fallbackResponse: Response | null = null;

    for (const base of orderedBases) {
      try {
        const mergedHeaders = {
          ...authHeaders,
          ...(init?.headers as Record<string, string> | undefined),
        };
        const url = `${base}${path}`;
        const res = await fetch(url, {
          ...init,
          credentials: init?.credentials ?? "include",
          headers: mergedHeaders,
        });

        if (res.ok) {
          if (activeApiBase !== base) setActiveApiBase(base);
          return res;
        }

        if (res.status === 401 || res.status === 403) {
          if (!fallbackResponse) fallbackResponse = res;
          continue;
        }

        if (!fallbackResponse) fallbackResponse = res;
        return res;
      } catch (e) {
        lastError = e;
      }
    }

    if (fallbackResponse) return fallbackResponse;
    if (lastError instanceof Error) throw lastError;
    throw new Error("Failed to fetch");
  }

  async function loadSites() {
  try {
    const res = await apiFetch(`/jobs/${jobId}/sites`);
    if (!res.ok) return;

    const json = (await res.json()) as JobSitesResponse;
    const s = Array.isArray(json?.sites) ? json.sites : [];
    setSites(s);

    setSelectedSiteId((prev) => {
      if (prev !== "__none__") return prev;
      const first = s.find((x) => x.site_id != null)?.site_id;
      return first != null ? String(first) : "__none__";
    });
  } catch {
    // Non-fatal: rows can still be added without a site
  }
}
async function load() {
    setLoading(true);
    setError("");
    try {
      const [fRes, rRes] = await Promise.all([
        apiFetch(
          `/jobs/${jobId}/template-factors?limit=500&offset=0&scope=${
            scope === "All" ? "" : encodeURIComponent(scope)
          }&search=${encodeURIComponent(search)}`
        ),
        apiFetch(`/jobs/${jobId}/scope-data`),
      ]);

      if (!fRes.ok) {
        const msg = await fRes.text().catch(() => "");
        throw new Error(`template-factors failed (${fRes.status})${msg ? `: ${msg.slice(0, 200)}` : ""}`);
      }
      if (!rRes.ok) {
        const msg = await rRes.text().catch(() => "");
        throw new Error(`scope-data failed (${rRes.status})${msg ? `: ${msg.slice(0, 200)}` : ""}`);
      }

      const fJson = await fRes.json();
      const rJson = await rRes.json();

      const allFactors: TemplateFactor[] = Array.isArray(fJson?.factors) ? fJson.factors : [];
      const allRows: ScopeDataRow[] = Array.isArray(rJson?.rows) ? rJson.rows : [];

      setFactors(allFactors.filter((x) => Boolean(x?.is_custom)));
      setRows(allRows.filter((x) => Boolean(x?.is_custom_entry)));
    } catch (e: unknown) {
      setError(errorMessage(e, "Failed to load custom dataset data"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
  loadSites();
  load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, scope, baseUrl, activeApiBase]);

  const filteredFactors = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return factors;
    return factors.filter((f) => {
      const hay = [f.original_id, f.report_label, f.category, f.scope, f.source ?? ""]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [factors, search]);

    async function addFactorToJob(f: TemplateFactor) {
    setLoading(true);
    setError("");
    try {
      const siteId =
        selectedSiteId && selectedSiteId !== "__none__" ? Number(selectedSiteId) : null;

      const payload = {
        scope: f.scope,
        original_id: f.original_id,
        category: f.category ?? null,
        report_label: f.report_label ?? f.original_id,
        qty: 0,
        uom: f.uom,
        factor: f.factor,
        ghg_unit: f.ghg_unit,
        apply_pct: 100,
        data_source: "Custom Dataset",
        notes: f.source ? `Source: ${f.source}` : null,
        is_custom_entry: true,
        site_id: siteId,
      };

      const res = await apiFetch(`/jobs/${jobId}/scope-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // ... existing code ...

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Add failed (${res.status}): ${text.slice(0, 200)}`);
      }

      await load();
    } catch (e: unknown) {
      setError(errorMessage(e, "Failed to add factor"));
    } finally {
      setLoading(false);
    }
  }

  // Helper to get site name by ID
  function getSiteName(siteId: number | null): string {
    if (!siteId) return "No specific site";
    const site = sites.find(s => s.site_id === siteId);
    if (!site) return `Site #${siteId}`;
    return site.site_name ?? "Unnamed Site";
  }

  async function updateRow(rowId: number, patch: Partial<ScopeDataRow>) {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/jobs/${jobId}/scope-data/${rowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Update failed (${res.status}): ${text.slice(0, 200)}`);
      }

      await load();
    } catch (e: unknown) {
      setError(errorMessage(e, "Failed to update row"));
    } finally {
      setLoading(false);
    }
  }

  async function deleteRow(rowId: number) {
    const confirmed = await confirmAction({
      title: "Delete custom factor row?",
      description: "This custom dataset row will be removed from the job.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/jobs/${jobId}/scope-data/${rowId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Delete failed (${res.status}): ${text.slice(0, 200)}`);
      }

      await load();
    } catch (e: unknown) {
      setError(errorMessage(e, "Failed to delete row"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Custom Dataset</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label>Scope</Label>
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger>
                  <SelectValue placeholder="Scope" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All</SelectItem>
                  <SelectItem value="Scope 1">Scope 1</SelectItem>
                  <SelectItem value="Scope 2">Scope 2</SelectItem>
                  <SelectItem value="Scope 3">Scope 3</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Search</Label>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search custom IDs, labels, categories, sources…"
              />
            </div>
          </div>

          {error ? <div className="text-sm text-red-600">{error}</div> : null}

          {/* Site Selector */}
          <div className="flex items-center gap-4">
            <div className="space-y-2">
              <Label>Allocate to Site</Label>
              <Select
                value={selectedSiteId}
                onValueChange={setSelectedSiteId}
              >
                <SelectTrigger className="w-[250px]">
                  <SelectValue placeholder="Select a site..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No specific site</SelectItem>
                  {sites.map((site) => (
                    <SelectItem
                      key={site.site_id ?? "none"}
                      value={String(site.site_id ?? "__none__")}
                    >
                      {site.site_name ?? "Unnamed Site"}
                      {site.is_registered_office ? " (Registered Office)" : ""}
                      {site.location ? ` - ${site.location}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="text-xs text-muted-foreground">
              Select a site before adding factors to allocate emissions to specific locations
            </div>
          </div>

          <div className="rounded-md border">
            <div className="px-3 py-2 text-sm font-medium border-b">
              Available custom factors ({filteredFactors.length})
            </div>
            <div className="max-h-80 overflow-auto">
              {filteredFactors.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">
                  No custom factors found for this job (scope/client/search).
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b">
                      <th className="p-2 text-left">ID</th>
                      <th className="p-2 text-left">Label</th>
                      <th className="p-2 text-left">Scope</th>
                      <th className="p-2 text-left">Category</th>
                      <th className="p-2 text-right">Factor</th>
                      <th className="p-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFactors.slice(0, 200).map((f) => (
                      <tr key={`${f.scope}-${f.original_id}`} className="border-b">
                        <td className="p-2 font-mono">{f.original_id}</td>
                        <td className="p-2">{f.report_label}</td>
                        <td className="p-2">{f.scope}</td>
                        <td className="p-2">{f.category}</td>
                        <td className="p-2 text-right">
                          {typeof f.factor === "number" ? f.factor.toLocaleString() : "-"}
                        </td>
                        <td className="p-2 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={loading}
                            onClick={() => addFactorToJob(f)}
                          >
                            Add to Job
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {filteredFactors.length > 200 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground border-t">
                Showing first 200 results. Narrow search to find more.
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Custom rows in this job ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No custom dataset rows added to this job yet.
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map((r) => (
                <div key={r.row_id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">
                        {r.report_label ?? r.original_id}{" "}
                        <span className="text-xs text-muted-foreground font-mono">
                          ({r.original_id})
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {r.scope} • {r.category ?? "Uncategorized"} • Site: {getSiteName(r.site_id)}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <div className="text-[11px] font-medium text-muted-foreground">Qty</div>
                          <Input
                            className="w-28 text-right font-mono"
                            type="number"
                            step="0.01"
                            defaultValue={r.qty ?? 0}
                            onBlur={(e) => updateRow(r.row_id, { qty: Number(e.target.value || 0) })}
                          />
                        </div>

                        <div className="space-y-1">
                          <div className="text-[11px] font-medium text-muted-foreground">Apply %</div>
                          <Input
                            className="w-24 text-right font-mono"
                            type="number"
                            step="1"
                            defaultValue={r.apply_pct ?? 100}
                            onBlur={(e) =>
                              updateRow(r.row_id, { apply_pct: Number(e.target.value || 100) })
                            }
                          />
                        </div>
                      </div>

                      <div className="text-[11px] text-muted-foreground">
                        Qty × Factor × (Apply% / 100) = emissions
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="text-xs text-muted-foreground">
                      Factor:{" "}
                      <span className="font-mono">{typeof r.factor === "number" ? r.factor : "-"}</span> •
                      Unit: <span className="font-mono">{r.uom ?? "-"}</span> •
                      GHG: <span className="font-mono">{r.ghg_unit ?? "-"}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Input
                        className="flex-1"
                        placeholder="Notes"
                        defaultValue={r.notes ?? ""}
                        onBlur={(e) => updateRow(r.row_id, { notes: e.target.value })}
                      />
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={loading}
                        onClick={() => deleteRow(r.row_id)}
                        title="Delete this row"
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
