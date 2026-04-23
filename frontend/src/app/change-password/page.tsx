"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiUrl, clearAuthState, mustAcceptPortalTerms, setMustChangePassword } from "@/lib/auth-client";

function ChangePasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setOk("");

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirm password do not match.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(apiUrl("/auth/change-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
          confirm_password: confirmPassword,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { detail?: string; message?: string };
      if (!res.ok) {
        setError(payload.detail || "Password change failed.");
        return;
      }

      setMustChangePassword(false);
      setOk(payload.message || "Password changed.");
      const next = searchParams?.get("next");
      const fallback = mustAcceptPortalTerms()
        ? "/accept-terms?next=%2Faccount%2Fmfa-setup"
        : "/account/mfa-setup";
      setTimeout(() => router.replace(next || fallback), 600);
    } catch {
      setError("Password change request failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-6">
        <div className="w-full rounded-xl border bg-card p-6 shadow-sm">
          <h1 className="mb-1 text-2xl font-semibold">Change Password</h1>
          <p className="mb-6 text-sm text-muted-foreground">You must change your temporary password to continue.</p>
          <p className="mb-6 text-xs text-muted-foreground">
            Legal documents are available in{" "}
            <Link href="/legal" className="underline underline-offset-2 hover:text-foreground">
              Legal Documents
            </Link>
            .
          </p>

          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <label className="text-sm font-medium">Current Password</label>
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">New Password</label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Confirm New Password</label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>

            {error ? <div className="text-sm text-destructive">{error}</div> : null}
            {ok ? <div className="text-sm text-green-700">{ok}</div> : null}

            <Button type="submit" className="w-full bg-[#1c5026] text-white hover:bg-[#153f1e]" disabled={busy}>
              {busy ? "Updating..." : "Update Password"}
            </Button>
          </form>

          <div className="mt-4 text-center">
            <Button
              variant="ghost"
              onClick={() => {
                clearAuthState();
                router.replace("/login");
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ChangePasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <ChangePasswordContent />
    </Suspense>
  );
}
