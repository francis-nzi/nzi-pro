"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type JobFile = {
  file_id: number;
  job_id: number;
  row_id: number | null;
  file_type: string;
  file_name: string;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  description: string | null;
  uploaded_by: string | null;
  uploaded_at: string | null;
};

type JobScopeRow = {
  row_id: number;
  scope: string;
  category: string | null;
  original_id: string | null;
  level_1: string | null;
  level_2: string | null;
};

type JobFilesProps = {
  jobId: number;
  baseUrl: string;
};

export default function JobFiles({ jobId, baseUrl }: JobFilesProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [files, setFiles] = useState<JobFile[]>([]);
  const [scopeRows, setScopeRows] = useState<JobScopeRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [selectedFileType, setSelectedFileType] = useState<"client_provided" | "generated_report">("client_provided");
  const [selectedRowId, setSelectedRowId] = useState<number | "">("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    loadFiles();
    loadScopeRows();
  }, [jobId, baseUrl]);

  async function loadFiles() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/files`);
      if (!res.ok) {
        throw new Error(`Failed to load files: ${res.status}`);
      }
      const json = await res.json();
      setFiles(json.files || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadScopeRows() {
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/scope-data`);
      if (res.ok) {
        const json = await res.json();
        // Extract rows from the response
        const rows: JobScopeRow[] = [];
        if (json.items) {
          for (const item of json.items) {
            if (item.rows) {
              for (const row of item.rows) {
                rows.push({
                  row_id: row.row_id,
                  scope: row.scope,
                  category: row.category,
                  original_id: row.original_id,
                  level_1: row.level_1,
                  level_2: row.level_2,
                });
              }
            }
          }
        }
        setScopeRows(rows);
      }
    } catch (e) {
      console.error("Failed to load scope rows:", e);
    }
  }

  async function handleUpload(fileInput: HTMLInputElement) {
    const file = fileInput.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("file_type", selectedFileType);
      if (selectedRowId) {
        formData.append("row_id", selectedRowId.toString());
      }
      formData.append("description", description);

      const res = await fetch(`${baseUrl}/jobs/${jobId}/files`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to upload file");
      }

      // Reset form
      fileInput.value = "";
      setDescription("");
      setSelectedRowId("");
      
      // Reload files
      await loadFiles();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(fileId: number) {
    if (!confirm("Are you sure you want to delete this file?")) return;

    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/files/${fileId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error("Failed to delete file");
      }

      await loadFiles();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  function formatFileSize(bytes: number | null): string {
    if (!bytes) return "-";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getFileIcon(mimeType: string | null): string {
    if (!mimeType) return "📄";
    if (mimeType.includes("pdf")) return "📕";
    if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return "📊";
    if (mimeType.includes("document") || mimeType.includes("word")) return "📝";
    if (mimeType.includes("image")) return "🖼️";
    if (mimeType.includes("zip")) return "📦";
    return "📄";
  }

  function getRowLabel(rowId: number): string {
    const row = scopeRows.find(r => r.row_id === rowId);
    if (!row) return `Row ${rowId}`;
    const label = row.category || row.level_2 || row.level_1 || row.original_id || `Row ${rowId}`;
    return `${row.scope}: ${label}`;
  }

  const clientFiles = files.filter(f => f.file_type === "client_provided");
  const generatedFiles = files.filter(f => f.file_type === "generated_report");

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">Loading files...</div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-destructive">{error}</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Upload Section */}
      <Card>
        <CardHeader>
          <CardTitle>Upload File</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">File Type</label>
              <select
                value={selectedFileType}
                onChange={(e) => setSelectedFileType(e.target.value as "client_provided" | "generated_report")}
                className="w-full rounded-md border px-3 py-2 text-sm"
              >
                <option value="client_provided">Client Provided (Evidence)</option>
                <option value="generated_report">Generated Report</option>
              </select>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Link to Data Row (Optional)</label>
              <select
                value={selectedRowId}
                onChange={(e) => setSelectedRowId(e.target.value ? parseInt(e.target.value) : "")}
                className="w-full rounded-md border px-3 py-2 text-sm"
              >
                <option value="">Not linked to specific row</option>
                {scopeRows.map(row => (
                  <option key={row.row_id} value={row.row_id}>
                    {getRowLabel(row.row_id)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter description (e.g., 'Electricity invoice 2024', 'Annual report')"
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium">Select File</label>
            <input
              type="file"
              onChange={(e) => handleUpload(e.target)}
              disabled={uploading}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          
          {uploading && (
            <div className="text-sm text-muted-foreground">Uploading...</div>
          )}
        </CardContent>
      </Card>

      {/* Files Tabs */}
      <Tabs defaultValue="client" className="w-full">
        <TabsList>
          <TabsTrigger value="client">
            Client Provided ({clientFiles.length})
          </TabsTrigger>
          <TabsTrigger value="generated">
            Generated Reports ({generatedFiles.length})
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="client" className="space-y-4">
          {clientFiles.length === 0 ? (
            <Card>
              <CardContent className="py-8">
                <div className="text-center text-muted-foreground">
                  No client-provided files uploaded yet.
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {clientFiles.map(file => (
                <Card key={file.file_id}>
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-2xl">{getFileIcon(file.mime_type)}</span>
                        <div className="min-w-0">
                          <div className="font-medium truncate">{file.file_name}</div>
                          <div className="text-sm text-muted-foreground">
                            {file.description && <span>{file.description} • </span>}
                            {formatFileSize(file.file_size)}
                            {file.row_id && (
                              <span> • Linked to: {getRowLabel(file.row_id)}</span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Uploaded by {file.uploaded_by || "unknown"} on {file.uploaded_at ? new Date(file.uploaded_at).toLocaleDateString() : "unknown"}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.open(`${baseUrl}/jobs/${jobId}/files/${file.file_id}/download`, "_blank")}
                        >
                          Download
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDelete(file.file_id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
        
        <TabsContent value="generated" className="space-y-4">
          {generatedFiles.length === 0 ? (
            <Card>
              <CardContent className="py-8">
                <div className="text-center text-muted-foreground">
                  No generated reports yet. Generate a report from the Reports tab.
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {generatedFiles.map(file => (
                <Card key={file.file_id}>
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-2xl">{getFileIcon(file.mime_type)}</span>
                        <div className="min-w-0">
                          <div className="font-medium truncate">{file.file_name}</div>
                          <div className="text-sm text-muted-foreground">
                            {file.description && <span>{file.description} • </span>}
                            {formatFileSize(file.file_size)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Uploaded by {file.uploaded_by || "unknown"} on {file.uploaded_at ? new Date(file.uploaded_at).toLocaleDateString() : "unknown"}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.open(`${baseUrl}/jobs/${jobId}/files/${file.file_id}/download`, "_blank")}
                        >
                          Download
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDelete(file.file_id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
