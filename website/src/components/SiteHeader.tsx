"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, ChevronDown, Menu, X } from "lucide-react";
import { navLinks, type NavLink } from "@/content/site";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavDropdown({ link, pathname }: { link: NavLink; pathname: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = isActive(pathname, link.href);

  useEffect(() => {
    if (!open) return;

    function handleClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div className="nav-dropdown" ref={ref}>
      <button
        type="button"
        className={active ? "nav-link nav-dropdown-trigger active" : "nav-link nav-dropdown-trigger"}
        aria-expanded={open}
        aria-haspopup="true"
        aria-current={active ? "page" : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {link.label}
        <ChevronDown size={14} className={open ? "nav-caret nav-caret-open" : "nav-caret"} aria-hidden="true" />
      </button>

      {open ? (
        <div className="nav-dropdown-panel">
          <Link
            href={link.href}
            className="nav-dropdown-link nav-dropdown-overview"
            onClick={() => setOpen(false)}
          >
            {link.label} overview
          </Link>
          {link.children?.map((child) => (
            <Link
              key={child.href}
              href={child.href}
              className="nav-dropdown-link"
              onClick={() => setOpen(false)}
            >
              {child.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
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
          <Image
            src="/netzero-logo.png"
            alt="Net Zero International"
            width={150}
            height={59}
            priority
          />
        </Link>

        <nav className="site-nav" aria-label="Main navigation">
          {navLinks.map((link) =>
            link.children ? (
              <NavDropdown key={link.href} link={link} pathname={pathname} />
            ) : (
              <Link
                key={link.href}
                href={link.href}
                className={isActive(pathname, link.href) ? "nav-link active" : "nav-link"}
                aria-current={isActive(pathname, link.href) ? "page" : undefined}
              >
                {link.label}
              </Link>
            )
          )}
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
              <div key={link.href} className="mobile-nav-group">
                <Link
                  href={link.href}
                  className={isActive(pathname, link.href) ? "mobile-nav-link active" : "mobile-nav-link"}
                  aria-current={isActive(pathname, link.href) ? "page" : undefined}
                >
                  {link.label}
                </Link>
                {link.children ? (
                  <div className="mobile-nav-sublist">
                    {link.children.map((child) => (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={
                          isActive(pathname, child.href) ? "mobile-nav-sublink active" : "mobile-nav-sublink"
                        }
                        aria-current={isActive(pathname, child.href) ? "page" : undefined}
                      >
                        {child.label}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
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
