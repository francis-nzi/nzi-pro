"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
}

type LookupItem = {
  [key: string]: any;
};

const LOOKUP_TABLES = [
  { key: "job_types", label: "Job Types", idCol: "job_type_id", nameCol: "name" },
  { key: "job_statuses_lookup", label: "Job Statuses", idCol: "status_id", nameCol: "name" },
  { key: "vat_rates_lookup", label: "VAT Rates", idCol: "vat_rate_id", nameCol: "name" },
  { key: "payment_terms_lookup", label: "Payment Terms", idCol: "term_id", nameCol: "name" },
  { key: "time_subjects", label: "Time Subjects", idCol: "subject_id", nameCol: "name" },
  { key: "portfolios_lookup", label: "Portfolios", idCol: "portfolio_id", nameCol: "name" },
  { key: "industries_lookup", label: "Industries", idCol: "industry_id", nameCol: "name" },
];

export default function LookupsPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const [activeTab, setActiveTab] = useState(LOOKUP_TABLES[0].key);
  const [items, setItems] = useState<LookupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [newItemName, setNewItemName] = useState("");

  useEffect(() => {
    setItems([]); // Clear items when switching tabs
    loadItems(activeTab);
  }, [activeTab, baseUrl]);

  async function loadItems(tableName: string) {
    setLoading(true);
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/admin/lookups/${tableName}?_t=${Date.now()}`); // Prevent caching
      if (res.ok) {
        const json = await res.json();
        setItems(json.items || []);
      } else {
        setStatus(`Error: ${res.status} ${res.statusText}`);
      }
    } catch (e) {
      setStatus(`Error loading items: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  async function addItem() {
    if (!newItemName.trim()) {
      setStatus("Name is required");
      return;
    }

    setStatus("Adding...");
    try {
      const res = await fetch(`${baseUrl}/admin/lookups/${activeTab}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newItemName.trim(), is_active: true }),
      });

      if (!res.ok) {
        throw new Error(`Failed: ${res.status}`);
      }

      setStatus("Item added!");
      setNewItemName("");
      loadItems(activeTab);
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    }
  }

  async function archiveItem(tableName: string, itemId: number, itemName: string) {
    if (!confirm(`Are you sure you want to archive "${itemName}"?`)) return;

    setStatus("Archiving...");
    try {
      const res = await fetch(`${baseUrl}/admin/lookups/${tableName}/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: false }),
      });

      if (!res.ok) {
        throw new Error(`Failed: ${res.status}`);
      }

      setStatus("Item archived!");
      loadItems(tableName);
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    }
  }

  const currentTable = LOOKUP_TABLES.find(t => t.key === activeTab);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Lookups Management</h1>
            <p className="text-sm text-muted-foreground">
              Manage reference data: job types, statuses, VAT rates, and more
            </p>
          </div>
          <Button variant="secondary" asChild>
            <Link href="/admin">← Back to Admin</Link>
          </Button>
        </div>

        {status && <div className="mb-4 rounded-md bg-muted p-3 text-sm">{status}</div>}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4 lg:grid-cols-7">
            {LOOKUP_TABLES.map((table) => (
              <TabsTrigger key={table.key} value={table.key}>
                {table.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {LOOKUP_TABLES.map((table) => (
            <TabsContent key={table.key} value={table.key}>
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Items List */}
                <Card>
                  <CardHeader>
                    <CardTitle>{table.label}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <div className="text-sm text-muted-foreground">Loading...</div>
                    ) : items.length === 0 ? (
                      <div className="text-sm text-muted-foreground">No items found</div>
                    ) : (
                      <div className="space-y-2">
                        {items.map((item, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between rounded-md border p-3"
                          >
                            <div className="flex-1">
                              <div className="font-medium">{item[table.nameCol]}</div>
                              {item.is_active !== undefined && (
                                <span
                                  className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs ${
                                    item.is_active
                                      ? "bg-green-100 text-green-800"
                                      : "bg-gray-100 text-gray-600"
                                  }`}
                                >
                                  {item.is_active ? "Active" : "Inactive"}
                                </span>
                              )}
                            </div>
                            {item.is_active && (
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => archiveItem(table.key, item[table.idCol], item[table.nameCol])}
                              >
                                Archive
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Add Form */}
                <Card>
                  <CardHeader>
                    <CardTitle>Add New {table.label.slice(0, -1)}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="newItemName">Name</Label>
                      <Input
                        id="newItemName"
                        value={newItemName}
                        onChange={(e) => setNewItemName(e.target.value)}
                        placeholder="Enter name..."
                        onKeyDown={(e) => {
                          if (e.key === "Enter") addItem();
                        }}
                      />
                    </div>
                    <Button onClick={addItem} className="w-full">
                      Add Item
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          ))}
        </Tabs>

        {/* Documentation */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Lookup Tables</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <span className="font-medium">Job Types:</span> Define service offerings (e.g., Carbon Footprint, Net Zero Strategy)
            </div>
            <div>
              <span className="font-medium">Job Statuses:</span> Track job lifecycle (Open, Data Gathering, Reporting, Completed)
            </div>
            <div>
              <span className="font-medium">VAT Rates:</span> Configure tax rates for invoicing
            </div>
            <div>
              <span className="font-medium">Payment Terms:</span> Standard payment terms for clients
            </div>
            <div>
              <span className="font-medium">Time Subjects:</span> Categories for time tracking
            </div>
            <div>
              <span className="font-medium">Portfolios:</span> Client groupings for reporting
            </div>
            <div>
              <span className="font-medium">Industries:</span> Client industry classifications
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
