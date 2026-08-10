"use client";

import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type LeverSummaryItem = {
  lever_id: number;
  sphere_code: string | null;
  sphere_name: string | null;
  sub_sphere_code: string | null;
  sub_sphere_name: string | null;
  lever_code: string;
  lever_name: string;
  lever_description: string | null;
  is_custom: boolean;
  is_active: boolean;
  sort_order: number;
  action_count: number;
  completed_count: number;
  avg_progress: number;
};

export type ActionLeverSummary = {
  levers: LeverSummaryItem[];
  custom_levers: LeverSummaryItem[];
};

type ActionLeverGridProps = {
  summary: ActionLeverSummary | null;
  loading?: boolean;
  selectedLeverId?: number | null;
  onSelectLever?: (leverId: number) => void;
};

type SubSphereGroup = {
  key: string;
  name: string;
  levers: LeverSummaryItem[];
};

type SphereGroup = {
  code: string;
  name: string;
  subSpheres: SubSphereGroup[];
};

function fillColor(avgProgress: number): string {
  if (avgProgress >= 100) return "bg-emerald-200/70 dark:bg-emerald-900/40";
  if (avgProgress >= 50) return "bg-emerald-100/70 dark:bg-emerald-900/25";
  if (avgProgress > 0) return "bg-emerald-50/80 dark:bg-emerald-900/15";
  return "bg-transparent";
}

function LeverCell({
  lever,
  selected,
  onSelect,
}: {
  lever: LeverSummaryItem;
  selected: boolean;
  onSelect?: (leverId: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(lever.lever_id)}
      className={`relative w-full overflow-hidden rounded-lg border p-3 text-left text-xs transition-colors hover:border-primary ${
        selected ? "border-primary ring-1 ring-primary" : "border-border"
      }`}
    >
      <div
        className={`absolute inset-y-0 left-0 ${fillColor(lever.avg_progress)}`}
        style={{ width: `${Math.max(0, Math.min(100, lever.avg_progress))}%` }}
        aria-hidden
      />
      <div className="relative space-y-1.5">
        <div className="font-semibold text-foreground">{lever.lever_code}</div>
        <div className="line-clamp-3 text-muted-foreground">{lever.lever_description || lever.lever_name}</div>
        <div className="flex flex-wrap items-center gap-1 pt-1">
          <Badge variant="secondary" className="text-[10px]">
            {lever.avg_progress}% avg
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {lever.completed_count}/{lever.action_count} complete
          </Badge>
        </div>
      </div>
    </button>
  );
}

export default function ActionLeverGrid({ summary, loading, selectedLeverId, onSelectLever }: ActionLeverGridProps) {
  const spheres = useMemo<SphereGroup[]>(() => {
    const bySphere = new Map<string, SphereGroup>();
    for (const lever of summary?.levers ?? []) {
      const sphereKey = lever.sphere_code || "?";
      if (!bySphere.has(sphereKey)) {
        bySphere.set(sphereKey, { code: sphereKey, name: lever.sphere_name || sphereKey, subSpheres: [] });
      }
      const sphere = bySphere.get(sphereKey)!;
      const subKey = lever.sub_sphere_code || "?";
      let sub = sphere.subSpheres.find((s) => s.key === subKey);
      if (!sub) {
        sub = { key: subKey, name: lever.sub_sphere_name || subKey, levers: [] };
        sphere.subSpheres.push(sub);
      }
      sub.levers.push(lever);
    }
    return Array.from(bySphere.values());
  }, [summary]);

  const customLevers = summary?.custom_levers ?? [];

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading action lever framework...</div>;
  }

  if (spheres.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {spheres.map((sphere) => (
          <Card key={sphere.code} className="overflow-hidden">
            <CardHeader className="pb-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sphere {sphere.code}</div>
              <CardTitle className="text-base">{sphere.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {sphere.subSpheres.map((sub) => (
                <div key={sub.key} className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">
                    {sub.key} &middot; {sub.name}
                  </div>
                  <div className="space-y-2">
                    {sub.levers.map((lever) => (
                      <LeverCell
                        key={lever.lever_id}
                        lever={lever}
                        selected={selectedLeverId === lever.lever_id}
                        onSelect={onSelectLever}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      {customLevers.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Custom Levers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {customLevers.map((lever) => (
                <LeverCell
                  key={lever.lever_id}
                  lever={lever}
                  selected={selectedLeverId === lever.lever_id}
                  onSelect={onSelectLever}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
