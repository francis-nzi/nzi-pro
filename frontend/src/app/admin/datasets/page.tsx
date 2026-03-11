"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { STANDARD_COUNTRIES } from "@/lib/countries";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
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
  column_text: string;
  factor: number;
  uom: string;
  ghg_unit: string;
  report_label: string;
};

export default function DatasetsPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  
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
  const [selectedDataset, setSelectedDataset] = useState<number | null>(null);
  
  // Dataset filters
  const [filterCountry, setFilterCountry] = useState<string>("All");
  const [filterYear, setFilterYear] = useState<string>("All");
  
  // Edit mode
  const [editingDataset, setEditingDataset] = useState<Dataset | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  
  // File upload
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadingDatasetId, setUploadingDatasetId] = useState<number | null>(null);
  const [uploadStatus, setUploadStatus] = useState("");

  useEffect(() => {
    loadDatasets();
  }, [baseUrl]);

  async function loadDatasets() {
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}/admin/datasets`);
      if (res.ok) {
        const json = await res.json();
        setDatasets(json.items || []);
      }
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

      const res = await fetch(`${baseUrl}/admin/datasets/${datasetId}/upload-factors?replace=true`, {
        method: "POST",
        body: formData,
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
    }
  }

  async function createDataset() {
    if (!name.trim() || !source.trim()) {
      setStatus("Name and source are required");
      return;
    }

    setStatus("Creating dataset...");
    try {
      const res = await fetch(`${baseUrl}/admin/datasets`, {
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
        throw new Error(`Failed: ${res.status}`);
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
      if (selectedDataset) params.set("dataset_id", String(selectedDataset));
      params.set("limit", "100");

      const res = await fetch(`${baseUrl}/admin/factors?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setFactors(json.items || []);
        setStatus(`Found ${json.count} factors`);
      }
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    }
  }

  async function downloadDataset(datasetId: number, datasetName: string) {
    setStatus(`Downloading ${datasetName}...`);
    try {
      const res = await fetch(`${baseUrl}/admin/datasets/${datasetId}/export`);
      if (!res.ok) {
        throw new Error(`Failed to download: ${res.status}`);
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
      const res = await fetch(`${baseUrl}/admin/datasets/${editingDataset.dataset_id}`, {
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
        throw new Error(`Failed: ${res.status}`);
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
    if (!confirm(`Archive dataset "${datasetName}"? It will be hidden from the main view but can be restored later.`)) {
      return;
    }

    setStatus(`Archiving ${datasetName}...`);
    try {
      const res = await fetch(`${baseUrl}/admin/datasets/${datasetId}/archive`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });

      if (!res.ok) {
        throw new Error(`Failed: ${res.status}`);
      }

      setStatus(`${datasetName} archived successfully!`);
      loadDatasets();
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error archiving: ${(e as Error).message}`);
    }
  }

  // Get unique countries and years for filters
  const datasetCountryOptions = useMemo(() => {
    const existingCountries = new Set(
      datasets.map((ds) => ds.country).filter((value) => Boolean(value && value.trim()))
    );
    const options = new Set([...STANDARD_COUNTRIES, ...Array.from(existingCountries)]);
    return Array.from(options).sort((a, b) => a.localeCompare(b));
  }, [datasets]);

  const filteredCountryOptions = useMemo(() => {
    const query = countrySearchStarted ? country.trim().toLowerCase() : "";
    const filtered = !query
      ? datasetCountryOptions
      : datasetCountryOptions.filter((option) => option.toLowerCase().includes(query));
    return filtered.slice(0, 100);
  }, [country, countrySearchStarted, datasetCountryOptions]);

  const uniqueCountries = useMemo(() => {
    const countries = new Set(datasets.map(ds => ds.country));
    return ["All", ...Array.from(countries).sort()];
  }, [datasets]);

  const uniqueYears = useMemo(() => {
    const years = new Set(datasets.map(ds => ds.year));
    return ["All", ...Array.from(years).sort((a, b) => b - a)];
  }, [datasets]);

  // Filter and group datasets
  const filteredDatasets = useMemo(() => {
    return datasets.filter(ds => {
      // Exclude archived datasets from main list
      if (ds.archived) return false;
      if (filterCountry !== "All" && ds.country !== filterCountry) return false;
      if (filterYear !== "All" && ds.year !== Number(filterYear)) return false;
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
                  
                  {/* Prominent Success/Failure Message */}
                  {uploadStatus && (
                    <div className={`p-3 rounded-md text-sm font-medium ${
                      uploadStatus.includes("Success") || uploadStatus.includes("✓")
                        ? "bg-green-100 text-green-800 border border-green-200" 
                        : uploadStatus.includes("failed") || uploadStatus.includes("Error") || uploadStatus.includes("✗")
                        ? "bg-red-100 text-red-800 border border-red-200"
                        : "bg-blue-100 text-blue-800 border border-blue-200"
                    }`}>
                      {uploadStatus}
                    </div>
                  )}
                </div>
              )}
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
                  <Select value={filterCountry} onValueChange={setFilterCountry}>
                    <SelectTrigger id="filterCountry">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {uniqueCountries.map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="filterYear">Filter by Year</Label>
                  <Select value={filterYear} onValueChange={setFilterYear}>
                    <SelectTrigger id="filterYear">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {uniqueYears.map(y => (
                        <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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

        {/* Factor Search */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Search Conversion Factors</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
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
                <Label htmlFor="datasetFilter">Dataset</Label>
                <Select
                  value={selectedDataset ? String(selectedDataset) : "all"}
                  onValueChange={(v) => setSelectedDataset(v === "all" ? null : Number(v))}
                >
                  <SelectTrigger id="datasetFilter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Datasets</SelectItem>
                    {datasets.map((ds) => (
                      <SelectItem key={ds.dataset_id} value={String(ds.dataset_id)}>
                        [{ds.dataset_id}] {ds.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button onClick={searchFactors} className="w-full">
              Search Factors
            </Button>

            {factors.length > 0 && (
              <div className="mt-4 max-h-96 overflow-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      <th className="p-2 text-left">ID</th>
                      <th className="p-2 text-left">Dataset</th>
                      <th className="p-2 text-left">Scope</th>
                      <th className="p-2 text-left">Description</th>
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
