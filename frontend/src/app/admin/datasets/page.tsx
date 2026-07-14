"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import SearchableStringSelect from "@/components/SearchableStringSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { STANDARD_COUNTRIES } from "@/lib/countries";
import UploadProgressBar from "@/components/UploadProgressBar";
import { uploadFormDataWithProgress } from "@/lib/upload-with-progress";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function apiBaseUrl(): string {
  // Use the app's proxy route so this page does not depend on cross-origin CORS.
  return "/api/backend";
}

async function fetchWithAuth(input: string, init: RequestInit = {}) {
  return fetch(input, {
    ...init,
    credentials: "include",
  });
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => "");
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text);
    return parsed?.detail || parsed?.message || fallback;
  } catch {
    return text;
  }
}

type Dataset = {
  dataset_id: number;
  name: string;
  source: string;
  analysis_type: string;
  country: string;
  year: number;
  version: string;
  valid_from: string | null;
  valid_to: string | null;
  archived?: boolean;
  archived_at?: string | null;
  archived_by?: string | null;
  factor_count?: number;
};

type Factor = {
  db_id: number;
  dataset_id: number | null;
  dataset: string;
  analysis_type?: string | null;
  country?: string | null;
  year?: number | null;
  file_name?: string | null;
  original_id: string;
  scope: string;
  category?: string | null;
  level_1?: string | null;
  level_2?: string | null;
  level_3?: string | null;
  level_4?: string | null;
  column_text: string;
  report_label: string;
  factor: number;
  uom: string;
  ghg_unit: string;
  source?: string | null;
  region?: string | null;
  currency?: string | null;
  method?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  factor_definition_id?: number | null;
  factor_year_value_id?: number | null;
};

type UploadRejectedRow = {
  row_number: number;
  original_id?: string | null;
  scope?: string | null;
  reason: string;
};

type WorkbookImportSheetSummary = {
  sheet_name: string;
  year: number;
  dataset_id: number;
  total_rows: number;
  accepted_rows: number;
  updated_rows: number;
  inserted_rows: number;
  deleted_rows: number;
  blocked_rows: number;
  rejected_rows: number;
  message?: string;
};

type FactorUploadResponse = {
  detail?: { message?: string } | string;
  message?: string;
  factors_imported?: number;
  rows_rejected?: number;
  deleted_rows?: number;
  rejected_details?: UploadRejectedRow[];
};

type WorkbookImportResponse = {
  detail?: { message?: string } | string;
  message?: string;
  sheets?: WorkbookImportSheetSummary[];
};

type BulkNormalizePreviewRow = {
  db_id: number;
  dataset_id?: number | null;
  dataset: string;
  country?: string | null;
  year?: number | null;
  scope?: string | null;
  category?: string | null;
  original_id?: string | null;
  current_label: string;
  new_label: string;
};

type BulkNormalizeResponse = {
  ok?: boolean;
  dry_run?: boolean;
  matched_count?: number;
  changed_count?: number;
  updated_count?: number;
  remove_terms?: string[];
  preview?: BulkNormalizePreviewRow[];
  detail?: { message?: string } | string;
  message?: string;
};

export default function DatasetsPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const confirmAction = useConfirmDialog();
  
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [factors, setFactors] = useState<Factor[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  // Top-level page tabs
  const [activeTab, setActiveTab] = useState("browse");

  // Browse Datasets tab (server-side paginated)
  const [browseItems, setBrowseItems] = useState<Dataset[]>([]);
  const [browseTotal, setBrowseTotal] = useState(0);
  const [browsePage, setBrowsePage] = useState(1);
  const [browsePages, setBrowsePages] = useState(1);
  const [browseCountries, setBrowseCountries] = useState<string[]>([]);
  const [browseQuery, setBrowseQuery] = useState("");
  const [browseCountryFilter, setBrowseCountryFilter] = useState("all");
  const [browseYearFilter, setBrowseYearFilter] = useState("all");
  const [browseArchivedFilter, setBrowseArchivedFilter] = useState("false");
  const [browseLoading, setBrowseLoading] = useState(false);
  const [datasetDialogOpen, setDatasetDialogOpen] = useState(false);

  // Dataset form
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [analysisType, setAnalysisType] = useState("Activity");
  const [country, setCountry] = useState("United Kingdom");
  const [countryMenuOpen, setCountryMenuOpen] = useState(false);
  const [countrySearchStarted, setCountrySearchStarted] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());
  const [version, setVersion] = useState("v1");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  
  // Factor search
  const [searchQuery, setSearchQuery] = useState("");
  const [factorCountry, setFactorCountry] = useState<string>("");
  const [factorYear, setFactorYear] = useState<string>("");
  const [factorDatasetFilter, setFactorDatasetFilter] = useState<string>("");
  const [factorDbIdFilter, setFactorDbIdFilter] = useState<string>("");
  const [factorScopeFilter, setFactorScopeFilter] = useState<string>("");
  const [factorReportLabelFilter, setFactorReportLabelFilter] = useState<string>("");
  const [factorOriginalIdFilter, setFactorOriginalIdFilter] = useState<string>("");
  const [factorCategoryFilter, setFactorCategoryFilter] = useState<string>("");
  const [factorLevel1Filter, setFactorLevel1Filter] = useState<string>("");
  const [factorLevel2Filter, setFactorLevel2Filter] = useState<string>("");
  const [factorLevel3Filter, setFactorLevel3Filter] = useState<string>("");
  const [factorLevel4Filter, setFactorLevel4Filter] = useState<string>("");
  const [factorColumnTextFilter, setFactorColumnTextFilter] = useState<string>("");
  const [factorUomFilter, setFactorUomFilter] = useState<string>("");
  const [factorGhgUnitFilter, setFactorGhgUnitFilter] = useState<string>("");
  const [factorSourceFilter, setFactorSourceFilter] = useState<string>("");
  const [factorRegionFilter, setFactorRegionFilter] = useState<string>("");
  const [factorMethodFilter, setFactorMethodFilter] = useState<string>("");
  const [factorDbId, setFactorDbId] = useState<string>("");
  const [factorDatasetRef, setFactorDatasetRef] = useState<string>("");
  const [factorEditorYear, setFactorEditorYear] = useState<string>("");
  const [factorFileName, setFactorFileName] = useState<string>("");
  const [factorScope, setFactorScope] = useState<string>("");
  const [factorReportLabel, setFactorReportLabel] = useState<string>("");
  const [factorOriginalId, setFactorOriginalId] = useState<string>("");
  const [factorCategory, setFactorCategory] = useState<string>("");
  const [factorLevel1, setFactorLevel1] = useState<string>("");
  const [factorLevel2, setFactorLevel2] = useState<string>("");
  const [factorLevel3, setFactorLevel3] = useState<string>("");
  const [factorLevel4, setFactorLevel4] = useState<string>("");
  const [factorColumnText, setFactorColumnText] = useState<string>("");
  const [factorUom, setFactorUom] = useState<string>("");
  const [factorGhgUnit, setFactorGhgUnit] = useState<string>("");
  const [factorSource, setFactorSource] = useState<string>("");
  const [factorRegion, setFactorRegion] = useState<string>("");
  const [factorCurrency, setFactorCurrency] = useState<string>("");
  const [factorMethod, setFactorMethod] = useState<string>("");
  const [factorValidFrom, setFactorValidFrom] = useState<string>("");
  const [factorValidTo, setFactorValidTo] = useState<string>("");
  const [factorValue, setFactorValue] = useState<string>("");
  const [factorEditorStatus, setFactorEditorStatus] = useState<string>("");
  const [editingFactor, setEditingFactor] = useState<Factor | null>(null);
  const [factorSaving, setFactorSaving] = useState(false);
  const [factorEditorDialogOpen, setFactorEditorDialogOpen] = useState(false);
  const [factorsTotal, setFactorsTotal] = useState(0);
  const [factorsPage, setFactorsPage] = useState(1);
  const [factorsPages, setFactorsPages] = useState(1);
  const factorsPerPage = 20;
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkRemoveText, setBulkRemoveText] = useState<string>("");
  const [bulkPreview, setBulkPreview] = useState<BulkNormalizePreviewRow[]>([]);
  const [bulkSummary, setBulkSummary] = useState<string>("");
  const [bulkWorking, setBulkWorking] = useState(false);
  
  // Edit mode
  const [editingDataset, setEditingDataset] = useState<Dataset | null>(null);
  
  // File upload
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadingDatasetId, setUploadingDatasetId] = useState<number | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploadRejectedRows, setUploadRejectedRows] = useState<UploadRejectedRow[]>([]);
  const [workbookFile, setWorkbookFile] = useState<File | null>(null);
  const [workbookUploading, setWorkbookUploading] = useState(false);
  const [workbookProgress, setWorkbookProgress] = useState(0);
  const [workbookStatus, setWorkbookStatus] = useState("");
  const [workbookSheets, setWorkbookSheets] = useState<WorkbookImportSheetSummary[]>([]);

  const loadDatasets = useCallback(async () => {
    setLoading(true);
    try {
      // Unpaginated fetch used to populate dropdowns elsewhere on this page
      // (factor dataset picker, country options). per_page is set well above
      // the current dataset count so this always returns everything.
      const res = await fetchWithAuth(`${baseUrl}/admin/datasets?per_page=500&archived=all`);
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, `Failed to load datasets (${res.status})`));
      }
      const json = await res.json();
      setDatasets(json.items || []);
      setStatus((prev) => (prev.startsWith("Error loading datasets:") ? "" : prev));
    } catch (e) {
      setStatus(`Error loading datasets: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    loadDatasets();
  }, [loadDatasets]);

  const loadBrowseDatasets = useCallback(
    async (targetPage: number = browsePage) => {
      setBrowseLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(targetPage),
          per_page: "20",
          archived: browseArchivedFilter,
        });
        if (browseQuery) params.set("q", browseQuery);
        if (browseCountryFilter !== "all") params.set("country", browseCountryFilter);
        if (browseYearFilter !== "all") params.set("year", browseYearFilter);

        const res = await fetchWithAuth(`${baseUrl}/admin/datasets?${params.toString()}`);
        if (!res.ok) {
          throw new Error(await readErrorMessage(res, `Failed to load datasets (${res.status})`));
        }
        const json = await res.json();
        setBrowseItems(json.items || []);
        setBrowseTotal(json.total || 0);
        setBrowsePage(json.page || 1);
        setBrowsePages(json.pages || 1);
        if (json.countries?.length) setBrowseCountries(json.countries);
      } catch (e) {
        setStatus(`Error loading datasets: ${(e as Error).message}`);
      } finally {
        setBrowseLoading(false);
      }
    },
    [baseUrl, browseArchivedFilter, browseQuery, browseCountryFilter, browseYearFilter, browsePage]
  );

  useEffect(() => {
    loadBrowseDatasets(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browseCountryFilter, browseYearFilter, browseArchivedFilter]);

  function factorDatasetOption(ds: Dataset): string {
    const parts = [
      String(ds.dataset_id),
      `[${ds.year || "-"}]`,
      ds.name,
      ds.country ? `(${ds.country})` : "",
      ds.archived ? "(archived)" : "",
    ].filter(Boolean);
    return parts.join(" | ");
  }

  function parseDatasetIdRef(value: string): number | null {
    const text = String(value || "").trim();
    if (!text) return null;
    const first = text.split("|")[0].trim();
    const parsed = Number(first);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function resetFactorEditor() {
    setEditingFactor(null);
    setFactorDatasetRef("");
    setFactorEditorYear("");
    setFactorFileName("");
    setFactorDbId("");
    setFactorScope("");
    setFactorReportLabel("");
    setFactorOriginalId("");
    setFactorCategory("");
    setFactorLevel1("");
    setFactorLevel2("");
    setFactorLevel3("");
    setFactorLevel4("");
    setFactorColumnText("");
    setFactorUom("");
    setFactorGhgUnit("");
    setFactorSource("");
    setFactorRegion("");
    setFactorCurrency("");
    setFactorMethod("");
    setFactorValidFrom("");
    setFactorValidTo("");
    setFactorValue("");
    setFactorEditorStatus("");
  }

  function startCreateFactor() {
    resetFactorEditor();
    const latestDataset = [...datasets].sort((a, b) => Number(b.year || 0) - Number(a.year || 0) || a.name.localeCompare(b.name))[0];
    if (latestDataset) {
      setFactorDatasetRef(factorDatasetOption(latestDataset));
      setFactorEditorYear(String(latestDataset.year || ""));
      setFactorFileName(latestDataset.name || "");
      setFactorEditorStatus(`Creating a row for ${latestDataset.name}.`);
    }
    setFactorEditorDialogOpen(true);
  }

  function syncFactorEditorDataset(value: string) {
    setFactorDatasetRef(value);
    const datasetId = parseDatasetIdRef(value);
    const ds = datasetId ? factorDatasetLookup.get(String(datasetId)) : null;
    if (!ds) return;
    if (!factorEditorYear && ds.year) {
      setFactorEditorYear(String(ds.year));
    }
    if (!factorFileName && ds.name) {
      setFactorFileName(ds.name);
    }
  }

  function startEditFactor(factor: Factor) {
    setEditingFactor(factor);
    setFactorDbId(String(factor.db_id));
    const datasetRef = factorDatasetOption(
      {
        dataset_id: factor.dataset_id || 0,
        name: factor.dataset || `Dataset ${factor.dataset_id ?? "-"}`,
        source: "",
        analysis_type: factor.analysis_type || "",
        country: factor.country || "",
        year: factor.year || new Date().getFullYear(),
        version: "",
        valid_from: factor.valid_from || "",
        valid_to: factor.valid_to || "",
        archived: false,
      } as Dataset
    );
    setFactorDatasetRef(datasetRef);
    setFactorFileName(factor.file_name || "");
    setFactorEditorYear(factor.year ? String(factor.year) : "");
    setFactorScope(factor.scope || "");
    setFactorReportLabel(factor.report_label || "");
    setFactorOriginalId(factor.original_id || "");
    setFactorCategory(factor.category || "");
    setFactorLevel1(factor.level_1 || "");
    setFactorLevel2(factor.level_2 || "");
    setFactorLevel3(factor.level_3 || "");
    setFactorLevel4(factor.level_4 || "");
    setFactorColumnText(factor.column_text || "");
    setFactorUom(factor.uom || "");
    setFactorGhgUnit(factor.ghg_unit || "");
    setFactorSource(factor.source || "");
    setFactorRegion(factor.region || "");
    setFactorCurrency(factor.currency || "");
    setFactorMethod(factor.method || "");
    setFactorValidFrom(factor.valid_from || "");
    setFactorValidTo(factor.valid_to || "");
    setFactorValue(factor.factor != null ? String(factor.factor) : "");
    setFactorEditorStatus(`Editing factor row ${factor.db_id}.`);
    setFactorEditorDialogOpen(true);
  }

  function buildFactorPayload(): Record<string, unknown> | null {
    const dataset_id = parseDatasetIdRef(factorDatasetRef);
    if (!dataset_id) {
      setFactorEditorStatus("Please choose a dataset.");
      return null;
    }
    if (!factorOriginalId.trim()) {
      setFactorEditorStatus("Original ID is required.");
      return null;
    }
    if (!factorScope.trim()) {
      setFactorEditorStatus("Scope is required.");
      return null;
    }
    if (factorEditorYear.trim() && !Number.isFinite(Number(factorEditorYear))) {
      setFactorEditorStatus("Year must be numeric.");
      return null;
    }
    const factorNum = Number(factorValue);
    if (!Number.isFinite(factorNum)) {
      setFactorEditorStatus("Factor must be a number.");
      return null;
    }
    return {
      dataset_id,
      file_name: factorFileName.trim() || null,
      year: factorEditorYear ? Number(factorEditorYear) : null,
      original_id: factorOriginalId.trim(),
      scope: factorScope.trim(),
      category: factorCategory.trim() || null,
      level_1: factorLevel1.trim() || null,
      level_2: factorLevel2.trim() || null,
      level_3: factorLevel3.trim() || null,
      level_4: factorLevel4.trim() || null,
      column_text: factorColumnText.trim() || null,
      report_label: factorReportLabel.trim() || null,
      factor: factorNum,
      uom: factorUom.trim() || null,
      ghg_unit: factorGhgUnit.trim() || null,
      source: factorSource.trim() || null,
      region: factorRegion.trim() || null,
      currency: factorCurrency.trim() || null,
      method: factorMethod.trim() || null,
      valid_from: factorValidFrom || null,
      valid_to: factorValidTo || null,
    };
  }

  async function saveFactorRow() {
    const payload = buildFactorPayload();
    if (!payload) return;
    const datasetId = Number(payload.dataset_id);
    const endpoint = editingFactor
      ? `${baseUrl}/admin/factors/${editingFactor.db_id}`
      : `${baseUrl}/admin/datasets/${datasetId}/factors`;

    setFactorSaving(true);
    setFactorEditorStatus(editingFactor ? "Updating factor row..." : "Creating factor row...");
    setStatus(editingFactor ? "Updating factor row..." : "Creating factor row...");

    try {
      const res = await fetchWithAuth(endpoint, {
        method: editingFactor ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, `Failed: ${res.status}`));
      }

      setStatus(editingFactor ? "Factor row updated successfully!" : "Factor row created successfully!");
      setFactorEditorStatus(editingFactor ? "Factor row updated successfully." : "Factor row created successfully.");
      await Promise.all([loadDatasets(), searchFactors(factorsPage)]);
      resetFactorEditor();
      setFactorEditorDialogOpen(false);
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      const message = (e as Error).message;
      setStatus(`Error: ${message}`);
      setFactorEditorStatus(`Error: ${message}`);
    } finally {
      setFactorSaving(false);
    }
  }

  async function uploadFactors(datasetId: number) {
    return uploadFactorsWithReport(datasetId);
  }
  async function uploadFactorsWithReport(datasetId: number) {
    if (!uploadFile) {
      setUploadStatus("Please select a file");
      return;
    }

    setUploadingDatasetId(datasetId);
    setUploadStatus("Uploading file...");
    setUploadRejectedRows([]);

    try {
      const formData = new FormData();
      formData.append("file", uploadFile);

      const res = await uploadFormDataWithProgress(`${baseUrl}/admin/datasets/${datasetId}/upload-factors?replace=true`, {
        method: "POST",
        body: formData,
        credentials: "include",
        onProgress: ({ percent }) => setUploadProgress(percent),
      });

      const text = await res.text();
      let payload: FactorUploadResponse | null = null;
      try {
        payload = JSON.parse(text) as FactorUploadResponse;
      } catch {}

      if (!res.ok) {
        const detail = payload?.detail;
        const message =
          typeof detail === "string"
            ? detail
            : detail?.message || payload?.message || text;
        setUploadStatus(`Upload failed (${res.status}): ${message}`);
        setUploadingDatasetId(null);
        return;
      }

      const imported = Number(payload?.factors_imported || 0);
      const rejected = Number(payload?.rows_rejected || 0);
      const deleted = Number(payload?.deleted_rows || 0);
      setUploadRejectedRows((payload?.rejected_details || []) as UploadRejectedRow[]);
      setUploadStatus(
        `Success. Imported ${imported} factors`
        + (deleted > 0 ? `, removed ${deleted} obsolete rows` : "")
        + (rejected > 0 ? `, rejected ${rejected} invalid row(s)` : "")
      );
      setUploadFile(null);
      setUploadingDatasetId(null);
      await loadDatasets();
    } catch (e) {
      setUploadStatus(`Error: ${(e as Error).message}`);
      setUploadingDatasetId(null);
      setUploadProgress(0);
    }
  }

  async function importWorkbook() {
    if (!workbookFile) {
      setWorkbookStatus("Please select the workbook file");
      return;
    }

    setWorkbookUploading(true);
    setWorkbookProgress(0);
    setWorkbookStatus("Uploading workbook...");
    setWorkbookSheets([]);

    try {
      const formData = new FormData();
      formData.append("file", workbookFile);

      const res = await uploadFormDataWithProgress(`${baseUrl}/admin/datasets/import-conversion-factors-workbook?replace=true`, {
        method: "POST",
        body: formData,
        credentials: "include",
        onProgress: ({ percent }) => setWorkbookProgress(percent),
      });

      const text = await res.text();
      let payload: WorkbookImportResponse | null = null;
      try {
        payload = JSON.parse(text) as WorkbookImportResponse;
      } catch {}

      if (!res.ok) {
        const detail = payload?.detail;
        const message =
          typeof detail === "string"
            ? detail
            : detail?.message || payload?.message || text;
        setWorkbookStatus(`Import failed (${res.status}): ${message}`);
        setWorkbookUploading(false);
        return;
      }

      const sheets = Array.isArray(payload?.sheets) ? payload.sheets : [];
      setWorkbookSheets(sheets);
      setWorkbookStatus(payload?.message || "Workbook imported successfully.");
      setWorkbookFile(null);
      setWorkbookUploading(false);
      await loadDatasets();
    } catch (e) {
      setWorkbookStatus(`Error: ${(e as Error).message}`);
      setWorkbookUploading(false);
      setWorkbookProgress(0);
    }
  }

  async function createDataset() {
    if (!name.trim() || !source.trim()) {
      setStatus("Name and source are required");
      return;
    }

    setStatus("Creating dataset...");
    try {
      const res = await fetchWithAuth(`${baseUrl}/admin/datasets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          source: source.trim(),
          analysis_type: analysisType,
          country: country,
          year: year,
          version: version,
          valid_from: validFrom || null,
          valid_to: validTo || null,
        }),
      });

      if (!res.ok) {
        throw new Error(await readErrorMessage(res, `Failed: ${res.status}`));
      }

      const json = await res.json();
      setStatus(`Dataset created with ID ${json.dataset_id}!`);
      clearForm();
      setDatasetDialogOpen(false);
      loadDatasets();
      loadBrowseDatasets(1);
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    }
  }

  function startCreateDataset() {
    setEditingDataset(null);
    clearForm();
    setDatasetDialogOpen(true);
  }

  function clearForm() {
    setName("");
    setSource("");
    setAnalysisType("Activity");
    setCountry("United Kingdom");
    setYear(new Date().getFullYear());
    setVersion("v1");
    setValidFrom("");
    setValidTo("");
  }

  async function searchFactors(targetPage: number = 1) {
    setStatus("Searching...");
    try {
      const params = new URLSearchParams();
      params.set("q", searchQuery);
      if (factorDbIdFilter) params.set("db_id", factorDbIdFilter);
      const datasetFilterId = parseDatasetIdRef(factorDatasetFilter);
      if (datasetFilterId) params.set("dataset_id", String(datasetFilterId));
      if (factorCountry) params.set("country", factorCountry);
      if (factorYear) params.set("year", factorYear);
      if (factorScopeFilter) params.set("scope", factorScopeFilter);
      if (factorReportLabelFilter) params.set("report_label", factorReportLabelFilter);
      if (factorOriginalIdFilter) params.set("original_id", factorOriginalIdFilter);
      if (factorCategoryFilter) params.set("category", factorCategoryFilter);
      if (factorLevel1Filter) params.set("level_1", factorLevel1Filter);
      if (factorLevel2Filter) params.set("level_2", factorLevel2Filter);
      if (factorLevel3Filter) params.set("level_3", factorLevel3Filter);
      if (factorLevel4Filter) params.set("level_4", factorLevel4Filter);
      if (factorColumnTextFilter) params.set("column_text", factorColumnTextFilter);
      if (factorUomFilter) params.set("uom", factorUomFilter);
      if (factorGhgUnitFilter) params.set("ghg_unit", factorGhgUnitFilter);
      if (factorSourceFilter) params.set("source", factorSourceFilter);
      if (factorRegionFilter) params.set("region", factorRegionFilter);
      if (factorMethodFilter) params.set("method", factorMethodFilter);
      params.set("page", String(targetPage));
      params.set("per_page", String(factorsPerPage));

      const res = await fetchWithAuth(`${baseUrl}/admin/factors?${params.toString()}`);
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, `Failed to search factors (${res.status})`));
      }
      const json = await res.json();
      setFactors(json.items || []);
      setFactorsTotal(json.total || 0);
      setFactorsPage(json.page || 1);
      setFactorsPages(json.pages || 1);
      setStatus(`Found ${json.total ?? (json.items || []).length} factors`);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    }
  }

  function clearFactorFilters() {
    setSearchQuery("");
    setFactorDbIdFilter("");
    setFactorDatasetFilter("");
    setFactorCountry("");
    setFactorYear("");
    setFactorScopeFilter("");
    setFactorReportLabelFilter("");
    setFactorOriginalIdFilter("");
    setFactorCategoryFilter("");
    setFactorLevel1Filter("");
    setFactorLevel2Filter("");
    setFactorLevel3Filter("");
    setFactorLevel4Filter("");
    setFactorColumnTextFilter("");
    setFactorUomFilter("");
    setFactorGhgUnitFilter("");
    setFactorSourceFilter("");
    setFactorRegionFilter("");
    setFactorMethodFilter("");
    setFactors([]);
    setFactorsTotal(0);
    setFactorsPage(1);
    setFactorsPages(1);
    setStatus("Factor search filters cleared.");
  }

  function buildBulkNormalizePayload(dryRun: boolean) {
    const datasetId = parseDatasetIdRef(factorDatasetFilter);
    const dbId = factorDbIdFilter ? Number(factorDbIdFilter) : null;
    const yearValue = factorYear ? Number(factorYear) : null;
    return {
      dry_run: dryRun,
      preview_limit: 50,
      remove_terms: bulkRemoveText,
      q: searchQuery,
      db_id: Number.isFinite(dbId) ? dbId : null,
      dataset_id: datasetId ?? null,
      country: factorCountry || "",
      year: Number.isFinite(yearValue) ? yearValue : null,
      scope: factorScopeFilter || "",
      report_label: factorReportLabelFilter || "",
      original_id: factorOriginalIdFilter || "",
      category: factorCategoryFilter || "",
      level_1: factorLevel1Filter || "",
      level_2: factorLevel2Filter || "",
      level_3: factorLevel3Filter || "",
      level_4: factorLevel4Filter || "",
      column_text: factorColumnTextFilter || "",
      uom: factorUomFilter || "",
      ghg_unit: factorGhgUnitFilter || "",
      source: factorSourceFilter || "",
      region: factorRegionFilter || "",
      method: factorMethodFilter || "",
    };
  }

  async function previewBulkReportLabelChanges() {
    if (!bulkRemoveText.trim()) {
      setBulkSummary("Enter one or more fragments to remove first.");
      return;
    }

    setBulkWorking(true);
    setBulkSummary("Previewing changes...");
    try {
      const res = await fetchWithAuth(`${baseUrl}/admin/factors/bulk-normalize-report-labels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBulkNormalizePayload(true)),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, `Failed to preview changes (${res.status})`));
      }
      const json = (await res.json()) as BulkNormalizeResponse;
      setBulkPreview(json.preview || []);
      setBulkSummary(
        `Preview ready: ${json.matched_count || 0} matched, ${json.changed_count || 0} would change.`
      );
    } catch (e) {
      setBulkSummary(`Error: ${(e as Error).message}`);
    } finally {
      setBulkWorking(false);
    }
  }

  async function applyBulkReportLabelChanges() {
    if (!bulkRemoveText.trim()) {
      setBulkSummary("Enter one or more fragments to remove first.");
      return;
    }

    setBulkWorking(true);
    setBulkSummary("Applying changes...");
    try {
      const res = await fetchWithAuth(`${baseUrl}/admin/factors/bulk-normalize-report-labels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBulkNormalizePayload(false)),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, `Failed to apply changes (${res.status})`));
      }
      const json = (await res.json()) as BulkNormalizeResponse;
      setBulkPreview(json.preview || []);
      setBulkSummary(
        `Applied ${json.updated_count || 0} updates from ${json.changed_count || 0} matching rows.`
      );
      await searchFactors(factorsPage);
    } catch (e) {
      setBulkSummary(`Error: ${(e as Error).message}`);
    } finally {
      setBulkWorking(false);
    }
  }

  async function downloadDataset(datasetId: number, datasetName: string) {
    setStatus(`Downloading ${datasetName}...`);
    try {
      const res = await fetchWithAuth(`${baseUrl}/admin/datasets/${datasetId}/export`);
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, `Failed to download: ${res.status}`));
      }
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${datasetName.replace(/\s+/g, "_")}_dataset_${datasetId}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      setStatus(`Downloaded ${datasetName} successfully!`);
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error downloading: ${(e as Error).message}`);
    }
  }

  function startEditDataset(dataset: Dataset) {
    setEditingDataset(dataset);
    setName(dataset.name);
    setSource(dataset.source);
    setAnalysisType(dataset.analysis_type);
    setCountry(dataset.country);
    setYear(dataset.year || new Date().getFullYear());
    setVersion(dataset.version || "v1");
    setValidFrom(dataset.valid_from || "");
    setValidTo(dataset.valid_to || "");
    setDatasetDialogOpen(true);
  }

  function startUploadForDataset(dataset: Dataset) {
    startEditDataset(dataset);
    window.setTimeout(() => {
      document.getElementById("upload-factors-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  async function updateDataset() {
    if (!editingDataset) return;

    setStatus("Updating dataset...");
    try {
      const res = await fetchWithAuth(`${baseUrl}/admin/datasets/${editingDataset.dataset_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          source: source.trim(),
          analysis_type: analysisType,
          country: country,
          year: year,
          version: version,
          valid_from: validFrom || null,
          valid_to: validTo || null,
        }),
      });

      if (!res.ok) {
        throw new Error(await readErrorMessage(res, `Failed: ${res.status}`));
      }

      setStatus("Dataset updated successfully!");
      setEditingDataset(null);
      clearForm();
      setDatasetDialogOpen(false);
      loadDatasets();
      loadBrowseDatasets(browsePage);
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    }
  }

  async function archiveDataset(datasetId: number, datasetName: string, nextArchived: boolean) {
    const confirmed = await confirmAction({
      title: nextArchived ? "Archive dataset?" : "Restore dataset?",
      description: nextArchived
        ? `Archive dataset "${datasetName}"? It will be hidden from the main view but can be restored later.`
        : `Restore dataset "${datasetName}"? It will become active again.`,
      confirmLabel: nextArchived ? "Archive" : "Restore",
      destructive: nextArchived,
    });
    if (!confirmed) {
      return;
    }

    setStatus(`${nextArchived ? "Archiving" : "Restoring"} ${datasetName}...`);
    try {
      const res = await fetchWithAuth(`${baseUrl}/admin/datasets/${datasetId}/archive`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: nextArchived }),
      });

      if (!res.ok) {
        throw new Error(await readErrorMessage(res, `Failed: ${res.status}`));
      }

      setStatus(`${datasetName} ${nextArchived ? "archived" : "restored"} successfully!`);
      loadDatasets();
      loadBrowseDatasets(browsePage);
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    }
  }

  const datasetCountries = useMemo(() => {
    const existingCountries = new Set(
      datasets.map((ds) => ds.country).filter((value) => Boolean(value && value.trim()))
    );
    return Array.from(existingCountries).sort((a, b) => a.localeCompare(b));
  }, [datasets]);

  // Get unique countries and years for filters
  const countryDatasetCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    datasets.forEach((ds) => {
      if (ds.archived) return;
      const key = (ds.country || "").trim();
      if (!key) return;
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }, [datasets]);

  const datasetCountryOptions = useMemo(() => {
    const options = new Set([...STANDARD_COUNTRIES, ...datasetCountries]);
    return Array.from(options).sort((a, b) => {
      const aCount = countryDatasetCounts[a] || 0;
      const bCount = countryDatasetCounts[b] || 0;
      if (aCount !== bCount) return bCount - aCount;
      return a.localeCompare(b);
    });
  }, [datasetCountries, countryDatasetCounts]);

  const filteredCountryOptions = useMemo(() => {
    const query = countrySearchStarted ? country.trim().toLowerCase() : "";
    const filtered = !query
      ? datasetCountryOptions
      : datasetCountryOptions.filter((option) => option.toLowerCase().includes(query));
    return filtered.slice(0, 100);
  }, [country, countrySearchStarted, datasetCountryOptions]);

  const factorCountryOptions = useMemo(() => datasetCountries, [datasetCountries]);

  const factorDatasetOptions = useMemo(() => {
    return [...datasets]
      .sort((a, b) => Number(b.year || 0) - Number(a.year || 0) || a.name.localeCompare(b.name))
      .map((ds) => factorDatasetOption(ds));
  }, [datasets]);

  const factorDatasetLookup = useMemo(() => {
    return new Map(datasets.map((ds) => [String(ds.dataset_id), ds]));
  }, [datasets]);

  const allYearOptions = useMemo(() => {
    const years = Array.from(
      new Set(datasets.map((ds) => ds.year).filter((value): value is number => Number.isFinite(value)))
    ).sort((a, b) => b - a);
    return years.map((year) => String(year));
  }, [datasets]);

  const datasetYearOptions = useMemo(() => allYearOptions, [allYearOptions]);

  const factorYearOptions = useMemo(() => allYearOptions, [allYearOptions]);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: '#F26624' }}>Datasets & Factors</h1>
            <p className="text-sm text-muted-foreground">
              Manage conversion factor datasets and search factors
            </p>
          </div>
          <Button variant="secondary" asChild>
            <Link href="/admin">← Back to Admin</Link>
          </Button>
        </div>

        {status && (
          <div
            className={
              status.toLowerCase().startsWith("error")
                ? "mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-700"
                : "mb-4 rounded-md bg-muted p-3 text-sm"
            }
          >
            {status}
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="browse">Browse Datasets</TabsTrigger>
            <TabsTrigger value="factors">Search &amp; Edit Factors</TabsTrigger>
            <TabsTrigger value="tools">Import &amp; Tools</TabsTrigger>
          </TabsList>

          <TabsContent value="browse" className="space-y-4">
            <Card>
              <CardContent className="pt-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex flex-1 gap-2">
                    <Input
                      placeholder="Search dataset name or source..."
                      value={browseQuery}
                      onChange={(e) => setBrowseQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && loadBrowseDatasets(1)}
                      className="min-w-64"
                    />
                    <Button variant="secondary" onClick={() => loadBrowseDatasets(1)}>
                      Search
                    </Button>
                  </div>

                  <Select value={browseCountryFilter} onValueChange={setBrowseCountryFilter}>
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="All countries" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All countries</SelectItem>
                      {browseCountries.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={browseYearFilter} onValueChange={setBrowseYearFilter}>
                    <SelectTrigger className="w-32">
                      <SelectValue placeholder="All years" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All years</SelectItem>
                      {allYearOptions.map((y) => (
                        <SelectItem key={y} value={y}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={browseArchivedFilter} onValueChange={setBrowseArchivedFilter}>
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="false">Active only</SelectItem>
                      <SelectItem value="true">Archived only</SelectItem>
                      <SelectItem value="all">All</SelectItem>
                    </SelectContent>
                  </Select>

                  <Button onClick={startCreateDataset}>+ New Dataset</Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {browseLoading ? "Loading..." : `${browseTotal.toLocaleString()} datasets`}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/40">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-muted-foreground">Name</th>
                        <th className="px-4 py-2 text-left font-medium text-muted-foreground">Country</th>
                        <th className="px-4 py-2 text-left font-medium text-muted-foreground">Year</th>
                        <th className="px-4 py-2 text-left font-medium text-muted-foreground">Source</th>
                        <th className="px-4 py-2 text-left font-medium text-muted-foreground">Type</th>
                        <th className="px-4 py-2 text-right font-medium text-muted-foreground">Factors</th>
                        <th className="px-4 py-2 text-left font-medium text-muted-foreground">Valid</th>
                        <th className="px-4 py-2 text-left font-medium text-muted-foreground">Status</th>
                        <th className="px-4 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {browseItems.map((ds) => (
                        <tr key={ds.dataset_id} className="hover:bg-muted/20">
                          <td className="px-4 py-2 font-medium">{ds.name}</td>
                          <td className="px-4 py-2 text-muted-foreground">{ds.country || "—"}</td>
                          <td className="px-4 py-2 text-muted-foreground">{ds.year ?? "—"}</td>
                          <td className="px-4 py-2 text-muted-foreground">{ds.source || "—"}</td>
                          <td className="px-4 py-2 text-muted-foreground">{ds.analysis_type || "—"}</td>
                          <td className={`px-4 py-2 text-right tabular-nums font-semibold ${(ds.factor_count || 0) === 0 ? "text-red-600" : "text-green-600"}`}>
                            {ds.factor_count ?? 0}
                          </td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">
                            {ds.valid_from && ds.valid_to ? `${ds.valid_from} – ${ds.valid_to}` : "—"}
                          </td>
                          <td className="px-4 py-2">
                            {ds.archived ? (
                              <Badge variant="secondary" className="text-xs">Archived</Badge>
                            ) : (
                              <Badge variant="outline" className="border-green-500 text-xs text-green-600">Active</Badge>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="ghost" onClick={() => startEditDataset(ds)}>Edit</Button>
                              <Button size="sm" variant="ghost" onClick={() => startUploadForDataset(ds)}>Upload CSV</Button>
                              <Button size="sm" variant="ghost" onClick={() => downloadDataset(ds.dataset_id, ds.name)}>Download</Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className={ds.archived ? "text-green-600" : "text-muted-foreground"}
                                onClick={() => archiveDataset(ds.dataset_id, ds.name, !ds.archived)}
                              >
                                {ds.archived ? "Restore" : "Archive"}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {!browseLoading && browseItems.length === 0 && (
                        <tr>
                          <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                            No datasets found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {browsePages > 1 && (
                  <div className="flex items-center justify-between border-t px-4 py-3">
                    <span className="text-sm text-muted-foreground">
                      Page {browsePage} of {browsePages}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={browsePage <= 1 || browseLoading}
                        onClick={() => loadBrowseDatasets(browsePage - 1)}
                      >
                        Previous
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={browsePage >= browsePages || browseLoading}
                        onClick={() => loadBrowseDatasets(browsePage + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="factors" className="space-y-4">
            <Card className="w-full">
              <CardHeader>
                <CardTitle>Search Conversion Factors</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 lg:grid-cols-4">
                  <div className="space-y-2 lg:col-span-2">
                    <Label htmlFor="searchQuery">Search Text</Label>
                    <Input
                      id="searchQuery"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search labels, descriptors, IDs, notes..."
                      onKeyDown={(e) => {
                        if (e.key === "Enter") searchFactors(1);
                      }}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="factorDbIdFilter">DB ID</Label>
                    <Input
                      id="factorDbIdFilter"
                      value={factorDbIdFilter}
                      onChange={(e) => setFactorDbIdFilter(e.target.value)}
                      placeholder="12345"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") searchFactors(1);
                      }}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="factorDatasetFilter">Dataset</Label>
                    <SearchableStringSelect
                      id="factorDatasetFilter"
                      value={factorDatasetFilter}
                      options={factorDatasetOptions}
                      placeholder="All datasets"
                      showClearButton
                      onValueChange={setFactorDatasetFilter}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="factorCountry">Country</Label>
                    <SearchableStringSelect
                      id="factorCountry"
                      value={factorCountry}
                      options={factorCountryOptions}
                      placeholder="All Countries"
                      showClearButton
                      optionBadges={countryDatasetCounts}
                      onValueChange={setFactorCountry}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="factorYear">Year</Label>
                    <SearchableStringSelect
                      id="factorYear"
                      value={factorYear}
                      options={factorYearOptions}
                      placeholder="All Years"
                      showClearButton
                      onValueChange={setFactorYear}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="factorScopeFilter">Scope</Label>
                    <Input
                      id="factorScopeFilter"
                      value={factorScopeFilter}
                      onChange={(e) => setFactorScopeFilter(e.target.value)}
                      placeholder="Scope 1 / Scope 2 / Scope 3"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") searchFactors(1);
                      }}
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="factorReportLabelFilter">Report Label</Label>
                    <Input
                      id="factorReportLabelFilter"
                      value={factorReportLabelFilter}
                      onChange={(e) => setFactorReportLabelFilter(e.target.value)}
                      placeholder="Report label..."
                      onKeyDown={(e) => {
                        if (e.key === "Enter") searchFactors(1);
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="factorOriginalIdFilter">Original ID</Label>
                    <Input
                      id="factorOriginalIdFilter"
                      value={factorOriginalIdFilter}
                      onChange={(e) => setFactorOriginalIdFilter(e.target.value)}
                      placeholder="Factor ID..."
                      onKeyDown={(e) => {
                        if (e.key === "Enter") searchFactors(1);
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="factorCategoryFilter">Category</Label>
                    <Input
                      id="factorCategoryFilter"
                      value={factorCategoryFilter}
                      onChange={(e) => setFactorCategoryFilter(e.target.value)}
                      placeholder="Category..."
                      onKeyDown={(e) => {
                        if (e.key === "Enter") searchFactors(1);
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="factorLevel1Filter">Level 1</Label>
                    <Input
                      id="factorLevel1Filter"
                      value={factorLevel1Filter}
                      onChange={(e) => setFactorLevel1Filter(e.target.value)}
                      placeholder="Level 1..."
                      onKeyDown={(e) => {
                        if (e.key === "Enter") searchFactors(1);
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="factorLevel2Filter">Level 2</Label>
                    <Input
                      id="factorLevel2Filter"
                      value={factorLevel2Filter}
                      onChange={(e) => setFactorLevel2Filter(e.target.value)}
                      placeholder="Level 2..."
                      onKeyDown={(e) => {
                        if (e.key === "Enter") searchFactors(1);
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="factorLevel3Filter">Level 3</Label>
                    <Input
                      id="factorLevel3Filter"
                      value={factorLevel3Filter}
                      onChange={(e) => setFactorLevel3Filter(e.target.value)}
                      placeholder="Level 3..."
                      onKeyDown={(e) => {
                        if (e.key === "Enter") searchFactors(1);
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="factorLevel4Filter">Level 4</Label>
                    <Input
                      id="factorLevel4Filter"
                      value={factorLevel4Filter}
                      onChange={(e) => setFactorLevel4Filter(e.target.value)}
                      placeholder="Level 4..."
                      onKeyDown={(e) => {
                        if (e.key === "Enter") searchFactors(1);
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="factorColumnTextFilter">Column Text</Label>
                    <Input
                      id="factorColumnTextFilter"
                      value={factorColumnTextFilter}
                      onChange={(e) => setFactorColumnTextFilter(e.target.value)}
                      placeholder="Column text..."
                      onKeyDown={(e) => {
                        if (e.key === "Enter") searchFactors(1);
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="factorUomFilter">UoM</Label>
                    <Input
                      id="factorUomFilter"
                      value={factorUomFilter}
                      onChange={(e) => setFactorUomFilter(e.target.value)}
                      placeholder="Unit..."
                      onKeyDown={(e) => {
                        if (e.key === "Enter") searchFactors(1);
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="factorGhgUnitFilter">GHG Unit</Label>
                    <Input
                      id="factorGhgUnitFilter"
                      value={factorGhgUnitFilter}
                      onChange={(e) => setFactorGhgUnitFilter(e.target.value)}
                      placeholder="kgCO2e..."
                      onKeyDown={(e) => {
                        if (e.key === "Enter") searchFactors(1);
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="factorSourceFilter">Source</Label>
                    <Input
                      id="factorSourceFilter"
                      value={factorSourceFilter}
                      onChange={(e) => setFactorSourceFilter(e.target.value)}
                      placeholder="Source..."
                      onKeyDown={(e) => {
                        if (e.key === "Enter") searchFactors(1);
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="factorRegionFilter">Region</Label>
                    <Input
                      id="factorRegionFilter"
                      value={factorRegionFilter}
                      onChange={(e) => setFactorRegionFilter(e.target.value)}
                      placeholder="Region..."
                      onKeyDown={(e) => {
                        if (e.key === "Enter") searchFactors(1);
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="factorMethodFilter">Method</Label>
                    <Input
                      id="factorMethodFilter"
                      value={factorMethodFilter}
                      onChange={(e) => setFactorMethodFilter(e.target.value)}
                      placeholder="Method..."
                      onKeyDown={(e) => {
                        if (e.key === "Enter") searchFactors(1);
                      }}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => searchFactors(1)}>Search Factors</Button>
                  <Button type="button" variant="secondary" onClick={clearFactorFilters}>
                    Clear Filters
                  </Button>
                  <Button type="button" variant="outline" onClick={startCreateFactor}>
                    Add Factor Row
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setBulkDialogOpen(true)}>
                    Bulk normalise these results
                  </Button>
                </div>

                <div className="text-xs text-muted-foreground">
                  Search is smart across labels, IDs, notes, and metadata. Use the filters to narrow by exact dataset,
                  scope, report label, or any other column before editing the row.
                </div>
              </CardContent>
            </Card>

            <Card className="w-full">
              <CardHeader>
                <CardTitle>{factorsTotal} factor{factorsTotal === 1 ? "" : "s"}</CardTitle>
              </CardHeader>
              <CardContent>
                {factors.length > 0 ? (
                  <>
                    <div className="max-h-[32rem] overflow-auto rounded-md border">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-muted">
                          <tr>
                            <th className="p-2 text-left">DB ID</th>
                            <th className="p-2 text-left">ID</th>
                            <th className="p-2 text-left">Dataset</th>
                            <th className="p-2 text-left">Scope</th>
                            <th className="p-2 text-left">Category</th>
                            <th className="p-2 text-left">Report Label</th>
                            <th className="p-2 text-right">Factor</th>
                            <th className="p-2 text-left">Unit</th>
                            <th className="p-2 text-left">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {factors.map((f) => (
                            <tr key={f.db_id} className="border-t">
                              <td className="p-2 text-xs text-muted-foreground">{f.db_id}</td>
                              <td className="p-2 text-xs text-muted-foreground">{f.original_id}</td>
                              <td className="p-2">{f.dataset}</td>
                              <td className="p-2">{f.scope}</td>
                              <td className="p-2">{f.category || "-"}</td>
                              <td className="p-2">{f.report_label || f.column_text}</td>
                              <td className="p-2 text-right">{f.factor}</td>
                              <td className="p-2">{f.ghg_unit || f.uom || "-"}</td>
                              <td className="p-2">
                                <Button type="button" variant="outline" size="sm" onClick={() => startEditFactor(f)}>
                                  Edit
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex items-center justify-between pt-3 text-sm text-muted-foreground">
                      <div>Page {factorsPage} of {factorsPages}</div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={factorsPage <= 1}
                          onClick={() => searchFactors(factorsPage - 1)}
                        >
                          Previous
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={factorsPage >= factorsPages}
                          onClick={() => searchFactors(factorsPage + 1)}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    No results yet. Use the filters above and click Search Factors.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tools" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Import DESNZ / DEFRA Conversion Workbook</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-xs text-muted-foreground">
                  Upload the official year-by-year DESNZ / DEFRA Excel workbook (.xlsx) to merge UK factor data in place.
                  Download the workbook from the UK government website (search: &ldquo;DESNZ greenhouse gas reporting conversion factors&rdquo;), then upload it here.
                </div>
                <div className="text-xs">
                  <a
                    href={`${baseUrl}/admin/datasets/blank-upload-template`}
                    className="font-medium text-primary underline underline-offset-2"
                    download="factors_upload_template.xlsx"
                  >
                    Download blank XLSX template
                  </a>
                  {" "}(for a single dataset&apos;s CSV upload, available from the Edit Dataset dialog in Browse Datasets)
                </div>
                <div className="flex gap-2">
                  <Input
                    type="file"
                    accept=".xlsx"
                    onChange={(e) => {
                      setWorkbookFile(e.target.files?.[0] || null);
                      setWorkbookStatus("");
                      setWorkbookSheets([]);
                    }}
                    className="flex-1"
                    disabled={workbookUploading}
                  />
                  <Button
                    onClick={importWorkbook}
                    disabled={!workbookFile || workbookUploading}
                  >
                    {workbookUploading ? "Importing..." : "Import Workbook"}
                  </Button>
                </div>
                {workbookUploading ? (
                  <UploadProgressBar value={workbookProgress} label="Importing workbook..." />
                ) : null}
                {workbookStatus && (
                  <div className={`p-3 rounded-md text-sm font-medium ${
                    workbookStatus.startsWith("Imported") || workbookStatus.startsWith("Success") || workbookStatus.startsWith("Workbook imported")
                      ? "bg-green-100 text-green-800 border border-green-200"
                      : workbookStatus.includes("failed") || workbookStatus.includes("Error")
                      ? "bg-red-100 text-red-800 border border-red-200"
                      : "bg-blue-100 text-blue-800 border border-blue-200"
                  }`}>
                    {workbookStatus}
                  </div>
                )}
                {workbookSheets.length > 0 && (
                  <div className="rounded-md border bg-muted/20 p-3 text-sm">
                    <div className="font-medium">Workbook sheet summary</div>
                    <div className="mt-2 space-y-2">
                      {workbookSheets.map((sheet) => (
                        <div key={sheet.sheet_name} className="rounded-md border bg-background p-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-medium">{sheet.sheet_name}</div>
                            <div className="text-xs text-muted-foreground">Dataset #{sheet.dataset_id}</div>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {sheet.accepted_rows} valid rows, {sheet.updated_rows} updated, {sheet.inserted_rows} inserted
                            {sheet.deleted_rows > 0 ? `, ${sheet.deleted_rows} deleted` : ""}
                            {sheet.blocked_rows > 0 ? `, ${sheet.blocked_rows} referenced retained` : ""}
                            {sheet.rejected_rows > 0 ? `, ${sheet.rejected_rows} rejected` : ""}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <CrossCountryAudit />

            <Card>
              <CardHeader>
                <CardTitle>About Datasets</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <span className="font-medium">Activity-based:</span> Conversion factors based on physical activities (e.g., kWh electricity, km traveled)
                </div>
                <div>
                  <span className="font-medium">Spend-based:</span> Conversion factors based on monetary spend (e.g., £ spent on services)
                </div>
                <div>
                  <span className="font-medium">Valid From/To:</span> Date range when this dataset is applicable for auto-selection
                </div>
                <div>
                  <span className="font-medium">CSV Upload:</span> Use the data import tooling to upload factor CSVs.
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={datasetDialogOpen} onOpenChange={setDatasetDialogOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingDataset ? `Edit Dataset — ${editingDataset.name}` : "New Dataset"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="name">Dataset Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="DESNZ Activity UK 2025"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="source">Source *</Label>
              <Input
                id="source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="DESNZ / DEFRA / Custom"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="analysisType">Analysis Type</Label>
                <Select value={analysisType} onValueChange={setAnalysisType}>
                  <SelectTrigger id="analysisType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Activity">Activity</SelectItem>
                    <SelectItem value="Spend">Spend</SelectItem>
                    <SelectItem value="Activity & Spend">Activity & Spend</SelectItem>
                    <SelectItem value="Custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="country">Country</Label>
                <div className="relative">
                  <Input
                    id="country"
                    value={country}
                    onChange={(e) => {
                      setCountry(e.target.value);
                      setCountrySearchStarted(true);
                      setCountryMenuOpen(true);
                    }}
                    onFocus={() => {
                      setCountrySearchStarted(false);
                      setCountryMenuOpen(true);
                    }}
                    onBlur={() => {
                      // Delay close so click selection can register.
                      setTimeout(() => setCountryMenuOpen(false), 120);
                    }}
                    placeholder="Search country..."
                  />
                  {countryMenuOpen && (
                    <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-background shadow-sm">
                      {filteredCountryOptions.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">No countries found</div>
                      ) : (
                        filteredCountryOptions.map((countryOption) => (
                          <button
                            key={countryOption}
                            type="button"
                            className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setCountry(countryOption);
                              setCountrySearchStarted(false);
                              setCountryMenuOpen(false);
                            }}
                          >
                            {countryOption}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="year">Year</Label>
                <SearchableStringSelect
                  id="year"
                  value={String(year)}
                  options={datasetYearOptions}
                  placeholder="Search years..."
                  onValueChange={(value) => {
                    const parsed = Number(String(value).trim());
                    if (Number.isFinite(parsed)) {
                      setYear(parsed);
                    }
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="version">Version</Label>
                <Input
                  id="version"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="validFrom">Valid From</Label>
                <Input
                  id="validFrom"
                  type="date"
                  value={validFrom}
                  onChange={(e) => setValidFrom(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="validTo">Valid To</Label>
                <Input
                  id="validTo"
                  type="date"
                  value={validTo}
                  onChange={(e) => setValidTo(e.target.value)}
                />
              </div>
            </div>

            {/* Upload Factors Section - only for an existing dataset being edited */}
            {editingDataset && (
              <div id="upload-factors-section" className="mt-2 border-t pt-4 space-y-3">
                <div className="space-y-1">
                  <div className="text-sm font-semibold">Upload Conversion Factors</div>
                  <div className="text-xs text-muted-foreground">
                    Upload a CSV file to replace this dataset&apos;s rows. Columns: ID, Scope, Factor (required) +
                    Category, Levels 1–4, UOM, GHG Unit, Report Label, Year, Source, etc.
                  </div>
                  <div className="text-xs">
                    <a
                      href={`${baseUrl}/admin/datasets/blank-upload-template`}
                      className="font-medium text-primary underline underline-offset-2"
                      download="factors_upload_template.xlsx"
                    >
                      Download blank XLSX template
                    </a>
                    {" "}(open in Excel, fill in data, save as CSV, then upload)
                  </div>
                </div>

                <div className="flex gap-2">
                  <Input
                    type="file"
                    accept=".csv"
                    onChange={(e) => {
                      setUploadFile(e.target.files?.[0] || null);
                      setUploadStatus("");
                      setUploadRejectedRows([]);
                    }}
                    className="flex-1"
                    disabled={uploadingDatasetId === editingDataset.dataset_id}
                  />
                  <Button
                    onClick={() => uploadFactors(editingDataset.dataset_id)}
                    disabled={!uploadFile || uploadingDatasetId === editingDataset.dataset_id}
                  >
                    {uploadingDatasetId === editingDataset.dataset_id ? "Uploading..." : "Upload CSV"}
                  </Button>
                </div>
                {uploadingDatasetId === editingDataset.dataset_id ? (
                  <UploadProgressBar value={uploadProgress} label="Uploading factors..." />
                ) : null}

                {uploadStatus && (
                  <div className={`p-3 rounded-md text-sm font-medium ${
                    uploadStatus.startsWith("Success")
                      ? "bg-green-100 text-green-800 border border-green-200"
                      : uploadStatus.includes("failed") || uploadStatus.includes("Error")
                      ? "bg-red-100 text-red-800 border border-red-200"
                      : "bg-blue-100 text-blue-800 border border-blue-200"
                  }`}>
                    {uploadStatus}
                  </div>
                )}
                {uploadRejectedRows.length > 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <div className="font-medium">Rejected rows</div>
                    <div className="mt-2 space-y-1">
                      {uploadRejectedRows.slice(0, 10).map((row) => (
                        <div key={`${row.row_number}-${row.original_id ?? ""}-${row.scope ?? ""}`}>
                          Row {row.row_number}
                          {row.original_id ? `, ID ${row.original_id}` : ""}
                          {row.scope ? `, ${row.scope}` : ""}: {row.reason}
                        </div>
                      ))}
                      {uploadRejectedRows.length > 10 && (
                        <div>Showing first 10 of {uploadRejectedRows.length} rejected rows.</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDatasetDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={editingDataset ? updateDataset : createDataset}>
              {editingDataset ? "Save changes" : "Create dataset"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bulk normalise report labels</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Uses the factor filters currently active in Search & Edit Factors as the scope, then removes repeated
              fragments from <code>report_label</code>. This is ideal for trimming labels like <code>- Cars (by size)</code>{" "}
              across Business Travel, Employee Commuting, and Company Vehicles.
            </div>

            <div className="rounded-md border bg-muted/20 p-4 space-y-2">
              <div className="text-sm font-medium">Current scope (from the search filters)</div>
              <div className="text-xs text-muted-foreground">
                {searchQuery ? `Search text: "${searchQuery}"` : "Search text: none"}
              </div>
              <div className="text-xs text-muted-foreground">
                {factorCategoryFilter ? `Category: ${factorCategoryFilter}` : "Category: all"}
              </div>
              <div className="text-xs text-muted-foreground">
                {factorReportLabelFilter ? `Report label: ${factorReportLabelFilter}` : "Report label: all"}
              </div>
              <div className="text-xs text-muted-foreground">
                {factorCountry ? `Country: ${factorCountry}` : "Country: all"}
              </div>
              <div className="text-xs text-muted-foreground">
                {factorYear ? `Year: ${factorYear}` : "Year: all"}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bulkRemoveText">Remove fragments</Label>
              <Textarea
                id="bulkRemoveText"
                value={bulkRemoveText}
                onChange={(e) => setBulkRemoveText(e.target.value)}
                placeholder={`Cars (by size)\nVehicles (by size)\nby vehicle size`}
                rows={5}
              />
              <div className="text-xs text-muted-foreground">
                Enter one fragment per line. Matching is case-insensitive and only affects <code>report_label</code>.
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={previewBulkReportLabelChanges} disabled={bulkWorking}>
                Preview changes
              </Button>
              <Button type="button" onClick={applyBulkReportLabelChanges} disabled={bulkWorking}>
                Apply changes
              </Button>
            </div>

            {bulkSummary && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">{bulkSummary}</div>
            )}

            {bulkPreview.length > 0 && (
              <div className="max-h-80 overflow-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      <th className="p-2 text-left">DB ID</th>
                      <th className="p-2 text-left">Original ID</th>
                      <th className="p-2 text-left">Current Label</th>
                      <th className="p-2 text-left">New Label</th>
                      <th className="p-2 text-left">Category</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkPreview.map((row) => (
                      <tr key={row.db_id} className="border-t align-top">
                        <td className="p-2 text-xs text-muted-foreground">{row.db_id}</td>
                        <td className="p-2 text-xs text-muted-foreground">{row.original_id || "-"}</td>
                        <td className="p-2">{row.current_label}</td>
                        <td className="p-2 font-medium">{row.new_label}</td>
                        <td className="p-2 text-xs text-muted-foreground">{row.category || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={factorEditorDialogOpen}
        onOpenChange={(open) => {
          setFactorEditorDialogOpen(open);
          if (!open) resetFactorEditor();
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3 pr-6">
              <DialogTitle>{editingFactor ? `Edit Factor Row #${editingFactor.db_id}` : "Add Factor Row"}</DialogTitle>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={startCreateFactor}>
                  New Row
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={resetFactorEditor}>
                  Clear Editor
                </Button>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4">
            {factorEditorStatus && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                {factorEditorStatus}
              </div>
            )}

            {editingFactor?.factor_definition_id && (
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                <span className="font-semibold">Linked to factor definition #{editingFactor.factor_definition_id}.</span>{" "}
                Fields marked <span className="font-semibold text-blue-700">★ All years</span> will update every dataset year that shares this factor — not just this one row.
                {editingFactor.factor_year_value_id && (
                  <> Year-specific values (factor, valid dates, currency) update only this year (year value #{editingFactor.factor_year_value_id}).</>
                )}
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="factorDatasetRef">Dataset</Label>
                <SearchableStringSelect
                  id="factorDatasetRef"
                  value={factorDatasetRef}
                  options={factorDatasetOptions}
                  placeholder="Select a dataset..."
                  showClearButton
                  onValueChange={syncFactorEditorDataset}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="factorDbId">DB ID</Label>
                <Input
                  id="factorDbId"
                  value={factorDbId}
                  readOnly
                  placeholder="New row"
                  className="bg-muted"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="factorFileName">File Name</Label>
                <Input id="factorFileName" value={factorFileName} onChange={(e) => setFactorFileName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="factorEditorYear">Year</Label>
                <Input
                  id="factorEditorYear"
                  value={factorEditorYear}
                  onChange={(e) => setFactorEditorYear(e.target.value)}
                  placeholder="2025"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="factorValue">Factor</Label>
                <Input
                  id="factorValue"
                  value={factorValue}
                  onChange={(e) => setFactorValue(e.target.value)}
                  placeholder="0.231"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="factorUom">
                  UoM{editingFactor?.factor_definition_id ? <span className="ml-1 text-xs font-semibold text-blue-600">★ All years</span> : null}
                </Label>
                <Input id="factorUom" value={factorUom} onChange={(e) => setFactorUom(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="factorGhgUnit">
                  GHG Unit{editingFactor?.factor_definition_id ? <span className="ml-1 text-xs font-semibold text-blue-600">★ All years</span> : null}
                </Label>
                <Input id="factorGhgUnit" value={factorGhgUnit} onChange={(e) => setFactorGhgUnit(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="factorOriginalId">Original ID</Label>
                <Input id="factorOriginalId" value={factorOriginalId} onChange={(e) => setFactorOriginalId(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="factorScope">
                  Scope{editingFactor?.factor_definition_id ? <span className="ml-1 text-xs font-semibold text-blue-600">★ All years</span> : null}
                </Label>
                <Input id="factorScope" value={factorScope} onChange={(e) => setFactorScope(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="factorReportLabel">
                  Report Label{editingFactor?.factor_definition_id ? <span className="ml-1 text-xs font-semibold text-blue-600">★ All years</span> : null}
                </Label>
                <Input id="factorReportLabel" value={factorReportLabel} onChange={(e) => setFactorReportLabel(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="factorCategory">
                  Category{editingFactor?.factor_definition_id ? <span className="ml-1 text-xs font-semibold text-blue-600">★ All years</span> : null}
                </Label>
                <Input id="factorCategory" value={factorCategory} onChange={(e) => setFactorCategory(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="factorLevel1">
                  Level 1{editingFactor?.factor_definition_id ? <span className="ml-1 text-xs font-semibold text-blue-600">★ All years</span> : null}
                </Label>
                <Input id="factorLevel1" value={factorLevel1} onChange={(e) => setFactorLevel1(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="factorLevel2">
                  Level 2{editingFactor?.factor_definition_id ? <span className="ml-1 text-xs font-semibold text-blue-600">★ All years</span> : null}
                </Label>
                <Input id="factorLevel2" value={factorLevel2} onChange={(e) => setFactorLevel2(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="factorLevel3">
                  Level 3{editingFactor?.factor_definition_id ? <span className="ml-1 text-xs font-semibold text-blue-600">★ All years</span> : null}
                </Label>
                <Input id="factorLevel3" value={factorLevel3} onChange={(e) => setFactorLevel3(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="factorLevel4">
                  Level 4{editingFactor?.factor_definition_id ? <span className="ml-1 text-xs font-semibold text-blue-600">★ All years</span> : null}
                </Label>
                <Input id="factorLevel4" value={factorLevel4} onChange={(e) => setFactorLevel4(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="factorColumnText">
                  Column Text{editingFactor?.factor_definition_id ? <span className="ml-1 text-xs font-semibold text-blue-600">★ All years</span> : null}
                </Label>
                <Input id="factorColumnText" value={factorColumnText} onChange={(e) => setFactorColumnText(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="factorSource">
                  Source{editingFactor?.factor_definition_id ? <span className="ml-1 text-xs font-semibold text-blue-600">★ All years</span> : null}
                </Label>
                <Input id="factorSource" value={factorSource} onChange={(e) => setFactorSource(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="factorRegion">
                  Region{editingFactor?.factor_definition_id ? <span className="ml-1 text-xs font-semibold text-blue-600">★ All years</span> : null}
                </Label>
                <Input id="factorRegion" value={factorRegion} onChange={(e) => setFactorRegion(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="factorCurrency">Currency</Label>
                <Input id="factorCurrency" value={factorCurrency} onChange={(e) => setFactorCurrency(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="factorMethod">
                  Method{editingFactor?.factor_definition_id ? <span className="ml-1 text-xs font-semibold text-blue-600">★ All years</span> : null}
                </Label>
                <Input id="factorMethod" value={factorMethod} onChange={(e) => setFactorMethod(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="factorValidFrom">Valid From</Label>
                <Input id="factorValidFrom" type="date" value={factorValidFrom} onChange={(e) => setFactorValidFrom(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="factorValidTo">Valid To</Label>
                <Input id="factorValidTo" type="date" value={factorValidTo} onChange={(e) => setFactorValidTo(e.target.value)} />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setFactorEditorDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={saveFactorRow} disabled={factorSaving}>
              {factorSaving ? "Saving..." : editingFactor ? "Update Factor Row" : "Create Factor Row"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Cross-Country Audit Panel ────────────────────────────────────────────────

type AuditJobSummary = {
  job_number: string | null;
  job_title: string | null;
  client_name: string | null;
  client_country?: string | null;
  datasets?: string[];
  row_count: number;
};

type AuditResult = {
  orphaned_dataset_id: { description: string; total_rows: number; jobs: AuditJobSummary[] };
  cross_country_mismatch: { description: string; total_rows: number; jobs: AuditJobSummary[] };
};

function CrossCountryAudit() {
  const [result, setResult] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [fixResult, setFixResult] = useState<string>("");
  const [error, setError] = useState("");

  const runAudit = useCallback(async () => {
    setLoading(true);
    setError("");
    setFixResult("");
    try {
      const res = await fetchWithAuth(`${apiBaseUrl()}/admin/datasets/cross-country-audit`);
      if (!res.ok) {
        const msg = await readErrorMessage(res, `Error ${res.status}`);
        throw new Error(msg);
      }
      setResult(await res.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const runFix = useCallback(async () => {
    setFixing(true);
    setError("");
    setFixResult("");
    try {
      const res = await fetchWithAuth(`${apiBaseUrl()}/admin/datasets/fix-cross-country`, { method: "POST" });
      if (!res.ok) {
        const msg = await readErrorMessage(res, `Error ${res.status}`);
        throw new Error(msg);
      }
      const json = await res.json() as { message: string };
      setFixResult(json.message);
      // Re-run audit to show updated state
      const auditRes = await fetchWithAuth(`${apiBaseUrl()}/admin/datasets/cross-country-audit`);
      if (auditRes.ok) setResult(await auditRes.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFixing(false);
    }
  }, []);

  const hasMismatches = (result?.cross_country_mismatch.total_rows ?? 0) > 0;

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>Dataset Reference Audit</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Find job rows referencing a dataset from the wrong country, or with orphaned dataset references after a factor upload.
            </p>
          </div>
          <div className="flex gap-2">
            {result && hasMismatches && (
              <Button onClick={runFix} disabled={fixing} variant="default">
                {fixing ? "Fixing…" : "Fix Mismatches"}
              </Button>
            )}
            <Button variant="outline" onClick={runAudit} disabled={loading || fixing}>
              {loading ? "Running…" : "Run Audit"}
            </Button>
          </div>
        </div>
      </CardHeader>
      {(result || error || fixResult) && (
        <CardContent className="space-y-6">
          {fixResult && <p className="text-sm text-green-700 font-medium">{fixResult}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {result && (
            <>
              <AuditSection
                title="Orphaned dataset_id (factor deleted, reference remains)"
                description={result.orphaned_dataset_id.description}
                totalRows={result.orphaned_dataset_id.total_rows}
                jobs={result.orphaned_dataset_id.jobs}
                showDatasets={false}
              />
              <AuditSection
                title="Cross-country mismatch (dataset country ≠ client country)"
                description={result.cross_country_mismatch.description}
                totalRows={result.cross_country_mismatch.total_rows}
                jobs={result.cross_country_mismatch.jobs}
                showDatasets
              />
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function AuditSection({
  title,
  description,
  totalRows,
  jobs,
  showDatasets,
}: {
  title: string;
  description: string;
  totalRows: number;
  jobs: AuditJobSummary[];
  showDatasets: boolean;
}) {
  return (
    <div>
      <h3 className="font-semibold text-sm">{title}</h3>
      <p className="text-xs text-muted-foreground mt-0.5 mb-2">{description}</p>
      {totalRows === 0 ? (
        <p className="text-sm text-green-700 font-medium">No issues found.</p>
      ) : (
        <>
          <p className="text-sm text-amber-700 font-medium mb-2">{totalRows} affected row{totalRows !== 1 ? "s" : ""} across {jobs.length} job{jobs.length !== 1 ? "s" : ""}.</p>
          <div className="rounded border overflow-hidden text-xs">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2">Job</th>
                  <th className="text-left px-3 py-2">Client</th>
                  {showDatasets && <th className="text-left px-3 py-2">Client Country</th>}
                  {showDatasets && <th className="text-left px-3 py-2">Wrong Dataset(s)</th>}
                  <th className="text-right px-3 py-2">Rows</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {jobs.map((j, i) => (
                  <tr key={i} className="hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono">{j.job_number || "—"} <span className="font-sans text-muted-foreground">{j.job_title}</span></td>
                    <td className="px-3 py-2">{j.client_name}</td>
                    {showDatasets && <td className="px-3 py-2">{j.client_country}</td>}
                    {showDatasets && <td className="px-3 py-2">{(j.datasets || []).join(", ")}</td>}
                    <td className="px-3 py-2 text-right">{j.row_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
