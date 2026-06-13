"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  BarChart2,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  RefreshCw,
  Send,
  Timer,
  Users,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ── Types ────────────────────────────────────────────────────────────────────

type PortalFile = {
  file_id: number;
  job_id: number;
  file_type: string;
  file_name: string;
  file_size: number | null;
  description: string | null;
  uploaded_at: string | null;
  portal_visible: boolean;
  portal_description: string | null;
  portal_expires_at: string | null;
};

type PortalUser = {
  portal_user_id: number;
  full_name: string;
  email: string;
  is_active: boolean;
};

type PortalVersion = {
  report_version_id: number;
  version_number: number | null;
  version_label: string | null;
  status: string;
  created_at: string | null;
};

type Review = {
  review_id: number;
  status: string;
  portal_version_id: number | null;
  published_at: string | null;
  published_by: string | null;
  sent_for_review_at: string | null;
};

type PortalStatus = {
  ok: boolean;
  review: Review;
  portal_users: PortalUser[];
  active_portal_users_count: number;
  widget_pngs: Array<{ widget_id: string; captured_at: string | null }>;
  widget_png_count: number;
  captured_widget_ids: string[];
  latest_capture_at: string | null;
  portal_version: PortalVersion | null;
  client_db_id: number | null;
};

// The seven standard chart widgets that should be captured for a complete portal submission
const EXPECTED_WIDGET_IDS = [
  { id: "emissions_scope_donut",       label: "Emissions by Scope" },
  { id: "emissions_site_donut",        label: "Emissions by Site" },
  { id: "emissions_by_activity",       label: "Emissions by Activity" },
  { id: "scope_year_on_year_bar",      label: "Year-on-Year Comparison" },
  { id: "emissions_reduction_pathway", label: "Reduction Pathway" },
  { id: "intensity_pathway",           label: "Intensity Pathway" },
  { id: "historical_emissions_trend",  label: "Historical Trend" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function StatusDot({ ok }: { ok: boolean }) {
  return ok
    ? <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
    : <XCircle className="h-4 w-4 text-amber-500 flex-shrink-0" />;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ReadinessCard({
  title,
  icon: Icon,
  ok,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  ok: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border p-5 ${ok ? "border-green-200 bg-green-50/40" : "border-amber-200 bg-amber-50/40"}`}>
      <div className="flex items-start gap-3">
        <div className={`rounded-lg p-2 ${ok ? "bg-green-100" : "bg-amber-100"}`}>
          <Icon className={`h-4 w-4 ${ok ? "text-green-700" : "text-amber-700"}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <StatusDot ok={ok} />
            <p className="text-sm font-semibold text-gray-900">{title}</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

// ── Portal Files Section ──────────────────────────────────────────────────────

function formatFileSize(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function PortalFilesSection({ jobId, baseUrl }: { jobId: number; baseUrl: string }) {
  const [files, setFiles] = useState<PortalFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const descTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${baseUrl}/jobs/${jobId}/files`, { credentials: "include" });
        const data = await res.json() as { files: PortalFile[] };
        setFiles(data.files ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, [baseUrl, jobId]);

  async function patchPortal(fileId: number, patch: Record<string, unknown>) {
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

  function toggleVisible(file: PortalFile) {
    const next = !file.portal_visible;
    setFiles(fs => fs.map(f => f.file_id === file.file_id ? { ...f, portal_visible: next } : f));
    void patchPortal(file.file_id, { portal_visible: next });
  }

  function onDescChange(file: PortalFile, value: string) {
    setFiles(fs => fs.map(f => f.file_id === file.file_id ? { ...f, portal_description: value } : f));
    clearTimeout(descTimers.current[file.file_id]);
    descTimers.current[file.file_id] = setTimeout(() => {
      void patchPortal(file.file_id, { portal_description: value });
    }, 600);
  }

  function onExpiryChange(file: PortalFile, value: string) {
    const expires = value || null;
    setFiles(fs => fs.map(f => f.file_id === file.file_id ? { ...f, portal_expires_at: expires } : f));
    void patchPortal(file.file_id, { portal_expires_at: expires ?? "" });
  }

  const visibleCount = files.filter(f => f.portal_visible).length;

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Portal Files</p>
        <p className="text-sm text-gray-400">Loading files…</p>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Portal Files</p>
        <p className="text-sm text-gray-500">No files attached to this job yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-gray-400" />
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Portal Files</p>
        </div>
        <span className="text-xs text-gray-500">
          {visibleCount} of {files.length} visible to client
        </span>
      </div>

      <div className="divide-y divide-gray-50">
        {files.map(file => {
          const isSaving = saving[file.file_id] ?? false;
          const expiryValue = file.portal_expires_at
            ? file.portal_expires_at.slice(0, 16)
            : "";
          const isExpired = file.portal_expires_at
            ? new Date(file.portal_expires_at) <= new Date()
            : false;

          return (
            <div key={file.file_id} className={`px-5 py-4 ${file.portal_visible ? "bg-white" : "bg-gray-50/60"}`}>
              <div className="flex items-start gap-3">
                {/* Visibility checkbox */}
                <div className="flex-shrink-0 pt-0.5">
                  <input
                    type="checkbox"
                    checked={file.portal_visible}
                    onChange={() => toggleVisible(file)}
                    className="h-4 w-4 rounded border-gray-300 text-green-600 cursor-pointer"
                    title={file.portal_visible ? "Hide from client portal" : "Show on client portal"}
                  />
                </div>

                <div className="flex-1 min-w-0 space-y-2">
                  {/* File name + meta */}
                  <div className="flex items-start gap-2 flex-wrap">
                    <span className={`text-sm font-medium truncate max-w-sm ${file.portal_visible ? "text-gray-900" : "text-gray-500"}`}>
                      {file.file_name}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 flex-shrink-0">
                      {file.file_type.replace(/_/g, " ")}
                    </span>
                    {isExpired && file.portal_visible && (
                      <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-600 flex-shrink-0">
                        Expired
                      </span>
                    )}
                    {isSaving && (
                      <span className="text-xs text-gray-400 flex-shrink-0">Saving…</span>
                    )}
                  </div>

                  <div className="text-xs text-gray-400">
                    {formatFileSize(file.file_size)}
                    {file.uploaded_at && (
                      <> · Added {fmtDateTime(file.uploaded_at)}</>
                    )}
                  </div>

                  {/* Portal description */}
                  <input
                    type="text"
                    value={file.portal_description ?? ""}
                    onChange={e => onDescChange(file, e.target.value)}
                    placeholder={file.description ?? "Add a description for clients…"}
                    className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-700 placeholder-gray-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
                  />

                  {/* Expiry timer */}
                  <div className="flex items-center gap-2">
                    <Timer className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                    <span className="text-xs text-gray-500">Expires:</span>
                    <input
                      type="datetime-local"
                      value={expiryValue}
                      onChange={e => onExpiryChange(file, e.target.value)}
                      className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
                    />
                    {expiryValue && (
                      <button
                        onClick={() => onExpiryChange(file, "")}
                        className="text-xs text-gray-400 hover:text-gray-600 underline"
                      >
                        Set to forever
                      </button>
                    )}
                    {!expiryValue && (
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
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type JobPortalManagementProps = {
  jobId: number;
  baseUrl: string;
};

export default function JobPortalManagement({ jobId, baseUrl }: JobPortalManagementProps) {
  const [status, setStatus] = useState<PortalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; message: string } | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/portal-status`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { detail?: string };
        throw new Error(body.detail ?? `Server returned ${res.status}`);
      }
      setStatus(await res.json() as PortalStatus);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [baseUrl, jobId]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  async function sendToPortal() {
    if (!confirm(
      "Send this report to the client portal?\n\nThe client will be notified and will see the current version of the report."
    )) return;

    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/review/send-to-portal`, {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json() as { ok?: boolean; sent_to_count?: number; detail?: string };
      if (!res.ok) throw new Error(body.detail ?? `Server returned ${res.status}`);
      const count = body.sent_to_count ?? 0;
      setSendResult({
        ok: true,
        message: `Report sent to portal successfully. ${count} client user${count === 1 ? "" : "s"} notified.`,
      });
      await loadStatus();
    } catch (e) {
      setSendResult({ ok: false, message: String(e) });
    } finally {
      setSending(false);
    }
  }

  // ── Derived readiness ─────────────────────────────────────────────────────

  const hasPortalUsers  = (status?.active_portal_users_count ?? 0) > 0;
  const capturedIds     = new Set(status?.captured_widget_ids ?? []);
  const capturedCount   = capturedIds.size;
  const expectedCount   = EXPECTED_WIDGET_IDS.length;
  const chartsReady     = capturedCount >= expectedCount;
  const alreadySent     = Boolean(status?.review?.portal_version_id);
  const readyToSend     = hasPortalUsers && capturedCount > 0;

  // ── Loading / error states ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-gray-400">
        Loading portal status…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6">
        <p className="text-sm font-medium text-red-700">Failed to load portal status</p>
        <p className="mt-1 text-xs text-red-500">{error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void loadStatus()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!status) return null;

  const { review, portal_users, portal_version, latest_capture_at } = status;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Client Portal</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Manage what the client sees in their NZInsights portal.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadStatus()}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* Send result banner */}
      {sendResult && (
        <div className={`rounded-xl border px-4 py-3 text-sm flex items-start gap-2 ${
          sendResult.ok
            ? "border-green-200 bg-green-50 text-green-800"
            : "border-red-200 bg-red-50 text-red-700"
        }`}>
          {sendResult.ok
            ? <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
            : <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />}
          {sendResult.message}
        </div>
      )}

      {/* Current portal status */}
      {alreadySent && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Current Portal Version</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-gray-500">Last sent</p>
              <p className="text-sm font-medium text-gray-900">{fmtDateTime(review.published_at)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Sent by</p>
              <p className="text-sm font-medium text-gray-900">{review.published_by ?? "—"}</p>
            </div>
            {portal_version && (
              <div>
                <p className="text-xs text-gray-500">Version</p>
                <p className="text-sm font-medium text-gray-900">
                  {portal_version.version_number != null ? `v${portal_version.version_number}` : "—"}
                  {portal_version.version_label ? ` · ${portal_version.version_label}` : ""}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Readiness checks */}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Readiness Checklist</p>

        {/* Portal users */}
        <ReadinessCard title="Portal Users" icon={Users} ok={hasPortalUsers}>
          {hasPortalUsers ? (
            <div className="space-y-1 mt-1">
              {portal_users.filter(u => u.is_active).map(u => (
                <p key={u.portal_user_id} className="text-xs text-gray-600">
                  {u.full_name} <span className="text-gray-400">({u.email})</span>
                </p>
              ))}
              {portal_users.filter(u => !u.is_active).length > 0 && (
                <p className="text-xs text-gray-400 mt-1">
                  {portal_users.filter(u => !u.is_active).length} inactive user(s) not shown
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-amber-700 mt-1">
              No active portal users. Add users from the client record before sending.
            </p>
          )}
          {status.client_db_id && (
            <Link
              href={`/clients/${status.client_db_id}?section=portal`}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              Manage portal users
              <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </ReadinessCard>

        {/* Charts */}
        <ReadinessCard title="Charts Captured" icon={BarChart2} ok={chartsReady}>
          {capturedCount > 0 ? (
            <div className="mt-1 space-y-1">
              <p className="text-xs text-gray-600">
                {capturedCount} of {expectedCount} charts captured
                {latest_capture_at ? ` · last captured ${fmtDateTime(latest_capture_at)}` : ""}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                {EXPECTED_WIDGET_IDS.map(w => (
                  <div key={w.id} className="flex items-center gap-1.5">
                    {capturedIds.has(w.id)
                      ? <CheckCircle2 className="h-3 w-3 text-green-600 flex-shrink-0" />
                      : <XCircle className="h-3 w-3 text-amber-400 flex-shrink-0" />}
                    <span className="text-xs text-gray-600">{w.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-amber-700 mt-1">
              No charts captured yet. Go to Insights and click &ldquo;Capture Charts for PDF&rdquo; first.
            </p>
          )}
          <Link
            href={`/jobs/${jobId}/insights`}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            Go to Insights
            <ExternalLink className="h-3 w-3" />
          </Link>
        </ReadinessCard>

        {/* Report data */}
        <ReadinessCard title="Report Data" icon={Clock} ok>
          <p className="text-xs text-gray-600 mt-1">
            Report data is compiled from the current live job state when you click &ldquo;Send to Portal&rdquo;.
            {alreadySent && review.published_at && (
              <> The client is currently viewing the version sent on {fmtDateTime(review.published_at)}.</>
            )}
          </p>
        </ReadinessCard>
      </div>

      {/* Send to Portal CTA */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-gray-900">
              {alreadySent ? "Update Portal" : "Send to Portal"}
            </p>
            <p className="mt-1 text-xs text-gray-500 max-w-lg">
              {alreadySent
                ? "Sends the current report data to the client portal, replacing the existing version. Active portal users will be notified by email."
                : "Saves a snapshot of the current report data and makes it visible to the client in their NZInsights portal. Active portal users will be notified by email."}
            </p>
            {!readyToSend && (
              <p className="mt-2 text-xs text-amber-600 flex items-center gap-1">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                {!hasPortalUsers
                  ? "Add at least one active portal user before sending."
                  : "Capture charts from Insights before sending."}
              </p>
            )}
          </div>
          <Button
            onClick={() => void sendToPortal()}
            disabled={sending || !readyToSend}
            className="flex-shrink-0 flex items-center gap-2 bg-green-700 hover:bg-green-800 text-white"
          >
            <Send className="h-4 w-4" />
            {sending ? "Sending…" : alreadySent ? "Update Portal" : "Send to Portal"}
          </Button>
        </div>
      </div>

      {/* Portal users section */}
      {portal_users.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Portal Users</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-5 py-2.5 text-xs font-medium text-gray-500">Name</th>
                <th className="text-left px-5 py-2.5 text-xs font-medium text-gray-500">Email</th>
                <th className="text-left px-5 py-2.5 text-xs font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody>
              {portal_users.map(u => (
                <tr key={u.portal_user_id} className="border-b border-gray-50 last:border-0">
                  <td className="px-5 py-3 text-sm text-gray-900">{u.full_name}</td>
                  <td className="px-5 py-3 text-sm text-gray-500">{u.email}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      u.is_active
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-100 text-gray-500"
                    }`}>
                      {u.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Portal files management */}
      <PortalFilesSection jobId={jobId} baseUrl={baseUrl} />

    </div>
  );
}
