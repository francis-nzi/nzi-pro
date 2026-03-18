"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Save, Plus, Trash2, Edit2 } from "lucide-react";
import Link from "next/link";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";

function apiBaseUrl() {
  if (typeof window === "undefined") return "http://localhost:8000";
  return process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
}

interface JobItem {
  item_id: number;
  item_code: string;
  item_name: string;
  description: string;
  notes: string;
  category: string;
  unit: string;
  estimated_hours: number;
  vat_rate_id: number | null;
  cost_amount: number;
  cost_currency: string;
  sell_amount: number;
  sell_currency: string;
  vat_rate: number;
  is_active: boolean;
  sort_order: number;
}

interface VatRate {
  vat_rate_id: number;
  name: string;
  rate_pct: number;
}

const DEFAULT_CATEGORIES = [
  "Assessment",
  "Reporting",
  "Advisory",
  "Training",
  "Ongoing",
  "Other",
];

const UNITS = [
  "day",
  "hour",
  "month",
  "year",
  "project",
  "report",
  "each",
];

export default function JobItemsPage() {
  const confirmAction = useConfirmDialog();
  const [items, setItems] = useState<JobItem[]>([]);
  const [vatRates, setVatRates] = useState<VatRate[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<string[]>(DEFAULT_CATEGORIES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("__all__");
  const [searchQuery, setSearchQuery] = useState("");

  // Form state
  const [itemCode, setItemCode] = useState("");
  const [itemName, setItemName] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState("day");
  const [estimatedHours, setEstimatedHours] = useState("");
  const [vatRateId, setVatRateId] = useState<string>("");
  const [costAmount, setCostAmount] = useState("");
  const [costCurrency, setCostCurrency] = useState("GBP");
  const [sellAmount, setSellAmount] = useState("");
  const [sellCurrency, setSellCurrency] = useState("GBP");
  const [vatRate, setVatRate] = useState("20");
  const [sortOrder, setSortOrder] = useState("0");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError("");

    try {
      const baseUrl = apiBaseUrl();
      
      // Load job items and VAT rates in parallel
      const [itemsRes, vatRes, categoriesRes] = await Promise.all([
        fetch(`${baseUrl}/admin/job-items?include_inactive=true`, { credentials: "include" }),
        fetch(`${baseUrl}/admin/lookups/vat_rates_lookup`, { credentials: "include" }),
        fetch(`${baseUrl}/admin/lookups/job_item_categories_lookup`, { credentials: "include" }),
      ]);

      if (!itemsRes.ok) {
        const detailText = await itemsRes.text().catch(() => "");
        throw new Error(
          `Failed to load job items (${itemsRes.status} ${itemsRes.statusText})${detailText ? `: ${detailText}` : ""}`
        );
      }

      const itemsData = await itemsRes.json();
      setItems(itemsData.items || []);
      
      if (vatRes.ok) {
        const vatData = await vatRes.json();
        setVatRates(vatData.items || []);
      }

      if (categoriesRes.ok) {
        const categoriesData = await categoriesRes.json();
        type CategoryLookupItem = { name?: string; is_active?: boolean | null };
        const lookupItems: CategoryLookupItem[] = Array.isArray(categoriesData.items) ? categoriesData.items : [];
        const names = Array.isArray(categoriesData.items)
          ? lookupItems
              .filter((item) => item && item.is_active !== false && String(item.name || "").trim())
              .map((item) => String(item.name).trim())
          : [];
        setCategoryOptions(names.length > 0 ? names : DEFAULT_CATEGORIES);
      } else {
        setCategoryOptions(DEFAULT_CATEGORIES);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
      setCategoryOptions(DEFAULT_CATEGORIES);
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setItemCode("");
    setItemName("");
    setDescription("");
    setNotes("");
    setCategory("");
    setUnit("day");
    setEstimatedHours("");
    setVatRateId("");
    setCostAmount("");
    setCostCurrency("GBP");
    setSellAmount("");
    setSellCurrency("GBP");
    setVatRate("20");
    setSortOrder("0");
    setEditingId(null);
  }

  function handleEdit(item: JobItem) {
    setItemCode(item.item_code);
    setItemName(item.item_name);
    setDescription(item.description || "");
    setNotes(item.notes || "");
    setCategory(item.category || "");
    setUnit(item.unit || "day");
    setEstimatedHours(String(item.estimated_hours || 0));
    setVatRateId(item.vat_rate_id ? String(item.vat_rate_id) : "");
    setCostAmount(String(item.cost_amount || 0));
    setCostCurrency(item.cost_currency || "GBP");
    setSellAmount(String(item.sell_amount || 0));
    setSellCurrency(item.sell_currency || "GBP");
    setVatRate(String(item.vat_rate || 20));
    setSortOrder(String(item.sort_order || 0));
    setEditingId(item.item_id);
    setShowForm(true);
  }

  function handleCancel() {
    resetForm();
    setShowForm(false);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();

    if (!itemCode.trim() || !itemName.trim()) {
      setStatus("Item code and name are required");
      return;
    }

    const payload = {
      item_code: itemCode.trim().toUpperCase(),
      item_name: itemName.trim(),
      description: description.trim(),
      notes: notes.trim(),
      category: category,
      unit: unit,
      estimated_hours: parseFloat(estimatedHours) || 0,
      vat_rate_id: vatRateId ? parseInt(vatRateId) : null,
      cost_amount: parseFloat(costAmount) || 0,
      cost_currency: costCurrency,
      sell_amount: parseFloat(sellAmount) || 0,
      sell_currency: sellCurrency,
      vat_rate: parseFloat(vatRate) || 20,
      sort_order: parseInt(sortOrder) || 0,
      is_active: true,
    };

    try {
      const baseUrl = apiBaseUrl();
      const url = editingId
        ? `${baseUrl}/admin/job-items/${editingId}`
        : `${baseUrl}/admin/job-items`;
      const method = editingId ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Failed to save job item");
      }

      setStatus(editingId ? "Job item updated!" : "Job item created!");
      resetForm();
      setShowForm(false);
      loadData();
      setTimeout(() => setStatus(""), 3000);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to save job item");
    }
  }

  async function handleDelete(itemId: number) {
    const confirmed = await confirmAction({
      title: "Delete job item?",
      description: "This job item will be removed from the catalogue.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) {
      return;
    }

    try {
      const baseUrl = apiBaseUrl();
      const response = await fetch(`${baseUrl}/admin/job-items/${itemId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Failed to delete job item");
      }

      setStatus("Job item deleted!");
      loadData();
      setTimeout(() => setStatus(""), 3000);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to delete job item");
    }
  }

  async function handleToggleActive(item: JobItem) {
    try {
      const baseUrl = apiBaseUrl();
      const response = await fetch(`${baseUrl}/admin/job-items/${item.item_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ is_active: !item.is_active }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Failed to update job item");
      }

      setStatus(item.is_active ? "Job item deactivated!" : "Job item activated!");
      loadData();
      setTimeout(() => setStatus(""), 3000);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to update job item");
    }
  }

  const categoryList = Array.from(
    new Set(
      categoryOptions
        .map((cat) => String(cat || "").trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));

  const filteredItems = items.filter((item) => {
    const itemCategory = item.category || "Uncategorized";
    const matchesCategory = categoryFilter === "__all__" || itemCategory === categoryFilter;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return matchesCategory;
    const haystack = [
      item.item_code,
      item.item_name,
      item.description,
      item.notes,
      item.category,
      item.unit,
    ]
      .map((v) => String(v || "").toLowerCase())
      .join(" ");
    return matchesCategory && haystack.includes(q);
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto w-full max-w-7xl px-6 py-10">
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: '#F26624' }}>
              Job Items
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage service items for building jobs, quotes and invoices
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/admin">Back to Admin</Link>
            </Button>
            <Button
              onClick={() => {
                resetForm();
                setShowForm(true);
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Job Item
            </Button>
          </div>
        </div>

        {error && (
          <div className="mb-4 text-sm text-destructive">{error}</div>
        )}

        {status && (
          <div className="mb-4 text-sm text-green-600">{status}</div>
        )}

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Find Items</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="categoryFilter">Category</Label>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger id="categoryFilter">
                    <SelectValue placeholder="Filter by category..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All categories</SelectItem>
                    {categoryList.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="searchItems">Search</Label>
                <Input
                  id="searchItems"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search code, name, notes, description..."
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Dialog open={showForm} onOpenChange={(open) => (!open ? handleCancel() : setShowForm(true))}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit Job Item" : "Add New Job Item"}</DialogTitle>
              <DialogDescription>
                {editingId
                  ? "Update the fields below and save changes."
                  : "Create a new job item for use in jobs, quotes, and invoices."}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSave} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="itemCode">Item Code *</Label>
                    <Input
                      id="itemCode"
                      value={itemCode}
                      onChange={(e) => setItemCode(e.target.value)}
                      placeholder="e.g., ASSESS"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="itemName">Item Name *</Label>
                    <Input
                      id="itemName"
                      value={itemName}
                      onChange={(e) => setItemName(e.target.value)}
                      placeholder="e.g., Carbon Assessment"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Description of the service item..."
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Internal notes for consultants, assumptions, caveats, or delivery guidance..."
                    rows={4}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="category">Category</Label>
                    <Select value={category} onValueChange={setCategory}>
                      <SelectTrigger id="category">
                        <SelectValue placeholder="Select category..." />
                      </SelectTrigger>
                      <SelectContent>
                        {categoryOptions.map((cat) => (
                          <SelectItem key={cat} value={cat}>
                            {cat}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="unit">Unit</Label>
                    <Select value={unit} onValueChange={setUnit}>
                      <SelectTrigger id="unit">
                        <SelectValue placeholder="Select unit..." />
                      </SelectTrigger>
                      <SelectContent>
                        {UNITS.map((u) => (
                          <SelectItem key={u} value={u}>
                            {u}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="estimatedHours">Estimated Hours</Label>
                    <Input
                      id="estimatedHours"
                      type="number"
                      step="0.5"
                      value={estimatedHours}
                      onChange={(e) => setEstimatedHours(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="vatRateId">VAT Rate (from lookup)</Label>
                    <Select value={vatRateId} onValueChange={setVatRateId}>
                      <SelectTrigger id="vatRateId">
                        <SelectValue placeholder="Select VAT rate..." />
                      </SelectTrigger>
                      <SelectContent>
                        {vatRates.map((vr) => (
                          <SelectItem key={vr.vat_rate_id} value={String(vr.vat_rate_id)}>
                            {vr.name} ({vr.rate_pct}%)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="vatRate">VAT Rate (%)</Label>
                    <Input
                      id="vatRate"
                      type="number"
                      step="0.01"
                      value={vatRate}
                      onChange={(e) => setVatRate(e.target.value)}
                      placeholder="20"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="costAmount">Cost Amount</Label>
                    <Input
                      id="costAmount"
                      type="number"
                      step="0.01"
                      value={costAmount}
                      onChange={(e) => setCostAmount(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="costCurrency">Cost Currency</Label>
                    <Input
                      id="costCurrency"
                      value={costCurrency}
                      onChange={(e) => setCostCurrency(e.target.value)}
                      placeholder="GBP"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="sellAmount">Sell Amount</Label>
                    <Input
                      id="sellAmount"
                      type="number"
                      step="0.01"
                      value={sellAmount}
                      onChange={(e) => setSellAmount(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sellCurrency">Sell Currency</Label>
                    <Input
                      id="sellCurrency"
                      value={sellCurrency}
                      onChange={(e) => setSellCurrency(e.target.value)}
                      placeholder="GBP"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="sortOrder">Sort Order</Label>
                    <Input
                      id="sortOrder"
                      type="number"
                      value={sortOrder}
                      onChange={(e) => setSortOrder(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button type="submit">
                    <Save className="h-4 w-4 mr-2" />
                    {editingId ? "Update Item" : "Create Item"}
                  </Button>
                  <Button type="button" variant="outline" onClick={handleCancel}>
                    Cancel
                  </Button>
                </div>
              </form>
          </DialogContent>
        </Dialog>

        {/* Job Items List */}
        {filteredItems.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              {items.length === 0
                ? 'No job items found. Click "Add Job Item" to create one.'
                : "No job items match the current filters."}
            </CardContent>
          </Card>
        ) : (
          <Card className="mb-6">
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Est. Hours</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Sell</TableHead>
                    <TableHead className="text-right">VAT</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item) => (
                    <TableRow key={item.item_id}>
                      <TableCell>
                        <div className="font-medium">{item.item_name}</div>
                        {item.notes ? (
                          <div className="max-w-[360px] truncate text-xs text-muted-foreground">{item.notes}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>{item.category || "Uncategorized"}</TableCell>
                      <TableCell>{item.unit}</TableCell>
                      <TableCell className="text-right">{item.estimated_hours || 0}</TableCell>
                      <TableCell className="text-right">
                        {item.cost_currency} {item.cost_amount?.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.sell_currency} {item.sell_amount?.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">{item.vat_rate}%</TableCell>
                      <TableCell>
                        <span
                          className={`px-2 py-1 rounded text-xs ${
                            item.is_active
                              ? "bg-green-100 text-green-800"
                              : "bg-gray-100 text-gray-800"
                          }`}
                        >
                          {item.is_active ? "Active" : "Inactive"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-2 justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEdit(item)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleToggleActive(item)}
                          >
                            {item.is_active ? "Deactivate" : "Activate"}
                          </Button>
                          {!item.is_active && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(item.item_id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
