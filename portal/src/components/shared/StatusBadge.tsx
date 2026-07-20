import { Badge } from "@/components/ui/badge"

export type StatusLevel = "success" | "risk" | "warning" | "neutral"

const LABELS: Record<StatusLevel, string> = {
  success: "On track",
  risk: "At risk",
  warning: "Needs attention",
  neutral: "—",
}

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: StatusLevel
  label?: string
  className?: string
}) {
  return (
    <Badge
      variant={status === "neutral" ? "outline" : status}
      className={className}
    >
      {label ?? LABELS[status]}
    </Badge>
  )
}
