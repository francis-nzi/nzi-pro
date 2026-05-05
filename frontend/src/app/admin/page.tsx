"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, BadgeAlert, Search, Sparkles, Table2 } from "lucide-react";
import { ADMIN_DOMAINS as DOMAIN_ORDER, ADMIN_MODULES, DOMAIN_COPY, type AdminDomain, type AdminModule } from "@/components/admin/adminModuleCatalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function AdminPage() {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const filteredModules = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return ADMIN_MODULES;
    return ADMIN_MODULES.filter((m) => {
      const target = `${m.title} ${m.description} ${m.domain}`.toLowerCase();
      return target.includes(q);
    });
  }, [deferredQuery]);

  const stats = useMemo(() => {
    const criticalCount = ADMIN_MODULES.filter((m) => m.critical).length;
    const highlightCount = ADMIN_MODULES.filter((m) => m.highlight).length;
    return {
      modules: ADMIN_MODULES.length,
      criticalCount,
      highlightCount,
    };
  }, []);

  const featuredModules = useMemo(() => ADMIN_MODULES.filter((m) => m.highlight || m.critical), []);

  const sections = useMemo(() => {
    return DOMAIN_ORDER.map((domain) => ({
      domain,
      items: filteredModules.filter((m) => m.domain === domain),
    }));
  }, [filteredModules]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(242,102,36,0.10),_transparent_28%),linear-gradient(180deg,_#fdfbf8_0%,_#ffffff_28%)]">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="overflow-hidden rounded-[2rem] border border-orange-100/70 bg-white/85 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="relative overflow-hidden border-b border-slate-200/70 px-6 py-8 sm:px-8">
            <div className="absolute inset-0 bg-gradient-to-r from-[#1c5026]/8 via-transparent to-[#f26624]/8" />
            <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-800">Admin Center</Badge>
                  <Badge variant="outline" className="border-orange-200 text-orange-700">
                    {stats.modules} modules
                  </Badge>
                  <Badge variant="outline" className="border-rose-200 text-rose-700">
                    {stats.criticalCount} critical
                  </Badge>
                </div>
                <div>
                  <h1 className="text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">Control center for operations</h1>
                  <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
                    A clearer starting point for the tools that keep the platform running. Search, jump straight to
                    the task you need, or use the grouped areas below when you are working methodically.
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[360px]">
                <StatPill label="Modules" value={stats.modules.toString()} icon={Table2} />
                <StatPill label="Highlights" value={stats.highlightCount.toString()} icon={Sparkles} />
                <StatPill label="Critical" value={stats.criticalCount.toString()} icon={BadgeAlert} />
              </div>
            </div>
          </div>

          <div className="border-b border-slate-200/70 px-6 py-5 sm:px-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative w-full lg:max-w-xl">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search admin areas, tasks, or modules..."
                  className="h-12 rounded-2xl border-slate-200 bg-white pl-10 text-base shadow-sm"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {DOMAIN_ORDER.map((domain) => (
                  <Badge key={domain} variant="outline" className="rounded-full border-slate-200 px-3 py-1 text-sm">
                    {domain}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          <div className="px-6 py-6 sm:px-8">
            <div className="mb-6 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Quick access</h2>
                <p className="text-sm text-slate-600">The most common places to go first.</p>
              </div>
              <Badge variant="outline" className="rounded-full border-slate-200 px-3 py-1">
                {featuredModules.length} priority tools
              </Badge>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {featuredModules.map((module) => (
                <FeaturedModuleCard key={module.href} module={module} />
              ))}
            </div>
          </div>

          <div className="space-y-8 px-6 pb-8 sm:px-8">
            {sections.map((section) =>
              section.items.length ? (
                <section key={section.domain} className="space-y-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                        {DOMAIN_COPY[section.domain].eyebrow}
                      </div>
                      <h3 className="text-2xl font-semibold text-slate-900">{section.domain}</h3>
                      <p className="max-w-3xl text-sm text-slate-600">{DOMAIN_COPY[section.domain].summary}</p>
                    </div>
                    <Badge variant="outline" className="w-fit rounded-full border-slate-200 px-3 py-1">
                      {section.items.length} modules
                    </Badge>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {section.items.map((module) => (
                      <ModuleCard key={module.href} module={module} />
                    ))}
                  </div>
                </section>
              ) : null
            )}

            {!filteredModules.length ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 px-6 py-12 text-center">
                <p className="text-lg font-medium text-slate-900">No admin areas match your search.</p>
                <p className="mt-2 text-sm text-slate-600">Try a broader term like “team”, “billing”, or “archive”.</p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Button variant="secondary" asChild className="rounded-full">
            <Link href="/">← Back to Hub</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function StatPill({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Icon className="h-4 w-4 text-[#1c5026]" />
        <span>{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function FeaturedModuleCard({ module }: { module: AdminModule }) {
  const Icon = module.icon;
  return (
    <Card className={`group h-full border-slate-200 bg-gradient-to-br from-white to-slate-50 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg ${module.critical ? "border-rose-200" : ""}`}>
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#1c5026]/10 text-[#1c5026]">
            <Icon className="h-5 w-5" />
          </div>
          {module.critical ? <Badge variant="destructive">Critical</Badge> : <Badge variant="outline">Priority</Badge>}
        </div>
        <div>
          <CardTitle className="text-lg text-slate-900">{module.title}</CardTitle>
          <CardDescription className="mt-2 text-sm leading-6 text-slate-600">{module.description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Button asChild className="w-full rounded-xl bg-[#1c5026] text-white hover:bg-[#153f1e]">
          <Link href={module.href}>
            {module.cta}
            <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function ModuleCard({ module }: { module: AdminModule }) {
  const Icon = module.icon;
  return (
    <Card className={`group h-full border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${module.critical ? "border-rose-200" : ""}`}>
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
            <Icon className="h-4 w-4" />
          </div>
          {module.critical ? <Badge variant="destructive">Critical</Badge> : null}
        </div>
        <div>
          <CardTitle className="text-base text-slate-900">{module.title}</CardTitle>
          <CardDescription className="mt-2 text-sm leading-6 text-slate-600">{module.description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Button
          asChild
          variant="outline"
          className="w-full justify-between rounded-xl border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50"
        >
          <Link href={module.href}>
            {module.cta}
            <ArrowRight className="h-4 w-4 text-slate-500 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
