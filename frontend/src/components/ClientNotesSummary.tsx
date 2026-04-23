"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ClientJobRef = {
  job_id: number;
  job_number: string | null;
  job_title: string | null;
  reporting_year?: number | null;
  status?: string | null;
};

type ClientNote = {
  note_id: string;
  source_type: string;
  source_label: string;
  client_db_id: number;
  job_id: number | null;
  job_number: string | null;
  job_title: string | null;
  scope: string;
  site_id: number | null;
  site_name: string;
  category: string;
  report_label: string;
  original_id: string;
  note_location: string;
  note_subject: string | null;
  note_text: string;
  note_author: string | null;
  note_updated_at: string | null;
  row_created_at: string | null;
  row_updated_at: string | null;
};

type ClientNotesSummary = {
  client_db_id: number;
  client_name: string | null;
  total: number;
  items: ClientNote[];
  jobs?: ClientJobRef[];
};

type Props = {
  clientId: number;
  baseUrl: string;
  jobs?: ClientJobRef[];
};

function formatTimestamp(value: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString("en-GB");
}

function matchesSearch(search: string, values: Array<string | null | undefined>): boolean {
  const terms = search
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  if (!terms.length) return true;
  const haystack = values.map((value) => String(value || "").toLowerCase()).join(" ");
  return terms.every((term) => haystack.includes(term));
}

function jobLabel(job: ClientJobRef): string {
  const parts = [job.job_number || `Job ${job.job_id}`, job.job_title].filter(Boolean);
  return parts.join(" - ");
}

function sourceLabel(sourceType: string): string {
  if (sourceType === "client") return "Client Note";
  if (sourceType === "job-communication") return "Job Note";
  if (sourceType === "job-row") return "Job Row Note";
  return sourceType || "Note";
}

export default function ClientNotesSummary({ clientId, baseUrl, jobs = [] }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<ClientNotesSummary | null>(null);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("All");
  const [jobFilter, setJobFilter] = useState("All");
  const [scopeFilter, setScopeFilter] = useState("All");
  const [siteFilter, setSiteFilter] = useState("All");
  const [authorFilter, setAuthorFilter] = useState("All");

  const loadNotes = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/notes-summary`, { credentials: "include" });
      if (!res.ok) {
        throw new Error(`Failed to load notes summary: ${res.status}`);
      }
      const json = (await res.json()) as ClientNotesSummary;
      setSummary(json);
    } catch (err) {
      setSummary(null);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [baseUrl, clientId]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  const availableSources = useMemo(() => {
    const seen = new Set<string>();
    for (const item of summary?.items || []) {
      if (item.source_type) seen.add(item.source_type);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [summary]);

  const availableJobs = useMemo(() => {
    const seen = new Map<string, ClientJobRef>();
    for (const job of [...jobs, ...(summary?.jobs || [])]) {
      if (!job?.job_id) continue;
      const key = String(job.job_id);
      if (!seen.has(key)) seen.set(key, job);
    }
    return Array.from(seen.values()).sort((a, b) => String(a.job_number || a.job_id).localeCompare(String(b.job_number || b.job_id)));
  }, [jobs, summary]);

  const availableScopes = useMemo(() => {
    const seen = new Set<string>();
    for (const item of summary?.items || []) {
      if (item.scope) seen.add(item.scope);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [summary]);

  const availableSites = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of summary?.items || []) {
      if (item.site_id == null) continue;
      const key = String(item.site_id);
      if (!seen.has(key)) seen.set(key, item.site_name || `Site ${item.site_id}`);
    }
    return Array.from(seen.entries()).map(([siteId, siteName]) => ({ siteId, siteName }));
  }, [summary]);

  const availableAuthors = useMemo(() => {
    const seen = new Set<string>();
    for (const item of summary?.items || []) {
      if (item.note_author) seen.add(item.note_author);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [summary]);

  const filteredNotes = useMemo(() => {
    return (summary?.items || []).filter((item) => {
      if (sourceFilter !== "All" && item.source_type !== sourceFilter) return false;
      if (jobFilter !== "All" && String(item.job_id ?? "") !== jobFilter) return false;
      if (scopeFilter !== "All" && item.scope !== scopeFilter) return false;
      if (siteFilter !== "All" && String(item.site_id ?? "") !== siteFilter) return false;
      if (authorFilter !== "All" && (item.note_author || "") !== authorFilter) return false;
      if (search.trim()) {
        return matchesSearch(search, [
          item.note_text,
          item.note_location,
          item.note_subject,
          item.source_label,
          item.note_author,
          item.job_number,
          item.job_title,
          item.scope,
          item.site_name,
          item.category,
          item.report_label,
          item.original_id,
        ]);
      }
      return true;
    });
  }, [authorFilter, jobFilter, scopeFilter, search, siteFilter, sourceFilter, summary]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Client Notes</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Notes from client communications, job notes, and job data, all in one place.
              </p>
            </div>
            <Button variant="outline" asChild>
              <Link href={`/clients/${clientId}?section=timeline`}>Open Communications</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem_14rem_12rem_12rem_12rem]">
            <div className="min-w-0">
              <Label htmlFor="clientNoteSearch">Search</Label>
              <Input
                id="clientNoteSearch"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search notes, labels, IDs, or authors..."
                className="w-full"
              />
            </div>
            <div className="min-w-0">
              <Label htmlFor="clientNoteSourceFilter">Source</Label>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger id="clientNoteSourceFilter" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Sources</SelectItem>
                  {availableSources.map((source) => (
                    <SelectItem key={source} value={source}>
                      {sourceLabel(source)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <Label htmlFor="clientNoteJobFilter">Job</Label>
              <Select value={jobFilter} onValueChange={setJobFilter}>
                <SelectTrigger id="clientNoteJobFilter" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Jobs</SelectItem>
                  {availableJobs.map((job) => (
                    <SelectItem key={job.job_id} value={String(job.job_id)}>
                      {jobLabel(job)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <Label htmlFor="clientNoteScopeFilter">Scope</Label>
              <Select value={scopeFilter} onValueChange={setScopeFilter}>
                <SelectTrigger id="clientNoteScopeFilter" className="w-full">
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
              <Label htmlFor="clientNoteSiteFilter">Site</Label>
              <Select value={siteFilter} onValueChange={setSiteFilter}>
                <SelectTrigger id="clientNoteSiteFilter" className="w-full">
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
              <Label htmlFor="clientNoteAuthorFilter">Author</Label>
              <Select value={authorFilter} onValueChange={setAuthorFilter}>
                <SelectTrigger id="clientNoteAuthorFilter" className="w-full">
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
                setJobFilter("All");
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
            <div className="text-sm text-muted-foreground">No notes found for this client.</div>
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
                          {item.job_number ? `Job ${item.job_number}` : item.job_id ? `Job ${item.job_id}` : "Client"}
                        </div>
                      </td>
                      <td className="p-2">
                        <div className="font-medium">{item.note_location}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {item.site_name || "No site"}
                          {item.scope ? ` | ${item.scope}` : ""}
                          {item.category ? ` | ${item.category}` : ""}
                          {item.report_label ? ` | ${item.report_label}` : ""}
                        </div>
                      </td>
                      <td className="p-2 whitespace-pre-wrap">
                        {item.note_subject ? <div className="font-medium">{item.note_subject}</div> : null}
                        <div>{item.note_text}</div>
                      </td>
                      <td className="p-2">{item.note_author || "-"}</td>
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
