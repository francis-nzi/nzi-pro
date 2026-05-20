"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, FileText, MessageSquare } from "lucide-react";
import { apiFetch } from "@/lib/auth";
import PortalShell from "@/components/PortalShell";

type Job = {
  job_id: number;
  job_number: string;
  title: string;
  reporting_year: number | null;
  status: string;
  review_status: string;
  review_id: number | null;
  sent_for_review_at: string | null;
  approved_at: string | null;
};

const REVIEW_LABELS: Record<string, string> = {
  not_sent: "Not available yet",
  draft: "Not available yet",
  sent_for_review: "Ready to review",
  changes_requested: "Changes requested",
  approved: "Approved",
};

const REVIEW_COLOURS: Record<string, string> = {
  not_sent: "bg-gray-100 text-gray-500",
  draft: "bg-gray-100 text-gray-500",
  sent_for_review: "bg-blue-100 text-blue-700",
  changes_requested: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
};

function ReviewIcon({ status }: { status: string }) {
  if (status === "approved") return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (status === "sent_for_review") return <FileText className="h-4 w-4 text-blue-600" />;
  if (status === "changes_requested") return <MessageSquare className="h-4 w-4 text-amber-600" />;
  return <Clock className="h-4 w-4 text-gray-400" />;
}

export default function DashboardPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [clientName, setClientName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/portal/dashboard")
      .then(r => r.json() as Promise<{ jobs: Job[]; client_name: string }>)
      .then(d => { setJobs(d.jobs ?? []); setClientName(d.client_name ?? ""); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <PortalShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {clientName ? `${clientName}` : "Your Reports"}
          </h1>
          <p className="mt-1 text-sm text-gray-500">Your carbon reporting history and review status.</p>
        </div>

        {loading ? (
          <div className="text-sm text-gray-400">Loading…</div>
        ) : jobs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-400">
            No reports available yet. Your NZI contact will send your report for review when it is ready.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {jobs.map(job => {
              const canReview = job.review_status === "sent_for_review" || job.review_status === "changes_requested" || job.review_status === "approved";
              return (
                <div key={job.job_id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs text-gray-400 font-medium uppercase tracking-wide">
                        {job.reporting_year ?? "—"}
                      </div>
                      <div className="mt-0.5 font-semibold text-gray-900 leading-tight">
                        {job.title || `Job ${job.job_id}`}
                      </div>
                      {job.job_number && (
                        <div className="mt-0.5 text-xs text-gray-400">{job.job_number}</div>
                      )}
                    </div>
                    <ReviewIcon status={job.review_status} />
                  </div>

                  <div className="mt-3">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${REVIEW_COLOURS[job.review_status] ?? "bg-gray-100 text-gray-500"}`}>
                      {REVIEW_LABELS[job.review_status] ?? job.review_status}
                    </span>
                  </div>

                  {canReview ? (
                    <Link
                      href={`/jobs/${job.job_id}/review`}
                      className="mt-4 block w-full rounded-lg py-2 text-center text-sm font-medium text-white transition-colors"
                      style={{ backgroundColor: "#F26624" }}
                    >
                      {job.review_status === "approved" ? "View Report" : "Review Report"}
                    </Link>
                  ) : (
                    <div className="mt-4 rounded-lg bg-gray-50 py-2 text-center text-sm text-gray-400">
                      Not yet available
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PortalShell>
  );
}
