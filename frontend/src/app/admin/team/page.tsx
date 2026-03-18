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

type SortBy = "name" | "role" | "status" | "access" | "invite_date";
type LifecycleStatus = "Active" | "Invited" | "Invite Lapsed" | "Deactivated";

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

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [usersRes, rolesRes, positionsRes] = await Promise.all([
        fetch(`${baseUrl}/admin/users`),
        fetch(`${baseUrl}/admin/roles`),
        fetch(`${baseUrl}/admin/lookups/positions_lookup`),
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
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
  }

  function closeForm() {
    setFormOpen(false);
    setEditingEmail(null);
    clearForm();
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
      const body = {
        full_name: fullName.trim(),
        email: email.trim().toLowerCase(),
        role,
        position: position || null,
        mobile_phone: mobilePhone.trim() || null,
        cost_per_hour: costPerHour.trim() === "" ? null : Number(costPerHour),
        sell_per_hour: sellPerHour.trim() === "" ? null : Number(sellPerHour),
        status: userStatus,
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

  const activeRoles = useMemo(
    () => roles.filter((r) => r.is_active).map((r) => r.role_name),
    [roles]
  );

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
        const av = a.has_password ? "set" : "none";
        const bv = b.has_password ? "set" : "none";
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
                  {(activeRoles.length > 0
                    ? activeRoles
                    : ["Admin", "Consultant", "ReadOnly", "CRM", "QA", "Support"]
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
                  <SelectItem value="access">Sort: Password State</SelectItem>
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
                            {user.has_password ? (
                              <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">
                                Password set
                              </Badge>
                            ) : (
                              <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">
                                No password
                              </Badge>
                            )}
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

        <Dialog open={formOpen} onOpenChange={setFormOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingEmail ? "Edit Team Member" : "Invite Team Member"}</DialogTitle>
              <DialogDescription>
                {!editingEmail
                  ? "Create the user profile first. Invite expires after 7 days."
                  : "Update profile, role, and lifecycle settings."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
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
                  <Label htmlFor="role">Role *</Label>
                  <Select value={role} onValueChange={setRole}>
                    <SelectTrigger id="role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(activeRoles.length > 0
                        ? activeRoles
                        : ["Admin", "Consultant", "ReadOnly", "CRM", "QA", "Support"]
                      ).map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

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

              {editingEmail && (
                <div className="rounded-md border p-3 text-xs text-muted-foreground">
                  <div className="font-medium text-foreground mb-2">Invite & Access Details</div>
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
            </div>

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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
