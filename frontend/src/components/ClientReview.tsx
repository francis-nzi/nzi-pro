"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, FileDown, MessageSquare, UserPlus, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type ReviewStatus = "draft" | "sent_for_review" | "changes_requested" | "approved" | "not_sent";

type Review = {
  review_id: number;
  job_id: number;
  status: ReviewStatus;
  sent_for_review_at: string | null;
  sent_by: string | null;
  approved_at: string | null;
  approved_by_name: string | null;
  approved_by_email: string | null;
  portal_version_id: number | null;
  published_at: string | null;
  published_by: string | null;
  pdf_version_id: number | null;
};

type Comment = {
  comment_id: number;
  review_id: number;
  author_type: "client" | "crm";
  author_name: string;
  author_email: string;
  comment_text: string;
  section_reference: string | null;
  status: "open" | "addressed" | "dismissed";
  crm_response: string | null;
  created_at: string | null;
  addressed_at: string | null;
  addressed_by: string | null;
};

type PortalUser = {
  portal_user_id: number;
  email: string;
  full_name: string;
  is_active: boolean;
  last_login_at: string | null;
};

type Props = {
  jobId: number;
  clientDbId: number;
  baseUrl: string;
};

const STATUS_LABELS: Record<ReviewStatus, string> = {
  not_sent: "Not sent",
  draft: "Draft",
  sent_for_review: "Awaiting client",
  changes_requested: "Changes requested",
  approved: "Approved",
};

const STATUS_COLOURS: Record<ReviewStatus, string> = {
  not_sent: "bg-gray-100 text-gray-600 border-gray-200",
  draft: "bg-gray-100 text-gray-600 border-gray-200",
  sent_for_review: "bg-blue-100 text-blue-700 border-blue-200",
  changes_requested: "bg-amber-100 text-amber-700 border-amber-200",
  approved: "bg-green-100 text-green-700 border-green-200",
};

function formatDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export default function ClientReview({ jobId, clientDbId, baseUrl }: Props) {
  const [review, setReview] = useState<Review | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [portalUsers, setPortalUsers] = useState<PortalUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [publishing, setPublishing] = useState(false);

  // Respond form state
  const [respondingTo, setRespondingTo] = useState<number | null>(null);
  const [responseText, setResponseText] = useState("");
  const [responding, setResponding] = useState(false);

  // Add portal user form
  const [showAddUser, setShowAddUser] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [addingUser, setAddingUser] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [reviewRes, usersRes] = await Promise.all([
        fetch(`${baseUrl}/jobs/${jobId}/review`, { credentials: "include" }),
        fetch(`${baseUrl}/clients/${clientDbId}/portal-users`, { credentials: "include" }),
      ]);
      if (reviewRes.ok) {
        const data = await reviewRes.json() as { review: Review; comments: Comment[]; portal_users: PortalUser[] };
        setReview(data.review);
        setComments(data.comments ?? []);
      }
      if (usersRes.ok) {
        const data = await usersRes.json() as { items: PortalUser[] };
        setPortalUsers(data.items ?? []);
      }
    } catch {
      setError("Failed to load review data");
    } finally {
      setLoading(false);
    }
  }, [baseUrl, jobId, clientDbId]);

  useEffect(() => { void load(); }, [load]);

  async function safeJson<T>(res: Response): Promise<T> {
    try {
      return await res.json() as T;
    } catch {
      throw new Error(`Server returned a non-JSON response (HTTP ${res.status}). Please try again.`);
    }
  }

  async function handlePublishPdf() {
    if (!confirm("Publish the final PDF to the client portal?\n\nThis makes it available for the client to download. Make sure a Final version exists in Report Printing first.")) return;
    setPublishing(true);
    setStatus("");
    setError("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/review/publish-pdf`, {
        method: "POST",
        credentials: "include",
      });
      const data = await safeJson<{ ok?: boolean; published_at?: string; detail?: string }>(res);
      if (!res.ok) throw new Error(data.detail ?? `Failed to publish (HTTP ${res.status})`);
      await load();
      setStatus("PDF published. The client can now download it from the portal.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  async function handleRespond(commentId: number, newStatus: "addressed" | "dismissed") {
    setResponding(true);
    setError("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/review/comments/${commentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: newStatus, crm_response: responseText.trim() || null }),
      });
      const data = await safeJson<{ ok?: boolean; detail?: string }>(res);
      if (!res.ok) throw new Error(data.detail ?? "Failed to respond");
      setRespondingTo(null);
      setResponseText("");
      await load();
      setStatus(newStatus === "addressed" ? "Comment marked as addressed." : "Comment dismissed.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResponding(false);
    }
  }

  async function handleAddPortalUser(e: React.FormEvent) {
    e.preventDefault();
    setAddingUser(true);
    setError("");
    try {
      const res = await fetch(`${baseUrl}/clients/${clientDbId}/portal-users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: newEmail.trim(), full_name: newName.trim(), password: newPassword }),
      });
      const data = await safeJson<{ ok?: boolean; detail?: string }>(res);
      if (!res.ok) throw new Error(data.detail ?? "Failed to create user");
      setShowAddUser(false);
      setNewEmail(""); setNewName(""); setNewPassword("");
      await load();
      setStatus("Portal user created and welcome email sent.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAddingUser(false);
    }
  }

  async function handleToggleUserActive(user: PortalUser) {
    try {
      const res = await fetch(`${baseUrl}/clients/${clientDbId}/portal-users/${user.portal_user_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ is_active: !user.is_active }),
      });
      if (!res.ok) throw new Error("Failed to update user");
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const openCount = comments.filter(c => c.status === "open").length;
  const clientComments = comments.filter(c => c.author_type === "client");

  // Group client comments by section
  const commentsBySection = clientComments.reduce<Record<string, Comment[]>>((acc, c) => {
    const key = c.section_reference?.trim() || "General";
    if (!acc[key]) acc[key] = [];
    acc[key].push(c);
    return acc;
  }, {});

  if (loading) return <div className="text-sm text-muted-foreground p-4">Loading review…</div>;

  const isApproved = review?.status === "approved";
  const isPublished = !!review?.published_at;
  const hasSentVersion = !!review?.portal_version_id;

  return (
    <div className="space-y-6">

      {/* Review status */}
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              Client Review
              {review && (
                <Badge variant="outline" className={STATUS_COLOURS[review.status as ReviewStatus] ?? ""}>
                  {STATUS_LABELS[review.status as ReviewStatus] ?? review.status}
                </Badge>
              )}
              {isPublished && (
                <Badge variant="outline" className="bg-green-100 text-green-700 border-green-200">
                  PDF Published
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Use <strong>Send to Portal</strong> in Report Printing to send the report to the client for review.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {isApproved && !isPublished && (
              <Button
                variant="outline"
                onClick={() => void handlePublishPdf()}
                disabled={publishing}
                className="border-green-300 text-green-700 hover:bg-green-50"
                title="Publish the final PDF to the client portal for download"
              >
                <FileDown className="mr-2 h-4 w-4" />
                {publishing ? "Publishing…" : "Publish PDF"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          {isApproved && (
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle2 className="h-4 w-4" />
              Approved by {review?.approved_by_name} ({review?.approved_by_email}) on {formatDate(review?.approved_at ?? null)}
            </div>
          )}
          {isPublished && (
            <div className="text-green-700">
              PDF published on {formatDate(review?.published_at ?? null)} by {review?.published_by}
            </div>
          )}
          {!isApproved && review?.sent_for_review_at && (
            <div>Last sent to portal: {formatDateTime(review.sent_for_review_at)} by {review.sent_by}</div>
          )}
          {!hasSentVersion && !isApproved && (
            <div className="text-amber-600">No report has been sent to the portal yet. Use Send to Portal in Report Printing.</div>
          )}
          {openCount > 0 && (
            <div className="text-amber-600 font-medium">{openCount} open comment{openCount === 1 ? "" : "s"} awaiting response</div>
          )}
          {isApproved && !isPublished && (
            <div className="text-amber-600">
              Report approved — generate a Final version in Report Printing, then click <strong>Publish PDF</strong> above.
            </div>
          )}
          {status && <div className="text-green-700">{status}</div>}
          {error && <div className="text-red-600">{error}</div>}
          {portalUsers.filter(u => u.is_active).length === 0 && (
            <div className="text-amber-600">No active portal users — add a client account below before sending.</div>
          )}
        </CardContent>
      </Card>

      {/* Client comments grouped by section */}
      {clientComments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Client Comments
              {openCount > 0 && (
                <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-200">{openCount} open</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {Object.entries(commentsBySection).map(([section, sectionComments]) => (
              <div key={section}>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 border-b pb-1">
                  {section}
                </div>
                <div className="space-y-3">
                  {sectionComments.map(comment => (
                    <div key={comment.comment_id} className={`rounded-lg border p-4 ${comment.status === "open" ? "border-amber-200 bg-amber-50/40" : "border-gray-200 bg-muted/20"}`}>
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="font-medium">{comment.author_name}</span>
                            <Badge
                              variant="outline"
                              className={comment.status === "open" ? "bg-amber-100 text-amber-700 border-amber-200 text-xs" : comment.status === "addressed" ? "bg-green-100 text-green-700 border-green-200 text-xs" : "bg-gray-100 text-gray-600 border-gray-200 text-xs"}
                            >
                              {comment.status}
                            </Badge>
                            <span className="text-xs text-muted-foreground">{formatDate(comment.created_at)}</span>
                            {comment.addressed_by && (
                              <span className="text-xs text-muted-foreground">
                                · Resolved by {comment.addressed_by} on {formatDate(comment.addressed_at)}
                              </span>
                            )}
                          </div>
                          <p className="text-sm">{comment.comment_text}</p>
                          {comment.crm_response && (
                            <div className="mt-2 rounded-md bg-blue-50 border border-blue-100 px-3 py-2 text-sm text-blue-800">
                              <span className="font-medium">Response: </span>{comment.crm_response}
                            </div>
                          )}
                        </div>
                        {comment.status === "open" && respondingTo !== comment.comment_id && (
                          <Button variant="outline" size="sm" className="shrink-0" onClick={() => { setRespondingTo(comment.comment_id); setResponseText(""); }}>
                            Respond
                          </Button>
                        )}
                      </div>

                      {respondingTo === comment.comment_id && (
                        <div className="mt-3 space-y-2 border-t pt-3">
                          <Textarea
                            placeholder="Optional response note visible to the client…"
                            rows={2}
                            value={responseText}
                            onChange={e => setResponseText(e.target.value)}
                          />
                          <div className="flex gap-2">
                            <Button size="sm" disabled={responding} onClick={() => void handleRespond(comment.comment_id, "addressed")}>
                              {responding ? "Saving…" : "Mark Addressed"}
                            </Button>
                            <Button size="sm" variant="outline" disabled={responding} onClick={() => void handleRespond(comment.comment_id, "dismissed")}>
                              Dismiss
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setRespondingTo(null)}>
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Portal users */}
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">Portal Access</CardTitle>
            <CardDescription>Client contacts with NZInsights portal accounts for this client.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowAddUser(v => !v)}>
            <UserPlus className="mr-2 h-4 w-4" />
            Add Portal User
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {showAddUser && (
            <form onSubmit={e => void handleAddPortalUser(e)} className="rounded-lg border p-4 space-y-3 bg-muted/30">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="pu-name">Full Name</Label>
                  <Input id="pu-name" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Jane Smith" required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pu-email">Email</Label>
                  <Input id="pu-email" type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="jane@example.com" required />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="pu-pass">Temporary Password</Label>
                <Input id="pu-pass" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Min 8 characters" required minLength={8} />
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={addingUser}>{addingUser ? "Creating…" : "Create Account & Send Welcome Email"}</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setShowAddUser(false)}>Cancel</Button>
              </div>
            </form>
          )}

          {portalUsers.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
              No portal users yet. Add one above to give this client access to NZInsights.
            </div>
          ) : (
            <div className="divide-y rounded-md border">
              {portalUsers.map(user => (
                <div key={user.portal_user_id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <div className="text-sm font-medium">{user.full_name}</div>
                    <div className="text-xs text-muted-foreground">{user.email}</div>
                    {user.last_login_at && (
                      <div className="text-xs text-muted-foreground">Last login: {formatDate(user.last_login_at)}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={user.is_active ? "secondary" : "outline"}>
                      {user.is_active ? "Active" : "Inactive"}
                    </Badge>
                    <Button variant="ghost" size="sm" onClick={() => void handleToggleUserActive(user)}>
                      {user.is_active ? "Deactivate" : "Reactivate"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
