"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function apiBaseUrl(): string {
  return "/api/backend";
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

type ArchivedIndustry = {
  industry_id: number;
  name: string;
  is_active?: boolean | null;
};

type ArchiveRetentionSummary = {
  retention_days: number;
  cutoff_at: string | null;
  datasets: {
    archived_total: number;
    purgeable_total: number;
  };
  clients: {
    archived_total: number;
    purgeable_total: number;
  };
};

export default function ArchivePage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const confirmAction = useConfirmDialog();

  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [clients, setClients] = useState<ArchivedClient[]>([]);
  const [industries, setIndustries] = useState<ArchivedIndustry[]>([]);
  const [retentionSummary, setRetentionSummary] = useState<ArchiveRetentionSummary | null>(null);
  const [retentionDays, setRetentionDays] = useState("365");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [retentionStatus, setRetentionStatus] = useState("");
  const [retentionError, setRetentionError] = useState("");
  const [purging, setPurging] = useState(false);

  useEffect(() => {
    void loadArchivedData();
  }, [baseUrl]);

  async function loadArchivedData() {
    setLoading(true);
    try {
      const [datasetsRes, clientsRes, industriesRes, retentionRes] = await Promise.all([
        fetch(`${baseUrl}/admin/datasets?include_archived=true`),
        fetch(`${baseUrl}/admin/archived-clients`),
        fetch(`${baseUrl}/admin/lookups/industries_lookup?include_archived=true`),
        fetch(`${baseUrl}/admin/archive/retention-summary`),
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
      if (industriesRes.ok) {
        const json = await industriesRes.json();
        setIndustries(
          Array.isArray(json.items)
            ? json.items.filter((item: ArchivedIndustry) => !item.is_active)
            : []
        );
      }
      if (retentionRes.ok) {
        const json = (await retentionRes.json()) as ArchiveRetentionSummary;
        setRetentionSummary(json);
        setRetentionDays(String(json.retention_days || 365));
      }
    } catch (e) {
      setStatus(`Error loading archived items: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  async function saveRetentionPolicy() {
    const parsedDays = Number.parseInt(retentionDays, 10);
    if (!Number.isFinite(parsedDays) || parsedDays < 1) {
      setRetentionError("Retention days must be a positive number.");
      return;
    }

    setRetentionError("");
    setRetentionStatus("Saving retention policy...");
    try {
      const res = await fetch(`${baseUrl}/system-settings/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ settings: { archive_retention_days: String(parsedDays) } }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(String((payload as { detail?: string }).detail || "Failed to save retention policy"));
      }
      setRetentionStatus(`Retention policy saved: ${parsedDays} days.`);
      await loadArchivedData();
      setTimeout(() => setRetentionStatus(""), 3000);
    } catch (e) {
      setRetentionError((e as Error).message);
      setRetentionStatus("");
    }
  }

  async function purgeArchivedData() {
    const parsedDays = Number.parseInt(retentionDays, 10);
    if (!Number.isFinite(parsedDays) || parsedDays < 1) {
      setRetentionError("Retention days must be a positive number.");
      return;
    }

    const confirmed = await confirmAction({
      title: "Purge archived data?",
      description: `This will permanently delete archived datasets and archived clients older than ${parsedDays} days. Archived clients with dependent jobs, quotes, or invoices will be skipped.`,
      confirmLabel: "Purge archived data",
      destructive: true,
      confirmationText: "PURGE",
    });
    if (!confirmed) return;

    setPurging(true);
    setRetentionError("");
    setRetentionStatus("Purging archived data...");
    try {
      const res = await fetch(`${baseUrl}/admin/archive/purge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ retention_days: parsedDays }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(String((payload as { detail?: string }).detail || "Failed to purge archived data"));
      }
      const counts = (payload as { counts?: { datasets_deleted?: number; clients_deleted?: number; clients_skipped?: number } }).counts || {};
      setRetentionStatus(
        `Purged ${Number(counts.datasets_deleted || 0)} datasets and ${Number(counts.clients_deleted || 0)} clients.`
        + (Number(counts.clients_skipped || 0) ? ` Skipped ${Number(counts.clients_skipped || 0)} clients with dependencies.` : "")
      );
      await loadArchivedData();
      setTimeout(() => setRetentionStatus(""), 4000);
    } catch (e) {
      setRetentionError((e as Error).message);
      setRetentionStatus("");
    } finally {
      setPurging(false);
    }
  }

  async function unarchiveDataset(datasetId: number, datasetName: string) {
    const confirmed = await confirmAction({
      title: "Restore dataset?",
      description: `Restore dataset "${datasetName}"? It will be moved back to the active datasets.`,
      confirmLabel: "Restore",
    });
    if (!confirmed) return;

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
    const confirmed = await confirmAction({
      title: "Permanently delete dataset?",
      description: `This will permanently delete dataset "${datasetName}" and all associated conversion factors. This action cannot be undone.`,
      confirmLabel: "Delete permanently",
      destructive: true,
      confirmationText: "DELETE",
    });
    if (!confirmed) {
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
    const confirmed = await confirmAction({
      title: "Restore client?",
      description: `Restore client "${clientName}"?`,
      confirmLabel: "Restore",
    });
    if (!confirmed) return;

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
    const confirmed = await confirmAction({
      title: "Permanently delete client?",
      description: `This will permanently delete client "${clientName}". This action cannot be undone.`,
      confirmLabel: "Delete permanently",
      destructive: true,
      confirmationText: "DELETE",
    });
    if (!confirmed) {
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

  async function restoreIndustry(industryId: number, industryName: string) {
    const confirmed = await confirmAction({
      title: "Restore industry?",
      description: `Restore industry "${industryName}"? It will return to the active Industry lookup list.`,
      confirmLabel: "Restore",
    });
    if (!confirmed) return;

    setStatus(`Restoring ${industryName}...`);
    try {
      const res = await fetch(`${baseUrl}/admin/lookups/industries_lookup/${industryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: true }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed: ${res.status}${t ? ` - ${t}` : ""}`);
      }
      setStatus(`${industryName} restored successfully!`);
      void loadArchivedData();
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error restoring industry: ${(e as Error).message}`);
    }
  }

  async function permanentlyDeleteIndustry(industryId: number, industryName: string) {
    const confirmed = await confirmAction({
      title: "Permanently delete industry?",
      description: `This will permanently delete industry "${industryName}". This action cannot be undone.`,
      confirmLabel: "Delete permanently",
      destructive: true,
      confirmationText: "DELETE",
    });
    if (!confirmed) {
      setStatus("Deletion cancelled");
      setTimeout(() => setStatus(""), 2000);
      return;
    }

    setStatus(`Permanently deleting ${industryName}...`);
    try {
      const res = await fetch(`${baseUrl}/admin/lookups/industries_lookup/${industryId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed: ${res.status}${t ? ` - ${t}` : ""}`);
      }
      setStatus(`${industryName} permanently deleted`);
      void loadArchivedData();
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error deleting industry: ${(e as Error).message}`);
    }
  }

  const groupedDatasets = useMemo(() => {
    const groups: Record<string, Record<string, Dataset[]>> = {};

    datasets.forEach((ds) => {
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
            <h1 className="text-2xl font-semibold" style={{ color: "#F26624" }}>Archive Management</h1>
            <p className="text-sm text-muted-foreground">
              Admin-only: Restore or permanently delete archived items
            </p>
          </div>
          <Button variant="secondary" asChild>
            <Link href="/admin">Back to Admin</Link>
          </Button>
        </div>

        {status && (
          <div className="mb-4 rounded-md bg-muted p-3 text-sm">{status}</div>
        )}

        <Card className="mb-6 border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle>Retention & Purge Controls</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="archive-retention-days">Archive retention days</Label>
                <Input
                  id="archive-retention-days"
                  type="number"
                  min={1}
                  max={3650}
                  value={retentionDays}
                  onChange={(event) => setRetentionDays(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Archived clients and datasets older than this window become eligible for purge.
                </p>
              </div>
              <div className="rounded-lg border bg-background p-4">
                <div><span className="font-medium">Configured retention:</span> {retentionSummary?.retention_days || retentionDays} days</div>
                <div><span className="font-medium">Cutoff:</span> {retentionSummary?.cutoff_at || "-"}</div>
                <div><span className="font-medium">Purgeable datasets:</span> {retentionSummary?.datasets.purgeable_total ?? 0}</div>
                <div><span className="font-medium">Purgeable clients:</span> {retentionSummary?.clients.purgeable_total ?? 0}</div>
              </div>
            </div>
            {retentionError ? <p className="text-destructive">{retentionError}</p> : null}
            {retentionStatus ? <p className="text-muted-foreground">{retentionStatus}</p> : null}
            <div className="flex flex-wrap gap-3">
              <Button type="button" onClick={saveRetentionPolicy} disabled={loading}>
                Save Retention
              </Button>
              <Button type="button" variant="destructive" onClick={purgeArchivedData} disabled={loading || purging}>
                {purging ? "Purging..." : "Purge Archived Data"}
              </Button>
            </div>
          </CardContent>
        </Card>

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
                      <div className="text-sm font-semibold text-primary">Folder {country}</div>
                      <div className="h-px flex-1 bg-border"></div>
                    </div>
                    {Object.entries(yearGroups).sort(([a], [b]) => Number(b) - Number(a)).map(([year, datasetItems]) => (
                      <div key={year} className="ml-4 space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="text-xs font-medium text-muted-foreground">Year {year}</div>
                          <div className="h-px flex-1 bg-border/50"></div>
                        </div>
                        <div className="ml-4 space-y-2">
                          {datasetItems.map((ds) => (
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
                                      Archived: {new Date(ds.archived_at).toLocaleString("en-GB")}
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

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Archived Industries ({industries.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading...</div>
            ) : industries.length === 0 ? (
              <div className="text-sm text-muted-foreground">No archived industries</div>
            ) : (
              <div className="space-y-2">
                {industries
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((industry) => (
                    <div
                      key={industry.industry_id}
                      className="rounded-md border border-destructive/20 bg-destructive/5 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="font-medium text-sm">[{industry.industry_id}] {industry.name}</div>
                          <div className="mt-1 text-xs text-muted-foreground">Archived industry lookup item</div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => restoreIndustry(industry.industry_id, industry.name)}
                          >
                            Restore
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => permanentlyDeleteIndustry(industry.industry_id, industry.name)}
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
          <h3 className="font-semibold text-destructive">Warning: Admin Only</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            This page is for administrators only. Permanent deletion cannot be undone.
            Only delete items that you are certain will never be needed again.
          </p>
        </div>
      </div>
    </div>
  );
}
