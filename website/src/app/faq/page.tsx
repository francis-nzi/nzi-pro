import type { Metadata } from "next";
import { SectionHeading } from "@/components/SectionHeading";
import { JsonLd } from "@/components/JsonLd";
import { ClosingCta } from "@/components/ClosingCta";
import { breadcrumbSchema, faqPageSchema } from "@/lib/schema";
import { faqs } from "@/content/site";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Common questions about Net Zero International services and delivery.",
  alternates: { canonical: "/faq" },
};

const faqSchema = faqPageSchema("/faq", faqs);
const breadcrumbs = breadcrumbSchema([{ name: "FAQ", path: "/faq" }]);

export default function FaqPage() {
  return (
    <>
      <JsonLd data={faqSchema} />
      <JsonLd data={breadcrumbs} />
      <div className="site-wrap">
        <section className="page-hero">
          <p className="eyebrow">FAQ</p>
          <h1>Questions clients usually ask before they begin.</h1>
          <p className="lead">
            Straight answers to what clients usually want to know before they get in touch.
          </p>
        </section>

        <section className="content-section">
          <SectionHeading
            eyebrow="Answers"
            title="Straight answers"
            description="If your question isn't here, get in touch and we'll answer it directly."
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

        <ClosingCta
          title="Still have a question?"
          description="Send it over and we'll answer directly, no generic reply, no sales pitch."
        />
      </div>
    </>
  );
}
