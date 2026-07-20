import Link from "next/link";
import { ArrowRight, Mail, MessageSquare } from "lucide-react";
import { SectionHeading } from "@/components/SectionHeading";

export const metadata = {
  title: "Contact",
  description: "Contact Net Zero International about carbon reporting, Scope 3, workshops or training.",
};

export default function ContactPage() {
  return (
    <div className="site-wrap">
      <section className="page-hero">
        <p className="eyebrow">Contact</p>
        <h1>Start the conversation with the right service.</h1>
        <p className="lead">
          Tell us what you need help with and we&apos;ll point you toward the right support,
          whether that is carbon reporting, a carbon reduction plan, Scope 3 work, workshops or training.
        </p>
      </section>

      <section className="content-section">
        <div className="contact-grid">
          <article className="page-card contact-cta">
            <SectionHeading
              eyebrow="Start here"
              title="Best next step"
              description="Use the email link below to request a discovery call or ask about a specific service."
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
              Tell us about your reporting, reduction plan, Scope 3, workshop, or training needs
            </p>
            <p>
              <ArrowRight size={16} style={{ display: "inline", verticalAlign: "-0.15em", marginRight: 8 }} />
              We can start with a short discovery conversation and agree the right next step.
            </p>
          </article>
        </div>
      </section>

      <section className="content-section">
        <SectionHeading
          eyebrow="Before you email"
          title="What to include"
          description="A few details up front help us point you to the right service straight away."
        />

        <div className="page-layout">
          <article className="page-card">
            <ul className="stack-list">
              <li>Which service you&apos;re interested in, if you already know</li>
              <li>Your organisation type and rough size (sites, headcount, or turnover)</li>
              <li>Any deadline you&apos;re working to, e.g. a procurement or reporting date</li>
              <li>Any reporting or data you already have in place</li>
            </ul>
          </article>
        </div>
      </section>
    </div>
  );
}
