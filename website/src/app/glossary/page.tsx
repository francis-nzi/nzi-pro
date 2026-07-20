import type { Metadata } from "next";
import { SectionHeading } from "@/components/SectionHeading";
import { JsonLd } from "@/components/JsonLd";
import { ClosingCta } from "@/components/ClosingCta";
import { breadcrumbSchema, definedTermSetSchema } from "@/lib/schema";
import { glossaryTerms } from "@/content/site";

export const metadata: Metadata = {
  title: "Net Zero Glossary",
  description: "Key carbon reporting and Net Zero terminology explained in plain English.",
  alternates: { canonical: "/glossary" },
};

const definedTermSet = definedTermSetSchema(glossaryTerms);
const breadcrumbs = breadcrumbSchema([{ name: "Glossary", path: "/glossary" }]);

export default function GlossaryPage() {
  return (
    <>
      <JsonLd data={definedTermSet} />
      <JsonLd data={breadcrumbs} />
      <div className="site-wrap">
        <section className="page-hero">
          <p className="eyebrow">Glossary</p>
          <h1>A glossary that makes the subject easier to navigate.</h1>
          <p className="lead">
            Plain-English definitions for the carbon reporting and Net Zero terms you&apos;ll come
            across when working with us.
          </p>
        </section>

        <section className="content-section">
          <SectionHeading
            eyebrow="Terms"
            title="Useful definitions"
            description="The core terms that come up most in carbon accounting and Net Zero reporting."
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

        <ClosingCta
          title="Term not covered here?"
          description="Ask us directly, we're happy to explain how any of this applies to your organisation specifically."
        />
      </div>
    </>
  );
}
