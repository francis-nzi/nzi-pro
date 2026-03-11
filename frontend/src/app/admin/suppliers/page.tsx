"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
}

type Supplier = {
  supplier_id: number;
  supplier_name: string;
  address: string;
  contact_name: string;
  contact_email: string;
  website: string;
  phone: string;
  notes: string;
  is_active: boolean;
  item_count?: number;
};

type SupplierItem = {
  supplier_item_id: number;
  supplier_id: number;
  cost_type: string;
  item_name: string;
  description: string;
  uom: string;
  agreed_rate: number;
  is_vatable: boolean;
  vat_rate_pct: number;
  is_active: boolean;
};

type LookupItem = { name?: string; is_active?: boolean };

const COST_TYPES = ["Consultant", "Product", "Software", "Sales Commission", "Travel", "Other"];

export default function SuppliersPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null);
  const [supplierItems, setSupplierItems] = useState<SupplierItem[]>([]);
  const [uomOptions, setUomOptions] = useState<string[]>(["hours", "days", "units"]);

  const [supplierForm, setSupplierForm] = useState({
    supplier_name: "",
    address: "",
    contact_name: "",
    contact_email: "",
    website: "",
    phone: "",
    notes: "",
    is_active: true,
  });

  const [itemForm, setItemForm] = useState({
    cost_type: "Consultant",
    item_name: "",
    description: "",
    uom: "hours",
    agreed_rate: 0,
    is_vatable: false,
    vat_rate_pct: 20,
    is_active: true,
  });

  async function loadSuppliers() {
    setLoading(true);
    try {
      const [supRes, uomRes] = await Promise.all([
        fetch(`${baseUrl}/admin/suppliers?include_inactive=true`, { credentials: "include" }),
        fetch(`${baseUrl}/admin/lookups/uom_lookup`, { credentials: "include" }),
      ]);
      if (!supRes.ok) {
        const t = await supRes.text().catch(() => "");
        throw new Error(`Failed to load suppliers (${supRes.status})${t ? `: ${t}` : ""}`);
      }
      const supJson = (await supRes.json()) as { items?: Supplier[] };
      const supplierList = Array.isArray(supJson?.items) ? supJson.items : [];
      setSuppliers(supplierList);
      if (!selectedSupplierId && supplierList.length > 0) {
        setSelectedSupplierId(Number(supplierList[0].supplier_id));
      }
      if (uomRes.ok) {
        const uomJson = (await uomRes.json()) as { items?: LookupItem[] };
        const names = Array.isArray(uomJson?.items)
          ? uomJson.items.filter((x) => (x?.is_active ?? true) && String(x?.name || "").trim()).map((x) => String(x.name))
          : [];
        if (names.length > 0) setUomOptions(names);
      }
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadItems(supplierId: number) {
    try {
      const res = await fetch(`${baseUrl}/admin/suppliers/${supplierId}/items?include_inactive=true`, { credentials: "include" });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to load supplier items (${res.status})${t ? `: ${t}` : ""}`);
      }
      const json = (await res.json()) as { items?: SupplierItem[] };
      setSupplierItems(Array.isArray(json?.items) ? json.items : []);
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  useEffect(() => {
    void loadSuppliers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl]);

  useEffect(() => {
    if (selectedSupplierId) void loadItems(selectedSupplierId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSupplierId]);

  async function saveSupplier() {
    setStatus("");
    try {
      if (!supplierForm.supplier_name.trim()) {
        setStatus("Supplier name is required.");
        return;
      }
      const existing = suppliers.find((s) => s.supplier_name.trim().toLowerCase() === supplierForm.supplier_name.trim().toLowerCase());
      const method = existing ? "PUT" : "POST";
      const url = existing ? `${baseUrl}/admin/suppliers/${existing.supplier_id}` : `${baseUrl}/admin/suppliers`;
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(supplierForm),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to save supplier (${res.status})${t ? `: ${t}` : ""}`);
      }
      setStatus(existing ? "Supplier updated." : "Supplier created.");
      await loadSuppliers();
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  async function saveItem() {
    setStatus("");
    try {
      if (!selectedSupplierId) {
        setStatus("Select a supplier first.");
        return;
      }
      if (!itemForm.item_name.trim()) {
        setStatus("Item name is required.");
        return;
      }
      const res = await fetch(`${baseUrl}/admin/suppliers/${selectedSupplierId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(itemForm),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to add item (${res.status})${t ? `: ${t}` : ""}`);
      }
      setItemForm({
        cost_type: itemForm.cost_type,
        item_name: "",
        description: "",
        uom: itemForm.uom,
        agreed_rate: 0,
        is_vatable: false,
        vat_rate_pct: 20,
        is_active: true,
      });
      await loadItems(selectedSupplierId);
      await loadSuppliers();
      setStatus("Supplier item added.");
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  async function toggleSupplierItemActive(item: SupplierItem, active: boolean) {
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/admin/supplier-items/${item.supplier_item_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ is_active: active }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to update item (${res.status})${t ? `: ${t}` : ""}`);
      }
      if (selectedSupplierId) await loadItems(selectedSupplierId);
      setStatus(active ? "Item activated." : "Item archived.");
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: "#F26624" }}>Suppliers</h1>
            <p className="text-sm text-muted-foreground">Manage supplier master data and agreed service rates.</p>
          </div>
          <Button variant="secondary" asChild>
            <Link href="/admin">{"<-"} Back to Admin</Link>
          </Button>
        </div>

        {status ? <div className="mb-4 rounded-md bg-muted p-3 text-sm">{status}</div> : null}

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Supplier Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Supplier</Label>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={selectedSupplierId ? String(selectedSupplierId) : ""}
                  onChange={(e) => {
                    const id = Number(e.target.value || 0);
                    const supplier = suppliers.find((s) => s.supplier_id === id);
                    setSelectedSupplierId(id || null);
                    if (supplier) {
                      setSupplierForm({
                        supplier_name: supplier.supplier_name || "",
                        address: supplier.address || "",
                        contact_name: supplier.contact_name || "",
                        contact_email: supplier.contact_email || "",
                        website: supplier.website || "",
                        phone: supplier.phone || "",
                        notes: supplier.notes || "",
                        is_active: supplier.is_active !== false,
                      });
                    }
                  }}
                >
                  <option value="">Select supplier...</option>
                  {suppliers.map((s) => (
                    <option key={s.supplier_id} value={String(s.supplier_id)}>
                      {s.supplier_name} ({s.item_count || 0} items){s.is_active ? "" : " [inactive]"}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={supplierForm.supplier_name} onChange={(e) => setSupplierForm((p) => ({ ...p, supplier_name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Address</Label>
                <Textarea rows={3} value={supplierForm.address} onChange={(e) => setSupplierForm((p) => ({ ...p, address: e.target.value }))} />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Contact</Label>
                  <Input value={supplierForm.contact_name} onChange={(e) => setSupplierForm((p) => ({ ...p, contact_name: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={supplierForm.contact_email} onChange={(e) => setSupplierForm((p) => ({ ...p, contact_email: e.target.value }))} />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Website</Label>
                  <Input value={supplierForm.website} onChange={(e) => setSupplierForm((p) => ({ ...p, website: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input value={supplierForm.phone} onChange={(e) => setSupplierForm((p) => ({ ...p, phone: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea rows={2} value={supplierForm.notes} onChange={(e) => setSupplierForm((p) => ({ ...p, notes: e.target.value }))} />
              </div>
              <div className="flex justify-end">
                <Button onClick={saveSupplier} disabled={loading}>Save Supplier</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Supplier Service Items</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Cost Type</Label>
                  <Select value={itemForm.cost_type} onValueChange={(v) => setItemForm((p) => ({ ...p, cost_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {COST_TYPES.map((ct) => <SelectItem key={ct} value={ct}>{ct}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Item Name</Label>
                  <Input value={itemForm.item_name} onChange={(e) => setItemForm((p) => ({ ...p, item_name: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea rows={3} value={itemForm.description} onChange={(e) => setItemForm((p) => ({ ...p, description: e.target.value }))} />
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>UoM</Label>
                  <Select value={itemForm.uom} onValueChange={(v) => setItemForm((p) => ({ ...p, uom: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {uomOptions.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Agreed Rate</Label>
                  <Input type="number" step="0.01" value={String(itemForm.agreed_rate)} onChange={(e) => setItemForm((p) => ({ ...p, agreed_rate: Number(e.target.value || 0) }))} />
                </div>
                <div className="space-y-2">
                  <Label>VAT %</Label>
                  <Input type="number" step="0.01" value={String(itemForm.vat_rate_pct)} disabled={!itemForm.is_vatable} onChange={(e) => setItemForm((p) => ({ ...p, vat_rate_pct: Number(e.target.value || 0) }))} />
                </div>
              </div>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={itemForm.is_vatable} onChange={(e) => setItemForm((p) => ({ ...p, is_vatable: e.target.checked }))} />
                VATable
              </label>
              <div className="flex justify-end">
                <Button onClick={saveItem} disabled={!selectedSupplierId}>Add Service Item</Button>
              </div>

              <div className="rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr className="border-b">
                      <th className="p-2 text-left">Item</th>
                      <th className="p-2 text-left">Type</th>
                      <th className="p-2 text-left">UoM</th>
                      <th className="p-2 text-right">Rate</th>
                      <th className="p-2 text-right">VAT %</th>
                      <th className="p-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {supplierItems.map((item) => (
                      <tr key={item.supplier_item_id} className="border-b">
                        <td className="p-2">
                          <div className="font-medium">{item.item_name}</div>
                          {item.description ? <div className="text-xs text-muted-foreground">{item.description}</div> : null}
                        </td>
                        <td className="p-2">{item.cost_type || "-"}</td>
                        <td className="p-2">{item.uom || "-"}</td>
                        <td className="p-2 text-right">{Number(item.agreed_rate || 0).toFixed(2)}</td>
                        <td className="p-2 text-right">{item.is_vatable ? Number(item.vat_rate_pct || 0).toFixed(2) : "0.00"}</td>
                        <td className="p-2 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void toggleSupplierItemActive(item, !(item.is_active !== false))}
                          >
                            {item.is_active !== false ? "Archive" : "Restore"}
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {!loading && supplierItems.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-3 text-sm text-muted-foreground">No service items for this supplier yet.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

