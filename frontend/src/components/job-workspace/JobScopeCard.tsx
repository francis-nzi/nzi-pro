"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
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
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Plus,
  Trash2,
  Edit2,
  RefreshCw,
} from "lucide-react";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";

function api() {
  return "/api/backend";
}

interface LineItem {
  line_item_id: number;
  item_id: number | null;
  item_name: string;
  item_code: string;
  description: string;
  category: string;
  quantity: number;
  estimated_hours: number;
  total_hours: number;
  unit: string;
  unit_sell: number;
  sell_currency: string;
  vat_rate: number;
  notes: string;
  sort_order: number;
}

interface Summary {
  budgeted_hours: number;
  logged_hours: number;
  variance_hours: number;
  pct_used: number | null;
  over_budget: boolean;
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
  vat_rate: number;
  vat_rate_id: number | null;
}

interface EditState {
  line_item_id: number | null;
  item_id: string;
  item_name: string;
  item_code: string;
  category: string;
  quantity: string;
  estimated_hours: string;
  unit: string;
  unit_sell: string;
  notes: string;
  sort_order: string;
}

function emptyEdit(): EditState {
  return {
    line_item_id: null,
    item_id: "",
    item_name: "",
    item_code: "",
    category: "",
    quantity: "1",
    estimated_hours: "0",
    unit: "day",
    unit_sell: "0",
    notes: "",
    sort_order: "0",
  };
}

function HoursBar({ summary }: { summary: Summary }) {
  const pct = Math.min((summary.pct_used ?? 0), 100);
  const color = summary.over_budget
    ? "bg-red-500"
    : (summary.pct_used ?? 0) >= 80
    ? "bg-amber-400"
    : "bg-[#1c5026]";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-500">
          <span className="font-semibold text-slate-800">{summary.logged_hours.toFixed(1)}</span>
          {" / "}
          <span className="text-slate-600">{summary.budgeted_hours.toFixed(1)} hrs budgeted</span>
        </span>
        <span className={`font-semibold ${summary.over_budget ? "text-red-600" : "text-slate-600"}`}>
          {summary.pct_used !== null ? `${summary.pct_used}%` : "—"}
          {summary.over_budget && (
            <span className="ml-1.5 inline-flex items-center gap-0.5 text-xs text-red-600">
              <AlertTriangle className="h-3 w-3" />
              Over budget
            </span>
          )}
          {!summary.over_budget && summary.budgeted_hours > 0 && (
            <span className="ml-1.5 text-xs text-slate-400">
              ({summary.variance_hours.toFixed(1)} hrs remaining)
            </span>
          )}
        </span>
      </div>
      {summary.budgeted_hours > 0 && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-2 rounded-full transition-all ${color}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

export interface JobScopeCardHandle {
  applyTemplate: () => void;
}

interface JobScopeCardProps {
  jobId: number;
  jobTypeId?: number | null;
  jobTypeName?: string;
}

const JobScopeCard = forwardRef<JobScopeCardHandle, JobScopeCardProps>(
function JobScopeCard({ jobId, jobTypeId, jobTypeName }, ref) {
  const [items, setItems] = useState<LineItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [allJobItems, setAllJobItems] = useState<JobItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [edit, setEdit] = useState<EditState>(emptyEdit());
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const confirm = useConfirmDialog();
  const loadedRef = useRef(false);

  useImperativeHandle(ref, () => ({ applyTemplate }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${api()}/jobs/${jobId}/line-items`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setSummary(data.summary || null);
      }
    } catch {
      setStatus("Failed to load scope items");
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  const loadJobItems = useCallback(async () => {
    try {
      const res = await fetch(`${api()}/admin/job-items`);
      if (res.ok) {
        const data = await res.json();
        setAllJobItems(data.items || []);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    if (!loadedRef.current) {
      loadedRef.current = true;
      load();
      loadJobItems();
    }
  }, [load, loadJobItems]);

  function openAdd() {
    setEdit({ ...emptyEdit(), sort_order: String(items.length) });
    setEditOpen(true);
    setStatus("");
  }

  function openEdit(item: LineItem) {
    setEdit({
      line_item_id: item.line_item_id,
      item_id: item.item_id ? String(item.item_id) : "",
      item_name: item.item_name,
      item_code: item.item_code,
      category: item.category,
      quantity: String(item.quantity),
      estimated_hours: String(item.estimated_hours),
      unit: item.unit,
      unit_sell: String(item.unit_sell),
      notes: item.notes,
      sort_order: String(item.sort_order),
    });
    setEditOpen(true);
    setStatus("");
  }

  function onItemSelect(itemId: string) {
    const ji = allJobItems.find((i) => String(i.item_id) === itemId);
    if (ji) {
      setEdit((e) => ({
        ...e,
        item_id: itemId,
        item_name: ji.item_name,
        item_code: ji.item_code,
        category: ji.category,
        unit: ji.unit,
        estimated_hours: String(ji.estimated_hours),
        unit_sell: String(ji.sell_amount),
      }));
    } else {
      setEdit((e) => ({ ...e, item_id: itemId }));
    }
  }

  async function saveItem() {
    if (!edit.item_name.trim()) {
      setStatus("Item name is required");
      return;
    }
    setLoading(true);
    setStatus("");
    try {
      const payload = {
        item_id: edit.item_id ? parseInt(edit.item_id) : null,
        item_name: edit.item_name.trim(),
        item_code: edit.item_code.trim(),
        category: edit.category.trim(),
        quantity: parseFloat(edit.quantity) || 1,
        estimated_hours: parseFloat(edit.estimated_hours) || 0,
        unit: edit.unit,
        unit_sell: parseFloat(edit.unit_sell) || 0,
        notes: edit.notes.trim(),
        sort_order: parseInt(edit.sort_order) || 0,
      };

      const url =
        edit.line_item_id !== null
          ? `${api()}/jobs/${jobId}/line-items/${edit.line_item_id}`
          : `${api()}/jobs/${jobId}/line-items`;
      const method = edit.line_item_id !== null ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        setStatus(err?.detail || "Failed to save");
        return;
      }
      const data = await res.json();
      setEditOpen(false);
      setItems(
        edit.line_item_id !== null
          ? items.map((i) => (i.line_item_id === edit.line_item_id ? data.item : i))
          : [...items, data.item]
      );
      if (data.summary) setSummary(data.summary);
    } catch {
      setStatus("Failed to save item");
    } finally {
      setLoading(false);
    }
  }

  async function deleteItem(item: LineItem) {
    const ok = await confirm({
      title: "Delete scope item?",
      description: `"${item.item_name}" will be removed from this job's scope.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setLoading(true);
    try {
      const res = await fetch(`${api()}/jobs/${jobId}/line-items/${item.line_item_id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        const data = await res.json();
        setItems(items.filter((i) => i.line_item_id !== item.line_item_id));
        if (data.summary) setSummary(data.summary);
      }
    } catch {
      setStatus("Failed to delete");
    } finally {
      setLoading(false);
    }
  }

  async function applyTemplate() {
    const hasItems = items.length > 0;
    const msg = hasItems
      ? "This will replace all existing scope items with the job type template. Existing items will be deleted."
      : `Scope items from the "${jobTypeName}" template will be added to this job.`;
    const ok = await confirm({
      title: hasItems ? "Replace scope with template?" : "Apply template?",
      description: msg,
      confirmLabel: hasItems ? "Replace" : "Apply",
      destructive: hasItems,
    });
    if (!ok) return;
    setApplyingTemplate(true);
    setStatus("");
    try {
      const res = await fetch(`${api()}/jobs/${jobId}/line-items/apply-template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replace: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data?.detail || "Failed to apply template");
        return;
      }
      setItems(data.items || []);
      if (data.summary) setSummary(data.summary);
    } catch {
      setStatus("Failed to apply template");
    } finally {
      setApplyingTemplate(false);
    }
  }

  async function createInvoice() {
    setCreatingInvoice(true);
    setStatus("");
    try {
      const res = await fetch(`${api()}/jobs/${jobId}/line-items/create-invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data?.detail || "Failed to create invoice");
        return;
      }
      window.location.href = `/invoices/${data.invoice_id}`;
    } catch {
      setStatus("Failed to create invoice");
    } finally {
      setCreatingInvoice(false);
    }
  }

  const totalHours = items.reduce((s, i) => s + i.total_hours, 0);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
          <div>
            <CardTitle style={{ color: "#F26624" }}>Job Scope & Hours</CardTitle>
            <p className="mt-0.5 text-xs text-slate-500">
              Define the scope items and budgeted hours for this job.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {jobTypeId && (
              <Button
                variant="outline"
                size="sm"
                onClick={applyTemplate}
                disabled={applyingTemplate}
                className="gap-1.5 text-xs"
                title={jobTypeName ? `Load default items from the ${jobTypeName} template` : "Load default items from template"}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${applyingTemplate ? "animate-spin" : ""}`} />
                {applyingTemplate ? "Applying…" : "Apply template"}
              </Button>
            )}
            {items.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={createInvoice}
                disabled={creatingInvoice}
                className="gap-1.5 text-xs"
              >
                <FileText className="h-3.5 w-3.5" />
                {creatingInvoice ? "Creating…" : "Create invoice"}
              </Button>
            )}
            <Button
              size="sm"
              onClick={openAdd}
              className="gap-1.5 bg-[#1c5026] text-xs hover:bg-[#154020]"
            >
              <Plus className="h-3.5 w-3.5" />
              Add item
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {status && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{status}</div>
          )}

          {summary && summary.budgeted_hours > 0 && <HoursBar summary={summary} />}

          {loading && items.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">Loading…</p>
          ) : items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center">
              <Clock className="mx-auto mb-2 h-7 w-7 text-slate-300" />
              <p className="text-sm font-medium text-slate-600">No scope items yet</p>
              {jobTypeId ? (
                <button
                  onClick={applyTemplate}
                  className="mt-1 text-xs text-[#1c5026] hover:underline"
                >
                  Create items from template
                </button>
              ) : (
                <p className="mt-1 text-xs text-slate-400">
                  Add items manually or assign a Job Type to load from a template.
                </p>
              )}
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
                  <TableHead className="text-right">Sell</TableHead>
                  <TableHead className="w-20 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.line_item_id}>
                    <TableCell>
                      <div className="font-medium text-slate-900">{item.item_name}</div>
                      {item.description && (
                        <div className="whitespace-pre-line text-xs text-slate-500">{item.description}</div>
                      )}
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
                    <TableCell className="text-right font-medium tabular-nums">{item.total_hours.toFixed(1)}</TableCell>
                    <TableCell className="text-right tabular-nums text-slate-500">
                      {item.unit_sell > 0
                        ? `${item.sell_currency} ${(item.unit_sell * item.quantity).toFixed(2)}`
                        : "—"}
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
                          onClick={() => deleteItem(item)}
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

          {items.length > 0 && (
            <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
              <div className="flex items-center gap-2 text-slate-500">
                <Clock className="h-4 w-4" />
                <span>
                  Total budgeted:{" "}
                  <span className="font-semibold text-slate-900">{totalHours.toFixed(1)} hrs</span>
                </span>
              </div>
              {summary && (
                <div className="flex items-center gap-1.5 text-xs">
                  {summary.over_budget ? (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Over budget
                    </Badge>
                  ) : summary.logged_hours > 0 ? (
                    <Badge variant="secondary" className="gap-1 text-[#1c5026]">
                      <CheckCircle2 className="h-3 w-3" />
                      {summary.pct_used}% used
                    </Badge>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{edit.line_item_id ? "Edit Scope Item" : "Add Scope Item"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {status && editOpen && (
              <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{status}</div>
            )}

            <div className="space-y-1.5">
              <Label>From item library (optional)</Label>
              <Select value={edit.item_id} onValueChange={onItemSelect}>
                <SelectTrigger>
                  <SelectValue placeholder="Select from library or fill in manually…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">— Manual entry —</SelectItem>
                  {allJobItems.map((i) => (
                    <SelectItem key={i.item_id} value={String(i.item_id)}>
                      {i.item_name}
                      {i.estimated_hours > 0 ? ` (${i.estimated_hours} hrs)` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Item Name *</Label>
                <Input
                  value={edit.item_name}
                  onChange={(e) => setEdit((s) => ({ ...s, item_name: e.target.value }))}
                  placeholder="e.g. Data collection support"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Item Code</Label>
                <Input
                  value={edit.item_code}
                  onChange={(e) => setEdit((s) => ({ ...s, item_code: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Input
                  value={edit.category}
                  onChange={(e) => setEdit((s) => ({ ...s, category: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Quantity</Label>
                <Input
                  type="number"
                  min="0.25"
                  step="0.25"
                  value={edit.quantity}
                  onChange={(e) => setEdit((s) => ({ ...s, quantity: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Hrs / Unit</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.25"
                  value={edit.estimated_hours}
                  onChange={(e) => setEdit((s) => ({ ...s, estimated_hours: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Unit</Label>
                <Select value={edit.unit} onValueChange={(v) => setEdit((s) => ({ ...s, unit: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["day", "hour", "unit", "fixed", "report"].map((u) => (
                      <SelectItem key={u} value={u}>{u}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Sell Price (ex VAT)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={edit.unit_sell}
                  onChange={(e) => setEdit((s) => ({ ...s, unit_sell: e.target.value }))}
                />
              </div>
            </div>

            {parseFloat(edit.quantity) > 0 && parseFloat(edit.estimated_hours) > 0 && (
              <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
                <span className="text-slate-500">Budgeted hours: </span>
                <span className="font-semibold text-slate-900">
                  {(parseFloat(edit.quantity) * parseFloat(edit.estimated_hours)).toFixed(1)} hrs
                </span>
                {parseFloat(edit.unit_sell) > 0 && (
                  <>
                    <span className="ml-3 text-slate-500">Sell value: </span>
                    <span className="font-semibold text-slate-900">
                      £{(parseFloat(edit.quantity) * parseFloat(edit.unit_sell)).toFixed(2)}
                    </span>
                  </>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button
                onClick={saveItem}
                disabled={loading}
                className="bg-[#1c5026] hover:bg-[#154020]"
              >
                {loading ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
});

export default JobScopeCard;
