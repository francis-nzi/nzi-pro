"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiUrl, clearAuthState, setAuthState } from "@/lib/auth-client";

function MfaSetupContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [mfaStatus, setMfaStatus] = useState<{
    mfa_enabled: boolean;
    mfa_enabled_at?: string | null;
    mfa_last_used_at?: string | null;
    mfa_required_for_all_users?: boolean;
    mfa_setup_required?: boolean;
  }>({
    mfa_enabled: false,
  });
  const [currentPassword, setCurrentPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [setupSecret, setSetupSecret] = useState("");
  const [provisioningUri, setProvisioningUri] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [setupStarted, setSetupStarted] = useState(false);

  const nextTarget = searchParams?.get("next") || "/";

  const mfaQrUrl = useMemo(() => {
    const uri = String(provisioningUri || "").trim();
    if (!uri) return "";
    return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(uri)}`;
  }, [provisioningUri]);

  const loadMfaStatus = useCallback(async () => {
    const res = await fetch(apiUrl("/auth/mfa/status"), { credentials: "include" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Failed to load MFA status (${res.status})${text ? `: ${text}` : ""}`);
    }
    const json = await res.json();
    setMfaStatus({
      mfa_enabled: Boolean(json?.mfa_enabled),
      mfa_enabled_at: json?.mfa_enabled_at || null,
      mfa_last_used_at: json?.mfa_last_used_at || null,
      mfa_required_for_all_users: Boolean(json?.mfa_required_for_all_users),
      mfa_setup_required: Boolean(json?.mfa_setup_required),
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        await loadMfaStatus();
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [loadMfaStatus]);

  async function startSetup() {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      if (!currentPassword) throw new Error("Current password is required to start MFA setup.");
      const res = await fetch(apiUrl("/auth/mfa/setup/start"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: currentPassword }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed to start MFA setup (${res.status})${text ? `: ${text}` : ""}`);
      }
      const json = await res.json();
      setSetupSecret(String(json?.secret || ""));
      setProvisioningUri(String(json?.provisioning_uri || ""));
      setSetupStarted(true);
      setStatus("MFA setup started. Scan the QR code or enter the manual key in your authenticator app.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function verifySetup() {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      if (!otpCode) throw new Error("Enter the 6-digit authenticator code.");
      const res = await fetch(apiUrl("/auth/mfa/setup/verify"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp_code: otpCode }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed to verify MFA setup (${res.status})${text ? `: ${text}` : ""}`);
      }
      const json = await res.json();
      const accessToken = String(json?.access_token || "");
      const userIdentity = String(json?.user?.email || json?.user?.user_id || "");
      if (accessToken || userIdentity) {
        setAuthState(accessToken || null, userIdentity || null);
      }
      setRecoveryCodes(Array.isArray(json?.recovery_codes) ? json.recovery_codes : []);
      setOtpCode("");
      setSetupStarted(false);
      await loadMfaStatus();
      setStatus("MFA is now enabled. Save your recovery codes securely.");
      router.replace(nextTarget);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <PageHeader
          title="Set Up MFA"
          subtitle="Complete multi-factor authentication before continuing"
          breadcrumbs={[{ label: "Account" }, { label: "MFA Setup" }]}
        />

        <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          This step is required before you continue into the rest of the platform.
        </div>

        {loading ? <div className="mb-4 text-sm text-muted-foreground">Loading MFA status...</div> : null}
        {error ? <div className="mb-4 text-sm text-destructive">{error}</div> : null}
        {status ? <div className="mb-4 text-sm text-green-700">{status}</div> : null}

        <Card>
          <CardHeader>
            <CardTitle>Multi-Factor Authentication (MFA)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {mfaStatus.mfa_required_for_all_users ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Multi-factor authentication is required for all users. Please complete setup before continuing.
              </div>
            ) : null}
            <div className="text-sm">
              Status:{" "}
              <span className={mfaStatus.mfa_enabled ? "font-medium text-green-700" : "text-muted-foreground"}>
                {mfaStatus.mfa_enabled ? "Enabled" : "Disabled"}
              </span>
            </div>
            {!mfaStatus.mfa_enabled ? (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="md:col-span-1">
                    <Label>Current Password</Label>
                    <Input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Authenticator Code</Label>
                    <Input value={otpCode} onChange={(e) => setOtpCode(e.target.value)} placeholder="123456" />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" disabled={saving} onClick={() => void startSetup()}>
                    Start MFA Setup
                  </Button>
                  {setupStarted ? (
                    <Button disabled={saving} onClick={() => void verifySetup()}>
                      Verify & Enable MFA
                    </Button>
                  ) : null}
                </div>
                {setupStarted ? (
                  <div className="rounded-md border p-3 text-sm space-y-2">
                    <div className="font-medium">Setup details</div>
                    {mfaQrUrl ? (
                      <div className="space-y-2">
                        <div>Scan this QR code in your authenticator app:</div>
                        <img
                          src={mfaQrUrl}
                          alt="MFA provisioning QR code"
                          width={220}
                          height={220}
                          className="rounded border bg-white p-1"
                        />
                      </div>
                    ) : null}
                    <div>
                      Manual key: <code>{setupSecret || "-"}</code>
                    </div>
                    <div className="break-all">
                      Provisioning URI: <code>{provisioningUri || "-"}</code>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                MFA is already enabled for this account. Continue to the platform when you&apos;re ready.
              </div>
            )}
            {recoveryCodes.length > 0 ? (
              <div className="rounded-md border p-3 text-sm space-y-2">
                <div className="font-medium">Recovery codes (save these securely)</div>
                <div className="grid gap-1 md:grid-cols-2">
                  {recoveryCodes.map((code) => (
                    <code key={code}>{code}</code>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <Button variant="ghost" asChild>
                <Link href="/legal">Review legal documents</Link>
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  clearAuthState();
                  router.replace("/login");
                }}
              >
                Sign out
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function MfaSetupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <MfaSetupContent />
    </Suspense>
  );
}
