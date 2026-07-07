"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, clearPartialToken, setPartialToken, setToken } from "@/lib/auth";

import { BRAND } from "@/lib/brand";
type ClientOption = { client_db_id: number; client_name: string };

function ClientPicker({
  clients,
  value,
  onChange,
}: {
  clients: ClientOption[];
  value: number | null;
  onChange: (id: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = clients.find(c => c.client_db_id === value);
  const filtered = query.trim()
    ? clients.filter(c => c.client_name.toLowerCase().includes(query.toLowerCase()))
    : clients;

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutsideClick);
    return () => document.removeEventListener("mousedown", onOutsideClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen(v => !v); setQuery(""); }}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-left flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-orange-400"
      >
        <span className={selected ? "text-gray-900" : "text-gray-400"}>
          {selected ? selected.client_name : "Select a client…"}
        </span>
        <span className="text-gray-400 ml-2">▾</span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="p-2 border-b border-gray-100">
            <input
              autoFocus
              type="text"
              placeholder="Search clients…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
          <ul className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-gray-400">No clients found</li>
            ) : (
              filtered.map(c => (
                <li
                  key={c.client_db_id}
                  onClick={() => { onChange(c.client_db_id); setOpen(false); setQuery(""); }}
                  className={`cursor-pointer px-3 py-2 text-sm hover:bg-orange-50 ${value === c.client_db_id ? "font-semibold text-orange-600" : "text-gray-800"}`}
                >
                  {c.client_name}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

type LoginStep =
  | "credentials"
  | "mfa_challenge"
  | "staff_client_picker"
  | "reset_request"
  | "reset_sent";

export default function LoginPage() {
  const router = useRouter();

  const [step, setStep] = useState<LoginStep>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // MFA challenge state
  const [mfaChallengeToken, setMfaChallengeToken] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");

  // Staff client selection state
  const [staffName, setStaffName] = useState("");
  const [staffClients, setStaffClients] = useState<ClientOption[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [issuing, setIssuing] = useState(false);

  // Password reset state
  const [resetEmail, setResetEmail] = useState("");
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
        ok?: boolean;
        // staff path
        needs_client_selection?: boolean;
        staff_name?: string;
        accessible_clients?: ClientOption[];
        // MFA already set up — challenge required
        mfa_required?: boolean;
        mfa_challenge_token?: string;
        // MFA not yet set up — onboarding
        mfa_setup_required?: boolean;
        must_accept_tac?: boolean;
        partial_token?: string;
        detail?: string;
      };
      if (!res.ok) throw new Error(data.detail ?? "Login failed");

      if (data.needs_client_selection) {
        setStaffName(data.staff_name ?? email);
        setStaffClients(data.accessible_clients ?? []);
        setSelectedClientId(null);
        setError("");
        setStep("staff_client_picker");
        return;
      }

      if (data.mfa_required && data.mfa_challenge_token) {
        setMfaChallengeToken(data.mfa_challenge_token);
        setStep("mfa_challenge");
        return;
      }

      if (data.mfa_setup_required && data.partial_token) {
        setPartialToken(data.partial_token);
        // T&C must come first if needed, then MFA setup
        if (data.must_accept_tac) {
          router.replace("/accept-terms");
        } else {
          router.replace("/setup-mfa");
        }
        return;
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaVerify(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const body = showRecovery
        ? { recovery_code: recoveryCode.trim() }
        : { otp_code: otpCode.trim() };

      const res = await fetch("/api/backend/portal/auth/mfa-verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${mfaChallengeToken}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json() as {
        ok?: boolean;
        access_token?: string;
        partial_token?: string;
        must_accept_tac?: boolean;
        mfa_setup_required?: boolean;
        detail?: string;
      };
      if (!res.ok) throw new Error(data.detail ?? "Verification failed");

      if (data.access_token) {
        setToken(data.access_token);
        router.replace("/dashboard");
        return;
      }

      if (data.partial_token) {
        setPartialToken(data.partial_token);
        router.replace(data.must_accept_tac ? "/accept-terms" : "/setup-mfa");
      }
    } catch (err) {
      setError((err as Error).message);
      setOtpCode("");
      setRecoveryCode("");
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
    } catch {
      // Intentionally swallow — always show "sent" to prevent enumeration
    } finally {
      setResetLoading(false);
      setStep("reset_sent");
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold" style={{ color: BRAND }}>NZInsights</h1>
          <p className="mt-2 text-sm text-gray-500">Your carbon reporting portal</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">

          {step === "staff_client_picker" && (
            <>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Choose a client portal</h2>
              <p className="text-sm text-gray-500 mb-6">
                Signed in as <span className="font-medium text-gray-700">{staffName}</span> (staff). Select the client portal you want to access.
              </p>
              <form onSubmit={e => void handleStaffClientSelect(e)} className="space-y-4">
                <ClientPicker clients={staffClients} value={selectedClientId} onChange={setSelectedClientId} />
                {error && <p className="text-sm text-red-600">{error}</p>}
                <button
                  type="submit"
                  disabled={issuing || !selectedClientId}
                  className="w-full rounded-lg py-2.5 text-sm font-semibold text-white disabled:opacity-60 transition-colors"
                  style={{ backgroundColor: BRAND }}
                >
                  {issuing ? "Opening portal…" : "Open portal"}
                </button>
                <button
                  type="button"
                  onClick={() => { setStep("credentials"); setError(""); }}
                  className="text-sm text-gray-500 hover:underline"
                >
                  Back to sign in
                </button>
              </form>
            </>
          )}

          {step === "mfa_challenge" && (
            <>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Two-factor authentication</h2>
              <p className="text-sm text-gray-500 mb-6">
                {showRecovery
                  ? "Enter one of your recovery codes."
                  : "Enter the 6-digit code from your authenticator app."}
              </p>
              <form onSubmit={e => void handleMfaVerify(e)} className="space-y-4">
                {!showRecovery ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Authenticator code</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      required
                      autoFocus
                      value={otpCode}
                      onChange={e => setOtpCode(e.target.value.replace(/\D/g, ""))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-center tracking-[0.3em] text-xl focus:outline-none focus:ring-2 focus:ring-orange-400"
                      placeholder="000000"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Recovery code</label>
                    <input
                      type="text"
                      required
                      autoFocus
                      value={recoveryCode}
                      onChange={e => setRecoveryCode(e.target.value.toUpperCase())}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-center tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-orange-400"
                      placeholder="XXXXXX-XXXXXX"
                    />
                  </div>
                )}

                {error && <p className="text-sm text-red-600">{error}</p>}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg py-2.5 text-sm font-semibold text-white disabled:opacity-60 transition-colors"
                  style={{ backgroundColor: BRAND }}
                >
                  {loading ? "Verifying…" : "Verify"}
                </button>
              </form>

              <div className="mt-4 space-y-2">
                <button
                  type="button"
                  onClick={() => { setShowRecovery(v => !v); setOtpCode(""); setRecoveryCode(""); setError(""); }}
                  className="text-sm text-gray-500 hover:underline"
                >
                  {showRecovery ? "Use authenticator app instead" : "Use a recovery code instead"}
                </button>
                <br />
                <button
                  type="button"
                  onClick={() => { setStep("credentials"); setMfaChallengeToken(""); setError(""); }}
                  className="text-sm text-gray-400 hover:underline"
                >
                  Back to sign in
                </button>
              </div>
            </>
          )}

          {step === "credentials" && (
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
                  style={{ backgroundColor: BRAND }}
                >
                  {loading ? "Signing in…" : "Sign in"}
                </button>
              </form>
              <button
                onClick={() => { setStep("reset_request"); setResetEmail(email); }}
                className="mt-4 text-sm text-gray-500 hover:text-gray-700 underline"
              >
                Forgot your password?
              </button>
            </>
          )}

          {step === "reset_request" && (
            <>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Reset your password</h2>
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
                  style={{ backgroundColor: BRAND }}
                >
                  {resetLoading ? "Sending…" : "Send reset link"}
                </button>
                <button type="button" onClick={() => setStep("credentials")} className="text-sm text-gray-500 hover:underline">
                  Back to sign in
                </button>
              </form>
            </>
          )}

          {step === "reset_sent" && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Check your inbox</h2>
              <p className="text-sm text-gray-600">If that email is registered, you&apos;ll receive a reset link shortly.</p>
              <button onClick={() => { setStep("credentials"); }} className="text-sm text-orange-600 hover:underline">
                Back to sign in
              </button>
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          &copy; {new Date().getFullYear()} Net Zero International. All rights reserved.
        </p>
      </div>
    </div>
  );
}
