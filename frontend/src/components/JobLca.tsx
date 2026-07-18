"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import UploadProgressBar from "@/components/UploadProgressBar";
import { uploadFormDataWithProgress } from "@/lib/upload-with-progress";
import { formatJobFamilyLabel, getJobFamilyDescription, jobFamilyBadgeClassName } from "@/lib/job-family";

type JobLcaProps = {
  jobId: number;
  baseUrl: string;
  jobFamily?: string | null;
};

type Assessment = {
  assessment_id: number;
  name: string;
  sku?: string | null;
  assessment_type: string;
  functional_unit_value: number;
  functional_unit_unit: string;
  lifecycle_boundary: string;
  standard: string;
  review_status: string;
  total_tco2e: number;
  last_calculated_at?: string | null;
};

type AssessmentDetail = Assessment & {
  job_id: number;
  client_db_id: number | null;
  description?: string | null;
  confirmed_quantity?: number | null;
  confirmed_quantity_unit?: string;
  included_modules: string[];
  reference_year?: number | null;
  geography?: string | null;
  assumptions?: string | null;
  data_sources_note?: string | null;
};

type LcaModule = {
  module_code: string;
  label: string;
  description?: string | null;
  module_group: string;
  default_in_pcf: boolean;
  default_in_lca: boolean;
};

type MaterialCategory = { category_id: number; name: string };

type DatasetOption = {
  dataset_id: number;
  name: string;
  analysis_type?: string;
  country?: string;
  year?: number | null;
  version?: string;
};

type LineItem = {
  line_item_id: number;
  component_id?: number | null;
  module_code: string;
  line_label: string;
  material_category_id?: number | null;
  quantity: number;
  unit?: string | null;
  origin_country?: string | null;
  factor_value: number;
  factor_unit?: string | null;
  data_quality?: string;
  is_gap_filled?: boolean;
  is_placeholder?: boolean;
};

type Summary = {
  total_tco2e: number;
  module_breakdown: Array<{ module_code: string; emissions_tco2e: number; share_pct: number }>;
  category_breakdown: Array<{ material_category_id: number; mass_kg: number; emissions_tco2e: number; share_pct: number }>;
  hotspots: Array<{ line_item_id: number; module_code: string; line_label: string; emissions_tco2e: number; is_gap_filled: boolean }>;
  mass_reconciliation: {
    confirmed_quantity: number | null;
    confirmed_quantity_unit: string;
    captured_mass_kg: number;
    mass_gap_kg: number | null;
  };
  items_count: number;
  placeholder_count: number;
  gap_filled_count: number;
};

type ReportPayload = {
  goal_scope: {
    name: string;
    lifecycle_boundary: string;
    functional_unit: string;
    review_status: string;
  };
  inventory_analysis: { rows_count: number; placeholder_rows: number };
  impact_assessment: { total_tco2e: number };
  data_quality: { gap_filled_pct: number; primary_data_rows: number };
};

type LcaComponent = {
  component_id: number;
  client_db_id: number | null;
  component_code?: string | null;
  description: string;
  material_category_id?: number | null;
  default_unit_mass?: number | null;
  default_unit: string;
  origin_country?: string | null;
  archived: boolean;
};

type WorkflowStageKey = "goal-scope" | "inventory" | "factor-mapping" | "gap-filling" | "impact" | "reporting";

const LIFECYCLE_BOUNDARIES = [
  { value: "cradle_to_gate", label: "Cradle to gate (A1-A3)" },
  { value: "cradle_to_grave", label: "Cradle to grave (full lifecycle)" },
  { value: "custom", label: "Custom module selection" },
];

export default function JobLca({ jobId, baseUrl, jobFamily }: JobLcaProps) {
  const effectiveFamily = jobFamily === "pcf" ? "pcf" : "lca";
  const familyLabel = formatJobFamilyLabel(effectiveFamily);
  const familyDescription = getJobFamilyDescription(effectiveFamily);
  const familyBadgeClass = jobFamilyBadgeClassName(effectiveFamily);

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<string>("");
  const [assessment, setAssessment] = useState<AssessmentDetail | null>(null);
  const [modules, setModules] = useState<LcaModule[]>([]);
  const [categories, setCategories] = useState<MaterialCategory[]>([]);
  const [items, setItems] = useState<LineItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [report, setReport] = useState<ReportPayload | null>(null);

  const [lcaDatasets, setLcaDatasets] = useState<DatasetOption[]>([]);
  const [selectedDatasetIds, setSelectedDatasetIds] = useState<number[]>([]);
  const [inheritedDatasetIds, setInheritedDatasetIds] = useState<number[]>([]);

  // Goal & scope form (new assessment / edits to selected assessment)
  const [newName, setNewName] = useState("");
  const [newSku, setNewSku] = useState("");
  const [newBoundary, setNewBoundary] = useState<string>(effectiveFamily === "pcf" ? "cradle_to_gate" : "cradle_to_grave");

  // Manual line-item form
  const [lineModule, setLineModule] = useState("A1");
  const [lineLabel, setLineLabel] = useState("");
  const [lineCategory, setLineCategory] = useState<string>("");
  const [lineQty, setLineQty] = useState("1");
  const [lineUnit, setLineUnit] = useState("kg");
  const [lineCountry, setLineCountry] = useState("");
  const [lineFactor, setLineFactor] = useState("");
  const [lineFactorUnit, setLineFactorUnit] = useState("kgCO2e/kg");
  const [lineDataQuality, setLineDataQuality] = useState("secondary");
  const [linePlaceholder, setLinePlaceholder] = useState(false);
  const [lineNotes, setLineNotes] = useState("");

  const [bomFile, setBomFile] = useState<File | null>(null);
  const [bomUploadProgress, setBomUploadProgress] = useState(0);

  const [activeWorkflowStage, setActiveWorkflowStage] = useState<WorkflowStageKey>("goal-scope");
  const [stageLockEnabled, setStageLockEnabled] = useState(false);

  // Add-from-library modal
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryComponents, setLibraryComponents] = useState<LcaComponent[]>([]);
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryModule, setLibraryModule] = useState("A1");
  const [selectedComponentIds, setSelectedComponentIds] = useState<Set<number>>(new Set());
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [showNewComponentForm, setShowNewComponentForm] = useState(false);
  const [newComponentCode, setNewComponentCode] = useState("");
  const [newComponentDescription, setNewComponentDescription] = useState("");
  const [newComponentCategory, setNewComponentCategory] = useState("");
  const [newComponentMass, setNewComponentMass] = useState("");
  const [newComponentUnit, setNewComponentUnit] = useState("kg");
  const [newComponentCountry, setNewComponentCountry] = useState("");
  const [newComponentSupplier, setNewComponentSupplier] = useState("");

  async function apiFetch(path: string, init?: RequestInit) {
    return fetch(`${baseUrl}${path}`, { credentials: "include", ...init });
  }

  async function loadAssessments() {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/jobs/${jobId}/lca/overview`);
      if (!res.ok) throw new Error(`Failed to load LCA overview (${res.status})`);
      const json = await res.json();
      const list = Array.isArray(json?.assessments) ? json.assessments : [];
      setAssessments(list);
      if (!selectedAssessmentId && list.length > 0) setSelectedAssessmentId(String(list[0].assessment_id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadAssessmentDetail(assessmentId: string) {
    if (!assessmentId) {
      setAssessment(null);
      return;
    }
    try {
      const res = await apiFetch(`/jobs/${jobId}/lca/assessments/${assessmentId}`);
      if (!res.ok) return;
      setAssessment(await res.json());
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function loadItems(assessmentId: string) {
    if (!assessmentId) {
      setItems([]);
      setSummary(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/jobs/${jobId}/lca/assessments/${assessmentId}/line-items`);
      if (!res.ok) throw new Error(`Failed to load line items (${res.status})`);
      const json = await res.json();
      setItems(Array.isArray(json?.items) ? json.items : []);
      setSummary((json?.summary || null) as Summary | null);
      setSelectedDatasetIds(Array.isArray(json?.selected_dataset_ids) ? json.selected_dataset_ids : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadDatasetSelection(assessmentId: string) {
    if (!assessmentId) {
      setLcaDatasets([]);
      return;
    }
    try {
      const res = await apiFetch(`/jobs/${jobId}/lca/assessments/${assessmentId}/datasets`);
      if (!res.ok) return;
      const json = await res.json();
      setLcaDatasets(Array.isArray(json?.datasets) ? json.datasets : []);
      setInheritedDatasetIds(Array.isArray(json?.inherited_job_dataset_ids) ? json.inherited_job_dataset_ids : []);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function loadModulesAndCategories() {
    try {
      const [modRes, catRes] = await Promise.all([apiFetch("/lca/modules"), apiFetch("/lca/material-categories")]);
      if (modRes.ok) {
        const json = await modRes.json();
        setModules(Array.isArray(json?.items) ? json.items : []);
      }
      if (catRes.ok) {
        const json = await catRes.json();
        setCategories(Array.isArray(json?.items) ? json.items : []);
      }
    } catch {
      // reference data is non-critical; leave lists empty on failure
    }
  }

  useEffect(() => {
    void loadAssessments();
    void loadModulesAndCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadAssessmentDetail(selectedAssessmentId);
    void loadItems(selectedAssessmentId);
    void loadDatasetSelection(selectedAssessmentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAssessmentId]);

  async function createAssessment() {
    if (!newName.trim()) {
      setStatus("Name is required.");
      return;
    }
    setStatus("Creating assessment...");
    setError("");
    try {
      const res = await apiFetch(`/jobs/${jobId}/lca/assessments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          sku: newSku.trim(),
          assessment_type: "product",
          lifecycle_boundary: newBoundary,
          standard: effectiveFamily === "pcf" ? "ISO 14067" : "ISO 14040/14044",
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to create assessment (${res.status})${t ? `: ${t}` : ""}`);
      }
      const json = await res.json();
      await loadAssessments();
      if (json?.assessment_id) setSelectedAssessmentId(String(json.assessment_id));
      setNewName("");
      setNewSku("");
      setStatus("Assessment created.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  async function saveAssessmentField(patch: Record<string, unknown>) {
    if (!selectedAssessmentId) return;
    try {
      const res = await apiFetch(`/jobs/${jobId}/lca/assessments/${selectedAssessmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Save failed (${res.status})${t ? `: ${t}` : ""}`);
      }
      const json = await res.json();
      setSummary(json?.summary || null);
      await loadAssessmentDetail(selectedAssessmentId);
      await loadAssessments();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function saveDatasetSelection() {
    if (!selectedAssessmentId) return;
    setStatus("Saving LCA datasets...");
    try {
      const res = await apiFetch(`/jobs/${jobId}/lca/assessments/${selectedAssessmentId}/datasets`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataset_ids: selectedDatasetIds }),
      });
      if (!res.ok) throw new Error(`Failed to save datasets (${res.status})`);
      await loadItems(selectedAssessmentId);
      setStatus("Datasets saved.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  async function addManualLine() {
    if (!selectedAssessmentId) {
      setStatus("Select or create an assessment first.");
      return;
    }
    if (!lineLabel.trim()) {
      setStatus("Line label is required.");
      return;
    }
    setStatus("Adding line item...");
    try {
      const res = await apiFetch(`/jobs/${jobId}/lca/assessments/${selectedAssessmentId}/line-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          module_code: lineModule,
          line_label: lineLabel.trim(),
          material_category_id: lineCategory || null,
          quantity: Number(lineQty || 0),
          unit: lineUnit.trim() || "kg",
          origin_country: lineCountry.trim(),
          factor_value: Number(lineFactor || 0),
          factor_unit: lineFactorUnit.trim() || "kgCO2e/kg",
          mapped_factor_source: Number(lineFactor || 0) > 0 ? "manual" : null,
          data_quality: lineDataQuality,
          is_placeholder: linePlaceholder,
          notes: lineNotes.trim(),
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to add line item (${res.status})${t ? `: ${t}` : ""}`);
      }
      setLineLabel("");
      setLineQty("1");
      setLineFactor("");
      setLineCountry("");
      setLineNotes("");
      setLinePlaceholder(false);
      await loadItems(selectedAssessmentId);
      await loadAssessments();
      setStatus("Line item added and assessment recalculated.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  async function mapFactor(lineItemId: number) {
    if (!selectedAssessmentId) return;
    setStatus("Mapping emission factor...");
    try {
      const res = await apiFetch(`/jobs/${jobId}/lca/line-items/${lineItemId}/map-factor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply_top_match: true }),
      });
      if (!res.ok) throw new Error(`Failed to map factor (${res.status})`);
      await loadItems(selectedAssessmentId);
      await loadAssessments();
      setStatus("Best-matched factor applied.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  async function gapFill(lineItemId: number) {
    if (!selectedAssessmentId) return;
    setStatus("Running data gap estimation...");
    try {
      const res = await apiFetch(`/jobs/${jobId}/lca/line-items/${lineItemId}/gap-fill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: true }),
      });
      if (!res.ok) throw new Error(`Failed to gap-fill (${res.status})`);
      await loadItems(selectedAssessmentId);
      await loadAssessments();
      setStatus("Gap-filled factor applied.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  async function removeItem(lineItemId: number) {
    if (!selectedAssessmentId) return;
    try {
      const res = await apiFetch(`/jobs/${jobId}/lca/line-items/${lineItemId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Failed to delete item (${res.status})`);
      await loadItems(selectedAssessmentId);
      await loadAssessments();
      setStatus("Line item removed.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  async function generateReport() {
    if (!selectedAssessmentId) {
      setStatus("Select an assessment first.");
      return;
    }
    setStatus("Generating report payload...");
    try {
      const res = await apiFetch(`/jobs/${jobId}/lca/assessments/${selectedAssessmentId}/report`);
      if (!res.ok) throw new Error(`Failed to generate report (${res.status})`);
      setReport(await res.json());
      setStatus("Report payload generated.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  async function importBom() {
    if (!selectedAssessmentId) {
      setStatus("Select an assessment first.");
      return;
    }
    if (!bomFile) {
      setStatus("Choose a BOM CSV/XLSX file first.");
      return;
    }
    setStatus("Importing BOM and auto-mapping factors...");
    setError("");
    setBomUploadProgress(0);
    try {
      const form = new FormData();
      form.append("file", bomFile);
      const res = await uploadFormDataWithProgress(`${baseUrl}/jobs/${jobId}/lca/assessments/${selectedAssessmentId}/bom-upload`, {
        method: "POST",
        credentials: "include",
        body: form,
        onProgress: ({ percent }) => setBomUploadProgress(percent),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to import BOM (${res.status})${t ? `: ${t}` : ""}`);
      }
      const json = await res.json();
      await loadItems(selectedAssessmentId);
      await loadAssessments();
      setBomFile(null);
      setStatus(
        `BOM imported. Inserted ${json?.inserted ?? 0}, mapped ${json?.mapped ?? 0}, gap-filled ${json?.gap_filled ?? 0}, ` +
          `skipped ${json?.skipped ?? 0}, new library components ${json?.components_created ?? 0}.`
      );
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setBomUploadProgress(0);
    }
  }

  async function openLibraryPicker() {
    if (!assessment?.client_db_id) {
      setStatus("This assessment isn't linked to a client yet.");
      return;
    }
    setLibrarySearch("");
    setSelectedComponentIds(new Set());
    setLibraryOpen(true);
    setLibraryLoading(true);
    try {
      const res = await apiFetch(`/clients/${assessment.client_db_id}/lca-components?include_global=true`);
      if (res.ok) {
        const json = await res.json();
        setLibraryComponents(Array.isArray(json?.items) ? json.items : []);
      }
    } finally {
      setLibraryLoading(false);
    }
  }

  const filteredLibraryComponents = useMemo(() => {
    const q = librarySearch.trim().toLowerCase();
    if (!q) return libraryComponents;
    return libraryComponents.filter((c) =>
      [c.component_code, c.description, c.origin_country].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
    );
  }, [libraryComponents, librarySearch]);

  function toggleLibraryComponent(id: number) {
    setSelectedComponentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createLibraryComponent() {
    if (!assessment?.client_db_id) return;
    if (!newComponentDescription.trim()) {
      setStatus("Component description is required.");
      return;
    }
    try {
      const res = await apiFetch(`/clients/${assessment.client_db_id}/lca-components`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          component_code: newComponentCode.trim(),
          description: newComponentDescription.trim(),
          material_category_id: newComponentCategory || null,
          default_unit_mass: newComponentMass ? Number(newComponentMass) : null,
          default_unit: newComponentUnit.trim() || "kg",
          origin_country: newComponentCountry.trim(),
          supplier_name: newComponentSupplier.trim(),
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to create component (${res.status})${t ? `: ${t}` : ""}`);
      }
      const listRes = await apiFetch(`/clients/${assessment.client_db_id}/lca-components?include_global=true`);
      if (listRes.ok) {
        const json = await listRes.json();
        setLibraryComponents(Array.isArray(json?.items) ? json.items : []);
      }
      setNewComponentCode("");
      setNewComponentDescription("");
      setNewComponentCategory("");
      setNewComponentMass("");
      setNewComponentCountry("");
      setNewComponentSupplier("");
      setShowNewComponentForm(false);
      setStatus("Component added to the library.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function addSelectedComponents() {
    if (!selectedAssessmentId || selectedComponentIds.size === 0) return;
    setStatus(`Adding ${selectedComponentIds.size} line(s) from the component library...`);
    try {
      for (const componentId of selectedComponentIds) {
        await apiFetch(`/jobs/${jobId}/lca/assessments/${selectedAssessmentId}/line-items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ component_id: componentId, module_code: libraryModule }),
        });
      }
      setLibraryOpen(false);
      await loadItems(selectedAssessmentId);
      await loadAssessments();
      setStatus("Component(s) added to the assessment.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  const categoryName = (id?: number | null) => categories.find((c) => c.category_id === id)?.name || `Category ${id}`;
  const moduleLabel = (code: string) => modules.find((m) => m.module_code === code)?.label || code;

  const hasRows = items.some((r) => !r.is_placeholder);
  const hasMappedFactors = items.some((r) => Number(r.factor_value || 0) > 0 && !r.is_gap_filled);
  const hasGapFilled = items.some((r) => Boolean(r.is_gap_filled));
  const hasImpactResults = Boolean(summary && summary.items_count >= 0 && (summary.module_breakdown || []).length > 0);

  const workflow: Array<{ key: WorkflowStageKey; title: string; done: boolean }> = [
    { key: "goal-scope", title: "1. Goal & Scope", done: Boolean(selectedAssessmentId) },
    { key: "inventory", title: "2. Inventory", done: hasRows },
    { key: "factor-mapping", title: "3. Factor Mapping", done: hasMappedFactors || items.length === 0 },
    { key: "gap-filling", title: "4. Data Gap Filling", done: hasGapFilled || items.length === 0 },
    { key: "impact", title: "5. Impact Assessment", done: hasImpactResults },
    { key: "reporting", title: "6. Reporting", done: Boolean(report) },
  ];
  const activeIdx = workflow.findIndex((w) => w.key === activeWorkflowStage);
  function isStageUnlocked(idx: number) {
    if (!stageLockEnabled) return true;
    if (idx <= 0) return true;
    for (let i = 0; i < idx; i += 1) if (!workflow[i].done) return false;
    return true;
  }
  const nextIdx = Math.min(activeIdx + 1, workflow.length - 1);
  const nextLocked = !isStageUnlocked(nextIdx);

  if (jobFamily && jobFamily !== "lca" && jobFamily !== "pcf") return null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-2">
          <CardTitle className="tracking-tight" style={{ color: "#EA580C" }}>
            {effectiveFamily === "pcf" ? "Product Carbon Footprint" : "Life Cycle Assessment"}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge className={familyBadgeClass} variant="outline">{familyLabel}</Badge>
            <span>{familyDescription}</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Assessment</Label>
              <Select value={selectedAssessmentId} onValueChange={setSelectedAssessmentId}>
                <SelectTrigger><SelectValue placeholder="Select assessment..." /></SelectTrigger>
                <SelectContent>
                  {assessments.map((a) => (
                    <SelectItem key={a.assessment_id} value={String(a.assessment_id)}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-md border px-3 py-2 text-sm">
              Total: {assessment ? `${Number(assessment.total_tco2e || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })} tCO₂e` : "-"}
            </div>
            <div className="rounded-md border px-3 py-2 text-sm">
              Boundary: {assessment?.lifecycle_boundary?.replace(/_/g, " ") || "-"}
            </div>
          </div>
          {bomFile ? <UploadProgressBar value={bomUploadProgress} label="Uploading BOM..." /> : null}
          <div className="grid gap-2 md:grid-cols-3">
            {workflow.map((w) => (
              <Button
                key={w.key}
                variant={activeWorkflowStage === w.key ? "default" : "outline"}
                className="justify-between"
                disabled={!isStageUnlocked(workflow.findIndex((x) => x.key === w.key))}
                onClick={() => setActiveWorkflowStage(w.key)}
              >
                <span>{w.title}</span>
                <span className="text-xs">{w.done ? "Done" : "Pending"}</span>
              </Button>
            ))}
          </div>
          <div className="flex items-center justify-between rounded-md border px-3 py-2 text-xs text-muted-foreground">
            <span>Stage Lock: {stageLockEnabled ? "Enabled" : "Disabled"}.</span>
            <Button variant="outline" onClick={() => setStageLockEnabled((v) => !v)}>
              {stageLockEnabled ? "Disable Lock" : "Enable Lock"}
            </Button>
          </div>
          {error ? <div className="text-sm text-destructive">{error}</div> : null}
          {status ? <div className="text-sm text-muted-foreground">{status}</div> : null}
          {loading ? <div className="text-xs text-muted-foreground">Loading...</div> : null}
        </CardContent>
      </Card>

      {activeWorkflowStage === "goal-scope" ? (
        <Card>
          <CardHeader><CardTitle>Stage 1: Goal & Scope</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-4">
              <div className="space-y-2 lg:col-span-2">
                <Label>New Assessment Name</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. P50 6L ECO" />
              </div>
              <div className="space-y-2">
                <Label>SKU</Label>
                <Input value={newSku} onChange={(e) => setNewSku(e.target.value)} placeholder="SKU-001" />
              </div>
              <div className="space-y-2">
                <Label>Lifecycle Boundary</Label>
                <Select value={newBoundary} onValueChange={setNewBoundary}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LIFECYCLE_BOUNDARIES.map((b) => (<SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="lg:col-span-4 flex justify-end">
                <Button onClick={createAssessment}>Create Assessment</Button>
              </div>
            </div>

            {assessment ? (
              <div className="space-y-4 rounded-md border p-3">
                <div className="text-sm font-medium">Editing: {assessment.name}</div>
                <div className="grid gap-4 lg:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Confirmed Quantity (mass reconciliation)</Label>
                    <Input
                      type="number"
                      defaultValue={assessment.confirmed_quantity ?? ""}
                      onBlur={(e) => saveAssessmentField({ confirmed_quantity: e.target.value ? Number(e.target.value) : null })}
                      placeholder="e.g. 8.5"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Confirmed Quantity Unit</Label>
                    <Input
                      defaultValue={assessment.confirmed_quantity_unit || "kg"}
                      onBlur={(e) => saveAssessmentField({ confirmed_quantity_unit: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Review Status</Label>
                    <Select value={assessment.review_status} onValueChange={(v) => saveAssessmentField({ review_status: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="in_review">In Review</SelectItem>
                        <SelectItem value="verified">Verified</SelectItem>
                        <SelectItem value="published">Published</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Functional Unit Value</Label>
                    <Input
                      type="number"
                      defaultValue={assessment.functional_unit_value}
                      onBlur={(e) => saveAssessmentField({ functional_unit_value: Number(e.target.value || 1) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Functional Unit</Label>
                    <Input
                      defaultValue={assessment.functional_unit_unit}
                      onBlur={(e) => saveAssessmentField({ functional_unit_unit: e.target.value })}
                      placeholder="unit, kg_product..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Standard</Label>
                    <Input
                      defaultValue={assessment.standard}
                      onBlur={(e) => saveAssessmentField({ standard: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Assumptions</Label>
                    <Textarea
                      defaultValue={assessment.assumptions || ""}
                      onBlur={(e) => saveAssessmentField({ assumptions: e.target.value })}
                      rows={3}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Data Sources Note</Label>
                    <Textarea
                      defaultValue={assessment.data_sources_note || ""}
                      onBlur={(e) => saveAssessmentField({ data_sources_note: e.target.value })}
                      rows={3}
                    />
                  </div>
                </div>
              </div>
            ) : null}

            <div className="space-y-3 rounded-md border p-3">
              <div className="text-sm font-medium">Dataset Selection</div>
              <div className="text-xs text-muted-foreground">
                Select which conversion-factor datasets factor mapping, BOM auto-map, and gap-fill will search.
              </div>
              {selectedAssessmentId ? (
                <>
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {lcaDatasets.map((ds) => {
                      const selected = selectedDatasetIds.includes(ds.dataset_id);
                      return (
                        <button
                          key={ds.dataset_id}
                          type="button"
                          className={`rounded-md border px-3 py-2 text-left text-sm ${selected ? "border-primary bg-primary/5" : ""}`}
                          onClick={() =>
                            setSelectedDatasetIds((prev) =>
                              prev.includes(ds.dataset_id) ? prev.filter((id) => id !== ds.dataset_id) : [...prev, ds.dataset_id]
                            )
                          }
                        >
                          <div className="font-medium">{ds.name || `Dataset ${ds.dataset_id}`}</div>
                          <div className="text-xs text-muted-foreground">
                            {ds.country || "-"}{ds.year ? ` | ${ds.year}` : ""}{ds.analysis_type ? ` | ${ds.analysis_type}` : ""}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs text-muted-foreground">
                      {selectedDatasetIds.length > 0
                        ? `${selectedDatasetIds.length} dataset(s) selected.`
                        : inheritedDatasetIds.length > 0
                          ? `Inheriting ${inheritedDatasetIds.length} job dataset(s).`
                          : "No datasets selected. Searches all datasets."}
                    </div>
                    <Button variant="outline" onClick={saveDatasetSelection}>Save Datasets</Button>
                  </div>
                </>
              ) : (
                <div className="text-xs text-muted-foreground">Create/select an assessment to configure datasets.</div>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {activeWorkflowStage === "inventory" ? (
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Stage 2A: BOM Import</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="text-xs text-muted-foreground">
                Supported columns: item/material/component, quantity/qty/weight, unit/uom, origin_country/country,
                module/stage, component_code/part_code (links or creates a library component), factor/factor_value.
                Rows with zero weight are kept as placeholder/assembly-grouping labels and excluded from the calculation.
              </div>
              <Input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => setBomFile(e.target.files?.[0] ?? null)} />
              <div className="flex justify-end"><Button onClick={importBom}>Import BOM + Auto Map</Button></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Stage 2B: Add from Component Library</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="text-xs text-muted-foreground">
                Reuse components already defined for this client (material, mass, origin, supplier) instead of retyping them.
              </div>
              <Button variant="outline" onClick={() => void openLibraryPicker()}>Browse Component Library</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Stage 2C: Manual Line Item</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-4">
                <div className="space-y-2">
                  <Label>Module</Label>
                  <Select value={lineModule} onValueChange={setLineModule}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {modules.map((m) => (<SelectItem key={m.module_code} value={m.module_code}>{m.module_code} - {m.label}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 lg:col-span-3">
                  <Label>Line Label</Label>
                  <Input value={lineLabel} onChange={(e) => setLineLabel(e.target.value)} placeholder="e.g. Aluminium sheet" />
                </div>
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={lineCategory} onValueChange={setLineCategory}>
                    <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (<SelectItem key={c.category_id} value={String(c.category_id)}>{c.name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Quantity</Label><Input type="number" value={lineQty} onChange={(e) => setLineQty(e.target.value)} /></div>
                <div className="space-y-2"><Label>Unit</Label><Input value={lineUnit} onChange={(e) => setLineUnit(e.target.value)} placeholder="kg, kWh, km..." /></div>
                <div className="space-y-2"><Label>Origin Country</Label><Input value={lineCountry} onChange={(e) => setLineCountry(e.target.value)} /></div>
                <div className="space-y-2"><Label>Factor</Label><Input type="number" value={lineFactor} onChange={(e) => setLineFactor(e.target.value)} placeholder="optional" /></div>
                <div className="space-y-2"><Label>Factor Unit</Label><Input value={lineFactorUnit} onChange={(e) => setLineFactorUnit(e.target.value)} /></div>
                <div className="space-y-2">
                  <Label>Data Quality</Label>
                  <Select value={lineDataQuality} onValueChange={setLineDataQuality}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="primary">Primary</SelectItem>
                      <SelectItem value="secondary">Secondary</SelectItem>
                      <SelectItem value="proxy">Proxy</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={linePlaceholder} onChange={(e) => setLinePlaceholder(e.target.checked)} />
                    No weight yet (placeholder / assembly grouping)
                  </label>
                </div>
                <div className="space-y-2 lg:col-span-2"><Label>Notes</Label><Textarea value={lineNotes} onChange={(e) => setLineNotes(e.target.value)} rows={2} /></div>
              </div>
              <div className="flex justify-end"><Button onClick={addManualLine}>Add Line Item</Button></div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {activeWorkflowStage === "factor-mapping" || activeWorkflowStage === "gap-filling" ? (
        <Card>
          <CardHeader>
            <CardTitle>{activeWorkflowStage === "factor-mapping" ? "Stage 3: Factor Mapping" : "Stage 4: Data Gap Filling"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {items.length === 0 ? (
              <div className="text-sm text-muted-foreground">No line items yet.</div>
            ) : (
              items.map((row) => (
                <div key={row.line_item_id} className={`rounded-md border p-3 ${row.is_placeholder ? "opacity-60" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-medium">
                        {row.line_label} {row.is_placeholder ? <Badge variant="secondary" className="ml-1">Placeholder</Badge> : null}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {moduleLabel(row.module_code)} | {row.material_category_id ? categoryName(row.material_category_id) : "Uncategorized"} |
                        {" "}Qty {Number(row.quantity || 0).toLocaleString()} {row.unit || "-"} |
                        {" "}Factor {Number(row.factor_value || 0).toLocaleString()} {row.factor_unit || ""} |
                        {" "}{row.is_gap_filled ? "Gap-filled" : "Direct/Matched"}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => mapFactor(row.line_item_id)}>Auto Map Factor</Button>
                      <Button variant="outline" onClick={() => gapFill(row.line_item_id)}>Gap Fill</Button>
                      <Button variant="outline" onClick={() => removeItem(row.line_item_id)}>Delete</Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ) : null}

      {activeWorkflowStage === "impact" ? (
        <Card>
          <CardHeader><CardTitle>Stage 5: Impact Assessment</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm">
              Total: <span className="font-semibold">{Number(summary?.total_tco2e || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })} tCO₂e</span>
            </div>
            <div className="rounded-md border p-3">
              <div className="mb-2 text-sm font-medium">Mass Reconciliation</div>
              <div className="grid gap-2 text-sm md:grid-cols-3">
                <div>Confirmed: {summary?.mass_reconciliation.confirmed_quantity ?? "-"} {summary?.mass_reconciliation.confirmed_quantity_unit}</div>
                <div>Captured (A1): {summary?.mass_reconciliation.captured_mass_kg ?? 0} kg</div>
                <div>Gap: {summary?.mass_reconciliation.mass_gap_kg ?? "-"} kg</div>
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-md border p-3">
                <div className="mb-2 text-sm font-medium">By Module</div>
                <div className="space-y-1 text-sm">
                  {(summary?.module_breakdown || []).map((s) => (
                    <div key={s.module_code} className="flex justify-between">
                      <span>{moduleLabel(s.module_code)}</span>
                      <span>{s.emissions_tco2e.toLocaleString(undefined, { maximumFractionDigits: 4 })} tCO₂e ({s.share_pct.toFixed(1)}%)</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="mb-2 text-sm font-medium">By Material Category</div>
                <div className="space-y-1 text-sm">
                  {(summary?.category_breakdown || []).map((s) => (
                    <div key={s.material_category_id} className="flex justify-between">
                      <span>{categoryName(s.material_category_id)}</span>
                      <span>{s.emissions_tco2e.toLocaleString(undefined, { maximumFractionDigits: 4 })} tCO₂e ({s.share_pct.toFixed(1)}%)</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="rounded-md border p-3">
              <div className="mb-2 text-sm font-medium">Hotspot Line Items</div>
              <div className="space-y-1 text-sm">
                {(summary?.hotspots || []).slice(0, 8).map((h) => (
                  <div key={h.line_item_id} className="flex justify-between">
                    <span>{h.line_label}</span>
                    <span>{h.emissions_tco2e.toLocaleString(undefined, { maximumFractionDigits: 4 })} tCO₂e</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {activeWorkflowStage === "reporting" ? (
        <Card>
          <CardHeader><CardTitle>Stage 6: Reporting</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-end">
              <Button variant="outline" onClick={generateReport}>Generate Report Payload</Button>
            </div>
            {report ? (
              <div className="space-y-2 rounded-md border p-3">
                <div className="text-sm">
                  {report?.goal_scope?.name || "-"} | Boundary: {report?.goal_scope?.lifecycle_boundary || "-"} |
                  {" "}Functional Unit: {report?.goal_scope?.functional_unit || "-"} | Status: {report?.goal_scope?.review_status || "-"}
                </div>
                <div className="text-sm">
                  Rows: {report?.inventory_analysis?.rows_count || 0} ({report?.inventory_analysis?.placeholder_rows || 0} placeholder) |
                  {" "}Total GWP: {Number(report?.impact_assessment?.total_tco2e || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })} tCO₂e
                </div>
                <div className="text-xs text-muted-foreground">
                  Data quality: {report?.data_quality?.gap_filled_pct ?? 0}% gap-filled, {report?.data_quality?.primary_data_rows ?? 0} primary rows
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Generate the report payload to review the assessment summary.</div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex items-center justify-between">
        <Button variant="outline" disabled={activeIdx <= 0} onClick={() => setActiveWorkflowStage(workflow[Math.max(activeIdx - 1, 0)].key)}>
          Previous Stage
        </Button>
        <Button disabled={activeIdx >= workflow.length - 1 || nextLocked} onClick={() => setActiveWorkflowStage(workflow[nextIdx].key)}>
          Next Stage
        </Button>
      </div>

      <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add from Component Library</DialogTitle>
            <DialogDescription>Select components to add as line items in the chosen module.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-2 md:grid-cols-2">
              <Input value={librarySearch} onChange={(e) => setLibrarySearch(e.target.value)} placeholder="Search components..." />
              <Select value={libraryModule} onValueChange={setLibraryModule}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {modules.map((m) => (<SelectItem key={m.module_code} value={m.module_code}>{m.module_code} - {m.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setShowNewComponentForm((v) => !v)}>
              {showNewComponentForm ? "Cancel new component" : "+ New Component"}
            </Button>
            {showNewComponentForm ? (
              <div className="grid gap-2 rounded-md border p-3 md:grid-cols-2">
                <Input value={newComponentCode} onChange={(e) => setNewComponentCode(e.target.value)} placeholder="Component code (optional)" />
                <Input value={newComponentDescription} onChange={(e) => setNewComponentDescription(e.target.value)} placeholder="Description *" />
                <Select value={newComponentCategory} onValueChange={setNewComponentCategory}>
                  <SelectTrigger><SelectValue placeholder="Material category" /></SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (<SelectItem key={c.category_id} value={String(c.category_id)}>{c.name}</SelectItem>))}
                  </SelectContent>
                </Select>
                <div className="flex gap-2">
                  <Input type="number" value={newComponentMass} onChange={(e) => setNewComponentMass(e.target.value)} placeholder="Default mass" />
                  <Input value={newComponentUnit} onChange={(e) => setNewComponentUnit(e.target.value)} placeholder="Unit" className="w-20" />
                </div>
                <Input value={newComponentCountry} onChange={(e) => setNewComponentCountry(e.target.value)} placeholder="Origin country" />
                <Input value={newComponentSupplier} onChange={(e) => setNewComponentSupplier(e.target.value)} placeholder="Supplier name" />
                <div className="md:col-span-2 flex justify-end">
                  <Button type="button" size="sm" onClick={() => void createLibraryComponent()}>Save Component</Button>
                </div>
              </div>
            ) : null}
            <div className="max-h-80 overflow-auto rounded-md border">
              {libraryLoading ? (
                <div className="p-4 text-center text-sm text-muted-foreground">Loading...</div>
              ) : filteredLibraryComponents.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">No components found.</div>
              ) : (
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-gray-100">
                    {filteredLibraryComponents.map((c) => (
                      <tr key={c.component_id} className="cursor-pointer hover:bg-gray-50/70" onClick={() => toggleLibraryComponent(c.component_id)}>
                        <td className="w-8 px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={selectedComponentIds.has(c.component_id)}
                            onChange={() => toggleLibraryComponent(c.component_id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-900">{c.description}</div>
                          <div className="text-xs text-slate-500">
                            {c.component_code || "-"} | {c.origin_country || "Origin not set"} | {c.default_unit_mass ?? "-"} {c.default_unit}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLibraryOpen(false)}>Cancel</Button>
            <Button onClick={() => void addSelectedComponents()} disabled={selectedComponentIds.size === 0}>
              Add {selectedComponentIds.size || ""} Line{selectedComponentIds.size === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
