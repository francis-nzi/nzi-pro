"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type JobNote = {
  note_id: string;
  source_type: string;
  source_label: string;
  row_id: number | null;
  job_id: number;
  job_number: string | null;
  job_title: string | null;
  scope: string;
  site_id: number | null;
  site_name: string;
  category: string;
  report_label: string;
  original_id: string;
  note_text: string;
  note_location: string;
  note_updated_at: string | null;
  note_updated_by: string | null;
  row_created_at: string | null;
  row_updated_at: string | null;
};

type JobNotesSummary = {
  job_id: number;
  job_number: string | null;
  job_title: string | null;
  total: number;
  items: JobNote[];
};

type JobNotesSummaryProps = {
  jobId: number;
  baseUrl: string;
};

function formatTimestamp(value: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString();
}

function matchesSearch(search: string, values: Array<string | null | undefined>): boolean {
  const terms = search
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  if (!terms.length) return true;

  const haystack = values
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
  return terms.every((term) => haystack.includes(term));
}

export default function JobNotesSummary({ jobId, baseUrl }: JobNotesSummaryProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<JobNotesSummary | null>(null);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("All");
  const [scopeFilter, setScopeFilter] = useState("All");
  const [siteFilter, setSiteFilter] = useState("All");
  const [authorFilter, setAuthorFilter] = useState("All");

  const loadNotes = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/notes-summary`, { credentials: "include" });
      if (!res.ok) {
        throw new Error(`Failed to load notes summary: ${res.status}`);
      }
      const json = (await res.json()) as JobNotesSummary;
      setSummary(json);
    } catch (err) {
      setSummary(null);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [baseUrl, jobId]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  const availableScopes = useMemo(() => {
    const seen = new Set<string>();
    for (const item of summary?.items || []) {
      if (item.scope) seen.add(item.scope);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [summary]);

  const availableSources = useMemo(() => {
    const seen = new Set<string>();
    for (const item of summary?.items || []) {
      if (item.source_type) seen.add(item.source_type);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [summary]);

  const availableSites = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of summary?.items || []) {
      if (item.site_id == null) continue;
      const key = String(item.site_id);
      if (!seen.has(key)) {
        seen.set(key, item.site_name || `Site ${item.site_id}`);
      }
    }
    return Array.from(seen.entries()).map(([siteId, siteName]) => ({ siteId, siteName }));
  }, [summary]);

  const availableAuthors = useMemo(() => {
    const seen = new Set<string>();
    for (const item of summary?.items || []) {
      if (item.note_updated_by) seen.add(item.note_updated_by);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [summary]);

  const filteredNotes = useMemo(() => {
    return (summary?.items || []).filter((item) => {
      if (sourceFilter !== "All" && item.source_type !== sourceFilter) return false;
      if (scopeFilter !== "All" && item.scope !== scopeFilter) return false;
      if (siteFilter !== "All" && String(item.site_id ?? "") !== siteFilter) return false;
      if (authorFilter !== "All" && (item.note_updated_by || "") !== authorFilter) return false;
      if (search.trim()) {
        return matchesSearch(search, [
          item.source_label,
          item.note_text,
          item.note_location,
          item.scope,
          item.site_name,
          item.category,
          item.report_label,
          item.original_id,
          item.note_updated_by,
        ]);
      }
      return true;
    });
  }, [authorFilter, search, siteFilter, scopeFilter, sourceFilter, summary]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Job Notes</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Job communications and job row notes, with row context, author, and timestamp.
              </p>
            </div>
            <Button variant="outline" asChild>
              <Link href={`/jobs/${jobId}/data-entry`}>Open Data Entry</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem_12rem_12rem_12rem]">
            <div className="min-w-0">
              <Label htmlFor="noteSearch">Search</Label>
              <Input
                id="noteSearch"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search notes, labels, IDs, or authors..."
                className="w-full"
              />
            </div>
            <div className="min-w-0">
              <Label htmlFor="noteSourceFilter">Source</Label>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger id="noteSourceFilter" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Sources</SelectItem>
                  {availableSources.map((source) => (
                    <SelectItem key={source} value={source}>
                      {source === "job-communication" ? "Job Note" : source === "job-row" ? "Job Row Note" : source}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <Label htmlFor="noteScopeFilter">Scope</Label>
              <Select value={scopeFilter} onValueChange={setScopeFilter}>
                <SelectTrigger id="noteScopeFilter" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Scopes</SelectItem>
                  {availableScopes.map((scope) => (
                    <SelectItem key={scope} value={scope}>
                      {scope}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <Label htmlFor="noteSiteFilter">Site</Label>
              <Select value={siteFilter} onValueChange={setSiteFilter}>
                <SelectTrigger id="noteSiteFilter" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Sites</SelectItem>
                  {availableSites.map((site) => (
                    <SelectItem key={site.siteId} value={site.siteId}>
                      {site.siteName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <Label htmlFor="noteAuthorFilter">Author</Label>
              <Select value={authorFilter} onValueChange={setAuthorFilter}>
                <SelectTrigger id="noteAuthorFilter" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Authors</SelectItem>
                  {availableAuthors.map((author) => (
                    <SelectItem key={author} value={author}>
                      {author}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setSearch("");
                setSourceFilter("All");
                setScopeFilter("All");
                setSiteFilter("All");
                setAuthorFilter("All");
              }}
            >
              Clear Filters
            </Button>
            <Button variant="outline" onClick={loadNotes} disabled={loading}>
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {error ? <div className="text-sm text-destructive">{error}</div> : null}

      <Card>
        <CardHeader>
          <CardTitle>Notes Ledger ({filteredNotes.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading notes...</div>
          ) : filteredNotes.length === 0 ? (
            <div className="text-sm text-muted-foreground">No notes found for this job.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1200px] text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="p-2">Source</th>
                    <th className="p-2">Where</th>
                    <th className="p-2">Note</th>
                    <th className="p-2">Updated By</th>
                    <th className="p-2">Updated At</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredNotes.map((item) => (
                    <tr key={item.note_id} className="border-b align-top">
                      <td className="p-2">
                        <div className="font-medium">{item.source_label}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {item.job_number ? `Job ${item.job_number}` : item.job_id ? `Job ${item.job_id}` : "Job"}
                        </div>
                      </td>
                      <td className="p-2">
                        <div className="font-medium">{item.note_location}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {item.row_id ? `Row ${item.row_id}` : item.job_id ? `Job ${item.job_id}` : "Job"} | {item.scope || "No scope"} | {item.site_name || "No site"}
                        </div>
                      </td>
                      <td className="p-2 whitespace-pre-wrap">{item.note_text}</td>
                      <td className="p-2">{item.note_updated_by || "-"}</td>
                      <td className="p-2">{formatTimestamp(item.note_updated_at || item.row_updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
