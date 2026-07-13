import { SectionHeading } from "@/components/SectionHeading";

export const metadata = {
  title: "About",
  description: "Why the new site exists and what it should communicate.",
};

export default function AboutPage() {
  return (
    <div className="site-wrap">
      <section className="page-hero">
        <p className="eyebrow">About</p>
        <h1>Clear, credible, and ready to scale.</h1>
        <p className="lead">
          The rebuilt site should make the company easier to understand in under a minute. That
          means sharper positioning, more obvious proof, and fewer dead-end pages.
        </p>
      </section>

      <section className="content-section">
        <SectionHeading
          eyebrow="Why now"
          title="The current site is doing too much of the job through template noise"
          description="A future-proof rebuild separates brand, content, and application concerns so each part can evolve without breaking the rest."
        />

        <div className="card-grid">
          <article className="info-card">
            <h3>Sales surface</h3>
            <p>Clear offers, obvious next steps, and pages that make it easy to enquire or book a call.</p>
          </article>
          <article className="info-card">
            <h3>Knowledge surface</h3>
            <p>Resources, glossary pages, and answer-first content that help people and AI systems understand the business.</p>
          </article>
          <article className="info-card">
            <h3>Trust surface</h3>
            <p>Consistent design, proof points, and a structure that says who you are before asking for action.</p>
          </article>
        </div>
      </section>

      <section className="content-section">
        <SectionHeading
          eyebrow="Working model"
          title="What this means in practice"
          description="The public site should be content-driven, but ready to connect to live data and product surfaces when needed."
        />

        <div className="page-layout">
          <article className="quote-card">
            <blockquote>
              Strong copy, specific pages, clean architecture, and an operating model that allows us to plug in live data, lead capture, and portal links when needed.
            </blockquote>
          </article>
        </div>
      </section>
    </div>
  );
}
