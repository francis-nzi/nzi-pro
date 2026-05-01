"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/auth-client";

type AuthMeResponse = {
  user?: {
    email?: string | null;
    user_id?: string | null;
  } | null;
  current_org?: {
    org_id?: string | null;
    name?: string | null;
  } | null;
};

type AcceptInviteResponse = {
  ok?: boolean;
  org_id?: string;
  email?: string;
  role?: string;
  detail?: string;
};

export default function AcceptInviteClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams?.get("token") || "";
  const nextTarget = searchParams?.get("next") || "/";
  const [loading, setLoading] = useState(Boolean(token));
  const [message, setMessage] = useState(token ? "Checking your sign-in state..." : "");
  const [error, setError] = useState("");
  const [needsSignIn, setNeedsSignIn] = useState(false);

  const loginHref = useMemo(() => {
    const current = `/accept-invite?token=${encodeURIComponent(token)}${nextTarget ? `&next=${encodeURIComponent(nextTarget)}` : ""}`;
    return `/login?next=${encodeURIComponent(current)}`;
  }, [nextTarget, token]);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setError("Missing invitation token.");
      return;
    }

    let cancelled = false;

    async function acceptInvite() {
      try {
        const meRes = await fetch(apiUrl("/auth/me"), {
          credentials: "include",
          headers: { "X-NZI-Skip-Auth-Redirect": "1" },
        });

        if (meRes.status === 401) {
          if (!cancelled) {
            setNeedsSignIn(true);
            setError("");
            setMessage("Please sign in with the invited account to accept this invitation.");
          }
          return;
        }

        if (!meRes.ok) {
          const mePayload = (await meRes.json().catch(() => ({}))) as { detail?: string };
          throw new Error(mePayload.detail || `Unable to verify your session (HTTP ${meRes.status}).`);
        }

        const acceptRes = await fetch(apiUrl(`/admin/organisation-invitations/${encodeURIComponent(token)}/accept`), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-NZI-Skip-Auth-Redirect": "1",
          },
          credentials: "include",
          body: JSON.stringify({}),
        });
        const payload = (await acceptRes.json().catch(() => ({}))) as AcceptInviteResponse;

        if (cancelled) return;

        if (!acceptRes.ok) {
          throw new Error(payload.detail || `Invitation acceptance failed (HTTP ${acceptRes.status}).`);
        }

        setNeedsSignIn(false);
        setMessage(`Invitation accepted for ${payload.email || "your account"}. Redirecting...`);
        setError("");
        window.setTimeout(() => {
          router.replace(nextTarget || "/");
        }, 1800);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Invitation acceptance failed.");
          setMessage("");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void acceptInvite();

    return () => {
      cancelled = true;
    };
  }, [nextTarget, router, token]);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-6 py-10">
        <div className="w-full rounded-xl border bg-card p-6 shadow-sm">
          <h1 className="mb-1 text-2xl font-semibold">Accept invitation</h1>
          <p className="mb-6 text-sm text-muted-foreground">Join the organisation that invited you into NZ Insights Pro</p>
          {loading ? <div className="text-sm text-muted-foreground">{message || "Loading..."}</div> : null}
          {message ? <div className="text-sm text-foreground">{message}</div> : null}
          {error ? <div className="text-sm text-destructive">{error}</div> : null}
          {needsSignIn ? (
            <div className="mt-4 rounded-md border bg-muted/60 p-3 text-sm text-muted-foreground">
              You need to sign in before this invitation can be accepted.
            </div>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-2">
            <Button asChild className="bg-[#1c5026] text-white hover:bg-[#153f1e]">
              <Link href={loginHref}>Sign in to accept</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/">Back to dashboard</Link>
            </Button>
          </div>
          <div className="mt-4 text-xs text-muted-foreground">
            If this invitation was sent to a different email address, sign out and use the invited account instead.
          </div>
        </div>
      </div>
    </div>
  );
}
