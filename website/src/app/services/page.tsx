import Link from "next/link";
import { SectionHeading } from "@/components/SectionHeading";
import { JsonLd } from "@/components/JsonLd";
import { ClosingCta } from "@/components/ClosingCta";
import { breadcrumbSchema } from "@/lib/schema";
import { serviceCards, servicePages } from "@/content/site";

export const metadata = {
  title: "Services",
  description: "Carbon reporting, carbon reduction plans, Scope 3 support, workshops and training.",
  alternates: { canonical: "/services" },
};

const breadcrumbs = breadcrumbSchema([{ name: "Services", path: "/services" }]);

export default function ServicesPage() {
  return (
    <>
    <JsonLd data={breadcrumbs} />
    <div className="site-wrap">
      <section className="page-hero">
        <p className="eyebrow">Services</p>
        <h1>The core business offering, presented clearly.</h1>
        <p className="lead">
          We offer a small number of well-defined services rather than generic sustainability
          support. Explore each one below, or get in touch if you&apos;re not sure where to start.
        </p>
      </section>

      <section className="content-section">
        <SectionHeading
          eyebrow="Service map"
          title="Dedicated pages for each core offer"
          description="Each core service has its own page covering what's included, who it's for, and what you'll get."
        />

        <div className="card-grid">
          {servicePages.map((page) => (
            <Link key={page.slug} href={`/${page.slug}`} className="page-card">
              <p className="eyebrow">{page.eyebrow}</p>
              <h3>{page.title}</h3>
              <p>{page.description}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="content-section">
        <SectionHeading
          eyebrow="At a glance"
          title="A quick summary of every service"
          description="A one-line view of what each service covers, plus where to go for supporting guides and FAQs."
        />

        <div className="card-grid">
          {serviceCards.map((item) => (
            <article key={item.title} className="page-card">
              <h3>{item.title}</h3>
              <p>{item.summary}</p>
              {item.href ? (
                <Link href={item.href} className="inline-cta">
                  Learn more<span className="sr-only"> about {item.title}</span>
                </Link>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <ClosingCta
        title="Not sure which service fits?"
        description="Tell us what you're trying to achieve and we'll point you to the right one, or tell you honestly if we're not the right fit."
      />
    </div>
    </>
  );
}
