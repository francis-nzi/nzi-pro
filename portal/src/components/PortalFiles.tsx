"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { apiFetch } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyStatePanel, ErrorPanel, SkeletonLoader } from "@/components/shared/DataStates";

async function downloadPortalFile(fileId: number, fileName: string) {
  const res = await apiFetch(`/portal/files/${fileId}/download`);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Types ─────────────────────────────────────────────────────────────────────

type PortalFile = {
  file_id: number;
  job_id: number;
  reporting_year: number | null;
  job_title: string;
  job_number: string;
  file_name: string;
  file_type: string;
  description: string | null;
  file_size: number | null;
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

// ── Main component ─────────────────────────────────────────────────────────────

export default function PortalFiles() {
  const [files, setFiles] = useState<PortalFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState<Record<number, boolean>>({});

  // Filters
  const [search, setSearch] = useState("");
  const [filterJob, setFilterJob] = useState("all");
  const [filterYear, setFilterYear] = useState("all");
  const [filterType, setFilterType] = useState("all");

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
  const jobOptions = Array.from(
    new Map(files.map(f => [f.job_id, { jobId: f.job_id, label: f.job_number ? `${f.job_number} — ${f.job_title}` : f.job_title }])).values()
  );
  const fileTypes = Array.from(new Set(files.map((f) => f.file_type).filter(Boolean))).sort();
  const years = Array.from(new Set(files.map((f) => f.reporting_year).filter((y): y is number => y != null)))
    .sort((a, b) => b - a);

  // Apply filters
  const q = search.trim().toLowerCase();
  const visible = files.filter((f) => {
    if (q) {
      const hay = [f.file_name, f.description ?? "", fileTypeLabel(f.file_type), f.job_number, f.job_title].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (filterJob !== "all" && String(f.job_id) !== filterJob) return false;
    if (filterYear !== "all" && String(f.reporting_year) !== filterYear) return false;
    if (filterType !== "all" && f.file_type !== filterType) return false;
    return true;
  });

  const isFiltered = q || filterJob !== "all" || filterYear !== "all" || filterType !== "all";

  if (loading) {
    return <SkeletonLoader rows={5} />;
  }

  if (error) {
    return <ErrorPanel description={`Failed to load files: ${error}`} />;
  }

  if (files.length === 0) {
    return (
      <EmptyStatePanel
        title="No files yet"
        description="Your NZI team will upload documents here as they become available."
      />
    );
  }

  return (
    <div className="space-y-4">

      {/* ── Filter bar ── */}
      <div className="space-y-2 rounded-xl border border-border bg-muted/40 p-3">
        {/* Search */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search file name or description…"
            className="h-8 pl-8 text-xs"
          />
        </div>

        {/* Dropdowns row */}
        <div className="flex flex-wrap items-center gap-2">
          {jobOptions.length > 1 && (
            <Select value={filterJob} onValueChange={setFilterJob}>
              <SelectTrigger className="h-8 w-auto min-w-[10rem] text-xs">
                <SelectValue placeholder="All jobs" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All jobs</SelectItem>
                {jobOptions.map(j => <SelectItem key={j.jobId} value={String(j.jobId)}>{j.label}</SelectItem>)}
              </SelectContent>
            </Select>
          )}

          <Select value={filterYear} onValueChange={setFilterYear}>
            <SelectTrigger className="h-8 w-auto min-w-[8rem] text-xs">
              <SelectValue placeholder="All years" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All years</SelectItem>
              {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="h-8 w-auto min-w-[9rem] text-xs">
              <SelectValue placeholder="All file types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All file types</SelectItem>
              {fileTypes.map((t) => (
                <SelectItem key={t} value={t}>{fileTypeLabel(t)}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {isFiltered && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{visible.length} of {files.length} files</span>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                onClick={() => { setSearch(""); setFilterJob("all"); setFilterYear("all"); setFilterType("all"); }}
              >
                Clear filters
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ── File list ── */}
      {visible.length === 0 ? (
        <EmptyStatePanel
          title="No files match your search"
          description="Try adjusting or clearing your filters."
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setSearch(""); setFilterType("all"); setFilterYear("all"); }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {visible.map((file) => {
            const isDownloading = downloading[file.file_id] ?? false;
            return (
              <div key={file.file_id} className="flex items-start gap-4 px-5 py-4">
                <FileIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-muted-foreground" />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {file.file_name}
                    </span>
                    {file.file_type && (
                      <Badge className={`ring-1 ring-inset ${fileTypeBadge(file.file_type)}`}>
                        {fileTypeLabel(file.file_type)}
                      </Badge>
                    )}
                  </div>

                  {file.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{file.description}</p>
                  )}

                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    {file.reporting_year && <span>{file.reporting_year} report year</span>}
                    {file.job_number && <span>{file.job_number}</span>}
                    {formatFileSize(file.file_size) && <span>{formatFileSize(file.file_size)}</span>}
                    {file.uploaded_at && <span>Added {formatDate(file.uploaded_at)}</span>}
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={isDownloading}
                  onClick={() => {
                    setDownloading(d => ({ ...d, [file.file_id]: true }));
                    downloadPortalFile(file.file_id, file.file_name)
                      .catch(() => {})
                      .finally(() => setDownloading(d => ({ ...d, [file.file_id]: false })));
                  }}
                  className="flex-shrink-0 gap-1.5"
                >
                  <ExternalLinkIcon className="h-3.5 w-3.5" />
                  {isDownloading ? "…" : "Open"}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
