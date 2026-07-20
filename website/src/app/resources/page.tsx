import Link from "next/link";
import { SectionHeading } from "@/components/SectionHeading";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbSchema } from "@/lib/schema";
import { faqs, resourcePages } from "@/content/site";
import { comparisonPages } from "@/content/comparisons";

export const metadata = {
  title: "Resources",
  description: "Glossary and FAQs that help explain the Net Zero International services.",
  alternates: { canonical: "/resources" },
};

const breadcrumbs = breadcrumbSchema([{ name: "Resources", path: "/resources" }]);

export default function ResourcesPage() {
  return (
    <>
    <JsonLd data={breadcrumbs} />
    <div className="site-wrap">
      <section className="page-hero">
        <p className="eyebrow">Resources</p>
        <h1>Support material for clients and search visitors.</h1>
        <p className="lead">
          Plain-English guides to the terms and questions that come up most when clients start
          working with us.
        </p>
      </section>

      <section className="content-section">
        <SectionHeading
          eyebrow="Resource hub"
          title="Start here for knowledge pages"
          description="Start with the glossary or FAQ, or head straight to a service page if you already know what you need."
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
          eyebrow="Guides"
          title="Short answers to specific comparisons"
          description="Standalone guides for the questions that come up most when scoping carbon work."
        />

        <div className="card-grid">
          {comparisonPages.map((page) => (
            <Link key={page.slug} href={`/resources/${page.slug}`} className="page-card">
              <h3>{page.h1}</h3>
              <p>{page.metaDescription}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="content-section">
        <SectionHeading
          eyebrow="FAQ"
          title="Common questions"
          description="The questions we're asked most before a project starts. See the full FAQ page for more."
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
    </>
  );
}
