"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MessageSquare } from "lucide-react";

type Props = { jobId: number; baseUrl: string };

export default function JobReviewNotificationBar({ jobId, baseUrl }: Props) {
  const [openCount, setOpenCount] = useState<number | null>(null);

  useEffect(() => {
    fetch(`${baseUrl}/jobs/${jobId}/review`, { credentials: "include" })
      .then(r => r.ok ? r.json() as Promise<{ open_count?: number }> : null)
      .then(d => { if (d != null) setOpenCount(d.open_count ?? 0); })
      .catch(() => { /* non-fatal */ });
  }, [jobId, baseUrl]);

  if (!openCount) return null;

  return (
    <Link
      href={`/jobs/${jobId}/client-review`}
      className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 shadow-sm transition hover:bg-amber-100 print:hidden"
    >
      <MessageSquare className="h-4 w-4 shrink-0" />
      <span>
        <span className="font-semibold">{openCount} client report note{openCount !== 1 ? "s" : ""}</span>
        {" "}need{openCount === 1 ? "s" : ""} attention — click to review and respond.
      </span>
    </Link>
  );
}
