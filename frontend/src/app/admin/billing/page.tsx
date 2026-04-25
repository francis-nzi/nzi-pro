"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseApiError, type OrgCapacityErrorInfo } from "@/lib/org-capacity-errors";

function apiBaseUrl(): string {
  return "/api/backend";
}

type OrganisationRoleCapabilities = {
  can_manage_billing?: boolean;
  can_manage_organisation?: boolean;
  role?: string | null;
};

type OrganisationUsage = {
  org_id?: string | null;
  plan?: string | null;
  plan_status?: string | null;
  archived?: boolean | null;
  max_users?: number | null;
  max_clients?: number | null;
  active_members?: number | null;
  pending_invites?: number | null;
  active_clients?: number | null;
};

type Organisation = {
  org_id: string;
  name: string;
  slug: string;
  plan?: string | null;
  plan_status?: string | null;
  max_users?: number | null;
  max_clients?: number | null;
  archived?: boolean | null;
  updated_at?: string | null;
  usage?: OrganisationUsage | null;
  entitlement?: {
    plan?: string | null;
    plan_status?: string | null;
    max_users?: number | null;
    max_clients?: number | null;
    trial_ends_at?: string | null;
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
    subscription_status?: string | null;
    current_period_start?: string | null;
    current_period_end?: string | null;
    auto_renew?: boolean | null;
  } | null;
};

type OrganisationBillingInvoice = {
  billing_invoice_id: string;
  org_id: string;
  invoice_number: string;
  status?: string | null;
  amount_cents?: number | null;
  currency?: string | null;
  description?: string | null;
  invoice_date?: string | null;
  due_date?: string | null;
  paid_at?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  payment_reference?: string | null;
  stripe_invoice_id?: string | null;
  stripe_payment_intent_id?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type OrganisationBillingEvent = {
  billing_event_id: string;
  org_id: string;
  billing_invoice_id?: string | null;
  event_type?: string | null;
  source?: string | null;
  status?: string | null;
  amount_cents?: number | null;
  currency?: string | null;
  reference?: string | null;
  notes?: string | null;
  effective_at?: string | null;
  created_at?: string | null;
};

type OrganisationsResponse = {
  items?: Organisation[];
  active_org_id?: string | null;
  current_capabilities?: OrganisationRoleCapabilities | null;
  current_entitlement?: Organisation["entitlement"] | null;
  current_usage?: OrganisationUsage | null;
};

type OrganisationBillingResponse = {
  organisation?: Organisation | null;
  entitlement?: Organisation["entitlement"] | null;
  billing?: {
    role?: string | null;
    capabilities?: OrganisationRoleCapabilities | null;
    invoices?: OrganisationBillingInvoice[];
    events?: OrganisationBillingEvent[];
  } | null;
};

type BillingInvoiceForm = {
  invoice_number: string;
  status: string;
  amount: string;
  currency: string;
  description: string;
  invoice_date: string;
  due_date: string;
  paid_at: string;
  period_start: string;
  period_end: string;
  payment_reference: string;
  stripe_invoice_id: string;
  stripe_payment_intent_id: string;
};

type BillingEventForm = {
  event_type: string;
  source: string;
  status: string;
  amount: string;
  currency: string;
  reference: string;
  notes: string;
  billing_invoice_id: string;
  effective_at: string;
};

const DEFAULT_BILLING_INVOICE_FORM: BillingInvoiceForm = {
  invoice_number: "",
  status: "draft",
  amount: "0.00",
  currency: "GBP",
  description: "",
  invoice_date: "",
  due_date: "",
  paid_at: "",
  period_start: "",
  period_end: "",
  payment_reference: "",
  stripe_invoice_id: "",
  stripe_payment_intent_id: "",
};

const DEFAULT_BILLING_EVENT_FORM: BillingEventForm = {
  event_type: "note",
  source: "manual",
  status: "recorded",
  amount: "0.00",
  currency: "GBP",
  reference: "",
  notes: "",
  billing_invoice_id: "",
  effective_at: "",
};

const BILLING_INVOICE_STATUSES = ["draft", "issued", "paid", "overdue", "void", "refunded"] as const;
const BILLING_EVENT_TYPES = [
  "note",
  "invoice_created",
  "invoice_issued",
  "payment_received",
  "payment_failed",
  "subscription_created",
  "subscription_updated",
  "subscription_canceled",
  "renewal",
  "reminder_sent",
] as const;

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("en-GB");
}

function formatMoney(cents?: number | null, currency?: string | null): string {
  const nextCurrency = currency || "GBP";
  const amount = Number(cents || 0) / 100;
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: nextCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${nextCurrency} ${amount.toFixed(2)}`;
  }
}

function formatLimitUsage(used?: number | null, limit?: number | null): string {
  const usedValue = Number(used || 0);
  const limitValue = Number(limit || 0);
  if (!Number.isFinite(limitValue) || limitValue <= 0) return `${usedValue}`;
  return `${usedValue}/${limitValue}`;
}

function usagePercent(used?: number | null, limit?: number | null): number | null {
  const usedValue = Number(used || 0);
  const limitValue = Number(limit || 0);
  if (!Number.isFinite(limitValue) || limitValue <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((usedValue / limitValue) * 100)));
}

export default function BillingPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [currentCapabilities, setCurrentCapabilities] = useState<OrganisationRoleCapabilities | null>(null);
  const [currentEntitlement, setCurrentEntitlement] = useState<Organisation["entitlement"] | null>(null);
  const [currentUsage, setCurrentUsage] = useState<OrganisationUsage | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billing, setBilling] = useState<OrganisationBillingResponse["billing"] | null>(null);
  const [billingSaving, setBillingSaving] = useState<string | null>(null);
  const [billingInvoiceForm, setBillingInvoiceForm] = useState<BillingInvoiceForm>(DEFAULT_BILLING_INVOICE_FORM);
  const [billingEventForm, setBillingEventForm] = useState<BillingEventForm>(DEFAULT_BILLING_EVENT_FORM);
  const [capacityError, setCapacityError] = useState<OrgCapacityErrorInfo | null>(null);

  const selectedOrg = useMemo(
    () => organisations.find((org) => org.org_id === selectedOrgId) || null,
    [organisations, selectedOrgId]
  );
  const canManageBilling = Boolean(selectedOrg?.entitlement || currentCapabilities?.can_manage_billing);

  function setApiError(detail: unknown, fallback: string): string {
    const parsed = parseApiError(detail, fallback);
    setCapacityError(parsed.capacity || null);
    setError(parsed.message);
    return parsed.message;
  }

  const loadOrganisations = useCallback(async () => {
    setLoading(true);
    setError("");
    setCapacityError(null);
    try {
      const res = await fetch(`${baseUrl}/admin/organisations`, { credentials: "include" });
      const payload = (await res.json().catch(() => ({}))) as OrganisationsResponse;
      if (!res.ok) {
        const detail = (payload as { detail?: unknown }).detail;
        throw new Error(setApiError(detail, "Failed to load organisations"));
      }
      const items = Array.isArray(payload.items) ? payload.items : [];
      setOrganisations(items);
      setCurrentCapabilities(payload.current_capabilities || null);
      setCurrentEntitlement(payload.current_entitlement || null);
      setCurrentUsage(payload.current_usage || null);
      const nextActive = payload.active_org_id || items.find((item) => item.org_id === payload.active_org_id)?.org_id || items[0]?.org_id || null;
      setActiveOrgId(nextActive);
      setSelectedOrgId((current) => current || nextActive);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  const loadBilling = useCallback(async (orgId: string | null) => {
    if (!orgId) {
      setBilling(null);
      return;
    }
    setBillingLoading(true);
    try {
      const res = await fetch(`${baseUrl}/admin/organisations/${encodeURIComponent(orgId)}/billing`, {
        credentials: "include",
      });
      const payload = (await res.json().catch(() => ({}))) as OrganisationBillingResponse;
      if (!res.ok) {
        const detail = (payload as { detail?: unknown }).detail;
        throw new Error(setApiError(detail, "Failed to load organisation billing"));
      }
      setBilling(payload.billing || null);
    } catch (e) {
      setBilling(null);
      setError((e as Error).message);
    } finally {
      setBillingLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    void loadOrganisations();
  }, [loadOrganisations]);

  useEffect(() => {
    void loadBilling(selectedOrg?.org_id || null);
  }, [loadBilling, selectedOrg?.org_id]);

  function updateBillingInvoiceForm<K extends keyof BillingInvoiceForm>(key: K, value: BillingInvoiceForm[K]) {
    setBillingInvoiceForm((current) => ({ ...current, [key]: value }));
  }

  function updateBillingEventForm<K extends keyof BillingEventForm>(key: K, value: BillingEventForm[K]) {
    setBillingEventForm((current) => ({ ...current, [key]: value }));
  }

  async function saveBillingInvoice() {
    if (!selectedOrg?.org_id) {
      setError("Select an organisation first.");
      return;
    }
    setBillingSaving("invoice");
    setError("");
    setCapacityError(null);
    setStatus("Saving billing invoice...");
    try {
      const payload = {
        invoice_number: billingInvoiceForm.invoice_number.trim(),
        status: billingInvoiceForm.status.trim() || "draft",
        amount: billingInvoiceForm.amount.trim(),
        currency: billingInvoiceForm.currency.trim() || "GBP",
        description: billingInvoiceForm.description.trim(),
        invoice_date: billingInvoiceForm.invoice_date || null,
        due_date: billingInvoiceForm.due_date || null,
        paid_at: billingInvoiceForm.paid_at || null,
        period_start: billingInvoiceForm.period_start || null,
        period_end: billingInvoiceForm.period_end || null,
        payment_reference: billingInvoiceForm.payment_reference.trim(),
        stripe_invoice_id: billingInvoiceForm.stripe_invoice_id.trim(),
        stripe_payment_intent_id: billingInvoiceForm.stripe_payment_intent_id.trim(),
      };
      const res = await fetch(`${baseUrl}/admin/organisations/${encodeURIComponent(selectedOrg.org_id)}/billing/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = (body as { detail?: unknown }).detail;
        throw new Error(setApiError(detail, "Unable to save billing invoice"));
      }
      setBillingInvoiceForm(DEFAULT_BILLING_INVOICE_FORM);
      setStatus("Billing invoice saved.");
      await loadBilling(selectedOrg.org_id);
      setTimeout(() => setStatus(""), 2500);
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setBillingSaving(null);
    }
  }

  async function saveBillingEvent() {
    if (!selectedOrg?.org_id) {
      setError("Select an organisation first.");
      return;
    }
    setBillingSaving("event");
    setError("");
    setCapacityError(null);
    setStatus("Recording billing event...");
    try {
      const payload = {
        event_type: billingEventForm.event_type.trim() || "note",
        source: billingEventForm.source.trim() || "manual",
        status: billingEventForm.status.trim() || "recorded",
        amount: billingEventForm.amount.trim(),
        currency: billingEventForm.currency.trim() || "GBP",
        reference: billingEventForm.reference.trim(),
        notes: billingEventForm.notes.trim(),
        billing_invoice_id: billingEventForm.billing_invoice_id.trim(),
        effective_at: billingEventForm.effective_at || null,
        payload: {
          source: "billing-admin",
        },
      };
      const res = await fetch(`${baseUrl}/admin/organisations/${encodeURIComponent(selectedOrg.org_id)}/billing/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = (body as { detail?: unknown }).detail;
        throw new Error(setApiError(detail, "Unable to save billing event"));
      }
      setBillingEventForm(DEFAULT_BILLING_EVENT_FORM);
      setStatus("Billing event recorded.");
      await loadBilling(selectedOrg.org_id);
      setTimeout(() => setStatus(""), 2500);
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setBillingSaving(null);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold" style={{ color: "#F26624" }}>
                Billing & Entitlements
              </h1>
              {activeOrgId ? <Badge variant="outline">Active: {activeOrgId}</Badge> : null}
            </div>
            <p className="text-muted-foreground">
              Review plan status, usage limits, invoices, and billing events for the selected organisation.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" asChild>
              <Link href="/admin/organisations">Organisations</Link>
            </Button>
            <Button variant="secondary" asChild>
              <Link href="/admin">Back to Admin</Link>
            </Button>
          </div>
        </div>

        {error ? (
          <div className="mb-4 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
            <div className="font-medium">{error}</div>
            {capacityError ? (
              <div className="mt-2 flex flex-col gap-2 text-sm text-destructive/90 md:flex-row md:items-center md:justify-between">
                <div>
                  {capacityError.helpText ? <div>{capacityError.helpText}</div> : null}
                  {capacityError.limitValue != null || capacityError.currentValue != null ? (
                    <div className="mt-1 text-xs text-destructive/80">
                      {capacityError.limitType === "users" ? "Users" : capacityError.limitType === "clients" ? "Clients" : "Usage"}:
                      {" "}
                      {capacityError.currentValue ?? "-"}
                      {capacityError.limitValue != null ? ` / ${capacityError.limitValue}` : ""}
                    </div>
                  ) : null}
                </div>
                {capacityError.ctaHref ? (
                  <Button asChild size="sm" variant="secondary">
                    <Link href={capacityError.ctaHref}>{capacityError.ctaLabel || "Open Admin"}</Link>
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {status ? <div className="mb-4 rounded-md bg-muted p-3 text-sm">{status}</div> : null}

        <Card className="mb-6 border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle>Billing Overview</CardTitle>
            <CardDescription>
              Choose an organisation and review its current entitlement and usage in one place.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 text-sm">
            <div className="rounded-lg border bg-background p-4 space-y-2">
              <div className="font-medium">Plan</div>
              <p className="text-muted-foreground">
                {selectedOrg?.entitlement?.plan || currentEntitlement?.plan || selectedOrg?.plan || "trial"}
              </p>
            </div>
            <div className="rounded-lg border bg-background p-4 space-y-2">
              <div className="font-medium">Subscription</div>
              <p className="text-muted-foreground">
                {selectedOrg?.entitlement?.subscription_status || currentEntitlement?.subscription_status || selectedOrg?.plan_status || "active"}
              </p>
            </div>
            <div className="rounded-lg border bg-background p-4 space-y-2">
              <div className="font-medium">Users</div>
              <p className="text-muted-foreground">
                {formatLimitUsage(selectedOrg?.usage?.active_members ?? currentUsage?.active_members, selectedOrg?.usage?.max_users ?? currentUsage?.max_users)}
                {selectedOrg?.usage?.pending_invites || currentUsage?.pending_invites ? ` + ${selectedOrg?.usage?.pending_invites ?? currentUsage?.pending_invites} pending` : ""}
              </p>
            </div>
            <div className="rounded-lg border bg-background p-4 space-y-2">
              <div className="font-medium">Clients</div>
              <p className="text-muted-foreground">
                {formatLimitUsage(selectedOrg?.usage?.active_clients ?? currentUsage?.active_clients, selectedOrg?.usage?.max_clients ?? currentUsage?.max_clients)}
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[280px_1fr]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Organisations</CardTitle>
              <CardDescription>Select an organisation for detailed billing.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {loading ? (
                <div className="text-sm text-muted-foreground">Loading organisations...</div>
              ) : organisations.length === 0 ? (
                <div className="text-sm text-muted-foreground">No organisations found.</div>
              ) : (
                organisations.map((org) => {
                  const isSelected = org.org_id === selectedOrgId;
                  return (
                    <Button
                      key={org.org_id}
                      variant={isSelected ? "default" : "outline"}
                      className="w-full justify-between"
                      onClick={() => setSelectedOrgId(org.org_id)}
                    >
                      <span>{org.name}</span>
                      <span className="text-xs opacity-75">{org.usage?.active_clients ?? 0} clients</span>
                    </Button>
                  );
                })
              )}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Selected Organisation</CardTitle>
                <CardDescription>Current entitlement and capacity summary for the selected tenant.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>Selected org: {selectedOrg?.name || "-"}</div>
                <div>Selected org id: {selectedOrg?.org_id || "-"}</div>
                <div>Entitlement status: {selectedOrg?.entitlement?.subscription_status || currentEntitlement?.subscription_status || selectedOrg?.plan_status || "-"}</div>
                <div>
                  Billing usage: {formatLimitUsage(selectedOrg?.usage?.active_members ?? currentUsage?.active_members, selectedOrg?.usage?.max_users ?? currentUsage?.max_users)} users
                  {selectedOrg?.usage?.pending_invites || currentUsage?.pending_invites ? ` + ${selectedOrg?.usage?.pending_invites ?? currentUsage?.pending_invites} pending` : ""} |{" "}
                  {formatLimitUsage(selectedOrg?.usage?.active_clients ?? currentUsage?.active_clients, selectedOrg?.usage?.max_clients ?? currentUsage?.max_clients)} clients
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-md border bg-background p-3">
                    <div className="text-xs font-semibold uppercase text-muted-foreground">Users</div>
                    <div className="mt-1 text-lg font-semibold">
                      {formatLimitUsage(selectedOrg?.usage?.active_members ?? currentUsage?.active_members, selectedOrg?.usage?.max_users ?? currentUsage?.max_users)}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {selectedOrg?.usage?.pending_invites ?? currentUsage?.pending_invites ?? 0} pending invites
                    </div>
                  </div>
                  <div className="rounded-md border bg-background p-3">
                    <div className="text-xs font-semibold uppercase text-muted-foreground">Clients</div>
                    <div className="mt-1 text-lg font-semibold">
                      {formatLimitUsage(selectedOrg?.usage?.active_clients ?? currentUsage?.active_clients, selectedOrg?.usage?.max_clients ?? currentUsage?.max_clients)}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {usagePercent(selectedOrg?.usage?.active_clients ?? currentUsage?.active_clients, selectedOrg?.usage?.max_clients ?? currentUsage?.max_clients) != null
                        ? `${usagePercent(selectedOrg?.usage?.active_clients ?? currentUsage?.active_clients, selectedOrg?.usage?.max_clients ?? currentUsage?.max_clients)}% of limit`
                        : "No limit set"}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  Plan: {selectedOrg?.entitlement?.plan || currentEntitlement?.plan || selectedOrg?.plan || "trial"}
                  {selectedOrg?.entitlement?.stripe_subscription_id || currentEntitlement?.stripe_subscription_id
                    ? ` | Subscription: ${selectedOrg?.entitlement?.stripe_subscription_id || currentEntitlement?.stripe_subscription_id}`
                    : ""}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Billing & Payments</CardTitle>
                <CardDescription>Track org invoices, payment events, and subscription lifecycle history.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {!selectedOrg ? (
                  <div className="text-sm text-muted-foreground">Select an organisation to view billing history.</div>
                ) : billingLoading ? (
                  <div className="text-sm text-muted-foreground">Loading billing history...</div>
                ) : (
                  <>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-semibold">Invoices</div>
                          <div className="text-xs text-muted-foreground">Latest org invoices and payment state.</div>
                        </div>
                        <Badge variant="outline">{billing?.invoices?.length || 0} records</Badge>
                      </div>
                      {billing?.invoices?.length ? (
                        <div className="space-y-2">
                          {billing.invoices.map((invoice) => (
                            <div key={invoice.billing_invoice_id} className="rounded-md border p-3 text-sm">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="font-medium">
                                  {invoice.invoice_number} · {formatMoney(invoice.amount_cents, invoice.currency)}
                                </div>
                                <Badge variant={invoice.status === "paid" ? "secondary" : "outline"}>{invoice.status || "draft"}</Badge>
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {invoice.description || "No description"} | Issued: {formatDate(invoice.invoice_date)} | Due: {formatDate(invoice.due_date)}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                Paid: {formatDate(invoice.paid_at)} | Period: {formatDate(invoice.period_start)} to {formatDate(invoice.period_end)}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                Payment ref: {invoice.payment_reference || "-"} | Stripe invoice: {invoice.stripe_invoice_id || "-"}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">No billing invoices found.</div>
                      )}
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-semibold">Billing events</div>
                          <div className="text-xs text-muted-foreground">Subscription and payment lifecycle notes.</div>
                        </div>
                        <Badge variant="outline">{billing?.events?.length || 0} records</Badge>
                      </div>
                      {billing?.events?.length ? (
                        <div className="space-y-2">
                          {billing.events.map((event) => (
                            <div key={event.billing_event_id} className="rounded-md border p-3 text-sm">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="font-medium">{event.event_type || "note"}</div>
                                <Badge variant="secondary">{event.status || "recorded"}</Badge>
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {formatMoney(event.amount_cents, event.currency)} | {event.source || "manual"} | {formatDate(event.effective_at || event.created_at)}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {event.reference || "-"}{event.notes ? ` · ${event.notes}` : ""}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">No billing events found.</div>
                      )}
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="space-y-4 rounded-md border p-4">
                        <div>
                          <div className="text-sm font-semibold">Create invoice</div>
                          <div className="text-xs text-muted-foreground">Record a new org invoice or payment milestone.</div>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor="billing-invoice-number">Invoice number</Label>
                            <Input id="billing-invoice-number" value={billingInvoiceForm.invoice_number} onChange={(e) => updateBillingInvoiceForm("invoice_number", e.target.value)} placeholder="INV-2026-001" disabled={!canManageBilling} />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="billing-invoice-status">Status</Label>
                            <Select value={billingInvoiceForm.status} onValueChange={(value) => updateBillingInvoiceForm("status", value)} disabled={!canManageBilling}>
                              <SelectTrigger id="billing-invoice-status">
                                <SelectValue placeholder="draft" />
                              </SelectTrigger>
                              <SelectContent>
                                {BILLING_INVOICE_STATUSES.map((status) => (
                                  <SelectItem key={status} value={status}>
                                    {status}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="billing-invoice-amount">Amount</Label>
                            <Input id="billing-invoice-amount" value={billingInvoiceForm.amount} onChange={(e) => updateBillingInvoiceForm("amount", e.target.value)} placeholder="1250.00" disabled={!canManageBilling} />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="billing-invoice-currency">Currency</Label>
                            <Input id="billing-invoice-currency" value={billingInvoiceForm.currency} onChange={(e) => updateBillingInvoiceForm("currency", e.target.value)} placeholder="GBP" disabled={!canManageBilling} />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="billing-invoice-description">Description</Label>
                          <Input id="billing-invoice-description" value={billingInvoiceForm.description} onChange={(e) => updateBillingInvoiceForm("description", e.target.value)} placeholder="Monthly subscription invoice" disabled={!canManageBilling} />
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor="billing-invoice-date">Invoice date</Label>
                            <Input id="billing-invoice-date" type="date" value={billingInvoiceForm.invoice_date} onChange={(e) => updateBillingInvoiceForm("invoice_date", e.target.value)} disabled={!canManageBilling} />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="billing-invoice-due-date">Due date</Label>
                            <Input id="billing-invoice-due-date" type="date" value={billingInvoiceForm.due_date} onChange={(e) => updateBillingInvoiceForm("due_date", e.target.value)} disabled={!canManageBilling} />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="billing-invoice-paid-at">Paid at</Label>
                            <Input id="billing-invoice-paid-at" type="date" value={billingInvoiceForm.paid_at} onChange={(e) => updateBillingInvoiceForm("paid_at", e.target.value)} disabled={!canManageBilling} />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="billing-invoice-period-start">Period start</Label>
                            <Input id="billing-invoice-period-start" type="date" value={billingInvoiceForm.period_start} onChange={(e) => updateBillingInvoiceForm("period_start", e.target.value)} disabled={!canManageBilling} />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="billing-invoice-period-end">Period end</Label>
                            <Input id="billing-invoice-period-end" type="date" value={billingInvoiceForm.period_end} onChange={(e) => updateBillingInvoiceForm("period_end", e.target.value)} disabled={!canManageBilling} />
                          </div>
                        </div>
                        <div className="grid gap-3 md:grid-cols-3">
                          <div className="space-y-2">
                            <Label htmlFor="billing-invoice-payment-reference">Payment reference</Label>
                            <Input id="billing-invoice-payment-reference" value={billingInvoiceForm.payment_reference} onChange={(e) => updateBillingInvoiceForm("payment_reference", e.target.value)} disabled={!canManageBilling} />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="billing-invoice-stripe-id">Stripe invoice</Label>
                            <Input id="billing-invoice-stripe-id" value={billingInvoiceForm.stripe_invoice_id} onChange={(e) => updateBillingInvoiceForm("stripe_invoice_id", e.target.value)} disabled={!canManageBilling} />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="billing-invoice-payment-intent">Payment intent</Label>
                            <Input id="billing-invoice-payment-intent" value={billingInvoiceForm.stripe_payment_intent_id} onChange={(e) => updateBillingInvoiceForm("stripe_payment_intent_id", e.target.value)} disabled={!canManageBilling} />
                          </div>
                        </div>
                        <Button onClick={() => void saveBillingInvoice()} disabled={!canManageBilling || billingSaving === "invoice"}>
                          {billingSaving === "invoice" ? "Saving..." : "Save invoice"}
                        </Button>
                      </div>

                      <div className="space-y-4 rounded-md border p-4">
                        <div>
                          <div className="text-sm font-semibold">Record event</div>
                          <div className="text-xs text-muted-foreground">Log lifecycle events such as payments or renewals.</div>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor="billing-event-type">Event type</Label>
                            <Select value={billingEventForm.event_type} onValueChange={(value) => updateBillingEventForm("event_type", value)} disabled={!canManageBilling}>
                              <SelectTrigger id="billing-event-type">
                                <SelectValue placeholder="note" />
                              </SelectTrigger>
                              <SelectContent>
                                {BILLING_EVENT_TYPES.map((eventType) => (
                                  <SelectItem key={eventType} value={eventType}>
                                    {eventType}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="billing-event-status">Status</Label>
                            <Input id="billing-event-status" value={billingEventForm.status} onChange={(e) => updateBillingEventForm("status", e.target.value)} disabled={!canManageBilling} />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="billing-event-source">Source</Label>
                            <Input id="billing-event-source" value={billingEventForm.source} onChange={(e) => updateBillingEventForm("source", e.target.value)} disabled={!canManageBilling} />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="billing-event-amount">Amount</Label>
                            <Input id="billing-event-amount" value={billingEventForm.amount} onChange={(e) => updateBillingEventForm("amount", e.target.value)} disabled={!canManageBilling} />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="billing-event-currency">Currency</Label>
                            <Input id="billing-event-currency" value={billingEventForm.currency} onChange={(e) => updateBillingEventForm("currency", e.target.value)} disabled={!canManageBilling} />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="billing-event-ref">Reference</Label>
                            <Input id="billing-event-ref" value={billingEventForm.reference} onChange={(e) => updateBillingEventForm("reference", e.target.value)} disabled={!canManageBilling} />
                          </div>
                          <div className="space-y-2 md:col-span-2">
                            <Label htmlFor="billing-event-notes">Notes</Label>
                            <Input id="billing-event-notes" value={billingEventForm.notes} onChange={(e) => updateBillingEventForm("notes", e.target.value)} disabled={!canManageBilling} />
                          </div>
                          <div className="space-y-2 md:col-span-2">
                            <Label htmlFor="billing-event-invoice">Invoice link</Label>
                            <Input id="billing-event-invoice" value={billingEventForm.billing_invoice_id} onChange={(e) => updateBillingEventForm("billing_invoice_id", e.target.value)} placeholder="Optional billing invoice id" disabled={!canManageBilling} />
                          </div>
                          <div className="space-y-2 md:col-span-2">
                            <Label htmlFor="billing-event-effective-at">Effective at</Label>
                            <Input id="billing-event-effective-at" type="date" value={billingEventForm.effective_at} onChange={(e) => updateBillingEventForm("effective_at", e.target.value)} disabled={!canManageBilling} />
                          </div>
                        </div>
                        <Button onClick={() => void saveBillingEvent()} disabled={!canManageBilling || billingSaving === "event"}>
                          {billingSaving === "event" ? "Saving..." : "Save event"}
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
