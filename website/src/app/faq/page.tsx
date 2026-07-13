import type { Metadata } from "next";
import { SectionHeading } from "@/components/SectionHeading";
import { faqs } from "@/content/site";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Common questions about the rebuilt public site and its future-proof setup.",
};

export default function FaqPage() {
  return (
    <div className="site-wrap">
      <section className="page-hero">
        <p className="eyebrow">FAQ</p>
        <h1>Questions the site should answer clearly.</h1>
        <p className="lead">
          These answers should be easy to scan, easy to quote, and easy to expand later as the
          site grows.
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
