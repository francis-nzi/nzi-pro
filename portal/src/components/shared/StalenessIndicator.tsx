import { Clock } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type StalenessTier = "fresh" | "stale" | "very-stale"

function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24))
}

function tierFor(days: number, thresholdDays: number): StalenessTier {
  if (days < thresholdDays) return "fresh"
  if (days < thresholdDays * 2) return "stale"
  return "very-stale"
}

const TIER_STYLES: Record<StalenessTier, string> = {
  fresh: "border-transparent bg-status-success/10 text-status-success",
  stale: "border-transparent bg-status-warning/10 text-status-warning",
  "very-stale": "border-transparent bg-status-risk/10 text-status-risk",
}

/**
 * Surfaces data recency with the same visual weight as a risk/status badge,
 * not a small-print timestamp — required by UX spec §5.5. `thresholdDays` is
 * the point at which data for the given type is considered stale (the spec's
 * example: 60+ days without an upload for reporting-year-in-progress data);
 * pass the right threshold per data type rather than relying on one default
 * everywhere.
 */
export function StalenessIndicator({
  lastRefreshed,
  thresholdDays = 60,
  className,
}: {
  lastRefreshed: Date | string
  thresholdDays?: number
  className?: string
}) {
  const date = typeof lastRefreshed === "string" ? new Date(lastRefreshed) : lastRefreshed
  const days = daysSince(date)
  const tier = tierFor(days, thresholdDays)
  const label =
    days <= 0 ? "Updated today" : days === 1 ? "Updated yesterday" : `Updated ${days} days ago`

  return (
    <Badge className={cn(TIER_STYLES[tier], "gap-1", className)}>
      <Clock className="size-3" aria-hidden="true" />
      {label}
    </Badge>
  )
}
