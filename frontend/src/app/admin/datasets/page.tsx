"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
};

type Factor = {
  db_id: number;
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
  const [country, setCountry] = useState("UK");
  const [year, setYear] = useState(new Date().getFullYear());
  const [version, setVersion] = useState("v1");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  
  // Factor search
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDataset, setSelectedDataset] = useState<number | null>(null);

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
    setCountry("UK");
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

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Datasets & Factors</h1>
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
          {/* Create Dataset */}
          <Card>
            <CardHeader>
              <CardTitle>Create New Dataset</CardTitle>
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
                      <SelectItem value="Custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="country">Country</Label>
                  <Input
                    id="country"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                  />
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

              <Button onClick={createDataset} className="w-full">
                Create Dataset
              </Button>
            </CardContent>
          </Card>

          {/* Existing Datasets */}
          <Card>
            <CardHeader>
              <CardTitle>Existing Datasets</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-sm text-muted-foreground">Loading...</div>
              ) : datasets.length === 0 ? (
                <div className="text-sm text-muted-foreground">No datasets found</div>
              ) : (
                <div className="space-y-3">
                  {datasets.map((ds) => (
                    <div
                      key={ds.dataset_id}
                      className="rounded-md border p-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="font-medium">
                        [{ds.dataset_id}] {ds.name}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {ds.source} • {ds.analysis_type} • {ds.country} {ds.year}
                      </div>
                      {ds.valid_from && ds.valid_to && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          Valid: {ds.valid_from} to {ds.valid_to}
                        </div>
                      )}
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
              <span className="font-medium">CSV Upload:</span> Use the Streamlit admin to upload factor CSVs (migration in progress)
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
