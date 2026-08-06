"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, clearAllTokens, getPartialToken, setToken } from "@/lib/auth";

import { BRAND } from "@/lib/brand";
export default function AcceptTermsPage() {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleAccept(e: React.FormEvent) {
    e.preventDefault();
    if (!accepted) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/portal/auth/accept-tac", { method: "POST" });
      const data = await res.json() as {
        ok?: boolean;
        accepted_tac_version?: string;
        mfa_setup_required?: boolean;
        detail?: string;
      };
      if (!res.ok) throw new Error(data.detail ?? "Could not record acceptance");
      if (data.mfa_setup_required) {
        router.replace("/setup-mfa");
      } else {
        router.replace("/dashboard");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function handleDecline() {
    clearAllTokens();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/netzero-logo.png"
            alt="Net Zero International"
            className="mx-auto h-12 w-auto object-contain"
          />
          <h1 className="mt-3 text-2xl font-bold" style={{ color: BRAND }}>NZ Insights Pro</h1>
          <p className="mt-1 text-sm text-gray-500">Terms &amp; Conditions</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Before you continue</h2>
          <p className="text-sm text-gray-500 mb-6">
            Please read and accept our Terms &amp; Conditions to access your NZInsights portal.
          </p>

          <div className="h-72 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-5 text-sm text-gray-700 leading-relaxed mb-6">
            <p className="font-semibold mb-3">NZInsights Client Portal — Terms &amp; Conditions (Version 2026-v1)</p>

            <p className="mb-3">
              These Terms &amp; Conditions (&quot;Terms&quot;) govern your access to and use of the NZInsights Client Portal
              (&quot;Portal&quot;) operated by Net Zero International Ltd (&quot;NZI&quot;, &quot;we&quot;, &quot;us&quot;, &quot;our&quot;).
            </p>

            <p className="font-medium mb-1">1. Acceptance</p>
            <p className="mb-3">
              By accessing or using the Portal you agree to be bound by these Terms. If you do not agree, you must not
              access the Portal.
            </p>

            <p className="font-medium mb-1">2. Access and Authorisation</p>
            <p className="mb-3">
              Access is granted by NZI to named individuals associated with the relevant client organisation. Your
              access credentials are personal to you and must not be shared. You are responsible for all activity that
              occurs under your account.
            </p>

            <p className="font-medium mb-1">3. Data and Confidentiality</p>
            <p className="mb-3">
              All data, reports and materials available via the Portal are confidential and proprietary to NZI and/or
              the relevant client. You must not copy, distribute or disclose any such materials to any third party
              without NZI&apos;s prior written consent.
            </p>

            <p className="font-medium mb-1">4. Acceptable Use</p>
            <p className="mb-3">
              You must not attempt to gain unauthorised access to any part of the Portal or related systems, or
              interfere with the integrity or performance of the Portal.
            </p>

            <p className="font-medium mb-1">5. Intellectual Property</p>
            <p className="mb-3">
              All content, software and materials provided via the Portal are owned by or licensed to NZI and are
              protected by applicable intellectual property laws.
            </p>

            <p className="font-medium mb-1">6. Limitation of Liability</p>
            <p className="mb-3">
              To the maximum extent permitted by law, NZI shall not be liable for any indirect, incidental, special or
              consequential damages arising from your use of the Portal.
            </p>

            <p className="font-medium mb-1">7. Governing Law</p>
            <p className="mb-3">
              These Terms are governed by the laws of England and Wales. Any disputes shall be subject to the exclusive
              jurisdiction of the courts of England and Wales.
            </p>

            <p className="font-medium mb-1">8. Changes to Terms</p>
            <p>
              NZI reserves the right to update these Terms at any time. You will be asked to re-accept any material
              updates before continuing to access the Portal.
            </p>
          </div>

          <form onSubmit={e => void handleAccept(e)} className="space-y-5">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={accepted}
                onChange={e => setAccepted(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-orange-500"
              />
              <span className="text-sm text-gray-700">
                I have read and agree to the NZInsights Portal Terms &amp; Conditions.
              </span>
            </label>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={!accepted || loading}
                className="flex-1 rounded-lg py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition-colors"
                style={{ backgroundColor: BRAND }}
              >
                {loading ? "Saving…" : "Accept & continue"}
              </button>
              <button
                type="button"
                onClick={handleDecline}
                className="flex-1 rounded-lg py-2.5 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
              >
                Decline &amp; sign out
              </button>
            </div>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          &copy; {new Date().getFullYear()} Net Zero International. All rights reserved.
        </p>
      </div>
    </div>
  );
}
