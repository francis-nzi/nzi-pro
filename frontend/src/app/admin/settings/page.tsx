"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";
import UploadProgressBar from "@/components/UploadProgressBar";
import { uploadFormDataWithProgress } from "@/lib/upload-with-progress";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

function apiBaseUrl(): string {
  return "/api/backend";
}

function xeroProxyBaseUrl(): string {
  return "/api/backend";
}

type CompanyProfileField = {
  key: string;
  label: string;
  default: string;
  description: string;
};

type CompanyProfileResponse = {
  profile: Record<string, string>;
  fields: CompanyProfileField[];
};

type IntensityMetricDefaults = Record<string, {
  label: string;
  value: number;
  divider: number;
}>;

const DEFAULT_INTENSITY_METRICS: IntensityMetricDefaults = {
  employees: { label: "Employees", value: 0, divider: 1 },
  turnover: { label: "Turnover", value: 0, divider: 1 },
  premises_owned: { label: "Premises Owned", value: 0, divider: 1 },
  premises_leased: { label: "Premises Leased", value: 0, divider: 1 },
  vehicles_owned: { label: "Vehicles Owned", value: 0, divider: 1 },
  vehicles_leased: { label: "Vehicles Leased", value: 0, divider: 1 },
};

type XeroConnection = {
  connection_key?: string | null;
  integration_type?: string | null;
  tenant_id?: string | null;
  org_name?: string | null;
  access_token?: string | null;
  refresh_token?: string | null;
  expires_at?: string | null;
  scope?: string | null;
  status?: string | null;
  last_tested_at?: string | null;
  last_error?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
};

export default function SystemSettingsPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const searchParams = useSearchParams();
  const confirmAction = useConfirmDialog();

  const [nziLogoFile, setNziLogoFile] = useState<string | null>(null);
  const [logoVersion, setLogoVersion] = useState<number>(Date.now());
  const [fields, setFields] = useState<CompanyProfileField[]>([]);
  const [profile, setProfile] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [xeroConnection, setXeroConnection] = useState<XeroConnection | null>(null);
  const [xeroLoading, setXeroLoading] = useState(false);
  const [xeroStatus, setXeroStatus] = useState("");
  const [xeroError, setXeroError] = useState("");
  const [xeroOrgName, setXeroOrgName] = useState("");
  const [xeroScope, setXeroScope] = useState("accounting.contacts accounting.invoices");
  const [xeroInvoiceId, setXeroInvoiceId] = useState("");
  const [intensityMetricDefaultsText, setIntensityMetricDefaultsText] = useState(() => JSON.stringify(DEFAULT_INTENSITY_METRICS, null, 2));
  const [intensityMetricDefaultsSaving, setIntensityMetricDefaultsSaving] = useState(false);
  const [intensityMetricDefaultsStatus, setIntensityMetricDefaultsStatus] = useState("");
  const [intensityMetricDefaultsError, setIntensityMetricDefaultsError] = useState("");
  const xeroHeaderBadge = xeroConnection?.status === "connected"
    ? { label: "Xero Connected", variant: "default" as const }
    : xeroConnection?.status === "configured"
      ? { label: "Xero Configured", variant: "secondary" as const }
      : xeroConnection?.status === "error"
        ? { label: "Xero Error", variant: "destructive" as const }
        : { label: "Xero Disconnected", variant: "outline" as const };

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [profileRes, logoRes] = await Promise.all([
        fetch(`${baseUrl}/system-settings/profile`, { credentials: "include" }),
        fetch(`${baseUrl}/system-settings/nzi_logo_file`, { credentials: "include" }),
      ]);

      if (!profileRes.ok) {
        throw new Error("Failed to load company profile settings");
      }

      const profileJson = (await profileRes.json()) as CompanyProfileResponse;
      setFields(Array.isArray(profileJson.fields) ? profileJson.fields : []);
      setProfile(profileJson.profile || {});

      if (logoRes.ok) {
        const logoJson = await logoRes.json();
        setNziLogoFile(logoJson.setting_value || null);
      } else {
        setNziLogoFile(null);
      }
      const intensityRes = await fetch(`${baseUrl}/system-settings/intensity_metric_defaults`, { credentials: "include" });
      if (intensityRes.ok) {
        const intensityJson = await intensityRes.json();
        const raw = String(intensityJson.setting_value || "").trim();
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as IntensityMetricDefaults;
            setIntensityMetricDefaultsText(JSON.stringify(parsed, null, 2));
          } catch {
            setIntensityMetricDefaultsText(raw);
          }
        } else {
          setIntensityMetricDefaultsText(JSON.stringify(DEFAULT_INTENSITY_METRICS, null, 2));
        }
      } else {
        setIntensityMetricDefaultsText(JSON.stringify(DEFAULT_INTENSITY_METRICS, null, 2));
      }
      setLogoVersion(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  async function saveIntensityMetricDefaults() {
    setIntensityMetricDefaultsSaving(true);
    setIntensityMetricDefaultsError("");
    setIntensityMetricDefaultsStatus("Saving intensity metric defaults...");
    try {
      const parsed = JSON.parse(intensityMetricDefaultsText || "{}") as IntensityMetricDefaults;
      const res = await fetch(`${baseUrl}/system-settings/intensity_metric_defaults`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ setting_value: JSON.stringify(parsed) }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = (payload as { detail?: unknown }).detail;
        throw new Error(typeof detail === "string" ? detail : "Failed to save intensity metric defaults");
      }
      setIntensityMetricDefaultsText(JSON.stringify(parsed, null, 2));
      setIntensityMetricDefaultsStatus("Intensity metric defaults saved.");
      setTimeout(() => setIntensityMetricDefaultsStatus(""), 2500);
    } catch (e) {
      setIntensityMetricDefaultsError((e as Error).message);
      setIntensityMetricDefaultsStatus("");
    } finally {
      setIntensityMetricDefaultsSaving(false);
    }
  }

  const loadXeroStatus = useCallback(async () => {
    setXeroLoading(true);
    setXeroError("");
    try {
      const res = await fetch(`${xeroProxyBaseUrl()}/xero/status`, { credentials: "include" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = (payload as { detail?: unknown }).detail;
        throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail || "Failed to load Xero status"));
      }
      const connection = (payload as { connection?: XeroConnection | null }).connection ?? null;
      setXeroConnection(connection);
      setXeroOrgName(String(connection?.org_name || ""));
      setXeroScope(String(connection?.scope || "accounting.contacts accounting.invoices"));
      setXeroStatus(
        connection?.status === "connected"
          ? "Xero is connected."
          : connection?.status === "configured"
            ? "Xero is configured but not yet connected."
            : "Xero is not connected."
      );
    } catch (e) {
      setXeroError(`Failed to load Xero status: ${(e as Error).message}`);
      setXeroConnection(null);
      setXeroStatus("");
    } finally {
      setXeroLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
    void loadXeroStatus();
  }, [loadSettings, loadXeroStatus]);

  useEffect(() => {
    const xeroResult = searchParams.get("xero");
    if (!xeroResult) return;
    if (xeroResult === "connected") {
      setStatus("Xero connected successfully.");
      return;
    }
    setError(`Xero: ${xeroResult}`);
  }, [searchParams]);

  function setProfileValue(key: string, value: string) {
    setProfile((prev) => ({ ...prev, [key]: value }));
  }

  async function saveProfile() {
    setSavingProfile(true);
    setError("");
    setStatus("Saving company profile...");
    try {
      const res = await fetch(`${baseUrl}/system-settings/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ settings: profile }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = (payload as { detail?: unknown }).detail;
        throw new Error(typeof detail === "string" ? detail : "Profile save failed");
      }
      setProfile((payload as { profile?: Record<string, string> }).profile || profile);
      setStatus("Company profile saved successfully.");
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setError(`Save failed: ${(e as Error).message}`);
      setStatus("");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleLogoUpload(file: File | undefined) {
    if (!file) return;

    setUploading(true);
    setError("");
    setStatus("Uploading logo...");
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await uploadFormDataWithProgress(`${baseUrl}/system-settings/upload/nzi-logo`, {
        method: "POST",
        credentials: "include",
        body: formData,
        onProgress: ({ percent }) => setUploadProgress(percent),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(String((payload as { detail?: string }).detail || "Upload failed"));
      }

      setNziLogoFile((payload as { filename?: string }).filename || null);
      setLogoVersion(Date.now());
      setStatus("NZI logo uploaded successfully.");
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setError(`Upload failed: ${(e as Error).message}`);
      setStatus("");
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }

  async function handleDeleteLogo() {
    const confirmed = await confirmAction({
      title: "Delete NZI logo?",
      description: "The current logo file will be removed from system settings.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;

    setUploading(true);
    setError("");
    setStatus("Deleting logo...");

    try {
      const res = await fetch(`${baseUrl}/system-settings/upload/nzi-logo`, {
        method: "DELETE",
        credentials: "include",
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(String((payload as { detail?: string }).detail || "Delete failed"));
      }

      setNziLogoFile(null);
      setLogoVersion(Date.now());
      setStatus("NZI logo deleted successfully.");
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setError(`Delete failed: ${(e as Error).message}`);
      setStatus("");
    } finally {
      setUploading(false);
    }
  }

  async function saveXeroConnection() {
    setXeroLoading(true);
    setXeroError("");
    setXeroStatus("Saving Xero connection...");
    try {
      const res = await fetch(`${xeroProxyBaseUrl()}/xero/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          org_name: xeroOrgName,
          scope: xeroScope,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = (payload as { detail?: unknown }).detail;
        throw new Error(typeof detail === "string" ? detail : "Failed to save Xero connection");
      }
      setXeroConnection((payload as { connection?: XeroConnection | null }).connection ?? null);
      if ((payload as { ok?: boolean }).ok) {
        setXeroStatus("Xero connection saved and tested successfully.");
      } else {
        setXeroStatus("Xero connection saved, but the connection test returned an error.");
      }
      await loadXeroStatus();
    } catch (e) {
      setXeroError((e as Error).message);
      setXeroStatus("");
    } finally {
      setXeroLoading(false);
    }
  }

  async function testXeroConnection() {
    setXeroLoading(true);
    setXeroError("");
    setXeroStatus("Testing Xero connection...");
    try {
      const res = await fetch(`${xeroProxyBaseUrl()}/xero/test`, { method: "POST", credentials: "include" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = (payload as { detail?: unknown }).detail;
        throw new Error(typeof detail === "string" ? detail : "Xero test failed");
      }
      const orgName = String((payload as { Name?: string; name?: string }).Name || (payload as { Name?: string; name?: string }).name || "");
      setXeroStatus(orgName ? `Xero connection test passed for ${orgName}.` : "Xero connection test passed.");
      await loadXeroStatus();
    } catch (e) {
      setXeroError((e as Error).message);
      setXeroStatus("");
    } finally {
      setXeroLoading(false);
    }
  }

  async function disconnectXero() {
    const confirmed = await confirmAction({
      title: "Disconnect Xero?",
      description: "This will clear the saved Xero connection details from the app.",
      confirmLabel: "Disconnect",
      destructive: true,
    });
    if (!confirmed) return;

    setXeroLoading(true);
    setXeroError("");
    setXeroStatus("Disconnecting Xero...");
    try {
      const res = await fetch(`${xeroProxyBaseUrl()}/xero/disconnect`, {
        method: "POST",
        credentials: "include",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = (payload as { detail?: unknown }).detail;
        throw new Error(typeof detail === "string" ? detail : "Failed to disconnect Xero");
      }
      await loadXeroStatus();
      setXeroStatus("Xero disconnected.");
    } catch (e) {
      setXeroError((e as Error).message);
      setXeroStatus("");
    } finally {
      setXeroLoading(false);
    }
  }

  async function syncXeroInvoice(mode: "sync" | "resync") {
    const invoiceId = Number(xeroInvoiceId);
    if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
      setXeroError("Enter a valid invoice ID first.");
      return;
    }

    setXeroLoading(true);
    setXeroError("");
    setXeroStatus(mode === "sync" ? "Syncing invoice to Xero..." : "Resyncing invoice from Xero...");
    try {
      const res = await fetch(`${xeroProxyBaseUrl()}/xero/invoices/${invoiceId}/${mode === "sync" ? "sync" : "resync"}`, {
        method: "POST",
        credentials: "include",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = (payload as { detail?: unknown }).detail;
        throw new Error(typeof detail === "string" ? detail : "Invoice sync failed");
      }
      const invoiceNumber = String((payload as { invoice?: { invoice_number?: string | null } }).invoice?.invoice_number || invoiceId);
      setXeroStatus(`Invoice ${invoiceNumber} synced with Xero.`);
    } catch (e) {
      setXeroError((e as Error).message);
      setXeroStatus("");
    } finally {
      setXeroLoading(false);
    }
  }

  const logoUrl = nziLogoFile ? `${baseUrl}/system-settings/logo/file?v=${logoVersion}` : null;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <AdminPageHeader
          kicker="System & Governance"
          title="System Settings"
          description="Configure global company identity and document settings."
          badges={[xeroHeaderBadge.label]}
          actions={
            <Button variant="outline" asChild className="rounded-full">
              <Link href="/admin">Back to Admin</Link>
            </Button>
          }
        />

        {error ? (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {status ? (
          <div className="rounded-md bg-muted p-3 text-sm">
            {status}
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Company Identity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading settings...</div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {fields.map((field) => {
                  const value = profile[field.key] ?? field.default ?? "";
                  const multiline = field.key === "registered_address_line_2";
                  return (
                    <div key={field.key} className={field.key === "registered_address_line_2" ? "md:col-span-2" : ""}>
                      <Label htmlFor={field.key}>{field.label}</Label>
                      {multiline ? (
                        <Textarea
                          id={field.key}
                          className="mt-2"
                          rows={2}
                          value={value}
                          onChange={(e) => setProfileValue(field.key, e.target.value)}
                        />
                      ) : (
                        <Input
                          id={field.key}
                          className="mt-2"
                          value={value}
                          onChange={(e) => setProfileValue(field.key, e.target.value)}
                        />
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">{field.description}</p>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={() => void saveProfile()} disabled={savingProfile || loading}>
                {savingProfile ? "Saving..." : "Save Company Settings"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Net Zero International Logo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="text-sm text-muted-foreground">
              Upload the NZI logo used across documents, report covers, letters, invoices, and quotes.
            </div>

            {logoUrl ? (
              <div className="space-y-3">
                <Label>Current Logo</Label>
                <div className="flex items-center justify-center rounded-lg border bg-gray-50 p-6">
                  <img
                    src={logoUrl}
                    alt="Net Zero International Logo"
                    style={{
                      maxHeight: "250px",
                      maxWidth: "100%",
                      objectFit: "contain",
                    }}
                  />
                </div>
                <div className="flex justify-end">
                  <Button variant="destructive" size="sm" onClick={() => void handleDeleteLogo()} disabled={uploading}>
                    Delete Logo
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="space-y-3">
              <Label htmlFor="nziLogo">{logoUrl ? "Replace Logo" : "Upload Logo"}</Label>
              <Input
                id="nziLogo"
                type="file"
                accept="image/*"
                onChange={(e) => void handleLogoUpload(e.target.files?.[0])}
                disabled={uploading}
              />
              {uploading ? <UploadProgressBar value={uploadProgress} label="Uploading logo..." /> : null}
              <p className="text-xs text-muted-foreground">
                Accepted formats: PNG, JPG, SVG. Maximum file size: 5MB.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Xero Integration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="text-sm text-muted-foreground">
              Xero is set up as a Custom Connection. No browser OAuth flow is required.
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="xeroOrgName">Organisation Name</Label>
                <Input
                  id="xeroOrgName"
                  className="mt-2"
                  value={xeroOrgName}
                  onChange={(e) => setXeroOrgName(e.target.value)}
                  placeholder="Company name in Xero"
                />
              </div>
              <div>
                <Label htmlFor="xeroScope">Scope</Label>
                <Input
                  id="xeroScope"
                  className="mt-2"
                  value={xeroScope}
                  onChange={(e) => setXeroScope(e.target.value)}
                  placeholder="accounting.contacts accounting.invoices"
                />
              </div>
            </div>

            <div className="rounded-md border bg-muted/30 p-4 text-sm">
              <div className="font-medium">Current status</div>
              <div className="mt-1 text-muted-foreground">
                {xeroConnection?.status ? `Status: ${xeroConnection.status}` : "No saved connection yet."}
              </div>
              <div className="mt-1 text-muted-foreground">
                {xeroConnection?.last_error ? `Last error: ${xeroConnection.last_error}` : "No recent connection errors."}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                The app needs `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET` in Render. Scope is normalized to custom-connection-safe values.
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void loadXeroStatus()} disabled={xeroLoading}>
                Refresh Status
              </Button>
              <Button variant="secondary" onClick={() => void testXeroConnection()} disabled={xeroLoading}>
                Test Connection
              </Button>
              <Button variant="secondary" onClick={() => void saveXeroConnection()} disabled={xeroLoading}>
                Save and Test
              </Button>
              <Button variant="destructive" onClick={() => void disconnectXero()} disabled={xeroLoading}>
                Disconnect
              </Button>
            </div>

            <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
              <div>
                <Label htmlFor="xeroInvoiceId">Invoice ID to sync</Label>
                <Input
                  id="xeroInvoiceId"
                  className="mt-2"
                  value={xeroInvoiceId}
                  onChange={(e) => setXeroInvoiceId(e.target.value)}
                  placeholder="e.g. 1234"
                />
              </div>
              <div className="self-end">
                <Button onClick={() => void syncXeroInvoice("sync")} disabled={xeroLoading}>
                  Sync Invoice
                </Button>
              </div>
              <div className="self-end">
                <Button variant="outline" onClick={() => void syncXeroInvoice("resync")} disabled={xeroLoading}>
                  Resync Invoice
                </Button>
              </div>
            </div>

            {xeroStatus ? <div className="rounded-md bg-muted p-3 text-sm">{xeroStatus}</div> : null}
            {xeroError ? <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{xeroError}</div> : null}
            {xeroLoading ? <div className="text-sm text-muted-foreground">Working...</div> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Global Intensity Metrics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Define reusable intensity metric defaults here. These are the starting values shown in Job &gt; Data &gt; Intensity Metrics when a job has no saved metrics yet.
            </div>

            <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
              Edit the JSON to add or rename global metrics such as Employee, Premises, Vehicles, or any organisation-wide denominator you want available across jobs.
            </div>

            <div className="space-y-2">
              <Label htmlFor="intensityMetricDefaultsText">Default metrics JSON</Label>
              <Textarea
                id="intensityMetricDefaultsText"
                className="font-mono text-sm min-h-[220px]"
                value={intensityMetricDefaultsText}
                onChange={(e) => setIntensityMetricDefaultsText(e.target.value)}
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">
                Keys become the reusable metric IDs. Each item should include a display label, value, and divider.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void saveIntensityMetricDefaults()} disabled={intensityMetricDefaultsSaving}>
                {intensityMetricDefaultsSaving ? "Saving..." : "Save Global Metrics"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setIntensityMetricDefaultsText(JSON.stringify(DEFAULT_INTENSITY_METRICS, null, 2))}
                disabled={intensityMetricDefaultsSaving}
              >
                Reset Example
              </Button>
            </div>

            {intensityMetricDefaultsStatus ? (
              <div className="rounded-md bg-muted p-3 text-sm">{intensityMetricDefaultsStatus}</div>
            ) : null}
            {intensityMetricDefaultsError ? (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {intensityMetricDefaultsError}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
