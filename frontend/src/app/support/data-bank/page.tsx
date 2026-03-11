"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { hasAuthState } from "@/lib/auth-client";

type SubjectItem = {
  subject_id: number;
  name: string;
  is_active: boolean;
};

type DataCard = {
  card_id: number;
  subject_id: number | null;
  subject_name: string;
  category: string;
  country: string;
  reporting_year: number | null;
  title: string;
  content: string;
  source_type: string;
  source_url: string;
  reference_text: string;
  tags: string;
  created_by: string;
  created_at: string | null;
  updated_at: string | null;
  is_active: boolean;
};

type Suggestion = {
  title: string;
  content: string;
  category: string;
  country: string;
  reporting_year: number | null;
  source_url: string;
  reference_text: string;
};

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
}

function formatTs(ts: string | null): string {
  if (!ts) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

export default function DataBankPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const [mounted, setMounted] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [status, setStatus] = useState("");
  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [cards, setCards] = useState<DataCard[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [loadingCards, setLoadingCards] = useState(false);
  const [savingCard, setSavingCard] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const [newSubject, setNewSubject] = useState("");

  const [filterCategory, setFilterCategory] = useState("all");
  const [filterCountry, setFilterCountry] = useState("all");
  const [filterYear, setFilterYear] = useState("all");
  const [filterSubjectId, setFilterSubjectId] = useState("all");
  const [filterQuery, setFilterQuery] = useState("");

  const [subjectId, setSubjectId] = useState("");
  const [category, setCategory] = useState("");
  const [country, setCountry] = useState("");
  const [reportingYear, setReportingYear] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sourceType, setSourceType] = useState("Article");
  const [sourceUrl, setSourceUrl] = useState("");
  const [referenceText, setReferenceText] = useState("");
  const [tags, setTags] = useState("");

  const [aiSubjectId, setAiSubjectId] = useState("");
  const [aiCountry, setAiCountry] = useState("");
  const [aiCategory, setAiCategory] = useState("");
  const [aiYear, setAiYear] = useState("");
  const [aiIndustry, setAiIndustry] = useState("");
  const [aiQuery, setAiQuery] = useState("");

  useEffect(() => {
    setMounted(true);
    setAuthed(hasAuthState());
  }, []);

  const loadSubjects = useCallback(async () => {
    try {
      const res = await fetch(`${baseUrl}/databank/subjects`, { credentials: "include" });
      if (!res.ok) throw new Error(`Subjects failed: ${res.status}`);
      const json = await res.json();
      const items: SubjectItem[] = Array.isArray(json.items) ? json.items : [];
      setSubjects(items.filter((x) => x.is_active !== false));
      if (!subjectId && items[0]) setSubjectId(String(items[0].subject_id));
      if (!aiSubjectId && items[0]) setAiSubjectId(String(items[0].subject_id));
    } catch (e) {
      setStatus(`Error loading subjects: ${(e as Error).message}`);
    }
  }, [aiSubjectId, baseUrl, subjectId]);

  const loadCards = useCallback(async () => {
    setLoadingCards(true);
    try {
      const p = new URLSearchParams();
      if (filterCategory !== "all") p.set("category", filterCategory);
      if (filterCountry !== "all") p.set("country", filterCountry);
      if (filterYear !== "all") p.set("reporting_year", filterYear);
      if (filterSubjectId !== "all") p.set("subject_id", filterSubjectId);
      if (filterQuery.trim()) p.set("query", filterQuery.trim());
      const res = await fetch(`${baseUrl}/databank/cards?${p.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Cards failed: ${res.status}`);
      const json = await res.json();
      setCards(Array.isArray(json.items) ? json.items : []);
      const f = json.facets || {};
      setCategories(Array.isArray(f.categories) ? f.categories : []);
      setCountries(Array.isArray(f.countries) ? f.countries : []);
      setYears(Array.isArray(f.years) ? f.years : []);
    } catch (e) {
      setStatus(`Error loading data cards: ${(e as Error).message}`);
    } finally {
      setLoadingCards(false);
    }
  }, [baseUrl, filterCategory, filterCountry, filterQuery, filterSubjectId, filterYear]);

  useEffect(() => {
    if (authed) {
      void loadSubjects();
      void loadCards();
    }
  }, [authed, loadCards, loadSubjects]);

  async function addSubject() {
    if (!newSubject.trim()) return;
    try {
      const res = await fetch(`${baseUrl}/databank/subjects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: newSubject.trim() }),
      });
      if (!res.ok) throw new Error(`Subject create failed: ${res.status}`);
      setNewSubject("");
      await loadSubjects();
      setStatus("Subject saved.");
    } catch (e) {
      setStatus(`Error saving subject: ${(e as Error).message}`);
    }
  }

  async function addCard(cardOverride?: Partial<Suggestion>) {
    const payload = {
      subject_id: Number(subjectId || aiSubjectId),
      category: (cardOverride?.category ?? category).trim(),
      country: (cardOverride?.country ?? country).trim(),
      reporting_year: (cardOverride?.reporting_year ?? (reportingYear ? Number(reportingYear) : null)),
      title: (cardOverride?.title ?? title).trim(),
      content: (cardOverride?.content ?? content).trim(),
      source_type: sourceType,
      source_url: (cardOverride?.source_url ?? sourceUrl).trim(),
      reference_text: (cardOverride?.reference_text ?? referenceText).trim(),
      tags: tags.trim(),
    };
    if (!payload.subject_id || !payload.category || !payload.title || !payload.content) {
      setStatus("Subject, category, title and content are required.");
      return;
    }
    setSavingCard(true);
    try {
      const res = await fetch(`${baseUrl}/databank/cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Card create failed: ${res.status} ${txt}`);
      }
      setStatus("Data card saved.");
      if (!cardOverride) {
        setCategory("");
        setCountry("");
        setReportingYear("");
        setTitle("");
        setContent("");
        setSourceUrl("");
        setReferenceText("");
        setTags("");
      }
      await loadCards();
    } catch (e) {
      setStatus(`Error saving card: ${(e as Error).message}`);
    } finally {
      setSavingCard(false);
    }
  }

  async function archiveCard(cardId: number) {
    try {
      const res = await fetch(`${baseUrl}/databank/cards/${cardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ is_active: false }),
      });
      if (!res.ok) throw new Error(`Archive failed: ${res.status}`);
      await loadCards();
      setStatus("Card archived.");
    } catch (e) {
      setStatus(`Error archiving card: ${(e as Error).message}`);
    }
  }

  async function generateSuggestions() {
    if (!aiSubjectId && !aiQuery.trim()) {
      setStatus("Select a subject or provide a query.");
      return;
    }
    setSuggesting(true);
    setSuggestions([]);
    try {
      const selected = subjects.find((s) => String(s.subject_id) === aiSubjectId);
      const res = await fetch(`${baseUrl}/databank/suggestions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          subject: selected?.name || "",
          country: aiCountry.trim(),
          category: aiCategory.trim(),
          reporting_year: aiYear ? Number(aiYear) : null,
          industry: aiIndustry.trim(),
          query: aiQuery.trim(),
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Suggestion failed: ${res.status} ${txt}`);
      }
      const json = await res.json();
      setSuggestions(Array.isArray(json.items) ? json.items : []);
      setStatus(`Generated ${Array.isArray(json.items) ? json.items.length : 0} suggestions.`);
    } catch (e) {
      setStatus(`Error generating suggestions: ${(e as Error).message}`);
    } finally {
      setSuggesting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold" style={{ color: "#F26624" }}>Data Bank</h1>
            <p className="text-muted-foreground">
              Curated data cards for legislation, news, datasets and references used as additional AI context.
            </p>
          </div>
          <Button variant="secondary" asChild>
            <Link href="/support">Back to Support</Link>
          </Button>
        </div>

        {!mounted ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">Loading...</CardContent>
          </Card>
        ) : !authed ? (
          <Card>
            <CardHeader>
              <CardTitle>Access Restricted</CardTitle>
              <CardDescription>This area is available to team members only.</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="space-y-6">
            {status ? <div className="rounded-md bg-muted p-3 text-sm">{status}</div> : null}

            <Card>
              <CardHeader>
                <CardTitle>Subjects Lookup</CardTitle>
                <CardDescription>Manage subject taxonomy used on Data Cards.</CardDescription>
              </CardHeader>
              <CardContent className="flex gap-2">
                <Input
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  placeholder="Add new subject"
                />
                <Button onClick={addSubject}>Add Subject</Button>
              </CardContent>
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Add Data Card</CardTitle>
                  <CardDescription>Add links, references, and notes for AI grounding.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <Label>Subject</Label>
                    <Select value={subjectId} onValueChange={setSubjectId}>
                      <SelectTrigger><SelectValue placeholder="Select subject" /></SelectTrigger>
                      <SelectContent>
                        {subjects.map((s) => (
                          <SelectItem key={s.subject_id} value={String(s.subject_id)}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="space-y-2">
                      <Label>Category</Label>
                      <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Regulation" />
                    </div>
                    <div className="space-y-2">
                      <Label>Country</Label>
                      <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="e.g. UK" />
                    </div>
                    <div className="space-y-2">
                      <Label>Year</Label>
                      <Input value={reportingYear} onChange={(e) => setReportingYear(e.target.value)} placeholder="e.g. 2026" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Title</Label>
                    <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Content</Label>
                    <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={5} />
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Source Type</Label>
                      <Select value={sourceType} onValueChange={setSourceType}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Article">Article</SelectItem>
                          <SelectItem value="Legislation">Legislation</SelectItem>
                          <SelectItem value="Dataset">Dataset</SelectItem>
                          <SelectItem value="Reference">Reference</SelectItem>
                          <SelectItem value="News">News</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Source URL</Label>
                      <Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Reference Text</Label>
                    <Textarea value={referenceText} onChange={(e) => setReferenceText(e.target.value)} rows={2} />
                  </div>
                  <div className="space-y-2">
                    <Label>Tags</Label>
                    <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="comma,separated,tags" />
                  </div>
                  <Button onClick={() => void addCard()} disabled={savingCard}>Save Data Card</Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>AI Suggestions (OpenAI)</CardTitle>
                  <CardDescription>Generate up to 10 candidate cards, then add selected items to Data Bank.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <Label>Subject</Label>
                    <Select value={aiSubjectId} onValueChange={setAiSubjectId}>
                      <SelectTrigger><SelectValue placeholder="Select subject" /></SelectTrigger>
                      <SelectContent>
                        {subjects.map((s) => (
                          <SelectItem key={s.subject_id} value={String(s.subject_id)}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <Input value={aiCategory} onChange={(e) => setAiCategory(e.target.value)} placeholder="Category" />
                    <Input value={aiCountry} onChange={(e) => setAiCountry(e.target.value)} placeholder="Country" />
                    <Input value={aiYear} onChange={(e) => setAiYear(e.target.value)} placeholder="Year" />
                  </div>
                  <Input value={aiIndustry} onChange={(e) => setAiIndustry(e.target.value)} placeholder="Industry (optional)" />
                  <Textarea
                    value={aiQuery}
                    onChange={(e) => setAiQuery(e.target.value)}
                    rows={4}
                    placeholder="Ask for suggestions around a subject/country, e.g. key UK climate regulations impacting manufacturing in 2026."
                  />
                  <Button onClick={generateSuggestions} disabled={suggesting}>
                    {suggesting ? "Generating..." : "Generate Suggestions"}
                  </Button>
                  {suggestions.length > 0 ? (
                    <div className="space-y-2">
                      {suggestions.map((s, idx) => (
                        <div key={`${s.title}-${idx}`} className="rounded-md border p-3">
                          <div className="font-medium">{s.title}</div>
                          <div className="mt-1 text-sm text-muted-foreground">{s.content}</div>
                          <div className="mt-2 text-xs text-muted-foreground">
                            {s.category || "-"} | {s.country || "-"} | {s.reporting_year || "-"}
                          </div>
                          <div className="mt-2">
                            <Button size="sm" variant="outline" onClick={() => void addCard(s)}>
                              Add to Data Bank
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Data Cards Repository ({cards.length})</CardTitle>
                <CardDescription>Filter by category, country, year, subject, or free text.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                  <Select value={filterCategory} onValueChange={setFilterCategory}>
                    <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {categories.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={filterCountry} onValueChange={setFilterCountry}>
                    <SelectTrigger><SelectValue placeholder="Country" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Countries</SelectItem>
                      {countries.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={filterYear} onValueChange={setFilterYear}>
                    <SelectTrigger><SelectValue placeholder="Year" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Years</SelectItem>
                      {years.map((x) => <SelectItem key={x} value={String(x)}>{x}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={filterSubjectId} onValueChange={setFilterSubjectId}>
                    <SelectTrigger><SelectValue placeholder="Subject" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Subjects</SelectItem>
                      {subjects.map((x) => <SelectItem key={x.subject_id} value={String(x.subject_id)}>{x.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input value={filterQuery} onChange={(e) => setFilterQuery(e.target.value)} placeholder="Search title/content/ref" />
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={loadCards}>Apply Filters</Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setFilterCategory("all");
                      setFilterCountry("all");
                      setFilterYear("all");
                      setFilterSubjectId("all");
                      setFilterQuery("");
                      void loadCards();
                    }}
                  >
                    Reset
                  </Button>
                </div>

                {loadingCards ? (
                  <div className="text-sm text-muted-foreground">Loading cards...</div>
                ) : cards.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No Data Cards found.</div>
                ) : (
                  <div className="space-y-3">
                    {cards.map((c) => (
                      <div key={c.card_id} className="rounded-md border p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold">{c.title}</div>
                            <div className="text-xs text-muted-foreground">
                              {c.subject_name || "No subject"} | {c.category || "-"} | {c.country || "Global"} | {c.reporting_year || "N/A"}
                            </div>
                            <div className="mt-2 whitespace-pre-wrap text-sm">{c.content}</div>
                            {c.source_url ? (
                              <a href={c.source_url} target="_blank" rel="noreferrer" className="mt-2 block text-sm text-blue-600 underline">
                                {c.source_url}
                              </a>
                            ) : null}
                            {c.reference_text ? <div className="mt-1 text-xs text-muted-foreground">{c.reference_text}</div> : null}
                            <div className="mt-2 text-xs text-muted-foreground">
                              Added by {c.created_by || "-"} on {formatTs(c.created_at)}
                            </div>
                          </div>
                          <Button variant="outline" size="sm" onClick={() => void archiveCard(c.card_id)}>
                            Archive
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
