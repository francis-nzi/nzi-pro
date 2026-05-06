"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ADMIN_CENTER_GROUPS,
  getAdminCenterModulesByDomain,
  toAdminCenterHref,
  type AdminDomain,
  type AdminModule,
  recordAdminCenterVisit,
} from "./adminCenterConfig";

type AdminCenterSidebarProps = {
  activeDomain: AdminDomain;
  onSelectDomain: (domain: AdminDomain) => void;
  onNavigate?: () => void;
};

export function AdminCenterSidebar({ activeDomain, onSelectDomain, onNavigate }: AdminCenterSidebarProps) {
  const [openDomains, setOpenDomains] = useState<Record<AdminDomain, boolean>>({
    "People & Access": true,
    "Reference Data": true,
    "Reporting & Delivery": true,
    "System & Governance": true,
  });

  const groups = useMemo(
    () =>
      ADMIN_CENTER_GROUPS.map((group) => ({
        ...group,
        modules: getAdminCenterModulesByDomain(group.domain),
      })),
    [],
  );

  function handleVisit(module: AdminModule) {
    recordAdminCenterVisit(module);
    onNavigate?.();
  }

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-r border-slate-200/80 bg-white/95 backdrop-blur">
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-2">
          {groups.map((group) => {
            const isOpen = openDomains[group.domain];
            const active = activeDomain === group.domain;
            return (
              <section key={group.domain} className="rounded-2xl border border-slate-200/80 bg-slate-50/70">
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left transition",
                    active ? "bg-[#1c5026]/8 text-slate-900" : "text-slate-800 hover:bg-slate-100",
                  )}
                  onClick={() => {
                    setOpenDomains((current) => ({ ...current, [group.domain]: !current[group.domain] }));
                    onSelectDomain(group.domain);
                  }}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">{group.label}</span>
                      <Badge variant="outline" className="rounded-full border-slate-200 px-2 py-0.5 text-[11px]">
                        {group.count}
                      </Badge>
                    </div>
                  </div>
                  {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />}
                </button>

                {isOpen ? (
                  <div className="space-y-1 px-3 pb-3">
                    {group.modules.map((module) => {
                      const Icon = module.icon;
                      return (
                        <Link
                          key={module.href}
                          href={toAdminCenterHref(module.href)}
                          onClick={() => handleVisit(module)}
                          className={cn(
                            "group flex items-start gap-3 rounded-xl px-3 py-2 transition hover:bg-white",
                            active && module.domain === activeDomain ? "bg-white shadow-sm" : "",
                          )}
                        >
                          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700 transition group-hover:bg-[#1c5026]/10 group-hover:text-[#1c5026]">
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-slate-900">{module.title}</span>
                              {module.highlight ? (
                                <Badge className="rounded-full bg-amber-100 text-amber-800 hover:bg-amber-100">Priority</Badge>
                              ) : null}
                              {module.critical ? (
                                <Badge variant="destructive" className="rounded-full">
                                  Critical
                                </Badge>
                              ) : null}
                            </span>
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
