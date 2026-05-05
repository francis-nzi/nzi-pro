"use client";

import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";
import type { AdminModule } from "@/components/admin/adminModuleCatalog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { recordAdminCenterVisit } from "./adminCenterConfig";

type AdminCenterModuleGridProps = {
  modules: AdminModule[];
  onNavigate?: () => void;
};

export function AdminCenterModuleGrid({ modules, onNavigate }: AdminCenterModuleGridProps) {
  function handleVisit(module: AdminModule) {
    recordAdminCenterVisit(module);
    onNavigate?.();
  }

  return (
    <section className="space-y-4">
      {modules.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {modules.map((module) => {
            const Icon = module.icon;
            return (
              <Card
                key={module.href}
                className="group overflow-hidden border-slate-200/80 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-[#1c5026]/20 hover:shadow-md"
              >
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#1c5026]/8 text-[#1c5026]">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      {module.highlight ? (
                        <Badge className="rounded-full bg-amber-100 text-amber-800 hover:bg-amber-100">Priority</Badge>
                      ) : null}
                      {module.critical ? <Badge variant="destructive">Critical</Badge> : null}
                    </div>
                  </div>
                  <div>
                    <CardTitle className="text-lg text-slate-900">{module.title}</CardTitle>
                    <CardDescription className="mt-2 text-sm leading-6 text-slate-600">
                      {module.description}
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="pb-5">
                  <Link
                    href={module.href}
                    onClick={() => handleVisit(module)}
                    className="inline-flex items-center gap-2 text-sm font-medium text-[#1c5026] transition hover:text-[#153f1e]"
                  >
                    {module.cta}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                    <ExternalLink className="h-3.5 w-3.5" />
                    Opens the existing admin module
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="border-dashed border-slate-200 bg-slate-50 shadow-none">
          <CardContent className="px-4 py-8 text-sm text-slate-600">
            No modules match this filter. Try another group or search term.
          </CardContent>
        </Card>
      )}
    </section>
  );
}
