"use client";

import { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, ExternalLink, Mail, Globe, FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import type { TrainingDocument } from "./types";
import { DOCUMENT_TYPE_OPTIONS, formatDocumentType } from "./types";

type Props = {
  targetType: "product" | "run" | "booking";
  targetId: number;
  baseUrl: string;
  title?: string;
};

const EMPTY_FORM = {
  document_type: "general",
  document_name: "",
  file_url: "",
  notes: "",
  attach_to_email: false,
  is_visible_on_portal: false,
};

type FormState = typeof EMPTY_FORM;

function docTypeColor(type: string) {
  switch (type) {
    case "course_overview":       return "bg-blue-100 text-blue-800";
    case "lesson_plan":           return "bg-purple-100 text-purple-800";
    case "slides":                return "bg-indigo-100 text-indigo-800";
    case "questionnaire":         return "bg-amber-100 text-amber-800";
    case "feedback_form":         return "bg-orange-100 text-orange-800";
    case "joining_instructions":  return "bg-teal-100 text-teal-800";
    case "post_course_resources": return "bg-green-100 text-green-800";
    case "certificate_template":  return "bg-rose-100 text-rose-800";
    default:                      return "bg-slate-100 text-slate-600";
  }
}

export default function DocumentsPanel({ targetType, targetId, baseUrl, title = "Documents" }: Props) {
  const [docs, setDocs] = useState<TrainingDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TrainingDocument | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<TrainingDocument | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}/training-documents?target_type=${targetType}&target_id=${targetId}`);
      if (res.ok) {
        const data = await res.json();
        setDocs(data.documents ?? []);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }

  useEffect(() => {
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetType, targetId, baseUrl]);

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(doc: TrainingDocument) {
    setEditing(doc);
    setForm({
      document_type: doc.document_type,
      document_name: doc.document_name,
      file_url: doc.file_url ?? "",
      notes: doc.notes ?? "",
      attach_to_email: doc.attach_to_email,
      is_visible_on_portal: doc.is_visible_on_portal,
    });
    setDialogOpen(true);
  }

  async function save() {
    if (!form.document_name.trim()) {
      toast.error("Document name is required");
      return;
    }
    setSaving(true);
    try {
      const body = {
        target_type: targetType,
        target_id: targetId,
        document_type: form.document_type,
        document_name: form.document_name.trim(),
        file_url: form.file_url.trim() || null,
        notes: form.notes.trim() || null,
        attach_to_email: form.attach_to_email,
        is_visible_on_portal: form.is_visible_on_portal,
      };
      const url = editing
        ? `${baseUrl}/training-documents/${editing.training_document_id}`
        : `${baseUrl}/training-documents`;
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(editing ? "Document updated" : "Document added");
      setDialogOpen(false);
      await load();
    } catch (e: unknown) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function deleteDoc(doc: TrainingDocument) {
    try {
      const res = await fetch(`${baseUrl}/training-documents/${doc.training_document_id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Document removed");
      setConfirmDelete(null);
      await load();
    } catch (e: unknown) {
      toast.error(String(e));
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
          <FileText className="h-3.5 w-3.5 text-slate-400" />
          {title}
          {docs.length > 0 && (
            <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">{docs.length}</span>
          )}
        </h4>
        <Button size="sm" variant="outline" onClick={openAdd} className="h-7 gap-1 text-xs">
          <Plus className="h-3 w-3" />
          Add
        </Button>
      </div>

      {loading ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : docs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 py-4 text-center text-xs text-slate-400">
          No documents yet. Add course materials, lesson plans, questionnaires, etc.
        </p>
      ) : (
        <div className="space-y-1.5">
          {docs.map((doc) => (
            <div
              key={doc.training_document_id}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium text-slate-800">{doc.document_name}</span>
                  <Badge className={`text-xs ${docTypeColor(doc.document_type)}`} variant="outline">
                    {formatDocumentType(doc.document_type)}
                  </Badge>
                  {doc.attach_to_email && (
                    <span className="flex items-center gap-0.5 rounded border border-blue-200 bg-blue-50 px-1 py-0.5 text-[10px] font-medium text-blue-700">
                      <Mail className="h-2.5 w-2.5" /> Email
                    </span>
                  )}
                  {doc.is_visible_on_portal && (
                    <span className="flex items-center gap-0.5 rounded border border-teal-200 bg-teal-50 px-1 py-0.5 text-[10px] font-medium text-teal-700">
                      <Globe className="h-2.5 w-2.5" /> Portal
                    </span>
                  )}
                </div>
                {doc.notes && <p className="mt-0.5 text-xs text-slate-500">{doc.notes}</p>}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {doc.file_url && (
                  <a
                    href={doc.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    title="Open document"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => openEdit(doc)}
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(doc)}
                  className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Document" : "Add Document"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Document Type</Label>
              <Select value={form.document_type} onValueChange={(v) => setForm((f) => ({ ...f, document_type: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Document Name *</Label>
              <Input
                value={form.document_name}
                onChange={(e) => setForm((f) => ({ ...f, document_name: e.target.value }))}
                placeholder="e.g. Net Zero Leaders — Lesson Plan v2"
              />
            </div>

            <div>
              <Label>URL / Link</Label>
              <Input
                value={form.file_url}
                onChange={(e) => setForm((f) => ({ ...f, file_url: e.target.value }))}
                placeholder="https://… (SharePoint, Google Drive, etc.)"
              />
            </div>

            <div>
              <Label>Notes</Label>
              <Textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional description or version note"
              />
            </div>

            <div className="flex gap-6">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-emerald-600"
                  checked={form.attach_to_email}
                  onChange={(e) => setForm((f) => ({ ...f, attach_to_email: e.target.checked }))}
                />
                <span>Attach to emails</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-emerald-600"
                  checked={form.is_visible_on_portal}
                  onChange={(e) => setForm((f) => ({ ...f, is_visible_on_portal: e.target.checked }))}
                />
                <span>Visible on portal</span>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : editing ? "Save Changes" : "Add Document"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!confirmDelete} onOpenChange={() => setConfirmDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove Document</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600">
            Remove <span className="font-medium">{confirmDelete?.document_name}</span>? This cannot be undone.
          </p>
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => confirmDelete && deleteDoc(confirmDelete)}>
              Remove
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
