"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, setToken } from "@/lib/auth";

type ClientOption = { client_db_id: number; client_name: string };

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Staff client selection state
  const [staffName, setStaffName] = useState("");
  const [staffClients, setStaffClients] = useState<ClientOption[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [selectingClient, setSelectingClient] = useState(false);
  const [issuing, setIssuing] = useState(false);

  // Password reset state
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/portal/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json() as {
        access_token?: string | null;
        needs_client_selection?: boolean;
        staff_name?: string;
        accessible_clients?: ClientOption[];
        detail?: string;
      };
      if (!res.ok) throw new Error(data.detail ?? "Login failed");

      if (data.needs_client_selection) {
        // Staff user — show client picker
        setStaffName(data.staff_name ?? email);
        setStaffClients(data.accessible_clients ?? []);
        setSelectedClientId(data.accessible_clients?.[0]?.client_db_id ?? null);
        setSelectingClient(true);
        return;
      }

      if (data.access_token) setToken(data.access_token);
      router.replace("/dashboard");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleStaffClientSelect(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedClientId) return;
    setIssuing(true);
    setError("");
    try {
      const res = await apiFetch("/portal/auth/staff-select-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, client_db_id: selectedClientId }),
      });
      const data = await res.json() as { access_token?: string; detail?: string };
      if (!res.ok) throw new Error(data.detail ?? "Failed to access client portal");
      if (data.access_token) setToken(data.access_token);
      router.replace("/dashboard");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIssuing(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setResetLoading(true);
    try {
      await apiFetch("/portal/auth/password-reset-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetEmail.trim() }),
      });
      setResetSent(true);
    } catch {
      setResetSent(true);
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold" style={{ color: "#F26624" }}>NZInsights</h1>
          <p className="mt-2 text-sm text-gray-500">Your carbon reporting portal</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          {selectingClient ? (
            /* ── Staff: pick which client to view ── */
            <>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Choose a client portal</h2>
              <p className="text-sm text-gray-500 mb-6">
                Signed in as <span className="font-medium text-gray-700">{staffName}</span> (staff). Select the client portal you want to access.
              </p>
              <form onSubmit={e => void handleStaffClientSelect(e)} className="space-y-4">
                <select
                  value={selectedClientId ?? ""}
                  onChange={e => setSelectedClientId(Number(e.target.value))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  required
                >
                  {staffClients.map(c => (
                    <option key={c.client_db_id} value={c.client_db_id}>{c.client_name}</option>
                  ))}
                </select>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <button
                  type="submit"
                  disabled={issuing || !selectedClientId}
                  className="w-full rounded-lg py-2.5 text-sm font-semibold text-white disabled:opacity-60 transition-colors"
                  style={{ backgroundColor: "#F26624" }}
                >
                  {issuing ? "Opening portal…" : "Open portal"}
                </button>
                <button
                  type="button"
                  onClick={() => { setSelectingClient(false); setError(""); }}
                  className="text-sm text-gray-500 hover:underline"
                >
                  Back to sign in
                </button>
              </form>
            </>
          ) : !showReset ? (
            /* ── Standard sign in ── */
            <>
              <h2 className="text-lg font-semibold text-gray-900 mb-6">Sign in to your account</h2>
              <form onSubmit={e => void handleLogin(e)} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                    autoComplete="current-password"
                  />
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-60"
                  style={{ backgroundColor: "#F26624" }}
                >
                  {loading ? "Signing in…" : "Sign in"}
                </button>
              </form>
              <button
                onClick={() => { setShowReset(true); setResetEmail(email); }}
                className="mt-4 text-sm text-gray-500 hover:text-gray-700 underline"
              >
                Forgot your password?
              </button>
            </>
          ) : (
            /* ── Password reset ── */
            <>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Reset your password</h2>
              {resetSent ? (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">If that email is registered, you&apos;ll receive a reset link shortly. Check your inbox.</p>
                  <button onClick={() => { setShowReset(false); setResetSent(false); }} className="text-sm text-orange-600 hover:underline">
                    Back to sign in
                  </button>
                </div>
              ) : (
                <form onSubmit={e => void handleReset(e)} className="space-y-4">
                  <p className="text-sm text-gray-500">Enter your email and we&apos;ll send a reset link valid for 2 hours.</p>
                  <input
                    type="email"
                    required
                    value={resetEmail}
                    onChange={e => setResetEmail(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                    placeholder="you@example.com"
                  />
                  <button
                    type="submit"
                    disabled={resetLoading}
                    className="w-full rounded-lg py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                    style={{ backgroundColor: "#F26624" }}
                  >
                    {resetLoading ? "Sending…" : "Send reset link"}
                  </button>
                  <button type="button" onClick={() => setShowReset(false)} className="text-sm text-gray-500 hover:underline">
                    Back to sign in
                  </button>
                </form>
              )}
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          &copy; {new Date().getFullYear()} Net Zero International. All rights reserved.
        </p>
      </div>
    </div>
  );
}
