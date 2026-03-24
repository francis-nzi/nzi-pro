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

function formatApiError(action: string, status: number, text: string): string {
  const body = text.trim();
  if (!body) return `${action} failed (${status}).`;
  if (body.startsWith("<!DOCTYPE html") || body.startsWith("<html")) {
    if (status >= 500) {
      return `${action} failed (${status}): the backend returned an HTML error page, likely a temporary Render outage. Please try again in a minute.`;
    }
    return `${action} failed (${status}): the backend returned an unexpected HTML response.`;
  }
  return `${action} failed (${status}): ${body}`;
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
type RunStatsEntity = {
  processed?: number;
  inserted?: number;
  updated?: number;
};
type RunResult = {
  ok?: boolean;
  mode?: string;
  selected_clients?: Array<{ wfm_client_id?: string; name?: string }>;
  stats?: {
    clients?: RunStatsEntity;
    contacts?: RunStatsEntity;
    jobs?: RunStatsEntity;
    warnings?: string[];
    errors?: string[];
  };
};
type LegacyCommitResult = {
  ok?: boolean;
  job_id?: number;
  site_id?: number;
  inserted?: number;
  updated?: number;
  disabled_existing_legacy_rows?: number;
};
type ImpactItem = {
  count?: number;
  samples?: string[];
  source_fields?: string[];
};
type ImpactPreview = {
  ok?: boolean;
  coverage_note?: string;
  selection?: {
    jobs?: number;
    clients?: number;
    job_numbers?: string[];
  };
  impacts?: {
    job?: Record<string, ImpactItem>;
    client?: Record<string, ImpactItem>;
  };
  direct_mappings?: Record<string, { count?: number; samples?: string[] }>;
};
type AttributeOverrideChange = {
  field: string;
  action?: string;
  from_value?: string | null;
  to_value?: string | null;
};
type AttributeOverrideRow = {
  entity: string;
  row_number: number;
  match_key?: string;
  match_value?: string;
  target_id?: number;
  matched_label?: string;
  status?: string;
  warnings?: string[];
  changes?: AttributeOverrideChange[];
  update_fields?: Record<string, string | number | null>;
};
type AttributeOverridePreview = {
  ok?: boolean;
  filename?: string;
  summary?: {
    total_rows?: number;
    client_rows?: number;
    job_rows?: number;
    ready_rows?: number;
    blocked_rows?: number;
    skipped_rows?: number;
  };
  warnings?: string[];
  rows_ready?: AttributeOverrideRow[];
  rows_blocked?: AttributeOverrideRow[];
  rows_skipped?: AttributeOverrideRow[];
};
type AttributeOverrideCommitResult = {
  ok?: boolean;
  run_id?: string;
  applied_rows?: number;
  applied_changes?: number;
  applied_by_entity?: { client?: number; job?: number };
};
type ClientIndustryBackfillRow = {
  nzi_client_id?: number;
  wfm_client_id?: string;
  client_name?: string;
  existing_value?: string | null;
  wfm_value?: string;
  match_method?: string;
  action?: string;
  reason?: string;
};
type ClientIndustryBackfillResult = {
  ok?: boolean;
  target_field?: string;
  target_label?: string;
  target_column?: string;
  preview_only?: boolean;
  overwrite_existing?: boolean;
  applied_updates?: number;
  lookup_rows_inserted?: number;
  missing_lookup_values?: string[];
  summary?: {
    total_wfm_clients?: number;
    clients_with_wfm_value?: number;
    matched_by_map?: number;
    matched_by_name?: number;
    ready_updates?: number;
    fill_updates?: number;
    replace_updates?: number;
    unchanged?: number;
    missing_wfm_value?: number;
    unmatched_clients?: number;
    ambiguous_name_matches?: number;
    missing_lookup_values?: number;
  };
  rows_ready?: ClientIndustryBackfillRow[];
  rows_unmatched?: ClientIndustryBackfillRow[];
  rows_unchanged?: ClientIndustryBackfillRow[];
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

const DEFAULT_TARGET_FIELDS: { job: string[]; client: string[] } = {
  job: [
    "ignore",
    "report_from",
    "report_to",
    "crm_name",
    "is_benchmark",
    "is_renewal",
    "data_collection_due",
    "first_draft_due",
    "final_report_due",
    "scope_1_tco2e",
    "scope_2_tco2e",
    "scope_3_tco2e",
    "total_tco2e",
    "employees",
    "turnover",
    "parent-client",
  ],
  client: [
    "ignore",
    "industry",
    "sic_code",
    "company_reg",
    "year_end_month",
    "benchmark_period_start",
    "benchmark_period_end",
    "currency",
    "description_long",
    "turnover",
  ],
};

const CLIENT_BACKFILL_OPTIONS = [
  { value: "industry", label: "Industry" },
  { value: "crm_owner", label: "Client Manager" },
  { value: "year_end_month", label: "Financial Year End Month" },
  { value: "benchmark_period_start", label: "Benchmark Period Start" },
  { value: "benchmark_period_end", label: "Benchmark Period End" },
] as const;

function formatCount(value: unknown): string {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(numeric)) return "0";
  return numeric.toLocaleString();
}

const CLIENT_BACKFILL_REQUIRED_FILES: Record<string, string[]> = {
  industry: ["clients.csv", "client_custom_field_values.csv", "custom_fields.csv"],
  crm_owner: ["clients.csv", "staff.csv"],
  year_end_month: ["clients.csv"],
  benchmark_period_start: ["clients.csv", "client_custom_field_values.csv", "custom_fields.csv"],
  benchmark_period_end: ["clients.csv", "client_custom_field_values.csv", "custom_fields.csv"],
};

function normalizeEntity(value: string | undefined | null): "job" | "client" {
  const v = String(value || "").trim().toLowerCase();
  return v === "client" ? "client" : "job";
}

function impactCount(value: ImpactItem | undefined): number {
  return Number(value?.count || 0);
}

function mergeMappingSummary(
  mapping: WfmMapping | null
): { job: Record<string, string[]>; client: Record<string, string[]> } {
  const merged = {
    job: { ...DEFAULT_MAPPING_SUMMARY.job },
    client: { ...DEFAULT_MAPPING_SUMMARY.client },
  };
  for (const entity of ["job", "client"] as const) {
    const incoming = mapping?.mappings?.[entity] || {};
    for (const [target, sources] of Object.entries(incoming)) {
      merged[entity][target] = Array.isArray(sources) ? sources : [];
    }
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
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [impactPreview, setImpactPreview] = useState<ImpactPreview | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogFile, setCatalogFile] = useState("custom_fields.csv");
  const [mapAllMinScore, setMapAllMinScore] = useState("70");
  const [mappingTargets, setMappingTargets] = useState<MappingTargets>({});
  const [mappingEdits, setMappingEdits] = useState<Record<string, MappingEdit>>({});
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null);

  const [maxClients, setMaxClients] = useState("3");
  const [clientIds, setClientIds] = useState("");
  const [clientNames, setClientNames] = useState("");
  const [jobNumbers, setJobNumbers] = useState("");
  const [legacyJobId, setLegacyJobId] = useState("");
  const [legacySiteId, setLegacySiteId] = useState("");
  const [legacyFile, setLegacyFile] = useState<File | null>(null);
  const [legacyPreview, setLegacyPreview] = useState<any>(null);
  const [legacyCommitResult, setLegacyCommitResult] = useState<LegacyCommitResult | null>(null);
  const [legacyManualLookup, setLegacyManualLookup] = useState<Record<string, string>>({});
  const [attributeOverrideFile, setAttributeOverrideFile] = useState<File | null>(null);
  const [attributeOverridePreview, setAttributeOverridePreview] = useState<AttributeOverridePreview | null>(null);
  const [attributeOverrideCommitResult, setAttributeOverrideCommitResult] = useState<AttributeOverrideCommitResult | null>(null);
  const [clientBackfillField, setClientBackfillField] = useState<string>("industry");
  const [overwriteClientIndustries, setOverwriteClientIndustries] = useState(true);
  const [clientIndustryBackfillResult, setClientIndustryBackfillResult] = useState<ClientIndustryBackfillResult | null>(null);
  const [wfmSourceFiles, setWfmSourceFiles] = useState<File[]>([]);
  const [replaceExistingWfmFiles, setReplaceExistingWfmFiles] = useState(true);
  const mergedMappingSummary = useMemo(() => mergeMappingSummary(mapping), [mapping]);
  const uploadedWfmFileNames = useMemo(
    () => new Set((summary?.files || []).map((file) => String(file?.name || "").toLowerCase()).filter(Boolean)),
    [summary]
  );
  const missingClientIndustryFiles = useMemo(
    () => (CLIENT_BACKFILL_REQUIRED_FILES[clientBackfillField] || []).filter((name) => !uploadedWfmFileNames.has(name.toLowerCase())),
    [clientBackfillField, uploadedWfmFileNames]
  );
  const canRunClientIndustryBackfill = missingClientIndustryFiles.length === 0;
  const selectedClientBackfillLabel = useMemo(
    () => CLIENT_BACKFILL_OPTIONS.find((option) => option.value === clientBackfillField)?.label || "Client Field",
    [clientBackfillField]
  );
  const selectedClients = runResult?.selected_clients ?? [];
  const runWarnings = runResult?.stats?.warnings ?? [];
  const runErrors = runResult?.stats?.errors ?? [];
  const attributeReadyRows = attributeOverridePreview?.rows_ready ?? [];
  const attributeBlockedRows = attributeOverridePreview?.rows_blocked ?? [];
  const attributeSkippedRows = attributeOverridePreview?.rows_skipped ?? [];
  const legacySummary = legacyPreview?.summary ?? {};
  const legacyDatasetYears = Array.isArray(legacySummary?.dataset_years_available)
    ? legacySummary.dataset_years_available
    : [];
  const legacySummaryCards = [
    { label: "Parsed Rows", value: legacySummary?.parsed_rows },
    { label: "Ready Rows", value: legacySummary?.resolved_rows },
    { label: "Unresolved Rows", value: legacySummary?.unresolved_rows },
    { label: "Ignored Company Rows", value: legacySummary?.ignored_rows },
    { label: "Raw Quantity Rows", value: legacySummary?.quantity_mode_rows },
    { label: "Emissions Rows", value: legacySummary?.emissions_mode_rows },
    { label: "Collisions", value: legacySummary?.collision_rows },
    { label: "Scope Corrections", value: legacySummary?.scope_override_rows },
    { label: "Scope Mismatches", value: legacySummary?.scope_mismatch_rows },
  ];

  async function loadCatalog(query?: string, fileName?: string) {
    const q = (query ?? catalogQuery).trim();
    const f = (fileName ?? catalogFile).trim();
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (f) params.set("file_name", f);
    const res = await fetch(`${baseUrl}/admin/import-export/wfm/catalog${params.toString() ? `?${params.toString()}` : ""}`, {
      credentials: "include",
    });
    if (!res.ok) return;
    const json = await res.json();
    const items = Array.isArray(json?.items) ? json.items : [];
    setCatalog(items);
    const next: Record<string, MappingEdit> = {};
    for (const item of items) {
      const key = `${item.file_name}::${item.field_name}`;
      const sourceEntity = normalizeEntity(item.source_entity || item.suggested_entity || "job");
      const targetEntity = normalizeEntity(
        item.target_entity || item.suggested_entity || item.source_entity || "job"
      );
      next[key] = {
        source_entity: sourceEntity,
        target_entity: targetEntity,
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ include_all: false, min_suggest_score: 70 }),
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
          recommended_only: true,
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

  function openMappingEditor(item: CatalogItem) {
    const key = `${item.file_name}::${item.field_name}`;
    const existing = mappingEdits[key];
    const sourceEntity = normalizeEntity(item.source_entity || item.suggested_entity || existing?.source_entity || "job");
    const targetEntity = normalizeEntity(
      existing?.target_entity || item.target_entity || item.suggested_entity || item.source_entity || "job"
    );

    setMappingEdits((prev) => ({
      ...prev,
      [key]: {
        source_entity: sourceEntity,
        target_entity: targetEntity,
        target_field: existing?.target_field || item.target_field || item.suggested_target || "",
        priority: Number(existing?.priority ?? item.priority ?? 10),
        // Opening the editor means "make this the active mapping" unless the user unticks it.
        is_active: true,
        notes: existing?.notes || item.notes || "",
      },
    }));
    setEditingItem(item);
  }

  async function saveManualMap(item: CatalogItem): Promise<boolean> {
    const key = `${item.file_name}::${item.field_name}`;
    const edit = mappingEdits[key];
    if (!edit?.source_entity || !edit?.target_entity || !edit?.target_field) {
      return false;
    }
    const sourceEntity = normalizeEntity(edit.source_entity);
    const targetEntity = normalizeEntity(edit.target_entity);
    const res = await fetch(`${baseUrl}/admin/import-export/wfm/mappings/upsert`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_entity: sourceEntity,
        source_field: item.field_name,
        target_entity: targetEntity,
        target_field: edit.target_field,
        priority: Number(edit.priority || 10),
        is_active: !!edit.is_active,
        notes: edit.notes || "",
      }),
    });
    if (res.ok) {
      await loadCatalog();
      return true;
    }
    return false;
  }

  async function previewLegacyAnnualFile() {
    if (!legacyFile) {
      setError("Please select a legacy annual XLSX file.");
      return;
    }
    if (!legacyJobId.trim()) {
      setError("Please enter Job ID or Job Number for legacy upload.");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("Parsing legacy annual file...");
    setLegacyPreview(null);
    setLegacyCommitResult(null);
    try {
      const fd = new FormData();
      fd.append("job_id", legacyJobId.trim());
      fd.append("file", legacyFile);
      const res = await fetch(`${baseUrl}/admin/import-export/legacy/preview`, {
        method: "POST",
        credentials: "include",
        body: fd,
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
      if (!res.ok) throw new Error(formatApiError("Legacy preview", res.status, text));
      setLegacyPreview(json);
      setLegacyManualLookup({});
      setStatus("Legacy preview ready.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function commitLegacyAnnualFile() {
    if (!legacyPreview?.rows_ready?.length) {
      setError("No preview rows to commit.");
      return;
    }
    if (!legacyJobId.trim()) {
      setError("Please enter Job ID or Job Number.");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("Committing legacy annual rows...");
    try {
      const res = await fetch(`${baseUrl}/admin/import-export/legacy/commit`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: legacyJobId.trim(),
          site_id: legacySiteId.trim() ? Number(legacySiteId) : null,
          rows_ready: legacyPreview.rows_ready,
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
      if (!res.ok) throw new Error(formatApiError("Legacy commit", res.status, text));
      setLegacyCommitResult(json);
      const inserted = Number(json?.inserted || 0);
      const updated = Number(json?.updated || 0);
      const disabled = Number(json?.disabled_existing_legacy_rows || 0);
      setStatus(
        `Legacy annual rows committed for ${legacyPreview?.job_number || `job ${json?.job_id ?? legacyJobId.trim()}`}: ${inserted} inserted, ${updated} updated${disabled ? `, ${disabled} prior legacy rows replaced` : ""}.`
      );
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function resolveLegacyUnmatched() {
    if (!legacyPreview) return;
    setBusy(true);
    setError("");
    setStatus("Resolving unmatched legacy rows...");
    try {
      const manual_lookup = Object.entries(legacyManualLookup)
        .filter(([lookup_key, original_id]) => lookup_key && String(original_id || "").trim())
        .map(([lookup_key, original_id]) => ({ lookup_key, original_id: String(original_id).trim() }));

      const res = await fetch(`${baseUrl}/admin/import-export/legacy/resolve`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows_ready: legacyPreview.rows_ready || [],
          rows_unresolved: legacyPreview.rows_unresolved || [],
          manual_lookup,
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
      if (!res.ok) throw new Error(formatApiError("Legacy resolve", res.status, text));
      setLegacyPreview((prev: any) => ({
        ...(prev || {}),
        rows_ready: json.rows_ready || [],
        rows_unresolved: json.rows_unresolved || [],
        summary: {
          ...(prev?.summary || {}),
          ...(json.summary || {}),
        },
      }));
      setStatus("Unmatched legacy rows resolved.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function downloadAttributeOverrideTemplate() {
    setBusy(true);
    setError("");
    setStatus("Downloading attribute override template...");
    try {
      const res = await fetch(`${baseUrl}/admin/import-export/attributes/template`, {
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Template download failed (${res.status})${text ? `: ${text}` : ""}`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "attribute_override_template.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setStatus("Attribute override template downloaded.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function downloadAttributeOverrideGuide() {
    setBusy(true);
    setError("");
    setStatus("Downloading attribute override cheat sheet...");
    try {
      const res = await fetch(`${baseUrl}/admin/import-export/attributes/guide`, {
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Guide download failed (${res.status})${text ? `: ${text}` : ""}`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "ATTRIBUTE_OVERRIDE_CHEATSHEET.docx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setStatus("Attribute override cheat sheet downloaded.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function previewAttributeOverrides() {
    if (!attributeOverrideFile) {
      setError("Please select an attribute override workbook.");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("Previewing attribute overrides...");
    setAttributeOverrideCommitResult(null);
    try {
      const fd = new FormData();
      fd.append("file", attributeOverrideFile);
      const res = await fetch(`${baseUrl}/admin/import-export/attributes/preview`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const text = await res.text().catch(() => "");
      let json: AttributeOverridePreview | { raw: string } = {};
      if (text.trim()) {
        try {
          json = JSON.parse(text);
        } catch {
          json = { raw: text };
        }
      }
      if (!res.ok) {
        throw new Error(`Attribute override preview failed (${res.status})${text ? `: ${text}` : ""}`);
      }
      setAttributeOverridePreview(json as AttributeOverridePreview);
      const summary = (json as AttributeOverridePreview).summary;
      setStatus(
        `Attribute preview ready. ${Number(summary?.ready_rows || 0)} ready, ${Number(summary?.blocked_rows || 0)} blocked, ${Number(summary?.skipped_rows || 0)} unchanged.`
      );
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function commitAttributeOverrides() {
    if (!attributeReadyRows.length) {
      setError("No ready override rows to commit.");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("Applying attribute overrides...");
    try {
      const res = await fetch(`${baseUrl}/admin/import-export/attributes/commit`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows_ready: attributeReadyRows }),
      });
      const text = await res.text().catch(() => "");
      let json: AttributeOverrideCommitResult | { raw: string } = {};
      if (text.trim()) {
        try {
          json = JSON.parse(text);
        } catch {
          json = { raw: text };
        }
      }
      if (!res.ok) {
        throw new Error(`Attribute override commit failed (${res.status})${text ? `: ${text}` : ""}`);
      }
      setAttributeOverrideCommitResult(json as AttributeOverrideCommitResult);
      setStatus(
        `Applied ${Number((json as AttributeOverrideCommitResult).applied_changes || 0)} field changes across ${Number((json as AttributeOverrideCommitResult).applied_rows || 0)} rows.`
      );
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function previewClientIndustryBackfill() {
    if (!canRunClientIndustryBackfill) {
      setError(`Upload the required WFM files first: ${missingClientIndustryFiles.join(", ")}`);
      setStatus("");
      return;
    }
    setBusy(true);
    setError("");
    setStatus(`Previewing ${selectedClientBackfillLabel.toLowerCase()} backfill...`);
    try {
      const res = await fetch(`${baseUrl}/admin/import-export/wfm/client-fields/backfill`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_field: clientBackfillField,
          preview_only: true,
          overwrite_existing: overwriteClientIndustries,
        }),
      });
      const text = await res.text().catch(() => "");
      const json = text.trim() ? JSON.parse(text) : {};
      if (!res.ok) {
        throw new Error(`${selectedClientBackfillLabel} preview failed (${res.status})${text ? `: ${text}` : ""}`);
      }
      setClientIndustryBackfillResult(json as ClientIndustryBackfillResult);
      const summary = (json as ClientIndustryBackfillResult).summary;
      setStatus(
        `${selectedClientBackfillLabel} preview ready. ${Number(summary?.ready_updates || 0)} updates, ${Number(summary?.unchanged || 0)} unchanged, ${Number(summary?.unmatched_clients || 0)} unmatched.`
      );
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function applyClientIndustryBackfill() {
    if (!canRunClientIndustryBackfill) {
      setError(`Upload the required WFM files first: ${missingClientIndustryFiles.join(", ")}`);
      setStatus("");
      return;
    }
    setBusy(true);
    setError("");
    setStatus(`Applying ${selectedClientBackfillLabel.toLowerCase()} backfill...`);
    try {
      const res = await fetch(`${baseUrl}/admin/import-export/wfm/client-fields/backfill`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_field: clientBackfillField,
          preview_only: false,
          overwrite_existing: overwriteClientIndustries,
        }),
      });
      const text = await res.text().catch(() => "");
      const json = text.trim() ? JSON.parse(text) : {};
      if (!res.ok) {
        throw new Error(`${selectedClientBackfillLabel} backfill failed (${res.status})${text ? `: ${text}` : ""}`);
      }
      setClientIndustryBackfillResult(json as ClientIndustryBackfillResult);
      setStatus(`Applied ${Number((json as ClientIndustryBackfillResult).applied_updates || 0)} ${selectedClientBackfillLabel.toLowerCase()} updates.`);
      await loadSummary();
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setBusy(false);
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
              <Button variant="secondary" disabled={busy} onClick={() => void scanFields()}>Scan Recommended WFM Fields</Button>
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
                <div className="space-y-4 text-sm">
                  <div className="grid gap-3 md:grid-cols-4">
                    <div className="rounded border bg-muted/20 p-3">
                      <div className="text-xs text-muted-foreground">Mode</div>
                      <div className="text-xl font-semibold uppercase">{runResult.mode || "-"}</div>
                    </div>
                    <div className="rounded border bg-muted/20 p-3">
                      <div className="text-xs text-muted-foreground">Selected Clients</div>
                      <div className="text-xl font-semibold">{Number(runResult.selected_clients?.length || 0)}</div>
                    </div>
                    <div className="rounded border bg-muted/20 p-3">
                      <div className="text-xs text-muted-foreground">Warnings</div>
                      <div className="text-xl font-semibold">{Number(runResult.stats?.warnings?.length || 0)}</div>
                    </div>
                    <div className="rounded border bg-muted/20 p-3">
                      <div className="text-xs text-muted-foreground">Errors</div>
                      <div className="text-xl font-semibold">{Number(runResult.stats?.errors?.length || 0)}</div>
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted">
                        <tr>
                          <th className="p-2 text-left">Entity</th>
                          <th className="p-2 text-left">Processed</th>
                          <th className="p-2 text-left">Inserted</th>
                          <th className="p-2 text-left">Updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { label: "Clients", stats: runResult.stats?.clients },
                          { label: "Contacts", stats: runResult.stats?.contacts },
                          { label: "Jobs", stats: runResult.stats?.jobs },
                        ].map(({ label, stats }) => (
                          <tr key={label} className="border-t">
                            <td className="p-2 font-medium">{label}</td>
                            <td className="p-2">{Number(stats?.processed || 0)}</td>
                            <td className="p-2">{Number(stats?.inserted || 0)}</td>
                            <td className="p-2">{Number(stats?.updated || 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {selectedClients.length > 0 ? (
                    <div>
                      <div className="mb-2 text-sm font-medium">Selected Clients</div>
                      <div className="overflow-x-auto rounded border">
                        <table className="w-full text-xs">
                          <thead className="bg-muted">
                            <tr>
                              <th className="p-2 text-left">Client Name</th>
                              <th className="p-2 text-left">WFM Client ID</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedClients.slice(0, 25).map((client, idx) => (
                              <tr key={`${client.wfm_client_id || "client"}-${idx}`} className="border-t">
                                <td className="p-2">{client.name || "-"}</td>
                                <td className="p-2 break-all">{client.wfm_client_id || "-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {selectedClients.length > 25 ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          Showing first 25 of {selectedClients.length} selected clients.
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {runWarnings.length > 0 ? (
                    <div>
                      <div className="mb-2 text-sm font-medium">Warnings</div>
                      <div className="max-h-48 overflow-auto rounded border p-2 text-xs text-muted-foreground">
                        {runWarnings.slice(0, 50).map((warning, idx) => (
                          <div key={`warning-${idx}`} className={idx > 0 ? "mt-1 border-t pt-1" : ""}>
                            {warning}
                          </div>
                        ))}
                      </div>
                      {runWarnings.length > 50 ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          Showing first 50 of {runWarnings.length} warnings.
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {runErrors.length > 0 ? (
                    <div>
                      <div className="mb-2 text-sm font-medium text-destructive">Errors</div>
                      <div className="max-h-48 overflow-auto rounded border border-destructive/30 p-2 text-xs text-destructive">
                        {runErrors.slice(0, 50).map((err, idx) => (
                          <div key={`error-${idx}`} className={idx > 0 ? "mt-1 border-t border-destructive/20 pt-1" : ""}>
                            {err}
                          </div>
                        ))}
                      </div>
                      {runErrors.length > 50 ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          Showing first 50 of {runErrors.length} errors.
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <details className="rounded border p-2">
                    <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Raw JSON</summary>
                    <pre className="mt-2 max-h-96 overflow-auto text-xs">{JSON.stringify(runResult, null, 2)}</pre>
                  </details>
                </div>
              </div>
            ) : null}
            {impactPreview ? (
              <div className="rounded border p-3">
                <div className="mb-2 text-sm font-medium">Mapping Impact Preview</div>
                <div className="space-y-4 text-sm">
                  <div className="rounded border bg-muted/20 p-3 text-xs text-muted-foreground">
                    {impactPreview.coverage_note || "Counts reflect unique selected jobs or clients with a resolved value after importer fallback rules."}
                  </div>
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
                        {(impactPreview.selection?.job_numbers || []).slice(0, 5).join(", ") || "-"}
                      </div>
                    </div>
                  </div>

                  {(["job", "client"] as const).map((entity) => {
                    const entries = Object.entries(impactPreview.impacts?.[entity] || {})
                      .filter(([, value]) => impactCount(value) > 0)
                      .sort((a, b) => impactCount(b[1]) - impactCount(a[1]));
                    if (!entries.length) return null;
                    return (
                      <div key={entity}>
                        <div className="mb-2 text-sm font-medium capitalize">{entity} Mapping Hits</div>
                        <div className="overflow-x-auto rounded border">
                          <table className="w-full text-xs">
                            <thead className="bg-muted">
                              <tr>
                                <th className="p-2 text-left">Target</th>
                                <th className="p-2 text-left">Coverage</th>
                                <th className="p-2 text-left">Source Fields</th>
                                <th className="p-2 text-left">Sample Values</th>
                              </tr>
                            </thead>
                            <tbody>
                              {entries.map(([target, value]) => (
                                <tr key={`${entity}-${target}`} className="border-t align-top">
                                  <td className="p-2 font-medium">{entity}.{target}</td>
                                  <td className="p-2">{impactCount(value)}</td>
                                  <td className="p-2 whitespace-normal break-words">
                                    {(value.source_fields || []).join(", ") || "-"}
                                  </td>
                                  <td className="p-2 whitespace-normal break-words">
                                    {(value.samples || []).join(", ") || "-"}
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
                                <td className="p-2">{Number(value?.count || 0)}</td>
                                <td className="p-2 whitespace-normal break-words">
                                  {(value?.samples || []).join(", ") || "-"}
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
          <CardHeader><CardTitle>Backfill Client Fields</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded border bg-muted/30 p-3 text-xs text-muted-foreground">
              Reuses the WFM client backfill flow for supported client fields. It matches NZI clients by
              <strong> WFM import map</strong> first and <strong>client name</strong> second, then updates the selected NZI client field.
            </div>
            <label className="block text-sm text-muted-foreground">
              <div className="mb-1">Client Field</div>
              <select
                className="w-full rounded border bg-background px-3 py-2 text-sm text-foreground"
                value={clientBackfillField}
                onChange={(e) => {
                  setClientBackfillField(e.target.value);
                  setClientIndustryBackfillResult(null);
                }}
              >
                {CLIENT_BACKFILL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {!canRunClientIndustryBackfill ? (
              <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                Upload the required WFM source files first: <strong>{missingClientIndustryFiles.join(", ")}</strong>.
              </div>
            ) : null}
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={overwriteClientIndustries}
                onChange={(e) => setOverwriteClientIndustries(e.target.checked)}
              />
              Overwrite existing NZI client field values with the WFM value
            </label>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy || !canRunClientIndustryBackfill} onClick={() => void previewClientIndustryBackfill()}>
                Preview Backfill
              </Button>
              <Button
                disabled={busy || !canRunClientIndustryBackfill || !clientIndustryBackfillResult?.summary?.ready_updates}
                onClick={() => void applyClientIndustryBackfill()}
              >
                Apply Backfill
              </Button>
            </div>

            {clientIndustryBackfillResult ? (
              <div className="rounded border p-3 space-y-4">
                <div className="grid gap-3 md:grid-cols-5">
                  <div className="rounded border bg-muted/20 p-3">
                    <div className="text-xs text-muted-foreground">WFM Clients</div>
                    <div className="text-xl font-semibold">{Number(clientIndustryBackfillResult.summary?.total_wfm_clients || 0)}</div>
                  </div>
                  <div className="rounded border bg-muted/20 p-3">
                    <div className="text-xs text-muted-foreground">With WFM Value</div>
                    <div className="text-xl font-semibold">{Number(clientIndustryBackfillResult.summary?.clients_with_wfm_value || 0)}</div>
                  </div>
                  <div className="rounded border bg-muted/20 p-3">
                    <div className="text-xs text-muted-foreground">Ready Updates</div>
                    <div className="text-xl font-semibold">{Number(clientIndustryBackfillResult.summary?.ready_updates || 0)}</div>
                  </div>
                  <div className="rounded border bg-muted/20 p-3">
                    <div className="text-xs text-muted-foreground">Unchanged</div>
                    <div className="text-xl font-semibold">{Number(clientIndustryBackfillResult.summary?.unchanged || 0)}</div>
                  </div>
                  <div className="rounded border bg-muted/20 p-3">
                    <div className="text-xs text-muted-foreground">Unmatched</div>
                    <div className="text-xl font-semibold">{Number(clientIndustryBackfillResult.summary?.unmatched_clients || 0)}</div>
                  </div>
                </div>

                {clientIndustryBackfillResult.preview_only === false ? (
                  <div className="rounded border bg-muted/20 p-3 text-sm">
                    Applied <strong>{Number(clientIndustryBackfillResult.applied_updates || 0)}</strong> {String(clientIndustryBackfillResult.target_label || selectedClientBackfillLabel).toLowerCase()} updates
                    {Number(clientIndustryBackfillResult.lookup_rows_inserted || 0) > 0
                      ? ` and inserted ${Number(clientIndustryBackfillResult.lookup_rows_inserted || 0)} missing lookup rows`
                      : ""}
                    .
                  </div>
                ) : null}

                {clientIndustryBackfillResult.missing_lookup_values?.length ? (
                  <div>
                    <div className="mb-2 text-sm font-medium">Values Missing From Lookup</div>
                    <div className="rounded border p-2 text-xs text-muted-foreground">
                      {clientIndustryBackfillResult.missing_lookup_values.join(" | ")}
                    </div>
                  </div>
                ) : null}

                {(clientIndustryBackfillResult.rows_ready || []).length > 0 ? (
                  <div>
                    <div className="mb-2 text-sm font-medium">Ready Updates</div>
                    <div className="max-h-72 overflow-auto rounded border">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-muted">
                          <tr>
                            <th className="p-2 text-left">Client</th>
                            <th className="p-2 text-left">Match</th>
                            <th className="p-2 text-left">Current</th>
                            <th className="p-2 text-left">WFM</th>
                            <th className="p-2 text-left">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(clientIndustryBackfillResult.rows_ready || []).slice(0, 100).map((row, idx) => (
                            <tr key={`industry-ready-${idx}`} className="border-t align-top">
                              <td className="p-2">
                                {row.client_name || "-"}
                                <div className="text-[11px] text-muted-foreground">NZI {row.nzi_client_id || "-"} / WFM {row.wfm_client_id || "-"}</div>
                              </td>
                              <td className="p-2">{row.match_method || "-"}</td>
                              <td className="p-2">{row.existing_value || "-"}</td>
                              <td className="p-2">{row.wfm_value || "-"}</td>
                              <td className="p-2 uppercase">{row.action || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                {(clientIndustryBackfillResult.rows_unmatched || []).length > 0 ? (
                  <div>
                    <div className="mb-2 text-sm font-medium">Unmatched Clients</div>
                    <div className="max-h-72 overflow-auto rounded border">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-muted">
                          <tr>
                            <th className="p-2 text-left">WFM Client</th>
                            <th className="p-2 text-left">WFM Industry</th>
                            <th className="p-2 text-left">Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(clientIndustryBackfillResult.rows_unmatched || []).slice(0, 100).map((row, idx) => (
                            <tr key={`industry-unmatched-${idx}`} className="border-t align-top">
                              <td className="p-2">
                                {row.client_name || "-"}
                                <div className="text-[11px] text-muted-foreground">{row.wfm_client_id || "-"}</div>
                              </td>
                              <td className="p-2">{row.wfm_value || "-"}</td>
                              <td className="p-2 text-muted-foreground">{row.reason || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                {(clientIndustryBackfillResult.rows_unchanged || []).length > 0 ? (
                  <div>
                    <div className="mb-2 text-sm font-medium">Unchanged</div>
                    <div className="max-h-72 overflow-auto rounded border">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-muted">
                          <tr>
                            <th className="p-2 text-left">Client</th>
                            <th className="p-2 text-left">Current</th>
                            <th className="p-2 text-left">WFM</th>
                            <th className="p-2 text-left">Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(clientIndustryBackfillResult.rows_unchanged || []).slice(0, 100).map((row, idx) => (
                            <tr key={`field-unchanged-${idx}`} className="border-t align-top">
                              <td className="p-2">
                                {row.client_name || "-"}
                                <div className="text-[11px] text-muted-foreground">NZI {row.nzi_client_id || "-"} / WFM {row.wfm_client_id || "-"}</div>
                              </td>
                              <td className="p-2">{row.existing_value || "-"}</td>
                              <td className="p-2">{row.wfm_value || "-"}</td>
                              <td className="p-2 text-muted-foreground">{row.reason || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Legacy Annual File Upload (Template-Mapped IDs)</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <Label>Job ID / Number *</Label>
                <Input
                  value={legacyJobId}
                  onChange={(e) => setLegacyJobId(e.target.value)}
                  placeholder="e.g. 267 or J000267"
                />
              </div>
              <div>
                <Label>Site ID (optional)</Label>
                <Input value={legacySiteId} onChange={(e) => setLegacySiteId(e.target.value)} placeholder="Auto if blank" />
              </div>
              <div>
                <Label>Legacy XLSX File *</Label>
                <Input type="file" accept=".xlsx" onChange={(e) => setLegacyFile(e.target.files?.[0] || null)} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" disabled={busy || !legacyFile} onClick={() => void previewLegacyAnnualFile()}>
                Preview Legacy Upload
              </Button>
              <Button
                variant="secondary"
                disabled={busy || !legacyPreview?.rows_unresolved?.length}
                onClick={() => void resolveLegacyUnmatched()}
              >
                Resolve Unmatched Rows
              </Button>
              <Button
                disabled={busy || !legacyPreview?.rows_ready?.length}
                onClick={() => void commitLegacyAnnualFile()}
              >
                Commit Legacy Rows
              </Button>
            </div>
            {legacyCommitResult ? (
              <div className="rounded border p-3 space-y-3">
                <div className="text-sm font-medium">Last Legacy Commit</div>
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded border bg-muted/20 p-3">
                    <div className="text-xs text-muted-foreground">Job</div>
                    <div className="text-lg font-semibold">{legacyPreview?.job_number || `ID ${legacyCommitResult.job_id ?? "-"}`}</div>
                  </div>
                  <div className="rounded border bg-muted/20 p-3">
                    <div className="text-xs text-muted-foreground">Inserted</div>
                    <div className="text-lg font-semibold">{Number(legacyCommitResult.inserted || 0)}</div>
                  </div>
                  <div className="rounded border bg-muted/20 p-3">
                    <div className="text-xs text-muted-foreground">Updated</div>
                    <div className="text-lg font-semibold">{Number(legacyCommitResult.updated || 0)}</div>
                  </div>
                  <div className="rounded border bg-muted/20 p-3">
                    <div className="text-xs text-muted-foreground">Site ID</div>
                    <div className="text-lg font-semibold">{legacyCommitResult.site_id ?? "-"}</div>
                  </div>
                </div>
                <div className="rounded border bg-muted/20 p-3 text-xs text-muted-foreground">
                  Replaced prior legacy rows for this job/site: <strong>{Number(legacyCommitResult.disabled_existing_legacy_rows || 0)}</strong>.
                  Imported rows should now be visible under <strong>Jobs &gt; Data</strong> for {legacyPreview?.job_number || `job ${legacyCommitResult.job_id ?? "-"}`}.
                </div>
              </div>
            ) : null}
            {legacyPreview ? (
              <div className="rounded border p-3 space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">Preview Summary</div>
                    <div className="text-xs text-muted-foreground">
                      {legacyPreview.job_number ? `Job ${legacyPreview.job_number}` : null}
                      {legacyPreview.filename ? `${legacyPreview.job_number ? " | " : ""}${legacyPreview.filename}` : null}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Ready rows: {formatCount(Array.isArray(legacyPreview.rows_ready) ? legacyPreview.rows_ready.length : 0)}
                    {" | "}
                    Unresolved rows: {formatCount(Array.isArray(legacyPreview.rows_unresolved) ? legacyPreview.rows_unresolved.length : 0)}
                  </div>
                </div>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  {legacySummaryCards.map((item) => (
                    <div key={item.label} className="rounded border bg-muted/20 p-3">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{item.label}</div>
                      <div className="mt-1 text-lg font-semibold">{formatCount(item.value)}</div>
                    </div>
                  ))}
                </div>
                <div className="rounded border bg-muted/20 p-3">
                  <div className="text-xs font-medium">Dataset Years Available</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {legacyDatasetYears.length > 0
                      ? legacyDatasetYears.map((year: number) => formatCount(year)).join(", ")
                      : "No active dataset years were available for this preview."}
                  </div>
                </div>
                {Array.isArray(legacyPreview.warnings) && legacyPreview.warnings.length > 0 ? (
                  <div>
                    <div className="text-xs font-medium">Warnings</div>
                    <ul className="list-disc pl-5 text-xs text-muted-foreground">
                      {legacyPreview.warnings.map((w: string, i: number) => (
                        <li key={`${i}-${w}`}>{w}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {Array.isArray(legacyPreview.rows_unresolved) && legacyPreview.rows_unresolved.length > 0 ? (
                  <div className="rounded border p-2">
                    <div className="mb-2 text-xs font-medium">Unresolved Rows (enter Original ID where available)</div>
                    <div className="max-h-72 overflow-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-muted sticky top-0">
                          <tr>
                            <th className="p-1 text-left">Section</th>
                            <th className="p-1 text-left">Activity</th>
                            <th className="p-1 text-left">Scope</th>
                            <th className="p-1 text-left">Reason</th>
                            <th className="p-1 text-left">Lookup Key</th>
                            <th className="p-1 text-left">Original ID</th>
                          </tr>
                        </thead>
                        <tbody>
                          {legacyPreview.rows_unresolved.slice(0, 200).map((r: any, idx: number) => {
                            const lk = String(r.lookup_key || "");
                            const value = legacyManualLookup[lk] ?? "";
                            return (
                              <tr key={`${lk}-${idx}`} className="border-t">
                                <td className="p-1">{r.section || "-"}</td>
                                <td className="p-1">{r.activity || "-"}</td>
                                <td className="p-1">{r.scope || "-"}</td>
                                <td className="p-1 max-w-[260px] align-top text-muted-foreground">
                                  <div>{r.reason || "-"}</div>
                                  {r.match_note ? <div className="mt-1 text-[11px]">{r.match_note}</div> : null}
                                  {r.candidate_original_id ? (
                                    <div className="mt-1 text-[11px]">Candidate ID: {r.candidate_original_id}</div>
                                  ) : null}
                                </td>
                                <td className="p-1 max-w-[320px] truncate" title={lk}>{lk || "-"}</td>
                                <td className="p-1">
                                  <Input
                                    value={value}
                                    onChange={(e) =>
                                      setLegacyManualLookup((prev) => ({ ...prev, [lk]: e.target.value }))
                                    }
                                    placeholder="e.g. 25_301_3046_9_1"
                                    className="h-7 text-xs"
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Bulk Client / Job Attribute Overrides</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded border bg-muted/30 p-3 text-xs text-muted-foreground">
                Upload an Excel workbook with optional <strong>clients</strong> and/or <strong>jobs</strong> sheets to bulk update
                existing records. Blank values leave fields unchanged. Use <code>clear_fieldname</code> columns to clear values.
              </div>
              <div className="rounded border p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">Help</div>
                    <div className="text-xs text-muted-foreground">
                      Quick rules for matching rows, changing values, and clearing fields.
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" asChild>
                      <Link href="/support/attribute-overrides">Open Help Page</Link>
                    </Button>
                    <Button variant="secondary" size="sm" disabled={busy} onClick={() => void downloadAttributeOverrideGuide()}>
                      Download Cheat Sheet
                    </Button>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
                  <div className="rounded border bg-muted/20 p-2">
                    <div className="mb-1 font-medium text-foreground">Matching</div>
                    <div>Clients: <code>client_db_id</code>, <code>wfm_client_id</code>, or <code>client_name</code>.</div>
                    <div>Jobs: <code>job_id</code>, <code>wfm_job_id</code>, or <code>job_number</code>.</div>
                  </div>
                  <div className="rounded border bg-muted/20 p-2">
                    <div className="mb-1 font-medium text-foreground">Value Rules</div>
                    <div>Value blank + clear blank: leave unchanged.</div>
                    <div>Value filled + clear blank: set/update.</div>
                    <div>Value blank + clear <code>TRUE</code>: clear existing value.</div>
                    <div>Value filled + clear <code>TRUE</code>: blocked.</div>
                  </div>
                  <div className="rounded border bg-muted/20 p-2">
                    <div className="mb-1 font-medium text-foreground">Accepted Clear Values</div>
                    <div><code>TRUE</code>, <code>1</code>, <code>yes</code>, <code>y</code>, <code>on</code></div>
                  </div>
                  <div className="rounded border bg-muted/20 p-2">
                    <div className="mb-1 font-medium text-foreground">Date Format</div>
                    <div>Use <code>YYYY-MM-DD</code> where possible for the cleanest import.</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
              <div className="space-y-2">
                <Label>Attribute Override Workbook</Label>
                <Input
                  type="file"
                  accept=".xlsx"
                  onChange={(e) => {
                    setAttributeOverrideFile(e.target.files?.[0] || null);
                    setAttributeOverridePreview(null);
                    setAttributeOverrideCommitResult(null);
                  }}
                />
                {attributeOverrideFile ? (
                  <div className="text-xs text-muted-foreground">Selected: {attributeOverrideFile.name}</div>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={busy} onClick={() => void downloadAttributeOverrideTemplate()}>
                  Download Template
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => void downloadAttributeOverrideGuide()}>
                  Download Guide
                </Button>
                <Button variant="outline" disabled={busy || !attributeOverrideFile} onClick={() => void previewAttributeOverrides()}>
                  Preview Overrides
                </Button>
                <Button disabled={busy || !attributeReadyRows.length} onClick={() => void commitAttributeOverrides()}>
                  Commit Overrides
                </Button>
              </div>
            </div>

            {attributeOverridePreview ? (
              <div className="rounded border p-3 space-y-4">
                <div className="grid gap-3 md:grid-cols-5">
                  <div className="rounded border bg-muted/20 p-3">
                    <div className="text-xs text-muted-foreground">Rows</div>
                    <div className="text-xl font-semibold">{Number(attributeOverridePreview.summary?.total_rows || 0)}</div>
                  </div>
                  <div className="rounded border bg-muted/20 p-3">
                    <div className="text-xs text-muted-foreground">Clients Sheet</div>
                    <div className="text-xl font-semibold">{Number(attributeOverridePreview.summary?.client_rows || 0)}</div>
                  </div>
                  <div className="rounded border bg-muted/20 p-3">
                    <div className="text-xs text-muted-foreground">Jobs Sheet</div>
                    <div className="text-xl font-semibold">{Number(attributeOverridePreview.summary?.job_rows || 0)}</div>
                  </div>
                  <div className="rounded border bg-muted/20 p-3">
                    <div className="text-xs text-muted-foreground">Ready</div>
                    <div className="text-xl font-semibold">{attributeReadyRows.length}</div>
                  </div>
                  <div className="rounded border bg-muted/20 p-3">
                    <div className="text-xs text-muted-foreground">Blocked / Unchanged</div>
                    <div className="text-xl font-semibold">{attributeBlockedRows.length + attributeSkippedRows.length}</div>
                  </div>
                </div>

                {Array.isArray(attributeOverridePreview.warnings) && attributeOverridePreview.warnings.length > 0 ? (
                  <div>
                    <div className="mb-1 text-sm font-medium">Workbook Warnings</div>
                    <div className="rounded border p-2 text-xs text-muted-foreground">
                      {attributeOverridePreview.warnings.join(" | ")}
                    </div>
                  </div>
                ) : null}

                {attributeReadyRows.length > 0 ? (
                  <div>
                    <div className="mb-2 text-sm font-medium">Ready Rows</div>
                    <div className="max-h-72 overflow-auto rounded border">
                      <table className="w-full text-xs">
                        <thead className="bg-muted sticky top-0">
                          <tr>
                            <th className="p-2 text-left">Entity</th>
                            <th className="p-2 text-left">Row</th>
                            <th className="p-2 text-left">Matched Record</th>
                            <th className="p-2 text-left">Changes</th>
                            <th className="p-2 text-left">Warnings</th>
                          </tr>
                        </thead>
                        <tbody>
                          {attributeReadyRows.slice(0, 100).map((row, idx) => (
                            <tr key={`override-ready-${idx}`} className="border-t align-top">
                              <td className="p-2">{row.entity}</td>
                              <td className="p-2">{row.row_number}</td>
                              <td className="p-2">
                                {row.matched_label || "-"}
                                <div className="text-[11px] text-muted-foreground">{row.match_key}: {row.match_value || "-"}</div>
                              </td>
                              <td className="p-2 whitespace-normal break-words">
                                {(row.changes || []).map((change) => `${change.field}: ${change.from_value || "-"} -> ${change.to_value || "-"}`).join(" | ") || "-"}
                              </td>
                              <td className="p-2 whitespace-normal break-words text-muted-foreground">
                                {(row.warnings || []).join(" | ") || "-"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {attributeReadyRows.length > 100 ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Showing first 100 of {attributeReadyRows.length} ready rows.
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {attributeBlockedRows.length > 0 || attributeSkippedRows.length > 0 ? (
                  <div>
                    <div className="mb-2 text-sm font-medium">Blocked / Unchanged Rows</div>
                    <div className="max-h-72 overflow-auto rounded border">
                      <table className="w-full text-xs">
                        <thead className="bg-muted sticky top-0">
                          <tr>
                            <th className="p-2 text-left">Status</th>
                            <th className="p-2 text-left">Entity</th>
                            <th className="p-2 text-left">Row</th>
                            <th className="p-2 text-left">Matched Record</th>
                            <th className="p-2 text-left">Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...attributeBlockedRows, ...attributeSkippedRows].slice(0, 100).map((row, idx) => (
                            <tr key={`override-blocked-${idx}`} className="border-t align-top">
                              <td className="p-2 uppercase">{row.status || "-"}</td>
                              <td className="p-2">{row.entity}</td>
                              <td className="p-2">{row.row_number}</td>
                              <td className="p-2">{row.matched_label || row.match_value || "-"}</td>
                              <td className="p-2 whitespace-normal break-words text-muted-foreground">
                                {(row.warnings || []).join(" | ") || "No effective changes"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {attributeBlockedRows.length + attributeSkippedRows.length > 100 ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Showing first 100 of {attributeBlockedRows.length + attributeSkippedRows.length} blocked or unchanged rows.
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {attributeOverrideCommitResult ? (
              <div className="rounded border bg-muted/20 p-3 text-sm">
                Applied <strong>{Number(attributeOverrideCommitResult.applied_changes || 0)}</strong> field changes across{" "}
                <strong>{Number(attributeOverrideCommitResult.applied_rows || 0)}</strong> matched rows
                {attributeOverrideCommitResult.run_id ? ` (run ${attributeOverrideCommitResult.run_id})` : ""}.
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Field Mapping (WFM to NZI)</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded border bg-muted/30 p-3 text-xs text-muted-foreground">
              This mapping is <strong>global field mapping</strong>, not per-client mapping.
              Each row maps a <strong>WFM field name</strong> (for example a custom field label) to an NZI target
              (for example <code>job.report_from</code> or <code>client.turnover</code>).
            </div>
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
            <div className="flex flex-wrap gap-2">
              <select
                className="h-10 rounded border bg-background px-3 text-sm"
                value={catalogFile}
                onChange={(e) => {
                  setCatalogFile(e.target.value);
                  void loadCatalog(catalogQuery, e.target.value);
                }}
              >
                <option value="custom_fields.csv">custom_fields.csv (Recommended)</option>
                <option value="">All files</option>
                <option value="job_custom_field_values.csv">job_custom_field_values.csv</option>
                <option value="client_custom_field_values.csv">client_custom_field_values.csv</option>
                <option value="jobs.csv">jobs.csv</option>
                <option value="clients.csv">clients.csv</option>
              </select>
              <Input value={catalogQuery} onChange={(e) => setCatalogQuery(e.target.value)} placeholder="Search fields/files/sample values" />
              <Button variant="outline" onClick={() => void loadCatalog(catalogQuery, catalogFile)}>Search</Button>
            </div>
            <div className="max-h-[420px] overflow-y-auto overflow-x-hidden rounded border">
              <table className="w-full table-fixed text-xs">
                <colgroup>
                  <col className="w-[10%]" />
                  <col className="w-[14%]" />
                  <col className="w-[28%]" />
                  <col className="w-[16%]" />
                  <col className="w-[12%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                </colgroup>
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
                      <td className="p-2 align-top break-words">{item.file_name}</td>
                      <td className="p-2 align-top font-medium break-words">{item.field_name}</td>
                      <td className="p-2 align-top whitespace-normal break-words" title={item.sample_values || ""}>
                        {item.sample_values || "-"}
                      </td>
                      <td className="p-2">
                        {item.suggested_entity && item.suggested_target ? `${item.suggested_entity}.${item.suggested_target}` : "-"}
                      </td>
                      <td className="p-2 text-[11px] align-top whitespace-normal break-words">
                        {item.suggestion_score != null ? (
                          <div>
                            <div>Score: {Number(item.suggestion_score).toFixed(1)}</div>
                            <div className="text-muted-foreground">{item.suggestion_reason || ""}</div>
                          </div>
                        ) : "-"}
                      </td>
                      <td className="p-2 align-top whitespace-normal break-words">
                        {item.target_entity && item.target_field
                          ? `${item.target_entity}.${item.target_field}${item.is_active === false ? " (inactive)" : ""}`
                          : "-"}
                      </td>
                      <td className="p-2 align-top">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!item.suggested_target}
                          onClick={() => void mapField(item)}
                        >
                          Map Suggested
                        </Button>
                        <div className="mt-2">
                          <Button size="sm" onClick={() => openMappingEditor(item)}>Edit Map</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {catalog.length === 0 ? (
                    <tr>
                      <td className="p-3 text-muted-foreground" colSpan={7}>No catalog rows yet. Run &quot;Scan All WFM Fields&quot;.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {editingItem ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-2xl rounded-lg border bg-background p-4 shadow-xl">
              {(() => {
                const key = `${editingItem.file_name}::${editingItem.field_name}`;
                const edit = mappingEdits[key];
                const selectedEntity = normalizeEntity(edit?.target_entity || "job");
                const optionsFromApi = mappingTargets.targets?.[selectedEntity] || [];
                const optionsFromMapping = Object.keys(mapping?.mappings?.[selectedEntity] || {});
                const optionsFromDefaults = DEFAULT_TARGET_FIELDS[selectedEntity] || [];
                const targetFieldOptions = Array.from(
                  new Set([
                    ...optionsFromApi,
                    ...optionsFromMapping,
                    ...optionsFromDefaults,
                  ].map((x) => String(x || "").trim()).filter(Boolean))
                ).sort((a, b) => a.localeCompare(b));
                return (
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-base font-semibold">Edit Mapping</div>
                        <div className="text-xs text-muted-foreground">{editingItem.file_name} :: {editingItem.field_name}</div>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => setEditingItem(null)}>Close</Button>
                    </div>

                    <div className="rounded border bg-muted/30 p-2 text-xs">
                      <div><strong>Sample:</strong> {editingItem.sample_values || "-"}</div>
                      <div><strong>Suggested:</strong> {editingItem.suggested_entity && editingItem.suggested_target ? `${editingItem.suggested_entity}.${editingItem.suggested_target}` : "-"}</div>
                    </div>

                    <div className="grid gap-2 md:grid-cols-2">
                      <input
                        className="h-9 rounded border px-2 bg-muted text-muted-foreground"
                        value={`source: ${edit?.source_entity || "job"}`}
                        readOnly
                        title="Source entity (derived from the WFM file/field)"
                      />
                      <select
                        className="h-9 rounded border px-2"
                        value={selectedEntity}
                        onChange={(e) =>
                          updateEdit(key, {
                            target_entity: normalizeEntity(e.target.value),
                            target_field: "",
                          })
                        }
                        title="Target entity"
                      >
                        <option value="job">job</option>
                        <option value="client">client</option>
                      </select>
                      <select
                        className="h-9 rounded border px-2 md:col-span-2"
                        value={edit?.target_field || ""}
                        onChange={(e) => updateEdit(key, { target_field: e.target.value })}
                      >
                        <option value="">target field...</option>
                        {targetFieldOptions.map((tf) => (
                          <option key={tf} value={tf}>{tf}</option>
                        ))}
                      </select>
                      <input
                        className="h-9 rounded border px-2"
                        value={String(edit?.priority ?? 10)}
                        onChange={(e) => updateEdit(key, { priority: Number(e.target.value || 10) })}
                        placeholder="priority"
                      />
                      <input
                        className="h-9 rounded border px-2"
                        value={edit?.notes || ""}
                        onChange={(e) => updateEdit(key, { notes: e.target.value })}
                        placeholder="notes"
                      />
                    </div>

                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!edit?.is_active}
                        onChange={(e) => updateEdit(key, { is_active: e.target.checked })}
                      />
                      Active mapping
                    </label>

                    <div className="flex items-center justify-end gap-2">
                      <Button variant="outline" onClick={() => setEditingItem(null)}>Cancel</Button>
                      <Button
                        onClick={async () => {
                          const ok = await saveManualMap(editingItem);
                          if (ok) setEditingItem(null);
                        }}
                      >
                        Save Map
                      </Button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
