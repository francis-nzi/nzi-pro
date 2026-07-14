import Link from "next/link";
import { SectionHeading } from "@/components/SectionHeading";
import { serviceCards, servicePages } from "@/content/site";

export const metadata = {
  title: "Services",
  description: "Carbon reporting, carbon reduction plans, Scope 3 support, workshops and training.",
};

export default function ServicesPage() {
  return (
    <div className="site-wrap">
      <section className="page-hero">
        <p className="eyebrow">Services</p>
        <h1>The core business offering, presented clearly.</h1>
        <p className="lead">
          Each service page should answer three questions immediately: what the service is,
          who it is for, and how it helps the client move forward.
        </p>
      </section>

      <section className="content-section">
        <SectionHeading
          eyebrow="Service map"
          title="Dedicated pages for each core offer"
          description="The main services each have a landing page so the site is useful for people and search."
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
          eyebrow="Service blocks"
          title="Support content that backs up the sales pages"
          description="These are the reusable blocks the site can use across the homepage, cards, and future campaign pages."
        />

        <div className="card-grid">
          {serviceCards.map((item) => (
            <article key={item.title} className="page-card">
              <h3>{item.title}</h3>
              <p>{item.summary}</p>
              {item.href ? (
                <Link href={item.href} className="inline-cta">
                  Learn more
                </Link>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
