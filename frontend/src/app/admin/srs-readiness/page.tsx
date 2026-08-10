"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Edit2, Plus, Save } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

function apiBaseUrl() {
  return "/api/backend";
}

type SrsQuestion = {
  question_id: number;
  question_code: string;
  section: string;
  theme?: string | null;
  question_text: string;
  evidence_examples?: string | null;
  is_active: boolean;
  is_custom: boolean;
  sort_order: number;
};

const DEFAULT_SECTIONS = ["Governance", "Strategy", "Risk Management", "Metrics & Targets"];

export default function AdminSrsReadinessPage() {
  const [items, setItems] = useState<SrsQuestion[]>([]);
  const [sections, setSections] = useState<string[]>(DEFAULT_SECTIONS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sectionFilter, setSectionFilter] = useState("__all__");
  const [statusFilter, setStatusFilter] = useState("__all__");

  const [section, setSection] = useState(DEFAULT_SECTIONS[0]);
  const [theme, setTheme] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [evidenceExamples, setEvidenceExamples] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const baseUrl = apiBaseUrl();
      const res = await fetch(`${baseUrl}/admin/srs-readiness-questions?include_inactive=true`, {
        credentials: "include",
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `Failed to load SRS readiness questions (${res.status})`);
      }
      const payload = (await res.json()) as { items?: SrsQuestion[]; sections?: string[] };
      setItems(Array.isArray(payload.items) ? payload.items : []);
      if (Array.isArray(payload.sections) && payload.sections.length) {
        setSections(payload.sections);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load SRS readiness questions");
    } finally {
      setLoading(false);
    }
  }

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (sectionFilter !== "__all__" && item.section !== sectionFilter) return false;
      if (statusFilter === "active" && !item.is_active) return false;
      if (statusFilter === "inactive" && item.is_active) return false;
      if (!q) return true;
      const target = `${item.question_text} ${item.theme || ""} ${item.evidence_examples || ""}`.toLowerCase();
      return target.includes(q);
    });
  }, [items, searchQuery, sectionFilter, statusFilter]);

  function resetForm() {
    setSection(sections[0] || DEFAULT_SECTIONS[0]);
    setTheme("");
    setQuestionText("");
    setEvidenceExamples("");
    setSortOrder("0");
    setIsActive(true);
    setEditingId(null);
  }

  function startCreate() {
    resetForm();
    setShowForm(true);
    setStatus("");
  }

  function startEdit(item: SrsQuestion) {
    setSection(item.section);
    setTheme(item.theme || "");
    setQuestionText(item.question_text);
    setEvidenceExamples(item.evidence_examples || "");
    setSortOrder(String(item.sort_order || 0));
    setIsActive(item.is_active);
    setEditingId(item.question_id);
    setShowForm(true);
    setStatus("");
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!questionText.trim()) {
      setStatus("Question text is required.");
      return;
    }

    const payload = {
      section,
      theme: theme.trim() || null,
      question_text: questionText.trim(),
      evidence_examples: evidenceExamples.trim() || null,
      sort_order: Number(sortOrder || 0) || 0,
      is_active: isActive,
    };

    try {
      setStatus(editingId ? "Updating question..." : "Creating question...");
      const baseUrl = apiBaseUrl();
      const res = await fetch(
        editingId ? `${baseUrl}/admin/srs-readiness-questions/${editingId}` : `${baseUrl}/admin/srs-readiness-questions`,
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `Failed to save question (${res.status})`);
      }
      await loadData();
      setStatus(editingId ? "Question updated." : "Question created.");
      setShowForm(false);
      resetForm();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to save question");
    }
  }

  async function handleToggleActive(item: SrsQuestion) {
    const baseUrl = apiBaseUrl();
    try {
      setStatus(item.is_active ? "Disabling question..." : "Enabling question...");
      const res = await fetch(`${baseUrl}/admin/srs-readiness-questions/${item.question_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          section: item.section,
          theme: item.theme || null,
          question_text: item.question_text,
          evidence_examples: item.evidence_examples || null,
          sort_order: item.sort_order,
          is_active: !item.is_active,
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `Failed to update question (${res.status})`);
      }
      await loadData();
      setStatus(item.is_active ? "Question disabled." : "Question enabled.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to update question");
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-bold" style={{ color: "#F26624" }}>
              SRS Readiness Questions
            </h1>
            <p className="text-muted-foreground">
              Manage the UK SRS Readiness assessment question bank. Questions are grouped into four sections
              (Governance, Strategy, Risk Management, Metrics &amp; Targets) and scored 1-3 per client on the
              client&apos;s SRS Readiness tab.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href="/admin">Back to Admin</Link>
            </Button>
            <Button onClick={startCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Add Question
            </Button>
          </div>
        </div>

        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px_220px]">
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search questions..."
              />
              <Select value={sectionFilter} onValueChange={setSectionFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by section" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All sections</SelectItem>
                  {sections.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All statuses</SelectItem>
                  <SelectItem value="active">Active only</SelectItem>
                  <SelectItem value="inactive">Inactive only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {status ? <div className="mt-3 text-sm text-muted-foreground">{status}</div> : null}
            {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
          </CardContent>
        </Card>

        {showForm ? (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>{editingId ? "Edit Question" : "New Question"}</CardTitle>
              <CardDescription>
                Only active questions are scored on a client&apos;s SRS Readiness tab and shown in the portal.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleSave}>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="section">Section</Label>
                    <Select value={section} onValueChange={setSection}>
                      <SelectTrigger id="section">
                        <SelectValue placeholder="Select section" />
                      </SelectTrigger>
                      <SelectContent>
                        {sections.map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="theme">Theme</Label>
                    <Input
                      id="theme"
                      value={theme}
                      onChange={(event) => setTheme(event.target.value)}
                      placeholder="e.g. Leadership oversight"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="questionText">Question</Label>
                  <Textarea
                    id="questionText"
                    rows={3}
                    value={questionText}
                    onChange={(event) => setQuestionText(event.target.value)}
                    placeholder="Evidence-based question, e.g. Is there a named senior leader with accountability for sustainability-related decisions?"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="evidenceExamples">Evidence Examples</Label>
                  <Textarea
                    id="evidenceExamples"
                    rows={2}
                    value={evidenceExamples}
                    onChange={(event) => setEvidenceExamples(event.target.value)}
                    placeholder="e.g. Board papers, leadership terms of reference, named role profile."
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="sortOrder">Sort Order</Label>
                    <Input
                      id="sortOrder"
                      type="number"
                      value={sortOrder}
                      onChange={(event) => setSortOrder(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="activeStatus">Status</Label>
                    <Select value={isActive ? "active" : "inactive"} onValueChange={(value) => setIsActive(value === "active")}>
                      <SelectTrigger id="activeStatus">
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="submit">
                    <Save className="mr-2 h-4 w-4" />
                    {editingId ? "Update Question" : "Create Question"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      resetForm();
                      setShowForm(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Assessment Question Bank</CardTitle>
            <CardDescription>
              The 24 standard UK SRS Readiness questions are seeded automatically. Disable any that don&apos;t
              apply, or add additional criteria of your own.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading questions...</div>
            ) : filteredItems.length === 0 ? (
              <div className="rounded-md border border-dashed p-8 text-sm text-muted-foreground">
                No questions match the current filters.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Section</TableHead>
                    <TableHead>Question</TableHead>
                    <TableHead>Theme</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item) => (
                    <TableRow key={item.question_id}>
                      <TableCell>
                        <Badge variant="outline">{item.section}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium max-w-[440px]">{item.question_text}</span>
                          {item.is_custom ? (
                            <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 text-xs">Custom</Badge>
                          ) : null}
                        </div>
                        {item.evidence_examples ? (
                          <div className="max-w-[440px] text-xs text-muted-foreground">{item.evidence_examples}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>{item.theme || "-"}</TableCell>
                      <TableCell>
                        <Badge variant={item.is_active ? "secondary" : "outline"}>
                          {item.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => startEdit(item)}>
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleToggleActive(item)}>
                            {item.is_active ? "Disable" : "Enable"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
