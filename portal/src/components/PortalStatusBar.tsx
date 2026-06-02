"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Info, AlertTriangle, CheckCircle2, Megaphone } from "lucide-react";
import { apiFetch } from "@/lib/auth";

type Broadcast = {
  broadcast_id: number;
  title: string | null;
  message: string;
  style: "info" | "warning" | "success" | "promo";
  link_url: string | null;
  link_label: string | null;
};

type ActionItem = {
  type: string;
  job_id: number;
  message: string;
  href: string;
  style: "info" | "warning";
};

const STYLE_CLASSES = {
  info:    "bg-blue-50 border-blue-200 text-blue-800",
  warning: "bg-amber-50 border-amber-200 text-amber-800",
  success: "bg-green-50 border-green-200 text-green-700",
  promo:   "bg-orange-50 border-orange-200 text-orange-800",
};

const STYLE_ICON = {
  info:    <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />,
  warning: <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />,
  success: <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />,
  promo:   <Megaphone className="h-3.5 w-3.5 shrink-0 mt-0.5" />,
};

const SESSION_KEY = "dismissed_broadcasts";

function getDismissed(): Set<number> {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as number[]);
  } catch {
    return new Set();
  }
}

function saveDismissed(ids: Set<number>) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify([...ids]));
  } catch { /* ignore */ }
}

export default function PortalStatusBar() {
  const router = useRouter();
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  useEffect(() => {
    setDismissed(getDismissed());
    apiFetch("/portal/status-bar")
      .then(async r => r.ok ? r.json() as Promise<{ broadcasts: Broadcast[]; actions: ActionItem[] }> : { broadcasts: [], actions: [] })
      .then(d => {
        setBroadcasts(d.broadcasts ?? []);
        setActions(d.actions ?? []);
      })
      .catch(() => { /* non-fatal */ });
  }, []);

  function dismiss(id: number) {
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(id);
      saveDismissed(next);
      return next;
    });
  }

  const visibleBroadcasts = broadcasts.filter(b => !dismissed.has(b.broadcast_id));
  const allItems = [...visibleBroadcasts.map(b => ({ kind: "broadcast" as const, ...b })),
                    ...actions.map(a => ({ kind: "action" as const, ...a }))];

  if (allItems.length === 0) return null;

  return (
    <div className="border-b border-gray-200 bg-white">
      <div className="max-w-6xl mx-auto px-4 py-1 space-y-1">
        {visibleBroadcasts.map(b => (
          <div
            key={`b-${b.broadcast_id}`}
            className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${STYLE_CLASSES[b.style] ?? STYLE_CLASSES.info}`}
          >
            {STYLE_ICON[b.style] ?? STYLE_ICON.info}
            <div className="flex-1 min-w-0">
              {b.title && <span className="font-semibold mr-1">{b.title}:</span>}
              <span>{b.message}</span>
              {b.link_url && (
                <a
                  href={b.link_url}
                  target={b.link_url.startsWith("http") ? "_blank" : undefined}
                  rel="noopener noreferrer"
                  className="ml-2 underline font-medium hover:opacity-80"
                >
                  {b.link_label || "Learn more"}
                </a>
              )}
            </div>
            <button
              onClick={() => dismiss(b.broadcast_id)}
              className="shrink-0 opacity-60 hover:opacity-100 transition"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        {actions.map((a, i) => (
          <button
            key={`a-${i}`}
            onClick={() => router.push(a.href)}
            className={`flex w-full items-start gap-2 rounded-md border px-3 py-2 text-xs text-left transition hover:opacity-80 ${STYLE_CLASSES[a.style] ?? STYLE_CLASSES.info}`}
          >
            {STYLE_ICON[a.style] ?? STYLE_ICON.info}
            <span className="flex-1">{a.message}</span>
            <span className="shrink-0 underline font-medium opacity-70">View →</span>
          </button>
        ))}
      </div>
    </div>
  );
}
