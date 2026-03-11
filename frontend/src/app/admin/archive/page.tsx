"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
  archived: boolean;
  archived_at: string | null;
  archived_by: string | null;
};

type ArchivedClient = {
  db_id: number;
  client_name: string;
  industry: string;
  status: string;
};

export default function ArchivePage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [clients, setClients] = useState<ArchivedClient[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    void loadArchivedData();
  }, [baseUrl]);

  async function loadArchivedData() {
    setLoading(true);
    try {
      const [datasetsRes, clientsRes] = await Promise.all([
        fetch(`${baseUrl}/admin/datasets?include_archived=true`),
        fetch(`${baseUrl}/admin/archived-clients`),
      ]);

      if (datasetsRes.ok) {
        const json = await datasetsRes.json();
        const archived = (json.items || []).filter((ds: Dataset) => ds.archived);
        setDatasets(archived);
      }
      if (clientsRes.ok) {
        const json = await clientsRes.json();
        setClients(Array.isArray(json.items) ? json.items : []);
      }
    } catch (e) {
      setStatus(`Error loading archived items: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  async function unarchiveDataset(datasetId: number, datasetName: string) {
    if (!confirm(`Restore dataset "${datasetName}"? It will be moved back to the active datasets.`)) {
      return;
    }

    setStatus(`Restoring ${datasetName}...`);
    try {
      const res = await fetch(`${baseUrl}/admin/datasets/${datasetId}/archive`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: false }),
      });

      if (!res.ok) {
        throw new Error(`Failed: ${res.status}`);
      }

      setStatus(`${datasetName} restored successfully!`);
      void loadArchivedData();
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error restoring: ${(e as Error).message}`);
    }
  }

  async function permanentlyDeleteDataset(datasetId: number, datasetName: string) {
    if (!confirm(`⚠️ PERMANENTLY DELETE dataset "${datasetName}"?\n\nThis action CANNOT be undone. All associated conversion factors will also be deleted.\n\nType "DELETE" to confirm.`)) {
      return;
    }

    const confirmation = prompt(`Type "DELETE" to permanently delete "${datasetName}"`);
    if (confirmation !== "DELETE") {
      setStatus("Deletion cancelled");
      setTimeout(() => setStatus(""), 2000);
      return;
    }

    setStatus(`Permanently deleting ${datasetName}...`);
    try {
      const res = await fetch(`${baseUrl}/admin/datasets/${datasetId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error(`Failed: ${res.status}`);
      }

      setStatus(`${datasetName} permanently deleted`);
      void loadArchivedData();
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error deleting: ${(e as Error).message}`);
    }
  }

  async function reactivateClient(clientId: number, clientName: string) {
    if (!confirm(`Restore client "${clientName}"?`)) {
      return;
    }
    setStatus(`Restoring ${clientName}...`);
    try {
      const res = await fetch(`${baseUrl}/admin/archived-clients/${clientId}/reactivate`, {
        method: "PATCH",
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed: ${res.status}${t ? ` - ${t}` : ""}`);
      }
      setStatus(`${clientName} restored successfully!`);
      void loadArchivedData();
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error restoring client: ${(e as Error).message}`);
    }
  }

  async function permanentlyDeleteClient(clientId: number, clientName: string) {
    if (!confirm(`PERMANENTLY DELETE client "${clientName}"?\n\nThis action cannot be undone.`)) {
      return;
    }
    const confirmation = prompt(`Type "DELETE" to permanently delete "${clientName}"`);
    if (confirmation !== "DELETE") {
      setStatus("Deletion cancelled");
      setTimeout(() => setStatus(""), 2000);
      return;
    }
    setStatus(`Permanently deleting ${clientName}...`);
    try {
      const res = await fetch(`${baseUrl}/admin/archived-clients/${clientId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed: ${res.status}${t ? ` - ${t}` : ""}`);
      }
      setStatus(`${clientName} permanently deleted`);
      void loadArchivedData();
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error deleting client: ${(e as Error).message}`);
    }
  }

  // Group by country and year
  const groupedDatasets = useMemo(() => {
    const groups: Record<string, Record<string, Dataset[]>> = {};
    
    datasets.forEach(ds => {
      const countryKey = ds.country || "Unknown";
      const yearKey = String(ds.year || "Unknown");
      
      if (!groups[countryKey]) groups[countryKey] = {};
      if (!groups[countryKey][yearKey]) groups[countryKey][yearKey] = [];
      
      groups[countryKey][yearKey].push(ds);
    });
    
    return groups;
  }, [datasets]);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: '#F26624' }}>Archive Management</h1>
            <p className="text-sm text-muted-foreground">
              Admin-only: Restore or permanently delete archived items
            </p>
          </div>
          <Button variant="secondary" asChild>
            <Link href="/admin">← Back to Admin</Link>
          </Button>
        </div>

        {status && (
          <div className="mb-4 rounded-md bg-muted p-3 text-sm">{status}</div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Archived Datasets ({datasets.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading...</div>
            ) : datasets.length === 0 ? (
              <div className="text-sm text-muted-foreground">No archived datasets</div>
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
                              className="rounded-md border border-destructive/20 bg-destructive/5 p-3"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1">
                                  <div className="font-medium text-sm">
                                    [{ds.dataset_id}] {ds.name}
                                  </div>
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {ds.source} • {ds.analysis_type}
                                  </div>
                                  {ds.archived_at && (
                                    <div className="mt-1 text-xs text-muted-foreground">
                                      Archived: {new Date(ds.archived_at).toLocaleString('en-GB')}
                                      {ds.archived_by && ` by ${ds.archived_by}`}
                                    </div>
                                  )}
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => unarchiveDataset(ds.dataset_id, ds.name)}
                                  >
                                    Restore
                                  </Button>
                                  <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={() => permanentlyDeleteDataset(ds.dataset_id, ds.name)}
                                  >
                                    Delete Forever
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

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Archived Clients ({clients.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading...</div>
            ) : clients.length === 0 ? (
              <div className="text-sm text-muted-foreground">No archived clients</div>
            ) : (
              <div className="space-y-2">
                {clients.map((c) => (
                  <div
                    key={c.db_id}
                    className="rounded-md border border-destructive/20 bg-destructive/5 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="font-medium text-sm">[{c.db_id}] {c.client_name}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {c.industry || "No industry"} • {c.status}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => reactivateClient(c.db_id, c.client_name)}
                        >
                          Restore
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => permanentlyDeleteClient(c.db_id, c.client_name)}
                        >
                          Delete Forever
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="mt-6 rounded-md border border-destructive/50 bg-destructive/10 p-4">
          <h3 className="font-semibold text-destructive">⚠️ Warning: Admin Only</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            This page is for administrators only. Permanent deletion cannot be undone.
            Only delete items that you are certain will never be needed again.
          </p>
        </div>
      </div>
    </div>
  );
}
