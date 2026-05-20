"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Send } from "lucide-react";
import Link from "next/link";
import { apiFetch } from "@/lib/auth";
import PortalShell from "@/components/PortalShell";

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

function formatDate(iso: string | null) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return iso; }
}

export default function ReviewPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);
  const router = useRouter();

  const [review, setReview] = useState<Review | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [reportHtml, setReportHtml] = useState("");
  const [reportLoading, setReportLoading] = useState(true);
  const [commentsLoading, setCommentsLoading] = useState(true);

  const [newComment, setNewComment] = useState("");
  const [sectionRef, setSectionRef] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const iframeRef = useRef<HTMLIFrameElement>(null);

  const loadComments = useCallback(async () => {
    const res = await apiFetch(`/portal/jobs/${jobId}/comments`);
    const data = await res.json() as { review: Review; comments: Comment[] };
    setReview(data.review);
    setComments(data.comments ?? []);
    setCommentsLoading(false);
  }, [jobId]);

  useEffect(() => {
    void loadComments();
    apiFetch(`/portal/jobs/${jobId}/report-html`)
      .then(r => r.text())
      .then(html => setReportHtml(html))
      .catch(() => setReportHtml("<p style='padding:2rem;color:#666'>Report could not be loaded.</p>"))
      .finally(() => setReportLoading(false));
  }, [jobId, loadComments]);

  // Write HTML into iframe once loaded
  useEffect(() => {
    if (!reportHtml || !iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(reportHtml);
    doc.close();
  }, [reportHtml]);

  async function handleSubmitComment(e: React.FormEvent) {
    e.preventDefault();
    if (!newComment.trim()) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const res = await apiFetch(`/portal/jobs/${jobId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment_text: newComment.trim(), section_reference: sectionRef.trim() || null }),
      });
      const data = await res.json() as { ok?: boolean; detail?: string };
      if (!res.ok) throw new Error(data.detail ?? "Failed to submit comment");
      setNewComment("");
      setSectionRef("");
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
                Report approved by {review?.approved_by_name} on {formatDate(review?.approved_at ?? null)}
              </div>
            ) : (
              <div className="text-sm text-gray-600">
                Read the report below and leave comments for anything you would like changed.
                {openCount > 0 && <span className="ml-2 font-medium text-amber-700">{openCount} open comment{openCount === 1 ? "" : "s"}.</span>}
              </div>
            )}
          </div>
          {canApprove && !isApproved && (
            <button
              onClick={() => router.push(`/jobs/${jobId}/approve`)}
              className="rounded-lg px-5 py-2 text-sm font-semibold text-white shrink-0"
              style={{ backgroundColor: "#F26624" }}
            >
              Approve Report
            </button>
          )}
        </div>

        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          {/* Report viewer */}
          <div className="flex-1 min-w-0 rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
            <div className="border-b border-gray-100 px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">
              Report
            </div>
            {reportLoading ? (
              <div className="p-10 text-center text-sm text-gray-400">Loading report…</div>
            ) : (
              <iframe
                ref={iframeRef}
                title="Report"
                className="w-full"
                style={{ height: "80vh", border: "none" }}
                sandbox="allow-same-origin"
              />
            )}
          </div>

          {/* Comment panel */}
          <div className="w-full lg:w-96 shrink-0 space-y-4">
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="border-b border-gray-100 px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">
                Comments &amp; Changes
              </div>
              <div className="max-h-[50vh] overflow-y-auto divide-y divide-gray-100">
                {commentsLoading ? (
                  <div className="p-4 text-sm text-gray-400">Loading…</div>
                ) : comments.length === 0 ? (
                  <div className="p-4 text-sm text-gray-400">No comments yet. Add one below.</div>
                ) : (
                  comments.map(c => (
                    <div key={c.comment_id} className={`p-3 ${c.author_type === "crm" ? "bg-blue-50/40" : ""}`}>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-medium text-gray-600">
                          {c.author_type === "crm" ? "NZI" : c.author_name}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {c.section_reference && (
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{c.section_reference}</span>
                          )}
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c.status === "open" ? "bg-amber-100 text-amber-700" : c.status === "addressed" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                            {c.status}
                          </span>
                        </div>
                      </div>
                      <p className="text-sm text-gray-800">{c.comment_text}</p>
                      {c.crm_response && (
                        <div className="mt-1.5 rounded-md bg-blue-50 border border-blue-100 px-2.5 py-1.5 text-xs text-blue-800">
                          <span className="font-medium">Response: </span>{c.crm_response}
                        </div>
                      )}
                      <div className="mt-1 text-xs text-gray-400">{formatDate(c.created_at)}</div>
                    </div>
                  ))
                )}
              </div>

              {!isApproved && (
                <form onSubmit={e => void handleSubmitComment(e)} className="border-t border-gray-100 p-3 space-y-2">
                  <input
                    type="text"
                    value={sectionRef}
                    onChange={e => setSectionRef(e.target.value)}
                    placeholder="Section (optional, e.g. Scope 2 table)"
                    className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400"
                  />
                  <textarea
                    value={newComment}
                    onChange={e => setNewComment(e.target.value)}
                    rows={3}
                    placeholder="Describe your comment or change request…"
                    className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400 resize-none"
                  />
                  {submitError && <p className="text-xs text-red-600">{submitError}</p>}
                  <button
                    type="submit"
                    disabled={submitting || !newComment.trim()}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium text-white disabled:opacity-50 transition-colors"
                    style={{ backgroundColor: "#F26624" }}
                  >
                    <Send className="h-3.5 w-3.5" />
                    {submitting ? "Submitting…" : "Submit Comment"}
                  </button>
                </form>
              )}
            </div>

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
