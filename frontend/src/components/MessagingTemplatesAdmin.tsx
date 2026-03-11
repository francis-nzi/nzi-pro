"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type MessageTemplate = {
  template_id: number;
  template_key: string;
  template_name: string;
  message_type: string;
  subject_template: string;
  body_template: string;
  is_active: boolean;
};

const MESSAGE_TYPES = [
  { value: "quote_send", label: "Quote Send" },
  { value: "invoice_send", label: "Invoice Send" },
  { value: "job_overview_letter_send", label: "Job Overview Letter Send" },
  { value: "reminder", label: "Reminder" },
  { value: "introduction", label: "Introduction" },
  { value: "job_start", label: "Job Start" },
  { value: "general", label: "General" },
];

type Props = {
  baseUrl: string;
};

export default function MessagingTemplatesAdmin({ baseUrl }: Props) {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [templateKey, setTemplateKey] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [messageType, setMessageType] = useState("general");
  const [subjectTemplate, setSubjectTemplate] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState("");
  const [isActive, setIsActive] = useState(true);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/admin/message-templates?channel=email`, { credentials: "include" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed to load messaging templates (${res.status})${text ? `: ${text}` : ""}`);
      }
      const json = await res.json();
      setTemplates(Array.isArray(json?.items) ? json.items : []);
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  function clearForm() {
    setEditingId(null);
    setTemplateKey("");
    setTemplateName("");
    setMessageType("general");
    setSubjectTemplate("");
    setBodyTemplate("");
    setIsActive(true);
  }

  function startEdit(template: MessageTemplate) {
    setEditingId(template.template_id);
    setTemplateKey(template.template_key);
    setTemplateName(template.template_name || "");
    setMessageType(template.message_type || "general");
    setSubjectTemplate(template.subject_template || "");
    setBodyTemplate(template.body_template || "");
    setIsActive(Boolean(template.is_active));
  }

  async function saveTemplate() {
    if (!templateKey.trim()) {
      setStatus("Template key is required.");
      return;
    }
    if (!subjectTemplate.trim()) {
      setStatus("Subject template is required.");
      return;
    }
    if (!bodyTemplate.trim()) {
      setStatus("Body template is required.");
      return;
    }
    setStatus("Saving...");
    try {
      const payload = {
        template_key: templateKey.trim(),
        template_name: templateName.trim(),
        channel: "email",
        message_type: messageType,
        subject_template: subjectTemplate,
        body_template: bodyTemplate,
        is_active: isActive,
      };
      const res = editingId
        ? await fetch(`${baseUrl}/admin/message-templates/${editingId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(payload),
          })
        : await fetch(`${baseUrl}/admin/message-templates`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Save failed (${res.status})${text ? `: ${text}` : ""}`);
      }
      setStatus("Template saved.");
      clearForm();
      await loadTemplates();
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Email Messaging Templates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? <div className="text-sm text-muted-foreground">Loading templates...</div> : null}
          {templates.map((t) => (
            <div key={t.template_id} className="rounded border p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{t.template_name || t.template_key}</div>
                  <div className="text-xs text-muted-foreground">{t.template_key} · {t.message_type}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => startEdit(t)}>Edit</Button>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {t.is_active ? "Active" : "Inactive"}
              </div>
            </div>
          ))}
          {!loading && templates.length === 0 ? <div className="text-sm text-muted-foreground">No templates found.</div> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{editingId ? "Edit Messaging Template" : "Add Messaging Template"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Template Key</Label>
            <Input value={templateKey} onChange={(e) => setTemplateKey(e.target.value)} placeholder="quote_send" />
          </div>
          <div>
            <Label>Template Name</Label>
            <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Quote Email" />
          </div>
          <div>
            <Label>Message Type</Label>
            <Select value={messageType} onValueChange={setMessageType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MESSAGE_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Subject Template</Label>
            <Input
              value={subjectTemplate}
              onChange={(e) => setSubjectTemplate(e.target.value)}
              placeholder="Quote {{quote_number}} from Net Zero International"
            />
          </div>
          <div>
            <Label>Body Template (HTML)</Label>
            <Textarea
              rows={10}
              value={bodyTemplate}
              onChange={(e) => setBodyTemplate(e.target.value)}
              placeholder="<p>Dear {{attention_name}},</p><p>Please find attached...</p>"
            />
          </div>
          <div>
            <Label>Status</Label>
            <Select value={isActive ? "active" : "inactive"} onValueChange={(v) => setIsActive(v === "active")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => void saveTemplate()}>{editingId ? "Update" : "Create"}</Button>
            {editingId ? <Button variant="outline" onClick={clearForm}>Cancel</Button> : null}
          </div>
          {status ? <div className="text-sm text-muted-foreground">{status}</div> : null}
          <div className="text-xs text-muted-foreground">
            Available placeholders include: {"{{client_name}}"}, {"{{contact_name}}"}, {"{{quote_number}}"}, {"{{invoice_number}}"}, {"{{job_number}}"}, {"{{valid_to}}"}, {"{{due_date}}"}, {"{{reporting_period_start}}"}, {"{{reporting_period_end}}"}, {"{{crm_name}}"}, {"{{sender_name}}"}, {"{{custom_message}}"}.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
