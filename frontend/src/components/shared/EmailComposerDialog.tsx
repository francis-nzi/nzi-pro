"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

type Kind = "quote" | "invoice";

type Props = {
  open: boolean;
  onClose: () => void;
  baseUrl: string;
  kind: Kind;
  id: number | null;
  defaultTo?: string;
  defaultCc?: string;
  onSent?: () => void;
};

/** Brings the quote_send/invoice_send template forward pre-filled with this
 * document's own details, and lets the user edit the subject/message before
 * actually sending -- instead of sending the template verbatim with no
 * chance to review it. */
export default function EmailComposerDialog({ open, onClose, baseUrl, kind, id, defaultTo, defaultCc, onSent }: Props) {
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !id) return;
    let cancelled = false;
    setTo(defaultTo || "");
    setCc(defaultCc || "");
    setSubject("");
    setMessage("");
    setError("");
    setLoadingPreview(true);
    fetch(`${baseUrl}/${kind}s/${id}/email-preview`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          throw new Error(`Failed to load email template (${res.status})${t ? `: ${t}` : ""}`);
        }
        return res.json() as Promise<{ subject: string; message: string }>;
      })
      .then((json) => {
        if (cancelled) return;
        setSubject(json.subject || "");
        setMessage(json.message || "");
      })
      .catch((e) => {
        if (cancelled) return;
        setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id, kind]);

  async function send() {
    if (!id) return;
    if (!to.trim()) {
      setError("Enter a recipient email address.");
      return;
    }
    setSending(true);
    setError("");
    try {
      const res = await fetch(`${baseUrl}/${kind}s/${id}/email-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          to: to.trim(),
          cc: cc.trim(),
          subject: subject.trim(),
          message: message.trim(),
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Failed to send email (${res.status})${t ? `: ${t}` : ""}`);
      }
      onSent?.();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Send {kind === "quote" ? "Quote" : "Invoice"} Email</DialogTitle>
          <DialogDescription>
            Brought forward from the {kind === "quote" ? "Quote Email" : "Invoice Email"} template &mdash; edit anything below before sending.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="email-to">To</Label>
              <Input id="email-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@example.com" />
            </div>
            <div>
              <Label htmlFor="email-cc">CC (optional, comma-separated)</Label>
              <Input id="email-cc" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="colleague@example.com" />
            </div>
          </div>

          <div>
            <Label htmlFor="email-subject">Subject</Label>
            <Input
              id="email-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={loadingPreview}
              placeholder={loadingPreview ? "Loading template..." : ""}
            />
          </div>

          <div>
            <Label htmlFor="email-message">Message</Label>
            <Textarea
              id="email-message"
              rows={10}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={loadingPreview}
              placeholder={loadingPreview ? "Loading template..." : ""}
            />
          </div>

          {error && <div className="text-sm text-rose-700">{error}</div>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={() => void send()} disabled={sending || loadingPreview}>
            {sending ? "Sending..." : "Send Email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
