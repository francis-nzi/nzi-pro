"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type JobNote = {
  note_id: string;
  source_type: string;
  source_label: string;
  communication_id: number | null;
  row_id: number | null;
  job_id: number;
  job_number: string | null;
  job_title: string | null;
  note_subject: string | null;
  scope: string;
  site_id: number | null;
  site_name: string;
  category: string;
  report_label: string;
  original_id: string;
  note_text: string;
  note_location: string;
  archived?: boolean;
  archived_at?: string | null;
  archived_by?: string | null;
  note_created_at: string | null;
  note_updated_at: string | null;
  note_updated_by: string | null;
  note_edit_timestamps?: string[];
  row_created_at: string | null;
  row_updated_at: string | null;
};

type SiteOption = {
  site_id: number;
  site_name: string;
  is_registered_office: boolean;
};

type JobNotesSummary = {
  job_id: number;
  job_number: string | null;
  job_title: string | null;
  client_db_id?: number | null;
  total: number;
  items: JobNote[];
  site_options?: SiteOption[];
  default_site_id?: number | null;
  scope_options?: string[];
  category_options?: string[];
};

type JobNoteGroup = {
  key: string;
  label: string;
  description: string;
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
  const [siteOptions, setSiteOptions] = useState<SiteOption[]>([]);
  const [defaultSiteId, setDefaultSiteId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("All");
  const [archiveFilter, setArchiveFilter] = useState("Active");
  const [scopeFilter, setScopeFilter] = useState("All");
  const [siteFilter, setSiteFilter] = useState("All");
  const [authorFilter, setAuthorFilter] = useState("All");
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    "job-communication": true,
    "job-row": true,
  });
  const [addNoteOpen, setAddNoteOpen] = useState(false);
  const [pendingArchiveNote, setPendingArchiveNote] = useState<JobNote | null>(null);
  const [noteSubject, setNoteSubject] = useState("");
  const [noteScope, setNoteScope] = useState("__none__");
  const [noteCategory, setNoteCategory] = useState("__none__");
  const [noteSiteId, setNoteSiteId] = useState("__none__");
  const [noteText, setNoteText] = useState("");
  const [addNoteLoading, setAddNoteLoading] = useState(false);
  const [addNoteError, setAddNoteError] = useState("");
  const [editingNote, setEditingNote] = useState<JobNote | null>(null);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/notes-summary?archive_state=all&_t=${Date.now()}`, { credentials: "include" });
      if (!res.ok) {
        throw new Error(`Failed to load notes summary: ${res.status}`);
      }
      const json = (await res.json()) as JobNotesSummary;
      setSummary(json);
      setSiteOptions(json.site_options || []);
      setDefaultSiteId(json.default_site_id ?? null);
    } catch (err) {
      setSummary(null);
      setSiteOptions([]);
      setDefaultSiteId(null);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [baseUrl, jobId]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  const resolvedDefaultSiteId = useMemo(() => {
    if (defaultSiteId != null) return String(defaultSiteId);
    if (siteOptions.length > 0) return String(siteOptions[0].site_id);
    return "__none__";
  }, [defaultSiteId, siteOptions]);

  const availableScopes = useMemo(() => {
    const seen = new Set<string>();
    for (const scope of summary?.scope_options || []) {
      if (scope) seen.add(scope);
    }
    for (const item of summary?.items || []) {
      if (item.scope) seen.add(item.scope);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [summary]);

  const availableCategories = useMemo(() => {
    const seen = new Set<string>();
    for (const category of summary?.category_options || []) {
      if (category) seen.add(category);
    }
    for (const item of summary?.items || []) {
      if (item.category) seen.add(item.category);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [summary]);

  const noteScopeOptions = useMemo(() => {
    const seen = new Set<string>(availableScopes);
    if (editingNote?.scope && editingNote.scope.toLowerCase() !== "nan") seen.add(editingNote.scope);
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [availableScopes, editingNote?.scope]);

  const noteCategoryOptions = useMemo(() => {
    const seen = new Set<string>(availableCategories);
    if (editingNote?.category && editingNote.category.toLowerCase() !== "nan") seen.add(editingNote.category);
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [availableCategories, editingNote?.category]);

  const availableSources = useMemo(() => {
    const seen = new Set<string>();
    for (const item of summary?.items || []) {
      if (item.source_type) seen.add(item.source_type);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [summary]);

  const availableSites = useMemo(() => {
    const seen = new Map<string, string>();
    for (const site of siteOptions) {
      const key = String(site.site_id);
      if (!seen.has(key)) {
        seen.set(key, site.site_name || `Site ${site.site_id}`);
      }
    }
    for (const item of summary?.items || []) {
      if (item.site_id == null) continue;
      const key = String(item.site_id);
      if (!seen.has(key)) {
        seen.set(key, item.site_name || `Site ${item.site_id}`);
      }
    }
    return Array.from(seen.entries()).map(([siteId, siteName]) => ({ siteId, siteName }));
  }, [siteOptions, summary]);

  const noteSiteOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const site of siteOptions) {
      const key = String(site.site_id);
      if (!seen.has(key)) {
        seen.set(key, site.site_name || `Site ${site.site_id}`);
      }
    }
    if (editingNote?.site_id != null) {
      const key = String(editingNote.site_id);
      if (!seen.has(key)) {
        seen.set(key, editingNote.site_name || `Site ${editingNote.site_id}`);
      }
    }
    return Array.from(seen.entries()).map(([siteId, siteName]) => ({ siteId, siteName }));
  }, [editingNote?.site_id, editingNote?.site_name, siteOptions]);

  const availableAuthors = useMemo(() => {
    const seen = new Set<string>();
    for (const item of summary?.items || []) {
      if (item.note_updated_by) seen.add(item.note_updated_by);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [summary]);

  const resetNoteForm = useCallback((note?: JobNote | null) => {
    if (note && note.source_type === "job-communication") {
      const noteScopeValue = note.scope && note.scope.toLowerCase() !== "nan" ? note.scope : "";
      const noteCategoryValue = note.category && note.category.toLowerCase() !== "nan" ? note.category : "";
      setEditingNote(note);
      setNoteSubject(note.note_subject || "");
      setNoteScope(noteScopeValue || "__none__");
      setNoteCategory(noteCategoryValue || "__none__");
      setNoteSiteId(note.site_id != null ? String(note.site_id) : resolvedDefaultSiteId);
      setNoteText(note.note_text || "");
      return;
    }
    setEditingNote(null);
    setNoteSubject("");
    setNoteScope("__none__");
    setNoteCategory("__none__");
    setNoteSiteId(resolvedDefaultSiteId);
    setNoteText("");
  }, [resolvedDefaultSiteId]);

  const openAddNote = useCallback(() => {
    resetNoteForm(null);
    setAddNoteError("");
    setAddNoteOpen(true);
  }, [resetNoteForm]);

  const openEditNote = useCallback((note: JobNote) => {
    resetNoteForm(note);
    setAddNoteError("");
    setAddNoteOpen(true);
  }, [resetNoteForm]);

  useEffect(() => {
    if (!addNoteOpen || editingNote) return;
    if (noteSiteId !== "__none__") return;
    setNoteSiteId(resolvedDefaultSiteId);
  }, [addNoteOpen, editingNote, noteSiteId, resolvedDefaultSiteId]);

  const handleSaveNote = useCallback(async () => {
    if (!noteText.trim()) return;
    setAddNoteLoading(true);
    setAddNoteError("");
    try {
      const selectedSiteId = noteSiteId && noteSiteId !== "__none__" ? Number(noteSiteId) : null;
      const selectedSite = siteOptions.find((site) => String(site.site_id) === String(selectedSiteId));
      const payload = {
        message_text: noteText.trim(),
        subject: noteSubject.trim() || null,
        channel: "note",
        direction: "internal",
        scope: noteScope !== "__none__" ? noteScope : null,
        category: noteCategory !== "__none__" ? noteCategory : null,
        site_id: selectedSiteId,
        site_name: selectedSite?.site_name || null,
      };

      const res = editingNote?.communication_id
        ? await fetch(`${baseUrl}/jobs/${jobId}/communications/${editingNote.communication_id}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`${baseUrl}/jobs/${jobId}/communications`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { detail?: string }).detail || `Error ${res.status}`);
      }
      setAddNoteOpen(false);
      setEditingNote(null);
      setNoteSubject("");
      setNoteScope("__none__");
      setNoteCategory("__none__");
      setNoteSiteId(resolvedDefaultSiteId);
      setNoteText("");
      void loadNotes();
    } catch (err) {
      setAddNoteError((err as Error).message);
    } finally {
      setAddNoteLoading(false);
    }
  }, [
    baseUrl,
    editingNote?.communication_id,
    jobId,
    loadNotes,
    noteCategory,
    noteScope,
    noteSiteId,
    noteSubject,
    noteText,
    resolvedDefaultSiteId,
    siteOptions,
  ]);

  const handleArchiveNote = useCallback(
    (note: JobNote) => {
      if (!note.communication_id) return;
      setPendingArchiveNote(note);
    },
    [],
  );

  const doArchiveNote = useCallback(async () => {
    const note = pendingArchiveNote;
    setPendingArchiveNote(null);
    if (!note || !note.communication_id) return;
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/communications/${note.communication_id}/archive`, {
        method: "PATCH",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { detail?: string }).detail || `Error ${res.status}`);
      }
      void loadNotes();
    } catch (err) {
      setAddNoteError((err as Error).message);
    }
  }, [baseUrl, jobId, loadNotes, pendingArchiveNote]);

  const filteredNotes = useMemo(() => {
    return (summary?.items || []).filter((item) => {
      if (sourceFilter !== "All" && item.source_type !== sourceFilter) return false;
      if (archiveFilter === "Active" && item.archived) return false;
      if (archiveFilter === "Archived" && !item.archived) return false;
      if (scopeFilter !== "All" && item.scope !== scopeFilter) return false;
      if (siteFilter !== "All" && String(item.site_id ?? "") !== siteFilter) return false;
      if (authorFilter !== "All" && (item.note_updated_by || "") !== authorFilter) return false;
      if (search.trim()) {
        return matchesSearch(search, [
          item.source_label,
          item.note_subject,
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
  }, [archiveFilter, authorFilter, search, siteFilter, scopeFilter, sourceFilter, summary]);

  const groupedNotes = useMemo<JobNoteGroup[]>(() => {
    const groupMeta: Array<Pick<JobNoteGroup, "key" | "label" | "description">> = [
      {
        key: "client-note",
        label: "Client Notes",
        description: "Client-level notes linked to this job.",
      },
      {
        key: "job-communication",
        label: "Job Notes",
        description: "Notes captured from job communications and job-level updates.",
      },
      {
        key: "job-row",
        label: "Job Row Notes",
        description: "Notes attached to individual job rows and line items.",
      },
    ];

    return groupMeta
      .map((group) => ({
        ...group,
        items: filteredNotes.filter((item) => item.source_type === group.key),
      }))
      .filter((group) => group.items.length > 0);
  }, [filteredNotes]);

  const noteTimestampLine = useCallback((item: JobNote) => {
    const createdAt = item.note_created_at || item.row_created_at || item.note_updated_at || item.row_updated_at;
    const edits = (item.note_edit_timestamps || []).filter(Boolean);
    const parts = [
      createdAt ? `Created ${formatTimestamp(createdAt)}` : null,
      edits.length > 0 ? `Edits ${edits.map((ts) => formatTimestamp(ts)).join(", ")}` : null,
    ].filter(Boolean);
    return parts.join(" • ");
  }, []);

  const toggleSection = useCallback((key: string) => {
    setExpandedSections((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }, []);

  const renderNotesTable = useCallback((items: JobNote[]) => {
    return (
      <div className="w-full">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="w-[24%] p-2">Source</th>
              <th className="w-[28%] p-2">Where</th>
              <th className="w-[28%] p-2">Note</th>
              <th className="w-[10%] p-2">Updated By</th>
              <th className="w-[10%] p-2">Updated At</th>
              <th className="w-[10%] p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.note_id} className={`border-b align-top ${item.archived ? "bg-muted/30" : ""}`}>
                <td className="p-2 align-top break-words">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-medium">{item.source_label}</div>
                    {item.archived ? (
                      <Badge variant="destructive" className="text-[10px] uppercase tracking-[0.16em]">
                        Archived
                      </Badge>
                    ) : null}
                  </div>
                  {item.note_subject ? <div className="mt-1 text-xs font-medium text-slate-700">{item.note_subject}</div> : null}
                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.job_number ? `Job ${item.job_number}` : item.job_id ? `Job ${item.job_id}` : "Job"}
                  </div>
                </td>
                <td className="p-2 align-top break-words">
                  <div className="font-medium">{item.note_location}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge variant="outline" className="bg-white text-[10px] uppercase tracking-[0.14em]">
                      Scope: {item.scope || "None"}
                    </Badge>
                    <Badge variant="outline" className="bg-white text-[10px] uppercase tracking-[0.14em]">
                      Category: {item.category || "None"}
                    </Badge>
                    <Badge variant="outline" className="bg-white text-[10px] uppercase tracking-[0.14em]">
                      Site: {item.site_name || "No site"}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.row_id ? `Row ${item.row_id}` : item.job_id ? `Job ${item.job_id}` : "Job"}
                  </div>
                </td>
                <td className="p-2 align-top whitespace-pre-wrap break-words">
                  <div>{item.note_text}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {noteTimestampLine(item) || "No timestamp available"}
                  </div>
                </td>
                <td className="p-2 align-top break-words">{item.note_updated_by || "-"}</td>
                <td className="p-2 align-top">{formatTimestamp(item.note_updated_at || item.row_updated_at)}</td>
                <td className="p-2 align-top">
                  {item.source_type === "job-communication" && !item.archived ? (
                    <div className="flex flex-col gap-2">
                      <Button variant="outline" size="sm" onClick={() => openEditNote(item)}>
                        Edit
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => void handleArchiveNote(item)}>
                        Archive
                      </Button>
                    </div>
                  ) : item.archived ? (
                    <span className="text-xs text-muted-foreground">Archived</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Read only</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }, [handleArchiveNote, openEditNote]);

  return (
    <div className="space-y-6">
      <ConfirmDialog
        open={pendingArchiveNote !== null}
        onOpenChange={(open) => { if (!open) setPendingArchiveNote(null); }}
        title="Archive note"
        description="Archive this note? It will be removed from the active notes list."
        confirmLabel="Archive"
        onConfirm={() => void doArchiveNote()}
      />
      <Dialog
        open={addNoteOpen}
        onOpenChange={(open) => {
          setAddNoteOpen(open);
          if (!open) {
            setEditingNote(null);
            setNoteSubject("");
            setNoteScope("__none__");
            setNoteCategory("__none__");
            setNoteSiteId("__none__");
            setNoteText("");
            setAddNoteError("");
          }
        }}
      >
        <DialogContent className="w-[98vw] max-w-7xl">
          <DialogHeader>
            <DialogTitle>{editingNote ? "Edit Job Note" : "Add Job Note"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5 md:col-span-3">
                <Label htmlFor="newNoteSubject">Subject <span className="text-muted-foreground">(optional)</span></Label>
                <Input
                  id="newNoteSubject"
                  value={noteSubject}
                  onChange={(e) => setNoteSubject(e.target.value)}
                  placeholder="Brief subject..."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="newNoteScope">Scope</Label>
                <Select value={noteScope} onValueChange={setNoteScope}>
                  <SelectTrigger id="newNoteScope" className="w-full">
                    <SelectValue placeholder="No scope" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No scope</SelectItem>
                    {noteScopeOptions.map((scope) => (
                      <SelectItem key={scope} value={scope}>
                        {scope}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="newNoteCategory">Category</Label>
                <Select value={noteCategory} onValueChange={setNoteCategory}>
                  <SelectTrigger id="newNoteCategory" className="w-full">
                    <SelectValue placeholder="No category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No category</SelectItem>
                    {noteCategoryOptions.map((category) => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="newNoteSite">Site</Label>
                <Select value={noteSiteId} onValueChange={setNoteSiteId}>
                  <SelectTrigger id="newNoteSite" className="w-full">
                    <SelectValue placeholder="No site" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No site</SelectItem>
                    {noteSiteOptions.map((site) => (
                      <SelectItem key={site.siteId} value={site.siteId}>
                        {site.siteName}
                        {siteOptions.find((opt) => String(opt.site_id) === site.siteId)?.is_registered_office ? " (Registered Office)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 md:col-span-3">
                <Label htmlFor="newNoteText">Note <span className="text-destructive">*</span></Label>
                <Textarea
                  id="newNoteText"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Enter note..."
                  rows={8}
                />
              </div>
            </div>
            {addNoteError && <p className="text-sm text-destructive">{addNoteError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddNoteOpen(false)} disabled={addNoteLoading}>
              Cancel
            </Button>
            <Button onClick={handleSaveNote} disabled={addNoteLoading || !noteText.trim()}>
              {addNoteLoading ? "Saving..." : editingNote ? "Update Note" : "Save Note"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Job Notes</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Job communications and job row notes, with row context, author, and timestamp.
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={openAddNote}>Add Note</Button>
              <Button variant="outline" asChild>
                <Link href={`/jobs/${jobId}/data-entry`}>Open Data Entry</Link>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem_12rem_12rem_12rem_12rem]">
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
              <Label htmlFor="noteArchiveFilter">Archive</Label>
              <Select value={archiveFilter} onValueChange={setArchiveFilter}>
                <SelectTrigger id="noteArchiveFilter" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Archived">Archived</SelectItem>
                  <SelectItem value="All">All</SelectItem>
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
                setArchiveFilter("Active");
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
