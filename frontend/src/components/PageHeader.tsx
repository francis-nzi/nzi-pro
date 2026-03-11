import Link from "next/link";
import React from "react";

import { cn } from "@/lib/utils";

type Breadcrumb = {
  label: string;
  href?: string;
};

type PageHeaderProps = {
  title: string;
  subtitle?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbs?: Breadcrumb[];
  titleSuffix?: React.ReactNode;
  className?: string;
  actionsClassName?: string;
};

export default function PageHeader({
  title,
  subtitle,
  meta,
  actions,
  breadcrumbs,
  titleSuffix,
  className,
  actionsClassName,
}: PageHeaderProps) {
  return (
    <div className={cn("mb-8 space-y-4", className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {breadcrumbs.map((crumb, idx) => (
            <React.Fragment key={`${crumb.label}-${idx}`}>
              {crumb.href ? (
                <Link href={crumb.href} className="hover:text-foreground">
                  {crumb.label}
                </Link>
              ) : (
                <span className="text-foreground">{crumb.label}</span>
              )}
              {idx < breadcrumbs.length - 1 ? <span>/</span> : null}
            </React.Fragment>
          ))}
        </nav>
      ) : null}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">{title}</h1>
            {titleSuffix}
          </div>
          {subtitle ? (
            <div className="text-sm text-muted-foreground">{subtitle}</div>
          ) : null}
          {meta ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {meta}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div className={cn("flex flex-wrap gap-2", actionsClassName)}>{actions}</div>
        ) : null}
      </div>
    </div>
  );
}