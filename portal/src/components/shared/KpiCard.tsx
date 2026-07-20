import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TrendChip } from "@/components/shared/TrendChip"
import { cn } from "@/lib/utils"

type KpiCardProps = {
  label: string
  value: string
  unit?: string
  trend?: number
  trendGoodDirection?: "up" | "down"
  /**
   * When the KPI is built from fewer dimensions than are in scope for the
   * current filter (e.g. 3 of 5 sites reporting), show that explicitly
   * rather than let a partial figure look identical to a complete one —
   * required by the UX spec §5.4 "partial-data state".
   */
  partialLabel?: string
  className?: string
}

export function KpiCard({
  label,
  value,
  unit,
  trend,
  trendGoodDirection,
  partialLabel,
  className,
}: KpiCardProps) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-end justify-between gap-3 pt-0">
        <div>
          <div className="text-2xl font-bold text-foreground">
            {value}
            {unit ? <span className="ml-1 text-sm font-medium text-muted-foreground">{unit}</span> : null}
          </div>
          {partialLabel ? (
            <p className={cn("mt-1 text-xs text-status-warning")}>{partialLabel}</p>
          ) : null}
        </div>
        {trend !== undefined ? (
          <TrendChip value={trend} goodDirection={trendGoodDirection} />
        ) : null}
      </CardContent>
    </Card>
  )
}
