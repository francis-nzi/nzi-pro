"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { hasAuthState } from "@/lib/auth-client";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";

type MethodologyRow = {
  methodology_id: number;
  country: string;
  scope: string;
  category: string;
  report_label: string;
  descriptor: string;
  uom: string;
  suggested_original_id: string;
  suggested_factor_db_id: number | null;
  notes: string;
  is_default: boolean;
  is_active: boolean;
  created_by: string;
  created_at: string | null;
  updated_at: string | null;
  source_payload?: string | null;
};

type MethodologyResponse = {
  items: MethodologyRow[];
  facets?: {
    countries?: string[];
    scopes?: string[];
    categories?: string[];
    uoms?: string[];
  };
};

type DatasetFactorRow = {
  db_id: number;
  original_id: string;
  dataset: string | null;
  analysis_type: string | null;
  country: string | null;
  year: number | null;
  scope: string | null;
  category: string | null;
  level_1: string | null;
  level_2: string | null;
  level_3: string | null;
  level_4: string | null;
  column_text: string | null;
  uom: string | null;
  ghg_unit: string | null;
  factor: number | null;
  report_label: string | null;
};

function apiBaseUrl(): string {
  return "/api/backend";
}

function formatTs(ts: string | null): string {
  if (!ts) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function normalizeText(value?: string | null): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function uniqueTextParts(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(normalized);
  }
  return parts;
}

function buildMethodologyDefaultsFromFactor(factor: DatasetFactorRow) {
  const reportLabel = normalizeText(factor.report_label) || normalizeText(factor.column_text) || normalizeText(factor.original_id) || "Factor";
  const descriptor = uniqueTextParts([
    factor.level_4,
    factor.level_3,
    factor.level_2,
    factor.column_text,
    factor.analysis_type,
  ]).join(" • ");
  return {
    country: normalizeText(factor.country) || "UK",
    scope: normalizeText(factor.scope),
    category: normalizeText(factor.category) || normalizeText(factor.level_1) || normalizeText(factor.level_2) || normalizeText(factor.column_text) || normalizeText(factor.report_label) || "Uncategorised",
    report_label: reportLabel,
    descriptor,
    uom: normalizeText(factor.uom),
    suggested_original_id: normalizeText(factor.original_id),
    suggested_factor_db_id: String(factor.db_id),
    notes: `Promoted from dataset ${normalizeText(factor.dataset) || "library"}${factor.year ? ` (${factor.year})` : ""}.`,
    is_default: true,
  };
}

function summarizeSourcePayload(payload?: string | null): string {
  if (!payload) return "";
  try {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed !== "object") return "";
    const obj = parsed as Record<string, unknown>;
    return uniqueTextParts([
      typeof obj.dataset === "string" ? obj.dataset : null,
      typeof obj.country === "string" ? obj.country : null,
      typeof obj.year === "number" ? String(obj.year) : null,
      typeof obj.scope === "string" ? obj.scope : null,
      typeof obj.report_label === "string" ? obj.report_label : null,
      typeof obj.original_id === "string" ? obj.original_id : null,
    ]).join(" • ");
  } catch {
    return "";
  }
}

const EMPTY_DRAFT = {
  country: "UK",
  scope: "",
  category: "",
  report_label: "",
  descriptor: "",
  uom: "",
  suggested_original_id: "",
  suggested_factor_db_id: "",
  notes: "",
  is_default: true,
};

export default function MethodologyPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const confirmAction = useConfirmDialog();
  const [mounted, setMounted] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [rows, setRows] = useState<MethodologyRow[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [scopes, setScopes] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [uoms, setUoms] = useState<string[]>([]);
  const [filterCountry, setFilterCountry] = useState("UK");
  const [filterScope, setFilterScope] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterUom, setFilterUom] = useState("all");
  const [filterDefaultOnly, setFilterDefaultOnly] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [draft, setDraft] = useState({ ...EMPTY_DRAFT });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingDraft, setEditingDraft] = useState({ ...EMPTY_DRAFT });
  const [datasetCountry, setDatasetCountry] = useState("UK");
  const [datasetYear, setDatasetYear] = useState("");
  const [datasetScope, setDatasetScope] = useState("all");
  const [datasetReportLabel, setDatasetReportLabel] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [datasetQuery, setDatasetQuery] = useState("");
  const [datasetResults, setDatasetResults] = useState<DatasetFactorRow[]>([]);
  const [datasetLoading, setDatasetLoading] = useState(false);
  const [datasetStatus, setDatasetStatus] = useState("");
  const [datasetError, setDatasetError] = useState("");

  useEffect(() => {
    setMounted(true);
    setAuthed(hasAuthState());
  }, []);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (filterCountry.trim()) params.set("country", filterCountry.trim());
      if (filterScope !== "all") params.set("scope", filterScope);
      if (filterCategory !== "all") params.set("category", filterCategory);
      if (filterUom !== "all") params.set("uom", filterUom);
      if (filterDefaultOnly) params.set("default_only", "true");
      if (filterQuery.trim()) params.set("query", filterQuery.trim());

      const res = await fetch(`${baseUrl}/methodology/rows?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const json = (await res.json()) as MethodologyResponse;
      setRows(Array.isArray(json.items) ? json.items : []);
      const facets = json.facets || {};
      setCountries(Array.isArray(facets.countries) ? facets.countries : []);
      setScopes(Array.isArray(facets.scopes) ? facets.scopes : []);
      setCategories(Array.isArray(facets.categories) ? facets.categories : []);
      setUoms(Array.isArray(facets.uoms) ? facets.uoms : []);
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [baseUrl, filterCategory, filterCountry, filterDefaultOnly, filterQuery, filterScope, filterUom]);

  useEffect(() => {
    if (authed) void loadRows();
  }, [authed, loadRows]);

  useEffect(() => {
    if (authed) void loadDatasetLibrary();
    // Intentional mount-time preload so the default UK library is visible immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  const loadDatasetLibrary = useCallback(async () => {
    setDatasetLoading(true);
    setDatasetError("");
    setDatasetStatus("");
    try {
      const params = new URLSearchParams();
      if (datasetCountry.trim()) params.set("country", datasetCountry.trim());
      if (datasetYear.trim()) params.set("year", datasetYear.trim());
      if (datasetScope !== "all") params.set("scope", datasetScope);
      if (datasetReportLabel.trim()) params.set("report_label", datasetReportLabel.trim());
      if (datasetId.trim()) params.set("dataset_id", datasetId.trim());
      if (datasetQuery.trim()) params.set("q", datasetQuery.trim());
      params.set("limit", "40");

      const res = await fetch(`${baseUrl}/admin/factors?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const json = await res.json().catch(() => ({}));
      setDatasetResults(Array.isArray(json?.items) ? json.items : []);
      setDatasetStatus(
        Array.isArray(json?.items) ? `Found ${json.items.length} dataset factor row${json.items.length === 1 ? "" : "s"}.` : "No dataset rows returned.",
      );
    } catch (e) {
      setDatasetError((e as Error).message);
      setDatasetResults([]);
    } finally {
      setDatasetLoading(false);
    }
  }, [baseUrl, datasetCountry, datasetId, datasetQuery, datasetReportLabel, datasetScope, datasetYear]);

  async function addDatasetAsMethodologyRow(row: DatasetFactorRow) {
    setSaving(true);
    setStatus("Creating methodology row from selected dataset factor...");
    try {
      const draftFromFactor = buildMethodologyDefaultsFromFactor(row);
      const res = await fetch(`${baseUrl}/methodology/rows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...draftFromFactor,
          source_payload: row,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(String((payload as { detail?: string }).detail || `Failed: ${res.status}`));
      }
      setStatus(`Added ${draftFromFactor.report_label} as a methodology row.`);
      setDraft({ ...draftFromFactor });
      await loadRows();
      if (payload?.methodology_id) {
        setEditingId(Number(payload.methodology_id));
        setEditingDraft({ ...draftFromFactor });
      }
    } catch (e) {
      setStatus(`Error creating methodology row: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function saveRow() {
    if (!draft.category.trim() || !draft.report_label.trim()) {
      setStatus("Category and report label are required.");
      return;
    }
    setSaving(true);
    setStatus("Saving methodology row...");
    try {
      const res = await fetch(`${baseUrl}/methodology/rows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          country: draft.country.trim() || "UK",
          scope: draft.scope.trim(),
          category: draft.category.trim(),
          report_label: draft.report_label.trim(),
          descriptor: draft.descriptor.trim(),
          uom: draft.uom.trim(),
          suggested_original_id: draft.suggested_original_id.trim(),
          suggested_factor_db_id: draft.suggested_factor_db_id.trim() ? Number(draft.suggested_factor_db_id) : null,
          notes: draft.notes.trim(),
          is_default: draft.is_default,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(String((payload as { detail?: string }).detail || `Failed: ${res.status}`));
      }
      setDraft({ ...EMPTY_DRAFT });
      setStatus("Methodology row saved.");
      await loadRows();
    } catch (e) {
      setStatus(`Error saving row: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  function beginEdit(row: MethodologyRow) {
    setEditingId(row.methodology_id);
    setEditingDraft({
      country: row.country || "UK",
      scope: row.scope || "",
      category: row.category || "",
      report_label: row.report_label || "",
      descriptor: row.descriptor || "",
      uom: row.uom || "",
      suggested_original_id: row.suggested_original_id || "",
      suggested_factor_db_id: row.suggested_factor_db_id != null ? String(row.suggested_factor_db_id) : "",
      notes: row.notes || "",
      is_default: row.is_default,
    });
  }

  async function saveEdit(rowId: number) {
    if (!editingDraft.category.trim() || !editingDraft.report_label.trim()) {
      setStatus("Category and report label are required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${baseUrl}/methodology/rows/${rowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          country: editingDraft.country.trim() || "UK",
          scope: editingDraft.scope.trim(),
          category: editingDraft.category.trim(),
          report_label: editingDraft.report_label.trim(),
          descriptor: editingDraft.descriptor.trim(),
          uom: editingDraft.uom.trim(),
          suggested_original_id: editingDraft.suggested_original_id.trim(),
          suggested_factor_db_id: editingDraft.suggested_factor_db_id.trim() ? Number(editingDraft.suggested_factor_db_id) : null,
          notes: editingDraft.notes.trim(),
          is_default: editingDraft.is_default,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(String((payload as { detail?: string }).detail || `Failed: ${res.status}`));
      }
      setEditingId(null);
      setStatus("Methodology row updated.");
      await loadRows();
    } catch (e) {
      setStatus(`Error updating row: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function archiveRow(row: MethodologyRow) {
    const confirmed = await confirmAction({
      title: "Archive methodology row?",
      description: `Archive "${row.report_label}"?`,
      confirmLabel: "Archive",
      destructive: true,
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      const res = await fetch(`${baseUrl}/methodology/rows/${row.methodology_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ is_active: false }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      await loadRows();
      setStatus("Row archived.");
    } catch (e) {
      setStatus(`Error archiving row: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  const filteredCount = rows.length;

  if (!mounted) {
    return null;
  }

  if (!authed) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="mx-auto max-w-6xl">
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Loading methodology access...
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold" style={{ color: "#F26624" }}>Methodology Library</h1>
            <p className="text-muted-foreground">
              Company-suggested conversion-factor guidance by country, scope, category, report label, descriptor and UoM.
            </p>
          </div>
          <Button variant="secondary" asChild>
            <Link href="/support">Back to Support</Link>
          </Button>
        </div>

        {error ? <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
        {status ? <div className="rounded-md bg-muted p-3 text-sm">{status}</div> : null}

        <Card>
          <CardHeader>
            <CardTitle>Search Dataset Library</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
              <div>
                <Label>Country</Label>
                <Select value={datasetCountry} onValueChange={setDatasetCountry}>
                  <SelectTrigger className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UK">UK</SelectItem>
                    {countries.filter((c) => c !== "UK").map((country) => (
                      <SelectItem key={country} value={country}>
                        {country}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Year</Label>
                <Input
                  className="mt-2"
                  value={datasetYear}
                  onChange={(e) => setDatasetYear(e.target.value)}
                  placeholder="e.g. 2022"
                  inputMode="numeric"
                />
              </div>
              <div>
                <Label>Scope</Label>
                <Select value={datasetScope} onValueChange={setDatasetScope}>
                  <SelectTrigger className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Scopes</SelectItem>
                    {scopes.map((scope) => (
                      <SelectItem key={scope} value={scope}>
                        {scope}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Report Label</Label>
                <Input
                  className="mt-2"
                  value={datasetReportLabel}
                  onChange={(e) => setDatasetReportLabel(e.target.value)}
                  placeholder="Search by report label"
                />
              </div>
              <div>
                <Label>Dataset ID</Label>
                <Input
                  className="mt-2"
                  value={datasetId}
                  onChange={(e) => setDatasetId(e.target.value)}
                  placeholder="Dataset ID"
                />
              </div>
              <div>
                <Label>Search</Label>
                <Input
                  className="mt-2"
                  value={datasetQuery}
                  onChange={(e) => setDatasetQuery(e.target.value)}
                  placeholder="Labels, descriptors, IDs..."
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void loadDatasetLibrary()} disabled={datasetLoading}>
                {datasetLoading ? "Searching..." : "Search Dataset Library"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setDatasetCountry("UK");
                  setDatasetYear("");
                  setDatasetScope("all");
                  setDatasetReportLabel("");
                  setDatasetId("");
                  setDatasetQuery("");
                  setDatasetResults([]);
                  setDatasetError("");
                  setDatasetStatus("");
                }}
              >
                Reset
              </Button>
              <div className="text-sm text-muted-foreground">
                Search dataset factors first, then promote the chosen row into the methodology library.
              </div>
            </div>

            {datasetError ? <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{datasetError}</div> : null}
            {datasetStatus ? <div className="rounded-md bg-muted p-3 text-sm">{datasetStatus}</div> : null}

            <div className="space-y-3">
              {datasetLoading ? (
                <div className="text-sm text-muted-foreground">Loading dataset library...</div>
              ) : datasetResults.length === 0 ? (
                <div className="text-sm text-muted-foreground">No dataset rows found for the current search.</div>
              ) : (
                datasetResults.map((row) => {
                  const summary = uniqueTextParts([
                    row.country,
                    row.year ? String(row.year) : null,
                    row.scope,
                    row.category,
                    row.report_label,
                    row.column_text,
                    row.uom,
                  ]).join(" • ");
                  return (
                    <div key={row.db_id} className="rounded-lg border p-4 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="font-semibold">
                            {row.report_label || row.column_text || row.original_id}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {row.dataset || "Dataset"}{row.analysis_type ? ` • ${row.analysis_type}` : ""}
                          </div>
                          <div className="text-xs text-muted-foreground">{summary || row.original_id}</div>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => void addDatasetAsMethodologyRow(row)} disabled={saving}>
                            Add as Methodology Row
                          </Button>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-3 text-xs md:grid-cols-3">
                        <div className="rounded border p-2">
                          <div className="text-muted-foreground">Descriptor</div>
                          <div className="mt-1">{uniqueTextParts([row.level_2, row.level_3, row.level_4, row.column_text]).join(" • ") || "-"}</div>
                        </div>
                        <div className="rounded border p-2">
                          <div className="text-muted-foreground">ID / Factor</div>
                          <div className="mt-1 font-mono">{row.original_id}</div>
                          <div className="mt-1 font-mono">{row.factor !== null && row.factor !== undefined ? row.factor.toFixed(5) : "-"}</div>
                        </div>
                        <div className="rounded border p-2">
                          <div className="text-muted-foreground">UoM / GHG</div>
                          <div className="mt-1">{row.uom || "-"}</div>
                          <div className="mt-1">{row.ghg_unit || "-"}</div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Filter Methodology Rows</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-5">
              <div>
                <Label>Country</Label>
                <Select value={filterCountry} onValueChange={setFilterCountry}>
                  <SelectTrigger className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UK">UK</SelectItem>
                    <SelectItem value="all">All Countries</SelectItem>
                    {countries.filter((c) => c !== "UK").map((country) => (
                      <SelectItem key={country} value={country}>
                        {country}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Scope</Label>
                <Select value={filterScope} onValueChange={setFilterScope}>
                  <SelectTrigger className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Scopes</SelectItem>
                    {scopes.map((scope) => (
                      <SelectItem key={scope} value={scope}>
                        {scope}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Category</Label>
                <Select value={filterCategory} onValueChange={setFilterCategory}>
                  <SelectTrigger className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {categories.map((category) => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>UoM</Label>
                <Select value={filterUom} onValueChange={setFilterUom}>
                  <SelectTrigger className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All UoM</SelectItem>
                    {uoms.map((uom) => (
                      <SelectItem key={uom} value={uom}>
                        {uom}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={filterDefaultOnly}
                    onChange={(e) => setFilterDefaultOnly(e.target.checked)}
                  />
                  Default only
                </label>
              </div>
            </div>

            <div>
              <Label>Search</Label>
              <Input
                className="mt-2"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="Search labels, descriptors, IDs, notes..."
              />
            </div>

            <div className="text-sm text-muted-foreground">
              Showing {filteredCount} methodology row{filteredCount === 1 ? "" : "s"}.
              Country defaults to UK unless you choose another market.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Add Methodology Row</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>Country</Label>
                <Input className="mt-2" value={draft.country} onChange={(e) => setDraft((d) => ({ ...d, country: e.target.value }))} />
              </div>
              <div>
                <Label>Scope</Label>
                <Input className="mt-2" value={draft.scope} onChange={(e) => setDraft((d) => ({ ...d, scope: e.target.value }))} placeholder="Scope 1 / Scope 2 / Scope 3" />
              </div>
              <div>
                <Label>Category</Label>
                <Input className="mt-2" value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))} placeholder="Vehicle mileage, hotel stays..." />
              </div>
              <div>
                <Label>Report Label</Label>
                <Input className="mt-2" value={draft.report_label} onChange={(e) => setDraft((d) => ({ ...d, report_label: e.target.value }))} placeholder="What the user should pick" />
              </div>
              <div>
                <Label>Descriptor</Label>
                <Input className="mt-2" value={draft.descriptor} onChange={(e) => setDraft((d) => ({ ...d, descriptor: e.target.value }))} placeholder="petrol / diesel / electric / rail..." />
              </div>
              <div>
                <Label>UoM</Label>
                <Input className="mt-2" value={draft.uom} onChange={(e) => setDraft((d) => ({ ...d, uom: e.target.value }))} placeholder="km, mile, night, passenger-km..." />
              </div>
              <div>
                <Label>Suggested Original ID</Label>
                <Input className="mt-2" value={draft.suggested_original_id} onChange={(e) => setDraft((d) => ({ ...d, suggested_original_id: e.target.value }))} placeholder="Factor ID or internal reference" />
              </div>
              <div>
                <Label>Suggested Factor DB ID</Label>
                <Input className="mt-2" value={draft.suggested_factor_db_id} onChange={(e) => setDraft((d) => ({ ...d, suggested_factor_db_id: e.target.value }))} placeholder="Optional factor_lookup db id" />
              </div>
            </div>

            <div>
              <Label>Notes</Label>
              <Textarea className="mt-2" value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} rows={3} placeholder="Why this factor is the recommended default..." />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.is_default}
                  onChange={(e) => setDraft((d) => ({ ...d, is_default: e.target.checked }))}
                />
                Mark as default
              </label>
              <Button onClick={() => void saveRow()} disabled={saving}>
                {saving ? "Saving..." : "Save Row"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4">
          {loading ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">Loading methodology rows...</CardContent>
            </Card>
          ) : rows.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">No methodology rows found for the current filters.</CardContent>
            </Card>
          ) : (
            rows.map((row) => {
              const isEditing = editingId === row.methodology_id;
              return (
                <Card key={row.methodology_id}>
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-lg">
                          {row.report_label}
                          {row.is_default ? <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">Default</span> : null}
                        </CardTitle>
                        <div className="text-sm text-muted-foreground">
                          {row.country || "UK"} • {row.scope || "Any scope"} • {row.category || "Uncategorised"}
                        </div>
                        {summarizeSourcePayload(row.source_payload) ? (
                          <div className="mt-2 rounded border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                            Source dataset: {summarizeSourcePayload(row.source_payload)}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex gap-2">
                        {isEditing ? (
                          <>
                            <Button size="sm" onClick={() => void saveEdit(row.methodology_id)} disabled={saving}>Save</Button>
                            <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Cancel</Button>
                          </>
                        ) : (
                          <>
                            <Button size="sm" variant="outline" onClick={() => beginEdit(row)}>Edit</Button>
                            <Button size="sm" variant="destructive" onClick={() => void archiveRow(row)} disabled={saving}>Archive</Button>
                          </>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {isEditing ? (
                      <div className="grid gap-4 md:grid-cols-2">
                        <div><Label>Country</Label><Input className="mt-2" value={editingDraft.country} onChange={(e) => setEditingDraft((d) => ({ ...d, country: e.target.value }))} /></div>
                        <div><Label>Scope</Label><Input className="mt-2" value={editingDraft.scope} onChange={(e) => setEditingDraft((d) => ({ ...d, scope: e.target.value }))} /></div>
                        <div><Label>Category</Label><Input className="mt-2" value={editingDraft.category} onChange={(e) => setEditingDraft((d) => ({ ...d, category: e.target.value }))} /></div>
                        <div><Label>Report Label</Label><Input className="mt-2" value={editingDraft.report_label} onChange={(e) => setEditingDraft((d) => ({ ...d, report_label: e.target.value }))} /></div>
                        <div><Label>Descriptor</Label><Input className="mt-2" value={editingDraft.descriptor} onChange={(e) => setEditingDraft((d) => ({ ...d, descriptor: e.target.value }))} /></div>
                        <div><Label>UoM</Label><Input className="mt-2" value={editingDraft.uom} onChange={(e) => setEditingDraft((d) => ({ ...d, uom: e.target.value }))} /></div>
                        <div><Label>Suggested Original ID</Label><Input className="mt-2" value={editingDraft.suggested_original_id} onChange={(e) => setEditingDraft((d) => ({ ...d, suggested_original_id: e.target.value }))} /></div>
                        <div><Label>Suggested Factor DB ID</Label><Input className="mt-2" value={editingDraft.suggested_factor_db_id} onChange={(e) => setEditingDraft((d) => ({ ...d, suggested_factor_db_id: e.target.value }))} /></div>
                        <div className="md:col-span-2">
                          <Label>Notes</Label>
                          <Textarea className="mt-2" rows={3} value={editingDraft.notes} onChange={(e) => setEditingDraft((d) => ({ ...d, notes: e.target.value }))} />
                        </div>
                        <label className="flex items-center gap-2 text-sm md:col-span-2">
                          <input type="checkbox" checked={editingDraft.is_default} onChange={(e) => setEditingDraft((d) => ({ ...d, is_default: e.target.checked }))} />
                          Mark as default
                        </label>
                      </div>
                    ) : (
                      <div className="grid gap-4 md:grid-cols-3 text-sm">
                        <div className="rounded border p-3">
                          <div className="text-xs text-muted-foreground">Descriptor</div>
                          <div className="mt-1 font-medium">{row.descriptor || "-"}</div>
                        </div>
                        <div className="rounded border p-3">
                          <div className="text-xs text-muted-foreground">UoM / IDs</div>
                          <div className="mt-1 font-medium">{row.uom || "-"}</div>
                          <div className="mt-1 text-xs text-muted-foreground">Suggested ID: {row.suggested_original_id || "-"}</div>
                        </div>
                        <div className="rounded border p-3">
                          <div className="text-xs text-muted-foreground">Created</div>
                          <div className="mt-1">{formatTs(row.created_at)}</div>
                          <div className="mt-1 text-xs text-muted-foreground">By {row.created_by || "-"}</div>
                        </div>
                        <div className="rounded border p-3 md:col-span-3">
                          <div className="text-xs text-muted-foreground">Notes</div>
                          <div className="mt-1">{row.notes || "-"}</div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
