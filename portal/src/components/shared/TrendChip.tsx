import { ArrowDown, ArrowUp, Minus } from "lucide-react"
import { cn } from "@/lib/utils"

type TrendChipProps = {
  /** Percentage change, e.g. 12.4 or -8.1. */
  value: number
  /**
   * Which direction counts as "good" for this metric. Defaults to "down"
   * because most values shown in this portal are emissions figures, where a
   * decrease is the desired outcome — the opposite of a typical revenue KPI.
   * Pass "up" explicitly for metrics where growth is good (e.g. renewable
   * energy share, data completeness).
   */
  goodDirection?: "up" | "down"
  className?: string
}

export function TrendChip({ value, goodDirection = "down", className }: TrendChipProps) {
  const isFlat = Math.abs(value) < 0.05
  const isUp = value > 0
  const isGood = isFlat ? true : goodDirection === "down" ? !isUp : isUp

  const Icon = isFlat ? Minus : isUp ? ArrowUp : ArrowDown

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
        isFlat
          ? "bg-muted text-muted-foreground"
          : isGood
            ? "bg-status-success/10 text-status-success"
            : "bg-status-risk/10 text-status-risk",
        className
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {isFlat ? "No change" : `${Math.abs(value).toFixed(1)}%`}
    </span>
  )
}
