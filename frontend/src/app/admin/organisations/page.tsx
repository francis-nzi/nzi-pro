"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";

function apiBaseUrl(): string {
  return "/api/backend";
}

type OrganisationMembership = {
  role?: string | null;
  is_active?: boolean;
  is_owner?: boolean;
};

type Organisation = {
  org_id: string;
  name: string;
  slug: string;
  plan?: string | null;
  plan_status?: string | null;
  max_users?: number | null;
  max_clients?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  is_member?: boolean;
  is_active_org?: boolean;
  membership?: OrganisationMembership | null;
};

type OrganisationsResponse = {
  items?: Organisation[];
  active_org_id?: string | null;
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

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("en-GB");
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
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [form, setForm] = useState<OrganisationForm>(DEFAULT_FORM);
  const [invite, setInvite] = useState<InviteForm>(DEFAULT_INVITE);
  const [inviteResult, setInviteResult] = useState<{ token: string; expires_at: string } | null>(null);

  const selectedOrg = useMemo(
    () => organisations.find((org) => org.org_id === selectedOrgId) || null,
    [organisations, selectedOrgId]
  );

  const loadOrganisations = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${baseUrl}/admin/organisations`, { credentials: "include" });
      const payload = (await res.json().catch(() => ({}))) as OrganisationsResponse;
      if (!res.ok) {
        const detail = (payload as { detail?: unknown }).detail;
        throw new Error(typeof detail === "string" ? detail : "Failed to load organisations");
      }
      const items = Array.isArray(payload.items) ? payload.items : [];
      setOrganisations(items);
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

  function updateForm<K extends keyof OrganisationForm>(key: K, value: OrganisationForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateInvite<K extends keyof InviteForm>(key: K, value: InviteForm[K]) {
    setInvite((current) => ({ ...current, [key]: value }));
  }

  function resetNewOrganisationForm() {
    setSelectedOrgId(null);
    setForm(DEFAULT_FORM);
  }

  async function saveOrganisation() {
    setSaving(true);
    setError("");
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
        throw new Error(typeof detail === "string" ? detail : "Unable to save organisation");
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
    setStatus("Switching organisation...");
    try {
      const res = await fetch(`${baseUrl}/admin/organisations/${encodeURIComponent(orgId)}/switch`, {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = (body as { detail?: unknown }).detail;
        throw new Error(typeof detail === "string" ? detail : "Unable to switch organisation");
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
        throw new Error(typeof detail === "string" ? detail : "Unable to create invitation");
      }
      const result = (body as { invite?: { token?: string; expires_at?: string } }).invite;
      setInviteResult(
        result?.token && result?.expires_at
          ? { token: result.token, expires_at: result.expires_at }
          : null
      );
      setInvite(DEFAULT_INVITE);
      setStatus("Invitation created.");
      setTimeout(() => setStatus(""), 2500);
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setInviting(null);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold" style={{ color: "#F26624" }}>
                Organisation Management
              </h1>
              {activeOrgId ? <Badge variant="outline">Active: {activeOrgId}</Badge> : null}
            </div>
            <p className="text-muted-foreground">
              Create organisations, update plan details, issue invitations, and switch your active org context.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={resetNewOrganisationForm}>
              New Organisation
            </Button>
            <Button variant="secondary" asChild>
              <Link href="/admin">Back to Admin</Link>
            </Button>
          </div>
        </div>

        {error ? <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
        {status ? <div className="mb-4 rounded-md bg-muted p-3 text-sm">{status}</div> : null}
        {inviteResult ? (
          <div className="mb-4 rounded-md border bg-emerald-50 p-3 text-sm text-emerald-900">
            Invitation token created. Share this token only with the invited user: <span className="font-mono">{inviteResult.token}</span>
          </div>
        ) : null}

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
                              {org.is_member ? <Badge variant="outline">Member</Badge> : null}
                            </div>
                            <div className="mt-1 text-sm text-muted-foreground">
                              Slug: {org.slug} • Plan: {org.plan || "trial"} • Status: {org.plan_status || "active"}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              Max users: {org.max_users ?? "-"} • Max clients: {org.max_clients ?? "-"} • Updated: {formatDate(org.updated_at)}
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
                              variant="secondary"
                              onClick={() => void switchOrganisation(org.org_id)}
                              disabled={switching === org.org_id}
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
                  <Button onClick={() => void saveOrganisation()} disabled={saving}>
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
                  <Input
                    id="invite-role"
                    value={invite.role}
                    onChange={(e) => updateInvite("role", e.target.value)}
                    placeholder="Consultant"
                  />
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
                  disabled={invoicing === selectedOrg?.org_id || !selectedOrg?.org_id}
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
                <CardTitle>Current Selection</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>Selected org: {selectedOrg?.name || "-"}</div>
                <div>Selected org id: {selectedOrg?.org_id || "-"}</div>
                <div>Active org id: {activeOrgId || "-"}</div>
                <div className="text-xs text-muted-foreground">
                  Use Switch to change your current session org. Edit to adjust plan details or create a new organisation.
                </div>
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
