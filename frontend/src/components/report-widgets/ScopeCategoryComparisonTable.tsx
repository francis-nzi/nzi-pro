import type { ReactNode } from "react";
import { ReportYearHeader } from "./ReportYearHeader";
import { REPORT_WIDGET_IDS } from "./registry";
import type { ReportComparisonYear, ScopeCategoryComparisonRow } from "./types";

type ScopeCategoryComparisonTableProps = {
  years: ReportComparisonYear[];
  rows: ScopeCategoryComparisonRow[];
  widgetKey?: string;
  showWidgetRef?: boolean;
  emptyText?: string;
  valueFormatter?: (value: number | null, year: number) => ReactNode;
};

export function ScopeCategoryComparisonTable({
  years,
  rows,
  widgetKey = REPORT_WIDGET_IDS.scopeCategoryComparison,
  showWidgetRef = false,
  emptyText = "No comparison data available.",
  valueFormatter = (value) => (value == null ? "-" : value.toFixed(2)),
}: ScopeCategoryComparisonTableProps) {
  if (!years.length) {
    return <div className="text-sm text-muted-foreground">{emptyText}</div>;
  }

  if (!rows.length) {
    return <div className="text-sm text-muted-foreground">{emptyText}</div>;
  }

  return (
    <div className="overflow-x-auto" data-widget-key={widgetKey}>
      {showWidgetRef ? (
        <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
          <span>Widget ref</span>
          <span className="font-mono tracking-[0.18em] text-foreground">{widgetKey}</span>
        </div>
      ) : null}
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-muted">
            <th className="text-left p-2 border">Scope</th>
            <th className="text-left p-2 border">Category</th>
            {years.map((year) => (
              <th key={year.year} className="p-2 border whitespace-nowrap align-middle text-center">
                <ReportYearHeader year={year} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            if (row.type === "category") {
              return (
                <tr key={`cat-${row.scope}-${row.category}-${idx}`} className="hover:bg-muted/30">
                  <td className="p-2 border">{row.scope}</td>
                  <td className="p-2 border">{row.category}</td>
                  {row.values.map((value, colIdx) => (
                    <td key={colIdx} className="text-right p-2 border">
                      {valueFormatter(value, years[colIdx]?.year)}
                    </td>
                  ))}
                </tr>
              );
            }
            if (row.type === "subtotal") {
              return (
                <tr key={`sub-${row.scope}-${idx}`} className="bg-muted/60 font-semibold">
                  <td className="p-2 border">{row.scope}</td>
                  <td className="p-2 border">Subtotal</td>
                  {row.values.map((value, colIdx) => (
                    <td key={colIdx} className="text-right p-2 border">
                      {valueFormatter(value, years[colIdx]?.year)}
                    </td>
                  ))}
                </tr>
              );
            }
            return (
              <tr key={`total-${idx}`} className="bg-muted font-bold">
                <td className="p-2 border">All Scopes</td>
                <td className="p-2 border">Total</td>
                {row.values.map((value, colIdx) => (
                  <td key={colIdx} className="text-right p-2 border">
                    {valueFormatter(value, years[colIdx]?.year)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
