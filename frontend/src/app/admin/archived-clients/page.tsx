"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
}

type ArchivedClient = {
  db_id: number;
  client_name: string;
  industry: string;
  status: string;
};

export default function ArchivedClientsPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  
  const [clients, setClients] = useState<ArchivedClient[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    loadClients();
  }, [baseUrl]);

  async function loadClients() {
    setLoading(true);
    setStatus("");
    try {
      const params = new URLSearchParams();
      params.set("q", searchQuery);

      const res = await fetch(`${baseUrl}/admin/archived-clients?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setClients(json.items || []);
      }
    } catch (e) {
      setStatus(`Error loading clients: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  async function reactivateClient(clientId: number, clientName: string) {
    if (!confirm(`Are you sure you want to reactivate "${clientName}"?`)) return;

    setStatus("Reactivating...");
    try {
      const res = await fetch(`${baseUrl}/admin/archived-clients/${clientId}/reactivate`, {
        method: "PATCH",
      });

      if (!res.ok) {
        throw new Error(`Failed: ${res.status}`);
      }

      setStatus(`Client "${clientName}" reactivated!`);
      loadClients();
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: '#F26624' }}>Archived Clients</h1>
            <p className="text-sm text-muted-foreground">
              View and reactivate archived clients
            </p>
          </div>
          <Button variant="secondary" asChild>
            <Link href="/admin">← Back to Admin</Link>
          </Button>
        </div>

        {status && <div className="mb-4 rounded-md bg-muted p-3 text-sm">{status}</div>}

        <Card>
          <CardHeader>
            <CardTitle>Search Archived Clients</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <div className="flex-1 space-y-2">
                <Label htmlFor="searchQuery">Search</Label>
                <Input
                  id="searchQuery"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by client name..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter") loadClients();
                  }}
                />
              </div>
              <div className="flex items-end">
                <Button onClick={loadClients}>Search</Button>
              </div>
            </div>

            {loading ? (
              <div className="text-sm text-muted-foreground">Loading...</div>
            ) : clients.length === 0 ? (
              <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
                No archived clients found
              </div>
            ) : (
              <div className="space-y-3">
                {clients.map((client) => (
                  <div
                    key={client.db_id}
                    className="flex items-center justify-between rounded-md border p-4 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex-1">
                      <div className="font-medium">{client.client_name}</div>
                      <div className="text-sm text-muted-foreground">
                        ID: {client.db_id} • Industry: {client.industry || "N/A"}
                      </div>
                      <span className="mt-2 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                        {client.status}
                      </span>
                    </div>
                    <Button
                      onClick={() => reactivateClient(client.db_id, client.client_name)}
                      variant="default"
                    >
                      Reactivate
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Documentation */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>About Archived Clients</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <span className="font-medium">Archiving:</span> Clients are archived when they are no longer active but their historical data must be retained
            </div>
            <div>
              <span className="font-medium">Reactivation:</span> Reactivating a client restores full access and allows new jobs to be created
            </div>
            <div>
              <span className="font-medium">Data Retention:</span> All historical jobs, reports, and data remain intact when a client is archived
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
