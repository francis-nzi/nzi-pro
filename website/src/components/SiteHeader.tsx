"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Menu } from "lucide-react";
import { navLinks } from "@/content/site";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="site-header">
      <div className="site-wrap site-header-inner">
        <Link href="/" className="brand" aria-label="NZ Insights Pro home">
          <span className="brand-mark">NZI</span>
          <span className="brand-text">
            <strong>NZ Insights Pro</strong>
            <span>Net Zero International</span>
          </span>
        </Link>

        <nav className="site-nav" aria-label="Main navigation">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={isActive(pathname, link.href) ? "nav-link active" : "nav-link"}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="header-actions">
          <Link href="/contact" className="btn btn-ghost desktop-only">
            Book a call <ArrowRight size={16} />
          </Link>
          <button className="mobile-menu" type="button" aria-label="Open navigation">
            <Menu size={20} />
          </button>
        </div>
      </div>
    </header>
  );
}
