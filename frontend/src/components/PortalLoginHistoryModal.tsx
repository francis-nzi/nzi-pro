"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

type HistoryAction = {
  action: string;
  entity_type: string;
  entity_id: string | null;
  created_at: string | null;
};

type HistorySession = {
  session_id: number;
  portal_user_name: string;
  portal_user_email: string;
  login_at: string | null;
  last_activity_at: string | null;
  logout_at: string | null;
  logout_reason: string | null;
  duration_seconds: number | null;
  is_active: boolean;
  actions: HistoryAction[];
};

type Props = {
  baseUrl: string;
  clientDbId: number | null;
  clientName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const mins = Math.round(seconds / 60);
  if (mins < 1) return "<1 min";
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hours}h ${rem}m` : `${hours}h`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return value;
  }
}

// Reused unchanged from both the Dashboard's Portals tab (per-row History
// button) and Client -> Portal's Login History button -- same endpoint,
// same audit data either way.
export default function PortalLoginHistoryModal({ baseUrl, clientDbId, clientName, open, onOpenChange }: Props) {
  const [sessions, setSessions] = useState<HistorySession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || clientDbId == null) return;
    setLoading(true);
    setError("");
    fetch(`${baseUrl}/clients/${clientDbId}/portal-login-history`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load login history (${res.status})`);
        const data = await res.json() as { history?: HistorySession[] };
        setSessions(Array.isArray(data.history) ? data.history : []);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [baseUrl, clientDbId, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Portal Login History{clientName ? ` — ${clientName}` : ""}</DialogTitle>
          <DialogDescription>
            Who logged into the portal, when, for how long, and what data-entry actions they made during that
            session.
          </DialogDescription>
        </DialogHeader>
        {error ? <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}
        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : sessions.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No portal logins recorded yet.</div>
        ) : (
          <div className="space-y-3">
            {sessions.map((s) => (
              <div key={s.session_id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-medium text-foreground">{s.portal_user_name || s.portal_user_email}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{s.portal_user_email}</span>
                  </div>
                  {s.is_active ? (
                    <Badge variant="outline" className="border-green-300 text-green-700">Currently on portal</Badge>
                  ) : (
                    <Badge variant="secondary">
                      {s.logout_reason === "timeout" ? "Auto logged out" : "Logged out"}
                    </Badge>
                  )}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Login: {formatDateTime(s.login_at)} · Duration: {formatDuration(s.duration_seconds)}
                  {!s.is_active ? ` · Logout: ${formatDateTime(s.logout_at)}` : ""}
                </div>
                {s.actions.length > 0 ? (
                  <div className="mt-2 space-y-1 rounded-md bg-muted/30 p-2 text-xs">
                    {s.actions.map((a, i) => (
                      <div key={i}>
                        <span className="font-medium text-foreground">{a.action}</span>{" "}
                        <span className="text-muted-foreground">
                          {a.entity_type}{a.entity_id ? ` #${a.entity_id}` : ""} · {formatDateTime(a.created_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-muted-foreground">No data changes during this session.</div>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
