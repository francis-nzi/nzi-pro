import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { AdminModule } from "@/components/admin/adminModuleCatalog";

type AdminCenterAlertBannerProps = {
  criticalModule: AdminModule | null;
};

export function AdminCenterAlertBanner({ criticalModule }: AdminCenterAlertBannerProps) {
  if (!criticalModule) return null;

  return (
    <Card className="border-rose-200 bg-rose-50/70 shadow-sm">
      <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 text-rose-700">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="destructive" className="rounded-full">
                Critical
              </Badge>
              <p className="text-sm font-semibold text-rose-900">1 critical item requires attention</p>
            </div>
            <p className="mt-1 text-sm leading-6 text-rose-800">
              {criticalModule.title} has records pending permanent removal. Review before the next scheduled purge.
            </p>
          </div>
        </div>
        <Button asChild className="rounded-full bg-rose-600 text-white hover:bg-rose-700">
          <Link href={criticalModule.href}>
            Review now
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
