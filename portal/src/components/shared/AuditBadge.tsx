import { ShieldCheck, FileQuestion, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export type AuditLevel = "verified" | "estimated" | "self-reported"

const CONFIG: Record<AuditLevel, { label: string; icon: typeof ShieldCheck; className: string }> = {
  verified: {
    label: "Verified",
    icon: ShieldCheck,
    className: "border-transparent bg-status-success/10 text-status-success",
  },
  estimated: {
    label: "Estimated",
    icon: Sparkles,
    className: "border-transparent bg-status-warning/10 text-status-warning",
  },
  "self-reported": {
    label: "Self-reported",
    icon: FileQuestion,
    className: "border-transparent bg-muted text-muted-foreground",
  },
}

export function AuditBadge({
  level,
  className,
}: {
  level: AuditLevel
  className?: string
}) {
  const { label, icon: Icon, className: variantClassName } = CONFIG[level]
  return (
    <Badge className={cn(variantClassName, "gap-1", className)}>
      <Icon className="size-3" aria-hidden="true" />
      {label}
    </Badge>
  )
}
