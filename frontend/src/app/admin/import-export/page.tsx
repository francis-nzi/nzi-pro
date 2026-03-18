"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function apiBaseUrl(): string {
  return "/api/backend";
}

type WfmSummary = {
  file_count: number;
  total_size_bytes: number;
  files: Array<{ name: string; rows: number; size_bytes: number }>;
  preview_clients: Array<{ wfm_client_id: string; name: string }>;
  imported_counts?: { clients?: number; contacts?: number; jobs?: number };
};

type WfmMapping = {
  mappings: { job?: Record<string, string[]>; client?: Record<string, string[]> };
  source_fields: { job_custom_field_names?: string[]; client_custom_field_names?: string[] };
};
type CatalogItem = {
  file_name: string;
  field_name: string;
  source_entity?: string;
  sample_values?: string;
  non_empty_count: number;
  distinct_count: number;
  suggested_entity?: string;
  suggested_target?: string;
  suggestion_score?: number;
  suggestion_reason?: string;
  suggested_candidates?: Array<{ target_entity: string; target_field: string; score: number; reason: string }>;
  target_entity?: string;
  target_field?: string;
  priority?: number;
  is_active?: boolean;
  notes?: string;
};
type MappingTargets = { targets?: { job?: string[]; client?: string[] } };
type MappingEdit = {
  source_entity: string;
  target_entity: string;
  target_field: string;
  priority: number;
  is_active: boolean;
  notes: string;
};

const DEFAULT_MAPPING_SUMMARY: { job: Record<string, string[]>; client: Record<string, string[]> } = {
  job: {
    ignore: [],
    report_from: ["Report From", "Reporting Period From"],
    report_to: ["Report To", "Reporting Period To"],
    crm_name: ["Report Writer", "Job Manager", "Assigned Consultant"],
    is_benchmark: ["Is Benchmark?", "Benchmark?", "Benchmark"],
    is_renewal: ["Is renewal?", "Is Renewal?", "Renewal?"],
    data_collection_due: ["Data Completion Date", "Data Collection Due Date"],
    first_draft_due: ["Draft Report Due Date", "First Draft Due Date"],
    final_report_due: ["Report Due Date", "Final Report Due Date", "Report Completion Date"],
    scope_1_tco2e: ["Scope 1 (tCO2e)", "Scope 1 Emissions", "Scope 1"],
    scope_2_tco2e: ["Scope 2 (tCO2e)", "Scope 2 Emissions", "Scope 2"],
    scope_3_tco2e: ["Scope 3 (tCO2e)", "Scope 3 Emissions", "Scope 3"],
    total_tco2e: ["Total Emissions (tCO2e)", "Total Emissions"],
    employees: ["Number of Employees", "Employees"],
    turnover: ["Turnover", "Annual Turnover"],
  },
  client: {
    ignore: [],
    turnover: ["Turnover", "Annual Turnover"],
    industry: ["Industry", "Sector", "Business Sector", "Company Sector"],
    sic_code: ["Industry Code (SIC)", "Industry Code", "SIC Code", "SIC", "SIC Number"],
    company_reg: ["Company Number", "Company Registration", "Company Registration Number"],
    year_end_month: ["Financial Year End", "Year End Date"],
    benchmark_period_start: ["Benchmark Date From", "Benchmark Period Start"],
    benchmark_period_end: ["Benchmark Date To", "Benchmark Period End"],
    currency: ["Currency"],
    description_long: ["Other Client Data", "Client Notes"],
  },
};

function impactCount(value: { count?: number } | undefined): number {
  return Number(value?.count || 0);
}

function mergeMappingSummary(mapping: WfmMapping | null): { job: Record<string, string[]>; client: Record<string, string[]> } {
  const merged = {
    job: { ...DEFAULT_MAPPING_SUMMARY.job },
    client: { ...DEFAULT_MAPPING_SUMMARY.client },
  };
  for (const entity of ["job", "client"] as const) {
    const incoming = mapping?.mappings?.[entity] || {};
    for (const [target, sources] of Object.entries(incoming)) merged[entity][target] = Array.isArray(sources) ? sources : [];
  }
  return merged;
}

export default function AdminImportExportPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<WfmSummary | null>(null);
  const [mapping, setMapping] = useState<WfmMapping | null>(null);
  const [runResult, setRunResult] = useState<any>(null);
  const [impactPreview, setImpactPreview] = useState<any>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [mapAllMinScore, setMapAllMinScore] = useState("70");
  const [mappingTargets, setMappingTargets] = useState<MappingTargets>({});
  const [mappingEdits, setMappingEdits] = useState<Record<string, MappingEdit>>({});

  const [maxClients, setMaxClients] = useState("3");
  const [clientIds, setClientIds] = useState("");
  const [clientNames, setClientNames] = useState("");
  const [jobNumbers, setJobNumbers] = useState("");
  const [wfmSourceFiles, setWfmSourceFiles] = useState<File[]>([]);
  const [replaceExistingWfmFiles, setReplaceExistingWfmFiles] = useState(true);
  const mergedMappingSummary = useMemo(() => mergeMappingSummary(mapping), [mapping]);

  async function loadCatalog(query?: string) {
    const q = (query ?? catalogQuery).trim();
    const res = await fetch(`${baseUrl}/admin/import-export/wfm/catalog${q ? `?q=${encodeURIComponent(q)}` : ""}`, {
      credentials: "include",
    });
    if (!res.ok) return;
    const json = await res.json();
    const items = Array.isArray(json?.items) ? json.items : [];
    setCatalog(items);
    const next: Record<string, MappingEdit> = {};
    for (const item of items) {
      const key = `${item.file_name}::${item.field_name}`;
      next[key] = {
        source_entity: (item.source_entity || item.suggested_entity || "job").toLowerCase(),
        target_entity: (item.target_entity || item.suggested_entity || item.source_entity || "job").toLowerCase(),
        target_field: item.target_field || item.suggested_target || "",
        priority: Number(item.priority || 10),
        is_active: item.is_active !== false,
        notes: item.notes || "",
      };
    }
    setMappingEdits(next);
  }

  async function loadSummary() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${baseUrl}/admin/import-export/wfm/summary`, { credentials: "include" });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to load summary (${res.status})${t ? `: ${t}` : ""}`);
      }
      const json = await res.json();
      setSummary(json);
      const mapRes = await fetch(`${baseUrl}/admin/import-export/wfm/mapping`, { credentials: "include" });
      if (mapRes.ok) {
        const mapJson = await mapRes.json();
        setMapping(mapJson);
      }
      const targetsRes = await fetch(`${baseUrl}/admin/import-export/wfm/mapping-targets`, { credentials: "include" });
      if (targetsRes.ok) {
        const targetsJson = await targetsRes.json();
        setMappingTargets(targetsJson);
      }
      await loadCatalog("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSummary();
  }, []);

  async function runImport(mode: "dry-run" | "import") {
    setBusy(true);
    setError("");
    setStatus(mode === "import" ? "Running live import..." : "Running dry-run...");
    setRunResult(null);
    try {
      const res = await fetch(`${baseUrl}/admin/import-export/wfm/run`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          max_clients: maxClients.trim() ? Number(maxClients) : null,
          client_ids: clientIds.trim(),
          client_names: clientNames.trim(),
          job_numbers: jobNumbers.trim(),
        }),
      });
      const text = await res.text().catch(() => "");
      let json: any = {};
      if (text.trim()) {
        try {
          json = JSON.parse(text);
        } catch {
          json = { raw: text };
        }
      }
      if (!res.ok) {
        throw new Error(`Run failed (${res.status})${text ? `: ${text}` : ""}`);
      }
      setRunResult(json);
      setStatus(mode === "import" ? "Import complete." : "Dry-run complete.");
      await loadSummary();
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function uploadWfmSourceFiles() {
    if (!wfmSourceFiles.length) {
      setError("Choose one or more WFM CSV or ZIP files first.");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("Uploading WFM source files...");
    try {
      const formData = new FormData();
      formData.append("replace_existing", replaceExistingWfmFiles ? "true" : "false");
      for (const file of wfmSourceFiles) {
        formData.append("files", file);
      }
      const res = await fetch(`${baseUrl}/admin/import-export/wfm/source-files`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const text = await res.text().catch(() => "");
      let json: any = {};
      if (text.trim()) {
        try {
          json = JSON.parse(text);
        } catch {
          json = { raw: text };
        }
      }
      if (!res.ok) {
        throw new Error(`Upload failed (${res.status})${text ? `: ${text}` : ""}`);
      }
      setWfmSourceFiles([]);
      setStatus(`Uploaded ${Number(json.file_count || 0)} WFM file(s).`);
      await loadSummary();
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function previewImpact() {
    setBusy(true);
    setError("");
    setStatus("Building mapping impact preview...");
    try {
      const res = await fetch(`${baseUrl}/admin/import-export/wfm/mappings/preview-impact`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_numbers: jobNumbers.trim(),
          client_ids: clientIds.trim(),
          client_names: clientNames.trim(),
        }),
      });
      const text = await res.text().catch(() => "");
      let json: any = {};
      if (text.trim()) {
        try {
          json = JSON.parse(text);
        } catch {
          json = { raw: text };
        }
      }
      if (!res.ok) throw new Error(`Preview failed (${res.status})${text ? `: ${text}` : ""}`);
      setImpactPreview(json);
      setStatus("Impact preview ready.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function exportImported() {
    setBusy(true);
    setError("");
    setStatus("Preparing export ZIP...");
    try {
      const res = await fetch(`${baseUrl}/admin/import-export/wfm/export-imported`, { credentials: "include" });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Export failed (${res.status})${t ? `: ${t}` : ""}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "wfm_import_export.zip";
      a.click();
      URL.revokeObjectURL(url);
      setStatus("Export downloaded.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function scanFields() {
    setBusy(true);
    setError("");
    setStatus("Scanning all WFM CSV fields...");
    try {
      const res = await fetch(`${baseUrl}/admin/import-export/wfm/scan`, {
        method: "POST",
        credentials: "include",
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) throw new Error(`Scan failed (${res.status})${text ? `: ${text}` : ""}`);
      await loadSummary();
      setStatus("WFM field scan complete.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function mapField(item: CatalogItem) {
    const sourceEntity = item.source_entity || item.suggested_entity || "";
    const targetEntity = item.target_entity || item.suggested_entity || sourceEntity || "";
    const targetField = item.target_field || item.suggested_target || "";
    if (!sourceEntity || !targetEntity || !targetField) return;
    const res = await fetch(`${baseUrl}/admin/import-export/wfm/mappings/upsert`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_entity: sourceEntity,
        source_field: item.field_name,
        target_entity: targetEntity,
        target_field: targetField,
        priority: 10,
        is_active: true,
      }),
    });
    if (res.ok) {
      await loadCatalog();
      await loadSummary();
    }
  }

  async function mapAllSuggested() {
    setBusy(true);
    setError("");
    setStatus("Applying suggested mappings...");
    try {
      const res = await fetch(`${baseUrl}/admin/import-export/wfm/mappings/map-suggested`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          min_score: Number(mapAllMinScore || 70),
          only_unmapped: true,
        }),
      });
      const txt = await res.text().catch(() => "");
      if (!res.ok) throw new Error(`Map suggested failed (${res.status})${txt ? `: ${txt}` : ""}`);
      await loadCatalog();
      setStatus("Suggested mappings applied.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  function updateEdit(key: string, patch: Partial<MappingEdit>) {
    setMappingEdits((prev) => ({ ...prev, [key]: { ...(prev[key] || {
      source_entity: "job",
      target_entity: "job",
      target_field: "",
      priority: 10,
      is_active: true,
      notes: "",
    }), ...patch } }));
  }

  async function saveManualMap(item: CatalogItem) {
    const key = `${item.file_name}::${item.field_name}`;
    const edit = mappingEdits[key];
    if (!edit?.source_entity || !edit?.target_entity || !edit?.target_field) {
      return;
    }
    const res = await fetch(`${baseUrl}/admin/import-export/wfm/mappings/upsert`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_entity: edit.source_entity,
        source_field: item.field_name,
        target_entity: edit.target_entity,
        target_field: edit.target_field,
        priority: Number(edit.priority || 10),
        is_active: !!edit.is_active,
        notes: edit.notes || "",
      }),
    });
    if (res.ok) {
      await loadCatalog();
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-6xl px-6 py-10 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold" style={{ color: "#F26624" }}>Import / Export</h1>
            <p className="text-muted-foreground">WorkflowMax migration control panel (trial + production runs).</p>
          </div>
          <Button variant="secondary" asChild>
            <Link href="/admin">{"<-"} Back to Admin</Link>
          </Button>
        </div>

        <Card>
          <CardHeader><CardTitle>WorkflowMax Source Summary</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {loading ? <div className="text-sm text-muted-foreground">Loading...</div> : null}
            {summary ? (
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded border p-3 text-sm">Files: <strong>{summary.file_count}</strong></div>
                <div className="rounded border p-3 text-sm">Size: <strong>{(summary.total_size_bytes / (1024 * 1024)).toFixed(2)} MB</strong></div>
                <div className="rounded border p-3 text-sm">
                  Imported so far: <strong>{summary.imported_counts?.clients || 0}</strong> clients / <strong>{summary.imported_counts?.jobs || 0}</strong> jobs
                </div>
              </div>
            ) : null}
            <div className="rounded border p-4 space-y-3">
              <div>
                <div className="text-sm font-medium">Upload WFM Source Files</div>
                <div className="text-sm text-muted-foreground">
                  Upload the WorkflowMax CSV files, or a ZIP containing them, into this Render environment for the one-off import.
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
                <div className="space-y-2">
                  <Label htmlFor="wfm-source-files">CSV or ZIP files</Label>
                  <Input
                    id="wfm-source-files"
                    type="file"
                    multiple
                    accept=".csv,.zip"
                    onChange={(e) => setWfmSourceFiles(Array.from(e.target.files || []))}
                  />
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={replaceExistingWfmFiles}
                      onChange={(e) => setReplaceExistingWfmFiles(e.target.checked)}
                    />
                    Replace any existing WFM source CSVs in this environment
                  </label>
                  {wfmSourceFiles.length ? (
                    <div className="text-xs text-muted-foreground">
                      Selected: {wfmSourceFiles.map((file) => file.name).join(", ")}
                    </div>
                  ) : null}
                </div>
                <Button disabled={busy || !wfmSourceFiles.length} onClick={() => void uploadWfmSourceFiles()}>
                  Upload WFM Files
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Run Import</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <Label>Max Clients (trial)</Label>
                <Input value={maxClients} onChange={(e) => setMaxClients(e.target.value)} placeholder="3" />
              </div>
              <div>
                <Label>Client IDs (comma separated)</Label>
                <Input value={clientIds} onChange={(e) => setClientIds(e.target.value)} placeholder="uuid1,uuid2,uuid3" />
              </div>
              <div>
                <Label>Client Names (comma separated)</Label>
                <Input value={clientNames} onChange={(e) => setClientNames(e.target.value)} placeholder="First Event,Client B" />
              </div>
              <div>
                <Label>Job Numbers (comma separated)</Label>
                <Input value={jobNumbers} onChange={(e) => setJobNumbers(e.target.value)} placeholder="J000547" />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => void scanFields()}>Scan All WFM Fields</Button>
              <Input
                value={mapAllMinScore}
                onChange={(e) => setMapAllMinScore(e.target.value)}
                placeholder="Min score"
                className="w-28"
              />
              <Button variant="outline" disabled={busy} onClick={() => void mapAllSuggested()}>
                Map All Suggested
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => void previewImpact()}>
                Preview Mapping Impact
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => void runImport("dry-run")}>Run Dry-Run</Button>
              <Button disabled={busy} onClick={() => void runImport("import")}>Run Import</Button>
              <Button variant="secondary" disabled={busy} onClick={() => void exportImported()}>Export Imported Data</Button>
            </div>
            {status ? <div className="text-sm text-muted-foreground">{status}</div> : null}
            {error ? <div className="text-sm text-destructive">{error}</div> : null}
            {runResult ? (
              <div className="rounded border p-3">
                <div className="mb-2 text-sm font-medium">Last Run Result</div>
                <pre className="max-h-96 overflow-auto text-xs">{JSON.stringify(runResult, null, 2)}</pre>
              </div>
            ) : null}
            {impactPreview ? (
              <div className="rounded border p-3">
                <div className="mb-2 text-sm font-medium">Mapping Impact Preview</div>
                <div className="space-y-4 text-sm">
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded border bg-muted/20 p-3">
                      <div className="text-xs text-muted-foreground">Selected Jobs</div>
                      <div className="text-xl font-semibold">{Number(impactPreview.selection?.jobs || 0)}</div>
                    </div>
                    <div className="rounded border bg-muted/20 p-3">
                      <div className="text-xs text-muted-foreground">Selected Clients</div>
                      <div className="text-xl font-semibold">{Number(impactPreview.selection?.clients || 0)}</div>
                    </div>
                    <div className="rounded border bg-muted/20 p-3">
                      <div className="text-xs text-muted-foreground">Previewed Job Numbers</div>
                      <div className="text-xs">
                        {(impactPreview.selection?.job_numbers || []).slice(0, 10).join(", ") || "-"}
                      </div>
                    </div>
                  </div>

                  {(["job", "client"] as const).map((entity) => {
                    const entries = Object.entries(impactPreview.impacts?.[entity] || {})
                      .filter(([, value]) => impactCount(value as { count?: number }) > 0)
                      .sort((a, b) => impactCount(b[1] as { count?: number }) - impactCount(a[1] as { count?: number }));
                    if (!entries.length) return null;
                    return (
                      <div key={entity}>
                        <div className="mb-2 text-sm font-medium capitalize">{entity} Mapping Hits</div>
                        <div className="overflow-x-auto rounded border">
                          <table className="w-full text-xs">
                            <thead className="bg-muted">
                              <tr>
                                <th className="p-2 text-left">Target</th>
                                <th className="p-2 text-left">Count</th>
                                <th className="p-2 text-left">Source Fields</th>
                                <th className="p-2 text-left">Sample Values</th>
                              </tr>
                            </thead>
                            <tbody>
                              {entries.map(([target, value]) => (
                                <tr key={`${entity}-${target}`} className="border-t align-top">
                                  <td className="p-2 font-medium">{entity}.{target}</td>
                                  <td className="p-2">{impactCount(value as { count?: number })}</td>
                                  <td className="p-2 whitespace-normal break-words">
                                    {((value as { source_fields?: string[] }).source_fields || []).join(", ") || "-"}
                                  </td>
                                  <td className="p-2 whitespace-normal break-words">
                                    {((value as { samples?: string[] }).samples || []).join(", ") || "-"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}

                  {impactPreview.direct_mappings && Object.keys(impactPreview.direct_mappings).length > 0 ? (
                    <div>
                      <div className="mb-2 text-sm font-medium">Direct CSV Mappings</div>
                      <div className="overflow-x-auto rounded border">
                        <table className="w-full text-xs">
                          <thead className="bg-muted">
                            <tr>
                              <th className="p-2 text-left">Mapping</th>
                              <th className="p-2 text-left">Count</th>
                              <th className="p-2 text-left">Samples</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(impactPreview.direct_mappings).map(([label, value]) => (
                              <tr key={label} className="border-t align-top">
                                <td className="p-2 font-medium">{label}</td>
                                <td className="p-2">{Number((value as { count?: number })?.count || 0)}</td>
                                <td className="p-2 whitespace-normal break-words">
                                  {(((value as { samples?: string[] })?.samples) || []).join(", ") || "-"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}

                  <details className="rounded border p-2">
                    <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Raw JSON</summary>
                    <pre className="mt-2 max-h-96 overflow-auto text-xs">{JSON.stringify(impactPreview, null, 2)}</pre>
                  </details>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Field Mapping (WFM to NZI)</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {!mapping ? <div className="text-muted-foreground">No mapping metadata loaded.</div> : null}
            {mergedMappingSummary.job ? (
              <div>
                <div className="font-medium mb-1">Job mappings</div>
                <div className="space-y-1">
                  {Object.entries(mergedMappingSummary.job).map(([target, sources]) => (
                    <div key={target} className="rounded border px-2 py-1">
                      <strong>{target}</strong>: {sources.join(" | ")}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {mergedMappingSummary.client ? (
              <div>
                <div className="font-medium mb-1">Client mappings</div>
                <div className="space-y-1">
                  {Object.entries(mergedMappingSummary.client).map(([target, sources]) => (
                    <div key={target} className="rounded border px-2 py-1">
                      <strong>{target}</strong>: {sources.join(" | ")}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Discovered WFM Fields (All CSVs)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input value={catalogQuery} onChange={(e) => setCatalogQuery(e.target.value)} placeholder="Search fields/files/sample values" />
              <Button variant="outline" onClick={() => void loadCatalog(catalogQuery)}>Search</Button>
            </div>
            <div className="max-h-[420px] overflow-auto rounded border">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="text-left p-2">File</th>
                    <th className="text-left p-2">Field</th>
                    <th className="text-left p-2">Sample</th>
                    <th className="text-left p-2">Suggested</th>
                    <th className="text-left p-2">Suggestion</th>
                    <th className="text-left p-2">Mapped</th>
                    <th className="text-left p-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {catalog.map((item, idx) => (
                    <tr key={`${item.file_name}-${item.field_name}-${idx}`} className="border-t">
                      <td className="p-2">{item.file_name}</td>
                      <td className="p-2 font-medium">{item.field_name}</td>
                      <td className="p-2 max-w-[320px] truncate">{item.sample_values || "-"}</td>
                      <td className="p-2">
                        {item.suggested_entity && item.suggested_target ? `${item.suggested_entity}.${item.suggested_target}` : "-"}
                      </td>
                      <td className="p-2 text-[11px]">
                        {item.suggestion_score != null ? (
                          <div>
                            <div>Score: {Number(item.suggestion_score).toFixed(1)}</div>
                            <div className="text-muted-foreground">{item.suggestion_reason || ""}</div>
                          </div>
                        ) : "-"}
                      </td>
                      <td className="p-2">{item.target_entity && item.target_field ? `${item.target_entity}.${item.target_field}` : "-"}</td>
                      <td className="p-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!item.suggested_target}
                          onClick={() => void mapField(item)}
                        >
                          Map Suggested
                        </Button>
                        <div className="mt-2 grid gap-1">
                          {(() => {
                            const key = `${item.file_name}::${item.field_name}`;
                            const edit = mappingEdits[key];
                            const targetFieldOptions = (mappingTargets.targets?.[(edit?.target_entity || "job") as "job" | "client"] || []);
                            return (
                              <>
                                <select
                                  className="h-7 rounded border px-1"
                                  value={edit?.source_entity || "job"}
                                  onChange={(e) => updateEdit(key, { source_entity: e.target.value })}
                                >
                                  <option value="job">job</option>
                                  <option value="client">client</option>
                                </select>
                                <select
                                  className="h-7 rounded border px-1"
                                  value={edit?.target_entity || "job"}
                                  onChange={(e) => updateEdit(key, { target_entity: e.target.value, target_field: "" })}
                                >
                                  <option value="job">job</option>
                                  <option value="client">client</option>
                                </select>
                                <select
                                  className="h-7 rounded border px-1"
                                  value={edit?.target_field || ""}
                                  onChange={(e) => updateEdit(key, { target_field: e.target.value })}
                                >
                                  <option value="">target field...</option>
                                  {targetFieldOptions.map((tf) => (
                                    <option key={tf} value={tf}>{tf}</option>
                                  ))}
                                </select>
                                <input
                                  className="h-7 rounded border px-1"
                                  value={String(edit?.priority ?? 10)}
                                  onChange={(e) => updateEdit(key, { priority: Number(e.target.value || 10) })}
                                  placeholder="priority"
                                />
                                <label className="flex items-center gap-1 text-[11px]">
                                  <input
                                    type="checkbox"
                                    checked={!!edit?.is_active}
                                    onChange={(e) => updateEdit(key, { is_active: e.target.checked })}
                                  />
                                  active
                                </label>
                                <input
                                  className="h-7 rounded border px-1"
                                  value={edit?.notes || ""}
                                  onChange={(e) => updateEdit(key, { notes: e.target.value })}
                                  placeholder="notes"
                                />
                                <Button size="sm" onClick={() => void saveManualMap(item)}>Save Map</Button>
                              </>
                            );
                          })()}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {catalog.length === 0 ? (
                    <tr>
                      <td className="p-3 text-muted-foreground" colSpan={7}>No catalog rows yet. Run "Scan All WFM Fields".</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
