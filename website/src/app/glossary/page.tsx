import type { Metadata } from "next";
import { SectionHeading } from "@/components/SectionHeading";
import { glossaryTerms } from "@/content/site";

export const metadata: Metadata = {
  title: "Net Zero Glossary",
  description: "Key terminology explained in plain English.",
};

export default function GlossaryPage() {
  return (
    <div className="site-wrap">
      <section className="page-hero">
        <p className="eyebrow">Glossary</p>
        <h1>A glossary that makes the subject easier to navigate.</h1>
        <p className="lead">
          This page helps visitors, search engines, and AI assistants understand the language
          used across the site.
        </p>
      </section>

      <section className="content-section">
        <SectionHeading
          eyebrow="Terms"
          title="Useful definitions"
          description="Short explanations that can be linked to from service pages, resources, and FAQs."
        />

        <div className="card-grid">
          {glossaryTerms.map((term) => (
            <article key={term.term} className="page-card">
              <h3>{term.term}</h3>
              <p>{term.definition}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
