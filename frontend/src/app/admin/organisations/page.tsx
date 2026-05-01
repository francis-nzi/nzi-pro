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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";
import { parseApiError, type OrgCapacityErrorInfo } from "@/lib/org-capacity-errors";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

function apiBaseUrl(): string {
  return "/api/backend";
}

type OrganisationMembership = {
  role?: string | null;
  is_active?: boolean;
  is_owner?: boolean;
  capabilities?: OrganisationRoleCapabilities | null;
};

type OrganisationRoleCapabilities = {
  can_switch?: boolean;
  can_manage_members?: boolean;
  can_invite?: boolean;
  can_manage_organisation?: boolean;
  can_transfer_ownership?: boolean;
  can_manage_billing?: boolean;
  is_owner_role?: boolean;
  is_admin_role?: boolean;
  role?: string | null;
};

type OrganisationMember = {
  org_id: string;
  user_id: string;
  full_name?: string | null;
  email?: string | null;
  role?: string | null;
  is_active?: boolean;
  is_owner?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
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
  archived_at?: string | null;
  archived_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  is_member?: boolean;
  is_active_org?: boolean;
  usage?: {
    org_id?: string | null;
    plan?: string | null;
    plan_status?: string | null;
    archived?: boolean | null;
    max_users?: number | null;
    max_clients?: number | null;
    active_members?: number | null;
    pending_invites?: number | null;
    active_clients?: number | null;
  } | null;
  membership?: OrganisationMembership | null;
  role_capabilities?: OrganisationRoleCapabilities | null;
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
  payload_json?: string | null;
  effective_at?: string | null;
  created_by?: string | null;
  created_at?: string | null;
};

type OrganisationBillingResponse = {
  organisation?: Organisation | null;
  entitlement?: Organisation["entitlement"] | null;
  usage?: Organisation["usage"] | null;
  billing?: {
    role?: string | null;
    capabilities?: OrganisationRoleCapabilities | null;
    invoices?: OrganisationBillingInvoice[];
    events?: OrganisationBillingEvent[];
  } | null;
};

type OrganisationsResponse = {
  items?: Organisation[];
  active_org_id?: string | null;
  current_membership?: OrganisationMembership | null;
  current_capabilities?: OrganisationRoleCapabilities | null;
  current_entitlement?: Organisation["entitlement"] | null;
  current_usage?: Organisation["usage"] | null;
};

type OrganisationMembersResponse = {
  items?: OrganisationMember[];
};

type OrganisationForm = {
  name: string;
  slug: string;
  plan: string;
  plan_status: string;
  max_users: string;
  max_clients: string;
};

type InviteForm = {
  email: string;
  role: string;
  days_valid: string;
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

const DEFAULT_FORM: OrganisationForm = {
  name: "",
  slug: "",
  plan: "trial",
  plan_status: "active",
  max_users: "3",
  max_clients: "10",
};

const DEFAULT_INVITE: InviteForm = {
  email: "",
  role: "Consultant",
  days_valid: "7",
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

const ORG_ROLE_OPTIONS = ["Owner", "Admin", "Billing", "Member", "Consultant"] as const;

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
  if (!Number.isFinite(limitValue) || limitValue <= 0) {
    return `${usedValue}`;
  }
  return `${usedValue}/${limitValue}`;
}

function usagePercent(used?: number | null, limit?: number | null): number | null {
  const usedValue = Number(used || 0);
  const limitValue = Number(limit || 0);
  if (!Number.isFinite(limitValue) || limitValue <= 0) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round((usedValue / limitValue) * 100)));
}

export default function OrganisationsPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const confirmAction = useConfirmDialog();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [invoicing, setInviting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [currentCapabilities, setCurrentCapabilities] = useState<OrganisationRoleCapabilities | null>(null);
  const [currentEntitlement, setCurrentEntitlement] = useState<Organisation["entitlement"] | null>(null);
  const [currentUsage, setCurrentUsage] = useState<Organisation["usage"] | null>(null);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [form, setForm] = useState<OrganisationForm>(DEFAULT_FORM);
  const [invite, setInvite] = useState<InviteForm>(DEFAULT_INVITE);
  const [inviteResult, setInviteResult] = useState<{ token: string; expires_at: string } | null>(null);
  const [members, setMembers] = useState<OrganisationMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberSaving, setMemberSaving] = useState<string | null>(null);
  const [memberDraftRoles, setMemberDraftRoles] = useState<Record<string, string>>({});
  const [billingLoading, setBillingLoading] = useState(false);
  const [billing, setBilling] = useState<OrganisationBillingResponse["billing"] | null>(null);
  const [selectedBillingEntitlement, setSelectedBillingEntitlement] = useState<Organisation["entitlement"] | null>(null);
  const [selectedBillingUsage, setSelectedBillingUsage] = useState<Organisation["usage"] | null>(null);
  const [billingInvoiceForm, setBillingInvoiceForm] = useState<BillingInvoiceForm>(DEFAULT_BILLING_INVOICE_FORM);
  const [billingEventForm, setBillingEventForm] = useState<BillingEventForm>(DEFAULT_BILLING_EVENT_FORM);
  const [billingSaving, setBillingSaving] = useState<string | null>(null);
  const [capacityError, setCapacityError] = useState<OrgCapacityErrorInfo | null>(null);

  const selectedOrg = useMemo(
    () => organisations.find((org) => org.org_id === selectedOrgId) || null,
    [organisations, selectedOrgId]
  );
  const canManageBilling = Boolean(
    selectedOrg?.membership?.capabilities?.can_manage_billing || currentCapabilities?.can_manage_billing
  );

  function setApiError(detail: unknown, fallback: string): string {
    const parsed = parseApiError(detail, fallback);
    setCapacityError(parsed.capacity || null);
    setError(parsed.message);
    return parsed.message;
  }

  const loadMembers = useCallback(
    async (orgId: string | null) => {
      if (!orgId) {
        setMembers([]);
        setMemberDraftRoles({});
        return;
      }
      setMembersLoading(true);
      try {
        const res = await fetch(`${baseUrl}/admin/organisations/${encodeURIComponent(orgId)}/members`, {
          credentials: "include",
        });
        const payload = (await res.json().catch(() => ({}))) as OrganisationMembersResponse;
        if (!res.ok) {
          const detail = (payload as { detail?: unknown }).detail;
          throw new Error(setApiError(detail, "Failed to load organisation members"));
        }
        const items = Array.isArray(payload.items) ? payload.items : [];
        setMembers(items);
        setMemberDraftRoles(
          items.reduce<Record<string, string>>((acc, item) => {
            if (item.user_id) {
              acc[item.user_id] = item.role || "Member";
            }
            return acc;
          }, {})
        );
      } catch (e) {
        setMembers([]);
        setMemberDraftRoles({});
        setError((e as Error).message);
      } finally {
        setMembersLoading(false);
      }
    },
    [baseUrl]
  );

  const loadBilling = useCallback(
    async (orgId: string | null) => {
      if (!orgId) {
        setBilling(null);
        setSelectedBillingEntitlement(null);
        setSelectedBillingUsage(null);
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
        setBilling((payload as OrganisationBillingResponse).billing || null);
        setSelectedBillingEntitlement((payload as OrganisationBillingResponse).entitlement || null);
        setSelectedBillingUsage((payload as OrganisationBillingResponse).usage || null);
      } catch (e) {
        setBilling(null);
        setError((e as Error).message);
      } finally {
        setBillingLoading(false);
      }
    },
    [baseUrl]
  );

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
      setCurrentCapabilities((payload as OrganisationsResponse).current_capabilities || null);
      setCurrentEntitlement((payload as OrganisationsResponse).current_entitlement || null);
      setCurrentUsage((payload as OrganisationsResponse).current_usage || null);
      const nextActive = payload.active_org_id || items.find((item) => item.is_active_org)?.org_id || items[0]?.org_id || null;
      setActiveOrgId(nextActive);
      setSelectedOrgId((current) => current || nextActive);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    void loadOrganisations();
  }, [loadOrganisations]);

  useEffect(() => {
    if (!selectedOrg) return;
    setForm({
      name: selectedOrg.name || "",
      slug: selectedOrg.slug || "",
      plan: selectedOrg.plan || "trial",
      plan_status: selectedOrg.plan_status || "active",
      max_users: String(selectedOrg.max_users ?? 3),
      max_clients: String(selectedOrg.max_clients ?? 10),
    });
  }, [selectedOrg]);

  useEffect(() => {
    void loadMembers(selectedOrg?.org_id || null);
  }, [loadMembers, selectedOrg?.org_id]);

  useEffect(() => {
    void loadBilling(selectedOrg?.org_id || null);
  }, [loadBilling, selectedOrg?.org_id]);

  function updateForm<K extends keyof OrganisationForm>(key: K, value: OrganisationForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateInvite<K extends keyof InviteForm>(key: K, value: InviteForm[K]) {
    setInvite((current) => ({ ...current, [key]: value }));
  }

  function updateMemberDraftRole(userId: string, role: string) {
    setMemberDraftRoles((current) => ({ ...current, [userId]: role }));
  }

  function updateBillingInvoiceForm<K extends keyof BillingInvoiceForm>(key: K, value: BillingInvoiceForm[K]) {
    setBillingInvoiceForm((current) => ({ ...current, [key]: value }));
  }

  function updateBillingEventForm<K extends keyof BillingEventForm>(key: K, value: BillingEventForm[K]) {
    setBillingEventForm((current) => ({ ...current, [key]: value }));
  }

  async function setOrganisationArchived(orgId: string, archived: boolean) {
    const confirmed = await confirmAction({
      title: archived ? "Archive organisation?" : "Reactivate organisation?",
      description: archived
        ? "This will archive the organisation and pause normal operations."
        : "This will reactivate the organisation and allow normal operations again.",
      confirmLabel: archived ? "Archive" : "Reactivate",
    });
    if (!confirmed) return;

    setSaving(true);
    setError("");
    setCapacityError(null);
    setStatus(archived ? "Archiving organisation..." : "Reactivating organisation...");
    try {
      const res = await fetch(`${baseUrl}/admin/organisations/${encodeURIComponent(orgId)}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ archived }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = (body as { detail?: unknown }).detail;
        throw new Error(setApiError(detail, "Unable to update organisation archive state"));
      }
      setStatus(archived ? "Organisation archived." : "Organisation reactivated.");
      await loadOrganisations();
      await loadMembers(selectedOrgId);
      setTimeout(() => setStatus(""), 2500);
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setSaving(false);
    }
  }

  async function transferOwnership(member: OrganisationMember) {
    if (!selectedOrg?.org_id || !member.user_id) return;
    const confirmed = await confirmAction({
      title: "Transfer ownership?",
      description: `Make ${member.full_name || member.email || member.user_id} the organisation owner.`,
      confirmLabel: "Transfer",
    });
    if (!confirmed) return;

    setMemberSaving(member.user_id);
    setError("");
    setCapacityError(null);
    setStatus("Transferring ownership...");
    try {
      const res = await fetch(`${baseUrl}/admin/organisations/${encodeURIComponent(selectedOrg.org_id)}/transfer-ownership`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ member_user_id: member.user_id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = (body as { detail?: unknown }).detail;
        throw new Error(setApiError(detail, "Unable to transfer ownership"));
      }
      setStatus("Organisation ownership transferred.");
      await loadMembers(selectedOrg.org_id);
      await loadOrganisations();
      setTimeout(() => setStatus(""), 2500);
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setMemberSaving(null);
    }
  }

  function resetNewOrganisationForm() {
    setSelectedOrgId(null);
    setForm(DEFAULT_FORM);
  }

  async function saveOrganisation() {
    setSaving(true);
    setError("");
    setCapacityError(null);
    setStatus(selectedOrg ? "Saving organisation..." : "Creating organisation...");
    try {
      const payload = {
        name: form.name.trim(),
        slug: form.slug.trim() || undefined,
        plan: form.plan.trim() || "trial",
        plan_status: form.plan_status.trim() || "active",
        max_users: Number(form.max_users || 0),
        max_clients: Number(form.max_clients || 0),
      };
      const res = await fetch(
        selectedOrg ? `${baseUrl}/admin/organisations/${encodeURIComponent(selectedOrg.org_id)}` : `${baseUrl}/admin/organisations`,
        {
          method: selectedOrg ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = (body as { detail?: unknown }).detail;
        throw new Error(setApiError(detail, "Unable to save organisation"));
      }
      const organisation = (body as { organisation?: Organisation }).organisation;
      if (organisation?.org_id) {
        setSelectedOrgId(organisation.org_id);
      }
      setStatus(selectedOrg ? "Organisation updated." : "Organisation created.");
      await loadOrganisations();
      setTimeout(() => setStatus(""), 2500);
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setSaving(false);
    }
  }

  async function switchOrganisation(orgId: string) {
    const confirmed = await confirmAction({
      title: "Switch active organisation?",
      description: "This will update your current active org for the session.",
      confirmLabel: "Switch",
    });
    if (!confirmed) return;

    setSwitching(orgId);
    setError("");
    setCapacityError(null);
    setStatus("Switching organisation...");
    try {
      const res = await fetch(`${baseUrl}/admin/organisations/${encodeURIComponent(orgId)}/switch`, {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = (body as { detail?: unknown }).detail;
        throw new Error(setApiError(detail, "Unable to switch organisation"));
      }
      setActiveOrgId(orgId);
      setStatus("Active organisation switched.");
      await loadOrganisations();
      setTimeout(() => setStatus(""), 2500);
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setSwitching(null);
    }
  }

  async function inviteUser() {
    if (!selectedOrg?.org_id) {
      setError("Select an organisation first.");
      return;
    }
    setInviting(selectedOrg.org_id);
    setError("");
    setCapacityError(null);
    setStatus("Creating invitation...");
    try {
      const res = await fetch(`${baseUrl}/admin/organisations/${encodeURIComponent(selectedOrg.org_id)}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: invite.email.trim(),
          role: invite.role.trim() || "Consultant",
          days_valid: Number(invite.days_valid || 7),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = (body as { detail?: unknown }).detail;
        throw new Error(setApiError(detail, "Unable to create invitation"));
      }
      const result = (body as { invite?: { token?: string; expires_at?: string } }).invite;
      setInviteResult(
        result?.token && result?.expires_at
          ? { token: result.token, expires_at: result.expires_at }
          : null
      );
      setInvite(DEFAULT_INVITE);
      setStatus("Invitation created.");
      await loadMembers(selectedOrg.org_id);
      setTimeout(() => setStatus(""), 2500);
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setInviting(null);
    }
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
          source: "organisation-admin",
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

  async function saveMemberRole(member: OrganisationMember) {
    if (!selectedOrg?.org_id || !member.user_id) return;
    const nextRole = memberDraftRoles[member.user_id] || member.role || "Member";
    setMemberSaving(member.user_id);
    setError("");
    setCapacityError(null);
    setStatus("Updating organisation member...");
    try {
      const res = await fetch(
        `${baseUrl}/admin/organisations/${encodeURIComponent(selectedOrg.org_id)}/members/${encodeURIComponent(member.user_id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ role: nextRole }),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = (body as { detail?: unknown }).detail;
        throw new Error(setApiError(detail, "Unable to update member role"));
      }
      setStatus("Organisation member updated.");
      await loadMembers(selectedOrg.org_id);
      await loadOrganisations();
      setTimeout(() => setStatus(""), 2500);
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setMemberSaving(null);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <AdminPageHeader
          kicker="People & Access"
          title="Organisation Management"
          description="Create organisations, update plan details, issue invitations, and switch your active org context."
          badges={activeOrgId ? [<>Active org: {activeOrgId}</>] : []}
          actions={
            <>
              <Button variant="secondary" asChild className="rounded-full">
                <Link href="/admin/billing">Billing &amp; Entitlements</Link>
              </Button>
              <Button onClick={resetNewOrganisationForm} className="rounded-full bg-[#1c5026] text-white hover:bg-[#153f1e]">
                New Organisation
              </Button>
              <Button variant="outline" asChild className="rounded-full">
                <Link href="/admin">Back to Admin</Link>
              </Button>
            </>
          }
        />

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
        {inviteResult ? (
          <div className="mb-4 rounded-md border bg-emerald-50 p-3 text-sm text-emerald-900">
            Invitation token created. Share this token only with the invited user: <span className="font-mono">{inviteResult.token}</span>
          </div>
        ) : null}

        <Card className="mb-6 border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle>Organisation Onboarding Checklist</CardTitle>
            <CardDescription>
              Use this when you bring a new tenant online or hand a workspace to a new team.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 text-sm">
            <div className="rounded-lg border bg-background p-4 space-y-2">
              <div className="font-medium">1. Review the active org</div>
              <p className="text-muted-foreground">Confirm the tenant name, plan, and member count before making changes.</p>
            </div>
            <div className="rounded-lg border bg-background p-4 space-y-2">
              <div className="font-medium">2. Invite the team</div>
              <p className="text-muted-foreground">Add owners, admins, billing users, and consultants from the member panel.</p>
            </div>
            <div className="rounded-lg border bg-background p-4 space-y-2">
              <div className="font-medium">3. Switch safely</div>
              <p className="text-muted-foreground">Use the organisation switch action only after you confirm the tenant context in Support.</p>
            </div>
            <div className="rounded-lg border bg-background p-4 space-y-2">
              <div className="font-medium">4. Check billing and limits</div>
              <p className="text-muted-foreground">Review plan status, member limits, and client capacity before the first job goes live.</p>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Organisations</CardTitle>
              <CardDescription>Select an organisation to edit or switch it active.</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-sm text-muted-foreground">Loading organisations...</div>
              ) : organisations.length === 0 ? (
                <div className="text-sm text-muted-foreground">No organisations found.</div>
              ) : (
                <div className="space-y-3">
                  {organisations.map((org) => {
                    const isSelected = org.org_id === selectedOrgId;
                    const isActive = org.org_id === activeOrgId;
                    return (
                    <div
                        key={org.org_id}
                        className={`w-full rounded-xl border p-4 text-left transition ${
                          isSelected ? "border-primary bg-primary/5" : "hover:bg-muted/30"
                        }`}
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div>
                        <div className="flex items-center gap-2">
                          <div className="text-lg font-semibold">{org.name}</div>
                          {isActive ? <Badge>Active</Badge> : null}
                          {org.archived ? <Badge variant="destructive">Archived</Badge> : null}
                          {org.is_member ? <Badge variant="outline">Member</Badge> : null}
                        </div>
                            <div className="mt-1 text-sm text-muted-foreground">
                              Slug: {org.slug} | Plan: {org.plan || "trial"} | Status: {org.plan_status || "active"}
                            </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            Plan: {org.plan || "trial"} | Status: {org.plan_status || "active"}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            Max users: {org.max_users ?? "-"} | Max clients: {org.max_clients ?? "-"} | Updated: {formatDate(org.updated_at)}
                          </div>
                        </div>
                          <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setSelectedOrgId(org.org_id)}
                              >
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void setOrganisationArchived(org.org_id, !org.archived)}
                                disabled={saving}
                              >
                                {org.archived ? "Reactivate" : "Archive"}
                              </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void switchOrganisation(org.org_id)}
                              disabled={switching === org.org_id || !!org.archived}
                            >
                              {switching === org.org_id ? "Switching..." : "Switch"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{selectedOrg ? "Edit Organisation" : "Create Organisation"}</CardTitle>
                <CardDescription>
                  {selectedOrg
                    ? `Updating ${selectedOrg.name}.`
                    : "Add a new organisation and optionally make yourself the first member."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="org-name">Name</Label>
                  <Input id="org-name" value={form.name} onChange={(e) => updateForm("name", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-slug">Slug</Label>
                  <Input id="org-slug" value={form.slug} onChange={(e) => updateForm("slug", e.target.value)} />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="org-plan">Plan</Label>
                    <Input id="org-plan" value={form.plan} onChange={(e) => updateForm("plan", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="org-plan-status">Plan Status</Label>
                    <Input
                      id="org-plan-status"
                      value={form.plan_status}
                      onChange={(e) => updateForm("plan_status", e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="org-max-users">Max Users</Label>
                    <Input id="org-max-users" type="number" min="1" value={form.max_users} onChange={(e) => updateForm("max_users", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="org-max-clients">Max Clients</Label>
                    <Input id="org-max-clients" type="number" min="1" value={form.max_clients} onChange={(e) => updateForm("max_clients", e.target.value)} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => void saveOrganisation()} disabled={saving || !!selectedOrg?.archived}>
                    {saving ? "Saving..." : selectedOrg ? "Save Changes" : "Create Organisation"}
                  </Button>
                  {selectedOrg ? (
                    <Button variant="outline" onClick={resetNewOrganisationForm} disabled={saving}>
                      Clear Selection
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Invite User</CardTitle>
                <CardDescription>
                  Create an invitation tied to the selected organisation.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="invite-email">Email</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    value={invite.email}
                    onChange={(e) => updateInvite("email", e.target.value)}
                    placeholder="person@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-role">Role</Label>
                  <Select value={invite.role} onValueChange={(value) => updateInvite("role", value)}>
                    <SelectTrigger id="invite-role">
                      <SelectValue placeholder="Consultant" />
                    </SelectTrigger>
                    <SelectContent>
                      {ORG_ROLE_OPTIONS.map((role) => (
                        <SelectItem key={role} value={role}>
                          {role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-days">Valid for days</Label>
                  <Input
                    id="invite-days"
                    type="number"
                    min="1"
                    value={invite.days_valid}
                    onChange={(e) => updateInvite("days_valid", e.target.value)}
                  />
                </div>
                <Button
                  onClick={() => void inviteUser()}
                  disabled={invoicing === selectedOrg?.org_id || !selectedOrg?.org_id || !!selectedOrg?.archived}
                >
                  {invoicing === selectedOrg?.org_id ? "Creating..." : "Create Invitation"}
                </Button>
                <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                  Current selection: {selectedOrg ? `${selectedOrg.name} (${selectedOrg.org_id})` : "No organisation selected"}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Members &amp; Roles</CardTitle>
                <CardDescription>
                  Review the organisation membership list and adjust each member&apos;s role.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!selectedOrg ? (
                  <div className="text-sm text-muted-foreground">Select an organisation to view members.</div>
                ) : membersLoading ? (
                  <div className="text-sm text-muted-foreground">Loading members...</div>
                ) : members.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No members found.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Member</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {members.map((member) => {
                        const draftRole = memberDraftRoles[member.user_id] || member.role || "Member";
                        const changed = draftRole !== (member.role || "Member");
                        const canTransferOwnership = Boolean(selectedOrg?.membership?.capabilities?.can_transfer_ownership || currentCapabilities?.can_transfer_ownership);
                        return (
                          <TableRow key={member.user_id}>
                            <TableCell>
                              <div className="font-medium">{member.full_name || member.email || member.user_id}</div>
                              <div className="text-xs text-muted-foreground">{member.email || member.user_id}</div>
                              {member.is_owner ? <Badge className="mt-1">Owner</Badge> : null}
                            </TableCell>
                            <TableCell className="w-[220px]">
                              <Select
                                value={draftRole}
                                onValueChange={(value) => updateMemberDraftRole(member.user_id, value)}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Member" />
                                </SelectTrigger>
                                <SelectContent>
                                  {ORG_ROLE_OPTIONS.map((role) => (
                                    <SelectItem key={role} value={role}>
                                      {role}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Badge variant={member.is_active ? "secondary" : "outline"}>
                                {member.is_active ? "Active" : "Inactive"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                {!member.is_owner && canTransferOwnership ? (
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => void transferOwnership(member)}
                                    disabled={memberSaving === member.user_id}
                                  >
                                    Transfer ownership
                                  </Button>
                                ) : null}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void saveMemberRole(member)}
                                disabled={!changed || memberSaving === member.user_id}
                              >
                                {memberSaving === member.user_id ? "Saving..." : "Save"}
                              </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Current Selection</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>Selected org: {selectedOrg?.name || "-"}</div>
                <div>Selected org id: {selectedOrg?.org_id || "-"}</div>
                <div>Active org id: {activeOrgId || "-"}</div>
                <div>
                  Your role: {selectedOrg?.membership?.role || currentCapabilities?.role || "-"}
                </div>
                <div>
                  Entitlement status: {selectedOrg?.entitlement?.subscription_status || currentEntitlement?.subscription_status || selectedOrg?.plan_status || "-"}
                </div>
                <div>
                  Plan: {selectedOrg?.entitlement?.plan || currentEntitlement?.plan || selectedOrg?.plan || "trial"}
                </div>
                <div>
                  Billing usage: {formatLimitUsage(selectedBillingUsage?.active_members ?? currentUsage?.active_members, selectedBillingUsage?.max_users ?? currentUsage?.max_users)} users
                  {selectedBillingUsage?.pending_invites ?? currentUsage?.pending_invites ? ` + ${selectedBillingUsage?.pending_invites ?? currentUsage?.pending_invites} pending` : ""} |{" "}
                  {formatLimitUsage(selectedBillingUsage?.active_clients ?? currentUsage?.active_clients, selectedBillingUsage?.max_clients ?? currentUsage?.max_clients)} clients
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-md border bg-background p-3">
                    <div className="text-xs font-semibold uppercase text-muted-foreground">Users</div>
                    <div className="mt-1 text-lg font-semibold">
                      {formatLimitUsage(selectedBillingUsage?.active_members ?? currentUsage?.active_members, selectedBillingUsage?.max_users ?? currentUsage?.max_users)}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {selectedBillingUsage?.pending_invites ?? currentUsage?.pending_invites ?? 0} pending invites
                    </div>
                  </div>
                  <div className="rounded-md border bg-background p-3">
                    <div className="text-xs font-semibold uppercase text-muted-foreground">Clients</div>
                    <div className="mt-1 text-lg font-semibold">
                      {formatLimitUsage(selectedBillingUsage?.active_clients ?? currentUsage?.active_clients, selectedBillingUsage?.max_clients ?? currentUsage?.max_clients)}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {usagePercent(selectedBillingUsage?.active_clients ?? currentUsage?.active_clients, selectedBillingUsage?.max_clients ?? currentUsage?.max_clients) != null
                        ? `${usagePercent(selectedBillingUsage?.active_clients ?? currentUsage?.active_clients, selectedBillingUsage?.max_clients ?? currentUsage?.max_clients)}% of limit`
                        : "No limit set"}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  {currentCapabilities?.can_manage_members ? <Badge variant="secondary">Manage members</Badge> : null}
                  {currentCapabilities?.can_invite ? <Badge variant="secondary">Invite users</Badge> : null}
                  {currentCapabilities?.can_manage_organisation ? <Badge variant="secondary">Manage org</Badge> : null}
                  {currentCapabilities?.can_manage_billing ? <Badge variant="secondary">Billing</Badge> : null}
                  {currentCapabilities?.can_transfer_ownership ? <Badge variant="secondary">Transfer ownership</Badge> : null}
                </div>
                <div className="text-xs text-muted-foreground">
                  Owners can transfer ownership. Admins can manage members and settings. Billing, member, and consultant roles can switch orgs but not transfer ownership.
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Billing &amp; Payments</CardTitle>
                <CardDescription>
                  Track org invoices, payment events, and subscription lifecycle history.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {!selectedOrg ? (
                  <div className="text-sm text-muted-foreground">Select an organisation to view billing history.</div>
                ) : billingLoading ? (
                  <div className="text-sm text-muted-foreground">Loading billing history...</div>
                ) : (
                  <>
                    <div className="rounded-md border p-3 text-sm">
                      <div className="font-medium">Current billing status</div>
                      <div className="mt-1 text-muted-foreground">
                        Plan: {selectedBillingEntitlement?.plan || currentEntitlement?.plan || selectedOrg.plan || "trial"} | Status:{" "}
                        {selectedBillingEntitlement?.subscription_status || currentEntitlement?.subscription_status || selectedOrg.plan_status || "active"}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Subscription: {selectedBillingEntitlement?.stripe_subscription_id || currentEntitlement?.stripe_subscription_id || "-"}
                      </div>
                    </div>

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
                            <Input
                              id="billing-invoice-number"
                              value={billingInvoiceForm.invoice_number}
                              onChange={(e) => updateBillingInvoiceForm("invoice_number", e.target.value)}
                              placeholder="INV-2026-001"
                              disabled={!canManageBilling}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="billing-invoice-status">Status</Label>
                            <Select
                              value={billingInvoiceForm.status}
                              onValueChange={(value) => updateBillingInvoiceForm("status", value)}
                              disabled={!canManageBilling}
                            >
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
                            <Input
                              id="billing-invoice-amount"
                              value={billingInvoiceForm.amount}
                              onChange={(e) => updateBillingInvoiceForm("amount", e.target.value)}
                              placeholder="1250.00"
                              disabled={!canManageBilling}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="billing-invoice-currency">Currency</Label>
                            <Input
                              id="billing-invoice-currency"
                              value={billingInvoiceForm.currency}
                              onChange={(e) => updateBillingInvoiceForm("currency", e.target.value)}
                              placeholder="GBP"
                              disabled={!canManageBilling}
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="billing-invoice-description">Description</Label>
                          <Input
                            id="billing-invoice-description"
                            value={billingInvoiceForm.description}
                            onChange={(e) => updateBillingInvoiceForm("description", e.target.value)}
                            placeholder="Monthly subscription invoice"
                            disabled={!canManageBilling}
                          />
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor="billing-invoice-date">Invoice date</Label>
                            <Input
                              id="billing-invoice-date"
                              type="date"
                              value={billingInvoiceForm.invoice_date}
                              onChange={(e) => updateBillingInvoiceForm("invoice_date", e.target.value)}
                              disabled={!canManageBilling}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="billing-invoice-due-date">Due date</Label>
                            <Input
                              id="billing-invoice-due-date"
                              type="date"
                              value={billingInvoiceForm.due_date}
                              onChange={(e) => updateBillingInvoiceForm("due_date", e.target.value)}
                              disabled={!canManageBilling}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="billing-invoice-paid-at">Paid at</Label>
                            <Input
                              id="billing-invoice-paid-at"
                              type="date"
                              value={billingInvoiceForm.paid_at}
                              onChange={(e) => updateBillingInvoiceForm("paid_at", e.target.value)}
                              disabled={!canManageBilling}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="billing-invoice-period-start">Period start</Label>
                            <Input
                              id="billing-invoice-period-start"
                              type="date"
                              value={billingInvoiceForm.period_start}
                              onChange={(e) => updateBillingInvoiceForm("period_start", e.target.value)}
                              disabled={!canManageBilling}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="billing-invoice-period-end">Period end</Label>
                            <Input
                              id="billing-invoice-period-end"
                              type="date"
                              value={billingInvoiceForm.period_end}
                              onChange={(e) => updateBillingInvoiceForm("period_end", e.target.value)}
                              disabled={!canManageBilling}
                            />
                          </div>
                        </div>
                        <div className="grid gap-3 md:grid-cols-3">
                          <div className="space-y-2">
                            <Label htmlFor="billing-invoice-payment-reference">Payment reference</Label>
                            <Input
                              id="billing-invoice-payment-reference"
                              value={billingInvoiceForm.payment_reference}
                              onChange={(e) => updateBillingInvoiceForm("payment_reference", e.target.value)}
                              disabled={!canManageBilling}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="billing-invoice-stripe-id">Stripe invoice</Label>
                            <Input
                              id="billing-invoice-stripe-id"
                              value={billingInvoiceForm.stripe_invoice_id}
                              onChange={(e) => updateBillingInvoiceForm("stripe_invoice_id", e.target.value)}
                              disabled={!canManageBilling}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="billing-invoice-payment-intent">Payment intent</Label>
                            <Input
                              id="billing-invoice-payment-intent"
                              value={billingInvoiceForm.stripe_payment_intent_id}
                              onChange={(e) => updateBillingInvoiceForm("stripe_payment_intent_id", e.target.value)}
                              disabled={!canManageBilling}
                            />
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
                            <Select
                              value={billingEventForm.event_type}
                              onValueChange={(value) => updateBillingEventForm("event_type", value)}
                              disabled={!canManageBilling}
                            >
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
                            <Input
                              id="billing-event-status"
                              value={billingEventForm.status}
                              onChange={(e) => updateBillingEventForm("status", e.target.value)}
                              disabled={!canManageBilling}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="billing-event-source">Source</Label>
                            <Input
                              id="billing-event-source"
                              value={billingEventForm.source}
                              onChange={(e) => updateBillingEventForm("source", e.target.value)}
                              disabled={!canManageBilling}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="billing-event-amount">Amount</Label>
                            <Input
                              id="billing-event-amount"
                              value={billingEventForm.amount}
                              onChange={(e) => updateBillingEventForm("amount", e.target.value)}
                              disabled={!canManageBilling}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="billing-event-currency">Currency</Label>
                            <Input
                              id="billing-event-currency"
                              value={billingEventForm.currency}
                              onChange={(e) => updateBillingEventForm("currency", e.target.value)}
                              disabled={!canManageBilling}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="billing-event-ref">Reference</Label>
                            <Input
                              id="billing-event-ref"
                              value={billingEventForm.reference}
                              onChange={(e) => updateBillingEventForm("reference", e.target.value)}
                              disabled={!canManageBilling}
                            />
                          </div>
                          <div className="space-y-2 md:col-span-2">
                            <Label htmlFor="billing-event-notes">Notes</Label>
                            <Input
                              id="billing-event-notes"
                              value={billingEventForm.notes}
                              onChange={(e) => updateBillingEventForm("notes", e.target.value)}
                              disabled={!canManageBilling}
                            />
                          </div>
                          <div className="space-y-2 md:col-span-2">
                            <Label htmlFor="billing-event-invoice">Invoice link</Label>
                            <Input
                              id="billing-event-invoice"
                              value={billingEventForm.billing_invoice_id}
                              onChange={(e) => updateBillingEventForm("billing_invoice_id", e.target.value)}
                              placeholder="Optional billing invoice id"
                              disabled={!canManageBilling}
                            />
                            <div className="text-xs text-muted-foreground">
                              Leave blank for a standalone event, or paste a billing invoice id from the list above.
                            </div>
                          </div>
                          <div className="space-y-2 md:col-span-2">
                            <Label htmlFor="billing-event-effective-at">Effective at</Label>
                            <Input
                              id="billing-event-effective-at"
                              type="date"
                              value={billingEventForm.effective_at}
                              onChange={(e) => updateBillingEventForm("effective_at", e.target.value)}
                              disabled={!canManageBilling}
                            />
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

        <div className="mt-8 flex justify-between gap-2">
          <Button variant="secondary" asChild>
            <Link href="/admin">Back to Admin</Link>
          </Button>
          <Button variant="outline" onClick={() => void loadOrganisations()}>
            Refresh
          </Button>
        </div>
      </div>
    </div>
  );
}
