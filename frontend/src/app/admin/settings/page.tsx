"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
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

export default function SystemSettingsPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);

  const [nziLogoFile, setNziLogoFile] = useState<string | null>(null);
  const [logoVersion, setLogoVersion] = useState<number>(Date.now());
  const [fields, setFields] = useState<CompanyProfileField[]>([]);
  const [profile, setProfile] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void loadSettings();
  }, [baseUrl]);

  async function loadSettings() {
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
      setLogoVersion(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

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
        throw new Error(String((payload as { detail?: string }).detail || "Profile save failed"));
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

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${baseUrl}/system-settings/upload/nzi-logo`, {
        method: "POST",
        credentials: "include",
        body: formData,
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
    }
  }

  async function handleDeleteLogo() {
    if (!confirm("Are you sure you want to delete the NZI logo?")) return;

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

  const logoUrl = nziLogoFile ? `${baseUrl}/system-settings/logo/file?v=${logoVersion}` : null;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-[#F26624]">System Settings</h1>
            <p className="mt-1 text-muted-foreground">Configure global company identity and document settings.</p>
          </div>
          <Button variant="secondary" asChild>
            <Link href="/admin">Back to Admin</Link>
          </Button>
        </div>

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
              <p className="text-xs text-muted-foreground">
                Accepted formats: PNG, JPG, SVG. Maximum file size: 5MB.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
