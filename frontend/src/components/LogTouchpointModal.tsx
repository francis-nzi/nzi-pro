"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type LogTouchpointModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseUrl: string;
  clientDbId: number | null;
  clientName?: string;
  onSaved?: () => void | Promise<void>;
};

const TOUCHPOINT_TYPES = [
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "meeting", label: "Meeting" },
  { value: "report_sent", label: "Report Sent" },
  { value: "data_request", label: "Data Request" },
  { value: "other", label: "Other" },
];

const OUTCOMES = [
  { value: "positive", label: "Positive" },
  { value: "neutral", label: "Neutral" },
  { value: "concern_raised", label: "Concern Raised" },
  { value: "escalation_needed", label: "Escalation Needed" },
];

function toDateTimeLocal(value: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = value.getFullYear();
  const month = pad(value.getMonth() + 1);
  const day = pad(value.getDate());
  const hours = pad(value.getHours());
  const minutes = pad(value.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export default function LogTouchpointModal({
  open,
  onOpenChange,
  baseUrl,
  clientDbId,
  clientName,
  onSaved,
}: LogTouchpointModalProps) {
  const initialDateTime = useMemo(() => toDateTimeLocal(new Date()), [open]);
  const [touchpointType, setTouchpointType] = useState("call");
  const [occurredAt, setOccurredAt] = useState(initialDateTime);
  const [summary, setSummary] = useState("");
  const [outcome, setOutcome] = useState("neutral");
  const [nextAction, setNextAction] = useState("");
  const [nextActionDue, setNextActionDue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setTouchpointType("call");
    setOccurredAt(toDateTimeLocal(new Date()));
    setSummary("");
    setOutcome("neutral");
    setNextAction("");
    setNextActionDue("");
    setSaving(false);
    setError("");
  }, [open]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clientDbId) {
      setError("Client is required.");
      return;
    }
    if (!summary.trim()) {
      setError("Summary is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        client_db_id: clientDbId,
        touchpoint_type: touchpointType,
        summary: summary.trim(),
        outcome,
        next_action: nextAction.trim() || null,
        next_action_due: nextActionDue || null,
        occurred_at: occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString(),
      };
      const res = await fetch(`${baseUrl}/intelligence/touchpoints`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let detail = "Failed to save touchpoint.";
        try {
          const data = await res.json();
          if (data?.detail) detail = String(data.detail);
        } catch {
          /* ignore */
        }
        throw new Error(detail);
      }
      await onSaved?.();
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message || "Failed to save touchpoint.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Log Contact</DialogTitle>
          <DialogDescription>
            {clientName ? `Capture a touchpoint for ${clientName}.` : "Capture a client touchpoint."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label>Touchpoint Type</Label>
            <Select value={touchpointType} onValueChange={setTouchpointType}>
              <SelectTrigger>
                <SelectValue placeholder="Select touchpoint type" />
              </SelectTrigger>
              <SelectContent>
                {TOUCHPOINT_TYPES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="occurred_at">Date / Time</Label>
            <Input id="occurred_at" type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="summary">Summary</Label>
            <Textarea id="summary" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What was discussed?" rows={4} />
          </div>

          <div className="grid gap-2">
            <Label>Outcome</Label>
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger>
                <SelectValue placeholder="Select outcome" />
              </SelectTrigger>
              <SelectContent>
                {OUTCOMES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="next_action">Next Action</Label>
            <Input id="next_action" value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="Optional next step" />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="next_action_due">Next Action Due</Label>
            <Input id="next_action_due" type="date" value={nextActionDue} onChange={(e) => setNextActionDue(e.target.value)} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !clientDbId}>
              {saving ? "Saving..." : "Save Touchpoint"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
