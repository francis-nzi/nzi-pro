"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
}

type User = {
  user_id: string;
  full_name: string;
  email: string;
  role: string;
  position?: string;
  status: string;
  has_password?: boolean;
  invited_at?: string | null;
  invited_by?: string | null;
  invite_expires_at?: string | null;
  invite_lapsed?: boolean;
  mobile_phone?: string | null;
  cost_per_hour?: number | null;
  sell_per_hour?: number | null;
  user_type?: string | null;
  access_scope?: string | null;
};

type Role = {
  role_name: string;
  is_active: boolean;
};

type PositionOption = {
  position_id: number;
  name: string;
  is_active: boolean;
};

type PermissionOption = {
  permission_key: string;
  description: string;
};

type AccessClientOption = {
  client_db_id: number;
  client_name: string;
};

type UserAccessOverride = {
  permission_key: string;
  effect: "allow" | "deny";
  reason?: string | null;
};

type UserLinkedClient = {
  client_db_id: number;
  role_name?: string | null;
  client_name?: string | null;
};

type AccessOptionsPayload = {
  roles: Role[];
  permissions: PermissionOption[];
  access_scopes: string[];
  user_types: string[];
  clients: AccessClientOption[];
};

type UserAccessPayload = {
  email: string;
  role: string;
  user_type: string;
  access_scope: string;
  linked_clients: UserLinkedClient[];
  overrides: UserAccessOverride[];
  effective_permissions: string[];
  denied_permissions: string[];
  is_super_admin: boolean;
};

type SortBy = "name" | "role" | "status" | "access" | "invite_date";
type LifecycleStatus = "Active" | "Invited" | "Invite Lapsed" | "Deactivated";
type PermissionSetting = "inherit" | "allow" | "deny";

const PORTAL_ROLE_NAMES = new Set([
  "ClientAdmin",
  "ClientContributor",
  "ClientViewer",
  "ClientReporting",
]);

const USER_TYPE_LABELS: Record<string, string> = {
  internal: "Internal",
  client_portal: "Client Portal",
};

const ACCESS_SCOPE_LABELS: Record<string, string> = {
  all: "All clients",
  linked_clients: "Linked clients",
};

function lifecycleStatus(user: User): LifecycleStatus {
  const active = (user.status || "").trim().toLowerCase() === "active";
  if (!active) return "Deactivated";
  if (user.invite_lapsed) return "Invite Lapsed";
  if (!user.has_password) return "Invited";
  return "Active";
}

function prettyDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function normalizeUserType(value?: string | null): string {
  return String(value || "internal").trim().toLowerCase() === "client_portal"
    ? "client_portal"
    : "internal";
}

function normalizeAccessScope(userType: string, value?: string | null): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "linked_clients") return "linked_clients";
  if (normalized === "all") return "all";
  return userType === "client_portal" ? "linked_clients" : "all";
}

export default function TeamManagementPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const confirmAction = useConfirmDialog();

  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [positions, setPositions] = useState<PositionOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [passwordFilter, setPasswordFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortBy>("name");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("ReadOnly");
  const [position, setPosition] = useState("");
  const [userStatus, setUserStatus] = useState("Active");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [setPasswordNow, setSetPasswordNow] = useState(false);
  const [mobilePhone, setMobilePhone] = useState("");
  const [costPerHour, setCostPerHour] = useState("");
  const [sellPerHour, setSellPerHour] = useState("");
  const [accessOptions, setAccessOptions] = useState<AccessOptionsPayload>({
    roles: [],
    permissions: [],
    access_scopes: ["all", "linked_clients"],
    user_types: ["internal", "client_portal"],
    clients: [],
  });
  const [dialogTab, setDialogTab] = useState("profile");
  const [userType, setUserType] = useState("internal");
  const [accessScope, setAccessScope] = useState("all");
  const [linkedClientIds, setLinkedClientIds] = useState<number[]>([]);
  const [permissionEffects, setPermissionEffects] = useState<Record<string, PermissionSetting>>({});
  const [permissionReasons, setPermissionReasons] = useState<Record<string, string>>({});
  const [effectivePermissions, setEffectivePermissions] = useState<string[]>([]);
  const [deniedPermissions, setDeniedPermissions] = useState<string[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [linkedClientSearch, setLinkedClientSearch] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [usersRes, rolesRes, positionsRes, accessOptionsRes] = await Promise.all([
        fetch(`${baseUrl}/admin/users`),
        fetch(`${baseUrl}/admin/roles`),
        fetch(`${baseUrl}/admin/lookups/positions_lookup`),
        fetch(`${baseUrl}/admin/access/options`),
      ]);

      if (usersRes.ok) {
        const usersJson = await usersRes.json();
        setUsers(usersJson.items || []);
      }

      if (rolesRes.ok) {
        const rolesJson = await rolesRes.json();
        setRoles(rolesJson.items || []);
      }

      if (positionsRes.ok) {
        const positionsJson = await positionsRes.json();
        setPositions((positionsJson.items || []).filter((p: PositionOption) => p.is_active !== false));
      } else {
        setPositions([]);
      }

      if (accessOptionsRes.ok) {
        const accessOptionsJson = await accessOptionsRes.json();
        setAccessOptions({
          roles: accessOptionsJson.roles || [],
          permissions: accessOptionsJson.permissions || [],
          access_scopes: accessOptionsJson.access_scopes || ["all", "linked_clients"],
          user_types: accessOptionsJson.user_types || ["internal", "client_portal"],
          clients: accessOptionsJson.clients || [],
        });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const allRoleOptions = useMemo(() => {
    const fromAccess = (accessOptions.roles || []).filter((r) => r.is_active !== false).map((r) => r.role_name);
    const fromRoles = roles.filter((r) => r.is_active).map((r) => r.role_name);
    return Array.from(new Set([...fromAccess, ...fromRoles]));
  }, [accessOptions.roles, roles]);

  const visibleRoleOptions = useMemo(() => {
    const options = allRoleOptions.filter((name) =>
      userType === "client_portal" ? PORTAL_ROLE_NAMES.has(name) : !PORTAL_ROLE_NAMES.has(name)
    );
    if (role && !options.includes(role)) {
      return [role, ...options];
    }
    return options;
  }, [allRoleOptions, role, userType]);

  const filteredLinkedClients = useMemo(() => {
    const query = linkedClientSearch.trim().toLowerCase();
    if (!query) return accessOptions.clients;
    return accessOptions.clients.filter((client) =>
      `${client.client_name} ${client.client_db_id}`.toLowerCase().includes(query)
    );
  }, [accessOptions.clients, linkedClientSearch]);

  const overrideRows = useMemo(
    () =>
      (accessOptions.permissions || []).map((permission) => ({
        ...permission,
        effect: permissionEffects[permission.permission_key] || "inherit",
        reason: permissionReasons[permission.permission_key] || "",
      })),
    [accessOptions.permissions, permissionEffects, permissionReasons]
  );

  function resetAccessState(nextUserType = "internal", nextRole?: string) {
    const normalizedType = normalizeUserType(nextUserType);
    const defaultRole =
      nextRole ||
      (normalizedType === "client_portal"
        ? allRoleOptions.find((name) => PORTAL_ROLE_NAMES.has(name)) || "ClientViewer"
        : allRoleOptions.find((name) => !PORTAL_ROLE_NAMES.has(name)) || "ReadOnly");
    setDialogTab("profile");
    setUserType(normalizedType);
    setAccessScope(normalizeAccessScope(normalizedType, null));
    setRole(defaultRole);
    setLinkedClientIds([]);
    setPermissionEffects({});
    setPermissionReasons({});
    setEffectivePermissions([]);
    setDeniedPermissions([]);
    setIsSuperAdmin(false);
    setAccessLoading(false);
    setAccessError("");
    setLinkedClientSearch("");
  }

  async function loadUserAccess(emailValue: string) {
    const emailNorm = emailValue.trim().toLowerCase();
    if (!emailNorm) return;
    setAccessLoading(true);
    setAccessError("");
    try {
      const res = await fetch(`${baseUrl}/admin/users/${encodeURIComponent(emailNorm)}/access`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.detail || `Failed to load access: ${res.status}`);
      }
      const accessPayload = payload as UserAccessPayload;
      const nextUserType = normalizeUserType(accessPayload.user_type);
      setUserType(nextUserType);
      setRole(accessPayload.role || role);
      setAccessScope(normalizeAccessScope(nextUserType, accessPayload.access_scope));
      setLinkedClientIds(
        (accessPayload.linked_clients || [])
          .map((item) => Number(item.client_db_id))
          .filter((value) => Number.isFinite(value))
      );
      const nextEffects: Record<string, PermissionSetting> = {};
      const nextReasons: Record<string, string> = {};
      for (const item of accessPayload.overrides || []) {
        if (!item?.permission_key) continue;
        nextEffects[item.permission_key] = item.effect === "allow" ? "allow" : "deny";
        nextReasons[item.permission_key] = item.reason || "";
      }
      setPermissionEffects(nextEffects);
      setPermissionReasons(nextReasons);
      setEffectivePermissions(accessPayload.effective_permissions || []);
      setDeniedPermissions(accessPayload.denied_permissions || []);
      setIsSuperAdmin(Boolean(accessPayload.is_super_admin));
    } catch (e) {
      setAccessError((e as Error).message);
      setEffectivePermissions([]);
      setDeniedPermissions([]);
      setIsSuperAdmin(false);
    } finally {
      setAccessLoading(false);
    }
  }

  function toggleLinkedClient(clientDbId: number) {
    setLinkedClientIds((current) =>
      current.includes(clientDbId)
        ? current.filter((value) => value !== clientDbId)
        : [...current, clientDbId].sort((a, b) => a - b)
    );
  }

  function setPermissionEffect(permissionKey: string, effect: PermissionSetting) {
    setPermissionEffects((current) => {
      const next = { ...current };
      if (effect === "inherit") {
        delete next[permissionKey];
      } else {
        next[permissionKey] = effect;
      }
      return next;
    });
    if (effect === "inherit") {
      setPermissionReasons((current) => {
        const next = { ...current };
        delete next[permissionKey];
        return next;
      });
    }
  }

  function setPermissionReason(permissionKey: string, reason: string) {
    setPermissionReasons((current) => ({ ...current, [permissionKey]: reason }));
  }

  function clearForm() {
    setFullName("");
    setEmail("");
    setRole("ReadOnly");
    setPosition("");
    setUserStatus("Active");
    setPassword("");
    setConfirmPassword("");
    setSetPasswordNow(false);
    setMobilePhone("");
    setCostPerHour("");
    setSellPerHour("");
    resetAccessState("internal", "ReadOnly");
  }

  function openInviteDialog() {
    setEditingEmail(null);
    clearForm();
    setFormOpen(true);
  }

  function startEdit(user: User) {
    setEditingEmail(user.email);
    setFullName(user.full_name);
    setEmail(user.email);
    setRole(user.role);
    setPosition(user.position || "");
    setUserStatus(user.status || "Active");
    setPassword("");
    setConfirmPassword("");
    setSetPasswordNow(false);
    setMobilePhone(user.mobile_phone || "");
    setCostPerHour(user.cost_per_hour != null ? String(user.cost_per_hour) : "");
    setSellPerHour(user.sell_per_hour != null ? String(user.sell_per_hour) : "");
    setFormOpen(true);
    loadUserAccess(user.email);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingEmail(null);
    clearForm();
  }

  function handleUserTypeChange(nextType: string) {
    const normalizedType = normalizeUserType(nextType);
    setUserType(normalizedType);
    setAccessScope(normalizeAccessScope(normalizedType, accessScope));
    const roleIsPortal = PORTAL_ROLE_NAMES.has(role);
    if (normalizedType === "client_portal" && !roleIsPortal) {
      setRole(allRoleOptions.find((name) => PORTAL_ROLE_NAMES.has(name)) || "ClientViewer");
    }
    if (normalizedType === "internal" && roleIsPortal) {
      setRole(allRoleOptions.find((name) => !PORTAL_ROLE_NAMES.has(name)) || "ReadOnly");
    }
  }

  async function saveUser() {
    if (!fullName.trim() || !email.trim()) {
      setStatus("Full name and email are required");
      return;
    }

    const shouldValidatePassword = editingEmail
      ? Boolean(password || confirmPassword)
      : setPasswordNow;

    if (shouldValidatePassword) {
      if (!password) {
        setStatus("Password is required");
        return;
      }
      if (password !== confirmPassword) {
        setStatus("Password and confirm password do not match");
        return;
      }
      if (password.length < 8) {
        setStatus("Password must be at least 8 characters");
        return;
      }
    }

    setStatus(editingEmail ? "Updating user..." : "Saving user...");

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const normalizedUserType = normalizeUserType(userType);
      const normalizedAccessScope = normalizeAccessScope(normalizedUserType, accessScope);
      const body = {
        full_name: fullName.trim(),
        email: normalizedEmail,
        role,
        position: position || null,
        mobile_phone: mobilePhone.trim() || null,
        cost_per_hour: costPerHour.trim() === "" ? null : Number(costPerHour),
        sell_per_hour: sellPerHour.trim() === "" ? null : Number(sellPerHour),
        status: userStatus,
        user_type: normalizedUserType,
        access_scope: normalizedAccessScope,
        password: shouldValidatePassword ? password : undefined,
      };

      const res = await fetch(`${baseUrl}/admin/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.detail || `Save failed: ${res.status}`);
      }

      const overridePayload = Object.entries(permissionEffects)
        .filter(([, effect]) => effect === "allow" || effect === "deny")
        .map(([permission_key, effect]) => ({
          permission_key,
          effect,
          reason: permissionReasons[permission_key]?.trim() || null,
        }));

      const accessRes = await fetch(
        `${baseUrl}/admin/users/${encodeURIComponent(normalizedEmail)}/access`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role,
            user_type: normalizedUserType,
            access_scope: normalizedAccessScope,
            linked_clients: linkedClientIds.map((client_db_id) => ({ client_db_id })),
            overrides: overridePayload,
          }),
        }
      );

      if (!accessRes.ok) {
        const payload = await accessRes.json().catch(() => ({}));
        throw new Error(payload?.detail || `Access save failed: ${accessRes.status}`);
      }

      if (editingEmail) {
        setStatus("User updated");
      } else if (shouldValidatePassword) {
        setStatus("User created with temporary password. User must change it at first login.");
      } else {
        setStatus("User invited. Invite expires in 7 days.");
      }

      closeForm();
      await loadData();
      setTimeout(() => setStatus(""), 4000);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    }
  }

  async function setActiveState(emailValue: string, activate: boolean) {
    const actionLabel = activate ? "reactivate" : "deactivate";
    const confirmed = await confirmAction({
      title: `${actionLabel[0].toUpperCase() + actionLabel.slice(1)} user?`,
      description: `Are you sure you want to ${actionLabel} ${emailValue}?`,
      confirmLabel: actionLabel[0].toUpperCase() + actionLabel.slice(1),
      destructive: !activate,
    });
    if (!confirmed) return;

    try {
      const res = await fetch(`${baseUrl}/admin/users/${encodeURIComponent(emailValue)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: activate ? "Active" : "Disabled" }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.detail || `Request failed: ${res.status}`);
      }

      setStatus(activate ? "User reactivated" : "User deactivated");
      await loadData();
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    }
  }

  async function resetPassword(emailValue: string) {
    const confirmed = await confirmAction({
      title: "Generate temporary password?",
      description: `Generate a temporary password for ${emailValue}?`,
      confirmLabel: "Generate",
    });
    if (!confirmed) return;

    try {
      const res = await fetch(`${baseUrl}/admin/users/${encodeURIComponent(emailValue)}/password/reset`, {
        method: "POST",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.detail || `Reset failed: ${res.status}`);
      }

      const tempPassword = String(payload?.temporary_password || "");
      if (!tempPassword) {
        setStatus("Temporary password generated");
        return;
      }

      try {
        await navigator.clipboard.writeText(tempPassword);
        setStatus("Temporary password generated and copied to clipboard");
      } catch {
        setStatus("Temporary password generated");
      }

      window.alert(
        `Temporary password for ${emailValue}:\n\n${tempPassword}\n\nShare securely. User will be prompted to change it after login.`
      );
      await loadData();
      setTimeout(() => setStatus(""), 5000);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    }
  }

  async function reinviteUser(emailValue: string) {
    const confirmed = await confirmAction({
      title: "Re-invite user?",
      description: `Re-invite ${emailValue}? This will generate a new temporary password valid for 7 days.`,
      confirmLabel: "Re-invite",
    });
    if (!confirmed) return;

    try {
      const res = await fetch(`${baseUrl}/admin/users/${encodeURIComponent(emailValue)}/reinvite`, {
        method: "POST",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.detail || `Re-invite failed: ${res.status}`);
      }

      const tempPassword = String(payload?.temporary_password || "");
      const expiresAt = String(payload?.invite_expires_at || "");

      try {
        if (tempPassword) {
          await navigator.clipboard.writeText(tempPassword);
        }
      } catch {
        // clipboard is best-effort only
      }

      window.alert(
        `Re-invite created for ${emailValue}.\n\nTemporary password:\n${tempPassword || "(not returned)"}\n\nExpires:\n${prettyDate(expiresAt)}`
      );
      setStatus("User re-invited");
      await loadData();
      setTimeout(() => setStatus(""), 5000);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    }
  }

  const positionOptions = useMemo(() => {
    const names = positions.map((p) => p.name);
    if (position && !names.includes(position)) {
      return [position, ...names];
    }
    return names;
  }, [positions, position]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();

    const rows = users.filter((user) => {
      if (q) {
        const haystack = `${user.full_name} ${user.email} ${user.position || ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      if (roleFilter !== "all" && user.role !== roleFilter) return false;

      const derivedStatus = lifecycleStatus(user);
      if (statusFilter !== "all" && derivedStatus !== statusFilter) return false;

      if (passwordFilter === "has" && !user.has_password) return false;
      if (passwordFilter === "none" && user.has_password) return false;

      return true;
    });

    return rows.sort((a, b) => {
      if (sortBy === "role") return a.role.localeCompare(b.role);
      if (sortBy === "status") return lifecycleStatus(a).localeCompare(lifecycleStatus(b));
      if (sortBy === "access") {
        const av = `${normalizeUserType(a.user_type)}|${normalizeAccessScope(
          normalizeUserType(a.user_type),
          a.access_scope
        )}|${
          a.has_password ? "set" : "none"
        }`;
        const bv = `${normalizeUserType(b.user_type)}|${normalizeAccessScope(
          normalizeUserType(b.user_type),
          b.access_scope
        )}|${
          b.has_password ? "set" : "none"
        }`;
        return av.localeCompare(bv);
      }
      if (sortBy === "invite_date") {
        const at = a.invited_at ? new Date(a.invited_at).getTime() : 0;
        const bt = b.invited_at ? new Date(b.invited_at).getTime() : 0;
        return bt - at;
      }
      return a.full_name.localeCompare(b.full_name);
    });
  }, [users, search, roleFilter, statusFilter, passwordFilter, sortBy]);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: "#F26624" }}>
              Team Management
            </h1>
            <p className="text-sm text-muted-foreground">
              Invite team members, assign roles, and manage access lifecycle
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={openInviteDialog}>Invite Team Member</Button>
            <Button variant="secondary" asChild>
              <Link href="/admin">Back to Admin</Link>
            </Button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        )}
        {status && <div className="mb-4 rounded-md bg-muted p-3 text-sm">{status}</div>}

        <Card>
          <CardHeader className="gap-4">
            <CardTitle>Team Members</CardTitle>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email, position"
                className="xl:col-span-2"
              />

              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  {(allRoleOptions.length > 0
                    ? allRoleOptions
                    : [
                        "SuperAdmin",
                        "Admin",
                        "Consultant",
                        "ReadOnly",
                        "CRM",
                        "QA",
                        "Support",
                        "ClientAdmin",
                        "ClientContributor",
                        "ClientViewer",
                        "ClientReporting",
                      ]
                  ).map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All status</SelectItem>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Invited">Invited</SelectItem>
                  <SelectItem value="Invite Lapsed">Invite Lapsed</SelectItem>
                  <SelectItem value="Deactivated">Deactivated</SelectItem>
                </SelectContent>
              </Select>

              <Select value={passwordFilter} onValueChange={setPasswordFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Password" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All passwords</SelectItem>
                  <SelectItem value="has">Password set</SelectItem>
                  <SelectItem value="none">No password</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex items-center justify-between text-sm text-muted-foreground">
              <span>{filteredUsers.length} members</span>
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
                <SelectTrigger className="w-[230px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Sort: Name</SelectItem>
                  <SelectItem value="role">Sort: Role</SelectItem>
                  <SelectItem value="status">Sort: Lifecycle Status</SelectItem>
                  <SelectItem value="access">Sort: Access Type</SelectItem>
                  <SelectItem value="invite_date">Sort: Invite Date</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {loading ? (
              <div className="text-sm text-muted-foreground">Loading...</div>
            ) : filteredUsers.length === 0 ? (
              <div className="text-sm text-muted-foreground">No team members match this filter</div>
            ) : (
              <div className="max-h-[700px] overflow-auto rounded-md border">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Position</TableHead>
                      <TableHead>Access</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((user) => {
                      const state = lifecycleStatus(user);
                      const isActive = state !== "Deactivated";
                      return (
                        <TableRow key={user.email}>
                          <TableCell>
                            <div className="font-medium">{user.full_name}</div>
                            <div className="text-xs text-muted-foreground">{user.email}</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">{user.role}</Badge>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-muted-foreground">{user.position || "-"}</span>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <div className="flex flex-wrap gap-1">
                                <Badge variant="outline">
                                  {USER_TYPE_LABELS[normalizeUserType(user.user_type)] || "Internal"}
                                </Badge>
                                <Badge variant="outline">
                                  {ACCESS_SCOPE_LABELS[
                                    normalizeAccessScope(normalizeUserType(user.user_type), user.access_scope)
                                  ] ||
                                    normalizeAccessScope(normalizeUserType(user.user_type), user.access_scope)}
                                </Badge>
                              </div>
                              {user.has_password ? (
                                <Badge className="w-fit bg-emerald-100 text-emerald-900 hover:bg-emerald-100">
                                  Password set
                                </Badge>
                              ) : (
                                <Badge className="w-fit bg-amber-100 text-amber-900 hover:bg-amber-100">
                                  No password
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {state === "Active" && (
                              <Badge className="bg-green-100 text-green-900 hover:bg-green-100">Active</Badge>
                            )}
                            {state === "Invited" && (
                              <Badge className="bg-blue-100 text-blue-900 hover:bg-blue-100">Invited</Badge>
                            )}
                            {state === "Invite Lapsed" && (
                              <Badge className="bg-orange-100 text-orange-900 hover:bg-orange-100">
                                Invite Lapsed
                              </Badge>
                            )}
                            {state === "Deactivated" && <Badge variant="outline">Deactivated</Badge>}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="outline" onClick={() => startEdit(user)}>
                                Edit
                              </Button>
                              <Button size="sm" variant="secondary" onClick={() => reinviteUser(user.email)}>
                                Send Invite Email
                              </Button>
                              <Button size="sm" variant="secondary" onClick={() => resetPassword(user.email)}>
                                Reset Password
                              </Button>
                              {isActive ? (
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => setActiveState(user.email, false)}
                                >
                                  Deactivate
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setActiveState(user.email, true)}
                                >
                                  Reactivate
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog
          open={formOpen}
          onOpenChange={(open) => {
            if (open) {
              setFormOpen(true);
            } else {
              closeForm();
            }
          }}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingEmail ? "Edit Team Member" : "Invite Team Member"}</DialogTitle>
              <DialogDescription>
                {!editingEmail
                  ? "Create the user profile first. Invite expires after 7 days."
                  : "Update profile, role, and lifecycle settings."}
              </DialogDescription>
            </DialogHeader>

            <Tabs value={dialogTab} onValueChange={setDialogTab} className="space-y-4">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="profile">Profile</TabsTrigger>
                <TabsTrigger value="access">Access</TabsTrigger>
              </TabsList>

              <TabsContent value="profile" className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="fullName">Full Name *</Label>
                  <Input
                    id="fullName"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="John Doe"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email *</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="john.doe@example.com"
                    disabled={Boolean(editingEmail)}
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="userStatus">Status</Label>
                    <Select value={userStatus} onValueChange={setUserStatus}>
                      <SelectTrigger id="userStatus">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Active">Active</SelectItem>
                        <SelectItem value="Disabled">Disabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="position">Position</Label>
                    <Select value={position || "__none"} onValueChange={(v) => setPosition(v === "__none" ? "" : v)}>
                      <SelectTrigger id="position">
                        <SelectValue placeholder="Select a position" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">No position</SelectItem>
                        {positionOptions.map((name) => (
                          <SelectItem key={name} value={name}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="text-xs text-muted-foreground">
                      Positions are managed in Admin {"->"} Manage Lookups {"->"} Positions.
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="mobilePhone">Mobile Phone</Label>
                    <Input
                      id="mobilePhone"
                      value={mobilePhone}
                      onChange={(e) => setMobilePhone(e.target.value)}
                      placeholder="+44 7..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="costPerHour">Cost/hr</Label>
                    <Input
                      id="costPerHour"
                      type="number"
                      step="0.01"
                      min="0"
                      value={costPerHour}
                      onChange={(e) => setCostPerHour(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sellPerHour">Sell/hr</Label>
                    <Input
                      id="sellPerHour"
                      type="number"
                      step="0.01"
                      min="0"
                      value={sellPerHour}
                      onChange={(e) => setSellPerHour(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </div>

                {!editingEmail && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={setPasswordNow}
                      onChange={(e) => {
                        setSetPasswordNow(e.target.checked);
                        if (!e.target.checked) {
                          setPassword("");
                          setConfirmPassword("");
                        }
                      }}
                    />
                    Set initial password now (advanced)
                  </label>
                )}

                {(editingEmail || setPasswordNow) && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="password">{editingEmail ? "New Password" : "Password"}</Label>
                      <Input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={editingEmail ? "Leave blank to keep current password" : "Set initial password"}
                      />
                      <div className="text-xs text-muted-foreground">Minimum 8 characters.</div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="confirmPassword">Confirm Password</Label>
                      <Input
                        id="confirmPassword"
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter password"
                      />
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="access" className="space-y-4">
                {accessError && (
                  <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                    {accessError}
                  </div>
                )}
                {accessLoading && (
                  <div className="rounded-md border p-3 text-sm text-muted-foreground">
                    Loading access details...
                  </div>
                )}

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="userType">User Type</Label>
                    <Select value={userType} onValueChange={handleUserTypeChange}>
                      <SelectTrigger id="userType">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(accessOptions.user_types || ["internal", "client_portal"]).map((item) => (
                          <SelectItem key={item} value={item}>
                            {USER_TYPE_LABELS[item] || item}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="role">Role *</Label>
                    <Select value={role} onValueChange={setRole}>
                      <SelectTrigger id="role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(visibleRoleOptions.length > 0
                          ? visibleRoleOptions
                          : userType === "client_portal"
                            ? ["ClientViewer", "ClientContributor", "ClientAdmin", "ClientReporting"]
                            : ["SuperAdmin", "Admin", "Consultant", "ReadOnly", "CRM", "QA", "Support"]
                        ).map((r) => (
                          <SelectItem key={r} value={r}>
                            {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="accessScope">Access Scope</Label>
                    <Select value={accessScope} onValueChange={setAccessScope}>
                      <SelectTrigger id="accessScope">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(accessOptions.access_scopes || ["all", "linked_clients"])
                          .filter((scope) => (userType === "client_portal" ? scope === "linked_clients" : true))
                          .map((scope) => (
                            <SelectItem key={scope} value={scope}>
                              {ACCESS_SCOPE_LABELS[scope] || scope}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {isSuperAdmin && (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                    This user is a SuperAdmin. All permissions are granted automatically.
                  </div>
                )}

                {accessScope === "linked_clients" && (
                  <div className="space-y-3 rounded-md border p-4">
                    <div>
                      <div className="font-medium">Linked Clients</div>
                      <div className="text-sm text-muted-foreground">
                        Only these clients and their jobs will be visible to this user.
                      </div>
                    </div>
                    <Input
                      value={linkedClientSearch}
                      onChange={(e) => setLinkedClientSearch(e.target.value)}
                      placeholder="Filter linked clients"
                    />
                    <div className="max-h-56 space-y-2 overflow-auto rounded-md border p-3">
                      {filteredLinkedClients.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No clients match this filter.</div>
                      ) : (
                        filteredLinkedClients.map((client) => {
                          const checked = linkedClientIds.includes(client.client_db_id);
                          return (
                            <label
                              key={client.client_db_id}
                              className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                            >
                              <span>{client.client_name}</span>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleLinkedClient(client.client_db_id)}
                              />
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-md border p-4">
                    <div className="font-medium">Effective Permissions</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {effectivePermissions.length > 0 ? (
                        effectivePermissions.map((permission) => (
                          <Badge key={permission} variant="secondary">
                            {permission}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-sm text-muted-foreground">No effective permissions loaded yet.</span>
                      )}
                    </div>
                  </div>

                  <div className="rounded-md border p-4">
                    <div className="font-medium">Denied Permissions</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {deniedPermissions.length > 0 ? (
                        deniedPermissions.map((permission) => (
                          <Badge key={permission} variant="destructive">
                            {permission}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-sm text-muted-foreground">No explicit denies.</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-3 rounded-md border p-4">
                  <div>
                    <div className="font-medium">Permission Overrides</div>
                    <div className="text-sm text-muted-foreground">
                      Inherit by default. Use Allow or Deny only when this user needs an exception.
                    </div>
                  </div>
                  <div className="max-h-72 overflow-auto rounded-md border">
                    <Table>
                      <TableHeader className="sticky top-0 bg-background">
                        <TableRow>
                          <TableHead>Permission</TableHead>
                          <TableHead className="w-[160px]">Setting</TableHead>
                          <TableHead>Reason</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {overrideRows.map((permission) => (
                          <TableRow key={permission.permission_key}>
                            <TableCell>
                              <div className="font-medium">{permission.permission_key}</div>
                              <div className="text-xs text-muted-foreground">{permission.description}</div>
                            </TableCell>
                            <TableCell>
                              <Select
                                value={permission.effect}
                                onValueChange={(value) =>
                                  setPermissionEffect(permission.permission_key, value as PermissionSetting)
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="inherit">Inherited</SelectItem>
                                  <SelectItem value="allow">Allow</SelectItem>
                                  <SelectItem value="deny">Deny</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Input
                                value={permission.reason}
                                onChange={(e) => setPermissionReason(permission.permission_key, e.target.value)}
                                placeholder="Why this override exists"
                                disabled={permission.effect === "inherit"}
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                {editingEmail && (
                  <div className="rounded-md border p-3 text-xs text-muted-foreground">
                    <div className="mb-2 font-medium text-foreground">Invite & Access Details</div>
                    {(() => {
                      const currentUser = users.find((u) => u.email === editingEmail);
                      return (
                        <>
                          <div className="grid gap-1 md:grid-cols-2">
                            <div>Invited At: {prettyDate(currentUser?.invited_at)}</div>
                            <div>Invited By: {currentUser?.invited_by || "-"}</div>
                            <div>Invite Expires: {prettyDate(currentUser?.invite_expires_at)}</div>
                            <div>Password Set: {currentUser?.has_password ? "Yes" : "No"}</div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => currentUser?.email && reinviteUser(currentUser.email)}
                              disabled={!currentUser?.email}
                            >
                              Send Invite Email
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => currentUser?.email && resetPassword(currentUser.email)}
                              disabled={!currentUser?.email}
                            >
                              Reset Password
                            </Button>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}
              </TabsContent>
            </Tabs>

            <DialogFooter>
              <Button variant="outline" onClick={closeForm}>
                Cancel
              </Button>
              <Button onClick={saveUser}>
                {editingEmail ? "Save Changes" : setPasswordNow ? "Create User" : "Invite User"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Roles & Permissions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <span className="font-medium">SuperAdmin:</span> Full unrestricted access across all clients, jobs, settings, and security controls.
            </div>
            <div>
              <span className="font-medium">Admin:</span> Full system access including team management and settings.
            </div>
            <div>
              <span className="font-medium">Consultant:</span> Manage clients, jobs, and reports.
            </div>
            <div>
              <span className="font-medium">CRM:</span> Manage clients and contacts.
            </div>
            <div>
              <span className="font-medium">QA:</span> Review and approve outputs.
            </div>
            <div>
              <span className="font-medium">Support:</span> Assist clients with view/update actions.
            </div>
            <div>
              <span className="font-medium">ReadOnly:</span> View-only access.
            </div>
            <div className="pt-2 text-xs text-muted-foreground">
              Client portal roles: <span className="font-medium text-foreground">ClientAdmin</span>,{" "}
              <span className="font-medium text-foreground">ClientContributor</span>,{" "}
              <span className="font-medium text-foreground">ClientViewer</span>, and{" "}
              <span className="font-medium text-foreground">ClientReporting</span>. Use linked-client scope
              to restrict portal users to specific clients and jobs.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
