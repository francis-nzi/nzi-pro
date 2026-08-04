"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

function apiBaseUrl(): string {
  return "/api/backend";
}

type Supplier = {
  supplier_id: number;
  supplier_name: string;
  website: string | null;
  notes: string | null;
  is_active: boolean;
};

type SupplierLocation = {
  location_id: number;
  supplier_id: number;
  location_label: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  geocode_source: string | null;
  geocode_precision: string | null;
  is_active: boolean;
};

type SupplierComponent = {
  component_link_id: number;
  supplier_id: number;
  component_description: string;
  notes: string | null;
};

export default function LcaSuppliersPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null);
  const [locations, setLocations] = useState<SupplierLocation[]>([]);
  const [components, setComponents] = useState<SupplierComponent[]>([]);

  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierWebsite, setNewSupplierWebsite] = useState("");

  const [newLocationLabel, setNewLocationLabel] = useState("");
  const [newLocationAddress, setNewLocationAddress] = useState("");
  const [savingLocation, setSavingLocation] = useState(false);

  const [newComponentDescription, setNewComponentDescription] = useState("");
  const [savingComponent, setSavingComponent] = useState(false);

  async function loadSuppliers() {
    setLoading(true);
    setError("");
    try {
      const url = search.trim()
        ? `${baseUrl}/lca/suppliers?q=${encodeURIComponent(search.trim())}`
        : `${baseUrl}/lca/suppliers`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      setSuppliers(data.items ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSuppliers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSupplierDetail(supplierId: number) {
    setSelectedSupplierId(supplierId);
    try {
      const [locRes, compRes] = await Promise.all([
        fetch(`${baseUrl}/lca/suppliers/${supplierId}/locations`, { credentials: "include" }),
        fetch(`${baseUrl}/lca/suppliers/${supplierId}/components`, { credentials: "include" }),
      ]);
      setLocations(locRes.ok ? (await locRes.json()).items ?? [] : []);
      setComponents(compRes.ok ? (await compRes.json()).items ?? [] : []);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function addSupplier() {
    if (!newSupplierName.trim()) return;
    setError("");
    try {
      const res = await fetch(`${baseUrl}/lca/suppliers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ supplier_name: newSupplierName.trim(), website: newSupplierWebsite.trim() || null }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.detail || `Error ${res.status}`);
      }
      setNewSupplierName("");
      setNewSupplierWebsite("");
      setStatus("Supplier added.");
      await loadSuppliers();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function addLocation() {
    if (!selectedSupplierId || !newLocationLabel.trim() || !newLocationAddress.trim()) return;
    setSavingLocation(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/lca/suppliers/${selectedSupplierId}/locations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ location_label: newLocationLabel.trim(), address: newLocationAddress.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.detail || `Error ${res.status}`);
      }
      const data = await res.json();
      setStatus(data.geocoded ? "Location added and geocoded." : "Location added, but the address couldn't be geocoded -- edit it to retry.");
      setNewLocationLabel("");
      setNewLocationAddress("");
      await loadSupplierDetail(selectedSupplierId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingLocation(false);
    }
  }

  async function addComponent() {
    if (!selectedSupplierId || !newComponentDescription.trim()) return;
    setSavingComponent(true);
    setError("");
    try {
      const res = await fetch(`${baseUrl}/lca/suppliers/${selectedSupplierId}/components`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ component_description: newComponentDescription.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.detail || `Error ${res.status}`);
      }
      setNewComponentDescription("");
      await loadSupplierDetail(selectedSupplierId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingComponent(false);
    }
  }

  async function deleteComponent(componentLinkId: number) {
    if (!selectedSupplierId) return;
    try {
      const res = await fetch(`${baseUrl}/lca/suppliers/${selectedSupplierId}/components/${componentLinkId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      await loadSupplierDetail(selectedSupplierId);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function deactivateLocation(locationId: number) {
    if (!selectedSupplierId) return;
    if (!window.confirm("Remove this location? It stays linked to any transport legs that already used it.")) return;
    try {
      const res = await fetch(`${baseUrl}/lca/suppliers/${selectedSupplierId}/locations/${locationId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      await loadSupplierDetail(selectedSupplierId);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const selectedSupplier = suppliers.find((s) => s.supplier_id === selectedSupplierId) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">LCA Supplier Library</h1>
        <p className="text-sm text-muted-foreground">
          Global, geocoded suppliers, their locations, and the components they supply -- reused across every
          client&apos;s LCA transport legs instead of retyping an address every time. Any staff member can add or
          edit entries here.
        </p>
      </div>

      {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">{error}</div>}
      {status && <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">{status}</div>}

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Suppliers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void loadSuppliers(); }}
                placeholder="Search suppliers or components..."
                className="h-8 text-xs"
              />
              <Button size="sm" onClick={() => void loadSuppliers()} disabled={loading}>Search</Button>
            </div>

            <div className="max-h-96 space-y-1 overflow-y-auto">
              {suppliers.map((s) => (
                <button
                  key={s.supplier_id}
                  onClick={() => void loadSupplierDetail(s.supplier_id)}
                  className={`block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${selectedSupplierId === s.supplier_id ? "bg-muted font-medium" : ""}`}
                >
                  {s.supplier_name}
                </button>
              ))}
              {suppliers.length === 0 && !loading && (
                <div className="p-2 text-xs text-muted-foreground">No suppliers yet.</div>
              )}
            </div>

            <div className="space-y-2 border-t pt-3">
              <div className="text-xs font-medium text-foreground">Add supplier</div>
              <Input value={newSupplierName} onChange={(e) => setNewSupplierName(e.target.value)} placeholder="Supplier name" className="h-8 text-xs" />
              <Input value={newSupplierWebsite} onChange={(e) => setNewSupplierWebsite(e.target.value)} placeholder="Website (optional)" className="h-8 text-xs" />
              <Button size="sm" className="w-full" onClick={() => void addSupplier()} disabled={!newSupplierName.trim()}>
                + Add Supplier
              </Button>
            </div>
          </CardContent>
        </Card>

        {selectedSupplier ? (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{selectedSupplier.supplier_name} -- Locations</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {locations.map((loc) => (
                  <div key={loc.location_id} className="flex items-start justify-between gap-2 rounded-md border p-2 text-sm">
                    <div>
                      <div className="font-medium">{loc.location_label}</div>
                      <div className="text-xs text-muted-foreground">{loc.address}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {loc.latitude !== null && loc.longitude !== null ? (
                          <Badge variant="outline">{loc.geocode_precision ?? "geocoded"} ({loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)})</Badge>
                        ) : (
                          <Badge variant="destructive">not geocoded</Badge>
                        )}
                      </div>
                    </div>
                    <button className="text-xs text-rose-700 hover:underline" onClick={() => void deactivateLocation(loc.location_id)}>Remove</button>
                  </div>
                ))}
                {locations.length === 0 && <div className="text-xs text-muted-foreground">No locations yet.</div>}

                <div className="space-y-2 border-t pt-3">
                  <div className="text-xs font-medium text-foreground">Add a location</div>
                  <Input value={newLocationLabel} onChange={(e) => setNewLocationLabel(e.target.value)} placeholder="Label, e.g. Shenzhen Factory" className="h-8 text-xs" />
                  <Textarea value={newLocationAddress} onChange={(e) => setNewLocationAddress(e.target.value)} placeholder="Address, e.g. Shenzhen, Guangdong, China" rows={2} className="text-xs" />
                  <Button
                    size="sm"
                    onClick={() => void addLocation()}
                    disabled={savingLocation || !newLocationLabel.trim() || !newLocationAddress.trim()}
                  >
                    {savingLocation ? "Geocoding & saving..." : "+ Add Location"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{selectedSupplier.supplier_name} -- Components Supplied</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {components.map((c) => (
                  <div key={c.component_link_id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                    <span>{c.component_description}</span>
                    <button className="text-xs text-rose-700 hover:underline" onClick={() => void deleteComponent(c.component_link_id)}>Remove</button>
                  </div>
                ))}
                {components.length === 0 && <div className="text-xs text-muted-foreground">No components listed yet.</div>}

                <div className="flex gap-2 border-t pt-3">
                  <Input
                    value={newComponentDescription}
                    onChange={(e) => setNewComponentDescription(e.target.value)}
                    placeholder="e.g. EVOH SOARNOL DC3203RB (ethylene vinyl alcohol)"
                    className="h-8 text-xs"
                  />
                  <Button size="sm" onClick={() => void addComponent()} disabled={savingComponent || !newComponentDescription.trim()}>
                    + Add
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Select a supplier to manage its locations and components, or add a new one.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
