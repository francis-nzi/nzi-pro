"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MessageCircle, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";

type ReviewNotification = {
  job_id: number;
  job_number: string;
  title: string;
  client_name: string;
  crm_owner: string;
  open_count: number;
  last_comment_at: string | null;
  review_status: string;
};

export default function ClientReviewNotifications({
  baseUrl,
  crmOwner,
}: {
  baseUrl: string;
  crmOwner: string | null;
}) {
  const [items, setItems] = useState<ReviewNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const qs = crmOwner ? `?crm_owner=${encodeURIComponent(crmOwner)}` : "";
      const res = await fetch(`${baseUrl}/dashboard/review-notifications${qs}`, {
        cache: "no-store",
        credentials: "include",
      });
      if (res.ok) {
        const data = (await res.json()) as { items: ReviewNotification[] };
        setItems(data.items ?? []);
      }
    } catch { /* silently fail */ }
    finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { void load(); }, [baseUrl, crmOwner]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return null;
  if (items.length === 0) return null;

  return (
    <Card className="border-amber-200 bg-amber-50/40">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-amber-600" />
            <CardTitle className="text-sm font-semibold text-amber-900">
              Client Review Comments
            </CardTitle>
            <Badge variant="outline" className="border-amber-400 bg-amber-100 text-amber-800 font-semibold text-xs px-2 py-0">
              {items.reduce((s, i) => s + i.open_count, 0)} open
            </Badge>
          </div>
          <button
            onClick={() => void load(true)}
            disabled={refreshing}
            className="text-amber-600 hover:text-amber-800 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        <div className="divide-y divide-amber-100 rounded-lg border border-amber-200 bg-white overflow-hidden">
          {items.map(item => (
            <Link
              key={item.job_id}
              href={`/jobs/${item.job_id}?tab=review`}
              className="flex items-center justify-between px-3 py-2.5 hover:bg-amber-50 transition-colors group"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-800 group-hover:text-amber-800 truncate">
                    {item.client_name}
                  </span>
                  {item.job_number && (
                    <span className="text-xs text-gray-400 shrink-0">{item.job_number}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-gray-500 truncate">{item.title}</span>
                  {item.crm_owner && (
                    <span className="text-xs text-gray-400 shrink-0">· {item.crm_owner}</span>
                  )}
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-2 ml-3">
                {item.last_comment_at && (
                  <span className="text-xs text-gray-400 hidden sm:block">
                    {formatDate(item.last_comment_at)}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 border border-amber-300 px-2 py-0.5 text-xs font-semibold text-amber-800">
                  <MessageCircle className="h-3 w-3" />
                  {item.open_count}
                </span>
              </div>
            </Link>
          ))}
        </div>
        <p className="mt-2 text-xs text-amber-700 text-right">
          Click a row to open the job&apos;s review tab
        </p>
      </CardContent>
    </Card>
  );
}
