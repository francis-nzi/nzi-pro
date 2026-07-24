"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";
import LoadingOrbit from "@/components/LoadingOrbit";
import PendingPortalSubmissions from "@/components/PendingPortalSubmissions";
import { withAuditHeaders } from "@/lib/auth-client";
import { dispatchJobScopeRefresh, JOB_SCOPE_REFRESH_EVENT } from "@/lib/job-scope-refresh";
import { useUnsavedChangesGuard } from "@/lib/useUnsavedChangesGuard";
import FactorBrowserCard from "@/components/FactorBrowserCard";
import { FileText, PencilLine, Trash2 } from "lucide-react";

function apiBaseUrl(): string {
  return "/api/backend";
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
  dataset_id?: number | null;
  factor_db_id?: number | null;
  lookup_category?: string | null;
  level_1?: string | null;
  level_2?: string | null;
  level_3?: string | null;
  level_4?: string | null;
  column_text?: string | null;
  report_label: string | null;
  original_id: string;
  uom: string | null;
  qty: number | null;
  factor: number | null;
  factor_label?: string | null;
  dataset_label?: string | null;
  dataset_category?: string | null;
  factor_blended?: boolean;
  uses_monthly_factors?: boolean;
  monthly_factor_details?: Array<{
    month_index: number;
    month_label?: string | null;
    year?: number | null;
    dataset_id?: number | null;
    dataset_name?: string | null;
    dataset_category?: string | null;
    lookup_category?: string | null;
    factor_db_id?: number | null;
    factor_original_id?: string | null;
    factor?: number | null;
    ghg_unit?: string | null;
    qty?: number | null;
    uom?: string | null;
    emissions?: number | null;
  }>;
  source_qty?: number | null;
  source_uom?: string | null;
  storage_qty?: number | null;
  storage_uom?: string | null;
  storage_factor?: number | null;
  reference_factor?: number | null;
  factor_reference?: string | null;
  storage_reason?: string | null;
  unit_warning?: string | null;
  uses_emissions_fallback?: boolean;
  source_volume_available?: boolean;
  ghg_unit: string | null;
  calc_tco2e: number;
  tco2e_before_apply: number;
  apply_pct: number;
  data_source: string | null;
  data_confidence: string | null;
  notes: string | null;
  is_custom_entry: boolean;
  linked_row_id?: number | null;
  is_auto_generated?: boolean;
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
  is_registered_office?: boolean;
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
  level_1?: string | null;
  level_2?: string | null;
  level_3?: string | null;
  level_4?: string | null;
  column_text?: string | null;
  is_custom?: boolean;
  source?: string;
  methodology_default?: boolean;
  methodology_default_label?: string | null;
};

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
};

type PreviousYearRow = {
  row_id: number;
  job_id: number;
  scope: string;
  site_id: number | null;
  site_name: string | null;
  dataset_id: number | null;
  factor_db_id: number | null;
  original_id: string;
  category: string | null;
  dataset_category?: string | null;
  lookup_category?: string | null;
  level_1?: string | null;
  level_2?: string | null;
  level_3?: string | null;
  level_4?: string | null;
  column_text?: string | null;
  report_label: string | null;
  uom: string | null;
  factor: number | null;
  ghg_unit: string | null;
  previous_qty: number | null;
  previous_month_count: number;
  data_confidence: string | null;
  source_job_number?: string | null;
  source_job_title?: string | null;
  source_reporting_period_start?: string | null;
  source_reporting_period_end?: string | null;
};

type MonthlyFilterRow = {
  previous_month_count?: number | null;
  month_1?: number | null;
  month_2?: number | null;
  month_3?: number | null;
  month_4?: number | null;
  month_5?: number | null;
  month_6?: number | null;
  month_7?: number | null;
  month_8?: number | null;
  month_9?: number | null;
  month_10?: number | null;
  month_11?: number | null;
  month_12?: number | null;
};

type ScopeDataDebugRow = ScopeDataRow & {
  enabled?: boolean;
  site_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type JobDataEntryProps = {
  jobId: number;
  showEmissionsSummary?: boolean;
  baseUrl?: string;
};

export default function JobDataEntry({ jobId, showEmissionsSummary = false, baseUrl }: JobDataEntryProps) {
  const confirmAction = useConfirmDialog();
  const effectiveBaseUrl = (baseUrl || apiBaseUrl()).trim() || apiBaseUrl();
  
  const [scopeTotals, setScopeTotals] = useState<ScopeTotals | null>(null);
  const [scopeData, setScopeData] = useState<ScopeDataRow[]>([]);
  const [templateFactors, setTemplateFactors] = useState<TemplateFactor[]>([]);
  const [methodologyDefaults, setMethodologyDefaults] = useState<MethodologyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [jobData, setJobData] = useState<{
    reporting_period_start?: string | null;
    client_db_id?: number | null;
    addr_country?: string | null;
    billing_addr_country?: string | null;
    status?: string | null;
  } | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [fileLinks, setFileLinks] = useState<Record<number, { file_id: number; file_name: string; portal_visible: boolean }>>({});
  const [methodologyCountry, setMethodologyCountry] = useState<string>("UK");
  const [previousYearRows, setPreviousYearRows] = useState<PreviousYearRow[]>([]);
  const [previousYearLoading, setPreviousYearLoading] = useState(false);
  const [previousYearError, setPreviousYearError] = useState("");
  const [showDebugModal, setShowDebugModal] = useState(false);
  const [debugRows, setDebugRows] = useState<ScopeDataDebugRow[]>([]);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugError, setDebugError] = useState("");
  const [debugSearch, setDebugSearch] = useState("");
  const [selectedScope, setSelectedScope] = useState<string>("All");
  const [confidenceFilter, setConfidenceFilter] = useState<string>("All");
  const [siteFilter, setSiteFilter] = useState<string>("All");
  const [categoryFilter, setCategoryFilter] = useState<string>("All");
  const [monthlyCompletenessFilter, setMonthlyCompletenessFilter] = useState<string>("All");
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
  const [factorCategoryFilter, setFactorCategoryFilter] = useState<string>("All");
  const [factorCategoryOptions, setFactorCategoryOptions] = useState<string[]>([]);
  const [topFactors, setTopFactors] = useState<TemplateFactor[]>([]);
  const [regNumber, setRegNumber] = useState("");
  const [regLookupLoading, setRegLookupLoading] = useState(false);
  const [regLookupError, setRegLookupError] = useState("");
  const [addingFactorId, setAddingFactorId] = useState<string | null>(null);
  const [addingPreviousRowId, setAddingPreviousRowId] = useState<number | null>(null);
  const [selectedPreviousRowIds, setSelectedPreviousRowIds] = useState<Set<number>>(new Set());
  const [bulkAdding, setBulkAdding] = useState(false);
  const [factorsLoading, setFactorsLoading] = useState(false);
  const [factorsOffset, setFactorsOffset] = useState(0);
  const [factorsTotal, setFactorsTotal] = useState(0);
  const [factorsHasMore, setFactorsHasMore] = useState(false);
  const [loadingMoreFactors, setLoadingMoreFactors] = useState(false);
  const [autoAddTd, setAutoAddTd] = useState(true);
  
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
  const [monthlyValues, setMonthlyValues] = useState<string[]>(Array(12).fill(""));
  const [rowDetailCache, setRowDetailCache] = useState<Record<number, ScopeDataRow>>({});
  const [monthlyDetailLoadingRowId, setMonthlyDetailLoadingRowId] = useState<number | null>(null);
  const [monthlyDetailError, setMonthlyDetailError] = useState("");
  const [detailTab, setDetailTab] = useState("metadata");
  const [showRowEditorModal, setShowRowEditorModal] = useState(false);
  const [rowEditorRow, setRowEditorRow] = useState<ScopeDataRow | null>(null);
  const [rowEditorSiteId, setRowEditorSiteId] = useState<string>("");
  const [rowEditorCategory, setRowEditorCategory] = useState<string>("");
  const [rowEditorDataSource, setRowEditorDataSource] = useState<string>("");
  const [rowEditorNotes, setRowEditorNotes] = useState<string>("");
  const [rowEditorSelectedFactor, setRowEditorSelectedFactor] = useState<TemplateFactor | null>(null);
  const [rowEditorSaving, setRowEditorSaving] = useState(false);
  const [rowEditorError, setRowEditorError] = useState("");
  const [deletingRowId, setDeletingRowId] = useState<number | null>(null);
  const [pendingSaveRowIds, setPendingSaveRowIds] = useState<Set<number>>(new Set());
  const [dirtyRowIds, setDirtyRowIds] = useState<Set<number>>(new Set());
  const hasUnsavedChanges = dirtyRowIds.size > 0;

  function markRowDirty(rowId: number) {
    setDirtyRowIds((prev) => {
      if (prev.has(rowId)) return prev;
      const next = new Set(prev);
      next.add(rowId);
      return next;
    });
  }

  function clearRowDirty(rowId: number) {
    setDirtyRowIds((prev) => {
      if (!prev.has(rowId)) return prev;
      const next = new Set(prev);
      next.delete(rowId);
      return next;
    });
  }

  function markRowSaving(rowId: number, saving: boolean) {
    setPendingSaveRowIds((prev) => {
      const next = new Set(prev);
      if (saving) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  }

  function recalculateRowEmissions(row: ScopeDataRow, patch: Partial<ScopeDataRow>): ScopeDataRow {
    const nextRow = { ...row, ...patch };
    const nextQty = patch.qty !== undefined ? Number(patch.qty ?? 0) : Number(nextRow.qty ?? 0);
    const nextApply = patch.apply_pct !== undefined ? Number(patch.apply_pct ?? 100) : Number(nextRow.apply_pct ?? 100);
    const nextGhgUnit = patch.ghg_unit !== undefined ? patch.ghg_unit : nextRow.ghg_unit;

    let nextBefore = Number(nextRow.tco2e_before_apply ?? 0);
    const currentQty = Number(row.qty ?? 0);
    const factorValue = row.factor;
    const hasFactor = factorValue !== null && factorValue !== undefined && Number.isFinite(Number(factorValue));
    const factor = hasFactor ? Number(factorValue) : null;
    if (patch.qty !== undefined) {
      if (factor !== null) {
        nextBefore = nextQty * factor;
        if (isKgBasedUnit(nextGhgUnit)) {
          nextBefore /= 1000.0;
        }
      } else if (currentQty !== 0) {
        nextBefore = Number(row.tco2e_before_apply ?? 0) * (nextQty / currentQty);
      } else {
        nextBefore = Number(row.tco2e_before_apply ?? 0);
      }
    }

    const nextCalc = nextBefore * (nextApply / 100);
    return {
      ...nextRow,
      qty: patch.qty !== undefined ? patch.qty : nextRow.qty,
      apply_pct: patch.apply_pct !== undefined ? nextApply : nextRow.apply_pct,
      tco2e_before_apply: nextBefore,
      calc_tco2e: nextCalc,
    };
  }

  function replaceScopeDataRow(rowId: number, patch: Partial<ScopeDataRow>) {
    setScopeData((prev) => prev.map((row) => (row.row_id === rowId ? recalculateRowEmissions(row, patch) : row)));
  }

  function replaceScopeDataRowFromServer(updatedRow: ScopeDataRow) {
    setScopeData((prev) => prev.map((row) => (row.row_id === updatedRow.row_id ? { ...row, ...updatedRow } : row)));
  }

  function invalidateRowDetailCache(rowId: number) {
    setRowDetailCache((prev) => {
      if (!(rowId in prev)) return prev;
      const next = { ...prev };
      delete next[rowId];
      return next;
    });
  }

  function removeScopeDataRow(rowId: number) {
    setScopeData((prev) => prev.filter((row) => row.row_id !== rowId));
  }

  async function refreshScopeDataRow(rowId: number) {
    try {
      const res = await fetch(`${effectiveBaseUrl}/jobs/${jobId}/scope-data?row_id=${rowId}`, { credentials: "include" });
      if (!res.ok) return;
      const json = await res.json().catch(() => ({}));
      const row = Array.isArray(json?.rows) ? (json.rows[0] as ScopeDataRow | undefined) : undefined;
      if (row) {
        replaceScopeDataRowFromServer(row);
        invalidateRowDetailCache(rowId);
      }
    } catch {
      // Best-effort refresh of a cascaded sibling row; a full reload will still show it correctly.
    }
  }

  async function refreshScopeTotals() {
    try {
      const res = await fetch(`${effectiveBaseUrl}/jobs/${jobId}/scope-totals`, { credentials: "include" });
      if (res.ok) {
        const totalsData = await res.json();
        setScopeTotals(totalsData);
      }
    } catch (e) {
      console.error("Error refreshing scope totals:", e);
    }
  }

  function resetDataEntryFilters() {
    setSearchQuery("");
    setSelectedScope("All");
    setConfidenceFilter("All");
    setSiteFilter("All");
    setCategoryFilter("All");
    setMonthlyCompletenessFilter("All");
  }

  useEffect(() => {
    loadData();
  }, [jobId]);

  useEffect(() => {
    const handleRefresh = (event: Event) => {
      const detail = event instanceof CustomEvent ? (event.detail as { source?: string } | undefined) : undefined;
      if (detail?.source === "job-data-entry") return;
      void loadData();
    };
    window.addEventListener(JOB_SCOPE_REFRESH_EVENT, handleRefresh);
    return () => window.removeEventListener(JOB_SCOPE_REFRESH_EVENT, handleRefresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  async function loadData() {
    setLoading(true);
    setError("");
    setDeletingRowId(null);
    setPendingSaveRowIds(new Set());
    setDirtyRowIds(new Set());
    setRowDetailCache({});
    
    try {
      // Only load essential data on initial load (not template factors)
      const [totalsRes, dataRes, jobRes, previousRowsRes, fileLinksRes] = await Promise.all([
        fetch(`${effectiveBaseUrl}/jobs/${jobId}/scope-totals`, { credentials: "include" }),
        fetch(`${effectiveBaseUrl}/jobs/${jobId}/scope-data`, { credentials: "include" }),
        fetch(`${effectiveBaseUrl}/jobs/${jobId}`, { credentials: "include" }),
        fetch(`${effectiveBaseUrl}/jobs/${jobId}/previous-scope-rows?limit=50`, { credentials: "include" }),
        fetch(`${effectiveBaseUrl}/jobs/${jobId}/files/row-links`, { credentials: "include" }),
      ]);

      if (fileLinksRes.ok) {
        const linksJson = await fileLinksRes.json() as { links: Record<string, { file_id: number; file_name: string; portal_visible: boolean }> };
        const byRowId: Record<number, { file_id: number; file_name: string; portal_visible: boolean }> = {};
        for (const [rid, link] of Object.entries(linksJson.links || {})) byRowId[Number(rid)] = link;
        setFileLinks(byRowId);
      }

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
            const [clientRes, sitesRes] = await Promise.all([
              fetch(`${effectiveBaseUrl}/clients/${jobJson.client_db_id}`, { credentials: "include" }),
              fetch(`${effectiveBaseUrl}/clients/${jobJson.client_db_id}/sites`, { credentials: "include" }),
            ]);
            if (clientRes.ok) {
              const clientJson = await clientRes.json();
              setJobData((current) => ({
                ...(current || jobJson),
                addr_country: clientJson.addr_country || null,
                billing_addr_country: clientJson.billing_addr_country || null,
              }));
              const resolvedCountry = normalizeMethodologyCountry(
                clientJson?.addr_country || clientJson?.billing_addr_country || "UK",
              );
              setMethodologyCountry(resolvedCountry);
              await loadMethodologyDefaults(resolvedCountry);
            } else {
              setMethodologyCountry("UK");
              await loadMethodologyDefaults("UK");
            }
            if (sitesRes.ok) {
              const sitesData = await sitesRes.json();
              const activeSites: Site[] = sitesData.active_sites || [];
              setSites(activeSites);
              const regOffice = activeSites.find((s) => s.is_registered_office);
              if (regOffice) setSiteFilter(String(regOffice.site_id));
            }
          } catch (e) {
            console.error("Error loading sites:", e);
            setMethodologyCountry("UK");
            await loadMethodologyDefaults("UK");
          }
        }
      } else {
        setMethodologyCountry("UK");
        await loadMethodologyDefaults("UK");
      }

      if (previousRowsRes.ok) {
        const previousRowsJson = await previousRowsRes.json();
        setPreviousYearRows(previousRowsJson.rows || []);
        setPreviousYearError("");
      } else {
        const details = await previousRowsRes.text().catch(() => "");
        setPreviousYearRows([]);
        setPreviousYearError(details || "Failed to load previous-year rows");
      }
    } catch (e) {
      console.error("Error loading data:", e);
      setError((e as Error).message);
      setPreviousYearRows([]);
      setPreviousYearError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadTemplateFactors(reset = true) {
    if (reset) {
      setTemplateFactors([]);
      setFactorsOffset(0);
      setFactorCategoryOptions([]);
    }
    
    setFactorsLoading(true);
    try {
      const offset = reset ? 0 : factorsOffset;
      const scopeParam = factorScopeFilter !== "All" ? `&scope=${encodeURIComponent(factorScopeFilter)}` : "";
      const categoryParam = factorCategoryFilter !== "All" ? `&category=${encodeURIComponent(factorCategoryFilter)}` : "";
      const searchParam = factorSearchQuery ? `&search=${encodeURIComponent(factorSearchQuery)}` : "";
      
      const factorsRes = await fetch(
        `${effectiveBaseUrl}/jobs/${jobId}/template-factors?limit=50&offset=${offset}${scopeParam}${categoryParam}${searchParam}`,
        { credentials: "include" }
      );
      
      if (factorsRes.ok) {
        const factorsData = await factorsRes.json();
        setTemplateFactors(reset ? factorsData.factors || [] : [...templateFactors, ...(factorsData.factors || [])]);
        setFactorsTotal(factorsData.total || 0);
        setFactorsHasMore(factorsData.has_more || false);
        setFactorsOffset(offset + (factorsData.factors?.length || 0));
        setFactorCategoryOptions(Array.from(new Set([...(factorsData.category_options || [])])).filter(Boolean).sort((a: string, b: string) => a.localeCompare(b)));
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

  async function loadTopFactors(category: string) {
    if (!category || category === "All") {
      setTopFactors([]);
      return;
    }
    try {
      const res = await fetch(
        `${effectiveBaseUrl}/jobs/${jobId}/template-factors/top?category=${encodeURIComponent(category)}`,
        { credentials: "include" }
      );
      if (res.ok) {
        const data = await res.json();
        const items: { scope: string | null; category: string | null; report_label: string | null; original_id: string | null; uom: string | null }[] =
          data.items || [];
        setTopFactors(
          items.map((item) => ({
            scope: item.scope || "",
            category: item.category || "",
            report_label: item.report_label || "",
            original_id: item.original_id || "",
            uom: item.uom || "",
            dataset_id: null,
            factor_db_id: null,
            factor: null,
            ghg_unit: null,
          }))
        );
      } else {
        setTopFactors([]);
      }
    } catch {
      setTopFactors([]);
    }
  }

  useEffect(() => {
    if (showFactorBrowser) void loadTopFactors(factorCategoryFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFactorBrowser, factorCategoryFilter]);

  useUnsavedChangesGuard(hasUnsavedChanges);

  async function loadMethodologyDefaults(country: string) {
    const countryValue = normalizeMethodologyCountry(country);
    try {
      const params = new URLSearchParams();
      params.set("country", countryValue);
      params.set("default_only", "true");
      params.set("limit", "500");

      const res = await fetch(`${effectiveBaseUrl}/methodology/rows?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        setMethodologyDefaults([]);
        return;
      }
      const json = await res.json().catch(() => ({}));
      setMethodologyDefaults(Array.isArray(json?.items) ? json.items : []);
    } catch (e) {
      console.error("Error loading methodology defaults:", e);
      setMethodologyDefaults([]);
    }
  }

  async function loadMoreFactors() {
    if (loadingMoreFactors || !factorsHasMore) return;
    
    setLoadingMoreFactors(true);
    try {
      const scopeParam = factorScopeFilter !== "All" ? `&scope=${encodeURIComponent(factorScopeFilter)}` : "";
      const categoryParam = factorCategoryFilter !== "All" ? `&category=${encodeURIComponent(factorCategoryFilter)}` : "";
      const searchParam = factorSearchQuery ? `&search=${encodeURIComponent(factorSearchQuery)}` : "";
      
      const factorsRes = await fetch(
        `${effectiveBaseUrl}/jobs/${jobId}/template-factors?limit=50&offset=${factorsOffset}${scopeParam}${categoryParam}${searchParam}`,
        { credentials: "include" }
      );
      
      if (factorsRes.ok) {
        const factorsData = await factorsRes.json();
        setTemplateFactors([...templateFactors, ...(factorsData.factors || [])]);
        setFactorsTotal(factorsData.total || 0);
        setFactorsHasMore(factorsData.has_more || false);
        setFactorsOffset(factorsOffset + (factorsData.factors?.length || 0));
        if (Array.isArray(factorsData.category_options)) {
          setFactorCategoryOptions((prev) =>
            Array.from(new Set([...prev, ...factorsData.category_options])).filter(Boolean).sort((a: string, b: string) => a.localeCompare(b))
          );
        }
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

  async function loadPreviousYearRows() {
    setPreviousYearLoading(true);
    try {
      const previousRowsRes = await fetch(`${effectiveBaseUrl}/jobs/${jobId}/previous-scope-rows?limit=50`, {
        credentials: "include",
      });
      if (previousRowsRes.ok) {
        const previousRowsJson = await previousRowsRes.json();
        setPreviousYearRows(previousRowsJson.rows || []);
        setPreviousYearError("");
      } else {
        const details = await previousRowsRes.text().catch(() => "");
        const normalizedDetails = details.trim();
        const isNotFound =
          previousRowsRes.status === 404 ||
          normalizedDetails === '{"detail":"Not Found"}' ||
          normalizedDetails === '{"detail": "Not Found"}';
        setPreviousYearRows([]);
        setPreviousYearError(isNotFound ? "" : normalizedDetails || "Failed to load previous-year rows");
      }
    } catch (e) {
      setPreviousYearRows([]);
      setPreviousYearError((e as Error).message);
    } finally {
      setPreviousYearLoading(false);
    }
  }

  async function loadDebugRows() {
    setDebugLoading(true);
    setDebugError("");
    try {
      const res = await fetch(`${effectiveBaseUrl}/jobs/${jobId}/scope-data?include_disabled=true`, {
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed to load debug rows (${res.status})${text ? `: ${text}` : ""}`);
      }
      const json = await res.json();
      setDebugRows(Array.isArray(json?.rows) ? json.rows : []);
    } catch (e) {
      setDebugError((e as Error).message);
      setDebugRows([]);
    } finally {
      setDebugLoading(false);
    }
  }

  function openDebugModal() {
    setShowDebugModal(true);
    setDebugSearch("");
    void loadDebugRows();
  }

  function normalizeDisplayValue(value?: string | null): string {
    const normalized = String(value || "").trim().replace(/\s+/g, " ");
    if (!normalized) return "";
    const lower = normalized.toLowerCase();
    if (lower === "nan" || lower === "none" || lower === "null" || lower === "n/a") return "";
    return normalized;
  }

  function normalizeMethodologyCountry(value?: string | null): string {
    const normalized = normalizeDisplayValue(value);
    if (!normalized) return "UK";
    const compact = normalized.toLowerCase().replace(/[\s._-]+/g, "");
    if (compact === "uk" || compact === "gb" || compact === "unitedkingdom" || compact === "greatbritain") {
      return "UK";
    }
    return normalized;
  }

  const uniqueDisplayParts = useCallback((values: Array<string | null | undefined>): string[] => {
    const seen = new Set<string>();
    const parts: string[] = [];
    for (const value of values) {
      const normalized = normalizeDisplayValue(value);
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(normalized);
    }
    return parts;
  }, []);

  const multiTokenMatch = useCallback((searchText: string, values: Array<string | null | undefined>): boolean => {
    const tokens = searchText
      .toLowerCase()
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean);
    if (!tokens.length) return true;
    const haystack = values
      .map((value) => normalizeDisplayValue(value).toLowerCase())
      .filter(Boolean)
      .join(" ");
    return tokens.every((token) => haystack.includes(token));
  }, []);

  const rowDisplayTitle = useCallback((row: ScopeDataRow | PreviousYearRow): string => {
    return normalizeDisplayValue(row.report_label) || normalizeDisplayValue(row.column_text) || normalizeDisplayValue(row.original_id) || "Row";
  }, []);

  const rowDisplaySubtitle = useCallback((row: ScopeDataRow | PreviousYearRow): string => {
    return uniqueDisplayParts([
      row.category,
      row.level_4,
      row.level_3,
      row.level_2,
      row.level_1,
      row.uom,
    ]).join(" • ");
  }, [uniqueDisplayParts]);

  async function updateQuantity(rowId: number, newQty: number | null) {
    return updateField(rowId, { qty: newQty });
  }

  function startEditQty(row: ScopeDataRow) {
    setEditingRowId(row.row_id);
    setEditingQty(row.qty !== null ? String(row.qty) : "");
    markRowDirty(row.row_id);
  }

  async function saveEditQty(rowId: number) {
    const qty = editingQty.trim() ? parseFloat(editingQty) : null;
    const saved = await updateQuantity(rowId, qty);
    if (saved) {
      setEditingRowId(null);
      setEditingQty("");
      clearRowDirty(rowId);
    }
  }

  function cancelEditQty(rowId?: number) {
    if (rowId !== undefined && rowId !== null) {
      clearRowDirty(rowId);
    } else if (editingRowId !== null) {
      clearRowDirty(editingRowId);
    }
    setEditingRowId(null);
    setEditingQty("");
    setEditingField(null);
  }

  function startEditApply(row: ScopeDataRow) {
    setEditingRowId(row.row_id);
    setEditingField("apply");
    setEditingApply(String(row.apply_pct));
    markRowDirty(row.row_id);
  }

  async function saveEditApply(rowId: number) {
    const apply = editingApply.trim() ? parseFloat(editingApply) : 100;
    const saved = await updateField(rowId, { apply_pct: apply });
    if (saved) {
      setEditingRowId(null);
      setEditingApply("");
      setEditingField(null);
      clearRowDirty(rowId);
    }
  }

  function startEditSource(row: ScopeDataRow) {
    setEditingRowId(row.row_id);
    setEditingField("source");
    setEditingSource(row.data_source || "Company Data");
    markRowDirty(row.row_id);
  }

  async function saveEditSource(rowId: number) {
    const saved = await updateField(rowId, { data_source: editingSource.trim() || "Company Data" });
    if (saved) {
      setEditingRowId(null);
      setEditingSource("");
      setEditingField(null);
      clearRowDirty(rowId);
    }
  }

  function startEditConfidence(row: ScopeDataRow) {
    setEditingRowId(row.row_id);
    setEditingField("confidence");
    setEditingConfidence((row.data_confidence || "M").toUpperCase());
    markRowDirty(row.row_id);
  }

  async function saveEditConfidence(rowId: number) {
    const value = (editingConfidence || "M").toUpperCase();
    const normalized = value === "H" || value === "L" ? value : "M";
    const saved = await updateField(rowId, { data_confidence: normalized });
    if (saved) {
      setEditingRowId(null);
      setEditingField(null);
      setEditingConfidence("M");
      clearRowDirty(rowId);
    }
  }

  function startEditNotes(row: ScopeDataRow) {
    setEditingRowId(row.row_id);
    setEditingField("notes");
    setEditingNotes(row.notes || "");
    markRowDirty(row.row_id);
  }

  async function saveEditNotes(rowId: number) {
    const saved = await updateField(rowId, { notes: editingNotes.trim() });
    if (saved) {
      setEditingRowId(null);
      setEditingNotes("");
      setEditingField(null);
      clearRowDirty(rowId);
    }
  }

  async function updateField(rowId: number, fields: Record<string, unknown>) {
    markRowSaving(rowId, true);
    try {
      const res = await fetch(`${effectiveBaseUrl}/jobs/${jobId}/scope-data/${rowId}`, {
        method: "PATCH",
        headers: withAuditHeaders(
          { "Content-Type": "application/json" },
          { page: "Jobs", section: "Data Entry", container: "Scope Data Row" }
        ),
        credentials: "include",
        body: JSON.stringify(fields),
      });

      if (res.ok) {
        const result = await res.json().catch(() => ({}));
        replaceScopeDataRow(rowId, fields);
        invalidateRowDetailCache(rowId);
        clearRowDirty(rowId);
        await refreshScopeTotals();
        dispatchJobScopeRefresh("job-data-entry");
        if (result?.cascaded_row_id) {
          await refreshScopeDataRow(result.cascaded_row_id);
        }
        return true;
      }

      const text = await res.text();
      let message = text;
      try {
        const parsed = JSON.parse(text);
        if (typeof parsed?.detail === "string") {
          message = parsed.detail;
        } else if (parsed?.detail && typeof parsed.detail === "object" && typeof parsed.detail.message === "string") {
          message = parsed.detail.message;
        }
      } catch {
        // Fall back to raw response text.
      }
      setError(`Update failed: ${message}`);
      return false;
    } catch (e) {
      setError((e as Error).message);
      await loadData();
      return false;
    } finally {
      markRowSaving(rowId, false);
    }
  }

  function openMonthlyModal(row: ScopeDataRow) {
    setMonthlyDetailError("");
    const cachedRow = rowDetailCache[row.row_id] || row;
    setMonthlyEditRow(cachedRow);
    setDetailTab("monthly");
    // Initialize monthly values from row data
    const months = [
      cachedRow.month_1 ?? "", cachedRow.month_2 ?? "", cachedRow.month_3 ?? "",
      cachedRow.month_4 ?? "", cachedRow.month_5 ?? "", cachedRow.month_6 ?? "",
      cachedRow.month_7 ?? "", cachedRow.month_8 ?? "", cachedRow.month_9 ?? "",
      cachedRow.month_10 ?? "", cachedRow.month_11 ?? "", cachedRow.month_12 ?? "",
    ];
    setMonthlyValues(months.map((value) => (value === null || value === undefined ? "" : String(value))));
    setShowMonthlyModal(true);
    void loadRowDetail(row.row_id);
  }

  function rowToTemplateFactor(row: ScopeDataRow): TemplateFactor {
    return {
      scope: row.scope,
      category: row.category || row.dataset_category || row.lookup_category || row.level_1 || "",
      report_label: row.report_label || row.column_text || row.original_id || "",
      original_id: row.original_id,
      uom: row.uom || "",
      dataset_id: row.dataset_id ?? null,
      factor_db_id: row.factor_db_id ?? null,
      factor: row.factor ?? null,
      ghg_unit: row.ghg_unit ?? null,
      level_1: row.level_1 ?? null,
      level_2: row.level_2 ?? null,
      level_3: row.level_3 ?? null,
      level_4: row.level_4 ?? null,
      column_text: row.column_text ?? null,
      is_custom: Boolean(row.is_custom_entry),
    };
  }

  function openRowEditorModal(row: ScopeDataRow) {
    setShowFactorBrowser(false);
    setRowEditorRow(row);
    setRowEditorSiteId(row.site_id !== null && row.site_id !== undefined ? String(row.site_id) : "none");
    setRowEditorCategory(row.category || row.dataset_category || row.lookup_category || row.level_1 || "");
    setRowEditorDataSource(row.data_source || "Company Data");
    setRowEditorNotes(row.notes || "");
    setRowEditorSelectedFactor(rowToTemplateFactor(row));
    setRowEditorError("");
    setShowRowEditorModal(true);
    if (!templateFactors.length && !factorsLoading) {
      void loadTemplateFactors(true);
    }
    void loadRowDetail(row.row_id);
  }

  function closeRowEditorModal() {
    setShowRowEditorModal(false);
    setRowEditorRow(null);
    setRowEditorSiteId("");
    setRowEditorCategory("");
    setRowEditorDataSource("");
    setRowEditorNotes("");
    setRowEditorSelectedFactor(null);
    setRowEditorError("");
    setRowEditorSaving(false);
  }

  async function saveRowEditor() {
    if (!rowEditorRow) return;
    if (!rowEditorSelectedFactor) {
      setRowEditorError("Choose a replacement factor before saving.");
      return;
    }

    const siteId =
      rowEditorSiteId.trim() === "" || rowEditorSiteId === "none"
        ? null
        : Number.isNaN(Number(rowEditorSiteId))
          ? null
          : parseInt(rowEditorSiteId, 10);

    if (rowEditorSiteId.trim() !== "" && siteId === null) {
      setRowEditorError("Site must be a valid number.");
      return;
    }

    setRowEditorSaving(true);
    setRowEditorError("");
    try {
      const payload = {
        original_id: rowEditorSelectedFactor.original_id,
        dataset_id: rowEditorSelectedFactor.dataset_id,
        factor_db_id: rowEditorSelectedFactor.factor_db_id,
        factor: rowEditorSelectedFactor.factor,
        ghg_unit: rowEditorSelectedFactor.ghg_unit,
        uom: rowEditorSelectedFactor.uom,
        report_label: rowEditorSelectedFactor.report_label || null,
        level_1: rowEditorSelectedFactor.level_1 ?? null,
        level_2: rowEditorSelectedFactor.level_2 ?? null,
        level_3: rowEditorSelectedFactor.level_3 ?? null,
        level_4: rowEditorSelectedFactor.level_4 ?? null,
        column_text: rowEditorSelectedFactor.column_text ?? null,
        site_id: siteId,
        category: rowEditorCategory.trim() || null,
        data_source: rowEditorDataSource.trim() || "Company Data",
        notes: rowEditorNotes.trim() || null,
      };

      const res = await fetch(`${effectiveBaseUrl}/jobs/${jobId}/scope-data/${rowEditorRow.row_id}/repoint`, {
        method: "POST",
        headers: withAuditHeaders(
          { "Content-Type": "application/json" },
          { page: "Jobs", section: "Data Entry", container: "Row Editor" }
        ),
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        let message = text;
        try {
          const parsed = JSON.parse(text);
          if (typeof parsed?.detail === "string") {
            message = parsed.detail;
          } else if (parsed?.detail && typeof parsed.detail === "object" && typeof parsed.detail.message === "string") {
            message = parsed.detail.message;
          }
        } catch {
          // Fall back to raw response text.
        }
        setRowEditorError(message || "Failed to repoint row.");
        return;
      }

      const result = await res.json();
      if (result?.row) {
        replaceScopeDataRowFromServer(result.row as ScopeDataRow);
        invalidateRowDetailCache(rowEditorRow.row_id);
      } else {
        await loadData();
      }
      clearRowDirty(rowEditorRow.row_id);
      await refreshScopeTotals();
      dispatchJobScopeRefresh("job-data-entry");
      closeRowEditorModal();
    } catch (e) {
      setRowEditorError((e as Error).message);
    } finally {
      setRowEditorSaving(false);
    }
  }

  function closeMonthlyModal() {
    setShowMonthlyModal(false);
    setMonthlyEditRow(null);
    setMonthlyValues(Array(12).fill(""));
    setMonthlyDetailError("");
    setDetailTab("monthly");
  }

  function updateMonthlyValue(monthIndex: number, value: string) {
    const newValues = [...monthlyValues];
    newValues[monthIndex] = value;
    setMonthlyValues(newValues);
  }

  function getMonthlySum(): number {
    return monthlyValues.reduce((sum, val) => {
      const parsed = val.trim() === "" ? 0 : Number(val);
      return sum + (Number.isFinite(parsed) ? parsed : 0);
    }, 0);
  }

  function parseMonthlyValue(value: string): number | null {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
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
    const firstValue = monthlyValues[getMonthIndex(0)] ?? "";
    const newValues = Array(12).fill(firstValue);
    setMonthlyValues(newValues);
  }

  async function saveMonthlyData() {
    if (!monthlyEditRow) return;

    const monthlySum = getMonthlySum();
    const fields: Record<string, number | null> = {
      month_1: parseMonthlyValue(monthlyValues[0]),
      month_2: parseMonthlyValue(monthlyValues[1]),
      month_3: parseMonthlyValue(monthlyValues[2]),
      month_4: parseMonthlyValue(monthlyValues[3]),
      month_5: parseMonthlyValue(monthlyValues[4]),
      month_6: parseMonthlyValue(monthlyValues[5]),
      month_7: parseMonthlyValue(monthlyValues[6]),
      month_8: parseMonthlyValue(monthlyValues[7]),
      month_9: parseMonthlyValue(monthlyValues[8]),
      month_10: parseMonthlyValue(monthlyValues[9]),
      month_11: parseMonthlyValue(monthlyValues[10]),
      month_12: parseMonthlyValue(monthlyValues[11]),
    };

    // If annual qty is not set or monthly sum is different, update qty to match monthly sum
    if (!monthlyEditRow.qty || Math.abs(monthlyEditRow.qty - monthlySum) > 0.01) {
      fields.qty = monthlySum;
    }

    const saved = await updateField(monthlyEditRow.row_id, fields);
    if (saved) {
      clearRowDirty(monthlyEditRow.row_id);
      invalidateRowDetailCache(monthlyEditRow.row_id);
      closeMonthlyModal();
    }
  }

  async function loadRowDetail(rowId: number) {
    if (rowDetailCache[rowId]) {
      return rowDetailCache[rowId];
    }
    setMonthlyDetailLoadingRowId(rowId);
    setMonthlyDetailError("");
    try {
      const res = await fetch(
        `${effectiveBaseUrl}/jobs/${jobId}/scope-data?row_id=${rowId}&include_monthly_details=true`,
        { credentials: "include" }
      );

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed to load monthly detail (${res.status})${text ? `: ${text}` : ""}`);
      }

      const json = await res.json().catch(() => ({}));
      const detailRow = Array.isArray(json?.rows) ? (json.rows[0] as ScopeDataRow | undefined) : undefined;
      if (detailRow) {
        setRowDetailCache((prev) => ({ ...prev, [rowId]: detailRow }));
        if (monthlyEditRow?.row_id === rowId) {
          setMonthlyEditRow(detailRow);
          setMonthlyValues([
            detailRow.month_1 ?? "", detailRow.month_2 ?? "", detailRow.month_3 ?? "",
            detailRow.month_4 ?? "", detailRow.month_5 ?? "", detailRow.month_6 ?? "",
            detailRow.month_7 ?? "", detailRow.month_8 ?? "", detailRow.month_9 ?? "",
            detailRow.month_10 ?? "", detailRow.month_11 ?? "", detailRow.month_12 ?? "",
          ].map((value) => (value === null || value === undefined ? "" : String(value))));
        }
        return detailRow;
      } else {
        setMonthlyDetailError("Monthly detail was not returned for this row.");
      }
    } catch (e) {
      setMonthlyDetailError((e as Error).message);
    } finally {
      setMonthlyDetailLoadingRowId(null);
    }
    return null;
  }

  async function addFactorToJob(factor: TemplateFactor) {
    console.log("addFactorToJob called with factor:", factor);
    setAddingFactorId(factor.original_id);
    try {
      const payload = {
        scope: factor.scope,
        original_id: factor.original_id,
        category: factor.category,
        level_1: factor.level_1 ?? null,
        level_2: factor.level_2 ?? null,
        level_3: factor.level_3 ?? null,
        level_4: factor.level_4 ?? null,
        column_text: factor.column_text ?? null,
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
        site_id: siteFilter !== "All" ? parseInt(siteFilter) : null,
        auto_add_td: autoAddTd,
      };

      console.log("Sending payload:", payload);
      
      const res = await fetch(`${effectiveBaseUrl}/jobs/${jobId}/scope-data`, {
        method: "POST",
        headers: withAuditHeaders(
          { "Content-Type": "application/json" },
          { page: "Jobs", section: "Data Entry", container: "Browse & Add Factors" }
        ),
        credentials: "include",
        body: JSON.stringify(payload),
      });

      console.log("Response status:", res.status);

      if (res.ok) {
        const result = await res.json();
        console.log("Factor added successfully:", result);
        await loadData();
        dispatchJobScopeRefresh("job-data-entry");
        setError(result?.td_pair_warning || "");
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

  async function lookupVehicleByRegistration() {
    if (!regNumber.trim()) return;
    setRegLookupLoading(true);
    setRegLookupError("");
    try {
      const res = await fetch(`${effectiveBaseUrl}/jobs/${jobId}/vehicle-lookup`, {
        method: "POST",
        headers: withAuditHeaders(
          { "Content-Type": "application/json" },
          { page: "Jobs", section: "Data Entry", container: "Browse & Add Factors" }
        ),
        credentials: "include",
        body: JSON.stringify({ registration_number: regNumber }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.factor) {
        setRegNumber("");
        await addFactorToJob(d.factor as TemplateFactor);
      } else {
        setRegLookupError(d?.detail || "Couldn't look up that registration.");
      }
    } catch (e) {
      setRegLookupError((e as Error).message);
    } finally {
      setRegLookupLoading(false);
    }
  }

  async function addPreviousYearRowToJob(row: PreviousYearRow) {
    setAddingPreviousRowId(row.row_id);
    try {
      const payload = {
        scope: row.scope,
        original_id: row.original_id,
        category: row.category,
        level_1: row.level_1 ?? null,
        level_2: row.level_2 ?? null,
        level_3: row.level_3 ?? null,
        level_4: row.level_4 ?? null,
        column_text: row.column_text ?? null,
        report_label: row.report_label,
        uom: row.uom,
        factor: row.factor,
        ghg_unit: row.ghg_unit,
        dataset_id: row.dataset_id,
        factor_db_id: row.factor_db_id,
        qty: 0,
        apply_pct: 100,
        data_source: "Company Data",
        data_confidence: row.data_confidence || "M",
        is_custom_entry: false,
        site_id: siteFilter !== "All" ? parseInt(siteFilter) : null,
        auto_add_td: autoAddTd,
      };

      const res = await fetch(`${effectiveBaseUrl}/jobs/${jobId}/scope-data`, {
        method: "POST",
        headers: withAuditHeaders(
          { "Content-Type": "application/json" },
          { page: "Jobs", section: "Data Entry", container: "Reuse Previous Year Rows" }
        ),
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const result = await res.json().catch(() => ({}));
        await loadData();
        dispatchJobScopeRefresh("job-data-entry");
        setError(result?.td_pair_warning || "");
      } else {
        const text = await res.text();
        setError(`Failed to add previous-year row: ${text}`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAddingPreviousRowId(null);
    }
  }

  async function addSelectedPreviousRowsToJob() {
    const rowsToAdd = filteredPreviousYearRows.filter((r) => selectedPreviousRowIds.has(r.row_id));
    if (rowsToAdd.length === 0) return;
    setBulkAdding(true);
    try {
      for (const row of rowsToAdd) {
        const payload = {
          scope: row.scope,
          original_id: row.original_id,
          category: row.category,
          level_1: row.level_1 ?? null,
          level_2: row.level_2 ?? null,
          level_3: row.level_3 ?? null,
          level_4: row.level_4 ?? null,
          column_text: row.column_text ?? null,
          report_label: row.report_label,
          uom: row.uom,
          factor: row.factor,
          ghg_unit: row.ghg_unit,
          dataset_id: row.dataset_id,
          factor_db_id: row.factor_db_id,
          qty: 0,
          apply_pct: 100,
          data_source: "Company Data",
          data_confidence: row.data_confidence || "M",
          is_custom_entry: false,
          site_id: siteFilter !== "All" ? parseInt(siteFilter) : null,
          auto_add_td: autoAddTd,
        };
        const res = await fetch(`${effectiveBaseUrl}/jobs/${jobId}/scope-data`, {
          method: "POST",
          headers: withAuditHeaders(
            { "Content-Type": "application/json" },
            { page: "Jobs", section: "Data Entry", container: "Reuse Previous Year Rows" }
          ),
          credentials: "include",
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const text = await res.text();
          setError(`Failed to add row "${row.report_label}": ${text}`);
          break;
        }
      }
      setSelectedPreviousRowIds(new Set());
      await loadData();
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBulkAdding(false);
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

    setDeletingRowId(rowId);
    try {
      const res = await fetch(`${effectiveBaseUrl}/jobs/${jobId}/scope-data/${rowId}`, {
        method: "DELETE",
        headers: withAuditHeaders(undefined, {
          page: "Jobs",
          section: "Data Entry",
          container: "Scope Data Row",
        }),
        credentials: "include",
      });

      if (res.ok) {
        const result = await res.json().catch(() => ({}));
        removeScopeDataRow(rowId);
        clearRowDirty(rowId);
        if (result?.cascaded_row_id) {
          // The shared T&D row's total was recomputed (it may or may not
          // still exist, depending on whether other rows still link to
          // it) -- refresh it rather than assuming it was deleted too.
          await refreshScopeDataRow(result.cascaded_row_id);
        }
        const unlinkedRowIds: number[] = Array.isArray(result?.unlinked_row_ids)
          ? result.unlinked_row_ids
          : result?.unlinked_row_id
          ? [result.unlinked_row_id]
          : [];
        for (const unlinkedId of unlinkedRowIds) {
          replaceScopeDataRow(unlinkedId, { linked_row_id: null });
        }
        await refreshScopeTotals();
        dispatchJobScopeRefresh("job-data-entry");
      } else {
        const text = await res.text();
        setError(`Delete failed: ${text}`);
      }
    } catch (e) {
      setError((e as Error).message);
      await loadData();
    } finally {
      setDeletingRowId(null);
    }
  }

  function toggleRowExpanded(rowId: number) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      const willExpand = !next.has(rowId);
      if (willExpand) next.add(rowId);
      else next.delete(rowId);
      if (willExpand) {
        void loadRowDetail(rowId);
      }
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

  function isKgBasedUnit(unit?: string | null): boolean {
    return Boolean(unit && unit.replace(/\s+/g, "").toLowerCase().includes("kg"));
  }

  function unitBadgeClass(unit?: string | null, warning?: string | null): string {
    if (!unit) return "bg-slate-100 text-slate-800";
    if (isKgBasedUnit(unit) && !warning) return "bg-emerald-100 text-emerald-900";
    return "bg-amber-100 text-amber-900";
  }

  function uomBadgeClass(uom?: string | null): string {
    return uom ? "bg-sky-50 text-sky-800" : "bg-slate-100 text-slate-800";
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
      return "-";
    }
    if (row.factor !== null && row.factor !== undefined && !Number.isNaN(row.factor)) {
      return row.factor.toFixed(5);
    }
    if (row.uses_monthly_factors) {
      return row.factor_label || "Monthly factors";
    }
    return "-";
  }

  function monthlyStoredSummary(row: ScopeDataRow): string {
    const monthLabels = getOrderedMonths();
    const values = [
      row.month_1,
      row.month_2,
      row.month_3,
      row.month_4,
      row.month_5,
      row.month_6,
      row.month_7,
      row.month_8,
      row.month_9,
      row.month_10,
      row.month_11,
      row.month_12,
    ];
    const parts = values
      .map((value, index) => {
        if (value === null || value === undefined || Number.isNaN(value) || Math.abs(Number(value)) < 0.000001) {
          return null;
        }
        return `${monthLabels[index]}: ${Number(value).toFixed(2)}`;
      })
      .filter(Boolean) as string[];
    return parts.length ? parts.join(" • ") : "-";
  }

  function storageReasonText(reason: string | null | undefined): string {
    const value = String(reason || "").trim();
    if (!value) return "-";
    if (value === "multi_dataset_or_factor") return "Monthly dataset/factor fallback";
    if (value === "single_dataset_factor") return "Monthly raw quantity";
    return value.replaceAll("_", " ");
  }

  function hasLegacySourceVolume(row: ScopeDataRow): boolean {
    if (!isLegacyFallbackRow(row)) return false;
    if (row.source_volume_available !== undefined) return Boolean(row.source_volume_available);
    return Boolean(
      row.source_qty !== null &&
      row.source_qty !== undefined &&
      row.source_uom &&
      String(row.source_uom).trim()
    );
  }

  const getMonthlyFilledCount = useCallback((row: MonthlyFilterRow): number => {
    if (typeof row.previous_month_count === "number") {
      return row.previous_month_count;
    }
    const monthlyValues = [
      row.month_1,
      row.month_2,
      row.month_3,
      row.month_4,
      row.month_5,
      row.month_6,
      row.month_7,
      row.month_8,
      row.month_9,
      row.month_10,
      row.month_11,
      row.month_12,
    ];
    return monthlyValues.filter((value) => value !== null && value !== undefined).length;
  }, []);

  const matchesMonthlyCompleteness = useCallback((row: MonthlyFilterRow): boolean => {
    if (monthlyCompletenessFilter === "All") return true;
    const filledCount = getMonthlyFilledCount(row);
    if (monthlyCompletenessFilter === "Complete") return filledCount === 12;
    if (monthlyCompletenessFilter === "Partial") return filledCount > 0 && filledCount < 12;
    if (monthlyCompletenessFilter === "Empty") return filledCount === 0;
    if (monthlyCompletenessFilter === "Any") return filledCount > 0;
    return true;
  }, [getMonthlyFilledCount, monthlyCompletenessFilter]);

  const siteNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const site of sites) {
      map.set(String(site.site_id), site.site_name);
    }
    for (const row of previousYearRows) {
      if (row.site_id == null) continue;
      const key = String(row.site_id);
      if (!map.has(key) && row.site_name) {
        map.set(key, row.site_name);
      }
    }
    return map;
  }, [previousYearRows, sites]);

  const getSiteName = useCallback((siteId: number | null | undefined): string => {
    if (siteId == null) return "";
    return siteNameById.get(String(siteId)) || `Site ${siteId}`;
  }, [siteNameById]);

  const filteredData = useMemo(() => {
    return scopeData.filter((row) => {
      if (selectedScope !== "All" && row.scope !== selectedScope) return false;
      if (confidenceFilter !== "All") {
        const confidence = String(row.data_confidence || "M").toUpperCase();
        if (confidence !== confidenceFilter) return false;
      }
      if (siteFilter !== "All" && String(row.site_id ?? "") !== siteFilter) return false;
      if (categoryFilter !== "All" && String(row.dataset_category || row.lookup_category || row.level_1 || row.category || row.level_2 || "").trim() !== categoryFilter) {
        return false;
      }
      if (!matchesMonthlyCompleteness(row)) return false;
      if (searchQuery) {
        return multiTokenMatch(searchQuery, [
          rowDisplayTitle(row),
          rowDisplaySubtitle(row),
          row.dataset_category,
          row.lookup_category,
          row.category,
          row.original_id,
          row.level_1,
          row.level_2,
          row.level_3,
          row.level_4,
          row.column_text,
          getSiteName(row.site_id),
          row.data_source,
        ]);
      }
      return true;
    });
  }, [
    scopeData,
    selectedScope,
    confidenceFilter,
    siteFilter,
    categoryFilter,
    searchQuery,
    rowDisplayTitle,
    rowDisplaySubtitle,
    getSiteName,
    matchesMonthlyCompleteness,
    multiTokenMatch,
  ]);

  const filteredPreviousYearRows = useMemo(() => {
    return previousYearRows.filter((row) => {
      if (selectedScope !== "All" && row.scope !== selectedScope) return false;
      if (siteFilter !== "All" && String(row.site_id ?? "") !== siteFilter) return false;
      if (categoryFilter !== "All" && String(row.dataset_category || row.lookup_category || row.category || row.level_2 || row.level_1 || "").trim() !== categoryFilter) {
        return false;
      }
      if (!matchesMonthlyCompleteness(row)) return false;
      if (searchQuery) {
        return multiTokenMatch(searchQuery, [
          rowDisplayTitle(row),
          rowDisplaySubtitle(row),
          row.category,
          row.original_id,
          row.level_1,
          row.level_2,
          row.level_3,
          row.level_4,
          row.column_text,
          row.source_job_number,
          row.source_job_title,
          getSiteName(row.site_id),
          row.data_confidence,
        ]);
      }
      return true;
    });
  }, [
    previousYearRows,
    selectedScope,
    siteFilter,
    categoryFilter,
    searchQuery,
    rowDisplayTitle,
    rowDisplaySubtitle,
    getSiteName,
    matchesMonthlyCompleteness,
    multiTokenMatch,
  ]);

  const addedOriginalIds = useMemo(
    () => new Set(scopeData.map((r) => `${r.original_id}::${r.site_id ?? ""}`)),
    [scopeData],
  );

  const availableCategories = useMemo(() => {
    const seen = new Set<string>();
    for (const row of [...scopeData, ...previousYearRows]) {
      const category = String(
        ("dataset_category" in row ? row.dataset_category : undefined) ||
        ("lookup_category" in row ? row.lookup_category : undefined) ||
        row.level_1 ||
        row.category ||
        row.level_2 ||
        ""
      ).trim();
      if (category) seen.add(category);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [previousYearRows, scopeData]);

  const filteredDebugRows = useMemo(() => {
    return debugRows.filter((row) => {
      if (selectedScope !== "All" && row.scope !== selectedScope) return false;
      if (!debugSearch.trim()) return true;
      return multiTokenMatch(debugSearch, [
        row.scope,
        row.site_name,
        row.report_label,
        row.original_id,
        row.category,
        row.level_1,
        row.level_2,
        row.level_3,
        row.level_4,
        row.column_text,
        String(row.row_id),
        row.enabled ? "enabled" : "disabled",
      ]);
    });
  }, [debugRows, selectedScope, debugSearch, multiTokenMatch]);

  const debugDuplicateGroups = useMemo(
    () => Object.values(
      filteredDebugRows.reduce<Record<string, ScopeDataDebugRow[]>>((acc, row) => {
        const key = [
          row.site_id ?? "null",
          row.scope ?? "",
          row.original_id ?? "",
        ].join("::");
        if (!acc[key]) acc[key] = [];
        acc[key].push(row);
        return acc;
      }, {}),
    ).filter((group) => group.length > 1),
    [filteredDebugRows],
  );

  const factorDisplayTitle = useCallback((factor: TemplateFactor): string => {
    return normalizeDisplayValue(factor.report_label) || normalizeDisplayValue(factor.column_text) || normalizeDisplayValue(factor.original_id) || "Factor";
  }, []);

  const factorDisplaySubtitle = useCallback((factor: TemplateFactor): string => {
    return uniqueDisplayParts([
      factor.category,
      factor.column_text,
      factor.level_4,
      factor.level_3,
      factor.level_2,
      factor.level_1,
      factor.original_id,
      factor.source,
    ]).join(" • ");
  }, [uniqueDisplayParts]);

  const methodologyMatchesFactor = useCallback((methodology: MethodologyRow, factor: TemplateFactor): boolean => {
    const scope = normalizeDisplayValue(methodology.scope);
    if (scope && normalizeDisplayValue(factor.scope).toLowerCase() !== scope.toLowerCase()) return false;

    const category = normalizeDisplayValue(methodology.category);
    if (
      category &&
      !multiTokenMatch(category, [
        factor.category,
        factor.level_1,
        factor.level_2,
        factor.level_3,
        factor.level_4,
        factor.column_text,
      ])
    ) {
      return false;
    }

    const reportLabel = normalizeDisplayValue(methodology.report_label);
    if (
      reportLabel &&
      !multiTokenMatch(reportLabel, [
        factor.report_label,
        factor.column_text,
        factor.original_id,
        factor.source,
      ])
    ) {
      return false;
    }

    const descriptor = normalizeDisplayValue(methodology.descriptor);
    if (
      descriptor &&
      !multiTokenMatch(descriptor, [
        factor.category,
        factor.report_label,
        factor.column_text,
        factor.level_1,
        factor.level_2,
        factor.level_3,
        factor.level_4,
        factor.original_id,
        factor.source,
      ])
    ) {
      return false;
    }

    const uom = normalizeDisplayValue(methodology.uom);
    if (uom && normalizeDisplayValue(factor.uom).toLowerCase() !== uom.toLowerCase()) return false;

    const suggestedOriginalId = normalizeDisplayValue(methodology.suggested_original_id);
    if (
      suggestedOriginalId &&
      normalizeDisplayValue(factor.original_id).toLowerCase() !== suggestedOriginalId.toLowerCase()
    ) {
      return false;
    }

    const suggestedFactorDbId = methodology.suggested_factor_db_id;
    if (suggestedFactorDbId != null) {
      if (factor.factor_db_id == null) return false;
      if (Number(suggestedFactorDbId) !== Number(factor.factor_db_id)) return false;
    }

    return true;
  }, [multiTokenMatch]);

  const annotatedTemplateFactors = useMemo(() => {
    return templateFactors.map((factor) => {
      const match = methodologyDefaults.find((methodology) => methodologyMatchesFactor(methodology, factor)) || null;
      return {
        ...factor,
        methodology_default: Boolean(match),
        methodology_default_label: match
          ? uniqueDisplayParts([match.report_label, match.category, match.descriptor, match.uom]).join(" • ")
          : null,
      };
    });
  }, [templateFactors, methodologyDefaults, methodologyMatchesFactor, uniqueDisplayParts]);

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
    <div className="min-w-0 space-y-6">
      {showEmissionsSummary ? (
        <Card>
          <CardHeader>
            <CardTitle>Emissions Summary</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <LoadingOrbit className="py-8" label="Loading data summary..." />
            ) : scopeTotals ? (
              <div className="grid gap-4 md:grid-cols-4">
                <div className="space-y-1 text-center">
                  <div className="text-2xl font-bold">{scopeTotals.total.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div className="text-xs text-muted-foreground">Total tCO₂e</div>
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
      ) : null}

      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <PendingPortalSubmissions jobId={jobId} baseUrl={effectiveBaseUrl} onReviewed={loadData} />

      {/* Template Capture Action */}
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="font-medium">Add rows from template</div>
            <div className="text-sm text-muted-foreground">
              Search the emission factor library and add rows to this job.
            </div>
          </div>
          <Button
            onClick={async () => {
              if (!showFactorBrowser) {
                await loadTemplateFactors();
              }
              setShowFactorBrowser(!showFactorBrowser);
            }}
            size="lg"
            className="w-full sm:w-auto"
            disabled={factorsLoading}
          >
            {factorsLoading ? "Loading factors..." : showFactorBrowser ? "Hide factor browser" : "Add Data from Template"}{" "}
            {((factorsTotal || templateFactors.length) > 0) &&
              `(${(factorsTotal || templateFactors.length).toLocaleString()} factors available)`}
          </Button>
        </CardContent>
        {showFactorBrowser && (
          <div className="px-6 pb-6">
            <label className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={autoAddTd}
                onChange={(e) => setAutoAddTd(e.target.checked)}
                className="h-4 w-4"
              />
              Add T&D automatically for grid electricity rows
            </label>
            {(factorCategoryFilter === "Company Vehicles" || factorCategoryFilter === "Business Travel") && (
              <div className="mb-3 space-y-2 rounded-md border bg-muted/30 p-3">
                <label className="text-xs font-medium text-muted-foreground">
                  Have the vehicle&apos;s registration number? We&apos;ll work out the right category and add it directly.
                </label>
                <div className="flex gap-2">
                  <Input
                    placeholder="e.g. AB12 CDE"
                    value={regNumber}
                    onChange={(e) => setRegNumber(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void lookupVehicleByRegistration()}
                    className="max-w-xs"
                  />
                  <Button disabled={regLookupLoading || !regNumber.trim()} onClick={() => void lookupVehicleByRegistration()}>
                    {regLookupLoading ? "Looking up..." : "Look up & Add"}
                  </Button>
                </div>
                {regLookupError && <div className="text-xs text-rose-700">{regLookupError}</div>}
              </div>
            )}
            <FactorBrowserCard
              title="Browse & Add Factors"
              factorSearchQuery={factorSearchQuery}
              onFactorSearchQueryChange={setFactorSearchQuery}
              factorScopeFilter={factorScopeFilter}
              onFactorScopeFilterChange={setFactorScopeFilter}
              factorCategoryFilter={factorCategoryFilter}
              onFactorCategoryFilterChange={setFactorCategoryFilter}
              factorCategoryOptions={factorCategoryOptions}
              onSearch={() => loadTemplateFactors(true)}
              factorsLoading={factorsLoading}
              methodologyCountry={methodologyCountry}
              templateFactors={annotatedTemplateFactors}
              factorsTotal={factorsTotal}
              factorsHasMore={factorsHasMore}
              loadingMoreFactors={loadingMoreFactors}
              onLoadMore={loadMoreFactors}
              getFactorTitle={factorDisplayTitle}
              getFactorSubtitle={factorDisplaySubtitle}
              getActionProps={(factor) => ({
                label: isFactorAdded(factor.original_id) ? "Add Again" : "Add to Job",
                variant: isFactorAdded(factor.original_id) ? "outline" : "default",
                disabled: addingFactorId === factor.original_id,
              })}
              onSelectFactor={addFactorToJob}
              frequentFactors={!factorSearchQuery.trim() ? topFactors : []}
              emptyMessage="No factors found. Try adjusting your search or filters."
            />
          </div>
        )}
      </Card>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
            <div className="min-w-0 sm:col-span-2 xl:col-span-2">
              <Label htmlFor="search">Search</Label>
              <Input
                id="search"
                placeholder="Search by label, category, site, source, or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full min-w-0"
              />
            </div>
            <div className="min-w-0">
              <Label htmlFor="scopeFilter">Scope</Label>
              <Select value={selectedScope} onValueChange={setSelectedScope}>
                <SelectTrigger id="scopeFilter" className="w-full">
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
            <div className="min-w-0">
              <Label htmlFor="confidenceFilter">Data Confidence</Label>
              <Select value={confidenceFilter} onValueChange={setConfidenceFilter}>
                <SelectTrigger id="confidenceFilter" className="w-full">
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
            <div className="min-w-0">
              <Label htmlFor="siteFilter">Working Site</Label>
              <Select value={siteFilter} onValueChange={setSiteFilter}>
                <SelectTrigger id="siteFilter" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Sites</SelectItem>
                  {sites.map((site) => (
                    <SelectItem key={site.site_id} value={String(site.site_id)}>
                      {site.site_name}{site.is_registered_office ? " ★" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <Label htmlFor="categoryFilter">Category</Label>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger id="categoryFilter" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Categories</SelectItem>
                  {availableCategories.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <Label htmlFor="monthlyCompletenessFilter">Monthly</Label>
              <Select value={monthlyCompletenessFilter} onValueChange={setMonthlyCompletenessFilter}>
                <SelectTrigger id="monthlyCompletenessFilter" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Monthly</SelectItem>
                  <SelectItem value="Complete">Complete (12/12)</SelectItem>
                  <SelectItem value="Partial">Partial (1-11/12)</SelectItem>
                  <SelectItem value="Empty">Empty (0/12)</SelectItem>
                  <SelectItem value="Any">Has Monthly Data</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={() => setShowColumnManager(true)} variant="outline">
                Columns
              </Button>
            </div>
            <div className="flex items-end">
              <Button
                onClick={() => {
                  resetDataEntryFilters();
                  void loadData();
                }}
                variant="outline"
              >
                Refresh
              </Button>
            </div>
            <div className="flex items-end">
              <Button onClick={openDebugModal} variant="outline">
                Review Rows
              </Button>
            </div>
            <div className="flex flex-wrap items-end gap-2 sm:col-span-2 xl:col-span-6">
              <Button
                variant="outline"
                onClick={resetDataEntryFilters}
              >
                Clear Filters
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
              <LoadingOrbit className="py-16" label="Loading data entries..." />
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
                    {visibleColumns.apply && <th className="text-right p-2">Factor{filteredData.some((r) => r.factor_blended) ? <span className="text-amber-600 font-normal" title="Weighted average across two or more factor datasets for periods spanning a dataset year boundary"> (* = blended)</span> : null}</th>}
                    {visibleColumns.tco2e && <th className="text-right p-2">tCO₂e (After)</th>}
                    {visibleColumns.confidence && <th className="text-left p-2">Data Confidence</th>}
                    <th className="text-left p-2">Monthly</th>
                    <th className="text-left p-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredData.map((row) => {
                    const detailRow = rowDetailCache[row.row_id] || row;
                    return (
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
                                if (value) {
                                  markRowDirty(row.row_id);
                                  void updateField(row.row_id, { site_id: parseInt(value) });
                                }
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
                        <td className="p-2 max-w-xs">
                          <div className="truncate font-medium" title={rowDisplayTitle(row)}>
                            {rowDisplayTitle(row)}
                          </div>
                          <div className="truncate text-xs text-muted-foreground" title={rowDisplaySubtitle(row)}>
                            {rowDisplaySubtitle(row)}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <div
                              className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${uomBadgeClass(row.uom)}`}
                              title={row.uom || "Unit of measure missing"}
                            >
                              {row.uom ? `UoM: ${row.uom}` : "UoM missing"}
                            </div>
                            {row.ghg_unit ? (
                              <div
                                className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${unitBadgeClass(row.ghg_unit, row.unit_warning)}`}
                                title={row.unit_warning || `Factor unit: ${row.ghg_unit}`}
                              >
                                {`Unit: ${row.ghg_unit}`}
                              </div>
                            ) : (
                              <div className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-800">
                                Unit missing
                              </div>
                            )}
                            {row.is_auto_generated ? (
                              <div
                                className="inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-medium text-purple-900"
                                title="Automatically calculated by summing every grid-electricity row at this site that pairs to this T&D factor - not directly editable."
                              >
                                Auto T&D
                              </div>
                            ) : row.linked_row_id ? (
                              <div
                                className="inline-flex rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-medium text-purple-800"
                                title={`Contributes to a shared T&D total (row #${row.linked_row_id}) alongside any other grid-electricity rows at this site.`}
                              >
                                Linked → T&D
                              </div>
                            ) : null}
                            {row.data_source === "Spend Data" ? (
                              <div
                                className="inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-900"
                                title="This row is generated from Spend Data — delete the source entry on the Spend Data screen to remove it permanently, or it will reappear on next sync."
                              >
                                Spend Data
                              </div>
                            ) : null}
                            {fileLinks[row.row_id] ? (
                              <button
                                type="button"
                                onClick={() => window.open(`${effectiveBaseUrl}/jobs/${jobId}/files/${fileLinks[row.row_id].file_id}/download`, "_blank")}
                                className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-900 hover:bg-emerald-200"
                                title={`Source document: ${fileLinks[row.row_id].file_name}${fileLinks[row.row_id].portal_visible ? " (visible to client)" : " (not shared with client)"}`}
                              >
                                📎 Evidence
                              </button>
                            ) : null}
                          </div>
                        </td>
                        {visibleColumns.qty && (
                          <td className="p-2 text-right">
                            {row.is_auto_generated ? (
                              <span
                                className="inline-block px-2 py-1 font-mono"
                                title="Automatically calculated by summing linked grid-electricity rows at this site - not directly editable."
                              >
                                {row.qty?.toFixed(2) || "0.00"}
                              </span>
                            ) : isLegacyFallbackRow(row) ? (
                              <span
                                className="inline-block px-2 py-1 font-mono"
                                title="Legacy annual row shows the original source volume. This row is stored monthly as tCO₂e for audit compatibility."
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
                                    if (e.key === "Escape") cancelEditQty(row.row_id);
                                  }}
                                />
                                <Button size="sm" onClick={() => saveEditQty(row.row_id)} className="h-7 px-2" disabled={pendingSaveRowIds.has(row.row_id)}>
                                  {pendingSaveRowIds.has(row.row_id) ? "Saving..." : "Save"}
                                </Button>
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
                            <span className="font-mono font-semibold" title={row.factor_blended ? `Weighted average - blended across factor datasets: ${row.dataset_label || ""}` : undefined}>
                              {factorDisplayText(row)}
                              {row.factor_blended && <sup className="text-amber-600 ml-0.5" title={row.dataset_label || undefined}>*</sup>}
                            </span>
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
                                <Button size="sm" onClick={() => saveEditConfidence(row.row_id)} className="h-7 px-2" disabled={pendingSaveRowIds.has(row.row_id)}>
                                  {pendingSaveRowIds.has(row.row_id) ? "Saving..." : "Save"}
                                </Button>
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
                              className="h-9 w-9 rounded-full p-0"
                              onClick={() => openMonthlyModal(row)}
                              disabled={pendingSaveRowIds.has(row.row_id) || deletingRowId === row.row_id}
                              title={
                                isLegacyFallbackRow(row)
                                  ? "This legacy row stores monthly fallback tCO₂e values while showing the original source volume above."
                                  : undefined
                              }
                              aria-label="Open row detail"
                            >
                              <FileText className="h-4 w-4" />
                              <span className="sr-only">Detail</span>
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 w-9 rounded-full p-0"
                              onClick={() => openRowEditorModal(row)}
                              disabled={pendingSaveRowIds.has(row.row_id) || deletingRowId === row.row_id}
                              aria-label="Edit row"
                              title="Edit row"
                            >
                              <PencilLine className="h-4 w-4" />
                              <span className="sr-only">Edit</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-9 w-9 rounded-full p-0 text-destructive hover:text-destructive"
                              onClick={() => deleteRow(row.row_id)}
                              disabled={deletingRowId === row.row_id}
                              aria-label="Delete row"
                              title="Delete row"
                            >
                              <Trash2 className="h-4 w-4" />
                              <span className="sr-only">{deletingRowId === row.row_id ? "Deleting..." : "Delete"}</span>
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {expandedRows.has(row.row_id) && (
                        <tr key={`details-${row.row_id}`} className="border-b bg-muted/20">
                          <td colSpan={visibleColumnCount} className="p-3">
                            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                              <div className="text-xs">
                                <div className="text-muted-foreground">Category</div>
                                <div>{detailRow.dataset_category || detailRow.lookup_category || detailRow.level_1 || detailRow.category || "-"}</div>
                              </div>
                              <div className="text-xs">
                                <div className="text-muted-foreground">UOM</div>
                                <div>{detailRow.uom || "-"}</div>
                              </div>
                              <div className="text-xs">
                                <div className="text-muted-foreground">Factor</div>
                                <div className="font-mono break-all">{factorDisplayText(detailRow)}</div>
                              </div>
                              <div className="text-xs md:col-span-2 lg:col-span-4">
                                <div className="text-muted-foreground">UoM</div>
                                <div className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${uomBadgeClass(detailRow.uom)}`}>
                                  {detailRow.uom || "UoM missing"}
                                </div>
                              </div>
                              {detailRow.ghg_unit ? (
                                <div className="text-xs md:col-span-2 lg:col-span-4">
                                  <div className="text-muted-foreground">Unit</div>
                                  <div
                                    className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${unitBadgeClass(detailRow.ghg_unit, detailRow.unit_warning)}`}
                                    title={detailRow.unit_warning || `Factor unit: ${detailRow.ghg_unit}`}
                                  >
                                    {`Unit: ${detailRow.ghg_unit}`}
                                  </div>
                                </div>
                              ) : (
                                <div className="text-xs md:col-span-2 lg:col-span-4">
                                  <div className="text-muted-foreground">Unit</div>
                                  <div className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-800">
                                    Unit missing
                                  </div>
                                </div>
                              )}
                              <div className="text-xs">
                                <div className="text-muted-foreground">Apply %</div>
                                {editingRowId === row.row_id && editingField === "apply" ? (
                                  <div className="flex gap-1">
                                    <Input
                                      type="number"
                                      step="1"
                                      value={editingApply}
                                      onChange={(e) => setEditingApply(e.target.value)}
                                      className="h-7 w-24 text-right font-mono text-sm"
                                      autoFocus
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") saveEditApply(row.row_id);
                                        if (e.key === "Escape") cancelEditQty(row.row_id);
                                      }}
                                    />
                                    <Button size="sm" onClick={() => saveEditApply(row.row_id)} className="h-7 px-2" disabled={pendingSaveRowIds.has(row.row_id)}>
                                      {pendingSaveRowIds.has(row.row_id) ? "Saving..." : "Save"}
                                    </Button>
                                  </div>
                                ) : (
                                  <button className="font-mono hover:bg-muted px-2 py-1 rounded" onClick={() => startEditApply(row)}>
                                    {detailRow.apply_pct}%
                                  </button>
                                )}
                              </div>
                              <div className="text-xs">
                                <div className="text-muted-foreground">Factor ID</div>
                                <div className="font-mono break-all">{detailRow.factor_reference || detailRow.original_id || "-"}</div>
                              </div>
                              <div className="text-xs">
                                <div className="text-muted-foreground">Monthly</div>
                                <div className="font-mono">{monthlyCount(detailRow)}/12</div>
                              </div>
                              <div className="text-xs">
                                <div className="text-muted-foreground">tCO₂e (Before)</div>
                                <div className="font-mono">{detailRow.tco2e_before_apply.toFixed(4)}</div>
                              </div>
                              <div className="text-xs">
                                <div className="text-muted-foreground">Dataset</div>
                                <div>{detailRow.dataset_label || "-"}</div>
                              </div>
                              {detailRow.uses_monthly_factors && (
                                <div className="text-xs md:col-span-2 lg:col-span-4">
                                  <div className="text-muted-foreground mb-1">Monthly Dataset / Factor Audit</div>
                                  <div className="rounded border bg-background px-3 py-2">
                                    <div className="text-[11px] text-muted-foreground">
                                      Open Monthly to load the month-by-month dataset and factor audit for this row.
                                    </div>
                                  </div>
                                </div>
                              )}
                              {!detailRow.uses_monthly_factors && monthlyCount(detailRow) > 0 && (
                                <div className="text-xs md:col-span-2 lg:col-span-4">
                                  <div className="text-muted-foreground mb-1">Monthly Input</div>
                                  <div className="rounded border bg-background px-3 py-2">
                                    <div className="text-[11px] text-muted-foreground mb-2">
                                      Monthly values captured for this row.
                                    </div>
                                    <div className="mb-2 text-[11px] font-mono break-words">
                                      {monthlyStoredSummary(detailRow)}
                                    </div>
                                  </div>
                                </div>
                              )}
                              {isLegacyFallbackRow(detailRow) && (
                                <>
                                  <div className="text-xs">
                                    <div className="text-muted-foreground">Source Volume</div>
                                    {hasLegacySourceVolume(detailRow) ? (
                                      <div className="font-mono">
                                        {formatMaybeNumber(detailRow.source_qty, 2)} {detailRow.source_uom || ""}
                                      </div>
                                    ) : (
                                      <div className="text-muted-foreground">
                                        Unavailable on this import. Re-import the legacy file to restore source volume.
                                      </div>
                                    )}
                                  </div>
                                  <div className="text-xs">
                                    <div className="text-muted-foreground">Stored As</div>
                                    <div className="font-mono">
                                      {formatMaybeNumber(detailRow.storage_qty, 4)} {detailRow.storage_uom || ""}
                                    </div>
                                  </div>
                                  <div className="text-xs">
                                    <div className="text-muted-foreground">Storage Factor</div>
                                    <div className="font-mono">{formatMaybeNumber(detailRow.storage_factor, 5)}</div>
                                  </div>
                                  <div className="text-xs">
                                    <div className="text-muted-foreground">Storage Mode</div>
                                    <div>{storageReasonText(detailRow.storage_reason)}</div>
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
                                        if (e.key === "Escape") cancelEditQty(row.row_id);
                                      }}
                                    />
                                    <Button size="sm" onClick={() => saveEditSource(row.row_id)} className="h-7 px-2" disabled={pendingSaveRowIds.has(row.row_id)}>
                                      {pendingSaveRowIds.has(row.row_id) ? "Saving..." : "Save"}
                                    </Button>
                                  </div>
                                ) : (
                                  <button className="w-full rounded border px-2 py-1 text-left hover:bg-muted" onClick={() => startEditSource(row)}>
                                    {detailRow.data_source || "Company Data"}
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
                                        if (e.key === "Escape") cancelEditQty(row.row_id);
                                      }}
                                    />
                                    <Button size="sm" onClick={() => saveEditNotes(row.row_id)} className="h-7 px-2" disabled={pendingSaveRowIds.has(row.row_id)}>
                                      {pendingSaveRowIds.has(row.row_id) ? "Saving..." : "Save"}
                                    </Button>
                                  </div>
                                ) : (
                                  <button className="w-full rounded border px-2 py-1 text-left hover:bg-muted" onClick={() => startEditNotes(row)}>
                                    {detailRow.notes || <span className="text-muted-foreground italic">Add notes...</span>}
                                  </button>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 bg-muted/40 font-semibold text-sm">
                    <td className="p-2" />
                    <td className="p-2" />
                    {visibleColumns.site && <td className="p-2" />}
                    <td className="p-2 text-muted-foreground">
                      Filtered total ({filteredData.length} {filteredData.length === 1 ? "row" : "rows"})
                    </td>
                    {visibleColumns.qty && (
                      <td className="p-2 text-right font-mono">
                        {filteredData.reduce((sum, r) => sum + (r.qty ?? 0), 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                    )}
                    {visibleColumns.apply && <td className="p-2" />}
                    {visibleColumns.tco2e && (
                      <td className="p-2 text-right font-mono">
                        {filteredData.reduce((sum, r) => sum + (r.calc_tco2e ?? 0), 0).toFixed(4)}
                      </td>
                    )}
                    {visibleColumns.confidence && <td className="p-2" />}
                    <td className="p-2" />
                    <td className="p-2" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reuse Previous Year Rows</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 min-w-0">
          <div className="text-sm text-muted-foreground">
            Reuse rows from earlier jobs for this client to keep data entry fast and consistent. The factor and hierarchy fields are copied in, ready for this year&apos;s quantities.
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300"
              checked={autoAddTd}
              onChange={(e) => setAutoAddTd(e.target.checked)}
            />
            Add T&D automatically for grid electricity rows
          </label>
          {previousYearLoading ? (
            <div className="text-sm text-muted-foreground">Loading previous-year rows...</div>
          ) : previousYearError ? (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {previousYearError}
            </div>
          ) : filteredPreviousYearRows.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No reusable rows were found for the current filters.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300"
                    checked={selectedPreviousRowIds.size === filteredPreviousYearRows.length && filteredPreviousYearRows.length > 0}
                    ref={(el) => {
                      if (el) el.indeterminate = selectedPreviousRowIds.size > 0 && selectedPreviousRowIds.size < filteredPreviousYearRows.length;
                    }}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedPreviousRowIds(new Set(filteredPreviousYearRows.map((r) => r.row_id)));
                      } else {
                        setSelectedPreviousRowIds(new Set());
                      }
                    }}
                  />
                  Select all ({filteredPreviousYearRows.length})
                </label>
                <Button
                  onClick={addSelectedPreviousRowsToJob}
                  disabled={selectedPreviousRowIds.size === 0 || bulkAdding}
                  size="sm"
                >
                  {bulkAdding
                    ? "Adding..."
                    : selectedPreviousRowIds.size === 0
                      ? "Add to Job"
                      : `Add ${selectedPreviousRowIds.size} to Job`}
                </Button>
              </div>
              <div className="border rounded-md max-h-96 overflow-y-auto min-w-0">
                <div className="divide-y">
                  {filteredPreviousYearRows.map((row) => {
                    const isSelected = selectedPreviousRowIds.has(row.row_id);
                    const alreadyAdded = addedOriginalIds.has(`${row.original_id}::${row.site_id ?? ""}`);
                    return (
                      <div
                        key={`previous-${row.row_id}`}
                        className={`p-3 transition-colors ${alreadyAdded ? "opacity-70" : "cursor-pointer"} ${isSelected ? "bg-muted/60" : "hover:bg-muted/40"}`}
                        onClick={() => {
                          setSelectedPreviousRowIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(row.row_id)) next.delete(row.row_id);
                            else next.add(row.row_id);
                            return next;
                          });
                        }}
                      >
                        <div className="grid gap-3 md:grid-cols-[auto_minmax(0,1fr)] md:items-start">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-gray-300 mt-1"
                            checked={isSelected}
                            onChange={(e) => {
                              e.stopPropagation();
                              setSelectedPreviousRowIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(row.row_id)) next.delete(row.row_id);
                                else next.add(row.row_id);
                                return next;
                              });
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-start gap-2 min-w-0">
                              <span
                                className={`inline-block px-2 py-0.5 rounded text-xs ${
                                  row.scope === "Scope 1"
                                    ? "bg-red-100 text-red-800"
                                    : row.scope === "Scope 2"
                                      ? "bg-orange-100 text-orange-800"
                                      : "bg-blue-100 text-blue-800"
                                }`}
                              >
                                {row.scope}
                              </span>
                              <span className="min-w-0 flex-1 break-words font-medium leading-snug" title={rowDisplayTitle(row)}>
                                {rowDisplayTitle(row)}
                              </span>
                              {alreadyAdded && (
                                <span className="shrink-0 inline-block px-1.5 py-0.5 rounded text-xs bg-green-100 text-green-700">
                                  Added - Add Again
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground" title={rowDisplaySubtitle(row)}>
                              {rowDisplaySubtitle(row) || row.original_id}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              From {row.source_job_number || `Job ${row.job_id}`}
                              {row.source_job_title ? ` • ${row.source_job_title}` : ""}
                              {row.source_reporting_period_start && row.source_reporting_period_end
                                ? ` • ${row.source_reporting_period_start} to ${row.source_reporting_period_end}`
                                : ""}
                            </div>
                            <div className="flex flex-wrap gap-3 text-xs">
                              <span className="font-mono">
                                Previous Qty: {row.previous_qty?.toFixed(2) || "0.00"} {row.uom || ""}
                              </span>
                              <span className="text-muted-foreground">
                                Months used: {row.previous_month_count}/12
                              </span>
                              {row.site_name && (
                                <span className="text-muted-foreground">
                                  Site: {row.site_name}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
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
              { key: "apply", label: "Factor" },
              { key: "tco2e", label: "tCO₂e (After)" },
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

      <Dialog open={showDebugModal} onOpenChange={setShowDebugModal}>
        <DialogContent className="max-w-6xl">
          <DialogHeader>
            <DialogTitle>Review Rows</DialogTitle>
            <DialogDescription>
              Temporary debug view showing enabled and disabled scope rows so we can inspect uniqueness conflicts.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
              <div className="min-w-0">
                <Label htmlFor="debugSearch">Search rows</Label>
                <Input
                  id="debugSearch"
                  value={debugSearch}
                  onChange={(e) => setDebugSearch(e.target.value)}
                  placeholder="Search by site, scope, original ID, label..."
                  className="w-full min-w-0"
                />
              </div>
              <div className="flex items-end">
                <Button variant="outline" onClick={() => void loadDebugRows()} disabled={debugLoading}>
                  {debugLoading ? "Loading..." : "Reload"}
                </Button>
              </div>
              <div className="flex items-end">
                <Button variant="outline" onClick={() => setShowDebugModal(false)}>
                  Close
                </Button>
              </div>
            </div>

            {debugError && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{debugError}</div>}

            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Rows loaded</div>
                <div className="text-lg font-semibold">{filteredDebugRows.length}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Enabled</div>
                <div className="text-lg font-semibold">{filteredDebugRows.filter((row) => row.enabled !== false).length}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Disabled</div>
                <div className="text-lg font-semibold">{filteredDebugRows.filter((row) => row.enabled === false).length}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Duplicate keys</div>
                <div className="text-lg font-semibold">{debugDuplicateGroups.length}</div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-semibold">Duplicate key groups</div>
              {debugDuplicateGroups.length === 0 ? (
                <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                  No duplicate `(site, scope, original_id)` groups found in the loaded rows.
                </div>
              ) : (
                <div className="space-y-2">
                  {debugDuplicateGroups.map((group) => {
                    const key = group[0]
                      ? [group[0].site_id ?? "null", group[0].scope ?? "", group[0].original_id ?? ""].join(" :: ")
                      : "unknown";
                    return (
                      <div key={key} className="rounded-md border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-mono text-sm">{key}</div>
                          <div className="text-xs text-muted-foreground">{group.length} rows</div>
                        </div>
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          {group.map((row) => (
                            <div key={row.row_id} className="rounded border bg-muted/20 p-2 text-xs">
                              <div className="font-semibold">
                                Row {row.row_id} {row.enabled === false ? "(disabled)" : "(enabled)"}
                              </div>
                              <div>Site: {row.site_name || row.site_id || "-"}</div>
                              <div>Label: {row.report_label || "-"}</div>
                              <div>Qty: {row.qty?.toFixed(2) || "0.00"}</div>
                              <div>Updated: {row.updated_at || "-"}</div>
                              <div className="mt-2">
                                <Button variant="outline" size="sm" onClick={() => void deleteRow(row.row_id)}>
                                  Delete row
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="border rounded-md max-h-[60vh] overflow-auto">
              {debugLoading ? (
                <div className="p-4 text-sm text-muted-foreground">Loading debug rows...</div>
              ) : filteredDebugRows.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">No rows found for the current debug filter.</div>
              ) : (
                <table className="w-full min-w-[1100px] text-sm">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b">
                      <th className="p-2 text-left">Enabled</th>
                      <th className="p-2 text-left">Site</th>
                      <th className="p-2 text-left">Scope</th>
                      <th className="p-2 text-left">Original ID</th>
                      <th className="p-2 text-left">Report Label</th>
                      <th className="p-2 text-right">Qty</th>
                      <th className="p-2 text-right">Apply %</th>
                      <th className="p-2 text-right">tCO₂e</th>
                      <th className="p-2 text-left">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDebugRows.map((row) => (
                      <tr key={`debug-${row.row_id}`} className={`border-b ${row.enabled === false ? "bg-muted/40" : ""}`}>
                        <td className="p-2">{row.enabled === false ? "No" : "Yes"}</td>
                        <td className="p-2">{row.site_name || (row.site_id != null ? `Site ${row.site_id}` : "-")}</td>
                        <td className="p-2">{row.scope}</td>
                        <td className="p-2 font-mono">{row.original_id}</td>
                        <td className="p-2 max-w-[320px]">
                          <div className="truncate" title={row.report_label || ""}>{row.report_label || "-"}</div>
                        </td>
                        <td className="p-2 text-right font-mono">{row.qty?.toFixed(2) || "0.00"}</td>
                        <td className="p-2 text-right font-mono">{row.apply_pct?.toFixed(0) || "100"}%</td>
                        <td className="p-2 text-right font-mono">{row.calc_tco2e.toFixed(4)}</td>
                        <td className="p-2 text-xs text-muted-foreground">{row.updated_at || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showRowEditorModal} onOpenChange={(open) => (open ? setShowRowEditorModal(true) : closeRowEditorModal())}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Row Source</DialogTitle>
            {rowEditorRow && (
              <div className="mt-2">
                <div className="font-semibold">{rowDisplayTitle(rowEditorRow)}</div>
                <div className="text-xs text-muted-foreground">
                  {uniqueDisplayParts([
                    rowEditorRow.scope,
                    rowEditorRow.category,
                    rowEditorRow.original_id,
                  ]).join(" • ")}
                </div>
              </div>
            )}
          </DialogHeader>

          <div className="space-y-4">
            {rowEditorError && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {rowEditorError}
              </div>
            )}

            {rowEditorRow && (
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Row Details</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="rowEditorSite">Site</Label>
                        <Select value={rowEditorSiteId} onValueChange={setRowEditorSiteId}>
                          <SelectTrigger id="rowEditorSite" className="w-full">
                            <SelectValue placeholder="No site assigned" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No Site Assigned</SelectItem>
                            {sites.map((site) => (
                              <SelectItem key={site.site_id} value={String(site.site_id)}>
                                {site.site_name}{site.is_registered_office ? " ★" : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="rowEditorCategory">Category</Label>
                        <Input
                          id="rowEditorCategory"
                          value={rowEditorCategory}
                          onChange={(e) => setRowEditorCategory(e.target.value)}
                          placeholder="Category"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="rowEditorDataSource">Data Source</Label>
                      <Input
                        id="rowEditorDataSource"
                        value={rowEditorDataSource}
                        onChange={(e) => setRowEditorDataSource(e.target.value)}
                        placeholder="Company Data"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="rowEditorNotes">Notes</Label>
                      <textarea
                        id="rowEditorNotes"
                        value={rowEditorNotes}
                        onChange={(e) => setRowEditorNotes(e.target.value)}
                        placeholder="Optional notes"
                        className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      />
                    </div>

                    <div className="rounded-md border bg-muted/30 p-3 text-sm">
                      <div className="text-xs text-muted-foreground">Current factor on row</div>
                      <div className="font-mono break-all">{rowEditorRow.factor_reference || rowEditorRow.original_id || "-"}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {uniqueDisplayParts([rowEditorRow.uom, rowEditorRow.ghg_unit]).join(" • ") || "Unit information unavailable"}
                      </div>
                    </div>

                    <div className="rounded-md border bg-muted/20 p-3 text-sm">
                      <div className="text-xs text-muted-foreground">Selected replacement</div>
                      {rowEditorSelectedFactor ? (
                        <>
                          <div className="font-medium break-words">
                            {rowEditorSelectedFactor.report_label || rowEditorSelectedFactor.column_text || rowEditorSelectedFactor.original_id}
                          </div>
                          <div className="font-mono text-xs break-all">
                            {rowEditorSelectedFactor.original_id} {rowEditorSelectedFactor.dataset_id !== null ? `• Dataset ${rowEditorSelectedFactor.dataset_id}` : ""} {rowEditorSelectedFactor.factor_db_id !== null ? `• Factor ${rowEditorSelectedFactor.factor_db_id}` : ""}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {uniqueDisplayParts([rowEditorSelectedFactor.uom, rowEditorSelectedFactor.ghg_unit]).join(" • ") || "Unit information unavailable"}
                          </div>
                        </>
                      ) : (
                        <div className="text-muted-foreground">Choose a factor below.</div>
                      )}
                      {["completed", "closed"].includes(String(jobData?.status || "").trim().toLowerCase()) && (
                        <div className="mt-2 text-xs text-amber-700">
                          Repointing is blocked while this job&apos;s status is Completed or Closed. Change the job
                          status back to Open to make retrospective changes.
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <FactorBrowserCard
                  title="Choose Replacement Factor"
                  factorSearchQuery={factorSearchQuery}
                  onFactorSearchQueryChange={setFactorSearchQuery}
                  factorScopeFilter={factorScopeFilter}
                  onFactorScopeFilterChange={setFactorScopeFilter}
                  factorCategoryFilter={factorCategoryFilter}
                  onFactorCategoryFilterChange={setFactorCategoryFilter}
                  factorCategoryOptions={factorCategoryOptions}
                  onSearch={() => loadTemplateFactors(true)}
                  factorsLoading={factorsLoading}
                  methodologyCountry={methodologyCountry}
                  templateFactors={annotatedTemplateFactors}
                  factorsTotal={factorsTotal}
                  factorsHasMore={factorsHasMore}
                  loadingMoreFactors={loadingMoreFactors}
                  onLoadMore={loadMoreFactors}
                  getFactorTitle={factorDisplayTitle}
                  getFactorSubtitle={factorDisplaySubtitle}
                  getActionProps={() => ({
                    label: "Use This Factor",
                  })}
                  onSelectFactor={(factor) => {
                    setRowEditorSelectedFactor(factor);
                    setRowEditorCategory(factor.category || "");
                  }}
                  isFactorSelected={(factor) =>
                    Boolean(
                      rowEditorSelectedFactor &&
                      rowEditorSelectedFactor.original_id === factor.original_id &&
                      rowEditorSelectedFactor.dataset_id === factor.dataset_id &&
                      rowEditorSelectedFactor.factor_db_id === factor.factor_db_id
                    )
                  }
                  emptyMessage="No factors found. Try adjusting your search or filters."
                  listMaxHeightClassName="max-h-[28rem]"
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeRowEditorModal} disabled={rowEditorSaving}>
              Cancel
            </Button>
            <Button
              onClick={saveRowEditor}
              disabled={
                rowEditorSaving ||
                !rowEditorRow ||
                ["completed", "closed"].includes(String(jobData?.status || "").trim().toLowerCase())
              }
            >
              {rowEditorSaving ? "Saving..." : "Save Repoint"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Monthly Data Entry Modal */}
      <Dialog open={showMonthlyModal} onOpenChange={setShowMonthlyModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Row Detail</DialogTitle>
            {monthlyEditRow && (
              <div className="mt-2">
                <div className="font-semibold">{rowDisplayTitle(monthlyEditRow)}</div>
                <div className="text-xs text-muted-foreground">
                  {uniqueDisplayParts([
                    monthlyEditRow.scope,
                    monthlyEditRow.category,
                    monthlyEditRow.original_id,
                  ]).join(" • ")}
                </div>
              </div>
            )}
          </DialogHeader>

          <div className="space-y-4">
            {monthlyEditRow && isLegacyFallbackRow(monthlyEditRow) && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                This legacy annual row shows the original source volume in the grid, but its monthly values are stored as fallback tCO₂e for audit compatibility. Monthly values are read-only here.
              </div>
            )}

            <Tabs value={detailTab} onValueChange={setDetailTab} className="space-y-4">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="monthly">Monthly</TabsTrigger>
                <TabsTrigger value="metadata">Metadata</TabsTrigger>
                <TabsTrigger value="audit" disabled={!monthlyEditRow?.uses_monthly_factors}>Audit</TabsTrigger>
              </TabsList>

              <TabsContent value="metadata" className="space-y-4">
                {monthlyEditRow && (
                  <div className="rounded-md border bg-muted/20 p-3">
                    <div className="mb-3 text-sm font-semibold">Key Metadata</div>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="text-xs">
                        <div className="text-muted-foreground">Scope</div>
                        <div className="font-medium">{monthlyEditRow.scope || "-"}</div>
                      </div>
                      <div className="text-xs">
                        <div className="text-muted-foreground">Site</div>
                        <div className="font-medium">{getSiteName(monthlyEditRow.site_id) || "No site"}</div>
                      </div>
                      <div className="text-xs">
                        <div className="text-muted-foreground">Category</div>
                        <div className="font-medium">{monthlyEditRow.dataset_category || monthlyEditRow.lookup_category || monthlyEditRow.level_1 || monthlyEditRow.category || "-"}</div>
                      </div>
                      <div className="text-xs">
                        <div className="text-muted-foreground">Source</div>
                        <div className="font-medium">{monthlyEditRow.data_source || "Company Data"}</div>
                      </div>
                      <div className="text-xs">
                        <div className="text-muted-foreground">UoM</div>
                        <div className="font-mono">{monthlyEditRow.uom || "-"}</div>
                      </div>
                      <div className="text-xs">
                        <div className="text-muted-foreground">Unit</div>
                        <div className="font-mono">{monthlyEditRow.ghg_unit || "-"}</div>
                      </div>
                      <div className="text-xs">
                        <div className="text-muted-foreground">Factor ID</div>
                        <div className="font-mono break-all">{monthlyEditRow.factor_reference || monthlyEditRow.original_id || "-"}</div>
                      </div>
                      <div className="text-xs">
                        <div className="text-muted-foreground">Dataset</div>
                        <div>{monthlyEditRow.dataset_label || "-"}</div>
                      </div>
                      <div className="text-xs">
                        <div className="text-muted-foreground">Apply %</div>
                        <div className="font-mono">{monthlyEditRow.apply_pct.toFixed(2)}%</div>
                      </div>
                      <div className="text-xs">
                        <div className="text-muted-foreground">Monthly</div>
                        <div className="font-mono">{monthlyCount(monthlyEditRow)}/12</div>
                      </div>
                      <div className="text-xs">
                        <div className="text-muted-foreground">Factor</div>
                        <div className="font-mono">{factorDisplayText(monthlyEditRow)}</div>
                      </div>
                      <div className="text-xs">
                        <div className="text-muted-foreground">tCO₂e</div>
                        <div className="font-mono">{monthlyEditRow.calc_tco2e.toFixed(4)}</div>
                      </div>
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="monthly" className="space-y-4">
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
                          type="text"
                          inputMode="decimal"
                          step="0.01"
                          value={monthlyValues[actualIndex] ?? ""}
                          onChange={(e) => updateMonthlyValue(actualIndex, e.target.value)}
                          className="h-8 text-sm font-mono text-right"
                          disabled={monthlyEditRow ? isLegacyFallbackRow(monthlyEditRow) : false}
                        />
                      </div>
                    );
                  })}
                </div>

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

                  {monthlyEditRow && !isLegacyFallbackRow(monthlyEditRow) && monthlyEditRow.qty && Math.abs(monthlyEditRow.qty - getMonthlySum()) > 0.01 && (
                    <div className="mt-3 rounded-md border border-yellow-200 bg-yellow-50 p-3">
                      <div className="flex items-start gap-2">
                        <span className="text-sm font-semibold text-yellow-600">Warning:</span>
                        <div className="text-sm text-yellow-800">
                          <p>Monthly total ({getMonthlySum().toFixed(2)}) does not match Annual Qty ({monthlyEditRow.qty.toFixed(2)}).</p>
                          <p className="mt-1">When you save, the Annual Qty will be updated to match the monthly total.</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="audit" className="space-y-4">
                {monthlyEditRow && monthlyEditRow.uses_monthly_factors && (
                  <div className="rounded-md border bg-muted/20 p-3">
                    <div className="mb-2 text-sm font-semibold">Monthly Dataset / Factor Audit</div>
                    {monthlyDetailLoadingRowId === monthlyEditRow.row_id ? (
                      <div className="text-sm text-muted-foreground">Loading monthly audit...</div>
                    ) : monthlyDetailError ? (
                      <div className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">
                        {monthlyDetailError}
                      </div>
                    ) : (rowDetailCache[monthlyEditRow.row_id]?.monthly_factor_details || []).length ? (
                      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {(rowDetailCache[monthlyEditRow.row_id]?.monthly_factor_details || []).map((detail) => (
                          <div key={`${monthlyEditRow.row_id}-${detail.month_index}`} className="rounded border bg-background px-2 py-2 text-[11px]">
                            <div className="font-semibold">{detail.month_label || `M${detail.month_index}`}</div>
                            <div className="text-muted-foreground">Year: {detail.year ?? "-"}</div>
                            <div className="text-muted-foreground">{detail.dataset_name || "-"}</div>
                            <div className="text-muted-foreground">{detail.dataset_category || detail.lookup_category || monthlyEditRow.dataset_category || monthlyEditRow.lookup_category || monthlyEditRow.level_1 || monthlyEditRow.category || "-"}</div>
                            <div className="font-mono">
                              Qty: {detail.qty !== null && detail.qty !== undefined && !Number.isNaN(detail.qty)
                                ? detail.qty.toFixed(2)
                                : "-"} {detail.uom || ""}
                            </div>
                            <div className="font-mono">
                              Conversion Factor: {detail.factor !== null && detail.factor !== undefined && !Number.isNaN(detail.factor)
                                ? detail.factor.toFixed(5)
                                : "-"}
                            </div>
                            <div className="font-mono break-all">
                              ID: {detail.factor_original_id || "-"}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        Open and wait for the monthly audit to load, or reopen the modal if the row was just repointed.
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeMonthlyModal}>
              {monthlyEditRow && isLegacyFallbackRow(monthlyEditRow) ? "Close" : "Cancel"}
            </Button>
            {!(monthlyEditRow && isLegacyFallbackRow(monthlyEditRow)) && (
              <Button onClick={saveMonthlyData} disabled={monthlyEditRow ? pendingSaveRowIds.has(monthlyEditRow.row_id) : false}>
                {monthlyEditRow && pendingSaveRowIds.has(monthlyEditRow.row_id) ? "Saving..." : "Save Monthly Data"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
