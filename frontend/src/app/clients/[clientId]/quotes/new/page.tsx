"use client";

import Link from "next/link";
import { Suspense, useMemo, useState, useEffect, type Dispatch, type SetStateAction } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import PageHeader from "@/components/PageHeader";
import ActivityHistoryModal from "@/components/ActivityHistoryModal";
import { CompanyIdentityBlock, CompanyLegalFooter } from "@/components/CompanyIdentityBlock";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import EmailComposerDialog from "@/components/shared/EmailComposerDialog";

function apiBaseUrl(): string {
  return "/api/backend";
}

type LookupClient = {
  client_db_id: number;
  client_name: string;
  headquarters: string;
  currency: string;
  default_bill_to: string;
};

type PaymentTerm = { term_id: number; name: string };
type Currency = { currency_code: string; currency_name: string; symbol: string };
type VatRate = { vat_rate_id: number; name: string; rate_pct: number };
type JobItem = {
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
};
type Contact = {
  contact_id: number | null;
  full_name: string;
  email: string;
  job_title: string;
  is_primary: boolean;
};

type QuoteLine = {
  key: string;
  line_type: "main" | "option";
  item_id: number | null;
  description: string;
  unit: string;
  qty: number;
  rate: number;
  vat_rate_id: number | null;
  vat_rate_pct: number;
};

function newLine(lineType: "main" | "option" = "main"): QuoteLine {
  return {
    key: `${lineType}-${Math.random().toString(36).slice(2)}`,
    line_type: lineType,
    item_id: null,
    description: "",
    unit: "",
    qty: 1,
    rate: 0,
    vat_rate_id: null,
    vat_rate_pct: 20,
  };
}

function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function AddQuotePageContent() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const router = useRouter();
  const params = useParams<{ clientId: string }>();
  const searchParams = useSearchParams();
  const clientId = Number(params?.clientId);
  const requestedQuoteId = Number(searchParams.get("quoteId") || "");
  const prefillJobNumber = String(searchParams.get("jobNumber") || "").trim();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const [quoteId, setQuoteId] = useState<number | null>(null);
  const [quoteStatus, setQuoteStatus] = useState("Draft");

  const [client, setClient] = useState<LookupClient | null>(null);
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerm[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [vatRates, setVatRates] = useState<VatRate[]>([]);
  const [items, setItems] = useState<JobItem[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);

  const [quoteNumber, setQuoteNumber] = useState("");
  const [quoteDate, setQuoteDate] = useState(new Date().toISOString().slice(0, 10));
  const [validTo, setValidTo] = useState(addDaysIso(30));
  const [jobNumber, setJobNumber] = useState("");
  const [currencyCode, setCurrencyCode] = useState("GBP");
  const [paymentTermId, setPaymentTermId] = useState<string>("");
  const [contactId, setContactId] = useState<string>("");
  const [attention, setAttention] = useState("");
  const [billTo, setBillTo] = useState("");
  const [notes, setNotes] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [pdfRefreshKey, setPdfRefreshKey] = useState<number>(Date.now());
  const [mainLines, setMainLines] = useState<QuoteLine[]>([newLine("main")]);
  const [optionLines, setOptionLines] = useState<QuoteLine[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!Number.isFinite(clientId) || clientId <= 0) {
        setError("Invalid client id");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`${baseUrl}/clients/${clientId}/quotes/lookups`);
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          throw new Error(`Failed to load quote setup (${res.status})${t ? `: ${t}` : ""}`);
        }
        const json = await res.json();
        if (cancelled) return;
        setClient(json.client ?? null);
        setPaymentTerms(json.payment_terms ?? []);
        setCurrencies(json.currencies ?? []);
        setVatRates(json.vat_rates ?? []);
        setItems(json.items ?? []);
        setContacts(json.contacts ?? []);

        setCurrencyCode((json.client?.currency || "GBP").toUpperCase());
        setQuoteNumber(String(json.next_quote_number || ""));
        if (Array.isArray(json.payment_terms) && json.payment_terms.length > 0) {
          setPaymentTermId(String(json.payment_terms[0].term_id));
        }
        const defaultContactId = json.default_contact_id != null ? String(json.default_contact_id) : "";
        setContactId(defaultContactId);
        setAttention(String(json.default_attention || ""));
        setBillTo(String(json.client?.default_bill_to || json.client?.headquarters || ""));

        const defaultContact = (json.contacts || []).find((c: Contact) => String(c.contact_id) === defaultContactId);
        if (defaultContact?.email) setEmailTo(defaultContact.email);
        if (!(Number.isFinite(requestedQuoteId) && requestedQuoteId > 0) && prefillJobNumber) {
          setJobNumber(prefillJobNumber);
        }

        if (Number.isFinite(requestedQuoteId) && requestedQuoteId > 0) {
          const existingRes = await fetch(`${baseUrl}/quotes/${requestedQuoteId}`);
          if (!existingRes.ok) {
            const t = await existingRes.text().catch(() => "");
            throw new Error(`Failed to load quote (${existingRes.status})${t ? `: ${t}` : ""}`);
          }
          const existing = await existingRes.json();
          if (cancelled) return;
          setQuoteId(existing.quote_id ?? null);
          setQuoteNumber(String(existing.quote_number || ""));
          setQuoteDate(String(existing.quote_date || new Date().toISOString().slice(0, 10)));
          setValidTo(String(existing.valid_to || addDaysIso(30)));
          setJobNumber(String(existing.job_number || ""));
          setCurrencyCode(String(existing.currency_code || json.client?.currency || "GBP").toUpperCase());
          setPaymentTermId(existing.payment_term_id != null ? String(existing.payment_term_id) : "");
          setContactId(existing.contact_id != null ? String(existing.contact_id) : defaultContactId);
          setAttention(String(existing.attention || json.default_attention || ""));
          setBillTo(String(existing.bill_to || json.client?.default_bill_to || json.client?.headquarters || ""));
          setNotes(String(existing.notes || ""));
          setQuoteStatus(String(existing.status || "Draft"));

          const existingLines = Array.isArray(existing.lines) ? existing.lines : [];
          const mappedMain = existingLines
            .filter((l: { line_type?: string }) => (l.line_type || "main") !== "option")
            .map((l: { item_id?: number; description?: string; unit?: string; qty?: number; rate?: number; vat_rate_id?: number; vat_rate_pct?: number }) => ({
              key: newLine("main").key,
              line_type: "main" as const,
              item_id: l.item_id ?? null,
              description: String(l.description || ""),
              unit: String(l.unit || ""),
              qty: Number(l.qty || 0),
              rate: Number(l.rate || 0),
              vat_rate_id: l.vat_rate_id ?? null,
              vat_rate_pct: Number(l.vat_rate_pct || 0),
            }));
          const mappedOptions = existingLines
            .filter((l: { line_type?: string }) => (l.line_type || "main") === "option")
            .map((l: { item_id?: number; description?: string; unit?: string; qty?: number; rate?: number; vat_rate_id?: number; vat_rate_pct?: number }) => ({
              key: newLine("option").key,
              line_type: "option" as const,
              item_id: l.item_id ?? null,
              description: String(l.description || ""),
              unit: String(l.unit || ""),
              qty: Number(l.qty || 0),
              rate: Number(l.rate || 0),
              vat_rate_id: l.vat_rate_id ?? null,
              vat_rate_pct: Number(l.vat_rate_pct || 0),
            }));
          setMainLines(mappedMain.length > 0 ? mappedMain : [newLine("main")]);
          setOptionLines(mappedOptions);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, clientId, requestedQuoteId, prefillJobNumber]);

  const itemById = useMemo(() => {
    const map = new Map<number, JobItem>();
    items.forEach((it) => map.set(it.item_id, it));
    return map;
  }, [items]);

  const vatById = useMemo(() => {
    const map = new Map<number, VatRate>();
    vatRates.forEach((v) => map.set(v.vat_rate_id, v));
    return map;
  }, [vatRates]);

  const currencySymbol = useMemo(() => {
    const c = currencies.find((x) => x.currency_code === currencyCode);
    return c?.symbol || currencyCode;
  }, [currencies, currencyCode]);

  const fmt = useMemo(
    () =>
      new Intl.NumberFormat("en-GB", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    []
  );

  function formatMoney(n: number): string {
    return `${currencySymbol} ${fmt.format(n || 0)}`;
  }

  function updateLine(
    lines: QuoteLine[],
    setLines: Dispatch<SetStateAction<QuoteLine[]>>,
    key: string,
    patch: Partial<QuoteLine>
  ) {
    setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function onItemChange(
    lines: QuoteLine[],
    setLines: Dispatch<SetStateAction<QuoteLine[]>>,
    key: string,
    itemIdText: string
  ) {
    const itemId = Number(itemIdText);
    const item = itemById.get(itemId);
    if (!item) return;
    const vatPct = item.vat_rate_id ? vatById.get(item.vat_rate_id)?.rate_pct ?? item.vat_rate : item.vat_rate;
    updateLine(lines, setLines, key, {
      item_id: item.item_id,
      description: item.description || item.item_name,
      unit: item.unit || "",
      rate: Number(item.sell_amount || 0),
      vat_rate_id: item.vat_rate_id ?? null,
      vat_rate_pct: Number(vatPct || 0),
    });
  }

  function lineAmount(l: QuoteLine): number {
    return Number((l.qty || 0) * (l.rate || 0));
  }

  function normalize2dp(
    lines: QuoteLine[],
    setLines: Dispatch<SetStateAction<QuoteLine[]>>,
    key: string,
    field: "qty" | "rate" | "vat_rate_pct"
  ) {
    const line = lines.find((l) => l.key === key);
    if (!line) return;
    const value = Number(line[field] || 0);
    updateLine(lines, setLines, key, { [field]: Number(value.toFixed(2)) } as Partial<QuoteLine>);
  }

  const subtotal = useMemo(() => mainLines.reduce((acc, l) => acc + lineAmount(l), 0), [mainLines]);
  const vat = useMemo(
    () => mainLines.reduce((acc, l) => acc + lineAmount(l) * ((l.vat_rate_pct || 0) / 100), 0),
    [mainLines]
  );
  const total = subtotal + vat;

  function linePayload(lines: QuoteLine[]) {
    return lines.map((l, idx) => ({
      line_type: l.line_type,
      sort_order: idx + 1,
      item_id: l.item_id,
      description: l.description,
      unit: l.unit,
      qty: Number(l.qty || 0),
      rate: Number(l.rate || 0),
      amount: Number(lineAmount(l)),
      vat_rate_id: l.vat_rate_id,
      vat_rate_pct: Number(l.vat_rate_pct || 0),
      is_selected: true,
    }));
  }

  async function saveDraft() {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const payload = {
        quote_number: quoteNumber || undefined,
        quote_date: quoteDate,
        valid_to: validTo || undefined,
        job_number: jobNumber || "",
        currency_code: currencyCode || "GBP",
        payment_term_id: paymentTermId ? Number(paymentTermId) : undefined,
        contact_id: contactId ? Number(contactId) : undefined,
        attention: attention || "",
        bill_to: billTo || "",
        notes: notes || "",
        status: "Draft",
        lines: [...linePayload(mainLines), ...linePayload(optionLines.map((l) => ({ ...l, line_type: "option" })))],
      };

      const res = quoteId
        ? await fetch(`${baseUrl}/quotes/${quoteId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`${baseUrl}/clients/${clientId}/quotes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to save draft (${res.status})${t ? `: ${t}` : ""}`);
      }
      const saved = await res.json();
      setQuoteId(saved.quote_id);
      setQuoteNumber(saved.quote_number || quoteNumber);
      setQuoteStatus(saved.status || "Draft");
      setStatus(`Draft saved (${saved.quote_number || `#${saved.quote_id}`}).`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function approveQuote() {
    if (!quoteId) {
      setError("Save draft first before approving.");
      return;
    }
    setStatusBusy(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/quotes/${quoteId}/approve`, { method: "POST" });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to approve quote (${res.status})${t ? `: ${t}` : ""}`);
      }
      const q = await res.json();
      setQuoteStatus(q.status || "Approved");
      setStatus("Quote approved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStatusBusy(false);
    }
  }

  async function reviseQuote() {
    if (!quoteId) {
      setError("Save draft first before revising.");
      return;
    }
    setStatusBusy(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/quotes/${quoteId}/revise`, { method: "POST" });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to revise quote (${res.status})${t ? `: ${t}` : ""}`);
      }
      const q = await res.json();
      setQuoteId(q.quote_id);
      setQuoteNumber(q.quote_number || "");
      setQuoteStatus(q.status || "Draft");
      setStatus(`Revised quote created (${q.quote_number}).`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStatusBusy(false);
    }
  }

  async function acceptQuote(): Promise<boolean> {
    if (!quoteId) {
      setError("Save draft first before accepting.");
      return false;
    }
    setStatusBusy(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/quotes/${quoteId}/accept`, { method: "POST" });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to accept quote (${res.status})${t ? `: ${t}` : ""}`);
      }
      const q = await res.json();
      setQuoteStatus(q.status || "Accepted");
      setStatus("Quote accepted.");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setStatusBusy(false);
    }
  }

  async function acceptAndCreateJob() {
    const ok = await acceptQuote();
    if (!ok || !quoteId) return;
    router.push(`/jobs/new?clientId=${clientId}&fromQuoteId=${quoteId}`);
  }

  function openEmailDialog() {
    if (!quoteId) {
      setError("Save draft first before emailing.");
      return;
    }
    setError("");
    setStatus("");
    setShowEmailDialog(true);
  }

  function onContactChange(v: string) {
    setContactId(v);
    const c = contacts.find((x) => String(x.contact_id) === v);
    if (c) {
      setAttention(c.full_name || "");
      if (c.email) setEmailTo(c.email);
    }
  }

  function renderLinesTable(
    title: string,
    lines: QuoteLine[],
    setLines: Dispatch<SetStateAction<QuoteLine[]>>,
    lineType: "main" | "option"
  ) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{title}</CardTitle>
            <Button variant="outline" onClick={() => setLines((prev) => [...prev, newLine(lineType)])}>
              + Add Line
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col style={{ width: "45%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "10%" }} />
              </colgroup>
              <thead>
                <tr className="border-b">
                  <th className="p-2 text-left">Item</th>
                  <th className="p-2 text-left">Qty</th>
                  <th className="p-2 text-left">Rate</th>
                  <th className="p-2 text-left">VAT %</th>
                  <th className="p-2 text-left">Amount</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key} className="border-b">
                    <td className="p-2 align-top">
                      <Select value={l.item_id ? String(l.item_id) : ""} onValueChange={(v) => onItemChange(lines, setLines, l.key, v)}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select item..." />
                        </SelectTrigger>
                        <SelectContent>
                          {items.map((it) => (
                            <SelectItem key={it.item_id} value={String(it.item_id)}>
                              {it.item_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Textarea
                        className="mt-2"
                        value={l.description}
                        onChange={(e) => updateLine(lines, setLines, l.key, { description: e.target.value })}
                        placeholder="Item description"
                        rows={3}
                      />
                    </td>
                    <td className="p-2 align-top">
                      <Input
                        type="number"
                        step="0.01"
                        value={String(l.qty)}
                        onChange={(e) => updateLine(lines, setLines, l.key, { qty: Number(e.target.value || 0) })}
                        onBlur={() => normalize2dp(lines, setLines, l.key, "qty")}
                      />
                    </td>
                    <td className="p-2 align-top">
                      <Input
                        type="number"
                        step="0.01"
                        value={String(l.rate)}
                        onChange={(e) => updateLine(lines, setLines, l.key, { rate: Number(e.target.value || 0) })}
                        onBlur={() => normalize2dp(lines, setLines, l.key, "rate")}
                      />
                    </td>
                    <td className="p-2 align-top">
                      <Input
                        type="number"
                        step="0.01"
                        value={String(l.vat_rate_pct)}
                        onChange={(e) => updateLine(lines, setLines, l.key, { vat_rate_pct: Number(e.target.value || 0) })}
                        onBlur={() => normalize2dp(lines, setLines, l.key, "vat_rate_pct")}
                      />
                    </td>
                    <td className="p-2 align-top">{formatMoney(lineAmount(l))}</td>
                    <td className="p-2 align-top">
                      <Button variant="outline" onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}>
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr>
                    <td className="p-3 text-muted-foreground" colSpan={6}>
                      No lines added.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <PageHeader
          title="Add Quote"
          subtitle={client?.client_name ? `Client: ${client.client_name}` : "Create client quote"}
          breadcrumbs={[
            { label: "Clients", href: "/clients" },
            { label: client?.client_name ?? "Client", href: `/clients/${clientId}` },
            { label: "Add Quote" },
          ]}
          actions={
            <div className="flex gap-2">
              {quoteId ? <ActivityHistoryModal url={`/quotes/${quoteId}/history`} baseUrl={baseUrl} label="History" /> : null}
              <Button variant="outline" asChild>
                <Link href={`/clients/${clientId}/quotes`}>Quotes List</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href={`/clients/${clientId}`}>Back to Client</Link>
              </Button>
            </div>
          }
        />

        {loading ? <div className="mb-4 text-sm text-muted-foreground">Loading quote setup...</div> : null}
        {error ? <div className="mb-4 text-sm text-destructive">{error}</div> : null}
        {status ? <div className="mb-4 text-sm text-green-700">{status}</div> : null}

        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="grid gap-6 md:grid-cols-3">
              <div className="space-y-3">
                <h1 className="text-5xl font-light tracking-wide">QUOTE</h1>
                <div>
                  <Label>Attention</Label>
                  <Select value={contactId || "__none__"} onValueChange={(v) => onContactChange(v === "__none__" ? "" : v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select contact..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No contact selected</SelectItem>
                      {contacts.map((c) => (
                        <SelectItem key={String(c.contact_id)} value={String(c.contact_id)}>
                          {c.full_name} {c.is_primary ? "(Primary)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Bill To</Label>
                  <Textarea rows={6} value={billTo} onChange={(e) => setBillTo(e.target.value)} />
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <Label>Date</Label>
                  <Input type="date" value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} />
                </div>
                <div>
                  <Label>Quote Number</Label>
                  <Input value={quoteNumber} onChange={(e) => setQuoteNumber(e.target.value)} placeholder="Q001000/1" />
                </div>
                <div>
                  <Label>Job Number</Label>
                  <Input value={jobNumber} onChange={(e) => setJobNumber(e.target.value)} />
                </div>
                <div>
                  <Label>Valid To (default +30 days)</Label>
                  <Input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
                </div>
                <div>
                  <Label>Currency</Label>
                  <Select value={currencyCode} onValueChange={setCurrencyCode}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select currency..." />
                    </SelectTrigger>
                    <SelectContent>
                      {currencies.map((c) => (
                        <SelectItem key={c.currency_code} value={c.currency_code}>
                          {c.currency_code} {c.symbol ? `(${c.symbol})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Status</Label>
                  <Input value={quoteStatus} readOnly />
                </div>
              </div>

              <CompanyIdentityBlock baseUrl={baseUrl} />
            </div>
          </CardContent>
        </Card>

        {renderLinesTable("Quote Lines", mainLines, setMainLines, "main")}

        <Card className="my-6">
          <CardContent className="pt-6">
            <div className="ml-auto w-full max-w-md space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Sub-total</span>
                <span>{formatMoney(subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>VAT</span>
                <span>{formatMoney(vat)}</span>
              </div>
              <div className="flex justify-between border-t pt-2 text-base font-semibold">
                <span>Total</span>
                <span>{formatMoney(total)}</span>
              </div>
              <CompanyLegalFooter baseUrl={baseUrl} className="pt-3 text-right text-xs text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        {renderLinesTable("Options", optionLines, setOptionLines, "option")}

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Payment Terms and Notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Payment Terms</Label>
              <Select value={paymentTermId} onValueChange={setPaymentTermId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select payment term..." />
                </SelectTrigger>
                <SelectContent>
                  {paymentTerms.map((t) => (
                    <SelectItem key={t.term_id} value={String(t.term_id)}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div>
              <Label>Email To</Label>
              <Input value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="client@example.com" />
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button onClick={saveDraft} disabled={saving || loading || statusBusy}>
                {saving ? "Saving..." : "Save Draft"}
              </Button>
              <Button variant="outline" onClick={approveQuote} disabled={!quoteId || saving || statusBusy}>
                Approve
              </Button>
              <Button variant="outline" onClick={reviseQuote} disabled={!quoteId || saving || statusBusy}>
                Revise
              </Button>
              <Button variant="outline" onClick={openEmailDialog} disabled={!quoteId || saving || statusBusy}>
                Email PDF
              </Button>
              <Button
                variant="outline"
                onClick={acceptQuote}
                disabled={!quoteId || saving || statusBusy || quoteStatus === "Accepted"}
              >
                Accept
              </Button>
              <Button onClick={acceptAndCreateJob} disabled={!quoteId || saving || statusBusy}>
                Accept &amp; Create Job
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>PDF Preview</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setPdfRefreshKey(Date.now())} disabled={!quoteId}>
                  Refresh PDF
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {!quoteId ? (
              <div className="text-sm text-muted-foreground">Save draft to generate PDF preview.</div>
            ) : (
              <div className="h-[760px] overflow-hidden rounded-md border">
                <iframe
                  title="Quote PDF Preview"
                  src={`${baseUrl}/quotes/${quoteId}/pdf?ts=${pdfRefreshKey}`}
                  className="h-full w-full"
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <EmailComposerDialog
        open={showEmailDialog}
        onClose={() => setShowEmailDialog(false)}
        baseUrl={baseUrl}
        kind="quote"
        id={quoteId}
        clientId={clientId}
        defaultTo={emailTo}
        onSent={() => {
          setQuoteStatus("Sent");
          setStatus("Quote PDF emailed.");
        }}
      />
    </div>
  );
}

export default function AddQuotePage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-7xl p-6 text-sm text-muted-foreground">Loading...</div>}>
      <AddQuotePageContent />
    </Suspense>
  );
}
