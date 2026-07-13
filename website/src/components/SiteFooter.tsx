import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-wrap footer-grid">
        <div>
          <p className="eyebrow">NZ Insights Pro</p>
          <h2>Built for the AI era, but grounded in real delivery.</h2>
          <p className="muted">
            A future-proof marketing site should do three things well: explain the business clearly,
            help AI and search understand the brand, and connect cleanly to live systems when needed.
          </p>
        </div>

        <div className="footer-links">
          <div>
            <span>Explore</span>
            <Link href="/services">Services</Link>
            <Link href="/scope-3">Scope 3</Link>
            <Link href="/workshops">Workshops</Link>
            <Link href="/training">Training</Link>
            <Link href="/ai-era">AI Era</Link>
            <Link href="/resources">Resources</Link>
            <Link href="/faq">FAQ</Link>
          </div>
          <div>
            <span>Company</span>
            <Link href="/about">About</Link>
            <Link href="/regulations">Regulations</Link>
            <Link href="/glossary">Glossary</Link>
            <Link href="/contact">Contact</Link>
          </div>
          <div>
            <span>Use cases</span>
            <Link href="/workshops">Workshops</Link>
            <Link href="/training">Training</Link>
            <Link href="/ai-era">AI Era</Link>
          </div>
        </div>
      </div>

      <div className="site-wrap footer-bottom">
        <p>Net Zero International. Designed as a standalone Render service.</p>
        <p>Public site first. Dynamic data later.</p>
      </div>
    </footer>
  );
}
