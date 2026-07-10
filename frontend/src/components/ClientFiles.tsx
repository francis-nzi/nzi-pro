"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, FileIcon, Trash2, Upload } from "lucide-react";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";
import UploadProgressBar from "@/components/UploadProgressBar";
import { uploadFormDataWithProgress } from "@/lib/upload-with-progress";

interface ClientFile {
  file_id: number;
  source: "client" | "job";
  client_db_id: number;
  job_id: number | null;
  job_number: string | null;
  job_title: string | null;
  file_type: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  description: string | null;
  uploaded_by: string | null;
  uploaded_at: string | null;
  storage_provider: string | null;
  external_web_url: string | null;
  notes: string | null;
}

function fmtSize(bytes: number | null | undefined): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("en-AU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function FileRow({
  file,
  downloadUrl,
  onDelete,
  jobLabel,
}: {
  file: ClientFile;
  downloadUrl: string;
  onDelete?: () => void;
  jobLabel?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border p-3 bg-slate-50/50 hover:bg-slate-50">
      <FileIcon className="h-5 w-5 text-slate-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate">{file.file_name}</span>
          {jobLabel && (
            <Badge variant="outline" className="text-xs flex-shrink-0">
              {jobLabel}
            </Badge>
          )}
          <Badge variant="secondary" className="text-xs flex-shrink-0 capitalize">
            {(file.file_type || "general").replace(/_/g, " ")}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {[
            fmtSize(file.file_size),
            file.uploaded_by ? `by ${file.uploaded_by}` : null,
            fmtDate(file.uploaded_at),
            file.description,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {file.external_web_url ? (
          <Button variant="ghost" size="sm" asChild>
            <a href={file.external_web_url} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        ) : (
          <Button variant="ghost" size="sm" asChild>
            <a href={downloadUrl} download={file.file_name}>
              Download
            </a>
          </Button>
        )}
        {onDelete && (
          <Button variant="ghost" size="sm" onClick={onDelete}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        )}
      </div>
    </div>
  );
}

export default function ClientFiles({
  clientId,
  baseUrl,
}: {
  clientId: number;
  baseUrl: string;
}) {
  const confirmAction = useConfirmDialog();
  const [files, setFiles] = useState<ClientFile[]>([]);
  const [loading, setLoading] = useState(true);

  // Upload form state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState("general");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}/clients/${clientId}/files`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files || []);
      }
    } finally {
      setLoading(false);
    }
  }, [baseUrl, clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadFile) {
      setUploadStatus("Please select a file");
      return;
    }
    setUploading(true);
    setUploadStatus("");
    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      fd.append("file_type", fileType);
      fd.append("description", description);
      fd.append("notes", notes);
      const res = await uploadFormDataWithProgress(
        `${baseUrl}/clients/${clientId}/files`,
        {
          method: "POST",
          body: fd,
          onProgress: ({ percent }) => setUploadProgress(percent),
        }
      );
      if (!res.ok) {
        const err = await res.json<{ detail?: string }>();
        throw new Error(err.detail || "Upload failed");
      }
      setUploadStatus("File uploaded successfully!");
      setUploadFile(null);
      setDescription("");
      setNotes("");
      setUploadProgress(0);
      void load();
      setTimeout(() => setUploadStatus(""), 3000);
    } catch (err) {
      setUploadStatus(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(file: ClientFile) {
    const confirmed = await confirmAction({
      title: "Delete file?",
      description: `"${file.file_name}" will be permanently deleted.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    await fetch(`${baseUrl}/clients/${clientId}/files/${file.file_id}`, {
      method: "DELETE",
      credentials: "include",
    });
    void load();
  }

  const directFiles = files.filter((f) => f.source === "client");
  const jobFiles = files.filter((f) => f.source === "job");

  return (
    <div className="space-y-6">
      {/* Upload form */}
      <Card>
        <CardHeader>
          <CardTitle>Upload File to Client</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleUpload} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cf-file">File *</Label>
                <Input
                  id="cf-file"
                  type="file"
                  onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cf-type">File Type</Label>
                <Select value={fileType} onValueChange={setFileType}>
                  <SelectTrigger id="cf-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">General</SelectItem>
                    <SelectItem value="time_report">Time Report</SelectItem>
                    <SelectItem value="invoice">Invoice</SelectItem>
                    <SelectItem value="contract">Contract</SelectItem>
                    <SelectItem value="report">Report</SelectItem>
                    <SelectItem value="correspondence">Correspondence</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cf-desc">Description</Label>
              <Input
                id="cf-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this file..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cf-notes">Internal Notes</Label>
              <Textarea
                id="cf-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Internal notes (not visible to clients)..."
              />
            </div>
            {uploading && <UploadProgressBar progress={uploadProgress} />}
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={uploading || !uploadFile}>
                <Upload className="h-4 w-4 mr-2" />
                {uploading ? "Uploading..." : "Upload File"}
              </Button>
              {uploadStatus && (
                <span className="text-sm text-muted-foreground">{uploadStatus}</span>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Direct client files */}
      <Card>
        <CardHeader>
          <CardTitle>
            Client Files{" "}
            {!loading && (
              <span className="text-base font-normal text-muted-foreground">
                ({directFiles.length})
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : directFiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No files uploaded directly to this client yet.
            </p>
          ) : (
            <div className="space-y-2">
              {directFiles.map((f) => (
                <FileRow
                  key={`c-${f.file_id}`}
                  file={f}
                  downloadUrl={`${baseUrl}/clients/${clientId}/files/${f.file_id}/download`}
                  onDelete={() => handleDelete(f)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cascaded job files */}
      <Card>
        <CardHeader>
          <CardTitle>
            Files from Jobs{" "}
            {!loading && (
              <span className="text-base font-normal text-muted-foreground">
                ({jobFiles.length})
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : jobFiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No files on any jobs for this client yet.
            </p>
          ) : (
            <div className="space-y-2">
              {jobFiles.map((f) => (
                <FileRow
                  key={`j-${f.file_id}`}
                  file={f}
                  downloadUrl={`${baseUrl}/jobs/${f.job_id}/files/${f.file_id}/download`}
                  jobLabel={f.job_number ? `Job ${f.job_number}` : f.job_title || undefined}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
