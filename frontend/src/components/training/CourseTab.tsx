"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, Award, BookOpen, ToggleRight } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TRAINING_DELIVERY_MODE_OPTIONS } from "@/lib/training-workflow";
import type { TrainingProduct } from "./types";
import DocumentsPanel from "./DocumentsPanel";

type Props = {
  products: TrainingProduct[];
  baseUrl: string;
  onRefresh: () => void;
};

const EMPTY_FORM = (): Partial<TrainingProduct> => ({
  product_name: "",
  product_code: "",
  description: "",
  default_hours: null,
  default_delivery_mode: null,
  default_capacity: null,
  default_min_attendees: null,
  certificate_policy: "",
  is_active: true,
  accreditation_body: null,
  accreditation_ref: null,
  cpd_hours: null,
  cpd_points: null,
  certificate_validity_months: null,
  attendance_threshold_pct: 80,
});

export default function CourseTab({ products, baseUrl, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editProduct, setEditProduct] = useState<TrainingProduct | null>(null);
  const [form, setForm] = useState<Partial<TrainingProduct>>(EMPTY_FORM());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);

  function openCreate() {
    setEditProduct(null);
    setForm(EMPTY_FORM());
    setShowForm(true);
  }

  function openEdit(p: TrainingProduct) {
    setEditProduct(p);
    setForm({ ...p });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditProduct(null);
  }

  function setField<K extends keyof TrainingProduct>(key: K, value: TrainingProduct[K] | null) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    if (!form.product_name?.trim()) {
      toast.error("Course name is required");
      return;
    }
    setSaving(true);
    try {
      const url = editProduct
        ? `${baseUrl}/training-products/${editProduct.training_product_id}`
        : `${baseUrl}/training-products`;
      const res = await fetch(url, {
        method: editProduct ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(editProduct ? "Course updated" : "Course created");
      closeForm();
      onRefresh();
    } catch (e: unknown) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function deleteProduct(p: TrainingProduct) {
    if (!confirm(`Delete "${p.product_name}"? This cannot be undone.`)) return;
    setDeleting(p.training_product_id);
    try {
      const res = await fetch(`${baseUrl}/training-products/${p.training_product_id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? "Delete failed");
      }
      toast.success("Course deleted");
      onRefresh();
    } catch (e: unknown) {
      toast.error(String(e));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Course Catalogue</h3>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" /> New Course
        </Button>
      </div>

      {products.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-400">
            No courses defined yet. Create your first course above.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {products.map((p) => (
            <Card key={p.training_product_id} className={p.is_active ? "" : "opacity-60"}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-slate-900 text-sm">{p.product_name}</span>
                      {p.product_code && (
                        <Badge variant="outline" className="text-xs">{p.product_code}</Badge>
                      )}
                      {!p.is_active && (
                        <Badge variant="outline" className="text-xs text-slate-400">Inactive</Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(p)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-red-500 hover:text-red-700"
                      onClick={() => deleteProduct(p)}
                      disabled={deleting === p.training_product_id}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                {p.description && (
                  <p className="text-xs text-slate-500 line-clamp-2">{p.description}</p>
                )}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
                  {p.default_hours != null && (
                    <span className="flex items-center gap-1"><BookOpen className="h-3 w-3 text-slate-400" />{p.default_hours}h default</span>
                  )}
                  {p.default_delivery_mode && (
                    <span>{p.default_delivery_mode.replace(/_/g, " ")}</span>
                  )}
                  {p.default_capacity && (
                    <span>Capacity: {p.default_capacity}</span>
                  )}
                  {p.attendance_threshold_pct && (
                    <span>Threshold: {p.attendance_threshold_pct}%</span>
                  )}
                </div>
                {(p.accreditation_body || p.cpd_hours || p.certificate_validity_months) && (
                  <div className="rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                    <span className="flex items-center gap-1 font-medium">
                      <Award className="h-3 w-3" />
                      {p.accreditation_body ?? "Accredited"}
                      {p.accreditation_ref ? ` · ${p.accreditation_ref}` : ""}
                      {p.cpd_hours ? ` · ${p.cpd_hours} CPD hrs` : ""}
                      {p.cpd_points ? ` · ${p.cpd_points} CPD pts` : ""}
                      {p.certificate_validity_months ? ` · ${p.certificate_validity_months}mo validity` : ""}
                    </span>
                  </div>
                )}
                <div className="border-t border-slate-100 pt-3">
                  <DocumentsPanel
                    targetType="product"
                    targetId={p.training_product_id}
                    baseUrl={baseUrl}
                    title="Course Template Documents"
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={(o) => !o && closeForm()}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editProduct ? "Edit Course" : "New Course"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            {/* Core */}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Course Name *</Label>
                <Input value={form.product_name ?? ""} onChange={(e) => setField("product_name", e.target.value)} />
              </div>
              <div>
                <Label>Course Code</Label>
                <Input value={form.product_code ?? ""} onChange={(e) => setField("product_code", e.target.value || null)} />
              </div>
              <div>
                <Label>Default Delivery Mode</Label>
                <Select
                  value={form.default_delivery_mode ?? ""}
                  onValueChange={(v) => setField("default_delivery_mode", v || null)}
                >
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {TRAINING_DELIVERY_MODE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Default Hours</Label>
                <Input
                  type="number"
                  value={form.default_hours ?? ""}
                  onChange={(e) => setField("default_hours", e.target.value ? Number(e.target.value) : null)}
                />
              </div>
              <div>
                <Label>Default Capacity</Label>
                <Input
                  type="number"
                  value={form.default_capacity ?? ""}
                  onChange={(e) => setField("default_capacity", e.target.value ? Number(e.target.value) : null)}
                />
              </div>
              <div>
                <Label>Min Attendees</Label>
                <Input
                  type="number"
                  value={form.default_min_attendees ?? ""}
                  onChange={(e) => setField("default_min_attendees", e.target.value ? Number(e.target.value) : null)}
                />
              </div>
              <div>
                <Label>Attendance Threshold (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={form.attendance_threshold_pct ?? 80}
                  onChange={(e) => setField("attendance_threshold_pct", e.target.value ? Number(e.target.value) : 80)}
                />
              </div>
              <div className="col-span-2">
                <Label>Description</Label>
                <Textarea
                  rows={3}
                  value={form.description ?? ""}
                  onChange={(e) => setField("description", e.target.value || null)}
                />
              </div>
              <div className="col-span-2">
                <Label>Certificate Policy</Label>
                <Textarea
                  rows={2}
                  value={form.certificate_policy ?? ""}
                  onChange={(e) => setField("certificate_policy", e.target.value || null)}
                />
              </div>
            </div>

            {/* Accreditation */}
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700">
                <Award className="h-3.5 w-3.5" /> Accreditation & CPD
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Accrediting Body</Label>
                  <Input
                    placeholder="e.g. IEMA, CPD Certification Service"
                    value={form.accreditation_body ?? ""}
                    onChange={(e) => setField("accreditation_body", e.target.value || null)}
                  />
                </div>
                <div>
                  <Label>Accreditation Reference</Label>
                  <Input
                    value={form.accreditation_ref ?? ""}
                    onChange={(e) => setField("accreditation_ref", e.target.value || null)}
                  />
                </div>
                <div>
                  <Label>CPD Hours</Label>
                  <Input
                    type="number"
                    step="0.5"
                    value={form.cpd_hours ?? ""}
                    onChange={(e) => setField("cpd_hours", e.target.value ? Number(e.target.value) : null)}
                  />
                </div>
                <div>
                  <Label>CPD Points</Label>
                  <Input
                    type="number"
                    value={form.cpd_points ?? ""}
                    onChange={(e) => setField("cpd_points", e.target.value ? Number(e.target.value) : null)}
                  />
                </div>
                <div>
                  <Label>Certificate Validity (months)</Label>
                  <Input
                    type="number"
                    value={form.certificate_validity_months ?? ""}
                    onChange={(e) => setField("certificate_validity_months", e.target.value ? Number(e.target.value) : null)}
                  />
                </div>
              </div>
            </div>

            {/* Active toggle */}
            <div className="flex items-center gap-3">
              <ToggleRight className="h-4 w-4 text-slate-400" />
              <Label className="cursor-pointer">
                <input
                  type="checkbox"
                  className="mr-2 accent-emerald-600"
                  checked={form.is_active ?? true}
                  onChange={(e) => setField("is_active", e.target.checked)}
                />
                Active (visible in course selector)
              </Label>
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={closeForm}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : editProduct ? "Save Changes" : "Create Course"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
