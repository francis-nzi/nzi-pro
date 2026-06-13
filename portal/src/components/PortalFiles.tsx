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
  report:             "bg-blue-50 text-blue-700 ring-blue-200",
  final_report:       "bg-blue-50 text-blue-700 ring-blue-200",
  generated_report:   "bg-blue-50 text-blue-700 ring-blue-200",
  invoice:            "bg-purple-50 text-purple-700 ring-purple-200",
  certificate:        "bg-green-50 text-green-700 ring-green-200",
  policy:             "bg-orange-50 text-orange-700 ring-orange-200",
  training:           "bg-yellow-50 text-yellow-700 ring-yellow-200",
  data:               "bg-gray-50 text-gray-600 ring-gray-200",
  client_provided:    "bg-gray-50 text-gray-600 ring-gray-200",
};

function fileTypeBadge(raw: string): string {
  const key = (raw || "").toLowerCase().replace(/\s+/g, "_");
  return FILE_TYPE_COLORS[key] ?? "bg-gray-50 text-gray-600 ring-gray-200";
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function FileIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

// ── Search icon ───────────────────────────────────────────────────────────────

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function PortalFiles() {
  const [files, setFiles] = useState<PortalFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterYear, setFilterYear] = useState("all");

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

  // Derived filter options
  const fileTypes = Array.from(new Set(files.map((f) => f.file_type).filter(Boolean))).sort();
  const years = Array.from(new Set(files.map((f) => f.reporting_year).filter((y): y is number => y != null)))
    .sort((a, b) => b - a);

  // Apply filters
  const q = search.trim().toLowerCase();
  const visible = files.filter((f) => {
    if (q) {
      const hay = [f.file_name, f.description ?? "", fileTypeLabel(f.file_type)].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (filterType !== "all" && f.file_type !== filterType) return false;
    if (filterYear !== "all" && String(f.reporting_year) !== filterYear) return false;
    return true;
  });

  const isFiltered = q || filterType !== "all" || filterYear !== "all";

  if (loading) {
    return <div className="py-12 text-center text-sm text-gray-400">Loading files…</div>;
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
        <p className="mt-3 text-sm font-medium text-gray-500">No files yet</p>
        <p className="mt-1 text-xs text-gray-400">
          Your NZI team will upload documents here as they become available.
        </p>
      </div>
    );
  }

  const selectCls = "rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-100";

  return (
    <div className="space-y-4">

      {/* ── Filter bar ── */}
      <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3 space-y-2">
        {/* Search */}
        <div className="relative">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search file name or description…"
            className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-xs text-gray-700 placeholder-gray-400 focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-100"
          />
        </div>

        {/* Dropdowns row */}
        <div className="flex flex-wrap gap-2 items-center">
          <select value={filterYear} onChange={(e) => setFilterYear(e.target.value)} className={selectCls}>
            <option value="all">All years</option>
            {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
          </select>

          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className={selectCls}>
            <option value="all">All file types</option>
            {fileTypes.map((t) => (
              <option key={t} value={t}>{fileTypeLabel(t)}</option>
            ))}
          </select>

          {isFiltered && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-xs text-gray-500">{visible.length} of {files.length} files</span>
              <button
                onClick={() => { setSearch(""); setFilterType("all"); setFilterYear("all"); }}
                className="text-xs text-orange-600 hover:text-orange-700 underline"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── File list ── */}
      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 p-10 text-center">
          <p className="text-sm text-gray-400">No files match your search.</p>
          <button
            onClick={() => { setSearch(""); setFilterType("all"); setFilterYear("all"); }}
            className="mt-2 text-xs text-orange-600 hover:text-orange-700 underline"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {visible.map((file) => {
            const downloadUrl = file.external_web_url ?? `/api/backend/portal/files/${file.file_id}/download`;
            return (
              <div key={file.file_id} className="flex items-start gap-4 px-5 py-4">
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
                    {file.reporting_year && <span>{file.reporting_year} report year</span>}
                    {formatFileSize(file.file_size) && <span>{formatFileSize(file.file_size)}</span>}
                    {file.uploaded_at && <span>Added {formatDate(file.uploaded_at)}</span>}
                  </div>
                </div>

                <a
                  href={downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-orange-300 hover:text-orange-600"
                >
                  {file.external_web_url ? (
                    <><ExternalLinkIcon className="h-3.5 w-3.5" />Open</>
                  ) : (
                    "Download"
                  )}
                </a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
