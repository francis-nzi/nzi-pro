"use client"

import { RotateCcw } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type FilterOption = { value: string; label: string }

export type FilterDef = {
  key: string
  label: string
  options: FilterOption[]
  /** Optional filters (Scope, Industry, Data Source, Status) render smaller
   * and can be visually deprioritised vs. the required four (Year, Region,
   * Subsidiary, Site) per UX spec §5.1. */
  optional?: boolean
}

type GlobalFilterBarProps = {
  filters: FilterDef[]
  values: Record<string, string | undefined>
  onChange: (key: string, value: string | undefined) => void
  onReset: () => void
  className?: string
}

/**
 * Sticky filter bar shell (UX spec §5.1/5.2). Purely presentational and
 * controlled — the actual filter state and what it drives (KPIs, tables,
 * charts) is wired per page in Phase 1, not here.
 */
export function GlobalFilterBar({
  filters,
  values,
  onChange,
  onReset,
  className,
}: GlobalFilterBarProps) {
  return (
    <div
      className={cn(
        "sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-border bg-background/95 px-4 py-3 backdrop-blur",
        className
      )}
    >
      {filters.map((filter) => (
        <Select
          key={filter.key}
          value={values[filter.key]}
          onValueChange={(value) => onChange(filter.key, value)}
        >
          <SelectTrigger
            size="sm"
            className={cn("w-auto min-w-[9rem]", filter.optional && "text-muted-foreground")}
          >
            <SelectValue placeholder={filter.label} />
          </SelectTrigger>
          <SelectContent>
            {filter.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}

      <Button variant="ghost" size="sm" onClick={onReset} className="ml-auto text-muted-foreground">
        <RotateCcw className="size-3.5" aria-hidden="true" />
        Reset filters
      </Button>
    </div>
  )
}
