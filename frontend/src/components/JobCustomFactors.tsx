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

type JobCustomFactor = {
  factor_id: number;
  job_id: number;
  job_number?: string | null;
  job_title?: string | null;
  reporting_year?: number | null;
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
  const [source, setSource] = useState("Job-only factor");
  const [factor, setFactor] = useState("");
  const [factorYear, setFactorYear] = useState(String(defaultFactorYear));
  const [isActive, setIsActive] = useState(true);

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
        throw new Error(`Failed to load job-only factors: ${res.status}${text ? ` - ${text}` : ""}`);
      }

      const json = await res.json();
      setFactors(Array.isArray(json?.items) ? json.items : []);
    } catch (e) {
      setStatus(errorMessage(e, "Failed to load job-only factors"));
    } finally {
      setLoading(false);
    }
  }, [apiFetch, filterScope, includeArchived, jobId, search]);

  useEffect(() => {
    void loadFactors();
  }, [loadFactors]);

  useEffect(() => {
    setFactorYear(String(defaultFactorYear));
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
    setSource("Job-only factor");
    setFactor("");
    setFactorYear(String(defaultFactorYear));
    setIsActive(true);
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
    setSource(cleanText(item.source) || "Job-only factor");
    setFactor(typeof item.factor === "number" ? String(item.factor) : "");
    setFactorYear(String(item.factor_year ?? defaultFactorYear));
    setIsActive(Boolean(item.is_active ?? true));
  }

  async function saveFactor() {
    const descriptionText = cleanText(description);
    const scopeText = cleanText(scope);
    const factorNumber = Number(String(factor).trim());
    const factorYearNumber = Number(String(factorYear).trim());

    if (!descriptionText) {
      setStatus("Description is required");
      return;
    }
    if (!scopeText) {
      setStatus("Scope is required");
      return;
    }
    if (!Number.isFinite(factorNumber)) {
      setStatus("Factor value is required");
      return;
    }
    if (!Number.isFinite(factorYearNumber)) {
      setStatus("Factor year is required");
      return;
    }

    setLoading(true);
    setStatus(editingFactor ? "Updating job-only factor..." : "Creating job-only factor...");
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
        source: cleanText(source) || "Job-only factor",
        factor: factorNumber,
        factor_year: factorYearNumber,
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

      setStatus(editingFactor ? "Job-only factor updated" : "Job-only factor created");
      clearForm();
      await loadFactors();
      setTimeout(() => setStatus(""), 2500);
    } catch (e) {
      setStatus(errorMessage(e, "Failed to save job-only factor"));
    } finally {
      setLoading(false);
    }
  }

  async function toggleArchive(item: JobCustomFactor, archived: boolean) {
    const confirmed = await confirmAction({
      title: `${archived ? "Archive" : "Restore"} job-only factor?`,
      description: `${archived ? "Archive" : "Restore"} "${item.report_label || item.description}" for this job?`,
      confirmLabel: archived ? "Archive" : "Restore",
      destructive: archived,
    });
    if (!confirmed) return;

    setLoading(true);
    setStatus(archived ? "Archiving job-only factor..." : "Restoring job-only factor...");
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
      setStatus(archived ? "Job-only factor archived" : "Job-only factor restored");
      setTimeout(() => setStatus(""), 2500);
    } catch (e) {
      setStatus(errorMessage(e, "Failed to update job-only factor archive state"));
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Job-Only Factors</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
            Use this for one-off factors that belong to this job only. If the factor should be reused
            across every job for this client, add it in Reusable Conversion Factors instead. Once saved,
            job-only factors appear automatically in the job Data Entry factor picker and stay scoped to
            this job.
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
                <CardTitle>{editingFactor ? "Edit Job-Only Factor" : "Add Job-Only Factor"}</CardTitle>
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

                <div className="grid gap-4 md:grid-cols-2">
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
                    <Label htmlFor="jobCustomYear">Factor Year *</Label>
                    <Input
                      id="jobCustomYear"
                      type="number"
                      value={factorYear}
                      onChange={(e) => setFactorYear(e.target.value)}
                      placeholder={String(defaultFactorYear)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="jobCustomDescription">Description *</Label>
                  <Textarea
                    id="jobCustomDescription"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe the one-off job-only factor..."
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

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="jobCustomFactor">Factor *</Label>
                    <Input
                      id="jobCustomFactor"
                      type="number"
                      step="0.000001"
                      value={factor}
                      onChange={(e) => setFactor(e.target.value)}
                      placeholder="0.000000"
                    />
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={isActive}
                        onChange={(e) => setIsActive(e.target.checked)}
                      />
                      Active
                    </label>
                  </div>
                  <div className="flex items-end justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={clearForm}
                      disabled={loading}
                    >
                      Clear
                    </Button>
                    <Button type="button" onClick={saveFactor} disabled={loading}>
                      {editingFactor ? "Update Job-Only Factor" : "Save Job-Only Factor"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Job-Only Factors in Use ({filteredFactors.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-xs text-muted-foreground">
                  Job: {jobNumber || `#${jobId}`} {clientName ? `| ${clientName}` : ""} | Reporting year:{" "}
                  {reportingYear ?? defaultFactorYear}
                </div>

                <div className="max-h-[36rem] overflow-auto rounded-md border">
                  {loading && filteredFactors.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground">Loading factors...</div>
                  ) : filteredFactors.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground">
                      No job-only factors found yet.
                    </div>
                  ) : (
                    <div className="space-y-2 p-3">
                      {filteredFactors.map((item) => (
                        <div key={item.factor_id} className="rounded-md border p-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">
                                  {item.report_label || item.description || item.custom_id || "Job-only factor"}
                                </span>
                                <Badge variant={item.archived ? "secondary" : "default"}>
                                  {item.archived ? "Archived" : "Active"}
                                </Badge>
                                <Badge variant="outline">{item.scope}</Badge>
                                <Badge variant="outline">{item.factor_year ?? reportingYear ?? defaultFactorYear}</Badge>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                <span className="font-mono">{item.custom_id || `JCF-${jobId}-${item.factor_id}`}</span>
                                {" "} | {item.category || "Uncategorized"} | {item.country || "Country not set"}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {item.description}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Factor: <span className="font-mono">{item.factor?.toFixed(6) ?? "-"}</span>{" "}
                                | UOM: <span className="font-mono">{item.uom || "-"}</span>{" "}
                                | GHG: <span className="font-mono">{item.ghg_unit || "-"}</span>{" "}
                                | Source: <span className="font-mono">{item.source || "Job-only factor"}</span>
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
