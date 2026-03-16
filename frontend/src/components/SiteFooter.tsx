"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SiteFooter() {
  const pathname = usePathname();
  const hideFooter =
    pathname === "/legal" ||
    pathname?.startsWith("/legal/") ||
    pathname === "/login" ||
    pathname === "/change-password";

  if (hideFooter) {
    return null;
  }

  return (
    <footer className="border-t bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-6 py-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
        <div>Copyright Net Zero International</div>
        <div className="flex flex-wrap gap-4">
          <Link href="/legal#standard-terms" className="hover:text-foreground">Terms</Link>
          <Link href="/legal#portal-terms" className="hover:text-foreground">Portal Terms</Link>
          <Link href="/legal#privacy-policy" className="hover:text-foreground">Privacy</Link>
          <Link href="/legal#cookie-notice" className="hover:text-foreground">Cookies</Link>
        </div>
      </div>
    </footer>
  );
}
