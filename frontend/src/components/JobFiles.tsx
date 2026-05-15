"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";
import UploadProgressBar from "@/components/UploadProgressBar";
import { uploadFormDataWithProgress } from "@/lib/upload-with-progress";

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
  storage_provider?: string | null;
  external_item_id?: string | null;
  external_web_url?: string | null;
  external_path?: string | null;
  notes?: string | null;
};

type JobFileType = {
  file_type_id: number;
  file_type_key: string;
  display_name: string;
  storage_folder_key: string;
  sort_order: number;
  is_active: boolean;
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
  const confirmAction = useConfirmDialog();
  const [loading, setLoading] = useState(true);
  const [typesLoading, setTypesLoading] = useState(true);
  const [error, setError] = useState("");
  const [files, setFiles] = useState<JobFile[]>([]);
  const [fileTypes, setFileTypes] = useState<JobFileType[]>([]);
  const [scopeRows, setScopeRows] = useState<JobScopeRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFileType, setSelectedFileType] = useState("");
  const [selectedRowId, setSelectedRowId] = useState<number | "">("");
  const [description, setDescription] = useState("");
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingFileId, setEditingFileId] = useState<number | null>(null);
  const [editRowId, setEditRowId] = useState<number | "">("");
  const [editDescription, setEditDescription] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const loadFiles = useCallback(async () => {
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
  }, [baseUrl, jobId]);

  const loadFileTypes = useCallback(async () => {
    setTypesLoading(true);
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/files/types`);
      if (!res.ok) {
        throw new Error(`Failed to load file types: ${res.status}`);
      }
      const json = await res.json();
      setFileTypes(json.file_types || []);
    } catch (e) {
      console.error("Failed to load file types:", e);
      setFileTypes([
        {
          file_type_id: 1,
          file_type_key: "client_provided",
          display_name: "Client Provided (Evidence)",
          storage_folder_key: "client-provided",
          sort_order: 10,
          is_active: true,
        },
        {
          file_type_id: 2,
          file_type_key: "generated_report",
          display_name: "Generated Report",
          storage_folder_key: "generated-reports",
          sort_order: 20,
          is_active: true,
        },
      ]);
    } finally {
      setTypesLoading(false);
    }
  }, [baseUrl, jobId]);

  const loadScopeRows = useCallback(async () => {
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
  }, [baseUrl, jobId]);

  useEffect(() => {
    loadFiles();
    loadFileTypes();
    loadScopeRows();
  }, [loadFileTypes, loadFiles, loadScopeRows]);

  async function handleUpload(fileInput: HTMLInputElement) {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (!selectedFileType) {
      alert("Please select a file type before uploading.");
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("file_type", selectedFileType);
      if (selectedRowId) {
        formData.append("row_id", selectedRowId.toString());
      }
      formData.append("description", description);

      const res = await uploadFormDataWithProgress(`${baseUrl}/jobs/${jobId}/files`, {
        method: "POST",
        body: formData,
        onProgress: ({ percent }) => setUploadProgress(percent),
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
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to upload file");
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }

  async function handleDelete(fileId: number) {
    const confirmed = await confirmAction({
      title: "Delete file?",
      description: "This file will be removed from the job record.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;

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

  function startEditFile(file: JobFile) {
    setEditingFileId(file.file_id);
    setEditRowId(file.row_id ?? "");
    setEditDescription(file.description ?? "");
    setEditNotes("");
    setIsEditOpen(true);
  }

  async function saveEditFile() {
    if (!editingFileId) return;
    try {
      const payload: Record<string, string | number | null> = {
        row_id: editRowId === "" ? null : editRowId,
        description: editDescription.trim(),
        notes: editNotes.trim(),
      };
      const res = await fetch(`${baseUrl}/jobs/${jobId}/files/${editingFileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail || "Failed to update file");
      }
      setIsEditOpen(false);
      setEditingFileId(null);
      setEditRowId("");
      setEditDescription("");
      setEditNotes("");
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
    if (!mimeType) return "ðŸ“„";
    if (mimeType.includes("pdf")) return "ðŸ“•";
    if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return "ðŸ“Š";
    if (mimeType.includes("document") || mimeType.includes("word")) return "ðŸ“";
    if (mimeType.includes("image")) return "ðŸ–¼ï¸";
    if (mimeType.includes("zip")) return "ðŸ“¦";
    return "ðŸ“„";
  }

  function getRowLabel(rowId: number): string {
    const row = scopeRows.find(r => r.row_id === rowId);
    if (!row) return `Row ${rowId}`;
    const label = row.category || row.level_2 || row.level_1 || row.original_id || `Row ${rowId}`;
    return `${row.scope}: ${label}`;
  }

  function getStorageLabel(file: JobFile): string {
    return file.storage_provider === "onedrive" ? "SharePoint / OneDrive" : "Local server";
  }

  function getEditRowValue(): string {
    return editRowId === "" ? "" : String(editRowId);
  }

  const fileTypeLookup = useMemo(() => {
    return new Map(fileTypes.map((type) => [type.file_type_key, type]));
  }, [fileTypes]);

  const visibleFileTypes = useMemo(() => {
    const known = [...fileTypes];
    const seen = new Set(known.map((type) => type.file_type_key));
    for (const file of files) {
      if (!seen.has(file.file_type)) {
        known.push({
          file_type_id: 0,
          file_type_key: file.file_type,
          display_name: file.file_type,
          storage_folder_key: "client-provided",
          sort_order: 9999,
          is_active: false,
        });
        seen.add(file.file_type);
      }
    }
    return known.sort((a, b) => a.sort_order - b.sort_order || a.display_name.localeCompare(b.display_name));
  }, [fileTypes, files]);

  const activeFileTypes = useMemo(
    () => fileTypes.filter((type) => type.is_active).sort((a, b) => a.sort_order - b.sort_order || a.display_name.localeCompare(b.display_name)),
    [fileTypes],
  );

  function getFileTypeLabel(fileType: string): string {
    return fileTypeLookup.get(fileType)?.display_name || fileType;
  }

  function getFileTypeFiles(fileType: string): JobFile[] {
    return files.filter((file) => file.file_type === fileType);
  }

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
                onChange={(e) => setSelectedFileType(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
                disabled={typesLoading || activeFileTypes.length === 0}
              >
                {activeFileTypes.length === 0 ? (
                  <option value="">No active file types</option>
                ) : (
                  activeFileTypes.map((type) => (
                    <option key={type.file_type_key} value={type.file_type_key}>
                      {type.display_name}
                    </option>
                  ))
                )}
              </select>
              <div className="text-xs text-muted-foreground">
                File types are managed in Admin &gt; Lookups.
              </div>
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
            <UploadProgressBar value={uploadProgress} label="Uploading file..." />
          )}
        </CardContent>
      </Card>

      {/* Files Tabs */}
      <Tabs defaultValue="all" className="w-full">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="all">
            All Files ({files.length})
          </TabsTrigger>
          {visibleFileTypes.map((type) => (
            <TabsTrigger key={type.file_type_key} value={type.file_type_key}>
              {type.display_name} ({getFileTypeFiles(type.file_type_key).length})
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="all" className="space-y-4">
          {files.length === 0 ? (
            <Card>
              <CardContent className="py-8">
                <div className="text-center text-muted-foreground">
                  No files uploaded yet.
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {files.map((file) => (
                <Card key={file.file_id}>
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-2xl">{getFileIcon(file.mime_type)}</span>
                        <div className="min-w-0">
                          <div className="font-medium truncate">{file.file_name}</div>
                          <div className="text-xs text-muted-foreground">
                            Type: {getFileTypeLabel(file.file_type)}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {file.description && <span>{file.description} • </span>}
                            {formatFileSize(file.file_size)}
                            {file.row_id && (
                              <span> • Linked to: {getRowLabel(file.row_id)}</span>
                            )}
                          </div>
                          {file.notes && (
                            <div className="text-xs text-muted-foreground">
                              Notes: {file.notes}
                            </div>
                          )}
                          <div className="text-xs text-muted-foreground">
                            Uploaded by {file.uploaded_by || "unknown"} on {file.uploaded_at ? new Date(file.uploaded_at).toLocaleDateString() : "unknown"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Stored in: {getStorageLabel(file)}
                          </div>
                          {file.external_path ? (
                            <div className="text-xs text-muted-foreground break-all">
                              Remote path: {file.external_path}
                            </div>
                          ) : file.file_path ? (
                            <div className="text-xs text-muted-foreground break-all">
                              Local path: {file.file_path}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => startEditFile(file)}
                        >
                          Edit
                        </Button>
                        {file.external_web_url ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => window.open(file.external_web_url || "", "_blank")}
                          >
                            Open in SharePoint
                          </Button>
                        ) : null}
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

      {visibleFileTypes.map((type) => {
          const typeFiles = getFileTypeFiles(type.file_type_key);
          return (
            <TabsContent key={type.file_type_key} value={type.file_type_key} className="space-y-4">
              {typeFiles.length === 0 ? (
                <Card>
                  <CardContent className="py-8">
                    <div className="text-center text-muted-foreground">
                      No files uploaded yet for {type.display_name.toLowerCase()}.
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  {typeFiles.map((file) => (
                    <Card key={file.file_id}>
                      <CardContent className="py-3">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-2xl">{getFileIcon(file.mime_type)}</span>
                            <div className="min-w-0">
                              <div className="font-medium truncate">{file.file_name}</div>
                              <div className="text-xs text-muted-foreground">
                                Type: {getFileTypeLabel(file.file_type)}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {file.description && <span>{file.description} • </span>}
                                {formatFileSize(file.file_size)}
                                {file.row_id && (
                                  <span> • Linked to: {getRowLabel(file.row_id)}</span>
                                )}
                              </div>
                              {file.notes && (
                                <div className="text-xs text-muted-foreground">
                                  Notes: {file.notes}
                                </div>
                              )}
                              <div className="text-xs text-muted-foreground">
                                Uploaded by {file.uploaded_by || "unknown"} on {file.uploaded_at ? new Date(file.uploaded_at).toLocaleDateString() : "unknown"}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Stored in: {getStorageLabel(file)}
                              </div>
                              {file.external_path ? (
                                <div className="text-xs text-muted-foreground break-all">
                                  Remote path: {file.external_path}
                                </div>
                              ) : file.file_path ? (
                                <div className="text-xs text-muted-foreground break-all">
                                  Local path: {file.file_path}
                                </div>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => startEditFile(file)}
                            >
                              Edit
                            </Button>
                            {file.external_web_url ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => window.open(file.external_web_url || "", "_blank")}
                              >
                                Open in SharePoint
                              </Button>
                            ) : null}
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
          );
        })}
      </Tabs>

      <Card>
        <CardContent className="py-8">
          <div className="text-sm text-muted-foreground">
            File information can be updated with the Edit button on each file card.
          </div>
        </CardContent>
      </Card>

      {editingFileId !== null && (
        <div className={isEditOpen ? "" : "hidden"}>
          <Card>
            <CardHeader>
              <CardTitle>Edit File Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Link to Data Row</label>
                  <select
                    value={getEditRowValue()}
                    onChange={(e) => setEditRowId(e.target.value ? parseInt(e.target.value) : "")}
                    className="w-full rounded-md border px-3 py-2 text-sm"
                  >
                    <option value="">Not linked to specific row</option>
                    {scopeRows.map((row) => (
                      <option key={row.row_id} value={row.row_id}>
                        {getRowLabel(row.row_id)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Description</label>
                  <input
                    type="text"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="w-full rounded-md border px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Notes</label>
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="min-h-24 w-full rounded-md border px-3 py-2 text-sm"
                  placeholder="Optional internal notes"
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={saveEditFile}>Save changes</Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsEditOpen(false);
                    setEditingFileId(null);
                    setEditRowId("");
                    setEditDescription("");
                    setEditNotes("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}


