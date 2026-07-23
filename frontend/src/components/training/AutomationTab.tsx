"use client";

import { useCallback, useEffect, useState } from "react";
import { Send, Eye, CheckCircle, XCircle, Clock, Mail, CheckSquare, Square } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TrainingCompletionRecipient, TrainingCourseRun, TrainingLogEntry } from "./types";
import { formatTrainingCourseRunStatus, formatTrainingBookingStatus, formatTrainingBillingStatus } from "@/lib/training-workflow";

type AutomationPayload = {
  training_course_run_id: number;
  run_name: string | null;
  reminder_enabled: boolean;
  reminder_schedule_json: string;
  reminder_subject_template: string | null;
  reminder_body_template: string | null;
  completion_subject_template: string | null;
  completion_body_template: string | null;
  post_course_documents_json: string | null;
  auto_certificate: boolean;
  certificate_template_key: string;
};

type Props = {
  jobId: number;
  runs: TrainingCourseRun[];
  automationLog: TrainingLogEntry[];
  baseUrl: string;
  onRefresh: () => void;
};

function logStatusIcon(status: string) {
  switch (status) {
    case "sent": return <CheckCircle className="h-3.5 w-3.5 text-green-500" />;
    case "failed": return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    default: return <Clock className="h-3.5 w-3.5 text-amber-400" />;
  }
}

const DEFAULT_REMINDER_SUBJECT = "Reminder: {{run_name}} — {{session_date}}";
const DEFAULT_REMINDER_BODY = `Dear {{person_name}},

This is a reminder that you are booked on {{run_name}} on {{session_date}} at {{start_time}}.

Location: {{venue_name}}

Please get in touch if you have any questions.

Kind regards,
{{org_name}}`;

const DEFAULT_COMPLETION_SUBJECT = "Thank you for attending {{run_name}}";
const DEFAULT_COMPLETION_BODY = `Dear {{person_name}},

Thank you for attending {{run_name}}. Please find your materials attached.

{{if certificate}}Your certificate is attached to this email.{{end}}

Kind regards,
{{org_name}}`;

export default function AutomationTab({ jobId, runs, automationLog, baseUrl, onRefresh }: Props) {
  const [selectedRunId, setSelectedRunId] = useState<number | null>(runs[0]?.training_course_run_id ?? null);
  const [automation, setAutomation] = useState<AutomationPayload | null>(null);
  const [completionRecipients, setCompletionRecipients] = useState<TrainingCompletionRecipient[]>([]);
  const [loadingAuto, setLoadingAuto] = useState(Boolean(runs[0]?.training_course_run_id));
  const [loadingRecipients, setLoadingRecipients] = useState(Boolean(runs[0]?.training_course_run_id));
  const [saving, setSaving] = useState(false);
  const [previewResult, setPreviewResult] = useState<{ planned: unknown[] } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<Set<number>>(new Set());

  const loadAutomation = useCallback(async (runId: number) => {
    setLoadingAuto(true);
    try {
      const res = await fetch(`${baseUrl}/training-course-runs/${runId}/automation`);
      if (res.ok) setAutomation(await res.json());
    } catch { /* silent */ }
    finally { setLoadingAuto(false); }
  }, [baseUrl]);

  const loadCompletionRecipients = useCallback(async (runId: number) => {
    setLoadingRecipients(true);
    try {
      const res = await fetch(`${baseUrl}/training-course-runs/${runId}/completion-pack-recipients`);
      if (res.ok) {
        const data = await res.json();
        setCompletionRecipients(data.items ?? []);
        setSelectedRecipientIds(new Set());
      } else {
        setCompletionRecipients([]);
      }
    } catch {
      setCompletionRecipients([]);
    } finally {
      setLoadingRecipients(false);
    }
  }, [baseUrl]);

  async function selectRun(runId: number) {
    setSelectedRunId(runId);
    setAutomation(null);
    setCompletionRecipients([]);
    setSelectedRecipientIds(new Set());
  }

  async function saveAutomation() {
    if (!automation) return;
    setSaving(true);
    try {
      const res = await fetch(`${baseUrl}/training-course-runs/${automation.training_course_run_id}/automation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(automation),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Automation settings saved");
    } catch (e: unknown) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function runAutomation(triggerKey: string, mode: "preview" | "send", bookingIds?: number[]) {
    if (!selectedRunId) return;
    setRunning(`${triggerKey}-${mode}`);
    try {
      const res = await fetch(`${baseUrl}/training-course-runs/${selectedRunId}/automation/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger_key: triggerKey, mode, booking_ids: bookingIds ?? [] }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (mode === "preview") {
        setPreviewResult(data);
        setShowPreview(true);
      } else {
        toast.success(`Sent ${data.sent_count ?? 0} email(s)`);
        onRefresh();
      }
    } catch (e: unknown) {
      toast.error(String(e));
    } finally {
      setRunning(null);
    }
  }

  const selectedRun = runs.find((r) => r.training_course_run_id === selectedRunId);
  const completionEligibleRecipients = completionRecipients.filter((recipient) => recipient.can_send);
  const selectedCompletionRecipients = completionRecipients.filter((recipient) => selectedRecipientIds.has(recipient.training_booking_id));
  const completionSendTargets = selectedCompletionRecipients.filter((recipient) => recipient.can_send).map((recipient) => recipient.training_booking_id);
  const sendAllTargets = completionEligibleRecipients.map((recipient) => recipient.training_booking_id);
  const allSelectableIds = completionEligibleRecipients.map((recipient) => recipient.training_booking_id);
  const allSelected = allSelectableIds.length > 0 && allSelectableIds.every((id) => selectedRecipientIds.has(id));
  const completionReady = selectedRun ? String(selectedRun.status).toLowerCase() === "completed" : false;
  const selectedAutomationLogs = selectedRunId
    ? automationLog.filter((log) => log.training_course_run_id === selectedRunId)
    : automationLog;

  function toggleRecipient(recipientId: number) {
    setSelectedRecipientIds((prev) => {
      const next = new Set(prev);
      if (next.has(recipientId)) next.delete(recipientId);
      else next.add(recipientId);
      return next;
    });
  }

  function toggleAllRecipients() {
    setSelectedRecipientIds(allSelected ? new Set() : new Set(allSelectableIds));
  }

  async function sendCompletionPack(bookingIds?: number[]) {
    if (!selectedRunId) return;
    const effectiveTargets = bookingIds ?? [];
    if (bookingIds && bookingIds.length === 0) {
      toast.error("Select at least one recipient.");
      return;
    }
    await runAutomation("completion_pack", "send", effectiveTargets);
    await loadCompletionRecipients(selectedRunId);
  }

  useEffect(() => {
    if (!selectedRunId) return;
    void loadAutomation(selectedRunId);
    void loadCompletionRecipients(selectedRunId);
  }, [selectedRunId, loadAutomation, loadCompletionRecipients]);

  return (
    <div className="space-y-6" data-job-id={jobId}>
      {/* Cohort selector */}
      <div className="flex items-center gap-3">
        <Label className="shrink-0 text-sm">Cohort:</Label>
        <Select
          value={String(selectedRunId ?? "")}
          onValueChange={(v) => selectRun(Number(v))}
        >
          <SelectTrigger className="w-[280px]">
            <SelectValue placeholder="Select a cohort…" />
          </SelectTrigger>
          <SelectContent>
            {runs.map((r) => (
              <SelectItem key={r.training_course_run_id} value={String(r.training_course_run_id)}>
                {r.run_name || r.product_name || `Cohort #${r.training_course_run_id}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedRun && (
          <Badge variant="outline" className="text-xs">
            {formatTrainingCourseRunStatus(selectedRun.status)}
          </Badge>
        )}
      </div>

      {selectedRunId && !automation && !loadingAuto && (
        <Button variant="outline" size="sm" onClick={() => loadAutomation(selectedRunId)}>
          Load Automation Settings
        </Button>
      )}

      {loadingAuto && <p className="text-sm text-slate-400">Loading settings…</p>}

      {selectedRun && (
        <Card className="border-emerald-200 bg-emerald-50/40">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between gap-3 text-sm">
              <span>Completion Pack</span>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {completionReady ? "Ready to send" : "Waiting for completion"}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {completionEligibleRecipients.length} eligible
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {completionRecipients.filter((r) => r.sent_status === "sent").length} sent
                </Badge>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600">
              Send the completion email, certificate, and attached follow-up documents from the cohort page. The sent log below shows exactly who has received it.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void runAutomation("completion_pack", "preview", selectedRecipientIds.size > 0 ? [...selectedRecipientIds] : undefined)}
                disabled={!!running}
              >
                <Eye className="mr-1 h-3.5 w-3.5" />
                {running === "completion_pack-preview" ? "Previewing…" : "Preview Pack"}
              </Button>
              <Button
                size="sm"
                onClick={() => void sendCompletionPack(selectedRecipientIds.size > 0 ? completionSendTargets : sendAllTargets)}
                disabled={!!running || !completionReady || completionEligibleRecipients.length === 0 || (selectedRecipientIds.size > 0 && completionSendTargets.length === 0)}
              >
                <Send className="mr-1 h-3.5 w-3.5" />
                {running === "completion_pack-send" ? "Sending…" : selectedRecipientIds.size > 0 ? "Send Selected" : "Send All Remaining"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={toggleAllRecipients}
                disabled={completionEligibleRecipients.length === 0}
              >
                {allSelected ? <CheckSquare className="mr-1 h-3.5 w-3.5" /> : <Square className="mr-1 h-3.5 w-3.5" />}
                {allSelected ? "Clear Selection" : "Select All Eligible"}
              </Button>
            </div>
            {loadingRecipients ? (
              <p className="text-sm text-slate-400">Loading recipient status…</p>
            ) : completionRecipients.length === 0 ? (
              <p className="text-sm text-slate-400">No attendees found for this cohort.</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="max-h-[320px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <button type="button" onClick={toggleAllRecipients} className="text-slate-400 hover:text-slate-700" title="Select all eligible recipients">
                            {allSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                          </button>
                        </TableHead>
                        <TableHead>Recipient</TableHead>
                        <TableHead>Booking</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Sent</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {completionRecipients.map((recipient) => {
                        const isSelected = selectedRecipientIds.has(recipient.training_booking_id);
                        const sent = recipient.sent_status === "sent";
                        const failed = recipient.sent_status === "failed";
                        return (
                          <TableRow key={recipient.training_booking_id}>
                            <TableCell>
                              <button
                                type="button"
                                className="text-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => toggleRecipient(recipient.training_booking_id)}
                                disabled={!recipient.can_send && !isSelected}
                                title={recipient.can_send ? "Select recipient" : recipient.sent_status === "sent" ? "Already sent" : "No email available"}
                              >
                                {isSelected ? <CheckSquare className="h-4 w-4 text-emerald-600" /> : <Square className="h-4 w-4" />}
                              </button>
                            </TableCell>
                            <TableCell>
                              <div className="font-medium text-slate-900">{recipient.person_name || "Participant"}</div>
                              <div className="text-xs text-slate-500">{recipient.person_email || "No email address"}</div>
                            </TableCell>
                            <TableCell className="text-xs text-slate-500">
                              <div>{recipient.client_name || "No company"}</div>
                              <div className="mt-1 flex flex-wrap gap-1.5">
                                <Badge variant="outline" className="text-[10px]">{formatTrainingBookingStatus(recipient.attendance_status || "")}</Badge>
                                <Badge variant="outline" className="text-[10px]">{formatTrainingBillingStatus(recipient.billing_status || "")}</Badge>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={`text-xs ${sent ? "border-emerald-200 bg-emerald-50 text-emerald-700" : failed ? "border-red-200 bg-red-50 text-red-700" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
                                {sent ? "Sent" : failed ? "Failed" : recipient.can_send ? "Ready" : "Blocked"}
                              </Badge>
                              {recipient.error_text && <div className="mt-1 text-[10px] text-red-500">{recipient.error_text}</div>}
                            </TableCell>
                            <TableCell className="text-xs text-slate-500">
                              {recipient.sent_at ? new Date(recipient.sent_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs text-emerald-600"
                                disabled={!recipient.can_send || !!running}
                                onClick={() => void sendCompletionPack([recipient.training_booking_id])}
                              >
                                Send
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {automation && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Settings */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Reminder Emails</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="reminder-enabled"
                    className="accent-emerald-600"
                    checked={automation.reminder_enabled}
                    onChange={(e) => setAutomation((a) => a ? { ...a, reminder_enabled: e.target.checked } : a)}
                  />
                  <Label htmlFor="reminder-enabled" className="cursor-pointer">Enable reminder emails</Label>
                </div>
                <div>
                  <Label>Schedule (days before session, comma-separated)</Label>
                  <Input
                    value={(() => { try { return JSON.parse(automation.reminder_schedule_json ?? "[7,1]").join(", "); } catch { return "7, 1"; } })()}
                    onChange={(e) => {
                      const vals = e.target.value.split(",").map((v) => parseInt(v.trim())).filter((v) => !isNaN(v));
                      setAutomation((a) => a ? { ...a, reminder_schedule_json: JSON.stringify(vals) } : a);
                    }}
                    placeholder="7, 1"
                  />
                </div>
                <div>
                  <Label>Subject Template</Label>
                  <Input
                    value={automation.reminder_subject_template ?? ""}
                    placeholder={DEFAULT_REMINDER_SUBJECT}
                    onChange={(e) => setAutomation((a) => a ? { ...a, reminder_subject_template: e.target.value || null } : a)}
                  />
                </div>
                <div>
                  <Label>Body Template</Label>
                  <Textarea
                    rows={6}
                    value={automation.reminder_body_template ?? ""}
                    placeholder={DEFAULT_REMINDER_BODY}
                    onChange={(e) => setAutomation((a) => a ? { ...a, reminder_body_template: e.target.value || null } : a)}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => runAutomation("reminders", "preview")}
                    disabled={!!running}
                  >
                    <Eye className="mr-1 h-3.5 w-3.5" />
                    {running === "reminders-preview" ? "Previewing…" : "Preview"}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => runAutomation("reminders", "send")}
                    disabled={!!running || !automation.reminder_enabled}
                  >
                    <Send className="mr-1 h-3.5 w-3.5" />
                    {running === "reminders-send" ? "Sending…" : "Send Reminders"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Completion Pack</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="auto-cert"
                    className="accent-emerald-600"
                    checked={automation.auto_certificate}
                    onChange={(e) => setAutomation((a) => a ? { ...a, auto_certificate: e.target.checked } : a)}
                  />
                  <Label htmlFor="auto-cert" className="cursor-pointer">Auto-generate certificate</Label>
                </div>
                <div>
                  <Label>Subject Template</Label>
                  <Input
                    value={automation.completion_subject_template ?? ""}
                    placeholder={DEFAULT_COMPLETION_SUBJECT}
                    onChange={(e) => setAutomation((a) => a ? { ...a, completion_subject_template: e.target.value || null } : a)}
                  />
                </div>
                <div>
                  <Label>Body Template</Label>
                  <Textarea
                    rows={6}
                    value={automation.completion_body_template ?? ""}
                    placeholder={DEFAULT_COMPLETION_BODY}
                    onChange={(e) => setAutomation((a) => a ? { ...a, completion_body_template: e.target.value || null } : a)}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => runAutomation("completion_pack", "preview")}
                    disabled={!!running}
                  >
                    <Eye className="mr-1 h-3.5 w-3.5" />
                    Preview
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => runAutomation("completion_pack", "send")}
                    disabled={!!running}
                  >
                    <Send className="mr-1 h-3.5 w-3.5" />
                    {running === "completion_pack-send" ? "Sending…" : "Send Pack"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button onClick={saveAutomation} disabled={saving}>
                {saving ? "Saving…" : "Save Settings"}
              </Button>
            </div>

            <p className="text-xs text-slate-400">
              Available template variables: <code className="text-xs">{"{{person_name}} {{run_name}} {{session_date}} {{start_time}} {{venue_name}} {{org_name}}"}</code>
            </p>
          </div>

          {/* Log */}
          <div>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Mail className="h-4 w-4 text-slate-400" />
                  Automation Log
                </CardTitle>
              </CardHeader>
              <CardContent>
                {selectedAutomationLogs.length === 0 ? (
                  <p className="text-sm text-slate-400">No automation emails sent yet.</p>
                ) : (
                  <div className="space-y-1.5 max-h-96 overflow-y-auto">
                    {selectedAutomationLogs.map((log) => (
                      <div key={log.training_automation_log_id} className="flex items-start gap-2 rounded border border-slate-100 p-2 text-xs">
                        <div className="mt-0.5 shrink-0">{logStatusIcon(log.status)}</div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-slate-700 truncate">{log.subject ?? log.trigger_key}</p>
                          <p className="text-slate-500 truncate">To: {log.recipient_name} {log.recipient_email ? `<${log.recipient_email}>` : ""}</p>
                          {log.error_text && <p className="text-red-500">{log.error_text}</p>}
                          <p className="text-slate-400">
                            {log.sent_at
                              ? `Sent ${new Date(log.sent_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                              : `Created ${new Date(log.created_at ?? "").toLocaleDateString("en-GB")}`}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Preview dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Automation Preview</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {(previewResult?.planned as Array<{ recipient_name?: string; recipient_email?: string; subject?: string; trigger_key?: string }> | undefined)?.map((item, i) => (
              <div key={i} className="rounded border border-slate-200 p-3 text-sm">
                <p className="font-medium">{item.subject}</p>
                <p className="text-slate-500">To: {item.recipient_name} {item.recipient_email ? `<${item.recipient_email}>` : ""}</p>
                <p className="text-xs text-slate-400">{item.trigger_key}</p>
              </div>
            ))}
            {!previewResult?.planned || (previewResult.planned as unknown[]).length === 0 ? (
              <p className="text-slate-400">Nothing to send.</p>
            ) : null}
          </div>
          <div className="flex justify-end border-t pt-3">
            <Button variant="outline" onClick={() => setShowPreview(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
