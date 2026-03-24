"use client";

import { Fragment, useEffect, useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api/backend";
}

type ScopeTotals = {
  job_id: number;
  scope_1: number;
  scope_2: number;
  scope_3: number;
  total: number;
};

type ScopeDataRow = {
  row_id: number;
  scope: string;
  category: string | null;
  report_label: string | null;
  original_id: string;
  uom: string | null;
  qty: number | null;
  factor: number | null;
  source_qty?: number | null;
  source_uom?: string | null;
  storage_qty?: number | null;
  storage_uom?: string | null;
  storage_factor?: number | null;
  reference_factor?: number | null;
  factor_reference?: string | null;
  storage_reason?: string | null;
  uses_emissions_fallback?: boolean;
  ghg_unit: string | null;
  calc_tco2e: number;
  tco2e_before_apply: number;
  apply_pct: number;
  data_source: string | null;
  data_confidence: string | null;
  notes: string | null;
  is_custom_entry: boolean;
  site_id: number | null;
  month_1: number | null;
  month_2: number | null;
  month_3: number | null;
  month_4: number | null;
  month_5: number | null;
  month_6: number | null;
  month_7: number | null;
  month_8: number | null;
  month_9: number | null;
  month_10: number | null;
  month_11: number | null;
  month_12: number | null;
};

type Site = {
  site_id: number;
  site_name: string;
};

type TemplateFactor = {
  scope: string;
  category: string;
  report_label: string;
  original_id: string;
  uom: string;
  dataset_id: number | null;
  factor_db_id: number | null;
  factor: number | null;
  ghg_unit: string | null;
  is_custom?: boolean;
  source?: string;
};

export default function JobDataEntry({ jobId }: { jobId: number }) {
  const confirmAction = useConfirmDialog();
  const baseUrl = apiBaseUrl();
  
  const [scopeTotals, setScopeTotals] = useState<ScopeTotals | null>(null);
  const [scopeData, setScopeData] = useState<ScopeDataRow[]>([]);
  const [templateFactors, setTemplateFactors] = useState<TemplateFactor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [jobData, setJobData] = useState<{ reporting_period_start?: string | null; client_db_id?: number | null } | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedScope, setSelectedScope] = useState<string>("All");
  const [confidenceFilter, setConfidenceFilter] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [showColumnManager, setShowColumnManager] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [visibleColumns, setVisibleColumns] = useState({
    site: true,
    qty: true,
    apply: true,
    tco2e: true,
    confidence: true,
  });
  
  // Factor browser state
  const [showFactorBrowser, setShowFactorBrowser] = useState(false);
  const [factorSearchQuery, setFactorSearchQuery] = useState("");
  const [factorScopeFilter, setFactorScopeFilter] = useState<string>("All");
  const [addingFactorId, setAddingFactorId] = useState<string | null>(null);
  const [factorsLoading, setFactorsLoading] = useState(false);
  const [factorsOffset, setFactorsOffset] = useState(0);
  const [factorsTotal, setFactorsTotal] = useState(0);
  const [factorsHasMore, setFactorsHasMore] = useState(false);
  const [loadingMoreFactors, setLoadingMoreFactors] = useState(false);
  
  // Inline editing state
  const [editingRowId, setEditingRowId] = useState<number | null>(null);
  const [editingQty, setEditingQty] = useState<string>("");
  const [editingApply, setEditingApply] = useState<string>("");
  const [editingSource, setEditingSource] = useState<string>("");
  const [editingConfidence, setEditingConfidence] = useState<string>("M");
  const [editingNotes, setEditingNotes] = useState<string>("");
  const [editingField, setEditingField] = useState<string | null>(null);
  
  // Monthly data modal state
  const [showMonthlyModal, setShowMonthlyModal] = useState(false);
  const [monthlyEditRow, setMonthlyEditRow] = useState<ScopeDataRow | null>(null);
  const [monthlyValues, setMonthlyValues] = useState<number[]>(Array(12).fill(0));

  useEffect(() => {
    loadData();
  }, [jobId]);

  useEffect(() => {
    const handleRefresh = () => {
      void loadData();
    };
    window.addEventListener("nzi-job-scope-refresh", handleRefresh);
    return () => window.removeEventListener("nzi-job-scope-refresh", handleRefresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  async function loadData() {
    setLoading(true);
    setError("");
    
    try {
      // Only load essential data on initial load (not template factors)
      const [totalsRes, dataRes, jobRes] = await Promise.all([
        fetch(`${baseUrl}/jobs/${jobId}/scope-totals`, { credentials: "include" }),
        fetch(`${baseUrl}/jobs/${jobId}/scope-data`, { credentials: "include" }),
        fetch(`${baseUrl}/jobs/${jobId}`, { credentials: "include" }),
      ]);

      if (totalsRes.ok) {
        const totalsData = await totalsRes.json();
        setScopeTotals(totalsData);
      }

      if (dataRes.ok) {
        const dataJson = await dataRes.json();
        setScopeData(dataJson.rows || []);
      }

      if (jobRes.ok) {
        const jobJson = await jobRes.json();
        setJobData(jobJson);
        
        // Fetch sites for this client
        if (jobJson.client_db_id) {
          try {
            const sitesRes = await fetch(`${baseUrl}/clients/${jobJson.client_db_id}/sites`, { credentials: "include" });
            if (sitesRes.ok) {
              const sitesData = await sitesRes.json();
              setSites(sitesData.active_sites || []);
            }
          } catch (e) {
            console.error("Error loading sites:", e);
          }
        }
      }
    } catch (e) {
      console.error("Error loading data:", e);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadTemplateFactors(reset = true) {
    if (reset) {
      setTemplateFactors([]);
      setFactorsOffset(0);
    }
    
    setFactorsLoading(true);
    try {
      const offset = reset ? 0 : factorsOffset;
      const scopeParam = factorScopeFilter !== "All" ? `&scope=${encodeURIComponent(factorScopeFilter)}` : "";
      const searchParam = factorSearchQuery ? `&search=${encodeURIComponent(factorSearchQuery)}` : "";
      
      const factorsRes = await fetch(
        `${baseUrl}/jobs/${jobId}/template-factors?limit=50&offset=${offset}${scopeParam}${searchParam}`,
        { credentials: "include" }
      );
      
      if (factorsRes.ok) {
        const factorsData = await factorsRes.json();
        setTemplateFactors(reset ? factorsData.factors || [] : [...templateFactors, ...(factorsData.factors || [])]);
        setFactorsTotal(factorsData.total || 0);
        setFactorsHasMore(factorsData.has_more || false);
        setFactorsOffset(offset + (factorsData.factors?.length || 0));
      } else {
        const details = await factorsRes.text().catch(() => "");
        console.error("Failed to load template factors:", factorsRes.status, details);
        setError(`Failed to load template factors: ${factorsRes.status}${details ? ` - ${details}` : ""}`);
      }
    } catch (e) {
      console.error("Error loading template factors:", e);
      setError((e as Error).message);
    } finally {
      setFactorsLoading(false);
    }
  }

  async function loadMoreFactors() {
    if (loadingMoreFactors || !factorsHasMore) return;
    
    setLoadingMoreFactors(true);
    try {
      const scopeParam = factorScopeFilter !== "All" ? `&scope=${encodeURIComponent(factorScopeFilter)}` : "";
      const searchParam = factorSearchQuery ? `&search=${encodeURIComponent(factorSearchQuery)}` : "";
      
      const factorsRes = await fetch(
        `${baseUrl}/jobs/${jobId}/template-factors?limit=50&offset=${factorsOffset}${scopeParam}${searchParam}`,
        { credentials: "include" }
      );
      
      if (factorsRes.ok) {
        const factorsData = await factorsRes.json();
        setTemplateFactors([...templateFactors, ...(factorsData.factors || [])]);
        setFactorsTotal(factorsData.total || 0);
        setFactorsHasMore(factorsData.has_more || false);
        setFactorsOffset(factorsOffset + (factorsData.factors?.length || 0));
      } else {
        const details = await factorsRes.text().catch(() => "");
        console.error("Failed to load more template factors:", factorsRes.status, details);
      }
    } catch (e) {
      console.error("Error loading more factors:", e);
    } finally {
      setLoadingMoreFactors(false);
    }
  }

  async function updateQuantity(rowId: number, newQty: number | null) {
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/scope-data/${rowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ qty: newQty }),
      });

      if (res.ok) {
        await loadData();
      } else {
        const text = await res.text();
        setError(`Update failed: ${text}`);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function startEditQty(row: ScopeDataRow) {
    setEditingRowId(row.row_id);
    setEditingQty(row.qty !== null ? String(row.qty) : "");
  }

  async function saveEditQty(rowId: number) {
    const qty = editingQty.trim() ? parseFloat(editingQty) : null;
    await updateQuantity(rowId, qty);
    setEditingRowId(null);
    setEditingQty("");
  }

  function cancelEditQty() {
    setEditingRowId(null);
    setEditingQty("");
    setEditingField(null);
  }

  function startEditApply(row: ScopeDataRow) {
    setEditingRowId(row.row_id);
    setEditingField("apply");
    setEditingApply(String(row.apply_pct));
  }

  async function saveEditApply(rowId: number) {
    const apply = editingApply.trim() ? parseFloat(editingApply) : 100;
    await updateField(rowId, { apply_pct: apply });
    setEditingRowId(null);
    setEditingApply("");
    setEditingField(null);
  }

  function startEditSource(row: ScopeDataRow) {
    setEditingRowId(row.row_id);
    setEditingField("source");
    setEditingSource(row.data_source || "Company Data");
  }

  async function saveEditSource(rowId: number) {
    await updateField(rowId, { data_source: editingSource.trim() || "Company Data" });
    setEditingRowId(null);
    setEditingSource("");
    setEditingField(null);
  }

  function startEditConfidence(row: ScopeDataRow) {
    setEditingRowId(row.row_id);
    setEditingField("confidence");
    setEditingConfidence((row.data_confidence || "M").toUpperCase());
  }

  async function saveEditConfidence(rowId: number) {
    const value = (editingConfidence || "M").toUpperCase();
    const normalized = value === "H" || value === "L" ? value : "M";
    await updateField(rowId, { data_confidence: normalized });
    setEditingRowId(null);
    setEditingField(null);
    setEditingConfidence("M");
  }

  function startEditNotes(row: ScopeDataRow) {
    setEditingRowId(row.row_id);
    setEditingField("notes");
    setEditingNotes(row.notes || "");
  }

  async function saveEditNotes(rowId: number) {
    await updateField(rowId, { notes: editingNotes.trim() });
    setEditingRowId(null);
    setEditingNotes("");
    setEditingField(null);
  }

  async function updateField(rowId: number, fields: Record<string, unknown>) {
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/scope-data/${rowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(fields),
      });

      if (res.ok) {
        await loadData();
      } else {
        const text = await res.text();
        setError(`Update failed: ${text}`);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function openMonthlyModal(row: ScopeDataRow) {
    setMonthlyEditRow(row);
    // Initialize monthly values from row data
    const months = [
      row.month_1 || 0, row.month_2 || 0, row.month_3 || 0,
      row.month_4 || 0, row.month_5 || 0, row.month_6 || 0,
      row.month_7 || 0, row.month_8 || 0, row.month_9 || 0,
      row.month_10 || 0, row.month_11 || 0, row.month_12 || 0,
    ];
    setMonthlyValues(months);
    setShowMonthlyModal(true);
  }

  function closeMonthlyModal() {
    setShowMonthlyModal(false);
    setMonthlyEditRow(null);
    setMonthlyValues(Array(12).fill(0));
  }

  function updateMonthlyValue(monthIndex: number, value: string) {
    const newValues = [...monthlyValues];
    newValues[monthIndex] = value ? parseFloat(value) : 0;
    setMonthlyValues(newValues);
  }

  function getMonthlySum(): number {
    return monthlyValues.reduce((sum, val) => sum + (val || 0), 0);
  }

  function getOrderedMonths(): string[] {
    const allMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    
    // Get reporting period start month from job data
    if (!jobData?.reporting_period_start) return allMonths;
    
    try {
      const startDate = new Date(jobData.reporting_period_start);
      const startMonthIndex = startDate.getMonth(); // 0-11
      
      // Reorder months to start from reporting period start
      return [...allMonths.slice(startMonthIndex), ...allMonths.slice(0, startMonthIndex)];
    } catch (e) {
      return allMonths;
    }
  }

  function getMonthIndex(displayIndex: number): number {
    // Convert display index to actual month index based on reporting period
    if (!jobData?.reporting_period_start) return displayIndex;
    
    try {
      const startDate = new Date(jobData.reporting_period_start);
      const startMonthIndex = startDate.getMonth();
      return (startMonthIndex + displayIndex) % 12;
    } catch (e) {
      return displayIndex;
    }
  }

  function copyFirstMonthToAll() {
    const firstValue = monthlyValues[getMonthIndex(0)] || 0;
    const newValues = Array(12).fill(firstValue);
    setMonthlyValues(newValues);
  }

  async function saveMonthlyData() {
    if (!monthlyEditRow) return;

    const monthlySum = getMonthlySum();
    const fields: Record<string, number | null> = {
      month_1: monthlyValues[0] || null,
      month_2: monthlyValues[1] || null,
      month_3: monthlyValues[2] || null,
      month_4: monthlyValues[3] || null,
      month_5: monthlyValues[4] || null,
      month_6: monthlyValues[5] || null,
      month_7: monthlyValues[6] || null,
      month_8: monthlyValues[7] || null,
      month_9: monthlyValues[8] || null,
      month_10: monthlyValues[9] || null,
      month_11: monthlyValues[10] || null,
      month_12: monthlyValues[11] || null,
    };

    // If annual qty is not set or monthly sum is different, update qty to match monthly sum
    if (!monthlyEditRow.qty || Math.abs(monthlyEditRow.qty - monthlySum) > 0.01) {
      fields.qty = monthlySum;
    }

    await updateField(monthlyEditRow.row_id, fields);
    closeMonthlyModal();
  }

  async function addFactorToJob(factor: TemplateFactor) {
    console.log("addFactorToJob called with factor:", factor);
    setAddingFactorId(factor.original_id);
    try {
      const payload = {
        scope: factor.scope,
        original_id: factor.original_id,
        category: factor.category,
        report_label: factor.report_label,
        uom: factor.uom,
        factor: factor.factor,
        ghg_unit: factor.ghg_unit,
        dataset_id: factor.dataset_id,
        factor_db_id: factor.factor_db_id,
        qty: 0,
        apply_pct: 100,
        data_source: "Company Data",
        data_confidence: "M",
        is_custom_entry: false,
      };
      
      console.log("Sending payload:", payload);
      
      const res = await fetch(`${baseUrl}/jobs/${jobId}/scope-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      console.log("Response status:", res.status);

      if (res.ok) {
        const result = await res.json();
        console.log("Factor added successfully:", result);
        await loadData();
        setError("");
      } else {
        const text = await res.text();
        console.error("Failed to add factor:", text);
        setError(`Failed to add factor: ${text}`);
      }
    } catch (e) {
      console.error("Error in addFactorToJob:", e);
      setError((e as Error).message);
    } finally {
      setAddingFactorId(null);
    }
  }

  async function deleteRow(rowId: number) {
    const confirmed = await confirmAction({
      title: "Delete emissions entry?",
      description: "This emissions data entry will be removed from the job.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/scope-data/${rowId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (res.ok) {
        await loadData();
      } else {
        const text = await res.text();
        setError(`Delete failed: ${text}`);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function toggleRowExpanded(rowId: number) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  function monthlyCount(row: ScopeDataRow): number {
    let count = 0;
    for (let i = 1; i <= 12; i++) {
      const val = row[`month_${i}` as keyof ScopeDataRow] as number | null | undefined;
      if (val != null && Math.abs(val) > 0) count += 1;
    }
    return count;
  }

  function confidenceBadgeClass(value: string | null | undefined): string {
    const c = String(value || "M").toUpperCase();
    if (c === "H") return "bg-emerald-100 text-emerald-800";
    if (c === "L") return "bg-rose-100 text-rose-800";
    return "bg-amber-100 text-amber-800";
  }

  function isLegacyFallbackRow(row: ScopeDataRow): boolean {
    return Boolean(row.uses_emissions_fallback);
  }

  function formatMaybeNumber(value: number | null | undefined, digits = 2): string {
    if (value === null || value === undefined || Number.isNaN(value)) return "-";
    return value.toFixed(digits);
  }

  function factorDisplayText(row: ScopeDataRow): string {
    if (isLegacyFallbackRow(row)) {
      if (row.reference_factor !== null && row.reference_factor !== undefined && !Number.isNaN(row.reference_factor)) {
        return row.reference_factor.toFixed(5);
      }
      return row.factor_reference || row.original_id || "Monthly factors";
    }
    if (row.factor === null || row.factor === undefined || Number.isNaN(row.factor)) return "-";
    return row.factor.toFixed(5);
  }

  function storageReasonText(reason: string | null | undefined): string {
    const value = String(reason || "").trim();
    if (!value) return "-";
    if (value === "multi_dataset_or_factor") return "Monthly dataset/factor fallback";
    if (value === "single_dataset_factor") return "Monthly raw quantity";
    return value.replaceAll("_", " ");
  }

  const filteredData = scopeData.filter((row) => {
    if (selectedScope !== "All" && row.scope !== selectedScope) return false;
    if (confidenceFilter !== "All") {
      const confidence = String(row.data_confidence || "M").toUpperCase();
      if (confidence !== confidenceFilter) return false;
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        row.report_label?.toLowerCase().includes(q) ||
        row.category?.toLowerCase().includes(q) ||
        row.original_id.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const filteredFactors = templateFactors.filter((factor) => {
    if (factorScopeFilter !== "All" && factor.scope !== factorScopeFilter) return false;
    if (factorSearchQuery) {
      const q = factorSearchQuery.toLowerCase();
      return (
        factor.report_label?.toLowerCase().includes(q) ||
        factor.category?.toLowerCase().includes(q) ||
        factor.original_id?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Check if a factor is already added to the job
  const isFactorAdded = (originalId: string) => {
    return scopeData.some(row => row.original_id === originalId);
  };

  const visibleColumnCount =
    4 +
    (visibleColumns.site ? 1 : 0) +
    (visibleColumns.qty ? 1 : 0) +
    (visibleColumns.apply ? 1 : 0) +
    (visibleColumns.tco2e ? 1 : 0) +
    (visibleColumns.confidence ? 1 : 0);

  return (
    <div className="space-y-6">
      {/* Emissions Summary Card */}
      <Card>
        <CardHeader>
          <CardTitle>Emissions Summary</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground text-center">Loading...</div>
          ) : scopeTotals ? (
            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-1 text-center">
                <div className="text-2xl font-bold">{scopeTotals.total.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div className="text-xs text-muted-foreground">Total tCO2e</div>
              </div>
              <div className="space-y-1 text-center">
                <div className="text-2xl font-bold text-red-600">{scopeTotals.scope_1.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div className="text-xs text-muted-foreground">Scope 1</div>
              </div>
              <div className="space-y-1 text-center">
                <div className="text-2xl font-bold text-orange-600">{scopeTotals.scope_2.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div className="text-xs text-muted-foreground">Scope 2</div>
              </div>
              <div className="space-y-1 text-center">
                <div className="text-2xl font-bold text-blue-600">{scopeTotals.scope_3.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div className="text-xs text-muted-foreground">Scope 3</div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center">No data</div>
          )}
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4 flex-wrap">
            <div className="flex-1">
              <Label htmlFor="search">Search</Label>
              <Input
                id="search"
                placeholder="Search by label, category, or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="w-48">
              <Label htmlFor="scopeFilter">Scope</Label>
              <Select value={selectedScope} onValueChange={setSelectedScope}>
                <SelectTrigger id="scopeFilter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Scopes</SelectItem>
                  <SelectItem value="Scope 1">Scope 1</SelectItem>
                  <SelectItem value="Scope 2">Scope 2</SelectItem>
                  <SelectItem value="Scope 3">Scope 3</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-48">
              <Label htmlFor="confidenceFilter">Data Confidence</Label>
              <Select value={confidenceFilter} onValueChange={setConfidenceFilter}>
                <SelectTrigger id="confidenceFilter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All</SelectItem>
                  <SelectItem value="H">High (H)</SelectItem>
                  <SelectItem value="M">Medium (M)</SelectItem>
                  <SelectItem value="L">Low (L)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={() => setShowColumnManager(true)} variant="outline">
                Columns
              </Button>
            </div>
            <div className="flex items-end">
              <Button onClick={loadData} variant="outline">
                Refresh
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Data Grid */}
      <Card>
        <CardHeader>
          <CardTitle>Data Entries ({filteredData.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : filteredData.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No data entries yet. Add data using the template or Excel upload.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2 w-10"></th>
                    <th className="text-left p-2">Scope</th>
                    {visibleColumns.site && <th className="text-left p-2">Site</th>}
                    <th className="text-left p-2">Report Label</th>
                    {visibleColumns.qty && <th className="text-right p-2">Qty</th>}
                    {visibleColumns.apply && <th className="text-right p-2">Apply %</th>}
                    {visibleColumns.tco2e && <th className="text-right p-2">tCO2e (After)</th>}
                    {visibleColumns.confidence && <th className="text-left p-2">Data Confidence</th>}
                    <th className="text-left p-2">Monthly</th>
                    <th className="text-left p-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredData.map((row) => (
                    <Fragment key={row.row_id}>
                      <tr key={`main-${row.row_id}`} className="border-b hover:bg-muted/50">
                        <td className="p-2">
                          <Button variant="ghost" size="sm" onClick={() => toggleRowExpanded(row.row_id)}>
                            {expandedRows.has(row.row_id) ? "-" : "+"}
                          </Button>
                        </td>
                        <td className="p-2">
                          <span className={`inline-block px-2 py-1 rounded text-xs ${
                            row.scope === "Scope 1" ? "bg-red-100 text-red-800" :
                            row.scope === "Scope 2" ? "bg-orange-100 text-orange-800" :
                            "bg-blue-100 text-blue-800"
                          }`}>
                            {row.scope}
                          </span>
                        </td>
                        {visibleColumns.site && (
                          <td className="p-2">
                            <Select
                              value={row.site_id?.toString() || ""}
                              onValueChange={(value) => {
                                if (value) updateField(row.row_id, { site_id: parseInt(value) });
                              }}
                            >
                              <SelectTrigger className="h-7 w-32 text-xs">
                                <SelectValue placeholder="Select site" />
                              </SelectTrigger>
                              <SelectContent>
                                {sites.map((site) => (
                                  <SelectItem key={site.site_id} value={site.site_id.toString()}>
                                    {site.site_name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                        )}
                        <td className="p-2 max-w-xs truncate" title={row.report_label || ""}>{row.report_label || row.original_id}</td>
                        {visibleColumns.qty && (
                          <td className="p-2 text-right">
                            {isLegacyFallbackRow(row) ? (
                              <span
                                className="inline-block px-2 py-1 font-mono"
                                title="Legacy annual row shows the original source volume. This row is stored monthly as tCO2e for audit compatibility."
                              >
                                {row.qty?.toFixed(2) || "0.00"}
                              </span>
                            ) : editingRowId === row.row_id && !editingField ? (
                              <div className="flex gap-1 justify-end">
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={editingQty}
                                  onChange={(e) => setEditingQty(e.target.value)}
                                  className="w-24 h-7 text-right font-mono text-sm"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") saveEditQty(row.row_id);
                                    if (e.key === "Escape") cancelEditQty();
                                  }}
                                />
                                <Button size="sm" onClick={() => saveEditQty(row.row_id)} className="h-7 px-2">Save</Button>
                              </div>
                            ) : (
                              <button className="font-mono hover:bg-muted px-2 py-1 rounded" onClick={() => startEditQty(row)}>
                                {row.qty?.toFixed(2) || "0.00"}
                              </button>
                            )}
                          </td>
                        )}
                        {visibleColumns.apply && (
                          <td className="p-2 text-right">
                            {editingRowId === row.row_id && editingField === "apply" ? (
                              <div className="flex gap-1 justify-end">
                                <Input
                                  type="number"
                                  step="1"
                                  value={editingApply}
                                  onChange={(e) => setEditingApply(e.target.value)}
                                  className="w-20 h-7 text-right font-mono text-sm"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") saveEditApply(row.row_id);
                                    if (e.key === "Escape") cancelEditQty();
                                  }}
                                />
                                <Button size="sm" onClick={() => saveEditApply(row.row_id)} className="h-7 px-2">Save</Button>
                              </div>
                            ) : (
                              <button className="font-mono hover:bg-muted px-2 py-1 rounded" onClick={() => startEditApply(row)}>
                                {row.apply_pct}%
                              </button>
                            )}
                          </td>
                        )}
                        {visibleColumns.tco2e && (
                          <td className="p-2 text-right font-mono font-semibold">{row.calc_tco2e.toFixed(4)}</td>
                        )}
                        {visibleColumns.confidence && (
                          <td className="p-2">
                            {editingRowId === row.row_id && editingField === "confidence" ? (
                              <div className="flex gap-1 items-center">
                                <Select value={editingConfidence} onValueChange={setEditingConfidence}>
                                  <SelectTrigger className="h-7 w-20 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="H">H</SelectItem>
                                    <SelectItem value="M">M</SelectItem>
                                    <SelectItem value="L">L</SelectItem>
                                  </SelectContent>
                                </Select>
                                <Button size="sm" onClick={() => saveEditConfidence(row.row_id)} className="h-7 px-2">Save</Button>
                              </div>
                            ) : (
                              <button
                                className={`rounded-full px-2 py-0.5 text-xs ${confidenceBadgeClass(row.data_confidence)}`}
                                onClick={() => startEditConfidence(row)}
                              >
                                {(row.data_confidence || "M").toUpperCase()}
                              </button>
                            )}
                          </td>
                        )}
                        <td className="p-2 text-xs text-muted-foreground">{monthlyCount(row)}/12</td>
                        <td className="p-2">
                          <div className="flex gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openMonthlyModal(row)}
                              title={
                                isLegacyFallbackRow(row)
                                  ? "This legacy row stores monthly fallback tCO2e values while showing the original source volume above."
                                  : undefined
                              }
                            >
                              {isLegacyFallbackRow(row) ? "Monthly tCO2e" : "Monthly"}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => deleteRow(row.row_id)}>Delete</Button>
                          </div>
                        </td>
                      </tr>
                      {expandedRows.has(row.row_id) && (
                        <tr key={`details-${row.row_id}`} className="border-b bg-muted/20">
                          <td colSpan={visibleColumnCount} className="p-3">
                            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                              <div className="text-xs">
                                <div className="text-muted-foreground">Category</div>
                                <div>{row.category || "-"}</div>
                              </div>
                              <div className="text-xs">
                                <div className="text-muted-foreground">UOM</div>
                                <div>{row.uom || "-"}</div>
                              </div>
                              <div className="text-xs">
                                <div className="text-muted-foreground">Factor</div>
                                <div className="font-mono break-all">{factorDisplayText(row)}</div>
                              </div>
                              <div className="text-xs">
                                <div className="text-muted-foreground">Factor ID</div>
                                <div className="font-mono break-all">{row.factor_reference || row.original_id || "-"}</div>
                              </div>
                              <div className="text-xs">
                                <div className="text-muted-foreground">tCO2e (Before)</div>
                                <div className="font-mono">{row.tco2e_before_apply.toFixed(4)}</div>
                              </div>
                              {isLegacyFallbackRow(row) && (
                                <>
                                  <div className="text-xs">
                                    <div className="text-muted-foreground">Source Volume</div>
                                    <div className="font-mono">
                                      {formatMaybeNumber(row.qty, 2)} {row.uom || ""}
                                    </div>
                                  </div>
                                  <div className="text-xs">
                                    <div className="text-muted-foreground">Stored As</div>
                                    <div className="font-mono">
                                      {formatMaybeNumber(row.storage_qty, 4)} {row.storage_uom || ""}
                                    </div>
                                  </div>
                                  <div className="text-xs">
                                    <div className="text-muted-foreground">Storage Factor</div>
                                    <div className="font-mono">{formatMaybeNumber(row.storage_factor, 5)}</div>
                                  </div>
                                  <div className="text-xs">
                                    <div className="text-muted-foreground">Storage Mode</div>
                                    <div>{storageReasonText(row.storage_reason)}</div>
                                  </div>
                                </>
                              )}
                              <div className="text-xs md:col-span-2">
                                <div className="text-muted-foreground mb-1">Source</div>
                                {editingRowId === row.row_id && editingField === "source" ? (
                                  <div className="flex gap-1">
                                    <Input
                                      type="text"
                                      value={editingSource}
                                      onChange={(e) => setEditingSource(e.target.value)}
                                      className="h-7 text-sm"
                                      autoFocus
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") saveEditSource(row.row_id);
                                        if (e.key === "Escape") cancelEditQty();
                                      }}
                                    />
                                    <Button size="sm" onClick={() => saveEditSource(row.row_id)} className="h-7 px-2">Save</Button>
                                  </div>
                                ) : (
                                  <button className="w-full rounded border px-2 py-1 text-left hover:bg-muted" onClick={() => startEditSource(row)}>
                                    {row.data_source || "Company Data"}
                                  </button>
                                )}
                              </div>
                              <div className="text-xs md:col-span-2">
                                <div className="text-muted-foreground mb-1">Notes</div>
                                {editingRowId === row.row_id && editingField === "notes" ? (
                                  <div className="flex gap-1">
                                    <Input
                                      type="text"
                                      value={editingNotes}
                                      onChange={(e) => setEditingNotes(e.target.value)}
                                      className="h-7 text-sm"
                                      autoFocus
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") saveEditNotes(row.row_id);
                                        if (e.key === "Escape") cancelEditQty();
                                      }}
                                    />
                                    <Button size="sm" onClick={() => saveEditNotes(row.row_id)} className="h-7 px-2">Save</Button>
                                  </div>
                                ) : (
                                  <button className="w-full rounded border px-2 py-1 text-left hover:bg-muted" onClick={() => startEditNotes(row)}>
                                    {row.notes || <span className="text-muted-foreground italic">Add notes...</span>}
                                  </button>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showColumnManager} onOpenChange={setShowColumnManager}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Column Manager</DialogTitle>
            <DialogDescription>Show or hide optional columns in Data Entries.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {[
              { key: "site", label: "Site" },
              { key: "qty", label: "Qty" },
              { key: "apply", label: "Apply %" },
              { key: "tco2e", label: "tCO2e (After)" },
              { key: "confidence", label: "Data Confidence" },
            ].map((item) => (
              <label key={item.key} className="flex items-center justify-between text-sm">
                <span>{item.label}</span>
                <input
                  type="checkbox"
                  checked={visibleColumns[item.key as keyof typeof visibleColumns]}
                  onChange={(e) =>
                    setVisibleColumns((prev) => ({
                      ...prev,
                      [item.key]: e.target.checked,
                    }))
                  }
                />
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowColumnManager(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Data Button */}
      <div className="flex justify-center">
        <Button 
          onClick={async () => {
            if (!showFactorBrowser) {
              await loadTemplateFactors();
            }
            setShowFactorBrowser(!showFactorBrowser);
          }}
          size="lg"
          className="w-full max-w-md"
          disabled={factorsLoading}
        >
          {factorsLoading ? "Loading factors..." : showFactorBrowser ? "Hide" : "Add Data from Template"}{" "}
          {((factorsTotal || templateFactors.length) > 0) &&
            `(${(factorsTotal || templateFactors.length).toLocaleString()} factors available)`}
        </Button>
      </div>

      {/* Factor Browser */}
      {showFactorBrowser && (
        <Card>
          <CardHeader>
            <CardTitle>Browse & Add Factors</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Factor Search & Filter */}
            <div className="space-y-3">
              <div className="flex gap-4">
                <div className="flex-1">
                  <Label htmlFor="factorSearch">Search Factors</Label>
                  <Input
                    id="factorSearch"
                    placeholder="Search by label, category, or ID..."
                    value={factorSearchQuery}
                    onChange={(e) => setFactorSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") loadTemplateFactors(true);
                    }}
                  />
                </div>
                <div className="w-48">
                  <Label htmlFor="factorScopeFilter">Scope</Label>
                  <Select value={factorScopeFilter} onValueChange={(val) => {
                    setFactorScopeFilter(val);
                  }}>
                    <SelectTrigger id="factorScopeFilter">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="All">All Scopes</SelectItem>
                      <SelectItem value="Scope 1">Scope 1</SelectItem>
                      <SelectItem value="Scope 2">Scope 2</SelectItem>
                      <SelectItem value="Scope 3">Scope 3</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button onClick={() => loadTemplateFactors(true)} disabled={factorsLoading}>
                    {factorsLoading ? "Searching..." : "Search"}
                  </Button>
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                Showing {templateFactors.length} of {factorsTotal} factors
              </div>
            </div>

            {/* Factor List */}
            <div className="border rounded-md max-h-96 overflow-y-auto">
              {templateFactors.length === 0 && !factorsLoading ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  No factors found. Try adjusting your search or filters.
                </div>
              ) : (
                <div className="divide-y">
                  {filteredFactors.map((factor, index) => {
                    const alreadyAdded = isFactorAdded(factor.original_id);
                    const isAdding = addingFactorId === factor.original_id;
                    const uniqueKey = `${factor.original_id}_${factor.dataset_id}_${factor.factor_db_id}_${index}`;
                    
                    return (
                      <div
                        key={uniqueKey}
                        className={`p-3 hover:bg-muted/50 transition-colors ${
                          alreadyAdded ? "bg-muted/30" : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                                factor.scope === "Scope 1" ? "bg-red-100 text-red-800" :
                                factor.scope === "Scope 2" ? "bg-orange-100 text-orange-800" :
                                "bg-blue-100 text-blue-800"
                              }`}>
                                {factor.scope}
                              </span>
                              {factor.is_custom && (
                                <span className="inline-block px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-800 font-semibold">
                                  CUSTOM
                                </span>
                              )}
                              <span className="text-sm font-medium truncate">
                                {factor.report_label}
                              </span>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {factor.category}
                            </div>
                            <div className="mt-1 flex items-center gap-3 text-xs">
                              <span className="font-mono">
                                Factor: {factor.factor?.toFixed(5) || "N/A"}
                              </span>
                              <span className="text-muted-foreground">
                                {factor.uom} → {factor.ghg_unit}
                              </span>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => addFactorToJob(factor)}
                            disabled={alreadyAdded || isAdding}
                            variant={alreadyAdded ? "outline" : "default"}
                          >
                            {isAdding ? "Adding..." : alreadyAdded ? "Added ✓" : "Add to Job"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  {factorsHasMore && (
                    <div className="p-4 text-center">
                      <Button
                        onClick={loadMoreFactors}
                        disabled={loadingMoreFactors}
                        variant="outline"
                        className="w-full"
                      >
                        {loadingMoreFactors ? "Loading..." : `Load More (${factorsTotal - templateFactors.length} remaining)`}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Monthly Data Entry Modal */}
      <Dialog open={showMonthlyModal} onOpenChange={setShowMonthlyModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Monthly Data Entry</DialogTitle>
            {monthlyEditRow && (
              <div className="mt-2">
                <div className="font-semibold">{monthlyEditRow.report_label}</div>
                <div className="text-xs text-muted-foreground">
                  {monthlyEditRow.scope} • {monthlyEditRow.category}
                </div>
              </div>
            )}
          </DialogHeader>

          <div className="space-y-4">
            {monthlyEditRow && isLegacyFallbackRow(monthlyEditRow) && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                This legacy annual row shows the original source volume in the grid, but its monthly values are stored as fallback tCO2e for audit compatibility. Monthly values are read-only here.
              </div>
            )}
            {/* Copy to All Months Button */}
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={copyFirstMonthToAll}
                type="button"
                disabled={monthlyEditRow ? isLegacyFallbackRow(monthlyEditRow) : false}
              >
                Copy First Month to All
              </Button>
            </div>

            {/* Monthly Input Grid */}
            <div className="grid grid-cols-3 gap-3">
              {getOrderedMonths().map((month, displayIndex) => {
                const actualIndex = getMonthIndex(displayIndex);
                return (
                  <div key={`${month}-${displayIndex}`}>
                    <Label htmlFor={`month-${displayIndex}`} className="text-xs">
                      {month}
                    </Label>
                    <Input
                      id={`month-${displayIndex}`}
                      type="number"
                      step="0.01"
                      value={monthlyValues[actualIndex] || ""}
                      onChange={(e) => updateMonthlyValue(actualIndex, e.target.value)}
                      className="h-8 text-sm font-mono text-right"
                      disabled={monthlyEditRow ? isLegacyFallbackRow(monthlyEditRow) : false}
                    />
                  </div>
                );
              })}
            </div>

            {/* Summary */}
            <div className="border-t pt-4">
              <div className="flex justify-between items-center mb-2">
                <span className="font-semibold">
                  {monthlyEditRow && isLegacyFallbackRow(monthlyEditRow) ? "Monthly Stored Total:" : "Monthly Total:"}
                </span>
                <span className="font-mono text-lg">
                  {getMonthlySum().toFixed(2)} {monthlyEditRow && isLegacyFallbackRow(monthlyEditRow) ? (monthlyEditRow.storage_uom || monthlyEditRow.ghg_unit || monthlyEditRow.uom) : monthlyEditRow?.uom}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-semibold">
                  {monthlyEditRow && isLegacyFallbackRow(monthlyEditRow) ? "Displayed Annual Volume:" : "Annual Qty:"}
                </span>
                <span className="font-mono text-lg">{monthlyEditRow?.qty?.toFixed(2) || "0.00"} {monthlyEditRow?.uom}</span>
              </div>
              
              {/* Validation Warning */}
              {monthlyEditRow && !isLegacyFallbackRow(monthlyEditRow) && monthlyEditRow.qty && Math.abs(monthlyEditRow.qty - getMonthlySum()) > 0.01 && (
                <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                  <div className="flex items-start gap-2">
                    <span className="text-yellow-600 font-semibold text-sm">⚠️ Warning:</span>
                    <div className="text-sm text-yellow-800">
                      <p>Monthly total ({getMonthlySum().toFixed(2)}) does not match Annual Qty ({monthlyEditRow.qty.toFixed(2)}).</p>
                      <p className="mt-1">When you save, the Annual Qty will be updated to match the monthly total.</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeMonthlyModal}>
              {monthlyEditRow && isLegacyFallbackRow(monthlyEditRow) ? "Close" : "Cancel"}
            </Button>
            {!(monthlyEditRow && isLegacyFallbackRow(monthlyEditRow)) && (
              <Button onClick={saveMonthlyData}>
                Save Monthly Data
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
