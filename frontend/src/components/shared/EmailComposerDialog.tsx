"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

type Suggestion = { name: string; email: string; group: "Client" | "NZI Team" };

type Props = {
  open: boolean;
  onClose: () => void;
  baseUrl: string;
  kind: Kind;
  id: number | null;
  clientId?: number | null;
  defaultTo?: string;
  defaultCc?: string;
  onSent?: () => void;
};

/** Text input that suggests recipients (this client's contacts + the NZI
 * team) as you type, while staying a plain freely-editable email field --
 * clicking a suggestion just fills/appends it, it never restricts what can
 * be typed. `mode="single"` replaces the whole value (To); `mode="append"`
 * adds a comma-separated entry without disturbing what's already there (CC). */
function EmailFieldWithSuggestions({
  id,
  value,
  onChange,
  suggestions,
  mode,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  suggestions: Suggestion[];
  mode: "single" | "append";
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeSegment = mode === "append" ? value.split(",").pop() || "" : value;
  const query = activeSegment.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!query) return suggestions.slice(0, 8);
    return suggestions
      .filter((s) => s.name.toLowerCase().includes(query) || s.email.toLowerCase().includes(query))
      .slice(0, 8);
  }, [suggestions, query]);

  function pick(s: Suggestion) {
    if (mode === "single") {
      onChange(s.email);
    } else {
      const parts = value.split(",").map((p) => p.trim()).filter(Boolean);
      parts.pop(); // drop the in-progress segment being typed, if any
      if (!parts.includes(s.email)) parts.push(s.email);
      onChange(parts.join(", ") + ", ");
    }
    setOpen(false);
  }

  return (
    <div className="relative">
      <Input
        id={id}
        type={mode === "single" ? "email" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 150);
        }}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-background shadow-lg">
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.map((s) => (
              <button
                key={`${s.group}-${s.email}`}
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-100"
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (blurTimer.current) clearTimeout(blurTimer.current);
                  pick(s);
                }}
              >
                <span className="truncate">
                  <span className="font-medium">{s.name || s.email}</span>
                  {s.name ? <span className="ml-1.5 text-muted-foreground">{s.email}</span> : null}
                </span>
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {s.group}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Brings the quote_send/invoice_send template forward pre-filled with this
 * document's own details, and lets the user edit the subject/message before
 * actually sending -- instead of sending the template verbatim with no
 * chance to review it. */
export default function EmailComposerDialog({ open, onClose, baseUrl, kind, id, clientId, defaultTo, defaultCc, onSent }: Props) {
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

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

  useEffect(() => {
    if (!open || !clientId) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    Promise.all([
      fetch(`${baseUrl}/clients/${clientId}/quotes/lookups`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : { contacts: [] }))
        .catch(() => ({ contacts: [] })),
      fetch(`${baseUrl}/admin/users`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .catch(() => ({ items: [] })),
    ]).then(([lookups, team]) => {
      if (cancelled) return;
      const contactSuggestions: Suggestion[] = (Array.isArray(lookups?.contacts) ? lookups.contacts : [])
        .filter((c: { email?: string }) => c.email)
        .map((c: { full_name?: string; email?: string }) => ({
          name: c.full_name || "",
          email: c.email || "",
          group: "Client" as const,
        }));
      const teamSuggestions: Suggestion[] = (Array.isArray(team?.items) ? team.items : [])
        .filter((m: { email?: string; status?: string }) => m.email && String(m.status || "Active").toLowerCase() === "active")
        .map((m: { full_name?: string; email?: string }) => ({
          name: m.full_name || "",
          email: m.email || "",
          group: "NZI Team" as const,
        }));
      setSuggestions([...contactSuggestions, ...teamSuggestions]);
    });
    return () => {
      cancelled = true;
    };
  }, [open, clientId, baseUrl]);

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
              <EmailFieldWithSuggestions
                id="email-to"
                value={to}
                onChange={setTo}
                suggestions={suggestions}
                mode="single"
                placeholder="client@example.com"
              />
            </div>
            <div>
              <Label htmlFor="email-cc">CC (optional, comma-separated)</Label>
              <EmailFieldWithSuggestions
                id="email-cc"
                value={cc}
                onChange={setCc}
                suggestions={suggestions}
                mode="append"
                placeholder="colleague@example.com"
              />
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
