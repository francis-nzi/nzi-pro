"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";
import { inferJobFamilyFromJobTypeName } from "@/lib/job-family";

function apiBaseUrl(): string {
  return "/api/backend";
}

type LookupItem = {
  [key: string]: string | number | boolean | null | undefined;
};

const LOOKUP_TABLES = [
  { key: "job_types", label: "Job Types", idCol: "job_type_id", nameCol: "name" },
  { key: "job_statuses_lookup", label: "Job Statuses", idCol: "status_id", nameCol: "name" },
  { key: "vat_rates_lookup", label: "VAT Rates", idCol: "vat_rate_id", nameCol: "name" },
  { key: "payment_terms_lookup", label: "Payment Terms", idCol: "term_id", nameCol: "name" },
  { key: "positions_lookup", label: "Positions", idCol: "position_id", nameCol: "name" },
  { key: "processes_lookup", label: "Processes", idCol: "process_id", nameCol: "name" },
  { key: "job_item_categories_lookup", label: "Job Item Categories", idCol: "category_id", nameCol: "name" },
  { key: "job_file_types_lookup", label: "Job File Types", idCol: "file_type_id", nameCol: "display_name" },
  { key: "uom_lookup", label: "UoM", idCol: "uom_id", nameCol: "name" },
  { key: "action_categories_lookup", label: "Action Categories", idCol: "category_id", nameCol: "name" },
  { key: "bd_bin_reasons_lookup", label: "BD Bin Reasons", idCol: "bin_reason_id", nameCol: "name" },
  { key: "time_subjects", label: "Time Subjects", idCol: "subject_id", nameCol: "name" },
  { key: "portfolios_lookup", label: "Portfolios", idCol: "portfolio_id", nameCol: "name" },
  { key: "industries_lookup", label: "Industries", idCol: "industry_id", nameCol: "name" },
  { key: "currency_lookup", label: "Currencies", idCol: "currency_id", nameCol: "currency_name" },
];

const JOB_GROUP_OPTIONS = [
  { value: "crp", label: "CRP" },
  { value: "training", label: "Training" },
  { value: "consultancy", label: "Consultancy" },
  { value: "lca", label: "LCA" },
  { value: "pcf", label: "PCF" },
] as const;

export default function LookupsPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const confirmAction = useConfirmDialog();
  const [activeTab, setActiveTab] = useState(LOOKUP_TABLES[0].key);
  const [items, setItems] = useState<LookupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [lookupFilter, setLookupFilter] = useState("");
  const [newItemName, setNewItemName] = useState("");
  const [newJobTypeGroup, setNewJobTypeGroup] = useState("crp");
  const [vatRateName, setVatRateName] = useState("");
  const [vatRatePct, setVatRatePct] = useState("");
  const [currencyName, setCurrencyName] = useState("");
  const [currencySymbol, setCurrencySymbol] = useState("");
  const [fileTypeKey, setFileTypeKey] = useState("");
  const [fileTypeDisplayName, setFileTypeDisplayName] = useState("");
  const [fileTypeStorageFolder, setFileTypeStorageFolder] = useState("client-provided");
  const [fileTypeSortOrder, setFileTypeSortOrder] = useState("0");
  
  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editJobTypeGroup, setEditJobTypeGroup] = useState("crp");
  const [editRatePct, setEditRatePct] = useState("");
  const [editCurrencySymbol, setEditCurrencySymbol] = useState("");
  const [editFileTypeKey, setEditFileTypeKey] = useState("");
  const [editFileTypeStorageFolder, setEditFileTypeStorageFolder] = useState("");
  const [editFileTypeSortOrder, setEditFileTypeSortOrder] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const activeTable = useMemo(
    () => LOOKUP_TABLES.find((table) => table.key === activeTab) ?? LOOKUP_TABLES[0],
    [activeTab]
  );
  const filteredLookupTables = useMemo(() => {
    const query = lookupFilter.trim().toLowerCase();
    if (!query) return LOOKUP_TABLES;
    return LOOKUP_TABLES.filter((table) => table.label.toLowerCase().includes(query));
  }, [lookupFilter]);
  const visibleLookupTables = useMemo(() => {
    if (filteredLookupTables.some((table) => table.key === activeTab)) return filteredLookupTables;
    return [activeTable, ...filteredLookupTables.filter((table) => table.key !== activeTable.key)];
  }, [activeTable, activeTab, filteredLookupTables]);

  function singularLabel(label: string): string {
    if (label.endsWith("ies")) return `${label.slice(0, -3)}y`;
    if (label.endsWith("s")) return label.slice(0, -1);
    return label;
  }

  function itemIdValue(item: LookupItem, idCol: string): number {
    return Number(item[idCol]);
  }

  function itemNameValue(item: LookupItem, nameCol: string): string {
    return String(item[nameCol] ?? "");
  }

  const loadItems = useCallback(async (tableName: string) => {
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
  }, [baseUrl]);

  useEffect(() => {
    setItems([]); // Clear items when switching tabs
    setEditingId(null);
    loadItems(activeTab);
  }, [activeTab, loadItems]);

  async function addItem() {
    if (!newItemName.trim()) {
      setStatus("Name is required");
      return;
    }

    setStatus("Adding...");
    try {
      const payload: Record<string, string | number | boolean> = { name: newItemName.trim(), is_active: true };
      if (activeTab === "job_types") {
        payload.job_group = newJobTypeGroup || "crp";
      }
      const res = await fetch(`${baseUrl}/admin/lookups/${activeTab}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(`Failed: ${res.status}`);
      }

      setStatus("Item added!");
      setNewItemName("");
      setNewJobTypeGroup("crp");
      setIsAddDialogOpen(false);
      loadItems(activeTab);
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    }
  }

  async function addVatRate() {
    const name = vatRateName.trim();
    const pct = parseFloat(vatRatePct || "0");

    if (!name) {
      setStatus("VAT rate name is required");
      return;
    }
    if (Number.isNaN(pct) || pct < 0) {
      setStatus("VAT rate % must be a number of 0 or greater");
      return;
    }

    setStatus("Adding...");
    try {
      const res = await fetch(`${baseUrl}/admin/lookups/vat_rates_lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, rate_pct: pct, is_active: true }),
      });

      if (!res.ok) {
        throw new Error(`Failed: ${res.status}`);
      }

      setStatus("VAT rate added!");
      setVatRateName("");
      setVatRatePct("");
      setIsAddDialogOpen(false);
      loadItems("vat_rates_lookup");
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    }
  }

  async function addCurrency() {
    const name = currencyName.trim();
    const symbol = currencySymbol.trim();

    if (!name || !symbol) {
      setStatus("Currency label and symbol are required");
      return;
    }

    setStatus("Adding...");
    try {
      const res = await fetch(`${baseUrl}/admin/lookups/currency_lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currency_name: name,
          symbol,
          is_active: true
        }),
      });

      if (!res.ok) {
        throw new Error(`Failed: ${res.status}`);
      }

      setStatus("Currency added!");
      setCurrencyName("");
      setCurrencySymbol("");
      setIsAddDialogOpen(false);
      loadItems("currency_lookup");
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    }
  }

  async function archiveItem(tableName: string, itemId: number, itemName: string) {
    const confirmed = await confirmAction({
      title: "Archive lookup item?",
      description: `Archive "${itemName}"? It will remain in the system but no longer be active.`,
      confirmLabel: "Archive",
      destructive: true,
    });
    if (!confirmed) return;

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

  async function restoreItem(tableName: string, itemId: number, itemName: string) {
    const confirmed = await confirmAction({
      title: "Restore lookup item?",
      description: `Restore "${itemName}" to the active lookup list?`,
      confirmLabel: "Restore",
    });
    if (!confirmed) return;

    setStatus("Restoring...");
    try {
      const res = await fetch(`${baseUrl}/admin/lookups/${tableName}/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: true }),
      });

      if (!res.ok) {
        throw new Error(`Failed: ${res.status}`);
      }

      setStatus("Item restored!");
      loadItems(tableName);
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    }
  }

  function startEdit(item: LookupItem, table: typeof LOOKUP_TABLES[0]) {
    setEditingId(itemIdValue(item, table.idCol));
    if (table.key === "vat_rates_lookup") {
      setEditName(itemNameValue(item, table.nameCol));
      setEditRatePct(String(item.rate_pct ?? ""));
    } else if (table.key === "currency_lookup") {
      setEditName(itemNameValue(item, table.nameCol));
      setEditCurrencySymbol(String(item.symbol ?? ""));
    } else if (table.key === "job_file_types_lookup") {
      setEditName(itemNameValue(item, table.nameCol));
      setEditFileTypeKey(String(item.file_type_key ?? ""));
      setEditFileTypeStorageFolder(String(item.storage_folder_key ?? "client-provided"));
      setEditFileTypeSortOrder(String(item.sort_order ?? "0"));
    } else if (table.key === "job_types") {
      setEditName(itemNameValue(item, table.nameCol));
      setEditJobTypeGroup(String(item.job_group ?? item.job_family ?? "crp").toLowerCase());
    } else {
      setEditName(itemNameValue(item, table.nameCol));
      setEditRatePct("");
    }
    if (table.key !== "currency_lookup") {
      setEditCurrencySymbol("");
    }
    if (table.key !== "job_file_types_lookup") {
      setEditFileTypeKey("");
      setEditFileTypeStorageFolder("");
      setEditFileTypeSortOrder("");
    }
    if (table.key !== "job_types") {
      setEditJobTypeGroup("crp");
    }
  }

  async function addJobFileType() {
    const key = fileTypeKey.trim();
    const displayName = fileTypeDisplayName.trim();
    const storageFolderKey = fileTypeStorageFolder.trim() || "client-provided";
    const sortOrder = parseInt(fileTypeSortOrder || "0", 10) || 0;

    if (!key) {
      setStatus("File type key is required");
      return;
    }
    if (!displayName) {
      setStatus("Display name is required");
      return;
    }

    setStatus("Adding...");
    try {
      const res = await fetch(`${baseUrl}/admin/lookups/job_file_types_lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_type_key: key,
          display_name: displayName,
          storage_folder_key: storageFolderKey,
          sort_order: sortOrder,
          is_active: true,
        }),
      });

      if (!res.ok) {
        throw new Error(`Failed: ${res.status}`);
      }

      setStatus("File type added!");
      setFileTypeKey("");
      setFileTypeDisplayName("");
      setFileTypeStorageFolder("client-provided");
      setFileTypeSortOrder("0");
      setIsAddDialogOpen(false);
      loadItems("job_file_types_lookup");
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    }
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
    setEditRatePct("");
    setEditCurrencySymbol("");
    setEditFileTypeKey("");
    setEditFileTypeStorageFolder("");
    setEditFileTypeSortOrder("");
    setEditJobTypeGroup("crp");
  }

  async function saveEdit(tableName: string, itemId: number) {
    if (!editName.trim()) {
      setStatus("Name is required");
      return;
    }

    setSavingEdit(true);
    setStatus("Saving...");
    try {
      const payload: Record<string, string | number> =
        tableName === "currency_lookup"
          ? { currency_name: editName.trim(), symbol: editCurrencySymbol.trim() }
          : { name: editName.trim() };
      if (tableName === "vat_rates_lookup") {
        const pct = parseFloat(editRatePct || "0");
        if (Number.isNaN(pct) || pct < 0) {
          setStatus("VAT rate % must be a number of 0 or greater");
          setSavingEdit(false);
          return;
        }
        payload.rate_pct = pct;
      }
      if (tableName === "currency_lookup" && !editCurrencySymbol.trim()) {
        setStatus("Currency symbol is required");
        setSavingEdit(false);
        return;
      }

      if (tableName === "job_file_types_lookup") {
        if (!editFileTypeKey.trim()) {
          setStatus("File type key is required");
          setSavingEdit(false);
          return;
        }
        const sortOrder = parseInt(editFileTypeSortOrder || "0", 10) || 0;
        payload.file_type_key = editFileTypeKey.trim();
        payload.display_name = editName.trim();
        payload.storage_folder_key = editFileTypeStorageFolder.trim() || "client-provided";
        payload.sort_order = sortOrder;
      }
      if (tableName === "job_types") {
        payload.job_group = editJobTypeGroup || "crp";
      }

      const res = await fetch(`${baseUrl}/admin/lookups/${tableName}/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(`Failed: ${res.status}`);
      }

      setStatus("Item updated!");
      setEditingId(null);
      setEditName("");
      setEditRatePct("");
      setEditCurrencySymbol("");
      setEditFileTypeKey("");
      setEditFileTypeStorageFolder("");
      setEditFileTypeSortOrder("");
      loadItems(tableName);
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: '#F26624' }}>Lookups Management</h1>
            <p className="text-sm text-muted-foreground">
              Manage reference data: job types, statuses, VAT rates, and more
            </p>
          </div>
          <Button variant="secondary" asChild>
            <Link href="/admin">&larr; Back to Admin</Link>
          </Button>
        </div>

        {status && (
          <div
            className={`mb-4 rounded-md p-3 text-sm ${
              status.toLowerCase().startsWith("error")
                ? "border border-rose-200 bg-rose-50 text-rose-700"
                : "bg-muted text-foreground"
            }`}
          >
            {status}
          </div>
        )}

        <div className="mb-4">
          <Label htmlFor="lookupFilter" className="mb-2 block text-sm font-medium">Find Lookup Category</Label>
          <Input
            id="lookupFilter"
            value={lookupFilter}
            onChange={(e) => setLookupFilter(e.target.value)}
            placeholder="Type to filter categories..."
            className="w-full lg:max-w-md"
          />
        </div>

        <div className="mb-4 lg:hidden">
          <Label className="mb-2 block text-sm font-medium">Lookup Category</Label>
          <Select value={activeTab} onValueChange={setActiveTab}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select lookup category" />
            </SelectTrigger>
            <SelectContent>
              {visibleLookupTables.map((table) => (
                <SelectItem key={table.key} value={table.key}>
                  {table.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
          <Card className="hidden lg:block h-fit">
            <CardHeader>
              <CardTitle className="text-base">Lookup Categories</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {filteredLookupTables.length === 0 ? (
                <div className="text-sm text-muted-foreground">No matching categories.</div>
              ) : (
                filteredLookupTables.map((table) => (
                  <Button
                    key={table.key}
                    variant={activeTab === table.key ? "default" : "ghost"}
                    className="w-full justify-start"
                    onClick={() => setActiveTab(table.key)}
                  >
                    {table.label}
                  </Button>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle>{activeTable.label}</CardTitle>
              <Button onClick={() => setIsAddDialogOpen(true)}>
                Add {activeTable.key === "currency_lookup" ? "Currency" : singularLabel(activeTable.label)}
              </Button>
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
                      {editingId === itemIdValue(item, activeTable.idCol) ? (
                        <div className="flex flex-1 items-center gap-2">
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="flex-1"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEdit(activeTable.key, itemIdValue(item, activeTable.idCol));
                              if (e.key === "Escape") cancelEdit();
                            }}
                            autoFocus
                          />
                          {activeTable.key === "vat_rates_lookup" && (
                            <Input
                              type="number"
                              step="0.01"
                              value={editRatePct}
                              onChange={(e) => setEditRatePct(e.target.value)}
                              className="w-28"
                              placeholder="%"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveEdit(activeTable.key, itemIdValue(item, activeTable.idCol));
                                if (e.key === "Escape") cancelEdit();
                              }}
                            />
                          )}
                          {activeTable.key === "currency_lookup" && (
                            <Input
                              value={editCurrencySymbol}
                              onChange={(e) => setEditCurrencySymbol(e.target.value)}
                              className="w-28"
                              placeholder="Symbol"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveEdit(activeTable.key, itemIdValue(item, activeTable.idCol));
                                if (e.key === "Escape") cancelEdit();
                              }}
                            />
                          )}
                          {activeTable.key === "job_file_types_lookup" && (
                            <>
                              <Input
                                value={editFileTypeStorageFolder}
                                onChange={(e) => setEditFileTypeStorageFolder(e.target.value)}
                                className="w-44"
                                placeholder="Storage folder"
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveEdit(activeTable.key, itemIdValue(item, activeTable.idCol));
                                  if (e.key === "Escape") cancelEdit();
                                }}
                              />
                              <Input
                                type="number"
                                value={editFileTypeSortOrder}
                                onChange={(e) => setEditFileTypeSortOrder(e.target.value)}
                                className="w-24"
                                placeholder="Sort"
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveEdit(activeTable.key, itemIdValue(item, activeTable.idCol));
                                  if (e.key === "Escape") cancelEdit();
                                }}
                              />
                            </>
                          )}
                          {activeTable.key === "job_types" && (
                            <Select value={editJobTypeGroup} onValueChange={setEditJobTypeGroup}>
                              <SelectTrigger className="w-44">
                                <SelectValue placeholder="Select group" />
                              </SelectTrigger>
                              <SelectContent>
                                {JOB_GROUP_OPTIONS.map((group) => (
                                  <SelectItem key={group.value} value={group.value}>
                                    {group.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                          <Button
                            size="sm"
                            onClick={() => saveEdit(activeTable.key, itemIdValue(item, activeTable.idCol))}
                            disabled={savingEdit}
                          >
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={cancelEdit}
                            disabled={savingEdit}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <>
                          <div className="flex-1">
                            <div className="font-medium">{itemNameValue(item, activeTable.nameCol)}</div>
                            {activeTable.key === "job_types" && (
                              <div className="text-sm text-muted-foreground">
                                Group: {String(item.job_group ?? item.job_family ?? inferJobFamilyFromJobTypeName(String(item.name ?? "")) ?? "crp").toUpperCase()}
                              </div>
                            )}
                            {activeTable.key === "job_file_types_lookup" && (
                              <div className="text-sm text-muted-foreground">
                                Key: {String(item.file_type_key ?? "-")} • Folder: {String(item.storage_folder_key ?? "-")} • Sort: {String(item.sort_order ?? 0)}
                              </div>
                            )}
                            {activeTable.key === "vat_rates_lookup" && (
                              <div className="text-sm text-muted-foreground">
                                {Number(item.rate_pct ?? 0).toFixed(2)}%
                              </div>
                            )}
                            {activeTable.key === "currency_lookup" && (
                              <div className="text-sm text-muted-foreground">
                                Symbol: {String(item.symbol ?? "") || "-"}
                              </div>
                            )}
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
                          {item.is_active ? (
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => startEdit(item, activeTable)}
                              >
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() =>
                                  archiveItem(
                                    activeTable.key,
                                    itemIdValue(item, activeTable.idCol),
                                    itemNameValue(item, activeTable.nameCol),
                                  )
                                }
                              >
                                Archive
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                restoreItem(
                                  activeTable.key,
                                  itemIdValue(item, activeTable.idCol),
                                  itemNameValue(item, activeTable.nameCol),
                                )
                              }
                            >
                              Restore
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>
                Add New {activeTable.key === "currency_lookup" ? "Currency" : singularLabel(activeTable.label)}
              </DialogTitle>
              <DialogDescription>
                Create a new active lookup value for {activeTable.label.toLowerCase()}.
              </DialogDescription>
            </DialogHeader>
            {activeTable.key === "job_file_types_lookup" ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="fileTypeKey">File Type Key</Label>
                  <Input
                    id="fileTypeKey"
                    value={fileTypeKey}
                    onChange={(e) => setFileTypeKey(e.target.value)}
                    placeholder="client_feedback"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fileTypeDisplayName">Display Name</Label>
                  <Input
                    id="fileTypeDisplayName"
                    value={fileTypeDisplayName}
                    onChange={(e) => setFileTypeDisplayName(e.target.value)}
                    placeholder="Client Feedback"
                  />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="fileTypeStorageFolder">Storage Folder Key</Label>
                    <Input
                      id="fileTypeStorageFolder"
                      value={fileTypeStorageFolder}
                      onChange={(e) => setFileTypeStorageFolder(e.target.value)}
                      placeholder="client-provided"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="fileTypeSortOrder">Sort Order</Label>
                    <Input
                      id="fileTypeSortOrder"
                      type="number"
                      value={fileTypeSortOrder}
                      onChange={(e) => setFileTypeSortOrder(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                </div>
              </div>
            ) : activeTable.key === "currency_lookup" ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="currencyName">Currency Label</Label>
                  <Input
                    id="currencyName"
                    value={currencyName}
                    onChange={(e) => setCurrencyName(e.target.value)}
                    placeholder="US Dollar"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="currencySymbol">Currency Symbol</Label>
                  <Input
                    id="currencySymbol"
                    value={currencySymbol}
                    onChange={(e) => setCurrencySymbol(e.target.value)}
                    placeholder="$"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addCurrency();
                    }}
                  />
                </div>
              </div>
            ) : activeTable.key === "vat_rates_lookup" ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="vatRateName">VAT Rate Name</Label>
                  <Input
                    id="vatRateName"
                    value={vatRateName}
                    onChange={(e) => setVatRateName(e.target.value)}
                    placeholder="e.g. 20% Standard Rate"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vatRatePct">VAT Rate %</Label>
                  <Input
                    id="vatRatePct"
                    type="number"
                    step="0.01"
                    value={vatRatePct}
                    onChange={(e) => setVatRatePct(e.target.value)}
                    placeholder="20.00"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addVatRate();
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="newItemName">Name</Label>
                <Input
                  id="newItemName"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  placeholder={`Enter ${singularLabel(activeTable.label).toLowerCase()} name...`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addItem();
                  }}
                />
                {activeTable.key === "job_types" && (
                  <div className="space-y-2">
                    <Label htmlFor="newJobTypeGroup">Job Group</Label>
                    <Select value={newJobTypeGroup} onValueChange={setNewJobTypeGroup}>
                      <SelectTrigger id="newJobTypeGroup">
                        <SelectValue placeholder="Select group" />
                      </SelectTrigger>
                      <SelectContent>
                        {JOB_GROUP_OPTIONS.map((group) => (
                          <SelectItem key={group.value} value={group.value}>
                            {group.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsAddDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={
                  activeTable.key === "job_file_types_lookup"
                    ? addJobFileType
                    : activeTable.key === "currency_lookup"
                    ? addCurrency
                    : activeTable.key === "vat_rates_lookup"
                      ? addVatRate
                      : addItem
                }
              >
                {activeTable.key === "job_file_types_lookup"
                  ? "Add File Type"
                  : activeTable.key === "currency_lookup"
                  ? "Add Currency"
                  : activeTable.key === "vat_rates_lookup"
                    ? "Add VAT Rate"
                    : "Add Item"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Documentation */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Lookup Tables</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <span className="font-medium">Job Types:</span> Define service offerings (e.g., Carbon Footprint, Net Zero Strategy).{" "}
              <Button variant="link" className="h-auto p-0 text-sm" asChild>
                <Link href="/admin/job-types">Edit Estimated Hours</Link>
              </Button>
            </div>
            <div>
              <span className="font-medium">Job Statuses:</span> Track job lifecycle (Open, Data Gathering, Reporting, Completed)
            </div>
            <div>
              <span className="font-medium">Job File Types:</span> Configure job file upload categories and storage folders
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
            <div>
              <span className="font-medium">Currencies:</span> Currency codes and exchange rates for international clients
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
