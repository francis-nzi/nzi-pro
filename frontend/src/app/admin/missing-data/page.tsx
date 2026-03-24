"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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

function apiBaseUrl(): string {
  return "/api/backend";
}

type MissingFieldOption = {
  value: string;
  label: string;
};

type MissingFieldDef = {
  name: string;
  label: string;
  type: "text" | "textarea" | "date" | "integer" | "number" | "select";
  options?: MissingFieldOption[];
};

type MissingDataFieldsResponse = {
  ok?: boolean;
  entities?: {
    client?: MissingFieldDef[];
    job?: MissingFieldDef[];
  };
};

type MissingDataRow = {
  record_id: number;
  primary_label: string;
  secondary_label?: string;
  client_label?: string;
  owner_label?: string;
  status_label?: string;
  current_value?: string | number | boolean | null;
  edit_url?: string;
};

type MissingDataQueryResponse = {
  ok?: boolean;
  entity?: "client" | "job";
  field?: string;
  summary?: {
    total_matching?: number;
    returned_rows?: number;
    missing_only?: boolean;
    limit?: number;
  };
  rows?: MissingDataRow[];
};

function toDraftValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function displayValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === "") return "Missing";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function formatCount(value: number | undefined): string {
  return Number(value || 0).toLocaleString();
}

export default function AdminMissingDataPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const [loadingFields, setLoadingFields] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [saving, setSaving] = useState<number | "bulk" | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [fieldCatalog, setFieldCatalog] = useState<{ client: MissingFieldDef[]; job: MissingFieldDef[] }>({
    client: [],
    job: [],
  });
  const [entity, setEntity] = useState<"client" | "job">("client");
  const [fieldName, setFieldName] = useState("");
  const [search, setSearch] = useState("");
  const [missingOnly, setMissingOnly] = useState(true);
  const [limit, setLimit] = useState("200");
  const [rows, setRows] = useState<MissingDataRow[]>([]);
  const [summary, setSummary] = useState<MissingDataQueryResponse["summary"] | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [bulkValue, setBulkValue] = useState("");

  const fields = fieldCatalog[entity] || [];
  const selectedField = fields.find((field) => field.name === fieldName) || null;

  useEffect(() => {
    void loadFieldCatalog();
  }, [baseUrl]);

  useEffect(() => {
    if (!fieldName && fields.length > 0) {
      setFieldName(fields[0].name);
    }
  }, [fieldName, fields]);

  useEffect(() => {
    if (selectedField) {
      void loadRows();
    }
  }, [selectedField, entity, missingOnly]);

  async function loadFieldCatalog() {
    setLoadingFields(true);
    setError("");
    try {
      const res = await fetch(`${baseUrl}/admin/missing-data/fields`, { credentials: "include" });
      const json: MissingDataFieldsResponse = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(String((json as { detail?: string })?.detail || "Failed to load field list"));
      }
      setFieldCatalog({
        client: Array.isArray(json.entities?.client) ? json.entities.client : [],
        job: Array.isArray(json.entities?.job) ? json.entities.job : [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load field list");
    } finally {
      setLoadingFields(false);
    }
  }

  async function loadRows() {
    if (!fieldName) return;
    setLoadingRows(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/admin/missing-data/query`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity,
          field: fieldName,
          missing_only: missingOnly,
          search,
          limit: Number(limit || 200),
        }),
      });
      const json: MissingDataQueryResponse = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(String((json as { detail?: string })?.detail || "Failed to load rows"));
      }
      const nextRows = Array.isArray(json.rows) ? json.rows : [];
      setRows(nextRows);
      setSummary(json.summary || null);
      const nextDrafts: Record<number, string> = {};
      nextRows.forEach((row) => {
        nextDrafts[row.record_id] = toDraftValue(row.current_value);
      });
      setDrafts(nextDrafts);
    } catch (err) {
      setRows([]);
      setSummary(null);
      setError(err instanceof Error ? err.message : "Failed to load rows");
    } finally {
      setLoadingRows(false);
    }
  }

  async function saveRow(row: MissingDataRow) {
    if (!selectedField) return;
    setSaving(row.record_id);
    setError("");
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/admin/missing-data/update`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity,
          field: selectedField.name,
          record_id: row.record_id,
          value: drafts[row.record_id] ?? "",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(String((json as { detail?: string })?.detail || "Save failed"));
      }
      const savedValue = (json as { value?: string | number | boolean | null }).value ?? null;
      setRows((prev) =>
        prev
          .map((item) => (item.record_id === row.record_id ? { ...item, current_value: savedValue } : item))
          .filter((item) => !(missingOnly && item.record_id === row.record_id && savedValue !== null && String(savedValue).trim() !== ""))
      );
      setDrafts((prev) => ({ ...prev, [row.record_id]: toDraftValue(savedValue) }));
      setStatus(`Updated ${row.primary_label}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(null);
    }
  }

  async function bulkApply() {
    if (!selectedField || rows.length === 0) return;
    setSaving("bulk");
    setError("");
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/admin/missing-data/bulk-update`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity,
          field: selectedField.name,
          value: bulkValue,
          record_ids: rows.map((row) => row.record_id),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(String((json as { detail?: string })?.detail || "Bulk update failed"));
      }
      setStatus(`Updated ${formatCount(rows.length)} ${entity === "client" ? "clients" : "jobs"}.`);
      setBulkValue("");
      if (missingOnly) {
        setRows([]);
      } else {
        setRows((prev) => prev.map((row) => ({ ...row, current_value: bulkValue || null })));
      }
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk update failed");
    } finally {
      setSaving(null);
    }
  }

  function renderEditor(value: string, onChange: (next: string) => void, idPrefix: string) {
    if (!selectedField) return null;
    if (selectedField.type === "textarea") {
      return <Textarea id={idPrefix} value={value} onChange={(e) => onChange(e.target.value)} className="min-h-[84px]" />;
    }
    if (selectedField.type === "select") {
      const options = Array.isArray(selectedField.options) ? selectedField.options : [];
      return (
        <Select value={value || "__blank__"} onValueChange={(next) => onChange(next === "__blank__" ? "" : next)}>
          <SelectTrigger id={idPrefix}>
            <SelectValue placeholder="Select value..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__blank__">Blank</SelectItem>
            {options.map((option) => (
              <SelectItem key={`${idPrefix}-${option.value}`} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    const inputType =
      selectedField.type === "date"
        ? "date"
        : selectedField.type === "integer" || selectedField.type === "number"
          ? "number"
          : "text";
    return <Input id={idPrefix} type={inputType} value={value} onChange={(e) => onChange(e.target.value)} />;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-6 py-10 space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-bold" style={{ color: "#F26624" }}>
              Missing Data
            </h1>
            <p className="text-muted-foreground">
              Find clients and jobs with missing values for a selected field, then update them quickly in one place.
            </p>
          </div>
          <Button variant="secondary" asChild>
            <Link href="/admin">{"<-"} Back to Admin</Link>
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <Label>Entity</Label>
                <Select value={entity} onValueChange={(value: "client" | "job") => setEntity(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="client">Clients</SelectItem>
                    <SelectItem value="job">Jobs</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Field</Label>
                <Select value={fieldName} onValueChange={setFieldName} disabled={loadingFields || fields.length === 0}>
                  <SelectTrigger>
                    <SelectValue placeholder={loadingFields ? "Loading fields..." : "Select field"} />
                  </SelectTrigger>
                  <SelectContent>
                    {fields.map((field) => (
                      <SelectItem key={field.name} value={field.name}>
                        {field.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Search</Label>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={entity === "client" ? "Client, CRM, industry..." : "Job no, title, client, CRM..."}
                />
              </div>
              <div>
                <Label>Max rows</Label>
                <Input type="number" min={1} max={500} value={limit} onChange={(e) => setLimit(e.target.value)} />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={missingOnly}
                  onChange={(e) => setMissingOnly(e.target.checked)}
                />
                Show missing values only
              </label>
              <Button onClick={() => void loadRows()} disabled={loadingFields || !fieldName || loadingRows}>
                {loadingRows ? "Refreshing..." : "Refresh Results"}
              </Button>
            </div>

            {selectedField ? (
              <div className="rounded border bg-muted/20 p-3 text-sm text-muted-foreground">
                Editing field: <strong>{selectedField.label}</strong>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded border bg-muted/20 p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Total Matching</div>
                <div className="mt-1 text-2xl font-semibold">{formatCount(summary?.total_matching)}</div>
              </div>
              <div className="rounded border bg-muted/20 p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Rows Loaded</div>
                <div className="mt-1 text-2xl font-semibold">{formatCount(summary?.returned_rows)}</div>
              </div>
              <div className="rounded border bg-muted/20 p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Mode</div>
                <div className="mt-1 text-lg font-semibold">{summary?.missing_only ? "Missing only" : "All rows"}</div>
              </div>
              <div className="rounded border bg-muted/20 p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Field Type</div>
                <div className="mt-1 text-lg font-semibold">{selectedField?.type || "-"}</div>
              </div>
            </div>

            {selectedField && rows.length > 0 ? (
              <div className="rounded border p-4 space-y-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <div className="text-sm font-medium">Bulk Fill Visible Rows</div>
                    <div className="text-xs text-muted-foreground">
                      Apply one value to all currently listed {entity === "client" ? "clients" : "jobs"} for {selectedField.label}.
                    </div>
                  </div>
                  <Button onClick={() => void bulkApply()} disabled={saving !== null || rows.length === 0}>
                    {saving === "bulk" ? "Applying..." : `Apply to ${formatCount(rows.length)} Rows`}
                  </Button>
                </div>
                {renderEditor(bulkValue, setBulkValue, "bulk-value")}
              </div>
            ) : null}

            {error ? <div className="text-sm text-red-600">{error}</div> : null}
            {status ? <div className="text-sm text-muted-foreground">{status}</div> : null}

            {rows.length === 0 ? (
              <div className="rounded border border-dashed p-8 text-center text-sm text-muted-foreground">
                {loadingRows ? "Loading rows..." : "No rows matched the current filters."}
              </div>
            ) : (
              <div className="space-y-3">
                {rows.map((row) => (
                  <div key={row.record_id} className="rounded border p-4 space-y-3">
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="text-base font-semibold">{row.primary_label}</div>
                        {row.secondary_label ? <div className="text-sm text-muted-foreground">{row.secondary_label}</div> : null}
                        <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                          {row.client_label ? <span>Client: {row.client_label}</span> : null}
                          {row.owner_label ? <span>Owner: {row.owner_label}</span> : null}
                          {row.status_label ? <span>Status: {row.status_label}</span> : null}
                        </div>
                      </div>
                      {row.edit_url ? (
                        <Button variant="outline" asChild>
                          <Link href={row.edit_url}>Open Record</Link>
                        </Button>
                      ) : null}
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr_auto] xl:items-end">
                      <div>
                        <Label>Current Value</Label>
                        <div className="mt-2 rounded border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                          {displayValue(row.current_value)}
                        </div>
                      </div>
                      <div>
                        <Label htmlFor={`row-${row.record_id}`}>New Value</Label>
                        <div className="mt-2">
                          {renderEditor(drafts[row.record_id] ?? "", (next) => setDrafts((prev) => ({ ...prev, [row.record_id]: next })), `row-${row.record_id}`)}
                        </div>
                      </div>
                      <Button onClick={() => void saveRow(row)} disabled={saving !== null}>
                        {saving === row.record_id ? "Saving..." : "Save"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
