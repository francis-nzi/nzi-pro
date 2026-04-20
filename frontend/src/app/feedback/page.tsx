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

type FeedbackItem = {
  feedback_id: number;
  feedback_type: "wishlist" | "bug" | "business_dev";
  title: string;
  details: string;
  process_name: string;
  page_path: string;
  is_completed: boolean;
  created_at: string | null;
  created_by: string;
  updated_at: string | null;
  completed_at: string | null;
  completed_by: string;
};

const DEFAULT_PROCESS_OPTIONS = ["Client Onboarding", "Job Start", "Job Report", "General"];

function apiBaseUrl(): string {
  return "/api/backend";
}

function formatTs(ts: string | null): string {
  if (!ts) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function localBizDevFallback(criteria: {
  targetMarket: string;
  customerSegment: string;
  geography: string;
  serviceLine: string;
  objective: string;
  constraints: string;
  timeHorizon: string;
}): Array<{ title: string; details: string }> {
  const target = criteria.targetMarket || "target market";
  const segment = criteria.customerSegment || "customer segment";
  const geography = criteria.geography || "selected geography";
  const service = criteria.serviceLine || "carbon reporting services";
  const objective = criteria.objective || "growth";
  const horizon = criteria.timeHorizon || "12 months";
  const constraints = criteria.constraints || "no additional constraints";
  const seeds = [
    "Partner campaign",
    "Vertical offer",
    "Referral program",
    "Webinar funnel",
    "Compliance-led outreach",
    "Account expansion playbook",
    "Country proposition refresh",
    "Pilot offer",
    "Benchmark report lead magnet",
    "Case study campaign",
  ];
  return seeds.map((seed, idx) => ({
    title: `${seed} for ${service}`,
    details: `Idea ${idx + 1}: target ${segment} in ${target} (${geography}) over ${horizon}. Objective: ${objective}. Constraints: ${constraints}. Define owner, KPIs, and conversion target.`,
  }));
}

export default function FeedbackPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const [mounted, setMounted] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [processOptions, setProcessOptions] = useState<string[]>(DEFAULT_PROCESS_OPTIONS);
  const [showCompleted, setShowCompleted] = useState(true);
  const [wishlistTitle, setWishlistTitle] = useState("");
  const [wishlistDetails, setWishlistDetails] = useState("");
  const [wishlistProcess, setWishlistProcess] = useState("General");
  const [wishlistPage, setWishlistPage] = useState("");
  const [bugTitle, setBugTitle] = useState("");
  const [bugDetails, setBugDetails] = useState("");
  const [bugProcess, setBugProcess] = useState("General");
  const [bugPage, setBugPage] = useState("");
  const [bizDevTitle, setBizDevTitle] = useState("");
  const [bizDevDetails, setBizDevDetails] = useState("");
  const [bizDevProcess, setBizDevProcess] = useState("General");
  const [bizDevPage, setBizDevPage] = useState("");
  const [aiTargetMarket, setAiTargetMarket] = useState("");
  const [aiCustomerSegment, setAiCustomerSegment] = useState("");
  const [aiGeography, setAiGeography] = useState("");
  const [aiServiceLine, setAiServiceLine] = useState("");
  const [aiObjective, setAiObjective] = useState("");
  const [aiConstraints, setAiConstraints] = useState("");
  const [aiTimeHorizon, setAiTimeHorizon] = useState("12 months");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiIdeas, setAiIdeas] = useState<Array<{ title: string; details: string }>>([]);

  useEffect(() => {
    setMounted(true);
    setAuthed(hasAuthState());
    setAuthReady(true);
  }, []);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/feedback/items?include_completed=${showCompleted ? "true" : "false"}`);
      if (res.status === 403) {
        setAccessDenied(true);
        setItems([]);
        return;
      }
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const json = await res.json();
      setAccessDenied(false);
      setItems(json.items || []);
    } catch (e) {
      setStatus(`Error loading feedback: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [baseUrl, showCompleted]);

  const loadProcesses = useCallback(async () => {
    try {
      const res = await fetch(`${baseUrl}/admin/lookups/processes_lookup?_t=${Date.now()}`);
      if (!res.ok) return;
      const json = await res.json();
      const names = (json.items || [])
        .filter((item: { is_active?: boolean; name?: string }) => item?.is_active !== false && item?.name)
        .map((item: { name: string }) => String(item.name).trim())
        .filter(Boolean);
      if (names.length > 0) {
        setProcessOptions(names);
        if (!names.includes(wishlistProcess)) {
          setWishlistProcess(names[0]);
        }
        if (!names.includes(bugProcess)) {
          setBugProcess(names[0]);
        }
        if (!names.includes(bizDevProcess)) {
          setBizDevProcess(names[0]);
        }
      }
    } catch {
      // Keep default process options when lookup fetch fails.
    }
  }, [baseUrl, bizDevProcess, bugProcess, wishlistProcess]);

  useEffect(() => {
    if (authed) loadItems();
  }, [authed, loadItems]);

  useEffect(() => {
    if (authed) loadProcesses();
  }, [authed, loadProcesses]);

  async function addItem(feedbackType: "wishlist" | "bug" | "business_dev") {
    const title =
      feedbackType === "wishlist"
        ? wishlistTitle.trim()
        : feedbackType === "bug"
          ? bugTitle.trim()
          : bizDevTitle.trim();
    const details =
      feedbackType === "wishlist"
        ? wishlistDetails.trim()
        : feedbackType === "bug"
          ? bugDetails.trim()
          : bizDevDetails.trim();
    const processName =
      feedbackType === "wishlist"
        ? wishlistProcess.trim()
        : feedbackType === "bug"
          ? bugProcess.trim()
          : bizDevProcess.trim();
    const pagePath =
      feedbackType === "wishlist"
        ? wishlistPage.trim()
        : feedbackType === "bug"
          ? bugPage.trim()
          : bizDevPage.trim();

    if (!title) {
      setStatus(
        `${feedbackType === "wishlist" ? "Wishlist" : feedbackType === "bug" ? "Bug" : "Business development"} title is required`
      );
      return;
    }

    setSaving(true);
    setStatus("Saving...");
    try {
      const res = await fetch(`${baseUrl}/feedback/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedback_type: feedbackType,
          title,
          details,
          process_name: processName,
          page_path: pagePath,
        }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);

      if (feedbackType === "wishlist") {
        setWishlistTitle("");
        setWishlistDetails("");
        setWishlistProcess("General");
        setWishlistPage("");
      } else if (feedbackType === "bug") {
        setBugTitle("");
        setBugDetails("");
        setBugProcess("General");
        setBugPage("");
      } else {
        setBizDevTitle("");
        setBizDevDetails("");
        setBizDevProcess("General");
        setBizDevPage("");
      }
      setStatus("Saved");
      loadItems();
      setTimeout(() => setStatus(""), 2000);
    } catch (e) {
      setStatus(`Error saving feedback: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function toggleCompleted(item: FeedbackItem, checked: boolean) {
    try {
      const res = await fetch(`${baseUrl}/feedback/items/${item.feedback_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_completed: checked }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      loadItems();
    } catch (e) {
      setStatus(`Error updating item: ${(e as Error).message}`);
    }
  }

  const wishlistItems = items.filter((item) => item.feedback_type === "wishlist");
  const bugItems = items.filter((item) => item.feedback_type === "bug");
  const bizDevItems = items.filter((item) => item.feedback_type === "business_dev");

  async function generateBizDevIdeas() {
    setAiGenerating(true);
    setStatus("Generating business development ideas...");
    const criteria = {
      targetMarket: aiTargetMarket.trim(),
      customerSegment: aiCustomerSegment.trim(),
      geography: aiGeography.trim(),
      serviceLine: aiServiceLine.trim(),
      objective: aiObjective.trim(),
      constraints: aiConstraints.trim(),
      timeHorizon: aiTimeHorizon.trim(),
    };
    try {
      const res = await fetch(`${baseUrl}/feedback/business-dev/suggestions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_market: criteria.targetMarket,
          customer_segment: criteria.customerSegment,
          geography: criteria.geography,
          service_line: criteria.serviceLine,
          objective: criteria.objective,
          constraints: criteria.constraints,
          time_horizon: criteria.timeHorizon,
        }),
      });
      if (!res.ok) {
        await res.text().catch(() => "");
        const fallback = localBizDevFallback(criteria);
        setAiIdeas(fallback);
        setStatus(`AI endpoint unavailable (${res.status}). Showing fallback suggestions.`);
        return;
      }
      const json = await res.json();
      const serverIdeas = Array.isArray(json.items) ? json.items : [];
      if (serverIdeas.length === 0) {
        setAiIdeas(localBizDevFallback(criteria));
        setStatus("No AI output returned. Showing fallback suggestions.");
        return;
      }
      setAiIdeas(serverIdeas);
      setStatus("AI suggestions ready");
      setTimeout(() => setStatus(""), 2000);
    } catch (e) {
      setAiIdeas(localBizDevFallback(criteria));
      setStatus(`Error generating ideas: ${(e as Error).message}. Showing fallback suggestions.`);
    } finally {
      setAiGenerating(false);
    }
  }

  async function saveAiIdea(idea: { title: string; details: string }) {
    setSaving(true);
    setStatus("Saving AI idea...");
    try {
      const res = await fetch(`${baseUrl}/feedback/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedback_type: "business_dev",
          title: idea.title,
          details: idea.details,
          process_name: bizDevProcess || "General",
          page_path: bizDevPage || "/feedback",
        }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      setStatus("AI idea saved");
      await loadItems();
      setTimeout(() => setStatus(""), 1500);
    } catch (e) {
      setStatus(`Error saving AI idea: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold" style={{ color: "#F26624" }}>Team Feedback</h1>
            <p className="text-muted-foreground">Wishlist, bug, and business development idea tracking for team members.</p>
          </div>
          <Button variant="secondary" asChild>
            <Link href="/">Back to Hub</Link>
          </Button>
        </div>

        {!mounted || !authReady ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Loading feedback access...
            </CardContent>
          </Card>
        ) : !authed || accessDenied ? (
          <Card>
            <CardHeader>
              <CardTitle>Access Restricted</CardTitle>
              <CardDescription>This feedback area is available to team members only.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Your current role does not have access to this section.
            </CardContent>
          </Card>
        ) : (
          <>
            {status && <div className="mb-4 rounded-md bg-muted p-3 text-sm">{status}</div>}

            <div className="mb-4 flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showCompleted}
                  onChange={(e) => setShowCompleted(e.target.checked)}
                />
                Show completed items
              </label>
              <Button variant="outline" onClick={loadItems} disabled={loading}>
                Refresh
              </Button>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle>Wishlist</CardTitle>
                  <CardDescription>Track requested features and improvements.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="wishlistTitle">Title</Label>
                    <Input id="wishlistTitle" value={wishlistTitle} onChange={(e) => setWishlistTitle(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="wishlistProcess">Process</Label>
                    <Select value={wishlistProcess} onValueChange={setWishlistProcess}>
                      <SelectTrigger id="wishlistProcess">
                        <SelectValue placeholder="Select process" />
                      </SelectTrigger>
                      <SelectContent>
                        {processOptions.map((processName) => (
                          <SelectItem key={processName} value={processName}>
                            {processName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="wishlistPage">Page Path</Label>
                    <Input id="wishlistPage" value={wishlistPage} onChange={(e) => setWishlistPage(e.target.value)} placeholder="e.g. /jobs/[jobId]" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="wishlistDetails">Details</Label>
                    <Textarea id="wishlistDetails" value={wishlistDetails} onChange={(e) => setWishlistDetails(e.target.value)} />
                  </div>
                  <Button onClick={() => addItem("wishlist")} disabled={saving}>Add Wishlist Item</Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Bug Reports</CardTitle>
                  <CardDescription>Track platform defects and fixes.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="bugTitle">Title</Label>
                    <Input id="bugTitle" value={bugTitle} onChange={(e) => setBugTitle(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bugProcess">Process</Label>
                    <Select value={bugProcess} onValueChange={setBugProcess}>
                      <SelectTrigger id="bugProcess">
                        <SelectValue placeholder="Select process" />
                      </SelectTrigger>
                      <SelectContent>
                        {processOptions.map((processName) => (
                          <SelectItem key={processName} value={processName}>
                            {processName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bugPage">Page Path</Label>
                    <Input id="bugPage" value={bugPage} onChange={(e) => setBugPage(e.target.value)} placeholder="e.g. /admin/lookups" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bugDetails">Details</Label>
                    <Textarea id="bugDetails" value={bugDetails} onChange={(e) => setBugDetails(e.target.value)} />
                  </div>
                  <Button onClick={() => addItem("bug")} disabled={saving}>Add Bug Report</Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Business Development Ideas</CardTitle>
                  <CardDescription>Capture team-submitted commercial growth ideas.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="bizDevTitle">Title</Label>
                    <Input id="bizDevTitle" value={bizDevTitle} onChange={(e) => setBizDevTitle(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bizDevProcess">Process</Label>
                    <Select value={bizDevProcess} onValueChange={setBizDevProcess}>
                      <SelectTrigger id="bizDevProcess">
                        <SelectValue placeholder="Select process" />
                      </SelectTrigger>
                      <SelectContent>
                        {processOptions.map((processName) => (
                          <SelectItem key={`bizdev-${processName}`} value={processName}>
                            {processName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bizDevPage">Page Path</Label>
                    <Input id="bizDevPage" value={bizDevPage} onChange={(e) => setBizDevPage(e.target.value)} placeholder="e.g. /clients/[clientId]" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bizDevDetails">Details</Label>
                    <Textarea id="bizDevDetails" value={bizDevDetails} onChange={(e) => setBizDevDetails(e.target.value)} />
                  </div>
                  <Button onClick={() => addItem("business_dev")} disabled={saving}>Add Business Idea</Button>
                </CardContent>
              </Card>
            </div>

            <Card className="mt-6">
              <CardHeader>
                <CardTitle>AI Business Development Ideas</CardTitle>
                <CardDescription>Generate ideas based on criteria and save selected ideas to the checklist.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="aiTargetMarket">Target Market</Label>
                    <Input id="aiTargetMarket" value={aiTargetMarket} onChange={(e) => setAiTargetMarket(e.target.value)} placeholder="e.g. Mid-market UK" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="aiCustomerSegment">Customer Segment</Label>
                    <Input id="aiCustomerSegment" value={aiCustomerSegment} onChange={(e) => setAiCustomerSegment(e.target.value)} placeholder="e.g. Food manufacturing" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="aiGeography">Geography</Label>
                    <Input id="aiGeography" value={aiGeography} onChange={(e) => setAiGeography(e.target.value)} placeholder="e.g. UK / UAE" />
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="aiServiceLine">Service Line</Label>
                    <Input id="aiServiceLine" value={aiServiceLine} onChange={(e) => setAiServiceLine(e.target.value)} placeholder="e.g. Carbon reporting + advisory" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="aiObjective">Objective</Label>
                    <Input id="aiObjective" value={aiObjective} onChange={(e) => setAiObjective(e.target.value)} placeholder="e.g. Increase quote-to-win rate" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="aiTimeHorizon">Time Horizon</Label>
                    <Input id="aiTimeHorizon" value={aiTimeHorizon} onChange={(e) => setAiTimeHorizon(e.target.value)} placeholder="e.g. 12 months" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="aiConstraints">Constraints</Label>
                  <Textarea id="aiConstraints" value={aiConstraints} onChange={(e) => setAiConstraints(e.target.value)} placeholder="e.g. Limited sales headcount, fixed marketing budget" />
                </div>
                <div className="flex justify-end">
                  <Button onClick={generateBizDevIdeas} disabled={aiGenerating}>
                    {aiGenerating ? "Generating..." : "Generate Ideas"}
                  </Button>
                </div>
                <div className="space-y-2">
                  {aiIdeas.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No AI suggestions yet.</div>
                  ) : (
                    aiIdeas.map((idea, idx) => (
                      <div key={`ai-idea-${idx}`} className="rounded-md border p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="font-medium">{idea.title}</div>
                            <div className="mt-1 text-sm text-muted-foreground">{idea.details}</div>
                          </div>
                          <Button size="sm" variant="outline" onClick={() => saveAiIdea(idea)} disabled={saving}>
                            Save
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="mt-6 grid gap-6 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle>Wishlist Checklist ({wishlistItems.length})</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {loading ? (
                    <div className="text-sm text-muted-foreground">Loading...</div>
                  ) : wishlistItems.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No wishlist items.</div>
                  ) : (
                    wishlistItems.map((item) => (
                      <div key={item.feedback_id} className="rounded-md border p-3">
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={item.is_completed}
                            onChange={(e) => toggleCompleted(item, e.target.checked)}
                            className="mt-1"
                          />
                          <div className="flex-1">
                            <div className={`font-medium ${item.is_completed ? "line-through text-muted-foreground" : ""}`}>{item.title}</div>
                            {item.details && <div className="mt-1 text-sm text-muted-foreground">{item.details}</div>}
                            <div className="mt-2 text-xs text-muted-foreground">
                              Created: {formatTs(item.created_at)} by {item.created_by || "-"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Completed: {formatTs(item.completed_at)}{item.completed_by ? ` by ${item.completed_by}` : ""}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Bug Checklist ({bugItems.length})</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {loading ? (
                    <div className="text-sm text-muted-foreground">Loading...</div>
                  ) : bugItems.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No bug items.</div>
                  ) : (
                    bugItems.map((item) => (
                      <div key={item.feedback_id} className="rounded-md border p-3">
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={item.is_completed}
                            onChange={(e) => toggleCompleted(item, e.target.checked)}
                            className="mt-1"
                          />
                          <div className="flex-1">
                            <div className={`font-medium ${item.is_completed ? "line-through text-muted-foreground" : ""}`}>{item.title}</div>
                            {item.details && <div className="mt-1 text-sm text-muted-foreground">{item.details}</div>}
                            <div className="mt-2 text-xs text-muted-foreground">
                              Created: {formatTs(item.created_at)} by {item.created_by || "-"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Completed: {formatTs(item.completed_at)}{item.completed_by ? ` by ${item.completed_by}` : ""}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Business Development Checklist ({bizDevItems.length})</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {loading ? (
                    <div className="text-sm text-muted-foreground">Loading...</div>
                  ) : bizDevItems.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No business development ideas.</div>
                  ) : (
                    bizDevItems.map((item) => (
                      <div key={item.feedback_id} className="rounded-md border p-3">
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={item.is_completed}
                            onChange={(e) => toggleCompleted(item, e.target.checked)}
                            className="mt-1"
                          />
                          <div className="flex-1">
                            <div className={`font-medium ${item.is_completed ? "line-through text-muted-foreground" : ""}`}>{item.title}</div>
                            {item.details && <div className="mt-1 text-sm text-muted-foreground">{item.details}</div>}
                            <div className="mt-2 text-xs text-muted-foreground">
                              Created: {formatTs(item.created_at)} by {item.created_by || "-"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Completed: {formatTs(item.completed_at)}{item.completed_by ? ` by ${item.completed_by}` : ""}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
