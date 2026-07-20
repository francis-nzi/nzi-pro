import type { ReactNode } from "react"
import { AlertTriangle, FolderOpen, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * "No data yet for this period" — never let a chart or KPI render as a
 * broken chart, a NaN, or a silently-zeroed number (UX spec §5.4).
 */
export function EmptyStatePanel({
  title = "No data yet for this period",
  description,
  action,
  className,
}: {
  title?: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-10 text-center",
        className
      )}
    >
      <FolderOpen className="size-8 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action}
    </div>
  )
}

/**
 * Skeleton placeholders that match the final layout, not a spinner —
 * spinners cause layout shift when the real data arrives (UX spec §5.4).
 */
export function SkeletonLoader({
  rows = 3,
  className,
}: {
  rows?: number
  className?: string
}) {
  return (
    <div className={cn("space-y-3", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-4 w-full animate-pulse rounded bg-muted" />
      ))}
    </div>
  )
}

export function ErrorPanel({
  title = "Something went wrong loading this data",
  description = "Try again, or contact us if this keeps happening.",
  onRetry,
  className,
}: {
  title?: string
  description?: string
  onRetry?: () => void
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border border-status-risk/30 bg-status-risk/5 px-6 py-10 text-center",
        className
      )}
    >
      <AlertTriangle className="size-8 text-status-risk" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-2">
          <RefreshCw className="size-3.5" aria-hidden="true" />
          Try again
        </Button>
      ) : null}
    </div>
  )
}
