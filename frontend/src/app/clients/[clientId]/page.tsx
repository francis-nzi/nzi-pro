"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import ClientDashboard from "@/components/ClientDashboard";
import ClientJobsTable from "@/components/ClientJobsTable";
import ClientWorkspaceLeftNav from "@/components/ClientWorkspaceLeftNav";
import CallPrepPanel from "@/components/CallPrepPanel";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";
import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
const ClientCommunications = dynamic(() => import("@/components/ClientCommunications"), {
  ssr: false,
  loading: () => <div className="py-8 text-center text-sm text-muted-foreground">Loading communications...</div>,
});
const ClientNotesSummary = dynamic(() => import("@/components/ClientNotesSummary"), {
  ssr: false,
  loading: () => <div className="py-8 text-center text-sm text-muted-foreground">Loading notes...</div>,
});
const TasksTable = dynamic(() => import("@/components/TasksTable"), {
  ssr: false,
  loading: () => <div className="py-8 text-center text-sm text-muted-foreground">Loading tasks...</div>,
});
const ClientReporting = dynamic(() => import("@/components/ClientReporting"), {
  ssr: false,
  loading: () => <div className="py-8 text-center text-sm text-muted-foreground">Loading reporting...</div>,
});
const ClientActions = dynamic(() => import("@/components/ClientActions"), {
  ssr: false,
  loading: () => <div className="py-8 text-center text-sm text-muted-foreground">Loading actions...</div>,
});
const ClientSrsReadiness = dynamic(() => import("@/components/ClientSrsReadiness"), {
  ssr: false,
  loading: () => <div className="py-8 text-center text-sm text-muted-foreground">Loading SRS Readiness...</div>,
});
const ClientJobsSection = dynamic(() => import("@/components/ClientJobsSection"), {
  ssr: false,
  loading: () => <div className="py-8 text-center text-sm text-muted-foreground">Loading jobs...</div>,
});
const CustomFields = dynamic(() => import("@/components/CustomFields"), {
  ssr: false,
  loading: () => <div className="py-8 text-center text-sm text-muted-foreground">Loading custom fields...</div>,
});
const ClientPortalManagement = dynamic(() => import("@/components/ClientPortalManagement"), {
  ssr: false,
  loading: () => <div className="py-8 text-center text-sm text-muted-foreground">Loading portal data...</div>,
});
const ClientFiles = dynamic(() => import("@/components/ClientFiles"), {
  ssr: false,
  loading: () => <div className="py-8 text-center text-sm text-muted-foreground">Loading files...</div>,
});
const ClientAiProfile = dynamic(() => import("@/components/ClientAiProfile"), {
  ssr: false,
  loading: () => <div className="py-8 text-center text-sm text-muted-foreground">Loading AI profile...</div>,
});
const CompanyIdentityBlock = dynamic(
  () => import("@/components/CompanyIdentityBlock").then((mod) => mod.CompanyIdentityBlock),
  {
    ssr: false,
    loading: () => <div className="h-64 rounded-md border bg-muted/20 animate-pulse" />,
  }
);
const CompanyLegalFooter = dynamic(
  () => import("@/components/CompanyIdentityBlock").then((mod) => mod.CompanyLegalFooter),
  { ssr: false }
);

function apiBaseUrl(): string {
  return "/api/backend";
}

type Client = {
  client_db_id: number;
  client_name: string | null;
  billing_company?: string | null;
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
  benchmark_scope_1_tco2e?: number | null;
  benchmark_scope_2_tco2e?: number | null;
  benchmark_scope_3_tco2e?: number | null;
  benchmark_total_tco2e?: number | null;
  currency: string | null;
  logo_url?: string | null;
  parent_company?: string | null;
  group_structure?: string | null;
  reporting_frameworks?: string | null;
  certifications?: string | null;
  primary_scope3_categories?: string | null;
};

type ClientJobsResponse = {
  client_db_id: number;
  items: Array<{
    job_id: number;
    job_number: string | null;
    title: string | null;
    reporting_year: number | null;
    reporting_period_end?: string | null;
    status: string | null;
    job_type?: string | null;
    job_family?: string | null;
    is_crp?: boolean;
    milestone_status?: string | null;
    total_emissions?: number | null;
  }>;
};

type ClientSitesResponse = {
  client_db_id: number;
  active_sites?: ClientSite[];
  vacated_sites?: ClientSite[];
  sites?: ClientSite[];
};

type ClientSite = {
  site_id: number;
  site_name: string | null;
  location: string | null;
  is_registered_office: boolean;
  vacated_date?: string | null;
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

type ClientCreditNotesResponse = {
  items: Array<{
    credit_note_id: number;
    client_db_id: number;
    job_id: number | null;
    invoice_id: number | null;
    credit_note_number: string | null;
    credit_note_date: string | null;
    currency_code: string | null;
    subtotal: number | null;
    vat: number | null;
    total: number | null;
    status: string | null;
    notes: string | null;
    xero_credit_note_id?: string;
    xero_sync_status?: string;
    line_count?: number;
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
  | "overview"
  | "carbon"
  | "profile"
  | "financial"
  | "dashboard"
  | "timeline"
  | "notes"
  | "tasks"
  | "files"
  | "details"
  | "sites"
  | "contacts"
  | "jobs"
  | "reporting"
  | "actions"
  | "srs-readiness"
  | "custom-fields"
  | "portal"
  | "ai-profile";

type ProfileSubSection = "details" | "contacts" | "sites" | "custom-fields";

type FinancialView = "quotes" | "invoices" | "profit-loss";

function ClientDetailPageContent() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const confirmAction = useConfirmDialog();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ clientId: string }>();
  const searchParams = useSearchParams();
  const clientId = Number(params?.clientId);

  const [client, setClient] = useState<Client | null>(null);
  const [jobs, setJobs] = useState<ClientJobsResponse["items"]>([]);
  const [sites, setSites] = useState<ClientSite[]>([]);
  const [vacatedSites, setVacatedSites] = useState<ClientSite[]>([]);
  const [contacts, setContacts] = useState<ClientContactsResponse["contacts"]>([]);
  const [quotes, setQuotes] = useState<ClientQuotesResponse["items"]>([]);
  const [invoices, setInvoices] = useState<ClientInvoicesResponse["items"]>([]);
  const [creditNotes, setCreditNotes] = useState<ClientCreditNotesResponse["items"]>([]);
  const [financialSummary, setFinancialSummary] = useState<ClientFinancialSummary | null>(null);
  const [financialStatus, setFinancialStatus] = useState<string>("");
  const [quoteLookupItems, setQuoteLookupItems] = useState<QuoteLookupItem[]>([]);
  const [sitesLoaded, setSitesLoaded] = useState<boolean>(false);
  const [contactsLoaded, setContactsLoaded] = useState<boolean>(false);
  const [jobsLoaded, setJobsLoaded] = useState<boolean>(false);
  const [jobsLoading, setJobsLoading] = useState<boolean>(false);
  const [jobsError, setJobsError] = useState<string>("");
  const [financialLoaded, setFinancialLoaded] = useState<boolean>(false);
  const [financialSummaryLoaded, setFinancialSummaryLoaded] = useState<boolean>(false);
  const [quoteLookupsLoaded, setQuoteLookupsLoaded] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [clientNotFound, setClientNotFound] = useState<boolean>(false);
  const [openTaskCount, setOpenTaskCount] = useState<number | null>(null);
  const [activeSection, setActiveSection] = useState<ClientSection>("overview");
  const [activeProfileSubTab, setActiveProfileSubTab] = useState<ProfileSubSection>("details");
  const [financialView, setFinancialView] = useState<FinancialView>("quotes");
  const [callPrepOpen, setCallPrepOpen] = useState<boolean>(false);

  const [showAddContact, setShowAddContact] = useState<boolean>(false);
  const [editingContact, setEditingContact] = useState<number | null>(null);
  const [showAddSite, setShowAddSite] = useState<boolean>(false);
  const [editingSite, setEditingSite] = useState<number | null>(null);
  const [vacatingSite, setVacatingSite] = useState<number | null>(null);
  const [vacatedDate, setVacatedDate] = useState<string>("");
  const [contactForm, setContactForm] = useState({
    full_name: "",
    job_title: "",
    email: "",
    phone: "",
    is_primary: false,
  });
  const [siteForm, setSiteForm] = useState({
    site_name: "",
    location: "",
    is_registered_office: false,
  });
  const xeroInvoiceBadge = useMemo(() => {
    if (invoices.length === 0) {
      return { label: "Xero: No invoices", variant: "outline" as const };
    }
    const synced = invoices.filter((inv) => String((inv as { xero_sync_status?: string }).xero_sync_status || "").toLowerCase() === "synced").length;
    const failed = invoices.filter((inv) => String((inv as { xero_sync_status?: string }).xero_sync_status || "").toLowerCase() === "failed").length;
    const linked = invoices.filter((inv) => Boolean((inv as { xero_invoice_id?: string }).xero_invoice_id)).length;
    if (failed > 0) {
      return { label: `Xero: ${failed} failed`, variant: "destructive" as const };
    }
    if (synced > 0) {
      return { label: `Xero: ${synced} synced`, variant: "default" as const };
    }
    if (linked > 0) {
      return { label: `Xero: ${linked} linked`, variant: "secondary" as const };
    }
    return { label: "Xero: Not synced", variant: "outline" as const };
  }, [invoices]);

  const clientLogoSrc = useMemo(() => {
    const raw = String(client?.logo_url || "").trim();
    if (!raw) return "";
    if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("data:")) {
      return raw;
    }
    if (raw.startsWith("/uploads/")) {
      return `${baseUrl}${raw}`;
    }
    if (raw.startsWith("/api/backend/")) {
      return raw;
    }
    return raw;
  }, [baseUrl, client?.logo_url]);

  const reloadContacts = useCallback(async () => {
    try {
      const contactsRes = await fetch(`${baseUrl}/clients/${clientId}/contacts`, { credentials: "include" });
      if (contactsRes.ok) {
        const data = (await contactsRes.json()) as ClientContactsResponse;
        setContacts(data.contacts ?? []);
      }
    } catch {
      setContacts([]);
    } finally {
      setContactsLoaded(true);
    }
  }, [baseUrl, clientId]);

  const reloadJobs = useCallback(async () => {
    setJobsLoading(true);
    setJobsError("");
    try {
      const jobsRes = await fetch(`${baseUrl}/clients/${clientId}/jobs?limit=200&offset=0`, { credentials: "include" });
      if (jobsRes.ok) {
        const data = (await jobsRes.json()) as ClientJobsResponse;
        setJobs(data.items ?? []);
      } else {
        const body = await jobsRes.json().catch(() => null);
        const detail = body?.detail ?? jobsRes.statusText;
        setJobsError(`${jobsRes.status}: ${detail}`);
        setJobs([]);
      }
    } catch (e) {
      setJobsError((e as Error).message ?? "fetch failed");
      setJobs([]);
    } finally {
      setJobsLoaded(true);
      setJobsLoading(false);
    }
  }, [baseUrl, clientId]);

  const reloadSites = useCallback(async () => {
    try {
      const sitesRes = await fetch(`${baseUrl}/clients/${clientId}/sites`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!sitesRes.ok) return;
      const data = (await sitesRes.json()) as ClientSitesResponse;
      setSites(data.active_sites ?? data.sites ?? []);
      setVacatedSites(data.vacated_sites ?? []);
    } finally {
      setSitesLoaded(true);
    }
  }, [baseUrl, clientId]);

  const reloadFinancialData = useCallback(async () => {
    try {
      const [quotesRes, invoicesRes, creditNotesRes] = await Promise.allSettled([
        fetch(`${baseUrl}/clients/${clientId}/quotes`, { credentials: "include" }),
        fetch(`${baseUrl}/clients/${clientId}/invoices`, { credentials: "include" }),
        fetch(`${baseUrl}/clients/${clientId}/credit-notes`, { credentials: "include" }),
      ]);
      if (quotesRes.status === "fulfilled" && quotesRes.value.ok) {
        const data = (await quotesRes.value.json()) as ClientQuotesResponse;
        setQuotes(data.items ?? []);
      }
      if (invoicesRes.status === "fulfilled" && invoicesRes.value.ok) {
        const data = (await invoicesRes.value.json()) as ClientInvoicesResponse;
        setInvoices(data.items ?? []);
      }
      if (creditNotesRes.status === "fulfilled" && creditNotesRes.value.ok) {
        const data = (await creditNotesRes.value.json()) as ClientCreditNotesResponse;
        setCreditNotes(data.items ?? []);
      }
    } catch {
      // Keep the client page usable if one of the optional financial calls fails.
    } finally {
      setFinancialLoaded(true);
    }
  }, [baseUrl, clientId]);

  const reloadFinancialSummary = useCallback(async () => {
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/financial/summary`, { credentials: "include" });
      if (res.ok) {
        const data = (await res.json()) as ClientFinancialSummary;
        setFinancialSummary(data);
      }
    } catch {
      setFinancialSummary(null);
    } finally {
      setFinancialSummaryLoaded(true);
    }
  }, [baseUrl, clientId]);

  const reloadQuoteLookups = useCallback(async () => {
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/quotes/lookups`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setQuoteLookupItems(Array.isArray(data.items) ? data.items : []);
      }
    } catch {
      setQuoteLookupItems([]);
    } finally {
      setQuoteLookupsLoaded(true);
    }
  }, [baseUrl, clientId]);

  useEffect(() => {
    const section = String(searchParams.get("section") || "").trim().toLowerCase();
    let targetSection: ClientSection = "overview";
    let targetSubTab: ProfileSubSection = "details";
    
    if (section === "carbon" || section === "dashboard") {
      targetSection = "carbon";
    } else if (section === "reporting") {
      targetSection = "reporting";
    } else if (section === "actions") {
      targetSection = "actions";
    } else if (section === "srs-readiness") {
      targetSection = "srs-readiness";
    } else if (section === "timeline" || section === "communications") {
      targetSection = "timeline";
    } else if (section === "notes") {
      targetSection = "notes";
    } else if (section === "tasks") {
      targetSection = "tasks";
    } else if (section === "profile") {
      targetSection = "profile";
    } else if (section === "details") {
      targetSection = "profile";
      targetSubTab = "details";
    } else if (section === "contacts") {
      targetSection = "profile";
      targetSubTab = "contacts";
    } else if (section === "sites") {
      targetSection = "profile";
      targetSubTab = "sites";
    } else if (section === "custom-fields") {
      targetSection = "profile";
      targetSubTab = "custom-fields";
    } else if (section === "financial" || section === "financials") {
      targetSection = "financial";
    } else if (section === "portal") {
      targetSection = "portal";
    } else if (section === "ai-profile") {
      targetSection = "ai-profile";
    } else if (section === "overview") {
      targetSection = "overview";
    }
    
    setActiveSection(targetSection);
    setActiveProfileSubTab(targetSubTab);
  }, [searchParams]);

  function setSection(section: ClientSection) {
    let targetSection: ClientSection = section;
    let targetSubTab: ProfileSubSection = activeProfileSubTab;
    
    if (section === "dashboard" || section === "carbon") {
      targetSection = "carbon";
    } else if (section === "reporting") {
      targetSection = "reporting";
    } else if (section === "actions") {
      targetSection = "actions";
    } else if (section === "srs-readiness") {
      targetSection = "srs-readiness";
    } else if (section === "details") {
      targetSection = "profile";
      targetSubTab = "details";
    } else if (section === "contacts") {
      targetSection = "profile";
      targetSubTab = "contacts";
    } else if (section === "sites") {
      targetSection = "profile";
      targetSubTab = "sites";
    } else if (section === "custom-fields") {
      targetSection = "profile";
      targetSubTab = "custom-fields";
    } else if (section === "timeline") {
      targetSection = "timeline";
    } else if (section === "notes") {
      targetSection = "notes";
    } else if (section === "jobs") {
      targetSection = "overview";
    } else if (section === "profile") {
      targetSection = "profile";
    } else if (section === "financial") {
      targetSection = "financial";
    } else if (section === "portal") {
      targetSection = "portal";
    } else if (section === "ai-profile") {
      targetSection = "ai-profile";
    }

    setActiveSection(targetSection);
    setActiveProfileSubTab(targetSubTab);
    
    const nextParams = new URLSearchParams(searchParams.toString());
    if (targetSection === "overview") {
      nextParams.delete("section");
    } else {
      nextParams.set("section", targetSection);
    }
    const nextUrl = nextParams.toString() ? `${pathname}?${nextParams.toString()}` : pathname;
    router.replace(nextUrl, { scroll: false });
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!Number.isFinite(clientId) || clientId <= 0) {
        setError("Invalid client id");
        return;
      }

      setLoading(true);
      setError("");
      setClientNotFound(false);
      setSitesLoaded(false);
      setContactsLoaded(false);
      setJobsLoaded(false);
      setJobsLoading(false);
      setFinancialLoaded(false);
      setFinancialSummaryLoaded(false);
      setQuoteLookupsLoaded(false);

      try {
        const cRes = await fetch(`${baseUrl}/clients/${clientId}`, { credentials: "include" });

        if (!cRes.ok) {
          if (cRes.status === 404) {
            if (cancelled) return;
            setClientNotFound(true);
            setClient(null);
            setJobs([]);
            setSites([]);
            setVacatedSites([]);
            setContacts([]);
            setQuotes([]);
            setInvoices([]);
            setFinancialSummary(null);
            setQuoteLookupItems([]);
            setSitesLoaded(true);
            setContactsLoaded(true);
            setJobsLoaded(true);
            setJobsLoading(false);
            setFinancialLoaded(true);
            setFinancialSummaryLoaded(true);
            setQuoteLookupsLoaded(true);
            return;
          }
          const t = await cRes.text().catch(() => "");
          throw new Error(`Failed to load client: ${cRes.status} ${cRes.statusText}${t ? ` - ${t}` : ""}`);
        }

        const cJson = (await cRes.json()) as Client;

        if (cancelled) return;

        setClient(cJson);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        setClientNotFound(false);
        setClient(null);
        setJobs([]);
        setSites([]);
        setVacatedSites([]);
        setContacts([]);
        setQuotes([]);
        setInvoices([]);
        setFinancialSummary(null);
        setQuoteLookupItems([]);
        setSitesLoaded(false);
        setContactsLoaded(false);
        setJobsLoaded(false);
        setJobsLoading(false);
        setFinancialLoaded(false);
        setFinancialSummaryLoaded(false);
        setQuoteLookupsLoaded(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, clientId]);

  useEffect(() => {
    if (!Number.isFinite(clientId) || clientId <= 0) return;
    let cancelled = false;
    async function fetchCount() {
      try {
        const res = await fetch(`${baseUrl}/clients/${clientId}/tasks/open-count`, { credentials: "include" });
        if (res.ok) {
          const data = (await res.json()) as { count: number };
          if (!cancelled) setOpenTaskCount(data.count);
        }
      } catch { /* non-fatal */ }
    }
    void fetchCount();
    return () => { cancelled = true; };
  }, [baseUrl, clientId]);

  useEffect(() => {
    if (clientNotFound) return;

    // Overview tab pre-loads
    if (activeSection === "overview") {
      if (!jobsLoaded && !jobsLoading) void reloadJobs();
      if (!contactsLoaded) void reloadContacts();
      if (!financialLoaded) void reloadFinancialData();
      if (!financialSummaryLoaded) void reloadFinancialSummary();
      if (!sitesLoaded) void reloadSites();
    }
    
    // Company Profile sub-tabs load triggers
    if (activeSection === "profile") {
      if (activeProfileSubTab === "contacts" && !contactsLoaded) void reloadContacts();
      if ((activeProfileSubTab === "details" || activeProfileSubTab === "sites") && !sitesLoaded) void reloadSites();
    }
    
    // Legacy support mapping triggers
    if (activeSection === "contacts" && !contactsLoaded) {
      void reloadContacts();
    }
    if ((activeSection === "jobs" || activeSection === "timeline" || activeSection === "notes") && !jobsLoaded && !jobsLoading) {
      void reloadJobs();
    }
    if ((activeSection === "details" || activeSection === "sites") && !sitesLoaded) {
      void reloadSites();
    }
    if (activeSection === "financial" && !financialLoaded) {
      void reloadFinancialData();
    }
    if (activeSection === "financial" && financialView === "profit-loss" && !financialSummaryLoaded) {
      void reloadFinancialSummary();
    }
    if (activeSection === "financial" && financialView === "invoices" && !quoteLookupsLoaded) {
      void reloadQuoteLookups();
    }
  }, [
    activeSection,
    activeProfileSubTab,
    clientNotFound,
    contactsLoaded,
    jobsLoaded,
    jobsLoading,
    sitesLoaded,
    financialLoaded,
    financialSummaryLoaded,
    financialView,
    quoteLookupsLoaded,
    reloadContacts,
    reloadJobs,
    reloadSites,
    reloadFinancialData,
    reloadFinancialSummary,
    reloadQuoteLookups,
  ]);

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
      toast.success("Contact added");
    } catch (e) {
      toast.error((e as Error).message);
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
      toast.success("Contact updated");
    } catch (e) {
      toast.error((e as Error).message);
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
      toast.success("Contact deleted");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleAddSite() {
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/sites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(siteForm),
      });
      if (!res.ok) throw new Error("Failed to add site");
      await reloadSites();
      setSiteForm({ site_name: "", location: "", is_registered_office: false });
      setShowAddSite(false);
      toast.success("Site added");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleEditSite(siteId: number) {
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/sites/${siteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(siteForm),
      });
      if (!res.ok) throw new Error("Failed to update site");
      await reloadSites();
      setSiteForm({ site_name: "", location: "", is_registered_office: false });
      setEditingSite(null);
      setShowAddSite(false);
      toast.success("Site updated");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleVacateSite(siteId: number) {
    if (!vacatedDate) {
      toast.warning("Please select a vacated date");
      return;
    }
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/sites/${siteId}/vacate`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ vacated_date: vacatedDate }),
      });
      if (!res.ok) throw new Error("Failed to vacate site");
      await reloadSites();
      setVacatingSite(null);
      setVacatedDate("");
      toast.success("Site marked as vacated");
    } catch (e) {
      toast.error((e as Error).message);
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

  function startEditSite(site: ClientSite) {
    setSiteForm({
      site_name: site.site_name ?? "",
      location: site.location ?? "",
      is_registered_office: site.is_registered_office,
    });
    setEditingSite(site.site_id);
    setShowAddSite(false);
  }

  function cancelSiteEdit() {
    setSiteForm({ site_name: "", location: "", is_registered_office: false });
    setEditingSite(null);
    setShowAddSite(false);
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
              <div><span className="text-muted-foreground">Billing Company:</span> {client?.billing_company ?? client?.client_name ?? ""}</div>
              <div><span className="text-muted-foreground">Industry:</span> {client?.industry ?? ""}</div>
              <div><span className="text-muted-foreground">Status:</span> <StatusBadge status={client?.status} /></div>
              <div><span className="text-muted-foreground">Client Owner:</span> {client?.crm_owner ?? ""}</div>
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

        {(client?.parent_company || client?.group_structure || client?.reporting_frameworks || client?.certifications || client?.primary_scope3_categories) ? (
          <Card>
            <CardHeader>
              <CardTitle>Context &amp; Compliance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {client.parent_company ? <div><span className="font-medium">Parent company / group:</span> <span className="text-muted-foreground">{client.parent_company}</span></div> : null}
              {client.group_structure ? <div><span className="font-medium">Group structure:</span> <span className="text-muted-foreground">{client.group_structure}</span></div> : null}
              {(() => { try { const f = JSON.parse(client.reporting_frameworks || "null"); return Array.isArray(f) && f.length ? <div><span className="font-medium">Reporting frameworks:</span> <span className="text-muted-foreground">{(f as string[]).join(", ")}</span></div> : null; } catch { return null; } })()}
              {(() => { try { const c = JSON.parse(client.certifications || "null"); return Array.isArray(c) && c.length ? <div><span className="font-medium">Certifications:</span> <span className="text-muted-foreground">{(c as string[]).join(", ")}</span></div> : null; } catch { return null; } })()}
              {(() => { try { const s = JSON.parse(client.primary_scope3_categories || "null"); return Array.isArray(s) && s.length ? <div><span className="font-medium">Primary Scope 3:</span> <span className="text-muted-foreground">{(s as string[]).join(", ")}</span></div> : null; } catch { return null; } })()}
            </CardContent>
          </Card>
        ) : null}

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
            <div><span className="font-medium">Baseline Year:</span> <span className="text-muted-foreground">{client?.benchmark_year ?? "Not set"}</span></div>
            <div><span className="font-medium">Baseline Start:</span> <span className="text-muted-foreground">{client?.benchmark_period_start ? new Date(client.benchmark_period_start).toLocaleDateString("en-GB") : "Not set"}</span></div>
            <div><span className="font-medium">Baseline End:</span> <span className="text-muted-foreground">{client?.benchmark_period_end ? new Date(client.benchmark_period_end).toLocaleDateString("en-GB") : "Not set"}</span></div>
            <div><span className="font-medium">Currency:</span> <span className="text-muted-foreground">{client?.currency ?? "Not set"}</span></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Historical Baseline Emissions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid gap-2 md:grid-cols-2">
              <div><span className="font-medium">Scope 1:</span> <span className="text-muted-foreground">{client?.benchmark_scope_1_tco2e != null ? `${Number(client.benchmark_scope_1_tco2e).toLocaleString(undefined, { maximumFractionDigits: 1 })} tCO₂e` : "Not set"}</span></div>
              <div><span className="font-medium">Scope 2:</span> <span className="text-muted-foreground">{client?.benchmark_scope_2_tco2e != null ? `${Number(client.benchmark_scope_2_tco2e).toLocaleString(undefined, { maximumFractionDigits: 1 })} tCO₂e` : "Not set"}</span></div>
              <div><span className="font-medium">Scope 3:</span> <span className="text-muted-foreground">{client?.benchmark_scope_3_tco2e != null ? `${Number(client.benchmark_scope_3_tco2e).toLocaleString(undefined, { maximumFractionDigits: 1 })} tCO₂e` : "Not set"}</span></div>
              <div><span className="font-medium">Total:</span> <span className="text-muted-foreground">{client?.benchmark_total_tco2e != null ? `${Number(client.benchmark_total_tco2e).toLocaleString(undefined, { maximumFractionDigits: 1 })} tCO₂e` : "Not set"}</span></div>
            </div>
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

  function renderSitesSection() {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Active Sites ({sites.length})</CardTitle>
              <Button
                size="sm"
                onClick={() => {
                  setShowAddSite(true);
                  setEditingSite(null);
                  setSiteForm({ site_name: "", location: "", is_registered_office: false });
                }}
              >
                + Add Site
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {showAddSite || editingSite ? (
              <div className="mb-4 space-y-3 rounded-md border p-4">
                <div className="space-y-2">
                  <Label htmlFor="clientSiteName">Site Name</Label>
                  <Input
                    id="clientSiteName"
                    value={siteForm.site_name}
                    onChange={(e) => setSiteForm({ ...siteForm, site_name: e.target.value })}
                    placeholder="Main Office"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="clientSiteLocation">Location</Label>
                  <Input
                    id="clientSiteLocation"
                    value={siteForm.location}
                    onChange={(e) => setSiteForm({ ...siteForm, location: e.target.value })}
                    placeholder="London, UK"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="clientSiteRegisteredOffice"
                    checked={siteForm.is_registered_office}
                    onChange={(e) => setSiteForm({ ...siteForm, is_registered_office: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <Label htmlFor="clientSiteRegisteredOffice" className="font-normal cursor-pointer">
                    Registered Office
                  </Label>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => (editingSite ? handleEditSite(editingSite) : handleAddSite())}>
                    {editingSite ? "Update" : "Add"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={cancelSiteEdit}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}

            {sites.length === 0 ? (
              <div className="text-sm text-muted-foreground">No active sites.</div>
            ) : (
              <div className="space-y-2">
                {sites.map((site) => (
                  <div key={site.site_id} className="rounded-md border px-3 py-2 text-sm">
                    {vacatingSite === site.site_id ? (
                      <div className="space-y-3">
                        <div className="font-medium">Vacate Site: {site.site_name}</div>
                        <div className="space-y-2">
                          <Label htmlFor="clientVacatedDate">Vacated Date</Label>
                          <Input
                            id="clientVacatedDate"
                            type="date"
                            value={vacatedDate}
                            onChange={(e) => setVacatedDate(e.target.value)}
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => handleVacateSite(site.site_id)}>
                            Confirm Vacate
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => { setVacatingSite(null); setVacatedDate(""); }}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="font-medium">
                            {site.site_name ?? ""}
                            {site.is_registered_office ? (
                              <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                                Registered Office
                              </span>
                            ) : null}
                          </div>
                          {site.location ? <div className="text-muted-foreground">{site.location}</div> : null}
                        </div>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => startEditSite(site)}>
                            Edit
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => { setVacatingSite(site.site_id); setVacatedDate(""); }}>
                            Vacate
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Vacated Sites ({vacatedSites.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {vacatedSites.length === 0 ? (
              <div className="text-sm text-muted-foreground">No vacated sites.</div>
            ) : (
              <div className="space-y-2">
                {vacatedSites.map((site) => (
                  <div key={site.site_id} className="rounded-md border px-3 py-2 text-sm bg-muted/50">
                    <div className="font-medium">
                      {site.site_name ?? ""}
                      {site.is_registered_office ? (
                        <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">
                          Registered Office
                        </span>
                      ) : null}
                    </div>
                    {site.location ? <div className="text-muted-foreground">{site.location}</div> : null}
                    {site.vacated_date ? (
                      <div className="text-sm text-muted-foreground mt-1">
                        Vacated: {new Date(site.vacated_date).toLocaleDateString("en-GB")}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  function renderFinancialSection() {
    const currencyFmt = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const showQuotes = financialView === "quotes";
    const showInvoices = financialView === "invoices";
    const showProfitLoss = financialView === "profit-loss";
    const paidInvoiceCount = invoices.filter((inv) => String(inv.status || "").toLowerCase() === "paid").length;
    const financialSummaryCaption = financialSummaryLoaded
      ? financialSummary
        ? "Profit & Loss summary ready"
        : "No financial summary data"
      : "Profit & Loss summary loading";
    const quoteLookupCaption = quoteLookupsLoaded
      ? `${quoteLookupItems.length.toLocaleString()} quote item${quoteLookupItems.length === 1 ? "" : "s"} ready`
      : "Quote item catalogue loading";

    async function convertQuoteToInvoice(quoteId: number) {
      setFinancialStatus("");
      try {
        const res = await fetch(`${baseUrl}/quotes/${quoteId}/convert-to-invoice`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            invoice_date: new Date().toISOString().slice(0, 10),
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

    return (
      <div className="space-y-6">
        <div className="rounded-2xl border bg-card/70 p-5 shadow-sm">
          <div className="space-y-1">
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">Financial workspace</div>
            <h3 className="text-2xl font-semibold tracking-tight">Quotes, invoices, and profit analysis</h3>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Keep the commercial side of the client in one place. Draft quotes, issue invoices, and compare invoiced value with estimated and actual cost.
            </p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border bg-background/80 p-3 text-right">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Quotes</div>
              <div className="text-2xl font-semibold tabular-nums">{quotes.length.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">{quotes.length === 1 ? "1 quote in the client workspace" : "Quotes available for invoicing"}</div>
            </div>
            <div className="rounded-xl border bg-background/80 p-3 text-right">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Invoices</div>
              <div className="text-2xl font-semibold tabular-nums">{invoices.length.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">{paidInvoiceCount.toLocaleString()} paid, {Math.max(invoices.length - paidInvoiceCount, 0).toLocaleString()} open</div>
            </div>
            <div className="rounded-xl border bg-background/80 p-3 text-right">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Quote items</div>
              <div className="text-2xl font-semibold tabular-nums">{quoteLookupItems.length.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">{quoteLookupCaption}</div>
            </div>
            <div className="rounded-xl border bg-background/80 p-3 text-right">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">P&L summary</div>
              <div className="text-2xl font-semibold tabular-nums">{financialSummaryLoaded ? "Ready" : "Loading"}</div>
              <div className="text-xs text-muted-foreground">{financialSummaryCaption}</div>
            </div>
          </div>
        </div>

        {showQuotes ? (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>Quotes ({quotes.length})</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={xeroInvoiceBadge.variant}>{xeroInvoiceBadge.label}</Badge>
                  <Button size="sm" asChild><Link href={`/clients/${clientId}/quotes/new`}>+ Create Quote</Link></Button>
                  <Button size="sm" variant="outline" asChild><Link href={`/clients/${clientId}/quotes`}>View All Quotes</Link></Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
                Quotes are the source of truth for invoice creation. Use a quote to prefill invoice lines or convert it directly.
              </div>
              {quotes.length === 0 ? (
                <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">No quotes yet. Create a quote to get the financial flow started.</div>
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
                          <Button variant="outline" size="sm" onClick={() => void convertQuoteToInvoice(q.quote_id)}>Convert</Button>
                          <Button variant="outline" size="sm" asChild><Link href={`/clients/${clientId}/quotes/new?quoteId=${q.quote_id}`}>Open Quote</Link></Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                Xero badges here reflect invoice sync status for this client, since quotes are converted to invoices before Xero sync.
              </div>
            </CardContent>
          </Card>
        ) : null}

        {showInvoices ? (
          <>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle>Invoices ({invoices.length})</CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={xeroInvoiceBadge.variant}>{xeroInvoiceBadge.label}</Badge>
                    <Button size="sm" asChild><Link href={`/clients/${clientId}/invoices/new`}>+ Add Invoice</Link></Button>
                    <Button size="sm" variant="outline" asChild><Link href={`/clients/${clientId}/invoices`}>View All Invoices</Link></Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {invoices.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">No invoices yet. Add one to start tracking revenue here.</div>
                ) : (
                  <div className="space-y-2">
                    {invoices.slice(0, 8).map((inv) => (
                      <div key={inv.invoice_id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                        <div>
                          <div className="font-medium">{inv.invoice_number || `#${inv.invoice_id}`}</div>
                          <div className="text-muted-foreground">
                            Date: {inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString("en-GB") : "-"} | Status: {inv.status || "-"}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="min-w-[150px] text-right font-semibold">
                            {currencyFmt.format(Number(inv.total || 0))} {inv.currency_code || client?.currency || ""}
                          </div>
                          <Button size="sm" variant="outline" asChild>
                            <Link href={`/clients/${clientId}/invoices/${inv.invoice_id}`}>Open</Link>
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle>Credit Notes ({creditNotes.length})</CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" asChild><Link href={`/clients/${clientId}/credit-notes/new`}>+ Add Credit Note</Link></Button>
                    <Button size="sm" variant="outline" asChild><Link href={`/clients/${clientId}/credit-notes`}>View All Credit Notes</Link></Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {creditNotes.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">No credit notes yet. Issue one from a specific invoice, or add a standalone one here.</div>
                ) : (
                  <div className="space-y-2">
                    {creditNotes.slice(0, 8).map((cn) => (
                      <div key={cn.credit_note_id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                        <div>
                          <div className="font-medium">{cn.credit_note_number || `#${cn.credit_note_id}`}</div>
                          <div className="text-muted-foreground">
                            Date: {cn.credit_note_date ? new Date(cn.credit_note_date).toLocaleDateString("en-GB") : "-"} | Status: {cn.status || "-"}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="min-w-[150px] text-right font-semibold">
                            {currencyFmt.format(Number(cn.total || 0))} {cn.currency_code || client?.currency || ""}
                          </div>
                          <Button size="sm" variant="outline" asChild>
                            <Link href={`/clients/${clientId}/credit-notes/${cn.credit_note_id}`}>Open</Link>
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        ) : null}

        {showProfitLoss ? (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>Profit & Loss (Estimated vs Actual)</CardTitle>
                <div className="text-xs text-muted-foreground">{financialSummaryCaption}</div>
              </div>
            </CardHeader>
            <CardContent>
              {financialSummaryLoaded && !financialSummary ? (
                <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                  No summary data is available yet. Open invoices or quotes first, then come back here for the financial comparison.
                </div>
              ) : (
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
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    );
  }

  const headerActions = clientNotFound ? (
    <>
      <Button variant="outline" asChild>
        <Link href="/clients">Back to Clients</Link>
      </Button>
      <Button variant="secondary" asChild>
        <Link href="/admin/archived-clients">View Archived Clients</Link>
      </Button>
    </>
  ) : (
    <>
      <Button asChild>
        <Link href={`/jobs/new?clientId=${clientId}`}>+ Add Job</Link>
      </Button>
      <Button variant="secondary" onClick={() => setCallPrepOpen(true)}>
        Call Prep
      </Button>
      <Button variant="secondary" asChild>
        <Link href={`/clients/${clientId}/edit`}>Edit Client</Link>
      </Button>
      <Button variant="secondary" asChild>
        <Link href={`/clients/${clientId}/quotes/new`}>Create Quote</Link>
      </Button>
      <Button variant="outline" asChild>
        <Link href="/clients">Back to Clients</Link>
      </Button>
    </>
  );

  function renderOverviewSection() {
    const activeJobsCount = jobs.filter((j) => String(j.status || "").toLowerCase() !== "completed" && String(j.status || "").toLowerCase() !== "archived").length;
    const unpaidInvoiceCount = invoices.filter((inv) => String(inv.status || "").toLowerCase() !== "paid" && String(inv.status || "").toLowerCase() !== "void").length;
    const outstandingInvoicesTotal = financialSummary?.invoices.outstanding_total ?? 0;
    const currencyFmt = new Intl.NumberFormat("en-GB", { style: "currency", currency: client?.currency || "GBP", minimumFractionDigits: 2 });
    const primaryContact = contacts.find((c) => c.is_primary) ?? contacts[0] ?? null;

    const commJobs = (jobs || []).map((j) => ({
      ...j,
      job_number: j.job_number ?? `Job ${j.job_id}`,
      job_title: j.title ?? null,
    }));

    return (
      <div className="space-y-6">
        {/* Active Jobs table — full width */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base font-semibold">Active Jobs & Milestone Progress</CardTitle>
            <Badge variant="outline" className="border-green-200 bg-green-50 text-green-800">
              {activeJobsCount} active
            </Badge>
          </CardHeader>
          <CardContent className="pt-4">
            <ClientJobsTable jobs={jobs} loading={jobsLoading} error={jobsError} />
          </CardContent>
        </Card>

        {/* Financial Summary Card — full width */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base font-semibold">Financial & Billing Status</CardTitle>
            <Badge variant={unpaidInvoiceCount > 0 ? "destructive" : "outline"} className="border-orange-200">
              {unpaidInvoiceCount} open invoices
            </Badge>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 gap-4 pb-4 border-b border-slate-100">
              <div>
                <div className="text-xs text-muted-foreground uppercase">Outstanding Balance</div>
                <div className="text-2xl font-bold tracking-tight text-slate-950 mt-1">
                  {currencyFmt.format(outstandingInvoicesTotal)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground uppercase">Realization Rate</div>
                <div className="text-2xl font-bold tracking-tight text-emerald-700 mt-1">
                  {Number(financialSummary?.analysis.realization_pct || 100).toFixed(1)}%
                </div>
              </div>
            </div>
            <div className="pt-4 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Total Quotes:</span>
                <span className="font-semibold text-slate-800">{quotes.length} quotes</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Logged Consultant Time:</span>
                <span className="font-semibold text-slate-800">
                  {Number(financialSummary?.analysis.logged_hours || 0).toFixed(1)} hours
                </span>
              </div>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setSection("financial")}
                  className="text-xs text-[#1c5026] hover:underline font-medium"
                >
                  Open Financials →
                </button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Row 2: Client Portal Access + CRM Owner quick-info */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Portal Access Status */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-base font-semibold">Client Portal & Contacts</CardTitle>
              <button
                type="button"
                onClick={() => { setSection("profile"); setActiveProfileSubTab("contacts"); }}
                className="text-xs text-[#1c5026] hover:underline font-medium"
              >
                Manage →
              </button>
            </CardHeader>
            <CardContent className="space-y-3">
              {contacts.length === 0 ? (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  No contacts yet.{" "}
                  <button
                    type="button"
                    onClick={() => { setSection("profile"); setActiveProfileSubTab("contacts"); }}
                    className="underline"
                  >
                    Add a contact
                  </button>{" "}
                  to assign portal access.
                </div>
              ) : (
                <>
                  <div className="rounded-lg border border-slate-100 bg-slate-50/50 px-4 py-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Portal Status</span>
                      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
                        Setup in Admin
                      </Badge>
                    </div>
                    {primaryContact ? (
                      <div className="mt-2 text-xs text-muted-foreground">
                        Primary: <span className="font-medium text-slate-900">{primaryContact.full_name}</span>
                        {primaryContact.email ? ` — ${primaryContact.email}` : ""}
                      </div>
                    ) : null}
                  </div>
                  <div className="divide-y divide-slate-100">
                    {contacts.slice(0, 4).map((c) => (
                      <div key={c.contact_id} className="flex items-center justify-between py-2">
                        <div className="space-y-0.5">
                          <div className="text-sm font-medium text-slate-900">{c.full_name}</div>
                          <div className="text-xs text-muted-foreground">{c.email || "No email"}</div>
                        </div>
                        {c.is_primary ? (
                          <Badge className="bg-[#1c5026] text-white hover:bg-[#153f1e] text-xs">Primary</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">Contact</Badge>
                        )}
                      </div>
                    ))}
                    {contacts.length > 4 ? (
                      <div className="pt-2 text-xs text-muted-foreground">
                        +{contacts.length - 4} more —{" "}
                        <button
                          type="button"
                          onClick={() => { setSection("profile"); setActiveProfileSubTab("contacts"); }}
                          className="underline"
                        >
                          view all
                        </button>
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* CRM Quick-info */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-base font-semibold">Account Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border bg-slate-50/50 px-3 py-2.5">
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">CRM Owner</div>
                  <div className="mt-1 font-semibold text-[#1c5026]">{client?.crm_owner ?? "Unassigned"}</div>
                </div>
                <div className="rounded-lg border bg-slate-50/50 px-3 py-2.5">
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Net Zero Target</div>
                  <div className="mt-1 font-semibold text-slate-800">{client?.net_zero_year ?? "Not set"}</div>
                </div>
                <div className="rounded-lg border bg-slate-50/50 px-3 py-2.5">
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Industry</div>
                  <div className="mt-1 font-medium text-slate-700 truncate">{client?.industry ?? "—"}</div>
                </div>
                <div className="rounded-lg border bg-slate-50/50 px-3 py-2.5">
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">Sites</div>
                  <div className="mt-1 font-semibold text-slate-800">{sites.length}</div>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setSection("profile")}
                  className="text-xs text-[#1c5026] hover:underline font-medium"
                >
                  Company Profile →
                </button>
                <span className="text-muted-foreground">·</span>
                <Link
                  href={`/clients/${clientId}/edit`}
                  className="text-xs text-[#1c5026] hover:underline font-medium"
                >
                  Edit Details →
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Row 3: Communications shortcut */}
        <Card>
          <CardContent className="flex items-center justify-between py-4">
            <div>
              <div className="text-sm font-semibold text-slate-900">Communications & Activity</div>
              <div className="text-xs text-muted-foreground mt-0.5">Touchpoints, logged communications, tasks, and automation</div>
            </div>
            <button
              type="button"
              onClick={() => setSection("timeline")}
              className="text-sm font-medium text-[#1c5026] hover:underline"
            >
              Open Communications →
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  function renderProfileSection() {
    // Subtab switching now lives in ClientWorkspaceLeftNav; this just renders
    // whichever subtab's content is currently active.
    return (
      <div className="space-y-6">
        {activeProfileSubTab === "details" && renderDetailsSection()}
        {activeProfileSubTab === "contacts" && renderContactsSection()}
        {activeProfileSubTab === "sites" && renderSitesSection()}
        {activeProfileSubTab === "custom-fields" && (
          <CustomFields entityId={clientId} entityType="client" baseUrl={baseUrl} />
        )}
      </div>
    );
  }

  function renderActiveSection() {
    if (activeSection === "overview") return renderOverviewSection();
    if (activeSection === "carbon" || activeSection === "dashboard") {
      return <ClientDashboard clientId={clientId} baseUrl={baseUrl} />;
    }
    if (activeSection === "profile") return renderProfileSection();
    if (activeSection === "financial") return renderFinancialSection();

    // Fallbacks for direct legacy URL states
    if (activeSection === "timeline") {
      const commJobs = (jobs || []).map((j) => ({
        ...j,
        job_number: j.job_number ?? `Job ${j.job_id}`,
        job_title: j.title ?? null,
      }));
      return <ClientCommunications clientId={clientId} baseUrl={baseUrl} jobs={commJobs} />;
    }
    if (activeSection === "notes") {
      const noteJobs = (jobs || []).map((j) => ({
        ...j,
        job_number: j.job_number ?? `Job ${j.job_id}`,
        job_title: j.title ?? null,
      }));
      return <ClientNotesSummary clientId={clientId} baseUrl={baseUrl} jobs={noteJobs} />;
    }
    if (activeSection === "tasks") {
      return <TasksTable clientId={clientId} baseUrl={baseUrl} title="Client Tasks" />;
    }
    if (activeSection === "files") {
      return <ClientFiles clientId={clientId} baseUrl={baseUrl} />;
    }
    if (activeSection === "details") return renderDetailsSection();
    if (activeSection === "sites") return renderSitesSection();
    if (activeSection === "contacts") return renderContactsSection();
    if (activeSection === "jobs") return <ClientJobsSection loading={jobsLoading || !jobsLoaded} jobs={jobs} />;
    if (activeSection === "reporting") return <ClientReporting clientId={clientId} baseUrl={baseUrl} />;
    if (activeSection === "actions") return <ClientActions clientDbId={clientId} baseUrl={baseUrl} />;
    if (activeSection === "srs-readiness") return <ClientSrsReadiness clientDbId={clientId} baseUrl={baseUrl} />;
    if (activeSection === "portal") return <ClientPortalManagement clientId={clientId} baseUrl={baseUrl} />;
    if (activeSection === "custom-fields") return <CustomFields entityId={clientId} entityType="client" baseUrl={baseUrl} />;
    if (activeSection === "ai-profile") return <ClientAiProfile clientId={clientId} clientName={client?.client_name} clientWebsite={client?.website} baseUrl={baseUrl} />;
    return renderFinancialSection();
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <PageHeader
          title={clientNotFound ? "Client Not Found" : client?.client_name ?? "Client"}
          subtitle={`Client ID: ${Number.isFinite(clientId) ? clientId : "-"}`}
          breadcrumbs={[{ label: "Clients", href: "/clients" }, { label: clientNotFound ? "Not Found" : client?.client_name ?? "Client" }]}
          titleSuffix={client?.status ? <StatusBadge status={client.status} /> : undefined}
          actions={headerActions}
        />

        {clientNotFound ? (
          <Card className="mb-6 border-amber-200 bg-amber-50/40">
            <CardHeader>
              <CardTitle>Client Not Found</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                This client record is no longer available in the live database. It may have been deleted or archived.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <Link href="/clients">Back to Clients</Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/admin/archived-clients">View Archived Clients</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
        {error && !clientNotFound ? <div className="mb-4 text-sm text-destructive">{error}</div> : null}
        {loading ? <div className="mb-4 text-sm text-muted-foreground">Loading...</div> : null}

        {!clientNotFound ? (
          <div className="mt-4 flex items-start gap-6">
            <ClientWorkspaceLeftNav
              activeSection={activeSection}
              activeProfileSubTab={activeProfileSubTab}
              financialView={financialView}
              openTaskCount={openTaskCount}
              onSectionChange={(section) => setSection(section as ClientSection)}
              onProfileSubTabChange={(subtab) => setActiveProfileSubTab(subtab as ProfileSubSection)}
              onFinancialViewChange={(view) => setFinancialView(view as FinancialView)}
            />
            <div className="min-w-0 flex-1">
              {clientLogoSrc ? (
                <div className="mb-4 flex justify-end">
                  <div className="flex items-center justify-center rounded-lg border bg-white px-3 py-1">
                    <img
                      src={clientLogoSrc}
                      alt={`${client?.client_name || "Client"} logo`}
                      className="max-h-8 max-w-[100px] object-contain"
                      loading="lazy"
                    />
                  </div>
                </div>
              ) : null}
              {renderActiveSection()}
            </div>
          </div>
        ) : null}

        <CallPrepPanel
          open={callPrepOpen}
          onOpenChange={setCallPrepOpen}
          baseUrl={baseUrl}
          clientDbId={Number.isFinite(clientId) ? clientId : null}
          clientName={client?.client_name ?? undefined}
        />
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
