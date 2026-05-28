"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Clock, Plus, Trash2, Edit2 } from "lucide-react";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";

function api() {
  return "/api/backend";
}

interface JobType {
  job_type_id: number;
  name: string;
  description: string;
  estimated_hours: number;
  template_hours: number;
  item_count: number;
  is_crp: boolean;
}

interface TemplateItem {
  job_type_item_id: number;
  job_type_id: number;
  item_id: number;
  item_name: string;
  item_code: string;
  category: string;
  unit: string;
  quantity: number;
  estimated_hours: number;
  sell_amount: number;
  sell_currency: string;
  is_required: boolean;
  sort_order: number;
}

interface JobItem {
  item_id: number;
  item_code: string;
  item_name: string;
  category: string;
  unit: string;
  estimated_hours: number;
  sell_amount: number;
  sell_currency: string;
}

interface EditRow {
  job_type_item_id: number | null; // null = new
  item_id: number;
  quantity: number;
  sort_order: number;
}

export default function JobTypeTemplatesPage() {
  const [jobTypes, setJobTypes] = useState<JobType[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null);
  const [templateItems, setTemplateItems] = useState<TemplateItem[]>([]);
  const [allItems, setAllItems] = useState<JobItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [editRow, setEditRow] = useState<EditRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const confirm = useConfirmDialog();

  const loadJobTypes = useCallback(async () => {
    try {
      const res = await fetch(`${api()}/admin/job-types`);
      if (res.ok) {
        const data = await res.json();
        setJobTypes(data.items || []);
        if (!selectedTypeId && (data.items || []).length > 0) {
          setSelectedTypeId(data.items[0].job_type_id);
        }
      }
    } catch {
      setStatus("Failed to load job types");
    }
  }, [selectedTypeId]);

  const loadItems = useCallback(async () => {
    try {
      const res = await fetch(`${api()}/admin/job-items`);
      if (res.ok) {
        const data = await res.json();
        setAllItems(data.items || []);
      }
    } catch {
      // silent
    }
  }, []);

  const loadTemplateItems = useCallback(async (typeId: number) => {
    setLoading(true);
    try {
      const res = await fetch(`${api()}/admin/job-types/${typeId}/items`);
      if (res.ok) {
        const data = await res.json();
        setTemplateItems(data.items || []);
      }
    } catch {
      setStatus("Failed to load template items");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJobTypes();
    loadItems();
  }, [loadJobTypes, loadItems]);

  useEffect(() => {
    if (selectedTypeId) loadTemplateItems(selectedTypeId);
  }, [selectedTypeId, loadTemplateItems]);

  const selectedType = jobTypes.find((jt) => jt.job_type_id === selectedTypeId);

  const totalHours = templateItems.reduce(
    (sum, it) => sum + it.quantity * it.estimated_hours,
    0
  );

  function openAdd() {
    setEditRow({ job_type_item_id: null, item_id: 0, quantity: 1, sort_order: templateItems.length });
    setEditOpen(true);
  }

  function openEdit(item: TemplateItem) {
    setEditRow({
      job_type_item_id: item.job_type_item_id,
      item_id: item.item_id,
      quantity: item.quantity,
      sort_order: item.sort_order,
    });
    setEditOpen(true);
  }

  async function saveItem() {
    if (!selectedTypeId || !editRow || !editRow.item_id) {
      setStatus("Please select an item");
      return;
    }
    setLoading(true);
    setStatus("");
    try {
      const res = await fetch(`${api()}/admin/job-types/${selectedTypeId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_id: editRow.item_id,
          quantity: editRow.quantity,
          sort_order: editRow.sort_order,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        setStatus(err?.detail || "Failed to save");
        return;
      }
      setEditOpen(false);
      await loadTemplateItems(selectedTypeId);
      await loadJobTypes();
    } catch {
      setStatus("Failed to save item");
    } finally {
      setLoading(false);
    }
  }

  async function removeItem(item: TemplateItem) {
    if (!selectedTypeId) return;
    const ok = await confirm({
      title: "Remove item from template?",
      description: `"${item.item_name}" will be removed from the ${selectedType?.name} template. Existing jobs are not affected.`,
      confirmLabel: "Remove",
      variant: "destructive",
    });
    if (!ok) return;
    setLoading(true);
    try {
      await fetch(`${api()}/admin/job-types/${selectedTypeId}/items/${item.item_id}`, {
        method: "DELETE",
      });
      await loadTemplateItems(selectedTypeId);
      await loadJobTypes();
    } catch {
      setStatus("Failed to remove item");
    } finally {
      setLoading(false);
    }
  }

  const itemsAlreadyAdded = new Set(templateItems.map((t) => t.item_id));
  const availableItems = allItems.filter(
    (i) => !itemsAlreadyAdded.has(i.item_id) || editRow?.item_id === i.item_id
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Job Type Templates</h1>
        <p className="mt-1 text-sm text-slate-500">
          Define the default scope items for each job type. New jobs will be automatically
          populated with these items, which form the basis for time budgets and invoicing.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        {/* Left: job type list */}
        <div className="space-y-2">
          {jobTypes.map((jt) => (
            <button
              key={jt.job_type_id}
              onClick={() => setSelectedTypeId(jt.job_type_id)}
              className={`w-full rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                selectedTypeId === jt.job_type_id
                  ? "border-[#1c5026] bg-[#f0f7f1] font-medium text-[#1c5026]"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              <div className="font-medium leading-snug">{jt.name}</div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                <Clock className="h-3 w-3" />
                {jt.template_hours > 0
                  ? `${jt.template_hours} hrs · ${jt.item_count} items`
                  : jt.item_count > 0
                  ? `${jt.item_count} items`
                  : "No items yet"}
              </div>
            </button>
          ))}
        </div>

        {/* Right: items for selected type */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
            <div>
              <CardTitle className="text-base text-slate-900">
                {selectedType?.name ?? "Select a job type"}
              </CardTitle>
              {selectedType && (
                <p className="mt-0.5 text-xs text-slate-500">
                  {selectedType.description || "No description"}
                </p>
              )}
            </div>
            {selectedTypeId && (
              <Button size="sm" onClick={openAdd} className="gap-1.5 bg-[#1c5026] hover:bg-[#154020]">
                <Plus className="h-3.5 w-3.5" />
                Add Item
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {status && (
              <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{status}</div>
            )}
            {!selectedTypeId ? (
              <p className="py-8 text-center text-sm text-slate-400">Select a job type on the left to manage its template items.</p>
            ) : loading ? (
              <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
            ) : templateItems.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 py-10 text-center">
                <p className="text-sm font-medium text-slate-600">No items in this template yet</p>
                <p className="mt-1 text-xs text-slate-400">
                  Click "Add Item" to define the default scope for {selectedType?.name}.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Hrs / Unit</TableHead>
                    <TableHead className="text-right">Total Hrs</TableHead>
                    <TableHead className="w-20 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templateItems.map((item) => (
                    <TableRow key={item.job_type_item_id}>
                      <TableCell>
                        <div className="font-medium text-slate-900">{item.item_name}</div>
                        <div className="text-xs text-slate-400">{item.item_code}</div>
                      </TableCell>
                      <TableCell>
                        {item.category ? (
                          <Badge variant="secondary" className="text-xs">{item.category}</Badge>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                      <TableCell className="text-right tabular-nums">{item.estimated_hours}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {(item.quantity * item.estimated_hours).toFixed(1)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-slate-400 hover:text-slate-700"
                            onClick={() => openEdit(item)}
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-slate-400 hover:text-red-600"
                            onClick={() => removeItem(item)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {templateItems.length > 0 && (
              <div className="mt-3 flex items-center justify-end gap-2 border-t border-slate-100 pt-3 text-sm">
                <Clock className="h-4 w-4 text-slate-400" />
                <span className="text-slate-500">Total budgeted hours:</span>
                <span className="font-semibold text-slate-900">{totalHours.toFixed(1)} hrs</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add / Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editRow?.job_type_item_id ? "Edit Template Item" : "Add Item to Template"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Job Item</Label>
              <Select
                value={editRow?.item_id ? String(editRow.item_id) : ""}
                onValueChange={(v) =>
                  setEditRow((r) => r ? { ...r, item_id: parseInt(v) } : r)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select item…" />
                </SelectTrigger>
                <SelectContent>
                  {availableItems.map((i) => (
                    <SelectItem key={i.item_id} value={String(i.item_id)}>
                      {i.item_name}
                      {i.estimated_hours > 0 ? ` (${i.estimated_hours} hrs)` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editRow?.item_id ? (
                <p className="text-xs text-slate-400">
                  {allItems.find((i) => i.item_id === editRow.item_id)?.estimated_hours ?? 0} hrs / unit
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label>Quantity</Label>
              <Input
                type="number"
                min="0.25"
                step="0.25"
                value={editRow?.quantity ?? 1}
                onChange={(e) =>
                  setEditRow((r) => r ? { ...r, quantity: parseFloat(e.target.value) || 1 } : r)
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label>Sort Order</Label>
              <Input
                type="number"
                min="0"
                step="1"
                value={editRow?.sort_order ?? 0}
                onChange={(e) =>
                  setEditRow((r) => r ? { ...r, sort_order: parseInt(e.target.value) || 0 } : r)
                }
              />
            </div>

            {editRow?.item_id && editRow.quantity ? (
              <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
                <span className="text-slate-500">Budgeted hours: </span>
                <span className="font-semibold text-slate-900">
                  {(
                    (allItems.find((i) => i.item_id === editRow.item_id)?.estimated_hours ?? 0) *
                    editRow.quantity
                  ).toFixed(1)} hrs
                </span>
              </div>
            ) : null}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button
                onClick={saveItem}
                disabled={loading || !editRow?.item_id}
                className="bg-[#1c5026] hover:bg-[#154020]"
              >
                {loading ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
