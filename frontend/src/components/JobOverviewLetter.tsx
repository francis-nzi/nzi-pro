"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  jobId: number;
  baseUrl: string;
};

export default function JobOverviewLetter({ jobId, baseUrl }: Props) {
  const [toEmail, setToEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let currentUrl = "";

    async function loadContextAndPreview() {
      try {
        const contextRes = await fetch(`${baseUrl}/jobs/${jobId}/overview-letter`, {
          credentials: "include",
        });
        if (contextRes.ok) {
          const contextJson = await contextRes.json();
          if (!cancelled) {
            setToEmail(String(contextJson?.default_to_email || ""));
            setSubject(String(contextJson?.default_subject || ""));
            setMessage(String(contextJson?.default_message || ""));
          }
        }

        const pdfRes = await fetch(`${baseUrl}/jobs/${jobId}/overview-letter/pdf?ts=${Date.now()}`, {
          credentials: "include",
        });
        if (!pdfRes.ok) {
          const txt = await pdfRes.text().catch(() => "");
          throw new Error(`Failed to load preview (${pdfRes.status})${txt ? `: ${txt}` : ""}`);
        }
        const blob = await pdfRes.blob();
        currentUrl = URL.createObjectURL(blob);
        if (!cancelled) {
          setPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return currentUrl;
          });
        } else if (currentUrl) {
          URL.revokeObjectURL(currentUrl);
        }
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
        }
      }
    }

    void loadContextAndPreview();
    return () => {
      cancelled = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [baseUrl, jobId]);

  async function refreshPreview() {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/overview-letter/pdf?ts=${Date.now()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Failed to refresh preview (${res.status})${txt ? `: ${txt}` : ""}`);
      }
      const blob = await res.blob();
      const nextUrl = URL.createObjectURL(blob);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return nextUrl;
      });
      setStatus("Overview letter preview refreshed.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function sendOverviewLetter() {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/overview-letter/email`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to_email: toEmail.trim() || undefined,
          subject: subject.trim() || undefined,
          message_text: message.trim() || undefined,
        }),
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        throw new Error(`Failed to send overview letter (${res.status})${text ? `: ${text}` : ""}`);
      }
      setStatus("Overview letter sent.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Job Overview Letter</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground">
          Review the PDF below before sending. This letter summarizes the job details, reporting period, and milestone commitments.
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="overview-to-email">Email To</Label>
            <Input
              id="overview-to-email"
              value={toEmail}
              onChange={(e) => setToEmail(e.target.value)}
              placeholder="client@company.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="overview-subject">Subject</Label>
            <Input
              id="overview-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Job Overview Letter"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="overview-message">Email Message</Label>
            <Textarea
              id="overview-message"
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void refreshPreview()} disabled={busy}>
            Refresh PDF
          </Button>
          {previewUrl ? (
            <Button variant="outline" onClick={() => window.open(previewUrl, "_blank", "noopener,noreferrer")}>
              Open PDF
            </Button>
          ) : null}
          <Button onClick={() => void sendOverviewLetter()} disabled={busy}>
            {busy ? "Sending..." : "Send Overview Letter"}
          </Button>
        </div>

        {error ? <div className="text-sm text-destructive">{error}</div> : null}
        {status ? <div className="text-sm text-muted-foreground">{status}</div> : null}

        <div className="h-[780px] w-full overflow-hidden rounded-md border">
          {previewUrl ? (
            <iframe title="Overview Letter PDF Preview" src={previewUrl} className="h-full w-full" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Preview unavailable.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
