"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { clearAuthState, getAuthUserIdentifier, hasAuthState } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export function MainNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [profileOpen, setProfileOpen] = useState(false);
  const [authUi, setAuthUi] = useState<{ ready: boolean; authed: boolean; userId: string }>({
    ready: false,
    authed: false,
    userId: "",
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      setAuthUi({
        ready: true,
        authed: hasAuthState(),
        userId: getAuthUserIdentifier() || "",
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [pathname]);

  if (pathname === "/login" || pathname === "/change-password") {
    return null;
  }

  const links = [
    { href: "/", label: "Dashboard" },
    { href: "/clients", label: "Clients" },
    { href: "/jobs", label: "Jobs" },
    { href: "/business-development", label: "Sales" },
    { href: "/admin", label: "Admin" },
  ];

  return (
    <nav className="border-b bg-background">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-xl font-bold">NZI Pro</span>
          </Link>

          <div className="flex items-center gap-1">
            {links.map((link) => {
              const isActive = pathname === link.href || pathname?.startsWith(link.href + "/");
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <span>{link.label}</span>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-4">
          {!authUi.ready ? (
            <div className="h-9 w-24" aria-hidden />
          ) : authUi.authed ? (
            <div className="relative">
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1c5026] text-sm font-semibold text-white"
                onClick={() => setProfileOpen((v) => !v)}
                aria-label="Open account menu"
              >
                {(authUi.userId || "U").trim().charAt(0).toUpperCase() || "U"}
              </button>
              {profileOpen ? (
                <div className="absolute right-0 z-50 mt-2 w-64 rounded-md border bg-background p-2 shadow-lg">
                  <div className="rounded px-2 py-1.5 text-xs text-muted-foreground">Signed in as</div>
                  <div className="truncate px-2 pb-2 text-sm font-medium">{authUi.userId}</div>
                  <Button variant="ghost" size="sm" className="w-full justify-start" asChild>
                    <Link href="/account/settings" onClick={() => setProfileOpen(false)}>User Admin</Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => {
                      clearAuthState();
                      router.replace("/login");
                    }}
                  >
                    Sign out
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
