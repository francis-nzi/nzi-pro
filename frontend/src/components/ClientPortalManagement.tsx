"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FileText,
  Globe,
  History,
  Lock,
  Power,
  RefreshCw,
  Search,
  UserPlus,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import PortalLoginHistoryModal from "@/components/PortalLoginHistoryModal";
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
import { jobFamilyBadgeClassName } from "@/lib/job-family";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";

const PORTAL_ROLE_OPTIONS = [
  { value: "ClientAdmin", label: "Client Admin — full access, can approve reports & manage other users" },
  { value: "ClientContributor", label: "Contributor — can comment & manage actions, can't approve" },
  { value: "ClientViewer", label: "Viewer — read-only" },
  { value: "ClientReporting", label: "Reporting — read-only, Data/Reports-focused" },
] as const;

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
  invited_at: string | null;
  invited_by: string | null;
  role: string;
  site_ids: number[] | null;
  mfa_enabled: boolean;
  mfa_enabled_at: string | null;
};

type PortalSite = { site_id: number; site_name: string };

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

type PortalAccess = {
  client_db_id: number;
  is_enabled: boolean;
  access_expires_at: string | null;
  payment_status: "unpaid" | "invoiced" | "paid";
  payment_reference: string | null;
  nav_config: Record<string, boolean>;
  notes: string | null;
  portal_trained: boolean;
  max_users: number | null;
  client_status?: string;
};

type PortalTab = "access" | "users" | "navigation" | "jobs" | "files" | "history";

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

const PORTAL_ACCESS_EXPIRY_MIN = "2000-01-01T00:00";
const PORTAL_ACCESS_EXPIRY_MAX = "9999-12-31T23:59";

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateTimeLocalValue(value: string | null | undefined): string {
  if (!value) return "";
  const normalized = value.replace(" ", "T");
  return /^(\d{4,}-\d{2}-\d{2}T\d{2}:\d{2})/.exec(normalized)?.[1] ?? normalized;
}

function validatePortalAccessExpiry(value: string): string | null {
  if (!value) return null;

  const match = /^(\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return "Enter a valid access expiry date and time.";

  const [, yearPart, monthPart, dayPart, hourPart, minutePart] = match;
  const year = Number(yearPart);
  const month = Number(monthPart);
  const day = Number(dayPart);
  const hour = Number(hourPart);
  const minute = Number(minutePart);

  if (year < 2000 || year > 9999) {
    return "Access expiry year must be between 2000 and 9999.";
  }

  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute
  ) {
    return "Enter a valid access expiry date and time.";
  }

  return null;
}

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

function ExpiryBadge({ expiresAt }: { expiresAt: string | null }) {
  const status = expiryStatus(expiresAt);
  if (status === "forever") return <span className="text-xs text-gray-400">Forever</span>;
  if (status === "expired") return <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-600">Expired</span>;
  if (status === "expiring_soon") return <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">{fmtDate(expiresAt)}</span>;
  return <span className="text-xs text-gray-500">{fmtDate(expiresAt)}</span>;
}

function ClientPortalFilesSection({ clientId, baseUrl }: { clientId: number; baseUrl: string }) {
  const [files, setFiles] = useState<ClientPortalFile[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [filterJob, setFilterJob] = useState("");
  const [filterYear, setFilterYear] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterVisibility, setFilterVisibility] = useState<VisibilityFilter>("all");
  const [filterExpiry, setFilterExpiry] = useState<ExpiryFilter>("all");

  // Edit modal
  const [editingFile, setEditingFile] = useState<ClientPortalFile | null>(null);
  const [editVisible, setEditVisible] = useState(false);
  const [editDescription, setEditDescription] = useState("");
  const [editExpiry, setEditExpiry] = useState("");
  const [editSaving, setEditSaving] = useState(false);

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
    await fetch(`${baseUrl}/jobs/${jobId}/files/${fileId}/portal`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  function toggleVisible(file: ClientPortalFile) {
    const next = !file.portal_visible;
    setFiles(fs => fs.map(f => f.file_id === file.file_id ? { ...f, portal_visible: next } : f));
    void patchPortal(file.job_id, file.file_id, { portal_visible: next });
  }

  function openEdit(file: ClientPortalFile) {
    setEditingFile(file);
    setEditVisible(file.portal_visible);
    setEditDescription(file.portal_description ?? "");
    setEditExpiry(file.portal_expires_at ? file.portal_expires_at.slice(0, 16) : "");
  }

  function closeEdit() { setEditingFile(null); }

  async function saveEdit() {
    if (!editingFile) return;
    setEditSaving(true);
    try {
      await patchPortal(editingFile.job_id, editingFile.file_id, {
        portal_visible: editVisible,
        portal_description: editDescription,
        portal_expires_at: editExpiry || "",
      });
      setFiles(fs => fs.map(f => f.file_id === editingFile.file_id ? {
        ...f,
        portal_visible: editVisible,
        portal_description: editDescription || null,
        portal_expires_at: editExpiry || null,
      } : f));
      closeEdit();
    } finally {
      setEditSaving(false);
    }
  }

  // ── Filter options derived from data ─────────────────────────────────────
  const jobOptions = Array.from(
    new Map(files.map(f => [f.job_id, { jobId: f.job_id, label: `${f.job_number} — ${f.job_title}` }])).values()
  );
  const yearOptions = Array.from(new Set(files.map(f => f.reporting_year).filter(Boolean) as number[])).sort((a, b) => b - a);
  const typeOptions = Array.from(new Set(files.map(f => f.file_type).filter(Boolean))).sort();

  // ── Filter logic ──────────────────────────────────────────────────────────
  const q = search.trim().toLowerCase();
  const filteredFiles = files.filter(f => {
    if (q) {
      const hay = [f.file_name, f.portal_description, f.description, f.job_number, f.job_title, f.file_type].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (filterJob && String(f.job_id) !== filterJob) return false;
    if (filterYear && String(f.reporting_year) !== filterYear) return false;
    if (filterType && f.file_type !== filterType) return false;
    if (filterVisibility === "visible" && !f.portal_visible) return false;
    if (filterVisibility === "hidden" && f.portal_visible) return false;
    if (filterExpiry !== "all") {
      const s = expiryStatus(f.portal_expires_at);
      if (filterExpiry === "forever" && s !== "forever") return false;
      if (filterExpiry === "has_expiry" && s === "forever") return false;
      if (filterExpiry === "expired" && s !== "expired") return false;
      if (filterExpiry === "expiring_soon" && s !== "expiring_soon") return false;
    }
    return true;
  });

  const isFiltered = q || filterJob || filterYear || filterType || filterVisibility !== "all" || filterExpiry !== "all";
  const visibleCount = files.filter(f => f.portal_visible).length;
  const selectCls = "rounded border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200";

  return (
    <>
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
            <div className="space-y-3">

              {/* Filter bar */}
              <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3 space-y-2">
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
                <div className="flex flex-wrap gap-2 items-center">
                  <select value={filterJob} onChange={e => setFilterJob(e.target.value)} className={selectCls}>
                    <option value="">All jobs</option>
                    {jobOptions.map(j => <option key={j.jobId} value={String(j.jobId)}>{j.label}</option>)}
                  </select>
                  <select value={filterYear} onChange={e => setFilterYear(e.target.value)} className={selectCls}>
                    <option value="">All years</option>
                    {yearOptions.map(y => <option key={y} value={String(y)}>{y}</option>)}
                  </select>
                  <select value={filterType} onChange={e => setFilterType(e.target.value)} className={selectCls}>
                    <option value="">All file types</option>
                    {typeOptions.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                  </select>
                  <select value={filterVisibility} onChange={e => setFilterVisibility(e.target.value as VisibilityFilter)} className={selectCls}>
                    <option value="all">All visibility</option>
                    <option value="visible">Visible on portal</option>
                    <option value="hidden">Hidden from portal</option>
                  </select>
                  <select value={filterExpiry} onChange={e => setFilterExpiry(e.target.value as ExpiryFilter)} className={selectCls}>
                    <option value="all">All expiry</option>
                    <option value="forever">No expiry</option>
                    <option value="has_expiry">Has expiry set</option>
                    <option value="expiring_soon">Expiring within 30 days</option>
                    <option value="expired">Already expired</option>
                  </select>
                  {isFiltered && (
                    <div className="flex items-center gap-2 ml-auto">
                      <span className="text-xs text-gray-500">{filteredFiles.length} of {files.length} files</span>
                      <button onClick={() => { setSearch(""); setFilterJob(""); setFilterYear(""); setFilterType(""); setFilterVisibility("all"); setFilterExpiry("all"); }} className="text-xs text-blue-600 hover:text-blue-700 underline">
                        Clear filters
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Table */}
              {filteredFiles.length === 0 ? (
                <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No files match the current filters.
                </div>
              ) : (
                <div className="overflow-hidden rounded-md border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50">
                        <th className="w-8 px-3 py-2.5 text-center"><span className="sr-only">Visible</span></th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500">File</th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 hidden sm:table-cell">Job</th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 hidden md:table-cell">Year</th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 hidden lg:table-cell">Added</th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500">Expiry</th>
                        <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredFiles.map(file => {
                        const expStatus = expiryStatus(file.portal_expires_at);
                        return (
                          <tr key={file.file_id} className={`hover:bg-gray-50/50 ${!file.portal_visible ? "opacity-60" : ""}`}>
                            <td className="px-3 py-2.5 text-center">
                              <input
                                type="checkbox"
                                checked={file.portal_visible}
                                onChange={() => toggleVisible(file)}
                                className="h-4 w-4 rounded border-gray-300 text-green-600 cursor-pointer"
                                title={file.portal_visible ? "Hide from portal" : "Show on portal"}
                              />
                            </td>
                            <td className="px-3 py-2.5 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-gray-900 truncate max-w-[220px]">{file.file_name}</span>
                                <span className="hidden sm:inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 flex-shrink-0">
                                  {file.file_type.replace(/_/g, " ")}
                                </span>
                              </div>
                              {file.portal_description && (
                                <p className="mt-0.5 text-xs text-gray-400 truncate max-w-[260px]">{file.portal_description}</p>
                              )}
                            </td>
                            <td className="px-3 py-2.5 hidden sm:table-cell">
                              <div className="text-xs font-medium text-gray-700">{file.job_number}</div>
                              <div className="text-xs text-gray-400 truncate max-w-[140px]">{file.job_title}</div>
                            </td>
                            <td className="px-3 py-2.5 hidden md:table-cell text-xs text-gray-500">{file.reporting_year ?? "—"}</td>
                            <td className="px-3 py-2.5 hidden lg:table-cell text-xs text-gray-400">{fmtDate(file.uploaded_at)}</td>
                            <td className="px-3 py-2.5">
                              <ExpiryBadge expiresAt={file.portal_expires_at} />
                              {expStatus === "expiring_soon" && (
                                <div className="text-[10px] text-amber-600 mt-0.5">Expiring soon</div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <button
                                onClick={() => openEdit(file)}
                                className="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:border-blue-300 hover:text-blue-600 transition-colors"
                              >
                                Edit
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit modal */}
      {editingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={e => { if (e.target === e.currentTarget) closeEdit(); }}>
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{editingFile.file_name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{editingFile.job_number} · {editingFile.file_type.replace(/_/g, " ")}</p>
              </div>
              <button onClick={closeEdit} className="text-gray-400 hover:text-gray-600 flex-shrink-0 text-lg leading-none mt-0.5">✕</button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-4">
              {/* Visible toggle */}
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={editVisible}
                  onChange={e => setEditVisible(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-green-600"
                />
                <div>
                  <p className="text-sm font-medium text-gray-900">Visible on client portal</p>
                  <p className="text-xs text-gray-400">Client can see and download this file</p>
                </div>
              </label>

              {/* Description */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-700">Client-facing description</label>
                <textarea
                  value={editDescription}
                  onChange={e => setEditDescription(e.target.value)}
                  placeholder={editingFile.description ?? "Add a description shown to the client…"}
                  rows={3}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200 resize-none"
                />
              </div>

              {/* Expiry */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-700">Expiry date &amp; time</label>
                <div className="flex items-center gap-2">
                  <input
                    type="datetime-local"
                    value={editExpiry}
                    onChange={e => setEditExpiry(e.target.value)}
                    className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
                  />
                  {editExpiry && (
                    <button onClick={() => setEditExpiry("")} className="text-xs text-gray-400 hover:text-gray-600 underline flex-shrink-0">
                      Forever
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-400">Leave blank to never expire. File will be hidden automatically once expired.</p>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 border-t px-5 py-3 bg-gray-50 rounded-b-xl">
              <button onClick={closeEdit} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors">
                Cancel
              </button>
              <button
                onClick={() => void saveEdit()}
                disabled={editSaving}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
              >
                {editSaving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Portal Jobs Section ───────────────────────────────────────────────────────

type ClientPortalJob = {
  job_id: number;
  job_number: string | null;
  title: string | null;
  reporting_year: number | null;
  status: string | null;
  job_type?: string | null;
  job_family?: string | null;
  portal_visible: boolean;
  data_collection_due?: string | null;
  portal_data_entry_expiry?: string | null;
  portal_data_entry_expired?: boolean;
  portal_data_entry_expiry_override?: string | null;
  portal_data_entry_max_override_date?: string | null;
};

const DATA_ENTRY_GATED_FAMILIES = new Set(["training", "consultancy", "lca", "pcf"]);

function formatShortDate(value: string) {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function ClientPortalJobsSection({ clientId, baseUrl }: { clientId: number; baseUrl: string }) {
  const [jobs, setJobs] = useState<ClientPortalJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());
  const [expandedJobId, setExpandedJobId] = useState<number | null>(null);
  const [draftDate, setDraftDate] = useState("");
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [overrideError, setOverrideError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/jobs?limit=200`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json() as { items: ClientPortalJob[] };
        setJobs(data.items ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [baseUrl, clientId]);

  useEffect(() => { void load(); }, [load]);

  async function setVisibility(jobIds: number[], visible: boolean) {
    setSavingIds(prev => new Set([...prev, ...jobIds]));
    setJobs(js => js.map(j => jobIds.includes(j.job_id) ? { ...j, portal_visible: visible } : j));
    try {
      await fetch(`${baseUrl}/clients/${clientId}/portal-jobs`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_ids: jobIds, portal_visible: visible }),
      });
    } finally {
      setSavingIds(prev => {
        const next = new Set(prev);
        jobIds.forEach(id => next.delete(id));
        return next;
      });
    }
  }

  function toggleExpanded(job: ClientPortalJob) {
    if (expandedJobId === job.job_id) {
      setExpandedJobId(null);
      return;
    }
    setExpandedJobId(job.job_id);
    setDraftDate(job.portal_data_entry_expiry_override || "");
    setOverrideError("");
  }

  async function saveOverride(jobId: number, overrideDate: string | null) {
    setOverrideSaving(true);
    setOverrideError("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/portal-data-entry-expiry`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ override_date: overrideDate }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setOverrideError(d?.detail || "Failed to update the deadline.");
        return;
      }
      const updated = await res.json();
      setJobs(js => js.map(j => j.job_id === jobId
        ? {
            ...j,
            portal_data_entry_expiry_override: updated.portal_data_entry_expiry_override ?? null,
            portal_data_entry_expiry: updated.portal_data_entry_expiry ?? null,
            portal_data_entry_expired: Boolean(updated.portal_data_entry_expired),
          }
        : j));
      setExpandedJobId(null);
    } finally {
      setOverrideSaving(false);
    }
  }

  const visibleCount = jobs.filter(j => j.portal_visible).length;
  const allVisible = jobs.length > 0 && visibleCount === jobs.length;
  const someVisible = visibleCount > 0 && visibleCount < jobs.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Briefcase className="h-4 w-4" />
          Portal Jobs
          {!loading && (
            <span className="text-xs font-normal text-muted-foreground ml-1">
              {visibleCount} of {jobs.length} visible to client
            </span>
          )}
        </CardTitle>
        <CardDescription>
          Control which jobs the client can see in their NZInsights portal, and when portal data entry closes for each job.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="py-6 text-sm text-center text-muted-foreground">Loading jobs…</div>
        ) : jobs.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No jobs found for this client yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="w-8 px-3 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={allVisible}
                      ref={el => { if (el) el.indeterminate = someVisible; }}
                      onChange={() => void setVisibility(jobs.map(j => j.job_id), !allVisible)}
                      className="h-4 w-4 rounded border-gray-300 text-green-600 cursor-pointer"
                      title={allVisible ? "Hide all jobs from portal" : "Show all jobs on portal"}
                    />
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500">Job</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500">Reporting Period</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500">Status</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500">Data Entry</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {jobs.map(job => {
                  const dataEntryGated = !DATA_ENTRY_GATED_FAMILIES.has(String(job.job_family || ""));
                  const isExpanded = expandedJobId === job.job_id;
                  return (
                    <Fragment key={job.job_id}>
                      <tr className={`hover:bg-gray-50/50 ${!job.portal_visible ? "opacity-60" : ""}`}>
                        <td className="px-3 py-2.5 text-center">
                          <input
                            type="checkbox"
                            checked={job.portal_visible}
                            disabled={savingIds.has(job.job_id)}
                            onChange={() => void setVisibility([job.job_id], !job.portal_visible)}
                            className="h-4 w-4 rounded border-gray-300 text-green-600 cursor-pointer"
                            title={job.portal_visible ? "Hide from portal" : "Show on portal"}
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-gray-900">{job.job_number ?? `Job #${job.job_id}`}</span>
                            {job.job_type && (
                              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${jobFamilyBadgeClassName(job.job_family)}`}>
                                {job.job_type}
                              </span>
                            )}
                          </div>
                          {job.title && <div className="text-xs text-gray-400 truncate max-w-[260px]">{job.title}</div>}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-500">{job.reporting_year ?? "—"}</td>
                        <td className="px-3 py-2.5">
                          <Badge variant="outline" className="text-xs">{job.status ?? "—"}</Badge>
                        </td>
                        <td className="px-3 py-2.5">
                          {dataEntryGated ? (
                            <button
                              type="button"
                              onClick={() => toggleExpanded(job)}
                              className="flex items-center gap-1.5 text-xs hover:underline"
                            >
                              <span className={`h-2 w-2 rounded-full ${job.portal_data_entry_expired ? "bg-red-500" : "bg-emerald-500"}`} />
                              <span className={job.portal_data_entry_expired ? "text-red-700" : "text-emerald-700"}>
                                {job.portal_data_entry_expired ? "Closed" : "Open"}
                              </span>
                              {job.portal_data_entry_expiry && (
                                <span className="text-gray-400">
                                  {job.portal_data_entry_expired ? "since" : "until"} {formatShortDate(job.portal_data_entry_expiry)}
                                </span>
                              )}
                              <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                            </button>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-muted/30">
                          <td colSpan={5} className="px-3 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs text-muted-foreground">
                                {job.data_collection_due
                                  ? `Data Collection Deadline milestone: ${formatShortDate(job.data_collection_due)}`
                                  : "No Data Collection Deadline milestone set"}
                              </span>
                              <input
                                type="date"
                                value={draftDate}
                                max={job.portal_data_entry_max_override_date || undefined}
                                onChange={e => setDraftDate(e.target.value)}
                                className="rounded-md border px-2 py-1.5 text-sm"
                              />
                              <Button
                                size="sm"
                                disabled={overrideSaving || !draftDate}
                                onClick={() => void saveOverride(job.job_id, draftDate)}
                              >
                                {overrideSaving ? "Saving…" : "Save"}
                              </Button>
                              {job.portal_data_entry_expiry_override && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={overrideSaving}
                                  onClick={() => void saveOverride(job.job_id, null)}
                                >
                                  Clear override
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" onClick={() => setExpandedJobId(null)}>
                                Cancel
                              </Button>
                              {job.portal_data_entry_max_override_date && (
                                <div className="w-full text-xs text-muted-foreground">
                                  Latest allowed date: {formatShortDate(job.portal_data_entry_max_override_date)} (30 days from today — extend again any time)
                                </div>
                              )}
                              {overrideError && <div className="w-full text-xs text-red-600">{overrideError}</div>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ClientPortalManagement({ clientId, baseUrl }: Props) {
  const confirmAction = useConfirmDialog();
  const [activeTab, setActiveTab] = useState<PortalTab>("access");
  const [portalUsers, setPortalUsers] = useState<PortalUser[]>([]);
  const [history, setHistory] = useState<PortalHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusMsg, setStatusMsg] = useState("");

  // Portal access state
  const [portalAccess, setPortalAccess] = useState<PortalAccess | null>(null);
  const [accessSaving, setAccessSaving] = useState(false);
  const [editEnabled, setEditEnabled] = useState(false);
  const [editExpiry, setEditExpiry] = useState("");
  const [editPaymentStatus, setEditPaymentStatus] = useState<PortalAccess["payment_status"]>("unpaid");
  const [editPaymentRef, setEditPaymentRef] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editNavConfig, setEditNavConfig] = useState<Record<string, boolean>>({});
  const [navSaving, setNavSaving] = useState(false);
  const [editPortalTrained, setEditPortalTrained] = useState(false);
  const [editMaxUsers, setEditMaxUsers] = useState("");
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const expiryValidationError = validatePortalAccessExpiry(editExpiry);

  // Add user form
  const [showAddUser, setShowAddUser] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [addingUser, setAddingUser] = useState(false);
  const [addError, setAddError] = useState("");
  const [newUserRole, setNewUserRole] = useState<string>("ClientAdmin");
  const [newUserSiteIds, setNewUserSiteIds] = useState<number[]>([]);

  // Site-scoping (Governance) -- see CLIENT_PORTAL_GOVERNANCE_AUTHORIZATION_DESIGN.md
  const [sites, setSites] = useState<PortalSite[]>([]);
  const [managingSitesFor, setManagingSitesFor] = useState<number | null>(null);
  const [draftSiteIds, setDraftSiteIds] = useState<number[]>([]);
  const [savingSites, setSavingSites] = useState(false);
  const [savingRoleFor, setSavingRoleFor] = useState<number | null>(null);

  // Reset password
  const [resettingUserId, setResettingUserId] = useState<number | null>(null);
  const [resettingMfaUserId, setResettingMfaUserId] = useState<number | null>(null);

  const loadAccess = useCallback(async () => {
    const res = await fetch(`${baseUrl}/clients/${clientId}/portal-access`, { credentials: "include" });
    if (res.ok) {
      const data = await res.json() as { access: PortalAccess };
      const a = data.access;
      setPortalAccess(a);
      setEditEnabled(a.is_enabled);
      setEditExpiry(toDateTimeLocalValue(a.access_expires_at));
      setEditPaymentStatus(a.payment_status);
      setEditPaymentRef(a.payment_reference ?? "");
      setEditNotes(a.notes ?? "");
      setEditNavConfig({ ...a.nav_config });
      setEditPortalTrained(a.portal_trained);
      setEditMaxUsers(a.max_users != null ? String(a.max_users) : "");
    }
  }, [baseUrl, clientId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [usersRes, historyRes, candidatesRes, sitesRes] = await Promise.all([
        fetch(`${baseUrl}/clients/${clientId}/portal-users`, { credentials: "include" }),
        fetch(`${baseUrl}/clients/${clientId}/portal-history`, { credentials: "include" }),
        fetch(`${baseUrl}/clients/${clientId}/portal-candidate-users`, { credentials: "include" }),
        fetch(`${baseUrl}/clients/${clientId}/sites`, { credentials: "include" }),
      ]);
      if (sitesRes.ok) {
        const data = await sitesRes.json() as { active_sites?: PortalSite[] };
        setSites(data.active_sites ?? []);
      }
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

  useEffect(() => { void load(); void loadAccess(); }, [load, loadAccess]);

  async function safeJson<T>(res: Response): Promise<T> {
    try { return await res.json() as T; }
    catch { throw new Error(`Server error (HTTP ${res.status})`); }
  }

  async function copyPasswordAndNotify(temporaryPassword: string | undefined, message: string) {
    if (!temporaryPassword) {
      setStatusMsg(message);
      return;
    }
    try {
      await navigator.clipboard.writeText(temporaryPassword);
      setStatusMsg(`${message} Temporary password copied to clipboard.`);
    } catch {
      setStatusMsg(message);
    }
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
        role: newUserRole,
        site_ids: newUserSiteIds,
      };
      if (selectedCandidate.contact_id !== undefined) body.contact_id = selectedCandidate.contact_id;
      const res = await fetch(`${baseUrl}/clients/${clientId}/portal-users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await safeJson<{ ok?: boolean; detail?: string; temporary_password?: string }>(res);
      if (!res.ok) throw new Error(data.detail ?? "Failed to create user");
      setShowAddUser(false);
      setSelectedCandidate(null); setCandidateSearch("");
      setNewUserRole("ClientAdmin"); setNewUserSiteIds([]);
      await copyPasswordAndNotify(data.temporary_password, "Portal user created and welcome email sent.");
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

  async function handleUpdateRole(user: PortalUser, role: string) {
    setSavingRoleFor(user.portal_user_id);
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/portal-users/${user.portal_user_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ role }),
      });
      if (!res.ok) throw new Error("Failed to update role");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingRoleFor(null);
    }
  }

  function openSiteManager(user: PortalUser) {
    setManagingSitesFor(user.portal_user_id);
    setDraftSiteIds(user.site_ids ?? []);
  }

  async function handleSaveSites(portalUserId: number) {
    setSavingSites(true);
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/portal-users/${portalUserId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ site_ids: draftSiteIds }),
      });
      if (!res.ok) throw new Error("Failed to update site access");
      setManagingSitesFor(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingSites(false);
    }
  }

  async function handleResendInvite(user: PortalUser) {
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/portal-users/${user.portal_user_id}/resend-invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const data = await safeJson<{ ok?: boolean; detail?: string; temporary_password?: string }>(res);
      if (!res.ok) throw new Error(data.detail ?? "Failed to resend invite");
      await copyPasswordAndNotify(data.temporary_password, "Invite email resent.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleResetPassword(user: PortalUser) {
    setResettingUserId(user.portal_user_id);
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/portal-users/${user.portal_user_id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const data = await safeJson<{ ok?: boolean; detail?: string; temporary_password?: string }>(res);
      if (!res.ok) throw new Error(data.detail ?? "Failed to reset password");
      await copyPasswordAndNotify(data.temporary_password, "Password reset and emailed to the user.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResettingUserId(null);
    }
  }

  async function handleResetMfa(user: PortalUser) {
    const confirmed = await confirmAction({
      title: "Reset MFA for this user?",
      description: `${user.full_name || user.email} will need to set up two-factor authentication again the next time they log in. Use this if they've lost their authenticator device or recovery codes. Their password is not affected.`,
      confirmLabel: "Reset MFA",
      destructive: true,
    });
    if (!confirmed) return;
    setResettingMfaUserId(user.portal_user_id);
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/portal-users/${user.portal_user_id}/reset-mfa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const data = await safeJson<{ ok?: boolean; detail?: string }>(res);
      if (!res.ok) throw new Error(data.detail ?? "Failed to reset MFA");
      setStatusMsg("MFA reset — the user will set it up again on next login.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResettingMfaUserId(null);
    }
  }

  async function handleSaveAccess() {
    setError("");
    setStatusMsg("");
    if (expiryValidationError) {
      setError(expiryValidationError);
      return;
    }
    const maxUsersTrimmed = editMaxUsers.trim();
    const maxUsersValue = maxUsersTrimmed === "" ? null : Number(maxUsersTrimmed);
    if (maxUsersValue !== null && (!Number.isInteger(maxUsersValue) || maxUsersValue < 1)) {
      setError("No. of Users must be a whole number of 1 or more, or blank for unlimited.");
      return;
    }

    setAccessSaving(true);
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/portal-access`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          is_enabled: editEnabled,
          access_expires_at: editExpiry || null,
          payment_status: editPaymentStatus,
          payment_reference: editPaymentRef || null,
          nav_config: editNavConfig,
          notes: editNotes || null,
          portal_trained: editPortalTrained,
          max_users: maxUsersValue,
        }),
      });
      if (!res.ok) {
        const d = await res.json() as { detail?: string };
        throw new Error(d.detail ?? "Failed to save access settings");
      }
      setStatusMsg("Portal access settings saved.");
      await loadAccess();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAccessSaving(false);
    }
  }

  async function handleSaveNavConfig() {
    setNavSaving(true);
    setError("");
    try {
      // Only send nav_config -- every other field on this payload is
      // Optional server-side and falls back to whatever is already stored,
      // so there's no risk of clobbering unsaved edits made on the Access
      // tab (previously this resent portalAccess's last-loaded snapshot of
      // those fields, which could silently overwrite them).
      const res = await fetch(`${baseUrl}/clients/${clientId}/portal-access`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          nav_config: editNavConfig,
        }),
      });
      if (!res.ok) {
        const d = await res.json() as { detail?: string };
        throw new Error(d.detail ?? "Failed to save navigation settings");
      }
      setStatusMsg("Navigation settings saved.");
      await loadAccess();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setNavSaving(false);
    }
  }

  if (loading) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading portal data…</div>;
  }

  const activeCount = portalUsers.filter(u => u.is_active).length;

  const daysRemaining = portalAccess?.access_expires_at
    ? Math.ceil((new Date(portalAccess.access_expires_at).getTime() - Date.now()) / 86_400_000)
    : null;

  // Detect unsaved edits on the Access/Navigation tabs so Refresh can warn
  // before silently discarding them (it previously just reloaded from the
  // server unconditionally, wiping out any toggle the user hadn't saved yet).
  const navDirty = JSON.stringify(editNavConfig) !== JSON.stringify(portalAccess?.nav_config ?? {});
  const loadedExpiry = toDateTimeLocalValue(portalAccess?.access_expires_at);
  const loadedMaxUsers = portalAccess?.max_users != null ? String(portalAccess.max_users) : "";
  const accessDirty = Boolean(portalAccess) && (
    editEnabled !== portalAccess!.is_enabled ||
    editExpiry !== loadedExpiry ||
    editPaymentStatus !== portalAccess!.payment_status ||
    editPaymentRef !== (portalAccess!.payment_reference ?? "") ||
    editNotes !== (portalAccess!.notes ?? "") ||
    editPortalTrained !== portalAccess!.portal_trained ||
    editMaxUsers.trim() !== loadedMaxUsers
  );
  const hasUnsavedPortalSettings = navDirty || accessDirty;

  async function handleRefreshClick() {
    if (hasUnsavedPortalSettings) {
      const confirmed = await confirmAction({
        title: "Discard unsaved changes?",
        description: "You have unsaved changes on the Access or Navigation tab. Refreshing reloads settings from the server and will discard them.",
        confirmLabel: "Discard and refresh",
        destructive: true,
      });
      if (!confirmed) return;
    }
    void load();
    void loadAccess();
  }

  const isPortfolioOwner = (portalAccess?.client_status ?? "").trim().toLowerCase() === "portfolio owner";
  const ALL_NAV_ITEMS: { key: string; label: string }[] = [
    { key: "dashboard", label: "Dashboard" },
    { key: "portfolio", label: "Portfolio" },
    { key: "data_entry",label: "Data Entry" },
    { key: "data",      label: "Metrics" },
    { key: "actions",   label: "Strategy" },
    { key: "risk",      label: "Risk" },
    { key: "srs_readiness", label: "SRS Readiness" },
    { key: "governance",label: "Governance" },
    { key: "reports",   label: "Reports" },
    { key: "insights",  label: "Insights" },
    { key: "files",     label: "Files" },
  ];
  // Portfolio is only relevant for clients whose status is "Portfolio Owner" --
  // hide the toggle for everyone else so it can't be turned on by accident.
  const NAV_ITEMS = isPortfolioOwner
    ? ALL_NAV_ITEMS
    : ALL_NAV_ITEMS.filter(item => item.key !== "portfolio");

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Client Portal</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Manage portal access, users, navigation and published reports.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void handleRefreshClick()} className="flex items-center gap-1.5 text-xs">
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

      {/* Tab bar */}
      <div className="flex border-b border-gray-200 gap-0">
        {(["access", "users", "navigation", "jobs", "files", "history"] as PortalTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setStatusMsg(""); }}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
              activeTab === tab
                ? "border-green-700 text-green-800"
                : "border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300"
            }`}
          >
            {tab === "navigation" ? "Navigation" : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Access tab */}
      {activeTab === "access" && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Power className="h-4 w-4" />
                Portal Access Control
              </CardTitle>
              <CardDescription>
                Master switch for this client{"'"}s portal access. Payment and expiry tracking.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => setHistoryModalOpen(true)}>
              Login History
            </Button>
          </CardHeader>
          <CardContent className="space-y-5">

            {/* Status banner */}
            {portalAccess && (
              <>
                {!portalAccess.is_enabled && (
                  <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    <Lock className="h-4 w-4 flex-shrink-0" />
                    Portal access is currently <strong>disabled</strong> for this client.
                  </div>
                )}
                {portalAccess.is_enabled && daysRemaining !== null && daysRemaining <= 0 && (
                  <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    Access has <strong>expired</strong>. The client can no longer log in.
                  </div>
                )}
                {portalAccess.is_enabled && daysRemaining !== null && daysRemaining > 0 && daysRemaining <= 30 && (
                  <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    Access expires in <strong>{daysRemaining} day{daysRemaining !== 1 ? "s" : ""}</strong>.
                  </div>
                )}
                {portalAccess.is_enabled && (daysRemaining === null || daysRemaining > 30) && (
                  <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                    <Globe className="h-4 w-4 flex-shrink-0" />
                    Portal access is <strong>active</strong>
                    {daysRemaining !== null ? ` · ${daysRemaining} days remaining` : " · No expiry set"}.
                  </div>
                )}
              </>
            )}

            {/* Enable/Disable toggle */}
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <div className="text-sm font-medium">Enable portal access</div>
                <div className="text-xs text-muted-foreground">Master switch. When off, all users for this client are blocked at login.</div>
              </div>
              <button
                type="button"
                onClick={() => setEditEnabled(v => !v)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${editEnabled ? "bg-green-600" : "bg-gray-200"}`}
                role="switch"
                aria-checked={editEnabled}
              >
                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${editEnabled ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </div>

            {/* Portal Trained toggle */}
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <div className="text-sm font-medium">Portal trained</div>
                <div className="text-xs text-muted-foreground">Has the client been walked through using the portal?</div>
              </div>
              <button
                type="button"
                onClick={() => setEditPortalTrained(v => !v)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${editPortalTrained ? "bg-green-600" : "bg-gray-200"}`}
                role="switch"
                aria-checked={editPortalTrained}
              >
                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${editPortalTrained ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </div>

            {/* Expiry */}
            <div className="space-y-1">
              <Label htmlFor="access-expiry">Access Expires At</Label>
              <Input
                id="access-expiry"
                type="datetime-local"
                min={PORTAL_ACCESS_EXPIRY_MIN}
                max={PORTAL_ACCESS_EXPIRY_MAX}
                value={editExpiry}
                onChange={e => setEditExpiry(e.target.value)}
                aria-invalid={Boolean(expiryValidationError)}
                aria-describedby={`access-expiry-help${expiryValidationError ? " access-expiry-error" : ""}`}
                className={`max-w-xs ${expiryValidationError ? "border-red-500 focus-visible:ring-red-500" : ""}`}
              />
              <p id="access-expiry-help" className="text-xs text-muted-foreground">Leave blank for no expiry.</p>
              {expiryValidationError && (
                <p id="access-expiry-error" className="text-xs text-red-600" role="alert">
                  {expiryValidationError}
                </p>
              )}
            </div>

            {/* No. of Users */}
            <div className="space-y-1">
              <Label htmlFor="max-users">No. of Users</Label>
              <Input
                id="max-users"
                type="number"
                min={1}
                step={1}
                value={editMaxUsers}
                onChange={e => setEditMaxUsers(e.target.value)}
                className="max-w-xs"
                placeholder="Unlimited"
              />
              <p className="text-xs text-muted-foreground">
                Number of non-NZI portal users allowed for this client. Leave blank for unlimited -- this is
                informational only and does not block inviting more users. Currently {activeCount} active.
              </p>
            </div>

            {/* Payment status */}
            <div className="space-y-1">
              <Label htmlFor="payment-status">Payment Status</Label>
              <select
                id="payment-status"
                value={editPaymentStatus}
                onChange={e => setEditPaymentStatus(e.target.value as PortalAccess["payment_status"])}
                className="block h-9 rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="unpaid">Unpaid</option>
                <option value="invoiced">Invoiced</option>
                <option value="paid">Paid</option>
              </select>
            </div>

            {/* Payment reference */}
            <div className="space-y-1">
              <Label htmlFor="payment-ref">Payment / Invoice Reference</Label>
              <Input
                id="payment-ref"
                value={editPaymentRef}
                onChange={e => setEditPaymentRef(e.target.value)}
                placeholder="e.g. INV-2024-0042"
                className="max-w-xs"
              />
            </div>

            {/* Notes */}
            <div className="space-y-1">
              <Label htmlFor="access-notes">Notes</Label>
              <textarea
                id="access-notes"
                value={editNotes}
                onChange={e => setEditNotes(e.target.value)}
                rows={3}
                placeholder="Internal notes about this client's access…"
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
            </div>

            <Button onClick={() => void handleSaveAccess()} disabled={accessSaving || Boolean(expiryValidationError)} size="sm">
              {accessSaving ? "Saving…" : "Save Access Settings"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Users tab */}
      {activeTab === "users" && (
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

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Role</Label>
                  <Select value={newUserRole} onValueChange={setNewUserRole}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PORTAL_ROLE_OPTIONS.map(r => (
                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {sites.length > 1 && (
                  <div className="space-y-1">
                    <Label>Site access</Label>
                    <div className="max-h-28 overflow-y-auto rounded-md border p-2 space-y-1">
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={newUserSiteIds.length === 0}
                          onChange={() => setNewUserSiteIds([])}
                        />
                        All sites (unrestricted)
                      </label>
                      {sites.map(s => (
                        <label key={s.site_id} className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={newUserSiteIds.includes(s.site_id)}
                            onChange={(e) => setNewUserSiteIds(prev =>
                              e.target.checked ? [...prev, s.site_id] : prev.filter(id => id !== s.site_id)
                            )}
                          />
                          {s.site_name}
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Leave unchecked (all sites) unless this person should only see specific sites — a site-scoped user won&apos;t see Reports, Files, Actions, or Insights.
                    </p>
                  </div>
                )}
              </div>

              {addError && <p className="text-xs text-red-600">{addError}</p>}
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={addingUser || !selectedCandidate}>
                  {addingUser ? "Creating…" : "Create Account & Send Welcome Email"}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => { setShowAddUser(false); setSelectedCandidate(null); setCandidateSearch(""); setNewUserRole("ClientAdmin"); setNewUserSiteIds([]); }}>Cancel</Button>
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
                  <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{user.full_name}</div>
                      <div className="text-xs text-muted-foreground">{user.email}</div>
                      {user.last_login_at && (
                        <div className="text-xs text-muted-foreground">Last login: {fmtDate(user.last_login_at)}</div>
                      )}
                      {!user.last_login_at && (
                        <div className="text-xs text-muted-foreground">Never logged in</div>
                      )}
                      {user.invited_at && (
                        <div className="text-xs text-muted-foreground">Invited: {fmtDate(user.invited_at)}</div>
                      )}
                      {user.site_ids && user.site_ids.length > 0 && (
                        <div className="mt-0.5 text-xs text-amber-700">
                          Scoped to {user.site_ids.length} site{user.site_ids.length !== 1 ? "s" : ""} — no Reports/Files/Actions/Insights
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        value={user.role}
                        onValueChange={(v) => void handleUpdateRole(user, v)}
                      >
                        <SelectTrigger className="h-8 w-auto min-w-[8rem] text-xs" disabled={savingRoleFor === user.portal_user_id}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PORTAL_ROLE_OPTIONS.map(r => (
                            <SelectItem key={r.value} value={r.value}>{r.value}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {sites.length > 1 && (
                        <Button variant="ghost" size="sm" className="text-xs" onClick={() => openSiteManager(user)}>
                          Sites…
                        </Button>
                      )}
                      <Badge variant={user.is_active ? "secondary" : "outline"}>
                        {user.is_active ? "Active" : "Inactive"}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={user.mfa_enabled ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"}
                      >
                        {user.mfa_enabled ? "MFA enabled" : "MFA not set up"}
                      </Badge>
                      <Button variant="ghost" size="sm" onClick={() => void handleToggleActive(user)}>
                        {user.is_active ? "Deactivate" : "Reactivate"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-muted-foreground"
                        onClick={() => void handleResendInvite(user)}
                      >
                        Resend Invite
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-muted-foreground"
                        disabled={resettingUserId === user.portal_user_id}
                        onClick={() => void handleResetPassword(user)}
                      >
                        {resettingUserId === user.portal_user_id ? "Resetting…" : "Reset password"}
                      </Button>
                      {user.mfa_enabled && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs text-muted-foreground"
                          disabled={resettingMfaUserId === user.portal_user_id}
                          onClick={() => void handleResetMfa(user)}
                        >
                          {resettingMfaUserId === user.portal_user_id ? "Resetting…" : "Reset MFA"}
                        </Button>
                      )}
                    </div>
                  </div>

                  {managingSitesFor === user.portal_user_id && (
                    <div className="border-t bg-muted/30 px-4 py-3 space-y-2">
                      <p className="text-xs font-medium">Site access for {user.full_name}</p>
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        <label className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={draftSiteIds.length === 0}
                            onChange={() => setDraftSiteIds([])}
                          />
                          All sites (unrestricted)
                        </label>
                        {sites.map(s => (
                          <label key={s.site_id} className="flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={draftSiteIds.includes(s.site_id)}
                              onChange={(e) => setDraftSiteIds(prev =>
                                e.target.checked ? [...prev, s.site_id] : prev.filter(id => id !== s.site_id)
                              )}
                            />
                            {s.site_name}
                          </label>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" disabled={savingSites} onClick={() => void handleSaveSites(user.portal_user_id)}>
                          {savingSites ? "Saving…" : "Save"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setManagingSitesFor(null)}>Cancel</Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Navigation tab */}
      {activeTab === "navigation" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe className="h-4 w-4" />
              Portal Navigation
            </CardTitle>
            <CardDescription>
              Control which sections are visible in the client portal sidebar. Changes take effect on next login.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-3">
              {NAV_ITEMS.map(item => (
                <div key={item.key} className="flex items-center justify-between rounded-lg border p-3">
                  <div className="text-sm font-medium">{item.label}</div>
                  <button
                    type="button"
                    onClick={() => setEditNavConfig(cfg => ({ ...cfg, [item.key]: !(cfg[item.key] ?? true) }))}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${(editNavConfig[item.key] ?? true) ? "bg-green-600" : "bg-gray-200"}`}
                    role="switch"
                    aria-checked={editNavConfig[item.key] ?? true}
                  >
                    <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${(editNavConfig[item.key] ?? true) ? "translate-x-5" : "translate-x-0"}`} />
                  </button>
                </div>
              ))}
            </div>
            <Button onClick={() => void handleSaveNavConfig()} disabled={navSaving} size="sm">
              {navSaving ? "Saving…" : "Save Navigation Settings"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Jobs tab */}
      {activeTab === "jobs" && (
        <ClientPortalJobsSection clientId={clientId} baseUrl={baseUrl} />
      )}

      {/* Files tab */}
      {activeTab === "files" && (
        <ClientPortalFilesSection clientId={clientId} baseUrl={baseUrl} />
      )}

      {/* History tab */}
      {activeTab === "history" && (
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

      )}

      <PortalLoginHistoryModal
        baseUrl={baseUrl}
        clientDbId={clientId}
        open={historyModalOpen}
        onOpenChange={setHistoryModalOpen}
      />
    </div>
  );
}
