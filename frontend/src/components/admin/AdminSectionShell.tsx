"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, BadgeAlert, Building2, Database, FileCog, Gauge, History, Mail, Palette, Settings2, ShieldCheck, Sparkles, Table2, Users, Workflow, Boxes, FileSpreadsheet, Clock3, Layers3, UploadCloud, BellRing, ArchiveRestore, Folders } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type AdminDomain = "People & Access" | "Reference Data" | "Reporting & Delivery" | "System & Governance";

export type AdminSection = {
  title: string;
  href: string;
  description: string;
  domain: AdminDomain;
  icon: LucideIcon;
  critical?: boolean;
};

export const ADMIN_SECTIONS: AdminSection[] = [
  { title: "Organisation Management", href: "/admin/organisations", description: "Tenants, membership, switching, and billing controls.", domain: "People & Access", icon: Building2 },
  { title: "Billing & Entitlements", href: "/admin/billing", description: "Plans, limits, invoices, and billing events.", domain: "People & Access", icon: ShieldCheck },
  { title: "Team Management", href: "/admin/team", description: "Users, invitations, and access.", domain: "People & Access", icon: Users },
  { title: "Lookups", href: "/admin/lookups", description: "Statuses, VAT, currencies, and other reference lists.", domain: "Reference Data", icon: Table2 },
  { title: "Job Items", href: "/admin/job-items", description: "Items used in jobs, quotes, and invoices.", domain: "Reference Data", icon: FileSpreadsheet },
  { title: "Suppliers", href: "/admin/suppliers", description: "Supplier records, services, and defaults.", domain: "Reference Data", icon: Boxes },
  { title: "Datasets & Factors", href: "/admin/datasets", description: "Conversion datasets and factor imports.", domain: "Reference Data", icon: Database },
  { title: "Reusable Factors", href: "/admin/custom-factors", description: "Reusable client and global factors.", domain: "Reference Data", icon: Layers3 },
  { title: "Templates", href: "/admin/templates", description: "Data capture and report templates.", domain: "Reporting & Delivery", icon: FileCog },
  { title: "Milestone Templates", href: "/admin/milestone-templates", description: "Milestone schedules for job types.", domain: "Reporting & Delivery", icon: Clock3 },
  { title: "Automation Rules", href: "/admin/automations", description: "CRM triggers and automated actions.", domain: "Reporting & Delivery", icon: Workflow },
  { title: "Action Options", href: "/admin/actions-options", description: "Suggested actions for reports.", domain: "Reporting & Delivery", icon: Sparkles },
  { title: "Missing Data", href: "/admin/missing-data", description: "Find and clean up incomplete records.", domain: "Reporting & Delivery", icon: BadgeAlert },
  { title: "Theme Settings", href: "/admin/theme", description: "Branding and visual controls.", domain: "System & Governance", icon: Palette },
  { title: "Custom Fields", href: "/admin/custom-fields", description: "Fields across clients, jobs, and suppliers.", domain: "System & Governance", icon: Folders },
  { title: "System Settings", href: "/admin/settings", description: "Global platform configuration.", domain: "System & Governance", icon: Settings2 },
  { title: "Import / Export", href: "/admin/import-export", description: "WorkflowMax imports and migration snapshots.", domain: "System & Governance", icon: UploadCloud },
  { title: "Audit Log", href: "/admin/audit-log", description: "Immutable record of admin changes.", domain: "System & Governance", icon: History },
  { title: "Email Outbox", href: "/admin/email-outbox", description: "Delivery monitoring and failures.", domain: "System & Governance", icon: Mail },
  { title: "Tenant Usage Dashboard", href: "/admin/tenant-usage", description: "Capacity, archive state, and queues.", domain: "System & Governance", icon: Gauge },
  { title: "Background Jobs", href: "/admin/background-jobs", description: "Queued jobs, failures, and replay.", domain: "System & Governance", icon: BellRing },
  { title: "Archive Management", href: "/admin/archive", description: "Restore or permanently remove archived records.", domain: "System & Governance", icon: ArchiveRestore, critical: true },
];

export const DOMAIN_ORDER: AdminDomain[] = ["People & Access", "Reference Data", "Reporting & Delivery", "System & Governance"];

export const DOMAIN_LABELS: Record<AdminDomain, string> = {
  "People & Access": "People & Access",
  "Reference Data": "Reference Data",
  "Reporting & Delivery": "Reporting & Delivery",
  "System & Governance": "System & Governance",
};

export function getAdminSectionByPath(pathname: string): AdminSection | null {
  const normalized = pathname.endsWith("/") && pathname !== "/" ? pathname.slice(0, -1) : pathname;
  return ADMIN_SECTIONS.find((section) => normalized === section.href || normalized.startsWith(`${section.href}/`)) ?? null;
}

export function AdminSectionShell({
  pathname,
  children,
}: {
  pathname: string;
  children: React.ReactNode;
}) {
  const section = useMemo(() => getAdminSectionByPath(pathname), [pathname]);
  const isHub = pathname === "/admin";

  if (isHub) return <>{children}</>;

  const SectionIcon = section?.icon ?? Building2;

  return (
    <div className="bg-[radial-gradient(circle_at_top_left,_rgba(242,102,36,0.08),_transparent_25%),linear-gradient(180deg,_#faf7f2_0%,_#ffffff_24%)]">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="overflow-hidden rounded-[2rem] border border-orange-100/70 bg-white/90 shadow-[0_18px_70px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="border-b border-slate-200/70 px-6 py-6 sm:px-8">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-800">Admin Area</Badge>
              <Badge variant="outline" className="border-orange-200 text-orange-700">
                {section ? DOMAIN_LABELS[section.domain] : "Admin"}
              </Badge>
            </div>
            <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#1c5026]/10 text-[#1c5026]">
                    <SectionIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Admin Center</p>
                    <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
                      {section?.title || "Admin tools"}
                    </h1>
                  </div>
                </div>
                <p className="max-w-2xl text-sm leading-6 text-slate-600">
                  {section?.description ||
                    "A shared control surface for tenant operations, reference data, delivery settings, and governance."}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild className="rounded-full bg-[#1c5026] text-white hover:bg-[#153f1e]">
                  <Link href="/admin">Open admin hub</Link>
                </Button>
                <Button asChild variant="outline" className="rounded-full border-slate-200">
                  <Link href="/">
                    <span>Back to hub</span>
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              {DOMAIN_ORDER.map((domain) => (
                <Badge key={domain} variant="outline" className="rounded-full border-slate-200 px-3 py-1 text-sm">
                  {DOMAIN_LABELS[domain]}
                </Badge>
              ))}
            </div>
          </div>

          <div className="px-6 py-5 sm:px-8">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Quick routes</h2>
                <p className="text-sm text-slate-600">Jump to the major admin zones without hunting through menus.</p>
              </div>
              <Badge variant="outline" className="rounded-full border-slate-200 px-3 py-1 text-sm">
                {ADMIN_SECTIONS.length} modules
              </Badge>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {ADMIN_SECTIONS.slice(0, 8).map((item) => {
                const ItemIcon = item.icon;
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`group flex items-start gap-3 rounded-2xl border px-4 py-3 transition-all hover:-translate-y-0.5 hover:shadow-md ${
                      active
                        ? "border-[#1c5026]/30 bg-[#1c5026]/5"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${active ? "bg-[#1c5026]/10 text-[#1c5026]" : "bg-slate-100 text-slate-700"}`}>
                      <ItemIcon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900">{item.title}</span>
                        {item.critical ? <Badge variant="destructive">Critical</Badge> : null}
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-slate-600">{item.description}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="border-t border-slate-200/70 px-6 py-6 sm:px-8">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
