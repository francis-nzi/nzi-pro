"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const BASE = "/api/backend";

type Broadcast = {
  broadcast_id: number;
  title: string | null;
  message: string;
  broadcast_type: "global" | "client";
  target_client_db_id: number | null;
  target_client_name: string | null;
  style: "info" | "warning" | "success" | "promo";
  link_url: string | null;
  link_label: string | null;
  is_active: boolean;
  active_from: string | null;
  active_until: string | null;
  created_by: string;
  created_at: string | null;
  deactivated_at: string | null;
  deactivated_by: string | null;
};

type Client = { client_db_id: number; client_name: string };

const STYLE_LABELS: Record<string, string> = {
  info: "Info (blue)",
  warning: "Warning (amber)",
  success: "Success (green)",
  promo: "Promo (orange)",
};

const STYLE_BADGE: Record<string, string> = {
  info: "bg-blue-100 text-blue-700 border-blue-200",
  warning: "bg-amber-100 text-amber-700 border-amber-200",
  success: "bg-green-100 text-green-700 border-green-200",
  promo: "bg-orange-100 text-orange-700 border-orange-200",
};

function fmt(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

export default function BroadcastingPage() {
  const baseUrl = useMemo(() => BASE, []);

  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Form state
  const [fTitle, setFTitle] = useState("");
  const [fMessage, setFMessage] = useState("");
  const [fType, setFType] = useState<"global" | "client">("global");
  const [fClient, setFClient] = useState<string>("");
  const [fStyle, setFStyle] = useState("info");
  const [fLinkUrl, setFLinkUrl] = useState("");
  const [fLinkLabel, setFLinkLabel] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fUntil, setFUntil] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bRes, cRes] = await Promise.all([
        fetch(`${baseUrl}/admin/portal-broadcasts?include_inactive=${showInactive}`, { credentials: "include" }),
        fetch(`${baseUrl}/clients?limit=500&sort_by=client&sort_dir=asc`, { credentials: "include" }),
      ]);
      if (bRes.ok) {
        const d = await bRes.json() as { items: Broadcast[] };
        setBroadcasts(d.items ?? []);
      }
      if (cRes.ok) {
        const d = await cRes.json() as { items?: Client[]; clients?: Client[] };
        setClients(d.items ?? d.clients ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [baseUrl, showInactive]);

  useEffect(() => { void load(); }, [load]);

  function resetForm() {
    setFTitle(""); setFMessage(""); setFType("global"); setFClient("");
    setFStyle("info"); setFLinkUrl(""); setFLinkLabel(""); setFFrom(""); setFUntil("");
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!fMessage.trim()) return;
    setSaving(true); setError("");
    try {
      const body: Record<string, unknown> = {
        title: fTitle.trim() || null,
        message: fMessage.trim(),
        broadcast_type: fType,
        style: fStyle,
        link_url: fLinkUrl.trim() || null,
        link_label: fLinkLabel.trim() || null,
        active_from: fFrom ? new Date(fFrom).toISOString() : null,
        active_until: fUntil ? new Date(fUntil).toISOString() : null,
      };
      if (fType === "client") body.target_client_db_id = parseInt(fClient, 10);
      const res = await fetch(`${baseUrl}/admin/portal-broadcasts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json() as { detail?: string };
        throw new Error(d.detail ?? `HTTP ${res.status}`);
      }
      resetForm();
      setShowForm(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(b: Broadcast) {
    const res = await fetch(`${baseUrl}/admin/portal-broadcasts/${b.broadcast_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ is_active: !b.is_active }),
    });
    if (res.ok) await load();
  }

  async function handleDelete(b: Broadcast) {
    if (!confirm(`Delete this broadcast?\n\n"${b.message}"`)) return;
    await fetch(`${baseUrl}/admin/portal-broadcasts/${b.broadcast_id}`, {
      method: "DELETE",
      credentials: "include",
    });
    await load();
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        kicker="System & Governance"
        title="Broadcasting"
        description="Send announcements to client portals — global messages reach all clients; targeted messages go to a specific client."
      />

      {/* Controls */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button onClick={() => { resetForm(); setShowForm(v => !v); }}>
            <Plus className="mr-2 h-4 w-4" />
            New Broadcast
          </Button>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={e => setShowInactive(e.target.checked)}
              className="rounded"
            />
            Show inactive
          </label>
        </div>
        <div className="text-xs text-gray-400">{broadcasts.length} broadcast{broadcasts.length !== 1 ? "s" : ""}</div>
      </div>

      {/* Create form */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New Broadcast</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={e => void handleCreate(e)} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Title <span className="text-gray-400 font-normal">(optional)</span></Label>
                  <Input value={fTitle} onChange={e => setFTitle(e.target.value)} placeholder="e.g. New feature available" />
                </div>
                <div className="space-y-1">
                  <Label>Style</Label>
                  <Select value={fStyle} onValueChange={setFStyle}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(STYLE_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <Label>Message <span className="text-red-500">*</span></Label>
                <Textarea
                  value={fMessage}
                  onChange={e => setFMessage(e.target.value)}
                  placeholder="Message shown in the client portal status bar…"
                  rows={2}
                  required
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Target</Label>
                  <Select value={fType} onValueChange={v => setFType(v as "global" | "client")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="global">All clients (global)</SelectItem>
                      <SelectItem value="client">Specific client</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {fType === "client" && (
                  <div className="space-y-1">
                    <Label>Client <span className="text-red-500">*</span></Label>
                    <Select value={fClient} onValueChange={setFClient}>
                      <SelectTrigger><SelectValue placeholder="Select client…" /></SelectTrigger>
                      <SelectContent>
                        {clients.map(c => (
                          <SelectItem key={c.client_db_id} value={String(c.client_db_id)}>{c.client_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Link URL <span className="text-gray-400 font-normal">(optional CTA)</span></Label>
                  <Input value={fLinkUrl} onChange={e => setFLinkUrl(e.target.value)} placeholder="https://…" type="url" />
                </div>
                <div className="space-y-1">
                  <Label>Link label</Label>
                  <Input value={fLinkLabel} onChange={e => setFLinkLabel(e.target.value)} placeholder="e.g. Learn more" />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Active from <span className="text-gray-400 font-normal">(optional)</span></Label>
                  <Input type="datetime-local" value={fFrom} onChange={e => setFFrom(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Active until <span className="text-gray-400 font-normal">(optional)</span></Label>
                  <Input type="datetime-local" value={fUntil} onChange={e => setFUntil(e.target.value)} />
                </div>
              </div>

              {error && <div className="text-sm text-red-600">{error}</div>}

              <div className="flex gap-2">
                <Button type="submit" disabled={saving || !fMessage.trim()}>
                  {saving ? "Saving…" : "Publish Broadcast"}
                </Button>
                <Button type="button" variant="outline" onClick={() => { setShowForm(false); resetForm(); }}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Broadcast list */}
      {loading ? (
        <div className="text-sm text-gray-400 py-8 text-center">Loading…</div>
      ) : broadcasts.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-gray-400">
          No broadcasts yet. Create one above to display messages in the client portal.
        </div>
      ) : (
        <div className="divide-y rounded-lg border bg-white">
          {broadcasts.map(b => (
            <div key={b.broadcast_id} className={`flex items-start gap-4 px-4 py-4 ${!b.is_active ? "opacity-50" : ""}`}>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={STYLE_BADGE[b.style] ?? ""}>
                    {b.style}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {b.broadcast_type === "global" ? "Global" : b.target_client_name ?? `Client ${b.target_client_db_id}`}
                  </Badge>
                  {!b.is_active && <Badge variant="outline" className="text-xs text-gray-500">Inactive</Badge>}
                </div>
                {b.title && <div className="text-sm font-semibold text-gray-800">{b.title}</div>}
                <div className="text-sm text-gray-700">{b.message}</div>
                {b.link_url && (
                  <div className="text-xs text-blue-600">
                    CTA: <a href={b.link_url} target="_blank" rel="noopener noreferrer" className="underline">{b.link_label || b.link_url}</a>
                  </div>
                )}
                <div className="text-xs text-gray-400 flex flex-wrap gap-x-3">
                  <span>Created {fmt(b.created_at)} by {b.created_by}</span>
                  {b.active_from && <span>From {fmt(b.active_from)}</span>}
                  {b.active_until && <span>Until {fmt(b.active_until)}</span>}
                  {b.deactivated_at && <span>Deactivated {fmt(b.deactivated_at)} by {b.deactivated_by}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void toggleActive(b)}
                  title={b.is_active ? "Deactivate" : "Reactivate"}
                >
                  {b.is_active
                    ? <ToggleRight className="h-5 w-5 text-green-600" />
                    : <ToggleLeft className="h-5 w-5 text-gray-400" />}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleDelete(b)}
                  title="Delete permanently"
                >
                  <Trash2 className="h-4 w-4 text-red-400 hover:text-red-600" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
