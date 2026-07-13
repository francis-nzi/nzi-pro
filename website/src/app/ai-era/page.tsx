import { SectionHeading } from "@/components/SectionHeading";
import { aiPrinciples } from "@/content/site";

export const metadata = {
  title: "AI Era",
  description: "Why the new site should be designed for AI discovery and structured retrieval.",
};

export default function AiEraPage() {
  return (
    <div className="site-wrap">
      <section className="page-hero">
        <p className="eyebrow">AI era</p>
        <h1>Yes, we should build for the AI era.</h1>
        <p className="lead">
          The most useful move is not gimmicky AI content. It is a site that is structured,
          fast, explicit, and easy to quote, classify, and retrieve.
        </p>
      </section>

      <section className="content-section">
        <SectionHeading
          eyebrow="What matters"
          title="The useful takeaways"
          description="These are the parts that translate directly into site architecture and content strategy."
        />

        <div className="card-grid">
          {aiPrinciples.map((item) => (
            <article key={item.title} className="info-card">
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="content-section">
        <SectionHeading
          eyebrow="Implementation"
          title="How we would translate that into the site"
          description="The initial rebuild should include a content map, schema, metadata, and clean internal linking so the platform is ready for later integrations."
        />

        <article className="quote-card">
          <blockquote>
            The future-proof move is to make every important page useful on its own. If an AI agent
            reads only one page, it should still understand the company, the offer, and the next
            action.
          </blockquote>
        </article>
      </section>
    </div>
  );
}
