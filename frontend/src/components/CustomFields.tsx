"use client";

import { useEffect, useState } from "react";
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
  default_value?: string | null;
  field_value?: string | null;
};

type CustomFieldsProps = {
  entityId: number;
  entityType: "job" | "client" | "contact" | "quote" | "supplier";
  baseUrl: string;
  embedded?: boolean; // when true, renders without its own Card wrapper
  fieldNames?: string[];
  excludeFieldNames?: string[];
  hideEmptyState?: boolean;
};

export default function CustomFields({
  entityId,
  entityType,
  baseUrl,
  embedded = false,
  fieldNames,
  excludeFieldNames,
  hideEmptyState = false,
}: CustomFieldsProps) {
  const [fields, setFields] = useState<CustomFieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<number, string>>({});

  useEffect(() => {
    loadFields();
  }, [entityId, entityType, baseUrl, fieldNames?.join("|"), excludeFieldNames?.join("|")]);

  function filterFields(items: CustomFieldDefinition[]) {
    if (!fieldNames || fieldNames.length === 0) {
      return excludeFieldNames && excludeFieldNames.length > 0
        ? items.filter((item) => !excludeFieldNames.map((name) => String(name || "").trim()).includes(String(item.field_name || "").trim()))
        : items;
    }
    const allowed = new Set(fieldNames.map((name) => String(name || "").trim()).filter(Boolean));
    const excluded = new Set((excludeFieldNames || []).map((name) => String(name || "").trim()).filter(Boolean));
    return items.filter((item) => {
      const fieldName = String(item.field_name || "").trim();
      return allowed.has(fieldName) && !excluded.has(fieldName);
    });
  }

  async function loadFields() {
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}/custom-fields/values/${entityType}/${entityId}`);
      if (!res.ok) throw new Error("Failed to load custom fields");
      const data = await res.json();
      const items = filterFields(data.items || []);
      setFields(items);

      // Initialize field values from the loaded data (use default_value if no value saved)
      const values: Record<number, string> = {};
      items.forEach((item: CustomFieldDefinition) => {
        values[item.field_id] = item.field_value || item.default_value || "";
      });
      setFieldValues(values);
    } catch (e) {
      console.error("Error loading custom fields:", e);
    } finally {
      setLoading(false);
    }
  }

  async function saveFields() {
    // Check required fields
    const missingRequired = fields.filter(f => f.is_required && !fieldValues[f.field_id]?.trim());
    if (missingRequired.length > 0) {
      setStatus(`Please fill in required fields: ${missingRequired.map(f => f.field_label).join(", ")}`);
      return;
    }

    setSaving(true);
    setStatus("Saving...");

    try {
      const valuesToSave = Object.entries(fieldValues).map(([field_id, field_value]) => ({
        field_id: parseInt(field_id),
        entity_id: entityId,
        entity_type: entityType,
        field_value: field_value || null,
      }));

      const res = await fetch(`${baseUrl}/custom-fields/values`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(valuesToSave),
      });

      if (!res.ok) throw new Error("Failed to save custom fields");

      setStatus("Custom fields saved successfully!");
      setTimeout(() => setStatus(""), 3000);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  function handleValueChange(fieldId: number, value: string) {
    setFieldValues((prev) => ({ ...prev, [fieldId]: value }));
  }

  function renderFieldInput(field: CustomFieldDefinition) {
    const value = fieldValues[field.field_id] || "";

    switch (field.field_type) {
      case "textarea":
      case "multiline_text":
        return (
          <Textarea
            value={value}
            onChange={(e) => handleValueChange(field.field_id, e.target.value)}
            placeholder={`Enter ${field.field_label.toLowerCase()}...`}
            rows={3}
            className="resize-y"
          />
        );

      case "number":
      case "decimal":
        return (
          <Input
            type="number"
            step={field.field_type === "decimal" ? "0.01" : "1"}
            value={value}
            onChange={(e) => handleValueChange(field.field_id, e.target.value)}
            placeholder={`Enter ${field.field_label.toLowerCase()}...`}
          />
        );

      case "checkbox":
        return (
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id={`field-${field.field_id}`}
              checked={value === "true" || value === "1" || value === "yes"}
              onChange={(e) => handleValueChange(field.field_id, e.target.checked ? "true" : "false")}
              className="w-5 h-5 rounded border-gray-300"
            />
            <Label htmlFor={`field-${field.field_id}`} className="text-muted-foreground">
              {value === "true" || value === "1" || value === "yes" ? "Yes" : "No"}
            </Label>
          </div>
        );

      case "date":
        return (
          <Input
            type="date"
            value={value}
            onChange={(e) => handleValueChange(field.field_id, e.target.value)}
          />
        );

      case "dropdown":
      case "option":
        let options: any[] = [];
        if (field.options) {
          if (typeof field.options === "string") {
            try { options = JSON.parse(field.options); } catch { options = []; }
          } else if (Array.isArray(field.options)) {
            options = field.options;
          }
        }
        return (
          <Select value={value} onValueChange={(v) => handleValueChange(field.field_id, v)}>
            <SelectTrigger>
              <SelectValue placeholder={`Select ${field.field_label.toLowerCase()}...`} />
            </SelectTrigger>
            <SelectContent>
              {options.map((opt: any, idx: number) => (
                <SelectItem key={idx} value={opt.value || opt.label || String(opt)}>
                  {opt.label || opt.value || String(opt)}
                </SelectItem>
              ))}

            </SelectContent>
          </Select>
        );

      default:
        // text, single-line text
        return (
          <Input
            type="text"
            value={value}
            onChange={(e) => handleValueChange(field.field_id, e.target.value)}
            placeholder={`Enter ${field.field_label.toLowerCase()}...`}
          />
        );
    }
  }

  if (loading) {
    if (embedded) return <p className="py-4 text-center text-sm text-muted-foreground">Loading custom fields...</p>;
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Loading custom fields...
        </CardContent>
      </Card>
    );
  }

  if (hideEmptyState && fields.length === 0) return null;
  if (fields.length === 0) {
    if (embedded) return <p className="text-sm text-muted-foreground">No custom fields defined. Go to Admin → Custom Fields to add fields.</p>;
    return (
      <Card>
        <CardHeader>
          <CardTitle style={{ color: '#F26624' }}>Custom Fields</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            No custom fields defined for {entityType}s. Go to Admin → Custom Fields to add fields.
          </p>
        </CardContent>
      </Card>
    );
  }

  const inner = (
    <div className="space-y-6">

        {/* Unified 2-column grid — field pairs determined by display_order */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {fields.map((field) => {
            const isWide = field.field_type === "textarea" || field.field_type === "multiline_text";
            if (field.field_type === "checkbox") {
              const value = fieldValues[field.field_id] || "";
              const checked = value === "true" || value === "1" || value === "yes";
              return (
                <div key={field.field_id} className={isWide ? "md:col-span-2" : ""}>
                  <label
                    htmlFor={`field-${field.field_id}`}
                    className="flex h-full min-h-[60px] cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 hover:bg-slate-100 transition-colors"
                  >
                    <input
                      id={`field-${field.field_id}`}
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => handleValueChange(field.field_id, e.target.checked ? "true" : "false")}
                      className="h-4 w-4 shrink-0 rounded border-slate-300 accent-[#F26624]"
                    />
                    <div>
                      <div className="text-sm font-medium text-slate-700">
                        {field.field_label}
                        {field.is_required && <span className="ml-1 text-red-500">*</span>}
                      </div>
                      <div className="text-xs text-slate-400">{checked ? "Yes" : "No"}</div>
                    </div>
                  </label>
                </div>
              );
            }
            return (
              <div key={field.field_id} className={`space-y-1.5${isWide ? " md:col-span-2" : ""}`}>
                <Label htmlFor={`field-${field.field_id}`} className="flex items-center gap-1 text-sm font-medium">
                  {field.field_label}
                  {field.is_required && <span className="text-red-500">*</span>}
                </Label>
                {renderFieldInput(field)}
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 pt-4">
          <div className={`text-sm ${status.includes("Please") ? "text-red-500 font-medium" : "text-muted-foreground"}`}>{status}</div>
          <Button onClick={saveFields} disabled={saving} style={{ backgroundColor: '#F26624' }}>
            {saving ? "Saving..." : "Save Custom Fields"}
          </Button>
        </div>
      </div>
  );

  if (embedded) return inner;
  return (
    <Card>
      <CardHeader>
        <CardTitle style={{ color: '#F26624' }}>Custom Fields</CardTitle>
      </CardHeader>
      <CardContent>{inner}</CardContent>
    </Card>
  );
}
