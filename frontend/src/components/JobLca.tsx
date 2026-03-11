"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type JobLcaProps = {
  jobId: number;
  baseUrl: string;
};

type LcaProduct = {
  product_id: number;
  product_name: string;
  sku?: string | null;
  total_embedded_tco2e: number;
  functional_unit_value?: number;
  functional_unit_unit?: string;
  system_boundary?: string;
  lca_standard?: string;
};

type DatasetOption = {
  dataset_id: number;
  name: string;
  analysis_type?: string;
  country?: string;
  year?: number | null;
  version?: string;
};

type LcaItem = {
  item_id: number;
  stage_key: string;
  item_name: string;
  quantity: number;
  unit?: string | null;
  factor_value: number;
  factor_unit?: string | null;
  origin_country?: string | null;
  is_gap_filled?: boolean;
  data_quality?: string;
};

type LcaSummary = {
  total_tco2e: number;
  stage_breakdown: Array<{ stage_key: string; emissions_tco2e: number; share_pct: number }>;
  hotspots: Array<{ item_id: number; item_name: string; stage_key: string; emissions_tco2e: number; is_gap_filled: boolean }>;
};

type WorkflowStageKey =
  | "goal-scope"
  | "inventory"
  | "factor-mapping"
  | "gap-filling"
  | "impact"
  | "reporting";

const STAGES = [
  { key: "materials", label: "Material Inputs (BOM / origins)" },
  { key: "manufacturing", label: "Manufacturing (energy/process/waste)" },
  { key: "logistics", label: "Logistics (mode / distance / route)" },
  { key: "use_end_of_life", label: "Use + End-of-Life" },
];

export default function JobLca({ jobId, baseUrl }: JobLcaProps) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [products, setProducts] = useState<LcaProduct[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [items, setItems] = useState<LcaItem[]>([]);
  const [summary, setSummary] = useState<LcaSummary | null>(null);
  const [isoReport, setIsoReport] = useState<any>(null);
  const [lcaDatasets, setLcaDatasets] = useState<DatasetOption[]>([]);
  const [selectedDatasetIds, setSelectedDatasetIds] = useState<number[]>([]);
  const [inheritedDatasetIds, setInheritedDatasetIds] = useState<number[]>([]);
  const [effectiveDatasetIds, setEffectiveDatasetIds] = useState<number[]>([]);

  const [newProductName, setNewProductName] = useState("");
  const [newProductSku, setNewProductSku] = useState("");
  const [functionalUnit, setFunctionalUnit] = useState("kg_product");

  const [stageKey, setStageKey] = useState("materials");
  const [itemName, setItemName] = useState("");
  const [itemQty, setItemQty] = useState("1");
  const [itemUnit, setItemUnit] = useState("kg");
  const [itemFactor, setItemFactor] = useState("");
  const [itemFactorUnit, setItemFactorUnit] = useState("kgCO2e/unit");
  const [itemCountry, setItemCountry] = useState("");
  const [dataQuality, setDataQuality] = useState("secondary");
  const [notes, setNotes] = useState("");
  const [bomFile, setBomFile] = useState<File | null>(null);
  const [activeWorkflowStage, setActiveWorkflowStage] = useState<WorkflowStageKey>("goal-scope");
  const [stageLockEnabled, setStageLockEnabled] = useState(false);

  const selectedProduct = useMemo(
    () => products.find((p) => String(p.product_id) === selectedProductId) || null,
    [products, selectedProductId]
  );
  const itemsByStage = useMemo(() => {
    const out: Record<string, number> = {};
    for (const s of STAGES) out[s.key] = 0;
    for (const row of items) out[row.stage_key] = (out[row.stage_key] || 0) + 1;
    return out;
  }, [items]);
  const stageHasRows = useMemo(
    () => STAGES.every((s) => Number(itemsByStage[s.key] || 0) > 0),
    [itemsByStage]
  );
  const hasMappedFactors = useMemo(
    () => items.some((r) => Number(r.factor_value || 0) > 0),
    [items]
  );
  const hasGapFilled = useMemo(
    () => items.some((r) => Boolean(r.is_gap_filled)),
    [items]
  );
  const hasImpactResults = useMemo(
    () => Boolean(summary && Number(summary.total_tco2e || 0) >= 0 && (summary.stage_breakdown || []).length > 0),
    [summary]
  );

  async function loadProducts() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/lca/overview`, { credentials: "include" });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to load LCA overview (${res.status})${t ? `: ${t}` : ""}`);
      }
      const json = await res.json();
      const list = Array.isArray(json?.products) ? json.products : [];
      setProducts(list);
      if (!selectedProductId && list.length > 0) setSelectedProductId(String(list[0].product_id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadItems(productId: string) {
    if (!productId) {
      setItems([]);
      setSummary(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/lca/products/${productId}/items`, { credentials: "include" });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to load LCA items (${res.status})${t ? `: ${t}` : ""}`);
      }
      const json = await res.json();
      setItems(Array.isArray(json?.items) ? json.items : []);
      setSummary((json?.summary || null) as LcaSummary | null);
      if (Array.isArray(json?.selected_dataset_ids)) {
        setSelectedDatasetIds(json.selected_dataset_ids.map((v: any) => Number(v)).filter((v: number) => Number.isFinite(v)));
      }
      if (Array.isArray(json?.effective_dataset_ids)) {
        setEffectiveDatasetIds(json.effective_dataset_ids.map((v: any) => Number(v)).filter((v: number) => Number.isFinite(v)));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadDatasetSelection(productId: string) {
    if (!productId) {
      setLcaDatasets([]);
      setSelectedDatasetIds([]);
      setInheritedDatasetIds([]);
      setEffectiveDatasetIds([]);
      return;
    }
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/lca/products/${productId}/datasets`, { credentials: "include" });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to load LCA datasets (${res.status})${t ? `: ${t}` : ""}`);
      }
      const json = await res.json();
      const ds = Array.isArray(json?.datasets) ? json.datasets : [];
      setLcaDatasets(ds);
      setSelectedDatasetIds(
        Array.isArray(json?.selected_dataset_ids)
          ? json.selected_dataset_ids.map((v: any) => Number(v)).filter((v: number) => Number.isFinite(v))
          : []
      );
      setInheritedDatasetIds(
        Array.isArray(json?.inherited_job_dataset_ids)
          ? json.inherited_job_dataset_ids.map((v: any) => Number(v)).filter((v: number) => Number.isFinite(v))
          : []
      );
      setEffectiveDatasetIds(
        Array.isArray(json?.effective_dataset_ids)
          ? json.effective_dataset_ids.map((v: any) => Number(v)).filter((v: number) => Number.isFinite(v))
          : []
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void loadProducts();
  }, []);

  useEffect(() => {
    void loadItems(selectedProductId);
    void loadDatasetSelection(selectedProductId);
  }, [selectedProductId]);

  async function createProduct() {
    if (!newProductName.trim()) {
      setStatus("Product name is required.");
      return;
    }
    setStatus("Creating product...");
    setError("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/lca/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          product_name: newProductName.trim(),
          sku: newProductSku.trim(),
          functional_unit_unit: functionalUnit,
          lca_standard: "ISO 14040/14044",
          system_boundary: "cradle_to_grave",
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to create product (${res.status})${t ? `: ${t}` : ""}`);
      }
      const json = await res.json();
      await loadProducts();
      if (json?.product_id) setSelectedProductId(String(json.product_id));
      setNewProductName("");
      setNewProductSku("");
      setStatus("LCA product created.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  async function saveDatasetSelection() {
    if (!selectedProductId) {
      setStatus("Select or create a product first.");
      return;
    }
    setStatus("Saving LCA datasets...");
    setError("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/lca/products/${selectedProductId}/datasets`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ dataset_ids: selectedDatasetIds }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to save LCA datasets (${res.status})${t ? `: ${t}` : ""}`);
      }
      const json = await res.json();
      setSelectedDatasetIds(
        Array.isArray(json?.selected_dataset_ids)
          ? json.selected_dataset_ids.map((v: any) => Number(v)).filter((v: number) => Number.isFinite(v))
          : []
      );
      setEffectiveDatasetIds(
        Array.isArray(json?.effective_dataset_ids)
          ? json.effective_dataset_ids.map((v: any) => Number(v)).filter((v: number) => Number.isFinite(v))
          : []
      );
      await loadItems(selectedProductId);
      setStatus("LCA datasets saved.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  async function addItem() {
    if (!selectedProductId) {
      setStatus("Select or create a product first.");
      return;
    }
    if (!itemName.trim()) {
      setStatus("Item name is required.");
      return;
    }
    setStatus("Adding inventory item...");
    setError("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/lca/products/${selectedProductId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          stage_key: stageKey,
          item_name: itemName.trim(),
          quantity: Number(itemQty || 0),
          unit: itemUnit.trim(),
          factor_value: Number(itemFactor || 0),
          factor_unit: itemFactorUnit.trim() || "kgCO2e/unit",
          origin_country: itemCountry.trim(),
          data_quality: dataQuality,
          calculation_notes: notes.trim(),
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to add LCA item (${res.status})${t ? `: ${t}` : ""}`);
      }
      setItemName("");
      setItemQty("1");
      setItemUnit("kg");
      setItemFactor("");
      setItemCountry("");
      setNotes("");
      await loadItems(selectedProductId);
      await loadProducts();
      setStatus("Item added and LCA recalculated.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  async function mapFactor(itemId: number) {
    if (!selectedProductId) return;
    setStatus("Mapping emission factor...");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/lca/items/${itemId}/map-factor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ apply_top_match: true }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to map factor (${res.status})${t ? `: ${t}` : ""}`);
      }
      await loadItems(selectedProductId);
      await loadProducts();
      setStatus("Best-matched LCI factor applied.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  async function gapFill(itemId: number) {
    if (!selectedProductId) return;
    setStatus("Running data gap estimation...");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/lca/items/${itemId}/gap-fill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ apply: true }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to gap-fill item (${res.status})${t ? `: ${t}` : ""}`);
      }
      await loadItems(selectedProductId);
      await loadProducts();
      setStatus("Gap-filled factor applied and LCA recalculated.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  async function removeItem(itemId: number) {
    if (!selectedProductId) return;
    setStatus("Removing item...");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/lca/items/${itemId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to delete item (${res.status})${t ? `: ${t}` : ""}`);
      }
      await loadItems(selectedProductId);
      await loadProducts();
      setStatus("Item removed.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  async function generateIsoReport() {
    if (!selectedProductId) {
      setStatus("Select a product first.");
      return;
    }
    setStatus("Generating ISO-aligned report payload...");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/lca/products/${selectedProductId}/report`, {
        credentials: "include",
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to generate report (${res.status})${t ? `: ${t}` : ""}`);
      }
      const json = await res.json();
      setIsoReport(json);
      setStatus("ISO 14040/14044 report payload generated.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  async function importBom() {
    if (!selectedProductId) {
      setStatus("Select a product first.");
      return;
    }
    if (!bomFile) {
      setStatus("Choose a BOM CSV/XLSX file first.");
      return;
    }
    setStatus("Importing BOM and auto-mapping factors...");
    setError("");
    try {
      const form = new FormData();
      form.append("file", bomFile);
      const res = await fetch(`${baseUrl}/jobs/${jobId}/lca/products/${selectedProductId}/bom-upload`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to import BOM (${res.status})${t ? `: ${t}` : ""}`);
      }
      const json = await res.json();
      await loadItems(selectedProductId);
      await loadProducts();
      setBomFile(null);
      setStatus(
        `BOM imported. Inserted ${json?.inserted ?? 0}, mapped ${json?.mapped ?? 0}, gap-filled ${json?.gap_filled ?? 0}, skipped ${json?.skipped ?? 0}.`
      );
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    }
  }

  const workflow: Array<{ key: WorkflowStageKey; title: string; done: boolean }> = [
    { key: "goal-scope", title: "1. Goal & Scope", done: Boolean(selectedProductId) },
    { key: "inventory", title: "2. Inventory Analysis (LCI)", done: stageHasRows },
    { key: "factor-mapping", title: "3. Emission Factor Mapping", done: hasMappedFactors },
    { key: "gap-filling", title: "4. Data Gap Filling", done: hasGapFilled || items.length === 0 },
    { key: "impact", title: "5. Impact Assessment (LCIA)", done: hasImpactResults },
    { key: "reporting", title: "6. Reporting", done: Boolean(isoReport) },
  ];
  const activeIdx = workflow.findIndex((w) => w.key === activeWorkflowStage);
  const isStageUnlocked = (idx: number) => {
    if (!stageLockEnabled) return true;
    if (idx <= 0) return true;
    for (let i = 0; i < idx; i += 1) {
      if (!workflow[i].done) return false;
    }
    return true;
  };
  const nextIdx = Math.min(activeIdx + 1, workflow.length - 1);
  const nextLocked = !isStageUnlocked(nextIdx);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Life Cycle Assessment Wizard (ISO 14040/14044)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Product</Label>
              <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                <SelectTrigger><SelectValue placeholder="Select product..." /></SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.product_id} value={String(p.product_id)}>{p.product_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-md border px-3 py-2 text-sm">
              Embedded Emissions: {selectedProduct ? `${Number(selectedProduct.total_embedded_tco2e || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })} tCO2e` : "-"}
            </div>
            <div className="rounded-md border px-3 py-2 text-sm">
              Functional Unit: {selectedProduct ? `${selectedProduct.functional_unit_value || 1} ${selectedProduct.functional_unit_unit || "kg_product"}` : "-"}
            </div>
            <div className="rounded-md border px-3 py-2 text-sm">
              LCA Datasets: {effectiveDatasetIds.length > 0 ? `${effectiveDatasetIds.length} selected` : "None (all datasets)"}
            </div>
          </div>
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
            <span>
              Stage Lock: {stageLockEnabled ? "Enabled" : "Disabled"}.
              {stageLockEnabled ? " Complete each stage in order." : " Free navigation mode."}
            </span>
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
          <CardContent className="grid gap-4 lg:grid-cols-4">
            <div className="space-y-2 lg:col-span-2">
              <Label>Product Name</Label>
              <Input value={newProductName} onChange={(e) => setNewProductName(e.target.value)} placeholder="e.g. Product A" />
            </div>
            <div className="space-y-2">
              <Label>SKU</Label>
              <Input value={newProductSku} onChange={(e) => setNewProductSku(e.target.value)} placeholder="SKU-001" />
            </div>
            <div className="space-y-2">
              <Label>Functional Unit</Label>
              <Input value={functionalUnit} onChange={(e) => setFunctionalUnit(e.target.value)} placeholder="kg_product" />
            </div>
            <div className="lg:col-span-4 flex justify-end">
              <Button onClick={createProduct}>Create Product</Button>
            </div>
            <div className="space-y-3 lg:col-span-4 rounded-md border p-3">
              <div className="text-sm font-medium">LCA Dataset Selection</div>
              <div className="text-xs text-muted-foreground">
                Select the conversion-factor datasets to use for this product. Factor mapping, BOM auto-map, and gap-fill will use only these datasets.
              </div>
              {selectedProductId ? (
                <>
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {lcaDatasets.map((ds) => {
                      const selected = selectedDatasetIds.includes(ds.dataset_id);
                      return (
                        <button
                          key={ds.dataset_id}
                          type="button"
                          className={`rounded-md border px-3 py-2 text-left text-sm ${selected ? "border-primary bg-primary/5" : ""}`}
                          onClick={() => {
                            setSelectedDatasetIds((prev) =>
                              prev.includes(ds.dataset_id)
                                ? prev.filter((id) => id !== ds.dataset_id)
                                : [...prev, ds.dataset_id]
                            );
                          }}
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
                        ? `Product selection active: ${selectedDatasetIds.length} dataset(s).`
                        : inheritedDatasetIds.length > 0
                          ? `No product override selected. Inheriting ${inheritedDatasetIds.length} job dataset(s).`
                          : "No datasets selected. LCA will search all datasets."}
                    </div>
                    <Button variant="outline" onClick={saveDatasetSelection}>Save LCA Datasets</Button>
                  </div>
                </>
              ) : (
                <div className="text-xs text-muted-foreground">Create/select a product to configure datasets.</div>
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
                Supported columns: item/material/component, quantity/qty/weight, unit/uom, origin_country/country, stage, factor/factor_value.
              </div>
              <Input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => setBomFile(e.target.files?.[0] ?? null)} />
              <div className="flex justify-end"><Button onClick={importBom}>Import BOM + Auto Map</Button></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Stage 2B: Manual LCI Row</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-4">
                <div className="space-y-2">
                  <Label>Stage</Label>
                  <Select value={stageKey} onValueChange={setStageKey}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STAGES.map((s) => (<SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 lg:col-span-3">
                  <Label>Item Name</Label>
                  <Input value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="e.g. Aluminium sheet" />
                </div>
                <div className="space-y-2"><Label>Quantity</Label><Input type="number" value={itemQty} onChange={(e) => setItemQty(e.target.value)} /></div>
                <div className="space-y-2"><Label>Unit</Label><Input value={itemUnit} onChange={(e) => setItemUnit(e.target.value)} placeholder="kg, kWh, km..." /></div>
                <div className="space-y-2"><Label>Factor</Label><Input type="number" value={itemFactor} onChange={(e) => setItemFactor(e.target.value)} placeholder="optional" /></div>
                <div className="space-y-2"><Label>Factor Unit</Label><Input value={itemFactorUnit} onChange={(e) => setItemFactorUnit(e.target.value)} placeholder="kgCO2e/unit" /></div>
                <div className="space-y-2"><Label>Origin Country</Label><Input value={itemCountry} onChange={(e) => setItemCountry(e.target.value)} placeholder="United Kingdom" /></div>
                <div className="space-y-2">
                  <Label>Data Quality</Label>
                  <Select value={dataQuality} onValueChange={setDataQuality}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="primary">Primary</SelectItem>
                      <SelectItem value="secondary">Secondary</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 lg:col-span-2"><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Assumptions and process specifics..." /></div>
              </div>
              <div className="flex justify-end"><Button onClick={addItem}>Add Inventory Row</Button></div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {activeWorkflowStage === "factor-mapping" || activeWorkflowStage === "gap-filling" ? (
        <Card>
          <CardHeader><CardTitle>{activeWorkflowStage === "factor-mapping" ? "Stage 3: Emission Factor Mapping" : "Stage 4: Data Gap Filling"}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              {items.length === 0 ? <div className="text-sm text-muted-foreground">No inventory rows yet.</div> : items.map((row) => (
                <div key={row.item_id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-medium">{row.item_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.stage_key} | Qty {Number(row.quantity || 0).toLocaleString()} {row.unit || "-"} | Factor {Number(row.factor_value || 0).toLocaleString()} {row.factor_unit || ""} | {row.is_gap_filled ? "Gap-filled" : "Direct/Matched"}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => mapFactor(row.item_id)}>Auto Map Factor</Button>
                      <Button variant="outline" onClick={() => gapFill(row.item_id)}>Gap Fill</Button>
                      <Button variant="outline" onClick={() => removeItem(row.item_id)}>Delete</Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {activeWorkflowStage === "impact" ? (
        <Card>
          <CardHeader><CardTitle>Stage 5: Impact Assessment (LCIA) + Hotspots</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm">
              Total Embedded Emissions: <span className="font-semibold">{Number(summary?.total_tco2e || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })} tCO2e</span>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-md border p-3">
                <div className="mb-2 text-sm font-medium">By Lifecycle Stage</div>
                <div className="space-y-1 text-sm">
                  {(summary?.stage_breakdown || []).map((s) => (
                    <div key={s.stage_key} className="flex justify-between">
                      <span>{s.stage_key}</span>
                      <span>{s.emissions_tco2e.toLocaleString(undefined, { maximumFractionDigits: 4 })} tCO2e ({s.share_pct.toFixed(1)}%)</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="mb-2 text-sm font-medium">Hotspot Items</div>
                <div className="space-y-1 text-sm">
                  {(summary?.hotspots || []).slice(0, 6).map((h) => (
                    <div key={h.item_id} className="flex justify-between">
                      <span>{h.item_name}</span>
                      <span>{h.emissions_tco2e.toLocaleString(undefined, { maximumFractionDigits: 4 })} tCO2e</span>
                    </div>
                  ))}
                </div>
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
              <Button variant="outline" onClick={generateIsoReport}>Generate ISO Report Payload</Button>
            </div>
            {isoReport ? (
              <div className="space-y-2 rounded-md border p-3">
                <div className="text-sm">
                  Goal & Scope: {isoReport?.goal_scope?.product_name || "-"} | Boundary: {isoReport?.goal_scope?.system_boundary || "-"} | Functional Unit: {isoReport?.goal_scope?.functional_unit || "-"}
                </div>
                <div className="text-sm">
                  Inventory Rows: {isoReport?.inventory_analysis?.rows_count || 0} | Total GWP: {Number(isoReport?.impact_assessment?.total_embedded_tco2e || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })} tCO2e
                </div>
                <div className="text-xs text-muted-foreground">
                  Checklist: Goal/Scope {isoReport?.iso_14040_14044_checklist?.goal_and_scope_defined ? "yes" : "no"} | Inventory {isoReport?.iso_14040_14044_checklist?.inventory_collected ? "yes" : "no"} | LCIA {isoReport?.iso_14040_14044_checklist?.impact_assessed_gwp ? "yes" : "no"} | Interpretation {isoReport?.iso_14040_14044_checklist?.interpretation_hotspots_available ? "yes" : "no"}
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Generate the report payload to complete this stage.</div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          disabled={activeIdx <= 0}
          onClick={() => setActiveWorkflowStage(workflow[Math.max(activeIdx - 1, 0)].key)}
        >
          Previous Stage
        </Button>
        <Button
          disabled={activeIdx >= workflow.length - 1 || nextLocked}
          onClick={() => setActiveWorkflowStage(workflow[nextIdx].key)}
        >
          Next Stage
        </Button>
      </div>
      {nextLocked ? (
        <div className="text-xs text-muted-foreground">
          Next stage is locked. Complete all prior stages to continue.
        </div>
      ) : null}
    </div>
  );
}
