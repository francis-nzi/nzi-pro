"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
}

type User = {
  user_id: string;
  full_name: string;
  email: string;
  role: string;
  status: string;
};

type Role = {
  role_name: string;
  is_active: boolean;
};

export default function TeamManagementPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [editingEmail, setEditingEmail] = useState<string | null>(null);

  // Form fields
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("ReadOnly");
  const [userStatus, setUserStatus] = useState("Active");

  useEffect(() => {
    loadData();
  }, [baseUrl]);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [usersRes, rolesRes] = await Promise.all([
        fetch(`${baseUrl}/admin/users`),
        fetch(`${baseUrl}/admin/roles`),
      ]);

      if (usersRes.ok) {
        const usersJson = await usersRes.json();
        setUsers(usersJson.items || []);
      }

      if (rolesRes.ok) {
        const rolesJson = await rolesRes.json();
        setRoles(rolesJson.items || []);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function startEdit(user: User) {
    setEditingEmail(user.email);
    setFullName(user.full_name);
    setEmail(user.email);
    setRole(user.role);
    setUserStatus(user.status);
  }

  function cancelEdit() {
    setEditingEmail(null);
    clearForm();
  }

  function clearForm() {
    setFullName("");
    setEmail("");
    setRole("ReadOnly");
    setUserStatus("Active");
  }

  async function saveUser() {
    if (!fullName.trim() || !email.trim()) {
      setStatus("Full name and email are required");
      return;
    }

    setStatus("Saving...");
    try {
      const body = {
        full_name: fullName.trim(),
        email: email.trim().toLowerCase(),
        role: role,
        status: userStatus,
      };

      const res = await fetch(`${baseUrl}/admin/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Save failed: ${res.status} - ${text}`);
      }

      setStatus(editingEmail ? "User updated!" : "User added!");
      cancelEdit();
      loadData();
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    }
  }

  async function disableUser(email: string) {
    if (!confirm("Are you sure you want to disable this user?")) return;

    try {
      const res = await fetch(`${baseUrl}/admin/users/${encodeURIComponent(email)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Disabled" }),
      });

      if (!res.ok) {
        throw new Error(`Disable failed: ${res.status}`);
      }

      setStatus("User disabled");
      loadData();
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    }
  }

  const activeRoles = roles.filter(r => r.is_active).map(r => r.role_name);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Team Management</h1>
            <p className="text-sm text-muted-foreground">
              Manage NZI team members, roles, and access
            </p>
          </div>
          <Button variant="secondary" asChild>
            <Link href="/admin">← Back to Admin</Link>
          </Button>
        </div>

        {error && <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        {status && <div className="mb-4 rounded-md bg-muted p-3 text-sm">{status}</div>}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* User List */}
          <Card>
            <CardHeader>
              <CardTitle>Team Members</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-sm text-muted-foreground">Loading...</div>
              ) : users.length === 0 ? (
                <div className="text-sm text-muted-foreground">No team members found</div>
              ) : (
                <div className="space-y-2">
                  {users.map((user) => (
                    <div
                      key={user.email}
                      className="rounded-md border p-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="font-medium">{user.full_name}</div>
                          <div className="text-sm text-muted-foreground">{user.email}</div>
                          <div className="mt-1 flex gap-2 text-xs">
                            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-800">
                              {user.role}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 ${
                                user.status === "Active"
                                  ? "bg-green-100 text-green-800"
                                  : "bg-gray-100 text-gray-600"
                              }`}
                            >
                              {user.status}
                            </span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => startEdit(user)}
                          >
                            Edit
                          </Button>
                          {user.status === "Active" && (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => disableUser(user.email)}
                            >
                              Disable
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Add/Edit Form */}
          <Card>
            <CardHeader>
              <CardTitle>{editingEmail ? "Edit Team Member" : "Add Team Member"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
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
                  disabled={!!editingEmail}
                />
                {editingEmail && (
                  <div className="text-xs text-muted-foreground">
                    Email cannot be changed
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="role">Role *</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger id="role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {activeRoles.length > 0 ? (
                      activeRoles.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))
                    ) : (
                      <>
                        <SelectItem value="Admin">Admin</SelectItem>
                        <SelectItem value="Consultant">Consultant</SelectItem>
                        <SelectItem value="ReadOnly">ReadOnly</SelectItem>
                        <SelectItem value="CRM">CRM</SelectItem>
                        <SelectItem value="QA">QA</SelectItem>
                        <SelectItem value="Support">Support</SelectItem>
                      </>
                    )}
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

              <div className="flex gap-2">
                <Button onClick={saveUser} className="flex-1">
                  {editingEmail ? "Update User" : "Add User"}
                </Button>
                {editingEmail && (
                  <Button onClick={cancelEdit} variant="outline">
                    Cancel
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Documentation */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Roles & Permissions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <span className="font-medium">Admin:</span> Full system access including team management and system settings
            </div>
            <div>
              <span className="font-medium">Consultant:</span> Can manage clients, jobs, and generate reports
            </div>
            <div>
              <span className="font-medium">CRM:</span> Can manage clients and contacts
            </div>
            <div>
              <span className="font-medium">QA:</span> Can review and approve reports
            </div>
            <div>
              <span className="font-medium">Support:</span> Can view data and assist clients
            </div>
            <div>
              <span className="font-medium">ReadOnly:</span> View-only access to the system
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
