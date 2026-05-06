"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Clock3, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ADMIN_CENTER_RECENTLY_VISITED_EVENT,
  toAdminCenterHref,
  readAdminCenterRecentlyVisited,
  type AdminCenterVisitedItem,
} from "./adminCenterConfig";

function formatRelativeTime(value: string) {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "Visited recently";
  const delta = Date.now() - time;
  const minutes = Math.max(1, Math.round(delta / 60000));
  if (minutes < 60) return `Visited ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.max(1, Math.round(minutes / 60));
  if (hours < 24) return `Visited ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.max(1, Math.round(hours / 24));
  return `Visited ${days} day${days === 1 ? "" : "s"} ago`;
}

export function AdminCenterRecentlyVisited() {
  const [items, setItems] = useState<AdminCenterVisitedItem[]>([]);

  useEffect(() => {
    function refresh() {
      setItems(readAdminCenterRecentlyVisited());
    }

    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener(ADMIN_CENTER_RECENTLY_VISITED_EVENT, refresh as EventListener);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(ADMIN_CENTER_RECENTLY_VISITED_EVENT, refresh as EventListener);
    };
  }, []);

  const displayItems = useMemo(() => items.slice(0, 3), [items]);

  return (
    <Card className="border-slate-200/80 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <History className="h-5 w-5 text-[#1c5026]" />
          Recently visited
        </CardTitle>
        <p className="text-sm text-slate-600">Jump back to where you were working.</p>
      </CardHeader>
      <CardContent>
        {displayItems.length ? (
          <div className="grid gap-3 lg:grid-cols-3">
            {displayItems.map((item) => (
              <Link
                key={item.href}
                href={toAdminCenterHref(item.href)}
                className="group rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:-translate-y-0.5 hover:border-[#1c5026]/20 hover:shadow-md"
              >
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                    <Clock3 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">{item.title}</div>
                    <div className="text-xs text-slate-500">{formatRelativeTime(item.visitedAt)}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="rounded-full border-slate-200 px-2 py-0.5 text-[11px]">
                    {item.domain}
                  </Badge>
                  <span className="text-xs text-slate-500">Last opened from Admin Center</span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">
            No recent modules yet. Open a module to build your quick-access trail.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
