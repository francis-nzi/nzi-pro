"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Menu, X } from "lucide-react";
import { navLinks } from "@/content/site";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [lastPathname, setLastPathname] = useState(pathname);

  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setMenuOpen(false);
  }

  return (
    <header className="site-header">
      <div className="site-wrap site-header-inner">
        <Link href="/" className="brand" aria-label="Net Zero International home">
          <span className="brand-mark">NZI</span>
          <span className="brand-text">
            <strong>Net Zero International</strong>
            <span>Carbon reporting and Net Zero support</span>
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
            Contact us <ArrowRight size={16} />
          </Link>
          <button
            className="mobile-menu"
            type="button"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav-panel"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {menuOpen ? (
        <div className="mobile-nav-panel" id="mobile-nav-panel">
          <nav className="mobile-nav" aria-label="Mobile navigation">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={isActive(pathname, link.href) ? "mobile-nav-link active" : "mobile-nav-link"}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <Link href="/contact" className="btn btn-primary mobile-nav-cta">
            Contact us <ArrowRight size={16} />
          </Link>
        </div>
      ) : null}
    </header>
  );
}
