"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiUrl } from "@/lib/auth-client";

type RegisterResponse = {
  ok?: boolean;
  message?: string;
  verification_required?: boolean;
  org_id?: string;
  org_name?: string;
  email?: string;
  trial_ends_at?: string | null;
  verification_expires_at?: string | null;
  email_status?: string;
  email_error?: string | null;
  detail?: string;
};

function RegisterPage() {
  const [fullName, setFullName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [emailStatus, setEmailStatus] = useState("");
  const [verificationExpiresAt, setVerificationExpiresAt] = useState("");
  const [resendBusy, setResendBusy] = useState(false);

  async function submitRegister(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setEmailStatus("");
    setVerificationExpiresAt("");
    setBusy(true);
    try {
      const res = await fetch(apiUrl("/auth/register"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName.trim(),
          org_name: orgName.trim(),
          email: email.trim(),
          password,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as RegisterResponse;
      if (!res.ok) {
        setError(payload.detail || payload.message || `Registration failed (HTTP ${res.status}).`);
        return;
      }
      setMessage(payload.message || "Registration created. Check your email to verify your account.");
      setEmailStatus(String(payload.email_status || ""));
      setVerificationExpiresAt(String(payload.verification_expires_at || ""));
      setEmail(payload.email || email.trim());
    } catch {
      setError("Registration request failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    setResendBusy(true);
    setError("");
    try {
      const res = await fetch(apiUrl("/auth/register/resend-verification"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: email.trim() }),
      });
      const payload = (await res.json().catch(() => ({}))) as RegisterResponse;
      if (!res.ok) {
        setError(payload.detail || `Resend failed (HTTP ${res.status}).`);
        return;
      }
      setMessage(payload.message || "Verification email sent.");
      setEmailStatus(String(payload.email_status || ""));
    } catch {
      setError("Resend request failed. Please try again.");
    } finally {
      setResendBusy(false);
    }
  }

  const canResend = Boolean(email.trim() && (message || emailStatus || error));

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-6 py-10">
        <div className="w-full rounded-xl border bg-card p-6 shadow-sm">
          <h1 className="mb-1 text-2xl font-semibold">Create your account</h1>
          <p className="mb-6 text-sm text-muted-foreground">Start a 14-day NZ Insights Pro trial</p>

          <form className="space-y-4" onSubmit={submitRegister}>
            <div className="space-y-2">
              <label className="text-sm font-medium">Organisation name</label>
              <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Shredit ME" required />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Your full name</label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Smith" required />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Work email</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                autoComplete="email"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Password</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a strong password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <div className="text-xs text-muted-foreground">
              Your account will be created as the organisation owner and starts in a 14-day trial once verified.
            </div>
            {error ? <div className="text-sm text-destructive">{error}</div> : null}
            {message ? <div className="text-sm text-foreground">{message}</div> : null}
            {verificationExpiresAt ? (
              <div className="rounded-md border bg-muted p-3 text-xs text-muted-foreground">
                Verification link expires: {verificationExpiresAt}
              </div>
            ) : null}
            <Button type="submit" className="w-full bg-[#1c5026] text-white hover:bg-[#153f1e]" disabled={busy}>
              {busy ? "Creating account..." : "Create account"}
            </Button>
            {canResend ? (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => void resendVerification()}
                disabled={resendBusy || !canResend}
              >
                {resendBusy ? "Resending..." : "Resend verification email"}
              </Button>
            ) : null}
            <div className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="font-medium underline underline-offset-2 hover:text-foreground">
                Sign in
              </Link>
            </div>
            <div className="text-center text-xs text-muted-foreground">
              By creating an account, you agree to the{" "}
              <Link href="/legal#portal-terms" className="underline underline-offset-2 hover:text-foreground">
                Portal Terms of Use
              </Link>
              {" and acknowledge the "}
              <Link href="/legal#privacy-policy" className="underline underline-offset-2 hover:text-foreground">
                Privacy Policy
              </Link>
              .
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default RegisterPage;
