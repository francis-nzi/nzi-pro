"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminCenterShell } from "./AdminCenterShell";
import { AdminCenterSidebar } from "./AdminCenterSidebar";
import {
  ADMIN_CENTER_GROUPS,
  getAdminCenterModuleByHref,
  toAdminHref,
  type AdminDomain,
} from "./adminCenterConfig";

const modulePages = {
  "actions-options": dynamic(() => import("@/app/admin/actions-options/page"), { ssr: false }),
  archive: dynamic(() => import("@/app/admin/archive/page"), { ssr: false }),
  "archived-clients": dynamic(() => import("@/app/admin/archived-clients/page"), { ssr: false }),
  "audit-log": dynamic(() => import("@/app/admin/audit-log/page"), { ssr: false }),
  automations: dynamic(() => import("@/app/admin/automations/page"), { ssr: false }),
  "background-jobs": dynamic(() => import("@/app/admin/background-jobs/page"), { ssr: false }),
  billing: dynamic(() => import("@/app/admin/billing/page"), { ssr: false }),
  "custom-factors": dynamic(() => import("@/app/admin/custom-factors/page"), { ssr: false }),
  "custom-fields": dynamic(() => import("@/app/admin/custom-fields/page"), { ssr: false }),
  datasets: dynamic(() => import("@/app/admin/datasets/page"), { ssr: false }),
  "email-outbox": dynamic(() => import("@/app/admin/email-outbox/page"), { ssr: false }),
  "import-export": dynamic(() => import("@/app/admin/import-export/page"), { ssr: false }),
  "job-items": dynamic(() => import("@/app/admin/job-items/page"), { ssr: false }),
  "job-types": dynamic(() => import("@/app/admin/job-types/page"), { ssr: false }),
  lookups: dynamic(() => import("@/app/admin/lookups/page"), { ssr: false }),
  "milestone-templates": dynamic(() => import("@/app/admin/milestone-templates/page"), { ssr: false }),
  "missing-data": dynamic(() => import("@/app/admin/missing-data/page"), { ssr: false }),
  organisations: dynamic(() => import("@/app/admin/organisations/page"), { ssr: false }),
  settings: dynamic(() => import("@/app/admin/settings/page"), { ssr: false }),
  suppliers: dynamic(() => import("@/app/admin/suppliers/page"), { ssr: false }),
  team: dynamic(() => import("@/app/admin/team/page"), { ssr: false }),
  templates: dynamic(() => import("@/app/admin/templates/page"), { ssr: false }),
  "tenant-usage": dynamic(() => import("@/app/admin/tenant-usage/page"), { ssr: false }),
  theme: dynamic(() => import("@/app/admin/theme/page"), { ssr: false }),
  "time-subjects": dynamic(() => import("@/app/admin/time-subjects/page"), { ssr: false }),
} as const;

type ModuleSlug = keyof typeof modulePages;

function LoadingState() {
  return (
    <Card className="border-slate-200/80 bg-white/90 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Loader2 className="h-4 w-4 animate-spin text-[#1c5026]" />
          Loading admin module
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-slate-600">Please wait while the module loads.</CardContent>
    </Card>
  );
}

function NotFoundState({ href }: { href: string }) {
  return (
    <Card className="border-dashed border-slate-200/80 bg-white/90 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base text-slate-900">Admin module not found</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-slate-600">
        <p>The requested module is not available in the Admin Center route map.</p>
        <Link href={toAdminHref(href)} className="font-medium text-[#1c5026] hover:underline">
          Open the legacy admin route
        </Link>
      </CardContent>
    </Card>
  );
}

export function AdminCenterModuleRouteView({ slug }: { slug: string[] }) {
  const slugKey = slug.join("/") as ModuleSlug;
  const legacyHref = `/admin/${slugKey}`;
  const module = getAdminCenterModuleByHref(legacyHref);
  const activeDomain: AdminDomain = module?.domain ?? ADMIN_CENTER_GROUPS[0].domain;
  const Page = modulePages[slugKey];

  const sidebar = useMemo(
    () => (
      <AdminCenterSidebar
        activeDomain={activeDomain}
        onSelectDomain={() => {
          // The sidebar is navigational first; selecting a category should not change the current module view.
        }}
      />
    ),
    [activeDomain],
  );

  return (
    <AdminCenterShell label="Admin" sidebar={sidebar}>
      <div className="space-y-6">
        {Page ? <Page /> : <NotFoundState href={legacyHref} />}
      </div>
    </AdminCenterShell>
  );
}
