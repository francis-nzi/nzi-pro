"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SearchableStringSelect from "@/components/SearchableStringSelect";
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
  readiness_score?: number | null;
  readiness_breakdown?: ReadinessCheck[];
};

type ReadinessCheck = {
  key: string;
  label: string;
  weight: number;
  sub_score: number;
  points: number;
  detail: string;
};

type Readiness = { score: number; status_label: string; checks: ReadinessCheck[] };

type FactorCandidate = {
  db_id: number;
  label: string;
  uom?: string | null;
  factor: number;
  source?: string | null;
  region?: string | null;
  confidence: number;
};

type FactorSearchResult = {
  db_id: number;
  label: string;
  uom?: string | null;
  factor: number;
  source?: string | null;
  region?: string | null;
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
  activity_id?: number | null;
  module_code: string;
  line_label: string;
  material_category_id?: number | null;
  quantity: number;
  unit?: string | null;
  origin_country?: string | null;
  factor_value: number;
  factor_unit?: string | null;
  mapped_factor_source?: string | null;
  factor_match_confidence?: number | null;
  data_quality?: string;
  is_gap_filled?: boolean;
  is_placeholder?: boolean;
};

type MassReconciliation = {
  confirmed_quantity: number | null;
  confirmed_quantity_unit: string;
  captured_mass_kg: number;
  mass_gap_kg: number | null;
};

type Summary = {
  total_tco2e: number;
  module_breakdown: Array<{ module_code: string; emissions_tco2e: number; share_pct: number }>;
  category_breakdown: Array<{ material_category_id: number; mass_kg: number; emissions_tco2e: number; share_pct: number }>;
  hotspots: Array<{ line_item_id: number; module_code: string; line_label: string; emissions_tco2e: number; is_gap_filled: boolean }>;
  mass_reconciliation: MassReconciliation | null;
  items_count: number;
  placeholder_count: number;
  gap_filled_count: number;
  readiness?: Readiness;
};

type ReportPayload = {
  goal_scope: {
    assessment_type?: string;
    name: string;
    lifecycle_boundary: string;
    functional_unit: string;
    review_status: string;
  };
  inventory_analysis: { rows_count: number; placeholder_rows: number };
  impact_assessment: { total_tco2e: number };
  data_quality: { gap_filled_pct: number; primary_data_rows: number };
  readiness?: Readiness;
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
  is_assembly?: boolean;
  child_count?: number;
  resolved_mass_kg?: number | null;
};

type LcaComponentChild = {
  child_link_id: number;
  parent_component_id: number;
  child_component_id: number | null;
  line_label: string;
  material_category_id?: number | null;
  quantity: number;
  unit: string;
  origin_country?: string | null;
  factor_value?: number | null;
  factor_unit?: string | null;
  data_quality?: string;
  child_is_assembly: boolean;
};

type LcaActivity = {
  activity_id: number;
  client_db_id: number | null;
  activity_code?: string | null;
  description: string;
  default_module_code?: string | null;
  default_quantity?: number | null;
  default_unit: string;
  archived: boolean;
};

type Scenario = {
  scenario_id: number;
  name: string;
  description?: string | null;
  is_baseline: boolean;
  created_at?: string | null;
};

type MultiplierRule = {
  multiplier_id: number;
  module_code: string;
  material_category_id?: number | null;
  component_id?: number | null;
  activity_id?: number | null;
  multiplier: number;
};

type ScenarioComparisonRow = {
  scenario_id: number;
  name: string;
  is_baseline: boolean;
  total_tco2e: number;
  module_breakdown: Array<{ module_code: string; emissions_tco2e: number; share_pct: number }>;
  delta_vs_baseline_tco2e: number | null;
  delta_vs_baseline_pct: number | null;
};

type WorkflowStageKey = "goal-scope" | "inventory" | "factor-mapping" | "gap-filling" | "impact" | "scenarios" | "reporting";

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
  const assessmentDetailSeqRef = useRef(0);
  const itemsSeqRef = useRef(0);
  const [assessment, setAssessment] = useState<AssessmentDetail | null>(null);
  const [modules, setModules] = useState<LcaModule[]>([]);
  const [categories, setCategories] = useState<MaterialCategory[]>([]);
  const [items, setItems] = useState<LineItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [reviewCandidates, setReviewCandidates] = useState<Record<number, FactorCandidate[]>>({});
  const [factorSearchOpen, setFactorSearchOpen] = useState<Record<number, boolean>>({});
  const [factorSearchQuery, setFactorSearchQuery] = useState<Record<number, string>>({});
  const [factorSearchResults, setFactorSearchResults] = useState<Record<number, FactorSearchResult[]>>({});
  const [factorSearchLoading, setFactorSearchLoading] = useState<Record<number, boolean>>({});
  const [editingFactorId, setEditingFactorId] = useState<number | null>(null);
  const [editFactorValue, setEditFactorValue] = useState("");
  const [editFactorUnit, setEditFactorUnit] = useState("");
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(0.45);

  const [lcaDatasets, setLcaDatasets] = useState<DatasetOption[]>([]);
  const [selectedDatasetIds, setSelectedDatasetIds] = useState<number[]>([]);
  const [inheritedDatasetIds, setInheritedDatasetIds] = useState<number[]>([]);

  // Goal & scope form (new assessment / edits to selected assessment)
  const [newName, setNewName] = useState("");
  const [newSku, setNewSku] = useState("");
  const [newBoundary, setNewBoundary] = useState<string>(effectiveFamily === "pcf" ? "cradle_to_gate" : "cradle_to_grave");
  const [newAssessmentType, setNewAssessmentType] = useState<string>("product");
  const [newServiceModules, setNewServiceModules] = useState<Set<string>>(new Set());

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
  const [bomImportResult, setBomImportResult] = useState<{ kind: "success" | "warning" | "error"; message: string } | null>(null);

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

  // Assembly parts editor -- a component with 1+ children becomes a
  // composite/assembly (see LCA_ASSEMBLY_HIERARCHY_SCOPE.md). A child can
  // itself be another assembly, so this reuses the same component picker.
  const [partsComponentId, setPartsComponentId] = useState<number | null>(null);
  const [partsChildren, setPartsChildren] = useState<LcaComponentChild[]>([]);
  const [partsResolvedMass, setPartsResolvedMass] = useState<number | null>(null);
  const [partsLoading, setPartsLoading] = useState(false);
  const [partsError, setPartsError] = useState("");
  const [newPartChildId, setNewPartChildId] = useState("");
  const [newPartLabel, setNewPartLabel] = useState("");
  const [newPartQuantity, setNewPartQuantity] = useState("");
  const [newPartUnit, setNewPartUnit] = useState("kg");
  const [newPartFactor, setNewPartFactor] = useState("");
  const [newPartFactorUnit, setNewPartFactorUnit] = useState("kgCO2e/kg");

  // Add-from-activity-library modal (service assessments -- mirrors the component library above)
  const [libraryActivities, setLibraryActivities] = useState<LcaActivity[]>([]);
  const [selectedActivityIds, setSelectedActivityIds] = useState<Set<number>>(new Set());
  const [showNewActivityForm, setShowNewActivityForm] = useState(false);
  const [newActivityCode, setNewActivityCode] = useState("");
  const [newActivityDescription, setNewActivityDescription] = useState("");
  const [newActivityModule, setNewActivityModule] = useState("");
  const [newActivityQuantity, setNewActivityQuantity] = useState("");
  const [newActivityUnit, setNewActivityUnit] = useState("unit");

  // Scenarios (Phase 3: what-if multiplier engine)
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>("");
  const [multipliers, setMultipliers] = useState<MultiplierRule[]>([]);
  const [comparison, setComparison] = useState<ScenarioComparisonRow[]>([]);
  const [newScenarioName, setNewScenarioName] = useState("");
  const [newScenarioDescription, setNewScenarioDescription] = useState("");
  const [ruleModule, setRuleModule] = useState("A1");
  const [ruleCategory, setRuleCategory] = useState<string>("");
  const [ruleComponent, setRuleComponent] = useState<string>("");
  const [ruleActivity, setRuleActivity] = useState<string>("");
  const [ruleMultiplier, setRuleMultiplier] = useState("1.0");

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
    const seq = ++assessmentDetailSeqRef.current;
    try {
      const res = await apiFetch(`/jobs/${jobId}/lca/assessments/${assessmentId}`);
      if (!res.ok) return;
      const json = await res.json();
      // Several actions (BOM import, add/delete line item, etc.) each trigger
      // their own reload on top of the mount/selection-change effect, so more
      // than one of these can be in flight at once. Drop this response if a
      // newer call has since started -- otherwise a slower, older request can
      // resolve last and silently overwrite fresh state with stale data.
      if (seq !== assessmentDetailSeqRef.current) return;
      setAssessment(json);
    } catch (e) {
      if (seq === assessmentDetailSeqRef.current) setError((e as Error).message);
    }
  }

  async function loadItems(assessmentId: string) {
    if (!assessmentId) {
      setItems([]);
      setSummary(null);
      return;
    }
    const seq = ++itemsSeqRef.current;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/jobs/${jobId}/lca/assessments/${assessmentId}/line-items`);
      if (!res.ok) throw new Error(`Failed to load line items (${res.status})`);
      const json = await res.json();
      if (seq !== itemsSeqRef.current) return; // stale response -- a newer loadItems call has already started
      setItems(Array.isArray(json?.items) ? json.items : []);
      setSummary((json?.summary || null) as Summary | null);
      setSelectedDatasetIds(Array.isArray(json?.selected_dataset_ids) ? json.selected_dataset_ids : []);
    } catch (e) {
      if (seq === itemsSeqRef.current) setError((e as Error).message);
    } finally {
      if (seq === itemsSeqRef.current) setLoading(false);
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

  async function loadScenarios(assessmentId: string) {
    if (!assessmentId) {
      setScenarios([]);
      setSelectedScenarioId("");
      return;
    }
    try {
      const res = await apiFetch(`/jobs/${jobId}/lca/assessments/${assessmentId}/scenarios`);
      if (!res.ok) return;
      const json = await res.json();
      const list: Scenario[] = Array.isArray(json?.items) ? json.items : [];
      setScenarios(list);
      setSelectedScenarioId((prev) => {
        if (prev && list.some((s) => String(s.scenario_id) === prev)) return prev;
        const firstNonBaseline = list.find((s) => !s.is_baseline);
        return firstNonBaseline ? String(firstNonBaseline.scenario_id) : "";
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function loadMultipliers(scenarioId: string) {
    if (!scenarioId) {
      setMultipliers([]);
      return;
    }
    try {
      const res = await apiFetch(`/jobs/${jobId}/lca/scenarios/${scenarioId}/multipliers`);
      if (!res.ok) return;
      const json = await res.json();
      setMultipliers(Array.isArray(json?.items) ? json.items : []);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function loadComparison(assessmentId: string) {
    if (!assessmentId) {
      setComparison([]);
      return;
    }
    try {
      const res = await apiFetch(`/jobs/${jobId}/lca/assessments/${assessmentId}/scenario-comparison`);
      if (!res.ok) return;
      const json = await res.json();
      setComparison(Array.isArray(json?.scenarios) ? json.scenarios : []);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void loadAssessmentDetail(selectedAssessmentId);
    void loadItems(selectedAssessmentId);
    void loadDatasetSelection(selectedAssessmentId);
    void loadScenarios(selectedAssessmentId);
    void loadComparison(selectedAssessmentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAssessmentId]);

  useEffect(() => {
    void loadMultipliers(selectedScenarioId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedScenarioId]);

  useEffect(() => {
    // Reset the manual line-item Module/Category select to a valid default
    // when switching between a product and a service assessment -- "A1" (a
    // product module) isn't a valid choice once the picker's options switch
    // to Scope 3 categories, and vice versa.
    if (assessment?.assessment_type === "service") {
      setLineModule((prev) => (prev.startsWith("S") ? prev : "S1"));
      setLineCategory("");
    } else if (assessment) {
      setLineModule((prev) => (prev.startsWith("S") ? "A1" : prev));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessment?.assessment_type]);

  async function createAssessment() {
    if (!newName.trim()) {
      setStatus("Name is required.");
      return;
    }
    setStatus("Creating assessment...");
    setError("");
    try {
      const isNewService = newAssessmentType === "service";
      const res = await apiFetch(`/jobs/${jobId}/lca/assessments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          sku: newSku.trim(),
          assessment_type: newAssessmentType,
          ...(isNewService
            ? { included_modules: Array.from(newServiceModules), standard: "GHG Protocol Scope 3 Standard" }
            : { lifecycle_boundary: newBoundary, standard: effectiveFamily === "pcf" ? "ISO 14067" : "ISO 14040/14044" }),
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
      setNewServiceModules(new Set());
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
      await loadAssessmentDetail(selectedAssessmentId);
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
      const data = await res.json();
      setConfidenceThreshold(Number(data.confidence_threshold ?? 0.45));
      setReviewCandidates((prev) => {
        const next = { ...prev };
        if (data.auto_applied) {
          delete next[lineItemId];
        } else {
          next[lineItemId] = data.candidates || [];
        }
        return next;
      });
      await loadItems(selectedAssessmentId);
      await loadAssessments();
      await loadAssessmentDetail(selectedAssessmentId);
      setStatus(
        data.auto_applied
          ? "Best-matched factor applied."
          : (data.candidates || []).length
            ? "No confident match found -- pick a candidate below to apply it manually."
            : "No candidate factors found for this line."
      );
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  async function applyCandidate(lineItemId: number, factorDbId: number) {
    if (!selectedAssessmentId) return;
    setStatus("Applying selected factor...");
    try {
      const res = await apiFetch(`/jobs/${jobId}/lca/line-items/${lineItemId}/map-factor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factor_db_id: factorDbId }),
      });
      if (!res.ok) throw new Error(`Failed to apply factor (${res.status})`);
      setReviewCandidates((prev) => {
        const next = { ...prev };
        delete next[lineItemId];
        return next;
      });
      setFactorSearchResults((prev) => {
        const next = { ...prev };
        delete next[lineItemId];
        return next;
      });
      setFactorSearchOpen((prev) => ({ ...prev, [lineItemId]: false }));
      await loadItems(selectedAssessmentId);
      await loadAssessments();
      await loadAssessmentDetail(selectedAssessmentId);
      setStatus("Selected factor applied.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  function toggleFactorSearch(lineItemId: number) {
    setFactorSearchOpen((prev) => ({ ...prev, [lineItemId]: !prev[lineItemId] }));
  }

  async function runFactorSearch(lineItemId: number) {
    const q = (factorSearchQuery[lineItemId] || "").trim();
    setFactorSearchLoading((prev) => ({ ...prev, [lineItemId]: true }));
    try {
      const res = await apiFetch(`/jobs/${jobId}/lca/line-items/${lineItemId}/factor-search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(`Factor search failed (${res.status})`);
      const data = await res.json();
      setFactorSearchResults((prev) => ({ ...prev, [lineItemId]: data.items || [] }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFactorSearchLoading((prev) => ({ ...prev, [lineItemId]: false }));
    }
  }

  function startEditFactor(row: LineItem) {
    setEditingFactorId(row.line_item_id);
    setEditFactorValue(String(row.factor_value ?? 0));
    setEditFactorUnit(row.factor_unit || "kgCO2e/kg");
  }

  async function saveEditFactor(lineItemId: number) {
    if (!selectedAssessmentId) return;
    setStatus("Saving factor...");
    try {
      const res = await apiFetch(`/jobs/${jobId}/lca/line-items/${lineItemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          factor_value: editFactorValue,
          factor_unit: editFactorUnit.trim() || "kgCO2e/kg",
          mapped_factor_source: "manual",
          is_gap_filled: false,
        }),
      });
      if (!res.ok) throw new Error(`Failed to save factor (${res.status})`);
      setEditingFactorId(null);
      await loadItems(selectedAssessmentId);
      await loadAssessments();
      await loadAssessmentDetail(selectedAssessmentId);
      setStatus("Factor updated.");
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
      await loadAssessmentDetail(selectedAssessmentId);
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
      await loadAssessmentDetail(selectedAssessmentId);
      setStatus("Line item removed.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  async function createScenario() {
    if (!selectedAssessmentId) return;
    if (!newScenarioName.trim()) {
      setStatus("Scenario name is required.");
      return;
    }
    setStatus("Creating scenario...");
    try {
      const res = await apiFetch(`/jobs/${jobId}/lca/assessments/${selectedAssessmentId}/scenarios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newScenarioName.trim(), description: newScenarioDescription.trim() }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to create scenario (${res.status})${t ? `: ${t}` : ""}`);
      }
      const json = await res.json();
      setNewScenarioName("");
      setNewScenarioDescription("");
      await loadScenarios(selectedAssessmentId);
      await loadComparison(selectedAssessmentId);
      if (json?.scenario_id) setSelectedScenarioId(String(json.scenario_id));
      setStatus("Scenario created.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  async function deleteScenario(scenarioId: number) {
    if (!selectedAssessmentId) return;
    try {
      const res = await apiFetch(`/jobs/${jobId}/lca/scenarios/${scenarioId}`, { method: "DELETE" });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to delete scenario (${res.status})${t ? `: ${t}` : ""}`);
      }
      await loadScenarios(selectedAssessmentId);
      await loadComparison(selectedAssessmentId);
      setStatus("Scenario deleted.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  async function addMultiplierRule() {
    if (!selectedScenarioId) {
      setStatus("Select a scenario first.");
      return;
    }
    setStatus("Adding multiplier rule...");
    try {
      const res = await apiFetch(`/jobs/${jobId}/lca/scenarios/${selectedScenarioId}/multipliers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          module_code: ruleModule,
          material_category_id: ruleCategory || null,
          component_id: ruleComponent || null,
          activity_id: ruleActivity || null,
          multiplier: Number(ruleMultiplier || 1),
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to add multiplier rule (${res.status})${t ? `: ${t}` : ""}`);
      }
      setRuleCategory("");
      setRuleComponent("");
      setRuleActivity("");
      setRuleMultiplier("1.0");
      await loadMultipliers(selectedScenarioId);
      await loadComparison(selectedAssessmentId);
      setStatus("Multiplier rule added.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  async function deleteMultiplierRule(multiplierId: number) {
    try {
      const res = await apiFetch(`/jobs/${jobId}/lca/multipliers/${multiplierId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Failed to delete multiplier rule (${res.status})`);
      await loadMultipliers(selectedScenarioId);
      await loadComparison(selectedAssessmentId);
      setStatus("Multiplier rule removed.");
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

  async function downloadBomTemplate() {
    if (!selectedAssessmentId) {
      setStatus("Select an assessment first.");
      return;
    }
    setError("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/lca/assessments/${selectedAssessmentId}/bom-template`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Template download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const xFilename = res.headers.get("x-filename");
      const disposition = res.headers.get("content-disposition") || "";
      const cdMatch = disposition.match(/filename="?([^"]+)"?/i);
      link.download = xFilename || cdMatch?.[1] || `lca-bom-template-${selectedAssessmentId}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function importBom() {
    if (!selectedAssessmentId) {
      setBomImportResult({ kind: "error", message: "Select an assessment first." });
      return;
    }
    if (!bomFile) {
      setBomImportResult({ kind: "error", message: "Choose a BOM CSV/XLSX file first." });
      return;
    }
    setBomImportResult(null);
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
      await loadAssessmentDetail(selectedAssessmentId);
      setBomFile(null);
      const inserted = json?.inserted ?? 0;
      const skipped = json?.skipped ?? 0;
      const summary =
        `Inserted ${inserted}, mapped ${json?.mapped ?? 0}, gap-filled ${json?.gap_filled ?? 0}, ` +
        `needs review ${json?.needs_review ?? 0}, skipped ${skipped}, new library components ${json?.components_created ?? 0}.`;
      setBomImportResult({
        kind: inserted === 0 ? "error" : skipped > 0 ? "warning" : "success",
        message:
          inserted === 0
            ? `Nothing was imported -- every row was skipped. Check that your file has a header row with recognisable column names (item_name, quantity, etc). ${summary}`
            : summary,
      });
    } catch (e) {
      setBomImportResult({ kind: "error", message: (e as Error).message });
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
    setSelectedActivityIds(new Set());
    setLibraryModule((prev) => (isService ? (prev.startsWith("S") ? prev : "S1") : (prev.startsWith("S") ? "A1" : prev)));
    setLibraryOpen(true);
    setLibraryLoading(true);
    try {
      const path = isService ? "lca-activities" : "lca-components";
      const res = await apiFetch(`/clients/${assessment.client_db_id}/${path}?include_global=true`);
      if (res.ok) {
        const json = await res.json();
        if (isService) setLibraryActivities(Array.isArray(json?.items) ? json.items : []);
        else setLibraryComponents(Array.isArray(json?.items) ? json.items : []);
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

  async function loadPartsEditor(componentId: number) {
    if (!assessment?.client_db_id) return;
    setPartsLoading(true);
    setPartsError("");
    try {
      const res = await apiFetch(`/clients/${assessment.client_db_id}/lca-components/${componentId}/children`);
      if (res.ok) {
        const json = await res.json();
        setPartsChildren(Array.isArray(json?.items) ? json.items : []);
        setPartsResolvedMass(json?.resolved_mass_kg ?? null);
      }
    } finally {
      setPartsLoading(false);
    }
  }

  function openPartsEditor(componentId: number) {
    setPartsComponentId(componentId);
    setNewPartChildId("");
    setNewPartLabel("");
    setNewPartQuantity("");
    setNewPartUnit("kg");
    setNewPartFactor("");
    setNewPartFactorUnit("kgCO2e/kg");
    void loadPartsEditor(componentId);
  }

  async function refreshLibraryComponentsList() {
    if (!assessment?.client_db_id) return;
    const listRes = await apiFetch(`/clients/${assessment.client_db_id}/lca-components?include_global=true`);
    if (listRes.ok) {
      const json = await listRes.json();
      setLibraryComponents(Array.isArray(json?.items) ? json.items : []);
    }
  }

  async function addPart() {
    if (!assessment?.client_db_id || !partsComponentId) return;
    if (!newPartChildId && !newPartLabel.trim()) {
      setPartsError("Pick a library component or enter a label for this part.");
      return;
    }
    setPartsError("");
    try {
      const res = await apiFetch(`/clients/${assessment.client_db_id}/lca-components/${partsComponentId}/children`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          child_component_id: newPartChildId ? Number(newPartChildId) : null,
          line_label: newPartLabel.trim(),
          quantity: Number(newPartQuantity || 0),
          unit: newPartUnit.trim() || "kg",
          factor_value: newPartFactor ? Number(newPartFactor) : null,
          factor_unit: newPartFactorUnit.trim() || "kgCO2e/kg",
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to add part (${res.status})${t ? `: ${t}` : ""}`);
      }
      setNewPartChildId("");
      setNewPartLabel("");
      setNewPartQuantity("");
      setNewPartFactor("");
      await loadPartsEditor(partsComponentId);
      await refreshLibraryComponentsList();
    } catch (e) {
      setPartsError((e as Error).message);
    }
  }

  async function deletePart(childLinkId: number) {
    if (!assessment?.client_db_id || !partsComponentId) return;
    if (!window.confirm("Remove this part from the assembly?")) return;
    try {
      await apiFetch(`/clients/${assessment.client_db_id}/lca-components/${partsComponentId}/children/${childLinkId}`, {
        method: "DELETE",
      });
      await loadPartsEditor(partsComponentId);
      await refreshLibraryComponentsList();
    } catch (e) {
      setPartsError((e as Error).message);
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
      await loadAssessmentDetail(selectedAssessmentId);
      setStatus("Component(s) added to the assessment.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  const filteredLibraryActivities = useMemo(() => {
    const q = librarySearch.trim().toLowerCase();
    if (!q) return libraryActivities;
    return libraryActivities.filter((a) =>
      [a.activity_code, a.description].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
    );
  }, [libraryActivities, librarySearch]);

  function toggleLibraryActivity(id: number) {
    setSelectedActivityIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createLibraryActivity() {
    if (!assessment?.client_db_id) return;
    if (!newActivityDescription.trim()) {
      setStatus("Activity description is required.");
      return;
    }
    try {
      const res = await apiFetch(`/clients/${assessment.client_db_id}/lca-activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activity_code: newActivityCode.trim(),
          description: newActivityDescription.trim(),
          default_module_code: newActivityModule || null,
          default_quantity: newActivityQuantity ? Number(newActivityQuantity) : null,
          default_unit: newActivityUnit.trim() || "unit",
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to create activity (${res.status})${t ? `: ${t}` : ""}`);
      }
      const listRes = await apiFetch(`/clients/${assessment.client_db_id}/lca-activities?include_global=true`);
      if (listRes.ok) {
        const json = await listRes.json();
        setLibraryActivities(Array.isArray(json?.items) ? json.items : []);
      }
      setNewActivityCode("");
      setNewActivityDescription("");
      setNewActivityModule("");
      setNewActivityQuantity("");
      setShowNewActivityForm(false);
      setStatus("Activity added to the library.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function addSelectedActivities() {
    if (!selectedAssessmentId || selectedActivityIds.size === 0) return;
    setStatus(`Adding ${selectedActivityIds.size} line(s) from the activity library...`);
    try {
      for (const activityId of selectedActivityIds) {
        await apiFetch(`/jobs/${jobId}/lca/assessments/${selectedAssessmentId}/line-items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ activity_id: activityId, module_code: libraryModule }),
        });
      }
      setLibraryOpen(false);
      await loadItems(selectedAssessmentId);
      await loadAssessments();
      await loadAssessmentDetail(selectedAssessmentId);
      setStatus("Activity/activities added to the assessment.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  const categoryName = (id?: number | null) => categories.find((c) => c.category_id === id)?.name || `Category ${id}`;
  const categoryNames = useMemo(() => categories.map((c) => c.name), [categories]);

  async function resolveOrCreateCategory(name: string): Promise<MaterialCategory | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = categories.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing;
    try {
      const res = await apiFetch("/lca/material-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.category_id) return null;
      const created: MaterialCategory = { category_id: d.category_id, name: d.name || trimmed };
      setCategories((prev) => (prev.some((c) => c.category_id === created.category_id) ? prev : [...prev, created].sort((a, b) => a.name.localeCompare(b.name))));
      return created;
    } catch {
      return null;
    }
  }

  const moduleLabel = (code: string) => modules.find((m) => m.module_code === code)?.label || code;
  const isService = assessment?.assessment_type === "service";
  const serviceModules = useMemo(() => modules.filter((m) => m.module_group === "scope3"), [modules]);
  function readinessStatusLabel(score: number) {
    if (score < 40) return "Draft -- significant gaps";
    if (score < 70) return "Developing";
    if (score < 90) return "Good -- minor gaps";
    return "Verified-ready";
  }

  const selectedScenario = scenarios.find((s) => String(s.scenario_id) === selectedScenarioId) || null;
  const assessmentComponents = useMemo(() => {
    const seen = new Map<number, string>();
    for (const row of items) {
      if (row.component_id && !seen.has(row.component_id)) seen.set(row.component_id, row.line_label);
    }
    return Array.from(seen.entries()).map(([component_id, label]) => ({ component_id, label }));
  }, [items]);
  const componentLabel = (id: number) => assessmentComponents.find((c) => c.component_id === id)?.label || `Component ${id}`;
  const assessmentActivities = useMemo(() => {
    const seen = new Map<number, string>();
    for (const row of items) {
      if (row.activity_id && !seen.has(row.activity_id)) seen.set(row.activity_id, row.line_label);
    }
    return Array.from(seen.entries()).map(([activity_id, label]) => ({ activity_id, label }));
  }, [items]);
  const activityLabel = (id: number) => assessmentActivities.find((a) => a.activity_id === id)?.label || `Activity ${id}`;

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
    { key: "scenarios", title: "6. Scenarios", done: scenarios.some((s) => !s.is_baseline) },
    { key: "reporting", title: "7. Reporting", done: Boolean(report) },
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
          {assessment && typeof assessment.readiness_score === "number" ? (
            <div className="rounded-md border p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-medium">Readiness (advisory -- does not gate review status)</div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold">{assessment.readiness_score.toFixed(0)}/100</span>
                  <Badge variant="outline">{readinessStatusLabel(assessment.readiness_score)}</Badge>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-5">
                {(assessment.readiness_breakdown || []).map((c) => (
                  <div key={c.key} className="space-y-1" title={c.detail}>
                    <div className="text-xs text-muted-foreground">{c.label}</div>
                    <div className="h-1.5 w-full rounded-full bg-muted">
                      <div
                        className="h-1.5 rounded-full bg-primary"
                        style={{ width: `${Math.round(c.sub_score * 100)}%` }}
                      />
                    </div>
                    <div className="text-xs">{Math.round(c.sub_score * 100)}%</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
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
                <Label>Assessment Type</Label>
                <Select value={newAssessmentType} onValueChange={setNewAssessmentType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="product">Product (material x mass)</SelectItem>
                    <SelectItem value="service">Service (activity x quantity, Scope 3)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {newAssessmentType === "service" ? (
                <div className="space-y-2 lg:col-span-4">
                  <Label>Scope 3 Categories In Scope</Label>
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {serviceModules.map((m) => {
                      const checked = newServiceModules.has(m.module_code);
                      return (
                        <button
                          key={m.module_code}
                          type="button"
                          className={`rounded-md border px-3 py-2 text-left text-xs ${checked ? "border-primary bg-primary/5" : ""}`}
                          onClick={() =>
                            setNewServiceModules((prev) => {
                              const next = new Set(prev);
                              if (next.has(m.module_code)) next.delete(m.module_code);
                              else next.add(m.module_code);
                              return next;
                            })
                          }
                        >
                          {m.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Lifecycle Boundary</Label>
                  <Select value={newBoundary} onValueChange={setNewBoundary}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LIFECYCLE_BOUNDARIES.map((b) => (<SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
              )}
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
                {isService ? (
                  <div className="space-y-2">
                    <Label>Scope 3 Categories In Scope</Label>
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {serviceModules.map((m) => {
                        const checked = assessment.included_modules.includes(m.module_code);
                        return (
                          <button
                            key={m.module_code}
                            type="button"
                            className={`rounded-md border px-3 py-2 text-left text-xs ${checked ? "border-primary bg-primary/5" : ""}`}
                            onClick={() => {
                              const next = checked
                                ? assessment.included_modules.filter((c) => c !== m.module_code)
                                : [...assessment.included_modules, m.module_code];
                              saveAssessmentField({ included_modules: next });
                            }}
                          >
                            {m.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
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
          {!isService ? (
            <Card>
              <CardHeader><CardTitle>Stage 2A: BOM Import</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="text-xs text-muted-foreground">
                  Supported columns: item/material/component, quantity/qty/weight, unit/uom, origin_country/country,
                  module/stage, component_code/part_code (links or creates a library component), factor/factor_value.
                  Rows with zero weight are kept as placeholder/assembly-grouping labels and excluded from the calculation.
                </div>
                <div className="flex justify-end"><Button variant="outline" onClick={downloadBomTemplate}>Download Template</Button></div>
                <Input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={(e) => {
                    setBomFile(e.target.files?.[0] ?? null);
                    setBomImportResult(null);
                  }}
                />
                <div className="flex justify-end"><Button onClick={importBom}>Import BOM + Auto Map</Button></div>
                {bomImportResult ? (
                  <div
                    className={`rounded-md border px-3 py-2 text-sm ${
                      bomImportResult.kind === "success"
                        ? "border-green-200 bg-green-50 text-green-800"
                        : bomImportResult.kind === "warning"
                          ? "border-amber-200 bg-amber-50 text-amber-800"
                          : "border-red-200 bg-red-50 text-red-800"
                    }`}
                  >
                    {bomImportResult.message}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader><CardTitle>Stage 2B: Add from {isService ? "Activity" : "Component"} Library</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="text-xs text-muted-foreground">
                {isService
                  ? "Reuse activities already defined for this client (default Scope 3 category, quantity, unit) instead of retyping them."
                  : "Reuse components already defined for this client (material, mass, origin, supplier) instead of retyping them."}
              </div>
              <Button variant="outline" onClick={() => void openLibraryPicker()}>
                Browse {isService ? "Activity" : "Component"} Library
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Stage 2C: Manual Line Item</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-4">
                <div className="space-y-2">
                  <Label>{isService ? "Scope 3 Category" : "Module"}</Label>
                  <Select value={lineModule} onValueChange={setLineModule}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(isService ? serviceModules : modules).map((m) => (<SelectItem key={m.module_code} value={m.module_code}>{m.module_code} - {m.label}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 lg:col-span-3">
                  <Label>Line Label</Label>
                  <Input value={lineLabel} onChange={(e) => setLineLabel(e.target.value)} placeholder={isService ? "e.g. Economy flight, London-Berlin" : "e.g. Aluminium sheet"} />
                </div>
                {!isService ? (
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <SearchableStringSelect
                      value={lineCategory ? categoryName(Number(lineCategory)) : ""}
                      options={categoryNames}
                      placeholder="Search or type to add a new category..."
                      showClearButton
                      onValueChange={(name) => {
                        void (async () => {
                          const cat = await resolveOrCreateCategory(name);
                          setLineCategory(cat ? String(cat.category_id) : "");
                        })();
                      }}
                    />
                  </div>
                ) : null}
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
              items.map((row) => {
                const candidates = reviewCandidates[row.line_item_id] || [];
                const needsReview = !row.mapped_factor_source && typeof row.factor_match_confidence === "number";
                const isEditingFactor = editingFactorId === row.line_item_id;
                const isSearchOpen = Boolean(factorSearchOpen[row.line_item_id]);
                const searchResults = factorSearchResults[row.line_item_id] || [];
                return (
                  <div key={row.line_item_id} className={`rounded-md border p-3 ${row.is_placeholder ? "opacity-60" : ""}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium flex items-center gap-1">
                          {row.line_label}
                          {row.is_placeholder ? <Badge variant="secondary">Placeholder</Badge> : null}
                          {needsReview ? <Badge variant="destructive">Needs review</Badge> : null}
                          {row.mapped_factor_source && typeof row.factor_match_confidence === "number" ? (
                            <Badge variant="outline">{Math.round(row.factor_match_confidence * 100)}% confidence</Badge>
                          ) : null}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {moduleLabel(row.module_code)} | {row.material_category_id ? categoryName(row.material_category_id) : "Uncategorized"} |
                          {" "}Qty {Number(row.quantity || 0).toLocaleString()} {row.unit || "-"}
                        </div>
                        {isEditingFactor ? (
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <span className="text-xs text-muted-foreground">Factor</span>
                            <Input
                              type="number"
                              value={editFactorValue}
                              onChange={(e) => setEditFactorValue(e.target.value)}
                              className="h-7 w-28"
                            />
                            <Input
                              value={editFactorUnit}
                              onChange={(e) => setEditFactorUnit(e.target.value)}
                              className="h-7 w-32"
                              placeholder="kgCO2e/kg"
                            />
                            <Button size="sm" onClick={() => void saveEditFactor(row.line_item_id)}>Save</Button>
                            <Button size="sm" variant="outline" onClick={() => setEditingFactorId(null)}>Cancel</Button>
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground">
                            Factor {Number(row.factor_value || 0).toLocaleString()} {row.factor_unit || ""} |
                            {" "}{row.is_gap_filled ? "Gap-filled" : row.mapped_factor_source === "manual" ? "Manually set" : "Direct/Matched"}
                            {" "}
                            <button type="button" className="text-primary underline" onClick={() => startEditFactor(row)}>
                              Edit
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button variant="outline" onClick={() => mapFactor(row.line_item_id)}>Auto Map Factor</Button>
                        <Button variant="outline" onClick={() => toggleFactorSearch(row.line_item_id)}>
                          {isSearchOpen ? "Hide Search" : "Search Factor"}
                        </Button>
                        <Button variant="outline" onClick={() => gapFill(row.line_item_id)}>Gap Fill</Button>
                        <Button variant="outline" onClick={() => removeItem(row.line_item_id)}>Delete</Button>
                      </div>
                    </div>
                    {candidates.length > 0 ? (
                      <div className="mt-3 space-y-1 rounded-md border bg-muted/30 p-2">
                        <div className="text-xs text-muted-foreground">
                          No candidate reached the {Math.round(confidenceThreshold * 100)}% auto-apply threshold -- pick one to apply manually, or use Search Factor if none of these are right:
                        </div>
                        {candidates.map((c) => (
                          <div key={c.db_id} className="flex items-center justify-between gap-2 text-xs">
                            <span>
                              {c.label} ({Math.round(c.confidence * 100)}% confidence, {c.factor} {c.uom})
                            </span>
                            <Button size="sm" variant="outline" onClick={() => applyCandidate(row.line_item_id, c.db_id)}>
                              Use this match
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {isSearchOpen ? (
                      <div className="mt-3 space-y-2 rounded-md border bg-muted/30 p-2">
                        <div className="flex gap-2">
                          <Input
                            value={factorSearchQuery[row.line_item_id] || ""}
                            onChange={(e) => setFactorSearchQuery((prev) => ({ ...prev, [row.line_item_id]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void runFactorSearch(row.line_item_id);
                            }}
                            placeholder="e.g. plastic, metal, aramid fiber..."
                            className="h-8"
                          />
                          <Button size="sm" onClick={() => void runFactorSearch(row.line_item_id)} disabled={factorSearchLoading[row.line_item_id]}>
                            {factorSearchLoading[row.line_item_id] ? "Searching..." : "Search"}
                          </Button>
                        </div>
                        {searchResults.length > 0 ? (
                          <div className="max-h-56 space-y-1 overflow-y-auto">
                            {searchResults.map((c) => (
                              <div key={c.db_id} className="flex items-center justify-between gap-2 text-xs">
                                <span>
                                  {c.label} ({c.factor} {c.uom})
                                </span>
                                <Button size="sm" variant="outline" onClick={() => applyCandidate(row.line_item_id, c.db_id)}>
                                  Use this
                                </Button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground">
                            {factorSearchLoading[row.line_item_id] ? "" : "Type a keyword and press Search."}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })
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
            {summary?.mass_reconciliation ? (
              <div className="rounded-md border p-3">
                <div className="mb-2 text-sm font-medium">Mass Reconciliation</div>
                <div className="grid gap-2 text-sm md:grid-cols-3">
                  <div>Confirmed: {summary.mass_reconciliation.confirmed_quantity ?? "-"} {summary.mass_reconciliation.confirmed_quantity_unit}</div>
                  <div>Captured (A1): {summary.mass_reconciliation.captured_mass_kg ?? 0} kg</div>
                  <div>Gap: {summary.mass_reconciliation.mass_gap_kg ?? "-"} kg</div>
                </div>
              </div>
            ) : null}
            <div className={`grid gap-3 ${isService ? "" : "lg:grid-cols-2"}`}>
              <div className="rounded-md border p-3">
                <div className="mb-2 text-sm font-medium">{isService ? "By Scope 3 Category" : "By Module"}</div>
                <div className="space-y-1 text-sm">
                  {(summary?.module_breakdown || []).map((s) => (
                    <div key={s.module_code} className="flex justify-between">
                      <span>{moduleLabel(s.module_code)}</span>
                      <span>{s.emissions_tco2e.toLocaleString(undefined, { maximumFractionDigits: 4 })} tCO₂e ({s.share_pct.toFixed(1)}%)</span>
                    </div>
                  ))}
                </div>
              </div>
              {!isService ? (
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
              ) : null}
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

      {activeWorkflowStage === "scenarios" ? (
        <Card>
          <CardHeader>
            <CardTitle>Stage 6: Scenarios</CardTitle>
            <div className="text-xs text-muted-foreground">
              Model &quot;what if&quot; changes -- e.g. Recycled Metals or Low Carbon Operations -- as multipliers on the baseline, compared side by side.
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border p-3">
              <div className="mb-2 text-sm font-medium">Compare Scenarios</div>
              {comparison.length === 0 ? (
                <div className="text-sm text-muted-foreground">No scenarios yet.</div>
              ) : (
                <div className="space-y-1 text-sm">
                  {comparison.map((c) => (
                    <div key={c.scenario_id} className="flex items-center justify-between gap-2 rounded border px-2 py-1">
                      <span className="flex items-center gap-2">
                        {c.name}
                        {c.is_baseline ? <Badge variant="outline">Baseline</Badge> : null}
                      </span>
                      <span className="flex items-center gap-2">
                        <span>{c.total_tco2e.toLocaleString(undefined, { maximumFractionDigits: 4 })} tCO₂e</span>
                        {!c.is_baseline && c.delta_vs_baseline_pct !== null ? (
                          <Badge variant={c.delta_vs_baseline_pct <= 0 ? "secondary" : "destructive"}>
                            {c.delta_vs_baseline_pct > 0 ? "+" : ""}
                            {c.delta_vs_baseline_pct.toFixed(1)}%
                          </Badge>
                        ) : null}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-md border p-3 space-y-2">
                <div className="text-sm font-medium">Scenarios</div>
                <div className="space-y-1">
                  {scenarios.map((s) => (
                    <div
                      key={s.scenario_id}
                      className={`flex items-center justify-between gap-2 rounded border px-2 py-1 text-sm cursor-pointer ${
                        String(s.scenario_id) === selectedScenarioId ? "border-primary" : ""
                      }`}
                      onClick={() => setSelectedScenarioId(String(s.scenario_id))}
                    >
                      <span className="flex items-center gap-2">
                        {s.name}
                        {s.is_baseline ? <Badge variant="outline">Baseline</Badge> : null}
                      </span>
                      {!s.is_baseline ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            void deleteScenario(s.scenario_id);
                          }}
                        >
                          Delete
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className="space-y-2 border-t pt-2">
                  <Input placeholder="New scenario name (e.g. Recycled Metals)" value={newScenarioName} onChange={(e) => setNewScenarioName(e.target.value)} />
                  <Input placeholder="Description (optional)" value={newScenarioDescription} onChange={(e) => setNewScenarioDescription(e.target.value)} />
                  <Button variant="outline" onClick={createScenario}>+ New Scenario</Button>
                </div>
              </div>

              <div className="rounded-md border p-3 space-y-2">
                <div className="text-sm font-medium">
                  Multiplier Rules {selectedScenario ? `-- ${selectedScenario.name}` : ""}
                </div>
                {!selectedScenario ? (
                  <div className="text-sm text-muted-foreground">Select a non-baseline scenario to edit its rules.</div>
                ) : selectedScenario.is_baseline ? (
                  <div className="text-sm text-muted-foreground">The baseline scenario has no rules -- it&apos;s the as-measured reference.</div>
                ) : (
                  <>
                    <div className="space-y-1">
                      {multipliers.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No rules yet -- this scenario currently matches baseline.</div>
                      ) : (
                        multipliers.map((m) => (
                          <div key={m.multiplier_id} className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs">
                            <span>
                              {moduleLabel(m.module_code)}
                              {m.activity_id
                                ? ` | Activity: ${activityLabel(m.activity_id)}`
                                : m.component_id
                                  ? ` | Component: ${componentLabel(m.component_id)}`
                                  : m.material_category_id
                                    ? ` | Category: ${categoryName(m.material_category_id)}`
                                    : isService ? " | All activities" : " | All materials"}
                              {" -> "}
                              {m.multiplier}x
                            </span>
                            <Button size="sm" variant="outline" onClick={() => deleteMultiplierRule(m.multiplier_id)}>Remove</Button>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="grid gap-2 border-t pt-2 sm:grid-cols-2">
                      <Select value={ruleModule} onValueChange={setRuleModule}>
                        <SelectTrigger><SelectValue placeholder={isService ? "Scope 3 category" : "Module"} /></SelectTrigger>
                        <SelectContent>
                          {(isService ? serviceModules : modules).map((m) => (
                            <SelectItem key={m.module_code} value={m.module_code}>{m.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input placeholder="Multiplier (e.g. 0.3 = 70% less)" value={ruleMultiplier} onChange={(e) => setRuleMultiplier(e.target.value)} />
                      {isService ? (
                        <Select value={ruleActivity} onValueChange={setRuleActivity}>
                          <SelectTrigger><SelectValue placeholder="Optional -- a specific activity (more specific wins)" /></SelectTrigger>
                          <SelectContent>
                            {assessmentActivities.map((a) => (
                              <SelectItem key={a.activity_id} value={String(a.activity_id)}>{a.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <>
                          <Select value={ruleCategory} onValueChange={(v) => { setRuleCategory(v); setRuleComponent(""); }}>
                            <SelectTrigger><SelectValue placeholder="Category (optional -- module-wide if blank)" /></SelectTrigger>
                            <SelectContent>
                              {categories.map((c) => (
                                <SelectItem key={c.category_id} value={String(c.category_id)}>{c.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select value={ruleComponent} onValueChange={(v) => { setRuleComponent(v); setRuleCategory(""); }}>
                            <SelectTrigger><SelectValue placeholder="Or a specific component (more specific wins)" /></SelectTrigger>
                            <SelectContent>
                              {assessmentComponents.map((c) => (
                                <SelectItem key={c.component_id} value={String(c.component_id)}>{c.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </>
                      )}
                    </div>
                    <Button variant="outline" onClick={addMultiplierRule}>+ Add Rule</Button>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {activeWorkflowStage === "reporting" ? (
        <Card>
          <CardHeader><CardTitle>Stage 7: Reporting</CardTitle></CardHeader>
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
            <DialogTitle>Add from {isService ? "Activity" : "Component"} Library</DialogTitle>
            <DialogDescription>
              Select {isService ? "activities" : "components"} to add as line items in the chosen {isService ? "Scope 3 category" : "module"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-2 md:grid-cols-2">
              <Input value={librarySearch} onChange={(e) => setLibrarySearch(e.target.value)} placeholder={`Search ${isService ? "activities" : "components"}...`} />
              <Select value={libraryModule} onValueChange={setLibraryModule}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(isService ? serviceModules : modules).map((m) => (<SelectItem key={m.module_code} value={m.module_code}>{m.module_code} - {m.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            {isService ? (
              <>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowNewActivityForm((v) => !v)}>
                  {showNewActivityForm ? "Cancel new activity" : "+ New Activity"}
                </Button>
                {showNewActivityForm ? (
                  <div className="grid gap-2 rounded-md border p-3 md:grid-cols-2">
                    <Input value={newActivityCode} onChange={(e) => setNewActivityCode(e.target.value)} placeholder="Activity code (optional)" />
                    <Input value={newActivityDescription} onChange={(e) => setNewActivityDescription(e.target.value)} placeholder="Description *" />
                    <Select value={newActivityModule} onValueChange={setNewActivityModule}>
                      <SelectTrigger><SelectValue placeholder="Default Scope 3 category" /></SelectTrigger>
                      <SelectContent>
                        {serviceModules.map((m) => (<SelectItem key={m.module_code} value={m.module_code}>{m.label}</SelectItem>))}
                      </SelectContent>
                    </Select>
                    <div className="flex gap-2">
                      <Input type="number" value={newActivityQuantity} onChange={(e) => setNewActivityQuantity(e.target.value)} placeholder="Default quantity" />
                      <Input value={newActivityUnit} onChange={(e) => setNewActivityUnit(e.target.value)} placeholder="Unit" className="w-20" />
                    </div>
                    <div className="md:col-span-2 flex justify-end">
                      <Button type="button" size="sm" onClick={() => void createLibraryActivity()}>Save Activity</Button>
                    </div>
                  </div>
                ) : null}
                <div className="max-h-80 overflow-auto rounded-md border">
                  {libraryLoading ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">Loading...</div>
                  ) : filteredLibraryActivities.length === 0 ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">No activities found.</div>
                  ) : (
                    <table className="w-full text-sm">
                      <tbody className="divide-y divide-gray-100">
                        {filteredLibraryActivities.map((a) => (
                          <tr key={a.activity_id} className="cursor-pointer hover:bg-gray-50/70" onClick={() => toggleLibraryActivity(a.activity_id)}>
                            <td className="w-8 px-3 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={selectedActivityIds.has(a.activity_id)}
                                onChange={() => toggleLibraryActivity(a.activity_id)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <div className="font-medium text-slate-900">{a.description}</div>
                              <div className="text-xs text-slate-500">
                                {a.activity_code || "-"} | {a.default_module_code ? moduleLabel(a.default_module_code) : "No default category"} | {a.default_quantity ?? "-"} {a.default_unit}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowNewComponentForm((v) => !v)}>
                  {showNewComponentForm ? "Cancel new component" : "+ New Component"}
                </Button>
                {showNewComponentForm ? (
                  <div className="grid gap-2 rounded-md border p-3 md:grid-cols-2">
                    <Input value={newComponentCode} onChange={(e) => setNewComponentCode(e.target.value)} placeholder="Component code (optional)" />
                    <Input value={newComponentDescription} onChange={(e) => setNewComponentDescription(e.target.value)} placeholder="Description *" />
                    <SearchableStringSelect
                      value={newComponentCategory ? categoryName(Number(newComponentCategory)) : ""}
                      options={categoryNames}
                      placeholder="Material category -- search or type to add"
                      showClearButton
                      onValueChange={(name) => {
                        void (async () => {
                          const cat = await resolveOrCreateCategory(name);
                          setNewComponentCategory(cat ? String(cat.category_id) : "");
                        })();
                      }}
                    />
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
                                {c.component_code || "-"} | {c.origin_country || "Origin not set"} |{" "}
                                {c.is_assembly ? (
                                  <span className="font-medium text-blue-700">
                                    Assembly ({c.child_count} part{c.child_count === 1 ? "" : "s"}, {c.resolved_mass_kg ?? "-"} kg)
                                  </span>
                                ) : (
                                  <>{c.default_unit_mass ?? "-"} {c.default_unit}</>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                className="text-xs text-primary underline"
                                onClick={(e) => { e.stopPropagation(); openPartsEditor(c.component_id); }}
                              >
                                Parts
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLibraryOpen(false)}>Cancel</Button>
            {isService ? (
              <Button onClick={() => void addSelectedActivities()} disabled={selectedActivityIds.size === 0}>
                Add {selectedActivityIds.size || ""} Line{selectedActivityIds.size === 1 ? "" : "s"}
              </Button>
            ) : (
              <Button onClick={() => void addSelectedComponents()} disabled={selectedComponentIds.size === 0}>
                Add {selectedComponentIds.size || ""} Line{selectedComponentIds.size === 1 ? "" : "s"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={partsComponentId !== null} onOpenChange={(open) => { if (!open) setPartsComponentId(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Assembly Parts</DialogTitle>
            <DialogDescription>
              Add the materials or other library components that make up this assembly. Quantities are multiplied through
              when this assembly is referenced elsewhere (as a line item, or nested inside another assembly).
              {partsResolvedMass !== null && <span className="ml-1 font-medium text-slate-900">Total: {partsResolvedMass} kg</span>}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {partsError && <div className="rounded-md bg-rose-50 p-2 text-xs text-rose-700">{partsError}</div>}
            <div className="max-h-64 overflow-auto rounded-md border">
              {partsLoading ? (
                <div className="p-4 text-center text-sm text-muted-foreground">Loading...</div>
              ) : partsChildren.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">No parts added yet.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50 text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2">Part</th>
                      <th className="px-3 py-2">Qty</th>
                      <th className="px-3 py-2">Unit</th>
                      <th className="px-3 py-2">Factor</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {partsChildren.map((child) => (
                      <tr key={child.child_link_id}>
                        <td className="px-3 py-2">
                          {child.line_label}
                          {child.child_is_assembly && <span className="ml-1 text-xs text-blue-700">(assembly)</span>}
                        </td>
                        <td className="px-3 py-2">{child.quantity}</td>
                        <td className="px-3 py-2">{child.unit}</td>
                        <td className="px-3 py-2">{child.factor_value ?? "-"}</td>
                        <td className="px-3 py-2 text-right">
                          <button type="button" className="text-xs text-rose-700 underline" onClick={() => void deletePart(child.child_link_id)}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="grid gap-2 rounded-md border p-3 md:grid-cols-2">
              <Select value={newPartChildId} onValueChange={(v) => {
                setNewPartChildId(v);
                const picked = libraryComponents.find((c) => String(c.component_id) === v);
                if (picked) setNewPartLabel(picked.description);
              }}>
                <SelectTrigger><SelectValue placeholder="Pick a library component (optional)" /></SelectTrigger>
                <SelectContent>
                  {libraryComponents.filter((c) => c.component_id !== partsComponentId).map((c) => (
                    <SelectItem key={c.component_id} value={String(c.component_id)}>{c.description}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input value={newPartLabel} onChange={(e) => setNewPartLabel(e.target.value)} placeholder="Label (auto-filled if picked above)" />
              <div className="flex gap-2">
                <Input type="number" value={newPartQuantity} onChange={(e) => setNewPartQuantity(e.target.value)} placeholder="Quantity" />
                <Input value={newPartUnit} onChange={(e) => setNewPartUnit(e.target.value)} placeholder="Unit" className="w-20" />
              </div>
              <div className="flex gap-2">
                <Input type="number" value={newPartFactor} onChange={(e) => setNewPartFactor(e.target.value)} placeholder="Factor (optional)" />
                <Input value={newPartFactorUnit} onChange={(e) => setNewPartFactorUnit(e.target.value)} placeholder="Factor unit" className="w-32" />
              </div>
              <div className="md:col-span-2 flex justify-end">
                <Button type="button" size="sm" onClick={() => void addPart()}>Add Part</Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPartsComponentId(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
