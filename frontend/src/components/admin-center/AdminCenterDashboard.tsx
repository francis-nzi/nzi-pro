"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Building2, Search, Table2, Users, Workflow } from "lucide-react";
import { ADMIN_CENTER_GROUPS, ADMIN_CENTER_MODULE_COUNT, getAdminCenterCriticalModule, getAdminCenterGroup, getAdminCenterModulesByDomain, type AdminDomain } from "./adminCenterConfig";
import { AdminCenterAlertBanner } from "./AdminCenterAlertBanner";
import { AdminCenterModuleGrid } from "./AdminCenterModuleGrid";
import { AdminCenterRecentlyVisited } from "./AdminCenterRecentlyVisited";
import { AdminCenterShell } from "./AdminCenterShell";
import { AdminCenterStatsRow, type AdminCenterStat } from "./AdminCenterStatsRow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AdminCenterDashboard() {
  const [selectedDomain, setSelectedDomain] = useState<AdminDomain>(ADMIN_CENTER_GROUPS[0].domain);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const currentGroup = useMemo(() => getAdminCenterGroup(selectedDomain), [selectedDomain]);

  const filteredModules = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const base = getAdminCenterModulesByDomain(selectedDomain);
    if (!q) return base;
    return base.filter((module) => {
      const target = `${module.title} ${module.description} ${module.domain}`.toLowerCase();
      return target.includes(q);
    });
  }, [deferredQuery, selectedDomain]);

  const heroStats = useMemo<AdminCenterStat[]>(
    () => [
      {
        label: "Active Modules",
        value: ADMIN_CENTER_MODULE_COUNT.toString(),
        detail: "Across 4 categories",
        icon: Table2,
        tone: "green",
      },
      {
        label: "Team Members",
        value: "14",
        detail: "3 pending invitations",
        icon: Users,
        tone: "slate",
      },
      {
        label: "Organisations",
        value: "8",
        detail: "2 active tenants",
        icon: Building2,
        tone: "slate",
      },
      {
        label: "Automations",
        value: "6",
        detail: "All running normally",
        icon: Workflow,
        tone: "slate",
      },
    ],
    [],
  );

  const criticalModule = getAdminCenterCriticalModule();

  return (
    <AdminCenterShell>
      <div className="space-y-6">
        <section className="overflow-hidden rounded-[2rem] border border-slate-200/80 bg-white shadow-sm">
          <div className="border-b border-slate-200/80 px-6 py-6 sm:px-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-800">Admin Center</Badge>
                  <Badge variant="outline" className="border-slate-200 text-slate-700">
                    {ADMIN_CENTER_MODULE_COUNT} modules
                  </Badge>
                  {criticalModule ? <Badge variant="destructive">1 critical</Badge> : null}
                </div>
                <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-900">Control center for operations</h1>
                <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
                  A clearer starting point for the tools that keep the platform running. Search, jump straight to the
                  task you need, or use the grouped areas below when you are working methodically.
                </p>
              </div>
            </div>
          </div>

          <div className="border-b border-slate-200/80 px-6 py-5 sm:px-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative w-full lg:max-w-xl">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search admin areas, tasks, or modules..."
                  className="h-12 rounded-2xl border-slate-200 bg-white pl-10 text-base shadow-sm"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {ADMIN_CENTER_GROUPS.map((group) => (
                  <Button
                    key={group.domain}
                    type="button"
                    variant={selectedDomain === group.domain ? "default" : "outline"}
                    className={
                      selectedDomain === group.domain
                        ? "rounded-full bg-[#1c5026] text-white hover:bg-[#153f1e]"
                        : "rounded-full border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                    }
                    onClick={() => setSelectedDomain(group.domain)}
                  >
                    {group.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <AdminCenterAlertBanner criticalModule={criticalModule} />

        <AdminCenterStatsRow stats={heroStats} />

        <AdminCenterRecentlyVisited />

        <section className="rounded-[2rem] border border-slate-200/80 bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-[16px] font-bold text-[#1a1a2e]">
                {currentGroup.label} <span className="font-medium text-slate-500">— {getAdminCenterModulesByDomain(selectedDomain).length} modules</span>
              </div>
              <p className="mt-1 text-[13px] font-normal leading-6 text-slate-500">{currentGroup.subtitle}</p>
            </div>
            <div className="text-sm text-slate-500">
              Showing {filteredModules.length} module{filteredModules.length === 1 ? "" : "s"}
            </div>
          </div>

          <AdminCenterModuleGrid modules={filteredModules} />
        </section>
      </div>
    </AdminCenterShell>
  );
}
