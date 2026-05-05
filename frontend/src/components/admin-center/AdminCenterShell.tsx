"use client";

import { useEffect, useState } from "react";
import { Menu, PanelLeftClose, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AdminCenterShellProps = {
  sidebar: React.ReactNode;
  children: React.ReactNode;
};

export function AdminCenterShell({ sidebar, children }: AdminCenterShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, []);

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[linear-gradient(180deg,_#f3f6f8_0%,_#ffffff_18%)]">
      <div className="mx-auto flex w-full max-w-[1680px]">
        <aside className="hidden min-h-[calc(100vh-4rem)] w-[340px] shrink-0 border-r border-slate-200/70 bg-white/90 lg:sticky lg:top-16 lg:block lg:self-start">
          {sidebar}
        </aside>

        <main className="min-w-0 flex-1 px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
          <div className="mb-4 flex items-center justify-between gap-3 lg:hidden">
            <Button
              variant="outline"
              size="sm"
              className="rounded-full border-slate-200 bg-white"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="mr-2 h-4 w-4" />
              Menu
            </Button>
            <div className="text-sm font-semibold text-slate-500">Admin Center</div>
          </div>
          {children}
        </main>
      </div>

      <div
        className={cn(
          "fixed inset-0 z-50 bg-slate-950/40 transition-opacity lg:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setMobileOpen(false)}
        aria-hidden={!mobileOpen}
      >
        <div
          className={cn(
            "absolute inset-y-0 left-0 w-[min(92vw,340px)] bg-white shadow-2xl transition-transform",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <PanelLeftClose className="h-4 w-4 text-[#1c5026]" />
              Navigation
            </div>
            <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)} aria-label="Close menu">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="h-[calc(100%-57px)] overflow-y-auto">{sidebar}</div>
        </div>
      </div>
    </div>
  );
}
