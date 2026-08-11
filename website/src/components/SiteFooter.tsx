import Image from "next/image";
import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-wrap footer-grid">
        <div>
          <Image
            src="/netzero-mark.png"
            alt="Net Zero International"
            width={52}
            height={52}
            className="footer-mark"
          />
          <p className="eyebrow">Net Zero International</p>
          <h2>Practical net zero support for organisations that need clarity and credibility.</h2>
          <p className="muted">
            We help clients measure, report and reduce emissions through carbon accounting,
            carbon reduction plans, Scope 3 support, workshops and CPD accredited training.
          </p>
        </div>

        <div className="footer-links">
          <div>
            <span>Explore</span>
            <Link href="/services">Services</Link>
            <Link href="/carbon-reduction-plans">Carbon Reduction Plans</Link>
            <Link href="/scope-3">Scope 3</Link>
            <Link href="/workshops">Workshops</Link>
            <Link href="/training">Training</Link>
            <Link href="/resources">Resources</Link>
            <Link href="/faq">FAQ</Link>
          </div>
          <div>
            <span>Standards</span>
            <Link href="/standards">Standards</Link>
            <Link href="/ghg-protocol">GHG Protocol</Link>
            <Link href="/iso-14064">ISO 14064</Link>
            <Link href="/iso-14060">ISO 14060</Link>
          </div>
          <div>
            <span>Company</span>
            <Link href="/about">About</Link>
            <Link href="/regulations">Regulations</Link>
            <Link href="/glossary">Glossary</Link>
            <Link href="/contact">Contact</Link>
          </div>
          <div>
            <span>Support</span>
            <Link href="/regulations">Reporting</Link>
            <Link href="/uk-srs-readiness">UK SRS Readiness</Link>
            <Link href="/resources">Knowledge hub</Link>
            <Link href="/contact">Talk to us</Link>
          </div>
        </div>
      </div>

      <div className="site-wrap footer-bottom">
        <p>Net Zero International. Designed as a standalone Render service.</p>
        <p>Measured content first, dynamic data when needed.</p>
      </div>
    </footer>
  );
}
