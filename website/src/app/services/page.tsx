import Link from "next/link";
import { SectionHeading } from "@/components/SectionHeading";
import { serviceCards, servicePages } from "@/content/site";

export const metadata = {
  title: "Services",
  description: "Core service areas for the rebuilt NZ Insights Pro site.",
};

export default function ServicesPage() {
  return (
    <div className="site-wrap">
      <section className="page-hero">
        <p className="eyebrow">Services</p>
        <h1>Explain the offers in a way that converts and can be expanded later.</h1>
        <p className="lead">
          Each service page should answer three questions immediately: what the service is,
          who it is for, and what the next step should be.
        </p>
      </section>

      <section className="content-section">
        <SectionHeading
          eyebrow="Service map"
          title="Launch the services as proper pages, not just bullets"
          description="The main offers should have dedicated landing pages so search, AI, and people can all understand the business clearly."
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
          title="Supporting commercial entries"
          description="These are the reusable blocks the site can use across the homepage, cards, and future campaign pages."
        />

        <div className="card-grid">
          {serviceCards.map((item) => (
            <article key={item.title} className="page-card">
              <h3>{item.title}</h3>
              <p>{item.summary}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
