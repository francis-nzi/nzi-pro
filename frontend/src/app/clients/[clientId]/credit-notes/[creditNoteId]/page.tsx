"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import PageHeader from "@/components/PageHeader";
import ActivityHistoryModal from "@/components/ActivityHistoryModal";
import { CompanyIdentityBlock, CompanyLegalFooter } from "@/components/CompanyIdentityBlock";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

function apiBaseUrl(): string {
  return "/api/backend";
}

type LookupItem = {
  item_id: number;
  item_name: string;
  description: string;
  unit: string;
  sell_amount: number;
  vat_rate_id: number | null;
  vat_rate: number;
  category: string;
};

type LookupVatRate = {
  vat_rate_id: number;
  rate_pct: number;
};

type LookupContact = {
  contact_id: number;
  full_name: string;
  email: string;
  job_title?: string;
};

type TeamMember = {
  full_name: string | null;
  email?: string | null;
  status?: string | null;
};

type ClientJob = {
  job_id: number;
  job_number: string | null;
  title: string | null;
};

type CreditNoteLine = {
  key: string;
  credit_note_line_id?: number;
  item_id: number | null;
  description: string;
  unit: string;
  qty: number;
  rate: number;
  vat_rate_id: number | null;
  vat_rate_pct: number;
  notes: string;
};

type XeroCreditNoteInfo = {
  xero_credit_note_id: string;
  xero_credit_note_number: string;
  xero_status: string;
  xero_sync_status: string;
  xero_synced_at: string | null;
  xero_sync_error: string;
};

const moneyFmt = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function newLine(): CreditNoteLine {
  return {
    key: `line-${Math.random().toString(36).slice(2)}`,
    item_id: null,
    description: "",
    unit: "",
    qty: 1,
    rate: 0,
    vat_rate_id: null,
    vat_rate_pct: 20,
    notes: "",
  };
}

export default function CreditNoteDetailPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const confirmAction = useConfirmDialog();
  const params = useParams<{ clientId: string; creditNoteId: string }>();
  const router = useRouter();
  const clientId = Number(params?.clientId);
  const creditNoteId = Number(params?.creditNoteId);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [pdfRefreshKey, setPdfRefreshKey] = useState<number>(Date.now());

  const [clientName, setClientName] = useState("");
  const [creditNoteNumber, setCreditNoteNumber] = useState("");
  const [creditNoteDate, setCreditNoteDate] = useState("");
  const [statusValue, setStatusValue] = useState("Draft");
  const [notes, setNotes] = useState("");
  const [jobId, setJobId] = useState<string>("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [currencyCode, setCurrencyCode] = useState("GBP");
  const [lines, setLines] = useState<CreditNoteLine[]>([newLine()]);
  const [xeroInfo, setXeroInfo] = useState<XeroCreditNoteInfo | null>(null);

  const [items, setItems] = useState<LookupItem[]>([]);
  const [vatRates, setVatRates] = useState<LookupVatRate[]>([]);
  const [contacts, setContacts] = useState<LookupContact[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [jobs, setJobs] = useState<ClientJob[]>([]);
  const [emailCc, setEmailCc] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!Number.isFinite(clientId) || !Number.isFinite(creditNoteId) || clientId <= 0 || creditNoteId <= 0) {
        setError("Invalid client or credit note id");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const [cnRes, lookupsRes, teamRes, jobsRes] = await Promise.all([
          fetch(`${baseUrl}/credit-notes/${creditNoteId}`, { credentials: "include" }),
          fetch(`${baseUrl}/clients/${clientId}/quotes/lookups`, { credentials: "include" }),
          fetch(`${baseUrl}/admin/users`, { credentials: "include" }),
          fetch(`${baseUrl}/clients/${clientId}/jobs?limit=200&offset=0`, { credentials: "include" }),
        ]);
        if (!cnRes.ok) {
          const t = await cnRes.text().catch(() => "");
          throw new Error(`Failed to load credit note (${cnRes.status})${t ? `: ${t}` : ""}`);
        }
        if (!lookupsRes.ok) {
          const t = await lookupsRes.text().catch(() => "");
          throw new Error(`Failed to load lookups (${lookupsRes.status})${t ? `: ${t}` : ""}`);
        }
        const cn = await cnRes.json();
        const lookups = await lookupsRes.json();
        const teamJson = teamRes.ok ? await teamRes.json() : { items: [] };
        const jobsJson = jobsRes.ok ? await jobsRes.json() : { items: [] };
        if (cancelled) return;

        const members = (Array.isArray(teamJson.items) ? teamJson.items : []) as TeamMember[];
        setTeamMembers(members.filter((m) => String(m.status || "").toLowerCase() === "active" && m.email));
        setJobs(Array.isArray(jobsJson.items) ? jobsJson.items : []);

        setClientName(String(cn.client_name || ""));
        setCreditNoteNumber(String(cn.credit_note_number || ""));
        setCreditNoteDate(String(cn.credit_note_date || new Date().toISOString().slice(0, 10)));
        setStatusValue(String(cn.status || "Draft"));
        setNotes(String(cn.notes || ""));
        setJobId(cn.job_id != null ? String(cn.job_id) : "");
        setInvoiceNumber(String(cn.invoice_number || ""));
        setCurrencyCode(String(cn.currency_code || "GBP").toUpperCase());
        setXeroInfo({
          xero_credit_note_id: String(cn.xero_credit_note_id || ""),
          xero_credit_note_number: String(cn.xero_credit_note_number || ""),
          xero_status: String(cn.xero_status || ""),
          xero_sync_status: String(cn.xero_sync_status || "pending"),
          xero_synced_at: cn.xero_synced_at || null,
          xero_sync_error: String(cn.xero_sync_error || ""),
        });
        setItems(Array.isArray(lookups.items) ? lookups.items : []);
        setVatRates(Array.isArray(lookups.vat_rates) ? lookups.vat_rates : []);
        setContacts(Array.isArray(lookups.contacts) ? lookups.contacts : []);

        const cnLines = Array.isArray(cn.lines) ? cn.lines : [];
        setLines(
          cnLines.length > 0
            ? cnLines.map((l: { credit_note_line_id?: number; item_id?: number; description?: string; unit?: string; qty?: number; rate?: number; vat_rate_id?: number; vat_rate_pct?: number; notes?: string }) => ({
                key: `line-${Math.random().toString(36).slice(2)}`,
                credit_note_line_id: l.credit_note_line_id,
                item_id: l.item_id ?? null,
                description: String(l.description || ""),
                unit: String(l.unit || ""),
                qty: Number(l.qty || 0),
                rate: Number(l.rate || 0),
                vat_rate_id: l.vat_rate_id ?? null,
                vat_rate_pct: Number(l.vat_rate_pct || 0),
                notes: String(l.notes || ""),
              }))
            : [newLine()]
        );
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
  }, [baseUrl, clientId, creditNoteId]);

  const vatById = useMemo(() => {
    const map = new Map<number, number>();
    vatRates.forEach((v) => map.set(v.vat_rate_id, Number(v.rate_pct || 0)));
    return map;
  }, [vatRates]);

  function lineAmount(line: CreditNoteLine): number {
    return Number((line.qty || 0) * (line.rate || 0));
  }
  const subtotal = lines.reduce((acc, line) => acc + lineAmount(line), 0);
  const vat = lines.reduce((acc, line) => acc + lineAmount(line) * ((line.vat_rate_pct || 0) / 100), 0);
  const total = subtotal + vat;
  const xeroLinked = Boolean(xeroInfo?.xero_credit_note_id);
  const xeroSyncStatus = (xeroInfo?.xero_sync_status || "pending").toLowerCase();
  const xeroBadgeVariant =
    xeroLinked && xeroSyncStatus === "synced"
      ? "default"
      : xeroLinked && xeroSyncStatus === "failed"
        ? "destructive"
        : "secondary";
  const xeroBadgeLabel = xeroLinked
    ? `${xeroInfo?.xero_credit_note_number || `Xero ${xeroInfo?.xero_credit_note_id}`}`
    : "Not synced to Xero";
  const xeroHeaderLabel = xeroLinked
    ? xeroSyncStatus === "synced"
      ? "Xero Synced"
      : xeroSyncStatus === "failed"
        ? "Xero Sync Failed"
        : "Xero Linked"
    : "Xero Not Synced";

  function updateLine(key: string, patch: Partial<CreditNoteLine>) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function onItemChange(key: string, itemIdText: string) {
    const itemId = Number(itemIdText);
    const item = items.find((it) => it.item_id === itemId);
    if (!item) return;
    const vatPct = item.vat_rate_id ? (vatById.get(item.vat_rate_id) ?? Number(item.vat_rate || 0)) : Number(item.vat_rate || 0);
    updateLine(key, {
      item_id: item.item_id,
      description: item.description || item.item_name,
      unit: item.unit || "",
      rate: Number(item.sell_amount || 0),
      vat_rate_id: item.vat_rate_id ?? null,
      vat_rate_pct: vatPct,
    });
  }

  async function saveCreditNote() {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      if (!jobId) throw new Error("Job is required");
      const payload = {
        job_id: Number(jobId),
        credit_note_number: creditNoteNumber,
        credit_note_date: creditNoteDate || null,
        currency_code: currencyCode,
        status: statusValue,
        notes,
        lines: lines.map((line, idx) => ({
          sort_order: idx + 1,
          item_id: line.item_id,
          description: line.description,
          unit: line.unit,
          qty: Number(line.qty || 0),
          rate: Number(line.rate || 0),
          amount: Number(lineAmount(line)),
          vat_rate_id: line.vat_rate_id,
          vat_rate_pct: Number(line.vat_rate_pct || 0),
          notes: line.notes || "",
        })),
      };
      const res = await fetch(`${baseUrl}/credit-notes/${creditNoteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to save credit note (${res.status})${t ? `: ${t}` : ""}`);
      }
      setStatus("Credit note saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteCreditNote() {
    const confirmed = await confirmAction({
      title: "Delete credit note?",
      description: "This credit note will be permanently removed from the client financial records.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/credit-notes/${creditNoteId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to delete credit note (${res.status})${t ? `: ${t}` : ""}`);
      }
      router.push(`/clients/${clientId}?section=financial`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function emailCreditNotePdf() {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      if (!emailTo.trim()) throw new Error("Recipient email is required");
      const res = await fetch(`${baseUrl}/credit-notes/${creditNoteId}/email-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          to: emailTo.trim(),
          cc: emailCc.trim(),
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to email credit note PDF (${res.status})${t ? `: ${t}` : ""}`);
      }
      if (statusValue.toLowerCase() === "draft") setStatusValue("Sent");
      setStatus("Credit note PDF emailed.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function syncToXero() {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/xero/credit-notes/${creditNoteId}/sync`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to sync credit note to Xero (${res.status})${t ? `: ${t}` : ""}`);
      }
      const payload = await res.json() as {
        credit_note?: {
          xero_credit_note_id?: string | null;
          xero_credit_note_number?: string | null;
          xero_status?: string | null;
          xero_sync_status?: string | null;
          xero_sync_error?: string | null;
        };
      };
      const cn = payload.credit_note;
      if (cn) {
        setXeroInfo({
          xero_credit_note_id: String(cn.xero_credit_note_id || ""),
          xero_credit_note_number: String(cn.xero_credit_note_number || ""),
          xero_status: String(cn.xero_status || ""),
          xero_sync_status: String(cn.xero_sync_status || "pending"),
          xero_synced_at: new Date().toISOString(),
          xero_sync_error: String(cn.xero_sync_error || ""),
        });
        // Xero assigns the real credit note number on first sync -- pick that up
        // locally so the two systems show the same number going forward.
        if (cn.xero_credit_note_number) setCreditNoteNumber(cn.xero_credit_note_number);
      }
      setStatus("Credit note synced to Xero.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <PageHeader
          title="Credit Note"
          subtitle={creditNoteNumber || `Credit Note #${creditNoteId}`}
          breadcrumbs={[
            { label: "Clients", href: "/clients" },
            { label: clientName || `Client ${clientId}`, href: `/clients/${clientId}` },
            { label: "Financial", href: `/clients/${clientId}?section=financial` },
            { label: "Credit Note" },
          ]}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={xeroBadgeVariant as "default" | "secondary" | "destructive" | "outline"}>
                {xeroHeaderLabel}
              </Badge>
              <Badge variant={xeroBadgeVariant as "default" | "secondary" | "destructive" | "outline"}>{xeroBadgeLabel}</Badge>
              <ActivityHistoryModal url={`/credit-notes/${creditNoteId}/history`} baseUrl={baseUrl} label="History" />
              <Button variant="outline" asChild>
                <Link href={`/clients/${clientId}?section=financial`}>Back to Financial</Link>
              </Button>
            </div>
          }
        />

        {loading ? <div className="mb-4 text-sm text-muted-foreground">Loading credit note...</div> : null}
        {error ? <div className="mb-4 text-sm text-destructive">{error}</div> : null}
        {status ? <div className="mb-4 text-sm text-green-700">{status}</div> : null}

        {xeroInfo ? (
          <div className="mb-4 rounded-md border bg-muted/30 px-4 py-3 text-sm">
            <div className="font-medium">Xero status</div>
            <div className="mt-1 text-muted-foreground">
              {xeroLinked
                ? `Linked to Xero credit note ${xeroInfo.xero_credit_note_number || xeroInfo.xero_credit_note_id} with sync status ${xeroInfo.xero_sync_status || "pending"}.`
                : "This credit note has not been synced to Xero yet."}
            </div>
            {xeroInfo.xero_status ? (
              <div className="mt-1 text-muted-foreground">Xero record status: {xeroInfo.xero_status}</div>
            ) : null}
            {xeroInfo.xero_synced_at ? (
              <div className="mt-1 text-muted-foreground">
                Last synced: {new Date(xeroInfo.xero_synced_at).toLocaleString("en-GB")}
              </div>
            ) : null}
            {xeroInfo.xero_sync_error ? (
              <div className="mt-1 text-destructive">Last error: {xeroInfo.xero_sync_error}</div>
            ) : null}
          </div>
        ) : null}

        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="grid gap-6 md:grid-cols-3">
              <div className="space-y-3">
                <h1 className="text-5xl font-light tracking-wide">CREDIT NOTE</h1>
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">Job</div>
                  <select className="w-full rounded-md border px-3 py-2 text-sm" value={jobId} onChange={(e) => setJobId(e.target.value)}>
                    <option value="">Select job...</option>
                    {jobs.map((j) => (
                      <option key={j.job_id} value={String(j.job_id)}>
                        {j.job_number || `Job ${j.job_id}`}{j.title ? ` — ${j.title}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                {invoiceNumber ? (
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">Related Invoice</div>
                    <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">{invoiceNumber}</div>
                  </div>
                ) : null}
              </div>

              <div className="space-y-3">
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">Date</div>
                  <Input type="date" value={creditNoteDate} onChange={(e) => setCreditNoteDate(e.target.value)} />
                </div>
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">Credit Note Number</div>
                  <Input value={creditNoteNumber} onChange={(e) => setCreditNoteNumber(e.target.value)} />
                </div>
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">Currency</div>
                  <Input value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())} />
                </div>
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">Status</div>
                  <select className="w-full rounded-md border px-3 py-2 text-sm" value={statusValue} onChange={(e) => setStatusValue(e.target.value)}>
                    {["Draft", "Sent", "Approved", "Void"].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>

              <CompanyIdentityBlock baseUrl={baseUrl} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Credit Note Lines</CardTitle>
              <Button variant="outline" onClick={() => setLines((prev) => [...prev, newLine()])}>+ Add Line</Button>
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
                  {lines.map((line) => (
                    <tr key={line.key} className="border-b">
                      <td className="p-2">
                        <select
                          className="w-full rounded-md border px-2 py-1 text-sm"
                          value={line.item_id != null ? String(line.item_id) : ""}
                          onChange={(e) => onItemChange(line.key, e.target.value)}
                        >
                          <option value="">Select item...</option>
                          {items.map((item) => (
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
                      <td className="p-2">{moneyFmt.format(lineAmount(line))}</td>
                      <td className="p-2 text-right">
                        <Button variant="outline" size="sm" onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}>Remove</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ml-auto w-full max-w-md space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Sub-total</span>
                <span>{moneyFmt.format(subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>VAT</span>
                <span>{moneyFmt.format(vat)}</span>
              </div>
              <div className="flex justify-between border-t pt-2 text-base font-semibold">
                <span>Total</span>
                <span>{moneyFmt.format(total)}</span>
              </div>
              <CompanyLegalFooter baseUrl={baseUrl} className="pt-3 text-right text-xs text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader><CardTitle>Notes and Actions</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Notes</div>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Email To</div>
                <Input
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  placeholder="client@example.com"
                  list="credit-note-email-recipients"
                />
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">CC <span className="font-normal">(comma-separated, optional)</span></div>
                <Input
                  value={emailCc}
                  onChange={(e) => setEmailCc(e.target.value)}
                  placeholder="colleague@netzero.international"
                  list="credit-note-email-recipients"
                />
              </div>
              <datalist id="credit-note-email-recipients">
                {contacts.filter((c) => c.email).map((c) => (
                  <option key={`contact-${c.contact_id}`} value={c.email}>
                    {c.full_name}{c.job_title ? ` (${c.job_title})` : ""} — Client contact
                  </option>
                ))}
                {teamMembers.filter((m) => m.email).map((m) => (
                  <option key={`team-${m.email}`} value={m.email as string}>
                    {m.full_name} — NZI
                  </option>
                ))}
              </datalist>
            </div>
            <div className="flex justify-end gap-2">
              <Button onClick={saveCreditNote} disabled={saving}>{saving ? "Saving..." : "Save Credit Note"}</Button>
              <Button variant="outline" onClick={emailCreditNotePdf} disabled={saving}>Email PDF</Button>
              <Button variant="outline" onClick={syncToXero} disabled={saving}>
                {xeroInfo?.xero_credit_note_id ? "Resync to Xero" : "Sync to Xero"}
              </Button>
              <Button variant="destructive" onClick={deleteCreditNote} disabled={saving}>Delete</Button>
            </div>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>PDF Preview</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setPdfRefreshKey(Date.now())}>
                  Refresh PDF
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[760px] overflow-hidden rounded-md border">
              <iframe
                title="Credit Note PDF Preview"
                src={`${baseUrl}/credit-notes/${creditNoteId}/pdf?ts=${pdfRefreshKey}`}
                className="h-full w-full"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
