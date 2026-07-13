import { SectionHeading } from "@/components/SectionHeading";
import { faqs } from "@/content/site";

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
