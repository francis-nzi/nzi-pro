import { useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type PortalDataEntryDeadlineCardProps = {
  dataCollectionDue?: string | null;
  portalDataEntryExpiry?: string | null;
  portalDataEntryExpired?: boolean;
  portalDataEntryExpiryOverride?: string | null;
  maxOverrideDate?: string | null;
  onSetOverride: (overrideDate: string | null) => Promise<void>;
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function PortalDataEntryDeadlineCard({
  dataCollectionDue,
  portalDataEntryExpiry,
  portalDataEntryExpired,
  portalDataEntryExpiryOverride,
  maxOverrideDate,
  onSetOverride,
}: PortalDataEntryDeadlineCardProps) {
  const [editing, setEditing] = useState(false);
  const [draftDate, setDraftDate] = useState(portalDataEntryExpiryOverride || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await onSetOverride(draftDate || null);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update the deadline.");
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    setSaving(true);
    setError("");
    try {
      await onSetOverride(null);
      setDraftDate("");
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to clear the override.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Client Portal Data Entry</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 rounded-lg border p-3">
          <div className={`h-4 w-4 rounded-full ${portalDataEntryExpired ? "bg-red-500" : "bg-emerald-500"}`} />
          <div className="flex-1">
            <div className="font-medium">{portalDataEntryExpired ? "Closed" : "Open"}</div>
            <div className="text-sm text-muted-foreground">
              {portalDataEntryExpiry
                ? `${portalDataEntryExpired ? "Closed since" : "Closes on"} ${formatDate(portalDataEntryExpiry)}`
                : "No deadline set — clients can submit indefinitely"}
              {portalDataEntryExpiryOverride ? " (CRM override)" : ""}
            </div>
            {portalDataEntryExpiryOverride && dataCollectionDue ? (
              <div className="mt-1 text-xs text-muted-foreground">
                Data Collection Deadline milestone: {formatDate(dataCollectionDue)}
              </div>
            ) : null}
          </div>
          {!editing ? (
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
              onClick={() => {
                setDraftDate(portalDataEntryExpiryOverride || "");
                setEditing(true);
              }}
            >
              {portalDataEntryExpiryOverride ? "Change override" : "Extend deadline"}
            </button>
          ) : null}
        </div>

        {editing ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3">
            <input
              type="date"
              value={draftDate}
              max={maxOverrideDate || undefined}
              onChange={(e) => setDraftDate(e.target.value)}
              className="rounded-md border px-2 py-1.5 text-sm"
            />
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
              disabled={saving || !draftDate}
              onClick={handleSave}
            >
              {saving ? "Saving..." : "Save"}
            </button>
            {portalDataEntryExpiryOverride ? (
              <button
                type="button"
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                disabled={saving}
                onClick={handleClear}
              >
                Clear override
              </button>
            ) : null}
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
              disabled={saving}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
            {maxOverrideDate ? (
              <div className="w-full text-xs text-muted-foreground">
                Latest allowed date: {formatDate(maxOverrideDate)} (30 days past the Data Collection Deadline)
              </div>
            ) : null}
            {error ? <div className="w-full text-xs text-red-600">{error}</div> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
