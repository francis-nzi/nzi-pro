"use client";

import { useMemo } from "react";
import type { LucideIcon } from "lucide-react";
import { BadgeAlert, Building2, ClipboardCheck, Database, FileCog, Gauge, History, Mail, Palette, Settings2, ShieldCheck, Sparkles, Table2, Users, Workflow, Boxes, FileSpreadsheet, Clock3, Layers3, UploadCloud, BellRing, ArchiveRestore, Folders } from "lucide-react";
import { AdminCenterShell } from "@/components/admin-center/AdminCenterShell";

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
  { title: "SRS Readiness Questions", href: "/admin/srs-readiness", description: "UK SRS Readiness assessment question bank.", domain: "Reporting & Delivery", icon: ClipboardCheck },
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
  void useMemo(() => getAdminSectionByPath(pathname), [pathname]);
  return <AdminCenterShell>{children}</AdminCenterShell>;
}
