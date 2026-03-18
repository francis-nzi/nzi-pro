"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import ClientDashboard from "@/components/ClientDashboard";
import ClientCommunications from "@/components/ClientCommunications";
import { CompanyIdentityBlock, CompanyLegalFooter } from "@/components/CompanyIdentityBlock";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";
import ClientReporting from "@/components/ClientReporting";
import CustomFields from "@/components/CustomFields";
import MilestoneBadge from "@/components/MilestoneBadge";
import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { milestoneDotClass } from "@/lib/status-utils";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api/backend";
}

type Client = {
  client_db_id: number;
  client_name: string | null;
  industry: string | null;
  status: string | null;
  website: string | null;
  company_reg: string | null;
  headquarters: string | null;
  crm_owner: string | null;
  net_zero_year: number | null;
  interim_year: number | null;
  interim_s1_pct: number | null;
  interim_s2_pct: number | null;
  interim_s3_pct: number | null;
  benchmark_year: number | null;
  benchmark_period_start: string | null;
  benchmark_period_end: string | null;
  currency: string | null;
};

type ClientJobsResponse = {
  client_db_id: number;
  items: Array<{
    job_id: number;
    job_number: string | null;
    title: string | null;
    reporting_year: number | null;
    status: string | null;
    job_type?: string | null;
    is_crp?: boolean;
    milestone_status?: string | null;
    total_emissions?: number;
  }>;
};

type ClientSitesResponse = {
  client_db_id: number;
  sites: Array<{
    site_name: string | null;
    location: string | null;
    is_registered_office: boolean;
  }>;
};

type ClientContactsResponse = {
  client_db_id: number;
  contacts: Array<{
    contact_id: number;
    full_name: string | null;
    job_title: string | null;
    email: string | null;
    phone: string | null;
    is_primary: boolean;
  }>;
};

type ClientQuotesResponse = {
  client_db_id: number;
  items: Array<{
    quote_id: number;
    quote_number: string | null;
    quote_date: string | null;
    valid_to: string | null;
    currency_code: string | null;
    status: string | null;
    total: number | null;
  }>;
};

type ClientInvoicesResponse = {
  items: Array<{
    invoice_id: number;
    client_db_id: number;
    quote_id: number | null;
    invoice_number: string | null;
    invoice_date: string | null;
    due_date: string | null;
    currency_code: string | null;
    subtotal: number | null;
    vat: number | null;
    total: number | null;
    status: string | null;
    notes: string | null;
    paid_date: string | null;
    amount_paid: number | null;
    line_count?: number;
    lines?: Array<{
      invoice_line_id?: number;
      sort_order?: number;
      item_id?: number | null;
      description: string;
      unit: string;
      qty: number;
      rate: number;
      amount: number;
      vat_rate_id?: number | null;
      vat_rate_pct: number;
      notes?: string;
    }>;
  }>;
};

type ClientFinancialSummary = {
  client_db_id: number;
  quotes: { count: number; estimated_total: number };
  invoices: {
    count: number;
    invoiced_total: number;
    vat_total: number;
    paid_total: number;
    outstanding_total: number;
    overdue_count: number;
  };
  analysis: {
    variance_amount: number;
    realization_pct: number;
    actual_cost_from_time: number;
    logged_hours: number;
    time_cost_variance_vs_estimate: number;
  };
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
};

type ClientSection =
  | "dashboard"
  | "timeline"
  | "details"
  | "contacts"
  | "jobs"
  | "reporting"
  | "custom-fields"
  | "financial";

type FinancialView = "quotes" | "invoices" | "profit-loss";

const SECTIONS: Array<{ id: ClientSection; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "timeline", label: "Communications" },
  { id: "details", label: "Details" },
  { id: "contacts", label: "Contacts" },
  { id: "jobs", label: "Jobs" },
  { id: "reporting", label: "Reporting" },
  { id: "custom-fields", label: "Custom Fields" },
  { id: "financial", label: "Financial" },
];

function ClientDetailPageContent() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const confirmAction = useConfirmDialog();
  const params = useParams<{ clientId: string }>();
  const searchParams = useSearchParams();
  const clientId = Number(params?.clientId);

  const [client, setClient] = useState<Client | null>(null);
  const [jobs, setJobs] = useState<ClientJobsResponse["items"]>([]);
  const [sites, setSites] = useState<ClientSitesResponse["sites"]>([]);
  const [contacts, setContacts] = useState<ClientContactsResponse["contacts"]>([]);
  const [quotes, setQuotes] = useState<ClientQuotesResponse["items"]>([]);
  const [invoices, setInvoices] = useState<ClientInvoicesResponse["items"]>([]);
  const [financialSummary, setFinancialSummary] = useState<ClientFinancialSummary | null>(null);
  const [financialStatus, setFinancialStatus] = useState<string>("");
  const [quoteLookupItems, setQuoteLookupItems] = useState<QuoteLookupItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [activeSection, setActiveSection] = useState<ClientSection>("dashboard");
  const [financialView, setFinancialView] = useState<FinancialView>("quotes");

  const [showAddContact, setShowAddContact] = useState<boolean>(false);
  const [editingContact, setEditingContact] = useState<number | null>(null);
  const [contactForm, setContactForm] = useState({
    full_name: "",
    job_title: "",
    email: "",
    phone: "",
    is_primary: false,
  });
  const [invoiceForm, setInvoiceForm] = useState({
    quote_id: "",
    invoice_date: new Date().toISOString().slice(0, 10),
    due_date: "",
    subtotal: "0.00",
    vat: "0.00",
    total: "0.00",
    status: "Draft",
    notes: "",
    amount_paid: "0.00",
    paid_date: "",
  });
  const [invoiceDraftLines, setInvoiceDraftLines] = useState<
    Array<{
      key: string;
      item_id: number | null;
      description: string;
      unit: string;
      qty: number;
      rate: number;
      vat_rate_pct: number;
      notes: string;
    }>
  >([
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

  async function reloadContacts() {
    const contactsRes = await fetch(`${baseUrl}/clients/${clientId}/contacts`, { credentials: "include" });
    if (contactsRes.ok) {
      const data = (await contactsRes.json()) as ClientContactsResponse;
      setContacts(data.contacts ?? []);
    }
  }

  async function reloadFinancialData() {
    const [quotesRes, invoicesRes, summaryRes, lookupsRes] = await Promise.all([
      fetch(`${baseUrl}/clients/${clientId}/quotes`, { credentials: "include" }),
      fetch(`${baseUrl}/clients/${clientId}/invoices`, { credentials: "include" }),
      fetch(`${baseUrl}/clients/${clientId}/financial/summary`, { credentials: "include" }),
      fetch(`${baseUrl}/clients/${clientId}/quotes/lookups`, { credentials: "include" }),
    ]);
    if (quotesRes.ok) {
      const data = (await quotesRes.json()) as ClientQuotesResponse;
      setQuotes(data.items ?? []);
    }
    if (invoicesRes.ok) {
      const data = (await invoicesRes.json()) as ClientInvoicesResponse;
      setInvoices(data.items ?? []);
    }
    if (summaryRes.ok) {
      const data = (await summaryRes.json()) as ClientFinancialSummary;
      setFinancialSummary(data);
    }
    if (lookupsRes.ok) {
      const data = await lookupsRes.json();
      setQuoteLookupItems(Array.isArray(data.items) ? data.items : []);
    }
  }

  useEffect(() => {
    const section = String(searchParams.get("section") || "").trim().toLowerCase();
    const validSection = SECTIONS.find((s) => s.id === section);
    if (validSection) {
      setActiveSection(validSection.id);
    }
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!Number.isFinite(clientId) || clientId <= 0) {
        setError("Invalid client id");
        return;
      }

      setLoading(true);
      setError("");

      try {
        const [cRes, jRes, sRes, contactsRes, quotesRes, invoicesRes, summaryRes, lookupsRes] = await Promise.all([
          fetch(`${baseUrl}/clients/${clientId}`, { credentials: "include" }),
          fetch(`${baseUrl}/clients/${clientId}/jobs?limit=50&offset=0`, { credentials: "include" }),
          fetch(`${baseUrl}/clients/${clientId}/sites`, { credentials: "include" }),
          fetch(`${baseUrl}/clients/${clientId}/contacts`, { credentials: "include" }),
          fetch(`${baseUrl}/clients/${clientId}/quotes`, { credentials: "include" }),
          fetch(`${baseUrl}/clients/${clientId}/invoices`, { credentials: "include" }),
          fetch(`${baseUrl}/clients/${clientId}/financial/summary`, { credentials: "include" }),
          fetch(`${baseUrl}/clients/${clientId}/quotes/lookups`, { credentials: "include" }),
        ]);

        if (!cRes.ok) {
          const t = await cRes.text().catch(() => "");
          throw new Error(`Failed to load client: ${cRes.status} ${cRes.statusText}${t ? ` - ${t}` : ""}`);
        }

        const cJson = (await cRes.json()) as Client;
        const jJson = jRes.ok ? ((await jRes.json()) as ClientJobsResponse) : null;
        const sJson = sRes.ok ? ((await sRes.json()) as ClientSitesResponse) : null;
        const contactsJson = contactsRes.ok ? ((await contactsRes.json()) as ClientContactsResponse) : null;
        const quotesJson = quotesRes.ok ? ((await quotesRes.json()) as ClientQuotesResponse) : null;
        const invoicesJson = invoicesRes.ok ? ((await invoicesRes.json()) as ClientInvoicesResponse) : null;
        const summaryJson = summaryRes.ok ? ((await summaryRes.json()) as ClientFinancialSummary) : null;
        const lookupsJson = lookupsRes.ok ? await lookupsRes.json() : null;

        if (cancelled) return;

        setClient(cJson);
        setJobs(jJson?.items ?? []);
        setSites((sJson as unknown as { active_sites?: ClientSitesResponse["sites"]; sites?: ClientSitesResponse["sites"] })?.active_sites ?? sJson?.sites ?? []);
        setContacts(contactsJson?.contacts ?? []);
        setQuotes(quotesJson?.items ?? []);
        setInvoices(invoicesJson?.items ?? []);
        setFinancialSummary(summaryJson ?? null);
        setQuoteLookupItems(Array.isArray(lookupsJson?.items) ? lookupsJson.items : []);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        setClient(null);
        setJobs([]);
        setSites([]);
        setContacts([]);
        setQuotes([]);
        setInvoices([]);
        setFinancialSummary(null);
        setQuoteLookupItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, clientId]);

  async function handleAddContact() {
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(contactForm),
      });
      if (!res.ok) throw new Error("Failed to add contact");
      await reloadContacts();
      setContactForm({ full_name: "", job_title: "", email: "", phone: "", is_primary: false });
      setShowAddContact(false);
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function handleEditContact(contactId: number) {
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(contactForm),
      });
      if (!res.ok) throw new Error("Failed to update contact");
      await reloadContacts();
      setContactForm({ full_name: "", job_title: "", email: "", phone: "", is_primary: false });
      setEditingContact(null);
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function handleDeleteContact(contactId: number) {
    const confirmed = await confirmAction({
      title: "Delete contact?",
      description: "This contact will be removed from the client record.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/contacts/${contactId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete contact");
      await reloadContacts();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  function startEditContact(contact: ClientContactsResponse["contacts"][0]) {
    setContactForm({
      full_name: contact.full_name ?? "",
      job_title: contact.job_title ?? "",
      email: contact.email ?? "",
      phone: contact.phone ?? "",
      is_primary: contact.is_primary,
    });
    setEditingContact(contact.contact_id);
    setShowAddContact(false);
  }

  function cancelEdit() {
    setContactForm({ full_name: "", job_title: "", email: "", phone: "", is_primary: false });
    setEditingContact(null);
    setShowAddContact(false);
  }

  function renderDetailsSection() {
    return (
      <div className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div><span className="text-muted-foreground">Industry:</span> {client?.industry ?? ""}</div>
              <div><span className="text-muted-foreground">Status:</span> <StatusBadge status={client?.status} /></div>
              <div><span className="text-muted-foreground">CRM Owner:</span> {client?.crm_owner ?? ""}</div>
              <div><span className="text-muted-foreground">HQ:</span> {client?.headquarters ?? ""}</div>
              <div><span className="text-muted-foreground">Reg:</span> {client?.company_reg ?? ""}</div>
              <div><span className="text-muted-foreground">Website:</span> {client?.website ?? ""}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sites ({sites.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {sites.length === 0 ? (
                <div className="text-sm text-muted-foreground">No sites.</div>
              ) : (
                <div className="space-y-2">
                  {sites.map((s, idx) => (
                    <div key={`${s.site_name ?? "site"}-${idx}`} className="rounded-md border px-3 py-2 text-sm">
                      <div className="font-medium">{s.site_name ?? ""}</div>
                      <div className="text-muted-foreground">
                        {(s.location ?? "") + (s.is_registered_office ? " (Registered Office)" : "")}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Net Zero Targets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div><span className="font-medium">Net Zero Target Year:</span> <span className="text-muted-foreground">{client?.net_zero_year ?? "Not set"}</span></div>
            <div><span className="font-medium">Interim Target Year:</span> <span className="text-muted-foreground">{client?.interim_year ?? "Not set"}</span></div>
            <div className="grid gap-2 md:grid-cols-3">
              <div><span className="font-medium">Scope 1 Target:</span> <span className="text-muted-foreground">{client?.interim_s1_pct != null ? `${client.interim_s1_pct}%` : "Not set"}</span></div>
              <div><span className="font-medium">Scope 2 Target:</span> <span className="text-muted-foreground">{client?.interim_s2_pct != null ? `${client.interim_s2_pct}%` : "Not set"}</span></div>
              <div><span className="font-medium">Scope 3 Target:</span> <span className="text-muted-foreground">{client?.interim_s3_pct != null ? `${client.interim_s3_pct}%` : "Not set"}</span></div>
            </div>
            <div><span className="font-medium">Benchmark Year:</span> <span className="text-muted-foreground">{client?.benchmark_year ?? "Not set"}</span></div>
            <div><span className="font-medium">Benchmark Start:</span> <span className="text-muted-foreground">{client?.benchmark_period_start ? new Date(client.benchmark_period_start).toLocaleDateString("en-GB") : "Not set"}</span></div>
            <div><span className="font-medium">Benchmark End:</span> <span className="text-muted-foreground">{client?.benchmark_period_end ? new Date(client.benchmark_period_end).toLocaleDateString("en-GB") : "Not set"}</span></div>
            <div><span className="font-medium">Currency:</span> <span className="text-muted-foreground">{client?.currency ?? "Not set"}</span></div>
          </CardContent>
        </Card>
      </div>
    );
  }

  function renderContactsSection() {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Contacts ({contacts.length})</CardTitle>
            <Button
              size="sm"
              onClick={() => {
                setShowAddContact(true);
                setEditingContact(null);
                setContactForm({ full_name: "", job_title: "", email: "", phone: "", is_primary: false });
              }}
            >
              + Add Contact
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {showAddContact || editingContact ? (
            <div className="mb-4 space-y-3 rounded-md border p-4">
              <input className="w-full rounded-md border px-3 py-2 text-sm" placeholder="Full Name" value={contactForm.full_name} onChange={(e) => setContactForm({ ...contactForm, full_name: e.target.value })} />
              <input className="w-full rounded-md border px-3 py-2 text-sm" placeholder="Job Title" value={contactForm.job_title} onChange={(e) => setContactForm({ ...contactForm, job_title: e.target.value })} />
              <input className="w-full rounded-md border px-3 py-2 text-sm" placeholder="Email" value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })} />
              <input className="w-full rounded-md border px-3 py-2 text-sm" placeholder="Phone" value={contactForm.phone} onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={contactForm.is_primary} onChange={(e) => setContactForm({ ...contactForm, is_primary: e.target.checked })} />
                Primary Contact
              </label>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => (editingContact ? handleEditContact(editingContact) : handleAddContact())}>
                  {editingContact ? "Update" : "Add"}
                </Button>
                <Button size="sm" variant="outline" onClick={cancelEdit}>Cancel</Button>
              </div>
            </div>
          ) : null}

          {contacts.length === 0 ? (
            <div className="text-sm text-muted-foreground">No contacts.</div>
          ) : (
            <div className="space-y-2">
              {contacts.map((contact) => (
                <div key={contact.contact_id} className="rounded-md border px-3 py-2 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="font-medium">
                        {contact.full_name ?? ""}
                        {contact.is_primary ? <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">Primary</span> : null}
                      </div>
                      {contact.job_title ? <div className="text-muted-foreground">{contact.job_title}</div> : null}
                      {contact.email ? <div className="text-muted-foreground">{contact.email}</div> : null}
                      {contact.phone ? <div className="text-muted-foreground">{contact.phone}</div> : null}
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => startEditContact(contact)}>Edit</Button>
                      <Button size="sm" variant="destructive" onClick={() => handleDeleteContact(contact.contact_id)}>Delete</Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  function renderJobsSection() {
    if (jobs.length === 0) {
      return (
        <Card>
          <CardHeader><CardTitle>Jobs</CardTitle></CardHeader>
          <CardContent><div className="text-sm text-muted-foreground">No jobs.</div></CardContent>
        </Card>
      );
    }

    const jobsByType = jobs.reduce((acc, job) => {
      const type = job.job_type || "Unknown";
      if (!acc[type]) acc[type] = [];
      acc[type].push(job);
      return acc;
    }, {} as Record<string, typeof jobs>);

    return (
      <Card>
        <CardHeader><CardTitle>Jobs ({jobs.length})</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          {Object.entries(jobsByType).map(([jobType, typeJobs]) => (
            <div key={jobType}>
              <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{jobType}</h3>
              <div className="space-y-2">
                {typeJobs.map((j) => {
                  const statusColor = milestoneDotClass(j.milestone_status);
                  const emissionsFormatted =
                    j.is_crp && j.total_emissions != null && j.total_emissions > 0
                      ? j.total_emissions.toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
                      : j.is_crp
                        ? "-"
                        : "N/A";
                  return (
                    <div key={j.job_id} className="rounded-md border px-3 py-2 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                          <div className="flex items-center pt-1"><div className={`h-3 w-3 rounded-full ${statusColor}`} /></div>
                          <Link href={`/jobs/${j.job_id}`} className="min-w-0 flex-1">
                            <div className="font-medium">{(j.job_number ?? `Job ${j.job_id}`) + (j.reporting_year ? ` (${j.reporting_year})` : "")}</div>
                            <div className="text-muted-foreground">{j.title ?? ""}</div>
                            <div className="text-muted-foreground flex items-center gap-2"><span>Status:</span><StatusBadge status={j.status} /></div>
                          </Link>
                        </div>
                        <div className="flex items-center gap-3">
                          <MilestoneBadge status={j.milestone_status} className="hidden sm:inline-flex" />
                          {j.is_crp ? (
                            <div className="min-w-[120px] text-right">
                              <div className="text-base font-semibold">{emissionsFormatted}</div>
                              <div className="text-xs text-muted-foreground">tCO2e</div>
                            </div>
                          ) : null}
                          <Button variant="secondary" asChild><Link href={`/jobs/${j.job_id}`}>Go to Job</Link></Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  function invoiceLineAmount(line: { qty: number; rate: number }): number {
    return Number((line.qty || 0) * (line.rate || 0));
  }

  const draftSubtotal = invoiceDraftLines.reduce((acc, line) => acc + invoiceLineAmount(line), 0);
  const draftVat = invoiceDraftLines.reduce((acc, line) => acc + invoiceLineAmount(line) * ((line.vat_rate_pct || 0) / 100), 0);
  const draftTotal = draftSubtotal + draftVat;

  function addInvoiceLine() {
    setInvoiceDraftLines((prev) => [
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

  function updateInvoiceLine(key: string, patch: Partial<(typeof invoiceDraftLines)[number]>) {
    setInvoiceDraftLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function removeInvoiceLine(key: string) {
    setInvoiceDraftLines((prev) => prev.filter((line) => line.key !== key));
  }

  function renderFinancialSection() {
    const currencyFmt = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const selectedQuote = quotes.find((q) => String(q.quote_id) === invoiceForm.quote_id);
    const showQuotes = financialView === "quotes";
    const showInvoices = financialView === "invoices";
    const showProfitLoss = financialView === "profit-loss";

    async function addInvoice() {
      setFinancialStatus("");
      try {
        const payloadLines = invoiceDraftLines.map((line, idx) => ({
          sort_order: idx + 1,
          item_id: line.item_id,
          description: line.description,
          unit: line.unit,
          qty: Number(line.qty || 0),
          rate: Number(line.rate || 0),
          amount: Number((line.qty || 0) * (line.rate || 0)),
          vat_rate_pct: Number(line.vat_rate_pct || 0),
          notes: line.notes || "",
        }));
        const payload = {
          quote_id: invoiceForm.quote_id ? Number(invoiceForm.quote_id) : null,
          invoice_date: invoiceForm.invoice_date || new Date().toISOString().slice(0, 10),
          due_date: invoiceForm.due_date || null,
          currency_code: selectedQuote?.currency_code || client?.currency || "GBP",
          subtotal: Number(draftSubtotal || 0),
          vat: Number(draftVat || 0),
          total: Number(draftTotal || 0),
          status: invoiceForm.status,
          notes: invoiceForm.notes,
          amount_paid: Number(invoiceForm.amount_paid || 0),
          paid_date: invoiceForm.paid_date || null,
          lines: payloadLines,
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
        await reloadFinancialData();
        setInvoiceForm({
          quote_id: "",
          invoice_date: new Date().toISOString().slice(0, 10),
          due_date: "",
          subtotal: "0.00",
          vat: "0.00",
          total: "0.00",
          status: "Draft",
          notes: "",
          amount_paid: "0.00",
          paid_date: "",
        });
        setInvoiceDraftLines([
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
        setFinancialStatus("Invoice added.");
      } catch (e) {
        setFinancialStatus((e as Error).message);
      }
    }

    function onInvoiceDraftItemChange(lineKey: string, itemIdText: string) {
      const itemId = Number(itemIdText);
      const selectedItem = quoteLookupItems.find((it) => Number(it.item_id) === itemId);
      if (!selectedItem) return;
      updateInvoiceLine(lineKey, {
        item_id: selectedItem.item_id,
        description: selectedItem.description || selectedItem.item_name || "",
        unit: selectedItem.unit || "",
        rate: Number(selectedItem.sell_amount || 0),
        vat_rate_pct: Number(selectedItem.vat_rate || 0),
      });
    }

    async function loadQuoteLinesToDraft(quoteId: number) {
      setFinancialStatus("");
      try {
        const res = await fetch(`${baseUrl}/quotes/${quoteId}`, { credentials: "include" });
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          throw new Error(`Failed to load quote lines (${res.status})${t ? `: ${t}` : ""}`);
        }
        const quote = await res.json();
        const lines = Array.isArray(quote.lines) ? quote.lines : [];
        const mainLines = lines.filter((line: { line_type?: string }) => (line.line_type || "main") !== "option");
        if (mainLines.length === 0) {
          setFinancialStatus("Quote has no billable lines.");
          return;
        }
        setInvoiceDraftLines(
          mainLines.map((line: { item_id?: number; description?: string; unit?: string; qty?: number; rate?: number; vat_rate_pct?: number; notes?: string }) => ({
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
        setInvoiceForm((prev) => ({ ...prev, quote_id: String(quoteId), notes: String(quote.notes || prev.notes || "") }));
      } catch (e) {
        setFinancialStatus((e as Error).message);
      }
    }

    async function convertQuoteToInvoice(quoteId: number) {
      setFinancialStatus("");
      try {
        const res = await fetch(`${baseUrl}/quotes/${quoteId}/convert-to-invoice`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            invoice_date: invoiceForm.invoice_date || new Date().toISOString().slice(0, 10),
            due_date: invoiceForm.due_date || null,
            status: "Draft",
          }),
        });
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          throw new Error(`Failed to convert quote (${res.status})${t ? `: ${t}` : ""}`);
        }
        await reloadFinancialData();
        setFinancialStatus("Quote converted to invoice.");
      } catch (e) {
        setFinancialStatus((e as Error).message);
      }
    }

    async function quickUpdateInvoice(invoiceId: number, patch: Record<string, unknown>) {
      setFinancialStatus("");
      try {
        const res = await fetch(`${baseUrl}/invoices/${invoiceId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          throw new Error(`Failed to update invoice (${res.status})${t ? `: ${t}` : ""}`);
        }
        await reloadFinancialData();
      } catch (e) {
        setFinancialStatus((e as Error).message);
      }
    }

    async function removeInvoice(invoiceId: number) {
      const confirmed = await confirmAction({
        title: "Delete invoice?",
        description: "This invoice will be removed from the client financial records.",
        confirmLabel: "Delete",
        destructive: true,
      });
      if (!confirmed) return;
      setFinancialStatus("");
      try {
        const res = await fetch(`${baseUrl}/invoices/${invoiceId}`, { method: "DELETE", credentials: "include" });
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          throw new Error(`Failed to delete invoice (${res.status})${t ? `: ${t}` : ""}`);
        }
        await reloadFinancialData();
      } catch (e) {
        setFinancialStatus((e as Error).message);
      }
    }

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap gap-2">
          <Button variant={showQuotes ? "default" : "outline"} onClick={() => setFinancialView("quotes")}>
            Quotes
          </Button>
          <Button variant={showInvoices ? "default" : "outline"} onClick={() => setFinancialView("invoices")}>
            Invoices
          </Button>
          <Button variant={showProfitLoss ? "default" : "outline"} onClick={() => setFinancialView("profit-loss")}>
            Profit & Loss
          </Button>
        </div>

        {showQuotes ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Quotes ({quotes.length})</CardTitle>
              <div className="flex gap-2">
                <Button size="sm" asChild><Link href={`/clients/${clientId}/quotes/new`}>+ Add Quote</Link></Button>
                <Button size="sm" variant="outline" asChild><Link href={`/clients/${clientId}/quotes`}>All Quotes</Link></Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {quotes.length === 0 ? (
              <div className="text-sm text-muted-foreground">No quotes yet.</div>
            ) : (
              <div className="space-y-2">
                {quotes.map((q) => (
                  <div key={q.quote_id} className="rounded-md border px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium">{q.quote_number || `#${q.quote_id}`}</div>
                        <div className="text-muted-foreground">
                          Date: {q.quote_date ? new Date(q.quote_date).toLocaleDateString("en-GB") : "-"} | Valid To: {q.valid_to ? new Date(q.valid_to).toLocaleDateString("en-GB") : "-"} | Status: {q.status || "-"}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-right font-semibold">{currencyFmt.format(Number(q.total || 0))} {q.currency_code || ""}</div>
                        <Button variant="outline" size="sm" onClick={() => void loadQuoteLinesToDraft(q.quote_id)}>Use Lines</Button>
                        <Button variant="outline" size="sm" onClick={() => void convertQuoteToInvoice(q.quote_id)}>Convert</Button>
                        <Button variant="outline" size="sm" asChild><Link href={`/clients/${clientId}/quotes/new?quoteId=${q.quote_id}`}>Open</Link></Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        ) : null}

        {showInvoices ? (
        <>
          <Card className="mb-6">
            <CardContent className="pt-6">
              <div className="grid gap-6 md:grid-cols-3">
                <div className="space-y-3">
                  <h1 className="text-5xl font-light tracking-wide">INVOICE</h1>
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">Quote</div>
                    <select
                      className="w-full rounded-md border px-3 py-2 text-sm"
                      value={invoiceForm.quote_id}
                      onChange={(e) => {
                        const quoteId = e.target.value;
                        setInvoiceForm((prev) => ({ ...prev, quote_id: quoteId }));
                        if (quoteId) void loadQuoteLinesToDraft(Number(quoteId));
                      }}
                    >
                      <option value="">No quote linked</option>
                      {quotes.map((q) => (
                        <option key={q.quote_id} value={String(q.quote_id)}>
                          {q.quote_number || `#${q.quote_id}`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">Status</div>
                    <Input value={invoiceForm.status} onChange={(e) => setInvoiceForm((prev) => ({ ...prev, status: e.target.value }))} />
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">Invoice Date</div>
                    <Input type="date" value={invoiceForm.invoice_date} onChange={(e) => setInvoiceForm((prev) => ({ ...prev, invoice_date: e.target.value }))} />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">Due Date</div>
                    <Input type="date" value={invoiceForm.due_date} onChange={(e) => setInvoiceForm((prev) => ({ ...prev, due_date: e.target.value }))} />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">Invoice Total</div>
                    <Input value={currencyFmt.format(draftTotal)} readOnly />
                  </div>
                  <div className="flex items-end gap-2">
                    {invoiceForm.quote_id ? (
                      <Button variant="outline" onClick={() => void convertQuoteToInvoice(Number(invoiceForm.quote_id))}>
                        Convert Selected Quote
                      </Button>
                    ) : null}
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
                <Button variant="outline" onClick={addInvoiceLine}>+ Add Line</Button>
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
                    {invoiceDraftLines.map((line) => (
                      <tr key={line.key} className="border-b">
                        <td className="p-2">
                          <select
                            className="w-full rounded-md border px-2 py-1 text-sm"
                            value={line.item_id != null ? String(line.item_id) : ""}
                            onChange={(e) => onInvoiceDraftItemChange(line.key, e.target.value)}
                          >
                            <option value="">Select item...</option>
                            {quoteLookupItems.map((it) => (
                              <option key={it.item_id} value={String(it.item_id)}>
                                {it.item_name}
                              </option>
                            ))}
                          </select>
                          <Textarea
                            className="mt-2"
                            rows={3}
                            value={line.description}
                            onChange={(e) => updateInvoiceLine(line.key, { description: e.target.value })}
                            placeholder="Item description"
                          />
                        </td>
                        <td className="p-2">
                          <Input value={line.unit} onChange={(e) => updateInvoiceLine(line.key, { unit: e.target.value })} />
                        </td>
                        <td className="p-2">
                          <Input type="number" step="0.01" value={String(line.qty)} onChange={(e) => updateInvoiceLine(line.key, { qty: Number(e.target.value || 0) })} />
                        </td>
                        <td className="p-2">
                          <Input type="number" step="0.01" value={String(line.rate)} onChange={(e) => updateInvoiceLine(line.key, { rate: Number(e.target.value || 0) })} />
                        </td>
                        <td className="p-2">
                          <Input type="number" step="0.01" value={String(line.vat_rate_pct)} onChange={(e) => updateInvoiceLine(line.key, { vat_rate_pct: Number(e.target.value || 0) })} />
                        </td>
                        <td className="p-2">{currencyFmt.format(invoiceLineAmount(line))}</td>
                        <td className="p-2 text-right">
                          <Button variant="outline" size="sm" onClick={() => removeInvoiceLine(line.key)}>Remove</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="ml-auto w-full max-w-md space-y-2 text-sm">
                <div className="flex justify-between"><span>Sub-total</span><span>{currencyFmt.format(draftSubtotal)}</span></div>
                <div className="flex justify-between"><span>VAT</span><span>{currencyFmt.format(draftVat)}</span></div>
                <div className="flex justify-between border-t pt-2 text-base font-semibold"><span>Total</span><span>{currencyFmt.format(draftTotal)}</span></div>
                <CompanyLegalFooter baseUrl={baseUrl} className="pt-3 text-right text-xs text-muted-foreground" />
              </div>
              <div className="flex justify-end">
                <Button onClick={addInvoice}>Add Invoice</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Invoices ({invoices.length})</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {invoices.length === 0 ? (
                <div className="text-sm text-muted-foreground">No invoices yet.</div>
              ) : (
                <div className="space-y-2">
                  {invoices.map((inv) => (
                    <div key={inv.invoice_id} className="rounded-md border px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium">{inv.invoice_number || `#${inv.invoice_id}`}</div>
                          <div className="text-muted-foreground">
                            Date: {inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString("en-GB") : "-"} | Due: {inv.due_date ? new Date(inv.due_date).toLocaleDateString("en-GB") : "-"}
                          </div>
                          <div className="text-muted-foreground">Status: {inv.status || "-"} | Paid: {currencyFmt.format(Number(inv.amount_paid || 0))} | Lines: {Number(inv.line_count || 0)}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="min-w-[150px] text-right font-semibold">
                            {currencyFmt.format(Number(inv.total || 0))} {inv.currency_code || client?.currency || ""}
                          </div>
                          <Button size="sm" variant="outline" onClick={() => quickUpdateInvoice(inv.invoice_id, { status: "Paid", amount_paid: inv.total || 0, paid_date: new Date().toISOString().slice(0, 10) })}>
                            Mark Paid
                          </Button>
                          <Button size="sm" variant="outline" asChild>
                            <Link href={`/clients/${clientId}/invoices/${inv.invoice_id}`}>Open</Link>
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => removeInvoice(inv.invoice_id)}>
                            Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {financialStatus ? <div className="text-sm text-muted-foreground">{financialStatus}</div> : null}
            </CardContent>
          </Card>
        </>
        ) : null}

        {showProfitLoss ? (
        <Card>
          <CardHeader><CardTitle>Profit & Loss (Estimated vs Actual)</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Estimated (Quotes)</div>
                <div className="text-xl font-semibold">{currencyFmt.format(Number(financialSummary?.quotes.estimated_total || 0))}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Invoiced</div>
                <div className="text-xl font-semibold">{currencyFmt.format(Number(financialSummary?.invoices.invoiced_total || 0))}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Outstanding</div>
                <div className="text-xl font-semibold">{currencyFmt.format(Number(financialSummary?.invoices.outstanding_total || 0))}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Paid</div>
                <div className="text-xl font-semibold">{currencyFmt.format(Number(financialSummary?.invoices.paid_total || 0))}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Variance (Invoiced - Estimated)</div>
                <div className="text-xl font-semibold">{currencyFmt.format(Number(financialSummary?.analysis.variance_amount || 0))}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Realization %</div>
                <div className="text-xl font-semibold">{Number(financialSummary?.analysis.realization_pct || 0).toFixed(2)}%</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Actual Cost (Time Logs)</div>
                <div className="text-xl font-semibold">{currencyFmt.format(Number(financialSummary?.analysis.actual_cost_from_time || 0))}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Logged Hours</div>
                <div className="text-xl font-semibold">{Number(financialSummary?.analysis.logged_hours || 0).toFixed(2)}h</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Time Cost Variance vs Estimate</div>
                <div className="text-xl font-semibold">{currencyFmt.format(Number(financialSummary?.analysis.time_cost_variance_vs_estimate || 0))}</div>
              </div>
            </div>
          </CardContent>
        </Card>
        ) : null}
      </div>
    );
  }

  function renderActiveSection() {
    if (activeSection === "dashboard") return <ClientDashboard clientId={clientId} baseUrl={baseUrl} />;
    if (activeSection === "timeline") {
      const commJobs = (jobs || []).map((j) => ({
        ...j,
        job_number: j.job_number ?? `Job ${j.job_id}`,
      }));
      return <ClientCommunications clientId={clientId} baseUrl={baseUrl} jobs={commJobs} />;
    }
    if (activeSection === "details") return renderDetailsSection();
    if (activeSection === "contacts") return renderContactsSection();
    if (activeSection === "jobs") return renderJobsSection();
    if (activeSection === "reporting") return <ClientReporting clientId={clientId} baseUrl={baseUrl} />;
    if (activeSection === "custom-fields") return <CustomFields entityId={clientId} entityType="client" baseUrl={baseUrl} />;
    return renderFinancialSection();
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <PageHeader
          title={client?.client_name ?? "Client"}
          subtitle={`Client ID: ${Number.isFinite(clientId) ? clientId : "-"}`}
          breadcrumbs={[{ label: "Clients", href: "/clients" }, { label: client?.client_name ?? "Client" }]}
          titleSuffix={client?.status ? <StatusBadge status={client.status} /> : undefined}
          actions={
            <>
              <Button asChild><Link href={`/jobs/new?clientId=${clientId}`}>+ Add Job</Link></Button>
              <Button variant="secondary" asChild><Link href={`/clients/${clientId}/edit`}>Edit Client</Link></Button>
              <Button variant="secondary" asChild><Link href={`/clients/${clientId}/quotes/new`}>Add Quote</Link></Button>
              <Button variant="outline" asChild><Link href="/clients">Back to Clients</Link></Button>
            </>
          }
        />

        {error ? <div className="mb-4 text-sm text-destructive">{error}</div> : null}
        {loading ? <div className="mb-4 text-sm text-muted-foreground">Loading...</div> : null}

        <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
          <Card className="h-fit lg:sticky lg:top-24">
            <CardHeader>
              <CardTitle className="text-base">Client Sections</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {SECTIONS.map((section) => (
                <Button
                  key={section.id}
                  variant={activeSection === section.id ? "default" : "outline"}
                  className="w-full justify-start"
                  onClick={() => setActiveSection(section.id)}
                >
                  {section.label}
                </Button>
              ))}
            </CardContent>
          </Card>

          <div>{renderActiveSection()}</div>
        </div>
      </div>
    </div>
  );
}

export default function ClientDetailPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-7xl p-6 text-sm text-muted-foreground">Loading...</div>}>
      <ClientDetailPageContent />
    </Suspense>
  );
}
