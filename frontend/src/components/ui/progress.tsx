import * as React from "react";
import { cn } from "@/lib/utils";

type ProgressProps = React.HTMLAttributes<HTMLDivElement> & {
  value?: number;
  max?: number;
};

export function Progress({ className, value = 0, max = 100, ...props }: ProgressProps) {
  const bounded = Math.max(0, Math.min(value, max));
  const pct = max > 0 ? (bounded / max) * 100 : 0;

  return (
    <div
      role="progressbar"
      aria-valuenow={bounded}
      aria-valuemin={0}
      aria-valuemax={max}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-slate-200", className)}
      {...props}
    >
      <div className="h-full rounded-full bg-slate-900 transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}
