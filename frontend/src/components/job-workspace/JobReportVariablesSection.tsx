import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AUTO_REPORT_METADATA_FIELDS, type ReportMetadataField } from "@/lib/job-workspace";
import { normalizeMetadataBoolean } from "@/lib/job-workspace";

type ConsultantOption = {
  user_id?: string | null;
  full_name: string | null;
  position?: string | null;
};

type JobReportVariablesSectionProps = {
  fieldsBySection: Record<string, ReportMetadataField[]>;
  fieldValues: Record<string, string>;
  consultantOptions: ConsultantOption[];
  apiUnavailable: boolean;
  saving: boolean;
  status: string;
  onValueChange: (fieldKey: string, nextValue: string) => void;
  onSave: () => void;
  hasFields: boolean;
};

function ConsultantCombobox({
  value,
  options,
  onSelect,
}: {
  value: string;
  options: ConsultantOption[];
  onSelect: (name: string, position: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const filtered = query.trim()
    ? options.filter((m) => (m.full_name ?? "").toLowerCase().includes(query.toLowerCase()))
    : options;

  function handleSelect(member: ConsultantOption) {
    onSelect(member.full_name ?? "", member.position ?? "");
    setQuery(member.full_name ?? "");
    setOpen(false);
  }

  function handleClear() {
    onSelect("", "");
    setQuery("");
    setOpen(false);
  }

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery(value);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [value]);

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={query}
        placeholder="Search team members..."
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md max-h-52 overflow-y-auto">
          <div
            className="cursor-pointer px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
            onMouseDown={(e) => { e.preventDefault(); handleClear(); }}
          >
            None
          </div>
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">No matches</div>
          ) : (
            filtered.map((m) => (
              <div
                key={`${m.user_id ?? ""}-${m.full_name ?? ""}`}
                className={`cursor-pointer px-3 py-2 text-sm hover:bg-accent ${
                  (m.full_name ?? "") === value ? "bg-accent/50 font-medium" : ""
                }`}
                onMouseDown={(e) => { e.preventDefault(); handleSelect(m); }}
              >
                {m.full_name}
                {m.position ? (
                  <span className="ml-2 text-xs text-muted-foreground">{m.position}</span>
                ) : null}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function renderFieldInput(
  field: ReportMetadataField,
  value: string,
  consultantOptions: ConsultantOption[],
  onValueChange: (fieldKey: string, nextValue: string) => void
) {
  const inputId = `setup-report-meta-${field.key}`;
  const isAutoField = AUTO_REPORT_METADATA_FIELDS.has(field.key);

  if (field.key === "consultant_name") {
    return (
      <ConsultantCombobox
        value={value.trim()}
        options={consultantOptions}
        onSelect={(name, position) => {
          onValueChange("consultant_name", name);
          onValueChange("consultant_position", position);
        }}
      />
    );
  }

  if (field.key === "consultant_position") {
    return <Input id={inputId} type="text" value={value} onChange={(e) => onValueChange(field.key, e.target.value)} />;
  }

  if (field.field_type === "textarea") {
    return (
      <Textarea
        id={inputId}
        value={value}
        rows={3}
        className={`resize-y ${isAutoField ? "bg-muted" : ""}`}
        readOnly={isAutoField}
        onChange={(e) => onValueChange(field.key, e.target.value)}
      />
    );
  }

  if (field.field_type === "boolean") {
    return (
      <Select
        value={value}
        onValueChange={(nextValue) => onValueChange(field.key, normalizeMetadataBoolean(nextValue))}
      >
        <SelectTrigger id={inputId}>
          <SelectValue placeholder="Select..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">Yes</SelectItem>
          <SelectItem value="false">No</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (field.field_type === "date") {
    return (
      <Input id={inputId} type="date" value={value} onChange={(e) => onValueChange(field.key, e.target.value)} />
    );
  }

  if (field.field_type === "number") {
    return (
      <Input
        id={inputId}
        type="number"
        value={value}
        readOnly={isAutoField}
        className={isAutoField ? "bg-muted" : undefined}
        onChange={(e) => onValueChange(field.key, e.target.value)}
      />
    );
  }

  return (
    <Input
      id={inputId}
      type="text"
      value={value}
      readOnly={isAutoField}
      className={isAutoField ? "bg-muted" : undefined}
      onChange={(e) => onValueChange(field.key, e.target.value)}
    />
  );
}

export default function JobReportVariablesSection({
  fieldsBySection,
  fieldValues,
  consultantOptions,
  apiUnavailable,
  saving,
  status,
  onValueChange,
  onSave,
  hasFields,
}: JobReportVariablesSectionProps) {
  return (
    <Card id="report-variables-section">
      <CardHeader>
        <CardTitle>Job Report Variables</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          These fields are <strong>global report metadata</strong> used by the report templates for methodology,
          data quality, targets, and other one-to-one placeholders. Template-specific section commentary lives in
          <strong> Report - Variables</strong>.
        </div>

        {!hasFields ? (
          <div className="text-sm text-muted-foreground">No report metadata variables available for this job.</div>
        ) : (
          Object.entries(fieldsBySection).map(([section, fields]) => (
            <div key={section} className="space-y-4">
              <h4 className="text-sm font-semibold">{section}</h4>
              <div className="grid gap-4 md:grid-cols-2">
                {fields.map((field) => (
                  <div
                    key={field.key}
                    className={field.field_type === "textarea" ? "space-y-2 md:col-span-2" : "space-y-2"}
                  >
                    <Label htmlFor={`setup-report-meta-${field.key}`} className="flex items-center gap-2">
                      {field.label}
                      {AUTO_REPORT_METADATA_FIELDS.has(field.key) ? (
                        <span className="rounded bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                          Auto-generated
                        </span>
                      ) : null}
                    </Label>
                    {renderFieldInput(field, fieldValues[field.key] ?? "", consultantOptions, onValueChange)}
                    {field.key === "datasets_names" ? (
                      <div className="text-xs text-muted-foreground">
                        Derived automatically from the job&apos;s active datasets and reporting period.
                      </div>
                    ) : field.key === "energy_consumption_uk_kwh" ? (
                      <div className="text-xs text-muted-foreground">
                        Derived automatically from Scope 2 UK electricity rows in Data Entry and uploads.
                      </div>
                    ) : field.key === "energy_consumption_non_uk_kwh" ? (
                      <div className="text-xs text-muted-foreground">
                        Derived automatically from Scope 2 non-UK electricity rows in Data Entry and uploads.
                      </div>
                    ) : field.key === "renewable_energy_kwh" ? (
                      <div className="text-xs text-muted-foreground">
                        Derived automatically from renewable or green electricity rows in the job&apos;s data inputs.
                      </div>
                    ) : field.key === "energy_emissions_tco2e" ? (
                      <div className="text-xs text-muted-foreground">
                        Auto-calculated from the data-derived kWh using the active electricity and T&amp;D factors.
                      </div>
                    ) : field.key === "energy_emissions_market_tco2e" ? (
                      <div className="text-xs text-muted-foreground">
                        Auto-calculated from the data-derived kWh. Renewable kWh suppresses the location factor,
                        while T&amp;D still applies to total grid electricity.
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}

        <div className="flex justify-end">
          <Button
            onClick={onSave}
            disabled={saving || !hasFields || apiUnavailable}
          >
            {apiUnavailable ? "Save Unavailable" : saving ? "Saving..." : "Save Report Variables"}
          </Button>
        </div>

        {status ? <div className="text-sm text-muted-foreground">{status}</div> : null}
      </CardContent>
    </Card>
  );
}
