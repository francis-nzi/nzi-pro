"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { getAuthUserIdentifier, getToken } from "@/lib/auth-client";

function apiBaseCandidates(): string[] {
  const out: string[] = [];
  out.push("/api/backend");

  if (typeof window !== "undefined") {
    const host = window.location.hostname || "localhost";
    out.push(`http://${host}:8002`);
    out.push(`http://${host}:8000`);
  }

  const envBase = String(process.env.NEXT_PUBLIC_API_BASE_URL ?? "").trim();
  if (envBase) out.push(envBase);

  out.push("http://127.0.0.1:8002");
  out.push("http://localhost:8000");

  return Array.from(new Set(out));
}

type CustomFactor = {
  factor_id: number;
  custom_id?: string | null;
  country: string;
  scope: string;
  description: string;
  report_label?: string | null;
  category?: string | null;
  uom: string;
  ghg_unit: string;
  source: string;
  is_global?: boolean;
  client_db_id?: number | null;
  client_name?: string | null;
  is_active?: boolean;
  factors_by_year?: Record<string, number>;
  created_by?: string | null;
  created_at?: string | null;
  archived: boolean;
  [key: string]: unknown;
};

type ClientItem = {
  client_db_id: number;
  client_name: string;
};

type ClientApiRow = {
  client_db_id?: number | string | null;
  client_name?: string | null;
};

type ClientsResponse = {
  items?: ClientApiRow[];
};

const BASE_YEARS = Array.from({ length: 13 }, (_, i) => 2018 + i);

function yearsFromFactor(factor: CustomFactor): Record<number, string> {
  const out: Record<number, string> = {};

  const byYear = factor.factors_by_year;
  if (byYear && typeof byYear === "object") {
    Object.entries(byYear).forEach(([yearKey, value]) => {
      const y = Number(yearKey);
      if (!Number.isFinite(y)) return;
      if (typeof value === "number") {
        out[y] = String(value);
      }
    });
  }

  if (Object.keys(out).length === 0) {
    BASE_YEARS.forEach((y) => {
      const legacy = factor[`factor_${y}`];
      if (typeof legacy === "number") {
        out[y] = String(legacy);
      }
    });
  }

  return out;
}

function parseYearFactors(input: Record<number, string>): Record<string, number> {
  const out: Record<string, number> = {};
  Object.entries(input).forEach(([yearKey, raw]) => {
    const year = Number(yearKey);
    if (!Number.isFinite(year)) return;
    const text = String(raw ?? "").trim();
    if (!text) return;
    const val = Number(text);
    if (!Number.isFinite(val)) return;
    out[String(year)] = val;
  });
  return out;
}

export default function CustomFactorsPage() {
  const apiBases = useMemo(() => apiBaseCandidates(), []);
  const [activeApiBase, setActiveApiBase] = useState<string | null>(null);

  const apiFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      let lastError: unknown = null;
      let fallbackResponse: Response | null = null;
      const orderedBases = activeApiBase
        ? [activeApiBase, ...apiBases.filter((b) => b !== activeApiBase)]
        : apiBases;
      const token = getToken();
      const userIdentifier = getAuthUserIdentifier();
      const authHeaders: Record<string, string> = {};
      if (token) authHeaders.Authorization = `Bearer ${token}`;
      else if (userIdentifier) authHeaders["X-User-Email"] = userIdentifier;

      for (const base of orderedBases) {
        try {
          const mergedHeaders = {
            ...authHeaders,
            ...(init?.headers as Record<string, string> | undefined),
          };
          const url = base.startsWith("/") ? `${base}${path}` : `${base}${path}`;
          const response = await fetch(url, {
            ...init,
            credentials: init?.credentials ?? "include",
            headers: mergedHeaders,
          });
          if (response.ok) {
            if (activeApiBase !== base) setActiveApiBase(base);
            return response;
          }

          // Common local-dev mismatch: valid session exists on another host/port.
          if (response.status === 401 || response.status === 403) {
            if (!fallbackResponse) fallbackResponse = response;
            continue;
          }

          if (!fallbackResponse) fallbackResponse = response;
          return response;
        } catch (e) {
          lastError = e;
        }
      }
      if (fallbackResponse) return fallbackResponse;
      if (lastError instanceof Error) throw lastError;
      throw new Error("Failed to fetch");
    },
    [activeApiBase, apiBases]
  );

  const [factors, setFactors] = useState<CustomFactor[]>([]);
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);

  // Form state
  const [editingFactor, setEditingFactor] = useState<CustomFactor | null>(null);
  const [customId, setCustomId] = useState("");
  const [country, setCountry] = useState("UK");
  const [scope, setScope] = useState("Scope 2");
  const [description, setDescription] = useState("");
  const [reportLabel, setReportLabel] = useState("");
  const [category, setCategory] = useState("");
  const [uom, setUom] = useState("kWh");
  const [ghgUnit, setGhgUnit] = useState("kg CO2e");
  const [source, setSource] = useState("");
  const [isGlobal, setIsGlobal] = useState(true);
  const [clientDbId, setClientDbId] = useState<string>("__none__");
  const [isActive, setIsActive] = useState(true);
  const [yearFactors, setYearFactors] = useState<Record<number, string>>({});
  const [yearToAdd, setYearToAdd] = useState("");

  const loadClients = useCallback(async () => {
    try {
      const res = await apiFetch("/clients?limit=500&offset=0");
      if (!res.ok) return;
      const json = (await res.json()) as ClientsResponse;
      const items = Array.isArray(json?.items) ? json.items : [];
      setClients(
        items
          .map((c) => ({
            client_db_id: Number(c.client_db_id),
            client_name: String(c.client_name ?? ""),
          }))
          .filter((c: ClientItem) => Number.isFinite(c.client_db_id) && c.client_name)
      );
    } catch {
      // Non-blocking for factor management.
    }
  }, [apiFetch]);

  const loadFactors = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (includeArchived) params.set("include_archived", "true");

      const res = await apiFetch(`/custom-factors?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed to load factors: ${res.status}${text ? ` - ${text}` : ""}`);
      }

      const json = await res.json();
      setFactors(Array.isArray(json?.items) ? json.items : []);
    } catch (e) {
      setStatus(`Error loading factors: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, includeArchived]);

  useEffect(() => {
    loadFactors();
  }, [loadFactors]);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  function clearForm() {
    setEditingFactor(null);
    setCustomId("");
    setCountry("UK");
    setScope("Scope 2");
    setDescription("");
    setReportLabel("");
    setCategory("");
    setUom("kWh");
    setGhgUnit("kg CO2e");
    setSource("");
    setIsGlobal(true);
    setClientDbId("__none__");
    setIsActive(true);
    setYearFactors({});
    setYearToAdd("");
  }

  function startEdit(factor: CustomFactor) {
    setEditingFactor(factor);
    setCustomId(String(factor.custom_id ?? ""));
    setCountry(String(factor.country ?? ""));
    setScope(String(factor.scope ?? ""));
    setDescription(String(factor.description ?? ""));
    setReportLabel(String(factor.report_label ?? ""));
    setCategory(String(factor.category ?? ""));
    setUom(String(factor.uom ?? ""));
    setGhgUnit(String(factor.ghg_unit ?? ""));
    setSource(String(factor.source ?? ""));
    setIsGlobal(Boolean(factor.is_global ?? true));
    setClientDbId(
      factor.client_db_id != null && Number.isFinite(Number(factor.client_db_id))
        ? String(factor.client_db_id)
        : "__none__"
    );
    setIsActive(Boolean(factor.is_active ?? true));
    setYearFactors(yearsFromFactor(factor));
    setYearToAdd("");
  }

  const formYears = useMemo(() => {
    const years = new Set<number>(BASE_YEARS);
    Object.keys(yearFactors).forEach((k) => {
      const y = Number(k);
      if (Number.isFinite(y)) years.add(y);
    });
    return Array.from(years).sort((a, b) => a - b);
  }, [yearFactors]);

  function addYearField() {
    const year = Number(String(yearToAdd).trim());
    if (!Number.isFinite(year) || year < 1900 || year > 2200) {
      setStatus("Enter a valid year (1900-2200)");
      return;
    }

    if (BASE_YEARS.includes(year)) {
      setStatus(
        `Year ${year} is already included by default (2018-2030). Add an extra year like 2031.`
      );
      return;
    }

    if (Object.prototype.hasOwnProperty.call(yearFactors, year)) {
      setStatus(`Year ${year} is already added.`);
      return;
    }

    setYearFactors((prev) => ({ ...prev, [year]: prev[year] ?? "" }));
    setStatus(`Added year ${year}`);
    setYearToAdd("");
  }

  function removeYearField(year: number) {
    setYearFactors((prev) => {
      const next = { ...prev };
      delete next[year];
      return next;
    });
  }

  async function saveFactor() {
    if (!description.trim()) {
      setStatus("Description is required");
      return;
    }
    if (!isGlobal && clientDbId === "__none__") {
      setStatus("Client must be selected for client-specific factors");
      return;
    }

    const factorsByYear = parseYearFactors(yearFactors);
    if (Object.keys(factorsByYear).length === 0) {
      setStatus("At least one year factor is required");
      return;
    }

    setStatus(editingFactor ? "Updating factor..." : "Creating factor...");

    const body: Record<string, unknown> = {
      custom_id: customId.trim() || null,
      country,
      scope,
      description: description.trim(),
      report_label: reportLabel.trim() || null,
      category: category.trim() || null,
      uom,
      ghg_unit: ghgUnit,
      source: source.trim(),
      is_global: isGlobal,
      client_db_id: isGlobal || clientDbId === "__none__" ? null : Number(clientDbId),
      is_active: isActive,
      factors_by_year: factorsByYear,
    };

    try {
      const url = editingFactor
        ? `/custom-factors/${editingFactor.factor_id}`
        : "/custom-factors";

      const res = await apiFetch(url, {
        method: editingFactor ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed: ${res.status}${text ? ` - ${text}` : ""}`);
      }

      setStatus(editingFactor ? "Factor updated" : "Factor created");
      clearForm();
      await loadFactors();
      setTimeout(() => setStatus(""), 2500);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    }
  }

  async function toggleArchive(factor: CustomFactor, archived: boolean) {
    const action = archived ? "archive" : "restore";
    if (!confirm(`${action[0].toUpperCase() + action.slice(1)} "${factor.report_label || factor.description}"?`)) {
      return;
    }

    setStatus(archived ? "Archiving..." : "Restoring...");
    try {
      const res = await apiFetch(`/custom-factors/${factor.factor_id}/archive`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed: ${res.status}${text ? ` - ${text}` : ""}`);
      }
      await loadFactors();
      setStatus(archived ? "Factor archived" : "Factor restored");
      setTimeout(() => setStatus(""), 2500);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    }
  }

  const filteredFactors = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return factors;

    return factors.filter((f) => {
      const text = [
        f.custom_id,
        f.report_label,
        f.description,
        f.category,
        f.country,
        f.scope,
        f.source,
        f.client_name,
      ]
        .map((v) => String(v ?? "").toLowerCase())
        .join(" ");
      return text.includes(q);
    });
  }, [factors, search]);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: "#F26624" }}>
              Custom Conversion Factors
            </h1>
            <p className="text-sm text-muted-foreground">
              Manage global/client custom factors with unlimited yearly values.
            </p>
          </div>
          <Button variant="secondary" asChild>
            <Link href="/admin">← Back to Admin</Link>
          </Button>
        </div>

        {status && <div className="mb-4 rounded-md bg-muted p-3 text-sm">{status}</div>}

        <div className="mb-4 grid gap-3 md:grid-cols-3">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="factorSearch">Search</Label>
            <Input
              id="factorSearch"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search custom_id, report label, description, category, source..."
            />
          </div>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
              />
              Show archived
            </label>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{editingFactor ? "Edit Factor" : "Add New Factor"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="customId">Custom ID</Label>
                  <Input
                    id="customId"
                    value={customId}
                    onChange={(e) => setCustomId(e.target.value)}
                    placeholder="e.g. UK-EL-GRID"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="country">Country *</Label>
                  <Select value={country} onValueChange={setCountry}>
                    <SelectTrigger id="country">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UAE">UAE</SelectItem>
                      <SelectItem value="UK">United Kingdom</SelectItem>
                      <SelectItem value="US">United States</SelectItem>
                      <SelectItem value="EU">European Union</SelectItem>
                      <SelectItem value="AU">Australia</SelectItem>
                      <SelectItem value="CA">Canada</SelectItem>
                      <SelectItem value="Global">Global</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="scope">Scope *</Label>
                  <Select value={scope} onValueChange={setScope}>
                    <SelectTrigger id="scope">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Scope 1">Scope 1</SelectItem>
                      <SelectItem value="Scope 2">Scope 2</SelectItem>
                      <SelectItem value="Scope 3">Scope 3</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="category">Category</Label>
                  <Input
                    id="category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="e.g. Electricity"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description *</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g., UK Electricity Grid - National"
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="reportLabel">Report Label</Label>
                <Input
                  id="reportLabel"
                  value={reportLabel}
                  onChange={(e) => setReportLabel(e.target.value)}
                  placeholder="How this appears in factor picker/reports"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="uom">Unit of Measure</Label>
                  <Input
                    id="uom"
                    value={uom}
                    onChange={(e) => setUom(e.target.value)}
                    placeholder="kWh, km, kg"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ghgUnit">GHG Unit</Label>
                  <Input
                    id="ghgUnit"
                    value={ghgUnit}
                    onChange={(e) => setGhgUnit(e.target.value)}
                    placeholder="kg CO2e"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="source">Source</Label>
                  <Input
                    id="source"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    placeholder="DESNZ, Custom"
                  />
                </div>
              </div>

              <div className="rounded-md border p-3 space-y-3">
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={isGlobal}
                      onChange={(e) => setIsGlobal(e.target.checked)}
                    />
                    Global factor
                  </label>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={(e) => setIsActive(e.target.checked)}
                    />
                    Active
                  </label>
                </div>

                {!isGlobal ? (
                  <div className="space-y-2">
                    <Label htmlFor="clientScope">Client Scope *</Label>
                    <Select value={clientDbId} onValueChange={setClientDbId}>
                      <SelectTrigger id="clientScope">
                        <SelectValue placeholder="Select client" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Select client...</SelectItem>
                        {clients.map((c) => (
                          <SelectItem key={c.client_db_id} value={String(c.client_db_id)}>
                            {c.client_name} (#{c.client_db_id})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label>Conversion Factors by Year</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      className="h-8 w-28"
                      placeholder="Year"
                      value={yearToAdd}
                      onChange={(e) => setYearToAdd(e.target.value)}
                    />
                    <Button type="button" variant="outline" className="h-8" onClick={addYearField}>
                      Add year
                    </Button>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground">
                  Base years 2018-2030 are shown by default. Use <strong>Add year</strong> for extra years
                  (e.g. 2031+).
                </div>

                <div className="grid grid-cols-2 gap-2 rounded-md border p-3">
                  {formYears.map((year) => (
                    <div key={year} className="flex items-center gap-2">
                      <Label htmlFor={`year_${year}`} className="w-12 text-xs">
                        {year}
                      </Label>
                      <Input
                        id={`year_${year}`}
                        type="number"
                        step="0.000001"
                        value={yearFactors[year] || ""}
                        onChange={(e) =>
                          setYearFactors((prev) => ({
                            ...prev,
                            [year]: e.target.value,
                          }))
                        }
                        placeholder="0.0"
                        className="h-8 text-xs"
                      />
                      {!BASE_YEARS.includes(year) ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="h-8 px-2"
                          onClick={() => removeYearField(year)}
                          title="Remove year"
                        >
                          ×
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                {editingFactor ? (
                  <Button variant="outline" onClick={clearForm} className="flex-1">
                    Cancel
                  </Button>
                ) : null}
                <Button onClick={saveFactor} className="flex-1">
                  {editingFactor ? "Update Factor" : "Add Factor"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Existing Custom Factors ({filteredFactors.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-sm text-muted-foreground">Loading...</div>
              ) : filteredFactors.length === 0 ? (
                <div className="text-sm text-muted-foreground">No custom factors yet</div>
              ) : (
                <div className="space-y-2 max-h-[700px] overflow-y-auto">
                  {filteredFactors.map((factor) => {
                    const byYear = yearsFromFactor(factor);
                    const sortedYears = Object.keys(byYear)
                      .map((k) => Number(k))
                      .filter((y) => Number.isFinite(y))
                      .sort((a, b) => a - b);

                    return (
                      <div
                        key={factor.factor_id}
                        className="rounded-md border p-3 hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 space-y-1">
                            <div className="font-medium text-sm">
                              {factor.report_label || factor.description}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {factor.custom_id || `CF-${factor.factor_id}`} • {factor.country} • {factor.scope}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {factor.category ? `${factor.category} • ` : ""}
                              {factor.uom} → {factor.ghg_unit}
                            </div>
                            <div className="flex flex-wrap gap-1 pt-1">
                              <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
                                {factor.is_global !== false ? "Global" : `Client #${factor.client_db_id ?? "?"}`}
                              </span>
                              {factor.client_name ? (
                                <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
                                  {factor.client_name}
                                </span>
                              ) : null}
                              <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
                                {factor.is_active === false ? "Inactive" : "Active"}
                              </span>
                              {factor.archived ? (
                                <span className="text-xs bg-red-100 text-red-800 px-1.5 py-0.5 rounded">
                                  Archived
                                </span>
                              ) : null}
                            </div>

                            {factor.source ? (
                              <div className="text-xs text-muted-foreground">Source: {factor.source}</div>
                            ) : null}

                            <div className="mt-2 flex flex-wrap gap-1">
                              {sortedYears.map((year) => (
                                <span key={`${factor.factor_id}-${year}`} className="text-xs bg-muted px-1.5 py-0.5 rounded">
                                  {year}: {byYear[year]}
                                </span>
                              ))}
                            </div>
                          </div>

                          <div className="flex gap-1">
                            <Button variant="outline" size="sm" onClick={() => startEdit(factor)}>
                              Edit
                            </Button>
                            {factor.archived ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => toggleArchive(factor, false)}
                              >
                                Restore
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => toggleArchive(factor, true)}
                              >
                                Archive
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
