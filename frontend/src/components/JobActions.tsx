"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Plus, Save, Sparkles, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type TermOption = {
  value: string;
  label: string;
  hint: string;
};

type SuggestedActionOption = {
  action_option_id: number;
  action_name: string;
  description?: string | null;
  action_term: string;
  action_term_label?: string;
  action_term_hint?: string;
  action_category?: string | null;
  scope_focus?: string | null;
  sort_order: number;
  is_active: boolean;
  is_default?: boolean;
};

type JobActionItem = {
  job_action_id?: number;
  action_option_id?: number | null;
  action_name: string;
  description?: string | null;
  action_term: string;
  action_term_label?: string;
  action_term_hint?: string;
  action_category?: string | null;
  scope_focus?: string | null;
  is_custom: boolean;
  sort_order: number;
};

type JobActionsResponse = {
  items?: JobActionItem[];
  suggested_options?: SuggestedActionOption[];
  term_options?: TermOption[];
  term_counts?: Record<string, number>;
};

type CopySourceJob = {
  job_id: number;
  job_number: string;
  title: string;
  reporting_year: number | null;
  status: string;
  action_count: number;
};

type JobActionsProps = {
  jobId: number;
  baseUrl?: string;
  onOpenReportNew?: () => void;
  isActive?: boolean;
};

function blankCustomAction(termOptions: TermOption[], sortOrder: number): JobActionItem {
  const defaultTerm = termOptions[1]?.value || termOptions[0]?.value || "medium";
  return {
    action_name: "",
    description: "",
    action_term: defaultTerm,
    action_term_label: termOptions.find((item) => item.value === defaultTerm)?.label || "Medium term",
    action_term_hint: termOptions.find((item) => item.value === defaultTerm)?.hint || "1-3 years",
    action_category: "",
    scope_focus: "",
    is_custom: true,
    sort_order: sortOrder,
  };
}

function termBadgeVariant(term: string): string {
  const normalized = String(term || "").trim().toLowerCase();
  if (normalized === "short") return "bg-green-100 text-green-800 border-green-200";
  if (normalized === "long") return "bg-sky-100 text-sky-800 border-sky-200";
  return "bg-amber-100 text-amber-800 border-amber-200";
}

export default function JobActions({
  jobId,
  baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "",
  onOpenReportNew,
  isActive = true,
}: JobActionsProps) {
  const [items, setItems] = useState<JobActionItem[]>([]);
  const [suggestedOptions, setSuggestedOptions] = useState<SuggestedActionOption[]>([]);
  const [termOptions, setTermOptions] = useState<TermOption[]>([
    { value: "short", label: "Short term", hint: "0-12 months" },
    { value: "medium", label: "Medium term", hint: "1-3 years" },
    { value: "long", label: "Long term", hint: "3+ years" },
  ]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const [copyOpen, setCopyOpen] = useState(false);
  const [copySourceJobs, setCopySourceJobs] = useState<CopySourceJob[]>([]);
  const [copySourceJobsLoading, setCopySourceJobsLoading] = useState(false);
  const [selectedCopySourceId, setSelectedCopySourceId] = useState<string>("");
  const [copyPreviewItems, setCopyPreviewItems] = useState<JobActionItem[]>([]);
  const [copyPreviewLoading, setCopyPreviewLoading] = useState(false);
  const [copyChecked, setCopyChecked] = useState<Set<number>>(new Set());

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/report-actions`, {
        credentials: "include",
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `Failed to load actions (${res.status})`);
      }
      const payload = (await res.json()) as JobActionsResponse;
      setItems(Array.isArray(payload.items) ? payload.items : []);
      setSuggestedOptions(Array.isArray(payload.suggested_options) ? payload.suggested_options : []);
      if (Array.isArray(payload.term_options) && payload.term_options.length) {
        setTermOptions(payload.term_options);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load actions");
    } finally {
      setLoading(false);
    }
  }, [baseUrl, jobId]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    void loadData();
  }, [isActive, loadData]);

  const selectedOptionIds = useMemo(
    () =>
      new Set(
        items
          .map((item) => item.action_option_id)
          .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      ),
    [items]
  );

  const filteredSuggestions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return suggestedOptions.filter((option) => {
      if (selectedOptionIds.has(option.action_option_id)) return false;
      if (!q) return true;
      const target = `${option.action_name} ${option.description || ""} ${option.action_category || ""} ${option.scope_focus || ""}`.toLowerCase();
      return target.includes(q);
    });
  }, [searchQuery, selectedOptionIds, suggestedOptions]);

  const termCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const option of termOptions) counts[option.value] = 0;
    for (const item of items) {
      counts[item.action_term] = (counts[item.action_term] || 0) + 1;
    }
    return counts;
  }, [items, termOptions]);

  function addSuggestedAction(option: SuggestedActionOption) {
    if (selectedOptionIds.has(option.action_option_id)) return;
    setItems((prev) => [
      ...prev,
      {
        action_option_id: option.action_option_id,
        action_name: option.action_name,
        description: option.description || "",
        action_term: option.action_term,
        action_term_label: option.action_term_label,
        action_term_hint: option.action_term_hint,
        action_category: option.action_category || "",
        scope_focus: option.scope_focus || "",
        is_custom: false,
        sort_order: (prev.length + 1) * 10,
      },
    ]);
    setStatus("");
  }

  function addCustomAction() {
    setItems((prev) => [...prev, blankCustomAction(termOptions, (prev.length + 1) * 10)]);
    setStatus("");
  }

  function updateItem(index: number, patch: Partial<JobActionItem>) {
    setItems((prev) =>
      prev.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const next = { ...item, ...patch };
        if (patch.action_term) {
          const termMeta = termOptions.find((option) => option.value === patch.action_term);
          next.action_term_label = termMeta?.label || next.action_term_label;
          next.action_term_hint = termMeta?.hint || next.action_term_hint;
        }
        return next;
      })
    );
    setStatus("");
  }

  function moveItem(index: number, direction: -1 | 1) {
    setItems((prev) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(nextIndex, 0, moved);
      return copy.map((item, idx) => ({ ...item, sort_order: (idx + 1) * 10 }));
    });
    setStatus("");
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, itemIndex) => itemIndex !== index).map((item, idx) => ({ ...item, sort_order: (idx + 1) * 10 })));
    setStatus("");
  }

  const openCopyDialog = useCallback(async () => {
    setCopyOpen(true);
    setSelectedCopySourceId("");
    setCopyPreviewItems([]);
    setCopyChecked(new Set());
    setCopySourceJobsLoading(true);
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/report-actions/available-sources`, { credentials: "include" });
      const data = await res.json() as { items: CopySourceJob[] };
      setCopySourceJobs(Array.isArray(data.items) ? data.items : []);
    } catch {
      setCopySourceJobs([]);
    } finally {
      setCopySourceJobsLoading(false);
    }
  }, [baseUrl, jobId]);

  const loadCopyPreview = useCallback(async (sourceId: string) => {
    setSelectedCopySourceId(sourceId);
    if (!sourceId) { setCopyPreviewItems([]); setCopyChecked(new Set()); return; }
    setCopyPreviewLoading(true);
    try {
      const res = await fetch(`${baseUrl}/jobs/${sourceId}/report-actions`, { credentials: "include" });
      const data = await res.json() as JobActionsResponse;
      const preview = Array.isArray(data.items) ? data.items : [];
      setCopyPreviewItems(preview);
      setCopyChecked(new Set(preview.map((_, i) => i)));
    } catch {
      setCopyPreviewItems([]);
      setCopyChecked(new Set());
    } finally {
      setCopyPreviewLoading(false);
    }
  }, [baseUrl]);

  function toggleCopyCheck(index: number) {
    setCopyChecked((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  }

  function applyImport() {
    const existingNames = new Set(items.map((item) => item.action_name.trim().toLowerCase()));
    const toAdd = copyPreviewItems
      .filter((_, i) => copyChecked.has(i))
      .filter((item) => !existingNames.has(item.action_name.trim().toLowerCase()))
      .map((item, i) => ({
        ...item,
        job_action_id: undefined,
        is_custom: true,
        sort_order: (items.length + i + 1) * 10,
      }));
    if (toAdd.length > 0) {
      setItems((prev) => [...prev, ...toAdd]);
      setStatus(`${toAdd.length} action${toAdd.length === 1 ? "" : "s"} added. Save to keep changes.`);
    }
    setCopyOpen(false);
  }

  function handleImportDefaults() {
    const defaultOptions = suggestedOptions.filter((option) => option.is_default && !selectedOptionIds.has(option.action_option_id));
    if (defaultOptions.length === 0) {
      setStatus("No default actions to import (all defaults are already in the plan).");
      return;
    }
    setItems((prev) => [
      ...prev,
      ...defaultOptions.map((option, i) => ({
        action_option_id: option.action_option_id,
        action_name: option.action_name,
        description: option.description || "",
        action_term: option.action_term,
        action_term_label: option.action_term_label,
        action_term_hint: option.action_term_hint,
        action_category: option.action_category || "",
        scope_focus: option.scope_focus || "",
        is_custom: false,
        sort_order: (prev.length + i + 1) * 10,
      })),
    ]);
    setStatus(`${defaultOptions.length} default action${defaultOptions.length === 1 ? "" : "s"} added. Save to keep changes.`);
  }

  async function saveActions() {
    const trimmedItems = items.map((item, index) => ({
      ...item,
      action_name: item.action_name.trim(),
      description: item.description?.trim() || "",
      action_category: item.action_category?.trim() || "",
      scope_focus: item.scope_focus?.trim() || "",
      sort_order: (index + 1) * 10,
    }));

    const firstBlank = trimmedItems.find((item) => !item.action_name);
    if (firstBlank) {
      setStatus("Every selected action needs a name before saving.");
      return;
    }

    setSaving(true);
    setStatus("Saving actions...");
    setError("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/report-actions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          items: trimmedItems.map((item) => ({
            action_option_id: item.action_option_id ?? null,
            action_name: item.action_name,
            description: item.description || null,
            action_term: item.action_term,
            action_category: item.action_category || null,
            scope_focus: item.scope_focus || null,
            is_custom: item.is_custom,
            sort_order: item.sort_order,
          })),
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `Failed to save actions (${res.status})`);
      }
      const payload = (await res.json()) as JobActionsResponse & { ok?: boolean };
      setItems(Array.isArray(payload.items) ? payload.items : []);
      setSuggestedOptions(Array.isArray(payload.suggested_options) ? payload.suggested_options : []);
      if (Array.isArray(payload.term_options) && payload.term_options.length) {
        setTermOptions(payload.term_options);
      }
      setStatus("Actions saved. They will now feed into the report actions section.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save actions");
      setStatus("");
    } finally {
      setSaving(false);
    }
  }

  const allChecked = copyPreviewItems.length > 0 && copyChecked.size === copyPreviewItems.length;
  const existingNamesForPreview = useMemo(
    () => new Set(items.map((item) => item.action_name.trim().toLowerCase())),
    [items]
  );

  return (
    <div className="space-y-6">
      <Dialog open={copyOpen} onOpenChange={setCopyOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Copy Actions from Another Job</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Source Job</Label>
              {copySourceJobsLoading ? (
                <p className="text-sm text-muted-foreground">Loading jobs...</p>
              ) : copySourceJobs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No other jobs with actions found for this client.</p>
              ) : (
                <Select value={selectedCopySourceId} onValueChange={(v) => void loadCopyPreview(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a job to copy actions from..." />
                  </SelectTrigger>
                  <SelectContent>
                    {copySourceJobs.map((job) => (
                      <SelectItem key={job.job_id} value={String(job.job_id)}>
                        {job.job_number ? `${job.job_number} – ` : ""}{job.title || `Job ${job.job_id}`}
                        {job.reporting_year ? ` (${job.reporting_year})` : ""}
                        {" "}&middot; {job.action_count} action{job.action_count === 1 ? "" : "s"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {selectedCopySourceId && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Actions to copy</Label>
                  {copyPreviewItems.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setCopyChecked(allChecked ? new Set() : new Set(copyPreviewItems.map((_, i) => i)))}
                    >
                      {allChecked ? "Deselect all" : "Select all"}
                    </Button>
                  )}
                </div>
                {copyPreviewLoading ? (
                  <p className="text-sm text-muted-foreground">Loading actions...</p>
                ) : copyPreviewItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No actions in selected job.</p>
                ) : (
                  <div className="max-h-80 overflow-y-auto space-y-2 rounded-md border p-3">
                    {copyPreviewItems.map((item, i) => {
                      const alreadyExists = existingNamesForPreview.has(item.action_name.trim().toLowerCase());
                      return (
                        <div key={i} className={`flex items-start gap-3 rounded-md p-2 ${alreadyExists ? "bg-muted/50" : ""}`}>
                          <input
                            type="checkbox"
                            id={`copy-item-${i}`}
                            checked={copyChecked.has(i)}
                            onChange={() => toggleCopyCheck(i)}
                            disabled={alreadyExists}
                            className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                          />
                          <div className="flex-1 min-w-0">
                            <label htmlFor={`copy-item-${i}`} className={`text-sm font-medium cursor-pointer ${alreadyExists ? "text-muted-foreground" : ""}`}>
                              {item.action_name}
                              {alreadyExists && <span className="ml-2 text-xs font-normal">(already in plan)</span>}
                            </label>
                            <div className="mt-0.5 flex flex-wrap gap-1">
                              <Badge variant="outline" className={`text-xs ${termBadgeVariant(item.action_term)}`}>
                                {item.action_term_label || item.action_term}
                              </Badge>
                              {item.action_category && <Badge variant="secondary" className="text-xs">{item.action_category}</Badge>}
                            </div>
                            {item.description && <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{item.description}</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {copyChecked.size} of {copyPreviewItems.length} selected. Actions already in this plan are skipped automatically.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyOpen(false)}>Cancel</Button>
            <Button
              onClick={applyImport}
              disabled={copyChecked.size === 0 || !selectedCopySourceId}
            >
              Add {copyChecked.size > 0 ? copyChecked.size : ""} Action{copyChecked.size === 1 ? "" : "s"} to Plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <CardTitle>Actions</CardTitle>
            <CardDescription>
              Build a report-ready action plan by selecting suggested actions from the shared library or adding custom actions for this job.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={handleImportDefaults}>
              <Sparkles className="mr-2 h-4 w-4" />
              Import Default Actions
            </Button>
            <Button variant="outline" onClick={() => void openCopyDialog()}>
              <Copy className="mr-2 h-4 w-4" />
              Copy from Another Job
            </Button>
            <Button variant="outline" onClick={addCustomAction}>
              <Plus className="mr-2 h-4 w-4" />
              Add Custom Action
            </Button>
            <Button onClick={saveActions} disabled={saving || loading}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? "Saving..." : "Save Actions"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            The saved actions below are imported directly into the report&apos;s Actions section. Suggested actions can be edited per job after selection.
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {termOptions.map((option) => (
              <div key={option.value} className="rounded-lg border bg-background p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{option.label}</div>
                <div className="mt-2 text-3xl font-semibold">{termCounts[option.value] || 0}</div>
                <div className="text-sm text-muted-foreground">{option.hint}</div>
              </div>
            ))}
          </div>

          {status ? <div className="text-sm text-muted-foreground">{status}</div> : null}
          {error ? <div className="text-sm text-red-600">{error}</div> : null}
          {onOpenReportNew ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={onOpenReportNew}>
                Continue to Draft Content
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Selected Actions</CardTitle>
          <CardDescription>
            Arrange and refine the actions that should appear in this job&apos;s report.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading actions...</div>
          ) : items.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
              No actions selected yet. Add suggested actions from the library below or create a custom action.
            </div>
          ) : (
            items.map((item, index) => (
              <div key={`${item.job_action_id || "new"}-${index}`} className="rounded-lg border p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={termBadgeVariant(item.action_term)}>
                      {item.action_term_label || item.action_term || "Medium term"}
                    </Badge>
                    <Badge variant="outline">{item.is_custom ? "Custom" : "Suggested"}</Badge>
                    {item.scope_focus ? <Badge variant="secondary">{item.scope_focus}</Badge> : null}
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => moveItem(index, -1)} disabled={index === 0}>
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => moveItem(index, 1)} disabled={index === items.length - 1}>
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeItem(index)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Action Name</Label>
                    <Input
                      value={item.action_name}
                      onChange={(event) => updateItem(index, { action_name: event.target.value })}
                      placeholder="e.g. Switch to renewable electricity tariff"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Action Term</Label>
                    <Select value={item.action_term} onValueChange={(value) => updateItem(index, { action_term: value })}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select action term" />
                      </SelectTrigger>
                      <SelectContent>
                        {termOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label} - {option.hint}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Input
                      value={item.action_category || ""}
                      onChange={(event) => updateItem(index, { action_category: event.target.value })}
                      placeholder="e.g. Energy, Travel, Procurement"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Scope / Focus</Label>
                    <Input
                      value={item.scope_focus || ""}
                      onChange={(event) => updateItem(index, { scope_focus: event.target.value })}
                      placeholder="e.g. Scope 2, Scope 3, All scopes"
                    />
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    value={item.description || ""}
                    onChange={(event) => updateItem(index, { description: event.target.value })}
                    placeholder="Describe what the client plans to do and how it supports emissions reduction."
                    rows={4}
                  />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="space-y-1">
              <CardTitle>Suggested Actions Library</CardTitle>
              <CardDescription>
                Start with reusable admin-managed actions, then tailor them for this job after adding them.
              </CardDescription>
            </div>
            <div className="w-full md:w-80">
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search suggested actions..."
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading suggestions...</div>
          ) : filteredSuggestions.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
              No more suggested actions match the current filter.
            </div>
          ) : (
            filteredSuggestions.map((option) => (
              <div key={option.action_option_id} className="rounded-lg border p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium">{option.action_name}</div>
                      <Badge variant="outline" className={termBadgeVariant(option.action_term)}>
                        {option.action_term_label || option.action_term}
                      </Badge>
                      {option.action_category ? <Badge variant="secondary">{option.action_category}</Badge> : null}
                    </div>
                    {option.scope_focus ? (
                      <div className="text-xs text-muted-foreground">{option.scope_focus}</div>
                    ) : null}
                    {option.description ? (
                      <div className="text-sm text-muted-foreground">{option.description}</div>
                    ) : null}
                  </div>
                  <Button type="button" variant="outline" onClick={() => addSuggestedAction(option)}>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Add to Job
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
