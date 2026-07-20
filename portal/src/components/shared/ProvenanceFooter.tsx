import { cn } from "@/lib/utils"

/**
 * Small, consistent source/lineage line for anything client-facing that's
 * derived from emission factors or third-party datasets — audit-facing
 * tools live or die on this being visible and consistent, not omitted.
 */
export function ProvenanceFooter({
  source,
  lastVerified,
  className,
}: {
  source: string
  lastVerified?: string
  className?: string
}) {
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      Source: {source}
      {lastVerified ? ` · Last verified ${lastVerified}` : null}
    </p>
  )
}
