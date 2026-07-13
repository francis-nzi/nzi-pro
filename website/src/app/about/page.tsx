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

        <div className="page-layout">
          <article className="quote-card">
            <blockquote>
              The website should be a knowledge surface, a sales surface, and a trust surface.
              It should not force visitors to decode the business from generic page builders.
            </blockquote>
          </article>

          <article className="page-card">
            <h3>What this means in practice</h3>
            <p>
              Strong copy, specific pages, clean architecture, and an operating model that allows
              us to plug in live data, lead capture, and portal links when needed.
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}
