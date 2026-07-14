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
          These answers should be easy to scan, easy to quote, and easy to expand as the site
          develops.
        </p>
      </section>

      <section className="content-section">
        <SectionHeading
          eyebrow="Answers"
          title="Short, direct, reusable"
          description="This format works well for visitors and for answer engines."
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
