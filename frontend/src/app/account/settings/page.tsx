"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { setAuthState } from "@/lib/auth-client";

type EmailSignatureEditorProps = {
  value: string;
  onChange: (html: string) => void;
};

function EmailSignatureEditor({ value, onChange }: EmailSignatureEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [showHtml, setShowHtml] = useState(false);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (el.innerHTML !== value) {
      el.innerHTML = value || "";
    }
  }, [value]);

  function runCommand(command: string, commandValue?: string) {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    try {
      document.execCommand(command, false, commandValue);
    } catch {
      // no-op fallback
    }
    onChange(el.innerHTML);
  }

  function insertLink() {
    const href = window.prompt("Enter link URL (https://...)");
    if (!href) return;
    runCommand("createLink", href.trim());
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => runCommand("bold")}>Bold</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => runCommand("italic")}>Italic</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => runCommand("underline")}>Underline</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => runCommand("insertUnorderedList")}>Bullets</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => runCommand("insertOrderedList")}>Numbered</Button>
        <Button type="button" variant="outline" size="sm" onClick={insertLink}>Link</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => runCommand("removeFormat")}>Clear Format</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => runCommand("undo")}>Undo</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => runCommand("redo")}>Redo</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setShowHtml((v) => !v)}>
          {showHtml ? "Hide HTML" : "View HTML"}
        </Button>
      </div>

      <div
        ref={editorRef}
        className="min-h-[180px] rounded-md border bg-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        contentEditable
        suppressContentEditableWarning
        onInput={() => onChange(editorRef.current?.innerHTML || "")}
      />

      {showHtml ? (
        <Textarea
          rows={6}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="<p><strong>Your Name</strong><br/>Role<br/><a href='mailto:you@company.com'>you@company.com</a></p>"
        />
      ) : null}
    </div>
  );
}

function apiBaseUrl(): string {
  return "/api/backend";
}

function AccountSettingsContent() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [profile, setProfile] = useState({
    user_id: "",
    email: "",
    full_name: "",
    role: "",
    position: "",
    mobile_phone: "",
  });
  const [settings, setSettings] = useState({
    timezone: "Europe/London",
    date_format: "DD/MM/YYYY",
    locale: "en-GB",
    default_currency: "GBP",
    theme_preference: "system",
    email_notifications: true,
    weekly_digest: false,
    email_signature_html: "",
  });

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mfaStatus, setMfaStatus] = useState<{
    mfa_enabled: boolean;
    mfa_enabled_at?: string | null;
    mfa_last_used_at?: string | null;
    mfa_required_for_all_users?: boolean;
    mfa_setup_required?: boolean;
  }>({
    mfa_enabled: false,
  });
  const [mfaPassword, setMfaPassword] = useState("");
  const [mfaOtp, setMfaOtp] = useState("");
  const [mfaRecoveryCode, setMfaRecoveryCode] = useState("");
  const [mfaSetupSecret, setMfaSetupSecret] = useState("");
  const [mfaProvisioningUri, setMfaProvisioningUri] = useState("");
  const [mfaRecoveryCodes, setMfaRecoveryCodes] = useState<string[]>([]);
  const [mfaSetupStarted, setMfaSetupStarted] = useState(false);
  const mfaQrUrl = useMemo(() => {
    const uri = String(mfaProvisioningUri || "").trim();
    if (!uri) return "";
    return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(uri)}`;
  }, [mfaProvisioningUri]);

  const loadMfaStatus = useCallback(async () => {
    const res = await fetch(`${baseUrl}/auth/mfa/status`, { credentials: "include" });
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
  }, [baseUrl]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`${baseUrl}/auth/account-settings`, { credentials: "include" });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Failed to load account settings (${res.status})${text ? `: ${text}` : ""}`);
        }
        const json = await res.json();
        if (cancelled) return;
        setProfile((prev) => ({ ...prev, ...(json?.user || {}) }));
        setSettings((prev) => ({ ...prev, ...(json?.settings || {}) }));
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
  }, [baseUrl, loadMfaStatus]);

  async function saveSettings() {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/auth/account-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          full_name: profile.full_name,
          position: profile.position,
          mobile_phone: profile.mobile_phone,
          timezone: settings.timezone,
          date_format: settings.date_format,
          locale: settings.locale,
          default_currency: settings.default_currency,
          theme_preference: settings.theme_preference,
          email_notifications: settings.email_notifications,
          weekly_digest: settings.weekly_digest,
          email_signature_html: settings.email_signature_html,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed to save settings (${res.status})${text ? `: ${text}` : ""}`);
      }
      setStatus("Account settings saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function changePassword() {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      if (!currentPassword || !newPassword) throw new Error("Current and new password are required.");
      if (newPassword !== confirmPassword) throw new Error("New password and confirm password do not match.");
      const res = await fetch(`${baseUrl}/auth/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
          confirm_password: confirmPassword,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed to change password (${res.status})${text ? `: ${text}` : ""}`);
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setStatus("Password changed.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function startMfaSetup() {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      if (!mfaPassword) throw new Error("Current password is required to start MFA setup.");
      const res = await fetch(`${baseUrl}/auth/mfa/setup/start`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: mfaPassword }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed to start MFA setup (${res.status})${text ? `: ${text}` : ""}`);
      }
      const json = await res.json();
      setMfaSetupSecret(String(json?.secret || ""));
      setMfaProvisioningUri(String(json?.provisioning_uri || ""));
      setMfaSetupStarted(true);
      setStatus("MFA setup started. Add the account in your authenticator app and verify with a code.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function verifyMfaSetup() {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      if (!mfaOtp) throw new Error("Enter the 6-digit authenticator code.");
      const res = await fetch(`${baseUrl}/auth/mfa/setup/verify`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp_code: mfaOtp }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed to verify MFA setup (${res.status})${text ? `: ${text}` : ""}`);
      }
      const json = await res.json();
      const accessToken = String(json?.access_token || "");
      if (accessToken) {
        setAuthState(accessToken || null);
      }
      setMfaRecoveryCodes(Array.isArray(json?.recovery_codes) ? json.recovery_codes : []);
      setMfaOtp("");
      setMfaSetupStarted(false);
      await loadMfaStatus();
      setStatus("MFA is now enabled. Save your recovery codes securely.");
      const next = searchParams?.get("next") || "/";
      router.replace(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function disableMfa() {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      if (!mfaPassword) throw new Error("Current password is required.");
      if (!mfaOtp && !mfaRecoveryCode) throw new Error("Enter authenticator code or recovery code.");
      const res = await fetch(`${baseUrl}/auth/mfa/disable`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: mfaPassword,
          otp_code: mfaOtp || undefined,
          recovery_code: mfaRecoveryCode || undefined,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed to disable MFA (${res.status})${text ? `: ${text}` : ""}`);
      }
      setMfaOtp("");
      setMfaRecoveryCode("");
      setMfaSetupSecret("");
      setMfaProvisioningUri("");
      setMfaRecoveryCodes([]);
      setMfaSetupStarted(false);
      await loadMfaStatus();
      setStatus("MFA disabled.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function regenerateRecoveryCodes() {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      if (!mfaPassword || !mfaOtp) throw new Error("Current password and authenticator code are required.");
      const res = await fetch(`${baseUrl}/auth/mfa/recovery-codes/regenerate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: mfaPassword,
          otp_code: mfaOtp,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed to regenerate recovery codes (${res.status})${text ? `: ${text}` : ""}`);
      }
      const json = await res.json();
      setMfaRecoveryCodes(Array.isArray(json?.recovery_codes) ? json.recovery_codes : []);
      setStatus("Recovery codes regenerated. Save them securely.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <PageHeader
          title="Account Settings"
          subtitle="User profile, security, and personalization"
          breadcrumbs={[{ label: "Account" }, { label: "Settings" }]}
        />

        {loading ? <div className="mb-4 text-sm text-muted-foreground">Loading settings...</div> : null}
        {error ? <div className="mb-4 text-sm text-destructive">{error}</div> : null}
        {status ? <div className="mb-4 text-sm text-green-700">{status}</div> : null}

        <div className="grid gap-6">
          <Card>
            <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div><Label>User ID</Label><Input value={profile.user_id} readOnly /></div>
              <div><Label>Email</Label><Input value={profile.email} readOnly /></div>
              <div><Label>Full Name</Label><Input value={profile.full_name} onChange={(e) => setProfile((p) => ({ ...p, full_name: e.target.value }))} /></div>
              <div><Label>Role</Label><Input value={profile.role} readOnly /></div>
              <div><Label>Position</Label><Input value={profile.position} onChange={(e) => setProfile((p) => ({ ...p, position: e.target.value }))} /></div>
              <div><Label>Mobile</Label><Input value={profile.mobile_phone} onChange={(e) => setProfile((p) => ({ ...p, mobile_phone: e.target.value }))} /></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Preferences</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <div>
                <Label>Timezone</Label>
                <Input value={settings.timezone} onChange={(e) => setSettings((s) => ({ ...s, timezone: e.target.value }))} />
              </div>
              <div>
                <Label>Date Format</Label>
                <Select value={settings.date_format} onValueChange={(v) => setSettings((s) => ({ ...s, date_format: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                    <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                    <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Locale</Label>
                <Input value={settings.locale} onChange={(e) => setSettings((s) => ({ ...s, locale: e.target.value }))} />
              </div>
              <div>
                <Label>Default Currency</Label>
                <Input value={settings.default_currency} onChange={(e) => setSettings((s) => ({ ...s, default_currency: e.target.value.toUpperCase() }))} />
              </div>
              <div>
                <Label>Theme Preference</Label>
                <Select value={settings.theme_preference} onValueChange={(v) => setSettings((s) => ({ ...s, theme_preference: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">System</SelectItem>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 pt-6">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={settings.email_notifications}
                    onChange={(e) => setSettings((s) => ({ ...s, email_notifications: e.target.checked }))}
                  />
                  Email notifications enabled
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={settings.weekly_digest}
                    onChange={(e) => setSettings((s) => ({ ...s, weekly_digest: e.target.checked }))}
                  />
                  Weekly digest enabled
                </label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Email Signature</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <EmailSignatureEditor
                value={settings.email_signature_html}
                onChange={(html) => setSettings((s) => ({ ...s, email_signature_html: html }))}
              />
              <div className="text-xs text-muted-foreground">This signature is appended to all system-sent emails from your account.</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Security</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <div><Label>Current Password</Label><Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} /></div>
              <div><Label>New Password</Label><Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></div>
              <div><Label>Confirm Password</Label><Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} /></div>
              <div className="md:col-span-3">
                <Button variant="outline" disabled={saving} onClick={() => void changePassword()}>Reset Password</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Multi-Factor Authentication (MFA)</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {mfaStatus.mfa_required_for_all_users ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Multi-factor authentication is required for all users. Please complete setup before continuing.
                </div>
              ) : null}
              {searchParams?.get("mfa") === "setup" && !mfaStatus.mfa_enabled ? (
                <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                  Complete MFA setup here to continue into the rest of the platform.
                </div>
              ) : null}
              <div className="text-sm">
                Status:{" "}
                <span className={mfaStatus.mfa_enabled ? "text-green-700 font-medium" : "text-muted-foreground"}>
                  {mfaStatus.mfa_enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="md:col-span-1">
                  <Label>Current Password</Label>
                  <Input type="password" value={mfaPassword} onChange={(e) => setMfaPassword(e.target.value)} />
                </div>
                <div>
                  <Label>Authenticator Code</Label>
                  <Input value={mfaOtp} onChange={(e) => setMfaOtp(e.target.value)} placeholder="123456" />
                </div>
                <div>
                  <Label>Recovery Code</Label>
                  <Input value={mfaRecoveryCode} onChange={(e) => setMfaRecoveryCode(e.target.value)} placeholder="ABCD-1234" />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {!mfaStatus.mfa_enabled ? (
                  <>
                    <Button variant="outline" disabled={saving} onClick={() => void startMfaSetup()}>Start MFA Setup</Button>
                    {mfaSetupStarted ? (
                      <Button disabled={saving} onClick={() => void verifyMfaSetup()}>Verify & Enable MFA</Button>
                    ) : null}
                  </>
                ) : (
                  <>
                    <Button variant="outline" disabled={saving} onClick={() => void regenerateRecoveryCodes()}>Regenerate Recovery Codes</Button>
                    <Button variant="outline" disabled={saving || Boolean(mfaStatus.mfa_required_for_all_users)} onClick={() => void disableMfa()}>
                      {mfaStatus.mfa_required_for_all_users ? "MFA required" : "Disable MFA"}
                    </Button>
                  </>
                )}
              </div>
              {mfaSetupStarted ? (
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
                  <div>Manual key: <code>{mfaSetupSecret || "-"}</code></div>
                  <div className="break-all">Provisioning URI: <code>{mfaProvisioningUri || "-"}</code></div>
                </div>
              ) : null}
              {mfaRecoveryCodes.length > 0 ? (
                <div className="rounded-md border p-3 text-sm space-y-2">
                  <div className="font-medium">Recovery codes (save these securely)</div>
                  <div className="grid gap-1 md:grid-cols-2">
                    {mfaRecoveryCodes.map((code) => (
                      <code key={code}>{code}</code>
                    ))}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button disabled={saving || loading} onClick={() => void saveSettings()}>
              {saving ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AccountSettingsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <AccountSettingsContent />
    </Suspense>
  );
}
