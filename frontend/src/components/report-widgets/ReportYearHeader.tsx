import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { ReportComparisonYear } from "./types";

type ReportYearHeaderProps = {
  year: ReportComparisonYear;
  className?: string;
};

export function ReportYearHeader({ year, className }: ReportYearHeaderProps) {
  const yearJobLabel = year.jobNumber || (year.jobId ? `Job ${year.jobId}` : "");

  const content = (
    <div className={`flex flex-col items-center gap-0.5 leading-tight ${className || ""}`}>
      {year.isBenchmark ? (
        <Badge className="h-4 rounded-full border-amber-400 bg-amber-400 px-1.5 py-0 text-[9px] font-bold leading-none text-white">
          BL
        </Badge>
      ) : null}
      {yearJobLabel ? (
        <span className="text-xs font-medium text-slate-700">{yearJobLabel}</span>
      ) : null}
      <span className="text-sm font-normal text-foreground">{year.year}</span>
    </div>
  );

  if (!year.jobId) {
    return content;
  }

  return (
    <Link
      href={`/jobs/${year.jobId}`}
      className={`flex flex-col items-center gap-0.5 leading-tight hover:text-foreground hover:underline ${className || ""}`}
      aria-label={`Open ${yearJobLabel || `Job ${year.jobId}`}`}
    >
      {content}
    </Link>
  );
}

