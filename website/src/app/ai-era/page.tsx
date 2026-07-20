import { SectionHeading } from "@/components/SectionHeading";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbSchema } from "@/lib/schema";
import { aiPrinciples } from "@/content/site";

export const metadata = {
  title: "AI-ready content",
  description: "How structured content helps the Net Zero International site perform in search and answer engines.",
  alternates: { canonical: "/ai-era" },
};

const breadcrumbs = breadcrumbSchema([{ name: "AI-ready content", path: "/ai-era" }]);

export default function AiEraPage() {
  return (
    <>
    <JsonLd data={breadcrumbs} />
    <div className="site-wrap">
      <section className="page-hero">
        <p className="eyebrow">AI-ready content</p>
        <h1>Built to be found, verified, and trusted — by people and by AI.</h1>
        <p className="lead">
          However you found us — a search engine, a colleague&apos;s recommendation, or an AI
          assistant helping with due diligence — you should get the same clear answer: who we
          are, what we do, and how to reach us.
        </p>
      </section>

      <section className="content-section">
        <SectionHeading
          eyebrow="What matters"
          title="What this means for you"
          description="The same principles that make us easy to verify online are the ones we bring to your carbon reporting."
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
          eyebrow="In practice"
          title="Clear, consistent, and easy to check"
          description="Every core page states plainly what we do and who it's for, so you don't have to dig for the answer."
        />

        <article className="quote-card">
          <blockquote>
            Whichever page you land on, you should immediately understand what we do, who
            it&apos;s for, and what to do next &mdash; no digging required.
          </blockquote>
        </article>
      </section>
    </div>
    </>
  );
}
