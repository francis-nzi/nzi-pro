import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type AdminPageHeaderProps = {
  kicker?: string;
  title: string;
  description: string;
  badges?: ReactNode[];
  actions?: ReactNode;
  children?: ReactNode;
};

export function AdminPageHeader({ kicker, title, description, badges, actions, children }: AdminPageHeaderProps) {
  return (
    <Card className="mb-6 overflow-hidden border-orange-100/70 bg-gradient-to-br from-white to-orange-50/60 shadow-[0_12px_50px_rgba(15,23,42,0.06)]">
      <CardHeader className="space-y-4 pb-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            {kicker ? <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{kicker}</div> : null}
            <CardTitle className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{title}</CardTitle>
            <CardDescription className="mt-3 max-w-2xl text-base leading-7 text-slate-600">{description}</CardDescription>
            {badges?.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {badges.map((badge, index) => (
                  <Badge key={index} variant="outline" className="rounded-full border-slate-200 px-3 py-1">
                    {badge}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap gap-2 lg:justify-end">{actions}</div> : null}
        </div>
      </CardHeader>
      {children ? <CardContent>{children}</CardContent> : null}
    </Card>
  );
}
