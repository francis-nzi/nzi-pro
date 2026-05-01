"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/auth-client";

type VerifyResponse = {
  ok?: boolean;
  verified?: boolean;
  message?: string;
  user_id?: string;
  email?: string;
  org_id?: string;
  verified_at?: string;
  detail?: string;
};

function RegisterVerifyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams?.get("token") || "";
  const email = searchParams?.get("email") || "";
  const [loading, setLoading] = useState(Boolean(token));
  const [message, setMessage] = useState(token ? "Verifying your account..." : "");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setError("Missing verification token.");
      return;
    }

    let cancelled = false;
    async function verify() {
      try {
        const res = await fetch(apiUrl("/auth/register/verify"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const payload = (await res.json().catch(() => ({}))) as VerifyResponse;
        if (cancelled) return;
        if (!res.ok) {
          setError(payload.detail || payload.message || `Verification failed (HTTP ${res.status}).`);
          setMessage("");
          return;
        }
        setMessage(payload.message || "Email verified successfully. You can now sign in.");
        setError("");
        window.setTimeout(() => {
          router.replace("/login?verified=1");
        }, 2200);
      } catch {
        if (!cancelled) {
          setError("Verification request failed. Please try again.");
          setMessage("");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void verify();
    return () => {
      cancelled = true;
    };
  }, [router, token]);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-6 py-10">
        <div className="w-full rounded-xl border bg-card p-6 shadow-sm">
          <h1 className="mb-1 text-2xl font-semibold">Verify email</h1>
          <p className="mb-6 text-sm text-muted-foreground">Finish activating your NZ Insights Pro account</p>
          {loading ? <div className="text-sm text-muted-foreground">{message || "Verifying..."}</div> : null}
          {message ? <div className="text-sm text-foreground">{message}</div> : null}
          {error ? <div className="text-sm text-destructive">{error}</div> : null}
          {email && !token ? <div className="text-sm text-muted-foreground">Requested for: {email}</div> : null}
          <div className="mt-6 flex gap-2">
            <Button asChild className="bg-[#1c5026] text-white hover:bg-[#153f1e]">
              <Link href="/login">Go to sign in</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/register">Back to register</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RegisterVerifyPage;
