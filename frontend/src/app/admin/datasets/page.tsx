"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import SearchableStringSelect from "@/components/SearchableStringSelect";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const envBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "").trim();
  if (!envBase) {
    return "/api/backend";
  }
  if (envBase === "/api/backend") {
    return "/api/backend";
  }
  return envBase;
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
  original_id: string;
  dataset: string;
  scope: string;
  category?: string | null;
  level_1?: string | null;
  column_text: string;
  report_label: string;
  factor: number;
  uom: string;
  ghg_unit: string;
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

export default function DatasetsPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const confirmAction = useConfirmDialog();
  
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [factors, setFactors] = useState<Factor[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  
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
  
  // Dataset filters
  const [filterCountry, setFilterCountry] = useState<string>("");
  const [filterYear, setFilterYear] = useState<string>("");
  
  // Edit mode
  const [editingDataset, setEditingDataset] = useState<Dataset | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  
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

  useEffect(() => {
    loadDatasets();
  }, [baseUrl]);

  async function loadDatasets() {
    setLoading(true);
    try {
      const res = await fetchWithAuth(`${baseUrl}/admin/datasets`);
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
  }

  async function uploadFactors(datasetId: number) {
    if (!uploadFile) {
      setUploadStatus("Please select a file");
      return;
    }

    console.log("Starting upload for dataset:", datasetId, "File:", uploadFile.name);
    setUploadingDatasetId(datasetId);
    setUploadProgress(0);
    setUploadStatus("📤 Uploading file...");

    try {
      const formData = new FormData();
      formData.append("file", uploadFile);

      console.log("Sending request to:", `${baseUrl}/admin/datasets/${datasetId}/upload-factors`);
      
      // Update status to show processing
      setTimeout(() => {
        if (uploadingDatasetId === datasetId) {
          setUploadStatus("⚙️ Processing CSV and importing factors... This may take a moment for large files.");
        }
      }, 500);

      const res = await uploadFormDataWithProgress(`${baseUrl}/admin/datasets/${datasetId}/upload-factors?replace=true`, {
        method: "POST",
        body: formData,
        credentials: "include",
        onProgress: ({ percent }) => setUploadProgress(percent),
      });

      console.log("Response status:", res.status, res.statusText);

      if (res.ok) {
        const json = await res.json();
        console.log("Upload response:", json);
        setUploadStatus(`✓ Success! Imported ${json.factors_imported} factors`);
        setUploadFile(null);
        setUploadingDatasetId(null);
        await loadDatasets();
      } else {
        const text = await res.text();
        console.error("Upload failed:", res.status, text);
        setUploadStatus(`✗ Upload failed (${res.status}): ${text}`);
        setUploadingDatasetId(null);
      }
    } catch (e) {
      console.error("Upload error:", e);
      setUploadStatus(`✗ Error: ${(e as Error).message}`);
      setUploadingDatasetId(null);
      setUploadProgress(0);
    }
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
      let payload: any = null;
      try {
        payload = JSON.parse(text);
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
      let payload: any = null;
      try {
        payload = JSON.parse(text);
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

      const sheets = Array.isArray(payload?.sheets) ? (payload.sheets as WorkbookImportSheetSummary[]) : [];
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
      loadDatasets();
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    }
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

  async function searchFactors() {
    setStatus("Searching...");
    try {
      const params = new URLSearchParams();
      params.set("q", searchQuery);
      if (factorCountry) params.set("country", factorCountry);
      if (factorYear) params.set("year", factorYear);
      params.set("limit", "100");

      const res = await fetchWithAuth(`${baseUrl}/admin/factors?${params.toString()}`);
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, `Failed to search factors (${res.status})`));
      }
      const json = await res.json();
      setFactors(json.items || []);
      setStatus(`Found ${json.count} factors`);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
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
    setShowEditDialog(true);
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
      setShowEditDialog(false);
      setEditingDataset(null);
      clearForm();
      loadDatasets();
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    }
  }

  async function archiveDataset(datasetId: number, datasetName: string) {
    const confirmed = await confirmAction({
      title: "Archive dataset?",
      description: `Archive dataset "${datasetName}"? It will be hidden from the main view but can be restored later.`,
      confirmLabel: "Archive",
      destructive: true,
    });
    if (!confirmed) {
      return;
    }

    setStatus(`Archiving ${datasetName}...`);
    try {
      const res = await fetchWithAuth(`${baseUrl}/admin/datasets/${datasetId}/archive`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });

      if (!res.ok) {
        throw new Error(await readErrorMessage(res, `Failed: ${res.status}`));
      }

      setStatus(`${datasetName} archived successfully!`);
      loadDatasets();
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error archiving: ${(e as Error).message}`);
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

  const filterCountryOptions = useMemo(() => datasetCountries, [datasetCountries]);

  const allYearOptions = useMemo(() => {
    const years = Array.from(
      new Set(datasets.map((ds) => ds.year).filter((value): value is number => Number.isFinite(value)))
    ).sort((a, b) => b - a);
    return years.map((year) => String(year));
  }, [datasets]);

  const factorYearOptions = useMemo(() => allYearOptions, [allYearOptions]);

  const filterYearOptions = useMemo(() => allYearOptions, [allYearOptions]);

  useEffect(() => {
    if (!factorCountry) {
      if (factorYear && !factorYearOptions.includes(factorYear)) {
        setFactorYear("");
      }
      return;
    }

    if (!factorYear) {
      const latest = factorYearOptions[0];
      if (latest) {
        setFactorYear(latest);
      }
      return;
    }

    if (!factorYearOptions.includes(factorYear)) {
      const latest = factorYearOptions[0];
      setFactorYear(latest || "");
    }
  }, [factorCountry, factorYear, factorYearOptions]);

  // Filter and group datasets
  const filteredDatasets = useMemo(() => {
    return datasets.filter(ds => {
      // Exclude archived datasets from main list
      if (ds.archived) return false;
      if (filterCountry && ds.country !== filterCountry) return false;
      if (filterYear && ds.year !== Number(filterYear)) return false;
      return true;
    });
  }, [datasets, filterCountry, filterYear]);

  // Group datasets by country and year
  const groupedDatasets = useMemo(() => {
    const groups: Record<string, Record<string, Dataset[]>> = {};
    
    filteredDatasets.forEach(ds => {
      const countryKey = ds.country || "Unknown";
      const yearKey = String(ds.year || "Unknown");
      
      if (!groups[countryKey]) groups[countryKey] = {};
      if (!groups[countryKey][yearKey]) groups[countryKey][yearKey] = [];
      
      groups[countryKey][yearKey].push(ds);
    });
    
    return groups;
  }, [filteredDatasets]);

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

        {status && <div className="mb-4 rounded-md bg-muted p-3 text-sm">{status}</div>}

        <Card className="mb-6 w-full">
          <CardHeader>
            <CardTitle>Search Conversion Factors</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="searchQuery">Search Text</Label>
                <Input
                  id="searchQuery"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search factors..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter") searchFactors();
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="factorCountry">Country</Label>
                <div className="w-full max-w-[180px]">
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
              </div>

              <div className="space-y-2">
                <Label htmlFor="factorYear">Year</Label>
                <div className="w-full max-w-[150px]">
                    <SearchableStringSelect
                      id="factorYear"
                      value={factorYear}
                      options={factorYearOptions}
                      placeholder="All Years"
                      showClearButton
                      onValueChange={setFactorYear}
                    />
                  </div>
              </div>
            </div>

            <Button onClick={searchFactors} className="w-full">
              Search Factors
            </Button>

            <div className="text-xs text-muted-foreground">
              Use country and year to narrow the conversion factor search before applying the text query. The year list
              shows all available dataset years; country still narrows the results.
            </div>

            {factors.length > 0 && (
              <div className="mt-4 max-h-96 overflow-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      <th className="p-2 text-left">ID</th>
                      <th className="p-2 text-left">Dataset</th>
                      <th className="p-2 text-left">Scope</th>
                      <th className="p-2 text-left">Category</th>
                      <th className="p-2 text-left">Level 1</th>
                      <th className="p-2 text-left">Report Label</th>
                      <th className="p-2 text-right">Factor</th>
                      <th className="p-2 text-left">Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {factors.map((f) => (
                      <tr key={f.db_id} className="border-t">
                        <td className="p-2 text-muted-foreground text-xs">{f.original_id}</td>
                        <td className="p-2">{f.dataset}</td>
                        <td className="p-2">{f.scope}</td>
                        <td className="p-2">{f.category || "-"}</td>
                        <td className="p-2">{f.level_1 || "-"}</td>
                        <td className="p-2">{f.report_label || f.column_text}</td>
                        <td className="p-2 text-right">{f.factor}</td>
                        <td className="p-2">{f.ghg_unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Create/Edit Dataset */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{editingDataset ? "Edit Dataset" : "Create New Dataset"}</CardTitle>
                {editingDataset && (
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => {
                      setEditingDataset(null);
                      clearForm();
                    }}
                  >
                    ← Back to Create New
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
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
                  <Input
                    id="year"
                    type="number"
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value))}
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

              <div className="flex gap-2">
                {editingDataset && (
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      setEditingDataset(null);
                      clearForm();
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                )}
                <Button 
                  onClick={editingDataset ? updateDataset : createDataset} 
                  className="flex-1"
                >
                  {editingDataset ? "Update Dataset" : "Create Dataset"}
                </Button>
              </div>
              
              {/* Upload Factors Section - Only show after dataset is created/selected */}
              {editingDataset && (
                <div className="mt-6 pt-6 border-t space-y-3">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold">Upload Conversion Factors</div>
                    <div className="text-xs text-muted-foreground">
                      Upload a CSV file containing conversion factors for this dataset
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
                      onClick={() => uploadFactorsWithReport(editingDataset.dataset_id)}
                      disabled={!uploadFile || uploadingDatasetId === editingDataset.dataset_id}
                    >
                      {uploadingDatasetId === editingDataset.dataset_id ? "Uploading..." : "Upload CSV"}
                    </Button>
                  </div>
                  {uploadingDatasetId === editingDataset.dataset_id ? (
                    <UploadProgressBar value={uploadProgress} label="Uploading factors..." />
                  ) : null}
                  
                  {/* Prominent Success/Failure Message */}
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

              <div className="mt-6 pt-6 border-t space-y-3">
                <div className="space-y-1">
                  <div className="text-sm font-semibold">Import Conversion Workbook</div>
                  <div className="text-xs text-muted-foreground">
                    Upload the year-by-year DESNZ / DEFRA Excel workbook to merge UK factor data in place.
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Expected filename:{" "}
                    <a
                      href="/downloads/DESNZ%20DEFRA%20Conversion%20Factors%202019-2025.xlsx"
                      className="font-medium text-primary underline underline-offset-2"
                      download
                    >
                      DESNZ DEFRA Conversion Factors 2019-2025.xlsx
                    </a>
                  </div>
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
              </div>
            </CardContent>
          </Card>

          {/* Existing Datasets */}
          <Card>
            <CardHeader>
              <CardTitle>Existing Datasets</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Filters */}
              <div className="mb-4 grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="filterCountry">Filter by Country</Label>
                  <div className="w-full max-w-[200px]">
                    <SearchableStringSelect
                      id="filterCountry"
                      value={filterCountry}
                      options={filterCountryOptions}
                      placeholder="All Countries"
                      showClearButton
                      optionBadges={countryDatasetCounts}
                      onValueChange={setFilterCountry}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="filterYear">Filter by Year</Label>
                  <div className="w-full max-w-[150px]">
                    <SearchableStringSelect
                      id="filterYear"
                      value={filterYear}
                      options={filterYearOptions}
                      placeholder="All Years"
                      showClearButton
                      onValueChange={setFilterYear}
                    />
                  </div>
                </div>
              </div>

              {loading ? (
                <div className="text-sm text-muted-foreground">Loading...</div>
              ) : datasets.length === 0 ? (
                <div className="text-sm text-muted-foreground">No datasets found</div>
              ) : filteredDatasets.length === 0 ? (
                <div className="text-sm text-muted-foreground">No datasets match the selected filters</div>
              ) : (
                <div className="space-y-4">
                  {Object.entries(groupedDatasets).sort(([a], [b]) => a.localeCompare(b)).map(([country, yearGroups]) => (
                    <div key={country} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-primary">📁 {country}</div>
                        <div className="h-px flex-1 bg-border"></div>
                      </div>
                      {Object.entries(yearGroups).sort(([a], [b]) => Number(b) - Number(a)).map(([year, datasets]) => (
                        <div key={year} className="ml-4 space-y-2">
                          <div className="flex items-center gap-2">
                            <div className="text-xs font-medium text-muted-foreground">📅 {year}</div>
                            <div className="h-px flex-1 bg-border/50"></div>
                          </div>
                          <div className="ml-4 space-y-2">
                            {datasets.map((ds) => (
                              <div
                                key={ds.dataset_id}
                                className="rounded-md border p-3 hover:bg-muted/50 transition-colors"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex-1">
                                    <div className="font-medium text-sm">
                                      [{ds.dataset_id}] {ds.name}
                                    </div>
                                    <div className="mt-1 text-xs text-muted-foreground">
                                      {ds.source} • {ds.analysis_type} • <span className={`font-semibold ${ds.factor_count === 0 ? 'text-red-600' : 'text-green-600'}`}>{ds.factor_count || 0} factors</span>
                                    </div>
                                    {ds.valid_from && ds.valid_to && (
                                      <div className="mt-1 text-xs text-muted-foreground">
                                        Valid: {ds.valid_from} to {ds.valid_to}
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex gap-2">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => startEditDataset(ds)}
                                    >
                                      Edit
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => archiveDataset(ds.dataset_id, ds.name)}
                                    >
                                      Archive
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => downloadDataset(ds.dataset_id, ds.name)}
                                    >
                                      Download CSV
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Documentation */}
        <Card className="mt-6">
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
      </div>
    </div>
  );
}
