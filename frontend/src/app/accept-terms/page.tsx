"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { apiUrl, performLogout, setMustAcceptPortalTerms } from "@/lib/auth-client";

function AcceptTermsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function acceptTerms() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(apiUrl("/auth/accept-portal-terms"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const payload = (await res.json().catch(() => ({}))) as { detail?: string };
      if (!res.ok) {
        setError(payload.detail || `Unable to record acceptance (${res.status}).`);
        return;
      }
      setMustAcceptPortalTerms(false);
      const next = searchParams?.get("next") || "/account/mfa-setup";
      router.replace(next);
    } catch {
      setError("Unable to record acceptance. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-6 py-10">
        <div className="w-full rounded-xl border bg-card p-6 shadow-sm">
          <h1 className="mb-2 text-2xl font-semibold">Accept Portal Terms</h1>
          <p className="mb-6 text-sm text-muted-foreground">
            Please review and accept NZI&apos;s Portal Terms of Use before continuing into the platform.
          </p>
          <div className="space-y-4 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
            <p>
              By accepting, you confirm that you are an authorised user of the NZI platform, will keep your credentials
              secure, and will use the portal only for lawful business purposes connected with NZI services.
            </p>
            <p>
              Review the full documents here:{" "}
              <Link href="/legal#portal-terms" className="underline underline-offset-2 hover:text-foreground">
                Portal Terms of Use
              </Link>
              {", "}
              <Link href="/legal#privacy-policy" className="underline underline-offset-2 hover:text-foreground">
                Privacy Policy
              </Link>
              {" and "}
              <Link href="/legal#cookie-notice" className="underline underline-offset-2 hover:text-foreground">
                Cookie Notice
              </Link>
              .
            </p>
          </div>
          {error ? <div className="mt-4 text-sm text-destructive">{error}</div> : null}
          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={acceptTerms} className="bg-[#1c5026] text-white hover:bg-[#153f1e]" disabled={busy}>
              {busy ? "Saving..." : "I Accept the Portal Terms"}
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                await performLogout();
                setMustAcceptPortalTerms(false);
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

export default function AcceptTermsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <AcceptTermsContent />
    </Suspense>
  );
}
