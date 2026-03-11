"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setAuthState, setMustChangePassword } from "@/lib/auth-client";

type LoginResponse = {
  access_token?: string;
  detail?: string;
  must_change_password?: boolean;
  user?: {
    user_id?: string;
    email?: string;
    must_change_password?: boolean;
  };
};

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);

    try {
      const res = await fetch("/api/backend/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: identifier.trim(),
          password,
        }),
      });

      const payload = (await res.json().catch(() => ({}))) as LoginResponse;
      if (!res.ok) {
        if (res.status === 401) setError("Login failed. Check your credentials.");
        else if (payload.detail) setError(payload.detail);
        else setError(`Login failed (HTTP ${res.status}).`);
        return;
      }

      const token = payload.access_token || null;
      const userIdentity = payload.user?.email || payload.user?.user_id || identifier.trim();
      setAuthState(token, userIdentity || null);

      const forceChange = Boolean(payload.must_change_password || payload.user?.must_change_password);
      setMustChangePassword(forceChange);
      if (forceChange) {
        router.replace("/change-password");
        return;
      }

      const next = searchParams?.get("next") || "/";
      if (typeof window !== "undefined") {
        window.location.assign(next);
        return;
      }
      router.replace(next);
    } catch {
      setError("Login request failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-6">
        <div className="w-full rounded-xl border bg-card p-6 shadow-sm">
          <h1 className="mb-1 text-2xl font-semibold">Sign In</h1>
          <p className="mb-6 text-sm text-muted-foreground">NZI Pro team access</p>

          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <label className="text-sm font-medium">Email or Username</label>
              <Input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="name@company.com"
                autoComplete="username"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Password</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete="current-password"
                required
              />
            </div>

            {error ? <div className="text-sm text-destructive">{error}</div> : null}

            <Button type="submit" className="w-full bg-[#1c5026] text-white hover:bg-[#153f1e]" disabled={busy}>
              {busy ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <LoginPageContent />
    </Suspense>
  );
}
