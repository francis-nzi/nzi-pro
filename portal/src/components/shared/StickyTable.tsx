import * as React from "react"
import { Table, TableHeader } from "@/components/ui/table"
import { cn } from "@/lib/utils"

/**
 * Table primitive with a sticky header baked in — the raw Table/TableHeader
 * primitives don't stick on their own, and every long portal table (Data,
 * Files, Portfolio client lists) needs the same behaviour, so it belongs
 * here once rather than repeated per page.
 */
export function StickyTable({
  className,
  maxHeight = "70vh",
  children,
  ...props
}: React.ComponentProps<typeof Table> & { maxHeight?: string }) {
  return (
    <div className="relative w-full overflow-auto rounded-lg border border-border" style={{ maxHeight }}>
      <Table className={cn("caption-bottom text-sm", className)} {...props}>
        {children}
      </Table>
    </div>
  )
}

export function StickyTableHeader({
  className,
  ...props
}: React.ComponentProps<typeof TableHeader>) {
  return (
    <TableHeader
      className={cn(
        "sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--border))] [&_tr]:border-b-0",
        className
      )}
      {...props}
    />
  )
}

export { TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
