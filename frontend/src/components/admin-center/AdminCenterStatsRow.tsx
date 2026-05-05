import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export type AdminCenterStat = {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone?: "green" | "slate" | "amber" | "rose";
};

type AdminCenterStatsRowProps = {
  stats: AdminCenterStat[];
};

const toneClasses: Record<NonNullable<AdminCenterStat["tone"]>, string> = {
  green: "border-emerald-200 bg-emerald-50/80 text-emerald-900",
  slate: "border-slate-200 bg-slate-50 text-slate-900",
  amber: "border-amber-200 bg-amber-50/80 text-amber-900",
  rose: "border-rose-200 bg-rose-50/80 text-rose-900",
};

export function AdminCenterStatsRow({ stats }: AdminCenterStatsRowProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <Card
            key={stat.label}
            className={`overflow-hidden border shadow-sm ${toneClasses[stat.tone || "slate"]}`}
          >
            <CardContent className="flex items-start justify-between gap-3 p-5">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">{stat.label}</p>
                <div className="mt-2 text-3xl font-semibold leading-none tracking-tight">{stat.value}</div>
                <p className="mt-2 text-sm leading-6 text-slate-600">{stat.detail}</p>
              </div>
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/70 text-slate-700 shadow-sm">
                <Icon className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
