"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  ArchiveRestore,
  BadgeAlert,
  Building2,
  Clock3,
  FileSpreadsheet,
  Folders,
  Gauge,
  Mail,
  Palette,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Table2,
  Users,
  Workflow,
  Boxes,
  Database,
  FileCog,
  Layers3,
  History,
  UploadCloud,
  BellRing,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type AdminDomain = "People & Access" | "Reference Data" | "Reporting & Delivery" | "System & Governance";

type AdminModule = {
  title: string;
  description: string;
  href: string;
  cta: string;
  domain: AdminDomain;
  icon: LucideIcon;
  highlight?: boolean;
  critical?: boolean;
};

const ADMIN_MODULES: AdminModule[] = [
  {
    title: "Organisation Management",
    description: "Create organisations, manage membership, switch the active tenant, and review billing controls.",
    href: "/admin/organisations",
    cta: "Open organisations",
    domain: "People & Access",
    icon: Building2,
    highlight: true,
  },
  {
    title: "Billing & Entitlements",
    description: "Review plan status, subscription state, usage limits, invoices, and billing events.",
    href: "/admin/billing",
    cta: "Review billing",
    domain: "People & Access",
    icon: ShieldCheck,
    highlight: true,
  },
  {
    title: "Team Management",
    description: "Manage NZI team members, roles, invitations, and access.",
    href: "/admin/team",
    cta: "Manage team",
    domain: "People & Access",
    icon: Users,
    highlight: true,
  },
  {
    title: "Lookups",
    description: "Maintain statuses, VAT rates, currencies, and other reference lists.",
    href: "/admin/lookups",
    cta: "Edit lookups",
    domain: "Reference Data",
    icon: Table2,
  },
  {
    title: "Job Items",
    description: "Manage service items used in jobs, quotes, and invoices.",
    href: "/admin/job-items",
    cta: "Open job items",
    domain: "Reference Data",
    icon: FileSpreadsheet,
  },
  {
    title: "Suppliers",
    description: "Manage suppliers, service items, agreed rates, and default VAT/UoM.",
    href: "/admin/suppliers",
    cta: "Manage suppliers",
    domain: "Reference Data",
    icon: Boxes,
  },
  {
    title: "Datasets & Factors",
    description: "Manage conversion factor datasets and imports.",
    href: "/admin/datasets",
    cta: "Open datasets",
    domain: "Reference Data",
    icon: Database,
    highlight: true,
  },
  {
    title: "Reusable Factors",
    description: "Add reusable global and client-level factors for jobs.",
    href: "/admin/custom-factors",
    cta: "Manage factors",
    domain: "Reference Data",
    icon: Layers3,
  },
  {
    title: "Templates",
    description: "Configure report and data capture templates.",
    href: "/admin/templates",
    cta: "Open templates",
    domain: "Reporting & Delivery",
    icon: FileCog,
    highlight: true,
  },
  {
    title: "Milestone Templates",
    description: "Define milestone schedules for each job type.",
    href: "/admin/milestone-templates",
    cta: "Plan milestones",
    domain: "Reporting & Delivery",
    icon: Clock3,
  },
  {
    title: "Automation Rules",
    description: "Configure CRM triggers, actions, and test runs.",
    href: "/admin/automations",
    cta: "Review automations",
    domain: "Reporting & Delivery",
    icon: Workflow,
  },
  {
    title: "Action Options",
    description: "Manage suggested carbon reduction actions used in job action plans and reports.",
    href: "/admin/actions-options",
    cta: "Edit actions",
    domain: "Reporting & Delivery",
    icon: Sparkles,
  },
  {
    title: "Theme Settings",
    description: "Control branding and visual settings.",
    href: "/admin/theme",
    cta: "Adjust theme",
    domain: "System & Governance",
    icon: Palette,
  },
  {
    title: "Custom Fields",
    description: "Define dynamic fields used across entities.",
    href: "/admin/custom-fields",
    cta: "Shape fields",
    domain: "System & Governance",
    icon: Folders,
  },
  {
    title: "System Settings",
    description: "Manage global application configuration.",
    href: "/admin/settings",
    cta: "Open settings",
    domain: "System & Governance",
    icon: Settings2,
  },
  {
    title: "Import / Export",
    description: "Run WorkflowMax trial/full imports and export migration snapshots.",
    href: "/admin/import-export",
    cta: "Run import/export",
    domain: "System & Governance",
    icon: UploadCloud,
    highlight: true,
  },
  {
    title: "Audit Log",
    description: "Review append-only changes made by team members across clients, jobs, sites, and data.",
    href: "/admin/audit-log",
    cta: "Inspect audit trail",
    domain: "System & Governance",
    icon: History,
  },
  {
    title: "Missing Data",
    description: "Find clients and jobs with blank fields, then update those values in one place.",
    href: "/admin/missing-data",
    cta: "Resolve missing data",
    domain: "Reporting & Delivery",
    icon: BadgeAlert,
  },
  {
    title: "Email Outbox",
    description: "Monitor outbound emails, delivery status, and failures across the platform.",
    href: "/admin/email-outbox",
    cta: "Review outbox",
    domain: "System & Governance",
    icon: Mail,
  },
  {
    title: "Tenant Usage Dashboard",
    description: "Review org capacity, archive state, and queue health at a glance.",
    href: "/admin/tenant-usage",
    cta: "Open usage dashboard",
    domain: "System & Governance",
    icon: Gauge,
  },
  {
    title: "Background Jobs",
    description: "Monitor queued PDF jobs, inspect failures, and replay safe jobs.",
    href: "/admin/background-jobs",
    cta: "Open job monitor",
    domain: "System & Governance",
    icon: BellRing,
  },
  {
    title: "Archive Management",
    description: "Restore or permanently remove archived records.",
    href: "/admin/archive",
    cta: "Manage archives",
    domain: "System & Governance",
    icon: ArchiveRestore,
    critical: true,
  },
];

const DOMAIN_ORDER: AdminDomain[] = [
  "People & Access",
  "Reference Data",
  "Reporting & Delivery",
  "System & Governance",
];

const DOMAIN_COPY: Record<AdminDomain, { eyebrow: string; summary: string }> = {
  "People & Access": {
    eyebrow: "Who can do what",
    summary: "Tenancy, billing, and team access live here. Start with organisations or billing if you are setting up a new customer.",
  },
  "Reference Data": {
    eyebrow: "Shared building blocks",
    summary: "Keep dropdowns, datasets, suppliers, and factor libraries in one reliable place.",
  },
  "Reporting & Delivery": {
    eyebrow: "How work gets delivered",
    summary: "Templates, milestones, automations, and report actions shape the client experience and your internal workflow.",
  },
  "System & Governance": {
    eyebrow: "Platform control room",
    summary: "Use these tools for global configuration, compliance, monitoring, and recovery tasks.",
  },
};

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
