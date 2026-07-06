"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Send } from "lucide-react";
import Link from "next/link";
import { apiFetch } from "@/lib/auth";
import PortalShell from "@/components/PortalShell";
import PortalReportViewer from "@/components/PortalReportViewer";

type Review = {
  review_id: number;
  status: string;
  approved_at: string | null;
  approved_by_name: string | null;
};

type Comment = {
  comment_id: number;
  author_type: "client" | "crm";
  author_name: string;
  comment_text: string;
  section_reference: string | null;
  status: "open" | "addressed" | "dismissed";
  crm_response: string | null;
  created_at: string | null;
};

const COMMENT_TYPES = [
  { value: "Comment",        label: "Comment" },
  { value: "Change Request", label: "Change Request" },
  { value: "Data Query",     label: "Data Query" },
  { value: "Approval Query", label: "Approval Query" },
] as const;

const STATUS_STYLES: Record<string, string> = {
  open:       "bg-amber-100 text-amber-700",
  addressed:  "bg-green-100 text-green-700",
  dismissed:  "bg-gray-100 text-gray-500",
};

function fmtDate(iso: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

export default function ReviewPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);
  const router = useRouter();

  const [review, setReview] = useState<Review | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);

  const [commentType, setCommentType] = useState<string>("Comment");
  const [sectionRef, setSectionRef] = useState("");
  const [newComment, setNewComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const loadComments = useCallback(async () => {
    const res = await apiFetch(`/portal/jobs/${jobId}/comments`);
    const data = await res.json() as { review: Review; comments: Comment[] };
    setReview(data.review);
    setComments(data.comments ?? []);
    setCommentsLoading(false);
  }, [jobId]);

  useEffect(() => { void loadComments(); }, [loadComments]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newComment.trim()) return;
    setSubmitting(true);
    setSubmitError("");
    const sectionValue = [commentType, sectionRef.trim()].filter(Boolean).join(" — ") || null;
    try {
      const res = await apiFetch(`/portal/jobs/${jobId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment_text: newComment.trim(), section_reference: sectionValue }),
      });
      const data = await res.json() as { ok?: boolean; detail?: string };
      if (!res.ok) throw new Error(data.detail ?? "Failed to submit comment");
      setNewComment("");
      setSectionRef("");
      setCommentType("Comment");
      await loadComments();
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const isApproved = review?.status === "approved";
  const openCount = comments.filter(c => c.status === "open").length;
  const canApprove = review?.status === "sent_for_review" && openCount === 0;

  return (
    <PortalShell>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </Link>
        </div>

        {/* Status bar */}
        <div className={`rounded-xl border p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between ${isApproved ? "bg-green-50 border-green-200" : "bg-white border-gray-200"}`}>
          <div>
            {isApproved ? (
              <div className="flex items-center gap-2 text-green-700 font-medium">
                <CheckCircle2 className="h-5 w-5" />
                Report approved by {review?.approved_by_name} on {fmtDate(review?.approved_at ?? null)}
              </div>
            ) : (
              <div className="text-sm text-gray-600">
                Review the report and add any comments or change requests below.
                {openCount > 0 && (
                  <span className="ml-2 font-medium text-amber-700">
                    {openCount} open comment{openCount === 1 ? "" : "s"} awaiting response.
                  </span>
                )}
              </div>
            )}
          </div>
          {canApprove && !isApproved && (
            <span className="text-sm font-medium text-green-700">
              All comments resolved — ready to approve.
            </span>
          )}
        </div>

        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">

          {/* Report viewer — live React report */}
          <div className="flex-1 min-w-0">
            <PortalReportViewer jobId={jobId} />
          </div>

          {/* Comment panel — sticky on desktop */}
          <div className="w-full lg:w-96 shrink-0 lg:sticky lg:top-4 space-y-4">

            {/* Thread */}
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="border-b border-gray-100 px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Comments &amp; Changes
                </span>
                {openCount > 0 && (
                  <span className="rounded-full bg-amber-100 border border-amber-300 px-2 py-0.5 text-xs font-semibold text-amber-800">
                    {openCount} open
                  </span>
                )}
              </div>

              <div className="max-h-[60vh] overflow-y-auto divide-y divide-gray-100">
                {commentsLoading ? (
                  <div className="p-4 text-sm text-gray-400">Loading…</div>
                ) : comments.length === 0 ? (
                  <div className="p-4 text-sm text-gray-400">No comments yet. Add one below.</div>
                ) : (
                  comments.map(c => (
                    <div key={c.comment_id} className={`p-3 ${c.author_type === "crm" ? "bg-blue-50/40" : ""}`}>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={`shrink-0 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold text-white ${c.author_type === "crm" ? "bg-blue-500" : "bg-orange-500"}`}>
                            {c.author_type === "crm" ? "N" : c.author_name?.[0]?.toUpperCase() ?? "C"}
                          </span>
                          <span className="text-xs font-medium text-gray-600 truncate">
                            {c.author_type === "crm" ? "NZI Team" : c.author_name}
                          </span>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[c.status] ?? "bg-gray-100 text-gray-500"}`}>
                          {c.status}
                        </span>
                      </div>

                      {c.section_reference && (
                        <div className="mb-1">
                          <span className="inline-block rounded-full bg-gray-100 border border-gray-200 px-2 py-0.5 text-xs text-gray-600">
                            {c.section_reference}
                          </span>
                        </div>
                      )}

                      <p className="text-sm text-gray-800 leading-relaxed">{c.comment_text}</p>

                      {c.crm_response && (
                        <div className="mt-2 rounded-md bg-blue-50 border border-blue-100 px-2.5 py-2 text-xs text-blue-800 leading-relaxed">
                          <span className="font-semibold">NZI response: </span>{c.crm_response}
                        </div>
                      )}

                      <div className="mt-1.5 text-xs text-gray-400">{fmtDate(c.created_at)}</div>
                    </div>
                  ))
                )}
              </div>

              {/* Add comment form */}
              {!isApproved && (
                <form onSubmit={e => void handleSubmit(e)} className="border-t border-gray-100 p-3 space-y-2">
                  <div className="flex gap-2">
                    <select
                      value={commentType}
                      onChange={e => setCommentType(e.target.value)}
                      className="flex-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400 bg-white"
                    >
                      {COMMENT_TYPES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                  <input
                    type="text"
                    value={sectionRef}
                    onChange={e => setSectionRef(e.target.value)}
                    placeholder="Section / page reference (optional)"
                    className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400"
                  />
                  <textarea
                    value={newComment}
                    onChange={e => setNewComment(e.target.value)}
                    rows={4}
                    placeholder={commentType === "Change Request"
                      ? "Describe the change you would like made…"
                      : commentType === "Data Query"
                      ? "What data or figure would you like clarified?"
                      : "Add your comment here…"}
                    className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400 resize-none"
                  />
                  {submitError && <p className="text-xs text-red-600">{submitError}</p>}
                  <button
                    type="submit"
                    disabled={submitting || !newComment.trim()}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium text-white disabled:opacity-50 transition-opacity"
                    style={{ backgroundColor: "#F26624" }}
                  >
                    <Send className="h-3.5 w-3.5" />
                    {submitting ? "Submitting…" : `Submit ${commentType}`}
                  </button>
                </form>
              )}
            </div>

            {/* Approve button */}
            {canApprove && !isApproved && (
              <button
                onClick={() => router.push(`/jobs/${jobId}/approve`)}
                className="w-full rounded-xl py-3 text-sm font-semibold text-white shadow-sm"
                style={{ backgroundColor: "#F26624" }}
              >
                All looks good — Approve Report →
              </button>
            )}
          </div>
        </div>
      </div>
    </PortalShell>
  );
}
