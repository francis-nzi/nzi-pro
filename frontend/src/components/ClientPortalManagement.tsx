"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FileText,
  History,
  RefreshCw,
  Search,
  Timer,
  UserPlus,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ── Types ─────────────────────────────────────────────────────────────────────

type Candidate = {
  label: string;      // display name
  email: string;
  full_name: string;
  contact_id?: number;
  group: "Client Contacts" | "NZI Team";
};

type PortalUser = {
  portal_user_id: number;
  email: string;
  full_name: string;
  is_active: boolean;
  last_login_at: string | null;
};

type ClientPortalFile = {
  file_id: number;
  job_id: number;
  job_number: string;
  job_title: string;
  reporting_year: number | null;
  file_type: string;
  file_name: string;
  file_size: number | null;
  description: string | null;
  uploaded_at: string | null;
  portal_visible: boolean;
  portal_description: string | null;
  portal_expires_at: string | null;
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

// ── Portal Files Section ──────────────────────────────────────────────────────

function formatFileSize(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type ExpiryFilter = "all" | "forever" | "has_expiry" | "expired" | "expiring_soon";
type VisibilityFilter = "all" | "visible" | "hidden";

function expiryStatus(expiresAt: string | null): "forever" | "expired" | "expiring_soon" | "future" {
  if (!expiresAt) return "forever";
  const d = new Date(expiresAt);
  const now = new Date();
  if (d <= now) return "expired";
  const soon = new Date();
  soon.setDate(soon.getDate() + 30);
  if (d <= soon) return "expiring_soon";
  return "future";
}

function ClientPortalFilesSection({ clientId, baseUrl }: { clientId: number; baseUrl: string }) {
  const [files, setFiles] = useState<ClientPortalFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const descTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  // Filters
  const [search, setSearch] = useState("");
  const [filterJob, setFilterJob] = useState("");
  const [filterYear, setFilterYear] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterVisibility, setFilterVisibility] = useState<VisibilityFilter>("all");
  const [filterExpiry, setFilterExpiry] = useState<ExpiryFilter>("all");

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${baseUrl}/clients/${clientId}/portal-files`, { credentials: "include" });
        const data = await res.json() as { files: ClientPortalFile[] };
        setFiles(data.files ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, [baseUrl, clientId]);

  async function patchPortal(jobId: number, fileId: number, patch: Record<string, unknown>) {
    setSaving(s => ({ ...s, [fileId]: true }));
    try {
      await fetch(`${baseUrl}/jobs/${jobId}/files/${fileId}/portal`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } finally {
      setSaving(s => ({ ...s, [fileId]: false }));
    }
  }

  function toggleVisible(file: ClientPortalFile) {
    const next = !file.portal_visible;
    setFiles(fs => fs.map(f => f.file_id === file.file_id ? { ...f, portal_visible: next } : f));
    void patchPortal(file.job_id, file.file_id, { portal_visible: next });
  }

  function onDescChange(file: ClientPortalFile, value: string) {
    setFiles(fs => fs.map(f => f.file_id === file.file_id ? { ...f, portal_description: value } : f));
    clearTimeout(descTimers.current[file.file_id]);
    descTimers.current[file.file_id] = setTimeout(() => {
      void patchPortal(file.job_id, file.file_id, { portal_description: value });
    }, 600);
  }

  function onExpiryChange(file: ClientPortalFile, value: string) {
    const expires = value || null;
    setFiles(fs => fs.map(f => f.file_id === file.file_id ? { ...f, portal_expires_at: expires } : f));
    void patchPortal(file.job_id, file.file_id, { portal_expires_at: expires ?? "" });
  }

  // ── Derived filter options (unique values from data) ──────────────────────
  const jobOptions = Array.from(
    new Map(files.map(f => [f.job_id, { jobId: f.job_id, label: `${f.job_number} — ${f.job_title}` }])).values()
  );
  const yearOptions = Array.from(new Set(files.map(f => f.reporting_year).filter(Boolean) as number[])).sort((a, b) => b - a);
  const typeOptions = Array.from(new Set(files.map(f => f.file_type).filter(Boolean))).sort();

  // ── Filter logic ──────────────────────────────────────────────────────────
  const q = search.trim().toLowerCase();
  const filteredFiles = files.filter(f => {
    if (q) {
      const haystack = [f.file_name, f.portal_description, f.description, f.job_number, f.job_title, f.file_type]
        .join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (filterJob && String(f.job_id) !== filterJob) return false;
    if (filterYear && String(f.reporting_year) !== filterYear) return false;
    if (filterType && f.file_type !== filterType) return false;
    if (filterVisibility === "visible" && !f.portal_visible) return false;
    if (filterVisibility === "hidden" && f.portal_visible) return false;
    if (filterExpiry !== "all") {
      const status = expiryStatus(f.portal_expires_at);
      if (filterExpiry === "forever" && status !== "forever") return false;
      if (filterExpiry === "has_expiry" && status === "forever") return false;
      if (filterExpiry === "expired" && status !== "expired") return false;
      if (filterExpiry === "expiring_soon" && status !== "expiring_soon") return false;
    }
    return true;
  });

  const isFiltered = q || filterJob || filterYear || filterType || filterVisibility !== "all" || filterExpiry !== "all";

  function clearFilters() {
    setSearch(""); setFilterJob(""); setFilterYear(""); setFilterType("");
    setFilterVisibility("all"); setFilterExpiry("all");
  }

  // Group filtered files by job
  const jobGroups = filteredFiles.reduce<{ jobId: number; jobNumber: string; jobTitle: string; year: number | null; files: ClientPortalFile[] }[]>(
    (acc, f) => {
      const g = acc.find(x => x.jobId === f.job_id);
      if (g) { g.files.push(f); }
      else acc.push({ jobId: f.job_id, jobNumber: f.job_number, jobTitle: f.job_title, year: f.reporting_year, files: [f] });
      return acc;
    },
    [],
  );

  const visibleCount = files.filter(f => f.portal_visible).length;
  const selectCls = "rounded border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4" />
          Portal Files
          {!loading && (
            <span className="text-xs font-normal text-muted-foreground ml-1">
              {visibleCount} of {files.length} visible to client
            </span>
          )}
        </CardTitle>
        <CardDescription>
          Control which files are visible on the client portal, add client-facing descriptions, and set expiry timers.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="py-6 text-sm text-center text-muted-foreground">Loading files…</div>
        ) : files.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No files attached to any jobs for this client yet.
          </div>
        ) : (
          <div className="space-y-4">

            {/* ── Filter bar ── */}
            <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3 space-y-2">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search file name, description, job…"
                  className="w-full rounded-md border border-gray-200 bg-white pl-8 pr-3 py-1.5 text-xs text-gray-700 placeholder-gray-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
                />
              </div>

              {/* Dropdowns */}
              <div className="flex flex-wrap gap-2 items-center">
                <select value={filterJob} onChange={e => setFilterJob(e.target.value)} className={selectCls}>
                  <option value="">All jobs</option>
                  {jobOptions.map(j => (
                    <option key={j.jobId} value={String(j.jobId)}>{j.label}</option>
                  ))}
                </select>

                <select value={filterYear} onChange={e => setFilterYear(e.target.value)} className={selectCls}>
                  <option value="">All years</option>
                  {yearOptions.map(y => <option key={y} value={String(y)}>{y}</option>)}
                </select>

                <select value={filterType} onChange={e => setFilterType(e.target.value)} className={selectCls}>
                  <option value="">All file types</option>
                  {typeOptions.map(t => (
                    <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                  ))}
                </select>

                <select value={filterVisibility} onChange={e => setFilterVisibility(e.target.value as VisibilityFilter)} className={selectCls}>
                  <option value="all">All visibility</option>
                  <option value="visible">Visible on portal</option>
                  <option value="hidden">Hidden from portal</option>
                </select>

                <select value={filterExpiry} onChange={e => setFilterExpiry(e.target.value as ExpiryFilter)} className={selectCls}>
                  <option value="all">All expiry</option>
                  <option value="forever">No expiry (forever)</option>
                  <option value="has_expiry">Has expiry set</option>
                  <option value="expiring_soon">Expiring within 30 days</option>
                  <option value="expired">Already expired</option>
                </select>

                {isFiltered && (
                  <div className="flex items-center gap-2 ml-auto">
                    <span className="text-xs text-gray-500">{filteredFiles.length} of {files.length} files</span>
                    <button
                      onClick={clearFilters}
                      className="text-xs text-blue-600 hover:text-blue-700 underline"
                    >
                      Clear filters
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* ── Results ── */}
            {filteredFiles.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                No files match the current filters.
              </div>
            ) : (
              <div className="space-y-3">
                {jobGroups.map(group => (
                  <div key={group.jobId} className="rounded-md border overflow-hidden">
                    {/* Job header */}
                    <div className="flex items-center justify-between bg-gray-50 px-4 py-2.5 border-b">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-gray-700">{group.jobNumber}</span>
                        <span className="text-xs text-gray-500 truncate max-w-xs">{group.jobTitle}</span>
                        {group.year && <span className="text-xs text-gray-400">{group.year}</span>}
                        <span className="text-xs text-gray-400">· {group.files.length} file{group.files.length !== 1 ? "s" : ""}</span>
                      </div>
                      <Link
                        href={`/jobs/${group.jobId}/portal-management`}
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                      >
                        Manage job
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>

                    {/* Files */}
                    <div className="divide-y divide-gray-50">
                      {group.files.map(file => {
                        const isSaving = saving[file.file_id] ?? false;
                        const expiryValue = file.portal_expires_at ? file.portal_expires_at.slice(0, 16) : "";
                        const expStatus = expiryStatus(file.portal_expires_at);

                        return (
                          <div key={file.file_id} className={`px-4 py-3 ${file.portal_visible ? "bg-white" : "bg-gray-50/40"}`}>
                            <div className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                checked={file.portal_visible}
                                onChange={() => toggleVisible(file)}
                                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-green-600 cursor-pointer flex-shrink-0"
                                title={file.portal_visible ? "Hide from portal" : "Show on portal"}
                              />
                              <div className="flex-1 min-w-0 space-y-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className={`text-sm font-medium truncate max-w-sm ${file.portal_visible ? "text-gray-900" : "text-gray-400"}`}>
                                    {file.file_name}
                                  </span>
                                  <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 flex-shrink-0">
                                    {file.file_type.replace(/_/g, " ")}
                                  </span>
                                  {expStatus === "expired" && (
                                    <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-600">Expired</span>
                                  )}
                                  {expStatus === "expiring_soon" && (
                                    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">Expiring soon</span>
                                  )}
                                  {isSaving && <span className="text-xs text-gray-400">Saving…</span>}
                                </div>
                                <div className="text-xs text-gray-400">
                                  {formatFileSize(file.file_size)}
                                  {file.uploaded_at && <> · Added {fmtDateTime(file.uploaded_at)}</>}
                                </div>
                                <input
                                  type="text"
                                  value={file.portal_description ?? ""}
                                  onChange={e => onDescChange(file, e.target.value)}
                                  placeholder={file.description ?? "Add a description for clients…"}
                                  className="w-full rounded-md border border-gray-200 px-3 py-1.5 text-xs text-gray-700 placeholder-gray-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
                                />
                                <div className="flex items-center gap-2">
                                  <Timer className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                                  <span className="text-xs text-gray-500">Expires:</span>
                                  <input
                                    type="datetime-local"
                                    value={expiryValue}
                                    onChange={e => onExpiryChange(file, e.target.value)}
                                    className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-700 focus:border-blue-400 focus:outline-none"
                                  />
                                  {expiryValue ? (
                                    <button onClick={() => onExpiryChange(file, "")} className="text-xs text-gray-400 hover:text-gray-600 underline">
                                      Set to forever
                                    </button>
                                  ) : (
                                    <span className="text-xs text-gray-400">Forever</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
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
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
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
      const [usersRes, historyRes, candidatesRes] = await Promise.all([
        fetch(`${baseUrl}/clients/${clientId}/portal-users`, { credentials: "include" }),
        fetch(`${baseUrl}/clients/${clientId}/portal-history`, { credentials: "include" }),
        fetch(`${baseUrl}/clients/${clientId}/portal-candidate-users`, { credentials: "include" }),
      ]);
      if (usersRes.ok) {
        const data = await usersRes.json() as { items: PortalUser[] };
        setPortalUsers(data.items ?? []);
      }
      if (historyRes.ok) {
        const data = await historyRes.json() as { items: PortalHistoryItem[] };
        setHistory(data.items ?? []);
      }
      if (candidatesRes.ok) {
        const data = await candidatesRes.json() as { contacts: { contact_id: number; full_name: string | null; email: string; job_title: string | null }[]; team: { user_id: string; full_name: string | null; email: string }[] };
        const built: Candidate[] = [
          ...( data.contacts ?? []).map(c => ({
            label: c.full_name ? `${c.full_name}${c.job_title ? ` — ${c.job_title}` : ""}` : c.email,
            email: c.email,
            full_name: c.full_name ?? c.email,
            contact_id: c.contact_id,
            group: "Client Contacts" as const,
          })),
          ...(data.team ?? []).map(u => ({
            label: u.full_name ?? u.email,
            email: u.email,
            full_name: u.full_name ?? u.email,
            group: "NZI Team" as const,
          })),
        ];
        setCandidates(built);
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
    if (!selectedCandidate) { setAddError("Please select a person first."); return; }
    setAddingUser(true);
    setAddError("");
    try {
      const body: Record<string, unknown> = {
        email: selectedCandidate.email,
        full_name: selectedCandidate.full_name,
        password: newPassword,
      };
      if (selectedCandidate.contact_id !== undefined) body.contact_id = selectedCandidate.contact_id;
      const res = await fetch(`${baseUrl}/clients/${clientId}/portal-users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await safeJson<{ ok?: boolean; detail?: string }>(res);
      if (!res.ok) throw new Error(data.detail ?? "Failed to create user");
      setShowAddUser(false);
      setSelectedCandidate(null); setCandidateSearch(""); setNewPassword("");
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
              {/* Person picker */}
              <div className="space-y-1">
                <Label>Person</Label>
                <div className="relative">
                  <button
                    type="button"
                    className="w-full flex items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm hover:bg-accent focus:outline-none"
                    onClick={() => { setPickerOpen(v => !v); setCandidateSearch(""); }}
                  >
                    {selectedCandidate ? (
                      <span className="truncate">
                        <span className="font-medium">{selectedCandidate.full_name}</span>
                        <span className="ml-2 text-muted-foreground text-xs">{selectedCandidate.email}</span>
                        <span className="ml-2 text-xs text-blue-600">{selectedCandidate.group}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Select a client contact or NZI team member…</span>
                    )}
                    <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0 ml-2" />
                  </button>

                  {pickerOpen && (
                    <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg">
                      <div className="flex items-center border-b px-3 py-2 gap-2">
                        <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        <input
                          autoFocus
                          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                          placeholder="Search by name or email…"
                          value={candidateSearch}
                          onChange={e => setCandidateSearch(e.target.value)}
                        />
                      </div>
                      <div className="max-h-60 overflow-y-auto py-1">
                        {(["Client Contacts", "NZI Team"] as const).map(group => {
                          const q = candidateSearch.toLowerCase();
                          const items = candidates.filter(c => c.group === group && (
                            !q || c.label.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
                          ));
                          if (items.length === 0) return null;
                          return (
                            <div key={group}>
                              <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/40">{group}</div>
                              {items.map(c => (
                                <button
                                  key={`${c.group}-${c.email}`}
                                  type="button"
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center justify-between gap-2"
                                  onClick={() => { setSelectedCandidate(c); setPickerOpen(false); setCandidateSearch(""); }}
                                >
                                  <span className="truncate font-medium">{c.full_name}</span>
                                  <span className="text-xs text-muted-foreground truncate">{c.email}</span>
                                </button>
                              ))}
                            </div>
                          );
                        })}
                        {candidates.filter(c => {
                          const q = candidateSearch.toLowerCase();
                          return !q || c.label.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
                        }).length === 0 && (
                          <div className="px-3 py-4 text-sm text-center text-muted-foreground">No matches found</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="pu-pass">Temporary Password</Label>
                <Input id="pu-pass" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Min 8 characters" required minLength={8} />
              </div>
              {addError && <p className="text-xs text-red-600">{addError}</p>}
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={addingUser || !selectedCandidate}>
                  {addingUser ? "Creating…" : "Create Account & Send Welcome Email"}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => { setShowAddUser(false); setSelectedCandidate(null); setCandidateSearch(""); setNewPassword(""); }}>Cancel</Button>
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

      {/* Portal Files */}
      <ClientPortalFilesSection clientId={clientId} baseUrl={baseUrl} />

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
