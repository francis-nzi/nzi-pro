"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
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
  critical?: boolean;
};

const ADMIN_MODULES: AdminModule[] = [
  {
    title: "Team Management",
    description: "Manage NZI team members, roles, invitations, and access.",
    href: "/admin/team",
    cta: "Manage Team",
    domain: "People & Access",
  },
  {
    title: "Lookups",
    description: "Maintain statuses, VAT rates, currencies, and other reference lists.",
    href: "/admin/lookups",
    cta: "Manage Lookups",
    domain: "Reference Data",
  },
  {
    title: "Job Items",
    description: "Manage service items used in jobs, quotes, and invoices.",
    href: "/admin/job-items",
    cta: "Manage Items",
    domain: "Reference Data",
  },
  {
    title: "Suppliers",
    description: "Manage suppliers, service items, agreed rates, and default VAT/UoM.",
    href: "/admin/suppliers",
    cta: "Manage Suppliers",
    domain: "Reference Data",
  },
  {
    title: "Datasets & Factors",
    description: "Manage conversion factor datasets and imports.",
    href: "/admin/datasets",
    cta: "Manage Datasets",
    domain: "Reference Data",
  },
  {
    title: "Custom Factors",
    description: "Add custom conversion factors for specific scenarios.",
    href: "/admin/custom-factors",
    cta: "Manage Custom Factors",
    domain: "Reference Data",
  },
  {
    title: "Templates",
    description: "Configure report and data capture templates.",
    href: "/admin/templates",
    cta: "Manage Templates",
    domain: "Reporting & Delivery",
  },
  {
    title: "Milestone Templates",
    description: "Define milestone schedules for each job type.",
    href: "/admin/milestone-templates",
    cta: "Manage Milestones",
    domain: "Reporting & Delivery",
  },
  {
    title: "Automation Rules",
    description: "Configure CRM triggers, actions, and test runs.",
    href: "/admin/automations",
    cta: "Manage Automations",
    domain: "Reporting & Delivery",
  },
  {
    title: "Theme Settings",
    description: "Control branding and visual settings.",
    href: "/admin/theme",
    cta: "Manage Theme",
    domain: "System & Governance",
  },
  {
    title: "Custom Fields",
    description: "Define dynamic fields used across entities.",
    href: "/admin/custom-fields",
    cta: "Manage Fields",
    domain: "System & Governance",
  },
  {
    title: "System Settings",
    description: "Manage global application configuration.",
    href: "/admin/settings",
    cta: "Open Settings",
    domain: "System & Governance",
  },
  {
    title: "Import / Export",
    description: "Run WorkflowMax trial/full imports and export migration snapshots.",
    href: "/admin/import-export",
    cta: "Open Import/Export",
    domain: "System & Governance",
  },
  {
    title: "Email Outbox",
    description: "Monitor outbound emails, delivery status, and failures across the platform.",
    href: "/admin/email-outbox",
    cta: "Open Outbox",
    domain: "System & Governance",
  },
  {
    title: "Archive Management",
    description: "Restore or permanently remove archived records.",
    href: "/admin/archive",
    cta: "Manage Archives",
    domain: "System & Governance",
    critical: true,
  },
];

export default function AdminPage() {
  const [query, setQuery] = useState("");

  const filteredModules = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ADMIN_MODULES;
    return ADMIN_MODULES.filter((m) => {
      const target = `${m.title} ${m.description} ${m.domain}`.toLowerCase();
      return target.includes(q);
    });
  }, [query]);

  const sections = useMemo(() => {
    const order: AdminDomain[] = [
      "People & Access",
      "Reference Data",
      "Reporting & Delivery",
      "System & Governance",
    ];
    return order.map((domain) => ({
      domain,
      items: filteredModules.filter((m) => m.domain === domain),
    }));
  }, [filteredModules]);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-bold" style={{ color: "#F26624" }}>
              Admin Center
            </h1>
            <p className="text-muted-foreground">
              Structured control panel for team, reference data, delivery, and system operations.
            </p>
          </div>
          <div className="w-full md:w-[360px]">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search admin areas..."
            />
          </div>
        </div>

        <div className="space-y-8">
          {sections.map((section) =>
            section.items.length ? (
              <section key={section.domain} className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">{section.domain}</h2>
                  <Badge variant="outline">{section.items.length} modules</Badge>
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {section.items.map((module) => (
                    <Card
                      key={module.href}
                      className={`transition-shadow hover:shadow-md ${module.critical ? "border-destructive/30" : ""}`}
                    >
                      <CardHeader className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <CardTitle style={{ color: "#F26624" }}>{module.title}</CardTitle>
                          {module.critical ? <Badge variant="destructive">Critical</Badge> : null}
                        </div>
                        <CardDescription>{module.description}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Button asChild className="w-full" variant={module.critical ? "destructive" : "default"}>
                          <Link href={module.href}>{module.cta}</Link>
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            ) : null
          )}
        </div>

        <div className="mt-8">
          <Button variant="secondary" asChild>
            <Link href="/">{"<-"} Back to Hub</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
