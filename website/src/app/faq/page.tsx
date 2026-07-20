import type { Metadata } from "next";
import { SectionHeading } from "@/components/SectionHeading";
import { faqs } from "@/content/site";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Common questions about Net Zero International services and delivery.",
};

export default function FaqPage() {
  return (
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
    </div>
  );
}
