import { SectionHeading } from "@/components/SectionHeading";
import { aiPrinciples } from "@/content/site";

export const metadata = {
  title: "AI-ready content",
  description: "How structured content helps the Net Zero International site perform in search and answer engines.",
};

export default function AiEraPage() {
  return (
    <div className="site-wrap">
      <section className="page-hero">
        <p className="eyebrow">AI-ready content</p>
        <h1>Structure the site so people and answer engines can understand it quickly.</h1>
        <p className="lead">
          The useful move is not gimmicky AI content. It is a site that is structured, fast,
          explicit, and easy to quote, classify, and retrieve.
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
          title="How that translates into the site"
          description="The site should include a content map, schema, metadata, and clean internal linking so the platform is ready for later integrations."
        />

        <article className="quote-card">
          <blockquote>
            Every important page should be useful on its own. If an AI agent reads only one page,
            it should still understand the company, the offer, and the next action.
          </blockquote>
        </article>
      </section>
    </div>
  );
}
