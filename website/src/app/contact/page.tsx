import Link from "next/link";
import { Mail, MessageSquare } from "lucide-react";
import { SectionHeading } from "@/components/SectionHeading";

export const metadata = {
  title: "Contact",
  description: "Get in touch about the rebuild and future website architecture.",
};

export default function ContactPage() {
  return (
    <div className="site-wrap">
      <section className="page-hero">
        <p className="eyebrow">Contact</p>
        <h1>Let&apos;s turn the current discussion into a rebuild plan.</h1>
        <p className="lead">
          The next step is straightforward: agree the scope, lock the page model, and build the
          first version as a separate Render service.
        </p>
      </section>

      <section className="content-section">
        <div className="contact-grid">
          <article className="page-card contact-cta">
            <SectionHeading
              eyebrow="Start here"
              title="Best next step"
              description="We can begin with the information architecture and the homepage, then expand into service and resource pages."
            />
            <div>
              <Link href="mailto:info@netzero.international" className="btn btn-primary">
                Email the team <Mail size={16} />
              </Link>
            </div>
          </article>

          <article className="page-card">
            <h3>Contact options</h3>
            <p>
              <Mail size={16} style={{ display: "inline", verticalAlign: "-0.15em", marginRight: 8 }} />
              info@netzero.international
            </p>
            <p>
              <MessageSquare size={16} style={{ display: "inline", verticalAlign: "-0.15em", marginRight: 8 }} />
              Render-hosted marketing service in the NZI Insights Pro Live project
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}
