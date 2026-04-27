"use client";

import { BarChart3 } from "lucide-react";
import type { ReactNode } from "react";

type EmptyChartProps = {
  title?: string;
  description?: string;
  icon?: ReactNode;
  className?: string;
  minHeight?: string;
};

export default function EmptyChart({
  title = "No data available",
  description,
  icon,
  className = "",
  minHeight = "min-h-[220px]",
}: EmptyChartProps) {
  const Icon = icon ?? <BarChart3 className="h-5 w-5" />;
  return (
    <div
      className={`flex ${minHeight} items-center justify-center rounded-lg border border-dashed border-muted-foreground/20 bg-muted/10 px-6 py-8 text-center ${className}`}
    >
      <div className="max-w-sm space-y-2">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {Icon}
        </div>
        <div className="text-sm font-medium text-foreground">{title}</div>
        {description ? <div className="text-xs text-muted-foreground">{description}</div> : null}
      </div>
    </div>
  );
}
