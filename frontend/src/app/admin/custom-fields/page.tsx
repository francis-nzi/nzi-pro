"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";
import Link from "next/link";
import { apiUrl } from "@/lib/auth-client";

type CustomFieldDefinition = {
  field_id: number;
  field_name: string;
  field_type: string;
  field_label: string;
  is_required: boolean;
  entity_type: string;
  options: any;
  display_order: number;
  is_active: boolean;
  default_value: string | null;
};

const FIELD_TYPES = [
  { value: "checkbox", label: "Checkbox (Yes/No)" },
  { value: "option", label: "Option (Radio buttons)" },
  { value: "multiline_text", label: "Multi-line Text" },
  { value: "decimal", label: "Decimal Number" },
  { value: "number", label: "Number (Integer)" },
  { value: "dropdown", label: "Dropdown" },
  { value: "date", label: "Date" },
  { value: "text", label: "Single-line Text" },
];

const ENTITY_TYPES = [
  { value: "client", label: "Client" },
  { value: "job", label: "Job" },
  { value: "contact", label: "Contact" },
  { value: "quote", label: "Quote" },
  { value: "supplier", label: "Supplier" },
];

export default function CustomFieldsAdmin() {
  const confirmAction = useConfirmDialog();
  const [fields, setFields] = useState<CustomFieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingField, setEditingField] = useState<CustomFieldDefinition | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    field_name: "",
    field_type: "text",
    field_label: "",
    is_required: false,
    entity_type: "job",
    display_order: 0,
    default_value: "",
    options: "",
  });

  useEffect(() => {
    loadFields();
  }, []);

  async function loadFields() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(apiUrl("/custom-fields/definitions"));
      if (!res.ok) throw new Error("Failed to load fields");
      const data = await res.json();
      setFields(data.items || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        ...formData,
        options:
          formData.options && (formData.field_type === "dropdown" || formData.field_type === "option")
            ? (() => {
                try {
                  // First try to parse as JSON
                  return JSON.parse(formData.options);
                } catch {
                  // If that fails, treat as plain text - one option per line
                  return formData.options
                    .split("\n")
                    .filter((line: string) => line.trim())
                    .map((label: string) => ({
                      label: label.trim(),
                      value: label.trim().toLowerCase().replace(/\s+/g, "_"),
                    }));
                }
              })()
            : null,
      };
      let res: Response;
      if (editingField) {
        res = await fetch(apiUrl(`/custom-fields/definitions/${editingField.field_id}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch(apiUrl("/custom-fields/definitions"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      if (!res.ok) {
        throw new Error(editingField ? "Failed to update field" : "Failed to create field");
      }
      setShowForm(false);
      resetForm();
      loadFields();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleDelete(fieldId: number) {
    const confirmed = await confirmAction({
      title: "Delete custom field?",
      description: "This field will be removed from active use across the system.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    try {
      const res = await fetch(apiUrl(`/custom-fields/definitions/${fieldId}`), {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete field");
      loadFields();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function resetForm() {
    setFormData({
      field_name: "",
      field_type: "text",
      field_label: "",
      is_required: false,
      entity_type: "job",
      display_order: 0,
      default_value: "",
      options: "",
    });
    setEditingField(null);
  }

  function openEdit(field: CustomFieldDefinition) {
    setEditingField(field);
    let fieldOptions = "";
    try {
      if (field.options) {
        const opts = JSON.parse(field.options);
        fieldOptions = opts.map((o: any) => o.label).join("\n");
      }
    } catch (e) {}
    setFormData({
      field_name: field.field_name,
      field_type: field.field_type,
      field_label: field.field_label,
      is_required: field.is_required,
      entity_type: field.entity_type,
      display_order: field.display_order,
      default_value: field.default_value || "",
      options: fieldOptions,
    });
    setShowForm(true);
  }

  const jobFields = fields.filter(f => f.entity_type === "job");
  const clientFields = fields.filter(f => f.entity_type === "client");

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="mb-6">
          <Button variant="secondary" asChild className="mb-4">
            <Link href="/admin">← Back to Admin</Link>
          </Button>
          <h1 className="text-3xl font-bold" style={{ color: '#F26624' }}>Custom Fields</h1>
          <p className="text-muted-foreground">Define custom fields for Clients, Jobs, Contacts, Quotes, and Suppliers</p>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-600 mb-4">
            {error}
          </div>
        )}

        <div className="flex justify-end mb-6">
          <Button 
            style={{ backgroundColor: '#F26624' }} 
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? "Cancel" : "Add Custom Field"}
          </Button>
        </div>

            {/* Create/Edit Form */}
        {showForm && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle style={{ color: '#F26624' }}>{editingField ? "Edit Custom Field" : "Create Custom Field"}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Field Label</Label>
                    <Input
                      value={formData.field_label}
                      onChange={(e) => setFormData({ ...formData, field_label: e.target.value })}
                      placeholder="e.g., Multi-Year Contract"
                      required
                    />
                  </div>
                  
                  <div>
                    <Label>Field Name (internal)</Label>
                    <Input
                      value={formData.field_name}
                      onChange={(e) => setFormData({ ...formData, field_name: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                      placeholder="e.g., multi_year_contract"
                      required
                    />
                  </div>

                  <div>
                    <Label>Field Type</Label>
                    <Select
                      value={formData.field_type}
                      onValueChange={(value: string) => setFormData({ ...formData, field_type: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FIELD_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Apply To</Label>
                    <Select
                      value={formData.entity_type}
                      onValueChange={(value: string) => setFormData({ ...formData, entity_type: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ENTITY_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Display Order</Label>
                    <Input
                      type="number"
                      value={formData.display_order}
                      onChange={(e) => setFormData({ ...formData, display_order: parseInt(e.target.value) || 0 })}
                      min={0}
                    />
                  </div>

                  <div>
                    <Label>Default Value</Label>
                    <Input
                      value={formData.default_value}
                      onChange={(e) => setFormData({ ...formData, default_value: e.target.value })}
                      placeholder="Optional default value"
                    />
                  </div>

                  {(formData.field_type === "dropdown" || formData.field_type === "option") && (
                    <div className="col-span-2">
                      <Label>Dropdown Options (one per line)</Label>
                      <Textarea
                        value={formData.options}
                        onChange={(e) => setFormData({ ...formData, options: e.target.value })}
                        placeholder="Option 1&#10;Option 2&#10;Option 3"
                        rows={4}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Enter each option on a new line. These will appear in the dropdown.
                      </p>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="required"
                      checked={formData.is_required}
                      onChange={(e) => setFormData({ ...formData, is_required: e.target.checked })}
                      className="w-4 h-4"
                    />
                    <Label htmlFor="required">Required field</Label>
                  </div>
                </div>

                <div className="flex gap-2 justify-end">
                  <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" style={{ backgroundColor: '#F26624' }}>
                    {editingField ? "Update" : "Create"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {loading ? (
          <div className="text-center py-10">Loading...</div>
        ) : fields.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              No custom fields defined yet. Click "Add Custom Field" to create one.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {/* Job Fields */}
            <Card>
              <CardHeader>
                <CardTitle style={{ color: '#F26624' }}>Job Fields ({jobFields.length})</CardTitle>
              </CardHeader>
              <CardContent>
                {jobFields.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No job fields defined</p>
                ) : (
                  <div className="space-y-3">
                    {jobFields.map((field) => (
                      <div key={field.field_id} className="flex items-center justify-between p-3 border rounded">
                        <div>
                          <div className="font-medium">{field.field_label}</div>
                          <div className="text-xs text-muted-foreground">
                            {field.field_type} • {field.is_required ? "Required" : "Optional"}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => openEdit(field)}>
                            Edit
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => handleDelete(field.field_id)}>
                            Delete
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Client Fields */}
            <Card>
              <CardHeader>
                <CardTitle style={{ color: '#F26624' }}>Client Fields ({clientFields.length})</CardTitle>
              </CardHeader>
              <CardContent>
                {clientFields.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No client fields defined</p>
                ) : (
                  <div className="space-y-3">
                    {clientFields.map((field) => (
                      <div key={field.field_id} className="flex items-center justify-between p-3 border rounded">
                        <div>
                          <div className="font-medium">{field.field_label}</div>
                          <div className="text-xs text-muted-foreground">
                            {field.field_type} • {field.is_required ? "Required" : "Optional"}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => openEdit(field)}>
                            Edit
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => handleDelete(field.field_id)}>
                            Delete
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
