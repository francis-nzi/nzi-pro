"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { apiFetch } from "@/lib/auth";
import PortalShell from "@/components/PortalShell";
import { BRAND } from "@/lib/brand";

export default function ApprovePage() {
  const params = useParams<{ jobId: string }>();
  const jobId = Number(params?.jobId);
  const router = useRouter();

  const [approverName, setApproverName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  // Pre-fill name from user session
  useEffect(() => {
    apiFetch("/portal/auth/me")
      .then(r => r.json() as Promise<{ user: { full_name: string } }>)
      .then(d => setApproverName(d.user.full_name ?? ""))
      .catch(() => {});
  }, []);

  async function handleApprove(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmed || !approverName.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await apiFetch(`/portal/jobs/${jobId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approver_name: approverName.trim(), confirmed: true }),
      });
      const data = await res.json() as { ok?: boolean; detail?: string };
      if (!res.ok) throw new Error(data.detail ?? "Approval failed");
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <PortalShell>
        <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
          <div className="rounded-full bg-green-100 p-5">
            <CheckCircle2 className="h-10 w-10 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Report approved</h1>
          <p className="text-gray-500 max-w-sm">
            Thank you. Your approval has been recorded. The finalised PDF will be generated automatically and uploaded to your file archive.
          </p>
          <Link
            href="/dashboard"
            className="mt-4 inline-flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold text-white"
            style={{ backgroundColor: BRAND }}
          >
            Back to Dashboard
          </Link>
        </div>
      </PortalShell>
    );
  }

  return (
    <PortalShell>
      <div className="mx-auto max-w-xl space-y-6">
        <div className="flex items-center gap-3">
          <Link href={`/jobs/${jobId}/review`} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
            <ArrowLeft className="h-4 w-4" />
            Back to review
          </Link>
        </div>

        <div>
          <h1 className="text-2xl font-bold text-gray-900">Approve Report</h1>
          <p className="mt-1 text-sm text-gray-500">
            By approving, you confirm this report is accurate and authorise Net Zero International to finalise it.
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <form onSubmit={e => void handleApprove(e)} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Your full name <span className="text-gray-400 font-normal">(for the approval record)</span>
              </label>
              <input
                type="text"
                required
                value={approverName}
                onChange={e => setApproverName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="Your name"
              />
            </div>

            <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
              <strong>Before approving:</strong> Please confirm you have read the full report, all comments have been addressed, and the content is accurate and ready to be finalised.
            </div>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={e => setConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-orange-500"
              />
              <span className="text-sm text-gray-700">
                I confirm I have reviewed this report and approve it for finalisation. I understand this action cannot be undone.
              </span>
            </label>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={submitting || !confirmed || !approverName.trim()}
              className="w-full rounded-lg py-3 text-sm font-semibold text-white disabled:opacity-50 transition-colors"
              style={{ backgroundColor: BRAND }}
            >
              {submitting ? "Submitting approval…" : "Confirm Approval"}
            </button>
          </form>
        </div>
      </div>
    </PortalShell>
  );
}
