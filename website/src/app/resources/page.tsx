import Link from "next/link";
import { SectionHeading } from "@/components/SectionHeading";
import { faqs, resourcePages } from "@/content/site";

export const metadata = {
  title: "Resources",
  description: "FAQs and support material for the rebuilt public site.",
};

export default function ResourcesPage() {
  return (
    <div className="site-wrap">
      <section className="page-hero">
        <p className="eyebrow">Resources</p>
        <h1>Build the knowledge layer alongside the sales site.</h1>
        <p className="lead">
          Resource pages are where AI-era visibility compounds. They answer common questions,
          support search intent, and create more entry points into the business.
        </p>
      </section>

      <section className="content-section">
        <SectionHeading
          eyebrow="Resource hub"
          title="Start here for knowledge pages"
          description="These pages support search, AI discovery, and internal linking."
        />

        <div className="card-grid">
          {resourcePages.map((page) => (
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
          eyebrow="FAQ"
          title="Questions the site should answer explicitly"
          description="These are the kinds of questions that should be easy to find both on the site and via search."
        />

        <div className="faq-grid">
          {faqs.map((item) => (
            <article key={item.q} className="faq-card">
              <h3>{item.q}</h3>
              <p>{item.a}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
