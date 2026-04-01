"use client";

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import UploadProgressBar from "@/components/UploadProgressBar";
import { uploadFormDataWithProgress } from "@/lib/upload-with-progress";
import { withAuditHeaders } from "@/lib/auth-client";

type ClientLogoUploadProps = {
  baseUrl: string;
  logoUrl: string;
  onLogoUrlChange: (value: string) => void;
  clientDbId?: number;
  className?: string;
};

function resolveLogoPreviewSrc(raw: string, baseUrl: string): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:")) {
    return value;
  }
  if (value.startsWith("/uploads/")) {
    return `${baseUrl.replace(/\/+$/, "")}${value}`;
  }
  if (value.startsWith("/api/backend/")) {
    return value;
  }
  return value;
}

export default function ClientLogoUpload({
  baseUrl,
  logoUrl,
  onLogoUrlChange,
  clientDbId,
  className = "",
}: ClientLogoUploadProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const previewSrc = useMemo(() => resolveLogoPreviewSrc(logoUrl, baseUrl), [logoUrl, baseUrl]);

  async function handleUpload() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Choose a logo file first.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    if (Number.isFinite(clientDbId ?? NaN) && Number(clientDbId) > 0) {
      formData.append("client_db_id", String(clientDbId));
    }

    setUploading(true);
    setUploadProgress(0);
    setMessage("");
    setError("");

    try {
      const response = await uploadFormDataWithProgress(`${baseUrl}/clients/logo-upload`, {
        method: "POST",
        body: formData,
        credentials: "include",
        headers: withAuditHeaders(
          {},
          {
            page: "Clients",
            section: "Basic Information",
            container: clientDbId ? "Client Logo Upload" : "Create Client Logo",
          }
        ),
        onProgress: (progress) => setUploadProgress(progress.percent),
      });
      const payload = await response.json<{ ok?: boolean; logo_url?: string; detail?: string }>();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.detail || `Upload failed: ${response.status} ${response.statusText}`);
      }

      if (payload.logo_url) {
        onLogoUrlChange(payload.logo_url);
      }
      setMessage("Logo uploaded successfully.");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (err) {
      setError((err as Error).message || "Logo upload failed");
    } finally {
      setUploading(false);
    }
  }

  function handleClear() {
    onLogoUrlChange("");
    setMessage("");
    setError("");
    setUploadProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  return (
    <div className={`space-y-3 rounded-lg border bg-muted/20 p-4 ${className}`.trim()}>
      <div className="space-y-2">
        <Label htmlFor="clientLogoFile">Upload logo file</Label>
        <Input
          ref={fileInputRef}
          id="clientLogoFile"
          type="file"
          accept="image/*"
          onChange={() => {
            setError("");
            setMessage("");
          }}
        />
        <p className="text-xs text-muted-foreground">
          Upload a PNG, JPG, SVG, or WebP. The uploaded file is saved as the client logo URL and used in reports.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={handleUpload} disabled={uploading}>
          {uploading ? "Uploading..." : "Upload logo"}
        </Button>
        <Button type="button" variant="outline" onClick={handleClear} disabled={uploading && !logoUrl}>
          Clear logo
        </Button>
      </div>

      {uploading ? <UploadProgressBar value={uploadProgress} label="Uploading logo..." /> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {previewSrc ? (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Logo preview</div>
          <div className="flex items-center justify-center rounded-md border bg-white p-4">
            <img
              src={previewSrc}
              alt="Client logo preview"
              className="max-h-28 max-w-full object-contain"
            />
          </div>
          <div className="break-all text-xs text-muted-foreground">{logoUrl}</div>
        </div>
      ) : null}
    </div>
  );
}
