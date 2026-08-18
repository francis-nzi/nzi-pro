"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  allSelected: boolean;
  someSelected: boolean;
  selectedCount: number;
  busy: boolean;
  error?: string;
  onToggleSelectAll: () => void;
  onApprove: () => void;
  onReject: (note: string | null) => void;
};

// Select-all checkbox + bulk approve/reject bar, shared by the various
// "Pending Portal Submissions"-style panels (Data Entry, Spend Data, Asset
// Register, Business Travel Register). Each panel keeps its own per-row
// rendering and selection state (see hooks/useBulkSelection) -- this is
// just the chrome, lifted out of PendingPortalCommutingSubmissions.tsx's
// original inline version so it isn't copy-pasted a 4th time.
export default function BulkSelectionBar({
  allSelected,
  someSelected,
  selectedCount,
  busy,
  error,
  onToggleSelectAll,
  onApprove,
  onReject,
}: Props) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");

  return (
    <div className="space-y-2 border-b pb-2">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected;
            }}
            onChange={onToggleSelectAll}
            className="size-4"
          />
          Select all
        </label>
        {selectedCount > 0 && (
          <>
            <span className="text-xs text-muted-foreground">{selectedCount} selected</span>
            <div className="ml-auto flex gap-2">
              <Button size="sm" disabled={busy} onClick={onApprove}>
                {busy ? "Approving..." : `Approve ${selectedCount}`}
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setRejecting((v) => !v)}>
                {`Reject ${selectedCount}`}
              </Button>
            </div>
          </>
        )}
      </div>

      {rejecting && selectedCount > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-rose-200 bg-rose-50 p-3">
          <Textarea
            placeholder="Reason for rejection, applied to all selected rows (shown to the client)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="text-sm"
          />
          <div>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                onReject(note || null);
                setRejecting(false);
                setNote("");
              }}
            >
              {busy ? "Rejecting..." : `Confirm Rejection of ${selectedCount}`}
            </Button>
          </div>
        </div>
      )}

      {error && <div className="text-xs text-rose-700">{error}</div>}
    </div>
  );
}
