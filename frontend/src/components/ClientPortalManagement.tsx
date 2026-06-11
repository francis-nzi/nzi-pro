"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ExternalLink,
  History,
  RefreshCw,
  UserPlus,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ── Types ─────────────────────────────────────────────────────────────────────

type PortalUser = {
  portal_user_id: number;
  email: string;
  full_name: string;
  is_active: boolean;
  last_login_at: string | null;
};

type PortalHistoryItem = {
  job_id: number;
  job_number: string;
  job_title: string;
  reporting_year: number | null;
  reporting_period_start: string | null;
  reporting_period_end: string | null;
  review_status: string;
  portal_version_id: number | null;
  sent_for_review_at: string | null;
  sent_by: string | null;
  published_at: string | null;
  published_by: string | null;
};

type Props = {
  clientId: number;
  baseUrl: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const REVIEW_STATUS_COLOURS: Record<string, string> = {
  not_sent: "bg-gray-100 text-gray-600 border-gray-200",
  draft: "bg-gray-100 text-gray-600 border-gray-200",
  sent_for_review: "bg-blue-100 text-blue-700 border-blue-200",
  changes_requested: "bg-amber-100 text-amber-700 border-amber-200",
  approved: "bg-green-100 text-green-700 border-green-200",
};

const REVIEW_STATUS_LABELS: Record<string, string> = {
  not_sent: "Not sent",
  draft: "Draft",
  sent_for_review: "Awaiting client",
  changes_requested: "Changes requested",
  approved: "Approved",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function periodLabel(item: PortalHistoryItem): string {
  if (item.reporting_year) return String(item.reporting_year);
  if (item.reporting_period_start && item.reporting_period_end) {
    return `${fmtDate(item.reporting_period_start)} – ${fmtDate(item.reporting_period_end)}`;
  }
  return "—";
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ClientPortalManagement({ clientId, baseUrl }: Props) {
  const [portalUsers, setPortalUsers] = useState<PortalUser[]>([]);
  const [history, setHistory] = useState<PortalHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusMsg, setStatusMsg] = useState("");

  // Add user form
  const [showAddUser, setShowAddUser] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [addingUser, setAddingUser] = useState(false);
  const [addError, setAddError] = useState("");

  // Reset password
  const [resettingFor, setResettingFor] = useState<number | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [usersRes, historyRes] = await Promise.all([
        fetch(`${baseUrl}/clients/${clientId}/portal-users`, { credentials: "include" }),
        fetch(`${baseUrl}/clients/${clientId}/portal-history`, { credentials: "include" }),
      ]);
      if (usersRes.ok) {
        const data = await usersRes.json() as { items: PortalUser[] };
        setPortalUsers(data.items ?? []);
      }
      if (historyRes.ok) {
        const data = await historyRes.json() as { items: PortalHistoryItem[] };
        setHistory(data.items ?? []);
      }
    } catch {
      setError("Failed to load portal data");
    } finally {
      setLoading(false);
    }
  }, [baseUrl, clientId]);

  useEffect(() => { void load(); }, [load]);

  async function safeJson<T>(res: Response): Promise<T> {
    try { return await res.json() as T; }
    catch { throw new Error(`Server error (HTTP ${res.status})`); }
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    setAddingUser(true);
    setAddError("");
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/portal-users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: newEmail.trim(), full_name: newName.trim(), password: newPassword }),
      });
      const data = await safeJson<{ ok?: boolean; detail?: string }>(res);
      if (!res.ok) throw new Error(data.detail ?? "Failed to create user");
      setShowAddUser(false);
      setNewName(""); setNewEmail(""); setNewPassword("");
      setStatusMsg("Portal user created and welcome email sent.");
      await load();
    } catch (e) {
      setAddError((e as Error).message);
    } finally {
      setAddingUser(false);
    }
  }

  async function handleToggleActive(user: PortalUser) {
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/portal-users/${user.portal_user_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ is_active: !user.is_active }),
      });
      if (!res.ok) throw new Error("Failed to update user");
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!resettingFor) return;
    setResetting(true);
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/portal-users/${resettingFor}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ new_password: resetPassword }),
      });
      const data = await safeJson<{ ok?: boolean; detail?: string }>(res);
      if (!res.ok) throw new Error(data.detail ?? "Failed to reset password");
      setResettingFor(null);
      setResetPassword("");
      setStatusMsg("Password reset successfully.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResetting(false);
    }
  }

  if (loading) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading portal data…</div>;
  }

  const activeCount = portalUsers.filter(u => u.is_active).length;

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Client Portal</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Manage portal access and view which reporting years have been published.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} className="flex items-center gap-1.5 text-xs">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {statusMsg && (
        <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          {statusMsg}
        </div>
      )}

      {/* Portal Users */}
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" />
              Portal Users
              {activeCount > 0 && (
                <Badge variant="secondary" className="text-xs">{activeCount} active</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Client contacts with NZInsights portal accounts. Users can access all published years for this client.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => { setShowAddUser(v => !v); setAddError(""); }}>
            <UserPlus className="mr-2 h-4 w-4" />
            Add Portal User
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">

          {showAddUser && (
            <form onSubmit={e => void handleAddUser(e)} className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="pu-name">Full Name</Label>
                  <Input id="pu-name" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Jane Smith" required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pu-email">Email</Label>
                  <Input id="pu-email" type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="jane@example.com" required />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="pu-pass">Temporary Password</Label>
                <Input id="pu-pass" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Min 8 characters" required minLength={8} />
              </div>
              {addError && <p className="text-xs text-red-600">{addError}</p>}
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={addingUser}>
                  {addingUser ? "Creating…" : "Create Account & Send Welcome Email"}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setShowAddUser(false)}>Cancel</Button>
              </div>
            </form>
          )}

          {portalUsers.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No portal users yet. Add one above to give this client access to NZInsights.
            </div>
          ) : (
            <div className="divide-y rounded-md border">
              {portalUsers.map(user => (
                <div key={user.portal_user_id}>
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{user.full_name}</div>
                      <div className="text-xs text-muted-foreground">{user.email}</div>
                      {user.last_login_at && (
                        <div className="text-xs text-muted-foreground">Last login: {fmtDate(user.last_login_at)}</div>
                      )}
                      {!user.last_login_at && (
                        <div className="text-xs text-muted-foreground">Never logged in</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={user.is_active ? "secondary" : "outline"}>
                        {user.is_active ? "Active" : "Inactive"}
                      </Badge>
                      <Button variant="ghost" size="sm" onClick={() => void handleToggleActive(user)}>
                        {user.is_active ? "Deactivate" : "Reactivate"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-muted-foreground"
                        onClick={() => { setResettingFor(resettingFor === user.portal_user_id ? null : user.portal_user_id); setResetPassword(""); }}
                      >
                        Reset password
                      </Button>
                    </div>
                  </div>

                  {resettingFor === user.portal_user_id && (
                    <form onSubmit={e => void handleResetPassword(e)} className="flex items-end gap-2 border-t bg-muted/20 px-4 py-3">
                      <div className="space-y-1">
                        <Label htmlFor={`rp-${user.portal_user_id}`} className="text-xs">New password (min 8 chars)</Label>
                        <Input
                          id={`rp-${user.portal_user_id}`}
                          type="password"
                          value={resetPassword}
                          onChange={e => setResetPassword(e.target.value)}
                          placeholder="New password"
                          required
                          minLength={8}
                          className="h-8 text-xs w-48"
                        />
                      </div>
                      <Button type="submit" size="sm" disabled={resetting}>{resetting ? "Saving…" : "Set Password"}</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setResettingFor(null)}>Cancel</Button>
                    </form>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Publication History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            Publication History
          </CardTitle>
          <CardDescription>
            Reporting years that have been sent to the NZInsights portal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No reports have been sent to the portal yet. Use the Portal Management tab inside a job to publish.
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Job</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Year</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Review status</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Last sent</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Sent by</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"></th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(item => {
                    const sentAt = item.sent_for_review_at ?? item.published_at;
                    const sentBy = item.sent_by ?? item.published_by;
                    const statusColour = REVIEW_STATUS_COLOURS[item.review_status] ?? "bg-gray-100 text-gray-600 border-gray-200";
                    const statusLabel = REVIEW_STATUS_LABELS[item.review_status] ?? item.review_status;
                    return (
                      <tr key={item.job_id} className="border-b last:border-0 hover:bg-gray-50/50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{item.job_number}</div>
                          <div className="text-xs text-gray-500 truncate max-w-[200px]">{item.job_title}</div>
                        </td>
                        <td className="px-4 py-3 text-gray-700">{periodLabel(item)}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={`text-xs ${statusColour}`}>{statusLabel}</Badge>
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-xs">{fmtDateTime(sentAt)}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{sentBy ?? "—"}</td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/jobs/${item.job_id}/portal-management`}
                            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                          >
                            Manage
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
