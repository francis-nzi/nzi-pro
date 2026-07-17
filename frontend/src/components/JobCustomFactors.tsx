"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useConfirmDialog } from "@/components/ConfirmDialogProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getToken } from "@/lib/auth-client";
import { useUnsavedChangesGuard } from "@/lib/useUnsavedChangesGuard";

type JobCustomFactor = {
  factor_id: number;
  job_id: number | null;
  job_number?: string | null;
  job_title?: string | null;
  custom_id?: string | null;
  country?: string | null;
  scope: string;
  description: string;
  report_label?: string | null;
  category?: string | null;
  uom?: string | null;
  ghg_unit?: string | null;
  source?: string | null;
  factor?: number | null;
  factor_year?: number | null;
  factors_by_year?: Record<string, number>;
  is_active?: boolean;
  archived?: boolean;
  created_by?: string | null;
  created_at?: string | null;
  updated_by?: string | null;
  updated_at?: string | null;
  archived_at?: string | null;
  archived_by?: string | null;
};

function apiBaseCandidates(): string[] {
  return ["/api/backend"];
}

function cleanText(value?: string | null): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function yearsFromFactor(item: JobCustomFactor, fallbackYear: number): Record<number, string> {
  const out: Record<number, string> = {};
  const byYear = item.factors_by_year;
  if (byYear && typeof byYear === "object" && Object.keys(byYear).length > 0) {
    Object.entries(byYear).forEach(([yearKey, value]) => {
      const y = Number(yearKey);
      if (Number.isFinite(y) && typeof value === "number") out[y] = String(value);
    });
    return out;
  }
  const year = item.factor_year ?? fallbackYear;
  out[year] = typeof item.factor === "number" ? String(item.factor) : "";
  return out;
}

function parseYearFactors(input: Record<number, string>): Record<string, number> {
  const out: Record<string, number> = {};
  Object.entries(input).forEach(([yearKey, raw]) => {
    const year = Number(yearKey);
    if (!Number.isFinite(year)) return;
    const value = Number(String(raw).trim());
    if (!Number.isFinite(value) || String(raw).trim() === "") return;
    out[String(year)] = value;
  });
  return out;
}

export default function JobCustomFactors({
  jobId,
  baseUrl: _baseUrl,
  jobNumber,
  clientName,
  reportingYear,
}: {
  jobId: number;
  baseUrl: string;
  jobNumber?: string | null;
  clientName?: string | null;
  reportingYear?: number | null;
}) {
  const confirmAction = useConfirmDialog();
  const apiBases = useMemo(() => {
    void _baseUrl;
    return apiBaseCandidates();
  }, [_baseUrl]);
  const defaultFactorYear = reportingYear ?? new Date().getFullYear();

  const [activeApiBase, setActiveApiBase] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [filterScope, setFilterScope] = useState("All");
  const [factors, setFactors] = useState<JobCustomFactor[]>([]);

  const [editingFactor, setEditingFactor] = useState<JobCustomFactor | null>(null);
  const [customId, setCustomId] = useState("");
  const [country, setCountry] = useState("UK");
  const [scope, setScope] = useState("Scope 3");
  const [description, setDescription] = useState("");
  const [reportLabel, setReportLabel] = useState("");
  const [category, setCategory] = useState("");
  const [uom, setUom] = useState("");
  const [ghgUnit, setGhgUnit] = useState("kg CO2e");
  const [source, setSource] = useState("Client factor");
  const [isActive, setIsActive] = useState(true);
  const [yearFactors, setYearFactors] = useState<Record<number, string>>({ [defaultFactorYear]: "" });
  const [yearToAdd, setYearToAdd] = useState("");

  const hasUnsavedChanges = useMemo(() => {
    const yearHasValue = Object.values(yearFactors).some((v) => v.trim());
    return Boolean(
      editingFactor ||
        customId.trim() ||
        country.trim() !== "UK" ||
        scope.trim() !== "Scope 3" ||
        description.trim() ||
        reportLabel.trim() ||
        category.trim() ||
        uom.trim() ||
        ghgUnit.trim() !== "kg CO2e" ||
        source.trim() !== "Client factor" ||
        yearHasValue ||
        !isActive
    );
  }, [editingFactor, customId, country, scope, description, reportLabel, category, uom, ghgUnit, source, yearFactors, isActive]);

  useUnsavedChangesGuard(hasUnsavedChanges);

  const apiFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      let lastError: unknown = null;
      let fallbackResponse: Response | null = null;
      const orderedBases = activeApiBase
        ? [activeApiBase, ...apiBases.filter((b) => b !== activeApiBase)]
        : apiBases;
      const token = getToken();
      const authHeaders: Record<string, string> = {};
      if (token) authHeaders.Authorization = `Bearer ${token}`;

      for (const base of orderedBases) {
        try {
          const mergedHeaders = {
            ...authHeaders,
            ...(init?.headers as Record<string, string> | undefined),
          };
          const response = await fetch(`${base}${path}`, {
            ...init,
            credentials: init?.credentials ?? "include",
            headers: mergedHeaders,
          });
          if (response.ok) {
            if (activeApiBase !== base) setActiveApiBase(base);
            return response;
          }
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

  const loadFactors = useCallback(async () => {
    setLoading(true);
    setStatus("");
    try {
      const params = new URLSearchParams();
      if (includeArchived) params.set("include_archived", "true");
      if (filterScope && filterScope !== "All") params.set("scope", filterScope);
      if (search.trim()) params.set("search", search.trim());

      const res = await apiFetch(`/jobs/${jobId}/custom-factors?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed to load client factors: ${res.status}${text ? ` - ${text}` : ""}`);
      }

      const json = await res.json();
      setFactors(Array.isArray(json?.items) ? json.items : []);
    } catch (e) {
      setStatus(errorMessage(e, "Failed to load client factors"));
    } finally {
      setLoading(false);
    }
  }, [apiFetch, filterScope, includeArchived, jobId, search]);

  useEffect(() => {
    void loadFactors();
  }, [loadFactors]);

  useEffect(() => {
    setYearFactors((prev) => (Object.keys(prev).length > 0 ? prev : { [defaultFactorYear]: "" }));
  }, [defaultFactorYear]);

  function clearForm() {
    setEditingFactor(null);
    setCustomId("");
    setCountry("UK");
    setScope("Scope 3");
    setDescription("");
    setReportLabel("");
    setCategory("");
    setUom("");
    setGhgUnit("kg CO2e");
    setSource("Client factor");
    setIsActive(true);
    setYearFactors({ [defaultFactorYear]: "" });
    setYearToAdd("");
  }

  function startEdit(item: JobCustomFactor) {
    setEditingFactor(item);
    setCustomId(cleanText(item.custom_id));
    setCountry(cleanText(item.country) || "UK");
    setScope(cleanText(item.scope) || "Scope 3");
    setDescription(cleanText(item.description));
    setReportLabel(cleanText(item.report_label));
    setCategory(cleanText(item.category));
    setUom(cleanText(item.uom));
    setGhgUnit(cleanText(item.ghg_unit) || "kg CO2e");
    setSource(cleanText(item.source) || "Client factor");
    setIsActive(Boolean(item.is_active ?? true));
    setYearFactors(yearsFromFactor(item, defaultFactorYear));
    setYearToAdd("");
  }

  const formYears = useMemo(() => {
    return Object.keys(yearFactors)
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
  }, [yearFactors]);

  function addYearField() {
    const year = Number(String(yearToAdd).trim());
    if (!Number.isFinite(year) || year < 1900 || year > 2200) {
      setStatus("Enter a valid year (1900-2200)");
      return;
    }
    if (Object.prototype.hasOwnProperty.call(yearFactors, year)) {
      setStatus(`Year ${year} is already added.`);
      return;
    }
    setYearFactors((prev) => ({ ...prev, [year]: "" }));
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
    const descriptionText = cleanText(description);
    const scopeText = cleanText(scope);
    const factorsByYear = parseYearFactors(yearFactors);

    if (!descriptionText) {
      setStatus("Description is required");
      return;
    }
    if (!scopeText) {
      setStatus("Scope is required");
      return;
    }
    if (Object.keys(factorsByYear).length === 0) {
      setStatus("At least one year's factor value is required");
      return;
    }

    setLoading(true);
    setStatus(editingFactor ? "Updating client factor..." : "Creating client factor...");
    try {
      const body = {
        custom_id: customId.trim() || null,
        country,
        scope: scopeText,
        description: descriptionText,
        report_label: cleanText(reportLabel) || null,
        category: cleanText(category) || null,
        uom: cleanText(uom) || null,
        ghg_unit: cleanText(ghgUnit) || null,
        source: cleanText(source) || "Client factor",
        factors_by_year: factorsByYear,
        is_active: isActive,
      };

      const path = editingFactor
        ? `/jobs/${jobId}/custom-factors/${editingFactor.factor_id}`
        : `/jobs/${jobId}/custom-factors`;

      const res = await apiFetch(path, {
        method: editingFactor ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Save failed (${res.status})${text ? `: ${text}` : ""}`);
      }

      setStatus(editingFactor ? "Client factor updated" : "Client factor created");
      clearForm();
      await loadFactors();
      setTimeout(() => setStatus(""), 2500);
    } catch (e) {
      setStatus(errorMessage(e, "Failed to save client factor"));
    } finally {
      setLoading(false);
    }
  }

  async function toggleArchive(item: JobCustomFactor, archived: boolean) {
    const confirmed = await confirmAction({
      title: `${archived ? "Archive" : "Restore"} client factor?`,
      description: `${archived ? "Archive" : "Restore"} "${item.report_label || item.description}"? ${archived ? "It will no longer be selectable in any job for this client." : "It will become selectable again in any job for this client."}`,
      confirmLabel: archived ? "Archive" : "Restore",
      destructive: archived,
    });
    if (!confirmed) return;

    setLoading(true);
    setStatus(archived ? "Archiving client factor..." : "Restoring client factor...");
    try {
      const res = await apiFetch(`/jobs/${jobId}/custom-factors/${item.factor_id}/archive`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Archive failed (${res.status})${text ? `: ${text}` : ""}`);
      }
      await loadFactors();
      setStatus(archived ? "Client factor archived" : "Client factor restored");
      setTimeout(() => setStatus(""), 2500);
    } catch (e) {
      setStatus(errorMessage(e, "Failed to update client factor archive state"));
    } finally {
      setLoading(false);
    }
  }

  const filteredFactors = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return factors;
    return factors.filter((item) => {
      const hay = [
        item.custom_id,
        item.report_label,
        item.description,
        item.category,
        item.scope,
        item.source,
        item.country,
        item.uom,
        item.ghg_unit,
      ]
        .map((v) => cleanText(v).toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }, [factors, search]);

  function yearSummary(item: JobCustomFactor): string {
    const byYear = item.factors_by_year;
    if (byYear && Object.keys(byYear).length > 0) {
      const years = Object.keys(byYear).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
      if (years.length === 1) return String(years[0]);
      return `${years[0]}-${years[years.length - 1]} (${years.length} years)`;
    }
    return String(item.factor_year ?? reportingYear ?? defaultFactorYear);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Client Factors</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
            Custom factors created here are shared across every job for this client -- including jobs from
            previous years -- not just the job you created them in. If a factor should be reused across
            every client in the system, add it in Reusable Conversion Factors instead. Give a factor a
            value for each year it applies to; a job will use the value for its own reporting year, falling
            back to the nearest earlier year if that exact year isn&apos;t set.
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="jobCustomFactorSearch">Search</Label>
              <Input
                id="jobCustomFactorSearch"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search custom ID, label, description, category, source..."
              />
            </div>
            <div className="space-y-2">
              <Label>List Scope</Label>
              <Select value={filterScope} onValueChange={setFilterScope}>
                <SelectTrigger>
                  <SelectValue placeholder="All scopes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All scopes</SelectItem>
                  <SelectItem value="Scope 1">Scope 1</SelectItem>
                  <SelectItem value="Scope 2">Scope 2</SelectItem>
                  <SelectItem value="Scope 3">Scope 3</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex items-end">
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

          {status ? <div className="rounded-md bg-muted p-3 text-sm">{status}</div> : null}

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <Card>
              <CardHeader>
                <CardTitle>{editingFactor ? "Edit Client Factor" : "Add Client Factor"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="jobCustomId">Custom ID</Label>
                    <Input
                      id="jobCustomId"
                      value={customId}
                      onChange={(e) => setCustomId(e.target.value)}
                      placeholder="Optional; auto-generated if blank"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="jobCustomCountry">Country</Label>
                    <Input
                      id="jobCustomCountry"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      placeholder="UK"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="jobCustomScope">Scope *</Label>
                  <Select value={scope} onValueChange={setScope}>
                    <SelectTrigger id="jobCustomScope">
                      <SelectValue placeholder="Select scope" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Scope 1">Scope 1</SelectItem>
                      <SelectItem value="Scope 2">Scope 2</SelectItem>
                      <SelectItem value="Scope 3">Scope 3</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="jobCustomDescription">Description *</Label>
                  <Textarea
                    id="jobCustomDescription"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe the client factor..."
                    rows={2}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="jobCustomReportLabel">Report Label</Label>
                  <Input
                    id="jobCustomReportLabel"
                    value={reportLabel}
                    onChange={(e) => setReportLabel(e.target.value)}
                    placeholder="Label shown in data entry and reporting"
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="jobCustomCategory">Category</Label>
                    <Input
                      id="jobCustomCategory"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      placeholder="e.g. Fuel, Travel"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="jobCustomUom">UOM</Label>
                    <Input
                      id="jobCustomUom"
                      value={uom}
                      onChange={(e) => setUom(e.target.value)}
                      placeholder="km, miles, kWh"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="jobCustomGhg">GHG Unit</Label>
                    <Input
                      id="jobCustomGhg"
                      value={ghgUnit}
                      onChange={(e) => setGhgUnit(e.target.value)}
                      placeholder="kg CO2e"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="jobCustomSource">Source</Label>
                  <Input
                    id="jobCustomSource"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    placeholder="Optional source note"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label>Factor Value by Year *</Label>
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
                    This job&apos;s reporting year ({defaultFactorYear}) is pre-filled. Add more years if
                    this factor should carry a different value in other years.
                  </div>
                  <div className="grid grid-cols-2 gap-2 rounded-md border p-3">
                    {formYears.map((year) => (
                      <div key={year} className="flex items-center gap-2">
                        <Label htmlFor={`jcf_year_${year}`} className="w-12 text-xs">
                          {year}
                        </Label>
                        <Input
                          id={`jcf_year_${year}`}
                          type="number"
                          step="0.000001"
                          value={yearFactors[year] || ""}
                          onChange={(e) =>
                            setYearFactors((prev) => ({ ...prev, [year]: e.target.value }))
                          }
                          placeholder="0.000000"
                          className="h-8 text-xs"
                        />
                        {formYears.length > 1 ? (
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

                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={(e) => setIsActive(e.target.checked)}
                    />
                    Active
                  </label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={clearForm}
                      disabled={loading}
                    >
                      Clear
                    </Button>
                    <Button type="button" onClick={saveFactor} disabled={loading}>
                      {editingFactor ? "Update Client Factor" : "Save Client Factor"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Client Factors in Use ({filteredFactors.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-xs text-muted-foreground">
                  Viewing from job: {jobNumber || `#${jobId}`} {clientName ? `| ${clientName}` : ""} |
                  Reporting year: {reportingYear ?? defaultFactorYear}
                </div>

                <div className="max-h-[36rem] overflow-auto rounded-md border">
                  {loading && filteredFactors.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground">Loading factors...</div>
                  ) : filteredFactors.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground">
                      No client factors found yet.
                    </div>
                  ) : (
                    <div className="space-y-2 p-3">
                      {filteredFactors.map((item) => (
                        <div key={item.factor_id} className="rounded-md border p-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">
                                  {item.report_label || item.description || item.custom_id || "Client factor"}
                                </span>
                                <Badge variant={item.archived ? "secondary" : "default"}>
                                  {item.archived ? "Archived" : "Active"}
                                </Badge>
                                <Badge variant="outline">{item.scope}</Badge>
                                <Badge variant="outline">{yearSummary(item)}</Badge>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                <span className="font-mono">{item.custom_id || `JCF-${item.job_id ?? jobId}-${item.factor_id}`}</span>
                                {" "} | {item.category || "Uncategorized"} | {item.country || "Country not set"}
                                {item.job_number ? ` | Created in job ${item.job_number}` : ""}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {item.description}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                UOM: <span className="font-mono">{item.uom || "-"}</span>{" "}
                                | GHG: <span className="font-mono">{item.ghg_unit || "-"}</span>{" "}
                                | Source: <span className="font-mono">{item.source || "Client factor"}</span>
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => startEdit(item)}
                                disabled={loading}
                              >
                                Edit
                              </Button>
                              <Button
                                type="button"
                                variant={item.archived ? "secondary" : "outline"}
                                onClick={() => toggleArchive(item, !item.archived)}
                                disabled={loading}
                              >
                                {item.archived ? "Restore" : "Archive"}
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
