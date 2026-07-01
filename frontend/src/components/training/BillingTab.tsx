"use client";

import { useEffect, useMemo, useState } from "react";
import { DollarSign, CheckCircle, AlertCircle, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { TRAINING_BILLING_STATUS_OPTIONS, formatTrainingBillingStatus } from "@/lib/training-workflow";
import type { TrainingCourseRun, TrainingBooking } from "./types";

type Props = {
  jobId: number;
  clientId: number | null;
  jobTitle?: string | null;
  jobNumber?: string | null;
  runs: TrainingCourseRun[];
  baseUrl: string;
  onRefresh: () => void;
};

type BookingRow = TrainingBooking & { run_name: string; run_id: number };

type LookupItem = {
  item_id: number;
  item_code: string;
  item_name: string;
  description: string;
  category: string;
  unit: string;
  sell_amount: number;
  sell_currency: string;
  vat_rate_id: number | null;
  vat_rate: number;
  is_active?: boolean;
};

type RunBillableGroup = {
  run_id: number;
  run_name: string;
  count: number;
};

function localDateInputValue(offsetDays = 0): string {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function billingColor(s: string) {
  switch (s) {
    case "paid": return "bg-green-100 text-green-800";
    case "invoiced": return "bg-blue-100 text-blue-800";
    case "included": return "bg-teal-100 text-teal-800";
    case "waived": return "bg-slate-100 text-slate-500";
    default: return "bg-amber-100 text-amber-700";
  }
}

function billingIcon(s: string) {
  switch (s) {
    case "paid": return <CheckCircle className="h-3.5 w-3.5 text-green-500" />;
    case "invoiced": return <Clock className="h-3.5 w-3.5 text-blue-400" />;
    default: return <AlertCircle className="h-3.5 w-3.5 text-amber-400" />;
  }
}

export default function BillingTab({ jobId, clientId, jobTitle, jobNumber, runs, baseUrl, onRefresh }: Props) {
  const allBookings = useMemo<BookingRow[]>(() => {
    const result: BookingRow[] = [];
    for (const run of runs) {
      for (const b of run.bookings) {
        result.push({
          ...b,
          run_name: run.run_name || run.product_name || `Cohort #${run.training_course_run_id}`,
          run_id: run.training_course_run_id,
        });
      }
    }
    return result;
  }, [runs]);

  const summary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const b of allBookings) {
      counts[b.billing_status] = (counts[b.billing_status] ?? 0) + 1;
    }
    return counts;
  }, [allBookings]);

  const billableBookings = useMemo(() => allBookings.filter((b) => b.billing_status === "invoiced"), [allBookings]);

  const billableGroups = useMemo<RunBillableGroup[]>(() => {
    const groups = new Map<number, RunBillableGroup>();
    for (const booking of billableBookings) {
      const existing = groups.get(booking.run_id);
      if (existing) {
        existing.count += 1;
      } else {
        groups.set(booking.run_id, {
          run_id: booking.run_id,
          run_name: booking.run_name,
          count: 1,
        });
      }
    }
    return Array.from(groups.values());
  }, [billableBookings]);

  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [lookupItems, setLookupItems] = useState<LookupItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(localDateInputValue());
  const [dueDate, setDueDate] = useState(localDateInputValue(30));
  const [creatingInvoice, setCreatingInvoice] = useState(false);

  const selectedItem = useMemo(
    () => lookupItems.find((item) => String(item.item_id) === selectedItemId) ?? null,
    [lookupItems, selectedItemId]
  );

  const invoiceSubtotal = useMemo(() => {
    if (!selectedItem) return 0;
    return billableGroups.reduce((sum, group) => sum + (group.count * Number(selectedItem.sell_amount || 0)), 0);
  }, [billableGroups, selectedItem]);

  const invoiceVat = useMemo(() => {
    if (!selectedItem) return 0;
    return invoiceSubtotal * (Number(selectedItem.vat_rate || 0) / 100);
  }, [invoiceSubtotal, selectedItem]);

  const invoiceTotal = invoiceSubtotal + invoiceVat;

  useEffect(() => {
    if (!invoiceOpen || !clientId) return;
    let cancelled = false;
    setLookupLoading(true);
    setLookupError("");

    void (async () => {
      try {
        const res = await fetch(`${baseUrl}/clients/${clientId}/quotes/lookups`, { credentials: "include" });
        if (!res.ok) {
          throw new Error(`Failed to load invoice items (${res.status})`);
        }
        const data = await res.json() as {
          items?: Array<{
            item_id: number;
            item_code?: string;
            item_name?: string;
            description?: string;
            category?: string;
            unit?: string;
            sell_amount?: number;
            sell_currency?: string;
            vat_rate_id?: number | null;
            vat_rate?: number;
            is_active?: boolean;
          }>;
        };
        if (cancelled) return;
        const items = Array.isArray(data.items) ? data.items : [];
        const normalised = items
          .filter((item) => (item.is_active ?? true) && String(item.item_name || "").trim().length > 0)
          .map((item) => ({
            item_id: Number(item.item_id),
            item_code: String(item.item_code || ""),
            item_name: String(item.item_name || ""),
            description: String(item.description || ""),
            category: String(item.category || ""),
            unit: String(item.unit || "each"),
            sell_amount: Number(item.sell_amount || 0),
            sell_currency: String(item.sell_currency || "GBP"),
            vat_rate_id: item.vat_rate_id ?? null,
            vat_rate: Number(item.vat_rate || 0),
            is_active: item.is_active !== false,
          }));
        setLookupItems(normalised);
      } catch (e) {
        if (!cancelled) {
          setLookupError((e as Error).message);
          setLookupItems([]);
        }
      } finally {
        if (!cancelled) setLookupLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [baseUrl, clientId, invoiceOpen]);

  useEffect(() => {
    if (!invoiceOpen || selectedItemId || lookupItems.length === 0) return;
    const trainingItem =
      lookupItems.find((item) => item.category.toLowerCase().includes("training")) ||
      lookupItems.find((item) => item.item_name.toLowerCase().includes("training")) ||
      lookupItems[0];
    if (trainingItem) {
      setSelectedItemId(String(trainingItem.item_id));
    }
  }, [invoiceOpen, lookupItems, selectedItemId]);

  async function updateBilling(booking: BookingRow, billing_status: string) {
    try {
      const res = await fetch(`${baseUrl}/training-bookings/${booking.training_booking_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...booking, billing_status }),
      });
      if (!res.ok) throw new Error(await res.text());
      onRefresh();
    } catch (e: unknown) {
      toast.error(String(e));
    }
  }

  async function createInvoice() {
    if (!selectedItem) {
      toast.error("Choose an invoice item first");
      return;
    }
    if (!billableGroups.length) {
      toast.error("Mark at least one booking as Invoiced first");
      return;
    }

    setCreatingInvoice(true);
    try {
      const payload = {
        job_id: jobId,
        invoice_date: invoiceDate || localDateInputValue(),
        due_date: dueDate || null,
        status: "Draft",
        notes: `Training invoice${jobNumber ? ` for ${jobNumber}` : ""}${jobTitle ? ` - ${jobTitle}` : ""}`,
        lines: billableGroups.map((group, index) => ({
          sort_order: index + 1,
          item_id: selectedItem.item_id,
          description: `${group.run_name} - Training attendees`,
          unit: selectedItem.unit || "each",
          qty: group.count,
          rate: Number(selectedItem.sell_amount || 0),
          vat_rate_id: selectedItem.vat_rate_id,
          vat_rate_pct: Number(selectedItem.vat_rate || 0),
          notes: `Auto-generated from training billing. Run: ${group.run_name}; attendees: ${group.count}.`,
        })),
      };

      const res = await fetch(`${baseUrl}/clients/${clientId}/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to create invoice (${res.status})${t ? `: ${t}` : ""}`);
      }
      const data = await res.json() as { invoice?: { invoice_id?: number }; invoice_id?: number };
      toast.success("Invoice created");
      setInvoiceOpen(false);
      onRefresh();
      const invoiceId = Number(data?.invoice?.invoice_id || data?.invoice_id || 0);
      if (invoiceId > 0) {
        window.location.href = `/clients/${clientId}/invoices/${invoiceId}`;
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreatingInvoice(false);
    }
  }

  const kpis = [
    { label: "Pending", value: summary["pending"] ?? 0, color: "text-amber-600", bg: "bg-amber-50", icon: AlertCircle },
    { label: "Invoiced", value: summary["invoiced"] ?? 0, color: "text-blue-600", bg: "bg-blue-50", icon: Clock },
    { label: "Paid", value: summary["paid"] ?? 0, color: "text-green-600", bg: "bg-green-50", icon: CheckCircle },
    { label: "Included / Waived", value: (summary["included"] ?? 0) + (summary["waived"] ?? 0), color: "text-slate-600", bg: "bg-slate-50", icon: DollarSign },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900">Billing workflow</p>
          <p className="text-xs text-slate-500">
            Mark attendees as <span className="font-medium">Invoiced</span>, then generate a draft invoice from the billing module.
          </p>
        </div>
        <Button onClick={() => setInvoiceOpen(true)} disabled={billableGroups.length === 0}>
          Create invoice
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500">{k.label}</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">{k.value}</p>
                  <p className="mt-0.5 text-xs text-slate-400">attendees</p>
                </div>
                <div className={`rounded-lg p-2 ${k.bg}`}>
                  <Icon className={`h-5 w-5 ${k.color}`} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {runs.map((run) => (
        <Card key={run.training_course_run_id}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span>{run.run_name || run.product_name || `Cohort #${run.training_course_run_id}`}</span>
              <span className="text-xs font-normal text-slate-500">{run.booking_count} attendees</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {run.bookings.length === 0 ? (
              <p className="px-4 pb-4 text-xs text-slate-400">No bookings.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Attendee</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Attendance</TableHead>
                    <TableHead className="w-[160px]">Billing Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {run.bookings.map((b) => {
                    const br = { ...b, run_name: run.run_name || "", run_id: run.training_course_run_id };
                    return (
                      <TableRow key={b.training_booking_id}>
                        <TableCell className="text-sm">
                          <div className="font-medium">{b.person_name}</div>
                          {b.person_email && <div className="text-xs text-slate-400">{b.person_email}</div>}
                          {b.client_name && <div className="text-xs text-slate-400">{b.client_name}</div>}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">
                          {b.booking_source?.replace(/_/g, " ")}
                          {b.entitlement_id ? ` (entitlement #${b.entitlement_id})` : ""}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {billingIcon(b.billing_status)}
                            <span className="text-xs text-slate-600">{b.attendance_status?.replace(/_/g, " ")}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Select value={b.billing_status} onValueChange={(v) => updateBilling(br, v)}>
                            <SelectTrigger className="h-7 border-0 p-0 shadow-none focus:ring-0">
                              <Badge className={`text-xs ${billingColor(b.billing_status)}`} variant="outline">
                                {formatTrainingBillingStatus(b.billing_status)}
                              </Badge>
                            </SelectTrigger>
                            <SelectContent>
                              {TRAINING_BILLING_STATUS_OPTIONS.map((o) => (
                                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ))}

      {allBookings.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-400">
            No bookings yet. Add attendees in the Attendees tab.
          </CardContent>
        </Card>
      )}

      <Dialog open={invoiceOpen} onOpenChange={(open) => setInvoiceOpen(open)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Create training invoice</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="font-medium text-slate-900">
                {billableBookings.length} booking{billableBookings.length === 1 ? "" : "s"} marked as Invoiced
              </div>
              <div className="mt-1 text-xs text-slate-500">
                One draft invoice will be created and you will be taken to the invoice page afterwards.
              </div>
            </div>

            <div>
              <Label>Invoice item</Label>
              <Select value={selectedItemId} onValueChange={setSelectedItemId}>
                <SelectTrigger>
                  <SelectValue placeholder={lookupLoading ? "Loading items..." : "Select invoice item"} />
                </SelectTrigger>
                <SelectContent>
                  {lookupItems.map((item) => (
                    <SelectItem key={item.item_id} value={String(item.item_id)}>
                      {item.item_name} - {item.sell_currency} {Number(item.sell_amount || 0).toFixed(2)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {lookupError ? <p className="mt-1 text-xs text-red-600">{lookupError}</p> : null}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Invoice date</Label>
                <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
              </div>
              <div>
                <Label>Due date</Label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Estimate</div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <div className="text-xs text-slate-500">Subtotal</div>
                  <div className="font-semibold">GBP {invoiceSubtotal.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">VAT</div>
                  <div className="font-semibold">GBP {invoiceVat.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Total</div>
                  <div className="font-semibold">GBP {invoiceTotal.toFixed(2)}</div>
                </div>
              </div>
            </div>

            {billableGroups.length > 0 ? (
              <div className="space-y-2">
                {billableGroups.map((group) => (
                  <div key={group.run_id} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm">
                    <div>
                      <div className="font-medium">{group.run_name}</div>
                      <div className="text-xs text-slate-500">{group.count} attendee{group.count === 1 ? "" : "s"}</div>
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      <div className="font-medium text-slate-900">GBP {(group.count * Number(selectedItem?.sell_amount || 0)).toFixed(2)}</div>
                      <div>{selectedItem?.item_name || "Item not selected"}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No attendees are currently marked as Invoiced.</p>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={() => setInvoiceOpen(false)}>Cancel</Button>
            <Button onClick={() => void createInvoice()} disabled={creatingInvoice || !selectedItem || billableGroups.length === 0}>
              {creatingInvoice ? "Creating..." : "Create invoice"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
