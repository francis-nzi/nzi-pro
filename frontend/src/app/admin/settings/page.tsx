"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
}

export default function SystemSettingsPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  
  const [nziLogoFile, setNziLogoFile] = useState<string | null>(null);
  const [logoVersion, setLogoVersion] = useState<number>(Date.now());
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    loadSettings();
  }, [baseUrl]);

  async function loadSettings() {
    try {
      const res = await fetch(`${baseUrl}/system-settings/nzi_logo_file`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load settings");
      const data = await res.json();
      setNziLogoFile(data.setting_value || null);
      setLogoVersion(Date.now());
    } catch (e) {
      console.error("Error loading settings:", e);
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

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || "Upload failed");
      }

      const data = await res.json();
      setNziLogoFile(data.filename);
      setLogoVersion(Date.now());
      setStatus("✅ NZI logo uploaded successfully!");
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setError(`Upload failed: ${(e as Error).message}`);
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

      if (!res.ok) throw new Error("Delete failed");

      setNziLogoFile(null);
      setLogoVersion(Date.now());
      setStatus("✅ NZI logo deleted successfully!");
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setError(`Delete failed: ${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  }

  const logoUrl = nziLogoFile ? `${baseUrl}/system-settings/logo/file?v=${logoVersion}` : null;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold" style={{ color: '#F26624' }}>System Settings</h1>
            <p className="text-muted-foreground mt-1">Configure global system settings</p>
          </div>
          <Button variant="secondary" asChild>
            <Link href="/admin">← Back to Admin</Link>
          </Button>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        
        {status && (
          <div className="rounded-md bg-muted p-3 text-sm">
            {status}
          </div>
        )}

        {/* NZI Logo Section */}
        <Card>
          <CardHeader>
            <CardTitle>Net Zero International Logo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="text-sm text-muted-foreground">
              Upload the Net Zero International logo to be used on all report cover pages.
              Recommended: PNG format with transparent background, max height 250px.
            </div>

            {/* Current Logo Preview */}
            {logoUrl && (
              <div className="space-y-3">
                <Label>Current Logo</Label>
                <div className="rounded-lg border p-6 bg-gray-50 flex items-center justify-center">
                  <img
                    src={logoUrl}
                    alt="Net Zero International Logo"
                    style={{
                      maxHeight: '250px',
                      maxWidth: '100%',
                      objectFit: 'contain'
                    }}
                  />
                </div>
                <div className="flex justify-end">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDeleteLogo}
                    disabled={uploading}
                  >
                    Delete Logo
                  </Button>
                </div>
              </div>
            )}

            {/* Upload Section */}
            <div className="space-y-3">
              <Label htmlFor="nziLogo">
                {logoUrl ? "Replace Logo" : "Upload Logo"}
              </Label>
              <Input
                id="nziLogo"
                type="file"
                accept="image/*"
                onChange={(e) => handleLogoUpload(e.target.files?.[0])}
                disabled={uploading}
              />
              <p className="text-xs text-muted-foreground">
                Accepted formats: PNG, JPG, SVG. Maximum file size: 5MB.
              </p>
            </div>

            {/* Usage Information */}
            <div className="rounded-md border border-blue-200 bg-blue-50 p-4">
              <h4 className="font-medium text-blue-900 mb-2">📘 How This Works</h4>
              <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
                <li>The uploaded logo will appear on all report cover pages</li>
                <li>Logo is displayed at the top of the page with max height of 250px</li>
                <li>Logo is stored in the system and accessible to all reports</li>
                <li>You can replace or delete the logo at any time</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* Future Settings Sections */}
        <Card>
          <CardHeader>
            <CardTitle>Additional Settings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground">
              Additional system settings will be added here in future updates.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
