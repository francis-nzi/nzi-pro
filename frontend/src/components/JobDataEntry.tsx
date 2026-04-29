"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
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
import { withAuditHeaders } from "@/lib/auth-client";
import { dispatchJobScopeRefresh, JOB_SCOPE_REFRESH_EVENT } from "@/lib/job-scope-refresh";
import { useUnsavedChangesGuard } from "@/lib/useUnsavedChangesGuard";

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
  uses_monthly_factors?: boolean;
  monthly_factor_details?: Array<{
    month_index: number;
    month_label?: string | null;
    year?: number | null;
    dataset_id?: number | null;
    dataset_name?: string | null;
    dataset_category?: string | null;
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
  } | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
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
  const [addingFactorId, setAddingFactorId] = useState<string | null>(null);
  const [addingPreviousRowId, setAddingPreviousRowId] = useState<number | null>(null);
  const [selectedPreviousRowIds, setSelectedPreviousRowIds] = useState<Set<number>>(new Set());
  const [bulkAdding, setBulkAdding] = useState(false);
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

  function removeScopeDataRow(rowId: number) {
    setScopeData((prev) => prev.filter((row) => row.row_id !== rowId));
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
    
    try {
      // Only load essential data on initial load (not template factors)
      const [totalsRes, dataRes, jobRes, previousRowsRes] = await Promise.all([
        fetch(`${effectiveBaseUrl}/jobs/${jobId}/scope-totals`, { credentials: "include" }),
        fetch(`${effectiveBaseUrl}/jobs/${jobId}/scope-data`, { credentials: "include" }),
        fetch(`${effectiveBaseUrl}/jobs/${jobId}`, { credentials: "include" }),
        fetch(`${effectiveBaseUrl}/jobs/${jobId}/previous-scope-rows?limit=50`, { credentials: "include" }),
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
              setSites(sitesData.active_sites || []);
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
    }
    
    setFactorsLoading(true);
    try {
      const offset = reset ? 0 : factorsOffset;
      const scopeParam = factorScopeFilter !== "All" ? `&scope=${encodeURIComponent(factorScopeFilter)}` : "";
      const searchParam = factorSearchQuery ? `&search=${encodeURIComponent(factorSearchQuery)}` : "";
      
      const factorsRes = await fetch(
        `${effectiveBaseUrl}/jobs/${jobId}/template-factors?limit=50&offset=${offset}${scopeParam}${searchParam}`,
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
      const searchParam = factorSearchQuery ? `&search=${encodeURIComponent(factorSearchQuery)}` : "";
      
      const factorsRes = await fetch(
        `${effectiveBaseUrl}/jobs/${jobId}/template-factors?limit=50&offset=${factorsOffset}${scopeParam}${searchParam}`,
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

  function uniqueDisplayParts(values: Array<string | null | undefined>): string[] {
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
  }

  function multiTokenMatch(searchText: string, values: Array<string | null | undefined>): boolean {
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
  }

  function rowDisplayTitle(row: ScopeDataRow | PreviousYearRow): string {
    return normalizeDisplayValue(row.report_label) || normalizeDisplayValue(row.column_text) || normalizeDisplayValue(row.original_id) || "Row";
  }

  function rowDisplaySubtitle(row: ScopeDataRow | PreviousYearRow): string {
    return uniqueDisplayParts([
      row.category,
      row.level_4,
      row.level_3,
      row.level_2,
      row.level_1,
      row.uom,
    ]).join(" • ");
  }

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
        replaceScopeDataRow(rowId, fields);
        clearRowDirty(rowId);
        await refreshScopeTotals();
        dispatchJobScopeRefresh("job-data-entry");
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

    const saved = await updateField(monthlyEditRow.row_id, fields);
    if (saved) {
      clearRowDirty(monthlyEditRow.row_id);
      closeMonthlyModal();
    }
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
        await loadData();
        dispatchJobScopeRefresh("job-data-entry");
        setError("");
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
        removeScopeDataRow(rowId);
        clearRowDirty(rowId);
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

  function isKgBasedUnit(unit?: string | null): boolean {
    return Boolean(unit && unit.replace(/\s+/g, "").toLowerCase().includes("kg"));
  }

  function unitBadgeClass(unit?: string | null, warning?: string | null): string {
    if (!unit) return "bg-slate-100 text-slate-800";
    if (isKgBasedUnit(unit) && !warning) return "bg-emerald-100 text-emerald-900";
    return "bg-amber-100 text-amber-900";
  }

  function uomBadgeClass(uom?: string | null): string {
    return uom ? "bg-emerald-100 text-emerald-900" : "bg-slate-100 text-slate-800";
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

  function getMonthlyFilledCount(row: MonthlyFilterRow): number {
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
  }

  function matchesMonthlyCompleteness(row: MonthlyFilterRow): boolean {
    if (monthlyCompletenessFilter === "All") return true;
    const filledCount = getMonthlyFilledCount(row);
    if (monthlyCompletenessFilter === "Complete") return filledCount === 12;
    if (monthlyCompletenessFilter === "Partial") return filledCount > 0 && filledCount < 12;
    if (monthlyCompletenessFilter === "Empty") return filledCount === 0;
    if (monthlyCompletenessFilter === "Any") return filledCount > 0;
    return true;
  }

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

  function getSiteName(siteId: number | null | undefined): string {
    if (siteId == null) return "";
    return siteNameById.get(String(siteId)) || `Site ${siteId}`;
  }

  const filteredData = scopeData.filter((row) => {
    if (selectedScope !== "All" && row.scope !== selectedScope) return false;
    if (confidenceFilter !== "All") {
      const confidence = String(row.data_confidence || "M").toUpperCase();
      if (confidence !== confidenceFilter) return false;
    }
    if (siteFilter !== "All" && String(row.site_id ?? "") !== siteFilter) return false;
    if (categoryFilter !== "All" && String(row.dataset_category || row.level_1 || row.category || row.level_2 || "").trim() !== categoryFilter) {
      return false;
    }
    if (!matchesMonthlyCompleteness(row)) return false;
    if (searchQuery) {
      return multiTokenMatch(searchQuery, [
        rowDisplayTitle(row),
        rowDisplaySubtitle(row),
        row.dataset_category,
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

  const filteredPreviousYearRows = previousYearRows.filter((row) => {
    if (selectedScope !== "All" && row.scope !== selectedScope) return false;
    if (siteFilter !== "All" && String(row.site_id ?? "") !== siteFilter) return false;
    if (categoryFilter !== "All" && String(row.category || row.level_2 || row.level_1 || "").trim() !== categoryFilter) {
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

  const addedOriginalIds = new Set(
    scopeData.map((r) => `${r.original_id}::${r.site_id ?? ""}`)
  );

  const availableSites = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of [...scopeData, ...previousYearRows]) {
      if (row.site_id == null) continue;
      const key = String(row.site_id);
      if (!seen.has(key)) seen.set(key, siteNameById.get(key) || `Site ${row.site_id}`);
    }
    return Array.from(seen.entries()).map(([siteId, siteName]) => ({ siteId, siteName }));
  }, [previousYearRows, scopeData, siteNameById]);

  const availableCategories = useMemo(() => {
    const seen = new Set<string>();
    for (const row of [...scopeData, ...previousYearRows]) {
      const category = String(
        ("dataset_category" in row ? row.dataset_category : undefined) ||
        row.level_1 ||
        row.category ||
        row.level_2 ||
        ""
      ).trim();
      if (category) seen.add(category);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [previousYearRows, scopeData]);

  const filteredDebugRows = debugRows.filter((row) => {
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

  const debugDuplicateGroups = Object.values(
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
  ).filter((group) => group.length > 1);

  function factorDisplayTitle(factor: TemplateFactor): string {
    return normalizeDisplayValue(factor.report_label) || normalizeDisplayValue(factor.column_text) || normalizeDisplayValue(factor.original_id) || "Factor";
  }

  function factorDisplaySubtitle(factor: TemplateFactor): string {
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
  }

  function methodologyMatchesFactor(methodology: MethodologyRow, factor: TemplateFactor): boolean {
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
  }

  const annotatedTemplateFactors = templateFactors.map((factor) => {
    const match = methodologyDefaults.find((methodology) => methodologyMatchesFactor(methodology, factor)) || null;
    return {
      ...factor,
      methodology_default: Boolean(match),
      methodology_default_label: match
        ? uniqueDisplayParts([match.report_label, match.category, match.descriptor, match.uom]).join(" • ")
        : null,
    };
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
    <div className="min-w-0 space-y-6">
      {showEmissionsSummary ? (
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
              <Label htmlFor="siteFilter">Site</Label>
              <Select value={siteFilter} onValueChange={setSiteFilter}>
                <SelectTrigger id="siteFilter" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Sites</SelectItem>
                  {availableSites.map((site) => (
                    <SelectItem key={site.siteId} value={site.siteId}>
                      {site.siteName}
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
              <Button onClick={loadData} variant="outline">
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
                onClick={() => {
                  setSearchQuery("");
                  setSelectedScope("All");
                  setConfidenceFilter("All");
                  setSiteFilter("All");
                  setCategoryFilter("All");
                  setMonthlyCompletenessFilter("All");
                }}
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
                    {visibleColumns.apply && <th className="text-right p-2">Factor</th>}
                    {visibleColumns.tco2e && <th className="text-right p-2">tCO₂e (After)</th>}
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
                          </div>
                        </td>
                        {visibleColumns.qty && (
                          <td className="p-2 text-right">
                            {isLegacyFallbackRow(row) ? (
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
                            <span className="font-mono font-semibold">{factorDisplayText(row)}</span>
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
                              onClick={() => openMonthlyModal(row)}
                              disabled={pendingSaveRowIds.has(row.row_id) || deletingRowId === row.row_id}
                              title={
                                isLegacyFallbackRow(row)
                                  ? "This legacy row stores monthly fallback tCO₂e values while showing the original source volume above."
                                  : undefined
                              }
                            >
                              {isLegacyFallbackRow(row) ? "Monthly tCO₂e" : "Monthly"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteRow(row.row_id)}
                              disabled={deletingRowId === row.row_id}
                            >
                              {deletingRowId === row.row_id ? "Deleting..." : "Delete"}
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
                                <div>{row.dataset_category || row.level_1 || row.category || "-"}</div>
                              </div>
                              <div className="text-xs">
                                <div className="text-muted-foreground">UOM</div>
                                <div>{row.uom || "-"}</div>
                              </div>
                              <div className="text-xs">
                                <div className="text-muted-foreground">Factor</div>
                                <div className="font-mono break-all">{factorDisplayText(row)}</div>
                              </div>
                              <div className="text-xs md:col-span-2 lg:col-span-4">
                                <div className="text-muted-foreground">UoM</div>
                                <div className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${uomBadgeClass(row.uom)}`}>
                                  {row.uom || "UoM missing"}
                                </div>
                              </div>
                              {row.ghg_unit ? (
                                <div className="text-xs md:col-span-2 lg:col-span-4">
                                  <div className="text-muted-foreground">Unit</div>
                                  <div
                                    className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${unitBadgeClass(row.ghg_unit, row.unit_warning)}`}
                                    title={row.unit_warning || `Factor unit: ${row.ghg_unit}`}
                                  >
                                    {`Unit: ${row.ghg_unit}`}
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
                                    {row.apply_pct}%
                                  </button>
                                )}
                              </div>
                              <div className="text-xs">
                                <div className="text-muted-foreground">Factor ID</div>
                                <div className="font-mono break-all">{row.factor_reference || row.original_id || "-"}</div>
                              </div>
                              <div className="text-xs">
                                <div className="text-muted-foreground">Monthly</div>
                                <div className="font-mono">{monthlyCount(row)}/12</div>
                              </div>
                              <div className="text-xs">
                                <div className="text-muted-foreground">tCO₂e (Before)</div>
                                <div className="font-mono">{row.tco2e_before_apply.toFixed(4)}</div>
                              </div>
                              <div className="text-xs">
                                <div className="text-muted-foreground">Dataset</div>
                                <div>{row.dataset_label || "-"}</div>
                              </div>
                              {row.uses_monthly_factors && (
                                <div className="text-xs md:col-span-2 lg:col-span-4">
                                  <div className="text-muted-foreground mb-1">Monthly Dataset / Factor Audit</div>
                                  <div className="rounded border bg-background px-3 py-2">
                                    <div className="mb-2 text-[11px] text-muted-foreground">
                                      Emissions for this row are calculated month by month using the setup dataset applicable to each month.
                                    </div>
                                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                                      {(row.monthly_factor_details || []).map((detail) => (
                                        <div key={`${row.row_id}-${detail.month_index}`} className="rounded border px-2 py-2 text-[11px]">
                                          <div className="font-semibold">{detail.month_label || `M${detail.month_index}`}</div>
                                          <div className="text-muted-foreground">Year: {detail.year ?? "-"}</div>
                                          <div className="text-muted-foreground">{detail.dataset_name || "-"}</div>
                                          <div className="text-muted-foreground">{detail.dataset_category || row.dataset_category || row.level_1 || row.category || "-"}</div>
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
                                  </div>
                                </div>
                              )}
                              {!row.uses_monthly_factors && monthlyCount(row) > 0 && (
                                <div className="text-xs md:col-span-2 lg:col-span-4">
                                  <div className="text-muted-foreground mb-1">Monthly Input</div>
                                  <div className="rounded border bg-background px-3 py-2">
                                    <div className="text-[11px] text-muted-foreground mb-2">
                                      Monthly values captured for this row.
                                    </div>
                                    <div className="mb-2 text-[11px] font-mono break-words">
                                      {monthlyStoredSummary(row)}
                                    </div>
                                  </div>
                                </div>
                              )}
                              {isLegacyFallbackRow(row) && (
                                <>
                                  <div className="text-xs">
                                    <div className="text-muted-foreground">Source Volume</div>
                                    {hasLegacySourceVolume(row) ? (
                                      <div className="font-mono">
                                        {formatMaybeNumber(row.source_qty, 2)} {row.source_uom || ""}
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
                                        if (e.key === "Escape") cancelEditQty(row.row_id);
                                      }}
                                    />
                                    <Button size="sm" onClick={() => saveEditSource(row.row_id)} className="h-7 px-2" disabled={pendingSaveRowIds.has(row.row_id)}>
                                      {pendingSaveRowIds.has(row.row_id) ? "Saving..." : "Save"}
                                    </Button>
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
                                        if (e.key === "Escape") cancelEditQty(row.row_id);
                                      }}
                                    />
                                    <Button size="sm" onClick={() => saveEditNotes(row.row_id)} className="h-7 px-2" disabled={pendingSaveRowIds.has(row.row_id)}>
                                      {pendingSaveRowIds.has(row.row_id) ? "Saving..." : "Save"}
                                    </Button>
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

      <Card>
        <CardHeader>
          <CardTitle>Reuse Previous Year Rows</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 min-w-0">
          <div className="text-sm text-muted-foreground">
            Reuse rows from earlier jobs for this client to keep data entry fast and consistent. The factor and hierarchy fields are copied in, ready for this year&apos;s quantities.
          </div>
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
                            disabled={false}
                            onChange={() => {}}
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
          <CardContent className="space-y-4 min-w-0">
            {/* Factor Search & Filter */}
            <div className="space-y-3">
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem_auto]">
                <div className="min-w-0">
                  <Label htmlFor="factorSearch">Search Factors</Label>
                  <Input
                    id="factorSearch"
                    placeholder="Search by label, category, or ID..."
                    value={factorSearchQuery}
                    className="w-full min-w-0"
                    onChange={(e) => setFactorSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") loadTemplateFactors(true);
                    }}
                  />
                </div>
                <div className="min-w-0">
                  <Label htmlFor="factorScopeFilter">Scope</Label>
                  <Select value={factorScopeFilter} onValueChange={(val) => {
                    setFactorScopeFilter(val);
                  }}>
                    <SelectTrigger id="factorScopeFilter" className="w-full">
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
                <div className="flex items-end md:justify-self-end">
                  <Button onClick={() => loadTemplateFactors(true)} disabled={factorsLoading} className="w-full md:w-auto">
                    {factorsLoading ? "Searching..." : "Search"}
                  </Button>
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                Methodology defaults loaded for <span className="font-medium text-foreground">{methodologyCountry}</span>.
              </div>
              <div className="text-sm text-muted-foreground">
                Showing {templateFactors.length} of {factorsTotal} factors
              </div>
            </div>

            {/* Factor List */}
            <div className="border rounded-md max-h-96 overflow-y-auto min-w-0">
              {templateFactors.length === 0 && !factorsLoading ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  No factors found. Try adjusting your search or filters.
                </div>
              ) : (
                <div className="divide-y">
                  {annotatedTemplateFactors.map((factor, index) => {
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
                        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
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
                              {factor.methodology_default && (
                                <span
                                  className="inline-block px-2 py-0.5 rounded text-xs bg-emerald-100 text-emerald-800 font-semibold"
                                  title={factor.methodology_default_label || "Matches company methodology default"}
                                >
                                  DEFAULT
                                </span>
                              )}
                              <span className="min-w-0 flex-1 break-words text-sm font-medium leading-snug">
                                {factorDisplayTitle(factor)}
                              </span>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground break-words">
                              {factorDisplaySubtitle(factor) || factor.original_id}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
                              <span className="font-mono">
                                Factor: {factor.factor?.toFixed(5) || "N/A"}
                              </span>
                              <span className="text-muted-foreground">
                                {factor.uom} {"->"} {factor.ghg_unit}
                              </span>
                            </div>
                            {alreadyAdded && (
                              <div className="mt-1 text-xs text-muted-foreground">
                                Already in this job - you can add it again for a different site.
                              </div>
                            )}
                          </div>
                          <div className="md:justify-self-end">
                            <Button
                              size="sm"
                              onClick={() => addFactorToJob(factor)}
                              disabled={isAdding}
                              variant={alreadyAdded ? "outline" : "default"}
                              className="w-full md:w-auto"
                            >
                              {isAdding ? "Adding..." : alreadyAdded ? "Add Again" : "Add to Job"}
                            </Button>
                          </div>
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
