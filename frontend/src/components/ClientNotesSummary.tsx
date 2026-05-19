"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

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
  note_backend?: string;
  source_label: string;
  raw_id: number;
  raw_job_id: number | null;
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
  updated_by: string | null;
  is_high_importance: boolean;
  archived: boolean;
  archived_at: string | null;
  archived_by: string | null;
  note_updated_at: string | null;
  row_created_at: string | null;
  row_updated_at: string | null;
};

type ClientNotesSummaryData = {
  client_db_id: number;
  client_name: string | null;
  total: number;
  items: ClientNote[];
  jobs?: ClientJobRef[];
};

type ClientNoteGroup = {
  key: string;
  label: string;
  description: string;
  items: ClientNote[];
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
  return sourceType || "Note";
}

export default function ClientNotesSummary({ clientId, baseUrl, jobs = [] }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<ClientNotesSummaryData | null>(null);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("All");
  const [jobFilter, setJobFilter] = useState("All");
  const [scopeFilter, setScopeFilter] = useState("All");
  const [siteFilter, setSiteFilter] = useState("All");
  const [authorFilter, setAuthorFilter] = useState("All");
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    client: true,
    "job-communication": true,
  });

  const [addClientNoteOpen, setAddClientNoteOpen] = useState(false);
  const [addSubject, setAddSubject] = useState("");
  const [addText, setAddText] = useState("");
  const [addHighImportance, setAddHighImportance] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState("");

  const [editingNote, setEditingNote] = useState<ClientNote | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editText, setEditText] = useState("");
  const [editHighImportance, setEditHighImportance] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");

  const loadNotes = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/notes-summary`, { credentials: "include" });
      if (!res.ok) {
        throw new Error(`Failed to load notes summary: ${res.status}`);
      }
      const json = (await res.json()) as ClientNotesSummaryData;
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

  const openEdit = useCallback((note: ClientNote) => {
    setEditingNote(note);
    setEditSubject(note.note_subject ?? "");
    setEditText(note.note_text);
    setEditHighImportance(Boolean(note.is_high_importance));
    setEditError("");
  }, []);

  const openAddClientNote = useCallback(() => {
    setAddSubject("");
    setAddText("");
    setAddHighImportance(false);
    setAddError("");
    setAddClientNoteOpen(true);
  }, []);

  const saveClientNote = useCallback(async () => {
    setAddBusy(true);
    setAddError("");
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          subject: addSubject.trim() || null,
          note_text: addText.trim(),
          is_high_importance: addHighImportance,
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `Save failed: ${res.status}`);
      }
      setAddClientNoteOpen(false);
      setAddSubject("");
      setAddText("");
      setAddHighImportance(false);
      await loadNotes();
    } catch (err) {
      setAddError((err as Error).message);
    } finally {
      setAddBusy(false);
    }
  }, [addHighImportance, addSubject, addText, baseUrl, clientId, loadNotes]);

  const saveEdit = useCallback(async () => {
    if (!editingNote) return;
    setEditBusy(true);
    setEditError("");
    try {
      let url: string;
      let body: Record<string, unknown>;
      if (editingNote.note_backend === "client_notes") {
        url = `${baseUrl}/client-notes/${editingNote.raw_id}`;
        body = { subject: editSubject, note_text: editText, is_high_importance: editHighImportance };
      } else if (editingNote.source_type === "client") {
        url = `${baseUrl}/timeline/events/${editingNote.raw_id}`;
        body = { subject: editSubject, body_text: editText, is_high_importance: editHighImportance };
      } else {
        url = `${baseUrl}/jobs/${editingNote.raw_job_id}/communications/${editingNote.raw_id}`;
        body = { subject: editSubject, message_text: editText };
      }
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `Save failed: ${res.status}`);
      }
      setEditingNote(null);
      await loadNotes();
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      setEditBusy(false);
    }
  }, [baseUrl, editingNote, editHighImportance, editSubject, editText, loadNotes]);

  const archiveNote = useCallback(async (note: ClientNote) => {
    if (!window.confirm("Archive this note? It will no longer appear in the notes list.")) return;
    try {
      let url: string;
      if (note.note_backend === "client_notes") {
        url = `${baseUrl}/client-notes/${note.raw_id}/archive`;
      } else if (note.source_type === "client") {
        url = `${baseUrl}/timeline/events/${note.raw_id}/archive`;
      } else {
        url = `${baseUrl}/jobs/${note.raw_job_id}/communications/${note.raw_id}/archive`;
      }
      const res = await fetch(url, { method: "PATCH", credentials: "include" });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `Archive failed: ${res.status}`);
      }
      await loadNotes();
    } catch (err) {
      alert(`Archive failed: ${(err as Error).message}`);
    }
  }, [baseUrl, loadNotes]);

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

  const groupedNotes = useMemo<ClientNoteGroup[]>(() => {
    const groupMeta: Array<Pick<ClientNoteGroup, "key" | "label" | "description">> = [
      {
        key: "client",
        label: "Client Notes",
        description: "Notes added directly on the client record.",
      },
      {
        key: "job-communication",
        label: "Job Notes",
        description: "Notes captured from job communications and job-level updates.",
      },
    ];

    return groupMeta
      .map((group) => ({
        ...group,
        items: filteredNotes.filter((item) => item.source_type === group.key),
      }))
      .filter((group) => group.items.length > 0);
  }, [filteredNotes]);

  const toggleSection = useCallback((key: string) => {
    setExpandedSections((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }, []);

  const renderNotesTable = useCallback((items: ClientNote[]) => {
    return (
      <div className="w-full">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="w-[18%] p-2">Source</th>
              <th className="w-[18%] p-2">Where</th>
              <th className="w-[36%] p-2">Note</th>
              <th className="w-[10%] p-2">Author</th>
              <th className="w-[10%] p-2">Updated At</th>
              <th className="w-[8%] p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.note_id} className={`border-b align-top ${item.is_high_importance ? "bg-amber-50/60" : ""}`}>
                <td className="p-2 align-top break-words">
                  <div className="font-medium">{item.source_label}</div>
                  {item.is_high_importance ? (
                    <Badge variant="secondary" className="mt-1 bg-amber-100 text-amber-800">
                      High importance
                    </Badge>
                  ) : null}
                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.job_number ? `Job ${item.job_number}` : item.job_id ? `Job ${item.job_id}` : "Client"}
                  </div>
                </td>
                <td className="p-2 align-top break-words">
                  <div className="font-medium">{item.note_location}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.site_name || "No site"}
                    {item.scope ? ` | ${item.scope}` : ""}
                    {item.category ? ` | ${item.category}` : ""}
                    {item.report_label ? ` | ${item.report_label}` : ""}
                  </div>
                </td>
                <td className="p-2 align-top whitespace-pre-wrap break-words">
                  {item.note_subject ? <div className="font-medium">{item.note_subject}</div> : null}
                  <div>{item.note_text}</div>
                  {item.updated_by ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Edited by {item.updated_by}
                      {item.row_updated_at ? ` on ${formatTimestamp(item.row_updated_at)}` : ""}
                    </div>
                  ) : null}
                </td>
                <td className="p-2 align-top break-words">{item.note_author || "-"}</td>
                <td className="p-2 align-top break-words">{formatTimestamp(item.note_updated_at || item.row_updated_at)}</td>
                <td className="p-2 align-top">
                  <div className="flex flex-col gap-1">
                    <Button size="sm" variant="outline" onClick={() => openEdit(item)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void archiveNote(item)}>
                      Archive
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }, [openEdit, archiveNote]);

  return (
      <div className="space-y-6">
      <Dialog open={addClientNoteOpen} onOpenChange={setAddClientNoteOpen}>
        <DialogContent className="!w-[98vw] !max-w-[1800px]">
          <DialogHeader>
            <DialogTitle>Add Client Note</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="addClientNoteSubject">Subject</Label>
              <Input
                id="addClientNoteSubject"
                value={addSubject}
                onChange={(e) => setAddSubject(e.target.value)}
                placeholder="Subject (optional)"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="addClientNoteText">Note</Label>
              <Textarea
                id="addClientNoteText"
                value={addText}
                onChange={(e) => setAddText(e.target.value)}
                rows={12}
                placeholder="Write the client note here..."
                className="w-full"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={addHighImportance}
                onChange={(e) => setAddHighImportance(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <span className="font-medium">High importance</span>
            </label>
            {addError ? <p className="text-sm text-destructive">{addError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddClientNoteOpen(false)} disabled={addBusy}>
              Cancel
            </Button>
            <Button onClick={() => void saveClientNote()} disabled={addBusy || !addText.trim()}>
              {addBusy ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editingNote !== null} onOpenChange={(open) => { if (!open) setEditingNote(null); }}>
        <DialogContent className="!w-[98vw] !max-w-[1800px]">
          <DialogHeader>
            <DialogTitle>{editingNote?.source_type === "client" ? "Edit Client Note" : "Edit Note"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="editNoteSubject">Subject</Label>
              <Input
                id="editNoteSubject"
                value={editSubject}
                onChange={(e) => setEditSubject(e.target.value)}
                placeholder="Subject (optional)"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="editNoteText">Note</Label>
              <Textarea
                id="editNoteText"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={10}
                placeholder="Note text..."
                className="w-full"
              />
            </div>
            {editingNote?.source_type === "client" ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editHighImportance}
                  onChange={(e) => setEditHighImportance(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <span className="font-medium">High importance</span>
              </label>
            ) : null}
            {editError ? <p className="text-sm text-destructive">{editError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingNote(null)} disabled={editBusy}>
              Cancel
            </Button>
            <Button onClick={() => void saveEdit()} disabled={editBusy || !editText.trim()}>
              {editBusy ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
              <div>
              <CardTitle>Client Notes</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Client-level and job-level notes, all in one place. Client notes can be added, edited, archived, and marked high importance.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={openAddClientNote}>
                Add Client Note
              </Button>
              <Button variant="outline" asChild>
                <Link href={`/clients/${clientId}?section=timeline`}>Open Communications</Link>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
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
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <div className="min-w-0">
                <Label htmlFor="clientNoteSourceFilter">Source</Label>
                <Select value={sourceFilter} onValueChange={setSourceFilter}>
                  <SelectTrigger id="clientNoteSourceFilter" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Sources</SelectItem>
                    {availableSources.map((src) => (
                      <SelectItem key={src} value={src}>
                        {sourceLabel(src)}
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
            <div className="space-y-4">
              {groupedNotes.map((group) => {
                const isExpanded = expandedSections[group.key] !== false;
                return (
                  <section key={group.key} className="rounded-lg border bg-background">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold">{group.label}</h3>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            {group.items.length}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{group.description}</p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => toggleSection(group.key)}>
                        {isExpanded ? "Collapse" : "Expand"}
                      </Button>
                    </div>
                    {isExpanded ? <div className="p-4">{renderNotesTable(group.items)}</div> : null}
                  </section>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
