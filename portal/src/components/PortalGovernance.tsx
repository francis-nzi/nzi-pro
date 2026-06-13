"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/auth";

// ── Types ─────────────────────────────────────────────────────────────────────

type PortalFile = {
  file_id: number;
  job_id: number;
  reporting_year: number | null;
  job_title: string;
  file_name: string;
  file_type: string;
  description: string | null;
  file_size: number | null;
  external_web_url: string | null;
  storage_provider: string;
  uploaded_at: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
    });
  } catch {
    return iso;
  }
}

function fileTypeLabel(raw: string): string {
  if (!raw) return "Document";
  return raw
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const FILE_TYPE_COLORS: Record<string, string> = {
  report:        "bg-blue-50 text-blue-700 ring-blue-200",
  final_report:  "bg-blue-50 text-blue-700 ring-blue-200",
  invoice:       "bg-purple-50 text-purple-700 ring-purple-200",
  certificate:   "bg-green-50 text-green-700 ring-green-200",
  policy:        "bg-orange-50 text-orange-700 ring-orange-200",
  training:      "bg-yellow-50 text-yellow-700 ring-yellow-200",
  data:          "bg-gray-50 text-gray-600 ring-gray-200",
};

function fileTypeBadge(raw: string): string {
  const key = (raw || "").toLowerCase().replace(/\s+/g, "_");
  return (
    FILE_TYPE_COLORS[key] ??
    "bg-gray-50 text-gray-600 ring-gray-200"
  );
}

// ── File icon (SVG) ───────────────────────────────────────────────────────────

function FileIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PortalGovernance() {
  const [files, setFiles] = useState<PortalFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterType, setFilterType] = useState<string>("all");

  useEffect(() => {
    apiFetch("/portal/files")
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        const d = await r.json() as { ok: boolean; files: PortalFile[] };
        setFiles(d.files ?? []);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Derive unique file types for filter tabs
  const fileTypes = Array.from(new Set(files.map((f) => f.file_type).filter(Boolean))).sort();

  const visible = filterType === "all"
    ? files
    : files.filter((f) => f.file_type === filterType);

  if (loading) {
    return (
      <div className="py-12 text-center text-sm text-gray-400">Loading files…</div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Failed to load files: {error}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center">
        <FileIcon className="mx-auto h-10 w-10 text-gray-300" />
        <p className="mt-3 text-sm font-medium text-gray-500">No documents yet</p>
        <p className="mt-1 text-xs text-gray-400">
          Your NZI team will upload documents here as they become available.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      {fileTypes.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilterType("all")}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filterType === "all"
                ? "bg-orange-100 text-orange-700"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            All ({files.length})
          </button>
          {fileTypes.map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filterType === t
                  ? "bg-orange-100 text-orange-700"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              {fileTypeLabel(t)} ({files.filter((f) => f.file_type === t).length})
            </button>
          ))}
        </div>
      )}

      {/* File list */}
      <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
        {visible.map((file) => {
          const downloadUrl = file.external_web_url ?? `/api/backend/portal/files/${file.file_id}/download`;
          return (
            <div
              key={file.file_id}
              className="flex items-start gap-4 px-5 py-4"
            >
              <FileIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-gray-400" />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-gray-900 truncate">
                    {file.file_name}
                  </span>
                  {file.file_type && (
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${fileTypeBadge(file.file_type)}`}>
                      {fileTypeLabel(file.file_type)}
                    </span>
                  )}
                </div>

                {file.description && (
                  <p className="mt-0.5 text-xs text-gray-500">{file.description}</p>
                )}

                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-400">
                  {file.reporting_year && (
                    <span>{file.reporting_year} report year</span>
                  )}
                  {formatFileSize(file.file_size) && (
                    <span>{formatFileSize(file.file_size)}</span>
                  )}
                  {file.uploaded_at && (
                    <span>Added {formatDate(file.uploaded_at)}</span>
                  )}
                </div>
              </div>

              <a
                href={downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-orange-300 hover:text-orange-600"
              >
                {file.external_web_url ? (
                  <>
                    <ExternalLinkIcon className="h-3.5 w-3.5" />
                    Open
                  </>
                ) : (
                  "Download"
                )}
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}
