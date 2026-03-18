"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { CompanyIdentityBlock, CompanyLegalFooter } from "@/components/CompanyIdentityBlock";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";

type ViewMode = "quotes" | "invoices" | "other-costs" | "profit-loss";

type JobQuote = {
  quote_id: number;
  quote_number: string | null;
  quote_date: string | null;
  valid_to: string | null;
  currency_code: string | null;
  status: string | null;
  total: number | null;
  job_number?: string | null;
};

type JobInvoice = {
  invoice_id: number;
  job_id?: number | null;
  quote_id: number | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  currency_code: string | null;
  total: number | null;
  status: string | null;
  amount_paid: number | null;
};

type QuoteLookupItem = {
  item_id: number;
  item_name: string;
  description?: string;
  category?: string;
  unit?: string;
  sell_amount?: number;
  vat_rate_id?: number | null;
  vat_rate?: number;
  is_active?: boolean;
};

type InvoiceDraftLine = {
  key: string;
  item_id: number | null;
  description: string;
  unit: string;
  qty: number;
  rate: number;
  vat_rate_pct: number;
  notes: string;
};

type JobFinancialSummary = {
  quotes: { count: number; estimated_total: number };
  invoices: { count: number; invoiced_total: number; paid_total: number; outstanding_total: number };
  other_costs?: { count: number; subtotal: number; vat_total: number; total: number };
  analysis: {
    actual_cost_from_time: number;
    variance_amount: number;
    realization_pct: number;
    logged_hours: number;
    actual_cost_total?: number;
    gross_profit_after_costs?: number;
  };
};

type OtherCost = {
  other_cost_id: number;
  job_id: number;
  cost_type: string;
  item_name: string;
  description: string;
  unit: string;
  qty: number;
  rate: number;
  amount_ex_vat: number;
  is_vatable: boolean;
  vat_rate_pct: number;
  vat_amount: number;
  total_inc_vat: number;
  supplier: string;
  incurred_date: string | null;
  notes: string;
};

type OtherCostSupplier = {
  supplier_id: number;
  supplier_name: string;
  address?: string;
  contact_name?: string;
  contact_email?: string;
  website?: string;
  phone?: string;
};

type OtherCostSupplierItem = {
  supplier_item_id: number;
  supplier_id: number;
  cost_type: string;
  item_name: string;
  description: string;
  uom: string;
  agreed_rate: number;
  is_vatable: boolean;
  vat_rate_pct: number;
};

type Props = {
  jobId: number;
  clientId: number | null;
  jobNumber?: string | null;
  baseUrl: string;
  mode: ViewMode;
};

export default function JobFinancial({ jobId, clientId, jobNumber, baseUrl, mode }: Props) {
  const confirmAction = useConfirmDialog();
  const costTypeOptions = ["Consultant", "Product", "Software", "Sales Commission", "Travel", "Other"];
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [quotes, setQuotes] = useState<JobQuote[]>([]);
  const [invoices, setInvoices] = useState<JobInvoice[]>([]);
  const [quoteLookupItems, setQuoteLookupItems] = useState<QuoteLookupItem[]>([]);
  const [otherCosts, setOtherCosts] = useState<OtherCost[]>([]);
  const [otherCostSuppliers, setOtherCostSuppliers] = useState<OtherCostSupplier[]>([]);
  const [otherCostSupplierItems, setOtherCostSupplierItems] = useState<OtherCostSupplierItem[]>([]);
  const [uomOptions, setUomOptions] = useState<string[]>(["hours", "days", "units"]);
  const [summary, setSummary] = useState<JobFinancialSummary | null>(null);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string>("");
  const [invoiceDate, setInvoiceDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState<string>("");
  const [invoiceStatus, setInvoiceStatus] = useState<string>("Draft");
  const [invoiceLines, setInvoiceLines] = useState<InvoiceDraftLine[]>([
    {
      key: `line-${Math.random().toString(36).slice(2)}`,
      item_id: null,
      description: "",
      unit: "",
      qty: 1,
      rate: 0,
      vat_rate_pct: 20,
      notes: "",
    },
  ]);
  const [otherCostForm, setOtherCostForm] = useState({
    supplier_id: "",
    supplier_item_id: "",
    cost_type: "Consultant",
    item_name: "",
    description: "",
    unit: "hours",
    qty: 1,
    rate: 0,
    is_vatable: false,
    vat_rate_pct: 20,
    supplier: "",
    incurred_date: new Date().toISOString().slice(0, 10),
    notes: "",
  });

  const money = useMemo(
    () => new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    []
  );
  const jobQuoteCreateHref = useMemo(() => {
    if (!(clientId && clientId > 0)) return "#";
    const q = jobNumber && jobNumber.trim().length ? `?jobNumber=${encodeURIComponent(jobNumber.trim())}` : "";
    return `/clients/${clientId}/quotes/new${q}`;
  }, [clientId, jobNumber]);

  async function load() {
    if (!Number.isFinite(jobId) || jobId <= 0) return;
    setLoading(true);
    setStatus("");
    try {
      if (mode === "profit-loss") {
        const res = await fetch(`${baseUrl}/jobs/${jobId}/financial/summary`, { credentials: "include" });
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          throw new Error(`Failed to load job P&L (${res.status})${t ? `: ${t}` : ""}`);
        }
        setSummary((await res.json()) as JobFinancialSummary);
        return;
      }
      if (mode === "other-costs") {
        const [costsRes, lookupsRes, uomRes] = await Promise.all([
          fetch(`${baseUrl}/jobs/${jobId}/other-costs`, { credentials: "include" }),
          fetch(`${baseUrl}/jobs/${jobId}/other-costs/lookups`, { credentials: "include" }),
          fetch(`${baseUrl}/admin/lookups/uom_lookup`, { credentials: "include" }),
        ]);
        if (!costsRes.ok) {
          const t = await costsRes.text().catch(() => "");
          throw new Error(`Failed to load other costs (${costsRes.status})${t ? `: ${t}` : ""}`);
        }
        const costsJson = (await costsRes.json()) as { items?: OtherCost[] };
        setOtherCosts(Array.isArray(costsJson?.items) ? costsJson.items : []);
        if (lookupsRes.ok) {
          const lookupsJson = (await lookupsRes.json()) as {
            suppliers?: OtherCostSupplier[];
            items?: OtherCostSupplierItem[];
          };
          setOtherCostSuppliers(Array.isArray(lookupsJson?.suppliers) ? lookupsJson.suppliers : []);
          setOtherCostSupplierItems(Array.isArray(lookupsJson?.items) ? lookupsJson.items : []);
        }
        if (uomRes.ok) {
          const uomJson = (await uomRes.json()) as { items?: Array<{ name?: string; is_active?: boolean }> };
          const names = Array.isArray(uomJson?.items)
            ? uomJson.items
                .filter((x) => (x?.is_active ?? true) && String(x?.name || "").trim().length > 0)
                .map((x) => String(x.name))
            : [];
          if (names.length > 0) setUomOptions(names);
        }
        return;
      }

      let loadedInvoices = false;
      const invRes = await fetch(`${baseUrl}/jobs/${jobId}/invoices`, { credentials: "include" });
      if (invRes.ok) {
        const invJson = (await invRes.json()) as { items?: JobInvoice[] };
        setInvoices(Array.isArray(invJson?.items) ? invJson.items : []);
        loadedInvoices = true;
      } else if (invRes.status === 404 && clientId && clientId > 0) {
        // Backward-compatible fallback for servers missing GET /jobs/{job_id}/invoices.
        const clientInvRes = await fetch(`${baseUrl}/clients/${clientId}/invoices`, { credentials: "include" });
        if (clientInvRes.ok) {
          const clientInvJson = (await clientInvRes.json()) as { items?: Array<JobInvoice & { job_id?: number | null }> };
          const all = Array.isArray(clientInvJson?.items) ? clientInvJson.items : [];
          setInvoices(all.filter((inv) => Number(inv.job_id || 0) === Number(jobId)));
          loadedInvoices = true;
        }
      }
      if (!loadedInvoices) {
        const t = await invRes.text().catch(() => "");
        throw new Error(`Failed to load invoices (${invRes.status})${t ? `: ${t}` : ""}`);
      }

      if (!(clientId && clientId > 0)) {
        setQuotes([]);
        setQuoteLookupItems([]);
        return;
      }

      const quoteRes = await fetch(`${baseUrl}/clients/${clientId}/quotes`, { credentials: "include" });
      if (!quoteRes.ok) {
        const t = await quoteRes.text().catch(() => "");
        throw new Error(`Failed to load quotes (${quoteRes.status})${t ? `: ${t}` : ""}`);
      }
      const qJson = (await quoteRes.json()) as { items?: JobQuote[] };
      const all = Array.isArray(qJson?.items) ? qJson.items : [];
      const filtered =
        jobNumber && jobNumber.trim().length
          ? all.filter((q) => String(q.job_number || "").trim() === jobNumber.trim())
          : all;
      setQuotes(filtered);

      if (mode === "invoices") {
        const [lookupsRes, adminItemsRes] = await Promise.all([
          fetch(`${baseUrl}/clients/${clientId}/quotes/lookups`, { credentials: "include" }),
          fetch(`${baseUrl}/admin/job-items?include_inactive=true`, { credentials: "include" }),
        ]);

        const lookupItems = lookupsRes.ok
          ? ((await lookupsRes.json()) as { items?: QuoteLookupItem[] })?.items ?? []
          : [];

        const adminItemsRaw = adminItemsRes.ok
          ? ((await adminItemsRes.json()) as { items?: Array<{
              item_id: number;
              item_name?: string;
              category?: string;
              unit?: string;
              sell_amount?: number;
              vat_rate_id?: number | null;
              vat_rate?: number;
              is_active?: boolean;
            }>; })?.items ?? []
          : [];

        const mappedAdmin: QuoteLookupItem[] = adminItemsRaw.map((it) => ({
          item_id: Number(it.item_id),
          item_name: String(it.item_name || ""),
          category: String(it.category || ""),
          unit: String(it.unit || ""),
          sell_amount: Number(it.sell_amount || 0),
          vat_rate_id: it.vat_rate_id ?? null,
          vat_rate: Number(it.vat_rate || 0),
          is_active: it.is_active !== false,
        }));

        const merged = new Map<number, QuoteLookupItem>();
        for (const item of mappedAdmin) merged.set(item.item_id, item);
        for (const item of lookupItems) {
          if (!item || !Number.isFinite(Number(item.item_id))) continue;
          merged.set(Number(item.item_id), { ...merged.get(Number(item.item_id)), ...item });
        }
        const finalItems = Array.from(merged.values()).filter((it) => (it.is_active ?? true) && String(it.item_name || "").trim().length > 0);
        setQuoteLookupItems(finalItems);
      }
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function lineAmount(line: InvoiceDraftLine): number {
    return Number((line.qty || 0) * (line.rate || 0));
  }
  const invoiceSubtotal = invoiceLines.reduce((acc, line) => acc + lineAmount(line), 0);
  const invoiceVat = invoiceLines.reduce((acc, line) => acc + lineAmount(line) * ((line.vat_rate_pct || 0) / 100), 0);
  const invoiceTotal = invoiceSubtotal + invoiceVat;
  const otherCostDraftAmount = Number(otherCostForm.qty || 0) * Number(otherCostForm.rate || 0);
  const otherCostDraftVat = otherCostForm.is_vatable
    ? otherCostDraftAmount * ((Number(otherCostForm.vat_rate_pct || 0) || 0) / 100)
    : 0;
  const otherCostDraftTotal = otherCostDraftAmount + otherCostDraftVat;
  const otherCostSubtotal = otherCosts.reduce((acc, row) => acc + Number(row.amount_ex_vat || 0), 0);
  const otherCostVat = otherCosts.reduce((acc, row) => acc + Number(row.vat_amount || 0), 0);
  const otherCostTotal = otherCosts.reduce((acc, row) => acc + Number(row.total_inc_vat || 0), 0);
  const filteredSupplierItems = otherCostForm.supplier_id
    ? otherCostSupplierItems.filter((item) => String(item.supplier_id) === String(otherCostForm.supplier_id))
    : [];

  function addLine() {
    setInvoiceLines((prev) => [
      ...prev,
      {
        key: `line-${Math.random().toString(36).slice(2)}`,
        item_id: null,
        description: "",
        unit: "",
        qty: 1,
        rate: 0,
        vat_rate_pct: 20,
        notes: "",
      },
    ]);
  }

  function updateLine(key: string, patch: Partial<InvoiceDraftLine>) {
    setInvoiceLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function removeLine(key: string) {
    setInvoiceLines((prev) => prev.filter((line) => line.key !== key));
  }

  function onItemChange(key: string, itemIdText: string) {
    const itemId = Number(itemIdText);
    const selected = quoteLookupItems.find((it) => Number(it.item_id) === itemId);
    if (!selected) return;
    updateLine(key, {
      item_id: selected.item_id,
      description: selected.description || selected.item_name || "",
      unit: selected.unit || "",
      rate: Number(selected.sell_amount || 0),
      vat_rate_pct: Number(selected.vat_rate || 0),
    });
  }

  async function loadQuoteLinesToDraft(quoteId: number) {
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/quotes/${quoteId}`, { credentials: "include" });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to load quote lines (${res.status})${t ? `: ${t}` : ""}`);
      }
      const quote = await res.json();
      const lines = Array.isArray(quote?.lines) ? quote.lines : [];
      const main = lines.filter((line: { line_type?: string }) => (line.line_type || "main") !== "option");
      if (!main.length) {
        setStatus("Quote has no billable lines.");
        return;
      }
      setInvoiceLines(
        main.map((line: { item_id?: number; description?: string; unit?: string; qty?: number; rate?: number; vat_rate_pct?: number; notes?: string }) => ({
          key: `line-${Math.random().toString(36).slice(2)}`,
          item_id: line.item_id ?? null,
          description: String(line.description || ""),
          unit: String(line.unit || ""),
          qty: Number(line.qty || 0),
          rate: Number(line.rate || 0),
          vat_rate_pct: Number(line.vat_rate_pct || 0),
          notes: String(line.notes || ""),
        }))
      );
      setSelectedQuoteId(String(quoteId));
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, clientId, jobNumber, baseUrl, mode]);

  async function convertQuote(quoteId: number) {
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/quotes/${quoteId}/convert-to-invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          job_id: jobId,
          invoice_date: invoiceDate || new Date().toISOString().slice(0, 10),
          due_date: dueDate || null,
          status: "Draft",
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to convert quote (${res.status})${t ? `: ${t}` : ""}`);
      }
      await load();
      setStatus("Quote converted to invoice.");
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  async function addManualInvoice() {
    setStatus("");
    try {
      let res = await fetch(`${baseUrl}/jobs/${jobId}/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          quote_id: selectedQuoteId ? Number(selectedQuoteId) : null,
          invoice_date: invoiceDate || new Date().toISOString().slice(0, 10),
          due_date: dueDate || null,
          status: invoiceStatus,
          total: Number(invoiceTotal || 0),
          subtotal: Number(invoiceSubtotal || 0),
          vat: Number(invoiceVat || 0),
          lines: invoiceLines.map((line, idx) => ({
            sort_order: idx + 1,
            item_id: line.item_id,
            description: line.description,
            unit: line.unit,
            qty: Number(line.qty || 0),
            rate: Number(line.rate || 0),
            amount: Number(lineAmount(line)),
            vat_rate_pct: Number(line.vat_rate_pct || 0),
            notes: line.notes || "",
          })),
        }),
      });
      if (res.status === 404 && clientId && clientId > 0) {
        // Backward-compatible fallback for servers that don't yet expose POST /jobs/{job_id}/invoices.
        res = await fetch(`${baseUrl}/clients/${clientId}/invoices`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            job_id: jobId,
            quote_id: selectedQuoteId ? Number(selectedQuoteId) : null,
            invoice_date: invoiceDate || new Date().toISOString().slice(0, 10),
            due_date: dueDate || null,
            status: invoiceStatus,
            total: Number(invoiceTotal || 0),
            subtotal: Number(invoiceSubtotal || 0),
            vat: Number(invoiceVat || 0),
            lines: invoiceLines.map((line, idx) => ({
              sort_order: idx + 1,
              item_id: line.item_id,
              description: line.description,
              unit: line.unit,
              qty: Number(line.qty || 0),
              rate: Number(line.rate || 0),
              amount: Number(lineAmount(line)),
              vat_rate_pct: Number(line.vat_rate_pct || 0),
              notes: line.notes || "",
            })),
          }),
        });
      }
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to create invoice (${res.status})${t ? `: ${t}` : ""}`);
      }
      await load();
      setStatus("Invoice created.");
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  async function addOtherCost() {
    setStatus("");
    try {
      if (!otherCostForm.item_name.trim()) {
        setStatus("Item name is required.");
        return;
      }
      const res = await fetch(`${baseUrl}/jobs/${jobId}/other-costs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          supplier:
            otherCostSuppliers.find((s) => String(s.supplier_id) === String(otherCostForm.supplier_id))
              ?.supplier_name || otherCostForm.supplier.trim(),
          supplier_id: otherCostForm.supplier_id ? Number(otherCostForm.supplier_id) : null,
          supplier_item_id: otherCostForm.supplier_item_id ? Number(otherCostForm.supplier_item_id) : null,
          cost_type: otherCostForm.cost_type,
          item_name: otherCostForm.item_name.trim(),
          description: otherCostForm.description.trim(),
          unit: otherCostForm.unit.trim(),
          qty: Number(otherCostForm.qty || 0),
          rate: Number(otherCostForm.rate || 0),
          is_vatable: Boolean(otherCostForm.is_vatable),
          vat_rate_pct: otherCostForm.is_vatable ? Number(otherCostForm.vat_rate_pct || 0) : 0,
          incurred_date: otherCostForm.incurred_date || null,
          notes: otherCostForm.notes.trim(),
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to add other cost (${res.status})${t ? `: ${t}` : ""}`);
      }
      setOtherCostForm({
        supplier_id: otherCostForm.supplier_id,
        supplier_item_id: "",
        cost_type: otherCostForm.cost_type || "Consultant",
        item_name: "",
        description: "",
        unit: otherCostForm.unit || "hours",
        qty: 1,
        rate: 0,
        is_vatable: false,
        vat_rate_pct: 20,
        supplier: "",
        incurred_date: new Date().toISOString().slice(0, 10),
        notes: "",
      });
      await load();
      setStatus("Other cost added.");
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  async function removeOtherCost(otherCostId: number) {
    const confirmed = await confirmAction({
      title: "Delete other cost?",
      description: "This other cost entry will be removed from the job financials.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/other-costs/${otherCostId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to delete other cost (${res.status})${t ? `: ${t}` : ""}`);
      }
      await load();
      setStatus("Other cost deleted.");
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  if (!clientId || clientId <= 0) {
    return <div className="text-sm text-muted-foreground">This job has no linked client.</div>;
  }

  if (mode === "quotes") {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Job Quotes ({quotes.length})</CardTitle>
            <Button size="sm" asChild><Link href={jobQuoteCreateHref}>+ Add Quote</Link></Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? <div className="text-sm text-muted-foreground">Loading quotes...</div> : null}
          {quotes.map((q) => (
            <div key={q.quote_id} className="rounded-md border px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium">{q.quote_number || `#${q.quote_id}`}</div>
                  <div className="text-muted-foreground">Status: {q.status || "-"} | Date: {q.quote_date || "-"}</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="font-semibold">{money.format(Number(q.total || 0))} {q.currency_code || ""}</div>
                  <Button size="sm" variant="outline" onClick={() => void convertQuote(q.quote_id)}>Convert</Button>
                  <Button size="sm" variant="outline" asChild><Link href={`/clients/${clientId}/quotes/new?quoteId=${q.quote_id}`}>Open</Link></Button>
                </div>
              </div>
            </div>
          ))}
          {!loading && quotes.length === 0 ? <div className="text-sm text-muted-foreground">No quotes linked to this job number.</div> : null}
          {status ? <div className="text-sm text-muted-foreground">{status}</div> : null}
        </CardContent>
      </Card>
    );
  }

  if (mode === "other-costs") {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Add Other Cost</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Supplier</div>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={otherCostForm.supplier_id}
                  onChange={(e) => {
                    const supplierId = e.target.value;
                    setOtherCostForm((prev) => ({
                      ...prev,
                      supplier_id: supplierId,
                      supplier_item_id: "",
                      item_name: "",
                      description: "",
                      unit: prev.unit,
                      rate: 0,
                      is_vatable: false,
                      vat_rate_pct: 20,
                    }));
                  }}
                >
                  <option value="">Select supplier...</option>
                  {otherCostSuppliers.map((option) => (
                    <option key={option.supplier_id} value={String(option.supplier_id)}>{option.supplier_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Service Item</div>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={otherCostForm.supplier_item_id}
                  onChange={(e) => {
                    const supplierItemId = e.target.value;
                    const selected = filteredSupplierItems.find((item) => String(item.supplier_item_id) === supplierItemId);
                    if (!selected) {
                      setOtherCostForm((prev) => ({ ...prev, supplier_item_id: "", item_name: "", description: "" }));
                      return;
                    }
                    setOtherCostForm((prev) => ({
                      ...prev,
                      supplier_item_id: supplierItemId,
                      cost_type: selected.cost_type || prev.cost_type,
                      item_name: selected.item_name || "",
                      description: selected.description || "",
                      unit: selected.uom || prev.unit,
                      rate: Number(selected.agreed_rate || 0),
                      is_vatable: Boolean(selected.is_vatable),
                      vat_rate_pct: Number(selected.vat_rate_pct || 0),
                    }));
                  }}
                  disabled={!otherCostForm.supplier_id}
                >
                  <option value="">{otherCostForm.supplier_id ? "Select service item..." : "Select supplier first"}</option>
                  {filteredSupplierItems.map((option) => (
                    <option key={option.supplier_item_id} value={String(option.supplier_item_id)}>
                      {option.item_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Type</div>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={otherCostForm.cost_type}
                  onChange={(e) => setOtherCostForm((prev) => ({ ...prev, cost_type: e.target.value }))}
                >
                  {costTypeOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Incurred Date</div>
                <Input
                  type="date"
                  value={otherCostForm.incurred_date}
                  onChange={(e) => setOtherCostForm((prev) => ({ ...prev, incurred_date: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Item Name</div>
                <Input
                  value={otherCostForm.item_name}
                  onChange={(e) => setOtherCostForm((prev) => ({ ...prev, item_name: e.target.value }))}
                  placeholder="Item name"
                />
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Supplier</div>
                <Input
                  value={otherCostForm.supplier}
                  onChange={(e) => setOtherCostForm((prev) => ({ ...prev, supplier: e.target.value }))}
                  placeholder="Supplier or payee"
                />
              </div>
            </div>

            <div>
              <div className="mb-1 text-xs text-muted-foreground">Description</div>
              <Textarea
                rows={3}
                value={otherCostForm.description}
                onChange={(e) => setOtherCostForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="Optional details for this cost"
              />
            </div>

              <div className="grid gap-4 md:grid-cols-4">
              <div>
                <div className="mb-1 text-xs text-muted-foreground">UoM</div>
                <Select value={otherCostForm.unit} onValueChange={(v) => setOtherCostForm((prev) => ({ ...prev, unit: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {uomOptions.map((u) => (
                      <SelectItem key={u} value={u}>{u}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Qty</div>
                <Input
                  type="number"
                  step="0.01"
                  value={String(otherCostForm.qty)}
                  onChange={(e) => setOtherCostForm((prev) => ({ ...prev, qty: Number(e.target.value || 0) }))}
                />
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Rate</div>
                <Input
                  type="number"
                  step="0.01"
                  value={String(otherCostForm.rate)}
                  disabled={Boolean(otherCostForm.supplier_item_id)}
                  onChange={(e) => setOtherCostForm((prev) => ({ ...prev, rate: Number(e.target.value || 0) }))}
                />
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Amount (ex VAT)</div>
                <Input value={money.format(otherCostDraftAmount)} readOnly />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={otherCostForm.is_vatable}
                  disabled={Boolean(otherCostForm.supplier_item_id)}
                  onChange={(e) => setOtherCostForm((prev) => ({ ...prev, is_vatable: e.target.checked }))}
                />
                VATable
              </label>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">VAT %</div>
                <Input
                  type="number"
                  step="0.01"
                  value={String(otherCostForm.vat_rate_pct)}
                  disabled={!otherCostForm.is_vatable || Boolean(otherCostForm.supplier_item_id)}
                  onChange={(e) => setOtherCostForm((prev) => ({ ...prev, vat_rate_pct: Number(e.target.value || 0) }))}
                />
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">VAT Amount</div>
                <Input value={money.format(otherCostDraftVat)} readOnly />
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Total (inc VAT)</div>
                <Input value={money.format(otherCostDraftTotal)} readOnly />
              </div>
            </div>

            <div>
              <div className="mb-1 text-xs text-muted-foreground">Notes</div>
              <Textarea
                rows={2}
                value={otherCostForm.notes}
                onChange={(e) => setOtherCostForm((prev) => ({ ...prev, notes: e.target.value }))}
              />
            </div>

            <div className="flex justify-end">
              <Button onClick={addOtherCost}>Add Other Cost</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Other Costs For This Job ({otherCosts.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? <div className="text-sm text-muted-foreground">Loading other costs...</div> : null}

            <div className="overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                    <tr className="border-b">
                      <th className="p-2 text-left">Date</th>
                      <th className="p-2 text-left">Supplier</th>
                      <th className="p-2 text-left">Type</th>
                      <th className="p-2 text-left">Item</th>
                    <th className="p-2 text-left">UoM</th>
                    <th className="p-2 text-right">Qty</th>
                    <th className="p-2 text-right">Rate</th>
                    <th className="p-2 text-right">Ex VAT</th>
                    <th className="p-2 text-right">VAT</th>
                    <th className="p-2 text-right">Total</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {otherCosts.map((cost) => (
                    <tr key={cost.other_cost_id} className="border-b">
                      <td className="p-2">{cost.incurred_date || "-"}</td>
                      <td className="p-2">{cost.supplier || "-"}</td>
                      <td className="p-2">{cost.cost_type || "-"}</td>
                      <td className="p-2">
                        <div className="font-medium">{cost.item_name}</div>
                        {cost.description ? <div className="text-xs text-muted-foreground">{cost.description}</div> : null}
                      </td>
                      <td className="p-2">{cost.unit || "-"}</td>
                      <td className="p-2 text-right">{Number(cost.qty || 0).toFixed(2)}</td>
                      <td className="p-2 text-right">{money.format(Number(cost.rate || 0))}</td>
                      <td className="p-2 text-right">{money.format(Number(cost.amount_ex_vat || 0))}</td>
                      <td className="p-2 text-right">{money.format(Number(cost.vat_amount || 0))}</td>
                      <td className="p-2 text-right">{money.format(Number(cost.total_inc_vat || 0))}</td>
                      <td className="p-2 text-right">
                        <Button size="sm" variant="outline" onClick={() => void removeOtherCost(cost.other_cost_id)}>
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!loading && otherCosts.length === 0 ? (
              <div className="text-sm text-muted-foreground">No other costs recorded for this job yet.</div>
            ) : null}

            <div className="ml-auto w-full max-w-md space-y-2 text-sm">
              <div className="flex justify-between"><span>Sub-total</span><span>{money.format(otherCostSubtotal)}</span></div>
              <div className="flex justify-between"><span>VAT</span><span>{money.format(otherCostVat)}</span></div>
              <div className="flex justify-between border-t pt-2 text-base font-semibold"><span>Total</span><span>{money.format(otherCostTotal)}</span></div>
            </div>

            {status ? <div className="text-sm text-muted-foreground">{status}</div> : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (mode === "profit-loss") {
    return (
      <Card>
        <CardHeader><CardTitle>Profit & Loss</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {loading ? <div className="text-sm text-muted-foreground">Loading P&L...</div> : null}
          <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Estimated</div><div className="text-xl font-semibold">{money.format(Number(summary?.quotes.estimated_total || 0))}</div></div>
          <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Invoiced</div><div className="text-xl font-semibold">{money.format(Number(summary?.invoices.invoiced_total || 0))}</div></div>
          <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Paid</div><div className="text-xl font-semibold">{money.format(Number(summary?.invoices.paid_total || 0))}</div></div>
          <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Outstanding</div><div className="text-xl font-semibold">{money.format(Number(summary?.invoices.outstanding_total || 0))}</div></div>
          <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Actual Cost</div><div className="text-xl font-semibold">{money.format(Number(summary?.analysis.actual_cost_from_time || 0))}</div></div>
          <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Other Costs</div><div className="text-xl font-semibold">{money.format(Number(summary?.other_costs?.total || 0))}</div></div>
          <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Total Cost (Time + Other)</div><div className="text-xl font-semibold">{money.format(Number(summary?.analysis.actual_cost_total || Number(summary?.analysis.actual_cost_from_time || 0) + Number(summary?.other_costs?.total || 0)))}</div></div>
          <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Gross Profit</div><div className="text-xl font-semibold">{money.format(Number(summary?.invoices.paid_total || 0) - Number(summary?.analysis.actual_cost_from_time || 0))}</div></div>
          <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Gross Profit After Other Costs</div><div className="text-xl font-semibold">{money.format(Number(summary?.analysis.gross_profit_after_costs ?? (Number(summary?.invoices.paid_total || 0) - (Number(summary?.analysis.actual_cost_from_time || 0) + Number(summary?.other_costs?.total || 0)))) )}</div></div>
          <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Variance</div><div className="text-xl font-semibold">{money.format(Number(summary?.analysis.variance_amount || 0))}</div></div>
          <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Realization %</div><div className="text-xl font-semibold">{Number(summary?.analysis.realization_pct || 0).toFixed(2)}%</div></div>
          <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Logged Hours</div><div className="text-xl font-semibold">{Number(summary?.analysis.logged_hours || 0).toFixed(2)}h</div></div>
          {status ? <div className="text-sm text-muted-foreground md:col-span-3">{status}</div> : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="grid gap-6 md:grid-cols-3">
            <div className="space-y-3">
              <h1 className="text-5xl font-light tracking-wide">INVOICE</h1>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Quote</div>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={selectedQuoteId}
                  onChange={(e) => {
                    const quoteId = e.target.value;
                    setSelectedQuoteId(quoteId);
                    if (quoteId) void loadQuoteLinesToDraft(Number(quoteId));
                  }}
                >
                  <option value="">No quote linked</option>
                  {quotes.map((q) => <option key={q.quote_id} value={String(q.quote_id)}>{q.quote_number || `#${q.quote_id}`}</option>)}
                </select>
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Status</div>
                <Input value={invoiceStatus} onChange={(e) => setInvoiceStatus(e.target.value)} />
              </div>
            </div>

            <div className="space-y-3">
              <div><div className="mb-1 text-xs text-muted-foreground">Invoice Date</div><Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></div>
              <div><div className="mb-1 text-xs text-muted-foreground">Due Date</div><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
              <div><div className="mb-1 text-xs text-muted-foreground">Invoice Total</div><Input value={money.format(invoiceTotal)} readOnly /></div>
              <div className="flex items-end gap-2">
                {selectedQuoteId ? <Button variant="outline" onClick={() => void convertQuote(Number(selectedQuoteId))}>Convert Selected Quote</Button> : null}
              </div>
            </div>

            <CompanyIdentityBlock baseUrl={baseUrl} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Invoice Lines</CardTitle>
            <Button variant="outline" onClick={addLine}>+ Add Line</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-auto rounded-md border">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col style={{ width: "45%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "5%" }} />
              </colgroup>
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="p-2 text-left">Item</th>
                  <th className="p-2 text-left">Unit</th>
                  <th className="p-2 text-left">Qty</th>
                  <th className="p-2 text-left">Rate</th>
                  <th className="p-2 text-left">VAT %</th>
                  <th className="p-2 text-left">Amount</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {invoiceLines.map((line) => (
                  <tr key={line.key} className="border-b">
                    <td className="p-2">
                      <select
                        className="w-full rounded-md border px-2 py-1 text-sm"
                        value={line.item_id != null ? String(line.item_id) : ""}
                        onChange={(e) => onItemChange(line.key, e.target.value)}
                      >
                        <option value="">Select item...</option>
                        {quoteLookupItems.map((item) => (
                          <option key={item.item_id} value={String(item.item_id)}>
                            {item.item_name}
                          </option>
                        ))}
                      </select>
                      <Textarea
                        className="mt-2"
                        rows={3}
                        value={line.description}
                        onChange={(e) => updateLine(line.key, { description: e.target.value })}
                        placeholder="Item description"
                      />
                    </td>
                    <td className="p-2">
                      <Input value={line.unit} onChange={(e) => updateLine(line.key, { unit: e.target.value })} />
                    </td>
                    <td className="p-2">
                      <Input type="number" step="0.01" value={String(line.qty)} onChange={(e) => updateLine(line.key, { qty: Number(e.target.value || 0) })} />
                    </td>
                    <td className="p-2">
                      <Input type="number" step="0.01" value={String(line.rate)} onChange={(e) => updateLine(line.key, { rate: Number(e.target.value || 0) })} />
                    </td>
                    <td className="p-2">
                      <Input type="number" step="0.01" value={String(line.vat_rate_pct)} onChange={(e) => updateLine(line.key, { vat_rate_pct: Number(e.target.value || 0) })} />
                    </td>
                    <td className="p-2">{money.format(lineAmount(line))}</td>
                    <td className="p-2 text-right">
                      <Button variant="outline" size="sm" onClick={() => removeLine(line.key)}>Remove</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ml-auto w-full max-w-md space-y-2 text-sm">
            <div className="flex justify-between"><span>Sub-total</span><span>{money.format(invoiceSubtotal)}</span></div>
            <div className="flex justify-between"><span>VAT</span><span>{money.format(invoiceVat)}</span></div>
            <div className="flex justify-between border-t pt-2 text-base font-semibold"><span>Total</span><span>{money.format(invoiceTotal)}</span></div>
            <CompanyLegalFooter baseUrl={baseUrl} className="pt-3 text-right text-xs text-muted-foreground" />
          </div>
          <div className="flex justify-end">
            <Button onClick={addManualInvoice}>Add Invoice</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Invoices For This Job ({invoices.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {loading ? <div className="text-sm text-muted-foreground">Loading invoices...</div> : null}
          {invoices.map((inv) => (
            <div key={inv.invoice_id} className="rounded-md border px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium">{inv.invoice_number || `#${inv.invoice_id}`}</div>
                  <div className="text-muted-foreground">Status: {inv.status || "-"} | Date: {inv.invoice_date || "-"} | Due: {inv.due_date || "-"}</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="font-semibold">{money.format(Number(inv.total || 0))} {inv.currency_code || ""}</div>
                  <Button size="sm" variant="outline" asChild><Link href={`/clients/${clientId}/invoices/${inv.invoice_id}`}>Open</Link></Button>
                </div>
              </div>
            </div>
          ))}
          {!loading && invoices.length === 0 ? <div className="text-sm text-muted-foreground">No invoices for this job yet.</div> : null}
          {status ? <div className="text-sm text-muted-foreground">{status}</div> : null}
        </CardContent>
      </Card>
    </div>
  );
}
